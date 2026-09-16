/**
 * Home — workspace-oriented entry, wired to REAL backend state: research history
 * with explicit current-ness, active thesis, monitor counts, recent evidence,
 * contradictions and uncertainties from the continuity snapshot.
 * Empty workspace renders an honest empty state — no fictional examples.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, StatusBadge, Empty, Note, timeAgo } from "../components/ui.js";
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
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const [all, snapshot, theses] = await Promise.all([listResearch(), getWorkspace(), listTheses()]);
        setResearch(homeDataFromSnapshot(snapshot, all).research);
        const active = theses.find((t) => t.isActive) ?? theses[theses.length - 1];
        if (active !== undefined) {
          const assessments = (snapshot.latestThesisAssessment !== undefined && snapshot.latestThesisAssessment.thesisRef === active.ref)
            ? [snapshot.latestThesisAssessment]
            : [];
          setThesis(thesisFromDto(active, assessments));
        }
        setCounts(homeDataFromSnapshot(snapshot, all).monitorCounts);
        setContradictions(snapshot.importantContradictions);
        setUncertainties(snapshot.unresolvedUncertainties);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      }
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
      <div className="page-head" style={{ display: "flex", gap: "var(--gap-4)", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Workspace</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>Your live research state — loaded from the backend, nothing invented.</p>
        </div>
        <button className="btn primary" onClick={() => navigate("/research")}>+ New research</button>
      </div>

      {error !== undefined && (
        <Note tone="warn">
          <b>Backend unreachable.</b> {error} — start it with <code>npm run api</code> and refresh.
        </Note>
      )}

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
