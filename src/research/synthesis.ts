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
 * the validated context, and must return the answer to the QUESTION - factors, mechanisms,
 * evidence refs, what would change the view - never a restatement of the evidence.
 *
 * CAUSAL CHAIN OUTPUT (research contract): for causal/macro questions, the engine requires
 * a structured representation that distinguishes:
 * 1. OBSERVATION: What actually happened?
 * 2. DRIVER: What directly explains the observed move?
 * 3. MECHANISM: Through what economic/market mechanism could that driver produce the move?
 * 4. TRANSMISSION: Where did that effect propagate?
 * 5. CROSS-ASSET RESPONSE: What happened in related markets?
 * 6. TRADER IMPLICATION: What does the combined evidence imply for the research question?
 * 7. COUNTER-EVIDENCE / INVALIDATION: What evidence would weaken or overturn the interpretation?
 * 8. UNCERTAINTY: Which links are directly evidenced and which are analytical inference?
 *
 * The model must NEVER silently turn correlation into causation. Every causal relationship
 * should carry an evidence status such as DIRECT_EVIDENCE, SUPPORTED_INFERENCE,
 * CORRELATIONAL, or UNRESOLVED.
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
import type { EvidenceQuality } from "./requirements.js";

/**
 * CAUSAL CHAIN LINK (research contract): one link in the causal chain. Each link carries
 * evidence quality to prevent correlation-causation confusion.
 */
export interface CausalChainLink {
  /** What this link represents in the causal chain. */
  readonly type: "observation" | "driver" | "mechanism" | "transmission" | "cross_asset" | "implication";
  /** Description of this link. */
  readonly description: string;
  /** Evidence supporting this link. */
  readonly evidenceRefs: readonly string[];
  /** Evidence quality for this link. */
  readonly evidenceQuality: EvidenceQuality;
  /** Whether the evidence is direct or inferred. */
  readonly evidenceDirectness: "DIRECT" | "INFERRED";
  /** Confidence in this link based on evidence. */
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  /** Limitations or uncertainties for this link. */
  readonly limitations?: readonly string[];
}

/**
 * TRANSMISSION MECHANISM (research contract): how one market/asset affects another.
 * Each mechanism carries evidence to support or contradict the transmission.
 */
export interface TransmissionMechanism {
  /** The source market/asset. */
  readonly source: string;
  /** The target market/asset. */
  readonly target: string;
  /** The mechanism through which source affects target. */
  readonly mechanism: string;
  /** Evidence supporting this transmission. */
  readonly supportingEvidence: readonly string[];
  /** Evidence contradicting this transmission. */
  readonly contradictingEvidence: readonly string[];
  /** Evidence quality for this transmission. */
  readonly evidenceQuality: EvidenceQuality;
  /** Whether the transmission is currently active based on evidence. */
  readonly active: boolean;
}

/**
 * FORWARD WATCH CONDITION (research contract): observable conditions to monitor that would
 * strengthen or weaken the thesis. These are derived from evidence, not invented.
 */
export interface ForwardWatchCondition {
  /** What to watch. */
  readonly condition: string;
  /** How it would affect the thesis if it occurs. */
  readonly effect: "strengthens" | "weakens" | "invalidates";
  /** Evidence this condition is derived from. */
  readonly evidenceRefs: readonly string[];
  /** Current status of this condition. */
  readonly currentStatus: "met" | "not_met" | "partially_met" | "unknown";
}

/**
 * COUNTER-EVIDENCE (research contract): evidence that would weaken or overturn the
 * leading conclusion. Every major thesis should include at least one attempt to falsify.
 */
export interface CounterEvidence {
  /** What the counter-evidence would show. */
  readonly description: string;
  /** Evidence supporting this counter-claim. */
  readonly evidenceRefs: readonly string[];
  /** How it would affect the thesis. */
  readonly impact: "weakens" | "invalidates" | "complicates";
  /** Current status. */
  readonly status: "present" | "absent" | "searched_not_found";
}

/**
 * CAUSAL CHAIN OUTPUT (research contract): structured representation for causal/macro
 * questions. Prevents correlation-causation confusion and ensures complete evidence chain.
 */
export interface CausalChainOutput {
  /** The observed move or event. */
  readonly observation: CausalChainLink;
  /** Direct drivers behind the observation. */
  readonly drivers: readonly CausalChainLink[];
  /** Economic/market mechanisms. */
  readonly mechanisms: readonly CausalChainLink[];
  /** Transmission into related markets. */
  readonly transmission: readonly TransmissionMechanism[];
  /** Cross-asset response confirming or contradicting the chain. */
  readonly crossAssetResponse: readonly CausalChainLink[];
  /** Implications for the trader. */
  readonly implications: readonly CausalChainLink[];
  /** Counter-evidence that would weaken the thesis. */
  readonly counterEvidence: readonly CounterEvidence[];
  /** Forward-looking conditions to watch. */
  readonly forwardWatchConditions: readonly ForwardWatchCondition[];
  /** Overall confidence in the causal chain. */
  readonly overallConfidence: "HIGH" | "MODERATE" | "LOW";
  /** Material uncertainties in the chain. */
  readonly uncertainties: readonly string[];
}

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
  '   "evidenceRefs": string[], // evidence ids from the context that support THIS factor',
  '   "counterevidenceRefs": string[], // evidence ids from the context that WEAKEN or complicate this factor; [] when the context holds none (say so, never invent)',
  '   "evidenceQuality": "DIRECT_EVIDENCE"|"SUPPORTED_INFERENCE"|"CORRELATIONAL"|"UNRESOLVED",',
  '   "evidenceDirectness": "DIRECT"|"INFERRED"',
  " }],",
  ' "whatWouldChangeTheView": string[], // observable conditions that would alter the conclusion',
  ' "implication": string,             // what the conclusion means for the trader\'s decision: one or two sentences, no process notes',
  ' "uncertainty": string[],            // material gaps only; never provider notes',
  ' "confidence": "HIGH"|"MODERATE"|"LOW",',
  ' "citedObjectRefs": string[],        // evidence ids from the context only',
  // CAUSAL CHAIN OUTPUT (research contract): for causal/macro questions, structured representation
  ' "causalChain": {                    // optional; required for CAUSAL/MACRO_REGIME questions',
  '   "observation": { "description": string, "evidenceRefs": string[], "evidenceQuality": string, "evidenceDirectness": string },',
  '   "drivers": [{ "description": string, "evidenceRefs": string[], "evidenceQuality": string, "evidenceDirectness": string }],',
  '   "mechanisms": [{ "description": string, "evidenceRefs": string[], "evidenceQuality": string, "evidenceDirectness": string }],',
  '   "transmission": [{ "source": string, "target": string, "mechanism": string, "supportingEvidence": string[], "contradictingEvidence": string[], "evidenceQuality": string, "active": boolean }],',
  '   "crossAssetResponse": [{ "description": string, "evidenceRefs": string[], "evidenceQuality": string, "evidenceDirectness": string }],',
  '   "implications": [{ "description": string, "evidenceRefs": string[], "evidenceQuality": string, "evidenceDirectness": string }],',
  '   "counterEvidence": [{ "description": string, "evidenceRefs": string[], "impact": string, "status": string }],',
  '   "forwardWatchConditions": [{ "condition": string, "effect": string, "evidenceRefs": string[], "currentStatus": string }],',
  '   "overallConfidence": "HIGH"|"MODERATE"|"LOW",',
  '   "uncertainties": string[]',
  " }",
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
    causalChain: "record",
  },
  optional: ["whatWouldChangeTheView", "implication", "uncertainty", "confidence", "causalChain"],
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
  "- CAUSAL CHAIN OUTPUT (research contract): for CAUSAL/MACRO_REGIME questions, you MUST include the `causalChain` object. This structures the evidence into:",
  "  1. OBSERVATION: What actually happened? (with evidence quality)",
  "  2. DRIVERS: What directly explains the observed move? (with evidence quality)",
  "  3. MECHANISMS: Through what economic/market mechanism could that driver produce the move? (with evidence quality)",
  "  4. TRANSMISSION: Where did that effect propagate? (with source/target/mechanism)",
  "  5. CROSS-ASSET RESPONSE: What happened in related markets? (with evidence quality)",
  "  6. IMPLICATIONS: What does the combined evidence imply? (with evidence quality)",
  "  7. COUNTER-EVIDENCE: What evidence would weaken or overturn the interpretation?",
  "  8. FORWARD WATCH CONDITIONS: What observable conditions would strengthen or weaken the thesis?",
  "- EVIDENCE QUALITY ASSESSMENT: for every causal relationship, assign one of:",
  "  - DIRECT_EVIDENCE: the evidence directly establishes the claim",
  "  - SUPPORTED_INFERENCE: the claim is a reasonable inference from direct evidence",
  "  - CORRELATIONAL: the evidence shows correlation but not causation",
  "  - UNRESOLVED: the evidence is insufficient to determine the relationship",
  "- NEVER SILENTLY TURN CORRELATION INTO CAUSATION: if oil and yields moved together but no mechanism is established, label it CORRELATIONAL, not DRIVER.",
  "Output style: plain professional prose, decision-useful for a trader. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

export interface AnswerFactor {
  readonly factor: string;
  readonly mechanism: string;
  readonly direction: string;
  readonly evidenceRefs: readonly string[];
  /** Context evidence that weakens/complicates this factor; empty when none exists in context. */
  readonly counterevidenceRefs: readonly string[];
  /** Evidence quality for this factor. */
  readonly evidenceQuality?: EvidenceQuality;
  /** Whether the evidence is direct or inferred. */
  readonly evidenceDirectness?: "DIRECT" | "INFERRED";
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
  /**
   * CAUSAL CHAIN OUTPUT (research contract): structured representation for causal/macro
   * questions. Prevents correlation-causation confusion and ensures complete evidence chain.
   */
  readonly causalChain?: CausalChainOutput;
}

export interface SynthesizeAnswerOptions {
  readonly provider: ModelProvider;
  /** The trader's verbatim question: the answer must address THIS. */
  readonly question: string;
  readonly context: ResearchContext;
  /** The engine's epistemic state: what the run covered and actually retrieved. */
  readonly contract?: ContractState;
  /**
   * The engine's COMPUTED confidence ceiling for this run (coverage/freshness/challenge/
   * recovery). The model is told what it is and the engine caps any stated level at it.
   */
  readonly computedConfidence?: string;
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
        ...(options.computedConfidence !== undefined
          ? [
              `ENGINE-COMPUTED CONFIDENCE for this run: ${options.computedConfidence}. It is derived from requirement coverage, evidence freshness, whether disconfirmation ran, and recovery outcomes. State at most this level; never a higher one.`,
            ]
          : []),
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
      ...(typeof rec.evidenceQuality === "string" ? { evidenceQuality: rec.evidenceQuality as EvidenceQuality } : {}),
      ...(typeof rec.evidenceDirectness === "string" ? { evidenceDirectness: rec.evidenceDirectness as "DIRECT" | "INFERRED" } : {}),
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
  
  // CAUSAL CHAIN VALIDATION: validate and clean the causal chain if present
  let causalChain: CausalChainOutput | undefined;
  if (data.causalChain !== undefined && data.causalChain !== null) {
    causalChain = validateCausalChain(data.causalChain, known);
  }
  
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
    ...(causalChain !== undefined ? { causalChain } : {}),
  };
}

/**
 * Render the synthesis as the trader-facing answer prose (answer first, then the factors).
 *
 * COUNTEREVIDENCE HONESTY: a factor with no counterevidence refs may only be described as
 * "no material counterevidence found" when disconfirmation was ACTUALLY attempted - otherwise
 * the rendered sentence would make exactly the claim the contract validator exists to reject
 * (an unsearched conclusion presented as a tested one).
 *
 * CAUSAL CHAIN RENDERING: for causal/macro questions, render the structured causal chain
 * as readable prose with evidence quality labels.
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
      const quality = f.evidenceQuality !== undefined ? ` [${f.evidenceQuality}]` : "";
      const directness = f.evidenceDirectness !== undefined ? ` [${f.evidenceDirectness}]` : "";
      return `${f.factor}${dir}: ${f.mechanism}${refs}${quality}${directness}.${counter}`;
    });
    parts.push("Factors that matter: " + factors.join("; ") + ".");
  }
  if (s.whatWouldChangeTheView.length > 0) {
    parts.push("What would change this view: " + s.whatWouldChangeTheView.join("; ") + ".");
  }
  if (s.uncertainty.length > 0) {
    parts.push("Material uncertainty: " + s.uncertainty.join("; ") + ".");
  }
  
  // CAUSAL CHAIN RENDERING: for causal/macro questions, render the structured chain
  if (s.causalChain !== undefined) {
    const chain = s.causalChain;
    const chainParts: string[] = [];
    
    // Observation
    chainParts.push(`OBSERVATION: ${chain.observation.description} [${chain.observation.evidenceQuality}]`);
    
    // Drivers
    if (chain.drivers.length > 0) {
      const driverTexts = chain.drivers.map((d) => 
        `${d.description} [${d.evidenceQuality}]`
      );
      chainParts.push("DRIVERS: " + driverTexts.join("; "));
    }
    
    // Mechanisms
    if (chain.mechanisms.length > 0) {
      const mechTexts = chain.mechanisms.map((m) => 
        `${m.description} [${m.evidenceQuality}]`
      );
      chainParts.push("MECHANISMS: " + mechTexts.join("; "));
    }
    
    // Transmission
    if (chain.transmission.length > 0) {
      const transTexts = chain.transmission.map((t) => 
        `${t.source} -> ${t.target}: ${t.mechanism} [${t.evidenceQuality}]${t.active ? " (active)" : ""}`
      );
      chainParts.push("TRANSMISSION: " + transTexts.join("; "));
    }
    
    // Cross-asset response
    if (chain.crossAssetResponse.length > 0) {
      const crossTexts = chain.crossAssetResponse.map((c) => 
        `${c.description} [${c.evidenceQuality}]`
      );
      chainParts.push("CROSS-ASSET RESPONSE: " + crossTexts.join("; "));
    }
    
    // Implications
    if (chain.implications.length > 0) {
      const impTexts = chain.implications.map((i) => 
        `${i.description} [${i.evidenceQuality}]`
      );
      chainParts.push("IMPLICATIONS: " + impTexts.join("; "));
    }
    
    // Counter-evidence
    if (chain.counterEvidence.length > 0) {
      const counterTexts = chain.counterEvidence.map((c) => 
        `${c.description} (${c.impact}; status: ${c.status})`
      );
      chainParts.push("COUNTER-EVIDENCE: " + counterTexts.join("; "));
    }
    
    // Forward watch conditions
    if (chain.forwardWatchConditions.length > 0) {
      const watchTexts = chain.forwardWatchConditions.map((w) => 
        `${w.condition} (${w.effect}; status: ${w.currentStatus})`
      );
      chainParts.push("WATCH: " + watchTexts.join("; "));
    }
    
    // Uncertainties
    if (chain.uncertainties.length > 0) {
      chainParts.push("CHAIN UNCERTAINTIES: " + chain.uncertainties.join("; "));
    }
    
    if (chainParts.length > 0) {
      parts.push("CAUSAL CHAIN:\n" + chainParts.join("\n"));
    }
  }
  
  return parts.join("\n\n");
}

/**
 * Validate and clean the causal chain output from the model. Ensures evidence refs exist
 * in the context and evidence quality is valid.
 */
function validateCausalChain(
  chain: unknown,
  knownRefs: Set<string>,
): CausalChainOutput | undefined {
  try {
    const keep = (refs: unknown[]): string[] =>
      Array.isArray(refs) ? refs.map(String).filter((r) => knownRefs.has(r)) : [];

    const validateLink = (link: Record<string, unknown>): CausalChainLink | undefined => {
      if (typeof link !== "object" || link === null) return undefined;
      const description = typeof link.description === "string" ? link.description.trim() : "";
      if (description === "") return undefined;
      
      const evidenceQuality = typeof link.evidenceQuality === "string" 
        ? link.evidenceQuality as EvidenceQuality
        : "UNRESOLVED";
      const evidenceDirectness = typeof link.evidenceDirectness === "string"
        ? link.evidenceDirectness as "DIRECT" | "INFERRED"
        : "INFERRED";
      
      return {
        type: typeof link.type === "string" ? link.type as CausalChainLink["type"] : "observation",
        description,
        evidenceRefs: Array.isArray(link.evidenceRefs) ? keep(link.evidenceRefs) : [],
        evidenceQuality,
        evidenceDirectness,
        confidence: typeof link.confidence === "string" ? link.confidence as "HIGH" | "MODERATE" | "LOW" : "MODERATE",
        ...(Array.isArray(link.limitations) && link.limitations.length > 0 
          ? { limitations: link.limitations.map(String) }
          : {}),
      };
    };

    const validateTransmission = (trans: Record<string, unknown>): TransmissionMechanism | undefined => {
      if (typeof trans !== "object" || trans === null) return undefined;
      const source = typeof trans.source === "string" ? trans.source : "";
      const target = typeof trans.target === "string" ? trans.target : "";
      const mechanism = typeof trans.mechanism === "string" ? trans.mechanism : "";
      if (source === "" || target === "" || mechanism === "") return undefined;
      
      return {
        source,
        target,
        mechanism,
        supportingEvidence: Array.isArray(trans.supportingEvidence) ? keep(trans.supportingEvidence) : [],
        contradictingEvidence: Array.isArray(trans.contradictingEvidence) ? keep(trans.contradictingEvidence) : [],
        evidenceQuality: typeof trans.evidenceQuality === "string"
          ? trans.evidenceQuality as EvidenceQuality
          : "UNRESOLVED",
        active: typeof trans.active === "boolean" ? trans.active : false,
      };
    };

    const validateCounterEvidence = (ce: Record<string, unknown>): CounterEvidence | undefined => {
      if (typeof ce !== "object" || ce === null) return undefined;
      const description = typeof ce.description === "string" ? ce.description.trim() : "";
      if (description === "") return undefined;
      
      return {
        description,
        evidenceRefs: Array.isArray(ce.evidenceRefs) ? keep(ce.evidenceRefs) : [],
        impact: typeof ce.impact === "string" ? ce.impact as "weakens" | "invalidates" | "complicates" : "weakens",
        status: typeof ce.status === "string" ? ce.status as "present" | "absent" | "searched_not_found" : "searched_not_found",
      };
    };

    const validateWatchCondition = (wc: Record<string, unknown>): ForwardWatchCondition | undefined => {
      if (typeof wc !== "object" || wc === null) return undefined;
      const condition = typeof wc.condition === "string" ? wc.condition.trim() : "";
      if (condition === "") return undefined;
      
      return {
        condition,
        effect: typeof wc.effect === "string" ? wc.effect as "strengthens" | "weakens" | "invalidates" : "weakens",
        evidenceRefs: Array.isArray(wc.evidenceRefs) ? keep(wc.evidenceRefs) : [],
        currentStatus: typeof wc.currentStatus === "string" ? wc.currentStatus as "met" | "not_met" | "partially_met" | "unknown" : "unknown",
      };
    };

    const chainObj = chain as Record<string, unknown>;
    const observation = validateLink(chainObj.observation as Record<string, unknown>);
    if (observation === undefined) return undefined;

    const drivers = Array.isArray(chainObj.drivers)
      ? (chainObj.drivers as Record<string, unknown>[]).map(validateLink).filter((l): l is CausalChainLink => l !== undefined)
      : [];
    const mechanisms = Array.isArray(chainObj.mechanisms)
      ? (chainObj.mechanisms as Record<string, unknown>[]).map(validateLink).filter((l): l is CausalChainLink => l !== undefined)
      : [];
    const transmission = Array.isArray(chainObj.transmission)
      ? (chainObj.transmission as Record<string, unknown>[]).map(validateTransmission).filter((t): t is TransmissionMechanism => t !== undefined)
      : [];
    const crossAssetResponse = Array.isArray(chainObj.crossAssetResponse)
      ? (chainObj.crossAssetResponse as Record<string, unknown>[]).map(validateLink).filter((l): l is CausalChainLink => l !== undefined)
      : [];
    const implications = Array.isArray(chainObj.implications)
      ? (chainObj.implications as Record<string, unknown>[]).map(validateLink).filter((l): l is CausalChainLink => l !== undefined)
      : [];
    const counterEvidence = Array.isArray(chainObj.counterEvidence)
      ? (chainObj.counterEvidence as Record<string, unknown>[]).map(validateCounterEvidence).filter((c): c is CounterEvidence => c !== undefined)
      : [];
    const forwardWatchConditions = Array.isArray(chainObj.forwardWatchConditions)
      ? (chainObj.forwardWatchConditions as Record<string, unknown>[]).map(validateWatchCondition).filter((w): w is ForwardWatchCondition => w !== undefined)
      : [];

    return {
      observation,
      drivers,
      mechanisms,
      transmission,
      crossAssetResponse,
      implications,
      counterEvidence,
      forwardWatchConditions,
      overallConfidence: typeof chainObj.overallConfidence === "string" ? chainObj.overallConfidence as "HIGH" | "MODERATE" | "LOW" : "MODERATE",
      uncertainties: Array.isArray(chainObj.uncertainties) ? chainObj.uncertainties.map(String) : [],
    };
  } catch {
    return undefined;
  }
}
