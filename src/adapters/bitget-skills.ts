/**
 * The five confirmed Bitget skills (FINDINGS.md §1–§2) as registry registrations.
 *
 * All descriptors encode CONFIRMED facts from FINDINGS.md §2 per-skill matrices:
 * capabilities, documented limitations, freshness profiles, and classification rules.
 * Skills are registered through the generic CapabilityRegistry; no Flow→Tool hardcoding
 * (final lock §6/§11). G1/G2 remain vendor-neutral stubs (final lock §12).
 */

import { CapabilityRegistry, HistoricalDataStub, WebRetrievalStub, type CapabilityCall, type ProviderAdapter } from "./capability-registry.js";
import { G1HistoricalDataAdapter, BINANCE_VISION_BASE_URL } from "./g1-historical.js";
import { G2WebRetrievalAdapter } from "./g2-web-retrieval.js";
import { NewsFallbackAdapter, SentimentFallbackAdapter, MacroFallbackAdapter } from "./fallback-providers.js";
import { BitgetSkillAdapter, type SkillDescriptor, type OutputMapping } from "./bitget-skill-adapter.js";
import { registerEquityAdapters } from "./equity.js";
import { MarketRegimeAdapter } from "./market-regime.js";
import { SecEdgarAdapter } from "./sec-edgar.js";
import { PublicDerivativesAdapter } from "./public-derivatives.js";
import { CoinGeckoMarketDataAdapter } from "./coingecko.js";
import { LocalKnowledgeAdapter } from "./local-knowledge.js";
import { McpTransport } from "./transports/mcp.js";
import { RestTransport, type Candle } from "./transports/rest.js";
import { TransportError } from "./transports/resilience.js";
import { FRESHNESS_PROFILES, assessFreshness, type FreshnessProfile } from "./freshness.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { intervalTokenFor, isResolution } from "../research/resolution.js";

/**
 * RESOLUTION -> the Bitget candle interval vocabulary (1min..1w; the venue has no native
 * month bar). The engine asks for a granularity, never a hardcoded "1h": a 24-hour path wants
 * hourly bars and a multi-year pull wants daily ones.
 */
function intervalForRequest(requiredResolution: unknown): string {
  if (isResolution(requiredResolution)) {
    const token = intervalTokenFor(requiredResolution);
    return token === "1M" ? "1w" : token;
  }
  return "1h";
}

// ---------------------------------------------------------------------------
// Descriptors; every field sourced from FINDINGS.md §2 (CONFIRMED)
// ---------------------------------------------------------------------------

export const MACRO_ANALYST: SkillDescriptor = {
  providerId: "bitget-signal/macro-analyst",
  capabilities: ["MACRO_ANALYSIS"],
  limitations: [
    "economic data has 1-2 day release lag; prices stale on weekends (FINDINGS.md §2.1)",
    "yield-curve inversion is a 12-24 month leading indicator, not a timing signal (FINDINGS.md §2.1)",
    "skill verdicts (RISK-ON/MIXED/RISK-OFF) are analysis, not raw fact (final lock §3)",
  ],
  freshnessProfile: "macro",
  dataClasses: ["Fed/FOMC context", "CPI/PCE/employment", "rates/yields", "yield curve", "DXY/VIX", "cross-asset correlations", "major equity/gold/oil"],
};

export const MARKET_INTEL: SkillDescriptor = {
  providerId: "bitget-signal/market-intel",
  capabilities: ["MARKET_DATA_ANALYSIS", "CRYPTO_MARKET_DATA"],
  limitations: [
    "NOT true on-chain intelligence (final lock §3): whale tracking, exchange reserves, token unlocks, ETF flow figures, and on-chain cycle indicators are NOT available",
    "ETF-flow figures are news-search PROXIES; whale/positioning are derivatives-positioning PROXIES (FINDINGS.md §2.2)",
    "cycle indicators approximated via dominance/stablecoin proxies (FINDINGS.md §2.2)",
    "outputs derived from these proxies must remain labeled PROXY_EVIDENCE with proxyBasis",
  ],
  freshnessProfile: "marketStructure",
  dataClasses: ["DeFi TVL", "chain TVL", "stablecoin supply", "DeFi yields/fees", "DEX activity", "rankings/trending", "gas/fees"],
};

export const SENTIMENT_ANALYST: SkillDescriptor = {
  providerId: "bitget-signal/sentiment-analyst",
  capabilities: ["SENTIMENT_ANALYSIS"],
  limitations: [
    "on-chain exchange flows not available on this server (FINDINGS.md §2.3)",
    "altcoins need futures symbol format (BTCUSDT-style, no slash) (FINDINGS.md §2.3)",
    "F&G bands / L-S thresholds interpretation is skill-authored, not observation (final lock §3)",
  ],
  freshnessProfile: "community",
  dataClasses: ["Fear & Greed", "retail long/short", "top-trader long/short", "open interest", "taker buy/sell", "Reddit trending"],
};

export const NEWS_BRIEFING: SkillDescriptor = {
  providerId: "bitget-signal/news-briefing",
  capabilities: ["NEWS_ANALYSIS"],
  limitations: [
    "RSS updates every 15-60 min; not real-time (FINDINGS.md §2.5); intra-hour event timing must come from technical-analysis klines (final lock §9)",
    "RSS aggregation is NOT unrestricted web retrieval (final lock §3); secondary reports are not primary sources",
    "failed feeds are skipped per-feed; completeness may be PARTIAL",
    "narrative synthesis is skill-authored, not observation (final lock §3)",
  ],
  freshnessProfile: "rss",
  dataClasses: ["news aggregation", "narrative synthesis", "event timelines", "keyword search over 44 RSS/Atom feeds", "social trending"],
};

export const TECHNICAL_ANALYSIS: SkillDescriptor = {
  providerId: "bitget-signal/technical-analysis",
  capabilities: ["TECHNICAL_ANALYSIS"],
  limitations: [
    "indicator output is computed locally over public klines; parameters must be preserved (FINDINGS.md §2.4)",
    "indicator series are recent-window only (default 200 klines); no deep history (FINDINGS.md §2.4)",
    "indicators must not become automatic trading recommendations (final lock §3)",
    "conflicting indicators are presented objectively (FINDINGS.md §2.4)",
  ],
  freshnessProfile: "technical",
  dataClasses: ["OHLCV", "23 indicators across trend/volatility/oscillator/volume/momentum/S-R", "pre/post-event price structure"],
};

/** Bitget v2 candles endpoints (FINDINGS.md §2.4, CONFIRMED). */
export const TECHNICAL_REST_PATHS = {
  spot: "/api/v2/spot/market/candles",
  futures: "/api/v2/mix/market/candles",
} as const;

// ---------------------------------------------------------------------------
// Output mappings; lock §3/§7 classification per skill (FINDINGS.md §2)
// ---------------------------------------------------------------------------

const MACRO_MAPPING: OutputMapping = {
  narrativeClass: "ANALYST_INTERPRETATION",
  dataClass: "QUANTITATIVE_OBSERVATION",
};

const MARKET_INTEL_MAPPING: OutputMapping = {
  narrativeClass: "INFERENCE",
  dataClass: "QUANTITATIVE_OBSERVATION",
  // market-intel's structural numbers are proxy-derived where they stand in for whale/reserve/
  // unlock/ETF/cycle data; the label travels with every output (final lock §3).
  proxyBasis:
    "market-intel structural proxy: derived from TVL/stablecoin/dominance/derivatives-positioning data, NOT direct on-chain or ETF-flow observation (final lock §3, FINDINGS.md §2.2)",
};

const SENTIMENT_MAPPING: OutputMapping = {
  narrativeClass: "ANALYST_INTERPRETATION",
  dataClass: "SENTIMENT_SIGNAL",
};

const NEWS_MAPPING: OutputMapping = {
  narrativeClass: "ANALYST_INTERPRETATION",
  dataClass: "FACTUAL_OBSERVATION",
};

/**
 * Keyless research-surface adapter: the capabilities the retired paid agent tier used to be
 * the ONLY provider for, now served by the official public MCP data surface.
 *
 * 2026-10-05: removing Heurist left ONCHAIN_ANALYSIS, DEFI_ANALYSIS and PROJECT_RESEARCH
 * with ZERO registered providers — the planner could still name them, which is exactly the
 * dead-end the zero-dead-end conformance test exists to prevent. Each is served by a public,
 * keyless MCP tool VERIFIED LIVE on market-data-mcp v1.26.0:
 *   - ONCHAIN_ANALYSIS -> `network_status`   (ETH gas, BTC recommended fees, mempool, blocks)
 *   - DEFI_ANALYSIS    -> `defi_analytics`  (DeFiLlama TVL/protocol/chain/fees/yields)
 *   - PROJECT_RESEARCH -> `crypto_market`   (CoinGecko search/price/markets/trending)
 *
 * EPISTEMIC HONESTY (this is the important part): `network_status` is public chain
 * telemetry, NOT the whale-tracking/exchange-reserve/token-unlock intelligence the on-chain
 * capability is usually imagined to mean. The limitation travels with every output, and the
 * outputs stay observation-class — a gas price is an observation, a "whale accumulation
 thesis" is not something this surface can support at all.
 */
export const KEYLESS_RESEARCH_SURFACE: SkillDescriptor = {
  providerId: "bitget/keyless-research-surface",
  capabilities: ["ONCHAIN_ANALYSIS", "DEFI_ANALYSIS", "PROJECT_RESEARCH"],
  limitations: [
    "ONCHAIN_ANALYSIS here means public chain telemetry (gas, fees, mempool, recent blocks) only — NOT whale tracking, exchange reserves, token unlocks or ETF flows, none of which this surface observes",
    "DEFI_ANALYSIS is DeFiLlama aggregates (TVL/fees/yields), not protocol-level internals or positions",
    "PROJECT_RESEARCH is public market/project metadata (price, market cap, rankings, trending), not due-diligence or team/contract analysis",
    "a provider outage returns an honest EMPTY with the attempt trail, never an inferred figure",
  ],
  freshnessProfile: "marketStructure",
  dataClasses: ["chain gas/fees/mempool", "DeFi TVL/fees/yields", "project market metadata"],
};

const KEYLESS_RESEARCH_MAPPING: OutputMapping = {
  narrativeClass: "INFERENCE",
  dataClass: "QUANTITATIVE_OBSERVATION",
};

/** Default tool/action per capability — every value a VERIFIED public enum member. */
const KEYLESS_RESEARCH_TOOLS: Readonly<Record<string, { toolName: string; action: string }>> = {
  ONCHAIN_ANALYSIS: { toolName: "network_status", action: "eth_gas" },
  DEFI_ANALYSIS: { toolName: "defi_analytics", action: "tvl_rank" },
  PROJECT_RESEARCH: { toolName: "crypto_market", action: "trending" },
};

/** Adapters that close the three dead ends the paid agent tier used to cover. */
export function createKeylessResearchSurfaceAdapters(transport: McpTransport): BitgetSkillAdapter[] {
  return Object.entries(KEYLESS_RESEARCH_TOOLS).map(([capability, { toolName, action }]) =>
    new BitgetSkillAdapter({
      descriptor: { ...KEYLESS_RESEARCH_SURFACE, providerId: `bitget/keyless-research-surface`, capabilities: [capability] },
      transport,
      toolFor: (requested) =>
        requested === capability
          ? {
              toolName,
              buildArgs: (params) => {
                const p = params as Record<string, unknown>;
                // The engine plans CAPABILITIES, not tool args; an unset action must still
                // produce a valid request, so each capability carries a sane verified default.
                const extra = actionArgs(["action", "protocol", "chain", "limit", "query", "page", "per_page"])(params);
                return { ...extra, action: (p.action as string | undefined) ?? action };
              },
            }
          : undefined,
      outputMapping: KEYLESS_RESEARCH_MAPPING,
    }),
  );
}

// ---------------------------------------------------------------------------
// Concrete MCP-backed adapters (tool names CONFIRMED in FINDINGS.md §2/§6)
// ---------------------------------------------------------------------------

/** Shared: a passthrough that strips unknown keys the tools would reject. */
const actionArgs = (allowed: readonly string[]) => (params: Record<string, unknown>): Record<string, unknown> => {
  const p = params as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (p[key] !== undefined) out[key] = p[key];
  }
  out["action"] = p["action"];
  return out;
};

// ---------------------------------------------------------------------------
// Concrete MCP-backed adapters; args/envelopes DISCOVERED live 2026-09-13:
// every tool requires an `action` enum (M1's empty-args assumption returned
// `{"error":"Unknown action:"}`), and responses are per-record JSON objects/arrays carrying
// `{"<key>": {"error": ""}}` envelopes where "" means OK and non-empty means that record's
// upstream fetch failed (preserved as UNAVAILABLE, never fabricated over; lock §18).
// ---------------------------------------------------------------------------

export function createMacroAnalystAdapter(transport: McpTransport): BitgetSkillAdapter {
  return new BitgetSkillAdapter({
    descriptor: MACRO_ANALYST,
    transport,
    toolFor: (capability) =>
      capability === "MACRO_ANALYSIS"
        ? {
            toolName: "macro_indicators",
            // actions: latest_release | history | fomc_news | multi_indicator | series_list
            buildArgs: actionArgs(["action", "indicator", "years"]),
          }
        : undefined,
    outputMapping: MACRO_MAPPING,
  });
}

export function createMarketIntelAdapter(transport: McpTransport): BitgetSkillAdapter {
  return new BitgetSkillAdapter({
    descriptor: MARKET_INTEL,
    transport,
    toolFor: (capability) =>
      capability === "MARKET_DATA_ANALYSIS" || capability === "CRYPTO_MARKET_DATA"          ? {
            toolName: "crypto_market",
            // actions: search | price | ohlcv | markets | trending | global.
            // Default action: the engine plans capabilities, not tool args (orchestration
            // capability-first); an unset action must still produce a VALID request, so fall
            // back to the broad market snapshot (global: market cap, BTC dominance, volumes).
            //
            // SHAPE-AWARE DEFAULT (research-integrity contract): when the run's own requirement
            // demands a time series, a high/low, a windowed volume or an OHLCV record, the
            // default becomes the `ohlcv` action — the SAME tool, already available here, whose
            // candles carry exactly those fields. Without this the tool answered every shape
            // request with a broad snapshot, which is why "the price path over the last 24
            // hours" produced one instant. An explicit action in the params always wins, and a
            // request that wants only a spot reading keeps the snapshot default.
            buildArgs: (params) => {
              const p = params as Record<string, unknown>;
              const demanded = Array.isArray(p.requiredFacets) ? (p.requiredFacets as string[]) : [];
              const wantsSeries = demanded.some((f) =>
                f === "SERIES" || f === "OHLC" || f === "HIGH" || f === "LOW" || f === "OPEN" || f === "CLOSE" || f === "VOLUME",
              );
              return {
                ...actionArgs(["action", "query", "coin_id", "coin_ids", "symbol", "interval", "limit"])(params),
                action: (p.action as string | undefined) ?? (wantsSeries ? "ohlcv" : "global"),
                // The bar size follows the requirement's granularity (or the horizon it implies),
                // never a fixed default.
                ...(wantsSeries && p.interval === undefined ? { interval: intervalForRequest(p.requiredResolution) } : {}),
              };
            },
          }
        : undefined,
    outputMapping: MARKET_INTEL_MAPPING,
  });
}

export function createSentimentAnalystAdapter(transport: McpTransport): BitgetSkillAdapter {
  return new BitgetSkillAdapter({
    descriptor: SENTIMENT_ANALYST,
    transport,
    toolFor: (capability) =>
      capability === "SENTIMENT_ANALYSIS"          ? {
            toolName: "derivatives_sentiment",
            // actions: reddit_trending | long_short | top_ls | top_position | open_interest |
            // taker_ratio. No funding-rate action exists (live-verified); funding context
            // must come from other capabilities when needed. Default: BTC long/short ratio,
            // the canonical positioning-sentiment signal (params remain overridable).
            buildArgs: (params) => ({
              ...actionArgs(["action", "symbol", "period", "filter", "limit"])(params),
              action: (params as { action?: string }).action ?? "long_short",
              symbol: (params as { symbol?: string }).symbol ?? "BTCUSDT",
            }),
          }
        : undefined,
    outputMapping: SENTIMENT_MAPPING,
  });
}

export function createNewsBriefingAdapter(transport: McpTransport): BitgetSkillAdapter {
  return new BitgetSkillAdapter({
    descriptor: NEWS_BRIEFING,
    transport,
    toolFor: (capability) =>
      capability === "NEWS_ANALYSIS"
        ? {
            toolName: "news_feed",
            // DISCOVERED (live 2026-09-13): args are { action: "latest"|"sources", keyword?,
            // feeds?, limit? 1-10 (default 5) }; FINDINGS.md's `limit 1-50` was wrong, and
            // M1's `{keywords}` array arg was silently ignored (0 items). `keyword` is a
            // case-insensitive title+summary filter.
            buildArgs: (params) => {
              const p = params as { keyword?: string; feeds?: string; limit?: number; action?: string };
              return {
                action: p.action ?? "latest",
                ...(p.keyword !== undefined ? { keyword: p.keyword } : {}),
                ...(p.feeds !== undefined ? { feeds: p.feeds } : {}),
                ...(p.limit !== undefined ? { limit: Math.min(10, Math.max(1, p.limit)) } : {}),
              };
            },
          }
        : undefined,
    outputMapping: NEWS_MAPPING,
    // DISCOVERED: news_feed returns one text block containing a JSON ARRAY of
    // { feed, error, items[] }; flatten into item-level outputs (the useful evidence unit),
    // with feed-level errors preserved as UNAVAILABLE outputs (never silently dropped, and
    // they drive PARTIAL completeness per failure-recovery.md §10).
    extractSourceTimestamp: (content) => {
      const first = content[0] as { text?: string } | undefined;
      if (first?.text === undefined) return undefined;
      try {
        const parsed = JSON.parse(first.text) as unknown;
        const feeds = Array.isArray(parsed) ? parsed : [parsed];
        for (const feed of feeds) {
          const items = (feed as { items?: Array<{ published?: string }> }).items ?? [];
          const published = items.map((i) => i.published).find((p): p is string => typeof p === "string" && p.length > 0);
          if (published !== undefined) {
            const t = Date.parse(published);
            if (!Number.isNaN(t)) return new Date(t).toISOString();
          }
        }
      } catch { /* narrative block without a JSON payload; no event time */ }
      return undefined;
    },
    flattenOutput: (output) => {
      const content = output.content;
      if (typeof content !== "object" || content === null) return [output];
      const feeds = Array.isArray(content) ? content : [content];
      const isFeedRecord = (f: unknown): f is { feed: string; error?: string; items?: ReadonlyArray<Record<string, unknown>> } =>
        typeof f === "object" && f !== null && "feed" in (f as Record<string, unknown>);
      if (!feeds.every(isFeedRecord)) return [output];
      const items: ToolOutput[] = [];
      for (const feed of feeds) {
        if (typeof feed.error === "string" && feed.error.length > 0) {
          items.push({ outputClass: "UNAVAILABLE", content: `feed ${feed.feed} reported error: ${feed.error}` });
          continue;
        }
        for (const item of feed.items ?? []) {
          items.push({
            outputClass: NEWS_MAPPING.dataClass,
            content: item,
            about: feed.feed,
          });
        }
      }
      return items;
    },
  });
}

// ---------------------------------------------------------------------------
// technical-analysis; MCP tool primary (DISCOVERED live 2026-09-13: the market-data MCP
// server exposes a WORKING `technical_analysis` tool; direct api.bitget.com REST was
// unreachable from the dev environment), with REST klines as a registry fallback.
// ---------------------------------------------------------------------------

export interface TechnicalQuery {
  /** Analysis actions on the MCP tool: rsi|macd|bollinger|ma|ema|atr|support_resistance|full_analysis|batch_analysis. */
  readonly action?: string;
  /** Symbol: "BTC/USDT" (slash, live-verified) for the MCP tool; "BTCUSDT" for REST. */
  readonly symbol?: string;
  readonly marketType?: "spot" | "futures";
  /** 1min|5min|15min|30min|1h|4h|1d|1w (FINDINGS.md §2.4). */
  readonly interval?: string;
  readonly timeframe?: string;
  /** Kline count (REST; default 200). */
  readonly limit?: string;
  readonly endTime?: string;
  readonly period?: number;
}

/**
 * DISCOVERED (live 2026-09-13): the MCP `technical_analysis` response mixes exact numeric
 * indicator values with skill-authored interpretive fields; `verdict` ("STRONG BEARISH"),
 * `signal` ("neutral"), `trend` ("bear"), `bull_signals`/`bear_signals`, and `suggested_stop`
 * (a trade recommendation). Lock §3: indicators must never become automatic trading
 * recommendations, and a skill verdict is analysis, not observation.
 * The split is leaf-level and TYPE-AWARE (live-discovered ambiguity): `signal: "neutral"` is a
 * judgment, but `signal: -44.24` inside the macd record is the MACD signal LINE; a measurement.
 */
/** Judgment fields when they carry text (verdicts/threshold labels). */
const TA_TEXT_JUDGMENT_FIELDS = new Set(["verdict", "signal", "trend", "position", "cross"]);
/** Always-judgment fields, even numeric: tallies and the trade recommendation. */
const TA_ALWAYS_JUDGMENT_FIELDS = new Set(["suggested_stop", "bull_signals", "bear_signals"]);

function isTaJudgmentEntry(key: string, value: unknown): boolean {
  if (TA_ALWAYS_JUDGMENT_FIELDS.has(key)) return true;
  if (TA_TEXT_JUDGMENT_FIELDS.has(key)) return typeof value === "string";
  return false;
}

/** Recursively partitions a technical_analysis record into measurement and judgment parts. */
function splitTaRecord(record: Record<string, unknown>): { obs: Record<string, unknown>; interp: Record<string, unknown> } {
  const obs: Record<string, unknown> = {};
  const interp: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isTaJudgmentEntry(key, value)) {
      interp[key] = value;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const inner = splitTaRecord(value as Record<string, unknown>);
      if (Object.keys(inner.obs).length > 0) obs[key] = inner.obs;
      if (Object.keys(inner.interp).length > 0) interp[key] = inner.interp;
    } else {
      obs[key] = value;
    }
  }
  return { obs, interp };
}

/** Splits one technical_analysis JSON object output into observation + interpretation outputs. */
function splitTaOutput(symbol?: string, timeframe?: string) {
  return (output: ToolOutput): readonly ToolOutput[] => {
    const content = output.content;
    if (typeof content !== "object" || content === null || Array.isArray(content)) return [output];
    const record = content as Record<string, unknown>;
    const meta = { ...(symbol !== undefined ? { about: symbol } : {}), ...(timeframe !== undefined ? { timeframe } : {}) };
    const { obs, interp } = splitTaRecord(record);
    const outputs: ToolOutput[] = [];
    if (Object.keys(obs).length > 0) {
      outputs.push({
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: obs,
        ...meta,
      });
    }
    if (Object.keys(interp).length > 0) {
      outputs.push({
        outputClass: "ANALYST_INTERPRETATION",
        content: interp,
        ...meta,
        interpretationBasis: `skill-authored technical verdict fields (verdict/signal/trend/cross/position/suggested_stop tallies) from the technical_analysis tool; analysis, not measurement (final lock §3)`,
      });
    }
    return outputs.length > 0 ? outputs : [output];
  };
}

/** Bitget v2 candles payload shape: { code, data: Candle[] } (order per official docs). */
function parseCandles(body: unknown, path: string): readonly Candle[] {
  const obj = body as { code?: string | number; data?: unknown };
  if (obj.code !== undefined && String(obj.code) !== "00000") {
    throw new TransportError("SCHEMA_ERROR", `Bitget REST ${path} returned code ${String(obj.code)}`, { retriable: false });
  }
  if (!Array.isArray(obj.data)) {
    throw new TransportError("SCHEMA_ERROR", `Bitget REST ${path} payload has no data array`, { retriable: false });
  }
  return obj.data as readonly Candle[];
}

/**
 * REST klines boundary (kept as the technical-analysis FALLBACK transport): raw OHLCV candles
 * are QUANTITATIVE_OBSERVATIONs with exact timestamps (final lock §9).
 */
export class TechnicalKlinesRestAdapter implements ProviderAdapter {
  readonly providerId = TECHNICAL_ANALYSIS.providerId;
  readonly capabilities = TECHNICAL_ANALYSIS.capabilities;
  readonly limitations = TECHNICAL_ANALYSIS.limitations;
  readonly freshnessProfile = FRESHNESS_PROFILES.technical.id;

  constructor(private readonly rest: RestTransport) {}

  async execute(capability: string, params: Record<string, unknown>, call?: CapabilityCall): Promise<ToolResultInput> {
    if (capability !== "TECHNICAL_ANALYSIS") {
      throw new TransportError("SCHEMA_ERROR", `${this.providerId} has no mapping for capability ${capability}`, { retriable: false });
    }
    const query = params as unknown as TechnicalQuery;
    const marketType = query.marketType ?? "spot";
    const path = marketType === "futures" ? TECHNICAL_REST_PATHS.futures : TECHNICAL_REST_PATHS.spot;
    const restParams: Record<string, string> = {
      symbol: (query.symbol ?? "BTCUSDT").replace("/", ""),
      ...(query.interval !== undefined ? { granularity: query.interval } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.endTime !== undefined ? { endTime: query.endTime } : {}),
    };

    const outcome = await this.rest.get(path, {
      params: restParams,
      ...(call?.deadlineMs !== undefined ? { deadlineMs: call.deadlineMs } : {}),
      ...(call?.signal !== undefined ? { signal: call.signal } : {}),
    });
    const candles = parseCandles(outcome.body, path);
    const lastCandle = candles[candles.length - 1];
    const sourceTimestamp = lastCandle !== undefined ? new Date(Number(lastCandle.ts)).toISOString() : undefined;

    const symbol = restParams["symbol"] ?? query.symbol ?? "BTCUSDT";
    const outputs = candles.map((candle) => ({
      outputClass: "QUANTITATIVE_OBSERVATION" as const,
      content: candle,
      about: symbol,
      timeframe: query.interval ?? "default",
    }));
    return {
      tool: this.providerId,
      capability,
      transport: `rest:${marketType}-candles`,
      params: { ...query, marketType },
      rawReference: outcome.rawReference,
      outputs,
      completeness: candles.length > 0 ? "COMPLETE" : "EMPTY",
      validation: "VALID",
      ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
      freshness: assessTechnicalFreshness(sourceTimestamp, query.interval),
      limitations: TECHNICAL_ANALYSIS.limitations,
    };
  }
}

/**
 * `technical-analysis` composite adapter: the MCP `technical_analysis` tool first (live-verified
 * indicator analysis over Binance-sourced klines), REST klines as registry-level fallback when
 * the MCP path fails. Both paths are read-only market data; never trading operations (lock §13).
 */
export class TechnicalAnalysisAdapter implements ProviderAdapter {
  readonly providerId = TECHNICAL_ANALYSIS.providerId;
  readonly capabilities = TECHNICAL_ANALYSIS.capabilities;
  readonly limitations = TECHNICAL_ANALYSIS.limitations;
  readonly freshnessProfile = FRESHNESS_PROFILES.technical.id;

  private readonly mcpAdapter: BitgetSkillAdapter;

  constructor(
    private readonly rest: RestTransport,
    mcp: McpTransport,
  ) {
    this.mcpAdapter = new BitgetSkillAdapter({
      descriptor: TECHNICAL_ANALYSIS,
      transport: mcp,
      toolFor: (capability) =>
        capability === "TECHNICAL_ANALYSIS"
          ? {
              toolName: "technical_analysis",
              // DISCOVERED live: args { action (required enum), symbol "BTC/USDT" (slash),
              // timeframe (default 4h), period }; batch_analysis uses `symbols`.
              buildArgs: (params) => {
                const q = params as TechnicalQuery;
                const symbol = (q.symbol ?? "BTC/USDT").includes("/") ? q.symbol! : q.symbol!.replace(/^(.{2,6})(USDT|USD|BUSD)$/, "$1/$2");
                return {
                  action: q.action ?? "full_analysis",
                  symbol,
                  timeframe: q.timeframe ?? q.interval ?? "1h",
                  ...(q.period !== undefined ? { period: q.period } : {}),
                };
              },
            }
          : undefined,
      outputMapping: { narrativeClass: "ANALYST_INTERPRETATION", dataClass: "QUANTITATIVE_OBSERVATION" },
      flattenOutput: splitTaOutput(
        undefined,
        undefined,
      ),
    });
  }

  async execute(capability: string, params: Record<string, unknown>, call?: CapabilityCall): Promise<ToolResultInput> {
    try {
      return await this.mcpAdapter.execute(capability, params, call);
    } catch (error) {
      // Registry-level fallback: surface the MCP failure, then let the klines path answer.
      // NOTE: the fallback serves the same capability with a different method; the registry
      // cannot see this, so the limitation must travel with the result.
      if (capability !== "TECHNICAL_ANALYSIS") throw error;
      try {
        const klines = await new TechnicalKlinesRestAdapter(this.rest).execute(capability, params, call);
        return {
          ...klines,
          limitations: [
            ...(klines.limitations ?? []),
            `MCP technical_analysis unavailable (${error instanceof Error ? error.message : String(error)}); served by REST klines fallback`,
          ],
        };
      } catch {
        // Both paths failed: the PRIMARY's (MCP) failure is the headline (failover law — a
        // fallback's failure never erases the primary's); its classification travels intact.
        throw error;
      }
    }
  }
}

/**
 * Kline timestamps are exact (FINDINGS.md §2.4); freshness is judged against the interval so a
 * 1d candle is not "stale" 10 minutes after it opened.
 */
function assessTechnicalFreshness(sourceTimestamp: string | undefined, interval?: string): "CURRENT" | "STALE" | "HISTORICAL" {
  const profile: FreshnessProfile = { ...FRESHNESS_PROFILES.technical, staleAfterMs: intervalWindowMs(interval) };
  return assessFreshness(profile, sourceTimestamp);
}

function intervalWindowMs(interval?: string): number {
  switch (interval) {
    case "1min": return 2 * 60 * 1000;
    case "5min": return 10 * 60 * 1000;
    case "15min": return 30 * 60 * 1000;
    case "30min": return 60 * 60 * 1000;
    case "1h": return 2 * 60 * 60 * 1000;
    case "4h": return 8 * 60 * 60 * 1000;
    case "1d": return 48 * 60 * 60 * 1000;
    case "1w": return 14 * 24 * 60 * 60 * 1000;
    default: return FRESHNESS_PROFILES.technical.staleAfterMs;
  }
}

// ---------------------------------------------------------------------------
// Registry factory; the only wiring point; the engine never learns any of this
// ---------------------------------------------------------------------------

export interface BitgetAdapterSetOptions {
  readonly mcp?: McpTransport;
  readonly rest?: RestTransport;
  /**
   * G1 historical-data override. Default: the real G1 adapter (Bitget REST primary →
   * Binance Vision public-mirror fallback; vendor selected 2026-09-15). Tests may inject
   * the NotConnected stub or a fake to exercise honest-unavailability laws.
   */
  readonly historical?: G1HistoricalDataAdapter | HistoricalDataStub;
  /**
   * Lazy accessor for the live Workspace (local-knowledge capability). Lazy because the
   * workspace is created per session AFTER the registry exists; the adapter resolves it
   * per request. Assigned via the returned bindWorkspace binding.
   */
  workspaceAccessor?: () => import("../domain/workspace.js").Workspace | undefined;
  /** G2 web-retrieval override (tests inject fakes; default is the real bounded adapter). */
  readonly webRetrieval?: G2WebRetrievalAdapter | WebRetrievalStub;
  /** Disable capability-level fallback providers (tests assert primary-only laws). */
  readonly fallbacks?: boolean;
}

/** Register the five skills (plus G1/G2 stubs) through the generic registry mechanism. */
export function createBitgetAdapterSet(options: BitgetAdapterSetOptions = {}): {
  registry: CapabilityRegistry;
  mcp: McpTransport;
  rest: RestTransport;
  /** Bind the session workspace accessor (local-knowledge capability). */
  bindWorkspace: (accessor: () => import("../domain/workspace.js").Workspace | undefined) => void;
} {
  const registry = new CapabilityRegistry();
  const mcp = options.mcp ?? new McpTransport();
  const rest = options.rest ?? new RestTransport();

  registry.register(createMacroAnalystAdapter(mcp));
  registry.register(createMarketIntelAdapter(mcp));
  registry.register(createSentimentAnalystAdapter(mcp));
  registry.register(createNewsBriefingAdapter(mcp));
  registry.register(new TechnicalAnalysisAdapter(rest, mcp));
  // Keyless research surface (2026-10-05): the three research domains the retired paid agent
  // tier was the sole provider for. Registered here, at the PRIMARY priority, because these
  // tools are public and free — they are not a fallback, they are the answer.
  for (const adapter of createKeylessResearchSurfaceAdapters(mcp)) registry.register(adapter);
  // G1 (vendor selected 2026-09-15): real historical OHLCV; Bitget REST primary,
  // Binance Vision public mirror fallback. Tests may override via options.historical.
  registry.register(options.historical ?? new G1HistoricalDataAdapter(rest, new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL })));
  // G2 (implemented 2026-09-15): bounded web/primary-source retrieval; SSRF-guarded,
  // source-classified, source≠evidence. Tests may override via options.webRetrieval.
  registry.register(options.webRetrieval ?? new G2WebRetrievalAdapter());
  // Capability-level fallbacks (2026-09-16): Bitget stays PRIMARY (default priority 100);
  // these register at lower priority (200) so the registry's failover loop reaches them
  // only when the primary fails/unavailable. The registry owns this selection; flows
  // never hardcode providers. Tests may disable via options.fallbacks === false.
  if (options.fallbacks !== false) {
    registry.register(new NewsFallbackAdapter(), 200);
    registry.register(new SentimentFallbackAdapter(), 200);
    registry.register(new MacroFallbackAdapter(), 200);
    // Crypto market-data fallback (2026-09-18): when Bitget's MCP upstreams time out from
    // production, prices previously had NO fallback (RSS is news, not market data). CoinGecko's
    // public keyless API serves the same observation vocabulary (price/24h stats).
    registry.register(new CoinGeckoMarketDataAdapter(), 200);
  }
  // Equity capabilities (2026-09-18): Yahoo Finance primary (OHLCV/quote, fundamentals,
  // earnings calendar, per-ticker news) with Stooq CSV as the market-data fallback inside
  // the adapter. Same registry mechanism; no Flow→provider hardcoding.
  registerEquityAdapters(registry);
  // Current market-regime observables (2026-09-20): keyless index/yield/volatility/dollar
  // quotes that serve ANY MACRO_ANALYSIS or MARKET_DATA_ANALYSIS requirement. Priority 150:
  // after the direct Bitget primaries (100), before the low-frequency statistical fallbacks
  // (200) — a CURRENT macro requirement must be answerable with current market observations,
  // never with annual statistical releases. Reusable capability, not question routing.
  if (options.fallbacks !== false) {
    registry.register(new MarketRegimeAdapter(), 150);
  }
  // Keyless replacements for the two capabilities Heurist Mesh used to serve, now that the
  // credit-based Mesh agent tier is removed from the research path entirely (2026-10-05).
  // Both are PUBLIC data (no account, no API key, no credits) and sit in the same low-priority
  // failover tier Heurist occupied, so capability availability is unchanged from the engine's
  // point of view while the per-run credit cost drops to zero.
  //  - DERIVATIVES_ANALYSIS (funding rate / open interest / long-short): the Bitget MCP's own
  //    `derivatives_sentiment` tool is broken (empty `{"error":""}` after ~15s on every
  //    action, verified twice), so this reads the public exchange REST API directly and
  //    degrades to an honest EMPTY rather than an inferred number.
  //  - SOURCE_VALIDATION / EQUITY_FUNDAMENTALS: SEC EDGAR needs no credential at all (only an
  //    identifying User-Agent). Bitget exposes no SEC surface, so EDGAR is the whole answer.
  if (options.fallbacks !== false) {
    registry.register(new PublicDerivativesAdapter(), 300);
    registry.register(new SecEdgarAdapter(), 300);
  }

  // Local knowledge (trader-owned workspace context) is a first-class capability served by
  // a lazy workspace accessor; the registry itself never holds a Workspace reference.
  const localKnowledge = new LocalKnowledgeAdapter(() => options.workspaceAccessor?.());
  registry.register(localKnowledge, 0);

  return { registry, mcp, rest, bindWorkspace: (accessor: () => import("../domain/workspace.js").Workspace | undefined) => { options.workspaceAccessor = accessor; } };
}
