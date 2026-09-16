/**
 * Research context builder — the validated, epistemically-typed research state handed to the
 * model for analysis/synthesis/challenge/thesis work (M3 §9).
 *
 * Architectural basis:
 * - M3 §9: context must DISTINGUISH observations, quantitative observations, documented
 *   statements, historical records, interpretations, sentiment signals, inferences, speculation,
 *   claims, hypotheses, judgments, contradictions, limitations, provenance, freshness,
 *   confidence, uncertainty. Never collapse them into "facts". The model can reference these
 *   objects; it can never upgrade their epistemic class.
 * - Evidence laws (§9/§12): retrieval failure/tool failure appear ONLY as limitations —
 *   never as negative evidence. Insufficient evidence stays distinguishable from contradiction.
 * - progressive-disclosure.md §74: the explanation layer must not fabricate or reinterpret
 *   evidence beyond the underlying evidence state — same rule here for model input.
 */

import type { Evidence, EvidenceClass, Freshness, Claim, Hypothesis, Judgment } from "../domain/objects.js";
import type { Workspace } from "../domain/workspace.js";
import type { ToolResult } from "../domain/tool-result.js";

/** One context item — every item keeps its architecture object type and epistemic class. */
export interface ContextItem {
  readonly ref: string;
  readonly kind:
    | "observation"
    | "quantitative_observation"
    | "market_data"
    | "documented_statement"
    | "historical_record"
    | "analyst_interpretation"
    | "sentiment_signal"
    | "inference"
    | "speculation"
    | "proxy_observation"
    | "claim"
    | "hypothesis"
    | "judgment";
  readonly text: string;
  readonly evidenceClass?: EvidenceClass;
  readonly freshness?: Freshness;
  readonly sourceRefs: readonly string[];
  /** Present only for PROXY_EVIDENCE — what the proxy actually measures (lock §3). */
  readonly proxyBasis?: string;
  readonly timestamp?: string;
}

export interface ContextLimitation {
  readonly kind:
    | "tool_failure" // a capability invocation failed — NOT evidence against anything
    | "empty_result" // a tool returned nothing usable — absence of data, not data of absence
    | "partial_result" // some feeds/sources answered, others did not
    | "stale_evidence" // usable but outside the freshness window
    | "insufficient_evidence"; // the valid research-completion outcome
  readonly description: string;
  readonly capability?: string;
  readonly toolRef?: string;
}

export interface ResearchContext {
  readonly researchRef?: string;
  readonly objective?: string;
  /** Evidence, epistemically bucketed — the model receives classes, not a "facts" list. */
  readonly items: readonly ContextItem[];
  readonly claims: readonly { ref: string; statement: string; status: string }[];
  readonly hypotheses: readonly { ref: string; statement: string; status: string; ranking: number }[];
  readonly judgment?: { ref: string; statement: string; confidence?: string; uncertainty: readonly string[] };
  /** Failures/limits — the model may NOT convert these into negative evidence. */
  readonly limitations: readonly ContextLimitation[];
  /** Cross-direction evidence pairs observed in the graph (contradiction preservation). */
  readonly contradictions: readonly { supports: readonly string[]; contradicts: readonly string[] }[];
  /** The trader's active thesis, when one exists — presented as THE TRADER'S position. */
  readonly thesis?: { ref: string; statement: string; status: string; claims: readonly string[]; assumptions: readonly string[]; invalidationConditions: readonly string[] };
  /** M6 (audit D1): the current theses inventory — lets state-change steps resolve WHICH thesis
   *  a trader means (e.g. "the halving thesis") without inventing refs. Trader-owned objects;
   *  presented for selection only, never for silent modification. */
  readonly theses?: readonly { ref: string; statement: string; status: string; active: boolean }[];
}

/** Map an evidence object to its context item kind — the epistemic boundary, mechanically. */
export function contextKindForEvidence(e: Evidence): ContextItem["kind"] {
  switch (e.evidenceClass) {
    case "RAW_DATA":
      return "market_data";
    case "OBSERVATION":
      return "observation";
    case "DERIVED_OBSERVATION":
      // Sub-class by evidence type tag: interpretations produced by skills/analysts stay
      // interpretations; model/inference-authored ones stay inferences (never "observation").
      return "analyst_interpretation";
    case "PROXY_EVIDENCE":
      return "proxy_observation";
    case "SPECULATION":
      return "speculation";
  }
  // Defensive exhaustiveness: EvidenceClass is a closed union; reaching here is impossible.
  throw new Error(`unhandled evidence class: ${String((e as Evidence).evidenceClass)}`);
}

/** Evidence whose observation text is JSON-serialized (news items etc.) — humanize for context. */
function evidenceText(e: Evidence): string {
  try {
    const parsed = JSON.parse(e.observation) as Record<string, unknown>;
    if (typeof parsed.title === "string") {
      const summary = typeof parsed.summary === "string" ? ` — ${String(parsed.summary).slice(0, 200)}` : "";
      return `${parsed.title}${summary}`;
    }
  } catch {
    // not JSON — use as-is
  }
  return e.observation;
}

/**
 * Build the validated research context from a workspace. Everything included comes from real
 * workspace objects — nothing is invented, and failures enter only through `limitations`.
 */
export function buildResearchContext(
  workspace: Workspace,
  options: {
    researchRef?: string;
    /** TOOL_RESULTs from this session, for failure/limitation reporting. */
    readonly executions?: readonly { readonly capability: string; readonly result: ToolResult }[];
    /** Set when the caller already knows evidence is insufficient (valid completion state). */
    readonly insufficientEvidence?: string;
  } = {},
): ResearchContext {
  const items: ContextItem[] = [];
  const limitations: ContextLimitation[] = [];
  const contradictions: { supports: readonly string[]; contradicts: readonly string[] }[] = [];

  // --- evidence (bucketed, with freshness/provenance preserved) ---
  for (const e of workspace.listEvidence()) {
    items.push({
      ref: e.id,
      kind: e.evidenceClass === "PROXY_EVIDENCE" ? "proxy_observation" : contextKindForEvidence(e),
      text: evidenceText(e),
      evidenceClass: e.evidenceClass,
      freshness: e.freshness,
      sourceRefs: e.sourceRefs,
      ...(e.proxyBasis !== undefined ? { proxyBasis: e.proxyBasis } : {}),
      ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
    });
  }

  // --- claims ---
  const claims = workspace.listClaims().map((c: Claim) => ({ ref: c.id, statement: c.statement, status: c.status }));

  // --- hypotheses ---
  const hypotheses = workspace.listHypotheses().map((h: Hypothesis) => ({
    ref: h.id,
    statement: h.statement,
    status: h.status,
    ranking: h.ranking,
  }));

  // --- current judgment (single ACTIVE judgment per research context) ---
  let judgment: ResearchContext["judgment"];
  const researchRef = options.researchRef;
  const current = researchRef !== undefined ? workspace.currentJudgment(researchRef) : undefined;
  if (current !== undefined) {
    judgment = {
      ref: current.id,
      statement: current.statement,
      ...(current.confidence !== undefined ? { confidence: current.confidence } : {}),
      uncertainty: current.uncertainty,
    };
  } else {
    const fallback = workspace.listJudgments().find((j: Judgment) => j.status === "ACTIVE");
    if (fallback !== undefined) {
      judgment = {
        ref: fallback.id,
        statement: fallback.statement,
        ...(fallback.confidence !== undefined ? { confidence: fallback.confidence } : {}),
        uncertainty: fallback.uncertainty,
      };
    }
  }

  // --- failures → limitations ONLY (never negative evidence; M3 §9/§19) ---
  for (const { capability, result } of options.executions ?? []) {
    if (result.failure.type === "NONE") {
      if (result.completeness === "PARTIAL") {
        limitations.push({ kind: "partial_result", description: `${capability} returned partial results`, capability, toolRef: result.id });
      }
      if (result.completeness === "EMPTY") {
        limitations.push({ kind: "empty_result", description: `${capability} returned no usable data (absence of data is not evidence of absence)`, capability, toolRef: result.id });
      }
      continue;
    }
    limitations.push({
      kind: "tool_failure",
      description: `${capability} invocation failed (${result.failure.type}): ${result.failure.message ?? "no message"}`,
      capability,
      toolRef: result.id,
    });
  }
  if (options.insufficientEvidence !== undefined) {
    limitations.push({ kind: "insufficient_evidence", description: options.insufficientEvidence });
  }

  // --- contradictions: evidence graph directions already record them ---
  const supporting = workspace.listEvidence().filter((e) => e.supports.length > 0);
  const contradicting = workspace.listEvidence().filter((e) => e.contradicts.length > 0);
  if (supporting.length > 0 && contradicting.length > 0) {
    contradictions.push({
      supports: supporting.map((e) => e.id),
      contradicts: contradicting.map((e) => e.id),
    });
  }

  // --- thesis: presented as the trader's own position, never the system's ---
  const activeThesis = workspace.getActiveThesis();
  const thesis: ResearchContext["thesis"] = activeThesis !== undefined
    ? {
        ref: activeThesis.id,
        statement: activeThesis.statement,
        status: activeThesis.status,
        claims: activeThesis.claims.map((c) => c.statement),
        assumptions: activeThesis.assumptions.map((a) => a.statement),
        invalidationConditions: [...activeThesis.invalidationConditions],
      }
    : undefined;
  // M6 (audit D1): the theses inventory — the model cannot resolve "make the halving thesis
  // active" without knowing which theses exist. The currently-active one is flagged.
  const activeId = workspace.getActiveThesis()?.id;
  const theses: ResearchContext["theses"] = workspace
    .listTheses()
    .filter((t) => t.status !== "ARCHIVED" && t.status !== "SUPERSEDED")
    .slice(0, 20)
    .map((t) => ({ ref: t.id, statement: t.statement, status: t.status, active: t.id === activeId }));

  const research = researchRef !== undefined ? workspace.getResearch(researchRef) : undefined;
  return {
    ...(researchRef !== undefined ? { researchRef } : {}),
    ...(research !== undefined ? { objective: research.objective } : {}),
    items,
    claims,
    hypotheses,
    ...(judgment !== undefined ? { judgment } : {}),
    limitations,
    contradictions,
    ...(thesis !== undefined ? { thesis } : {}),
    ...(theses.length > 0 ? { theses } : {}),
  };
}

/**
 * Render the context as the structured text block given to the model. Classes are explicit —
 * the prompt makes upgrading classes forbidden. Stale/historical items stay labeled
 * (progressive-disclosure.md §44: historical information must not pass as current).
 */
export function renderResearchContext(ctx: ResearchContext): string {
  const lines: string[] = [];
  if (ctx.objective !== undefined) lines.push(`RESEARCH OBJECTIVE: ${ctx.objective}`);

  const byKind = new Map<string, ContextItem[]>();
  for (const item of ctx.items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }
  lines.push("RESEARCH OBJECTS (epistemic classes preserved — do NOT treat interpretations, inferences, or speculation as observations):");
  for (const [kind, list] of byKind) {
    lines.push(`  ${kind.toUpperCase()} (${list.length}):`);
    for (const item of list.slice(0, 40)) {
      const freshness = item.freshness !== undefined ? ` [${item.freshness}]` : "";
      const proxy = item.proxyBasis !== undefined ? ` (proxy: ${item.proxyBasis})` : "";
      const ts = item.timestamp !== undefined ? ` @${item.timestamp}` : "";
      lines.push(`    ${item.ref}: ${item.text.slice(0, 300)}${freshness}${proxy}${ts}`);
    }
    if (list.length > 40) lines.push(`    … ${list.length - 40} more (${list.map((i) => i.ref).slice(40).join(", ")})`);
  }

  if (ctx.claims.length > 0) {
    lines.push("CLAIMS:");
    for (const c of ctx.claims) lines.push(`  ${c.ref} [${c.status}]: ${c.statement.slice(0, 200)}`);
  }
  if (ctx.hypotheses.length > 0) {
    lines.push("HYPOTHESES:");
    for (const h of ctx.hypotheses) lines.push(`  ${h.ref} [${h.status}, rank ${h.ranking}]: ${h.statement.slice(0, 200)}`);
  }
  if (ctx.judgment !== undefined) {
    lines.push(`CURRENT JUDGMENT ${ctx.judgment.ref}${ctx.judgment.confidence !== undefined ? ` (confidence: ${ctx.judgment.confidence})` : ""}:`);
    lines.push(`  ${ctx.judgment.statement.slice(0, 400)}`);
    if (ctx.judgment.uncertainty.length > 0) lines.push(`  uncertainty: ${ctx.judgment.uncertainty.join("; ")}`);
  }
  if (ctx.thesis !== undefined) {
    lines.push(`TRADER'S THESIS ${ctx.thesis.ref} [${ctx.thesis.status}] — the trader's own position; never treat assessment as authority to change it:`);
    lines.push(`  ${ctx.thesis.statement.slice(0, 400)}`);
    for (const c of ctx.thesis.claims) lines.push(`  thesis claim: ${c}`);
    for (const a of ctx.thesis.assumptions) lines.push(`  thesis assumption: ${a}`);
    for (const i of ctx.thesis.invalidationConditions) lines.push(`  invalidation condition: ${i}`);
  }
  if (ctx.theses !== undefined && ctx.theses.length > 0) {
    lines.push("TRADER'S THESES (trader-owned — for selection reference only; never silently modify):" );
    for (const t of ctx.theses) lines.push(`  ${t.ref}${t.active ? " [ACTIVE]" : ""} [${t.status}]: ${t.statement.slice(0, 160)}`);
  }
  if (ctx.limitations.length > 0) {
    lines.push("LIMITATIONS (data-availability conditions — NOT evidence against any claim; do not convert them into negative findings):");
    for (const l of ctx.limitations) lines.push(`  [${l.kind}] ${l.description}`);
  }
  if (ctx.contradictions.length > 0) {
    lines.push("CONTRADICTIONS (both directions are preserved in the graph):");
    for (const c of ctx.contradictions) {
      lines.push(`  supporting: ${c.supports.join(", ")}`);
      lines.push(`  contradicting: ${c.contradicts.join(", ")}`);
    }
  }
  return lines.join("\n");
}
