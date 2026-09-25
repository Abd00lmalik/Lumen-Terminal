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
import type { Research } from "../domain/objects.js";
import type { SavedArtifact } from "../domain/thesis.js";
import { newId, idPrefixes } from "../domain/ids.js";
import { beginRun, endRun } from "../domain/run-context.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { ProgressListener } from "../research/progress.js";
import {
  evidenceToDTO, evidenceSummaryDTO, judgmentToDTO, researchToDTO, continuitySnapshotToDTO,
  thesisToDTO, thesisAssessmentToDTO, artifactToDTO, memoryToDTO, monitorToDTO,
  provenanceToDTO, toHistoricalAnalysisDTO, uiText,
  type ResearchResponseDTO, type ResearchDiagnosticsDTO, type RequirementDiagnosticDTO, type AnswerDTO, type EvidenceDTO, type JudgmentDTO,
  type ResearchRunSummaryDTO, type ResearchRunAggregateDTO, type ResearchRecordTierDTO,
} from "./dto.js";
import { InvalidRequestError, ModelFailureError, PersistenceFailureError, NotFoundError } from "./errors.js";
import { renderConfidence, type ConfidenceComponents } from "../research/confidence.js";
import { questionTypeOf } from "../research/requirements.js";

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
    //
    // IDENTITY LAW (audit B1, found in production): the numeric prefix ALONE is not unique.
    // Counters are seeded from the ids in the snapshot the instance loaded, and a run id is
    // never an object id — so two serverless instances (or two cold starts) both minted
    // `run_000001` for different submissions. Production evidence: one "run" held 85 research
    // objects from many submissions, so a history entry could pair one submission's question
    // with another submission's answer. The per-invocation token makes a run id globally
    // unique; the readable prefix is kept for logs.
    beginRun({ runId: `${newId(idPrefixes.run)}-${crypto.randomUUID().slice(0, 8)}`, userQuestion: submittedQuestion });
    try {
      // Honest wall-clock budget: finish (and persist) before the caller's execution window
      // expires so a run always delivers its real state instead of dying mid-flight. Sized for
      // the 300s serverless function ceiling; local dev keeps the same contract.
      // PLATFORM-BOUNDED BUDGET: the function limit is 300s (vercel.json), so the research budget
      // must leave room for the last capability wave to FINISH plus the response write. Production
      // evidence: with a 30s tail a wave started just before the deadline overran to 301.6s and the
      // platform killed the request (HTTP 504 FUNCTION_INVOCATION_TIMEOUT), destroying the partial
      // research state the budget exists to deliver. 210s keeps the honest TIME_BUDGET_EXHAUSTED
      // stop comfortably inside the limit.
      const deadlineMs = Date.now() + 210_000;
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
        readonly role?: string;
        readonly status: string; readonly evidenceRefs: readonly string[]; readonly staleOnlyRefs: readonly string[];
        readonly recoveryAttempts: number; readonly missingReason?: string;
      }[];
      readonly floorCapabilities?: readonly string[];
      readonly recoveryRounds?: number;
      readonly confidence?: ConfidenceComponents;
      readonly questionResolution?: {
        readonly intent: string;
        readonly temporalScope: string;
        readonly status: string;
        readonly dimensions: readonly { readonly dimension: string; readonly fit: string }[];
        readonly unresolvedDimensions: readonly string[];
        readonly materiality: string;
        readonly evidenceCount: number;
        readonly relevantEvidenceCount: number;
        readonly staleEvidenceCount: number;
        readonly answerClaims: readonly { readonly text?: string; readonly evidenceRefs?: readonly string[] }[];
        readonly claimEvidenceLinks: number;
        readonly actionableInsight: {
          readonly whatEvidenceShows: readonly string[];
          readonly whatEvidenceDoesNotShow: readonly string[];
          readonly whatItMeans: string;
          readonly whatWouldChangeConclusion: readonly string[];
          readonly watchItems: readonly string[];
        };
      };
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
    // Engine-computed confidence: the most conservative value across this request's outcomes
    // (a request that ran several loops is only as confident as its weakest gate).
    const computed = loopOutcomes
      .map((o) => o.confidence)
      .filter((c): c is ConfidenceComponents => c !== undefined)
      .sort((a, b) => a.coreCoverage - b.coreCoverage)[0];
    const questionText = result.request?.objective;
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
                role: r.role ?? "CORE",
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
              // CONFIDENCE (engine-owned): when a loop computed it, that value is exposed with
              // its basis; a flow-only run (no ledger) exposes no confidence rather than a guess.
              ...(computed !== undefined
                ? { confidence: computed.level, confidenceBasis: renderConfidence(computed) }
                : {}),
              ...(questionText !== undefined ? { questionType: questionTypeOf(questionText) } : {}),
              requirementRoles: [...new Set(requirements.map((r) => r.role ?? "CORE"))],
              // TRANSMISSION LINKS (research contract §3): derived from the ledger, exposed so an
              // external benchmark can score each arrow rather than trusting the prose.
              causalLinks: computed?.causalLinks.map((l) => ({
                ...(l.source !== undefined ? { source: l.source } : {}),
                target: l.target,
                targetLabel: l.targetLabel,
                status: l.status,
                requirementId: l.requirementId,
                evidenceRefs: l.evidenceRefs,
              })) ?? [],
              ...(computed?.weakestCausalLink !== undefined
                ? { weakestCausalLink: computed.weakestCausalLink.target }
                : {}),
              // QUESTION RESOLUTION: surface the engine's own question-fit verdict so the
              // external benchmark can score resolution independently of evidence collection.
              ...(loopOutcomes.find((o) => o.questionResolution !== undefined)?.questionResolution !== undefined
                ? {
                    questionResolution: (() => {
                      const q = loopOutcomes.find((o) => o.questionResolution !== undefined)!.questionResolution!;
                      return {
                        intent: q.intent,
                        temporalScope: q.temporalScope,
                        status: q.status,
                        dimensions: q.dimensions.map((d) => ({ dimension: d.dimension, fit: d.fit })),
                        unresolvedDimensions: [...q.unresolvedDimensions],
                        materiality: q.materiality,
                        evidenceCount: q.evidenceCount,
                        relevantEvidenceCount: q.relevantEvidenceCount,
                        staleEvidenceCount: q.staleEvidenceCount,
                        answerClaimCount: q.answerClaims.length,
                        claimEvidenceLinks: q.claimEvidenceLinks,
                        actionableInsight: {
                          whatEvidenceShows: [...q.actionableInsight.whatEvidenceShows],
                          whatEvidenceDoesNotShow: [...q.actionableInsight.whatEvidenceDoesNotShow],
                          whatItMeans: q.actionableInsight.whatItMeans,
                          whatWouldChangeConclusion: [...q.actionableInsight.whatWouldChangeConclusion],
                          watchItems: [...q.actionableInsight.watchItems],
                        },
                      };
                    })(),
                  }
                : {}),
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
      // Durable history record: the run's presentation content MINUS the evidence/judgment
      // object copies the graph already holds (deduplication, not truncation). The read path
      // rehydrates those arrays from the graph by ref, so a retained run reopens complete.
      ws.saveResearchResponse(researchRef, toRunRecord(response));
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
  /**
   * Research history list (the History page contract): ONE lightweight entry per research
   * RUN, newest first by default. Each entry answers "what did I research?" — question,
   * timestamps, status, confidence, question-resolution verdict, a short insight/judgment
   * preview, save marker — and never dumps the run's objects. Opening an entry is one call
   * to getResearch(ref) (the run aggregate).
   *
   * Identity laws: the entry's `ref` IS the ref that opens the run (list and open use the
   * same identifier, by construction) and is always a research ref — monitor/other object
   * refs are never listed here because history lists only research objects. Filtering is
   * deliberately plain (exact status, case-insensitive substring) rather than a query
   * language.
   */
  listResearch(options: ResearchListOptions = {}): ResearchRunSummaryDTO[] {
    const ws = this.ws();
    const all = ws.listResearch();
    const activeId = ws.getContinuitySnapshot().activeResearchTarget?.id;
    const groups = new Map<string, Research[]>();
    const order: string[] = [];
    for (const r of all) {
      const key = runKey(r);
      const bucket = groups.get(key);
      if (bucket === undefined) {
        groups.set(key, [r]);
        order.push(key);
      } else {
        bucket.push(r);
      }
    }
    const artifacts = ws.listSavedArtifacts();
    const entries: ResearchRunSummaryDTO[] = order.map((key) => {
      const members = groups.get(key)!;
      // Representative: the member that carries the run's answer (its judgment), else the
      // most recent member. Its ref stays hydratable through getResearch.
      const representative = [...members].reverse().find((m) => m.currentJudgmentRef !== undefined)
        ?? members[members.length - 1]!;
      const memberIds = members.map((m) => m.id);
      const internalRefs = members.filter((m) => m.id !== representative.id).map((m) => m.id);
      const timestamps = runTimestamps(members);
      const record = this.findRunRecord(memberIds);
      const questionResolution = record?.researchDiagnostics?.questionResolution;
      const judgment = representative.currentJudgmentRef !== undefined
        ? ws.getJudgment(representative.currentJudgmentRef)
        : undefined;
      const confidence = record?.researchDiagnostics?.confidence
        ?? record?.answer.confidence
        ?? judgment?.confidence;
      const insightPreview = questionResolution?.actionableInsight.whatItMeans;
      const judgmentPreview = record?.answer.answer ?? judgment?.statement;
      return {
        ...researchToDTO(representative),
        ...(representative.userQuestion !== undefined ? { question: representative.userQuestion } : {}),
        ...(internalRefs.length > 0 ? { internalRefs } : {}),
        isCurrent: members.some((m) => m.id === activeId),
        ...timestamps,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(questionResolution !== undefined ? { questionResolutionStatus: questionResolution.status } : {}),
        ...(insightPreview !== undefined && insightPreview.length > 0 ? { insightPreview: preview(insightPreview) } : {}),
        ...(judgmentPreview !== undefined && judgmentPreview.length > 0 ? { judgmentPreview: preview(judgmentPreview) } : {}),
        ...(runIsSaved(artifacts, memberIds) ? { saved: true } : {}),
        // Honest listing: the full run record is not retained, so opening it will render at
        // a lower reconstruction tier (the aggregate reports which).
        ...(record === undefined ? { degraded: true } : {}),
      };
    });

    const wanted = options.status?.trim().toUpperCase();
    const needle = options.q?.trim().toLowerCase();
    let filtered = entries;
    if (wanted !== undefined && wanted.length > 0) {
      filtered = filtered.filter((e) => (wanted === "CURRENT" ? e.isCurrent === true : e.status === wanted));
    }
    if (needle !== undefined && needle.length > 0) {
      filtered = filtered.filter((e) =>
        [e.question, e.objective, e.userQuestion].some((text) => text !== undefined && text.toLowerCase().includes(needle)),
      );
    }
    const sorted = [...filtered].sort((a, b) => {
      const byTime = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
      return byTime !== 0 ? byTime : a.ref.localeCompare(b.ref);
    });
    if ((options.sort ?? "recent") === "recent") sorted.reverse(); // newest first
    const offset = options.offset ?? 0;
    const limit = options.limit ?? DEFAULT_RESEARCH_LIMIT;
    return sorted.slice(offset, offset + limit);
  }

  /**
   * Run aggregate (the single opening contract): everything the run view needs in ONE call,
   * on the SAME identity the history list exposes. Research-object fields plus the retained
   * response surface (`answer`, evidence, judgments, gaps, diagnostics) when a record exists,
   * hoisted presentation fields (question resolution, actionable insight, watch items,
   * confidence, stop reason, causal links), provenance, timestamps, saved/thesis associations
   * and the honest reconstruction tier.
   *
   * Reconstruction tiers (never fabricated):
   * 1. in-memory archive (this instance completed the run);
   * 2. workspace-persisted run record (any instance, incl. after a cold start) — slim records
   *    rehydrate their evidence/judgment arrays from the graph by ref;
   * 3. the run's real persisted JUDGMENT (legacy pre-record runs): the actual conclusion,
   *    never a "reasoning not retained" refusal;
   * 4. SUMMARY: only the research object remains — reported as degraded, not disguised.
   *
   * `researchRef` is ALWAYS the ref this aggregate was requested by, so a client navigating
   * from a history entry always lands on the same identity it listed.
   */
  getResearch(ref: string): ResearchRunAggregateDTO {
    const ws = this.ws();
    const r = ws.getResearch(ref);
    if (r === undefined) throw new NotFoundError("research");
    // RUN-AWARE: one submission creates several Research objects (plan steps), and the answer
    // is persisted against the run's ANSWER-bearing member, which is not necessarily the ref
    // the history entry exposes. Resolution therefore checks the whole run group, so clicking
    // a history entry always yields the run's real answer instead of a bare summary.
    // The group is the SAME set the history list used (see runKey), so listing and opening can
    // never disagree about which members belong to the run.
    const members = runMembers(ws.listResearch(), r);
    const memberIds = members.map((m) => m.id);
    const memberIdSet = new Set(memberIds);

    let response: ResearchResponseDTO | undefined;
    let recordTier: ResearchRecordTierDTO = "SUMMARY";
    for (const id of memberIds) {
      const archivedHit = this.responseArchive.get(id);
      if (archivedHit !== undefined) {
        response = archivedHit.response;
        recordTier = "FULL";
        break;
      }
      const payload = recordPayload(ws.getResearchResponse(id));
      if (payload !== undefined) {
        response = hydrateRunResponse(ws, payload, memberIds);
        recordTier = "FULL";
        break;
      }
    }
    // Legacy tier: runs completed before response persistence have no archived response,
    // but their judgment (statement, confidence, uncertainty, implications) WAS persisted.
    // Reconstruct the run's answer from that real persisted content.
    if (response === undefined) {
      const answerMember = members.find((m) => m.currentJudgmentRef !== undefined);
      const source = answerMember ?? (r.currentJudgmentRef !== undefined ? r : undefined);
      const j = source?.currentJudgmentRef !== undefined ? ws.getJudgment(source.currentJudgmentRef) : undefined;
      if (j !== undefined && source !== undefined) {
        response = {
          requestId: r.id,
          action: "RESEARCH",
          outcome: "COMPLETED",
          answer: {
            answer: j.statement,
            supportingReasons: [],
            opposingReasons: [],
            counterevidenceStatus: "NOT_ASSESSED",
            confidence: j.confidence ?? "UNKNOWN",
            keyUncertainty: j.uncertainty[0] ?? "",
            implication: j.implications[0] ?? "",
            citedObjectRefs: [j.id],
          },
          limitations: [],
          researchGaps: [],
          researchRef: ref,
          evidenceRefs: [...source.evidenceRefs],
          judgmentRef: j.id,
          evidence: [...source.evidenceRefs].flatMap((er) => {
            const e = ws.getEvidence(er);
            return e === undefined ? [] : [evidenceToDTO(e)];
          }),
          judgments: [judgmentToDTO(j)],
        };
        recordTier = "JUDGMENT";
      }
    }

    const diagnostics = response?.researchDiagnostics;
    const questionResolution = diagnostics?.questionResolution;
    const timestamps = runTimestamps(members);
    const confidence = diagnostics?.confidence ?? response?.answer.confidence;
    return {
      ...researchToDTO(r),
      ...(response ?? {}),
      ...(r.userQuestion !== undefined ? { question: r.userQuestion } : {}),
      researchRef: ref,
      createdAt: timestamps.createdAt ?? r.provenance[0]?.at ?? new Date(0).toISOString(),
      updatedAt: timestamps.updatedAt ?? r.provenance[r.provenance.length - 1]?.at ?? new Date(0).toISOString(),
      isCurrent: members.some((m) => m.id === ws.getContinuitySnapshot().activeResearchTarget?.id),
      provenance: provenanceToDTO(r.provenance),
      saved: runIsSaved(ws.listSavedArtifacts(), memberIds),
      recordTier,
      degraded: recordTier !== "FULL",
      ...(questionResolution !== undefined ? { questionResolution } : {}),
      ...(questionResolution !== undefined ? { actionableInsight: questionResolution.actionableInsight } : {}),
      ...(questionResolution !== undefined ? { watchNext: questionResolution.actionableInsight.watchItems } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(diagnostics !== undefined ? { stoppedBecause: diagnostics.completionGate } : {}),
      ...(diagnostics?.causalLinks !== undefined ? { causalLinks: diagnostics.causalLinks } : {}),
      ...(diagnostics?.weakestCausalLink !== undefined ? { weakestCausalLink: diagnostics.weakestCausalLink } : {}),
      summary: runCounts(members, response),
      thesisAssessments: ws.listThesisAssessments()
        .filter((a) => a.researchRef !== undefined && memberIdSet.has(a.researchRef))
        .map(thesisAssessmentToDTO),
    };
  }

  /** The retained presentation content of a run (any tier), for list summaries. */
  private findRunRecord(memberIds: readonly string[]): RunRecordPayload | undefined {
    for (const id of memberIds) {
      const archivedHit = this.responseArchive.get(id);
      if (archivedHit !== undefined) return archivedHit.response;
      const payload = recordPayload(this.ws().getResearchResponse(id));
      if (payload !== undefined) return payload;
    }
    return undefined;
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

/** Default history page size (bounded list responses law; /api/evidence honours the same). */
export const DEFAULT_RESEARCH_LIMIT = 50;
/** Hard ceiling for ?limit= on the history list. */
export const MAX_RESEARCH_LIMIT = 200;

/** Chars kept in a list-entry preview before truncation (the full text lives on the run). */
const PREVIEW_CHARS = 180;

/** Optional history-list window/filter (B4): limit/offset window, sort, status, substring search. */
export interface ResearchListOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: "recent" | "oldest";
  readonly status?: string;
  readonly q?: string;
}

/**
 * v2 slim run record marker. `toRunRecord` removes the evidence/judgment object ARRAYS from
 * the stored response because the workspace graph already holds those objects by ref; the read
 * path rehydrates them. Old (v1) records stored the complete response verbatim and are still
 * read as-is — the migration is explicit, not guessed: the version marker says which it is.
 */
export const RUN_RECORD_VERSION = 2;

/** Durable per-run presentation record stored in the workspace snapshot (survey of B5). */
export interface ResearchRunRecord {
  readonly recordVersion: number;
  readonly response: Omit<ResearchResponseDTO, "evidence" | "judgments">;
}

/** Stored payload shape: slim (v2) records have no evidence/judgments arrays. */
type RunRecordPayload = Omit<ResearchResponseDTO, "evidence" | "judgments"> &
  Partial<Pick<ResearchResponseDTO, "evidence" | "judgments">>;

/**
 * Slim a completed run's response for durable storage: everything the run view needs, minus
 * the duplicated graph objects (evidence[], judgments[]) that are rehydrated by ref at read
 * time. Deduplication, not truncation — the answer, gaps, limitations, question resolution and
 * diagnostics are all retained verbatim, so a retained run reopens complete after a restart.
 */
export function toRunRecord(response: ResearchResponseDTO): ResearchRunRecord {
  const { evidence: _evidence, judgments: _judgments, ...rest } = response;
  return { recordVersion: RUN_RECORD_VERSION, response: rest };
}

/** Unwrap a stored run record (v2 slim or v1 verbatim) into its presentation payload. */
function recordPayload(raw: unknown): RunRecordPayload | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const wrapper = raw as { recordVersion?: unknown; response?: unknown };
  if (wrapper.recordVersion === RUN_RECORD_VERSION && typeof wrapper.response === "object" && wrapper.response !== null) {
    return wrapper.response as RunRecordPayload;
  }
  if ("answer" in (raw as Record<string, unknown>)) return raw as RunRecordPayload;
  return undefined;
}

/**
 * Rebuild the complete response surface from a stored payload: evidence and judgments come
 * from the workspace graph by ref (never re-derived, never fabricated — an object the graph
 * no longer holds simply does not appear). Legacy v1 payloads that still carry their own
 * arrays are returned unchanged.
 */
function hydrateRunResponse(ws: Workspace, payload: RunRecordPayload, memberIds: readonly string[]): ResearchResponseDTO {
  const evidence = payload.evidence !== undefined && payload.evidence.length > 0
    ? [...payload.evidence]
    : payload.evidenceRefs.flatMap((ref) => {
        const e = ws.getEvidence(ref);
        return e === undefined ? [] : [evidenceToDTO(e)];
      });
  const judgments = payload.judgments !== undefined && payload.judgments.length > 0
    ? [...payload.judgments]
    : collectRunJudgments(ws, memberIds);
  return { ...payload, evidence, judgments };
}

/** Every judgment the run's members carry, de-duplicated (the original response's judgments). */
function collectRunJudgments(ws: Workspace, memberIds: readonly string[]): JudgmentDTO[] {
  const out: JudgmentDTO[] = [];
  for (const id of memberIds) {
    for (const j of judgmentsForResearch(ws, id)) if (!out.some((d) => d.ref === j.ref)) out.push(j);
  }
  return out;
}

/** Run start/end timestamps from the members' provenance trails (history never fakes "now"). */
function runTimestamps(members: readonly Research[]): { createdAt?: string; updatedAt?: string } {
  const ats = members.flatMap((m) => m.provenance.map((p) => p.at));
  if (ats.length === 0) return {};
  let min = ats[0]!;
  let max = ats[0]!;
  for (const at of ats) {
    if (at < min) min = at;
    if (at > max) max = at;
  }
  return { createdAt: min, updatedAt: max };
}

/**
 * Identity of the RUN a research object belongs to, as a group key.
 *
 * A run is (runId, verbatim question): the question comes from the same submission context
 * that stamped the run id, so members of one submission always agree on both. The question is
 * part of the key because legacy data contains run ids that were NOT unique — the run counter
 * restarted at 1 on every cold process (a run id is never an object id, so it was never
 * seeded), which stamped unrelated submissions with the same `run_000001`. Grouping on the id
 * alone merged those submissions: one history entry then showed one submission's question with
 * another submission's answer. Legacy objects without a run id stay their own entry.
 */
function runKey(r: Research): string {
  return r.runId === undefined ? `solo:${r.id}` : `${r.runId}\u0000${r.userQuestion ?? ""}`;
}

/** The members of the run `seed` belongs to (same key), in creation order. */
function runMembers(all: readonly Research[], seed: Research): Research[] {
  if (seed.runId === undefined) return [seed];
  const key = runKey(seed);
  return all.filter((m) => runKey(m) === key);
}

/**
 * Object counts for a run. When the run's record is retained, its refs are authoritative: they
 * are exactly the objects this request produced and that the run view renders. Only a run with
 * no retained record falls back to the union across its members (which can accumulate objects
 * from internal steps and would otherwise contradict the evidence the user actually sees).
 */
function runCounts(members: readonly Research[], response?: ResearchResponseDTO): ResearchRunAggregateDTO["summary"] {
  const evidence = new Set<string>();
  const claims = new Set<string>();
  const hypotheses = new Set<string>();
  const judgments = new Set<string>();
  for (const m of members) {
    for (const ref of m.evidenceRefs) evidence.add(ref);
    for (const ref of m.claimRefs) claims.add(ref);
    for (const ref of m.hypothesisRefs) hypotheses.add(ref);
    for (const ref of m.judgmentRefs) judgments.add(ref);
    if (m.currentJudgmentRef !== undefined) judgments.add(m.currentJudgmentRef);
  }
  return {
    evidenceCount: response !== undefined ? response.evidenceRefs.length : evidence.size,
    claimCount: claims.size,
    hypothesisCount: hypotheses.size,
    judgmentCount: response !== undefined ? response.judgments.length : judgments.size,
  };
}

/** True when a SAVEd artifact (LUI-authorized) derives from this run. */
function runIsSaved(artifacts: readonly SavedArtifact[], memberIds: readonly string[]): boolean {
  const ids = new Set(memberIds);
  return artifacts.some((a) =>
    (a.researchRef !== undefined && ids.has(a.researchRef)) || a.derivedFromRefs.some((ref) => ids.has(ref)),
  );
}

/** One-line list preview: whitespace collapsed, bounded, honestly marked when shortened. */
function preview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= PREVIEW_CHARS ? normalized : `${normalized.slice(0, PREVIEW_CHARS).trimEnd()} …`;
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
