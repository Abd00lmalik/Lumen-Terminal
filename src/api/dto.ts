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
import type { SavedArtifact, Thesis, ThesisAssessmentRecord, ThesisStatus } from "../domain/thesis.js";
import type { Provenance, ProvenanceOrigin } from "../domain/provenance.js";

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
  readonly observation: string;
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
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
}

export function evidenceToDTO(e: Evidence): EvidenceDTO {
  return {
    ref: e.id,
    observation: e.observation,
    evidenceType: e.evidenceType,
    evidenceClass: e.evidenceClass,
    ...(e.proxyBasis !== undefined ? { proxyBasis: e.proxyBasis } : {}),
    freshness: e.freshness,
    observedAt: e.observedAt,
    ...(e.timestamp !== undefined ? { eventTimestamp: e.timestamp } : {}),
    sourceRefs: idRefs(e.sourceRefs),
    ...(e.toolResultRef !== undefined ? { toolResultRef: e.toolResultRef } : {}),
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
  readonly statement: string;
  readonly objective: string;
  readonly status: ThesisStatus;
  readonly version: number;
  readonly priorVersionRef?: string;
  readonly claims: readonly ThesisClaimDTO[];
  readonly assumptions: readonly ThesisAssumptionDTO[];
  readonly invalidationConditions: readonly string[];
  readonly alternatives: readonly string[];
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function thesisToDTO(t: Thesis): ThesisDTO {
  return {
    ref: t.id,
    statement: t.statement,
    objective: t.objective,
    status: t.status,
    version: t.version,
    ...(t.priorVersionRef !== undefined ? { priorVersionRef: t.priorVersionRef } : {}),
    claims: t.claims.map((c) => ({ statement: c.statement, ...(c.importance !== undefined ? { importance: c.importance } : {}) })),
    assumptions: t.assumptions.map((a) => ({ statement: a.statement })),
    invalidationConditions: idRefs(t.invalidationConditions),
    alternatives: idRefs(t.alternatives),
    ...(t.confidence !== undefined ? { confidence: t.confidence } : {}),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
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
  };
}

// ---------------------------------------------------------------------------
// Workspace continuity DTO (F0 mandate §9)
// ---------------------------------------------------------------------------

export interface ContinuitySnapshotDTO {
  readonly activeResearch?: ResearchDTO;
  readonly activeBranchRef?: string;
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
  /** Validated refs only (the LUI already drops invented citations). */
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
}

export interface CausalLinkDiagnosticDTO {
  /** Canonical target fold of the link (INFLATION, RATES, RISK_ASSETS, ...). */
  readonly target: string;
  readonly targetLabel: string;
  /** SUPPORTED | PARTIALLY_SUPPORTED | STALE_ONLY | UNRESOLVED | NOT_RESEARCHED. */
  readonly status: string;
  readonly requirementId: string;
  readonly evidenceRefs: readonly string[];
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
   * BENCHMARK VISIBILITY (research coverage contract): structured execution metadata for
   * external scoring — what the run had to know, what it attempted, what it could not close.
   * Provenance and execution facts only; never model reasoning or hidden chain-of-thought.
   */
  readonly researchDiagnostics?: ResearchDiagnosticsDTO;
  /** The research object created by this request, when research ran. */
  readonly researchRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly judgmentRef?: string;
  /** Epistemic view of the evidence this request produced (classes preserved). */
  readonly evidence: readonly EvidenceDTO[];
  readonly judgments: readonly JudgmentDTO[];
  /** Flow 5 (HAS_THIS_HAPPENED_BEFORE) only: the deterministic historical-episode analysis
   *  current setup, explained analogues with per-dimension similarity, forward outcome windows.
   *  Structured server-side; the frontend renders it, never recomputes it. */
  readonly historicalAnalysis?: HistoricalAnalysisDTO;
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
  | "INTERNAL_ERROR";

export interface ApiErrorDTO {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    /** Confirmation/clarification context when code is AWAITING_CONFIRMATION. */
    readonly confirmation?: { readonly stepIndex: number; readonly reason: string };
  };
}
