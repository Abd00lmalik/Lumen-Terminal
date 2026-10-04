/**
 * F0 API DTOs; safe frontend view models (FRONTEND_ARCHITECTURE.md §9).
 *
 * Transport boundary rules (F0 mandate §2/§6/§7/§8):
 * - The API never exposes raw domain objects; every response is an explicit DTO.
 * - Epistemic distinctions are preserved AS DATA (evidence class, freshness, proxy basis,
 *   memory status, monitor lifecycle); the frontend never re-derives them.
 * - DTOs exclude: model prompts/reasoning, raw provider payloads, env/config, secrets,
 *   internal persistence paths. Provenance appears as references (ids + notes), not dumps.
 * - Mappers are pure functions; no logic, no state, no business decisions (F0 mandate §2).
 */

import type {
  Claim, Evidence, Freshness, Hypothesis, Judgment, Research,
} from "../domain/objects.js";
import type { EvidenceClass } from "../domain/objects.js";
import type { ObjectStatus } from "../domain/lifecycle.js";
import type { MemoryEntry, MemoryStatus, MemoryCategory, Monitor, MonitorCondition } from "../domain/memory.js";
import type { SavedArtifact, SavedKind, Thesis, ThesisAssessmentRecord, ThesisStatus } from "../domain/thesis.js";
import { THESIS_TRANSITIONS } from "../domain/thesis.js";
import type { Challenge } from "../domain/challenge.js";
import type { MonitoringAssessment, MonitorNotification } from "../domain/monitoring.js";
import type { Provenance, ProvenanceOrigin } from "../domain/provenance.js";
import { readableObservation } from "../research/observation-text.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Observation chars kept in list responses before truncation (full text via /:ref). */
const SUMMARY_OBSERVATION_CHARS = 400;

/** Epistemic evidence class; exposed verbatim so the UI can badge without re-deriving. */
export type EvidenceClassDTO = EvidenceClass; // RAW_DATA | OBSERVATION | DERIVED_OBSERVATION | INTERPRETATION | PROXY_EVIDENCE | SPECULATION

export type FreshnessDTO = Freshness; // CURRENT | STALE | HISTORICAL

export type ObjectStatusDTO = ObjectStatus;

/** Provenance trail, transport-safe: timestamps, origin kind/detail, notes. No internal paths. */
export interface ProvenanceEntryDTO {
  readonly at: string;
  readonly originKind: string;
  readonly originDetail?: string;
  readonly note?: string;
}

export function provenanceToDTO(p: Provenance): ProvenanceEntryDTO[] {
  return p.map((e) => {
    const origin: ProvenanceOrigin = e.origin;
    const detail = "toolRef" in origin ? `tool:${origin.toolRef}` : origin.detail;
    return {
      at: e.at,
      originKind: origin.kind,
      ...(detail !== undefined ? { originDetail: detail } : {}),
      ...(e.note !== undefined ? { note: e.note } : {}),
    };
  });
}

function idRefs(refs: readonly string[]): string[] {
  return [...refs];
}

// ---------------------------------------------------------------------------
// Evidence / claim / hypothesis / judgment
// ---------------------------------------------------------------------------

export interface EvidenceDTO {
  readonly ref: string;
  /** The research run that retrieved this observation (explicit ownership; never inferred). */
  readonly researchRunId?: string;
  readonly observation: string;
  /**
   * READABLE RENDERING of `observation` (presentation, not a second record): the frozen bytes
   * above are the integrity contract and stay untouched, while every trader-facing surface
   * shows this prose instead of a transport payload. Deterministic; asserts nothing the
   * payload does not say.
   */
  readonly displayText?: string;
  readonly evidenceType: string;
  /** Epistemic status AS DATA; the frontend badges this verbatim. */
  readonly evidenceClass: EvidenceClassDTO;
  /** Present ONLY for PROXY_EVIDENCE: what the proxy actually measures. */
  readonly proxyBasis?: string;
  readonly freshness: FreshnessDTO;
  readonly observedAt: string;
  readonly eventTimestamp?: string;
  readonly sourceRefs: readonly string[];
  readonly toolResultRef?: string;
  /** Serving source identity (transport/publisher/upstream) when known; distinct origins only corroborate. */
  readonly sourceProvider?: string;
  /** Source kind (PRIMARY/SECONDARY/COMMUNITY/ANALYSIS) when derivable from provenance. */
  readonly sourceType?: "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS";
  /** Repeated-content flag: same underlying report as another item; never independent corroboration. */
  readonly duplicateContent?: boolean;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
}

export function evidenceToDTO(e: Evidence): EvidenceDTO {
  return {
    ref: e.id,
    // PROVENANCE CONTRACT: the owning research run travels with every evidence object, so a
    // client can verify `evidence.researchRunId === currentResearchRunId` without inferring it.
    ...(e.researchRef !== undefined ? { researchRunId: e.researchRef } : {}),
    observation: e.observation,
    displayText: readableObservation(e.observation),
    evidenceType: e.evidenceType,
    evidenceClass: e.evidenceClass,
    ...(e.proxyBasis !== undefined ? { proxyBasis: e.proxyBasis } : {}),
    freshness: e.freshness,
    observedAt: e.observedAt,
    ...(e.timestamp !== undefined ? { eventTimestamp: e.timestamp } : {}),
    sourceRefs: idRefs(e.sourceRefs),
    ...(e.toolResultRef !== undefined ? { toolResultRef: e.toolResultRef } : {}),
    ...(e.sourceProvider !== undefined ? { sourceProvider: e.sourceProvider } : {}),
    ...(e.sourceType !== undefined ? { sourceType: e.sourceType } : {}),
    ...(e.duplicateContent === true ? { duplicateContent: true } : {}),
    supports: idRefs(e.supports),
    contradicts: idRefs(e.contradicts),
  };
}

/**
 * List-view summary: the full observation (which can embed an entire tool-result blob,
 * tens of KB per item) is truncated for list responses; the complete observation is
 * always available via GET /api/evidence/:ref (which uses `evidenceToDTO`). This keeps
 * list payloads bounded regardless of archive size — the unbounded variant reached
 * 1.28 MB in production and degraded every client load.
 */
export function evidenceSummaryDTO(e: Evidence): EvidenceDTO {
  const full = evidenceToDTO(e);
  return full.observation.length <= SUMMARY_OBSERVATION_CHARS
    ? full
    : { ...full, observation: full.observation.slice(0, SUMMARY_OBSERVATION_CHARS) + " …[truncated; full observation via /api/evidence/" + e.id + "]" };
}

export interface ClaimDTO {
  readonly ref: string;
  readonly statement: string;
  readonly type?: string;
  readonly evidenceRefs: readonly string[];
  readonly hypothesisRefs: readonly string[];
  readonly status: ObjectStatusDTO;
}

export function claimToDTO(c: Claim): ClaimDTO {
  return {
    ref: c.id,
    statement: c.statement,
    ...(c.type !== undefined ? { type: c.type } : {}),
    evidenceRefs: idRefs(c.evidenceRefs),
    hypothesisRefs: idRefs(c.hypothesisRefs),
    status: c.status,
  };
}

export interface HypothesisDTO {
  readonly ref: string;
  readonly statement: string;
  readonly type: Hypothesis["type"];
  readonly supportingClaims: readonly string[];
  readonly contradictingClaims: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly alternatives: readonly string[];
  readonly ranking: number;
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly status: ObjectStatusDTO;
}

export function hypothesisToDTO(h: Hypothesis): HypothesisDTO {
  return {
    ref: h.id,
    statement: h.statement,
    type: h.type,
    supportingClaims: idRefs(h.supportingClaims),
    contradictingClaims: idRefs(h.contradictingClaims),
    evidenceRefs: idRefs(h.evidenceRefs),
    alternatives: idRefs(h.alternatives),
    ranking: h.ranking,
    ...(h.confidence !== undefined ? { confidence: h.confidence } : {}),
    status: h.status,
  };
}

export interface JudgmentDTO {
  readonly ref: string;
  /** The research run that produced this judgment; Current Judgment is resolved through it. */
  readonly researchRunId: string;
  readonly statement: string;
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  readonly implications: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly supportingEvidence: readonly string[];
  readonly opposingEvidence: readonly string[];
  readonly keyClaims: readonly string[];
  readonly hypotheses: readonly string[];
  readonly status: ObjectStatusDTO;
}

export function judgmentToDTO(j: Judgment): JudgmentDTO {
  return {
    ref: j.id,
    // PROVENANCE CONTRACT: the run that produced this judgment, never a global "latest".
    researchRunId: j.researchRef,
    statement: j.statement,
    ...(j.confidence !== undefined ? { confidence: j.confidence } : {}),
    uncertainty: idRefs(j.uncertainty),
    implications: idRefs(j.implications),
    unresolvedQuestions: idRefs(j.unresolvedQuestions),
    supportingEvidence: idRefs(j.basis.supportingEvidence),
    opposingEvidence: idRefs(j.basis.opposingEvidence),
    keyClaims: idRefs(j.basis.keyClaims),
    hypotheses: idRefs(j.basis.hypotheses),
    status: j.status,
  };
}

export interface ResearchDTO {
  readonly ref: string;
  readonly objective: string;
  readonly question: string;
  /** One of the 8 locked flows (research-flows.md). Flow 5 is unavailable, never fabricated. */
  readonly flow: string;
  readonly status: ObjectStatusDTO;
  readonly currentJudgmentRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly claimRefs: readonly string[];
  readonly hypothesisRefs: readonly string[];
  readonly judgmentRefs: readonly string[];
  readonly history: readonly string[];
  /** The user submission this object belongs to (one question = one run). */
  readonly runRef?: string;
  /** The trader's verbatim question for the run; the text history shows. */
  readonly userQuestion?: string;
  /** Internal Research objects of the same run (plan steps, flow phases) — children, never top-level. */
  readonly internalRefs?: readonly string[];
}

export function researchToDTO(r: Research): ResearchDTO {
  return {
    ref: r.id,
    objective: r.objective,
    question: r.question,
    flow: r.flow,
    ...(r.runId !== undefined ? { runRef: r.runId } : {}),
    ...(r.userQuestion !== undefined ? { userQuestion: r.userQuestion } : {}),
    status: r.status,
    ...(r.currentJudgmentRef !== undefined ? { currentJudgmentRef: r.currentJudgmentRef } : {}),
    evidenceRefs: idRefs(r.evidenceRefs),
    claimRefs: idRefs(r.claimRefs),
    hypothesisRefs: idRefs(r.hypothesisRefs),
    judgmentRefs: idRefs(r.judgmentRefs),
    history: idRefs(r.history),
  };
}

// ---------------------------------------------------------------------------
// History list + ResearchRun aggregate (Phase B: run identity + history surface)
// ---------------------------------------------------------------------------

/**
 * Lightweight history entry (GET /api/research): ONE row per research RUN, answering
 * "what did I research?" — question, timestamps, status, confidence, question-resolution
 * verdict, a short insight preview, saved marker. Never an object dump; detailed
 * diagnostics live behind the run aggregate (GET /api/research/:ref) disclosure.
 */
export interface ResearchRunSummaryDTO extends ResearchDTO {
  /** Explicit current-ness (list + aggregate), never inferred by the client. */
  readonly isCurrent: boolean;
  /** First provenance timestamp across the run's research objects (when the run started). */
  readonly createdAt?: string;
  /** Last provenance timestamp across the run's research objects (when it last changed). */
  readonly updatedAt?: string;
  /** Engine-level confidence of the retained answer (absent when genuinely unknown). */
  readonly confidence?: string;
  /** Engine question-fit verdict: ANSWERED | PARTIALLY_ANSWERED | NOT_ANSWERED. */
  readonly questionResolutionStatus?: string;
  /** One-line actionable-insight preview (verbatim engine text, truncated). */
  readonly insightPreview?: string;
  /** One-line judgment preview (the run's conclusion, truncated). */
  readonly judgmentPreview?: string;
  /** True when a saved artifact derives from this run (SAVE through the LUI). */
  readonly saved?: boolean;
  /** True when the full run record is NOT retained (honest degraded listing). */
  readonly degraded?: boolean;
}

/**
 * How completely GET /api/research/:ref could reconstruct the run:
 * - FULL: the run's persisted presentation record (answer, evidence, gaps, diagnostics).
 * - JUDGMENT: legacy pre-record run reconstructed from its real persisted judgment.
 * - SUMMARY: only the research object summary remains (no answer retained; honest).
 */
export type ResearchRecordTierDTO = "FULL" | "JUDGMENT" | "SUMMARY";

/**
 * ResearchRun aggregate (GET /api/research/:ref): the single stable run-level presentation
 * contract. The frontend opens a historical run through this ONE endpoint instead of
 * stitching list/get/workspace/judgments calls. Carries the research object fields plus the
 * retained response surface (when a record exists), hoisted presentation fields, provenance,
 * timestamps, saved/thesis associations and the honest reconstruction tier. Internal engine
 * state beyond the diagnostics disclosure is not exposed.
 */
export type ResearchRunAggregateDTO = ResearchDTO &
  Partial<ResearchResponseDTO> & {
    /** Canonical open identity: ALWAYS the ref this aggregate was requested by. */
    readonly researchRef: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    /** Explicit current-ness (list + aggregate), never inferred by the client. */
    readonly isCurrent?: boolean;
    /** Provenance trail of the run's representative object (transport-safe). */
    readonly provenance: readonly ProvenanceEntryDTO[];
    /** True when a saved artifact derives from this run (SAVE through the LUI). */
    readonly saved: boolean;
    /** Reconstruction tier (see ResearchRecordTierDTO); degraded = tier !== FULL. */
    readonly recordTier: ResearchRecordTierDTO;
    readonly degraded: boolean;
    /** Engine question-fit verdict, hoisted for the run view (present when retained). */
    readonly questionResolution?: QuestionResolutionDTO;
    /** Actionable insight the answer carries (hoisted; never trade instructions). */
    readonly actionableInsight?: QuestionResolutionDTO["actionableInsight"];
    /** Watch items from the actionable insight (hoisted). */
    readonly watchNext?: readonly string[];
    /** Engine confidence level of the retained run (hoisted from diagnostics/answer). */
    readonly confidence?: string;
    /** Last completion gate the run ended on (hoisted from diagnostics). */
    readonly stoppedBecause?: string;
    /** Transmission links, hoisted for the run view (absent when the question asked none). */
    readonly causalLinks?: readonly CausalLinkDiagnosticDTO[];
    readonly weakestCausalLink?: string;
    /** Object counts for the run (evidence/claims/hypotheses/judgments). */
    readonly summary: {
      readonly evidenceCount: number;
      readonly claimCount: number;
      readonly hypothesisCount: number;
      readonly judgmentCount: number;
    };
    /** Thesis assessments produced by this run (thesis association; empty when none). */
    readonly thesisAssessments: readonly ThesisAssessmentDTO[];
    // Challenge/monitor associations: no such entities reference a research run today,
    // so none are exposed (a field would be invented state, not a mapping).
  };

// ---------------------------------------------------------------------------
// Thesis / assessments / frameworks / artifacts / memory / monitors
// ---------------------------------------------------------------------------

export interface ThesisClaimDTO {
  readonly statement: string;
  readonly importance?: string;
}

export interface ThesisAssumptionDTO {
  readonly statement: string;
}

export interface ThesisDTO {
  readonly ref: string;
  readonly title?: string;
  readonly statement: string;
  readonly objective: string;
  readonly asset?: string;
  readonly status: ThesisStatus;
  readonly version: number;
  readonly priorVersionRef?: string;
  readonly claims: readonly ThesisClaimDTO[];
  readonly assumptions: readonly ThesisAssumptionDTO[];
  readonly invalidationConditions: readonly string[];
  /** Material conditions: observable states that must hold for the thesis to stay tenable. */
  readonly materialConditions: readonly string[];
  readonly alternatives: readonly string[];
  /** Referenced runs (refs only; research objects are never copied into the thesis). */
  readonly linkedResearchRefs: readonly string[];
  /** Attached Saved artifacts (savedId refs only; never duplicated). */
  readonly linkedSavedIds: readonly string[];
  /** Trader confirmation state: false for a system-drafted thesis awaiting adoption. */
  readonly userConfirmed: boolean;
  /** Lifecycle moves allowed from the current status (deterministic; UI offers only these). */
  readonly allowedTransitions: readonly ThesisStatus[];
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function thesisToDTO(t: Thesis): ThesisDTO {
  return {
    ref: t.id,
    ...(t.title !== undefined ? { title: t.title } : {}),
    statement: t.statement,
    objective: t.objective,
    ...(t.asset !== undefined ? { asset: t.asset } : {}),
    status: t.status,
    version: t.version,
    ...(t.priorVersionRef !== undefined ? { priorVersionRef: t.priorVersionRef } : {}),
    claims: t.claims.map((c) => ({ statement: c.statement, ...(c.importance !== undefined ? { importance: c.importance } : {}) })),
    assumptions: t.assumptions.map((a) => ({ statement: a.statement })),
    invalidationConditions: idRefs(t.invalidationConditions),
    materialConditions: idRefs(t.materialConditions),
    alternatives: idRefs(t.alternatives),
    linkedResearchRefs: idRefs(t.linkedResearchRefs),
    linkedSavedIds: idRefs(t.linkedSavedIds),
    userConfirmed: t.userConfirmed,
    allowedTransitions: THESIS_TRANSITIONS[t.status] ?? [],
    ...(t.confidence !== undefined ? { confidence: t.confidence } : {}),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Challenge (Phase G): persistent falsification records derived from Flow 7
// ---------------------------------------------------------------------------

export interface ChallengeFalsifierDTO {
  readonly condition: string;
  readonly attacksClaim: string;
  readonly origin: "DERIVED_FROM_BELIEF" | "PROPOSED";
  readonly materiality: "MINOR" | "MEANINGFUL_WARNING" | "MATERIAL_CONTRADICTION" | "INVALIDATING";
}

export interface ChallengeDTO {
  readonly ref: string;
  readonly thesisRef: string;
  readonly thesisVersion: number;
  /** What part of the thesis this challenges, and why it could matter. */
  readonly claim: string;
  readonly falsifier: ChallengeFalsifierDTO;
  readonly status: "ACTIVE" | "RESOLVED" | "STALE" | "INFORMATION_GAP" | "CONTRADICTION";
  readonly materialityRationale: string;
  readonly supportingEvidenceRefs: readonly string[];
  readonly counterEvidenceRefs: readonly string[];
  readonly informationGaps: readonly string[];
  readonly conditionObserved: boolean;
  readonly researchRef: string;
  readonly assessment: ThesisAssessmentDTO["assessment"];
  readonly provenance: readonly ProvenanceEntryDTO[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function challengeToDTO(c: Challenge): ChallengeDTO {
  return {
    ref: c.id,
    thesisRef: c.thesisId,
    thesisVersion: c.thesisVersion,
    claim: c.claim,
    falsifier: c.falsifier,
    status: c.status,
    materialityRationale: c.materialityRationale,
    supportingEvidenceRefs: idRefs(c.supportingEvidenceRefs),
    counterEvidenceRefs: idRefs(c.counterEvidenceRefs),
    informationGaps: [...c.informationGaps],
    conditionObserved: c.conditionObserved,
    researchRef: c.researchRef,
    assessment: c.assessment,
    provenance: provenanceToDTO(c.provenance),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Result of POST /api/challenge: the Flow 7 verdict + the persisted challenge generation. */
export interface ChallengeRunDTO {
  readonly answer: string;
  readonly assessment?: "SUPPORTED" | "WEAKENED" | "MATERIALLY_CHALLENGED" | "UNSUPPORTED" | "INDETERMINATE";
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly researchRef?: string;
  /** Typed failure: no challenges assert anything when the methodology could not run. */
  readonly modelFailure?: { readonly type: string; readonly message: string };
  readonly challenges: readonly ChallengeDTO[];
}

/** Assessment status uses the first-class ThesisAssessmentStatus vocabulary (M6 audit D4). */
export interface ThesisAssessmentDTO {
  readonly ref: string;
  readonly thesisRef: string;
  readonly thesisVersion: number;
  readonly assessment: ThesisAssessmentRecord["assessment"];
  readonly rationale: string;
  readonly supportingEvidence: readonly string[];
  readonly contradictingEvidence: readonly string[];
  readonly unresolved: readonly string[];
  readonly whatWouldChange: readonly string[];
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  /** QUALITY ≠ CONFIDENCE: research quality is separate data, never merged into confidence. */
  readonly researchQuality?: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly researchRef?: string;
  readonly createdAt: string;
}

export function thesisAssessmentToDTO(a: ThesisAssessmentRecord): ThesisAssessmentDTO {
  return {
    ref: a.id,
    thesisRef: a.thesisId,
    thesisVersion: a.thesisVersion,
    assessment: a.assessment,
    rationale: a.rationale,
    supportingEvidence: idRefs(a.supportingEvidence),
    contradictingEvidence: idRefs(a.contradictingEvidence),
    unresolved: idRefs(a.unresolved),
    whatWouldChange: idRefs(a.whatWouldChange),
    ...(a.confidence !== undefined ? { confidence: a.confidence } : {}),
    ...(a.researchQuality !== undefined ? { researchQuality: a.researchQuality } : {}),
    ...(a.researchRef !== undefined ? { researchRef: a.researchRef } : {}),
    createdAt: a.createdAt,
  };
}

export interface SavedArtifactDTO {
  readonly ref: string;
  readonly type: string;
  readonly content: string;
  readonly derivedFromRefs: readonly string[];
  readonly rationale: string;
  readonly researchRef?: string;
  readonly thesisRef?: string;
  readonly createdAt: string;
}

export function artifactToDTO(a: SavedArtifact): SavedArtifactDTO {
  return {
    ref: a.id,
    type: a.type,
    content: a.content,
    derivedFromRefs: idRefs(a.derivedFromRefs),
    rationale: a.rationale,
    ...(a.researchRef !== undefined ? { researchRef: a.researchRef } : {}),
    ...(a.thesisRef !== undefined ? { thesisRef: a.thesisRef } : {}),
    createdAt: a.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Saved workspace (Phase C): the trader's explicitly-kept artifacts
// ---------------------------------------------------------------------------

export type SavedKindDTO = SavedKind; // RESEARCH | JUDGMENT | EVIDENCE | INSIGHT | WATCH_NEXT

/** Where a saved artifact came from (provenance context; never invented). */
export interface SavedOriginDTO {
  readonly researchRef?: string;
  /** The originating research question, when that run is still present. */
  readonly question?: string;
  /** The originating run's date (provenance-derived). */
  readonly createdAt?: string;
  /** The originating run's reconstruction tier (FULL | JUDGMENT | SUMMARY). */
  readonly recordTier?: ResearchRecordTierDTO;
  readonly degraded?: boolean;
  /** False when the originating run is no longer available; the artifact stays readable. */
  readonly available: boolean;
}

/** Saved-artifact library row (GET /api/saved): what the trader keeps, not everything researched. */
export interface SavedItemSummaryDTO {
  readonly savedId: string;
  readonly kind: SavedKindDTO;
  readonly title: string;
  readonly summary: string;
  readonly researchRef?: string;
  readonly sourceRef?: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Engine confidence of the originating artifact when it carries one. */
  readonly confidence?: string;
  /** Engine question-resolution verdict of the originating run (RESEARCH kind). */
  readonly questionResolutionStatus?: string;
  /** Freshness of a saved evidence artifact (CURRENT | STALE | HISTORICAL). */
  readonly freshness?: string;
  readonly degraded?: boolean;
  readonly recordTier?: ResearchRecordTierDTO;
}

/** Full saved artifact (GET /api/saved/:savedId): artifact first, provenance context after. */
export interface SavedItemDTO extends SavedItemSummaryDTO {
  readonly content: string;
  readonly derivedFromRefs: readonly string[];
  readonly rationale: string;
  /** Structured content persisted for this kind; rendered verbatim. */
  readonly snapshot?: Readonly<Record<string, unknown>>;
  readonly provenance: readonly ProvenanceEntryDTO[];
  readonly origin: SavedOriginDTO;
}

export function savedArtifactToDTO(a: SavedArtifact, origin: SavedOriginDTO): SavedItemDTO {
  const snapshotConfidence = typeof a.snapshot?.["confidence"] === "string" ? a.snapshot["confidence"] : undefined;
  const snapshotFreshness = typeof a.snapshot?.["freshness"] === "string" ? a.snapshot["freshness"] : undefined;
  const snapshotResolution = typeof a.snapshot?.["questionResolutionStatus"] === "string" ? a.snapshot["questionResolutionStatus"] : undefined;
  return {
    savedId: a.id,
    kind: a.kind,
    title: a.title,
    summary: a.summary,
    ...(a.researchRef !== undefined ? { researchRef: a.researchRef } : {}),
    ...(a.sourceRef !== undefined ? { sourceRef: a.sourceRef } : {}),
    tags: [...a.tags],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    ...(snapshotConfidence !== undefined ? { confidence: snapshotConfidence } : {}),
    ...(snapshotResolution !== undefined ? { questionResolutionStatus: snapshotResolution } : {}),
    ...(snapshotFreshness !== undefined ? { freshness: snapshotFreshness } : {}),
    ...(origin.degraded !== undefined ? { degraded: origin.degraded } : {}),
    ...(origin.recordTier !== undefined ? { recordTier: origin.recordTier } : {}),
    content: a.content,
    derivedFromRefs: [...a.derivedFromRefs],
    rationale: a.rationale,
    ...(a.snapshot !== undefined ? { snapshot: a.snapshot } : {}),
    provenance: provenanceToDTO(a.provenance),
    origin,
  };
}

/** Library row projection: a saved artifact WITHOUT its full body (bounded list payloads). */
export function savedArtifactToSummaryDTO(a: SavedArtifact, origin: SavedOriginDTO): SavedItemSummaryDTO {
  const full = savedArtifactToDTO(a, origin);
  const { content: _c, derivedFromRefs: _d, rationale: _r, snapshot: _s, provenance: _p, origin: _o, ...summary } = full;
  return summary;
}

export type MemoryStatusDTO = MemoryStatus; // CURRENT | STALE | HISTORICAL
export type MemoryCategoryDTO = MemoryCategory;

export interface MemoryDTO {
  readonly ref: string;
  readonly category: MemoryCategoryDTO;
  readonly content: string;
  /** Status AS DATA; the frontend demotes STALE/HISTORICAL; the API never merges them away. */
  readonly status: MemoryStatusDTO;
  readonly statusReason?: string;
  readonly createdAt: string;
  readonly lastValidatedAt?: string;
  readonly artifactRef?: string;
  readonly sourceResearchRef?: string;
  readonly sourceObjectRef?: string;
  readonly thesisRef?: string;
}

export function memoryToDTO(m: MemoryEntry): MemoryDTO {
  return {
    ref: m.id,
    category: m.category,
    content: m.content,
    status: m.status,
    ...(m.statusReason !== undefined ? { statusReason: m.statusReason } : {}),
    createdAt: m.createdAt,
    ...(m.lastValidatedAt !== undefined ? { lastValidatedAt: m.lastValidatedAt } : {}),
    ...(m.artifactRef !== undefined ? { artifactRef: m.artifactRef } : {}),
    ...(m.sourceResearchRef !== undefined ? { sourceResearchRef: m.sourceResearchRef } : {}),
    ...(m.sourceObjectRef !== undefined ? { sourceObjectRef: m.sourceObjectRef } : {}),
    ...(m.thesisRef !== undefined ? { thesisRef: m.thesisRef } : {}),
  };
}

export type MonitorLifecycleDTO = Monitor["status"]; // PROPOSED | ACTIVE | PAUSED | STALE | COMPLETED

export interface MonitorConditionDTO {
  readonly description: string;
  /** INVALIDATION vs EARLY_WARNING stay distinct kinds; the UI must never merge them. */
  readonly kind: MonitorCondition["kind"];
  readonly triggerType: MonitorCondition["triggerType"];
  readonly conditionStatus: MonitorCondition["conditionStatus"];
  readonly rationale: string;
  readonly evidenceDependencies: readonly string[];
}

export interface MonitorDTO {
  readonly ref: string;
  readonly target: string;
  readonly thesisRef?: string;
  readonly thesisVersion?: number;
  readonly conditions: readonly MonitorConditionDTO[];
  readonly freshnessExpectation?: string;
  readonly suggestedFrequency?: Monitor["suggestedFrequency"];
  readonly triggerRationale: string;
  /** Lifecycle AS DATA. PROPOSED ≠ ACTIVE; no background worker exists behind any status. */
  readonly status: MonitorLifecycleDTO;
  /** SOURCE_UNAVAILABLE is source STATE data, never an invalidation alert (M5 §12). */
  readonly sourceStates: readonly { readonly ref: string; readonly state: "SOURCE_UNAVAILABLE" | "OK"; readonly note: string; readonly at: string }[];
  // --- Phase H execution state ---
  readonly cadence?: "DAILY" | "WEEKLY" | "MANUAL";
  readonly lastCheckedAt?: string;
  /** Last check ATTEMPT distinct from completion (remediation D9: attempted ≠ completed). */
  readonly lastAttemptedCheckAt?: string;
  readonly lastTriggeredAt?: string;
  readonly lastAssessmentRef?: string;
  readonly linkedChallengeRefs?: readonly string[];
  /** Why am I watching this? Derived from the thesis/challenge relationship (§14). */
  readonly watchRationale?: string;
  readonly nextScheduledCheckAt?: string;
}

export interface MonitoringAssessmentDTO {
  readonly ref: string;
  readonly monitorRef: string;
  readonly thesisRef?: string;
  readonly checkId: string;
  readonly checkedAt: string;
  readonly outcome: "NO_MATERIAL_CHANGE" | "MATERIAL_CHANGE" | "INSUFFICIENT_EVIDENCE" | "PROVIDER_UNAVAILABLE" | "MONITOR_PAUSED";
  readonly changedConditions: readonly {
    readonly condition: string;
    readonly previousState: string;
    readonly currentState: string;
    readonly evidenceRefs: readonly string[];
    readonly materiality: "NOISE" | "MINOR" | "MEANINGFUL" | "MATERIAL";
    readonly materialityRationale: string;
    readonly freshness: "CURRENT" | "STALE" | "HISTORICAL";
  }[];
  readonly thesisImpact: "SUPPORTS_THESIS" | "WEAKENS_THESIS" | "POTENTIALLY_INVALIDATES_ASSUMPTION" | "NO_IMPACT" | "UNDETERMINED";
  readonly summary: string;
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  readonly researchRef?: string;
  readonly notificationRef?: string;
  readonly provenance: readonly ProvenanceEntryDTO[];
  readonly createdAt: string;
}

export interface MonitorNotificationDTO {
  readonly ref: string;
  readonly monitorRef: string;
  readonly assessmentRef: string;
  readonly title: string;
  readonly summary: string;
  readonly materiality: "NOISE" | "MINOR" | "MEANINGFUL" | "MATERIAL";
  readonly thesisImpact: string;
  readonly researchRef?: string;
  readonly read: boolean;
  readonly createdAt: string;
}

export interface MonitorCheckResultDTO {
  readonly assessment: MonitoringAssessmentDTO;
  readonly notification?: MonitorNotificationDTO;
  /** False when the check was deduplicated (idempotent replay) or not executed. */
  readonly executed: boolean;
}

export function monitorToDTO(m: Monitor): MonitorDTO {
  return {
    ref: m.id,
    target: m.target,
    ...(m.thesisRef !== undefined ? { thesisRef: m.thesisRef } : {}),
    ...(m.thesisVersion !== undefined ? { thesisVersion: m.thesisVersion } : {}),
    conditions: m.conditions.map((c) => ({
      description: c.description,
      kind: c.kind,
      triggerType: c.triggerType,
      conditionStatus: c.conditionStatus,
      rationale: c.rationale,
      evidenceDependencies: idRefs(c.evidenceDependencies),
    })),
    ...(m.freshnessExpectation !== undefined ? { freshnessExpectation: m.freshnessExpectation } : {}),
    ...(m.suggestedFrequency !== undefined ? { suggestedFrequency: m.suggestedFrequency } : {}),
    triggerRationale: m.triggerRationale,
    status: m.status,
    sourceStates: m.sourceStates.map((s) => ({ ref: s.ref, state: s.state, note: s.note, at: s.at })),
    // Phase H execution state + the "why am I watching this" rationale (challenge-derived).
    ...(m.cadence !== undefined ? { cadence: m.cadence } : {}),
    ...(m.lastCheckedAt !== undefined ? { lastCheckedAt: m.lastCheckedAt } : {}),
    ...(m.lastAttemptedCheckAt !== undefined ? { lastAttemptedCheckAt: m.lastAttemptedCheckAt } : {}),
    ...(m.lastTriggeredAt !== undefined ? { lastTriggeredAt: m.lastTriggeredAt } : {}),
    ...(m.lastAssessmentRef !== undefined ? { lastAssessmentRef: m.lastAssessmentRef } : {}),
    ...(m.linkedChallengeRefs !== undefined ? { linkedChallengeRefs: idRefs(m.linkedChallengeRefs) } : {}),
    ...(m.thesisRef !== undefined ? { watchRationale: `Watching the falsifiers of thesis ${m.thesisRef} (v${m.thesisVersion ?? "?"}): this monitor checks whether the challenged conditions have materially changed; the thesis itself is never modified by monitoring.` } : {}),
    ...nextCheckField(m),
  };
}

/** Next scheduled check (deterministic cadence law; MANUAL monitors are never scheduled). */
function nextCheckField(m: Monitor): { nextScheduledCheckAt?: string } {
  if (m.status !== "ACTIVE") return {};
  const interval = m.cadence === "DAILY" ? 24 * 60 * 60 * 1000 : m.cadence === "WEEKLY" ? 7 * 24 * 60 * 60 * 1000 : undefined;
  if (interval === undefined) return {};
  const base = m.lastCheckedAt !== undefined ? Date.parse(m.lastCheckedAt) : Date.parse(m.createdAt);
  if (Number.isNaN(base)) return {};
  return { nextScheduledCheckAt: new Date(base + interval).toISOString() };
}

export function monitoringAssessmentToDTO(a: MonitoringAssessment): MonitoringAssessmentDTO {
  return {
    ref: a.id,
    monitorRef: a.monitorRef,
    ...(a.thesisRef !== undefined ? { thesisRef: a.thesisRef } : {}),
    checkId: a.checkId,
    checkedAt: a.checkedAt,
    outcome: a.outcome,
    changedConditions: a.changedConditions.map((c) => ({
      condition: c.condition,
      previousState: c.previousState,
      currentState: c.currentState,
      evidenceRefs: idRefs(c.evidenceRefs),
      materiality: c.materiality,
      materialityRationale: c.materialityRationale,
      freshness: c.freshness,
    })),
    thesisImpact: a.thesisImpact,
    summary: a.summary,
    confidence: a.confidence,
    uncertainty: [...a.uncertainty],
    ...(a.researchRef !== undefined ? { researchRef: a.researchRef } : {}),
    ...(a.notificationRef !== undefined ? { notificationRef: a.notificationRef } : {}),
    provenance: provenanceToDTO(a.provenance),
    createdAt: a.createdAt,
  };
}

export function monitorNotificationToDTO(n: MonitorNotification): MonitorNotificationDTO {
  return {
    ref: n.id,
    monitorRef: n.monitorRef,
    assessmentRef: n.assessmentRef,
    title: n.title,
    summary: n.summary,
    materiality: n.materiality,
    thesisImpact: n.thesisImpact,
    ...(n.researchRef !== undefined ? { researchRef: n.researchRef } : {}),
    read: n.read,
    createdAt: n.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Workspace continuity DTO (F0 mandate §9)
// ---------------------------------------------------------------------------

export interface ContinuitySnapshotDTO {
  readonly activeResearch?: ResearchDTO;
  /**
   * The authoritative CURRENT research run. Evidence, judgment, answer and traceability in
   * this snapshot all belong to this run; a client binds its panels to it and discards any
   * response whose researchRunId differs.
   */
  readonly currentResearchRunId?: string;
  readonly activeBranchRef?: string;
  /** The CURRENT research run's evidence (never another run's observations). */
  readonly recentEvidence: readonly EvidenceDTO[];
  readonly currentClaims: readonly ClaimDTO[];
  readonly currentHypotheses: readonly HypothesisDTO[];
  readonly currentJudgment?: JudgmentDTO;
  readonly activeThesis?: ThesisDTO;
  readonly latestThesisAssessment?: ThesisAssessmentDTO;
  readonly activeFramework?: SavedArtifactDTO;
  readonly savedArtifacts: readonly SavedArtifactDTO[];
  readonly monitorProposals: readonly MonitorDTO[];
  readonly activeMonitors: readonly MonitorDTO[];
  readonly memories: readonly MemoryDTO[];
  readonly unresolvedUncertainties: readonly string[];
  readonly importantContradictions: readonly string[];
}

export interface BranchLite {
  readonly id: string;
}

/** Map the domain continuity snapshot into the safe DTO (pure; no re-derivation). */
export function continuitySnapshotToDTO(s: {
  activeResearchTarget: Research | undefined;
  currentResearchRunId?: string | undefined;
  activeBranch: { readonly id: string } | undefined;
  recentEvidence: readonly Evidence[];
  currentClaims: readonly Claim[];
  currentHypotheses: readonly Hypothesis[];
  currentJudgment: Judgment | undefined;
  activeThesis: Thesis | undefined;
  latestThesisAssessment: ThesisAssessmentRecord | undefined;
  activeFramework: SavedArtifact | undefined;
  savedArtifacts: readonly SavedArtifact[];
  monitorProposals: readonly Monitor[];
  activeMonitors: readonly Monitor[];
  memories: readonly MemoryEntry[];
  unresolvedUncertainties: readonly string[];
  importantContradictions: readonly string[];
}): ContinuitySnapshotDTO {
  return {
    ...(s.activeResearchTarget !== undefined ? { activeResearch: researchToDTO(s.activeResearchTarget) } : {}),
    // CURRENT POINTER: the authoritative research run every dependent panel binds to.
    ...(s.currentResearchRunId !== undefined ? { currentResearchRunId: s.currentResearchRunId } : {}),
    ...(s.activeBranch !== undefined ? { activeBranchRef: s.activeBranch.id } : {}),
    recentEvidence: s.recentEvidence.map(evidenceToDTO),
    currentClaims: s.currentClaims.map(claimToDTO),
    currentHypotheses: s.currentHypotheses.map(hypothesisToDTO),
    ...(s.currentJudgment !== undefined ? { currentJudgment: judgmentToDTO(s.currentJudgment) } : {}),
    ...(s.activeThesis !== undefined ? { activeThesis: thesisToDTO(s.activeThesis) } : {}),
    ...(s.latestThesisAssessment !== undefined ? { latestThesisAssessment: thesisAssessmentToDTO(s.latestThesisAssessment) } : {}),
    ...(s.activeFramework !== undefined ? { activeFramework: artifactToDTO(s.activeFramework) } : {}),
    savedArtifacts: s.savedArtifacts.map(artifactToDTO),
    monitorProposals: s.monitorProposals.map(monitorToDTO),
    activeMonitors: s.activeMonitors.map(monitorToDTO),
    memories: s.memories.map(memoryToDTO),
    unresolvedUncertainties: [...s.unresolvedUncertainties],
    importantContradictions: [...s.importantContradictions],
  };
}

/** Flow 5 structured episode analysis → transport-safe DTO (§8D). Structure-preserving. */
export function toHistoricalAnalysisDTO(a: {
  currentSetup?: {
    readonly asOf: string; readonly trendState: string; readonly momentumState: string;
    readonly volatilityState: string; readonly rangePositionState: string;
    readonly volumeState: string; readonly basis: string;
  } | undefined;
  episodesEvaluated: number;
  matches: readonly {
    episode: {
      anchorDate: string; window: { from: string; to: string };
      outcomes: readonly { days: number; forwardReturnPct: number; mfePct: number; maePct: number; directionPersisted: boolean }[];
      evidenceRefs: readonly string[];
    };
    dimensions: readonly { dimension: string; referenceValue: string; episodeValue: string; matched: boolean }[];
    differences: readonly string[];
  }[];
  interpretiveNote: string;
}): HistoricalAnalysisDTO {
  return {
    ...(a.currentSetup !== undefined ? { currentSetup: { ...a.currentSetup } } : {}),
    episodesEvaluated: a.episodesEvaluated,
    matches: a.matches.map((m) => ({
      anchorDate: m.episode.anchorDate,
      window: { from: m.episode.window.from, to: m.episode.window.to },
      dimensions: m.dimensions.map((d) => ({ ...d })),
      differences: [...m.differences],
      outcomes: m.episode.outcomes.map((o) => ({ ...o })),
      evidenceRefs: [...m.episode.evidenceRefs],
    })),
    interpretiveNote: a.interpretiveNote,
  };
}

// ---------------------------------------------------------------------------
// Research-request response DTO (F0 mandate §6/§7)
// ---------------------------------------------------------------------------

export type ResponseConfidenceDTO = "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

/**
 * Typography normalization for USER-FACING strings only. Model output is instructed to avoid
 * em/en dashes, but prompts are not a guarantee; the product renders plain punctuation.
 * Applied at the DTO boundary so stored research objects keep the model's verbatim output.
 */
export function uiText(s: string): string {
  return s.replace(/[\u2014\u2013]/g, "; ").replace(/\s{2,}/g, " ");
}

/**
 * PREMISE VALIDATION, as the client sees it: the run's own evidence contradicted the direction or
 * magnitude the question asserted. Every field is derived from admitted evidence; the note is a
 * trader-facing sentence with no identifiers, ids or engine vocabulary.
 */
export interface PremiseCheckDTO {
  readonly verdict: "CONTRADICTED" | "CONSISTENT" | "UNTESTABLE";
  readonly subject: string;
  readonly assertedDirection: "UP" | "DOWN";
  readonly assertedMagnitudePct?: number;
  readonly observedDirection?: "UP" | "DOWN";
  readonly observedChangePct?: number;
  readonly observedWindow: string;
  readonly evidenceRef: string;
  readonly note: string;
}

/** The progressive-disclosure answer card (L0); the primary frontend answer surface. */
export interface AnswerDTO {
  readonly answer: string;
  readonly supportingReasons: readonly string[];
  readonly opposingReasons: readonly string[];
  /**
   * PRESENT: opposing evidence was found. NONE_FOUND: the engine attempted disconfirmation
   * (FALSIFICATION capability) and the retrieval identified no material counterevidence.
   * NOT_ASSESSED: no disconfirmation was attempted, so an empty opposition list means nothing.
   */
  readonly counterevidenceStatus: "PRESENT" | "NONE_FOUND" | "NOT_ASSESSED";
  readonly confidence: ResponseConfidenceDTO;
  readonly keyUncertainty: string;
  readonly implication: string;
  /**
   * Object ids the answer is grounded in. FILTERED to the run's own evidence at the engine
   * boundary (provenance contract): a cross-run or invented citation cannot survive into the
   * record, so every id here belongs to the same research run as the answer.
   */
  readonly citedObjectRefs: readonly string[];
}

export interface RequirementDiagnosticDTO {
  readonly description: string;
  /** CORE | SUPPORTING | CHALLENGE | CONTEXT (or the role the engine inferred). */
  readonly role?: string;
  readonly importance: string;
  readonly timeSensitivity: string;
  /** SATISFIED | PARTIALLY_SATISFIED | PENDING | EXHAUSTED | UNAVAILABLE */
  readonly status: string;
  readonly evidenceCount: number;
  /** Observations that matched but fell outside the requirement's time horizon. */
  readonly staleEvidenceCount: number;
  readonly recoveryAttempts: number;
  readonly unresolvedReason?: string;
}

export interface ExecutionDiagnosticDTO {
  readonly round: number;
  readonly capability: string;
  /** Provider that served it (empty when no provider could). */
  readonly provider: string;
  readonly completeness: string;
  readonly failureType: string;
  readonly evidenceCount: number;
}

export interface ResearchDiagnosticsDTO {
  readonly requirements: readonly RequirementDiagnosticDTO[];
  readonly executions: readonly ExecutionDiagnosticDTO[];
  /** Capabilities the ENGINE's floor required beyond the model's plan. */
  readonly floorCapabilities: readonly string[];
  readonly recoveryRounds: number;
  /**
   * The engine's completion gate verdict per research outcome the request ran (a request may
   * dispatch its own loop AND route to a flow, each with its own gate).
   */
  readonly completionGates: readonly string[];
  /** The last gate reached (convenience for single-outcome runs). */
  readonly completionGate: string;
  /** Engine-assessed coverage: COMPLETE | PARTIAL | INSUFFICIENT. */
  readonly coverage: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  /** Engine-COMPUTED confidence level (the ceiling applied to any model-stated confidence). */
  readonly confidence?: string;
  /** Why that level: coverage, freshness, challenge and recovery components (no secrets). */
  readonly confidenceBasis?: string;
  /** The decision type the engine inferred from the question (research contract). */
  readonly questionType?: string;
  /** Requirement roles present in the ledger (CORE/SUPPORTING/CHALLENGE/CONTEXT). */
  readonly requirementRoles?: readonly string[];
  /**
   * TRANSMISSION LINKS (research contract §3): the engine-derived status of every causal link
   * the question's wording requested. Empty for questions that did not ask for a chain. Node
   * evidence is not arrow evidence, so this is what binds the judgment to the weakest link.
   */
  readonly causalLinks?: readonly CausalLinkDiagnosticDTO[];
  /** The link that binds the judgment (convenience for single-chain runs). */
  readonly weakestCausalLink?: string;
  /** QUESTION RESOLUTION (research contract): whether this run resolves the trader's need. */
  readonly questionResolution?: QuestionResolutionDTO;
}

export interface CausalLinkDiagnosticDTO {
  /** Canonical SOURCE fold of the link (the driver side, e.g. OIL for OIL->INFLATION). */
  readonly source?: string;
  /** Canonical target fold of the link (INFLATION, RATES, RISK_ASSETS, ...). */
  readonly target: string;
  readonly targetLabel: string;
  /** SUPPORTED | PARTIALLY_SUPPORTED | STALE_ONLY | UNRESOLVED | NOT_RESEARCHED. */
  readonly status: string;
  readonly requirementId: string;
  readonly evidenceRefs: readonly string[];
}

export interface QuestionResolutionDTO {
  /** Engine-derived decision intent (CURRENT_DRIVERS, THESIS_EVALUATION, ...). */
  readonly intent: string;
  /** Temporal window the question's wording requires (CURRENT, WEEKLY, MONTHLY, HISTORICAL, ANY). */
  readonly temporalScope: string;
  /** ANSWERED | PARTIALLY_ANSWERED | NOT_ANSWERED (engine-owned; model cannot self-declare). */
  readonly status: string;
  /** Per-dimension fit: the dimension and MISSING | PARTIAL | SATISFIED | NOT_APPLICABLE. */
  readonly dimensions: readonly { readonly dimension: string; readonly fit: string }[];
  readonly unresolvedDimensions: readonly string[];
  /** NONE | OBSERVED | RELEVANT | MATERIAL | CURRENTLY_ACTIVE */
  readonly materiality: string;
  readonly evidenceCount: number;
  readonly relevantEvidenceCount: number;
  readonly staleEvidenceCount: number;
  readonly answerClaimCount: number;
  readonly claimEvidenceLinks: number;
  /** Actionable insight fields the answer carries (never trade instructions). */
  readonly actionableInsight: {
    readonly whatEvidenceShows: readonly string[];
    readonly whatEvidenceDoesNotShow: readonly string[];
    readonly whatItMeans: string;
    readonly whatWouldChangeConclusion: readonly string[];
    readonly watchItems: readonly string[];
  };
}

export interface ResearchResponseDTO {
  readonly requestId: string;
  /** One of the locked six actions that ran (natural-language intent, not an API-routed flow). */
  readonly action: string;
  /** Whether the request halted for clarification/confirmation, was rejected, or completed. */
  readonly outcome: "COMPLETED" | "AWAITING_CONFIRMATION" | "REJECTED" | "MODEL_FAILURE";
  readonly answer: AnswerDTO;
  /** Typed failure classification when outcome is MODEL_FAILURE; never laundered into evidence. */
  readonly modelFailure?: { readonly type: string; readonly message: string };
  /** Limitations preserved verbatim from the research loop (partial results, provider outages). */
  readonly limitations: readonly string[];
  /**
   * MATERIAL research gaps (gap separation law): the engine-assessed CRITICAL requirements
   * this run could not satisfy after recovery, phrased as the requirement. These are the
   * only items allowed in the user-facing coverage panel; capability/provider notes stay in
   * the collapsed traceability detail.
   */
  readonly researchGaps: readonly string[];
  /**
   * PREMISE VALIDATION: present only when the run's OWN evidence contradicts the direction (or
   * magnitude) the question asserted. Trader-facing, identifier-free: "the current data shows
   * Bitcoin is up 0.81% over 24 hours, which does not match the premise that it moved down."
   * The note is ALSO the first line of the answer prose; this field lets the UI present it as a
   * distinct premise check rather than ordinary prose.
   */
  readonly premiseCheck?: PremiseCheckDTO;
  /**
   * BENCHMARK VISIBILITY (research coverage contract): structured execution metadata for
   * external scoring — what the run had to know, what it attempted, what it could not close.
   * Provenance and execution facts only; never model reasoning or hidden chain-of-thought.
   */
  readonly researchDiagnostics?: ResearchDiagnosticsDTO;
  /** The research object created by this request, when research ran. */
  readonly researchRef?: string;
  /**
   * The authoritative research run for this response. Async integrity: a client compares this
   * against its current run id and DISCARDS a response whose run differs, so a late
   * completion from an earlier submission can never overwrite the current workspace.
   */
  readonly researchRunId?: string;
  readonly evidenceRefs: readonly string[];
  readonly judgmentRef?: string;
  /**
   * EXECUTION MODE: how this run was executed.
   *
   * `RAW_OBSERVATION` means the request asked for a measurement only, and the application
   * enforced that: no judgment, no synthesis, no challenge requirement, no actionable insight,
   * no canonical research flow. The client uses this to present a measurement as a measurement —
   * it is a statement about the RESPONSE SHAPE, never a hint that content may be trimmed.
   */
  readonly executionMode?: "RESEARCH" | "RAW_OBSERVATION";
  /** Epistemic view of the evidence this request produced (classes preserved). */
  readonly evidence: readonly EvidenceDTO[];
  readonly judgments: readonly JudgmentDTO[];
  /** Flow 5 (HAS_THIS_HAPPENED_BEFORE) only: the deterministic historical-episode analysis
   *  current setup, explained analogues with per-dimension similarity, forward outcome windows.
   *  Structured server-side; the frontend renders it, never recomputes it. */
  readonly historicalAnalysis?: HistoricalAnalysisDTO;
}

/**
 * INVESTIGATION (conversational workbench). A thread of isolated research runs — the
 * conversation-level read surface. The frontend renders this; it never derives thread state.
 */
export interface InvestigationDTO {
  readonly id: string;
  readonly title: string;
  readonly subject: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isCurrent: boolean;
  /** The conversation, oldest first. */
  readonly turns: readonly ConversationTurnDTO[];
  /** The research runs this conversation produced, oldest first. */
  readonly runs: readonly {
    readonly researchRef: string;
    readonly runId: string;
    readonly userQuestion: string;
    readonly flow: string;
    readonly status: string;
    readonly judgmentRef?: string;
    readonly evidenceCount: number;
  }[];
  /** The trader's OWN thesis for this investigation, if they stated one. Never inferred. */
  readonly thesis?: { readonly thesisRef: string; readonly statement: string };
  /** Accumulated state DERIVED from real research artifacts (never a generated summary). */
  readonly state: InvestigationStateDTO;
}

export interface ConversationTurnDTO {
  readonly id: string;
  readonly investigationId: string;
  readonly role: string;
  readonly content: string;
  readonly intent: string;
  readonly researchRunId?: string;
  readonly continuedInvestigation: boolean;
  readonly createdAt: string;
}

export interface InvestigationStateDTO {
  readonly subject: string;
  readonly establishedFacts: readonly { readonly statement: string; readonly runId?: string; readonly evidenceRefs: readonly string[] }[];
  readonly findings: readonly { readonly statement: string; readonly runId?: string; readonly judgmentRef: string; readonly confidence: string }[];
  readonly competingExplanations: readonly { readonly statement: string; readonly runId?: string }[];
  readonly unresolvedQuestions: readonly string[];
  readonly thesis?: { readonly thesisRef: string; readonly statement: string };
  readonly challenges: readonly { readonly ref: string; readonly statement: string }[];
  readonly historicalComparisons: readonly { readonly runId: string; readonly statement: string }[];
  readonly runCount: number;
}

/** API view of the Flow 5 episode analysis (episode-analysis.ts shapes, transport-safe). */
export interface HistoricalAnalysisDTO {
  readonly currentSetup?: {
    readonly asOf: string;
    readonly trendState: string;
    readonly momentumState: string;
    readonly volatilityState: string;
    readonly rangePositionState: string;
    readonly volumeState: string;
    readonly basis: string;
  };
  readonly episodesEvaluated: number;
  readonly matches: readonly {
    readonly anchorDate: string;
    readonly window: { readonly from: string; readonly to: string };
    readonly dimensions: readonly {
      readonly dimension: string;
      readonly referenceValue: string;
      readonly episodeValue: string;
      readonly matched: boolean;
    }[];
    readonly differences: readonly string[];
    readonly outcomes: readonly {
      readonly days: number;
      readonly forwardReturnPct: number;
      readonly mfePct: number;
      readonly maePct: number;
      readonly directionPersisted: boolean;
    }[];
    readonly evidenceRefs: readonly string[];
  }[];
  readonly interpretiveNote: string;
}

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "AWAITING_CONFIRMATION"
  | "MODEL_FAILURE"
  | "PERSISTENCE_FAILURE"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export interface ApiErrorDTO {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    /** Confirmation/clarification context when code is AWAITING_CONFIRMATION. */
    readonly confirmation?: { readonly stepIndex: number; readonly reason: string };
  };
}
