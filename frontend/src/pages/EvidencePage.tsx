/**
 * Evidence / source view — REAL evidence objects from the backend with epistemic
 * distinctions intact: class rail + badge, freshness, provenance refs, event vs
 * retrieval timestamps, tool identity, support/contradiction relationships.
 * UNAVAILABLE evidence is rendered as recorded unavailability — never negative evidence.
 */
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell.js";
import {
  Panel, ClassBadge, EpistemicRail, FreshnessBadge, ProxyNote, KV, Note, Empty, timeAgo,
} from "../components/ui.js";
import { listEvidence, listClaims, ApiError } from "../api/index.js";
import { evidenceFromDto } from "../data/adapters.js";
import type { EvidenceItem } from "../data/types.js";

const FILTERS = ["ALL", "RAW_DATA", "OBSERVATION", "DERIVED_OBSERVATION", "INTERPRETATION", "PROXY_EVIDENCE", "SPECULATION"] as const;

export function EvidencePage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [selectedRef, setSelectedRef] = useState<string | undefined>(undefined);
  const [evidence, setEvidence] = useState<readonly EvidenceItem[]>([]);
  const [claims, setClaims] = useState<readonly { ref: string; statement: string }[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const [ev, cl] = await Promise.all([listEvidence(), listClaims()]);
        setEvidence(ev.map(evidenceFromDto));
        setClaims(cl.map((c) => ({ ref: c.ref, statement: c.statement })));
      } catch (err) {
        setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const list = evidence.filter((e) => filter === "ALL" || e.evidenceClass === filter);
  const current = selectedRef !== undefined ? evidence.find((e) => e.ref === selectedRef) : evidence[0];

  return (
    <AppShell
      title="Evidence"
      contextRail={
        <>
          {current !== undefined ? (
            <>
              <div className="rail-section">
                <div className="rail-title">Source record</div>
                <KV k="source" v={current.sourceRefs[0] ?? "—"} />
                <KV k="observed at" v={new Date(current.observedAt).toISOString().slice(0, 16).replace("T", " ")} />
                {current.eventTimestamp !== undefined && (
                  <KV k="event time" v={new Date(current.eventTimestamp).toISOString().slice(0, 16).replace("T", " ")} />
                )}
                {current.toolResultRef !== undefined && <KV k="tool result" v={current.toolResultRef} />}
                <KV k="type" v={current.evidenceType} />
              </div>
              <div className="rail-section">
                <div className="rail-title">Relationships</div>
                <KV k="supports" v={current.supports.join(", ") || "—"} />
                <KV k="contradicts" v={current.contradicts.join(", ") || "—"} />
              </div>
            </>
          ) : (
            <div className="rail-section">
              <div className="rail-title">Source record</div>
              <Empty title="No evidence selected" />
            </div>
          )}
          {claims.length > 0 && (
            <div className="rail-section">
              <div className="rail-title">Claims in workspace</div>
              {claims.slice(0, 5).map((c) => (
                <div key={c.ref} style={{ padding: "6px 0", borderTop: "1px dashed var(--line)", fontSize: 12.5, color: "var(--text-2)" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>{c.ref}</span> {c.statement}
                </div>
              ))}
            </div>
          )}
          <Note tone="info">
            Classification is data attached by the research engine — the interface never
            re-derives or flattens it.
          </Note>
        </>
      }
    >
      <div className="page-head">
        <h1 className="page-title">Evidence</h1>
        <p className="page-sub">
          {error === undefined
            ? `${evidence.length} evidence objects in this workspace — recorded by real research runs.`
            : "Evidence could not be loaded."}
        </p>
      </div>

      {error !== undefined && (
        <Note tone="warn">
          <b>Backend unreachable.</b> {error} — start it with <code>npm run api</code> and refresh.
        </Note>
      )}

      {error === undefined && evidence.length === 0 && (
        <Empty title="No evidence yet" hint="Run research in the workspace — evidence appears here as the engine records it." />
      )}

      {evidence.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "var(--gap-4)" }} role="tablist" aria-label="Filter by class">
            {FILTERS.map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={`badge ${filter === f ? "teal" : "gray"}`}
                style={{ cursor: "pointer", padding: "5px 10px" }}
                onClick={() => setFilter(f)}
              >
                {f.replace(/_/g, " ")}
              </button>
            ))}
          </div>

          <Panel kicker={`${list.length} items`} title="Evidence objects">
            <div>
              {list.map((e) => (
                <div
                  key={e.ref}
                  className="ev-item"
                  style={{ cursor: "pointer", background: e.ref === current?.ref ? "var(--panel-2)" : undefined }}
                  onClick={() => setSelectedRef(e.ref)}
                  onKeyDown={(ev) => ev.key === "Enter" && setSelectedRef(e.ref)}
                  role="button"
                  tabIndex={0}
                >
                  <EpistemicRail cls={e.evidenceClass} />
                  <div className="ev-body">
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{e.observation}</div>
                    <div className="ev-meta">
                      <ClassBadge cls={e.evidenceClass} />
                      <FreshnessBadge freshness={e.freshness} />
                      {e.proxyBasis !== undefined && <ProxyNote basis={e.proxyBasis} />}
                      <span className="ev-time mono">{e.ref} · {timeAgo(e.observedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Note>
            Reading the classes: <b>OBSERVATION</b> is directly recorded data · <b>DERIVED
            OBSERVATION</b> is computed from observations · <b>INTERPRETATION</b> is an analyst/model
            reading (never silently promoted to fact) · <b>PROXY EVIDENCE</b> measures something
            adjacent and says so · <b>SPECULATION</b> is explicitly unproven.
          </Note>
        </>
      )}
    </AppShell>
  );
}
