/**
 * Saved; the research library (Phase C).
 *
 * HISTORY answers "what have I researched?"; Saved answers "what do I want to keep?". This page
 * reads the durable saved library from the backend (never localStorage, never frontend-only
 * state): newest first, filterable by kind, searchable, with open + unsave and honest loading,
 * empty and persistence-failure states. Opening an artifact shows the ARTIFACT first and its
 * provenance context after ("Saved from research: <question>", date, ref, open original).
 *
 * A SAVE/UNSAVE state is only shown as persisted after the backend confirms the write; a failed
 * write surfaces as a failure, never as a false "Saved".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { Panel, Note, Empty, ConfidenceMeter, timeAgo } from "../components/ui.js";
import { listSaved, getSaved, deleteSaved, ApiError } from "../api/index.js";
import { savedItemFromDto } from "../data/adapters.js";
import { SAVED_KIND_TABS, SAVED_PAGE_SIZE, savedKindLabel } from "../data/saved.js";
import { formatStamp } from "../data/history.js";
import { isResearchRef } from "../data/identity.js";
import type { SavedKindDto, SavedItemSummaryDto } from "../api/index.js";
import type { SavedItemView } from "../data/types.js";

const KIND_BADGE: Record<string, string> = {
  RESEARCH: "blue",
  JUDGMENT: "teal",
  EVIDENCE: "green",
  INSIGHT: "amber",
  WATCH_NEXT: "gray",
};

export function SavedPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Phase D: an optional originating-run filter (?researchRef=rs_…) and a deep link to one
  // artifact (?open=sa_…). The filter is applied SERVER-SIDE (the backend does the matching).
  const runFilter = searchParams.get("researchRef") ?? "";
  const openParam = searchParams.get("open") ?? "";
  const [kind, setKind] = useState<"ALL" | SavedKindDto>("ALL");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<readonly SavedItemSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [openItem, setOpenItem] = useState<SavedItemView | undefined>(undefined);
  const [openError, setOpenError] = useState<string | undefined>(undefined);
  const requestSeq = useRef(0);

  const load = useCallback(async (nextKind: "ALL" | SavedKindDto, search: string): Promise<void> => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const rows = await listSaved({
        limit: SAVED_PAGE_SIZE,
        ...(nextKind !== "ALL" ? { kind: nextKind } : {}),
        ...(runFilter.trim() !== "" ? { researchRef: runFilter.trim() } : {}),
        ...(search.trim() !== "" ? { q: search } : {}),
      });
      if (seq !== requestSeq.current) return;
      setItems(rows);
      setError(undefined);
      setLoaded(true);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
      setLoaded(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [runFilter]);

  useEffect(() => {
    const t = setTimeout(() => { void load(kind, query); }, query === "" ? 0 : 300);
    return () => clearTimeout(t);
  }, [kind, query, runFilter, load]);

  const open = useCallback(async (savedId: string): Promise<void> => {
    setOpenError(undefined);
    try {
      const dto = await getSaved(savedId);
      setOpenItem(savedItemFromDto(dto));
    } catch (err) {
      setOpenError(err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Deep link (?open=sa_…): open the requested artifact once, from the real backend.
  const openedDeepLink = useRef(false);
  useEffect(() => {
    if (openParam === "" || openedDeepLink.current) return;
    openedDeepLink.current = true;
    void open(openParam);
  }, [openParam, open]);

  const clearRunFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("researchRef");
    next.delete("open");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const unsave = useCallback(async (savedId: string): Promise<void> => {
    setActionError(undefined);
    try {
      await deleteSaved(savedId); // confirmation only after the backend actually removed it
      setItems((prev) => prev.filter((i) => i.savedId !== savedId));
      setOpenItem((cur) => (cur?.savedId === savedId ? undefined : cur));
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? `Not unsaved: ${err.code} · ${err.message}`
          : `Not unsaved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  return (
    <AppShell
      title="Saved"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Saved library</div>
            <div className="kv"><span className="k">items</span><span className="v">{items.length}</span></div>
            <Note tone="info">
              Saved is what you chose to keep. History keeps everything researched; nothing is
              auto-saved.
            </Note>
          </div>
          <div className="rail-section">
            <div className="rail-title">Saving</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-3)" }}>
              Save research, a judgment, an insight, a piece of evidence or a watch item from the
              research view. SAVE is explicit and survives refresh and cold starts.
            </div>
          </div>
        </>
      }
    >
      <div className="page-head">
        <h1 className="page-title">Saved</h1>
        <p className="page-sub">
          Artifacts you explicitly kept, with their origin. Opening one shows the artifact first
          and the research it came from after; unsaving never touches the original research.
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--gap-3)", margin: "var(--gap-3) 0 var(--gap-4)", alignItems: "center", flexWrap: "wrap" }}>
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>⌕</span>
          <input
            className="search"
            placeholder="Search saved artifacts…"
            aria-label="Search saved artifacts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Filter saved artifacts by kind">
          {SAVED_KIND_TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={kind === tab.value}
              className={`badge ${kind === tab.value ? "teal" : "gray"}`}
              style={{ cursor: "pointer", padding: "5px 10px" }}
              onClick={() => setKind(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {runFilter !== "" && (
        <Note tone="info">
          Showing only artifacts saved from research <b>{runFilter}</b>.{" "}
          <button className="btn sm ghost" onClick={clearRunFilter}>clear filter</button>
        </Note>
      )}

      {actionError !== undefined && <Note tone="warn">{actionError}</Note>}

      {error !== undefined && loaded && items.length === 0 && (
        <BackendDownNote error={error}> No saved artifacts are shown because none could be read.</BackendDownNote>
      )}
      {error !== undefined && items.length > 0 && (
        <Note tone="warn">A refresh failed; showing the artifacts already loaded.</Note>
      )}

      {loading && !loaded && <Empty title="Loading saved artifacts…" />}

      {!loading && loaded && items.length === 0 && error === undefined && (
        query.trim() !== "" || kind !== "ALL"
          ? <Empty title="Nothing matches" hint="Try another kind or a shorter search." />
          : <Empty title="Nothing saved yet" hint='Save is explicit: open a research result and use "Save" on the result, a judgment, an insight or a watch item.' />
      )}

      {openItem !== undefined && (
        <SavedArtifactDetail
          item={openItem}
          onClose={() => setOpenItem(undefined)}
          onUnsave={() => void unsave(openItem.savedId)}
          onOpenResearch={(ref) => navigate(`/research/${encodeURIComponent(ref)}`)}
        />
      )}
      {openError !== undefined && <Note tone="warn">{openError}</Note>}

      {items.length > 0 && (
        <Panel kicker={`${items.length} ${items.length === 1 ? "artifact" : "artifacts"}`} title="Kept artifacts">
          <div className="row-list">
            {items.map((row) => (
              <div className="row" key={row.savedId} style={{ alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row-title">{row.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{row.summary}</div>
                  <div className="row-meta">
                    <span className={`badge ${KIND_BADGE[row.kind] ?? "gray"}`}>{savedKindLabel(row.kind)}</span>
                    {` · saved ${timeAgo(row.createdAt) !== "" ? timeAgo(row.createdAt) : formatStamp(row.createdAt)}`}
                    {row.researchRef !== undefined ? ` · from ${row.researchRef}` : ""}
                    {row.tags.length > 0 ? ` · ${row.tags.join(" · ")}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {row.confidence !== undefined && <ConfidenceMeter confidence={(row.confidence as "HIGH" | "MODERATE" | "LOW" | "UNKNOWN")} />}
                    {row.freshness !== undefined && <span className="badge gray">freshness {row.freshness.toLowerCase()}</span>}
                    {row.degraded === true && <span className="badge amber" title="The originating record is not fully retained; the saved artifact is real">partial record</span>}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <button className="btn sm" onClick={() => void open(row.savedId)}>open</button>
                  <button className="btn sm ghost" onClick={() => void unsave(row.savedId)}>unsave</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </AppShell>
  );
}

/** Artifact first, provenance context after ("Saved from research: <question>", date, ref). */
function SavedArtifactDetail({ item, onClose, onUnsave, onOpenResearch }: {
  item: SavedItemView;
  onClose: () => void;
  onUnsave: () => void;
  onOpenResearch: (ref: string) => void;
}) {
  const origin = item.origin;
  const openable = origin?.available === true && origin.researchRef !== undefined && isResearchRef(origin.researchRef);
  return (
    <Panel
      kicker={`saved ${savedKindLabel(item.kind)}`}
      title={item.title}
      right={
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn sm ghost" onClick={onClose}>close</button>
          <button className="btn sm" onClick={onUnsave}>unsave</button>
        </span>
      }
    >
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.65 }}>{item.content ?? item.summary}</div>

        {item.tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {item.tags.map((t) => <span className="badge gray" key={t}>{t}</span>)}
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="panel-kicker">provenance</div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
            {origin?.question !== undefined
              ? <>Saved from research: <b>{origin.question}</b></>
              : "Saved from research: originating run no longer available; this artifact is retained as saved."}
          </div>
          {origin?.createdAt !== undefined && (
            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>research date: {formatStamp(origin.createdAt)}</div>
          )}
          {origin?.researchRef !== undefined && (
            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>research ref: {origin.researchRef}{origin.recordTier !== undefined ? ` · record ${origin.recordTier.toLowerCase()}` : ""}</div>
          )}
          {item.sourceRef !== undefined && (
            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>source: {item.sourceRef}</div>
          )}
          {openable && (
            <button className="btn sm" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => onOpenResearch(origin!.researchRef!)}>
              Open original research
            </button>
          )}
          {!openable && (
            <Note tone="info">The original research run is not available; the saved artifact above remains readable.</Note>
          )}
        </div>

        {item.provenance !== undefined && item.provenance.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-3)" }}>saved provenance trail</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {item.provenance.map((p, i) => (
                <div className="mono" key={i} style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {formatStamp(p.at)} · {p.originKind}{p.note !== undefined ? ` · ${p.note}` : ""}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Panel>
  );
}
