/**
 * Home; workspace-oriented entry, wired to REAL backend state: research history
 * with explicit current-ness, active thesis, monitor counts, recent evidence,
 * contradictions and uncertainties from the continuity snapshot.
 * Empty workspace renders an honest empty state; no fictional examples.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, StatusBadge, Empty, Note, timeAgo } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { listResearch, getWorkspace } from "../api/index.js";
import { homeDataFromSnapshot, thesisFromDto } from "../data/adapters.js";
import { listTheses } from "../api/index.js";
import type { WorkspaceListItem, ThesisView } from "../data/types.js";
import type { ResearchDto } from "../api/index.js";

export function HomePage() {
  const navigate = useNavigate();
  const [research, setResearch] = useState<readonly WorkspaceListItem[]>([]);
  const [thesis, setThesis] = useState<ThesisView | undefined>(undefined);
  const [counts, setCounts] = useState({ active: 0, proposed: 0 });
  const [contradictions, setContradictions] = useState<readonly string[]>([]);
  const [uncertainties, setUncertainties] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    void (async () => {
      // Each load path is INDEPENDENT: one failed endpoint (e.g. a transient 404/timeout)
      // must not blank the whole home page — previously one rejected promise in this
      // Promise.all discarded the research history that had already loaded fine.
      const settled = await Promise.allSettled([listResearch(), getWorkspace(), listTheses()]);
      const all = settled[0].status === "fulfilled" ? settled[0].value : [];
      const snapshot = settled[1].status === "fulfilled" ? settled[1].value : undefined;
      const theses = settled[2].status === "fulfilled" ? settled[2].value : [];
      if (settled.every((s) => s.status === "rejected")) {
        setError(settled.find((s) => s.status === "rejected") as PromiseRejectedResult);
        setLoaded(true);
        return;
      }
      if (snapshot !== undefined) {
        setResearch(homeDataFromSnapshot(snapshot, all).research);
        setCounts(homeDataFromSnapshot(snapshot, all).monitorCounts);
        setContradictions(snapshot.importantContradictions);
        setUncertainties(snapshot.unresolvedUncertainties);
      } else if (all.length > 0) {
        // Snapshot unavailable: still render history from the research list alone.
        setResearch(all.map((r) => ({
          ref: r.ref,
          title: r.question.length > 0 ? r.question : r.objective,
          kind: "research" as const,
          status: r.status,
          updatedAt: r.history.length > 0 ? r.history[r.history.length - 1]! : new Date().toISOString(),
          meta: r.flow.replace(/_/g, " ").toLowerCase(),
        })));
      }
      const active = theses.find((t) => t.isActive) ?? theses[theses.length - 1];
      if (active !== undefined && snapshot !== undefined) {
        const assessments = (snapshot.latestThesisAssessment !== undefined && snapshot.latestThesisAssessment.thesisRef === active.ref)
          ? [snapshot.latestThesisAssessment]
          : [];
        setThesis(thesisFromDto(active, assessments));
      }
      setLoaded(true);
    })();
  }, []);

  const active = research.filter((r) => (r as WorkspaceListItem & { status?: string }).status === "ACTIVE" || (r as { status?: string }).status === "CURRENT");
  const recent = research.filter((r) => !active.includes(r));

  return (
    <AppShell
      title="Home"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Active thesis</div>
            {thesis !== undefined ? (
              <>
                <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 8 }}>{thesis.statement}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StatusBadge status={thesis.status} />
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>v{thesis.version}</span>
                </div>
              </>
            ) : (
              <Empty title="No theses yet" hint="Create one via research, then SAVE it." />
            )}
          </div>
          <div className="rail-section">
            <div className="rail-title">Monitoring</div>
            <div className="kv"><span className="k">active</span><span className="v">{counts.active}</span></div>
            <div className="kv"><span className="k">proposed</span><span className="v">{counts.proposed}</span></div>
          </div>
          {contradictions.length > 0 && (
            <div className="rail-section">
              <div className="rail-title">Important contradictions</div>
              {contradictions.slice(0, 4).map((c, i) => <Note key={i} tone="warn">{c}</Note>)}
            </div>
          )}
          {uncertainties.length > 0 && (
            <div className="rail-section">
              <div className="rail-title">Open uncertainties</div>
              {uncertainties.slice(0, 4).map((u, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--text-3)", padding: "4px 0", borderTop: i === 0 ? undefined : "1px dashed var(--line)" }}>◆ {u}</div>
              ))}
            </div>
          )}
        </>
      }
    >
      {/* §8G; home hero: the primary action is asking a research question; example
          questions seed the ask flow without inventing any data. */}
      <section className="home-hero">
        <div className="hero-kicker">AI research workbench</div>
        <h1 className="home-title">Ask a research question.</h1>
        <p className="home-sub">
          Lumen investigates with real market capabilities, classifies every piece of evidence,
          and hands you a judgment with its uncertainty; research informs your decision; it never becomes it.
        </p>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => navigate("/research")}>Ask a research question →</button>
          <button className="btn ghost" onClick={() => navigate("/thesis")}>Review thesis</button>
        </div>
        <div className="hero-examples" aria-label="Example research questions">
          {[
            "What is affecting BTC right now?",
            "Why did BTC move recently?",
            "Search historical data for similar BTC setups",
          ].map((q) => (
            <button key={q} className="example-chip" onClick={() => navigate("/research", { state: { question: q } })}>
              {q}
            </button>
          ))}
        </div>
      </section>

      {error !== undefined && <BackendDownNote error={error} />}

      <div className="search-wrap" style={{ maxWidth: 560, marginBottom: "var(--gap-5)" }}>
        <span className="search-icon" aria-hidden>⌕</span>
        <input className="search" placeholder="Search research, theses, evidence…" aria-label="Search workspace" />
      </div>

      {active.length > 0 && (
        <Panel title="Current research" kicker="the workspace's active context">
          <div className="row-list">
            {active.map((r) => (
              <button
                className="row" style={{ width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid var(--line)", color: "inherit", cursor: "pointer" }}
                key={r.ref} onClick={() => navigate("/research")}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">{r.title}</div>
                  <div className="row-meta">{r.meta} · {timeAgo(r.updatedAt)}</div>
                </div>
                <div className="row-right"><StatusBadge status={r.status} /></div>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Research history" kicker="everything the engine has run">
        <div className="row-list">
          {recent.map((r) => (
            <button
              className="row" style={{ width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid var(--line)", color: "inherit", cursor: "pointer" }}
              key={r.ref} onClick={() => navigate("/research")}
            >
              <div style={{ minWidth: 0 }}>
                <div className="row-title">{r.title}</div>
                <div className="row-meta">{r.meta} · {timeAgo(r.updatedAt)}</div>
              </div>
              <div className="row-right"><StatusBadge status={r.status} /></div>
            </button>
          ))}
          {loaded && error === undefined && research.length === 0 && (
            <Empty title="No research yet" hint="Start with a question about BTC or ETH in the research workspace." />
          )}
        </div>
      </Panel>
    </AppShell>
  );
}

void ({} as unknown as ResearchDto);
