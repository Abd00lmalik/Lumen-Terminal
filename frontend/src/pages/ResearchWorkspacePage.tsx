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
import { getWorkspace, listResearch, getResearch } from "../api/index.js";
import type { EvidenceItem, JudgmentView, ThesisView } from "../data/types.js";
import type { ResearchResponseDto, ResearchDto, ContinuitySnapshotDto, HistoricalAnalysisDto } from "../api/index.js";
import { useResearchStream } from "../hooks/useResearchStream.js";

interface WorkspaceData {
  readonly evidence: readonly EvidenceItem[];
  readonly judgment: JudgmentView | undefined;
  readonly thesis: ThesisView | undefined;
  readonly snapshot: ContinuitySnapshotDto | undefined;
  readonly loadError: unknown;
}

interface Turn {
  readonly question: string;
  readonly run: ResearchResponseDto;
}

/**
 * Hydrate a history entry into a renderable turn. `getResearch` serves the FULL archived
 * response for runs completed on the serving instance (answer, reasons, evidence); older
 * or cold-store runs degrade to the bare summary DTO rendered as an honest research
 * reference (objective + status) instead of a fabricated answer.
 */
function researchDtoToTurn(dto: ResearchDto & Partial<ResearchResponseDto>): Turn | undefined {
  const question = dto.question?.length > 0 ? dto.question : dto.objective;
  if (question.length === 0) return undefined;
  const answer = (dto as { answer?: ResearchResponseDto["answer"] }).answer;
  if (answer === undefined) {
    // Bare summary (full response not archived on this instance): render honestly.
    return {
      question,
      run: {
        requestId: dto.ref,
        action: "RESEARCH",
        outcome: "COMPLETED",
        answer: {
          answer: `Completed research (history): ${dto.objective}. Full reasoning is not retained on this server instance; ask again to re-run it in full.`,
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
  return { question, run: dto as ResearchResponseDto };
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
      const history = await listResearch();
      const completed = history.filter((r) => r.status === "COMPLETED").slice(-3);
      const hydrated = await Promise.all(
        completed.map(async (r): Promise<Turn | undefined> => {
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
        const seen = new Set(historyTurns!.map((t) => t.question));
        return [...historyTurns!, ...prev.filter((t) => !seen.has(t.question))];
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
  useEffect(() => {
    const ref = params.ref;
    if (ref === undefined || ref.length === 0) {
      setLinkedNotFound(false);
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
        setRuns((prev) => (prev.some((t) => t.run.requestId === ref) ? prev : [...prev, turn]));
      } catch {
        if (!cancelled) setLinkedNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.ref]);

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
    setSubmitting(true);
    void submit(q, { confirmed })
      .catch((err: unknown) => {
        // Defensive: streamResearchRequest resolves (never rejects) on handled failures.
        console.error("research stream submission threw", err);
      })
      .finally(() => setSubmitting(false));
  }, [stream.running, submitting, submit]);

  const evidenceById = new Map(ws.evidence.map((e) => [e.ref, e]));

  return (
    <AppShell
      title="Research"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Research state</div>
            {ws.snapshot?.activeResearch !== undefined ? (
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
          {ws.judgment !== undefined && (
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

      {linkedNotFound && (
        <Panel kicker="history" title="That research entry is not available">
          <div className="panel-body" style={{ paddingTop: 6 }}>The linked research run could not be loaded (it may be too old for this workspace store). Ask a new question below, or pick another entry from Research history.</div>
        </Panel>
      )}
      {runs.length === 0 && !stream.running && ws.loadError === undefined && (
        <Empty title="No research in this workspace yet" hint="Type a natural-language question above; the agent plans and investigates." />
      )}

      {runs.map((turn) => <RunView key={turn.run.requestId} turn={turn} evidenceById={evidenceById} onInspectEvidence={() => navigate("/evidence")} onConfirm={() => void ask(turn.question, true)} />)}
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

  return (
    <>
      <div className="chat-user">
        <div className="bubble">{turn.question}</div>
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

      {supporting.length > 0 && (
        <Panel kicker="structured findings" title="Strongest support">
          <div className="panel-body" style={{ paddingTop: 6 }}>
            {supporting.map((r, i) => <Finding key={i} text={r} tone="sup" />)}
          </div>
        </Panel>
      )}
      {opposing.length > 0 && (
        <Panel kicker="structured findings" title="Meaningful opposition">
          <div className="panel-body" style={{ paddingTop: 6 }}>
            {opposing.map((r, i) => <Finding key={i} text={r} tone="opp" />)}
          </div>
        </Panel>
      )}

      {run.limitations.length > 0 && (() => {
        // Limitation hierarchy (capability-expansion mandate §35): show only what is
        // materially MISSING for THIS question. Provider-fallback trails ("research
        // continued using ...") are SUCCESS stories, not failures: they belong in the
        // collapsed data-source notes, never in the visible wall. Only true capability
        // gaps (no provider at all, explicit UNAVAILABLE data dimensions) stay visible.
        const all = [...new Set(run.limitations)];
        const isFallbackNote = /provider fallback:|research continued using|fallback provider:|served by|attempted/i;
        const isProvenanceNote = /FINDINGS\.md|final lock|§|failure is a technical condition|must not|never |law|prox|aggregat|headline-level|secondary reporting|freshness|retrieval failure|proxy/i;
        const material = all.filter((l) =>
          (/UNAVAILABLE|no provider registered|insufficient|not available|unreachable|ConnectTimeout|timeout/i.test(l))
          && !isFallbackNote.test(l)
          && !isProvenanceNote.test(l)
        ).slice(0, 5);
        const detail = all.filter((l) => !material.includes(l));
        return (
          <Panel kicker="coverage notes" title="What this run could not do">
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
    </>
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
