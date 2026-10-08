/**
 * FOLLOW-UP POLICY — the execution contract for a turn that continues an investigation.
 *
 * Core principle (follow-up contract): a follow-up is a CONTINUATION of an investigation,
 * never permission to silently restart it. When the trader's own words scope the follow-up
 * to the evidence already collected ("based only on the evidence you just collected",
 * "using only the evidence above", "from the research you just did", "based on your previous
 * findings", or equivalent semantics), the orchestration layer MUST run it under
 * FOLLOW_UP_EVIDENCE_ONLY:
 *
 *   FOLLOW_UP + EVIDENCE_ONLY = NO_NEW_RETRIEVAL
 *
 * Concretely, an evidence-only follow-up gets NO root research planner, NO fresh requirement
 * expansion unrelated to the parent, NO capability execution (zero web/search/RSS retrieval),
 * and NO independent research-flow classification — it synthesizes from the inherited evidence
 * scope built here, and every fact it asserts must trace to a parent evidence id.
 *
 * Deterministic by design: the decision is made from the trader's verbatim message before any
 * model call, so a model classification can never widen the follow-up's evidence policy, and
 * the same guarantee is testable without a network.
 */
import type { Workspace } from "../domain/workspace.js";
import type { Evidence } from "../domain/objects.js";
import type { ResearchExecutionMode, ResearchRun } from "../domain/run-context.js";

/**
 * Evidence-only phrasings, sentence-anchored to THIS request's own scope words. The trader
 * scoping language ("only", "just", "previous") is the operative part; a message that merely
 * mentions evidence in passing ("compare the evidence with 2022") never matches.
 */
const EVIDENCE_ONLY_PATTERNS: readonly RegExp[] = [
  /\bbased (?:only|solely|purely) on\b[^.?!]{0,60}\bevidence\b/i,
  /\busing (?:only|solely)\b[^.?!]{0,30}\bevidence\b/i,
  /\bonly (?:the\s+)?evidence\b[^.?!]{0,40}\b(?:above|collected|gathered|just)\b/i,
  /\bevidence (?:you|we|i)\s+(?:just\s+)?(?:collected|gathered|found)\b/i,
  /\bfrom the research you (?:just\s+)?did\b/i,
  /\bbased on your (?:previous|prior|earlier|last) (?:findings?|research|evidence|results?|analysis)\b/i,
  /\bfrom (?:your|the) (?:previous|prior|earlier|above) findings?\b/i,
  /\busing the evidence (?:above|from (?:the|your) (?:previous|last|earlier))\b/i,
  /\bno new (?:research|search(?:es)?|retrieval|lookups?|data)\b/i,
  /\bwithout (?:any\s+)?(?:new|fresh|further) (?:research|search(?:es)?|retrieval|web\s+lookups?)\b/i,
  /\b(?:summar|recap)\w*[^.?!]{0,60}\b(?:just\s+)?collected\b/i,
];

/** True when the trader's own words scope THIS request to already-collected evidence. */
export function isEvidenceOnlyRequest(message: string): boolean {
  return EVIDENCE_ONLY_PATTERNS.some((re) => re.test(message));
}

/**
 * The execution mode a submission runs under. Deterministic, decided BEFORE any model call:
 * a non-continuing turn is always ROOT_RESEARCH; a continuing turn is EVIDENCE_ONLY exactly
 * when the trader's phrasing scopes it to the collected evidence, otherwise it may retrieve.
 */
export function researchExecutionModeOf(message: string, continuing: boolean): ResearchExecutionMode {
  if (!continuing) return "ROOT_RESEARCH";
  return isEvidenceOnlyRequest(message) ? "FOLLOW_UP_EVIDENCE_ONLY" : "FOLLOW_UP_WITH_NEW_RESEARCH";
}

/** One parent fact the follow-up may stand on: the evidence object itself (no clone). */
export interface InheritedEvidenceItem {
  readonly ref: string;
  readonly text: string;
  readonly kind: "observation" | "quantitative_observation" | "documented_statement" | "inference" | "speculation" | "claim";
  readonly evidenceClass: Evidence["evidenceClass"];
  readonly subject?: string;
  readonly observedAt?: string;
  readonly sourceRefs: readonly string[];
  readonly parentResearchId: string;
}

/** The complete inherited context an evidence-only follow-up synthesizes from. */
export interface InheritedEvidenceScope {
  readonly parentResearchId: string;
  readonly parentQuestion: string;
  /** The parent's evidence objects, referenced (never copied). */
  readonly items: readonly InheritedEvidenceItem[];
  /** The parent's retained answer/judgment text, when one exists (findings context). */
  readonly parentFindings: string;
  /** The parent's requirement state, verbatim from its retained record (what was/wasn't established). */
  readonly parentRequirementState: readonly { readonly description: string; readonly status: string }[];
  /** Every parent evidence id — the ONLY ids the follow-up may cite. */
  readonly allowedEvidenceIds: readonly string[];
}

const KIND_BY_CLASS: Readonly<Record<string, InheritedEvidenceItem["kind"]>> = {
  OBSERVATION: "observation",
  DERIVED_OBSERVATION: "inference",
  SPECULATION: "speculation",
};

/**
 * Build the inherited evidence scope for an evidence-only follow-up from the WORKSPACE GRAPH:
 * the parent run's evidence objects (referenced by id, never copied), the parent's retained
 * findings and requirement state. Only the named parent run contributes — evidence that merely
 * shares an investigation id does NOT become scope (cross-domain contamination law): this
 * follow-up's allowed scope is exactly its parent's evidence set.
 */
export function inheritedEvidenceScopeOf(workspace: Workspace, run: ResearchRun): InheritedEvidenceScope | undefined {
  const parentId = run.parentResearchId;
  if (parentId === undefined) return undefined;
  const parent = workspace.getResearch(parentId);
  if (parent === undefined) return undefined;

  const items: InheritedEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const id of parent.evidenceRefs) {
    if (seen.has(id)) continue;
    const e = workspace.getEvidence(id);
    if (e === undefined) continue;
    seen.add(id);
    items.push({
      ref: e.id,
      text: e.observation,
      kind: KIND_BY_CLASS[e.evidenceClass] ?? "observation",
      evidenceClass: e.evidenceClass,
      ...(e.subject !== undefined && e.subject !== "" ? { subject: e.subject } : {}),
      ...(e.timestamp !== undefined ? { observedAt: e.timestamp } : { observedAt: e.observedAt }),
      sourceRefs: e.sourceRefs ?? [],
      parentResearchId: parentId,
    });
  }

  // Parent findings: the retained presentation record's answer when it exists (the same
  // record History reopens), else the parent's current judgment text.
  const record = workspace.getResearchResponse(parentId) as { answer?: { answer?: string; confidence?: string } } | undefined;
  const parentFindings = record?.answer?.answer ?? "";
  const judgment = parent.currentJudgmentRef !== undefined ? workspace.getJudgment(parent.currentJudgmentRef) : undefined;

  const saved = record as unknown as { researchDiagnostics?: { requirements?: readonly { description?: string; status?: string }[] } } | undefined;
  const parentRequirementState = (saved?.researchDiagnostics?.requirements ?? [])
    .map((r) => ({ description: r.description ?? "", status: r.status ?? "" }))
    .filter((r) => r.description !== "");

  return {
    parentResearchId: parentId,
    parentQuestion: parent.question,
    items,
    parentFindings: parentFindings !== "" ? parentFindings : (judgment?.statement ?? ""),
    parentRequirementState,
    allowedEvidenceIds: [...seen],
  };
}

// ---------------------------------------------------------------------------
// Evidence-only synthesis (zero retrieval)
// ---------------------------------------------------------------------------

/** The one model call an evidence-only follow-up is allowed: summarize inherited evidence. */
const FOLLOW_UP_SUMMARY_SCHEMA_DESC = [
  'Respond as JSON: {"finding": string, "evidenceRefs": string[], "confidence": "LOW"|"MODERATE"}.',
  "finding: EXACTLY ONE concise sentence stating the strongest finding the collected evidence supports.",
  "evidenceRefs: the evidence ids (verbatim, e.g. ev_000123) your finding rests on — at least one, and ONLY ids from the provided evidence.",
  'confidence: "MODERATE" only when a direct observation supports the finding; otherwise "LOW".',
  "You have NO retrieval, NO tools, NO knowledge beyond the provided evidence. Never invent facts, numbers or sources that are not in the provided evidence.",
  "If the provided evidence cannot support any finding, set finding to one sentence that says so explicitly and return evidenceRefs pointing at the evidence that proved insufficient.",
].join("\n");

export interface EvidenceOnlySynthesis {
  readonly ok: boolean;
  /** The one-sentence finding (or the explicit unresolved statement). */
  readonly finding: string;
  /** Parent evidence ids the finding cites (⊆ allowedEvidenceIds). Empty when unresolved. */
  readonly evidenceRefs: readonly string[];
  /** Deterministic, never UNKNOWN: MODERATE only on direct parent evidence. */
  readonly confidence: "LOW" | "MODERATE";
  /** Why the follow-up could not answer (set when ok=false). */
  readonly reason?: string;
}

const GENERIC_TEMPLATE = /^Across \d+ research run/;

function sentencesOf(text: string): number {
  return text.replace(/\[(?:ev|rs|jd)_[^\]]+\]/g, "").split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0).length;
}

/**
One model call, strictly bounded: summarize the inherited evidence. The result is validated
deterministically — citations must be parent evidence ids, the finding must be one sentence,
and generic boilerplate that names no evidence is rejected (output-integrity law). No retry
loop, no capability execution, no second retrieval path exists on this code path.
 */
export async function synthesizeEvidenceOnlyFollowUp(options: {
  provider: { structured(req: { schemaName: string; schemaDescription: string; system?: string; prompt: string; preferJson?: boolean }): Promise<{ raw: string }> };
  scope: InheritedEvidenceScope;
  question: string;
}): Promise<EvidenceOnlySynthesis> {
  const { provider, scope, question } = options;
  if (scope.items.length === 0) {
    return {
      ok: false,
      finding: "The parent research run retained no evidence, so no finding can be summarized from it. Re-run the research or ask a new question.",
      evidenceRefs: [],
      confidence: "LOW",
      reason: "no inherited evidence in the parent run",
    };
  }
  const evidenceBlock = scope.items
    .map((i) => `[${i.ref}] (${i.evidenceClass}${i.observedAt !== undefined ? `, observed ${i.observedAt}` : ""}${i.subject !== undefined ? `, subject: ${i.subject}` : ""}) ${i.text}`)
    .join("\n");
  const findingsBlock = scope.parentFindings !== "" ? `\nPARENT FINDINGS (context, not citable evidence): ${scope.parentFindings.slice(0, 1500)}` : "";
  const gapsBlock = scope.parentRequirementState.length > 0
    ? `\nPARENT REQUIREMENT STATE (what the parent established and what it could not): ${scope.parentRequirementState.map((r) => `${r.description} -> ${r.status}`).join("; ").slice(0, 800)}`
    : "";
  const prompt = [
    `Follow-up question: "${question}"`,
    `Parent research question: "${scope.parentQuestion}"`,
    `${findingsBlock}${gapsBlock}`,
    "EVIDENCE COLLECTED BY THE PARENT RUN (the ONLY evidence you may use and cite):",
    evidenceBlock,
    "Answer with the strongest finding this evidence supports, in ONE sentence, citing its evidence ids.",
    "If the evidence cannot support a strongest finding, say so explicitly in one sentence.",
    `Respond as JSON conforming to schema "research.follow_up_summary".`,
    FOLLOW_UP_SUMMARY_SCHEMA_DESC,
  ].join("\n");

  let raw: string;
  try {
    const res = await provider.structured({
      schemaName: "research.follow_up_summary",
      schemaDescription: FOLLOW_UP_SUMMARY_SCHEMA_DESC,
      prompt,
      preferJson: true,
    });
    raw = res.raw;
  } catch (error) {
    return {
      ok: false,
      finding: `The follow-up summary could not be produced (the interpretation model failed: ${error instanceof Error ? error.message : String(error)}). The parent's evidence is unchanged and no new research was run.`,
      evidenceRefs: [],
      confidence: "LOW",
      reason: "summary model call failed",
    };
  }

  // Deterministic validation — the output-integrity law for follow-ups.
  let parsed: { finding?: unknown; evidenceRefs?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { ok: false, finding: "The follow-up summary was not valid output, so no finding is asserted. No new research was run.", evidenceRefs: [], confidence: "LOW", reason: "summary output was not JSON" };
  }
  const finding = typeof parsed.finding === "string" ? parsed.finding.trim() : "";
  const refs = Array.isArray(parsed.evidenceRefs) ? parsed.evidenceRefs.filter((r): r is string => typeof r === "string") : [];
  const allowed = new Set(scope.allowedEvidenceIds);
  const inScope = refs.filter((r) => allowed.has(r));
  const violations: string[] = [];
  if (finding === "") violations.push("empty finding");
  if (sentencesOf(finding) > 2) violations.push("finding is not a single concise sentence");
  if (GENERIC_TEMPLATE.test(finding)) violations.push("generic template instead of a finding");
  if (inScope.length === 0) violations.push("finding cites no parent evidence id");
  if (refs.length !== inScope.length) violations.push("cited evidence outside the parent's evidence scope");
  const directEvidence = scope.items.some((i) => i.evidenceClass === "OBSERVATION");
  const stated = parsed.confidence === "MODERATE" ? "MODERATE" : "LOW";
  const confidence: "LOW" | "MODERATE" = directEvidence && stated === "MODERATE" && violations.length === 0 ? "MODERATE" : "LOW";
  if (violations.length > 0) {
    return {
      ok: false,
      finding: `The follow-up could not be answered from the parent's evidence alone (output rejected: ${violations.join("; ")}). The request stays unresolved rather than asserting an unsupported finding.`,
      evidenceRefs: [],
      confidence: "LOW",
      reason: violations.join("; "),
    };
  }
  return { ok: true, finding, evidenceRefs: inScope, confidence };
}
