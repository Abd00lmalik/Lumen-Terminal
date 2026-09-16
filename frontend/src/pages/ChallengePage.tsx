/**
 * Challenge / falsification; REAL Flow-7 surface: hypotheses from the workspace
 * (the engine's competing explanations and falsification targets), recorded
 * contradictions, and what the latest assessment says would change the judgment.
 * "Nothing found" is rendered honestly; never manufactured opposition.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, Note, StatusBadge, ConfidenceMeter, Empty } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { getWorkspace } from "../api/index.js";
import { challengeFromSnapshot } from "../data/adapters.js";
import type { ChallengeView } from "../data/types.js";

export function ChallengePage() {
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<ChallengeView | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const snapshot = await getWorkspace();
        setChallenge(challengeFromSnapshot(snapshot));
        setLoaded(true);
      } catch (err) {
        setError(err);
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <AppShell title="Challenge">
      <div className="page-head">
        <div className="panel-kicker" style={{ marginBottom: 6 }}>falsification review · flow 7 methodology</div>
        <h1 className="page-title">What could prove this wrong?</h1>
        <p className="page-sub">
          Disconfirming evidence the engine actually found against your active belief. Scrutiny
          here is routine maintenance for a thesis; not an alarm.
        </p>
      </div>

      {error !== undefined && <BackendDownNote error={error} />}

      {loaded && error === undefined && challenge !== undefined && (
        <>
          <Panel kicker="belief under challenge" title="The trader's belief; evaluated, never rewritten"
            right={<button className="btn sm ghost" onClick={() => navigate("/thesis")}>thesis workspace →</button>}>
            <div className="panel-body answer-card" style={{ borderLeft: "none" }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>{challenge.belief}</p>
              <p className="mono" style={{ margin: "10px 0 0", fontSize: 10.5, color: "var(--text-3)" }}>
                owner: trader · {challenge.beliefOwner} · challenge does not mutate it
              </p>
            </div>
          </Panel>

          <Panel kicker={`${challenge.falsificationTargets.length} targets`} title="Falsification targets & search results">
            <div>
              {challenge.falsificationTargets.length === 0 && (
                <Empty
                  title="No hypotheses to challenge yet"
                  hint='Run research first; e.g. "Challenge my thesis" produces falsification targets and disconfirming evidence.'
                />
              )}
              {challenge.falsificationTargets.map((t, i) => (
                <div className="ev-item" key={t.ref ?? i}>
                  <span
                    className="ev-rail"
                    style={{ background: t.found === "DISCONFIRMING" ? "var(--down)" : t.found === "NONE_FOUND" ? "var(--cls-unavailable)" : "var(--up)" }}
                    aria-hidden
                  />
                  <div className="ev-body">
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="badge gray">{t.origin.replace(/_/g, " ")}</span>
                      <span className={`badge ${t.found === "DISCONFIRMING" ? "red" : t.found === "NONE_FOUND" ? "gray" : "green"}`}>
                        {t.found.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, margin: "8px 0 4px" }}>{t.target}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>searched: {t.searched}</div>
                    {t.evidenceRefs.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {t.evidenceRefs.map((r) => <button key={r} className="badge blue" style={{ cursor: "pointer" }} onClick={() => navigate("/evidence")}>{r}</button>)}
                      </div>
                    )}
                    {t.found === "NONE_FOUND" && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                        no credible contradictory evidence found; recorded honestly, not treated as proof
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {challenge.warnings.length > 0 && (
            <Panel kicker="scrutiny notes" title="Engine-recorded tensions">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {challenge.warnings.map((w, i) => <Note key={i} tone="warn">{w}</Note>)}
              </div>
            </Panel>
          )}

          <div className="grid-2">
            <Panel kicker="assessment" title="Where this leaves the thesis">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                {challenge.assessment !== undefined ? <StatusBadge status={challenge.assessment} /> : <Empty title="No assessment yet" hint='Ask "Does my thesis hold?" in the research workspace.' />}
                {challenge.assessment !== undefined && <ConfidenceMeter confidence="MODERATE" />}
              </div>
            </Panel>
            <Panel kicker="decision relevance" title="What would change the judgment">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {challenge.whatWouldChange.length === 0 && (
                  <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>nothing recorded yet; an assessment will fill this</span>
                )}
                {challenge.whatWouldChange.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                    <span aria-hidden style={{ color: "var(--accent)" }}>↦</span>
                    <span style={{ color: "var(--text-2)" }}>{w}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}
