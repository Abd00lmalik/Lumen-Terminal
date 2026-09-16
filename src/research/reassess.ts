/**
 * Reassessment pathway — M5 (thesis-monitor-reassessment.md; M5 §13–§15).
 *
 * The continuity loop: NEW EVIDENCE → VALIDATE → CHECK MATERIALITY → determine whether
 * reassessment is needed → REASSESS (via the EXISTING Flow 4 evaluation pathway) → RECORD the
 * assessment (history, never mutation) → REVALIDATE monitor conditions.
 *
 * Laws implemented here:
 * - Materiality gates reassessment: new data alone does NOT trigger it (M5 §13). Materiality
 *   considers relevance to thesis claims, contradiction/support, evidence quality, source
 *   reliability, freshness, directness, invalidation-condition impact, and uncertainty impact.
 * - The MODEL ASSESSES materiality and synthesizes the reassessment; the SYSTEM validates both.
 * - Reassessment NEVER rewrites the thesis (M5 §14): it records an assessment-history entry via
 *   Workspace.recordThesisAssessment and returns monitor-revalidation proposals for the trader.
 * - Memory interaction: a stale/historical memory relevant to the thesis is REVALIDATED (not
 *   overwritten) and current validated evidence outranks it (M5 §3/§18).
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { Thesis, ThesisAssessmentRecord } from "../domain/thesis.js";
import type { MemoryEntry, Monitor } from "../domain/memory.js";
import type { Evidence } from "../domain/objects.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Materiality decision — model proposes, system validates (M5 §13)
// ---------------------------------------------------------------------------

export interface MaterialityDecision {
  /** Whether the new evidence warrants full reassessment of the thesis. */
  readonly reassessmentNeeded: boolean;
  /** Why — grounded in the evidence, not model sentiment. */
  readonly rationale: string;
  /** Relevance to the thesis's claims/assumptions/invalidation conditions. */
  readonly affectsClaims: readonly string[];
  readonly affectsInvalidationConditions: readonly string[];
  /** Whether the evidence materially changes the uncertainty picture. */
  readonly changesUncertainty: boolean;
  /** Evidence-quality note: quality/directness/freshness of the new evidence. */
  readonly evidenceQualityNote: string;
}

export const MATERIALITY_SCHEMA: OutputSchema = {
  name: "reassess.materiality",
  properties: {
    reassessmentNeeded: "boolean",
    rationale: "string",
    affectsClaims: "string[]",
    affectsInvalidationConditions: "string[]",
    changesUncertainty: "boolean",
    evidenceQualityNote: "string",
  },
};

// ---------------------------------------------------------------------------
// Reassessment result — assessment history + monitor revalidation (M5 §14/§15)
// ---------------------------------------------------------------------------

export interface MonitorRevalidationProposal {
  readonly monitorId: string;
  /** STILL_RELEVANT → no action; REVIEW → flagged for the trader (never silently changed). */
  readonly outcome: "STILL_RELEVANT" | "REVIEW";
  readonly rationale: string;
}

export interface ReassessmentResult {
  /** Whether reassessment ran (false = below materiality threshold — an honest no-op). */
  readonly reassessed: boolean;
  readonly materiality: MaterialityDecision;
  /** The new assessment-history record (thesis object untouched) when reassessment ran. */
  readonly assessment?: ThesisAssessmentRecord;
  /** Monitor revalidation outcomes (proposals only — nothing silently changed). */
  readonly monitorRevalidations: readonly MonitorRevalidationProposal[];
  /** Memories revalidated during this reassessment (originals preserved, outcomes recorded). */
  readonly revalidatedMemories: readonly { readonly memoryId: string; readonly confirmed: boolean; readonly note: string }[];
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const REASSESSMENT_SCHEMA: OutputSchema = {
  name: "reassess.thesis",
  properties: {
    assessment: "string",
    rationale: "string",
    supportingEvidence: "string[]",
    contradictingEvidence: "string[]",
    unresolved: "string[]",
    whatWouldChange: "string[]",
    confidence: "string",
    researchQuality: "string",
    citedObjectRefs: "string[]",
    monitorRevalidations: "array", // entry-level validation below
    memoryRevalidations: "array", // entry-level validation below
  },
};

export const REASSESSMENT_SCHEMA_DESC = [
  '{"assessment": "SUPPORTED"|"WEAKENED"|"MATERIALLY_CHALLENGED"|"UNSUPPORTED"|"INDETERMINATE",',
  ' "rationale": string, "supportingEvidence": string[], "contradictingEvidence": string[],',
  ' "unresolved": string[], "whatWouldChange": string[], "confidence": "HIGH"|"MODERATE"|"LOW",',
  ' "researchQuality": "STRONG"|"MIXED"|"WEAK"|"UNAVAILABLE",',
  ' "citedObjectRefs": string[],  // evidence ids from the provided context only',
  ' "monitorRevalidations": [{"monitorId": string, "outcome": "STILL_RELEVANT"|"REVIEW", "rationale": string}],',
  ' "memoryRevalidations": [{"memoryId": string, "confirmed": boolean, "note": string}]',
].join("\n");

const MATERIALITY_SYSTEM = [
  "You are the materiality gate of a trading RESEARCH workbench (reassessment).",
  "You decide whether NEW evidence warrants reassessing the trader's thesis. You never execute anything.",
  "Rules:",
  "- Do NOT recommend reassessment merely because new data exists. Recommend it when the evidence is RELEVANT to the thesis's claims/assumptions/invalidation conditions, of usable quality, and capable of materially changing the assessment or the uncertainty picture.",
  "- LIMITATIONS (tool failures, empty feeds) are not evidence and never make evidence material.",
  "- Retrieval failure is not negative evidence.",
].join("\n");

const REASSESSMENT_SYSTEM = [
  "You are the thesis reassessor of a trading RESEARCH workbench.",
  "You receive the trader's thesis (NEVER rewrite it), its assessment history, and the VALIDATED research context including NEW evidence.",
  "Rules:",
  "- Assess with the existing vocabulary: SUPPORTED / WEAKENED / MATERIALLY_CHALLENGED / UNSUPPORTED / INDETERMINATE.",
  "- Current validated evidence OUTRANKS memory and historical conclusions. If a stored memory conflicts with current evidence, the memory is marked NOT confirmed — current research wins for current judgment.",
  "- Retrieval failure and tool limitations are data-availability conditions, NOT negative evidence.",
  "- Revalidate each proposed monitor: STILL_RELEVANT if its conditions remain material; REVIEW if new evidence makes a condition no longer material. Never claim a monitor was changed — you only propose.",
  "- Revalidate flagged memories (memoryId + whether current research confirms them). Originals are preserved by the system.",
  "- Only cite evidence ids present in the context — never fabricate refs.",
  "- The thesis object is never modified by reassessment; your output informs the trader, who decides.",
].join("\n");

// ---------------------------------------------------------------------------
// Reassessment runner
// ---------------------------------------------------------------------------

export interface ReassessOptions {
  readonly provider: ModelProvider;
  readonly workspace: Workspace;
  /** The thesis to reassess; defaults to the workspace's active thesis. */
  readonly thesisRef?: string;
  /** New evidence objects (already validated/ingested into the workspace) to weigh. */
  readonly newEvidence: readonly Evidence[];
  readonly origin?: ProvenanceOrigin;
  readonly now?: () => Date;
}

/**
 * Full reassessment pathway: materiality gate → (if material) model reassessment over the
 * thesis + history + new evidence → validated assessment-history record → monitor revalidation
 * proposals → memory revalidation. Thesis/framework/monitors are never silently mutated.
 */
export async function reassessThesis(options: ReassessOptions): Promise<ReassessmentResult> {
  const at = options.now ?? (() => new Date());
  const origin: ProvenanceOrigin = options.origin ?? { kind: "agent", detail: "Reassessment pathway" };
  const workspace = options.workspace;
  const thesis: Thesis | undefined = options.thesisRef !== undefined ? workspace.getThesis(options.thesisRef) : workspace.activeTheses()[0];
  if (thesis === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "no active thesis to reassess — nothing to evaluate (never fabricate one)", false);
    return noOpResult(new MaterialityDecisionShape(false, "no thesis", [], [], false, "n/a"), failure, "no thesis to reassess");
  }
  if (options.newEvidence.length === 0) {
    return noOpResult(new MaterialityDecisionShape(false, "no new evidence supplied — nothing to weigh", [], [], false, "n/a"), undefined, "No new evidence was supplied, so no reassessment ran.");
  }

  // 1. MATERIALITY GATE — model proposes; system validates. Irrelevant evidence = honest no-op.
  let materiality: MaterialityDecision;
  try {
    const res = await options.provider.structured<string>({
      schemaName: "reassess.materiality",
      schemaDescription: MATERIALITY_SCHEMA_DESC,
      system: MATERIALITY_SYSTEM,
      prompt: [
        `Thesis (trader-owned): "${thesis.statement}" (version ${thesis.version})`,
        `Claims: ${JSON.stringify(thesis.claims.map((c) => ({ statement: c.statement, importance: c.importance })))}`,
        `Assumptions: ${JSON.stringify(thesis.assumptions.map((a) => ({ statement: a.statement, importance: a.importance })))}`,
        `Invalidation conditions: ${JSON.stringify(thesis.invalidationConditions)}`,
        "NEW EVIDENCE:",
        ...options.newEvidence.map((e) => `- [${e.evidenceClass}] ${e.observation.slice(0, 200)} (id ${e.id}, observed ${e.observedAt})`),
      ].join("\n"),
      preferJson: true,
    });
    materiality = validateModelOutput<MaterialityDecision>(MATERIALITY_SCHEMA, res.raw).data;
  } catch (error) {
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return noOpResult(new MaterialityDecisionShape(false, `materiality gate failed: ${failure.message}`, [], [], false, "n/a"), failure, "The materiality check could not run (model failure) — no reassessment was performed.");
  }

  if (!materiality.reassessmentNeeded) {
    return noOpResult(materiality, undefined, `New evidence was reviewed and judged non-material for the thesis: ${materiality.rationale} No reassessment was performed (new data alone does not trigger reassessment).`);
  }

  // 2. REASSESS — via the existing evaluation pathway semantics (Flow 4 vocabulary), over the
  //    thesis + its assessment history + new evidence + relevant memories (stale labeled).
  const priorAssessments = workspace.listThesisAssessments(thesis.id);
  const memories = workspace.listMemories().filter((m) => m.thesisRef === thesis.id || m.contextTags.some((tag) => thesis.scope.entities.some((e) => tag.toLowerCase().includes(e.toLowerCase()))));
  const monitors = workspace.listMonitors().filter((m) => m.thesisRef === thesis.id && (m.status === "ACTIVE" || m.status === "PROPOSED"));
  const evidenceContext = {
    items: options.newEvidence.map((e) => ({
      ref: e.id,
      kind: "observation" as const,
      text: e.observation,
      evidenceClass: e.evidenceClass,
      timestamp: e.observedAt,
      sourceRefs: e.sourceRefs,
    })),
    claims: [], hypotheses: [], limitations: [], contradictions: [],
  };
  const historyText = priorAssessments.length > 0
    ? priorAssessments.map((a) => `- [v${a.thesisVersion}] ${a.assessment} (confidence ${a.confidence}, quality ${a.researchQuality ?? "n/a"}): ${a.rationale.slice(0, 140)}`).join("\n")
    : "- (no prior assessments)";

  let res: { raw: string };
  try {
    const resp = await options.provider.structured<string>({
      schemaName: "reassess.thesis",
      schemaDescription: REASSESSMENT_SCHEMA_DESC,
      system: REASSESSMENT_SYSTEM,
      prompt: [
        `TRADER'S THESIS (version ${thesis.version} — assess, never rewrite): "${thesis.statement}"`,
        `ASSESSMENT HISTORY (oldest first):\n${historyText}`,
        memories.length > 0 ? `RELEVANT MEMORY (continuity context — NOT current evidence; stale items must be flagged if unconfirmed):\n${memories.map((m: MemoryEntry) => `- [${m.status}] ${m.content.slice(0, 140)} (id ${m.id})`).join("\n")}` : "",
        `NEW EVIDENCE (validated):\n${options.newEvidence.map((e) => `- [${e.evidenceClass}] ${e.observation.slice(0, 240)} (id ${e.id})`).join("\n")}`,
        monitors.length > 0 ? `MONITORS to revalidate:\n${monitors.map((m: Monitor) => `- ${m.id} (${m.status}): ${m.conditions.map((c) => `[${c.kind}] ${c.description}`).join("; ").slice(0, 200)}`).join("\n")}` : "",
        "VALIDATED RESEARCH CONTEXT:",
        renderResearchContext(evidenceContext),
      ].filter((l) => l !== "").join("\n"),
      preferJson: true,
    });
    res = { raw: resp.raw };
  } catch (error) {
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return noOpResult(materiality, failure, `Reassessment failed at the model layer: ${failure.message} — the thesis is unchanged and no assessment was recorded.`);
  }

  // 3. SYSTEM VALIDATES the reassessment output.
  const parsed = validateModelOutput<Record<string, unknown>>(REASSESSMENT_SCHEMA, res.raw).data;
  const validAssessments = new Set(["SUPPORTED", "WEAKENED", "MATERIALLY_CHALLENGED", "UNSUPPORTED", "INDETERMINATE"]);
  const assessment = parsed["assessment"];
  const confidence = parsed["confidence"];
  const researchQuality = parsed["researchQuality"];
  if (typeof assessment !== "string" || !validAssessments.has(assessment)) {
    const failure = new ModelFailure("INVALID_OUTPUT", "reassessment vocabulary invalid — no assessment recorded", false);
    return noOpResult(materiality, failure, "Reassessment output failed validation — nothing was recorded and the thesis is unchanged.");
  }
  if (typeof confidence !== "string" || !["HIGH", "MODERATE", "LOW"].includes(confidence)) {
    const failure = new ModelFailure("INVALID_OUTPUT", "reassessment confidence invalid — no assessment recorded", false);
    return noOpResult(materiality, failure, "Reassessment output failed validation — nothing was recorded and the thesis is unchanged.");
  }
  const known = new Set<string>(options.newEvidence.map((e) => e.id));
  const refs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((r): r is string => typeof r === "string" && known.has(r)) : []);
  const strs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((s): s is string => typeof s === "string") : []);
  const monitorMap = new Map(monitors.map((m) => [m.id, m]));
  const memoryMap = new Map(memories.map((m) => [m.id, m]));
  const monitorRevalidations = (parsed["monitorRevalidations"] as unknown[]).flatMap((entry): MonitorRevalidationProposal[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const m = entry as Record<string, unknown>;
    if (typeof m.monitorId !== "string" || !monitorMap.has(m.monitorId)) return []; // invented monitors dropped
    if (m.outcome !== "STILL_RELEVANT" && m.outcome !== "REVIEW") return [];
    return [{ monitorId: m.monitorId, outcome: m.outcome as "STILL_RELEVANT" | "REVIEW", rationale: typeof m.rationale === "string" ? m.rationale : "" }];
  });
  const memoryRevalidations = (parsed["memoryRevalidations"] as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const m = entry as Record<string, unknown>;
    if (typeof m.memoryId !== "string" || !memoryMap.has(m.memoryId)) return []; // invented memories dropped
    if (typeof m.confirmed !== "boolean") return [];
    return [{ memoryId: m.memoryId, confirmed: m.confirmed, note: typeof m.note === "string" ? m.note : "" }];
  });

  // 4. RECORD the assessment (history entry — the thesis object is NOT mutated; M5 §14).
  const rq = typeof researchQuality === "string" && ["STRONG", "MIXED", "WEAK", "UNAVAILABLE"].includes(researchQuality)
    ? researchQuality as "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE"
    : undefined;
  const record = workspace.recordThesisAssessment({
    thesisId: thesis.id,
    thesisVersion: thesis.version,
    assessment: assessment as ThesisAssessmentRecord["assessment"],
    rationale: typeof parsed["rationale"] === "string" ? parsed["rationale"] : "",
    supportingEvidence: refs(parsed["supportingEvidence"]),
    contradictingEvidence: refs(parsed["contradictingEvidence"]),
    unresolved: strs(parsed["unresolved"]),
    whatWouldChange: strs(parsed["whatWouldChange"]),
    confidence: confidence as "HIGH" | "MODERATE" | "LOW",
    ...(rq !== undefined ? { researchQuality: rq } : {}),
  }, origin, at());

  // 5. APPLY memory revalidation to real entries (originals preserved; outcomes recorded; M5 §18).
  // A memory NOT confirmed by current research loses current influence (STALE) — the record
  // itself is never overwritten or deleted (current research outranks memory; M5 §3/§18).
  const appliedMemories: { memoryId: string; confirmed: boolean; note: string }[] = [];
  for (const mr of memoryRevalidations) {
    workspace.revalidateMemory(mr.memoryId, { confirmed: mr.confirmed, note: mr.note, ...(mr.confirmed ? {} : { newStatus: "STALE" as const }) }, origin, at());
    appliedMemories.push(mr);
  }

  // 6. MONITOR REVALIDATION — proposals; REVIEW flags set monitor status STALE for trader review
  //    (never deleted, never silently reworded; M5 §15).
  const revalidations: MonitorRevalidationProposal[] = monitorRevalidations.map((mr) => {
    if (mr.outcome === "REVIEW") {
      workspace.flagMonitorForReview(mr.monitorId, mr.rationale, origin, at());
    }
    return mr;
  });

  // 7. THESIS STATUS — reassessment may propose a thesis status transition; it is recorded as
  //    part of the assessment history only. The status transition itself stays a TRADER decision
  //    (thesis.md §6: thesis state is not a system decision).
  const response = buildReassessmentResponse(thesis, record, revalidations, appliedMemories, materiality);

  return {
    reassessed: true,
    materiality,
    assessment: record,
    monitorRevalidations: revalidations,
    revalidatedMemories: appliedMemories,
    response,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MATERIALITY_SCHEMA_DESC = [
  '{"reassessmentNeeded": boolean, "rationale": string,',
  ' "affectsClaims": string[], "affectsInvalidationConditions": string[],',
  ' "changesUncertainty": boolean, "evidenceQualityNote": string}',
].join("\n");

/** Local record shape for honest no-op results (no thesis import cycle issues). */
class MaterialityDecisionShape implements MaterialityDecision {
  constructor(
    public readonly reassessmentNeeded: boolean,
    public readonly rationale: string,
    public readonly affectsClaims: readonly string[],
    public readonly affectsInvalidationConditions: readonly string[],
    public readonly changesUncertainty: boolean,
    public readonly evidenceQualityNote: string,
  ) {}
}

function noOpResult(materiality: MaterialityDecision, failure: ModelFailure | undefined, response: string): ReassessmentResult {
  return {
    reassessed: false,
    materiality,
    monitorRevalidations: [],
    revalidatedMemories: [],
    ...(failure !== undefined ? { modelFailure: failure } : {}),
    response,
  };
}

function buildReassessmentResponse(
  thesis: Thesis,
  record: ThesisAssessmentRecord,
  revalidations: readonly MonitorRevalidationProposal[],
  memories: readonly { memoryId: string; confirmed: boolean; note: string }[],
  materiality: MaterialityDecision,
): string {
  const lines: string[] = [];
  lines.push(`**Thesis (trader-owned, version ${thesis.version}, unchanged):** "${thesis.statement}"`);
  lines.push(`**Reassessment:** ${record.assessment} — ${record.rationale}`);
  lines.push(`**Why now:** ${materiality.rationale}`);
  if (record.contradictingEvidence.length > 0) lines.push(`**New contradicting evidence:** ${record.contradictingEvidence.join(", ")}`);
  if (record.supportingEvidence.length > 0) lines.push(`**New supporting evidence:** ${record.supportingEvidence.join(", ")}`);
  lines.push(`**Evidence basis:** ${record.researchQuality ?? "n/a"} (confidence: ${record.confidence})`);
  if (memories.length > 0) {
    lines.push(`**Memory revalidated:** ${memories.map((m) => `${m.memoryId} ${m.confirmed ? "still current" : "no longer supported by current evidence (memory preserved, marked stale)"}`).join("; ")}`);
  }
  if (revalidations.length > 0) {
    lines.push(`**Monitors:** ${revalidations.map((m) => `${m.monitorId} → ${m.outcome === "REVIEW" ? "flagged for your review (conditions may no longer be material)" : "still relevant"}`).join("; ")}`);
  }
  lines.push(`**What would change this:** ${record.whatWouldChange.slice(0, 2).join("; ") || "see assessment history"}`);
  lines.push(`**Traceability:** assessment ${record.id} recorded in the thesis's assessment history — your thesis was not modified.`);
  return lines.join("\n");
}
