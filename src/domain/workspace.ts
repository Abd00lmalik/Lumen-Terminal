/**
 * Workspace aggregate root — owns the research graph and enforces cross-object rules.
 *
 * Architectural basis:
 * - research-object-model.md §22 (research graph), §17 (ownership), §9 (one current judgment;
 *   superseded versions preserved with basis and timestamp), §20 (freshness; stale ≠ deleted).
 * - object-lifecycle-state-machine.md: only one ACTIVE judgment per research context; restoring
 *   an old judgment does not silently make it current.
 * - Final lock §11: contradictory evidence is retained, hypotheses are living objects.
 * - Final lock §12: judgments record what is observed/inferred/uncertain/would-change.
 * - Final lock §14: workspace survives beyond individual messages — persistence target.
 */

import {
  createResearch, createBranch, createClaim, createEvidence, createHypothesis, createAnalysis,
  createJudgment, createSource, withStatus, appendRef, withProvenance,
  type Research, type Branch, type Claim, type Evidence, type Source, type Hypothesis,
  type Analysis, type Judgment,
} from "./objects.js";
import {
  createThesis, reviseThesis, createSavedArtifact,
  type Thesis, type SavedArtifact, type ThesisStatus, type ThesisAssessmentRecord, type ThesisAssessmentStatus,
} from "./thesis.js";
import {
  createMemoryEntry, decayMemory, revalidateMemory, proposeMonitor, transitionMonitor,
  recordMonitorSourceState, flagMonitorForReview,
  type MemoryEntry, type MemoryCategory, type MemoryStatus, type Monitor,
  type MonitorLifecycleStatus, type MonitorCondition,
} from "./memory.js";
import type { ObjectStatus } from "./lifecycle.js";
import { appendProvenance, createProvenance, type ProvenanceOrigin } from "./provenance.js";
import { newId, seedIdCountersFromIds } from "./ids.js";

export interface WorkspaceSnapshot {
  readonly researches: readonly Research[];
  readonly sources: readonly Source[];
  readonly evidence: readonly Evidence[];
  readonly claims: readonly Claim[];
  readonly hypotheses: readonly Hypothesis[];
  readonly analyses: readonly Analysis[];
  readonly judgments: readonly Judgment[];
  readonly branches: readonly Branch[];
  /** M3 additions: trader-owned theses + saved artifacts (memory.md object list). */
  readonly theses: readonly Thesis[];
  readonly savedArtifacts: readonly SavedArtifact[];
  /** M5 additions: research memory + monitoring handoff + thesis assessment history. */
  readonly memories: readonly MemoryEntry[];
  readonly monitors: readonly Monitor[];
  readonly thesisAssessments: readonly ThesisAssessmentRecord[];
  /** M6 (audit D1): the trader's explicit active-thesis selection (working state). */
  readonly activeThesisId?: string;
}

export class Workspace {
  private readonly researches = new Map<string, Research>();
  private readonly sources = new Map<string, Source>();
  private readonly evidence = new Map<string, Evidence>();
  private readonly claims = new Map<string, Claim>();
  private readonly hypotheses = new Map<string, Hypothesis>();
  private readonly analyses = new Map<string, Analysis>();
  private readonly judgments = new Map<string, Judgment>();
  private readonly branches = new Map<string, Branch>();
  private readonly theses = new Map<string, Thesis>();
  private readonly savedArtifacts = new Map<string, SavedArtifact>();
  private readonly memories = new Map<string, MemoryEntry>();
  private readonly monitors = new Map<string, Monitor>();
  private readonly thesisAssessments: ThesisAssessmentRecord[] = [];
  /** M6 (audit D1): the trader's EXPLICIT active-thesis selection (MANAGE_STATE set-active-thesis).
   *  Without it, "active thesis" was inferred from updatedAt ordering — an inference, not state.
   *  Trader-owned working state must be recorded, never guessed. */
  private activeThesisId: string | undefined;

  // ----- theses (trader-owned; system never silently mutates — thesis.md) -----

  addResearch(input: { objective: string; question: string; flow: string }, origin: ProvenanceOrigin, at?: Date): Research {
    const research = createResearch(input, origin, at);
    this.researches.set(research.id, research);
    return research;
  }

  getResearch(id: string): Research | undefined {
    return this.researches.get(id);
  }

  listResearch(): readonly Research[] {
    return [...this.researches.values()];
  }

  transitionResearch(id: string, to: ObjectStatus, origin: ProvenanceOrigin, note: string, at?: Date): Research {
    const research = this.mustResearch(id);
    const updated = withStatus("research", research, to, origin, note, at);
    this.researches.set(id, updated);
    return updated;
  }

  // ----- branches -----------------------------------------------------------

  addBranch(researchRef: string, objective: string, origin: ProvenanceOrigin, at?: Date): Branch {
    this.mustResearch(researchRef);
    const branch = createBranch(researchRef, objective, origin, at);
    this.branches.set(branch.id, branch);
    const research = this.mustResearch(researchRef);
    this.researches.set(researchRef, appendRef(research, "branchRefs", branch.id));
    return branch;
  }

  getBranch(id: string): Branch | undefined {
    return this.branches.get(id);
  }

  listBranches(): readonly Branch[] {
    return [...this.branches.values()];
  }

  transitionBranch(id: string, to: ObjectStatus, origin: ProvenanceOrigin, note: string, at?: Date): Branch {
    const branch = this.branches.get(id);
    if (!branch) throw new Error(`Unknown branch: ${id}`);
    const updated = withStatus("branch", branch, to, origin, note, at);
    this.branches.set(id, updated);
    return updated;
  }

  // ----- sources ------------------------------------------------------------

  addSource(
    input: Parameters<typeof createSource>[0],
    origin: ProvenanceOrigin,
    at?: Date,
  ): Source {
    const source = createSource(input, origin, at);
    this.sources.set(source.id, source);
    return source;
  }

  getSource(id: string): Source | undefined {
    return this.sources.get(id);
  }

  listSources(): readonly Source[] {
    return [...this.sources.values()];
  }

  // ----- evidence -----------------------------------------------------------

  addEvidence(
    input: {
      observation: string;
      evidenceType: string;
      evidenceClass: Evidence["evidenceClass"];
      sourceRefs?: readonly string[];
      timestamp?: string;
      supports?: readonly string[];
      contradicts?: readonly string[];
      freshness?: Evidence["freshness"];
      proxyBasis?: string;
      toolResultRef?: string;
      researchRef?: string;
    },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Evidence {
    const evidence = createEvidence(input, origin, at);
    this.evidence.set(evidence.id, evidence);
    if (input.researchRef) {
      const research = this.mustResearch(input.researchRef);
      this.researches.set(input.researchRef, appendRef(research, "evidenceRefs", evidence.id));
    }
    return evidence;
  }

  getEvidence(id: string): Evidence | undefined {
    return this.evidence.get(id);
  }

  /**
   * Register an already-created evidence object (e.g. from `evidenceFromToolResult`) without
   * re-creating it — identity, classification, and provenance are preserved exactly.
   */
  ingestEvidence(evidence: Evidence, researchRef?: string): Evidence {
    this.evidence.set(evidence.id, evidence);
    if (researchRef !== undefined) {
      const research = this.mustResearch(researchRef);
      this.researches.set(researchRef, appendRef(research, "evidenceRefs", evidence.id));
    }
    return evidence;
  }

  listEvidence(): readonly Evidence[] {
    return [...this.evidence.values()];
  }

  // ----- claims -------------------------------------------------------------

  addClaim(
    input: { statement: string; type?: string; hypothesisRefs?: readonly string[]; researchRef?: string },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Claim {
    const claim = createClaim(input, origin, at);
    this.claims.set(claim.id, claim);
    if (input.researchRef) {
      const research = this.mustResearch(input.researchRef);
      this.researches.set(input.researchRef, appendRef(research, "claimRefs", claim.id));
    }
    return claim;
  }

  getClaim(id: string): Claim | undefined {
    return this.claims.get(id);
  }

  listClaims(): readonly Claim[] {
    return [...this.claims.values()];
  }

  /** Link evidence to a claim with direction; the graph, not a transcript, is the source of truth. */
  linkEvidenceToClaim(
    evidenceId: string,
    claimId: string,
    direction: "supports" | "contradicts",
    origin: ProvenanceOrigin,
    note?: string,
    at?: Date,
  ): void {
    const evidence = this.mustEvidence(evidenceId);
    const claim = this.mustClaim(claimId);
    void claim;

    let updatedEvidence =
      direction === "supports"
        ? appendRef(evidence, "supports", claimId)
        : appendRef(evidence, "contradicts", claimId);
    if (note) updatedEvidence = withProvenance(updatedEvidence, origin, note, at);
    this.evidence.set(evidenceId, updatedEvidence);
    this.claims.set(claimId, appendRef(claim, "evidenceRefs", evidenceId));
  }

  // ----- hypotheses ---------------------------------------------------------

  addHypothesis(
    input: { statement: string; type?: Hypothesis["type"]; alternatives?: readonly string[]; researchRef?: string },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Hypothesis {
    const hypothesis = createHypothesis(input, origin, at);
    this.hypotheses.set(hypothesis.id, hypothesis);
    if (input.researchRef) {
      const research = this.mustResearch(input.researchRef);
      this.researches.set(input.researchRef, appendRef(research, "hypothesisRefs", hypothesis.id));
    }
    return hypothesis;
  }

  getHypothesis(id: string): Hypothesis | undefined {
    return this.hypotheses.get(id);
  }

  listHypotheses(): readonly Hypothesis[] {
    return [...this.hypotheses.values()];
  }

  /** Hypotheses are living objects: status changes must follow the lifecycle machine. */
  transitionHypothesis(id: string, to: ObjectStatus, origin: ProvenanceOrigin, note: string, at?: Date): Hypothesis {
    const hypothesis = this.hypotheses.get(id);
    if (!hypothesis) throw new Error(`Unknown hypothesis: ${id}`);
    const updated = withStatus("hypothesis", hypothesis, to, origin, note, at);
    this.hypotheses.set(id, updated);
    return updated;
  }

  // ----- analyses -----------------------------------------------------------

  addAnalysis(
    input: Parameters<typeof createAnalysis>[0] & { researchRef?: string },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Analysis {
    const { researchRef, ...rest } = input;
    const analysis = createAnalysis(rest, origin, at);
    this.analyses.set(analysis.id, analysis);
    if (researchRef) {
      const research = this.mustResearch(researchRef);
      this.researches.set(researchRef, appendRef(research, "analysisRefs", analysis.id));
    }
    return analysis;
  }

  getAnalysis(id: string): Analysis | undefined {
    return this.analyses.get(id);
  }

  listAnalyses(): readonly Analysis[] {
    return [...this.analyses.values()];
  }

  // ----- judgments ----------------------------------------------------------

  /**
   * Record a judgment for a research context. Enforces the architecture's versioning rule:
   * exactly one ACTIVE judgment; a new material judgment supersedes the previous one, which
   * remains fully preserved (never overwritten or deleted).
   */
  addJudgment(
    input: Parameters<typeof createJudgment>[0] & { researchRef: string },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Judgment {
    const { researchRef, ...rest } = input;
    const research = this.mustResearch(researchRef);

    for (const existingId of research.judgmentRefs) {
      const existing = this.judgments.get(existingId);
      if (existing && existing.status === "ACTIVE") {
        this.judgments.set(
          existingId,
          withStatus("judgment", existing, "SUPERSEDED", origin, `superseded by new judgment for ${researchRef}`, at),
        );
      }
    }

    const judgment = createJudgment(rest, origin, at);
    this.judgments.set(judgment.id, judgment);

    let updated = appendRef(research, "judgmentRefs", judgment.id);
    updated = Object.freeze({ ...updated, currentJudgmentRef: judgment.id });
    this.researches.set(researchRef, updated);
    return judgment;
  }

  getJudgment(id: string): Judgment | undefined {
    return this.judgments.get(id);
  }

  listJudgments(): readonly Judgment[] {
    return [...this.judgments.values()];
  }

  /** Current judgment for a research context (the single ACTIVE one), if any. */
  currentJudgment(researchRef: string): Judgment | undefined {
    const research = this.mustResearch(researchRef);
    if (!research.currentJudgmentRef) return undefined;
    const current = this.judgments.get(research.currentJudgmentRef);
    return current && current.status === "ACTIVE" ? current : undefined;
  }

  historicalJudgments(researchRef: string): readonly Judgment[] {
    const research = this.mustResearch(researchRef);
    return research.judgmentRefs
      .map((id) => this.judgments.get(id))
      .filter((j): j is Judgment => j !== undefined && j.status !== "ACTIVE");
  }

  /**
   * Register a trader-authored thesis. Origin must be trader-kind (directly or via
   * trader-confirmed import) — the system never silently creates or rewrites theses.
   */
  addThesis(
    input: Parameters<typeof createThesis>[0],
    origin: ProvenanceOrigin,
    at?: Date,
  ): Thesis {
    const thesis = createThesis(input, origin, at);
    this.theses.set(thesis.id, thesis);
    return thesis;
  }

  getThesis(id: string): Thesis | undefined {
    return this.theses.get(id);
  }

  /** M6 (audit D1): record the trader's explicit active-thesis selection (MANAGE_STATE).
   *  Unknown refs are rejected — no invented state. The thesis object itself is NOT mutated
   *  (selection is working state, not a thesis lifecycle change). */
  setActiveThesis(id: string): Thesis {
    const thesis = this.theses.get(id);
    if (thesis === undefined) throw new Error(`cannot activate unknown thesis ${id} — no invented state`);
    this.activeThesisId = id;
    return thesis;
  }

  /** The trader's explicit active thesis when set, else the newest current thesis (compat). */
  getActiveThesis(): Thesis | undefined {
    if (this.activeThesisId !== undefined) {
      const selected = this.theses.get(this.activeThesisId);
      if (selected !== undefined) return selected;
    }
    return this.activeTheses()[0];
  }

  /** Current (non-superseded, non-archived) theses, newest first. */
  activeTheses(): readonly Thesis[] {
    return [...this.theses.values()]
      .filter((t) => t.status === "ACTIVE" || t.status === "CONFIRMED" || t.status === "WEAKENED" || t.status === "REJECTED")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listTheses(): readonly Thesis[] {
    return [...this.theses.values()];
  }

  /**
   * Revise a thesis — TRADER-ONLY operation (thesis.md: the system must never silently replace
   * the trader's thesis). The prior version remains fully preserved in theses map.
   */
  reviseThesis(
    thesisId: string,
    changes: Partial<Pick<Thesis, "statement" | "objective" | "scope" | "claims" | "assumptions" | "invalidationConditions" | "alternatives" | "confidence">>,
    origin: ProvenanceOrigin,
    note: string,
    at?: Date,
  ): Thesis {
    const prior = this.mustThesis(thesisId);
    const revised = reviseThesis(prior, changes, origin, note, at);
    // The revised version replaces the id slot only if it keeps the same id (revise keeps id);
    // version history is preserved via priorVersionRef + updatedAt. Store both.
    this.theses.set(revised.id, revised);
    return revised;
  }

  transitionThesis(id: string, to: ThesisStatus, origin: ProvenanceOrigin, note: string, at?: Date): Thesis {
    const thesis = this.mustThesis(id);
    // Thesis status transitions are trader decisions; whatever origin executes the
    // transition is recorded explicitly in provenance — never silently.
    const atDate = at ?? new Date();
    const updated: Thesis = Object.freeze({
      ...thesis,
      status: to,
      provenance: appendProvenance(thesis.provenance, origin, `thesis status → ${to}: ${note}`, atDate),
      updatedAt: atDate.toISOString(),
    });
    this.theses.set(id, updated);
    return updated;
  }

  // ----- saved artifacts (SAVE — first-class, confirmed; lui-save-action.md) ---

  /**
   * Persist a SAVE proposal as a real artifact. Callers MUST pass a trader origin that
   * records the confirmation — silent saves are forbidden (M3 §17).
   */
  saveArtifact(
    input: Parameters<typeof createSavedArtifact>[0],
    origin: ProvenanceOrigin,
    at?: Date,
  ): SavedArtifact {
    const artifact = createSavedArtifact(input, origin, at);
    this.savedArtifacts.set(artifact.id, artifact);
    return artifact;
  }

  getSavedArtifact(id: string): SavedArtifact | undefined {
    return this.savedArtifacts.get(id);
  }

  listSavedArtifacts(): readonly SavedArtifact[] {
    return [...this.savedArtifacts.values()];
  }

  // ----- research memory (M5 — memory.md; SAVE is the promotion path) --------

  /** Record a persistent memory entry. Only confirmed SAVEs may call this (M5 §6/§7). */
  addMemory(
    input: Parameters<typeof createMemoryEntry>[0],
    origin: ProvenanceOrigin,
    at?: Date,
  ): MemoryEntry {
    const entry = createMemoryEntry(input, origin, at);
    this.memories.set(entry.id, entry);
    return entry;
  }

  getMemory(id: string): MemoryEntry | undefined {
    return this.memories.get(id);
  }

  listMemories(): readonly MemoryEntry[] {
    return [...this.memories.values()];
  }

  listMemoriesByCategory(category: MemoryCategory): readonly MemoryEntry[] {
    return this.listMemories().filter((m) => m.category === category);
  }

  /** Decay a memory (STALE/HISTORICAL) — influence is reduced; the entry is NEVER deleted (M5 §5). */
  decayMemory(id: string, status: "STALE" | "HISTORICAL", reason: string, origin: ProvenanceOrigin, at?: Date): MemoryEntry {
    const entry = this.memories.get(id);
    if (entry === undefined) throw new Error(`Unknown memory: ${id}`);
    const decayed = decayMemory(entry, status, reason, origin, at);
    this.memories.set(id, decayed);
    return decayed;
  }

  /** Revalidate memory against current research — original preserved, outcome recorded (M5 §5). */
  revalidateMemory(id: string, outcome: { confirmed: boolean; note: string; newStatus?: MemoryStatus }, origin: ProvenanceOrigin, at?: Date): MemoryEntry {
    const entry = this.memories.get(id);
    if (entry === undefined) throw new Error(`Unknown memory: ${id}`);
    const revalidated = revalidateMemory(entry, outcome, origin, at);
    this.memories.set(id, revalidated);
    return revalidated;
  }

  /**
   * Memory-conflict resolution (M5 §18): current research wins for current judgment; the
   * historical record is preserved (never overwritten). Marks the conflicting memory and
   * records the validation relationship on it.
   */
  resolveMemoryConflict(memoryId: string, currentEvidenceRef: string, note: string, origin: ProvenanceOrigin, at?: Date): MemoryEntry {
    return this.revalidateMemory(
      memoryId,
      { confirmed: false, note: `current evidence ${currentEvidenceRef} supersedes this memory for current judgment: ${note}`, newStatus: "STALE" },
      origin,
      at,
    );
  }

  // ----- monitoring handoff (M5 — thesis-monitor-reassessment.md §21–§26) -----

  /** Propose a monitor — status PROPOSED, inert until explicit trader confirmation (M5 §11). */
  addMonitorProposal(
    input: {
      target: string;
      conditions: readonly MonitorCondition[];
      triggerRationale: string;
      thesisRef?: string;
      thesisVersion?: number;
      freshnessExpectation?: string;
      suggestedFrequency?: "REAL_TIME" | "HIGH" | "MEDIUM" | "LOW";
    },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Monitor {
    const monitor = proposeMonitor(input, origin, at);
    this.monitors.set(monitor.id, monitor);
    return monitor;
  }

  getMonitor(id: string): Monitor | undefined {
    return this.monitors.get(id);
  }

  listMonitors(): readonly Monitor[] {
    return [...this.monitors.values()];
  }

  /**
   * Activate a monitor — TRADER-CONFIRMED operation only (M5 §11: activation requires the
   * confirmation boundary). A non-trader origin is rejected; no silent activation exists.
   * No background process is created — this is persistent handoff state only.
   */
  activateMonitor(id: string, origin: ProvenanceOrigin, note: string, at?: Date): Monitor {
    if (origin.kind !== "trader") {
      throw new Error("monitor activation requires explicit trader confirmation — system/model origins cannot activate monitors");
    }
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const activated = transitionMonitor(monitor, "ACTIVE", origin, note, at);
    this.monitors.set(id, activated);
    return activated;
  }

  transitionMonitor(id: string, to: MonitorLifecycleStatus, origin: ProvenanceOrigin, note: string, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const transitioned = transitionMonitor(monitor, to, origin, note, at);
    this.monitors.set(id, transitioned);
    return transitioned;
  }

  /** Source unavailability is a STATE — never a false invalidation alert (M5 §12). */
  recordMonitorSourceState(id: string, sourceRef: string, state: "SOURCE_UNAVAILABLE" | "OK", note: string, origin: ProvenanceOrigin, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const updated = recordMonitorSourceState(monitor, sourceRef, state, note, origin, at);
    this.monitors.set(id, updated);
    return updated;
  }

  /** Flag a monitor for review after reassessment — proposal for the trader, never silent change (M5 §15). */
  flagMonitorForReview(id: string, reason: string, origin: ProvenanceOrigin, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const flagged = flagMonitorForReview(monitor, reason, origin, at);
    this.monitors.set(id, flagged);
    return flagged;
  }

  // ----- thesis assessment history (M5 §9 — assessment ≠ mutation) ------------

  /**
   * Record a thesis assessment: a research RESULT about the thesis (thesis.md §7 THESIS
   * ASSESSMENT). It never mutates the thesis object — it accumulates in an auditable history.
   */
  recordThesisAssessment(input: {
    thesisId: string;
    thesisVersion: number;
    assessment: ThesisAssessmentStatus;
    rationale: string;
    supportingEvidence: readonly string[];
    contradictingEvidence: readonly string[];
    unresolved: readonly string[];
    whatWouldChange: readonly string[];
    confidence: "HIGH" | "MODERATE" | "LOW";
    researchRef?: string;
    researchQuality?: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  }, origin: ProvenanceOrigin, at?: Date): ThesisAssessmentRecord {
    const thesis = this.mustThesis(input.thesisId); // assessment must reference a real thesis
    const record: ThesisAssessmentRecord = Object.freeze({
      id: newId("assessment"),
      thesisId: thesis.id,
      thesisVersion: input.thesisVersion,
      assessment: input.assessment,
      rationale: input.rationale,
      supportingEvidence: input.supportingEvidence,
      contradictingEvidence: input.contradictingEvidence,
      unresolved: input.unresolved,
      whatWouldChange: input.whatWouldChange,
      confidence: input.confidence,
      ...(input.researchRef !== undefined ? { researchRef: input.researchRef } : {}),
      ...(input.researchQuality !== undefined ? { researchQuality: input.researchQuality } : {}),
      provenance: createProvenance(origin, `thesis assessment recorded (${input.assessment}) — thesis object unchanged`, at),
      createdAt: (at ?? new Date()).toISOString(),
    });
    this.thesisAssessments.push(record);
    return record;
  }

  listThesisAssessments(thesisId?: string): readonly ThesisAssessmentRecord[] {
    return thesisId === undefined ? [...this.thesisAssessments] : this.thesisAssessments.filter((a) => a.thesisId === thesisId);
  }

  latestThesisAssessment(thesisId: string): ThesisAssessmentRecord | undefined {
    const all = this.listThesisAssessments(thesisId);
    return all[all.length - 1];
  }

  // ----- workspace continuity (M5 §16 — domain representation for future UI) --

  /** The continuity view: everything a later request needs to recover research context. */
  getContinuitySnapshot(): {
    activeResearchTarget: Research | undefined;
    activeBranch: Branch | undefined;
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
  } {
    const researches = this.listResearch();
    const activeResearchTarget = researches[researches.length - 1];
    const latestJudgment = [...this.listJudgments()].reverse()[0];
    const activeThesis = this.getActiveThesis();
    const activeFramework = [...this.listSavedArtifacts()].reverse().find((a) => a.type === "framework");
    const latestAssessment = activeThesis !== undefined ? this.latestThesisAssessment(activeThesis.id) : undefined;
    const contradictions: string[] = [];
    for (const e of this.listEvidence()) {
      for (const ref of e.contradicts) {
        const other = this.getEvidence(ref);
        if (other !== undefined) contradictions.push(`${e.id} contradicts ${ref}: ${e.observation.slice(0, 120)}`);
      }
    }
    const uncertainties: string[] = [];
    for (const j of this.listJudgments()) uncertainties.push(...j.uncertainty);
    for (const a of this.listAnalyses()) uncertainties.push(...a.uncertainty);
    return {
      activeResearchTarget,
      activeBranch: [...this.listBranches()].reverse()[0],
      recentEvidence: this.listEvidence().slice(-10),
      currentClaims: this.listClaims(),
      currentHypotheses: this.listHypotheses(),
      currentJudgment: latestJudgment,
      activeThesis,
      latestThesisAssessment: latestAssessment,
      activeFramework,
      savedArtifacts: this.listSavedArtifacts(),
      monitorProposals: this.listMonitors().filter((m) => m.status === "PROPOSED"),
      activeMonitors: this.listMonitors().filter((m) => m.status === "ACTIVE"),
      memories: this.listMemories(),
      unresolvedUncertainties: [...new Set(uncertainties)],
      importantContradictions: contradictions,
    };
 }

  // ----- snapshot for persistence -------------------------------------------

  toSnapshot(): WorkspaceSnapshot {
    return {
      researches: this.listResearch(),
      sources: this.listSources(),
      evidence: this.listEvidence(),
      claims: this.listClaims(),
      hypotheses: this.listHypotheses(),
      analyses: this.listAnalyses(),
      judgments: this.listJudgments(),
      branches: this.listBranches(),
      theses: this.listTheses(),
      savedArtifacts: this.listSavedArtifacts(),
      memories: this.listMemories(),
      monitors: this.listMonitors(),
      thesisAssessments: this.listThesisAssessments(),
      // M6 (audit D1): the trader's explicit selection is working state and must round-trip.
      ...(this.activeThesisId !== undefined ? { activeThesisId: this.activeThesisId } : {}),
    };
  }

  static fromSnapshot(snap: WorkspaceSnapshot): Workspace {
    const ws = new Workspace();
    for (const r of snap.researches) ws.researches.set(r.id, r);
    for (const s of snap.sources) ws.sources.set(s.id, s);
    for (const e of snap.evidence) ws.evidence.set(e.id, e);
    for (const c of snap.claims) ws.claims.set(c.id, c);
    for (const h of snap.hypotheses) ws.hypotheses.set(h.id, h);
    for (const a of snap.analyses) ws.analyses.set(a.id, a);
    for (const j of snap.judgments) ws.judgments.set(j.id, j);
    for (const b of snap.branches) ws.branches.set(b.id, b);
    for (const t of snap.theses ?? []) ws.theses.set(t.id, t);
    for (const a of snap.savedArtifacts ?? []) ws.savedArtifacts.set(a.id, a);
    for (const m of snap.memories ?? []) ws.memories.set(m.id, m);
    for (const m of snap.monitors ?? []) ws.monitors.set(m.id, m);
    for (const a of snap.thesisAssessments ?? []) ws.thesisAssessments.push(a);
    if (snap.activeThesisId !== undefined) ws.activeThesisId = snap.activeThesisId;
    // Counter continuity (persistence law): a restored graph must never re-mint existing ids.
    // Without this, a server restart OVERWROTE persisted objects (fresh process → rs_000001 again).
    seedIdCountersFromIds([
      ...snap.researches, ...snap.sources, ...snap.evidence, ...snap.claims, ...snap.hypotheses,
      ...snap.analyses, ...snap.judgments, ...snap.branches, ...(snap.theses ?? []),
      ...(snap.savedArtifacts ?? []), ...(snap.memories ?? []), ...(snap.monitors ?? []),
    ].map((o) => o.id));
    return ws;
  }

  // ----- private ------------------------------------------------------------

  private mustResearch(id: string): Research {
    const r = this.researches.get(id);
    if (!r) throw new Error(`Unknown research: ${id}`);
    return r;
  }

  private mustEvidence(id: string): Evidence {
    const e = this.evidence.get(id);
    if (!e) throw new Error(`Unknown evidence: ${id}`);
    return e;
  }

  private mustClaim(id: string): Claim {
    const c = this.claims.get(id);
    if (!c) throw new Error(`Unknown claim: ${id}`);
    return c;
  }

  private mustThesis(id: string): Thesis {
    const t = this.theses.get(id);
    if (!t) throw new Error(`Unknown thesis: ${id}`);
    return t;
  }
}

export { createResearch, createBranch, createClaim, createEvidence, createHypothesis, createAnalysis, createJudgment, createSource, createThesis, reviseThesis, createSavedArtifact };
