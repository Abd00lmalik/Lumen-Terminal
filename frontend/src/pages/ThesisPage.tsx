/**
 * Thesis workspace — the trader's thesis from the REAL backend. Assessments come
 * from the auditable assessment history; the thesis text itself is rendered verbatim
 * and is never edited by the system. Confidence and research quality render separately.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, ConfidenceMeter, StatusBadge, Note, KV, Empty, timeAgo } from "../components/ui.js";
import { listTheses, getThesis } from "../api/index.js";
import { thesisFromDto } from "../data/adapters.js";
import type { ThesisView } from "../data/types.js";
import type { ThesisDto } from "../api/index.js";

export function ThesisPage() {
  const navigate = useNavigate();
  const [thesis, setThesis] = useState<ThesisView | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const theses = await listTheses();
        const dto: ThesisDto | undefined = theses.find((t) => t.isActive) ?? theses[theses.length - 1];
        if (dto !== undefined) {
          const detail = await getThesis(dto.ref);
          setThesis(thesisFromDto(detail, detail.assessments));
        }
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <AppShell
      title="Thesis"
      contextRail={
        <>
          {thesis !== undefined ? (
            <>
              <div className="rail-section">
                <div className="rail-title">Thesis record</div>
                <KV k="ref" v={thesis.ref} />
                <KV k="version" v={`v${thesis.version}`} />
                <KV k="status" v={thesis.status} />
                <KV k="objective" v={thesis.objective} />
                <KV k="updated" v={timeAgo(thesis.updatedAt)} />
              </div>
              {thesis.assessments.length > 0 && (
                <div className="rail-section">
                  <div className="rail-title">Latest assessment</div>
                  <StatusBadge status={thesis.assessments[thesis.assessments.length - 1]!.assessment} />
                  <div style={{ marginTop: 8 }}>
                    <ConfidenceMeter confidence={thesis.assessments[thesis.assessments.length - 1]!.confidence} />
                  </div>
                  <div className="kv"><span className="k">research quality</span><span className="v">{thesis.assessments[thesis.assessments.length - 1]!.researchQuality}</span></div>
                </div>
              )}
            </>
          ) : (
            <div className="rail-section">
              <div className="rail-title">Thesis record</div>
              <Empty title="No thesis" />
            </div>
          )}
          <Note>
            Assessments are research results. The thesis object is never modified by them —
            revision is a separate, explicit trader action.
          </Note>
        </>
      }
    >
      <div className="page-head">
        <h1 className="page-title">Thesis</h1>
        <p className="page-sub">Loaded from the backend — the trader's property, evaluated but never rewritten.</p>
      </div>

      {error !== undefined && (
        <Note tone="warn">
          <b>Backend unreachable.</b> {error} — start it with <code>npm run api</code> and refresh.
        </Note>
      )}

      {loaded && error === undefined && thesis === undefined && (
        <Empty
          title="No thesis in this workspace yet"
          hint="Ask the agent to save one: e.g. 'Save a thesis: BTC follows liquidity cycles' — then make it active."
        />
      )}

      {thesis !== undefined && (
        <>
          <div className="page-head" style={{ display: "flex", alignItems: "flex-start", gap: "var(--gap-4)" }}>
            <div style={{ flex: 1 }}>
              <div className="panel-kicker" style={{ marginBottom: 6 }}>trader-owned · v{thesis.version} · {timeAgo(thesis.updatedAt)}</div>
              <h1 className="page-title" style={{ maxWidth: 760, lineHeight: 1.3, fontSize: 22 }}>{thesis.statement}</h1>
            </div>
            <button className="btn" onClick={() => navigate("/challenge")}>Challenge this thesis →</button>
          </div>

          <div style={{ display: "flex", gap: "var(--gap-4)", alignItems: "center", marginBottom: "var(--gap-5)" }}>
            <span className="panel-kicker">current confidence</span>
            <ConfidenceMeter confidence={thesis.confidence} />
            <span className="panel-kicker" style={{ marginLeft: 16 }}>research quality</span>
            <span className="badge gray">{thesis.researchQuality}</span>
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>— quality and confidence are different things; both are shown.</span>
          </div>

          <div className="grid-2">
            <Panel kicker="claims" title="What the thesis asserts">
              <div className="panel-body">
                {thesis.claims.map((c) => (
                  <div key={c.statement} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={`badge ${c.importance === "CORE" ? "teal" : "gray"}`}>{c.importance}</span>
                    </div>
                    <div style={{ fontSize: 13.5, margin: "6px 0 4px" }}>{c.statement}</div>
                  </div>
                ))}
                {thesis.claims.length === 0 && <Empty title="No claims recorded" />}
              </div>
            </Panel>

            <Panel kicker="assumptions" title="What it rests on">
              <div className="panel-body">
                {thesis.assumptions.map((a) => (
                  <div key={a.statement} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13.5 }}>{a.statement}</div>
                  </div>
                ))}
                {thesis.assumptions.length === 0 && <Empty title="No assumptions recorded" />}
              </div>
            </Panel>
          </div>

          <Panel kicker="invalidation conditions" title="What would break the thesis">
            <div className="panel-body">
              {thesis.invalidationConditions.length === 0 && <span style={{ fontSize: 13, color: "var(--text-3)" }}>None recorded.</span>}
              {thesis.invalidationConditions.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13.5, borderTop: i === 0 ? undefined : "1px dashed var(--line)" }}>
                  <span aria-hidden style={{ color: "var(--down)" }}>⨯</span>{c}
                </div>
              ))}
            </div>
          </Panel>

          <Panel kicker="assessment history" title={`${thesis.assessments.length} assessments — appended, never overwritten`}>
            <div>
              {thesis.assessments.length === 0 && (
                <Empty title="No assessments yet" hint='Ask "Does my thesis hold?" in the research workspace to produce one.' />
              )}
              {[...thesis.assessments].reverse().map((a) => (
                <div className="ev-item" key={a.at}>
                  <span className="ev-rail" style={{ background: a.assessment === "SUPPORTED" ? "var(--up)" : a.assessment === "WEAKENED" ? "var(--warn)" : "var(--down)" }} aria-hidden />
                  <div className="ev-body">
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <StatusBadge status={a.assessment} />
                      <ConfidenceMeter confidence={a.confidence} />
                      <span className="badge gray">quality {a.researchQuality}</span>
                      <span className="ev-time mono">v{a.assessment === undefined ? "" : ""}{timeAgo(a.at)}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 6, color: "var(--text-2)" }}>{a.rationale}</div>
                    {a.whatWouldChange.length > 0 && (
                      <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-3)" }}>would change if: {a.whatWouldChange.join(" · ")}</div>
                    )}
                    {a.unresolved.length > 0 && (
                      <div style={{ fontSize: 12, marginTop: 2, color: "var(--warn)" }}>unresolved: {a.unresolved.join(" · ")}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid-2">
            <Panel kicker="supporting evidence" title="Backing the thesis">
              <div className="panel-body" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
                {thesis.supportingRefs.length === 0 && <span style={{ color: "var(--text-3)", fontSize: 12 }}>none in the latest assessment</span>}
                {thesis.supportingRefs.map((r) => <span key={r} className="mono" style={{ color: "var(--up)", fontSize: 11.5 }}>{r}</span>)}
              </div>
            </Panel>
            <Panel kicker="contradicting evidence" title="Pressing against it">
              <div className="panel-body" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
                {thesis.contradictingRefs.length === 0 && <span style={{ color: "var(--text-3)", fontSize: 12 }}>none in the latest assessment</span>}
                {thesis.contradictingRefs.map((r) => <span key={r} className="mono" style={{ color: "var(--down)", fontSize: 11.5 }}>{r}</span>)}
              </div>
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}
