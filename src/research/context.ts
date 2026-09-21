/**
 * Research context builder; the validated, epistemically-typed research state handed to the
 * model for analysis/synthesis/challenge/thesis work (M3 §9).
 *
 * Architectural basis:
 * - M3 §9: context must DISTINGUISH observations, quantitative observations, documented
 *   statements, historical records, interpretations, sentiment signals, inferences, speculation,
 *   claims, hypotheses, judgments, contradictions, limitations, provenance, freshness,
 *   confidence, uncertainty. Never collapse them into "facts". The model can reference these
 *   objects; it can never upgrade their epistemic class.
 * - Evidence laws (§9/§12): retrieval failure/tool failure appear ONLY as limitations
 *   never as negative evidence. Insufficient evidence stays distinguishable from contradiction.
 * - progressive-disclosure.md §74: the explanation layer must not fabricate or reinterpret
 *   evidence beyond the underlying evidence state; same rule here for model input.
 */

import type { Evidence, EvidenceClass, Freshness, Claim, Hypothesis } from "../domain/objects.js";
import type { Workspace } from "../domain/workspace.js";
import type { ToolResult } from "../domain/tool-result.js";
import { matchRequirement, domainsOfRequirement, isDiscriminatingRequirement, type CoverageEvidence, type EvidenceDomain, type ResearchRequirement } from "./requirements.js";

/** One context item; every item keeps its architecture object type and epistemic class. */
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
  /** Present only for PROXY_EVIDENCE; what the proxy actually measures (lock §3). */
  readonly proxyBasis?: string;
  readonly timestamp?: string;
}

export interface ContextLimitation {
  readonly kind:
    | "tool_failure" // a capability invocation failed; NOT evidence against anything
    | "empty_result" // a tool returned nothing usable; absence of data, not data of absence
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
  /**
   * Evidence excluded by the relevance gate (unrelated archived runs), surfaced so the
   * exclusion is auditable and the model knows more exists behind an explicit boundary.
   */
  readonly archiveBackground?: { readonly count: number; readonly sampleRefs: readonly string[] };
  /** Run-collected items demoted by the SUBJECT gate: this run ingested them but they do not concern the question's subject (wrong-target evidence; the loop's recovery reads this). */
  readonly rejectedWrongTarget?: number;
  /** Run-collected items admitted to no requirement (engine ledger): valid observations, but not evidence for THIS question — background for the graph, never synthesis input. */
  readonly rejectedNoRequirement?: number;
  /** Requirement-coverage report (rendered text) when the engine assessed requirements. */
  readonly requirementCoverage?: string;
  /** Which run the context is anchored to (the archive fallback when unscoped). */
  readonly currentResearchRef?: string;
  readonly currentResearchQuestion?: string;
  /**
   * What the items represent: a single research run (researchRef given) or the
   * workspace-wide archive of ALL past runs (no ref; may mix unrelated questions).
   * Analysis over the archive must say so, never present it as current research.
   */
  readonly scope?: "single_research" | "workspace_archive";
  /** Evidence, epistemically bucketed; the model receives classes, not a "facts" list. */
  readonly items: readonly ContextItem[];
  readonly claims: readonly { ref: string; statement: string; status: string }[];
  readonly hypotheses: readonly { ref: string; statement: string; status: string; ranking: number }[];
  readonly judgment?: { ref: string; statement: string; confidence?: string; uncertainty: readonly string[] };
  /** Failures/limits; the model may NOT convert these into negative evidence. */
  readonly limitations: readonly ContextLimitation[];
  /** Cross-direction evidence pairs observed in the graph (contradiction preservation). */
  readonly contradictions: readonly { supports: readonly string[]; contradicts: readonly string[] }[];
  /** The trader's active thesis, when one exists; presented as THE TRADER'S position. */
  readonly thesis?: { ref: string; statement: string; status: string; claims: readonly string[]; assumptions: readonly string[]; invalidationConditions: readonly string[] };
  /** M6 (audit D1): the current theses inventory; lets state-change steps resolve WHICH thesis
   *  a trader means (e.g. "the halving thesis") without inventing refs. Trader-owned objects;
   *  presented for selection only, never for silent modification. */
  readonly theses?: readonly { ref: string; statement: string; status: string; active: boolean }[];
}

// ---------------------------------------------------------------------------
// Relevance gate (zero-dead-end architecture)
// ---------------------------------------------------------------------------

const STOP_TERMS = new Set([
  "what", "why", "how", "when", "the", "a", "an", "is", "are", "was", "were", "did", "does",
  "do", "could", "should", "would", "affect", "affecting", "affects", "move", "moved", "moving",
  "happen", "happened", "right", "now", "currently", "current", "today", "recent", "recently",
  "last", "week", "data", "price", "prices", "market", "markets", "question", "research",
  "gather", "compare", "comparison", "explain", "about", "with", "for", "from", "and", "or",
  // Function words: tokens that appear in questions of ANY subject. Leaving them in made
  // unrelated archive evidence "relevant" ("this"/"driving" matched headline prose), which
  // is how a DeFi run's evidence reached an oil question's synthesis.
  "this", "that", "these", "those", "there", "here", "they", "them", "their", "its", "it",
  "in", "on", "at", "to", "of", "be", "been", "being", "has", "have", "had", "will",
  "would", "may", "might", "can", "than", "then", "other", "others", "more", "most",
  "much", "some", "any", "all", "not", "only", "also", "just", "very", "such", "into",
  "over", "new", "get", "got", "make", "makes", "made", "things", "thing", "going",
]);

/**
 * Key terms of a question: distinct alphanumeric tokens minus domain-neutral stopwords.
 * A question about TSLA has TSLA as a key term; "market"/"price" alone never make two
 * questions about different subjects relevant to each other.
 */
function relevanceTerms(text: string | undefined): Set<string> | undefined {
  if (text === undefined || text.trim() === "") return undefined;
  const terms = new Set(
    text
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 2 && !STOP_TERMS.has(t.toLowerCase()) && !STOP_TERMS.has(t)),
  );
  return terms.size > 0 ? terms : undefined;
}

/** An item is relevant when it shares at least one key term with the question. */
function isRelevant(itemText: string, terms: Set<string>): boolean {
  const itemTerms = relevanceTerms(itemText);
  if (itemTerms === undefined) return false;
  for (const t of itemTerms) if (terms.has(t)) return true;
  return false;
}

/**
 * Subject-term match (target-relevance law): the item concerns the question's subject.
 * Beyond token equality, quote-pair concatenations (BTCUSDT for subject BTC) and
 * whole-word occurrences ("BTC/USD", "oil prices" for subject OIL) count. Word-boundary
 * matching keeps GOLD from matching GOLDMAN.
 */
function isSubjectRelevant(itemText: string, subjectTerms: Set<string>): boolean {
  if (isRelevant(itemText, subjectTerms)) return true;
  const upper = itemText.toUpperCase();
  const itemTokens = new Set(upper.split(/[^A-Z0-9]+/).filter((t) => t !== ""));
  for (const term of subjectTerms) {
    for (const suffix of QUOTE_SUFFIXES) {
      if (itemTokens.has(`${term}${suffix}`)) return true;
    }
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(upper)) return true;
  }
  return false;
}

/** Quote-asset suffixes that glue a ticker into a market symbol (BTCUSDT, EURUSD...). */
const QUOTE_SUFFIXES = ["USDT", "USD", "USDC", "PERP"] as const;

/** Map an evidence object to its context item kind; the epistemic boundary, mechanically. */
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

/** Evidence whose observation text is JSON-serialized (news items etc.); humanize for context. */
function evidenceText(e: Evidence): string {
  try {
    const parsed = JSON.parse(e.observation) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.title === "string") {
        const summary = typeof rec.summary === "string" ? `; ${String(rec.summary).slice(0, 200)}` : "";
        // The subject symbol MUST travel with the rendered text: the target-relevance gate
        // matches on it, and headline text alone often never names the ticker (a headline
        // says "Nvidia", the evidence's subject field says NVDA). Rendered verbatim from
        // the payload; not fabrication.
        const symbol = typeof rec.symbol === "string" ? ` [${rec.symbol}]` : "";
        return `${rec.title}${summary}${symbol}`;
      }
      // Quantitative tool payloads arrive as one dense JSON line; models misread them as
      // "no data" (production-observed). Rendering the ACTUAL fields deterministically is not
      // fabrication: every rendered token comes from the payload, and the raw JSON stays on
      // the evidence object for provenance.
      const humanized = humanizeRecord(rec);
      if (humanized !== "") return humanized;
    }
  } catch {
    // not JSON; use as-is
  }
  return e.observation;
}

/** Render a tool payload's fields as readable text; bounded, lossless at one nesting level. */
function humanizeRecord(rec: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const names = value
        .slice(0, 3)
        .map((entry) => {
          if (entry !== null && typeof entry === "object" && "name" in (entry as Record<string, unknown>)) {
            return String((entry as Record<string, unknown>).name);
          }
          return typeof entry === "object" ? "" : String(entry);
        })
        .filter((s) => s !== "")
        .join(", ");
      if (names !== "") parts.push(`${key}: ${names}${value.length > 3 ? ` (+${value.length - 3} more)` : ""}`);
      continue;
    }
    if (typeof value === "object") {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (subValue !== null && subValue !== undefined && typeof subValue !== "object") {
          parts.push(`${key}.${subKey}: ${String(subValue)}`);
        }
      }
      continue;
    }
    parts.push(`${key}: ${String(value)}`);
  }
  const text = parts.join("; ");
  return text.length > 700 ? `${text.slice(0, 700)}...` : text;
}

/**
 * Build the validated research context from a workspace. Everything included comes from real
 * workspace objects; nothing is invented, and failures enter only through `limitations`.
 */
export function buildResearchContext(
  workspace: Workspace,
  options: {
    researchRef?: string;
    /**
     * Relevance gate (zero-dead-end architecture): when set, evidence items whose text
     * shares no key term with this string are DEMOTED out of the primary items list (a
     * bounded `archiveBackground` is still carried for provenance). This keeps archived
     * evidence from UNRELATED questions (e.g. BTC runs) from masquerading as context for
     * a TSLA question — the production failure where the decision model described crypto
     * news as its "available research context" and concluded insufficiency.
     */
    readonly relevantTo?: string;
    /**
     * SUBJECT terms of the question (resolved instrument + tickers + crypto aliases;
     * NOT generic market words). When set, the gate applies to ALL evidence — including
     * evidence this very run collected. This is the target-relevance law: a provider
     * returning wrong-domain items (crypto RSS during an oil question) must not enter
     * synthesis merely because this run ingested them; wrong-target evidence is demoted
     * with a rejection count, and the loop's recovery decides what to do about the gap.
     * Callers pass this ONLY for independent research questions whose subject resolved;
     * continuation flows (thesis hold, framework evaluation) keep run-scoped semantics
     * because their objective legitimately does not name the subject.
     */
    readonly subjectTerms?: readonly string[];
    /**
     * Requirement coverage (engine-assessed): rendered into the context so the decision and
     * synthesis models SEE which requirements are covered, which are stale-only, and which
     * are exhausted. The model cannot upgrade an uncovered requirement to satisfied.
     */
    readonly requirements?: readonly { readonly id: string; readonly description: string; readonly importance: string; readonly timeSensitivity: string; readonly status: string; readonly evidenceRefs: readonly string[]; readonly staleOnlyRefs: readonly string[]; readonly missingReason?: string }[];    /** TOOL_RESULTs from this session, for failure/limitation reporting. */
    readonly executions?: readonly { readonly capability: string; readonly result: ToolResult }[];
    /** Set when the caller already knows evidence is insufficient (valid completion state). */
    readonly insufficientEvidence?: string;
  } = {},
): ResearchContext {
  const items: ContextItem[] = [];
  const limitations: ContextLimitation[] = [];
  const contradictions: { supports: readonly string[]; contradicts: readonly string[] }[] = [];

  // --- evidence (bucketed, with freshness/provenance preserved) ---
  // Relevance gate (zero-dead-end architecture, two tiers):
  // 1. RUN-SCOPED (primary): evidence attached to the CURRENT research object is in scope
  //    by definition — this run ingested it against this question. Lexical filtering here
  //    over-fired (a "Does my thesis hold?" objective shares no term with the thesis's BTC
  //    evidence and emptied the context, killing Flow 4 evaluation).
  // 2. LEXICAL (foreign): evidence from OTHER runs enters only when it shares a key term
  //    with the current objective. This is the archive-contamination defense: a TSLA run
  //    must not see 500 stale BTC items as its "available research context" (observed live:
  //    the decision model described crypto news as its context and concluded insufficiency).
  // Demoted items are counted in `archiveBackground` (rendered as one provenance line).
  const relevantTerms = relevanceTerms(options.relevantTo);
  // Subject gate is OPT-IN: the caller (the adaptive loop for independent research
  // questions) derives subject terms via subjectTermsOf and passes them here. When absent
  // (continuation flows, thesis evaluation), run evidence keeps run-scoped semantics.
  const gateTerms = options.subjectTerms !== undefined && options.subjectTerms.length > 0
    ? new Set(options.subjectTerms.map((t) => t.toUpperCase()))
    : undefined;
  const runEvidenceRefs = new Set<string>(
    options.researchRef !== undefined
      ? (workspace.getResearch(options.researchRef)?.evidenceRefs ?? [])
      : [],
  );
  const archiveBackground = { count: 0, sampleRefs: [] as string[] };
  let rejectedWrongTarget = 0;
  // SYNTHESIS-ADMISSION LAW (VALID ≠ RELEVANT, second line of defense): when the engine
  // assessed requirements for this run, run-collected evidence that matches NO requirement
  // (not even stale-only) is background for the evidence graph, not synthesis input. The
  // live failure this prevents: with no resolved subject (a subjectless macro question) the
  // subject gate was off, so crypto observations the run collected entered the synthesis
  // context whole and the answer became a crypto summary. Opt-in like the subject gate:
  // callers without a requirement ledger keep run-scoped semantics. STALE_ONLY matches stay
  // admitted: stale evidence remains usable, explicitly labeled background.
  const admissionRequirements = (options.requirements ?? [])
    .filter((r) => r.description.trim() !== "")
    .map((r) => {
      const domains: readonly EvidenceDomain[] =
        (r as { domains?: readonly EvidenceDomain[] }).domains ?? domainsOfRequirement(r.description);
      return {
        id: r.id, description: r.description,
        timeSensitivity: r.timeSensitivity as ResearchRequirement["timeSensitivity"],
        domains: domains.length > 0 ? domains : (["GENERAL"] as const),
      };
    })
    .filter((r) => isDiscriminatingRequirement(r));
  let rejectedNoRequirement = 0;
  for (const e of workspace.listEvidence()) {
    const item: ContextItem = {
      ref: e.id,
      kind: e.evidenceClass === "PROXY_EVIDENCE" ? "proxy_observation" : contextKindForEvidence(e),
      text: evidenceText(e),
      evidenceClass: e.evidenceClass,
      freshness: e.freshness,
      sourceRefs: e.sourceRefs,
      ...(e.proxyBasis !== undefined ? { proxyBasis: e.proxyBasis } : {}),
      ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
    };
    const isRunEvidence = runEvidenceRefs.has(e.id);
    // Tier 1.5 (subject gate, run evidence): when the question's subject resolved, even
    // THIS run's evidence must concern that subject to enter synthesis. Provider results
    // are not evidence of the question's subject merely because the run requested them.
    // The producing tool's EXPLICIT subject declaration (`about`, e.g. "BTC") is honored
    // alongside the rendered text: a real indicator payload frequently omits its ticker, yet
    // the adapter declared which subject it concerns. Declared subject, not free text alone.
    const concernsSubject =
      gateTerms === undefined ||
      isSubjectRelevant(item.text, gateTerms) ||
      (e.subject !== undefined && isSubjectRelevant(e.subject, gateTerms));
    if (isRunEvidence && gateTerms !== undefined && !concernsSubject) {
      rejectedWrongTarget += 1;
      continue;
    }
    // Tier 1.6 (requirement-admission gate, run evidence): relevance to the QUESTION is
    // decided by the requirement matcher, not by "a provider returned it during this run".
    const matchesAnyRequirement =
      !isRunEvidence ||
      admissionRequirements.length === 0 ||
      admissionRequirements.some((req) => {
        const probe: ResearchRequirement = {
          id: req.id, description: req.description, importance: "CRITICAL",
          timeSensitivity: req.timeSensitivity,
          domains: req.domains,
          status: "PENDING", evidenceRefs: [], staleOnlyRefs: [], recoveryAttempts: 0,
        };
        const candidate: CoverageEvidence = {
          ref: e.id, text: item.text, evidenceType: e.evidenceType, freshness: e.freshness,
          ...(e.timestamp !== undefined ? { observedAt: e.timestamp } : {}),
        };
        return matchRequirement(probe, candidate, gateTerms !== undefined ? { subjectTerms: gateTerms } : {}) !== "NO_MATCH";
      });
    if (!matchesAnyRequirement) {
      rejectedNoRequirement += 1;
      continue;
    }
    // Tier 2 (archive gate): evidence from OTHER runs is scoped by SUBJECT when the
    // question's subject resolved, and by key terms otherwise. Subject scoping is the
    // target-relevance law applied to the archive: a DeFi/TVL evidence object from an
    // earlier crypto run must not enter an oil question merely because it shares a generic
    // token ("this", "driving") with the question text — the live contamination where the
    // oil synthesis cited ev_000326 (a DeFi run's evidence) as an oil-phase observation.
    const archiveOk =
      gateTerms !== undefined
        ? isSubjectRelevant(item.text, gateTerms) ||
          (e.subject !== undefined && isSubjectRelevant(e.subject, gateTerms))
        : relevantTerms === undefined || isRelevant(item.text, relevantTerms);
    if (!isRunEvidence && !archiveOk) {
      archiveBackground.count += 1;
      if (archiveBackground.sampleRefs.length < 5) archiveBackground.sampleRefs.push(e.id);
      continue;
    }
    items.push(item);
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
  }
  // NO global judgment fallback: a run without its own judgment must not inherit another
  // run's verdict (the stale-judgment contamination seen live). The context simply carries
  // no judgment line; the engine mints one at completion.
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
  // M6 (audit D1): the theses inventory; the model cannot resolve "make the halving thesis
  // active" without knowing which theses exist. The currently-active one is flagged.
  const activeId = workspace.getActiveThesis()?.id;
  const theses: ResearchContext["theses"] = workspace
    .listTheses()
    .filter((t) => t.status !== "ARCHIVED" && t.status !== "SUPERSEDED")
    .slice(0, 20)
    .map((t) => ({ ref: t.id, statement: t.statement, status: t.status, active: t.id === activeId }));

  const research = researchRef !== undefined ? workspace.getResearch(researchRef) : undefined;
  // Provenance of the context itself: without a researchRef the items below are the
  // workspace-wide accumulated archive (potentially from UNRELATED earlier runs), not a
  // coherent current investigation. The renderer states this explicitly so an ANALYZE
  // step can never present archived evidence from another question as "current research".
  const currentResearch = research ?? [...workspace.listResearch()].reverse()[0];
  return {
    ...(researchRef !== undefined ? { researchRef } : {}),
    ...(currentResearch !== undefined ? { objective: currentResearch.objective } : {}),
    ...(currentResearch !== undefined ? { currentResearchRef: currentResearch.id, currentResearchQuestion: currentResearch.question } : {}),
    ...(researchRef === undefined ? { scope: "workspace_archive" as const } : { scope: "single_research" as const }),
    ...(archiveBackground.count > 0 ? { archiveBackground } : {}),
    ...(rejectedWrongTarget > 0 ? { rejectedWrongTarget } : {}),
    ...(rejectedNoRequirement > 0 ? { rejectedNoRequirement } : {}),
    ...(options.requirements !== undefined && options.requirements.length > 0 ? { requirementCoverage: renderRequirementCoverage(options.requirements) } : {}),
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
 * Requirement coverage as the model sees it: engine-assessed status per requirement. A
 * provider returning data is NOT coverage; stale-only and exhausted requirement state is
 * stated explicitly so no answer can present an uncovered requirement as answered.
 */
function renderRequirementCoverage(requirements: readonly { readonly id: string; readonly description: string; readonly importance: string; readonly timeSensitivity: string; readonly status: string; readonly evidenceRefs: readonly string[]; readonly staleOnlyRefs: readonly string[]; readonly missingReason?: string }[]): string {
  const lines = requirements.map((r) => {
    const detail =
      r.status === "SATISFIED" ? `${r.evidenceRefs.length} relevant observation(s)`
      : r.status === "PARTIALLY_SATISFIED" ? `ONLY STALE evidence (${r.staleOnlyRefs.length}) for a ${r.timeSensitivity} requirement`
      : r.status === "EXHAUSTED" ? `EXHAUSTED: ${r.missingReason ?? "no relevant evidence after recovery"}`
      : `${r.status}: no relevant evidence yet`;
    return `- [${r.id}] (${r.importance}, ${r.timeSensitivity}) ${r.description}: ${r.status} (${detail})`;
  });
  const blocking = requirements.filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED");
  return [
    "REQUIREMENT COVERAGE (engine-assessed; a provider returning data is NOT coverage):",
    ...lines,
    blocking.length === 0
      ? "VERDICT: all CRITICAL requirements are covered by relevant, fresh-enough evidence."
      : `VERDICT: ${blocking.length} CRITICAL requirement(s) remain UNCOVERED (${blocking.map((b) => b.id).join(", ")}). Do NOT present them as answered; if recovery failed, state exactly which requirement could not be satisfied.`,
    "ANSWER LAW (gap separation): an UNCOVERED requirement is a RESEARCH GAP and belongs in the answer's uncertainty ONLY as it affects the conclusion (one plain sentence per material gap). Provider/tool failures, fallbacks, transport notes, and data-source caveats are CAPABILITY GAPS: they are NOT uncertainty, NOT findings, and must NEVER appear in the answer. Partially covered questions are answered from what IS established while naming what is not; one uncovered requirement never reduces the whole answer to the gap.",
  ].join("\n");
}

/**
 * Render the context as the structured text block given to the model. Classes are explicit
 * the prompt makes upgrading classes forbidden. Stale/historical items stay labeled
 * (progressive-disclosure.md §44: historical information must not pass as current).
 */
export function renderResearchContext(ctx: ResearchContext): string {
  const lines: string[] = [];
  if (ctx.scope === "workspace_archive") {
    lines.push(
      `CONTEXT SCOPE: workspace archive. The objects below were accumulated across ALL past research runs and may relate to DIFFERENT questions (most recent run: ${ctx.currentResearchQuestion ?? "unknown"}). They are background context, NOT a current investigation of the trader's new question.`,
    );
  } else if (ctx.researchRef !== undefined) {
    lines.push(`CONTEXT SCOPE: research ${ctx.researchRef}.`);
  }
  if (ctx.rejectedWrongTarget !== undefined && ctx.rejectedWrongTarget > 0) {
    lines.push(`TARGET GATE: ${ctx.rejectedWrongTarget} item(s) collected during THIS run do not concern the question's subject and are EXCLUDED from synthesis (wrong-target evidence). They are recorded for provenance but are NOT research findings for this question.`);
  }
  if (ctx.rejectedNoRequirement !== undefined && ctx.rejectedNoRequirement > 0) {
    lines.push(`REQUIREMENT GATE: ${ctx.rejectedNoRequirement} item(s) collected during THIS run satisfy none of the question's requirements and are EXCLUDED from synthesis. A provider returning data during this run does not make that data evidence for this question.`);
  }
  if (ctx.archiveBackground !== undefined) {
    lines.push(`RELEVANCE GATE: ${ctx.archiveBackground.count} archived evidence object(s) from unrelated past questions are EXCLUDED from this context (sample: ${ctx.archiveBackground.sampleRefs.join(", ")}). If this question needs them, research the question directly; do not treat the exclusion as evidence of absence.`);
  }
  if (ctx.objective !== undefined) lines.push(`RESEARCH OBJECTIVE: ${ctx.objective}`);
  if (ctx.requirementCoverage !== undefined) lines.push(ctx.requirementCoverage);

  const byKind = new Map<string, ContextItem[]>();
  for (const item of ctx.items) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }
  lines.push("RESEARCH OBJECTS (epistemic classes preserved; do NOT treat interpretations, inferences, or speculation as observations):");
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
    lines.push(`TRADER'S THESIS ${ctx.thesis.ref} [${ctx.thesis.status}]; the trader's own position; never treat assessment as authority to change it:`);
    lines.push(`  ${ctx.thesis.statement.slice(0, 400)}`);
    for (const c of ctx.thesis.claims) lines.push(`  thesis claim: ${c}`);
    for (const a of ctx.thesis.assumptions) lines.push(`  thesis assumption: ${a}`);
    for (const i of ctx.thesis.invalidationConditions) lines.push(`  invalidation condition: ${i}`);
  }
  if (ctx.theses !== undefined && ctx.theses.length > 0) {
    lines.push("TRADER'S THESES (trader-owned; for selection reference only; never silently modify):" );
    for (const t of ctx.theses) lines.push(`  ${t.ref}${t.active ? " [ACTIVE]" : ""} [${t.status}]: ${t.statement.slice(0, 160)}`);
  }
  if (ctx.limitations.length > 0) {
    lines.push("LIMITATIONS (data-availability conditions; NOT evidence against any claim; do not convert them into negative findings):");
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
