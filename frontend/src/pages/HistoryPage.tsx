/**
 * History; the research-history surface (Phase B / B2).
 *
 * Behaves like a research log, not a dashboard: newest first, grouped by day, one row per
 * research RUN answering "what did I research?", searchable, paginated, with honest loading,
 * empty, error and degraded states. Clicking a row opens THAT run through the same research
 * view a fresh result uses.
 *
 * Identity law it inherits from the backend: the `ref` a row lists is the `ref` that opens it,
 * and rows are research objects only — monitor rows are never mixed in (they navigate to the
 * Monitor page instead), so a row can never be an unopenable reference.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { Panel, StatusBadge, ConfidenceMeter, Empty, Note, timeAgo } from "../components/ui.js";
import { listResearch } from "../api/index.js";
import { HISTORY_PAGE_SIZE, formatStamp, groupHistoryByDay } from "../data/history.js";
import { isResearchRef } from "../data/identity.js";
import type { ResearchRunSummaryDto } from "../api/index.js";

export function HistoryPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<readonly ResearchRunSummaryDto[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const offset = useRef(0);
  const requestSeq = useRef(0);

  const load = useCallback(async (search: string, append: boolean): Promise<void> => {
    const seq = ++requestSeq.current;
    const from = append ? offset.current : 0;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const page = await listResearch({ limit: HISTORY_PAGE_SIZE, offset: from, ...(search.trim() !== "" ? { q: search } : {}) });
      // A stale response (the user typed again) must not overwrite newer results.
      if (seq !== requestSeq.current) return;
      setEntries((prev) => (append ? [...prev, ...page] : page));
      offset.current = from + page.length;
      setExhausted(page.length < HISTORY_PAGE_SIZE);
      setError(undefined);
      setLoaded(true);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err);
      setLoaded(true);
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // Debounced server-side search (the backend owns filtering; the client never guesses).
  useEffect(() => {
    const t = setTimeout(() => { void load(query, false); }, query === "" ? 0 : 300);
    return () => clearTimeout(t);
  }, [query, load]);

  const groups = groupHistoryByDay(entries);
  const degradedCount = entries.filter((e) => e.degraded === true).length;

  return (
    <AppShell
      title="History"
      contextRail={
        <>
          <div className="rail-section">
            <div className="rail-title">Research history</div>
            <div className="kv"><span className="k">runs loaded</span><span className="v">{entries.length}{exhausted ? "" : "+"}</span></div>
            <div className="kv"><span className="k">saved</span><span className="v">{entries.filter((e) => e.saved === true).length}</span></div>
            <div className="kv"><span className="k">partial records</span><span className="v">{degradedCount}</span></div>
            <Note tone="info">
              History lists research runs only. Monitors live in the Monitor workspace and are never listed here as research.
            </Note>
          </div>
          <div className="rail-section">
            <div className="rail-title">Tip</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-3)" }}>
              Opening a past run reopens the same research view, with its evidence, uncertainty and provenance. Nothing is re-run and nothing is rewritten.
            </div>
          </div>
        </>
      }
    >
      <div className="search-wrap" style={{ maxWidth: "none", marginBottom: "var(--gap-4)" }}>
        <span className="search-icon" aria-hidden>⌕</span>
        <input
          className="search"
          placeholder="Search your research questions…"
          aria-label="Search research history"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error !== undefined && loaded && entries.length === 0 && (
        <BackendDownNote error={error}> No history is shown because none could be read.</BackendDownNote>
      )}
      {error !== undefined && entries.length > 0 && (
        <Note tone="warn">A refresh failed; showing the rows already loaded. {error instanceof Error ? error.message : ""}</Note>
      )}

      {loading && !loaded && <Empty title="Loading research history…" />}

      {!loading && loaded && entries.length === 0 && error === undefined && (
        query.trim() === ""
          ? <Empty title="No research yet" hint="Ask a research question in the research workspace; every run is logged here." />
          : <Empty title="No matching research" hint={`Nothing matches “${query}”. Try a shorter phrase.`} />
      )}

      {groups.map((group) => (
        <div key={group.label}>
          <div className="panel-kicker" style={{ margin: "14px 2px 6px" }}>{group.label}</div>
          <Panel>
            <div className="row-list">
              {group.entries.map((e) => {
                // Only a research ref is openable. A row that is not one is rendered as a
                // plain row (never navigated to a question string, never a dead link).
                const openable = isResearchRef(e.ref);
                const body = (
                  <>
                    <div style={{ minWidth: 0 }}>
                      <div className="row-title">{e.question.length > 0 ? e.question : e.objective}</div>
                      {e.insightPreview !== undefined && (
                        <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {e.insightPreview}
                        </div>
                      )}
                      <div className="row-meta">
                        {formatStamp(e.updatedAt ?? e.createdAt)}
                        {timeAgo(e.updatedAt ?? e.createdAt) !== "" ? ` · ${timeAgo(e.updatedAt ?? e.createdAt)}` : ""}
                        {e.flow !== "" ? ` · ${e.flow.replace(/_/g, " ").toLowerCase()}` : ""}
                      </div>
                    </div>
                    <div className="row-right" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <StatusBadge status={e.isCurrent === true ? "CURRENT" : e.status} />
                      {e.questionResolutionStatus !== undefined && (
                        <span className="badge gray" title="Engine question-resolution verdict">{e.questionResolutionStatus.replace(/_/g, " ").toLowerCase()}</span>
                      )}
                      {e.confidence !== undefined && <ConfidenceMeter confidence={e.confidence} />}
                      <span style={{ display: "flex", gap: 4 }}>
                        {e.saved === true && <span className="badge blue" title="A saved artifact derives from this run">saved</span>}
                        {e.degraded === true && <span className="badge amber" title="The full record is not retained; the conclusion is still real">partial record</span>}
                      </span>
                    </div>
                  </>
                );
                const rowStyle = { width: "100%", textAlign: "left" as const, background: "none", border: "none", borderTop: "1px solid var(--line)", color: "inherit", cursor: "pointer" };
                return openable ? (
                  <button className="row" style={rowStyle} key={e.ref} onClick={() => navigate(`/research/${encodeURIComponent(e.ref)}`)}>
                    {body}
                  </button>
                ) : (
                  <div className="row" style={rowStyle} key={e.ref} title="Not a research reference; this row cannot be opened as research">
                    {body}
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      ))}

      {!exhausted && entries.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", margin: "14px 0" }}>
          <button className="btn sm" disabled={loadingMore} onClick={() => void load(query, true)}>
            {loadingMore ? "Loading…" : "Load older research"}
          </button>
        </div>
      )}
    </AppShell>
  );
}
