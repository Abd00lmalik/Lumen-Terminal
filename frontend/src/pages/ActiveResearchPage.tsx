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

/**
 * RESEARCH QUALITY (structured research state, not chain-of-thought): what the engine had to
 * know, which decision role each requirement plays, how the run ended, and — when the question
 * named a transmission chain — the engine's per-arrow status, with the weakest arrow called out.
 * Collapsed by default: the trader's answer stays the main surface.
 */
function ResearchQuality({ result }: { result: ResearchResponseDto }) {
  const d = result.researchDiagnostics;
  if (d === undefined) return null;
  const byRole = new Map<string, { covered: number; total: number }>();
  for (const r of d.requirements) {
    const role = r.role ?? "CORE";
    const entry = byRole.get(role) ?? { covered: 0, total: 0 };
    entry.total += 1;
    if (r.status === "SATISFIED") entry.covered += 1;
    byRole.set(role, entry);
  }
  const links = d.causalLinks ?? [];
  return (
    <Panel kicker="research quality" title="What Lumen checked">
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12.5 }}>
          {d.questionType !== undefined && <StatusBadge status={d.questionType} />}
          <span className="counts">coverage {d.coverage.toLowerCase()}</span>
          {d.confidence !== undefined && <span className="counts">confidence {d.confidence.toLowerCase()} (engine-computed)</span>}
          <span className="counts">gate {d.completionGate}</span>
          {d.recoveryRounds > 0 && <span className="counts">{d.recoveryRounds} recovery round(s)</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[...byRole.entries()].map(([role, c]) => (
            <div key={role} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span style={{ color: "var(--text-2)" }}>{role.toLowerCase()} requirements</span>
              <span className="counts">{c.covered}/{c.total} established</span>
            </div>
          ))}
        </div>
        {links.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>transmission links (evidence for the nodes is not evidence for the arrows)</div>
            {links.map((l) => (
              <div key={l.requirementId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                <span style={{ color: "var(--text-2)" }}>
                  {l.targetLabel}
                  {l.target === d.weakestCausalLink ? " · weakest link" : ""}
                </span>
                <span className="counts" style={l.status === "SUPPORTED" ? undefined : { color: "var(--warn)" }}>
                  {l.status.toLowerCase().replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
        <details>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-3)" }}>Research diagnostics (requirements, capabilities, provenance)</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {d.requirements.map((r) => (
              <div key={r.description} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                <span style={{ color: "var(--text-2)" }}>{r.role ?? "CORE"} · {r.description}</span>
                <span className="counts">{r.status}{r.status === "SATISFIED" ? ` (${r.evidenceCount})` : ""}</span>
              </div>
            ))}
            {d.confidenceBasis !== undefined && (
              <div className="mono" style={{ fontSize: 11.5, color: "var(--text-3)" }}>{d.confidenceBasis}</div>
            )}
          </div>
        </details>
      </div>
    </Panel>
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

      {(() => {
        // Gap separation: research gaps (engine-assessed) are the visible coverage story;
        // capability/provider notes stay in the collapsed detail.
        const gaps = [...new Set(result.researchGaps ?? [])];
        const notes = [...new Set(result.limitations)].filter((l) => !gaps.includes(l));
        if (gaps.length === 0 && notes.length === 0) return null;
        return (
          <Panel kicker="limitations" title={gaps.length > 0 ? "What this research could not establish" : "What this run could not do"}>
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {gaps.map((l, i) => <UnavailableNote key={`g${i}`} note={l} />)}
              {notes.length > 0 && (
                <details style={{ marginTop: 2 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-3)" }}>
                    {notes.length} data-source note{notes.length === 1 ? "" : "s"} (sources, provenance, evidence laws)
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {notes.map((l, i) => <UnavailableNote key={`n${i}`} note={l} />)}
                  </div>
                </details>
              )}
            </div>
          </Panel>
        );
      })()}

      <ResearchQuality result={result} />

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
