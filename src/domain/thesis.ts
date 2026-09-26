/**
 * Thesis & SavedArtifact; M3 domain additions (architecture objects deliberately deferred
 * from M0; see objects.ts header and IMPLEMENTATION_PLAN.md).
 *
 * Architectural basis:
 * - thesis.md §1 THESIS schema + object-lifecycle-state-machine.md THESIS LIFECYCLE:
 *   DRAFT → ACTIVE → CONFIRMED / WEAKENED / REJECTED → SUPERSEDED → ARCHIVED.
 *   "The system must never silently replace a trader's thesis. The agent may recommend a
 *   revised thesis, but the trader remains the decision-maker." → thesis mutation is a
 *   TRADER-ONLY operation here; the system may only assess (M3 §15).
 * - lui-save-action.md + memory.md Saved Artifact: SAVE promotes eligible content into
 *   persistent reusable memory WITH provenance (derivedFrom, verdict trail, created_at).
 *   SAVE is first-class and distinct from MANAGE_STATE (human-approved architecture lock).
 * - Versioning rule (object-lifecycle-state-machine.md §454–478): Thesis is a versioned object
 *   (independently restorable states); SavedArtifact carries its provenance trail.
 */

import { newId, idPrefixes } from "./ids.js";
import { createProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";
import type { ISO } from "./objects.js";

// ---------------------------------------------------------------------------
// THESIS; the trader's own position; system NEVER mutates it (thesis.md §1)
// ---------------------------------------------------------------------------

/** Thesis lifecycle states (object-lifecycle-state-machine.md THESIS LIFECYCLE). */
export type ThesisStatus =
  | "DRAFT"
  | "ACTIVE"
  | "CONFIRMED"
  | "WEAKENED"
  | "REJECTED"
  | "SUPERSEDED"
  | "ARCHIVED";

export interface ThesisScope {
  readonly entities: readonly string[];
  readonly timeframe?: string;
  readonly marketContext?: string;
  readonly conditions?: readonly string[];
}

export interface ThesisClaim {
  readonly statement: string;
  readonly importance: "CORE" | "SUPPORTING" | "CONTEXTUAL";
  readonly invalidationConditions: readonly string[];
}

export interface ThesisAssumption {
  readonly statement: string;
  readonly importance: "CORE" | "SUPPORTING" | "CONTEXTUAL";
  readonly invalidationConditions: readonly string[];
}

/**
 * Thesis assessment history record (M5 §9; thesis-monitor-reassessment.md §7 THESIS ASSESSMENT).
 * An ASSESSMENT is a research result ABOUT the thesis; it is NOT a mutation of the thesis itself.
 * The thesis object never changes when assessments are recorded.
 */
/**
 * Assessment vocabulary for thesis ASSESSMENTS (M4b §3: existing judgment vocabulary
 * SUPPORTED/WEAKENED/MATERIALLY_CHALLENGED/UNSUPPORTED/INDETERMINATE). This is the evaluation
 * outcome about a thesis, distinct from the thesis's own lifecycle `ThesisStatus`.
 */
export type ThesisAssessmentStatus = "SUPPORTED" | "WEAKENED" | "MATERIALLY_CHALLENGED" | "UNSUPPORTED" | "INDETERMINATE";

export interface ThesisAssessmentRecord {
  readonly id: string;
  readonly thesisId: string;
  /** Exact thesis version assessed (assessment → thesis version provenance). */
  readonly thesisVersion: number;
  /** Existing judgment vocabulary; no new taxonomy (M4 §22; M4b §3; M5 §14). */
  readonly assessment: ThesisAssessmentStatus;
  readonly rationale: string;
  readonly supportingEvidence: readonly string[];
  readonly contradictingEvidence: readonly string[];
  readonly unresolved: readonly string[];
  readonly whatWouldChange: readonly string[];
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  /** Research this assessment came from (provenance chain: assessment → research → evidence). */
  readonly researchRef?: string;
  /** Research quality is recorded SEPARATELY from confidence (M4b §3 distinction). */
  readonly researchQuality?: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly provenance: Provenance;
  readonly createdAt: ISO;
}

export interface Thesis {
  readonly id: string;
  readonly statement: string;
  readonly objective: string;
  readonly scope: ThesisScope;
  readonly claims: readonly ThesisClaim[];
  readonly assumptions: readonly ThesisAssumption[];
  readonly invalidationConditions: readonly string[];
  readonly alternatives: readonly string[];
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly status: ThesisStatus;
  /** Thesis versions are independently restorable; history records how/why it changed. */
  readonly version: number;
  readonly priorVersionRef?: string;
  readonly provenance: Provenance;
  readonly createdAt: ISO;
  readonly updatedAt: ISO;
}

export function createThesis(
  input: {
    statement: string;
    objective: string;
    scope?: ThesisScope;
    claims?: readonly ThesisClaim[];
    assumptions?: readonly ThesisAssumption[];
    invalidationConditions?: readonly string[];
    alternatives?: readonly string[];
    confidence?: "HIGH" | "MODERATE" | "LOW";
  },
  /** Thesis creation is a TRADER action (or trader-approved import); provenance records it. */
  origin: ProvenanceOrigin,
  at: Date = new Date(),
): Thesis {
  return Object.freeze({
    id: newId(idPrefixes.thesis),
    statement: input.statement,
    objective: input.objective,
    scope: Object.freeze({
      entities: Object.freeze([...(input.scope?.entities ?? [])]),
      ...(input.scope?.timeframe !== undefined ? { timeframe: input.scope.timeframe } : {}),
      ...(input.scope?.marketContext !== undefined ? { marketContext: input.scope.marketContext } : {}),
      ...(input.scope?.conditions !== undefined ? { conditions: Object.freeze([...input.scope.conditions]) } : {}),
    }),
    claims: Object.freeze([...(input.claims ?? [])].map((c) => Object.freeze({ ...c }))),
    assumptions: Object.freeze([...(input.assumptions ?? [])].map((a) => Object.freeze({ ...a }))),
    invalidationConditions: Object.freeze([...(input.invalidationConditions ?? [])]),
    alternatives: Object.freeze([...(input.alternatives ?? [])]),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    status: "ACTIVE",
    version: 1,
    provenance: createProvenance(origin, "thesis created (trader-owned)", at),
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  });
}

/**
 * Version a thesis. THE TRADER must be the origin; the system never silently rewrites the
 * thesis (thesis.md; M3 §15). Previous version stays fully preserved via priorVersionRef.
 */
export function reviseThesis(
  prior: Thesis,
  changes: Partial<Pick<Thesis, "statement" | "objective" | "scope" | "claims" | "assumptions" | "invalidationConditions" | "alternatives" | "confidence">>,
  origin: ProvenanceOrigin,
  note: string,
  at: Date = new Date(),
): Thesis {
  if (origin.kind !== "trader") {
    throw new Error("thesis revision requires trader origin; the system must never silently rewrite the trader's thesis");
  }
  return Object.freeze({
    ...prior,
    ...(changes.statement !== undefined ? { statement: changes.statement } : {}),
    ...(changes.objective !== undefined ? { objective: changes.objective } : {}),
    ...(changes.scope !== undefined ? { scope: changes.scope } : {}),
    ...(changes.claims !== undefined ? { claims: changes.claims } : {}),
    ...(changes.assumptions !== undefined ? { assumptions: changes.assumptions } : {}),
    ...(changes.invalidationConditions !== undefined ? { invalidationConditions: changes.invalidationConditions } : {}),
    ...(changes.alternatives !== undefined ? { alternatives: changes.alternatives } : {}),
    ...(changes.confidence !== undefined ? { confidence: changes.confidence } : {}),
    version: prior.version + 1,
    priorVersionRef: prior.id,
    provenance: createProvenance(origin, `thesis revised (v${prior.version + 1}): ${note}`, at),
    createdAt: prior.createdAt,
    updatedAt: at.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// SAVED_ARTIFACT; persistent reusable memory via SAVE (lui-save-action.md, memory.md)
//
// Phase C (Saved workspace): HISTORY is everything Lumen researched; SAVED is what the
// trader EXPLICITLY chose to keep. The artifact carries the origin it was promoted from
// (researchRef always; sourceRef identifies the exact originating object) so a saved fact
// can never masquerade as an independent, origin-less fact. Kinds are deliberately limited
// to the artifacts the research surfaces actually produce (no new taxonomy invented).
// ---------------------------------------------------------------------------

/** Phase C artifact kinds. Deliberately closed: no invented artifact types. */
export type SavedKind = "RESEARCH" | "JUDGMENT" | "EVIDENCE" | "INSIGHT" | "WATCH_NEXT";

export const SAVED_KINDS: readonly SavedKind[] = ["RESEARCH", "JUDGMENT", "EVIDENCE", "INSIGHT", "WATCH_NEXT"];

export function isSavedKind(value: unknown): value is SavedKind {
  return typeof value === "string" && (SAVED_KINDS as readonly string[]).includes(value);
}

/**
 * Map a legacy artifact `type` (pre-Phase-C vocabulary: finding, research-conclusion,
 * framework, ...) onto a Phase C kind. Legacy records keep their exact content; only the
 * missing classification is supplied, so old workspaces load without a migration write.
 */
export function legacyKindFromType(type: string | undefined): SavedKind {
  const t = (type ?? "").toLowerCase();
  if (t.includes("judg") || t.includes("conclusion") || t.includes("verdict")) return "JUDGMENT";
  if (t.includes("eviden")) return "EVIDENCE";
  if (t.includes("insight")) return "INSIGHT";
  if (t.includes("watch")) return "WATCH_NEXT";
  return "RESEARCH";
}

export interface SavedArtifact {
  readonly id: string;
  /** Phase C kind (RESEARCH | JUDGMENT | EVIDENCE | INSIGHT | WATCH_NEXT). */
  readonly kind: SavedKind;
  /** Legacy/free-form artifact type retained for continuity views (framework, preference, ...). */
  readonly type: string;
  readonly title: string;
  /** Concise one-line summary for the library row. */
  readonly summary: string;
  readonly content: string;
  /** Workspace objects the artifact derives from; provenance, not decoration. */
  readonly derivedFromRefs: readonly string[];
  readonly rationale: string;
  /** Originating research run; NEVER absent for a research-derived artifact. */
  readonly researchRef?: string;
  /** Exact originating object (judgment/evidence ref, watch index, insight marker). */
  readonly sourceRef?: string;
  readonly thesisRef?: string;
  readonly tags: readonly string[];
  /** Structured, already-persisted content for this kind (rendered verbatim; never re-derived). */
  readonly snapshot?: Readonly<Record<string, unknown>>;
  readonly provenance: Provenance;
  readonly createdAt: ISO;
  readonly updatedAt: ISO;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Deterministic identity of a saved artifact: originating research + kind + source object.
 * Title/question TEXT is never identity — retitling must not fork a second artifact, and
 * re-saving the same artifact must be idempotent.
 */
export function savedArtifactIdentity(a: Pick<SavedArtifact, "researchRef" | "kind" | "sourceRef">): string {
  const origin = a.researchRef ?? "";
  const source = a.sourceRef ?? a.researchRef ?? "";
  return `${origin}::${a.kind}::${source}`;
}

/**
 * Normalize a persisted (possibly legacy) artifact into the full Phase C shape. Legacy
 * records lack kind/title/tags/updatedAt/snapshot; the missing data is derived from what the
 * record actually holds (never invented), and the record is otherwise preserved verbatim.
 */
export function normalizeSavedArtifact(a: SavedArtifact): SavedArtifact {
  const raw = a as Partial<SavedArtifact>;
  const kind = isSavedKind(raw.kind) ? raw.kind : legacyKindFromType(raw.type);
  const content = typeof raw.content === "string" ? raw.content : "";
  const title = typeof raw.title === "string" && raw.title.trim() !== ""
    ? raw.title
    : clip(typeof raw.summary === "string" && raw.summary !== "" ? raw.summary : content, 120);
  const summary = typeof raw.summary === "string" && raw.summary !== "" ? raw.summary : clip(content, 240);
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  return Object.freeze({
    ...a,
    kind,
    type: typeof raw.type === "string" && raw.type !== "" ? raw.type : kind.toLowerCase(),
    title,
    summary,
    content,
    derivedFromRefs: Array.isArray(raw.derivedFromRefs) ? raw.derivedFromRefs : [],
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    provenance: Array.isArray(raw.provenance) ? raw.provenance : createProvenance({ kind: "system", detail: "legacy saved artifact" }),
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt,
  });
}

export function createSavedArtifact(
  input: {
    kind?: SavedKind;
    type?: string;
    title?: string;
    summary?: string;
    content: string;
    derivedFromRefs?: readonly string[];
    rationale?: string;
    researchRef?: string;
    sourceRef?: string;
    thesisRef?: string;
    tags?: readonly string[];
    snapshot?: Readonly<Record<string, unknown>>;
  },
  origin: ProvenanceOrigin,
  at: Date = new Date(),
): SavedArtifact {
  if (input.content.trim() === "") {
    throw new Error("SavedArtifact requires non-empty content; never persist an empty SAVE");
  }
  const kind: SavedKind = input.kind ?? legacyKindFromType(input.type);
  if (!isSavedKind(kind)) {
    throw new Error(`SavedArtifact kind must be one of ${SAVED_KINDS.join(", ")}`);
  }
  const type = input.type ?? kind.toLowerCase();
  const title = input.title !== undefined && input.title.trim() !== "" ? input.title.trim() : clip(input.summary ?? input.content, 120);
  const summary = input.summary !== undefined && input.summary.trim() !== "" ? clip(input.summary, 240) : clip(input.content, 240);
  const iso = at.toISOString();
  return Object.freeze({
    id: newId(idPrefixes.artifact),
    kind,
    type,
    title,
    summary,
    content: input.content,
    derivedFromRefs: Object.freeze([...(input.derivedFromRefs ?? [])]),
    rationale: input.rationale ?? "",
    ...(input.researchRef !== undefined ? { researchRef: input.researchRef } : {}),
    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
    ...(input.thesisRef !== undefined ? { thesisRef: input.thesisRef } : {}),
    tags: Object.freeze([...(input.tags ?? [])]),
    ...(input.snapshot !== undefined ? { snapshot: Object.freeze({ ...input.snapshot }) } : {}),
    provenance: createProvenance(origin, `saved artifact (${kind}) created with trader confirmation`, at),
    createdAt: iso,
    updatedAt: iso,
  });
}
