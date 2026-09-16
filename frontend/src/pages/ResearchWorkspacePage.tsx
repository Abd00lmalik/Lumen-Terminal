/**
 * Research workspace — the primary screen, wired to the REAL backend.
 *
 * - The ask-bar submits natural language to the backend (no keyword routing here).
 * - While running, the page renders the real SSE progress stages; when finished,
 *   the backend's ResearchResponseDTO is rendered verbatim: answer card, supporting/
 *   opposing reasons, uncertainty, limitations, and epistemically-classified evidence.
 * - The context rail shows the real continuity snapshot (active thesis, judgment,
 *   recent evidence). Empty/failed/partial states render the backend's own state.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import {
  Panel, ClassBadge, EpistemicRail, FreshnessBadge, ConfidenceMeter, StatusBadge,
  ProxyNote, UnavailableNote, KV, Note, Empty, timeAgo,
} from "../components/ui.js";
import { evidenceFromDto, judgmentFromDto } from "../data/adapters.js";
import { submitResearch, getWorkspace } from "../api/index.js";
import type { EvidenceItem, JudgmentView, ThesisView } from "../data/types.js";
import type { ResearchResponseDto, ContinuitySnapshotDto } from "../api/index.js";
import { useResearchStream } from "../hooks/useResearchStream.js";

interface WorkspaceData {
  readonly evidence: readonly EvidenceItem[];
  readonly judgment: JudgmentView | undefined;
  readonly thesis: ThesisView | undefined;
  readonly snapshot: ContinuitySnapshotDto | undefined;
  readonly loadError: string | undefined;
}

interface Turn {
  readonly question: string;
  readonly run: ResearchResponseDto;
}

export function ResearchWorkspacePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [runs, setRuns] = useState<readonly Turn[]>([]);
  const [ws, setWs] = useState<WorkspaceData>({ evidence: [], judgment: undefined, thesis: undefined, snapshot: undefined, loadError: undefined });
  const { state: stream } = useResearchStream();

  const refresh = useCallback(async () => {
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
      setWs((prev) => ({ ...prev, loadError: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const ask = async (question: string, confirmed = false) => {
    const q = question.trim();
    if (q.length === 0 || stream.running || submitting) return;
    setInput("");
    setSubmitting(true);
    try {
      const dto = await submitResearch(q, confirmed);
      setRuns((prev) => [...prev, { question: q, run: dto }]);
      await refresh();
    } catch (err) {
      // JSON-path failures render as a typed failure turn — the backend's own
      // error vocabulary, never mock content standing in for a failure.
      const code = (err as { code?: string }).code ?? "NETWORK";
      const message = err instanceof Error ? err.message : String(err);
      setRuns((prev) => [...prev, {
        question: q,
        run: {
          requestId: crypto.randomUUID(),
          action: "RESEARCH",
          outcome: code === "MODEL_FAILURE" ? "MODEL_FAILURE" : code === "AWAITING_CONFIRMATION" ? "AWAITING_CONFIRMATION" : code === "INVALID_REQUEST" ? "REJECTED" : "MODEL_FAILURE",
          answer: { answer: message, supportingReasons: [], opposingReasons: [], confidence: "UNKNOWN", keyUncertainty: "", implication: "", citedObjectRefs: [] },
          limitations: [],
          evidence: [],
          judgments: [],
          evidenceRefs: [],
        },
      }]);
    } finally {
      setSubmitting(false);
    }
  };

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
            placeholder="Ask a research question — e.g. why did BTC drop this morning?"
            aria-label="Ask a research question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void ask(input)}
            disabled={stream.running || submitting}
          />
        </div>
        <button className="btn primary" onClick={() => void ask(input)} disabled={stream.running || submitting || input.trim().length === 0}>
          {stream.running || submitting ? "Researching…" : "Research"}
        </button>
      </div>

      {ws.loadError !== undefined && (
        <Note tone="warn">
          <b>Backend unreachable.</b> {ws.loadError} — start it with <code>npm run api</code>, then refresh.
          No mock content is shown in its place.
        </Note>
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

      {runs.length === 0 && !stream.running && ws.loadError === undefined && (
        <Empty title="No research in this workspace yet" hint="Type a natural-language question above — the agent plans and investigates." />
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

      <Panel
        kicker={`${run.outcome.toLowerCase()} · ${run.action.toLowerCase()}`}
        title={run.outcome === "COMPLETED" ? "Judgment" : run.outcome === "AWAITING_CONFIRMATION" ? "Confirmation required" : run.outcome === "REJECTED" ? "Request rejected" : "Interpretation failed"}
        right={<ConfidenceMeter confidence={run.answer.confidence} />}
      >
        <div className="panel-body answer-card" style={{ borderLeft: "none", padding: 14 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>{run.answer.answer}</p>
          {run.answer.keyUncertainty.length > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--warn)" }}>◆ {run.answer.keyUncertainty}</p>
          )}
          {run.answer.implication.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>↳ {run.answer.implication}</p>
          )}
        </div>
      </Panel>

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
          <b>Model failure ({run.modelFailure.type}).</b> {run.modelFailure.message} — no evidence was fabricated to cover it.
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

      {run.limitations.length > 0 && (
        <Panel kicker="honest limitations" title="What this run could not do">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {run.limitations.map((l, i) => <UnavailableNote key={i} note={l} />)}
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
