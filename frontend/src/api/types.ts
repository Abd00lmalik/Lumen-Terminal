/**
 * API contract types; mirrored from the backend's src/api/dto.ts and API_CONTRACT.md.
 * These describe what the F0 backend actually returns; the view types in data/types.ts
 * are adapted FROM these (never the other way around). Keep in sync with the backend.
 */

// ---------------------------------------------------------------------------
// Shared epistemic primitives (status data arrives from the backend verbatim)
// ---------------------------------------------------------------------------

export type EvidenceClassDto =
  | "RAW_DATA"
  | "OBSERVATION"
  | "DERIVED_OBSERVATION"
  | "INTERPRETATION"
  | "PROXY_EVIDENCE"
  | "SPECULATION";

export type FreshnessDto = "CURRENT" | "STALE" | "HISTORICAL";
export type ConfidenceDto = "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
export type ObjectStatusDto = string; // lifecycle statuses (ACTIVE, COMPLETED, SUPERSEDED, …)

export interface ProvenanceEntryDto {
  readonly at: string;
  readonly originKind: string;
  readonly originDetail?: string;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Research objects
// ---------------------------------------------------------------------------

export interface EvidenceDto {
  readonly ref: string;
  readonly observation: string;
  readonly evidenceType: string;
  readonly evidenceClass: EvidenceClassDto;
  readonly proxyBasis?: string;
  readonly freshness: FreshnessDto;
  readonly observedAt: string;
  readonly eventTimestamp?: string;
  readonly sourceRefs: readonly string[];
  readonly toolResultRef?: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
}

export interface ClaimDto {
  readonly ref: string;
  readonly statement: string;
  readonly type?: string;
  readonly evidenceRefs: readonly string[];
  readonly hypothesisRefs: readonly string[];
  readonly status: ObjectStatusDto;
}

export interface HypothesisDto {
  readonly ref: string;
  readonly statement: string;
  readonly type: string;
  readonly supportingClaims: readonly string[];
  readonly contradictingClaims: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly alternatives: readonly string[];
  readonly ranking: number;
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly status: ObjectStatusDto;
}

export interface JudgmentDto {
  readonly ref: string;
  readonly statement: string;
  readonly confidence?: ConfidenceDto;
  readonly uncertainty: readonly string[];
  readonly implications: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly supportingEvidence: readonly string[];
  readonly opposingEvidence: readonly string[];
  readonly keyClaims: readonly string[];
  readonly hypotheses: readonly string[];
  readonly status: ObjectStatusDto;
}

export interface ResearchDto {
  readonly ref: string;
  readonly objective: string;
  readonly question: string;
  readonly flow: string;
  readonly status: ObjectStatusDto;
  readonly currentJudgmentRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly claimRefs: readonly string[];
  readonly hypothesisRefs: readonly string[];
  readonly judgmentRefs: readonly string[];
  readonly history: readonly string[];
  /** Present on list endpoints: explicit current-ness; the client never infers it. */
  readonly isCurrent?: boolean;
}

// ---------------------------------------------------------------------------
// Thesis / assessments / artifacts / memory / monitors
// ---------------------------------------------------------------------------

export interface ThesisDto {
  readonly ref: string;
  readonly statement: string;
  readonly objective: string;
  readonly status: string;
  readonly version: number;
  readonly priorVersionRef?: string;
  readonly claims: readonly { readonly statement: string; readonly importance?: string }[];
  readonly assumptions: readonly { readonly statement: string }[];
  readonly invalidationConditions: readonly string[];
  readonly alternatives: readonly string[];
  readonly confidence?: ConfidenceDto;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isActive?: boolean; // list/detail endpoints only
  readonly assessments?: readonly ThesisAssessmentDto[]; // detail endpoint only
}

export type AssessmentStatusDto =
  | "SUPPORTED"
  | "WEAKENED"
  | "MATERIALLY_CHALLENGED"
  | "UNSUPPORTED"
  | "INDETERMINATE";

export interface ThesisAssessmentDto {
  readonly ref: string;
  readonly thesisRef: string;
  readonly thesisVersion: number;
  readonly assessment: AssessmentStatusDto;
  readonly rationale: string;
  readonly supportingEvidence: readonly string[];
  readonly contradictingEvidence: readonly string[];
  readonly unresolved: readonly string[];
  readonly whatWouldChange: readonly string[];
  readonly confidence?: ConfidenceDto;
  /** QUALITY ≠ CONFIDENCE; separate data, rendered separately. */
  readonly researchQuality?: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly researchRef?: string;
  readonly createdAt: string;
}

export interface SavedArtifactDto {
  readonly ref: string;
  readonly type: string;
  readonly content: string;
  readonly derivedFromRefs: readonly string[];
  readonly rationale: string;
  readonly researchRef?: string;
  readonly thesisRef?: string;
  readonly createdAt: string;
}

export type MemoryCategoryDto =
  | "research"
  | "thesis"
  | "framework"
  | "preference"
  | "historical"
  | "monitor";

export interface MemoryDto {
  readonly ref: string;
  readonly category: MemoryCategoryDto;
  readonly content: string;
  readonly status: FreshnessDto;
  readonly statusReason?: string;
  readonly createdAt: string;
  readonly lastValidatedAt?: string;
  readonly artifactRef?: string;
  readonly sourceResearchRef?: string;
  readonly sourceObjectRef?: string;
  readonly thesisRef?: string;
}

export type MonitorLifecycleDto = "PROPOSED" | "ACTIVE" | "PAUSED" | "STALE" | "COMPLETED";

export interface MonitorConditionDto {
  readonly description: string;
  readonly kind: "INVALIDATION" | "EARLY_WARNING";
  readonly triggerType: string;
  readonly conditionStatus: string;
  readonly rationale: string;
  readonly evidenceDependencies: readonly string[];
}

export interface MonitorDto {
  readonly ref: string;
  readonly target: string;
  readonly thesisRef?: string;
  readonly thesisVersion?: number;
  readonly conditions: readonly MonitorConditionDto[];
  readonly freshnessExpectation?: string;
  readonly suggestedFrequency?: string;
  readonly triggerRationale: string;
  readonly status: MonitorLifecycleDto;
  readonly sourceStates: readonly {
    readonly ref: string;
    readonly state: "SOURCE_UNAVAILABLE" | "OK";
    readonly note: string;
    readonly at: string;
  }[];
}

// ---------------------------------------------------------------------------
// Workspace continuity snapshot
// ---------------------------------------------------------------------------

export interface ContinuitySnapshotDto {
  readonly activeResearch?: ResearchDto;
  readonly activeBranchRef?: string;
  readonly recentEvidence: readonly EvidenceDto[];
  readonly currentClaims: readonly ClaimDto[];
  readonly currentHypotheses: readonly HypothesisDto[];
  readonly currentJudgment?: JudgmentDto;
  readonly activeThesis?: ThesisDto;
  readonly latestThesisAssessment?: ThesisAssessmentDto;
  readonly activeFramework?: SavedArtifactDto;
  readonly savedArtifacts: readonly SavedArtifactDto[];
  readonly monitorProposals: readonly MonitorDto[];
  readonly activeMonitors: readonly MonitorDto[];
  readonly memories: readonly MemoryDto[];
  readonly unresolvedUncertainties: readonly string[];
  readonly importantContradictions: readonly string[];
}

export interface SessionDto {
  readonly workspaceRef: string;
  readonly createdAt: string;
  readonly continuity: ContinuitySnapshotDto;
}

// ---------------------------------------------------------------------------
// Research request/response + errors
// ---------------------------------------------------------------------------

export interface AnswerDto {
  readonly answer: string;
  readonly supportingReasons: readonly string[];
  readonly opposingReasons: readonly string[];
  /** PRESENT | NONE_FOUND | NOT_ASSESSED — engine-reported disconfirmation state. */
  readonly counterevidenceStatus?: "PRESENT" | "NONE_FOUND" | "NOT_ASSESSED";
  readonly confidence: ConfidenceDto;
  readonly keyUncertainty: string;
  readonly implication: string;
  readonly citedObjectRefs: readonly string[];
}

export type ResearchOutcomeDto = "COMPLETED" | "AWAITING_CONFIRMATION" | "REJECTED" | "MODEL_FAILURE";

export interface RequirementDiagnosticDto {
  readonly description: string;
  /** CORE | SUPPORTING | CHALLENGE | CONTEXT (research-contract role). */
  readonly role?: string;
  readonly importance: string;
  readonly timeSensitivity: string;
  readonly status: string;
  readonly evidenceCount: number;
  readonly staleEvidenceCount: number;
  readonly recoveryAttempts: number;
  readonly unresolvedReason?: string;
}

export interface ResearchDiagnosticsDto {
  readonly requirements: readonly RequirementDiagnosticDto[];
  readonly executions: readonly {
    readonly round: number;
    readonly capability: string;
    readonly provider: string;
    readonly completeness: string;
    readonly failureType: string;
    readonly evidenceCount: number;
  }[];
  readonly floorCapabilities: readonly string[];
  readonly recoveryRounds: number;
  /** One gate per research outcome the request ran (loop and/or flow). */
  readonly completionGates?: readonly string[];
  readonly completionGate: string;
  readonly coverage: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  /** Engine-COMPUTED confidence ceiling (never the model's own claim). */
  readonly confidence?: string;
  /** Why that level: coverage/freshness/challenge/recovery components. */
  readonly confidenceBasis?: string;
  /** The decision type the engine inferred from the question (research contract). */
  readonly questionType?: string;
  /** Requirement roles present in the ledger. */
  readonly requirementRoles?: readonly string[];
  /** Engine-derived transmission-link statuses when the question asked for a causal chain. */
  readonly causalLinks?: readonly CausalLinkDiagnosticDto[];
  /** The link that binds the judgment (convenience for single-chain runs). */
  readonly weakestCausalLink?: string;
}

export interface CausalLinkDiagnosticDto {
  /** Canonical source (driver) fold of the link, e.g. "OIL" for OIL -> INFLATION. */
  readonly source?: string;
  readonly target: string;
  readonly targetLabel: string;
  readonly status: string;
  readonly requirementId: string;
  readonly evidenceRefs: readonly string[];
}

export interface ResearchResponseDto {
  readonly requestId: string;
  readonly action: string;
  readonly outcome: ResearchOutcomeDto;
  readonly answer: AnswerDto;
  /** Benchmark/coverage metadata (requirement ledger + execution facts). */
  readonly researchDiagnostics?: ResearchDiagnosticsDto;
  readonly modelFailure?: { readonly type: string; readonly message: string };
  readonly limitations: readonly string[];
  /** Material research gaps (engine-assessed); the only user-facing coverage items. */
  readonly researchGaps?: readonly string[];
  readonly researchRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly judgmentRef?: string;
  readonly evidence: readonly EvidenceDto[];
  readonly judgments: readonly JudgmentDto[];
  /** Flow 5 only: deterministic historical-episode analysis (server-computed, never derived here). */
  readonly historicalAnalysis?: HistoricalAnalysisDto;
}

export interface HistoricalAnalysisDto {
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

export interface ApiErrorDto {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly confirmation?: { readonly stepIndex: number; readonly reason: string };
  };
}

// ---------------------------------------------------------------------------
// SSE progress events (src/research/progress.ts vocabulary)
// ---------------------------------------------------------------------------

export type ProgressStage =
  | "request_accepted"
  | "intent_understood"
  | "target_resolved"
  | "ambiguity_checked"
  | "consequence_checked"
  | "safety_checked"
  | "plan_created"
  | "step_started"
  | "response_ready"
  | "research_plan_created"
  | "capability_started"
  | "capability_completed"
  | "research_round_completed"
  | "research_stopped";

export interface ProgressEventDto {
  readonly stage: ProgressStage;
  readonly at: string;
  readonly summary: string;
  readonly data?: Readonly<Record<string, string | number | boolean>>;
}

export type SseEventDto =
  | { readonly event: "progress"; readonly data: ProgressEventDto }
  | { readonly event: "final"; readonly data: ResearchResponseDto }
  | { readonly event: "error"; readonly data: ApiErrorDto };

/** GET /api/monitors response shape (lifecycle-grouped). */
export interface MonitorsDto {
  readonly proposals: readonly MonitorDto[];
  readonly active: readonly MonitorDto[];
  readonly paused: readonly MonitorDto[];
  readonly stale: readonly MonitorDto[];
  readonly completed: readonly MonitorDto[];
}

/** GET /api/health; process availability ONLY (never claims provider/monitoring health). */
export interface HealthDto {
  readonly status: string;
}
