/**
 * Reusable UI primitives; the visual vocabulary shared by every screen.
 * The epistemic rail + class badge pair is the signature: structure encodes evidence class.
 */
import type { ReactNode } from "react";
import type { EvidenceClass, Freshness, Confidence, UnavailableInfo } from "../data/types.js";
import { parseAnswerSections } from "../data/answerSections.js";

/* ---------- epistemic class visuals ---------- */

const CLASS_META: Record<string, { label: string; color: string; badge: string }> = {
  OBSERVATION: { label: "OBSERVATION", color: "var(--cls-observation)", badge: "teal" },
  DERIVED_OBSERVATION: { label: "DERIVED OBSERVATION", color: "var(--cls-derived)", badge: "blue" },
  INTERPRETATION: { label: "INTERPRETATION", color: "var(--cls-interpretation)", badge: "violet" },
  PROXY_EVIDENCE: { label: "PROXY EVIDENCE", color: "var(--cls-proxy)", badge: "amber" },
  SPECULATION: { label: "SPECULATION", color: "var(--cls-speculation)", badge: "magenta" },
};

export function classMeta(c: EvidenceClass | UnavailableInfo): { label: string; color: string; badge: string } {
  if (typeof c === "string") return CLASS_META[c] ?? { label: c, color: "var(--text-3)", badge: "gray" };
  return { label: "UNAVAILABLE", color: "var(--cls-unavailable)", badge: "gray" };
}

export function ClassBadge({ cls }: { cls: EvidenceClass | UnavailableInfo }) {
  const m = classMeta(cls);
  return <span className={`badge ${m.badge}`}>{m.label}</span>;
}

export function EpistemicRail({ cls }: { cls: EvidenceClass | UnavailableInfo }) {
  return <span className="ev-rail" style={{ background: classMeta(cls).color }} aria-hidden />;
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const map = { CURRENT: "green", STALE: "amber", HISTORICAL: "gray" } as const;
  return <span className={`badge ${map[freshness]}`}>{freshness}</span>;
}

export function ProxyNote({ basis }: { basis: string }) {
  return (
    <span className="badge amber" title={basis} style={{ textTransform: "none", letterSpacing: 0 }}>
      proxy: {basis}
    </span>
  );
}

export function UnavailableNote({ note }: { note: string }) {
  return (
    <div className="note" role="note">
      <span className="note-dot" aria-hidden />
      <span>{note}</span>
    </div>
  );
}

/* ---------- confidence ---------- */

export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const cells = confidence === "HIGH" ? 3 : confidence === "MODERATE" ? 2 : confidence === "LOW" ? 1 : 0;
  const on = confidence === "HIGH" ? "on-high" : confidence === "MODERATE" ? "on-mod" : "on-low";
  return (
    <span className="confidence" title={`confidence: ${confidence}`}>
      <span className="conf-track" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className={`conf-cell ${i < cells ? on : ""}`} />)}
      </span>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--text-2)" }}>{confidence}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "COMPLETED" || status === "SUPPORTED" || status === "ACTIVE" || status === "CURRENT" ? "green"
    : status === "WEAKENED" || status === "PARTIAL" || status === "STALE" || status === "PAUSED" ? "amber"
    : status === "MATERIALLY_CHALLENGED" || status === "UNSUPPORTED" || status === "FAILED" ? "red"
    : "gray";
  return <span className={`badge ${tone}`}>{status.replace(/_/g, " ")}</span>;
}

/* ---------- layout helpers ---------- */

export function Panel({ title, kicker, right, children }: {
  title?: string; kicker?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="panel">
      {(title || kicker || right) && (
        <header className="panel-head">
          {kicker && <span className="panel-kicker">{kicker}</span>}
          {" "}
          {title && <span className="panel-title">{title}</span>}
          {" "}
          {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function KV({ k, v }: { k: string; v: string }) {
  return <div className="kv"><span className="k">{k}</span>{" "}<span className="v">{v}</span></div>;
}

export function Note({ tone, children }: { tone?: "warn" | "info"; children: ReactNode }) {
  return <div className={`note ${tone ?? ""}`}>{children}</div>;
}

/**
 * ANSWER PROSE (readability law: no raw Markdown on screen, real sections on screen).
 *
 * The engine composes trader-facing answers as labelled sections ("**What happened:** ...",
 * "**What happened**" + body lines). Rendering that string verbatim shows the trader literal
 * asterisks and a wall of semi-bold text — the "engineering console" look the product must
 * not have. This renders each parsed section as a real heading plus its paragraphs, with the
 * emphasis on the substance rather than on every line.
 *
 * Purely presentational: the text is shown verbatim (markers removed), nothing is summarized
 * or re-worded.
 */
export function AnswerProse({ text, className }: { text: string; className?: string }) {
  const sections = parseAnswerSections(text);
  return (
    <div className={className}>
      {sections.map((section, i) => (
        <div key={i} className="answer-section" style={i === 0 ? undefined : { marginTop: 12 }}>
          {section.heading !== undefined && <div className="section-h">{section.heading}</div>}
          <div className={section.heading !== undefined ? "section-body" : undefined}>
            {section.body.map((paragraph, j) => (
              <div key={j} style={j === 0 ? undefined : { marginTop: 6 }}>{paragraph}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big">{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

/**
 * Relative time for a REAL timestamp. An absent/invalid timestamp renders as nothing rather
 * than a fabricated "just now" — the UI never invents recency it does not have.
 */
export function timeAgo(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const mins = Math.max(1, Math.round((Date.now() - d) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
