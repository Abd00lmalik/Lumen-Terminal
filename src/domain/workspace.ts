/**
 * Workspace aggregate root; owns the research graph and enforces cross-object rules.
 *
 * Architectural basis:
 * - research-object-model.md §22 (research graph), §17 (ownership), §9 (one current judgment;
 *   superseded versions preserved with basis and timestamp), §20 (freshness; stale ≠ deleted).
 * - object-lifecycle-state-machine.md: only one ACTIVE judgment per research context; restoring
 *   an old judgment does not silently make it current.
 * - Final lock §11: contradictory evidence is retained, hypotheses are living objects.
 * - Final lock §12: judgments record what is observed/inferred/uncertain/would-change.
 * - Final lock §14: workspace survives beyond individual messages; persistence target.
 */

import {
  createResearch, createBranch, createClaim, createEvidence, createHypothesis, createAnalysis,
  createJudgment, createSource, withStatus, appendRef, withProvenance,
  type Research, type Branch, type Claim, type Evidence, type Source, type Hypothesis,
  type Analysis, type Judgment,
} from "./objects.js";
import {
  createThesis, reviseThesis, createSavedArtifact, normalizeSavedArtifact, normalizeThesis, savedArtifactIdentity, isSavedKind, thesisTransitionAllowed,
  type Thesis, type SavedArtifact, type SavedKind, type ThesisStatus, type ThesisAssessmentRecord, type ThesisAssessmentStatus,
} from "./thesis.js";
import {
  createChallenge, normalizeChallenge,
  type Challenge,
} from "./challenge.js";
import {
  applyExecutionPatch,
  type MonitoringAssessment, type MonitorNotification, type MonitorExecutionPatch,
} from "./monitoring.js";
import {
  createMemoryEntry, decayMemory, revalidateMemory, proposeMonitor, transitionMonitor,
  recordMonitorSourceState, flagMonitorForReview,
  type MemoryEntry, type MemoryCategory, type MemoryStatus, type Monitor,
  type MonitorLifecycleStatus, type MonitorCondition,
} from "./memory.js";
import type { ObjectStatus } from "./lifecycle.js";
import {
  createInvestigation,
  transitionInvestigation,
  withThesis,
  withTurn,
  type ConversationTurn,
  type Investigation,
  type InvestigationStatus,
} from "./investigation.js";
import { appendProvenance, createProvenance, type ProvenanceOrigin } from "./provenance.js";
import { newId, bumpIdCounterPast, bumpIdCounterPastId, idPrefixes, seedIdCountersFromIds } from "./ids.js";
import { currentRun } from "./run-context.js";

/**
 * The current snapshot schema version stamped by toSnapshot (Phase F). Bump on any
 * persisted-shape change; fromSnapshot remains accepting (versions are for observability
 * and guarded migration, not for reader rejection).
 */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Persisted run presentation records (researchResponses entries).
 *
 * RETENTION POLICY (Phase B): history must preserve the research record itself, so there is
 * NO FIFO eviction here — evicting the oldest responses silently degraded older runs to bare
 * summaries (the 100-run cap this replaces). Bounded growth is enforced by SHAPE, not by
 * dropping records: the application layer stores one SLIM record per completed run (answer,
 * diagnostics, gaps, resolution — never copies of evidence/judgment objects the graph already
 * holds), so each run contributes a fixed small record exactly once. A workspace with N runs
 * holds N records; nothing is duplicated inside a record.
 */
export interface ResearchResponseRecord {
  readonly researchId: string;
  readonly response: unknown;
}

export interface WorkspaceSnapshot {
  /**
   * PHASE F schema version of this snapshot (undefined = pre-versioning legacy, treated as
   * version 1 on read). Additive and forward-only: fromSnapshot accepts every KNOWN version
   * and the writer stamps the current one; an unknown FUTURE version still loads (readers
   * never reject data they may simply not understand field-wise) but the watchdog reports
   * SCHEMA_UNEXPECTED. Version 2 = Phase F (per-workspace objects, this marker).
   */
  readonly schemaVersion?: number;
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
  /** Phase G: persistent falsification challenges (Flow 7 derived; never thesis mutations). */
  readonly challenges?: readonly Challenge[];
  /** Phase H: monitoring assessments + in-app notifications (execution state). */
  readonly monitoringAssessments?: readonly MonitoringAssessment[];
  readonly monitorNotifications?: readonly MonitorNotification[];
  /** M6 (audit D1): the trader's explicit active-thesis selection (working state). */
  readonly activeThesisId?: string;
  /**
   * Conversational workbench: durable investigations + their conversation turns. Additive and
   * optional — a snapshot without them (every legacy workspace) loads with none, so no
   * investigation is required for research to run.
   */
  readonly investigations?: readonly Investigation[];
  readonly conversationTurns?: readonly ConversationTurn[];
  /** The investigation the trader is currently in (working state; never inferred). */
  readonly currentInvestigationId?: string;
  /**
   * Run presentation records per research id (see WorkspaceSnapshot.researchResponses):
   * one slim record per completed run, retained without eviction so any historical run
   * stays fully reconstructable after a restart.
   */
  readonly researchResponses?: readonly ResearchResponseRecord[];
  /**
   * Phase C unsave tombstones (id -> unsavedAt ISO). SAVED artifacts are DELETED on unsave,
   * and the multi-instance merge is a UNION — so without an explicit deletion record a stale
   * instance's write would resurrect an artifact the trader removed. A tombstone makes the
   * deletion durable across instances and cold starts (unsave always wins the merge).
   */
  readonly savedTombstones?: readonly { readonly id: string; readonly at: string }[];
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
  /** Saved ids the trader explicitly UNSAVED (tombstones; see WorkspaceSnapshot). */
  private readonly savedTombstones = new Map<string, string>();
  private readonly memories = new Map<string, MemoryEntry>();
  private readonly monitors = new Map<string, Monitor>();
  private readonly thesisAssessments: ThesisAssessmentRecord[] = [];
  /** Phase G: falsification challenges keyed by id (see domain/challenge.ts). */
  private readonly challenges = new Map<string, Challenge>();
  /** Phase H: monitoring assessments + notifications keyed by id. */
  private readonly monitoringAssessments = new Map<string, MonitoringAssessment>();
  private readonly notifications = new Map<string, MonitorNotification>();
  /** M6 (audit D1): the trader's EXPLICIT active-thesis selection (MANAGE_STATE set-active-thesis).
   *  Without it, "active thesis" was inferred from updatedAt ordering; an inference, not state.
   *  Trader-owned working state must be recorded, never guessed. */
  private activeThesisId: string | undefined;
  /** Persisted final responses per research id (see WorkspaceSnapshot.researchResponses). */
  private readonly researchResponses = new Map<string, unknown>();
  /**
   * INVESTIGATIONS (conversational workbench). An investigation is a THREAD of research runs,
   * never an owner of them: it references runs, and a run's evidence ownership stays with that
   * run alone.
   */
  private readonly investigations = new Map<string, Investigation>();
  private readonly conversationTurns = new Map<string, ConversationTurn>();
  /** The investigation the trader is currently in (explicit working state, never inferred). */
  private currentInvestigationId: string | undefined;

  // ----- theses (trader-owned; system never silently mutates; thesis.md) -----

  // ----- investigations (conversational workbench) -----

  /**
   * Open a new investigation. The trader's subject is recorded verbatim; the system never
   * invents one, and a question about a subject the trader named starts its own thread rather
   * than joining an existing one (topic-switch law).
   */
  addInvestigation(input: { title: string; subject: string }, origin: ProvenanceOrigin, at?: Date): Investigation {
    const investigation = createInvestigation(input, origin, at);
    this.investigations.set(investigation.id, investigation);
    this.currentInvestigationId = investigation.id;
    return investigation;
  }

  getInvestigation(id: string): Investigation | undefined {
    return this.investigations.get(id);
  }

  listInvestigations(): readonly Investigation[] {
    // Newest first: an investigation list is a workbench, and the live thread leads.
    return [...this.investigations.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** The investigation the trader is CURRENTLY in (explicit working state, never inferred). */
  currentInvestigation(): Investigation | undefined {
    return this.currentInvestigationId === undefined ? undefined : this.investigations.get(this.currentInvestigationId);
  }

  get currentInvestigationIdValue(): string | undefined {
    return this.currentInvestigationId;
  }

  /** Move the trader into a thread (what opening an investigation in the UI does). */
  setCurrentInvestigation(id: string): Investigation {
    const investigation = this.investigations.get(id);
    if (investigation === undefined) throw new Error(`cannot enter unknown investigation ${id}; no invented state`);
    this.currentInvestigationId = id;
    return investigation;
  }

  /**
   * LEAVE every investigation: what "New research" means.
   *
   * Clears only the CURRENT SELECTION. No investigation, turn, run, evidence, judgment or
   * thesis is deleted or mutated — History still lists every thread, and reopening one sets
   * the pointer again through `setCurrentInvestigation`. This is the difference between
   * "start something new" and "throw the work away", and conflating them is what left the
   * composer in follow-up mode over a thread the trader had explicitly walked away from.
   */
  clearCurrentInvestigation(): void {
    this.currentInvestigationId = undefined;
  }

  /**
   * Record a conversation turn and bind it to the run it produced.
   *
   * One turn = at most one run identity. The investigation accumulates the reference; it never
   * takes the run's evidence.
   */
  appendTurn(turn: ConversationTurn, runRef?: string, at?: Date): ConversationTurn {
    const investigation = this.investigations.get(turn.investigationId);
    if (investigation === undefined) {
      throw new Error(`cannot record a turn on unknown investigation ${turn.investigationId}`);
    }
    this.conversationTurns.set(turn.id, turn);
    this.investigations.set(investigation.id, withTurn(investigation, turn.id, runRef, at));
    return turn;
  }

  getTurn(id: string): ConversationTurn | undefined {
    return this.conversationTurns.get(id);
  }

  /** An investigation's conversation, oldest first. */
  listTurns(investigationId: string): readonly ConversationTurn[] {
    return [...this.conversationTurns.values()]
      .filter((t) => t.investigationId === investigationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
  }

  listConversationTurns(): readonly ConversationTurn[] {
    return [...this.conversationTurns.values()];
  }

  /** Every research run the conversation produced, resolved to its Research objects. */
  investigationRuns(investigationId: string): readonly Research[] {
    const investigation = this.investigations.get(investigationId);
    if (investigation === undefined) return [];
    // Ordered by the investigation's own runRefs (submission order), not by map insertion:
    // an absorb can insert objects in arbitrary order, which would scramble the thread.
    const ordered: Research[] = [];
    for (const runRef of investigation.runRefs) {
      const member = [...this.researches.values()].find((r) => r.id === runRef || r.runId === runRef);
      if (member !== undefined && !ordered.includes(member)) ordered.push(member);
    }
    return ordered;
  }

  /** The run a turn produced, if any (a turn that asked a question without research has none). */
  runForTurn(turnId: string): Research | undefined {
    const turn = this.conversationTurns.get(turnId);
    if (turn?.researchRunId === undefined) return undefined;
    return this.researches.get(turn.researchRunId);
  }

  /**
   * THESIS CONTINUITY: attach the trader's OWN thesis to the investigation.
   *
   * Requires a thesis that already EXISTS in the workspace — a thesis is created from an
   * explicit trader statement or an explicit confirmation flow, never inferred from a
   * conversation turn. This method therefore cannot invent a thesis.
   */
  attachInvestigationThesis(investigationId: string, thesisRef: string, at?: Date): Investigation {
    const investigation = this.investigations.get(investigationId);
    if (investigation === undefined) {
      throw new Error(`cannot attach a thesis to unknown investigation ${investigationId}`);
    }
    if (!this.theses.has(thesisRef)) {
      throw new Error(`cannot attach unknown thesis ${thesisRef}; no invented thesis`);
    }
    const next = withThesis(investigation, thesisRef, at);
    this.investigations.set(investigationId, next);
    return next;
  }

  transitionInvestigation(id: string, to: InvestigationStatus, origin: ProvenanceOrigin, note: string, at?: Date): Investigation {
    const investigation = this.investigations.get(id);
    if (investigation === undefined) throw new Error(`unknown investigation ${id}`);
    const next = transitionInvestigation(investigation, to, origin, note, at);
    this.investigations.set(id, next);
    return next;
  }

  addResearch(input: { objective: string; question: string; flow: string }, origin: ProvenanceOrigin, at?: Date): Research {
    // Stamp the active user submission (run-context): every Research created during one
    // question carries the same runId + the trader's verbatim question, so history shows one
    // entry per question instead of one per internal plan step.
    const run = currentRun();
    const research = createResearch(
      run !== undefined
        ? {
            ...input,
            runId: run.runId,
            userQuestion: run.userQuestion,
            ...(run.investigationId !== undefined ? { investigationRef: run.investigationId } : {}),
          }
        : input,
      origin,
      at,
    );
    this.researches.set(research.id, research);
    return research;
  }

  getResearch(id: string): Research | undefined {
    return this.researches.get(id);
  }

  listResearch(): readonly Research[] {
    return [...this.researches.values()];
  }

  /**
   * Persist the final trader-facing response record of a completed run. One record per run,
   * retained for the life of the workspace (see ResearchResponseRecord retention policy):
   * any later instance can then serve history verbatim, including for OLD runs.
   */
  saveResearchResponse(researchId: string, response: unknown): void {
    this.researchResponses.set(researchId, response);
  }

  getResearchResponse(researchId: string): unknown {
    return this.researchResponses.get(researchId);
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
   * re-creating it; identity, classification, and provenance are preserved exactly.
   *
   * EVIDENCE IMMUTABILITY (provenance contract): the observation, its timestamp, its sources
   * and its RUN OWNERSHIP are frozen at creation. Re-ingesting the same id is idempotent; it
   * can never re-parent an existing observation to a different run, and it can never
   * overwrite the stored payload. A new retrieval is always a NEW evidence record.
   */
  ingestEvidence(evidence: Evidence, researchRef?: string): Evidence {
    const existing = this.evidence.get(evidence.id);
    if (existing !== undefined) {
      const owner = researchRef ?? existing.researchRef;
      if (existing.researchRef !== undefined && owner !== undefined && existing.researchRef !== owner) {
        throw new Error(
          `evidence ${evidence.id} already belongs to research ${existing.researchRef}; ` +
          `a new retrieval must create a new evidence record (refusing to re-parent to ${owner})`,
        );
      }
      if (owner === undefined) return existing;
      return this.linkEvidenceToRun(existing, owner);
    }
    const owned = Object.freeze({
      ...evidence,
      ...(researchRef !== undefined ? { researchRef } : {}),
    });
    this.evidence.set(owned.id, owned);
    if (researchRef !== undefined) this.linkEvidenceToRun(owned, researchRef);
    return owned;
  }

  /** Attach an evidence object to a research object (idempotent; never re-parents). */
  private linkEvidenceToRun(evidence: Evidence, researchRef: string): Evidence {
    const research = this.mustResearch(researchRef);
    if (research.evidenceRefs.includes(evidence.id)) return evidence;
    const stamped = evidence.researchRef === researchRef
      ? evidence
      : Object.freeze({ ...evidence, researchRef });
    this.evidence.set(stamped.id, stamped);
    this.researches.set(researchRef, appendRef(research, "evidenceRefs", stamped.id));
    return stamped;
  }

  /**
   * EVIDENCE OWNED BY A RESEARCH OBJECT (explicit relational ownership). This is the ONLY
   * sanctioned way to answer "which evidence belongs to this run" — never a timestamp
   * comparison, an id-prefix heuristic, or a global latest-N scan.
   */
  evidenceForResearch(researchRef: string): readonly Evidence[] {
    const research = this.getResearch(researchRef);
    if (research === undefined) return [];
    return research.evidenceRefs
      .map((id) => this.evidence.get(id))
      .filter((e): e is Evidence => e !== undefined);
  }

  /**
   * Evidence owned by ANY member of the run `seed` belongs to (one user submission creates
   * several research objects: plan steps, flow phases). Run membership is resolved from the
   * shared run identity, never from similarity of question text or recency.
   */
  evidenceForRun(seed: Research): readonly Evidence[] {
    const out: Evidence[] = [];
    const seen = new Set<string>();
    for (const member of this.runMembers(seed)) {
      for (const e of this.evidenceForResearch(member.id)) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  }

  /** The set of research objects belonging to the same submission run as `seed`. */
  runMembers(seed: Research): readonly Research[] {
    if (seed.runId === undefined) return [seed];
    const key = runKeyOf(seed);
    return [...this.researches.values()].filter((m) => runKeyOf(m) === key);
  }

  /** True when the evidence belongs to the given research object's run. */
  isRunEvidence(researchRef: string, evidenceId: string): boolean {
    return this.evidenceForResearch(researchRef).some((e) => e.id === evidenceId);
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
   *
   * PROVENANCE CONTRACT (research-integrity remediation): the judgment is stamped with its
   * OWNING research object, and its evidence basis is FILTERED to that run. A judgment can
   * no longer claim traceability to an observation another run retrieved, so
   * `judgment.researchRunId === currentResearchRunId` is true by construction.
   */
  addJudgment(
    input: Parameters<typeof createJudgment>[0] & { researchRef: string },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Judgment {
    const { researchRef, ...rest } = input;
    const research = this.mustResearch(researchRef);

    // Idempotent re-add (multi-instance law): the SAME statement re-arriving for the same
    // research (e.g. the completion backstop running after a merge restored the flow's
    // judgment) must reuse the existing judgment — minting a second identical judgment
    // object would corrupt judgment counts and dedupe downstream. Scoped to THIS research
    // object, so a similar question in a later run never reuses an earlier run's verdict.
    for (const existingId of research.judgmentRefs) {
      const existing = this.judgments.get(existingId);
      if (existing && existing.status === "ACTIVE" && existing.statement === rest.statement) return existing;
    }

    for (const existingId of research.judgmentRefs) {
      const existing = this.judgments.get(existingId);
      if (existing && existing.status === "ACTIVE") {
        this.judgments.set(
          existingId,
          withStatus("judgment", existing, "SUPERSEDED", origin, `superseded by new judgment for ${researchRef}`, at),
        );
      }
    }

    // EVIDENCE-BASIS GATE: the basis may only cite evidence THIS RUN owns. Model-chosen
    // citation lists are re-derived from the graph, never trusted as provenance.
    const ownedEvidence = new Set(this.evidenceForResearch(researchRef).map((e) => e.id));
    const owned = (refs: readonly string[] | undefined): readonly string[] =>
      [...new Set((refs ?? []).filter((ref) => ownedEvidence.has(ref)))];
    const dropped = [
      ...countDropped(rest.basis.supportingEvidence, ownedEvidence),
      ...countDropped(rest.basis.opposingEvidence, ownedEvidence),
    ];
    const judgment = createJudgment(
      {
        ...rest,
        researchRef,
        basis: {
          supportingEvidence: owned(rest.basis.supportingEvidence),
          opposingEvidence: owned(rest.basis.opposingEvidence),
          keyClaims: [...new Set(rest.basis.keyClaims)],
          hypotheses: [...new Set(rest.basis.hypotheses)],
        },
      },
      origin,
      at,
    );
    this.judgments.set(judgment.id, judgment);

    let updated = appendRef(research, "judgmentRefs", judgment.id);
    updated = Object.freeze({ ...updated, currentJudgmentRef: judgment.id });
    this.researches.set(researchRef, updated);
    if (dropped.length > 0) {
      // Honest record of what the engine refused to attribute to this run, so a stripped
      // citation is auditable rather than silent.
      this.judgments.set(
        judgment.id,
        withProvenance(judgment, origin, `cross-run evidence excluded from judgment basis: ${dropped.join(", ")}`, at),
      );
    }
    return this.judgments.get(judgment.id)!;
  }

  getJudgment(id: string): Judgment | undefined {
    return this.judgments.get(id);
  }

  listJudgments(): readonly Judgment[] {
    return [...this.judgments.values()];
  }

  /**
   * Current judgment for a research context (the single ACTIVE one), if any.
   * OWNERSHIP LAW: the judgment must belong to this research object. A judgment minted for
   * another run can never satisfy this lookup, so a run without its own conclusion shows
   * none rather than inheriting a foreign verdict.
   */
  currentJudgment(researchRef: string): Judgment | undefined {
    const research = this.mustResearch(researchRef);
    if (!research.currentJudgmentRef) return undefined;
    const current = this.judgments.get(research.currentJudgmentRef);
    if (current === undefined || current.status !== "ACTIVE") return undefined;
    if (current.researchRef !== undefined && current.researchRef !== researchRef) return undefined;
    return current;
  }

  /** Judgments belonging to this research object only (never a global latest lookup). */
  judgmentsForResearch(researchRef: string): readonly Judgment[] {
    const research = this.getResearch(researchRef);
    if (research === undefined) return [];
    return research.judgmentRefs
      .map((id) => this.judgments.get(id))
      .filter((j): j is Judgment => j !== undefined && (j.researchRef === undefined || j.researchRef === researchRef));
  }

  historicalJudgments(researchRef: string): readonly Judgment[] {
    const research = this.mustResearch(researchRef);
    return research.judgmentRefs
      .map((id) => this.judgments.get(id))
      .filter((j): j is Judgment => j !== undefined && j.status !== "ACTIVE");
  }

  /**
   * Register a trader-authored thesis. Origin must be trader-kind (directly or via
   * trader-confirmed import); the system never silently creates or rewrites theses.
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
   *  Unknown refs are rejected; no invented state. The thesis object itself is NOT mutated
   *  (selection is working state, not a thesis lifecycle change). */
  setActiveThesis(id: string): Thesis {
    const thesis = this.theses.get(id);
    if (thesis === undefined) throw new Error(`cannot activate unknown thesis ${id}; no invented state`);
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

  /**
   * The EXPLICIT selection only (no compat fallback). Phase G challenge resolution needs the
   * distinction: with several current theses and no explicit choice, "my thesis" is genuinely
   * ambiguous and must clarify (M3 §13), never silently pick the newest.
   */
  explicitActiveThesisId(): string | undefined {
    if (this.activeThesisId !== undefined && this.theses.has(this.activeThesisId)) return this.activeThesisId;
    return undefined;
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
   * Revise a thesis; TRADER-ONLY operation (thesis.md: the system must never silently replace
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

  /**
   * Transition a thesis through the DETERMINISTIC lifecycle (Transitions not listed in
   * THESIS_TRANSITIONS are rejected). A transition is an explicit trader action (or a
   * documented lifecycle condition); an LLM sentence can never move a thesis. The thesis
   * statement itself is never touched here (status is lifecycle, not belief).
   */
  transitionThesis(id: string, to: ThesisStatus, origin: ProvenanceOrigin, note: string, at?: Date): Thesis {
    const thesis = this.mustThesis(id);
    if (thesis.status === to) return thesis; // idempotent: no-op transition is not an error
    if (!thesisTransitionAllowed(thesis.status, to)) {
      throw new Error(`invalid thesis transition ${thesis.status} → ${to}; see THESIS_TRANSITIONS`);
    }
    // Confirming/activating a thesis is a TRADER decision: a non-trader origin may not adopt
    // (DRAFT→ACTIVE) or confirm (→CONFIRMED) the trader's own belief.
    if ((to === "ACTIVE" || to === "CONFIRMED") && origin.kind !== "trader") {
      throw new Error(`thesis ${to} requires trader origin; the system must never adopt or confirm the trader's thesis`);
    }
    // Thesis status transitions are trader decisions; whatever origin executes the
    // transition is recorded explicitly in provenance; never silently.
    const atDate = at ?? new Date();
    const updated: Thesis = Object.freeze({
      ...thesis,
      status: to,
      // Adopting a DRAFT is the trader's confirmation; the flag records it honestly.
      ...(to === "ACTIVE" && !thesis.userConfirmed ? { userConfirmed: true } : {}),
      provenance: appendProvenance(thesis.provenance, origin, `thesis status → ${to}: ${note}`, atDate),
      updatedAt: atDate.toISOString(),
    });
    this.theses.set(id, updated);
    return updated;
  }

  /**
   * Attach a research run to a thesis (ref only; research is never copied). Idempotent, and the
   * ref must name a REAL run — no invented linkage.
   */
  linkThesisResearch(thesisId: string, researchRef: string, origin: ProvenanceOrigin, at?: Date): Thesis {
    const thesis = this.mustThesis(thesisId);
    this.mustResearch(researchRef);
    if (thesis.linkedResearchRefs.includes(researchRef)) return thesis;
    const atDate = at ?? new Date();
    const updated: Thesis = Object.freeze({
      ...thesis,
      linkedResearchRefs: Object.freeze([...thesis.linkedResearchRefs, researchRef]),
      provenance: appendProvenance(thesis.provenance, origin, `linked research ${researchRef}`, atDate),
      updatedAt: atDate.toISOString(),
    });
    this.theses.set(thesisId, updated);
    return updated;
  }

  /**
   * Attach an EXISTING Saved artifact to a thesis by reference (never duplicated). Idempotent;
   * the savedId must name a real saved artifact at link time. If the artifact is later unsaved
   * the thesis is untouched (the DTO reports the link as unavailable).
   */
  linkThesisSaved(thesisId: string, savedId: string, origin: ProvenanceOrigin, at?: Date): Thesis {
    const thesis = this.mustThesis(thesisId);
    if (this.savedArtifacts.get(savedId) === undefined) {
      throw new Error(`cannot link unknown saved artifact ${savedId} to thesis ${thesisId}`);
    }
    if (thesis.linkedSavedIds.includes(savedId)) return thesis;
    const atDate = at ?? new Date();
    const updated: Thesis = Object.freeze({
      ...thesis,
      linkedSavedIds: Object.freeze([...thesis.linkedSavedIds, savedId]),
      provenance: appendProvenance(thesis.provenance, origin, `linked saved artifact ${savedId}`, atDate),
      updatedAt: atDate.toISOString(),
    });
    this.theses.set(thesisId, updated);
    return updated;
  }

  /**
   * Detach a Saved artifact link. The thesis is NEVER deleted or invalidated by an unsave; this
   * only removes the reference. Idempotent.
   */
  unlinkThesisSaved(thesisId: string, savedId: string, origin: ProvenanceOrigin, at?: Date): Thesis {
    const thesis = this.mustThesis(thesisId);
    if (!thesis.linkedSavedIds.includes(savedId)) return thesis;
    const atDate = at ?? new Date();
    const updated: Thesis = Object.freeze({
      ...thesis,
      linkedSavedIds: Object.freeze(thesis.linkedSavedIds.filter((id) => id !== savedId)),
      provenance: appendProvenance(thesis.provenance, origin, `unlinked saved artifact ${savedId}`, atDate),
      updatedAt: atDate.toISOString(),
    });
    this.theses.set(thesisId, updated);
    return updated;
  }

  // ----- saved artifacts (SAVE; first-class, confirmed; lui-save-action.md) ---

  /**
   * Persist a SAVE proposal as a real artifact. Callers MUST pass a trader origin that
   * records the confirmation; silent saves are forbidden (M3 §17).
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

  /** Find a saved artifact by its deterministic identity (researchRef + kind + sourceRef). */
  findSavedArtifactByIdentity(
    input: { readonly researchRef?: string; readonly kind: SavedKind; readonly sourceRef?: string },
  ): SavedArtifact | undefined {
    const key = savedArtifactIdentity({ kind: input.kind, ...(input.researchRef !== undefined ? { researchRef: input.researchRef } : {}), ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}) });
    for (const artifact of this.savedArtifacts.values()) {
      if (savedArtifactIdentity(artifact) === key) return artifact;
    }
    return undefined;
  }

  /**
   * Idempotent SAVE (Phase C): saving the SAME originating artifact twice returns/updates the
   * existing record instead of minting duplicates. Repeated saves re-affirm provenance (an
   * appended entry makes the update visible to the merge) and refresh the snapshot/tags.
   */
  upsertSavedArtifact(
    input: Parameters<typeof createSavedArtifact>[0] & { readonly kind: SavedKind },
    origin: ProvenanceOrigin,
    at?: Date,
  ): { readonly artifact: SavedArtifact; readonly created: boolean } {
    const existing = this.findSavedArtifactByIdentity(input);
    const now = at ?? new Date();
    if (existing === undefined) {
      return { artifact: this.saveArtifact(input, origin, now), created: true };
    }
    const updated = Object.freeze({
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.tags !== undefined ? { tags: Object.freeze([...new Set([...existing.tags, ...input.tags])]) } : {}),
      ...(input.snapshot !== undefined ? { snapshot: Object.freeze({ ...input.snapshot }) } : {}),
      provenance: appendProvenance(existing.provenance, origin, "saved artifact re-affirmed (idempotent SAVE)", now),
      updatedAt: now.toISOString(),
    }) as SavedArtifact;
    this.savedArtifacts.set(updated.id, updated);
    return { artifact: updated, created: false };
  }

  /**
   * Unsave: remove ONLY the saved artifact (its tombstone keeps the removal durable across
   * instances). Never touches the originating research, evidence, judgment or memory.
   */
  removeSavedArtifact(id: string, at?: Date): boolean {
    const existed = this.savedArtifacts.delete(id);
    if (existed) this.savedTombstones.set(id, (at ?? new Date()).toISOString());
    return existed;
  }

  listSavedTombstones(): readonly { readonly id: string; readonly at: string }[] {
    return [...this.savedTombstones.entries()].map(([id, at]) => ({ id, at }));
  }

  /**
   * Merge a persisted snapshot's Saved collection into this graph (multi-instance READ
   * freshness). A warm serverless instance loads the workspace ONCE at construction; another
   * instance's SAVE/UNSAVE then lives only in the blob, so this graph would serve a stale
   * library. Scoped to Saved (never the whole graph) so an in-flight research run is never
   * clobbered. Tombstones win; a newer `updatedAt` replaces an older copy; existing local
   * artifacts are never dropped by a snapshot that simply has not seen them.
   */
  absorbSavedState(snapshot: WorkspaceSnapshot): void {
    // TOMBSTONE COUNTER CONTINUITY (Phase D production bug): a deleted artifact's id survives
    // only as a tombstone, so a counter seeded from artifact IDS alone rewinds after unsaves.
    // The next SAVE then re-mints a tombstoned id (`sa_000001` again) and every merge/absorb
    // pass (correctly) treats it as deleted — the artifact is written and instantly swallowed:
    // POST /api/saved returned 201 while every later GET served `[]`, forever. Bump past the
    // tombstoned ids so new artifacts never inherit a dead id. Tombstone semantics themselves
    // are untouched (tombstones still win; still durable; still durable across instances).
    for (const t of snapshot.savedTombstones ?? []) {
      this.savedTombstones.set(t.id, t.at);
      bumpIdCounterPastId(t.id);
    }
    for (const a of snapshot.savedArtifacts ?? []) {
      if (this.savedTombstones.has(a.id)) continue;
      const incoming = normalizeSavedArtifact(a);
      const existing = this.savedArtifacts.get(a.id);
      if (existing === undefined || incoming.updatedAt > existing.updatedAt) this.savedArtifacts.set(a.id, incoming);
    }
    for (const id of this.savedTombstones.keys()) this.savedArtifacts.delete(id);
  }

  /**
   * Merge a persisted snapshot's Thesis collection into this graph (multi-instance READ
   * freshness; the Thesis analogue of absorbSavedState). A warm serverless instance loads
   * the workspace ONCE; another instance's explicit thesis write (create/update/status/
   * link/unlink) then lives only in the blob, so this graph would serve a stale thesis view
   * forever (production: an attach returned success and the next read had lost the link).
   * Scoped to Thesis — never a whole-graph reload — so an in-flight research run is never
   * clobbered. Union by id; the side with MORE history entries is newer (provenance is
   * append-only and every mutation appends); equal history keeps local (our in-flight
   * writes win). Assessments are append-only records and merge by id. Selection is merged
   * like the snapshot merge: keep the local choice when it still exists, else take remote's.
   */
  absorbThesisState(snapshot: WorkspaceSnapshot): void {
    for (const raw of snapshot.theses ?? []) {
      const incoming = normalizeThesis(raw);
      const existing = this.theses.get(incoming.id);
      if (existing === undefined || thesisIsNewer(incoming, existing)) this.theses.set(incoming.id, incoming);
    }
    const seen = new Set<string>();
    for (const a of snapshot.thesisAssessments ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      if (!this.thesisAssessments.some((existing) => existing.id === a.id)) this.thesisAssessments.push(a);
    }
    const remoteActive = snapshot.activeThesisId;
    if (remoteActive !== undefined && this.activeThesisId === undefined) this.activeThesisId = remoteActive;
    else if (remoteActive === undefined && this.activeThesisId !== undefined && !this.theses.has(this.activeThesisId)) {
      this.activeThesisId = undefined; // the remote snapshot agrees the selection is gone
    }
    // Phase G: challenge read freshness (same union-by-id law; updatedAt breaks ties).
    for (const raw of snapshot.challenges ?? []) {
      const incoming = normalizeChallenge(raw);
      const existing = this.challenges.get(incoming.id);
      if (existing === undefined || incoming.updatedAt > existing.updatedAt) this.challenges.set(incoming.id, incoming);
    }
    // Phase H: monitor execution state, assessments, notifications (union-by-id; the
    // monitors' own execution fields ride the existing thesis-style monitor merge).
    for (const raw of snapshot.monitors ?? []) {
      const existing = this.monitors.get(raw.id);
      if (existing === undefined || raw.updatedAt > existing.updatedAt) this.monitors.set(raw.id, raw);
    }
    for (const a of snapshot.monitoringAssessments ?? []) {
      const existing = this.monitoringAssessments.get(a.id);
      if (existing === undefined) this.monitoringAssessments.set(a.id, a);
    }
    for (const n of snapshot.monitorNotifications ?? []) {
      if (!this.notifications.has(n.id)) this.notifications.set(n.id, n);
    }
  }

  /**
   * Merge a persisted snapshot's EXECUTION collections into this graph (remediation D4/D5/D7;
   * the research/judgment/evidence/analysis/branch analogue of absorbSavedState and
   * absorbThesisState).
   *
   * Root causes this closes:
   * - D4 (judgment id reuse): a warm instance that loaded BEFORE another instance persisted a
   *   run re-mints the other run's judgment id (its counter was seeded low). Absorbing the
   *   other instance's objects bumps the id counters past them, so a new judgment can never
   *   collide with a persisted one (same law as saved-tombstone continuity).
   * - D5 (CURRENT pointer): the continuity snapshot's CURRENT research is derived from Map
   *   insertion order; without absorption a warm instance's pointer ages while newer runs
   *   land in the store. The union keeps the graph current and `getContinuitySnapshot` picks
   *   the NEWEST COMPLETED research by timestamp, never bare insertion order.
   * - D7 (Save NOT_FOUND): the Save path resolves `researchRef` against this graph; a warm
   *   instance that predates the run 404s. Read paths absorb first, so the Save target exists.
   *
   * Scoped to execution collections — never a whole-graph reload — so an in-flight research
   * run is never clobbered. Union by id with the SAME newer-wins law as the snapshot merge
   * (more provenance/history entries = later state); local in-flight writes win ties.
   */
  absorbExecutionState(snapshot: WorkspaceSnapshot): void {
    for (const raw of snapshot.researches ?? []) {
      const existing = this.researches.get(raw.id);
      if (existing === undefined || revisionsOf(raw) > revisionsOf(existing)) this.researches.set(raw.id, raw);
    }
    for (const raw of snapshot.judgments ?? []) {
      const existing = this.judgments.get(raw.id);
      if (existing === undefined || revisionsOf(raw) > revisionsOf(existing)) this.judgments.set(raw.id, raw);
      // Counter continuity (D4): a persisted judgment id must never be re-minted.
      bumpIdCounterPastId(raw.id);
    }
    for (const raw of snapshot.evidence ?? []) {
      const existing = this.evidence.get(raw.id);
      if (existing === undefined || revisionsOf(raw) > revisionsOf(existing)) this.evidence.set(raw.id, raw);
      bumpIdCounterPastId(raw.id);
    }
    for (const raw of snapshot.analyses ?? []) {
      const existing = this.analyses.get(raw.id);
      if (existing === undefined || revisionsOf(raw) > revisionsOf(existing)) this.analyses.set(raw.id, raw);
      bumpIdCounterPastId(raw.id);
    }
    for (const raw of snapshot.claims ?? []) {
      const existing = this.claims.get(raw.id);
      if (existing === undefined || revisionsOf(raw) > revisionsOf(existing)) this.claims.set(raw.id, raw);
      bumpIdCounterPastId(raw.id);
    }
    for (const raw of snapshot.hypotheses ?? []) {
      const existing = this.hypotheses.get(raw.id);
      if (existing === undefined || revisionsOf(raw) > revisionsOf(existing)) this.hypotheses.set(raw.id, raw);
      bumpIdCounterPastId(raw.id);
    }
    for (const raw of snapshot.researchResponses ?? []) {
      if (!this.researchResponses.has(raw.researchId)) this.researchResponses.set(raw.researchId, raw.response);
    }
    // CONVERSATION ABSORPTION: another instance may have extended the thread this instance is
    // serving. Union by id (an investigation/turn is never deleted, only extended). An
    // investigation is an APPEND-ONLY THREAD, so the union is of its REFS rather than a
    // winner-take-all choice: `withTurn` grows a thread by appending `turnRefs`/`runRefs` and
    // appends NO provenance entry, so ranking by provenance alone rated an extended thread and
    // the stale copy that superseded it as equally new, the tie kept the STALE local copy, and
    // every run the investigation had accumulated silently vanished from the absorbed graph.
    // The restored thread then reported no research, the conversation router read it as "no live
    // thread", and the trader's follow-up opened a NEW investigation — the production failure.
    // Union is safe precisely because the collections are append-only: no turn or run can be
    // invented (neither instance recorded it) and none can be lost. The CURRENT investigation
    // pointer is never taken from a remote snapshot: which thread the trader is in is local
    // working state, and a warm instance must not yank the trader into a thread another
    // instance opened.
    for (const raw of snapshot.investigations ?? []) {
      const existing = this.investigations.get(raw.id);
      if (existing === undefined) {
        this.investigations.set(raw.id, raw);
      } else {
        // Provenance is replaced (more revisions wins); the refs are unioned, never replaced.
        const base = revisionsOf(raw) > revisionsOf(existing) ? raw : existing;
        this.investigations.set(raw.id, {
          ...base,
          turnRefs: unionRefs(existing.turnRefs, raw.turnRefs),
          runRefs: unionRefs(existing.runRefs, raw.runRefs),
          updatedAt: raw.updatedAt > existing.updatedAt ? raw.updatedAt : existing.updatedAt,
        });
      }
      bumpIdCounterPastId(raw.id); // inv_ counter continuity
    }
    for (const raw of snapshot.conversationTurns ?? []) {
      if (!this.conversationTurns.has(raw.id)) this.conversationTurns.set(raw.id, raw);
      bumpIdCounterPastId(raw.id); // tn_ counter continuity
    }
  }

  /**
   * Roll back an in-memory saved-artifact mutation whose persistence FAILED, so the library the
   * client reads can never show an artifact the durable store does not hold (no phantom save,
   * no tombstone invented by a failed unsave). Used only by the application layer on write error.
   */
  revertSavedArtifactChange(previous: SavedArtifact | undefined, createdId?: string): void {
    if (createdId !== undefined) this.savedArtifacts.delete(createdId);
    if (createdId !== undefined) this.savedTombstones.delete(createdId);
    if (previous !== undefined) {
      this.savedArtifacts.set(previous.id, previous);
      this.savedTombstones.delete(previous.id);
    }
  }

  // ----- research memory (M5; memory.md; SAVE is the promotion path) --------

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

  /** Decay a memory (STALE/HISTORICAL); influence is reduced; the entry is NEVER deleted (M5 §5). */
  decayMemory(id: string, status: "STALE" | "HISTORICAL", reason: string, origin: ProvenanceOrigin, at?: Date): MemoryEntry {
    const entry = this.memories.get(id);
    if (entry === undefined) throw new Error(`Unknown memory: ${id}`);
    const decayed = decayMemory(entry, status, reason, origin, at);
    this.memories.set(id, decayed);
    return decayed;
  }

  /** Revalidate memory against current research; original preserved, outcome recorded (M5 §5). */
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

  // ----- monitoring handoff (M5; thesis-monitor-reassessment.md §21–§26) -----

  /** Propose a monitor; status PROPOSED, inert until explicit trader confirmation (M5 §11). */
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
   * Activate a monitor; TRADER-CONFIRMED operation only (M5 §11: activation requires the
   * confirmation boundary). A non-trader origin is rejected; no silent activation exists.
   * No background process is created; this is persistent handoff state only.
   */
  activateMonitor(id: string, origin: ProvenanceOrigin, note: string, at?: Date): Monitor {
    if (origin.kind !== "trader") {
      throw new Error("monitor activation requires explicit trader confirmation; system/model origins cannot activate monitors");
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

  /** Source unavailability is a STATE; never a false invalidation alert (M5 §12). */
  // ----- Phase H: monitoring execution ---------------------------------------

  /**
   * Create a PROPOSED monitor with Phase H execution state (cadence, challenge linkage).
   * Still inert until the trader activates it (§3 law: Lumen proposes, the user activates).
   */
  addExecutableMonitorProposal(
    input: Omit<Parameters<Workspace["addMonitorProposal"]>[0], "freshnessExpectation" | "suggestedFrequency"> & {
      cadence?: "DAILY" | "WEEKLY" | "MANUAL";
      linkedChallengeRefs?: readonly string[];
    },
    origin: ProvenanceOrigin,
    at?: Date,
  ): Monitor {
    const { cadence, linkedChallengeRefs, ...rest } = input;
    const proposalInput = { ...rest } as Parameters<Workspace["addMonitorProposal"]>[0];
    const monitor = this.addMonitorProposal(proposalInput, origin, at);
    const executable: Monitor = {
      ...monitor,
      ...(cadence !== undefined ? { cadence } : { cadence: "MANUAL" as const }),
      ...(linkedChallengeRefs !== undefined && linkedChallengeRefs.length > 0 ? { linkedChallengeRefs: Object.freeze([...linkedChallengeRefs]) } : {}),
      triggerVersion: 1,
      provenance: appendProvenance(monitor.provenance, origin, `execution state attached (cadence ${cadence ?? "MANUAL"}; challenge-linked: ${linkedChallengeRefs?.length ?? 0})`, at),
    };
    this.monitors.set(executable.id, executable);
    return executable;
  }

  /** Explicit user update of monitor conditions (§14 user action; NEVER silent/self). */
  updateMonitorConditions(id: string, conditions: readonly MonitorCondition[], origin: ProvenanceOrigin, note: string, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    if (origin.kind !== "trader") throw new Error("monitor conditions can only be changed by the trader; the monitor never silently rewrites itself");
    const updated: Monitor = {
      ...monitor,
      conditions: Object.freeze([...conditions]),
      triggerVersion: (monitor.triggerVersion ?? 1) + 1, // re-check becomes legitimate
      provenance: appendProvenance(monitor.provenance, origin, `conditions updated by trader: ${note}`, at),
      updatedAt: (at ?? new Date()).toISOString(),
    };
    this.monitors.set(id, updated);
    return updated;
  }

  /** Record a completed monitoring check (idempotent by checkId at the caller level too). */
  recordMonitorCheck(id: string, patch: MonitorExecutionPatch, origin: ProvenanceOrigin, note: string, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const updated = applyExecutionPatch(monitor, patch, origin, note, at);
    this.monitors.set(id, updated);
    return updated;
  }

  /** Persist a monitoring assessment; IDEMPOTENT by checkId (§10). */
  recordMonitoringAssessment(assessment: MonitoringAssessment): MonitoringAssessment {
    this.monitoringAssessments.set(assessment.id, assessment);
    return assessment;
  }

  getMonitoringAssessment(id: string): MonitoringAssessment | undefined {
    return this.monitoringAssessments.get(id);
  }

  findMonitoringAssessmentByCheckId(checkId: string): MonitoringAssessment | undefined {
    return [...this.monitoringAssessments.values()].find((a) => a.checkId === checkId);
  }

  listMonitoringAssessments(monitorRef?: string): readonly MonitoringAssessment[] {
    const all = [...this.monitoringAssessments.values()].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
    return monitorRef === undefined ? all : all.filter((a) => a.monitorRef === monitorRef);
  }

  /** Persist a material-change notification; IDEMPOTENT by checkId (at most one per check). */
  recordNotification(notification: MonitorNotification): MonitorNotification {
    this.notifications.set(notification.id, notification);
    return notification;
  }

  findNotificationByCheckId(checkId: string): MonitorNotification | undefined {
    return [...this.notifications.values()].find((n) => n.checkId === checkId);
  }

  getNotification(id: string): MonitorNotification | undefined {
    return this.notifications.get(id);
  }

  listNotifications(): readonly MonitorNotification[] {
    return [...this.notifications.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markNotificationRead(id: string, origin: ProvenanceOrigin, at?: Date): MonitorNotification {
    const notification = this.notifications.get(id);
    if (notification === undefined) throw new Error(`Unknown notification: ${id}`);
    const updated: MonitorNotification = { ...notification, read: true, provenance: appendProvenance(notification.provenance, origin, "marked read", at) };
    this.notifications.set(id, updated);
    return updated;
  }

  recordMonitorSourceState(id: string, sourceRef: string, state: "SOURCE_UNAVAILABLE" | "OK", note: string, origin: ProvenanceOrigin, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const updated = recordMonitorSourceState(monitor, sourceRef, state, note, origin, at);
    this.monitors.set(id, updated);
    return updated;
  }

  /** Flag a monitor for review after reassessment; proposal for the trader, never silent change (M5 §15). */
  flagMonitorForReview(id: string, reason: string, origin: ProvenanceOrigin, at?: Date): Monitor {
    const monitor = this.monitors.get(id);
    if (monitor === undefined) throw new Error(`Unknown monitor: ${id}`);
    const flagged = flagMonitorForReview(monitor, reason, origin, at);
    this.monitors.set(id, flagged);
    return flagged;
  }

  // ----- thesis assessment history (M5 §9; assessment ≠ mutation) ------------

  /**
   * Record a thesis assessment: a research RESULT about the thesis (thesis.md §7 THESIS
   * ASSESSMENT). It never mutates the thesis object; it accumulates in an auditable history.
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
      provenance: createProvenance(origin, `thesis assessment recorded (${input.assessment}); thesis object unchanged`, at),
      createdAt: (at ?? new Date()).toISOString(),
    });
    this.thesisAssessments.push(record);
    return record;
  }

  listThesisAssessments(thesisId?: string): readonly ThesisAssessmentRecord[] {
    return thesisId === undefined ? [...this.thesisAssessments] : this.thesisAssessments.filter((a) => a.thesisId === thesisId);
  }

  // ----- Phase G: persistent falsification challenges ------------------------

  /**
   * Persist a derived challenge generation (Flow 7 output → durable records). IDEMPOTENT by
   * fingerprint: the same falsifier against the same thesis claim UPDATES the existing record
   * (fresh status/evidence/assessment; provenance appended; id stable) instead of minting a
   * duplicate — no endless re-warning across refreshes. Challenges from an OLDER derivation
   * run that the newest research did not re-derive are marked STALE (latest research did not
   * surface them; kept visible, never deleted). A challenge can never mutate its thesis.
   */
  recordChallenges(
    derived: readonly Parameters<typeof createChallenge>[0][],
    origin: ProvenanceOrigin,
    at?: Date,
  ): readonly Challenge[] {
    const now = (at ?? new Date());
    const written: Challenge[] = [];
    const touchedIds = new Set<string>();
    for (const d of derived) {
      const candidate = createChallenge(d, origin, now);
      const existing = [...this.challenges.values()].find((c) => c.fingerprint === candidate.fingerprint);
      if (existing === undefined) {
        this.challenges.set(candidate.id, candidate);
        touchedIds.add(candidate.id);
        written.push(candidate);
        continue;
      }
      // Re-derivation of a known challenge: refresh the volatile fields, keep identity.
      const updated: Challenge = {
        ...existing,
        status: candidate.status,
        materialityRationale: candidate.materialityRationale,
        supportingEvidenceRefs: candidate.supportingEvidenceRefs,
        counterEvidenceRefs: candidate.counterEvidenceRefs,
        informationGaps: candidate.informationGaps,
        conditionObserved: candidate.conditionObserved,
        researchRef: candidate.researchRef,
        assessment: candidate.assessment,
        thesisVersion: candidate.thesisVersion,
        provenance: appendProvenance(existing.provenance, origin, `re-derived from Flow 7 run (${candidate.researchRef}); status ${existing.status} → ${candidate.status}`, now),
        updatedAt: now.toISOString(),
      };
      this.challenges.set(existing.id, updated);
      touchedIds.add(existing.id);
      written.push(updated);
    }
    // Supersede: same-thesis challenges from PREVIOUS runs, untouched this round, did not
    // survive the latest falsification research → STALE (visible in history, re-openable by
    // new research; never silently deleted).
    for (const c of this.challenges.values()) {
      if (c.thesisId !== derived[0]?.thesisId) continue;
      if (touchedIds.has(c.id)) continue;
      if (c.researchRef === derived[0]?.researchRef) continue; // same run, different thesis edge
      if (c.status !== "ACTIVE" && c.status !== "CONTRADICTION" && c.status !== "INFORMATION_GAP") continue;
      const stale: Challenge = {
        ...c,
        status: "STALE",
        provenance: appendProvenance(c.provenance, origin, `not re-derived by the latest falsification research (${derived[0]?.researchRef ?? ""}); marked stale`, now),
        updatedAt: now.toISOString(),
      };
      this.challenges.set(c.id, stale);
      written.push(stale);
    }
    return written;
  }

  getChallenge(id: string): Challenge | undefined {
    return this.challenges.get(id);
  }

  listChallenges(thesisId?: string): readonly Challenge[] {
    const all = [...this.challenges.values()];
    return thesisId === undefined ? all : all.filter((c) => c.thesisId === thesisId);
  }

  latestThesisAssessment(thesisId: string): ThesisAssessmentRecord | undefined {
    const all = this.listThesisAssessments(thesisId);
    return all[all.length - 1];
  }

  // ----- workspace continuity (M5 §16; domain representation for future UI) --

  /** The continuity view: everything a later request needs to recover research context. */
  getContinuitySnapshot(): {
    activeResearchTarget: Research | undefined;
    /**
     * The authoritative CURRENT research run (the active target's object id). Every dependent
     * read — evidence, judgment, answer, traceability — is scoped from this pointer instead of
     * being resolved by an independent global "latest" query.
     */
    currentResearchRunId: string | undefined;
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
    // CURRENT research selection (remediation D5): Map insertion order is NOT run order —
    // multi-instance merges and absorbs insert objects in arbitrary order, which left CURRENT
    // pointing at an older run after newer ones completed (observed live). The CURRENT target
    // is the NEWEST COMPLETED research by SUBMISSION order, falling back to the newest
    // research of any status when nothing has completed yet. Opening an older history record
    // never changes this pointer (selection is a read-path concern, not workspace state).
    // SUBMISSION ORDER, NOT COMPLETION ORDER (async integrity): a long run submitted FIRST can
    // finish LAST (gap recovery, deep research, a slow provider). Ranking by the last
    // provenance entry made that stale run steal CURRENT when it finally landed, which is
    // exactly the "an old COMPLETED run masquerading as the current one" failure. CURRENT is
    // the run the trader asked for last, so ranking uses the CREATION timestamp (the head of
    // the provenance trail), which every run records at creation and never rewrites.
    // TIE LAW: two runs created in the same millisecond share that timestamp; the stable
    // descending sort would keep insertion order, leaving the OLDER inserted object first.
    // Reversing before the sort makes the tie fall to the LATER-inserted object.
    const newestBy = (rows: readonly Research[]): Research | undefined =>
      rows.slice().reverse().sort((a, b) => researchCreatedAt(b).localeCompare(researchCreatedAt(a)))[0];
    const activeResearchTarget = newestBy(researches.filter((r) => r.status === "COMPLETED"))
      ?? newestBy(researches);
    // CURRENT judgment = the ACTIVE research target's own judgment (scoped, honest).
    // The previous global-latest rule leaked the PREVIOUS run's verdict into a new run's
    // panel (observed live: a TSLA research displayed the prior BTC run's Clarity Act
    // judgment). A run with no judgment yet shows none — never a foreign verdict.
    // RUN SCOPE: the pointer is one research object, but a submission creates several; the
    // current judgment is the run's own answer-bearing conclusion, never another run's.
    const latestJudgment = activeResearchTarget === undefined
      ? undefined
      : this.runMembers(activeResearchTarget)
          .map((m) => (m.currentJudgmentRef !== undefined ? this.judgments.get(m.currentJudgmentRef) : undefined))
          .find((j): j is Judgment => j !== undefined && j.status === "ACTIVE" && j.researchRef !== undefined
            && this.runMembers(activeResearchTarget).some((m) => m.id === j.researchRef));
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
      currentResearchRunId: activeResearchTarget?.id,
      activeBranch: [...this.listBranches()].reverse()[0],
      // CURRENT evidence = the CURRENT run's evidence (RUN SCOPE). The previous global
      // "latest ten evidence objects in the workspace" surfaced OTHER runs' observations in
      // the current research panel, which is how a fresh 09:xx retrieval appeared beside a
      // 07:xx observation from an earlier run. With no current run there is no current
      // evidence — never a global fallback.
      recentEvidence: activeResearchTarget === undefined ? [] : [...this.evidenceForRun(activeResearchTarget)],
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
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      judgments: this.listJudgments(),
      branches: this.listBranches(),
      theses: this.listTheses(),
      savedArtifacts: this.listSavedArtifacts(),
      memories: this.listMemories(),
      monitors: this.listMonitors(),
      thesisAssessments: this.listThesisAssessments(),
      ...(this.challenges.size > 0 ? { challenges: this.listChallenges() } : {}),
      ...(this.monitoringAssessments.size > 0 ? { monitoringAssessments: this.listMonitoringAssessments() } : {}),
      ...(this.notifications.size > 0 ? { monitorNotifications: this.listNotifications() } : {}),
      ...(this.savedTombstones.size > 0 ? { savedTombstones: this.listSavedTombstones() } : {}),
      // M6 (audit D1): the trader's explicit selection is working state and must round-trip.
      ...(this.activeThesisId !== undefined ? { activeThesisId: this.activeThesisId } : {}),
      // Conversational workbench: investigations + turns round-trip so a thread survives a
      // restart and a refresh exactly as research does.
      ...(this.investigations.size > 0 ? { investigations: this.listInvestigations() } : {}),
      ...(this.conversationTurns.size > 0 ? { conversationTurns: this.listConversationTurns() } : {}),
      ...(this.currentInvestigationId !== undefined ? { currentInvestigationId: this.currentInvestigationId } : {}),
      ...(this.researchResponses.size > 0
        ? { researchResponses: [...this.researchResponses.entries()].map(([researchId, response]) => ({ researchId, response })) }
        : {}),
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
    // Phase D: normalize legacy theses (supply the Phase D collections/userConfirmed); no
    // migration write, the record is preserved verbatim otherwise.
    for (const t of snap.theses ?? []) ws.theses.set(t.id, normalizeThesis(t));
    // Phase C: normalize legacy artifacts (no kind/title/tags) on load; restore unsave tombstones.
    for (const a of snap.savedArtifacts ?? []) ws.savedArtifacts.set(a.id, normalizeSavedArtifact(a));
    // TOMBSTONE COUNTER CONTINUITY (see absorbSavedState): tombstoned ids must never be
    // re-minted after a cold start either, or the wedged create-invisible cycle restarts.
    for (const t of snap.savedTombstones ?? []) {
      ws.savedTombstones.set(t.id, t.at);
      bumpIdCounterPastId(t.id);
    }
    for (const id of ws.savedTombstones.keys()) ws.savedArtifacts.delete(id);
    for (const m of snap.memories ?? []) ws.memories.set(m.id, m);
    for (const m of snap.monitors ?? []) ws.monitors.set(m.id, m);
    for (const a of snap.thesisAssessments ?? []) ws.thesisAssessments.push(a);
    for (const c of snap.challenges ?? []) {
      const normalized = normalizeChallenge(c);
      ws.challenges.set(normalized.id, normalized);
      bumpIdCounterPastId(normalized.id); // counter continuity for the ch_ prefix
    }
    for (const a of snap.monitoringAssessments ?? []) {
      ws.monitoringAssessments.set(a.id, a);
      bumpIdCounterPastId(a.id); // mk_ counter continuity
    }
    for (const n of snap.monitorNotifications ?? []) {
      ws.notifications.set(n.id, n);
      bumpIdCounterPastId(n.id); // nt_ counter continuity
    }
    for (const r of snap.researchResponses ?? []) ws.researchResponses.set(r.researchId, r.response);
    if (snap.activeThesisId !== undefined) ws.activeThesisId = snap.activeThesisId;
    for (const inv of snap.investigations ?? []) ws.investigations.set(inv.id, inv);
    for (const t of snap.conversationTurns ?? []) ws.conversationTurns.set(t.id, t);
    if (snap.currentInvestigationId !== undefined) ws.currentInvestigationId = snap.currentInvestigationId;
    // Counter continuity (persistence law): a restored graph must never re-mint existing ids.
    // Without this, a server restart OVERWROTE persisted objects (fresh process → rs_000001 again).
    seedIdCountersFromIds([
      ...snap.researches, ...snap.sources, ...snap.evidence, ...snap.claims, ...snap.hypotheses,
      ...snap.analyses, ...snap.judgments, ...snap.branches, ...(snap.theses ?? []),
      ...(snap.savedArtifacts ?? []), ...(snap.memories ?? []), ...(snap.monitors ?? []),
      // Counter continuity for the conversational prefixes (inv_ / tn_): a cold process must
      // never re-mint an investigation or turn id that already exists in the loaded thread.
      ...(snap.investigations ?? []), ...(snap.conversationTurns ?? []),
    ].map((o) => o?.id).filter((id): id is string => typeof id === "string"));
    // RUN-IDENTITY CONTINUITY (audit B1): a run id is NOT an object id — it exists only as
    // `Research.runId` — so the seeding above never sees one and the run counter restarted at 1
    // on every cold process. Unrelated submissions were then stamped with the same run id and
    // merged into ONE history entry (production: one "run" held 85 research objects from many
    // submissions, pairing a question with another run's answer). New run ids also carry a
    // per-invocation token, so uniqueness no longer depends on this counter; seeding keeps the
    // readable numeric part monotonic across restarts.
    for (const id of snap.researches.map((r) => r?.runId)) {
      const parsed = typeof id === "string" ? /^run_(\d+)/.exec(id) : null;
      if (parsed !== null) bumpIdCounterPast(idPrefixes.run, Number(parsed[1]));
    }
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

export { createResearch, createBranch, createClaim, createEvidence, createHypothesis, createAnalysis, createJudgment, createSource, createThesis, reviseThesis, createSavedArtifact, isSavedKind };

/**
 * Identity of the RUN a research object belongs to, as a group key.
 *
 * A run is (runId, verbatim question): the question comes from the same submission context
 * that stamped the run id, so members of one submission always agree on both. The question
 * is part of the key because legacy data contains run ids that were NOT unique — the run
 * counter restarted at 1 on every cold process (a run id is never an object id, so it was
 * never seeded), which stamped unrelated submissions with the same `run_000001`. Grouping on
 * the id alone merged those submissions. Legacy objects without a run id stay their own entry.
 *
 * The authoritative RUN for ownership purposes is the submission run; the research OBJECT id
 * is the research run id carried on evidence and judgments.
 */
export function runKeyOf(r: Research): string {
  return r.runId === undefined ? `solo:${r.id}` : `${r.runId}\u0000${r.userQuestion ?? ""}`;
}

/**
 * Evidence refs a judgment basis named but this run does not own, reported for the audit
 * trail (a stripped cross-run citation is recorded, never silently dropped).
 */
function countDropped(refs: readonly string[] | undefined, owned: ReadonlySet<string>): string[] {
  return (refs ?? []).filter((ref) => !owned.has(ref));
}

/**
 * Recency comparison for absorbThesisState (mirrors mergeSnapshots' per-object law).
 * Provenance is append-only and every mutation appends, so MORE provenance entries = later
 * state; equal history keeps the existing side (in-flight local writes win). Ties broken by
 * the independent version counter and then by updatedAt, both monotonic.
 */
function thesisIsNewer(candidate: Thesis, existing: Thesis): boolean {
  if (candidate.provenance.length !== existing.provenance.length) {
    return candidate.provenance.length > existing.provenance.length;
  }
  if (candidate.version !== existing.version) return candidate.version > existing.version;
  return candidate.updatedAt > existing.updatedAt;
}

/**
 * Recency comparison for absorbExecutionState (mirrors mergeSnapshots' per-object law):
 * provenance is append-only and every mutation appends, so MORE entries = later state.
 * Tolerates snapshot objects whose provenance was optional in legacy records.
 */
function revisionsOf(o: { provenance?: readonly unknown[] }): number {
  return o.provenance?.length ?? 0;
}

/**
 * Union two append-only ref lists, preserving ORDER (conversation order is the record) and
 * never repeating a ref. Mirrors `unionRefs` in domain/merge.ts, which unions on the
 * persistence path; this one unions on the warm-instance absorption path. Neither can invent a
 * ref (only recorded ones are unioned) and neither can drop one.
 */
function unionRefs(local: readonly string[] | undefined, remote: readonly string[] | undefined): readonly string[] {
  const out: string[] = [...(local ?? [])];
  const seen = new Set(out);
  for (const ref of remote ?? []) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return Object.freeze(out);
}

/**
 * Monotonic timestamp of a research object for CURRENT selection: the provenance tail's
 * timestamp (every lifecycle mutation appends a provenance entry), else the empty string
 * (objects without provenance sort last and never win CURRENT).
 */
function researchTimestamp(r: { readonly provenance?: readonly { readonly at?: string }[] }): string {
  const last = r.provenance?.[r.provenance.length - 1]?.at;
  return typeof last === "string" ? last : "";
}

/**
 * CREATION timestamp of a research object: the head of its provenance trail, recorded when
 * the run was created and never rewritten. This is what CURRENT selection ranks by, so a run
 * that finishes late cannot displace the run the trader actually submitted last.
 */
function researchCreatedAt(r: { readonly provenance?: readonly { readonly at?: string }[] }): string {
  const first = r.provenance?.[0]?.at;
  if (typeof first === "string") return first;
  return researchTimestamp(r);
}
