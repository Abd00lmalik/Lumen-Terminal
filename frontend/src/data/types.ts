/**
 * Frontend view-model types — mirror the documented API contract shapes
 * (src/api/dto.ts) so integration later replaces mock data with real responses
 * without redesigning components. No backend imports here — this is a prototype.
 */

export type EvidenceClass =
  | "RAW_DATA"
  | "OBSERVATION"
  | "DERIVED_OBSERVATION"
  | "INTERPRETATION"
  | "PROXY_EVIDENCE"
  | "SPECULATION";

export type UnavailableInfo = { readonly kind: "UNAVAILABLE"; readonly note: string };

export type Freshness = "CURRENT" | "STALE" | "HISTORICAL";

export type Confidence = "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface EvidenceItem {
  readonly ref: string;
  readonly observation: string;
  readonly evidenceType: string;
  readonly evidenceClass: EvidenceClass | UnavailableInfo;
  readonly proxyBasis?: string;
  readonly freshness: Freshness;
  readonly observedAt: string;
  readonly eventTimestamp?: string;
  readonly sourceRefs: readonly string[];
  readonly toolResultRef?: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
}

export interface SourceInfo {
  readonly ref: string;
  readonly title: string;
  readonly kind: string;
  readonly timestamp: string;
  readonly freshness: Freshness;
  readonly provenance: string;
}

export interface JudgmentView {
  readonly ref: string;
  readonly statement: string;
  readonly confidence: Confidence;
  readonly uncertainty: readonly string[];
  readonly implications: readonly string[];
  readonly supportingEvidence: readonly string[];
  readonly opposingEvidence: readonly string[];
}

export interface ResearchSummary {
  readonly ref: string;
  readonly title: string;
  readonly question: string;
  readonly flow: string;
  readonly status: "COMPLETED" | "ACTIVE" | "AWAITING_CONFIRMATION" | "INSUFFICIENT_EVIDENCE";
  readonly confidence: Confidence;
  readonly updatedAt: string;
  readonly evidenceCount: number;
  readonly sourceCount: number;
  readonly isCurrent?: boolean;
}

export interface ThesisClaimView {
  readonly statement: string;
  readonly importance: "CORE" | "SUPPORTING";
  readonly invalidationConditions: readonly string[];
}

export interface ThesisAssessmentView {
  readonly assessment: "SUPPORTED" | "WEAKENED" | "MATERIALLY_CHALLENGED" | "UNSUPPORTED" | "INDETERMINATE";
  readonly rationale: string;
  readonly confidence: Confidence;
  readonly researchQuality: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly at: string;
  readonly whatWouldChange: readonly string[];
  readonly unresolved: readonly string[];
}

export interface ThesisView {
  readonly ref: string;
  readonly statement: string;
  readonly objective: string;
  readonly version: number;
  readonly claims: readonly ThesisClaimView[];
  readonly assumptions: readonly { statement: string; invalidationConditions: readonly string[] }[];
  readonly invalidationConditions: readonly string[];
  readonly assessments: readonly ThesisAssessmentView[];
  readonly confidence: Confidence;
  readonly researchQuality: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly supportingRefs: readonly string[];
  readonly contradictingRefs: readonly string[];
  readonly updatedAt: string;
  readonly status: string;
}

export interface MonitorConditionView {
  readonly description: string;
  readonly kind: "INVALIDATION" | "EARLY_WARNING";
  readonly triggerType: string;
}

export interface MonitorView {
  readonly ref: string;
  readonly target: string;
  readonly status: "PROPOSED" | "ACTIVE" | "PAUSED" | "STALE" | "COMPLETED";
  readonly conditions: readonly MonitorConditionView[];
  readonly sourceStates: readonly { ref: string; state: "OK" | "SOURCE_UNAVAILABLE"; note: string }[];
  /** Backend monitors carry no review timestamp; absence renders honestly as —. */
  readonly lastReviewed?: string;
  readonly triggerRationale: string;
}

export type MemoryStatus = "CURRENT" | "STALE" | "HISTORICAL";

export interface MemoryItem {
  readonly ref: string;
  readonly category: "research" | "thesis" | "framework" | "preference" | "historical" | "monitor";
  readonly content: string;
  readonly status: MemoryStatus;
  readonly statusReason?: string;
  readonly lastValidatedAt?: string;
  readonly createdAt: string;
}

export interface SavedArtifactView {
  readonly ref: string;
  readonly type: string;
  readonly content: string;
  readonly createdAt: string;
  readonly derivedFromRefs: readonly string[];
}

export interface ResearchRunStage {
  readonly name: string;
  readonly detail: string;
  readonly status: "done" | "active" | "pending";
}

export interface CapabilityRun {
  readonly name: string;
  readonly completeness: "COMPLETE" | "PARTIAL" | "EMPTY" | "FAILED";
  readonly sources: number;
  readonly evidence: number;
}

export interface ResearchRunState {
  readonly question: string;
  readonly elapsedSeconds: number;
  readonly stages: readonly ResearchRunStage[];
  readonly capabilities: readonly CapabilityRun[];
  readonly partialFindings: readonly string[];
}

export interface ChallengeView {
  readonly belief: string;
  readonly beliefOwner: string;
  readonly falsificationTargets: readonly {
    readonly target: string;
    readonly ref?: string;
    readonly origin: "DERIVED_FROM_BELIEF" | "PROPOSED";
    readonly searched: string;
    readonly found: "DISCONFIRMING" | "NONE_FOUND" | "SUPPORTING_ONLY";
    readonly evidenceRefs: readonly string[];
  }[];
  readonly warnings: readonly string[];
  readonly assessment: ThesisAssessmentView["assessment"] | undefined;
  readonly whatWouldChange: readonly string[];
}

export interface WorkspaceListItem {
  readonly ref: string;
  readonly title: string;
  readonly kind: "research" | "thesis" | "monitor";
  readonly status: string;
  readonly updatedAt: string;
  readonly meta: string;
}
