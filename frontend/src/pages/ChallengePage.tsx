/**
 * Phase G: Challenge — persistent falsification records over Flow 7 (WHAT_COULD_PROVE_ME_WRONG).
 *
 * Everything shown is a persisted, per-user Challenge record: what part of the thesis it
 * challenges, why it could matter, the evidence behind it, what would actually falsify the
 * thesis, whether that condition is currently observed, what remains unknown, and provenance.
 * "Nothing found" is rendered honestly; never manufactured opposition. Challenges are
 * research results ABOUT the thesis: the thesis itself is never mutated here.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, Note, StatusBadge, ConfidenceMeter, Empty } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { getWorkspace, listChallenges, runChallenge } from "../api/index.js";
import type { ChallengeDto } from "../api/types.js";
import { challengeHeadlineFromSnapshot } from "../data/adapters.js";

const STATUS_BADGE: Record<ChallengeDto["status"], string> = {
  ACTIVE: "orange",
  CONTRADICTION: "red",
  INFORMATION_GAP: "gray",
  STALE: "gray",
  RESOLVED: "green",
};

function statusTone(status: ChallengeDto["status"]): string {
  return STATUS_BADGE[status] ?? "gray";
}

export function ChallengePage() {
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<readonly ChallengeDto[]>([]);
  const [headline, setHeadline] = useState<{ belief: string; owner: string } | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | undefined>(undefined);

  const reload = async () => {
    try {
      const [rows, snapshot] = await Promise.all([listChallenges(), getWorkspace()]);
      setChallenges(rows);
      setHeadline(challengeHeadlineFromSnapshot(snapshot));
      setError(undefined);
    } catch (err) {
      setError(err);
    }
    setLoaded(true);
  };

  useEffect(() => {
    void reload();
  }, []);

  const run = async () => {
    setRunning(true);
    setRunNote(undefined);
    try {
      const result = await runChallenge();
      if (result.modelFailure !== undefined) {
        setRunNote(`Falsification research could not run (${result.modelFailure.type}); no challenges were asserted. ${result.modelFailure.message}`);
      } else {
        setRunNote(`Falsification research completed (${result.assessment ?? "INDETERMINATE"}); ${result.challenges.length} challenge record(s) now persisted.`);
      }
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunNote(message.includes("no active thesis")
        ? "No active thesis to challenge. Create or select one in the thesis workspace first."
        : `Challenge run failed: ${message}`);
    } finally {
      setRunning(false);
    }
  };

  const active = challenges.filter((c) => c.status === "ACTIVE" || c.status === "CONTRADICTION" || c.status === "INFORMATION_GAP");
  const settled = challenges.filter((c) => c.status === "STALE" || c.status === "RESOLVED");
  const lastResearched = challenges.reduce<string | undefined>((acc, c) => (acc === undefined || c.updatedAt > acc ? c.updatedAt : acc), undefined);
  const latestAssessment = challenges[0]?.assessment;

  return (
    <AppShell title="Challenge">
      <div className="page-head">
        <div className="panel-kicker" style={{ marginBottom: 6 }}>falsification review · flow 7 methodology</div>
        <h1 className="page-title">What could prove this wrong?</h1>
        <p className="page-sub">
          Persistent, evidence-backed challenges to your thesis; refreshed only through real
          research. Scrutiny here is routine maintenance for a thesis; not an alarm.
        </p>
      </div>

      {error !== undefined && <BackendDownNote error={error} />}

      <Panel
        kicker="current thesis (trader-owned; challenges never mutate it)"
        title="What is being challenged"
        right={(
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm ghost" onClick={() => navigate("/thesis")}>thesis workspace →</button>
            <button className="btn sm" onClick={() => void run()} disabled={running}>
              {running ? "researching falsifiers…" : challenges.length === 0 ? "Challenge my thesis" : "Re-run challenge research"}
            </button>
          </div>
        )}
      >
        <div className="panel-body answer-card" style={{ borderLeft: "none" }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>
            {headline?.belief ?? (loaded && error === undefined ? "No active thesis; select or create one in the thesis workspace." : "…")}
          </p>
          {headline?.owner !== undefined && headline.owner !== "" && (
            <p className="mono" style={{ margin: "10px 0 0", fontSize: 10.5, color: "var(--text-3)" }}>
              owner: trader · {headline.owner} · challenge does not mutate it
            </p>
          )}
          {runNote !== undefined && <Note tone={runNote.includes("could not") || runNote.includes("failed") || runNote.includes("No active") ? "warn" : "info"}>{runNote}</Note>}
        </div>
      </Panel>

      <Panel
        kicker={`${active.length} active · ${settled.length} settled`}
        title="Why it could be wrong"
      >
        <div>
          {!loaded && <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>loading...</span>}
          {loaded && error === undefined && challenges.length === 0 && (
            <Empty
              title="No challenge records yet"
              hint='Run "Challenge my thesis" (button above) or ask the research workspace. Challenges are derived from real falsification research; nothing is invented.'
            />
          )}
          {active.map((c) => <ChallengeCard key={c.ref} c={c} navigate={navigate} />)}
        </div>
      </Panel>

      {settled.length > 0 && (
        <Panel kicker="history; kept visible, never silently deleted" title="Resolved / stale challenges">
          <div>
            {settled.map((c) => <ChallengeCard key={c.ref} c={c} navigate={navigate} />)}
          </div>
        </Panel>
      )}

      <div className="grid-2">
        <Panel kicker="assessment" title="Where this leaves the thesis">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            {latestAssessment !== undefined ? <StatusBadge status={latestAssessment} /> : <Empty title="No falsification research yet" hint="Run the challenge above; the verdict comes from Flow 7, not from the UI." />}
            {latestAssessment !== undefined && <ConfidenceMeter confidence="MODERATE" />}
          </div>
        </Panel>
        <Panel kicker="refresh law" title="Last researched">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lastResearched === undefined
              ? <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>never; challenges exist only after real falsification research</span>
              : (
                <>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-2)" }}>{new Date(lastResearched).toLocaleString()}</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                    stale challenges are re-evaluated by new research, never by wall-clock age alone; a re-run re-derives the full set.
                  </span>
                </>
              )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function ChallengeCard({ c, navigate }: { c: ChallengeDto; navigate: (path: string) => void }) {
  return (
    <div className="ev-item">
      <span className="ev-rail" style={{ background: c.status === "CONTRADICTION" ? "var(--down)" : c.status === "RESOLVED" ? "var(--up)" : c.status === "STALE" ? "var(--cls-unavailable)" : "var(--accent)" }} aria-hidden />
      <div className="ev-body">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className={`badge ${statusTone(c.status)}`}>{c.status.replace(/_/g, " ")}</span>
          <span className="badge gray">{c.falsifier.materiality.replace(/_/g, " ")}</span>
          <span className="badge gray">{c.falsifier.origin.replace(/_/g, " ")}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{c.ref} · thesis v{c.thesisVersion}</span>
        </div>

        <div style={{ fontSize: 13.5, margin: "8px 0 4px" }}>{c.claim}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          <strong>falsifier:</strong> {c.falsifier.condition}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-3)", margin: "4px 0" }}>
          attacks: {c.falsifier.attacksClaim} · condition currently {c.conditionObserved ? "OBSERVED" : "not observed"}
        </div>

        {(c.supportingEvidenceRefs.length > 0 || c.counterEvidenceRefs.length > 0) && (
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>supporting:</span>
            {c.supportingEvidenceRefs.map((r) => <button key={r} className="badge green" style={{ cursor: "pointer" }} onClick={() => navigate("/evidence")}>{r}</button>)}
            <span className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 6 }}>counter:</span>
            {c.counterEvidenceRefs.map((r) => <button key={r} className="badge red" style={{ cursor: "pointer" }} onClick={() => navigate("/evidence")}>{r}</button>)}
          </div>
        )}

        {c.informationGaps.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {c.informationGaps.map((g, i) => <Note key={i} tone="info">{g}</Note>)}
          </div>
        )}

        <details style={{ marginTop: 8 }}>
          <summary className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", cursor: "pointer" }}>
            provenance · run {c.researchRef} · {c.provenance.length} entr{c.provenance.length === 1 ? "y" : "ies"}
          </summary>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {c.provenance.map((p, i) => (
              <div key={i} className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
                {new Date(p.at).toLocaleString()} · {p.originKind}{p.originDetail !== undefined ? ` · ${p.originDetail}` : ""}
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
