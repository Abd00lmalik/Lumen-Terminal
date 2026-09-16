/**
 * DTO → view-model adapters. The ONLY place backend DTOs meet the frontend's view
 * types: presentational components keep their existing props; pages consume adapters.
 *
 * Adaptation rules (integration mandate §18/§20):
 * - Epistemic status is copied verbatim; never flattened, never re-derived.
 * - Missing data renders honestly (, empty lists, unknown), never invented.
 * - Backend failure states (limitations, SOURCE_UNAVAILABLE, STALE) surface as data.
 */
import type {
  EvidenceDto, JudgmentDto, ResearchDto, ThesisDto, ThesisAssessmentDto,
  MonitorDto, MemoryDto, SavedArtifactDto, ContinuitySnapshotDto, ResearchResponseDto,
} from "../api/types.js";
import type {
  EvidenceItem, JudgmentView, ResearchSummary, ThesisView, ThesisAssessmentView,
  MonitorView, MemoryItem, SavedArtifactView, ChallengeView, WorkspaceListItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Evidence / judgment
// ---------------------------------------------------------------------------

export function evidenceFromDto(e: EvidenceDto): EvidenceItem {
  return {
    ref: e.ref,
    observation: e.observation,
    evidenceType: e.evidenceType,
    evidenceClass: e.evidenceClass, // verbatim: RAW_DATA…SPECULATION
    ...(e.proxyBasis !== undefined ? { proxyBasis: e.proxyBasis } : {}),
    freshness: e.freshness,
    observedAt: e.observedAt,
    ...(e.eventTimestamp !== undefined ? { eventTimestamp: e.eventTimestamp } : {}),
    ...(e.toolResultRef !== undefined ? { toolResultRef: e.toolResultRef } : {}),
    sourceRefs: [...e.sourceRefs],
    supports: [...e.supports],
    contradicts: [...e.contradicts],
  };
}

export function judgmentFromDto(j: JudgmentDto): JudgmentView {
  return {
    ref: j.ref,
    statement: j.statement,
    confidence: j.confidence ?? "UNKNOWN",
    uncertainty: [...j.uncertainty],
    implications: [...j.implications],
    supportingEvidence: [...j.supportingEvidence],
    opposingEvidence: [...j.opposingEvidence],
  };
}

// ---------------------------------------------------------------------------
// Research list / summaries
// ---------------------------------------------------------------------------

export function researchSummaryFromDto(r: ResearchDto): ResearchSummary {
  return {
    ref: r.ref,
    title: r.question.length > 0 ? r.question : r.objective,
    question: r.question,
    flow: r.flow,
    status: r.status === "ACTIVE" ? "ACTIVE" : "COMPLETED",
    confidence: "UNKNOWN", // per-research confidence lives on its judgment; not fabricated here
    updatedAt: r.history.length > 0 ? r.history[r.history.length - 1]! : new Date().toISOString(),
    evidenceCount: r.evidenceRefs.length,
    sourceCount: 0, // source counts are not part of the research DTO; rendered as
    ...(r.isCurrent !== undefined ? { isCurrent: r.isCurrent } : {}),
  };
}

// ---------------------------------------------------------------------------
// Thesis
// ---------------------------------------------------------------------------

export function assessmentFromDto(a: ThesisAssessmentDto): ThesisAssessmentView {
  return {
    assessment: a.assessment,
    rationale: a.rationale,
    confidence: a.confidence ?? "UNKNOWN",
    researchQuality: a.researchQuality ?? "UNAVAILABLE",
    at: a.createdAt,
    whatWouldChange: [...a.whatWouldChange],
    unresolved: [...a.unresolved],
  };
}

export function thesisFromDto(t: ThesisDto, assessments: readonly ThesisAssessmentDto[]): ThesisView {
  const latest = assessments.length > 0 ? assessments[assessments.length - 1]! : undefined;
  return {
    ref: t.ref,
    statement: t.statement,
    objective: t.objective,
    version: t.version,
    status: t.status,
    claims: t.claims.map((c) => ({
      statement: c.statement,
      importance: c.importance === "CORE" || c.importance === "SUPPORTING" ? c.importance : "SUPPORTING",
      invalidationConditions: [], // claim-level invalidation conditions are not in the thesis DTO
    })),
    assumptions: t.assumptions.map((a) => ({ statement: a.statement, invalidationConditions: [] })),
    invalidationConditions: [...t.invalidationConditions],
    assessments: assessments.map(assessmentFromDto),
    confidence: latest?.confidence ?? t.confidence ?? "UNKNOWN",
    researchQuality: latest?.researchQuality ?? "UNAVAILABLE",
    supportingRefs: latest ? [...latest.supportingEvidence] : [],
    contradictingRefs: latest ? [...latest.contradictingEvidence] : [],
    updatedAt: t.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------

export function monitorFromDto(m: MonitorDto): MonitorView {
  return {
    ref: m.ref,
    target: m.target,
    status: m.status,
    conditions: m.conditions.map((c) => ({
      description: c.description,
      kind: c.kind,
      triggerType: c.triggerType,
    })),
    sourceStates: m.sourceStates.map((s) => ({ ref: s.ref, state: s.state, note: s.note })),
    lastReviewed: undefined,
    triggerRationale: m.triggerRationale,
  };
}

// ---------------------------------------------------------------------------
// Memory / artifacts
// ---------------------------------------------------------------------------

export function memoryFromDto(m: MemoryDto): MemoryItem {
  return {
    ref: m.ref,
    category: m.category,
    content: m.content,
    status: m.status,
    ...(m.statusReason !== undefined ? { statusReason: m.statusReason } : {}),
    ...(m.lastValidatedAt !== undefined ? { lastValidatedAt: m.lastValidatedAt } : {}),
    createdAt: m.createdAt,
  };
}

export function artifactFromDto(a: SavedArtifactDto): SavedArtifactView {
  return {
    ref: a.ref,
    type: a.type,
    content: a.content,
    createdAt: a.createdAt,
    derivedFromRefs: [...a.derivedFromRefs],
  };
}

// ---------------------------------------------------------------------------
// Continuity snapshot → home-page aggregates
// ---------------------------------------------------------------------------

export interface HomeData {
  readonly research: readonly WorkspaceListItem[];
  readonly activeThesis: ThesisView | undefined;
  readonly monitorCounts: { active: number; proposed: number };
  readonly contradictions: readonly string[];
  readonly uncertainties: readonly string[];
  readonly artifacts: readonly SavedArtifactView[];
}

export function homeDataFromSnapshot(s: ContinuitySnapshotDto, allResearch: readonly ResearchDto[]): HomeData {
  const researchItems: WorkspaceListItem[] = allResearch
    .slice()
    .reverse()
    .map((r) => ({
      ref: r.ref,
      title: r.question.length > 0 ? r.question : r.objective,
      kind: "research" as const,
      status: r.isCurrent === true ? "CURRENT" : r.status,
      updatedAt: r.history.length > 0 ? r.history[r.history.length - 1]! : new Date().toISOString(),
      meta: r.flow.replace(/_/g, " ").toLowerCase(),
    }));
  const monitors: WorkspaceListItem[] = [
    ...s.monitorProposals.map((m) => ({ ref: m.ref, title: m.target, kind: "monitor" as const, status: m.status, updatedAt: "", meta: `${m.conditions.length} conditions` })),
    ...s.activeMonitors.map((m) => ({ ref: m.ref, title: m.target, kind: "monitor" as const, status: m.status, updatedAt: "", meta: `${m.conditions.length} conditions` })),
  ];
  return {
    research: [...researchItems, ...monitors],
    activeThesis: s.activeThesis !== undefined ? thesisFromDto(s.activeThesis, []) : undefined,
    monitorCounts: { active: s.activeMonitors.length, proposed: s.monitorProposals.length },
    contradictions: [...s.importantContradictions],
    uncertainties: [...s.unresolvedUncertainties],
    artifacts: s.savedArtifacts.map(artifactFromDto),
  };
}

// ---------------------------------------------------------------------------
// Challenge (Flow 7); derived from real hypotheses/evidence, never a script
// ---------------------------------------------------------------------------

export function challengeFromSnapshot(s: ContinuitySnapshotDto): ChallengeView {
  const hypotheses = [...s.currentHypotheses].sort((a, b) => a.ranking - b.ranking);
  const evidenceById = new Map(s.recentEvidence.map((e) => [e.ref, e]));
  const targets = hypotheses.slice(0, 6).map((h) => {
    const disconfirming = h.contradictingClaims.length > 0 || s.recentEvidence.some((e) => h.evidenceRefs.includes(e.ref) && e.contradicts.length > 0);
    const supporting = h.supportingClaims.length > 0 || s.recentEvidence.some((e) => h.evidenceRefs.includes(e.ref) && e.supports.length > 0);
    const found: ChallengeView["falsificationTargets"][number]["found"] =
      disconfirming ? "DISCONFIRMING" : supporting ? "SUPPORTING_ONLY" : "NONE_FOUND";
    const evidenceRefs = h.evidenceRefs.filter((r) => evidenceById.has(r));
    return {
      target: h.statement,
      ...(h.ref !== undefined ? { ref: h.ref } : {}),
      origin: "DERIVED_FROM_BELIEF" as const,
      searched: `hypothesis ${h.ref} · ${h.evidenceRefs.length} evidence objects examined`,
      found,
      evidenceRefs,
    };
  });
  const latest = s.latestThesisAssessment;
  return {
    belief: s.activeThesis?.statement ?? "No active thesis; select or create one in the thesis workspace.",
    beliefOwner: s.activeThesis !== undefined ? `${s.activeThesis.ref} v${s.activeThesis.version}` : "",
    falsificationTargets: targets,
    warnings: [...s.importantContradictions, ...s.unresolvedUncertainties].map((c) => `Engine-recorded: ${c}`),
    assessment: latest?.assessment,
    whatWouldChange: latest ? [...latest.whatWouldChange] : [],
  };
}

// ---------------------------------------------------------------------------
// Research response → workspace thread objects
// ---------------------------------------------------------------------------

export interface ThreadTurn {
  readonly question: string;
  readonly response: ResearchResponseDto;
}

export function answerHeadline(r: ResearchResponseDto): string {
  if (r.outcome === "REJECTED") return "Request rejected";
  if (r.outcome === "MODEL_FAILURE") return "Interpretation layer unavailable";
  if (r.outcome === "AWAITING_CONFIRMATION") return "Confirmation required";
  return r.action.charAt(0) + r.action.slice(1).toLowerCase();
}
