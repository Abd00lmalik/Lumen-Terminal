/**
 * Flow 5 — HAS THIS HAPPENED BEFORE? (historical comparison).
 *
 * Architectural basis: research-flows.md FLOW 5 + M6 audit law ("Do not fake, stub as
 * successful, or substitute Gemini background knowledge or current-data capabilities for
 * historical research").
 * - Historical comparison is defined by its OBJECT: past analogous episodes. Only the
 *   HISTORICAL_COMPARISON capability can satisfy it — that is the flow's analytical
 *   definition, not Flow→Tool hardcoding (the capability resolves through the registry;
 *   today it resolves to the G1 stub, which throws NotConnectedError).
 * - Until a G1 vendor is selected (final lock §4), this flow therefore ends in HONEST
 *   UNAVAILABLE: it never fabricates historical data, never passes current-data readings
 *   off as historical precedent, and never substitutes model background knowledge.
 * - The flow shares the M3/M4 adaptive machinery via runFlow (mode HISTORICAL) so that
 *   connecting a real G1 provider later requires no re-architecture.
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { runFlow, type FlowObjective, type FlowOutcome, type FlowMode } from "./flow-runner.js";
import { analyzeEpisodes, renderEpisodeAnalysis } from "./episode-analysis.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

/** HISTORICAL mode is Flow 5's analytical mode (added to the shared FlowMode vocabulary). */
export type HistoricalFlowMode = Extract<FlowMode, "HISTORICAL">;

export const FLOW5_OBJECTIVE: FlowObjective = {
  flow: "HAS_THIS_HAPPENED_BEFORE",
  mode: "HISTORICAL",
  schedulerGuidance: [
    "HISTORICAL MODE (Flow 5 — HAS THIS HAPPENED BEFORE?): the objective is genuine historical comparison.",
    "- Only the HISTORICAL_COMPARISON capability can produce historical-episode evidence. Plan ONLY tasks whose capabilities include HISTORICAL_COMPARISON.",
    "- NEVER plan current-data capabilities (NEWS_ANALYSIS, TECHNICAL_ANALYSIS, SENTIMENT_ANALYSIS, MARKET_DATA_ANALYSIS, MACRO_ANALYSIS, ONCHAIN_ANALYSIS) for this flow: a current reading is not a historical precedent, and dressing one up as comparison is fabrication.",
    "- Model background knowledge is NOT historical evidence. If the historical capability is unavailable, the correct outcome is UNAVAILABLE/INSUFFICIENT_EVIDENCE — never a substitute answer.",
    "- PRIORITY: analogous episodes with defined outcome windows, similarity basis, and divergence conditions once historical data is available.",
  ].join("\n"),
};

/** Deterministic plan filter: a historical flow may only execute historical capabilities. */
function isHistoricalTask(capabilities: readonly string[]): boolean {
  return capabilities.includes("HISTORICAL_COMPARISON");
}

export interface Flow5Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** Asset target resolved by the LUI (never invented here). */
  readonly asset?: string;
  /**
   * Historical query envelope override (tests / advanced use). Default: daily OHLCV for the
   * resolved asset over a 3-year lookback ending today — a research-engine decision, never
   * model-decided and never client-supplied.
   */
  readonly historicalWindow?: { from: string; to: string; interval?: string };
  readonly constraints?: readonly string[];
  readonly maxRounds?: number;
  readonly now?: () => Date;
}

export interface Flow5Result {
  readonly outcome: FlowOutcome;
  /** Typed model failure — planning/decision failures never become historical findings. */
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

/**
 * Historical query envelope for the HISTORICAL_COMPARISON capability call: the resolved asset
 * (normalized to venue pair format) + deterministic 3-year daily lookback unless overridden.
 * The engine owns invocation params (capability-first); the model proposes only capabilities.
 */
function historicalQueryEnvelope(
  asset: string | undefined,
  window: Flow5Options["historicalWindow"],
  at: Date,
): Record<string, unknown> {
  const base = (asset ?? "BTC/USDT").toUpperCase();
  const symbol = base.includes("/") || base.includes("USDT") || base.includes("USD") ? base : `${base}/USDT`;
  const to = window?.to ?? at.toISOString();
  const from = window?.from ?? new Date(at.getTime() - 3 * 365 * 86_400_000).toISOString();
  return {
    symbol,
    metric: "ohlcv",
    from,
    to,
    ...(window?.interval !== undefined ? { interval: window.interval } : { interval: "1d" }),
  };
}
function enforceHistoricalScope(
  outcome: FlowOutcome,
): { outcome: FlowOutcome; excludedCapabilities: readonly string[] } {
  const inScopeExecutions = outcome.executions.filter((e) => isHistoricalTask([e.capability]));
  const excluded = [
    ...new Set(outcome.executions.filter((e) => !isHistoricalTask([e.capability])).map((e) => e.capability)),
  ];
  const evidence = outcome.evidence.filter((e) =>
    inScopeExecutions.some((exec) => exec.evidenceIds.includes(e.id)),
  );
  const rounds = outcome.rounds.map((r) => ({
    ...r,
    executions: r.executions.filter((e) => isHistoricalTask([e.capability])),
  }));
  return {
    outcome: { ...outcome, executions: inScopeExecutions, evidence, rounds },
    excludedCapabilities: excluded,
  };
}

function buildFlow5Response(
  outcome: FlowOutcome,
  excludedCapabilities: readonly string[],
  analysis?: ReturnType<typeof analyzeEpisodes>,
): string {
  const historicalEvidence = outcome.evidence;
  const lines: string[] = [];
  if (historicalEvidence.length > 0) {
    // G1 connected: render the deterministic episode analysis (computed once, shared with the
    // judgment): CURRENT SETUP → HISTORICAL ANALOGUES → WHAT THIS DOES NOT ESTABLISH.
    // Evidence-ref mapping anchors each episode to the monthly chunk that covers its window.
    const episodeAnalysis = analysis ?? analyzeRetrievedRecord(historicalEvidence)!;
    lines.push(`**Historical record:** ${historicalEvidence.length} monthly historical block(s) retrieved for the analogy question.`);
    const coverage = historicalCoverageSummary(historicalEvidence);
    if (coverage !== undefined) lines.push(`**Coverage:** ${coverage}`);
    lines.push("");
    lines.push(...renderEpisodeAnalysis(episodeAnalysis));
  } else {
    lines.push("**Answer:** Historical comparison is currently UNAVAILABLE.");
    lines.push(
      "**Why:** the G1 historical-data vendor has not been connected (final lock §4), so no genuine historical episodes can be retrieved. This flow does not substitute current market data or model background knowledge for historical evidence.",
    );
    if (excludedCapabilities.length > 0) {
      lines.push(`**Scope guard:** planned out-of-scope capabilities were not executed for a historical question (${excludedCapabilities.join(", ")}).`);
    }
    lines.push("**What would change this:** connecting an approved G1 historical-data provider enables real precedent research.");
  }
  const limitationNote = outcome.context.limitations.slice(0, 3);
  if (limitationNote.length > 0) {
    lines.push(`**Limitations:** ${limitationNote.join("; ")}`);
  }
  lines.push(`**Traceability:** research ${outcome.researchId}; deeper levels available on request.`);
  return lines.join("\n");
}

/** Candle count of a monthly chunk observation (for evidence-ref positional mapping). */
function chunkBoundsOf(observation: string): { count: number } {
  try {
    const parsed = JSON.parse(observation) as { candleCount?: unknown };
    if (typeof parsed.candleCount === "number") return { count: parsed.candleCount };
  } catch {
    // malformed chunk — treated as zero-width by the analysis module anyway
  }
  return { count: 0 };
}

/**
 * Deterministic coverage summary of the retrieved historical record: window span, candle
 * count, and period extremes (min low / max high with their exact dates). Extremes are
 * arithmetic over retrieved observations — no interpretation, no fabrication.
 */
function historicalCoverageSummary(evidence: readonly { observation: string }[]): string | undefined {
  interface Candle {
    openTime: string;
    close: number;
    low: number;
    high: number;
  }
  let minLow: { date: string; value: number } | undefined;
  let maxHigh: { date: string; value: number } | undefined;
  let candleCount = 0;
  let firstOpen: string | undefined;
  let lastClose: string | undefined;
  for (const item of evidence) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.observation);
    } catch {
      continue;
    }
    // Monthly-chunk packaging: { month, candleCount, candles: [...] }
    const candles = (parsed as { candles?: unknown }).candles;
    if (!Array.isArray(candles)) continue;
    for (const raw of candles) {
      const c = raw as Partial<Candle>;
      if (typeof c.openTime !== "string" || typeof c.close !== "number") continue;
      candleCount += 1;
      if (firstOpen === undefined || c.openTime < firstOpen) firstOpen = c.openTime;
      if (lastClose === undefined || c.openTime > (lastClose ?? "")) lastClose = c.openTime;
      if (typeof c.low === "number" && (minLow === undefined || c.low < minLow.value)) {
        minLow = { date: c.openTime.slice(0, 10), value: c.low };
      }
      if (typeof c.high === "number" && (maxHigh === undefined || c.high > maxHigh.value)) {
        maxHigh = { date: c.openTime.slice(0, 10), value: c.high };
      }
    }
  }
  if (candleCount === 0) return undefined;
  const parts = [
    `${candleCount} daily candles retrieved (${firstOpen?.slice(0, 10)} → ${lastClose?.slice(0, 10)})`,
    ...(minLow !== undefined ? [`lowest low ${minLow.value.toLocaleString("en-US")} on ${minLow.date}`] : []),
    ...(maxHigh !== undefined ? [`highest high ${maxHigh.value.toLocaleString("en-US")} on ${maxHigh.date}`] : []),
  ];
  return parts.join("; ");
}

/**
 * Flow 5: historical-analogy question → constrained plan → HISTORICAL_COMPARISON capability
 * (G1 stub today: NotConnectedError) → honest UNAVAILABLE outcome. Never fabricates history.
 */
export async function runFlow5(objective: string, options: Flow5Options): Promise<Flow5Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 5 orchestration" };
  const workspace = options.workspace;

  const research = workspace.addResearch(
    { objective, question: objective, flow: "HAS_THIS_HAPPENED_BEFORE" },
    { kind: "trader", detail: "Flow 5 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const outcome = await runFlow(objective, FLOW5_OBJECTIVE, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: historicalQueryEnvelope(options.asset, options.historicalWindow, at()),
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  }).catch((error: unknown) => ({ modelFailure: error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false) }));

  if ("modelFailure" in outcome && outcome.modelFailure !== undefined && !("plan" in outcome)) {
    return {
      outcome: {
        researchId: research.id, flow: "HAS_THIS_HAPPENED_BEFORE", mode: "HISTORICAL",
        plan: { objective, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: [], adaptationPolicy: "n/a — planning failed" },
        rounds: [], executions: [], hypotheses: [], evidence: [],
        finalDecision: { decision: "INSUFFICIENT_EVIDENCE", rationale: `research could not start: ${outcome.modelFailure.message}`, nextTasks: [] },
        stoppedBecause: "MODEL_FAILURE",
        ...(outcome.modelFailure !== undefined ? { modelFailure: outcome.modelFailure } : {}),
        context: (await import("./context.js")).buildResearchContext(workspace, { researchRef: research.id }),
      },
      ...(outcome.modelFailure !== undefined ? { modelFailure: outcome.modelFailure } : {}),
      response: [
        `**Answer:** The historical-comparison request could not be processed: ${outcome.modelFailure.message}`,
        "**Why this is not a finding:** model/provider failure is a system condition, not evidence about historical precedent. Nothing was fabricated.",
      ].join("\n"),
    };
  }

  // Deterministic scope guard: a historical question is answered only by historical evidence.
  const { outcome: scoped, excludedCapabilities } = enforceHistoricalScope(outcome as FlowOutcome);

  // Deliberate analytical step (object model §8): every flow records a Judgment over its
  // findings. Flow 5's judgment is DETERMINISTIC — coverage/similarity computed from the
  // retrieved record, never model sentiment, and it never reads as prediction.
  const analysis = analyzeRetrievedRecord(scoped.evidence);
  const judgmentInput = {
    researchRef: research.id,
    statement:
        analysis === undefined
          ? `HISTORICAL ANALOGY UNAVAILABLE for "${objective.slice(0, 120)}": no historical evidence could be retrieved (G1 unavailable), so no precedent can be established. This is a data availability condition, not a market finding.`
          : `HISTORICAL ANALOGY for "${objective.slice(0, 120)}": ${analysis.matches.length} comparable historical episode(s) identified across ${scoped.evidence.length} retrieved monthly block(s). ${analysis.interpretiveNote} Historical precedent is evidence of what happened before — it does not establish recurrence and does not predict.`,
      basis: {
        supportingEvidence: scoped.evidence.map((e) => e.id),
        opposingEvidence: [],
        keyClaims: [],
        hypotheses: scoped.hypotheses.map((h) => h.id),
      },
      ...(analysis !== undefined && analysis.matches.length > 0 ? { confidence: "MODERATE" as const } : { confidence: "LOW" as const }),
      uncertainty: [
        "similarity is computed from the retrieved price/volume record only — no fundamental context",
        "historical precedent does not establish that a similar outcome follows",
        ...(scoped.stoppedBecause !== "EVIDENCE_SUFFICIENT" ? [`research ended early (${scoped.stoppedBecause})`] : []),
      ],
      unresolvedQuestions:
        analysis !== undefined && analysis.matches.length === 0
          ? ["no comparable episodes met the similarity threshold — is the current setup genuinely novel, or is the feature comparison too narrow?"]
          : [],
      implications: ["historical precedent informs context; it does not recommend", "no trading action follows from this research"],
  };
  workspace.addJudgment(judgmentInput, systemOrigin, at());

  return {
    outcome: scoped,
    response: buildFlow5Response(scoped, excludedCapabilities, analysis),
  };
}

/** Analyze the retrieved historical record (shared by the response builder and the judgment). */
function analyzeRetrievedRecord(historicalEvidence: FlowOutcome["evidence"]): ReturnType<typeof analyzeEpisodes> | undefined {
  if (historicalEvidence.length === 0) return undefined;
  const observations = historicalEvidence.map((e) => e.observation);
  const chunkBounds = historicalEvidence.map((e) => chunkBoundsOf(e.observation));
  return analyzeEpisodes(observations, (anchorIndex) => {
    // anchorIndex is positional over the ascending candle series; find the chunk whose
    // candle range contains it. Chunks are emitted in ascending order by the adapter.
    let cursor = 0;
    for (let chunkIdx = 0; chunkIdx < chunkBounds.length; chunkIdx++) {
      const bounds = chunkBounds[chunkIdx];
      if (bounds === undefined) continue;
      const next = cursor + bounds.count;
      if (anchorIndex >= cursor && anchorIndex < next) return historicalEvidence[chunkIdx]?.id;
      cursor = next;
    }
    return undefined;
  });
}
