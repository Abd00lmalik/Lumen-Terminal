/**
 * Thesis & SavedArtifact — M3 domain additions (architecture objects deliberately deferred
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
// THESIS — the trader's own position; system NEVER mutates it (thesis.md §1)
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
 * Thesis assessment history record (M5 §9 — thesis-monitor-reassessment.md §7 THESIS ASSESSMENT).
 * An ASSESSMENT is a research result ABOUT the thesis; it is NOT a mutation of the thesis itself.
 * The thesis object never changes when assessments are recorded.
 */
/**
 * Assessment vocabulary for thesis ASSESSMENTS (M4b §3: existing judgment vocabulary —
 * SUPPORTED/WEAKENED/MATERIALLY_CHALLENGED/UNSUPPORTED/INDETERMINATE). This is the evaluation
 * outcome about a thesis, distinct from the thesis's own lifecycle `ThesisStatus`.
 */
export type ThesisAssessmentStatus = "SUPPORTED" | "WEAKENED" | "MATERIALLY_CHALLENGED" | "UNSUPPORTED" | "INDETERMINATE";

export interface ThesisAssessmentRecord {
  readonly id: string;
  readonly thesisId: string;
  /** Exact thesis version assessed (assessment → thesis version provenance). */
  readonly thesisVersion: number;
  /** Existing judgment vocabulary — no new taxonomy (M4 §22; M4b §3; M5 §14). */
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
  /** Thesis creation is a TRADER action (or trader-approved import) — provenance records it. */
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
 * Version a thesis. THE TRADER must be the origin — the system never silently rewrites the
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
    throw new Error("thesis revision requires trader origin — the system must never silently rewrite the trader's thesis");
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
// SAVED_ARTIFACT — persistent reusable memory via SAVE (lui-save-action.md, memory.md)
// ---------------------------------------------------------------------------

export interface SavedArtifact {
  readonly id: string;
  readonly type: string; // e.g. "finding", "research-conclusion", "framework", "preference"
  readonly content: string;
  /** Workspace objects the artifact derives from — provenance, not decoration. */
  readonly derivedFromRefs: readonly string[];
  readonly rationale: string;
  readonly researchRef?: string;
  readonly thesisRef?: string;
  readonly provenance: Provenance;
  readonly createdAt: ISO;
}

export function createSavedArtifact(
  input: {
    type: string;
    content: string;
    derivedFromRefs?: readonly string[];
    rationale: string;
    researchRef?: string;
    thesisRef?: string;
  },
  origin: ProvenanceOrigin,
  at: Date = new Date(),
): SavedArtifact {
  if (input.content.trim() === "") {
    throw new Error("SavedArtifact requires non-empty content — never persist an empty SAVE");
  }
  return Object.freeze({
    id: newId(idPrefixes.artifact),
    type: input.type,
    content: input.content,
    derivedFromRefs: Object.freeze([...(input.derivedFromRefs ?? [])]),
    rationale: input.rationale,
    ...(input.researchRef !== undefined ? { researchRef: input.researchRef } : {}),
    ...(input.thesisRef !== undefined ? { thesisRef: input.thesisRef } : {}),
    provenance: createProvenance(origin, `saved artifact (${input.type}) created with trader confirmation`, at),
    createdAt: at.toISOString(),
  });
}
