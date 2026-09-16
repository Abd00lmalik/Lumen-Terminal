/**
 * Monitor view; the REAL monitoring handoff from the backend: lifecycle-grouped
 * monitors, distinct invalidation/early-warning conditions, source-unavailable as
 * state data. Activation posts to the backend's trader boundary and refreshes state.
 * A persistent explainer states that no background worker exists.
 */
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell.js";
import { Panel, Note, Empty, StatusBadge } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { listMonitors, activateMonitor, ApiError } from "../api/index.js";
import { monitorFromDto } from "../data/adapters.js";
import type { MonitorView } from "../data/types.js";

const GROUPS: { status: MonitorView["status"]; title: string }[] = [
  { status: "PROPOSED", title: "Proposed; awaiting your activation" },
  { status: "ACTIVE", title: "Active (handoff state)" },
  { status: "PAUSED", title: "Paused" },
  { status: "STALE", title: "Stale; flagged for review" },
  { status: "COMPLETED", title: "Completed" },
];

export function MonitorPage() {
  const [monitors, setMonitors] = useState<readonly MonitorView[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const grouped = await listMonitors();
      setMonitors([...grouped.proposals, ...grouped.active, ...grouped.paused, ...grouped.stale, ...grouped.completed].map(monitorFromDto));
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activate = async (ref: string) => {
    setBusy(true);
    try {
      await activateMonitor(ref);
      setNotice(`Monitor ${ref} activated; a persistent state change only; no background worker was created.`);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <AppShell
      title="Monitor"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">What this is</div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
              Monitors are persistent research state: conditions the engine recorded for future
              checking. Nothing runs in the background; no worker, no notifications, no cron.
            </div>
          </div>
          <Note>
            Activation is recorded through the backend's trader-confirmation boundary. It changes
            state, not reality; no live process exists behind an “active” badge.
          </Note>
        </>
      }
    >
      <div className="page-head">
        <h1 className="page-title">Monitoring handoff</h1>
        <p className="page-sub">
          Conditions worth watching, derived from your theses and research. Invalidation and
          early-warning conditions are kept separate; one disproves, the other only warns.
        </p>
      </div>

      {error !== undefined && <BackendDownNote error={error} />}
      {notice !== undefined && <Note tone="info">{notice}</Note>}

      {error === undefined && monitors.length === 0 && (
        <Empty title="No monitors yet" hint="Research that surfaces invalidation or early-warning conditions will propose monitors here." />
      )}

      {GROUPS.map((g) => {
        const items = monitors.filter((m) => m.status === g.status);
        if (items.length === 0) return null;
        return (
          <Panel key={g.status} kicker={`${items.length}`} title={g.title}>
            <div>
              {items.map((m) => (
                <div className="ev-item" key={m.ref}>
                  <span className="ev-rail" style={{
                    background: m.status === "ACTIVE" ? "var(--up)" : m.status === "PROPOSED" ? "var(--accent)"
                      : m.status === "STALE" ? "var(--stale)" : "var(--historical)",
                  }} aria-hidden />
                  <div className="ev-body" style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="row-title">{m.target}</span>
                      <StatusBadge status={m.status} />
                      <span className="ev-time mono">{m.ref}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                      {m.conditions.map((c, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center" }}>
                          <span className={`badge ${c.kind === "INVALIDATION" ? "red" : "amber"}`}>{c.kind.replace(/_/g, " ")}</span>
                          <span style={{ color: "var(--text-2)" }}>{c.description}</span>
                          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{c.triggerType.toLowerCase()}</span>
                        </div>
                      ))}
                    </div>
                    {m.sourceStates.some((s) => s.state === "SOURCE_UNAVAILABLE") && (
                      <div style={{ marginTop: 8 }}>
                        <Note tone="warn">
                          source unavailable: {m.sourceStates.find((s) => s.state === "SOURCE_UNAVAILABLE")?.note}; recorded as a source
                          state, never treated as a triggered condition.
                        </Note>
                      </div>
                    )}
                    {m.status === "PROPOSED" && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                        {confirming === m.ref ? (
                          <>
                            <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>Activate this monitor?</span>
                            <button className="btn sm primary" disabled={busy} onClick={() => void activate(m.ref)}>
                              {busy ? "Activating…" : "Yes, activate"}
                            </button>
                            <button className="btn sm ghost" onClick={() => setConfirming(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn sm" onClick={() => setConfirming(m.ref)}>Activate…</button>
                        )}
                      </div>
                    )}
                    {m.status === "PROPOSED" && (
                      <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
                        proposal only; activation requires your explicit confirmation
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        );
      })}
    </AppShell>
  );
}
