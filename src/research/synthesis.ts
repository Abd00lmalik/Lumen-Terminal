/**
 * Answer synthesis (research contract: RETRIEVAL IS NOT SYNTHESIS).
 *
 * The adaptive loop's decision rationale was written to decide whether research CONTINUES,
 * not to answer the trader's question. Using it as the answer produced the live failure
 * where "What could affect AAPL around its next earnings?" came back as a list of statistics
 * (price, EPS, market cap, PE) with no statement of what could actually affect the stock.
 *
 * This stage is the explicit ANALYSIS step between validated evidence and the final answer:
 * it receives the trader's verbatim question, the engine-assessed requirement coverage, and
 * the validated context, and must return the answer to the QUESTION — factors, mechanisms,
 * evidence refs, what would change the view — never a restatement of the evidence.
 *
 * Hard rules carried from the existing architecture: evidence-only facts (no background
 * knowledge presented as research), no provider/process notes in the answer, epistemic
 * classes preserved, citations restricted to real context refs, uncertainty never hidden,
 * no em/en dashes.
 */

import type { ModelProvider, OutputSchema } from "../model/provider.js";
import { validateModelOutput } from "../model/provider.js";
import type { ResearchContext } from "./context.js";
import { renderResearchContext } from "./context.js";
import {
  contractGapStatement,
  contractViolations,
  stripUnsupportedClaims,
  type ContractState,
  type ContractViolation,
} from "./contract-checks.js";

/** Storage/process language: an implication phrased as run accounting is not decision support. */
const PROCESS_NOTE = /preserved|evidence object|research id|rs_\d|deeper level|disclosure|provider|storage/i;

/**
 * Banned opener shapes (final-judgment contract): the first sentence must BE the answer,
 * never scene-setting, evidence bookkeeping, or a market-data summary. "The evidence
 * supports the thesis because" is an ANSWER (it states the verdict) and stays allowed; the
 * ban targets evidence-as-subject openers ("Evidence indicates...", "The available evidence...")
 * and conditions/summary openers.
 */
const BANNED_OPENERS =
  /^(current (market|macroeconomic)? ?(conditions|conditions show)|comprehensive evidence|evidence (indicates|suggests|shows|has been|is)|the (available |retrieved |gathered |collected )evidence|market data shows?|based on (the )?(evidence|research)|after (research|analysis)|the research (shows|indicates|found)|here (is|are))/i;

/** Does the direct answer obey the question-first law? */
export function opensWithTheAnswer(directAnswer: string): boolean {
  return !BANNED_OPENERS.test(directAnswer.trim());
}

export const ANSWER_SYNTHESIS_SCHEMA_DESC = [
  "{",
  ' "directAnswer": string, // 2 to 5 sentences that DIRECTLY answer the question',
  ' "keyFactors": [{',
  '   "factor": string,        // what it is, in the question\'s own terms',
  '   "mechanism": string,     // how it would act on the subject (transmission path)',
  '   "direction": string,     // which way it leans given the evidence, or "mixed"/"unclear"',
  '   "evidenceRefs": string[] // evidence ids from the context that support THIS factor',
  '   "counterevidenceRefs": string[] // evidence ids from the context that WEAKEN or complicate this factor; [] when the context holds none (say so, never invent)',
  " }],",
  ' "whatWouldChangeTheView": string[], // observable conditions that would alter the conclusion',
  ' "implication": string,             // what the conclusion means for the trader\'s decision: one or two sentences, no process notes',
  ' "uncertainty": string[],            // material gaps only; never provider notes',
  ' "confidence": "HIGH"|"MODERATE"|"LOW",',
  ' "citedObjectRefs": string[]         // evidence ids from the context only',
  "}",
].join("\n");

const ANSWER_SYNTHESIS_SCHEMA: OutputSchema = {
  name: "research.answer_synthesis",
  properties: {
    directAnswer: "string",
    keyFactors: "record[]",
    whatWouldChangeTheView: "string[]",
    implication: "string",
    uncertainty: "string[]",
    confidence: "string",
    citedObjectRefs: "string[]",
  },
  optional: ["whatWouldChangeTheView", "implication", "uncertainty", "confidence"],
};

const SYNTHESIS_SYSTEM = [
  "You are the ANSWER SYNTHESIZER of a trading RESEARCH workbench. You turn validated research evidence into the answer to the trader's question.",
  "The trader asked a QUESTION. Answer THAT question. Do NOT describe the research process, the providers, the tools, or what data happened to be retrieved.",
  "Hard rules:",
  "- RETRIEVAL IS NOT AN ANSWER. Reporting price, EPS, market cap or a headline is not an answer; say what those observations MEAN for the question (the factor, its mechanism, and why it matters).",
  "- Every factual claim must come from the provided context. Your background knowledge may clarify concepts but is NOT evidence; never present it as researched.",
  "- Cite only evidence ids that appear in the context. Never invent ids.",
  "- Respect epistemic classes: observations are facts; interpretations/inferences/speculation are not, and must not be upgraded. Repeated secondary reporting is one source, not corroboration.",
  "- LIMITATIONS and provider failures are data-availability conditions, never negative evidence, and never belong in the answer. Mention only uncertainties that change how the trader should read the conclusion.",
  "- If the context cannot support a material part of the question, say so ONCE, plainly, inside `uncertainty`; do not let it become the whole answer.",
  "- `implication` is decision support, not a process note: state what the conclusion means for the trader's read of the position, catalyst, risk or thesis (which factors are decisive, what to watch). Never mention evidence counts, research ids, storage, providers or disclosure levels.",
  "- UNCERTAINTY RULE: every uncertainty entry names WHAT is unresolved and HOW it affects the conclusion's reliability (which reading of the evidence it would change). 'Further monitoring is required' and 'the regime requires close monitoring' are NOT uncertainties; delete such filler. If nothing material is unresolved, return an empty array.",
  "- Distinguish what is established from what is inferred. Never fabricate certainty, and never force a conclusion the evidence does not support.",
  "- Match the question's analytical shape: for 'what could affect X', give drivers/catalysts/risks with mechanisms and inversion conditions; for 'why did X move', give the timeline, the candidates, and the best-supported explanation; for 'does my thesis hold', judge the claims against the evidence.",
  "- QUESTION-FIRST LAW: the FIRST sentence of directAnswer must BE the answer to the question, never a scene-setting opener. Never begin with 'Current market conditions show', 'Comprehensive evidence has been gathered', 'Evidence indicates', 'Market data shows', or a restatement of the question. Begin with the conclusion in the question's own terms: 'What favors risk assets right now is', 'The main factors that could affect AAPL are', 'The evidence supports the thesis because'.",
  "- CONVERT OBSERVATIONS TO IMPLICATIONS: for every important observation state what it MEANS for the question (support, oppose, or condition the conclusion, through which mechanism). 'VIX is 14.81' is a fact; 'compressed volatility signals reduced near-term hedging demand, which supports risk appetite' is analysis. Numbers appear as supporting evidence after the answer, not as the answer.",
  "- COUNTEREVIDENCE IS REQUIRED for every material factor: cite the context evidence that weakens or complicates it. When the context holds no counterevidence for a factor, return an empty array for it (the run searched and found none is a fact; a manufactured opposition is not). Do not restate the factor's own supporting evidence as opposition.",
  "Output style: plain professional prose, decision-useful for a trader. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

export interface AnswerFactor {
  readonly factor: string;
  readonly mechanism: string;
  readonly direction: string;
  readonly evidenceRefs: readonly string[];
  /** Context evidence that weakens/complicates this factor; empty when none exists in context. */
  readonly counterevidenceRefs: readonly string[];
}

export interface AnswerSynthesis {
  readonly directAnswer: string;
  readonly keyFactors: readonly AnswerFactor[];
  readonly whatWouldChangeTheView: readonly string[];
  /** What the conclusion means for the decision. Never a process/storage note. */
  readonly implication?: string;
  readonly uncertainty: readonly string[];
  readonly confidence?: string;
  readonly citedObjectRefs: readonly string[];
  /**
   * Claims the evidence ledger did not support (research-contract validation). A draft that
   * made them was retried once; anything that survived the retry was STRIPPED from the answer
   * and recorded here, so no unsupported claim ever stands in the trader-facing text.
   */
  readonly contractViolations?: readonly { readonly type: string; readonly detail: string }[];
}

export interface SynthesizeAnswerOptions {
  readonly provider: ModelProvider;
  /** The trader's verbatim question: the answer must address THIS. */
  readonly question: string;
  readonly context: ResearchContext;
  /** The engine's epistemic state: what the run covered and actually retrieved. */
  readonly contract?: ContractState;
}

/**
 * Produce the answer to the trader's question from the validated context. Returns undefined
 * when the model cannot produce a schema-valid synthesis (the caller keeps its deterministic
 * evidence-grounded fallback; nothing is fabricated).
 */
export async function synthesizeAnswer(options: SynthesizeAnswerOptions): Promise<AnswerSynthesis | undefined> {
  const { provider, question, context, contract } = options;
  let raw: string;
  try {
    const res = await provider.structured<string>({
      schemaName: "research.answer_synthesis",
      schemaDescription: ANSWER_SYNTHESIS_SCHEMA_DESC,
      system: SYNTHESIS_SYSTEM,
      prompt: [
        `Trader question (answer THIS): "${question}"`,
        "Validated research context follows. Evidence ids in brackets are the ONLY citable refs.",
        "---",
        renderResearchContext(context),
        "---",
        'Respond as JSON conforming to schema "research.answer_synthesis".',
        ANSWER_SYNTHESIS_SCHEMA_DESC,
      ].join("\n"),
      preferJson: true,
    });
    raw = res.raw;
  } catch {
    return undefined;
  }
  let data: AnswerSynthesis;
  try {
    data = validateModelOutput<AnswerSynthesis>(ANSWER_SYNTHESIS_SCHEMA, raw).data;
  } catch {
    return undefined; // invalid synthesis = no synthesis; the caller keeps its fallback
  }
  let direct = typeof data.directAnswer === "string" ? data.directAnswer.trim() : "";
  if (direct === "") return undefined;
  // Question-first enforcement (deterministic, not prompt-hopeful): a draft that opens with
  // a banned scene-setting shape gets ONE bounded corrective retry with the violation named;
  // if the retry still violates (or fails), the draft is rejected and the caller keeps its
  // deterministic evidence-grounded fallback. The law is enforced by the engine, not wished
  // into the model.
  if (!opensWithTheAnswer(direct)) {
    try {
      const retry = await provider.structured<string>({
        schemaName: "research.answer_synthesis",
        schemaDescription: ANSWER_SYNTHESIS_SCHEMA_DESC,
        system: SYNTHESIS_SYSTEM,
        prompt: [
          `Trader question (answer THIS): "${question}"`,
          "Your previous draft violated the QUESTION-FIRST LAW: it opened with scene-setting instead of the answer.",
          `Rejected draft: "${direct.slice(0, 600)}"`,
          "Rewrite it: the FIRST sentence must be the direct answer to the question in the question's own terms (for example 'What favors risk assets right now is ...', 'The main factors that could affect X are ...'), then the reasoning. Same JSON schema.",
          "Validated research context follows. Evidence ids in brackets are the ONLY citable refs.",
          "---",
          renderResearchContext(context),
          "---",
          'Respond as JSON conforming to schema "research.answer_synthesis".',
          ANSWER_SYNTHESIS_SCHEMA_DESC,
        ].join("\n"),
        preferJson: true,
      });
      const retried = validateModelOutput<AnswerSynthesis>(ANSWER_SYNTHESIS_SCHEMA, retry.raw).data;
      const retryDirect = typeof retried.directAnswer === "string" ? retried.directAnswer.trim() : "";
      if (retryDirect === "" || !opensWithTheAnswer(retryDirect)) return undefined;
      data = retried;
      direct = retryDirect; // the retry's answer replaces the rejected draft everywhere below
    } catch {
      return undefined;
    }
  }
  // Citation integrity: keep only refs that exist in the context (an off-context id is a
  // citation error, not a finding).
  const known = new Set<string>([
    ...context.items.map((i) => i.ref),
    ...context.claims.map((c) => c.ref),
    ...context.hypotheses.map((h) => h.ref),
  ]);
  const keep = (refs: readonly unknown[] | undefined): string[] =>
    (refs ?? []).map((r) => String(r)).filter((r) => known.has(r));
  // Entry-level validation of the compound structure: malformed factors are DROPPED, never
  // coerced into a fabricated one (record[] is only shape-checked by validateModelOutput).
  const factors: AnswerFactor[] = [];
  for (const entry of (data.keyFactors ?? []) as readonly unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const factor = typeof rec.factor === "string" ? rec.factor.trim() : "";
    if (factor === "") continue;
    factors.push({
      factor,
      mechanism: typeof rec.mechanism === "string" ? rec.mechanism : "",
      direction: typeof rec.direction === "string" ? rec.direction : "",
      evidenceRefs: keep(Array.isArray(rec.evidenceRefs) ? rec.evidenceRefs : []),
      // Counterevidence refs must ALSO exist in the context and must not simply repeat the
      // factor's own supporting refs (restating support as opposition is fabrication).
      counterevidenceRefs: keep(Array.isArray(rec.counterevidenceRefs) ? rec.counterevidenceRefs : [])
        .filter((r) => !Array.isArray(rec.evidenceRefs) || !(rec.evidenceRefs as unknown[]).map(String).includes(r)),
    });
  }
  // RESEARCH-CONTRACT VALIDATION (decision-quality contract): the model may synthesize, but it
  // may not claim coverage the ledger does not support. Violations get ONE bounded corrective
  // retry with the exact claim named; whatever survives is STRIPPED from the answer and the
  // engine's own gap statement is added, so an unsupported claim never reaches the trader.
  let violations: readonly ContractViolation[] = contract !== undefined ? contractViolations(direct, contract) : [];
  if (violations.length > 0) {
    const named = violations.map((v) => `- ${v.detail}`).join("\n");
    try {
      const retry = await provider.structured<string>({
        schemaName: "research.answer_synthesis",
        schemaDescription: ANSWER_SYNTHESIS_SCHEMA_DESC,
        system: SYNTHESIS_SYSTEM,
        prompt: [
          `Trader question (answer THIS): "${question}"`,
          "Your previous draft made claims the evidence ledger does not support:",
          named,
          `Rejected draft: "${direct.slice(0, 600)}"`,
          "Rewrite it so every claim is supported: remove the unsupported claim, or state plainly that the requirement was not established. Do not replace it with a different unsupported claim.",
          "Validated research context follows. Evidence ids in brackets are the ONLY citable refs.",
          "---",
          renderResearchContext(context),
          "---",
          'Respond as JSON conforming to schema "research.answer_synthesis".',
          ANSWER_SYNTHESIS_SCHEMA_DESC,
        ].join("\n"),
        preferJson: true,
      });
      const retried = validateModelOutput<AnswerSynthesis>(ANSWER_SYNTHESIS_SCHEMA, retry.raw).data;
      const retryDirect = typeof retried.directAnswer === "string" ? retried.directAnswer.trim() : "";
      const retryViolations = retryDirect === "" ? violations : contractViolations(retryDirect, contract!);
      if (retryDirect !== "" && retryViolations.length === 0) {
        data = retried;
        direct = retryDirect;
        violations = [];
      } else if (retryDirect !== "" && retryViolations.length < violations.length) {
        data = retried;
        direct = retryDirect;
        violations = retryViolations;
      }
    } catch {
      // Keep the original draft; the strip below still removes the unsupported claims.
    }
  }
  if (violations.length > 0) {
    const stripped = stripUnsupportedClaims(direct, violations).trim();
    // If nothing evidence-supported remains, the synthesis is rejected outright and the
    // caller keeps its deterministic evidence-grounded answer (never a fabricated one).
    if (stripped === "") return undefined;
    direct = stripped;
  }
  const contractGap = violations.length > 0 ? contractGapStatement(violations) : undefined;
  const implication = typeof data.implication === "string" ? data.implication.trim() : "";
  return {
    directAnswer: direct,
    keyFactors: factors,
    whatWouldChangeTheView: (data.whatWouldChangeTheView ?? []).map(String),
    // A storage/process note is not an implication; drop it so the caller can use its
    // deterministic decision-relevant fallback instead of leaking run internals.
    ...(implication !== "" && !PROCESS_NOTE.test(implication) ? { implication } : {}),
    uncertainty: [...(data.uncertainty ?? []).map(String), ...(contractGap !== undefined ? [contractGap] : [])],
    ...(typeof data.confidence === "string" ? { confidence: data.confidence } : {}),
    citedObjectRefs: keep(data.citedObjectRefs),
    ...(violations.length > 0
      ? { contractViolations: violations.map((v) => ({ type: v.type, detail: v.detail })) }
      : {}),
  };
}

/**
 * Render the synthesis as the trader-facing answer prose (answer first, then the factors).
 *
 * COUNTEREVIDENCE HONESTY: a factor with no counterevidence refs may only be described as
 * "no material counterevidence found" when disconfirmation was ACTUALLY attempted — otherwise
 * the rendered sentence would make exactly the claim the contract validator exists to reject
 * (an unsearched conclusion presented as a tested one).
 */
export function renderAnswerSynthesis(s: AnswerSynthesis, opts: { readonly disconfirmationAttempted?: boolean } = {}): string {
  const parts: string[] = [s.directAnswer];
  if (s.keyFactors.length > 0) {
    const factors = s.keyFactors.map((f) => {
      const refs = f.evidenceRefs.length > 0 ? ` [${f.evidenceRefs.join(", ")}]` : "";
      const counter = f.counterevidenceRefs.length > 0
        ? ` Counterevidence: [${f.counterevidenceRefs.join(", ")}]`
        : opts.disconfirmationAttempted === true
          ? " No material counterevidence was found in the retrieved evidence."
          : " Counterevidence for this factor was not searched for in this run.";
      const dir = f.direction !== "" ? ` (${f.direction})` : "";
      return `${f.factor}${dir}: ${f.mechanism}${refs}.${counter}`;
    });
    parts.push("Factors that matter: " + factors.join("; ") + ".");
  }
  if (s.whatWouldChangeTheView.length > 0) {
    parts.push("What would change this view: " + s.whatWouldChangeTheView.join("; ") + ".");
  }
  if (s.uncertainty.length > 0) {
    parts.push("Material uncertainty: " + s.uncertainty.join("; ") + ".");
  }
  return parts.join("\n\n");
}
