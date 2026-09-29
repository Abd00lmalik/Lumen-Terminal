/**
 * Phase H: Monitor workspace — thesis-aware material change monitoring.
 *
 * Shows the real monitoring state: active/paused monitors, challenge-derived conditions,
 * last checked / next scheduled, latest assessments, in-app notifications. "Check now" runs
 * the same bounded pipeline as scheduled checks. The thesis is never modified by monitoring;
 * notifications exist only for MATERIAL_CHANGE. No polling; explicit refresh.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, Note, Empty, StatusBadge } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import {
  listMonitors, activateMonitor, createMonitorFromChallenge, setMonitorStatus,
  checkMonitorNow, listMonitorAssessments, listNotifications, markNotificationRead, ApiError,
} from "../api/index.js";
import { monitorFromDto } from "../data/adapters.js";
import type { MonitorView } from "../data/types.js";
import type { MonitorAssessmentDto, MonitorNotificationDto } from "../api/types.js";

export function MonitorPage() {
  const navigate = useNavigate();
  const [monitors, setMonitors] = useState<readonly MonitorView[]>([]);
  const [rawMonitors, setRawMonitors] = useState<readonly Parameters<typeof monitorFromDto>[0][]>([]);
  const [notifications, setNotifications] = useState<readonly MonitorNotificationDto[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [assessmentsFor, setAssessmentsFor] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<readonly MonitorAssessmentDto[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [grouped, notes] = await Promise.all([listMonitors(), listNotifications()]);
      const flat = [...grouped.active, ...grouped.paused, ...grouped.proposals, ...grouped.stale, ...grouped.completed];
      setRawMonitors(flat);
      setMonitors(flat.map(monitorFromDto));
      setNotifications(notes);
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const rawByRef = new Map(rawMonitors.map((m) => [m.ref, m]));

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await fn();
      setNotice(`${label} done.`);
      await refresh();
    } catch (err) {
      setNotice(`${label} failed: ${err instanceof ApiError ? `${err.code}: ${err.message}` : String(err)}`);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const toggleAssessments = async (ref: string) => {
    if (assessmentsFor === ref) { setAssessmentsFor(null); return; }
    setBusy(true);
    try {
      setAssessments(await listMonitorAssessments(ref));
      setAssessmentsFor(ref);
    } catch (err) {
      setNotice(`Could not load assessments: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const createMonitor = async () => {
    await act("Monitor created from challenge (PROPOSED; activate it to enable checks)", async () => {
      await createMonitorFromChallenge({ cadence: "MANUAL" });
    });
  };

  return (
    <AppShell
      title="Monitor"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">What this is</div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
              Monitors watch the falsifiers YOUR challenge research identified for a thesis.
              Checks run bounded research through the same engine, grade materiality
              deterministically, and notify you only on material change. The thesis is never
              modified by monitoring; you decide.
            </div>
          </div>
          <Note>
            Lumen may propose; only you activate. Paused monitors execute nothing. Provider
            failures and missing data are never treated as negative evidence.
          </Note>
        </>
      }
    >
      <div className="page-head">
        <div className="panel-kicker" style={{ marginBottom: 6 }}>thesis-aware monitoring · derived from challenge</div>
        <h1 className="page-title">Monitor</h1>
        <p className="page-sub">
          Watch the conditions that matter to your thesis; hear only about material change.
        </p>
      </div>

      {error !== undefined && <BackendDownNote error={error} />}
      {notice !== undefined && <Note tone={notice.includes("failed") ? "warn" : "info"}>{notice}</Note>}

      <Panel
        kicker={`${notifications.filter((n) => !n.read).length} unread`}
        title="Material-change notifications"
        right={<button className="btn sm ghost" onClick={() => void createMonitor()}>New monitor from challenge</button>}
      >
        <div>
          {notifications.length === 0 && (
            <Empty title="No notifications" hint="Only MATERIAL changes notify; provider failures, noise, and missing data never do." />
          )}
          {notifications.map((n) => (
            <div className="ev-item" key={n.ref}>
              <span className="ev-rail" style={{ background: n.read ? "var(--cls-unavailable)" : "var(--down)" }} aria-hidden />
              <div className="ev-body">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`badge ${n.materiality === "MATERIAL" ? "red" : "amber"}`}>{n.materiality}</span>
                  <span className="badge gray">{n.thesisImpact.replace(/_/g, " ")}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 13, margin: "6px 0 2px" }}>{n.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>{n.summary}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {n.researchRef !== undefined && (
                    <button className="badge blue" style={{ cursor: "pointer" }} onClick={() => navigate(`/research/${n.researchRef}`)}>{n.researchRef}</button>
                  )}
                  {!n.read && (
                    <button className="btn sm ghost" disabled={busy} onClick={() => void act("Marked read", () => markNotificationRead(n.ref))}>mark read</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel kicker="create" title="Derive a monitor from your thesis challenges">
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
            Conditions come from your own Challenge records (falsifiers, contradictions, gaps);
            the model invents nothing. The monitor starts PROPOSED and inert until you activate it.
          </span>
          <button className="btn sm" disabled={busy} onClick={() => void createMonitor()}>Create monitor from challenge</button>
        </div>
      </Panel>

      {monitors.length === 0 && (
        <Empty title="No monitors yet" hint='Run "Challenge my thesis" first; monitors watch real falsifiers.' />
      )}

      {(["ACTIVE", "PAUSED", "PROPOSED", "STALE", "COMPLETED"] as const).map((status) => {
        const items = monitors.filter((m) => m.status === status);
        if (items.length === 0) return null;
        const title = status === "ACTIVE" ? "Active" : status === "PROPOSED" ? "Proposed; awaiting your activation"
          : status === "PAUSED" ? "Paused (executes nothing)" : status === "STALE" ? "Stale" : "Completed";
        return (
          <Panel key={status} kicker={`${items.length}`} title={title}>
            <div>
              {items.map((m) => {
                const raw = rawByRef.get(m.ref);
                return (
                  <div className="ev-item" key={m.ref}>
                    <span className="ev-rail" style={{ background: m.status === "ACTIVE" ? "var(--up)" : m.status === "PROPOSED" ? "var(--accent)" : "var(--cls-unavailable)" }} aria-hidden />
                    <div className="ev-body" style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="row-title">{m.target}</span>
                        <StatusBadge status={m.status} />
                        {raw?.cadence !== undefined && <span className="badge gray">{raw.cadence.toLowerCase()}</span>}
                        <span className="ev-time mono">{m.ref}</span>
                      </div>
                      {raw?.watchRationale !== undefined && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                          <strong>Why watching:</strong> {raw.watchRationale}
                        </div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                        {m.conditions.map((c, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center" }}>
                            <span className={`badge ${c.kind === "INVALIDATION" ? "red" : "amber"}`}>{c.kind.replace(/_/g, " ")}</span>
                            <span style={{ color: "var(--text-2)" }}>{c.description}</span>
                            <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{c.triggerType.toLowerCase()}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {raw?.lastCheckedAt !== undefined && <span>last checked: {new Date(raw.lastCheckedAt).toLocaleString()}</span>}
                        {raw?.nextScheduledCheckAt !== undefined && <span>next: {new Date(raw.nextScheduledCheckAt).toLocaleString()}</span>}
                        {raw?.lastTriggeredAt !== undefined && <span>last material: {new Date(raw.lastTriggeredAt).toLocaleString()}</span>}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {m.status === "PROPOSED" && (confirming === m.ref ? (
                          <>
                            <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>Activate this monitor?</span>
                            <button className="btn sm primary" disabled={busy} onClick={() => void act("Activated", () => activateMonitor(m.ref))}>Yes, activate</button>
                            <button className="btn sm ghost" onClick={() => setConfirming(null)}>Cancel</button>
                          </>
                        ) : (
                          <button className="btn sm" onClick={() => setConfirming(m.ref)}>Activate…</button>
                        ))}
                        {m.status === "ACTIVE" && (
                          <>
                            <button className="btn sm primary" disabled={busy} onClick={() => void act("Check running (real research; up to ~3 min)", () => checkMonitorNow(m.ref))}>
                              {busy ? "checking…" : "Check now"}
                            </button>
                            <button className="btn sm ghost" disabled={busy} onClick={() => void act("Paused (no scheduled check will run)", () => setMonitorStatus(m.ref, "PAUSED"))}>Pause</button>
                          </>
                        )}
                        {m.status === "PAUSED" && (
                          <button className="btn sm ghost" disabled={busy} onClick={() => void act("Resumed", () => setMonitorStatus(m.ref, "ACTIVE"))}>Resume</button>
                        )}
                        {(m.status === "ACTIVE" || m.status === "PAUSED") && (
                          <button className="btn sm ghost" disabled={busy} onClick={() => void toggleAssessments(m.ref)}>
                            {assessmentsFor === m.ref ? "hide history" : "assessment history"}
                          </button>
                        )}
                      </div>
                      {assessmentsFor === m.ref && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                          {assessments.length === 0 && <span style={{ fontSize: 12, color: "var(--text-3)" }}>no checks yet</span>}
                          {assessments.slice().reverse().map((a) => (
                            <div key={a.ref} style={{ borderTop: "1px solid var(--border-2, #333)", paddingTop: 6 }}>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                <span className={`badge ${a.outcome === "MATERIAL_CHANGE" ? "red" : a.outcome === "NO_MATERIAL_CHANGE" ? "green" : "gray"}`}>{a.outcome.replace(/_/g, " ")}</span>
                                <span className="badge gray">{a.thesisImpact.replace(/_/g, " ")}</span>
                                <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{new Date(a.checkedAt).toLocaleString()}</span>
                              </div>
                              <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 4 }}>{a.summary}</div>
                              {a.researchRef !== undefined && (
                                <button className="badge blue" style={{ cursor: "pointer", marginTop: 4 }} onClick={() => navigate(`/research/${a.researchRef}`)}>{a.researchRef}</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        );
      })}
    </AppShell>
  );
}
