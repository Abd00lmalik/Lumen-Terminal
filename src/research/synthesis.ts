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

/** Storage/process language: an implication phrased as run accounting is not decision support. */
const PROCESS_NOTE = /preserved|evidence object|research id|rs_\d|deeper level|disclosure|provider|storage/i;

export const ANSWER_SYNTHESIS_SCHEMA_DESC = [
  "{",
  ' "directAnswer": string, // 2 to 5 sentences that DIRECTLY answer the question',
  ' "keyFactors": [{',
  '   "factor": string,        // what it is, in the question\'s own terms',
  '   "mechanism": string,     // how it would act on the subject (transmission path)',
  '   "direction": string,     // which way it leans given the evidence, or "mixed"/"unclear"',
  '   "evidenceRefs": string[] // evidence ids from the context that support THIS factor',
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
  "- Distinguish what is established from what is inferred. Never fabricate certainty, and never force a conclusion the evidence does not support.",
  "- Match the question's analytical shape: for 'what could affect X', give drivers/catalysts/risks with mechanisms and inversion conditions; for 'why did X move', give the timeline, the candidates, and the best-supported explanation; for 'does my thesis hold', judge the claims against the evidence.",
  "Output style: plain professional prose, decision-useful for a trader. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

export interface AnswerFactor {
  readonly factor: string;
  readonly mechanism: string;
  readonly direction: string;
  readonly evidenceRefs: readonly string[];
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
}

export interface SynthesizeAnswerOptions {
  readonly provider: ModelProvider;
  /** The trader's verbatim question: the answer must address THIS. */
  readonly question: string;
  readonly context: ResearchContext;
}

/**
 * Produce the answer to the trader's question from the validated context. Returns undefined
 * when the model cannot produce a schema-valid synthesis (the caller keeps its deterministic
 * evidence-grounded fallback; nothing is fabricated).
 */
export async function synthesizeAnswer(options: SynthesizeAnswerOptions): Promise<AnswerSynthesis | undefined> {
  const { provider, question, context } = options;
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
  const direct = typeof data.directAnswer === "string" ? data.directAnswer.trim() : "";
  if (direct === "") return undefined;
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
    });
  }
  const implication = typeof data.implication === "string" ? data.implication.trim() : "";
  return {
    directAnswer: direct,
    keyFactors: factors,
    whatWouldChangeTheView: (data.whatWouldChangeTheView ?? []).map(String),
    // A storage/process note is not an implication; drop it so the caller can use its
    // deterministic decision-relevant fallback instead of leaking run internals.
    ...(implication !== "" && !PROCESS_NOTE.test(implication) ? { implication } : {}),
    uncertainty: (data.uncertainty ?? []).map(String),
    ...(typeof data.confidence === "string" ? { confidence: data.confidence } : {}),
    citedObjectRefs: keep(data.citedObjectRefs),
  };
}

/** Render the synthesis as the trader-facing answer prose (answer first, then the factors). */
export function renderAnswerSynthesis(s: AnswerSynthesis): string {
  const parts: string[] = [s.directAnswer];
  if (s.keyFactors.length > 0) {
    const factors = s.keyFactors.map((f) => {
      const refs = f.evidenceRefs.length > 0 ? ` [${f.evidenceRefs.join(", ")}]` : "";
      const dir = f.direction !== "" ? ` (${f.direction})` : "";
      return `${f.factor}${dir}: ${f.mechanism}${refs}`;
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
