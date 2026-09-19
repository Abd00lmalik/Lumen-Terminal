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
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { ProgressListener } from "../research/progress.js";
import {
  evidenceToDTO, evidenceSummaryDTO, judgmentToDTO, researchToDTO, continuitySnapshotToDTO,
  thesisToDTO, thesisAssessmentToDTO, artifactToDTO, memoryToDTO, monitorToDTO,
  toHistoricalAnalysisDTO, uiText,
  type ResearchResponseDTO, type AnswerDTO, type EvidenceDTO, type JudgmentDTO,
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

  /** Persist the workspace; a store failure surfaces honestly (never reported as success). */
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
    try {
      // Honest wall-clock budget: finish (and persist) before the caller's execution window
      // expires so a run always delivers its real state instead of dying mid-flight. Sized for
      // the 300s serverless function ceiling; local dev keeps the same contract.
      const deadlineMs = Date.now() + 270_000;
      result = await this.engine().handle(trimmed, origin, onProgress, deadlineMs);
    } catch (cause) {
      // The engine itself failing (vs the LUI's internal typed model failures) is unexpected.
      throw new ModelFailureError({ type: "PROVIDER_UNAVAILABLE", message: cause instanceof Error ? cause.message : String(cause) });
    }

    // Persist when the request mutated the graph. The LUI does not persist; the application
    // layer owns it (same store the engine uses).
    const mutated = result.research !== undefined || result.saved !== undefined || result.memory !== undefined
      || result.monitor !== undefined || result.activatedMonitor !== undefined || result.stateChange !== undefined
      || result.flow2 !== undefined || result.flow3 !== undefined || result.flow4 !== undefined
      || result.flow6 !== undefined || result.flow7 !== undefined || result.flow8 !== undefined
      || result.thesisAssessment !== undefined;
    if (mutated) await this.persist();

    return this.toResponseDTO(crypto.randomUUID(), result, submittedQuestion);
  }

  /** Map a LuiResult into the safe response DTO (epistemic status preserved as data). */
  private toResponseDTO(requestId: string, result: LuiResult, submittedQuestion: string): ResearchResponseDTO {
    const ws = this.ws();
    const answer: AnswerDTO = result.rejected !== undefined
      ? {
          answer: result.response?.answer ?? "Request rejected: execution-like commands cannot run in this research-only workbench.",
          supportingReasons: [],
          opposingReasons: [],
          confidence: "UNKNOWN",
          keyUncertainty: "",
          implication: "Rephrase as a research question if you want analysis on this topic.",
          citedObjectRefs: [],
        }
      : {
          answer: uiText(result.response?.answer ?? ""),
          supportingReasons: result.response?.supportingReasons.map(uiText) ?? [],
          opposingReasons: result.response?.opposingReasons.map(uiText) ?? [],
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
    // Honest outcome mapping: a pure interpretation failure (no research ran) is a MODEL_FAILURE;
    // a run that completed research but ended on a model failure is a partial COMPLETED with the
    // typed failure attached (the LUI's law: failure ≠ fabricated evidence, partial ≠ false success).
    const ranResearch = researchRef !== undefined;
    const outcome: ResearchResponseDTO["outcome"] =
      result.rejected !== undefined ? "REJECTED"
      : result.awaitingConfirmation !== undefined ? "AWAITING_CONFIRMATION"
      : result.modelFailure !== undefined && !ranResearch ? "MODEL_FAILURE"
      : "COMPLETED";

    const response: ResearchResponseDTO = {
      requestId,
      action: result.request.primaryAction,
      outcome,
      answer,
      ...(result.modelFailure !== undefined ? { modelFailure: { type: result.modelFailure.type, message: result.modelFailure.message } } : {}),
      limitations,
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
    // Archive completed runs for history hydration (bounded to the last 25).
    if (outcome === "COMPLETED" && researchRef !== undefined) {
      this.responseArchive.set(researchRef, { response, question: submittedQuestion });
      while (this.responseArchive.size > 25) {
        const oldest = this.responseArchive.keys().next().value;
        if (oldest === undefined) break;
        this.responseArchive.delete(oldest);
      }
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

  /** Research history: explicit status fields; the client never infers staleness/currentness. */
  listResearch() {
    return this.ws().listResearch().map((r) => ({
      ...researchToDTO(r),
      isCurrent: r.id === this.ws().getContinuitySnapshot().activeResearchTarget?.id,
    }));
  }

  getResearch(ref: string) {
    const r = this.ws().getResearch(ref);
    if (r === undefined) throw new NotFoundError("research");
    // Full response hydration: when this instance completed the run, serve the archived
    // response DTO (answer, reasons, evidence) so the frontend history renders past runs
    // verbatim instead of the bare research summary.
    const archived = this.responseArchive.get(ref);
    if (archived !== undefined) return archived.response;
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
