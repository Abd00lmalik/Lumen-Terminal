/**
 * Thesis workspace (Phase D).
 *
 * The trader's structured belief: WHAT they believe, WHY (claims/assumptions), what supports or
 * challenges it (assessment + evidence), what would prove it wrong (falsifiers/invalidation
 * conditions), the material conditions it depends on, and the research and Saved artifacts it
 * draws on. Lumen evaluates; it never silently rewrites the statement or the belief. Every
 * mutation here is an explicit trader action; nothing is shown as persisted until the backend
 * confirms it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Panel, ConfidenceMeter, StatusBadge, Note, KV, Empty, timeAgo } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import {
  listTheses, getThesis, createThesis, updateThesis, setThesisStatus, archiveThesis,
  linkThesisSaved, unlinkThesisSaved, listSaved, ApiError,
} from "../api/index.js";
import { thesisFromDto } from "../data/adapters.js";
import { savedKindLabel } from "../data/saved.js";
import { isResearchRef } from "../data/identity.js";
import type { ThesisView } from "../data/types.js";
import type { ThesisDto, SavedItemSummaryDto } from "../api/index.js";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "gray",
  ACTIVE: "teal",
  CONFIRMED: "green",
  WEAKENED: "amber",
  REJECTED: "red",
  INVALIDATED: "red",
  PAUSED: "gray",
  SUPERSEDED: "gray",
  ARCHIVED: "gray",
};

function errText(err: unknown): string {
  return err instanceof ApiError ? `${err.code} · ${err.message}` : err instanceof Error ? err.message : String(err);
}

export function ThesisPage() {
  const navigate = useNavigate();
  const params = useParams<{ ref?: string }>();
  const [list, setList] = useState<readonly (ThesisDto & { isActive?: boolean })[]>([]);
  const [thesis, setThesis] = useState<ThesisView | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [newStatement, setNewStatement] = useState("");
  const [editStatement, setEditStatement] = useState("");
  const [editDirty, setEditDirty] = useState(false);
  const [library, setLibrary] = useState<readonly SavedItemSummaryDto[]>([]);
  const [attachId, setAttachId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const rows = await listTheses();
      setList(rows);
      const chosen = params.ref !== undefined
        ? params.ref
        : (rows.find((t) => t.isActive) ?? rows[rows.length - 1])?.ref;
      if (chosen !== undefined) {
        const detail = await getThesis(chosen);
        const view = thesisFromDto(detail, detail.assessments ?? []);
        setThesis(view);
        setEditStatement((prev) => (editDirty ? prev : view.statement));
      } else {
        setThesis(undefined);
      }
      setError(undefined);
      setLoaded(true);
    } catch (err) {
      setError(err);
      setLoaded(true);
    }
  }, [params.ref, editDirty]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    void (async () => {
      try { setLibrary(await listSaved({ limit: 100 })); } catch { /* the attach picker just stays empty */ }
    })();
  }, []);

  const act = useCallback(async (fn: () => Promise<unknown>): Promise<void> => {
    setActionError(undefined);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setActionError(errText(err));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const latest = thesis !== undefined && thesis.assessments.length > 0
    ? thesis.assessments[thesis.assessments.length - 1]
    : undefined;

  const attachable = useMemo(() => {
    const already = new Set(thesis?.linkedSaved.map((s) => s.savedId) ?? []);
    return library.filter((s) => !already.has(s.savedId));
  }, [library, thesis]);

  const filteredList = statusFilter === "" ? list : list.filter((t) => t.status === statusFilter);

  return (
    <AppShell
      title="Thesis"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Theses</div>
            {list.length === 0 && <Empty title="No thesis" />}
            {list.map((t) => (
              <button
                key={t.ref}
                className={`nav-item ${thesis?.ref === t.ref ? "active" : ""}`}
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => navigate(`/thesis/${encodeURIComponent(t.ref)}`)}
              >
                <span className={`badge ${STATUS_TONE[t.status] ?? "gray"}`}>{t.status.toLowerCase()}</span>
                <span style={{ marginLeft: 8, fontSize: 12 }}>{t.title ?? t.statement.slice(0, 40)}</span>
              </button>
            ))}
          </div>
          {thesis !== undefined && (
            <div className="rail-section">
              <div className="rail-title">Thesis record</div>
              <KV k="ref" v={thesis.ref} />
              <KV k="version" v={`v${thesis.version}`} />
              <KV k="status" v={thesis.status} />
              <KV k="confirmed" v={thesis.userConfirmed ? "yes" : "no"} />
              {thesis.asset !== undefined && <KV k="asset" v={thesis.asset} />}
              <KV k="updated" v={timeAgo(thesis.updatedAt)} />
            </div>
          )}
          <Note>
            Assessments are research results. The thesis object is never modified by them;
            revision is a separate, explicit trader action.
          </Note>
        </>
      }
    >
      <div className="page-head">
        <h1 className="page-title">Thesis</h1>
        <p className="page-sub">What you believe, what supports it, and what would change your mind.</p>
      </div>

      {error !== undefined && <BackendDownNote error={error} />}
      {actionError !== undefined && <Note tone="warn">{actionError}</Note>}

      {filteredList.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "var(--gap-3) 0" }} role="tablist" aria-label="Filter theses by status">
          {["", "ACTIVE", "DRAFT", "PAUSED", "INVALIDATED", "CONFIRMED", "ARCHIVED"].map((s) => (
            <button
              key={s === "" ? "all" : s}
              role="tab"
              aria-selected={statusFilter === s}
              className={`badge ${statusFilter === s ? "teal" : "gray"}`}
              style={{ cursor: "pointer", padding: "5px 10px" }}
              onClick={() => setStatusFilter(s)}
            >
              {s === "" ? "All" : s.toLowerCase()}
            </button>
          ))}
        </div>
      )}

      {loaded && error === undefined && thesis === undefined && (
        <Panel kicker="new thesis" title="Start a thesis">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)" }}>
              A thesis is your own stated belief, in your own words. Lumen will research and assess it,
              never rewrite it. You can also create one from a research run or a saved artifact.
            </p>
            <textarea
              className="input"
              aria-label="New thesis statement"
              placeholder="e.g. BTC holds above its current support through this quarter"
              rows={3}
              value={newStatement}
              onChange={(e) => setNewStatement(e.target.value)}
            />
            <button
              className="btn primary"
              style={{ alignSelf: "flex-start" }}
              disabled={busy || newStatement.trim() === ""}
              onClick={() => void act(async () => {
                const created = await createThesis({ statement: newStatement.trim() });
                setNewStatement("");
                navigate(`/thesis/${encodeURIComponent(created.ref)}`);
              })}
            >
              Create thesis
            </button>
          </div>
        </Panel>
      )}

      {thesis !== undefined && (
        <>
          <div className="page-head" style={{ display: "flex", alignItems: "flex-start", gap: "var(--gap-4)" }}>
            <div style={{ flex: 1 }}>
              <div className="panel-kicker" style={{ marginBottom: 6 }}>
                trader-owned · v{thesis.version} · {timeAgo(thesis.updatedAt)} ·{" "}
                <span className={`badge ${STATUS_TONE[thesis.status] ?? "gray"}`}>{thesis.status.toLowerCase()}</span>
              </div>
              <h1 className="page-title" style={{ maxWidth: 760, lineHeight: 1.3, fontSize: 22 }}>{thesis.statement}</h1>
            </div>
            <button className="btn" onClick={() => navigate("/challenge")}>Challenge this thesis →</button>
          </div>

          {/* Deterministic lifecycle: only transitions the domain allows are offered, and each is
              an explicit trader action (never automatic, never from an LLM sentence). */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: "var(--gap-4)" }}>
            <span className="panel-kicker">set status</span>
            {thesis.allowedTransitions.length === 0 && <span style={{ fontSize: 12, color: "var(--text-3)" }}>no further transitions</span>}
            {thesis.allowedTransitions.map((s) => (
              <button
                key={s}
                className="btn sm ghost"
                disabled={busy}
                onClick={() => void act(() => setThesisStatus(thesis.ref, s))}
              >
                {s.toLowerCase()}
              </button>
            ))}
            {thesis.status !== "ARCHIVED" && (
              <button className="btn sm ghost" disabled={busy} onClick={() => void act(() => archiveThesis(thesis.ref))}>archive</button>
            )}
          </div>

          <div style={{ display: "flex", gap: "var(--gap-4)", alignItems: "center", marginBottom: "var(--gap-5)", flexWrap: "wrap" }}>
            <span className="panel-kicker">current confidence</span>
            <ConfidenceMeter confidence={thesis.confidence} />
            <span className="panel-kicker" style={{ marginLeft: 16 }}>research quality</span>
            <span className="badge gray">{thesis.researchQuality}</span>
            <span style={{ color: "var(--text-3)", fontSize: 12 }}>quality and confidence are different things; both are shown.</span>
          </div>

          {latest !== undefined && (
            <Panel kicker="current assessment" title={`Latest: ${latest.assessment.toLowerCase().replace(/_/g, " ")}`}>
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <StatusBadge status={latest.assessment} />
                  <ConfidenceMeter confidence={latest.confidence} />
                  <span className="badge gray">quality {latest.researchQuality}</span>
                </div>
                <div style={{ fontSize: 13.5 }}>{latest.rationale}</div>
                {latest.whatWouldChange.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>would change if: {latest.whatWouldChange.join(" · ")}</div>
                )}
                {latest.unresolved.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--warn)" }}>unresolved: {latest.unresolved.join(" · ")}</div>
                )}
              </div>
            </Panel>
          )}

          <div className="grid-2">
            <Panel kicker="supporting evidence" title="Backing the thesis">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {thesis.supportingRefs.length === 0 && <span style={{ color: "var(--text-3)", fontSize: 12 }}>none in the latest assessment</span>}
                {thesis.supportingRefs.map((r) => <span key={r} className="mono" style={{ color: "var(--up)", fontSize: 11.5 }}>{r}</span>)}
              </div>
            </Panel>
            <Panel kicker="counterevidence" title="Pressing against it">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {thesis.contradictingRefs.length === 0 && <span style={{ color: "var(--text-3)", fontSize: 12 }}>none in the latest assessment</span>}
                {thesis.contradictingRefs.map((r) => <span key={r} className="mono" style={{ color: "var(--down)", fontSize: 11.5 }}>{r}</span>)}
              </div>
            </Panel>
          </div>

          <div className="grid-2">
            <Panel kicker="assumptions" title="What it rests on">
              <div className="panel-body">
                {thesis.assumptions.length === 0 && <Empty title="No assumptions recorded" />}
                {thesis.assumptions.map((a) => <div key={a.statement} style={{ fontSize: 13.5, marginBottom: 10 }}>{a.statement}</div>)}
              </div>
            </Panel>
            <Panel kicker="material conditions" title="What must hold">
              <div className="panel-body">
                {thesis.materialConditions.length === 0 && <Empty title="No material conditions recorded" />}
                {thesis.materialConditions.map((c, i) => (
                  <div key={i} style={{ fontSize: 13.5, padding: "6px 0", borderTop: i === 0 ? undefined : "1px dashed var(--line)" }}>{c}</div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel kicker="falsifiers" title="What would prove this wrong?">
            <div className="panel-body">
              {thesis.invalidationConditions.length === 0 && <span style={{ fontSize: 13, color: "var(--text-3)" }}>None recorded.</span>}
              {thesis.invalidationConditions.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", fontSize: 13.5, borderTop: i === 0 ? undefined : "1px dashed var(--line)" }}>
                  <span aria-hidden style={{ color: "var(--down)" }}>⨯</span>{c}
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid-2">
            <Panel kicker="linked research" title="Research this thesis draws on">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {thesis.linkedResearch.length === 0 && <span style={{ fontSize: 12, color: "var(--text-3)" }}>No linked research yet.</span>}
                {thesis.linkedResearch.map((r) => (
                  <div key={r.researchRef} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{r.researchRef}</div>
                      <div style={{ fontSize: 13 }}>{r.question ?? (r.available ? "linked research" : "unavailable")}</div>
                    </div>
                    {r.available && isResearchRef(r.researchRef)
                      ? <button className="btn sm" onClick={() => navigate(`/research/${encodeURIComponent(r.researchRef)}`)}>open</button>
                      : <span className="badge gray" title="The run is no longer retained">unavailable</span>}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel kicker="linked saved artifacts" title="Kept artifacts attached">
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {thesis.linkedSaved.length === 0 && <span style={{ fontSize: 12, color: "var(--text-3)" }}>No saved artifacts attached.</span>}
                {thesis.linkedSaved.map((s) => (
                  <div key={s.savedId} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row-title" style={{ fontSize: 13 }}>{s.title ?? s.savedId}</div>
                      <div className="row-meta">
                        {s.kind !== undefined && <span className="badge blue">{savedKindLabel(s.kind)}</span>}
                        {!s.available && <span className="badge amber" style={{ marginLeft: 6 }}>now unavailable</span>}
                      </div>
                    </div>
                    <span style={{ display: "flex", gap: 6 }}>
                      {s.available && <button className="btn sm" onClick={() => navigate(`/saved?open=${encodeURIComponent(s.savedId)}`)}>open</button>}
                      <button className="btn sm ghost" onClick={() => void act(() => unlinkThesisSaved(thesis.ref, s.savedId))}>detach</button>
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <select className="input" aria-label="Attach a saved artifact" value={attachId} onChange={(e) => setAttachId(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Attach a saved artifact…</option>
                    {attachable.map((s) => <option key={s.savedId} value={s.savedId}>{savedKindLabel(s.kind)} · {s.title}</option>)}
                  </select>
                  <button
                    className="btn sm"
                    disabled={busy || attachId === ""}
                    onClick={() => void act(async () => { await linkThesisSaved(thesis.ref, attachId); setAttachId(""); })}
                  >
                    attach
                  </button>
                </div>
              </div>
            </Panel>
          </div>

          <Panel kicker="statement" title="Your belief, in your words">
            <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea
                className="input"
                aria-label="Edit thesis statement"
                rows={3}
                value={editStatement}
                onChange={(e) => { setEditDirty(true); setEditStatement(e.target.value); }}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn primary"
                  disabled={busy || !editDirty || editStatement.trim() === ""}
                  onClick={() => void act(async () => {
                    await updateThesis(thesis.ref, { statement: editStatement.trim() });
                    setEditDirty(false);
                  })}
                >
                  Save revision (v{thesis.version + 1})
                </button>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                  Explicit edit only. The previous version is preserved; assessments never change this text.
                </span>
              </div>
            </div>
          </Panel>

          <Panel kicker="assessment history" title={`${thesis.assessments.length} assessments; appended, never overwritten`}>
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
                      <span className="ev-time mono">{timeAgo(a.at)}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 6, color: "var(--text-2)" }}>{a.rationale}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
