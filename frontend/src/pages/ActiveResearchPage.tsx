/**
 * Active research; the REAL SSE progress surface. Every stage line is a backend
 * progress event (stage id, summary, safe data); capabilities appear when the engine
 * actually starts/completes them; the only timer is real elapsed time. When the run
 * finishes, the backend's final ResearchResponseDTO renders verbatim.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, StatusBadge, Note, Empty, ClassBadge, EpistemicRail, FreshnessBadge, ConfidenceMeter, UnavailableNote, timeAgo } from "../components/ui.js";
import { useResearchStream } from "../hooks/useResearchStream.js";
import { evidenceFromDto } from "../data/adapters.js";
import type { ResearchResponseDto } from "../api/index.js";

export function ActiveResearchPage() {
  const navigate = useNavigate();
  const { state: run, submit } = useResearchStream();
  const [question, setQuestion] = useState("");

  const started = run.stages.length > 0 || run.running || run.error !== undefined;

  return (
    <AppShell
      title="Research · running"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Run</div>
            <div className="kv"><span className="k">elapsed</span><span className="v">{run.elapsedSeconds}s</span></div>
            <div className="kv"><span className="k">stages seen</span><span className="v">{run.stages.length}</span></div>
            <div className="kv"><span className="k">capabilities</span><span className="v">{run.capabilities.length}</span></div>
          </div>
          {run.question !== "" && (
            <div className="rail-section">
              <div className="rail-title">Question</div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{run.question}</div>
            </div>
          )}
          <div className="rail-section">
            <div className="rail-title">Honesty rules</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
              Every stage below is a real backend event; none are simulated. A capability
              returning nothing is recorded as unavailability, never as evidence against you.
            </div>
          </div>
        </>
      }
    >
      <div className="ask-bar">
        <div className="search-wrap" style={{ maxWidth: "none" }}>
          <input
            className="search"
            placeholder="Ask a research question to watch the real pipeline…"
            aria-label="Ask a research question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && question.trim().length > 0 && !run.running) { submit(question.trim()); setQuestion(""); } }}
            disabled={run.running}
          />
        </div>
        <button
          className="btn primary"
          disabled={run.running || question.trim().length === 0}
          onClick={() => { submit(question.trim()); setQuestion(""); }}
        >
          {run.running ? "Running…" : "Start research"}
        </button>
      </div>

      {!started && (
        <Empty title="No run in progress" hint="Submit a question above; the pipeline stages shown here come from the backend's own event stream." />
      )}

      {run.error !== undefined && (
        <Panel kicker={`error · ${run.error.code.toLowerCase()}`} title="The run failed">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Note tone="warn">{run.error.message}</Note>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              No research content is displayed because none was produced.
            </span>
          </div>
        </Panel>
      )}

      {started && run.error === undefined && (
        <>
          <div className="page-head">
            <h1 className="page-title" style={{ fontSize: 20 }}>{run.question}</h1>
            <p className="page-sub" style={{ marginBottom: 0 }}>
              {run.running ? "Research is running; stages appear as the backend reports them." : "Run finished; the final result below is the backend's own response."}
            </p>
          </div>

          <Panel kicker="live backend events" title="Research pipeline"
            right={<span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{run.elapsedSeconds}s elapsed</span>}>
            <div className="panel-body" style={{ paddingTop: 6 }}>
              {run.stages.length === 0 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>waiting for the first backend event…</div>}
              {run.stages.map((s, i) => (
                <div className="run-stage" key={`${s.stage}-${i}`}>
                  <span className={`stage-dot ${s.status === "active" ? "active" : "done"}`} aria-hidden>{s.status === "active" ? "●" : "✓"}</span>
                  <div>
                    <div className={`stage-name ${s.status === "active" ? "" : "pending"}`}>
                      {s.name}
                      <span className="mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--text-3)" }}>{s.stage}</span>
                      {s.status === "active" && <span className="mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--accent)" }}>running</span>}
                    </div>
                    <div className="stage-detail">{s.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {run.capabilities.length > 0 && (
            <Panel kicker="capabilities in use" title="Investigation tasks">
              <div className="panel-body" style={{ paddingTop: 6 }}>
                {run.capabilities.map((c) => (
                  <div className="cap-chip" key={c.name}>
                    <span className="mono">{c.name}</span>
                    <StatusBadge status={c.status} />
                    <span className="counts">{c.detail}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {run.findings.length > 0 && (
            <Panel kicker="round decisions" title="Adaptive loop progress">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {run.findings.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                    <span aria-hidden style={{ color: "var(--text-3)" }}>▸</span>
                    <span style={{ color: "var(--text-2)" }}>{f}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {run.result !== undefined && <ResultView result={run.result} onInspectEvidence={() => navigate("/evidence")} />}
        </>
      )}
    </AppShell>
  );
}

/** Renders the backend's final ResearchResponseDTO verbatim. */
function ResultView({ result, onInspectEvidence }: { result: ResearchResponseDto; onInspectEvidence: () => void }) {
  return (
    <>
      <Panel
        kicker={`${result.outcome.toLowerCase()} · ${result.action.toLowerCase()}`}
        title="Final result"
        right={<ConfidenceMeter confidence={result.answer.confidence} />}
      >
        <div className="panel-body answer-card" style={{ borderLeft: "none", padding: 14 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>{result.answer.answer}</p>
          {result.answer.keyUncertainty.length > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--warn)" }}>◆ {result.answer.keyUncertainty}</p>
          )}
        </div>
      </Panel>

      {result.limitations.length > 0 && (
        <Panel kicker="limitations" title="What this run could not do">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Defensive dedupe, matching the workspace rendering. */}
            {[...new Set(result.limitations)].map((l, i) => <UnavailableNote key={i} note={l} />)}
          </div>
        </Panel>
      )}

      {result.evidence.length > 0 && (
        <Panel kicker="traceability" title="Evidence" right={<button className="btn sm ghost" onClick={onInspectEvidence}>Inspect all evidence →</button>}>
          <div>
            {result.evidence.slice(0, 8).map((e) => {
              const item = evidenceFromDto(e);
              return (
                <div className="ev-item" key={e.ref}>
                  <EpistemicRail cls={item.evidenceClass} />
                  <div className="ev-body">
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{item.observation}</div>
                    <div className="ev-meta">
                      <ClassBadge cls={item.evidenceClass} />
                      <FreshnessBadge freshness={item.freshness} />
                      <span className="ev-time mono">{item.ref} · {timeAgo(item.observedAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </>
  );
}
