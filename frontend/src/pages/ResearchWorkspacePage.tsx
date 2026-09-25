/**
 * Research workspace; the primary screen, wired to the REAL backend.
 *
 * - The ask-bar submits natural language to the backend (no keyword routing here).
 * - While running, the page renders the real SSE progress stages; when finished,
 *   the backend's ResearchResponseDTO is rendered verbatim: answer card, supporting/
 *   opposing reasons, uncertainty, limitations, and epistemically-classified evidence.
 * - The context rail shows the real continuity snapshot (active thesis, judgment,
 *   recent evidence). Empty/failed/partial states render the backend's own state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import {
  Panel, ClassBadge, EpistemicRail, FreshnessBadge, ConfidenceMeter, StatusBadge,
  ProxyNote, UnavailableNote, KV, Note, Empty, timeAgo,
} from "../components/ui.js";
import { evidenceFromDto, judgmentFromDto } from "../data/adapters.js";
import { isResearchRef, preferTurn, runOpenRef, turnIdentity } from "../data/identity.js";
import { isExpandedTurn, railBelongsToActive, selectActiveTurnRef } from "./researchView.js";
import { ApiError, getWorkspace, listResearch, getResearch } from "../api/index.js";
import type { EvidenceItem, JudgmentView, ThesisView } from "../data/types.js";
import type {
  ResearchResponseDto, ResearchDto, ContinuitySnapshotDto, HistoricalAnalysisDto,
  ResearchRecordTierDto, QuestionResolutionDto,
} from "../api/index.js";
import { useResearchStream } from "../hooks/useResearchStream.js";

interface WorkspaceData {
  readonly evidence: readonly EvidenceItem[];
  readonly judgment: JudgmentView | undefined;
  readonly thesis: ThesisView | undefined;
  readonly snapshot: ContinuitySnapshotDto | undefined;
  readonly loadError: unknown;
}

/**
 * What the run view renders: the response DTO plus the aggregate's hoisted presentation
 * fields. A freshly streamed result carries only the response surface; a reopened run carries
 * both — the view renders whichever is present and never re-derives either.
 */
interface RunLike extends ResearchResponseDto {
  readonly questionResolution?: QuestionResolutionDto;
  readonly actionableInsight?: QuestionResolutionDto["actionableInsight"];
  readonly watchNext?: readonly string[];
  readonly confidence?: string;
  readonly stoppedBecause?: string;
}

interface Turn {
  readonly question: string;
  readonly run: RunLike;
  /** True when the run was reconstructed at less than full fidelity (see recordTier). */
  readonly degraded?: boolean;
  /** How completely this run could be reconstructed: FULL | JUDGMENT | SUMMARY. */
  readonly recordTier?: ResearchRecordTierDto;
}

/**
 * Hydrate a run into a renderable turn; the SAME path serves a fresh result and a reopened
 * historical one (no second "history result" UI).
 *
 * Identity is normalized here: a turn's research identity is the research REF (never the
 * requestId). `getResearch` already answers on the ref the list exposed, and old bare
 * summaries carry the ref as their identity — without normalization `isExpandedTurn` and the
 * open affordance compared a UUID against a ref and silently failed.
 */
function researchDtoToTurn(dto: (ResearchDto & Partial<ResearchResponseDto>) & {
  readonly recordTier?: ResearchRecordTierDto;
  readonly degraded?: boolean;
}): Turn | undefined {
  const question = dto.question?.length > 0 ? dto.question : dto.objective;
  if (question.length === 0) return undefined;
  const researchRef = isResearchRef(dto.researchRef) ? dto.researchRef : dto.ref;
  const answer = dto.answer;
  if (answer === undefined) {
    // No retained answer at all (SUMMARY tier): render the summary honestly, never a
    // fabricated answer, and never pretend the record is complete.
    return {
      question,
      degraded: true,
      recordTier: "SUMMARY",
      run: {
        requestId: researchRef, // identity is the research ref, not a UUID
        researchRef,
        action: "RESEARCH",
        outcome: "COMPLETED",
        answer: {
          answer: `Only this research's summary is retained for ${dto.objective}. No answer, judgment or evidence record is available for this run.`,
          supportingReasons: [],
          opposingReasons: [],
          confidence: "UNKNOWN",
          keyUncertainty: "",
          implication: "",
          citedObjectRefs: [],
        },
        limitations: [],
        evidenceRefs: [...dto.evidenceRefs],
        evidence: [],
        judgments: [],
      },
    };
  }
  // Boundary cast: `answer` was just checked, and the aggregate's extra presentation fields
  // are copied through untouched (types are erased; nothing is synthesized here).
  return {
    question,
    ...(dto.degraded === true ? { degraded: true } : {}),
    ...(dto.recordTier !== undefined
      ? { recordTier: dto.recordTier }
      : { recordTier: "FULL" as const }),
    run: { ...(dto as unknown as RunLike), researchRef },
  };
}

/**
 * Transport-error → DTO-outcome mapping. Only a genuine interpretation failure maps to
 * MODEL_FAILURE; every other typed failure keeps its own vocabulary so the UI can never
 * mislabel a persistence/transport fault as a model fault (and PANEL_TITLES below renders
 * outcomes it knows explicitly rather than defaulting unknowns to a wrong caption).
 */
function errorTurnOutcome(code: string): ResearchResponseDto["outcome"] {
  switch (code) {
    case "AWAITING_CONFIRMATION": return "AWAITING_CONFIRMATION";
    case "INVALID_REQUEST":
    case "NOT_FOUND":
      return "REJECTED";
    case "MODEL_FAILURE":
    case "PROVIDER_UNAVAILABLE":
      return "MODEL_FAILURE";
    default:
      return "COMPLETED"; // honest catch-all: renders the message inside a failure panel, not as a verdict
  }
}

const PANEL_TITLES: Record<string, string> = {
  COMPLETED: "Research result",
  AWAITING_CONFIRMATION: "Confirmation required",
  REJECTED: "Request rejected",
  MODEL_FAILURE: "Interpretation failed",
};

export function ResearchWorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ ref?: string }>();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [runs, setRuns] = useState<readonly Turn[]>([]);
  const [ws, setWs] = useState<WorkspaceData>({ evidence: [], judgment: undefined, thesis: undefined, snapshot: undefined, loadError: undefined as unknown });
  const { state: stream, submit } = useResearchStream();
  const askedFromHome = useRef(""); // guards double-submission of a home-hero example in StrictMode

  // Every terminal stream event lands as a visible turn: success shows the backend's DTO;
  // typed errors (including a lost connection) render honest failure turns. Nothing leaves
  // the page silently "still researching" while history already holds the result.
  const streamDone = stream.result !== undefined;
  useEffect(() => {
    if (streamDone) {
      // Replace any history-hydrated copy of this same question with the fresh full response
      // (dedup by question text: history loads first, the live result supersedes it).
      setRuns((prev) => [...prev.filter((t) => t.question !== stream.question), { question: stream.question, run: stream.result! }]);
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamDone, stream.result]);

  useEffect(() => {
    if (stream.errorId > 0) {
      const code = stream.error!.code;
      const outcome = errorTurnOutcome(code);
      setRuns((prev) => [...prev, {
        question: stream.question,
        run: {
          requestId: crypto.randomUUID(),
          action: "RESEARCH",
          outcome,
          // Only a model-class failure carries the modelFailure field; other typed
          // failures speak through the answer message without being relabeled.
          ...(outcome === "MODEL_FAILURE" ? { modelFailure: { type: code, message: stream.error!.message } } : {}),
          answer: {
            answer: stream.error!.message,
            supportingReasons: [],
            opposingReasons: [],
            confidence: "UNKNOWN",
            keyUncertainty: "",
            implication: "",
            citedObjectRefs: [],
          },
          limitations: [],
          evidence: [],
          judgments: [],
          evidenceRefs: [],
        },
      }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.errorId]);

  const refresh = useCallback(async () => {
    // Workspace state (history + snapshot) refresh; RESILIENT by design:
    // - a failed history read NEVER wipes turns already on screen (the live result a user
    //   just received must not vanish because a read hiccuped) — history is merged, not set;
    // - the snapshot load retries once (bounded) to absorb cold-start/deploy blips before
    //   the honest banner is shown; previous state stays visible meanwhile.
    let historyTurns: readonly Turn[] | undefined;
    try {
      // The thread shows the newest few COMPLETED runs (oldest→newest, chat order); the
      // History page is the full, paginated surface. The window is requested from the
      // backend rather than sliced out of an unbounded list.
      const history = await listResearch({ limit: 50, status: "COMPLETED" });
      const latest = history.slice(0, 3).reverse();
      const hydrated = await Promise.all(
        latest.map(async (r): Promise<Turn | undefined> => {
          try {
            const full = await getResearch(r.ref);
            return researchDtoToTurn(full);
          } catch {
            return undefined; // one unreadable run must not sink the rest
          }
        }),
      );
      historyTurns = hydrated.filter((t): t is Turn => t !== undefined);
    } catch {
      // History unavailable (cold store, transient fault); existing turns stay untouched.
    }
    if (historyTurns !== undefined) {
      setRuns((prev) => {
        // MERGE LAW, identity-keyed: turns are deduped by research ref (never by requestId,
        // which compared a UUID against a ref and appended a duplicate row on every reopen).
        // A non-degraded record always wins over a degraded one for the same run; a turn
        // already on screen whose question matches a full history turn is that same run and
        // is superseded rather than duplicated.
        const merged = new Map<string, Turn>();
        const questionToKey = new Map<string, string>();
        const choose = (t: Turn): void => {
          const identity = turnIdentity({ requestId: t.run.requestId, ...(t.run.researchRef !== undefined ? { researchRef: t.run.researchRef } : {}) });
          const key = questionToKey.get(t.question) ?? identity;
          const existing = merged.get(key);
          if (existing === undefined) {
            merged.set(key, t);
            questionToKey.set(t.question, key);
            return;
          }
          if (preferTurn(existing, t) === "incoming") merged.set(key, t);
        };
        for (const t of historyTurns!) choose(t);
        for (const t of prev) {
          const covered = questionToKey.has(t.question) || merged.has(turnIdentity({ requestId: t.run.requestId, ...(t.run.researchRef !== undefined ? { researchRef: t.run.researchRef } : {}) }));
          if (!covered) choose(t);
        }
        return [...merged.values()];
      });
    }
    try {
      const snapshot = await getWorkspace();
      setWs({
        evidence: snapshot.recentEvidence.map(evidenceFromDto),
        judgment: snapshot.currentJudgment !== undefined ? judgmentFromDto(snapshot.currentJudgment) : undefined,
        thesis: snapshot.activeThesis !== undefined
          ? {
              ref: snapshot.activeThesis.ref,
              statement: snapshot.activeThesis.statement,
              objective: snapshot.activeThesis.objective,
              version: snapshot.activeThesis.version,
              claims: snapshot.activeThesis.claims.map((c: { statement: string; importance?: string }) => ({ statement: c.statement, importance: "SUPPORTING" as const, invalidationConditions: [] })),
              assumptions: snapshot.activeThesis.assumptions.map((a: { statement: string }) => ({ statement: a.statement, invalidationConditions: [] })),
              invalidationConditions: [...snapshot.activeThesis.invalidationConditions],
              assessments: [],
              confidence: snapshot.activeThesis.confidence ?? "UNKNOWN",
              researchQuality: "UNAVAILABLE",
              supportingRefs: [],
              contradictingRefs: [],
              updatedAt: snapshot.activeThesis.updatedAt,
              status: snapshot.activeThesis.status,
            }
          : undefined,
        snapshot,
        loadError: undefined,
      });
    } catch (err) {
      // One bounded retry: cold serverless instances and deploy windows produce transient
      // failures; the banner is only honest after a confirmed double failure.
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const snapshot = await getWorkspace();
        setWs({
          evidence: snapshot.recentEvidence.map(evidenceFromDto),
          judgment: snapshot.currentJudgment !== undefined ? judgmentFromDto(snapshot.currentJudgment) : undefined,
          thesis: snapshot.activeThesis !== undefined
            ? {
                ref: snapshot.activeThesis.ref,
                statement: snapshot.activeThesis.statement,
                objective: snapshot.activeThesis.objective,
                version: snapshot.activeThesis.version,
                claims: snapshot.activeThesis.claims.map((c: { statement: string; importance?: string }) => ({ statement: c.statement, importance: "SUPPORTING" as const, invalidationConditions: [] })),
                assumptions: snapshot.activeThesis.assumptions.map((a: { statement: string }) => ({ statement: a.statement, invalidationConditions: [] })),
                invalidationConditions: [...snapshot.activeThesis.invalidationConditions],
                assessments: [],
                confidence: snapshot.activeThesis.confidence ?? "UNKNOWN",
                researchQuality: "UNAVAILABLE",
                supportingRefs: [],
                contradictingRefs: [],
                updatedAt: snapshot.activeThesis.updatedAt,
                status: snapshot.activeThesis.status,
              }
            : undefined,
          snapshot,
          loadError: undefined,
        });
        return;
      } catch {
        // Confirmed failure: keep previous state on screen, surface the honest banner.
      }
      setWs((prev) => ({ ...prev, loadError: err }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // A direct link to a specific run (Research history click): fetch THAT run and show it
  // in the thread. Every run hydrates from its own persisted object, so clicking a BTC
  // history entry can never render an NVDA run. Unknown/deleted refs fall through to the
  // normal workspace view with an honest inline note.
  const [linkedNotFound, setLinkedNotFound] = useState(false);
  // A linked run that could not be fetched for a TRANSIENT reason is not "unavailable": the
  // banner is retryable and the retry loop below keeps trying.
  const [refLoadError, setRefLoadError] = useState<unknown>(undefined);
  // EXPLICIT user selection of a research run (history click / linked URL). This is the ONLY
  // way a non-live run becomes the active result; it is cleared when a new question starts.
  const [viewedRef, setViewedRef] = useState<string | undefined>(undefined);
  useEffect(() => {
    const ref = params.ref;
    if (ref === undefined || ref.length === 0) {
      setLinkedNotFound(false);
      setRefLoadError(undefined);
      setViewedRef(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const full = await getResearch(ref);
        if (cancelled) return;
        const turn = researchDtoToTurn(full);
        if (turn === undefined) return;
        setLinkedNotFound(false);
        setRefLoadError(undefined);
        setViewedRef(ref);
        // Dedupe on the SAME identity the list exposes: reopening a run already on screen
        // replaces its turn (preferring the fuller reconstruction) instead of appending a
        // duplicate row.
        setRuns((prev) => {
          const index = prev.findIndex((t) => turnIdentity({ requestId: t.run.requestId, ...(t.run.researchRef !== undefined ? { researchRef: t.run.researchRef } : {}) }) === ref);
          if (index === -1) return [...prev, turn];
          if (preferTurn(prev[index], turn) === "existing") return prev;
          const next = [...prev];
          next[index] = turn;
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        // The "not available" panel is reserved for a run the backend genuinely does not
        // have (typed NOT_FOUND). A cold start, deploy window or network blip is a
        // transient read failure and must never be reported as missing history.
        if (err instanceof ApiError && err.code === "NOT_FOUND") {
          setLinkedNotFound(true);
          setRefLoadError(undefined);
        } else {
          setLinkedNotFound(false);
          setRefLoadError(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.ref]);

  // A transient open failure retries in the background (bounded): a cold serverless instance
  // must not leave the user staring at a failure note for a run that exists.
  useEffect(() => {
    if (refLoadError === undefined || params.ref === undefined) return;
    let cancelled = false;
    let attempt = 0;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      attempt += 1;
      try {
        const full = await getResearch(params.ref!);
        if (cancelled) return;
        const turn = researchDtoToTurn(full);
        if (turn !== undefined) {
          setRefLoadError(undefined);
          setViewedRef(params.ref!);
          setRuns((prev) => (prev.some((t) => turnIdentity({ requestId: t.run.requestId, ...(t.run.researchRef !== undefined ? { researchRef: t.run.researchRef } : {}) }) === params.ref) ? prev : [...prev, turn]));
        }
        return;
      } catch {
        if (attempt < 3 && !cancelled) setTimeout(() => { void tick(); }, Math.min(4000 * 2 ** (attempt - 1), 20000));
      }
    };
    const t = setTimeout(() => { void tick(); }, 2500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refLoadError, params.ref]);

  // AUTO-RECOVERY: while the banner is up, a bounded background retry keeps trying to load
  // workspace state; the moment one succeeds the banner clears itself (a user should never
  // have to know that a cold serverless instance blipped). Backs off 5s, 10s, 20s, then 30s.
  const loadError = ws.loadError;
  useEffect(() => {
    if (loadError === undefined) return;
    let cancelled = false;
    let attempt = 0;
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      attempt += 1;
      try {
        const snapshot = await getWorkspace();
        if (!cancelled) {
          setWs({
            evidence: snapshot.recentEvidence.map(evidenceFromDto),
            judgment: snapshot.currentJudgment !== undefined ? judgmentFromDto(snapshot.currentJudgment) : undefined,
            thesis: undefined,
            snapshot,
            loadError: undefined,
          });
        }
        return; // recovered; stop the chain
      } catch {
        if (attempt < 4 && !cancelled) setTimeout(() => { void tick(); }, Math.min(5000 * 2 ** (attempt - 1), 30000));
      }
    };
    const t = setTimeout(() => { void tick(); }, 5000);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError]);

  // A question handed over from the home hero (navigation state) is asked once on arrival.
  useEffect(() => {
    const q = (location.state as { question?: string } | null)?.question;
    if (typeof q === "string" && q.length > 0 && askedFromHome.current !== q) {
      askedFromHome.current = q;
      navigate(location.pathname, { replace: true }); // clear the state so refresh/resubmit doesn't re-ask
      ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Submission drives the REAL SSE stream: progress stages render live; every terminal path
  // (final / typed error / connection lost) lands as a turn so the page NEVER returns to an
  // empty state while the backend holds the result (it is always in Research history too).
  const ask = useCallback((question: string, confirmed = false) => {
    const q = question.trim();
    if (q.length === 0 || stream.running || submitting) return;
    setInput("");
    // STATE ISOLATION (researchId-scoped active view): a new question immediately detaches
    // any previously selected/displayed research. The previous result stays in history and
    // its row, but it can never render as the answer to the new question.
    setViewedRef(undefined);
    setSubmitting(true);
    void submit(q, { confirmed })
      .catch((err: unknown) => {
        // Defensive: streamResearchRequest resolves (never rejects) on handled failures.
        console.error("research stream submission threw", err);
      })
      .finally(() => setSubmitting(false));
  }, [stream.running, submitting, submit]);

  const evidenceById = new Map(ws.evidence.map((e) => [e.ref, e]));
  // Active-result selection (state-isolation law): while a run is in flight NOTHING from a
  // previous research is expanded; otherwise the user's explicit selection or the newest
  // identified run is the one active result. The rail renders state/judgment only for it.
  const identifiedTurns = runs.map((t) => ({
    question: t.question,
    requestId: t.run.requestId,
    ...(t.run.researchRef !== undefined ? { researchRef: t.run.researchRef } : {}),
    ...(t.degraded === true ? { degraded: true } : {}),
  }));
  const activeRef = selectActiveTurnRef({
    turns: identifiedTurns,
    ...(viewedRef !== undefined ? { viewedRef } : {}),
    ...(stream.result?.researchRef !== undefined ? { liveRef: stream.result.researchRef } : {}),
    running: stream.running,
  });
  const railScoped = railBelongsToActive({
    running: stream.running,
    ...(ws.snapshot?.activeResearch?.ref !== undefined ? { snapshotRef: ws.snapshot.activeResearch.ref } : {}),
    ...(activeRef !== undefined ? { activeRef } : {}),
  });

  return (
    <AppShell
      title="Research"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Research state</div>
            {stream.running ? (
              <>
                <KV k="research" v="running" />
                <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-3)", margin: "6px 0" }}>{stream.question}</div>
                <KV k="stage" v={stream.stages[stream.stages.length - 1]?.name ?? "starting"} />
              </>
            ) : ws.snapshot?.activeResearch !== undefined && railScoped ? (
              <>
                <KV k="research" v={ws.snapshot.activeResearch.ref} />
                <KV k="flow" v={ws.snapshot.activeResearch.flow.replace(/_/g, " ").toLowerCase()} />
                <KV k="status" v={ws.snapshot.activeResearch.status} />
                <KV k="evidence" v={String(ws.snapshot.activeResearch.evidenceRefs.length)} />
              </>
            ) : (
              <Empty title="No active research" hint="Ask a question to start the first investigation." />
            )}
            <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void refresh()}>Refresh state ↻</button>
          </div>
          {ws.thesis !== undefined && (
            <div className="rail-section">
              <div className="rail-title">Active thesis</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-2)", marginBottom: 8 }}>{ws.thesis.statement}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <StatusBadge status={ws.thesis.status} />
                <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>v{ws.thesis.version}</span>
              </div>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => navigate("/thesis")}>Open thesis workspace</button>
            </div>
          )}
          {/* Rail judgment is scoped to the ACTIVE research: during a new run, and whenever
              the snapshot describes a different research, the previous verdict is NOT shown
              as current (the "new question displayed the old judgment" production bug). */}
          {ws.judgment !== undefined && railScoped && (
            <div className="rail-section">
              <div className="rail-title">Current judgment</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-2)", marginBottom: 8 }}>{ws.judgment.statement}</div>
              <ConfidenceMeter confidence={ws.judgment.confidence} />
            </div>
          )}
        </>
      }
    >
      <div className="ask-bar">
        <div className="search-wrap" style={{ maxWidth: "none" }}>
          <input
            className="search"
            placeholder="Ask a research question; e.g. why did BTC drop this morning?"
            aria-label="Ask a research question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(input)}
            disabled={stream.running || submitting}
          />
        </div>
        <button className="btn primary" onClick={() => ask(input)} disabled={stream.running || submitting || input.trim().length === 0}>
          {stream.running || submitting ? `Researching… ${stream.elapsedSeconds > 0 ? `(${stream.elapsedSeconds}s)` : ""}` : "Research"}
        </button>
      </div>

      {ws.loadError !== undefined && (
        <BackendDownNote error={ws.loadError}> No mock content is shown in its place.</BackendDownNote>
      )}

      {stream.running && (
        <Panel kicker="research running" title={stream.question}>
          <div className="panel-body" style={{ paddingTop: 6 }}>
            {stream.stages.map((s, i) => (
              <div className="run-stage" key={`${s.stage}-${i}`}>
                <span className={`stage-dot ${s.status === "active" ? "active" : "done"}`} aria-hidden>{s.status === "active" ? "●" : "✓"}</span>
                <div>
                  <div className={`stage-name ${s.status === "active" ? "" : "pending"}`}>{s.name}{s.status === "active" && <span className="mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--accent)" }}>running</span>}</div>
                  <div className="stage-detail">{s.summary}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Genuine 404 only: the backend does not have this run (bad/foreign/expired ref). */}
      {linkedNotFound && (
        <Panel kicker="history" title="That research entry is not available">
          <div className="panel-body" style={{ paddingTop: 6 }}>The backend has no research run for this reference. It is still retrying in the background if this was a transient read failure; otherwise pick another entry from Research history.</div>
        </Panel>
      )}
      {refLoadError !== undefined && (
        <BackendDownNote error={refLoadError}> The run is still on the server; this is a read failure, not missing history.</BackendDownNote>
      )}
      {runs.length === 0 && !stream.running && ws.loadError === undefined && (
        <Empty title="No research in this workspace yet" hint="Type a natural-language question above; the agent plans and investigates." />
      )}

      {runs.map((turn) => {
        const turnIdentified = {
          question: turn.question,
          requestId: turn.run.requestId,
          ...(turn.run.researchRef !== undefined ? { researchRef: turn.run.researchRef } : {}),
          ...(turn.degraded === true ? { degraded: true } : {}),
        };
        // Identity for rendering is the research ref when the turn has one, else its own
        // request id (failure turns). Never a UUID where a ref is expected.
        const identity = turnIdentity({ requestId: turn.run.requestId, ...(turn.run.researchRef !== undefined ? { researchRef: turn.run.researchRef } : {}) });
        if (isExpandedTurn(turnIdentified, activeRef, stream.running)) {
          return <RunView key={identity} turn={turn} evidenceById={evidenceById} onInspectEvidence={() => navigate("/evidence")} onConfirm={() => void ask(turn.question, true)} />;
        }
        // Archival row: a previous research stays reachable, but never occupies the active
        // area while a new question is being researched. The open affordance navigates with
        // the research REF: only a research ref can be opened (a requestId never can).
        const openRef = runOpenRef({ researchRef: turn.run.researchRef, requestId: turn.run.requestId });
        return (
          <div className="chat-user" key={identity}>
            <div className="bubble" style={{ opacity: 0.75 }}>
              {turn.question}
              {openRef !== undefined && (
                <button
                  className="btn sm ghost"
                  style={{ marginLeft: 10 }}
                  onClick={() => navigate(`/research/${encodeURIComponent(openRef)}`)}
                >
                  open
                </button>
              )}
            </div>
          </div>
        );
      })}
    </AppShell>
  );
}

function RunView({ turn, evidenceById, onInspectEvidence, onConfirm }: {
  turn: Turn;
  evidenceById: Map<string, EvidenceItem>;
  onInspectEvidence: () => void;
  onConfirm: () => void;
}) {
  const run = turn.run;
  const supporting = run.answer.supportingReasons;
  const opposing = run.answer.opposingReasons;

  // Engine-owned run state, rendered verbatim: what the run concluded about the QUESTION
  // (question resolution) and how completely the record was reconstructed. The client never
  // infers either.
  const resolution = run.questionResolution;
  const recordTier: ResearchRecordTierDto = turn.recordTier ?? "FULL";
  const insight = run.actionableInsight ?? resolution?.actionableInsight;
  const watchNext = run.watchNext ?? insight?.watchItems ?? [];

  return (
    <>
      <div className="chat-user">
        <div className="bubble">{turn.question}</div>
      </div>

      {/* RESEARCH STATUS: explicit state, immediately after the question. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 10px" }}>
        <StatusBadge status={run.outcome} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{run.action.toLowerCase()}</span>
        {resolution !== undefined && (
          <span className="badge gray" title="Engine question-resolution verdict">question {resolution.status.replace(/_/g, " ").toLowerCase()}</span>
        )}
        {run.stoppedBecause !== undefined && run.stoppedBecause !== "EVIDENCE_SUFFICIENT" && (
          <span className="badge gray" title="Why the engine stopped">stopped: {run.stoppedBecause.replace(/_/g, " ").toLowerCase()}</span>
        )}
        {recordTier !== "FULL" && (
          <span className="badge amber" title="This run's record is not fully retained">
            {recordTier === "JUDGMENT" ? "conclusion only" : "summary only"}
          </span>
        )}
      </div>

      {/* §8A: the JUDGMENT is the visual focal point; elevated surface, larger type.
          Failure/ambiguous states keep honest panel treatment (not a celebratory verdict). */}
      {run.outcome === "COMPLETED" ? (
        <section className="surface-judgment" aria-label="Research judgment">
          <div className="judgment-head">
            <span className="judgment-kicker">Judgment · {run.action.toLowerCase()}</span>
            <ConfidenceMeter confidence={run.answer.confidence} />
          </div>
          <p className="verdict">{run.answer.answer}</p>
          {run.answer.keyUncertainty.length > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--warn)" }}>◆ {run.answer.keyUncertainty}</p>
          )}
          {run.answer.implication.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>↳ {run.answer.implication}</p>
          )}
        </section>
      ) : (
        <Panel
          kicker={`${run.outcome === "MODEL_FAILURE" ? "model unavailable" : run.outcome.toLowerCase().replace(/_/g, " ")} · ${run.action.toLowerCase()}`}
          title={PANEL_TITLES[run.outcome] ?? "Run could not complete"}
        >
          <div className="panel-body" style={{ padding: 14 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>{run.answer.answer}</p>
            {run.answer.keyUncertainty.length > 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--warn)" }}>◆ {run.answer.keyUncertainty}</p>
            )}
          </div>
        </Panel>
      )}

      {run.historicalAnalysis !== undefined && <HistoricalAnalysisView a={run.historicalAnalysis} />}

      {run.outcome === "AWAITING_CONFIRMATION" && (
        <Panel kicker="consequential action" title="This request wants to change persistent state">
          <div className="panel-body" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>Nothing was persisted. Confirm to let the backend proceed:</span>
            <button className="btn sm primary" onClick={onConfirm}>Confirm & re-send</button>
          </div>
        </Panel>
      )}

      {run.modelFailure !== undefined && (
        <Note tone="warn">
          <b>Model unavailable.</b> Lumen could not interpret this research request because its model service is temporarily unavailable ({run.modelFailure.type}). No research result was fabricated; try again shortly.
        </Note>
      )}

      {/* ACTIONABLE INSIGHT (engine-derived): what the evidence shows, what it does NOT
          show, what it means, and what would change the conclusion. Never trade
          instructions; the trader keeps the decision. */}
      {insight !== undefined && (insight.whatItMeans.length > 0 || insight.whatEvidenceShows.length > 0) && (
        <Panel kicker="actionable insight" title="What this means for you">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insight.whatItMeans.length > 0 && (
              <div style={{ fontSize: 14, lineHeight: 1.65 }}>{insight.whatItMeans}</div>
            )}
            {insight.whatEvidenceShows.length > 0 && (
              <div>
                <div className="panel-kicker">what the evidence shows</div>
                {insight.whatEvidenceShows.slice(0, 5).map((r, i) => <Finding key={`s${i}`} text={r} tone="sup" />)}
              </div>
            )}
            {insight.whatEvidenceDoesNotShow.length > 0 && (
              <div>
                <div className="panel-kicker">what the evidence does not show</div>
                {insight.whatEvidenceDoesNotShow.slice(0, 5).map((r, i) => <Finding key={`n${i}`} text={r} tone="opp" />)}
              </div>
            )}
            {insight.whatWouldChangeConclusion.length > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                what would change this conclusion: {insight.whatWouldChangeConclusion.join(" · ")}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* WHY LUMEN REACHED THIS: the structured findings the answer was built from, kept
          separate from the conclusion itself so a reader can audit the reasoning path. */}
      {supporting.length > 0 && (
        <Panel kicker="why lumen reached this" title="Strongest support">
          <div className="panel-body" style={{ paddingTop: 6 }}>
            {supporting.map((r, i) => <Finding key={i} text={r} tone="sup" />)}
          </div>
        </Panel>
      )}
      {opposing.length > 0 && (
        <Panel kicker="why lumen reached this" title="Meaningful opposition">
          <div className="panel-body" style={{ paddingTop: 6 }}>
            {opposing.map((r, i) => <Finding key={i} text={r} tone="opp" />)}
          </div>
        </Panel>
      )}

      {run.evidence.length > 0 && (
        <Panel
          kicker="traceability"
          title="Evidence behind this response"
          right={<button className="btn sm ghost" onClick={onInspectEvidence}>Inspect all evidence →</button>}
        >
          <div>
            {run.evidence.slice(0, 6).map((e) => {
              const item = evidenceById.get(e.ref) ?? evidenceFromDto(e);
              return (
                <div className="ev-item" key={e.ref}>
                  <EpistemicRail cls={item.evidenceClass} />
                  <div className="ev-body">
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{item.observation}</div>
                    <div className="ev-meta">
                      <ClassBadge cls={item.evidenceClass} />
                      <FreshnessBadge freshness={item.freshness} />
                      {item.proxyBasis !== undefined && <ProxyNote basis={item.proxyBasis} />}
                      <span className="ev-time mono">{item.ref} · {timeAgo(item.observedAt)}</span>
                    </div>
                    {item.eventTimestamp !== undefined && (
                      <div className="ev-time mono" style={{ marginTop: 4 }}>observed: {item.eventTimestamp}</div>
                    )}
                    {item.sourceRefs.length > 0 && (
                      <div className="src-refs">
                        {item.sourceRefs.slice(0, 3).map((s, i) => (
                          <span className="src-ref" key={i} title={s}>{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {(() => {
        // GAP SEPARATION (final-judgment contract): the visible coverage panel shows only
        // MATERIAL RESEARCH GAPS the engine assessed (a CRITICAL requirement the run could
        // not satisfy). Provider notes, evidence laws, fallback trails, and provenance
        // caveats are capability diagnostics: they belong in the collapsed detail, never in
        // the wall a trader reads.
        const gaps = [...new Set(run.researchGaps ?? [])];
        const all = [...new Set(run.limitations)];
        const material = gaps.slice(0, 5);
        const detail = all.filter((l) => !material.includes(l));
        if (material.length === 0 && detail.length === 0) return null;
        return (
          <Panel kicker="uncertainty" title={material.length > 0 ? "What this research could not establish" : "What this run could not do"}>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {material.map((l, i) => <UnavailableNote key={`m${i}`} note={l} />)}
              {detail.length > 0 && (
                <details style={{ marginTop: 2 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-3)" }}>
                    {detail.length} data-source note{detail.length === 1 ? "" : "s"} (sources, provenance, evidence laws)
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {detail.map((l, i) => <UnavailableNote key={`d${i}`} note={l} />)}
                  </div>
                </details>
              )}
            </div>
          </Panel>
        );
      })()}

      {watchNext.length > 0 && (
        <Panel kicker="watch next" title="What to watch for next">
          <div className="panel-body" style={{ paddingTop: 6 }}>
            {watchNext.slice(0, 6).map((w, i) => (
              <div className="finding" key={i} style={{ background: "none" }}>
                <span className="tick" aria-hidden>◇</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* DIAGNOSTICS DISCLOSURE: the engine's requirement ledger, executions and gates.
          Collapsed by default (progressive disclosure); never the first thing a trader reads. */}
      <RunDiagnostics run={run} recordTier={recordTier} />

      {run.judgments.length > 0 && (
        <Panel kicker="research objects" title="Judgments created by this request">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {run.judgments.map((j) => (
              <div key={j.ref}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>{j.ref}</span>
                  <StatusBadge status={j.status} />
                  {j.confidence !== undefined && <ConfidenceMeter confidence={j.confidence} />}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{j.statement}</div>
                {j.uncertainty.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>uncertainty: {j.uncertainty.join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* DECISION OWNERSHIP (product law): Lumen researches; the human decides. Nothing on
          this page is an instruction, a recommendation or an execution. */}
      <Note tone="info">
        This research informs your decision; it does not make it. Lumen never executes trades and never changes
        state without your explicit confirmation.
      </Note>
    </>
  );
}

/**
 * Diagnostics disclosure (B3): the engine's own accounting — requirement ledger, capability
 * executions, completion gates, coverage, confidence basis, question-resolution dimensions and
 * transmission links. Collapsed by default: it exists for auditability, not for reading first.
 */
function RunDiagnostics({ run, recordTier }: { run: RunLike; recordTier: ResearchRecordTierDto }) {
  const d = run.researchDiagnostics;
  const resolution = run.questionResolution;
  if (d === undefined && resolution === undefined && recordTier === "FULL") return null;
  return (
    <details className="panel" style={{ padding: "10px 14px" }}>
      <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-3)" }}>
        diagnostics · how this run was produced (requirements, executions, gates)
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {recordTier !== "FULL" && (
          <Note tone="warn">
            This run's full record is not retained (reconstruction: {recordTier.toLowerCase()}). The conclusion above is
            the real persisted research; its supporting diagnostics may be incomplete.
          </Note>
        )}
        {d !== undefined && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <KV k="coverage" v={d.coverage} />
              <KV k="gate" v={d.completionGate} />
              {d.confidence !== undefined && <KV k="confidence" v={d.confidence} />}
              {d.questionType !== undefined && <KV k="question type" v={d.questionType} />}
              <KV k="recovery rounds" v={String(d.recoveryRounds)} />
            </div>
            {d.confidenceBasis !== undefined && d.confidenceBasis !== "" && (
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>confidence basis: {d.confidenceBasis}</div>
            )}
            {d.requirements.length > 0 && (
              <div>
                <div className="panel-kicker">requirement ledger</div>
                {d.requirements.map((r, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "4px 0", borderTop: i === 0 ? undefined : "1px dashed var(--line)" }}>
                    <span className="mono" style={{ color: "var(--text-3)" }}>{r.importance}/{r.role ?? "CORE"} · {r.status}</span>{" "}
                    {r.description}
                    <span className="mono" style={{ color: "var(--text-3)" }}> · {r.evidenceCount} evidence</span>
                    {r.unresolvedReason !== undefined && <div style={{ color: "var(--text-3)" }}>unresolved: {r.unresolvedReason}</div>}
                  </div>
                ))}
              </div>
            )}
            {d.executions.length > 0 && (
              <div>
                <div className="panel-kicker">capability executions</div>
                {d.executions.map((e, i) => (
                  <div key={i} className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", padding: "2px 0" }}>
                    r{e.round} · {e.capability} · {e.provider || "no provider"} · {e.completeness} · {e.evidenceCount} evidence{e.failureType !== "NONE" ? ` · ${e.failureType}` : ""}
                  </div>
                ))}
              </div>
            )}
            {d.causalLinks !== undefined && d.causalLinks.length > 0 && (
              <div>
                <div className="panel-kicker">transmission links</div>
                {d.causalLinks.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "2px 0" }}>
                    <span className="mono">{l.source !== undefined ? `${l.source} → ` : ""}{l.targetLabel}</span> · {l.status}
                    {d.weakestCausalLink === l.target && <span className="badge amber" style={{ marginLeft: 6 }}>weakest link</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {resolution !== undefined && (
          <div>
            <div className="panel-kicker">question resolution · {resolution.intent} · {resolution.status}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 4 }}>
              {resolution.dimensions.map((dim) => (
                <span key={dim.dimension} className={`dim-chip ${dim.fit === "SATISFIED" ? "match" : "diff"}`}>
                  {dim.dimension}: {dim.fit}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
              materiality {resolution.materiality.toLowerCase()} · {resolution.relevantEvidenceCount} relevant of {resolution.evidenceCount} evidence
              {resolution.staleEvidenceCount > 0 ? ` · ${resolution.staleEvidenceCount} stale` : ""}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function Finding({ text, tone }: { text: string; tone: "sup" | "opp" }) {
  return (
    <div className={`finding ${tone}`}>
      <span className="tick" aria-hidden>{tone === "sup" ? "▲" : "▼"}</span>
      <span>{text}</span>
    </div>
  );
}

/**
 * §8D; Flow 5 historical-research presentation. Renders the SERVER-COMPUTED structured
 * analysis: CURRENT SETUP → HISTORICAL ANALOGUES (explained, per-dimension) → FORWARD
 * OUTCOMES → what the record does NOT establish. Timeline-flavored; never a bare
 * "similarity score"; never a prediction.
 */
function HistoricalAnalysisView({ a }: { a: HistoricalAnalysisDto }) {
  return (
    <>
      {a.currentSetup !== undefined && (
        <Panel kicker="historical research · comparison target" title="Current setup">
          <div className="panel-body">
            <div className="setup-grid">
              <div className="surface-metric"><span className="metric-label">as of</span><span className="metric-value mono" style={{ fontSize: 12.5 }}>{a.currentSetup.asOf}</span></div>
              <div className="surface-metric"><span className="metric-label">trend</span><span className="setup-val">{a.currentSetup.trendState}</span></div>
              <div className="surface-metric"><span className="metric-label">momentum</span><span className="setup-val">{a.currentSetup.momentumState}</span></div>
              <div className="surface-metric"><span className="metric-label">volatility</span><span className="setup-val">{a.currentSetup.volatilityState}</span></div>
              <div className="surface-metric"><span className="metric-label">range position</span><span className="setup-val">{a.currentSetup.rangePositionState}</span></div>
              <div className="surface-metric"><span className="metric-label">volume</span><span className="setup-val">{a.currentSetup.volumeState}</span></div>
            </div>
            <div className="src-refs" style={{ borderTop: "none", paddingTop: 6 }}>
              <span className="src-ref" title={a.currentSetup.basis}>basis: {a.currentSetup.basis}</span>
            </div>
          </div>
        </Panel>
      )}

      <Panel
        kicker="historical research · analogues"
        title={`${a.matches.length} comparable episode${a.matches.length === 1 ? "" : "s"} of ${a.episodesEvaluated} evaluated`}
      >
        <div>
          {a.matches.length === 0 && (
            <div className="panel-body" style={{ color: "var(--text-2)", fontSize: 13 }}>
              No comparable episodes met the similarity threshold; the current setup may be genuinely novel, or the feature comparison too narrow.
            </div>
          )}
          {a.matches.map((m) => (
            <div className="episode" key={m.anchorDate}>
              <div className="episode-anchor">
                <span className="episode-date mono">{m.anchorDate}</span>
                <span className="episode-window mono">window {m.window.from} → {m.window.to}</span>
              </div>
              <div className="dims">
                {m.dimensions.map((d) => (
                  <span key={d.dimension} className={`dim-chip ${d.matched ? "match" : "diff"}`} title={`${d.referenceValue} vs ${d.episodeValue}`}>
                    <span className="dim-mark" aria-hidden>{d.matched ? "≈" : "≠"}</span> {d.dimension}
                  </span>
                ))}
              </div>
              {m.differences.length > 0 && (
                <div className="episode-diffs">differs: {m.differences.join(" · ")}</div>
              )}
              <table className="outcomes">
                <thead>
                  <tr><th>window</th><th>forward return</th><th>max favorable</th><th>max adverse</th><th>direction held</th></tr>
                </thead>
                <tbody>
                  {m.outcomes.map((o) => (
                    <tr key={o.days}>
                      <td className="mono">{o.days}d</td>
                      <td className={`mono ${o.forwardReturnPct >= 0 ? "pos" : "neg"}`}>{o.forwardReturnPct >= 0 ? "+" : ""}{o.forwardReturnPct.toFixed(2)}%</td>
                      <td className="mono pos">+{o.mfePct.toFixed(2)}%</td>
                      <td className="mono neg">−{o.maePct.toFixed(2)}%</td>
                      <td className="mono">{o.directionPersisted ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Panel>

      <Note tone="info">
        <b>What this does not establish:</b> {a.interpretiveNote} Historical precedent describes what happened before; it does not predict and does not recommend any action.
      </Note>
    </>
  );
}
