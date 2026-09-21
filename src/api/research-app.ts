/**
 * F0 Research Application Service; the seam between HTTP and the engine (F0 mandate §2).
 *
 * This layer contains NO research logic. It:
 * - validates transport input,
 * - derives the (stubbed) trader origin server-side; never from the client,
 * - calls `Lui.handle` (the existing LUI/engine boundary) for research requests,
 * - persists the workspace through the existing WorkspaceStore exactly where the engine's
 *   mutation paths ended (the LUI deliberately does not persist itself),
 * - maps the LuiResult into safe DTOs.
 *
 * It never: selects flows, picks tools, calls the model directly, fabricates evidence,
 * mutates thesis/monitor/memory state around the authorization boundary, or executes trades.
 */

import { Lui, type LuiResult } from "../lui/lui.js";
import type { ModelProvider } from "../model/provider.js";
import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import type { WorkspaceStore } from "../persistence/index.js";
import { Workspace, type WorkspaceSnapshot } from "../domain/workspace.js";
import { newId, idPrefixes } from "../domain/ids.js";
import { beginRun, endRun } from "../domain/run-context.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { ProgressListener } from "../research/progress.js";
import {
  evidenceToDTO, evidenceSummaryDTO, judgmentToDTO, researchToDTO, continuitySnapshotToDTO,
  thesisToDTO, thesisAssessmentToDTO, artifactToDTO, memoryToDTO, monitorToDTO,
  toHistoricalAnalysisDTO, uiText,
  type ResearchResponseDTO, type ResearchDiagnosticsDTO, type RequirementDiagnosticDTO, type AnswerDTO, type EvidenceDTO, type JudgmentDTO,
} from "./dto.js";
import { InvalidRequestError, ModelFailureError, PersistenceFailureError, NotFoundError } from "./errors.js";

/** F0 session stub (FRONTEND_ARCHITECTURE.md §18): one local trader identity, server-side only. */
export const TRADER_ORIGIN: ProvenanceOrigin = { kind: "trader", detail: "F0 API session (local trader identity)" };

export interface ResearchAppOptions {
  readonly provider: ModelProvider;
  readonly registry: CapabilityRegistry;
  readonly store: WorkspaceStore;
  /** Initial workspace when the store is empty (fresh sessions). */
  readonly workspace?: Workspace;
}

/**
 * The application boundary the routes talk to. Holds one workspace (loaded from the store at
 * construction) and the engine wiring; every mutation flows through the engine/domain; the
 * service itself only validates input and persists.
 */
export class ResearchApp {
  private lui?: Lui;
  /** Completed-run response archive (ref -> response DTO): lets history hydrate the FULL
   *  answer of a past run without re-running it. Bounded FIFO; warm-instance scope that
   *  becomes durable wherever the store is durable (Blob/File). */
  private responseArchive = new Map<string, { response: ResearchResponseDTO; question: string }>();

  constructor(
    public readonly options: ResearchAppOptions,
    private workspace: Workspace | undefined,
  ) {}

  static async create(options: ResearchAppOptions): Promise<ResearchApp> {
    let workspace: Workspace | undefined;
    try {
      workspace = await options.store.load();
    } catch (cause) {
      throw new PersistenceFailureError(cause);
    }
    const app = new ResearchApp(options, workspace ?? options.workspace);
    // Sweep only a RESTORED graph; a fresh in-memory workspace has nothing interrupted.
    if (workspace !== undefined) await app.sweepInterruptedResearch(workspace);
    return app;
  }

  /**
   * Startup sweep: research objects left ACTIVE by a process that died mid-run are marked
   * STOPPED with an honest note (the run did not complete; nothing is fabricated to "finish"
   * it). Without this, an interrupted run sits ACTIVE forever and misleads the UI. Persisted
   * only when the sweep actually changed something.
   */
  private async sweepInterruptedResearch(workspace: Workspace): Promise<void> {
    const now = new Date();
    const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "startup sweep: prior process did not complete this run" };
    let changed = false;
    for (const r of workspace.listResearch()) {
      if (r.status !== "ACTIVE" || r.judgmentRefs.length > 0) continue;
      workspace.transitionResearch(r.id, "STOPPED", systemOrigin, "run interrupted by a process restart before any judgment was recorded", now);
      changed = true;
    }
    if (changed) {
      try {
        await this.options.store.save(workspace.toSnapshot());
      } catch (cause) {
        throw new PersistenceFailureError(cause);
      }
    }
  }

  /** The live workspace (local-knowledge accessor; session-scoped state). */
  getWorkspace(): Workspace {
    return this.ws();
  }

  private ws(): Workspace {
    if (this.workspace === undefined) {
      throw new NotFoundError("workspace (no session initialized; POST /api/session first)");
    }
    return this.workspace;
  }

  private engine(): Lui {
    this.lui ??= new Lui({
      provider: this.options.provider,
      workspace: this.ws(),
      store: this.options.store,
      registry: this.options.registry,
    });
    return this.lui;
  }

  /** Persist the workspace; a store failure surfaces honestly (never reported as success).
   *  MERGE-BEFORE-WRITE (multi-instance law): our in-memory graph may be stale — another
   *  serverless instance can have completed runs and advanced the blob since we loaded.
   *  Overwriting blindly ERASED those runs (observed live: history shrank between reads
   *  and fresh answers degraded to bare summaries). The store re-reads current state via
   *  save()'s merge hook; the union wins by per-object updatedAt (last-write-wins per
   *  object, never per snapshot). */
  private async persist(): Promise<void> {
    try {
      await this.options.store.save(this.ws().toSnapshot());
    } catch (cause) {
      throw new PersistenceFailureError(cause);
    }
  }

  // ------------------------------------------------------------------
  // Research request (natural language; flow selection stays with the LUI)
  // ------------------------------------------------------------------

  /**
   * Submit a natural-language research request. The client sends ONLY a message; never a flow
   * name. `onProgress` receives REAL lifecycle events (threaded through the engine); when the
   * caller (route) supplies one, the route streams them as SSE.
   *
   * `confirmed` mirrors the frontend's explicit confirmation dialog (F0 mandate §12): SAVE/
   * MONITOR steps remain gated by the LUI's authorization boundary; an unconfirmed request
   * halts at AWAITING_CONFIRMATION persisting NOTHING; with the explicit confirmation flag the
   * origin records the trader's authorization and the LUI still validates trader kind before
   * persisting. There is no HTTP shortcut around the boundary.
   */
  async submitResearchRequest(
    message: string,
    onProgress?: ProgressListener,
    confirmed = false,
  ): Promise<ResearchResponseDTO> {
    const trimmed = typeof message === "string" ? message.trim() : "";
    if (trimmed.length === 0) {
      throw new InvalidRequestError("message is required and must be a non-empty string");
    }
    if (trimmed.length > 8000) {
      throw new InvalidRequestError("message exceeds the 8000-character limit");
    }
    const submittedQuestion = trimmed;
    if (typeof confirmed !== "boolean") {
      throw new InvalidRequestError("" + "confirmed must be a boolean when present");
    }

    const origin: ProvenanceOrigin = {
      kind: "trader",
      detail: confirmed
        ? "F0 API session (local trader identity); explicit trader confirmation: confirmed"
        : "F0 API session (local trader identity)",
    };
    let result: LuiResult;
    // One user submission = one research RUN: every Research object this submission creates
    // (plan steps, flow phases) is stamped with this run id and the trader's verbatim
    // question, so history shows ONE entry per question (run-context.ts).
    beginRun({ runId: newId(idPrefixes.run), userQuestion: submittedQuestion });
    try {
      // Honest wall-clock budget: finish (and persist) before the caller's execution window
      // expires so a run always delivers its real state instead of dying mid-flight. Sized for
      // the 300s serverless function ceiling; local dev keeps the same contract.
      const deadlineMs = Date.now() + 270_000;
      result = await this.engine().handle(trimmed, origin, onProgress, deadlineMs);
    } catch (cause) {
      // The engine itself failing (vs the LUI's internal typed model failures) is unexpected.
      throw new ModelFailureError({ type: "PROVIDER_UNAVAILABLE", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      endRun();
    }

    // Persist when the request mutated the graph. The LUI does not persist; the application
    // layer owns it (same store the engine uses).
    const mutated = result.research !== undefined || result.saved !== undefined || result.memory !== undefined
      || result.monitor !== undefined || result.activatedMonitor !== undefined || result.stateChange !== undefined
      || result.flow2 !== undefined || result.flow3 !== undefined || result.flow4 !== undefined
      || result.flow6 !== undefined || result.flow7 !== undefined || result.flow8 !== undefined
      || result.thesisAssessment !== undefined;
    if (mutated) await this.persist();

    return await this.toResponseDTO(crypto.randomUUID(), result, submittedQuestion);
  }

  /** Map a LuiResult into the safe response DTO (epistemic status preserved as data). */
  private async toResponseDTO(requestId: string, result: LuiResult, submittedQuestion: string): Promise<ResearchResponseDTO> {
    const ws = this.ws();
    // COUNTEREVIDENCE STATUS (coverage contract): the engine attempts disconfirmation itself
    // (the FALSIFICATION capability is part of the capability floor), so the answer can state
    // whether opposing evidence was found, was searched for and not found, or was never
    // attempted — instead of an empty opposition list that reads as balance it never had.
    const executionsOf = (outcome: unknown): readonly { readonly capability: string }[] =>
      outcome !== null && typeof outcome === "object" && Array.isArray((outcome as { executions?: unknown }).executions)
        ? ((outcome as { executions: readonly { capability: string }[] }).executions)
        : [];
    const falsificationAttempted = [
      result.research,
      result.flow2?.outcome, result.flow3?.outcome, result.flow4?.outcome,
      result.flow5?.outcome, result.flow6?.outcome, result.flow7?.outcome, result.flow8?.outcome,
    ].some((outcome) => executionsOf(outcome).some((e) => e.capability === "FALSIFICATION"));
    const answer: AnswerDTO = result.rejected !== undefined
      ? {
          answer: result.response?.answer ?? "Request rejected: execution-like commands cannot run in this research-only workbench.",
          supportingReasons: [],
          opposingReasons: [],
          counterevidenceStatus: "NOT_ASSESSED",
          confidence: "UNKNOWN",
          keyUncertainty: "",
          implication: "Rephrase as a research question if you want analysis on this topic.",
          citedObjectRefs: [],
        }
      : {
          answer: uiText(result.response?.answer ?? ""),
          supportingReasons: result.response?.supportingReasons.map(uiText) ?? [],
          opposingReasons: result.response?.opposingReasons.map(uiText) ?? [],
          counterevidenceStatus:
            (result.response?.opposingReasons.length ?? 0) > 0 ? "PRESENT" : falsificationAttempted ? "NONE_FOUND" : "NOT_ASSESSED",
          confidence: result.response?.confidence ?? "UNKNOWN",
          keyUncertainty: uiText(result.response?.keyUncertainty ?? ""),
          implication: uiText(result.response?.implication ?? ""),
          citedObjectRefs: [...(result.response?.citedObjectRefs ?? [])],
        };

    // Evidence + judgments exposed with epistemic classes intact (observation ≠ interpretation
    // ≠ proxy ≠ speculation). Limitations surface exactly what the research could not do.
    const evidence: EvidenceDTO[] = [];
    const judgments: JudgmentDTO[] = [];
    let researchRef: string | undefined;
    if (result.research !== undefined) {
      researchRef = result.research.research.id;
      for (const e of result.research.evidence) {
        const domain = ws.getEvidence(e.id) ?? e;
        evidence.push(evidenceToDTO(domain));
      }
      judgments.push(...judgmentsForResearch(ws, researchRef));
    }
    for (const flowOutcome of [
      result.flow2?.outcome, result.flow3?.outcome, result.flow4?.outcome,
      result.flow5?.outcome, result.flow6?.outcome, result.flow7?.outcome, result.flow8?.outcome,
    ]) {
      if (flowOutcome === undefined) continue;
      researchRef ??= flowOutcome.researchId;
      for (const e of flowOutcome.evidence) {
        if (!evidence.some((d) => d.ref === e.id)) evidence.push(evidenceToDTO(ws.getEvidence(e.id) ?? e));
      }
      const flowJudgments = judgmentsForResearch(ws, flowOutcome.researchId);
      for (const j of flowJudgments) if (!judgments.some((d) => d.ref === j.ref)) judgments.push(j);
    }

    const limitations = collectLimitations(result).map(uiText);
    // GAP SEPARATION (research contract §3): capability gaps (provider outages, fallbacks,
    // schema notes) are diagnostics; RESEARCH GAPS (a CRITICAL requirement the run could not
    // satisfy after recovery) are the only material coverage information a trader needs.
    // Engine-assessed, phrased as the requirement, never as provider accounting.
    const researchGaps = (result.research?.requirements ?? [])
      .filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED")
      .map((r) =>
        r.status === "PARTIALLY_SATISFIED"
          ? `${r.description}: only evidence outside the required time horizon was found`
          : r.status === "EXHAUSTED" || r.status === "UNAVAILABLE"
            ? `${r.description}: could not be established after the available research paths were exhausted`
            : `${r.description}: not established by the collected evidence`,
      )
      .slice(0, 5);
    // BENCHMARK VISIBILITY (coverage contract): structured facts an external benchmark can
    // score without reading model reasoning — the requirement ledger, what each capability
    // actually returned, what the engine's floor added, and the completion gates. Execution
    // metadata and provenance only.
    //
    // A single request may run SEVERAL research objects (the LUI's own dispatch plus the flow
    // it routed to), and the evidence lives on whichever object retrieved it — reporting only
    // the first object stated "0 evidence" for capabilities that had produced nine and sixteen
    // observations. The surface aggregates every outcome the request produced.
    // KNOWN GAP (recorded, not papered over): the flow runner keeps no requirement ledger, so
    // a request that routes to a flow contributes its EXECUTIONS and gate here but not its
    // requirements — only the adaptive loop's ledger is engine-owned today.
    interface OutcomeLike {
      readonly executions?: readonly {
        readonly round: number;
        readonly capability: string;
        readonly result: { readonly tool: string; readonly completeness: string; readonly failure?: { readonly type: string } };
        readonly evidenceIds: readonly string[];
      }[];
      readonly stoppedBecause?: string;
      readonly requirements?: readonly {
        readonly id: string; readonly description: string; readonly importance: string; readonly timeSensitivity: string;
        readonly status: string; readonly evidenceRefs: readonly string[]; readonly staleOnlyRefs: readonly string[];
        readonly recoveryAttempts: number; readonly missingReason?: string;
      }[];
      readonly floorCapabilities?: readonly string[];
      readonly recoveryRounds?: number;
    }
    const loopOutcomes = [
      result.research,
      result.flow2?.outcome, result.flow3?.outcome, result.flow4?.outcome,
      result.flow5?.outcome, result.flow6?.outcome, result.flow7?.outcome, result.flow8?.outcome,
    ]
      .filter((outcome): outcome is NonNullable<typeof outcome> => outcome !== undefined)
      .map((outcome) => outcome as unknown as OutcomeLike);
    const executionRecords = loopOutcomes.flatMap((o) => o.executions ?? []);
    const requirementLedger = loopOutcomes.flatMap((o) => o.requirements ?? []);
    const evidenceCount = evidence.length;
    const researchDiagnostics: ResearchDiagnosticsDTO | undefined =
      loopOutcomes.length === 0
        ? undefined
        : (() => {
            const seen = new Set<string>();
            const requirements: RequirementDiagnosticDTO[] = [];
            for (const r of requirementLedger) {
              const key = `${r.description}`;
              if (seen.has(key)) continue; // the same requirement can appear on more than one outcome
              seen.add(key);
              requirements.push({
                description: r.description,
                importance: r.importance,
                timeSensitivity: r.timeSensitivity,
                status: r.status,
                evidenceCount: r.evidenceRefs.length,
                staleEvidenceCount: r.staleOnlyRefs.length,
                recoveryAttempts: r.recoveryAttempts,
                ...(r.missingReason !== undefined ? { unresolvedReason: r.missingReason } : {}),
              });
            }
            const critical = requirements.filter((r) => r.importance === "CRITICAL");
            const satisfied = critical.filter((r) => r.status === "SATISFIED").length;
            const gates = [...new Set(loopOutcomes.map((o) => o.stoppedBecause ?? "UNKNOWN"))];
            const allCriticalCovered = critical.length > 0 && satisfied === critical.length;
            return {
              requirements,
              executions: executionRecords.map((e) => ({
                round: e.round,
                capability: e.capability,
                provider: e.result.tool,
                completeness: e.result.completeness,
                failureType: e.result.failure?.type ?? "NONE",
                evidenceCount: e.evidenceIds.length,
              })),
              floorCapabilities: [...new Set(loopOutcomes.flatMap((o) => o.floorCapabilities ?? []))],
              recoveryRounds: Math.max(...loopOutcomes.map((o) => o.recoveryRounds ?? 0)),
              completionGates: gates,
              completionGate: gates[gates.length - 1] ?? "UNKNOWN",
              coverage:
                allCriticalCovered && gates.every((g) => g === "EVIDENCE_SUFFICIENT")
                  ? "COMPLETE"
                  : evidenceCount === 0 || satisfied === 0
                    ? "INSUFFICIENT"
                    : "PARTIAL",
            };
          })();
    // Honest outcome mapping: a pure interpretation failure (no research ran) is a MODEL_FAILURE;
    // a run that completed research but ended on a model failure is a partial COMPLETED with the
    // typed failure attached (the LUI's law: failure ≠ fabricated evidence, partial ≠ false success).
    const ranResearch = researchRef !== undefined;
    const outcome: ResearchResponseDTO["outcome"] =
      result.rejected !== undefined ? "REJECTED"
      : result.awaitingConfirmation !== undefined ? "AWAITING_CONFIRMATION"
      : result.modelFailure !== undefined && !ranResearch ? "MODEL_FAILURE"
      : "COMPLETED";

    // JUDGMENT BACKSTOP (completion law): a completed run is not complete until its
    // conclusion exists as a judgment. Flows normally mint one; if none was linked
    // (flow path skipped it, or a prior instance's write was lost in a merge), the
    // run's validated answer IS the judgment — mint it deterministically. Without this
    // a completed run later hydrates as a judgmentless bare summary.
    if (outcome === "COMPLETED" && researchRef !== undefined && answer !== undefined) {
      const minted = ensureRunJudgment(
        ws,
        researchRef,
        answer,
        { kind: "agent", detail: "completion backstop: validated answer recorded as the run judgment" },
      );
      if (minted !== undefined && !judgments.some((d) => d.ref === minted.ref)) judgments.push(minted);
    }

    const response: ResearchResponseDTO = {
      requestId,
      action: result.request.primaryAction,
      outcome,
      answer,
      ...(result.modelFailure !== undefined ? { modelFailure: { type: result.modelFailure.type, message: result.modelFailure.message } } : {}),
      limitations,
      researchGaps,
      ...(researchDiagnostics !== undefined ? { researchDiagnostics } : {}),
      ...(researchRef !== undefined ? { researchRef } : {}),
      evidenceRefs: evidence.map((e) => e.ref),
      ...(judgments.length > 0 ? { judgmentRef: judgments[judgments.length - 1]!.ref } : {}),
      evidence,
      judgments,
      // Flow 5 structured historical analysis (server-computed; §8D; the frontend renders,
      // never derives): mapped only when this request ran the historical-comparison flow.
      ...(result.flow5?.historicalAnalysis !== undefined
        ? { historicalAnalysis: toHistoricalAnalysisDTO(result.flow5.historicalAnalysis) }
        : {}),
    };
    // Persist completed runs for history hydration: the response goes into the workspace
    // graph (so the NEXT store.save round-trips it to any instance) AND the in-memory
    // archive (so the completing instance serves it without a store read).
    if (outcome === "COMPLETED" && researchRef !== undefined) {
      this.responseArchive.set(researchRef, { response, question: submittedQuestion });
      while (this.responseArchive.size > 25) {
        const oldest = this.responseArchive.keys().next().value;
        if (oldest === undefined) break;
        this.responseArchive.delete(oldest);
      }
      ws.saveResearchResponse(researchRef, response);
      await this.persist();
    }
    return response;
  }

  // ------------------------------------------------------------------
  // Reads (safe DTOs over the existing workspace aggregate)
  // ------------------------------------------------------------------

  sessionSnapshot() {
    return { workspaceReady: true, continuity: this.continuity() };
  }

  continuity() {
    return continuitySnapshotToDTO(this.ws().getContinuitySnapshot());
  }

  /**
   * Research history: ONE entry per user submission, never one per internal plan step.
   *
   * A single trader question spawns several internal Research objects (action-plan steps,
   * flow phases) whose question text is an internal objective ("Gather current market news
   * ...", "Synthesize the gathered factors ..."). Listing those as top-level history made
   * one question look like several. Members of a run group under the run's answer-bearing
   * object, shown under the trader's verbatim question; the other members are exposed as
   * `internalRefs` children. Legacy objects without a runId keep their own entry (history is
   * never rewritten, only presented correctly). Explicit status fields; the client never
   * infers staleness/currentness.
   */
  listResearch() {
    const all = this.ws().listResearch();
    const activeId = this.ws().getContinuitySnapshot().activeResearchTarget?.id;
    const groups = new Map<string, (typeof all)[number][]>();
    const order: string[] = [];
    for (const r of all) {
      const key = r.runId ?? `solo:${r.id}`;
      const bucket = groups.get(key);
      if (bucket === undefined) {
        groups.set(key, [r]);
        order.push(key);
      } else {
        bucket.push(r);
      }
    }
    return order.map((key) => {
      const members = groups.get(key)!;
      // Representative: the member that carries the run's answer (its judgment), else the
      // most recent member. Its ref stays hydratable through getResearch.
      const representative = [...members].reverse().find((m) => m.currentJudgmentRef !== undefined)
        ?? members[members.length - 1]!;
      const internalRefs = members.filter((m) => m.id !== representative.id).map((m) => m.id);
      return {
        ...researchToDTO(representative),
        ...(representative.userQuestion !== undefined ? { question: representative.userQuestion } : {}),
        ...(internalRefs.length > 0 ? { internalRefs } : {}),
        isCurrent: members.some((m) => m.id === activeId),
      };
    });
  }

  getResearch(ref: string) {
    const r = this.ws().getResearch(ref);
    if (r === undefined) throw new NotFoundError("research");
    // Full response hydration, three tiers: in-memory archive (this instance completed
    // the run) -> workspace-persisted response (restored from the store: any instance can
    // serve history verbatim) -> bare research summary (genuinely old entry).
    //
    // RUN-AWARE: one submission creates several Research objects (plan steps), and the answer
    // is persisted against the run's ANSWER-bearing member, which is not necessarily the ref
    // the history entry exposes. Hydration therefore checks the whole run group, so clicking
    // a history entry always yields the run's real answer instead of a bare summary.
    const candidates = r.runId !== undefined
      ? this.ws().listResearch().filter((m) => m.runId === r.runId).map((m) => m.id)
      : [ref];
    for (const id of candidates) {
      const archivedHit = this.responseArchive.get(id);
      if (archivedHit !== undefined) return archivedHit.response;
      const persistedHit = this.ws().getResearchResponse(id);
      if (persistedHit !== undefined && typeof persistedHit === "object" && "answer" in (persistedHit as Record<string, unknown>)) {
        return persistedHit as ResearchResponseDTO;
      }
    }
    // Legacy tier: runs completed before response persistence have no archived response,
    // but their judgment (statement, confidence, uncertainty, implications) WAS persisted.
    // Reconstruct the run's answer from that real persisted content — the user gets the
    // actual research conclusion, never a "reasoning not retained" refusal.
    // Legacy tier: the run's answer-bearing member may be another object in the same run.
    const answerMember = candidates
      .map((id) => this.ws().getResearch(id))
      .find((m) => m?.currentJudgmentRef !== undefined);
    const j = answerMember?.currentJudgmentRef !== undefined
      ? this.ws().getJudgment(answerMember.currentJudgmentRef)
      : r.currentJudgmentRef !== undefined
        ? this.ws().getJudgment(r.currentJudgmentRef)
        : undefined;
    if (j !== undefined) {
      return {
        requestId: r.id,
        action: "RESEARCH",
        outcome: "COMPLETED",
        answer: {
          answer: j.statement,
          supportingReasons: [],
          opposingReasons: [],
          confidence: j.confidence ?? "UNKNOWN",
          keyUncertainty: j.uncertainty[0] ?? "",
          implication: j.implications[0] ?? "",
          citedObjectRefs: [j.id],
        },
        limitations: [],
        researchRef: r.id,
        evidenceRefs: [...(answerMember ?? r).evidenceRefs],
        judgmentRef: j.id,
        evidence: [...(answerMember ?? r).evidenceRefs].flatMap((er) => {
          const e = this.ws().getEvidence(er);
          return e === undefined ? [] : [evidenceToDTO(e)];
        }),
        judgments: [judgmentToDTO(j)],
      };
    }
    return researchToDTO(r);
  }

  /** List view: bounded count (route applies the window) + truncated observations. */
  listEvidence() {
    return this.ws().listEvidence().map(evidenceSummaryDTO);
  }

  getEvidence(ref: string) {
    const e = this.ws().getEvidence(ref);
    if (e === undefined) throw new NotFoundError("evidence");
    return evidenceToDTO(e);
  }

  listClaims() {
    return this.ws().listClaims().map((c) => ({
      ref: c.id, statement: c.statement, type: c.type, status: c.status,
      evidenceRefs: [...c.evidenceRefs], hypothesisRefs: [...c.hypothesisRefs],
    }));
  }

  listHypotheses() {
    return this.ws().listHypotheses().map((h) => ({
      ref: h.id, statement: h.statement, type: h.type, ranking: h.ranking,
      status: h.status, evidenceRefs: [...h.evidenceRefs],
      supportingClaims: [...h.supportingClaims], contradictingClaims: [...h.contradictingClaims],
    }));
  }

  listJudgments() {
    return this.ws().listJudgments().map(judgmentToDTO);
  }

  // Thesis workspace ---------------------------------------------------

  listTheses() {
    return this.ws().listTheses().map((t) => ({ ...thesisToDTO(t), isActive: t.id === this.ws().getActiveThesis()?.id }));
  }

  getThesis(ref: string) {
    const t = this.ws().getThesis(ref);
    if (t === undefined) throw new NotFoundError("thesis");
    return { ...thesisToDTO(t), isActive: t.id === this.ws().getActiveThesis()?.id, assessments: this.ws().listThesisAssessments(ref).map(thesisAssessmentToDTO) };
  }

  /** Selection only; routed through the domain (setActiveThesis), never direct thesis mutation. */
  async selectThesis(ref: string) {
    if (typeof ref !== "string" || ref.length === 0) throw new InvalidRequestError("thesisRef is required");
    let thesis;
    try {
      thesis = this.ws().setActiveThesis(ref); // unknown refs rejected by the domain
    } catch {
      throw new NotFoundError("thesis"); // never leak internals; selection targets must exist
    }
    await this.persist(); // the trader's selection is working state and must survive restarts
    return { selected: thesis.id, thesis: thesisToDTO(thesis) };
  }

  listAssessments(thesisRef?: string) {
    return this.ws().listThesisAssessments(thesisRef).map(thesisAssessmentToDTO);
  }

  // Memory / saved artifacts -------------------------------------------

  listSavedArtifacts() {
    return this.ws().listSavedArtifacts().map(artifactToDTO);
  }

  /** Memory with explicit status; STALE/HISTORICAL are returned, never merged away. */
  listMemories() {
    return this.ws().listMemories().map(memoryToDTO);
  }

  // Monitors ------------------------------------------------------------

  listMonitors() {
    const all = this.ws().listMonitors().map(monitorToDTO);
    return {
      proposals: all.filter((m) => m.status === "PROPOSED"),
      active: all.filter((m) => m.status === "ACTIVE"),
      paused: all.filter((m) => m.status === "PAUSED"),
      stale: all.filter((m) => m.status === "STALE"),
      completed: all.filter((m) => m.status === "COMPLETED"),
    };
  }

  /**
   * Activate a monitor through the DOMAIN boundary; `activateMonitor` itself rejects
   * non-trader origins, and the API never impersonates confirmation. This endpoint exists for
   * the local single-trader MVP where the HTTP caller IS the trader; the origin records the
   * explicit confirmation context. There is still no background worker behind an ACTIVE monitor.
   */
  async activateMonitor(ref: string) {
    if (typeof ref !== "string" || ref.length === 0) throw new InvalidRequestError("monitorRef is required");
    const origin: ProvenanceOrigin = { kind: "trader", detail: "F0 API monitor activation (trader-confirmed)" };
    let monitor;
    try {
      monitor = this.ws().activateMonitor(ref, origin, "activated via F0 API with explicit trader confirmation");
    } catch {
      throw new NotFoundError("monitor");
    }
    await this.persist();
    return monitorToDTO(monitor);
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Judgment backstop (completion law): a completed research run MUST carry a judgment.
 * Flows mint one during synthesis; if the run ended without any linked judgment, the
 * run's validated answer (already schema-checked, citations dropped if invented) is the
 * conclusion and is recorded as the judgment deterministically. Idempotent: if an ACTIVE
 * judgment already exists for the run, nothing is minted. Returns the minted judgment,
 * or undefined when one already exists.
 */
export function ensureRunJudgment(
  ws: Workspace,
  researchRef: string,
  answer: AnswerDTO,
  origin: ProvenanceOrigin,
): ReturnType<typeof judgmentToDTO> | undefined {
  const research = ws.getResearch(researchRef);
  if (research === undefined) return undefined;
  if (research.currentJudgmentRef !== undefined || research.judgmentRefs.length > 0) return undefined;
  const minted = ws.addJudgment(
    {
      researchRef,
      statement: answer.answer,
      basis: {
        supportingEvidence: [...answer.citedObjectRefs],
        opposingEvidence: [...answer.opposingReasons],
        keyClaims: [...answer.supportingReasons],
        hypotheses: [],
      },
      confidence: answer.confidence === "UNKNOWN" ? "LOW" : answer.confidence,
      uncertainty: answer.keyUncertainty === "" ? [] : [answer.keyUncertainty],
      implications: answer.implication === "" ? [] : [answer.implication],
      unresolvedQuestions: [],
    },
    origin,
  );
  return judgmentToDTO(minted);
}

function judgmentsForResearch(ws: Workspace, researchRef: string): ReturnType<typeof judgmentToDTO>[] {
  const research = ws.getResearch(researchRef);
  if (research === undefined) return [];
  const refs = research.currentJudgmentRef !== undefined
    ? [research.currentJudgmentRef]
    : [...research.judgmentRefs];
  return refs
    .map((id) => ws.getJudgment(id))
    .filter((j): j is NonNullable<typeof j> => j !== undefined)
    .map(judgmentToDTO);
}

function collectLimitations(result: LuiResult): string[] {
  const out: string[] = [];
  const fromExecutions = (executions: readonly { readonly result: { readonly failure: { readonly type: string; readonly message?: string }; readonly limitations: readonly string[] } }[]) => {
    for (const ex of executions) {
      if (ex.result.failure.type !== "NONE") {
        out.push(`${ex.result.failure.type}: ${ex.result.failure.message ?? "capability execution failed"}`);
      }
      out.push(...ex.result.limitations);
    }
  };
  if (result.research !== undefined) fromExecutions(result.research.executions);
  for (const f of [result.flow2, result.flow3, result.flow4, result.flow6, result.flow7, result.flow8]) {
    if (f !== undefined) fromExecutions(f.outcome.executions);
  }
  if (result.rejected !== undefined) out.push(result.rejected.reason);
  // Executions can legitimately surface the same constraint more than once (e.g. a
  // capability retried across plan rounds); the user needs each distinct limitation once.
  return [...new Set(out)];
}

export type { WorkspaceSnapshot };
