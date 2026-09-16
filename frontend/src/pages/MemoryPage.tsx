/**
 * Saved research & memory — REAL artifacts and memory from the backend with explicit
 * status: STALE/HISTORICAL render demoted and never merged into current knowledge.
 * Reads only — SAVE happens through the LUI authorization boundary in a conversation,
 * never a client-side write.
 */
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell.js";
import { Panel, Note, Empty, timeAgo } from "../components/ui.js";
import { BackendDownNote } from "../components/BackendDownNote.js";
import { listMemories, listArtifacts, ApiError } from "../api/index.js";
import { memoryFromDto, artifactFromDto } from "../data/adapters.js";
import type { MemoryItem, SavedArtifactView } from "../data/types.js";

const STATUS_STYLE: Record<string, { badge: string; opacity: number }> = {
  CURRENT: { badge: "green", opacity: 1 },
  STALE: { badge: "amber", opacity: 0.72 },
  HISTORICAL: { badge: "gray", opacity: 0.55 },
};

const CATEGORIES = ["ALL", "research", "thesis", "framework", "preference", "historical", "monitor"] as const;

export function MemoryPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("ALL");
  const [memories, setMemories] = useState<readonly MemoryItem[]>([]);
  const [artifacts, setArtifacts] = useState<readonly SavedArtifactView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const [m, a] = await Promise.all([listMemories(), listArtifacts()]);
        setMemories(m.map(memoryFromDto));
        setArtifacts(a.map(artifactFromDto));
        setLoaded(true);
      } catch (err) {
        setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
        setLoaded(true);
      }
    })();
  }, []);

  const list = memories.filter((m) =>
    (cat === "ALL" || m.category === cat) &&
    (query === "" || m.content.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <AppShell title="Saved">
      <div className="page-head">
        <h1 className="page-title">Saved research & memory</h1>
        <p className="page-sub">
          Artifacts you explicitly saved (through confirmed SAVE requests) plus the memory they
          created. Status is explicit backend data — stale memory never automatically outranks
          fresh research.
        </p>
      </div>

      {error !== undefined && <BackendDownNote error={error} />}

      <div className="grid-2">
        <Panel kicker={`${artifacts.length} items`} title="Saved artifacts">
          <div>
            {loaded && error === undefined && artifacts.length === 0 && (
              <Empty title="Nothing saved yet" hint='SAVE is explicit: e.g. "Save this research" in a conversation — with your confirmation.' />
            )}
            {artifacts.map((a) => (
              <div className="ev-item" key={a.ref}>
                <span className="ev-rail" style={{ background: "var(--accent)" }} aria-hidden />
                <div className="ev-body">
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="badge teal">{a.type.replace(/-/g, " ")}</span>
                    <span className="ev-time mono">{timeAgo(a.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>{a.content}</div>
                  {a.derivedFromRefs.length > 0 && (
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
                      derived from {a.derivedFromRefs.join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel kicker="how decay works" title="Memory is continuity, not authority">
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Note tone="info">
              <b>CURRENT</b> — validated against recent research and reusable now.
            </Note>
            <Note tone="warn">
              <b>STALE</b> — current research contradicts or supersedes it. Kept for audit,
              demoted in influence, never silently rewritten.
            </Note>
            <Note>
              <b>HISTORICAL</b> — past context preserved for the record. It informs history
              views; it does not inform current judgments.
            </Note>
          </div>
        </Panel>
      </div>

      <div style={{ display: "flex", gap: "var(--gap-3)", margin: "var(--gap-5) 0 var(--gap-4)", alignItems: "center", flexWrap: "wrap" }}>
        <div className="search-wrap">
          <span className="search-icon" aria-hidden>⌕</span>
          <input className="search" placeholder="Search memory…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search memory" />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="tablist" aria-label="Filter by category">
          {CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={cat === c}
              className={`badge ${cat === c ? "teal" : "gray"}`}
              style={{ cursor: "pointer", padding: "5px 10px" }}
              onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <Panel kicker={`${list.length} entries`} title="Memory entries">
        {loaded && error === undefined && memories.length === 0 && (
          <Empty title="No memory yet" hint="Memory accumulates from confirmed SAVE requests — ordinary research never becomes memory automatically." />
        )}
        {list.length === 0 && memories.length > 0 && <Empty title="Nothing matches" hint="Try a different search or category." />}
        <div>
          {list.map((m) => {
            const s = STATUS_STYLE[m.status] ?? STATUS_STYLE.HISTORICAL!;
            return (
              <div className="ev-item" key={m.ref} style={{ opacity: s.opacity }}>
                <span className="ev-rail" style={{ background: m.status === "CURRENT" ? "var(--fresh)" : m.status === "STALE" ? "var(--stale)" : "var(--historical)" }} aria-hidden />
                <div className="ev-body">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`badge ${s.badge}`}>{m.status}</span>
                    <span className="badge gray">{m.category}</span>
                    <span className="ev-time mono">{m.ref} · saved {timeAgo(m.createdAt)}{m.lastValidatedAt !== undefined ? ` · validated ${timeAgo(m.lastValidatedAt)}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>{m.content}</div>
                  {m.statusReason !== undefined && (
                    <div style={{ fontSize: 12, color: "var(--warn)", marginTop: 4 }}>ⓘ {m.statusReason}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </AppShell>
  );
}
