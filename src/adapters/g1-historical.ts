/**
 * G1 — Historical market data provider (vendor selected 2026-09-15, human-approved).
 *
 * Architectural basis:
 * - capability-registry.ts `HistoricalDataProvider` / `HistoricalQuery` (the interface was
 *   defined in M0 and is unchanged); final lock §4: externals only for G1/G2 — this module
 *   is the G1 implementation, still behind the registry (no Flow→Tool hardcoding).
 * - FINDINGS.md R4/R1: Flow 5 is Bitget-crippled without deep history; the public MCP hub
 *   is a single point of failure. Mitigation: an independent historical source.
 * - Live-verified 2026-09-15 from this machine: `api.bitget.com` is network-unreachable
 *   (HTTP 000); `data-api.binance.vision` (Binance's official Market-Data-Only URL —
 *   "do not require any authentication and serve only public market data") serves REAL
 *   multi-year OHLCV (BTC 2020-01-01 @ $7,200.85; the 2021-05-19 crash bar: low 30,000,
 *   close 36,690). CoinGecko anonymous caps at 365d; all other exchange APIs blocked here.
 *
 * Venue priority (human-approved): Bitget REST candles first (same venue as the other
 * capabilities; used when reachable) → Binance Vision public mirror fallback. Provenance
 * records the venue that actually served the data.
 *
 * Epistemic laws preserved:
 * - raw OHLCV candles are QUANTITATIVE_OBSERVATIONs with exact timestamps (final lock §9);
 * - failure/absence never becomes evidence: unmirrored metrics (funding/open_interest/
 *   liquidations) return honest UNAVAILABLE-class outputs with failure set — nothing invented;
 * - all resilience primitives reused (throttle, bounded retry, raw capture).
 */

import type { CapabilityName, HistoricalQuery, HistoricalDataProvider } from "./capability-registry.js";
import { RestTransport } from "./transports/rest.js";
import { TransportError } from "./transports/resilience.js";
import type { ToolOutput, ToolResultInput } from "../domain/tool-result.js";

/** Capabilities G1 can satisfy once connected. */
export const G1_CAPABILITIES: readonly CapabilityName[] = ["HISTORICAL_COMPARISON"];

/** Binance Vision is the live-verified fallback (official Market-Data-Only URL, no auth). */
export const BINANCE_VISION_BASE_URL = "https://data-api.binance.vision";

/** Bitget v2 candle endpoints (same paths the technical-analysis REST fallback uses). */
const BITGET_SPOT_CANDLES_PATH = "/api/v2/spot/market/candles";
const BITGET_FUTURES_CANDLES_PATH = "/api/v2/mix/market/candles";

/** Metrics the reachable sources can serve. Funding/OI/liquidations are NOT mirrored. */
type ServableMetric = "ohlcv";
const SERVABLE_METRICS: readonly ServableMetric[] = ["ohlcv"];

/** Cap one fetch at a sane candle count; deep ranges are served by multiple bounded calls. */
const MAX_CANDLES_PER_CALL = 1000;
/** Deep-range safety bound: at most 5 pages (5000 candles ≈ 13 years of daily bars). */
const MAX_PAGES = 5;

/** Freshness profile: historical data is intentionally in the past → HISTORICAL is honest. */
const HISTORICAL_PROFILE_ID = "historical:stable";

/** Normalized candle record emitted as evidence content (exact timestamps, numbers). */
export interface HistoricalCandle {
  readonly openTime: string; // ISO
  readonly closeTime: string; // ISO
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly baseVolume: number;
}

/** Bitget v2 candle schema (order per official API docs). */
interface BitgetCandle {
  readonly ts: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly baseVolume: string;
}

/** Binance kline array: [openTime, o, h, l, c, vol, closeTime, quoteVol, trades, ...]. */
type BinanceKline = readonly [number, string, string, string, string, string, number, string, number, string, string, string];

/** One venue's answer for a query. */
interface VenueFetch {
  readonly candles: readonly HistoricalCandle[];
  readonly venue: "bitget-rest" | "binance-vision";
  readonly rawReference: string;
  readonly attempts: number;
}

/** Symbol in venue REST format (no slash, uppercased). */
function restSymbol(symbol: string): string {
  return symbol.replace("/", "").toUpperCase();
}

function isoToMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new TransportError("SCHEMA_ERROR", `invalid ISO date bound: ${iso}`, { retriable: false });
  }
  return ms;
}

function intervalMsFor(interval: string): number {
  switch (interval) {
    case "1min": return 60_000;
    case "5min": return 5 * 60_000;
    case "15min": return 15 * 60_000;
    case "30min": return 30 * 60_000;
    case "1h": return 3_600_000;
    case "4h": return 4 * 3_600_000;
    case "1d": return 86_400_000;
    case "1w": return 7 * 86_400_000;
    case "1M": return 30 * 86_400_000;
    default: return 86_400_000; // daily default for historical comparison
  }
}

/** Map a neutral interval to Binance kline interval vocabulary. */
function binanceIntervalFor(interval: string): string {
  switch (interval) {
    case "1min": return "1m";
    case "5min": return "5m";
    case "15min": return "15m";
    case "30min": return "30m";
    case "1h": return "1h";
    case "4h": return "4h";
    case "1d": return "1d";
    case "1w": return "1w";
    case "1M": return "1M";
    default: return "1d";
  }
}

/** Bitget candles carry openTime only; closeTime is derived from the interval window. */
function toHistoricalCandle(c: BitgetCandle, interval: string): HistoricalCandle {
  const openMs = Number(c.ts);
  return {
    openTime: new Date(openMs).toISOString(),
    closeTime: new Date(openMs + intervalMsFor(interval) - 1).toISOString(),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    baseVolume: Number(c.baseVolume),
  };
}

function toHistoricalCandleFromKline(k: BinanceKline): HistoricalCandle {
  return {
    openTime: new Date(k[0]).toISOString(),
    closeTime: new Date(k[6]).toISOString(),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    baseVolume: Number(k[5]),
  };
}

/** Dedupe by openTime (venue pagination can overlap) and sort ascending. */
function dedupeAndSort(candles: readonly HistoricalCandle[]): readonly HistoricalCandle[] {
  const byOpen = new Map<string, HistoricalCandle>();
  for (const c of candles) byOpen.set(c.openTime, c);
  return [...byOpen.values()].sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime));
}

/** Group candles into calendar-month blocks (packaging only — values untouched). */
function chunkByMonth(candles: readonly HistoricalCandle[]): readonly { month: string; candles: readonly HistoricalCandle[] }[] {
  const chunks: { month: string; candles: HistoricalCandle[] }[] = [];
  let current: { month: string; candles: HistoricalCandle[] } | undefined;
  for (const candle of candles) {
    const month = candle.openTime.slice(0, 7); // YYYY-MM
    if (current === undefined || current.month !== month) {
      current = { month, candles: [] };
      chunks.push(current);
    }
    current.candles.push(candle);
  }
  return chunks;
}

/**
 * Bitget v2 candles payload: { code, data: Candle[] } (object rows per official docs).
 * Rows are parsed defensively: v2 also documents array-shaped rows [ts,o,h,l,c,baseVol,quoteVol];
 * an unexpected shape throws SCHEMA_ERROR honestly (the Vision fallback then serves).
 */
function parseBitgetCandles(body: unknown, path: string): readonly BitgetCandle[] {
  const obj = body as { code?: string | number; data?: unknown };
  if (obj.code !== undefined && String(obj.code) !== "00000") {
    throw new TransportError("SCHEMA_ERROR", `Bitget REST ${path} returned code ${String(obj.code)}`, { retriable: false });
  }
  if (!Array.isArray(obj.data)) {
    throw new TransportError("SCHEMA_ERROR", `Bitget REST ${path} payload has no data array`, { retriable: false });
  }
  return (obj.data as readonly unknown[]).map((row): BitgetCandle => {
    if (Array.isArray(row)) {
      const [ts, open, high, low, close, baseVolume] = row as [string, string, string, string, string, string];
      return { ts, open, high, low, close, baseVolume };
    }
    const rec = row as Record<string, unknown>;
    if (typeof rec.ts !== "string" || typeof rec.open !== "string") {
      throw new TransportError("SCHEMA_ERROR", `Bitget REST ${path} candle row has unexpected shape`, { retriable: false });
    }
    return {
      ts: rec.ts,
      open: String(rec.open),
      high: String(rec.high),
      low: String(rec.low),
      close: String(rec.close),
      baseVolume: String(rec.baseVolume ?? rec.baseVol ?? "0"),
    };
  });
}

function parseBinanceKlines(body: unknown): readonly BinanceKline[] {
  if (!Array.isArray(body)) {
    // Binance errors come as { code, msg } — non-array means a failure the transport missed.
    throw new TransportError("SCHEMA_ERROR", "Binance Vision klines payload is not an array", { retriable: false });
  }
  return body as readonly BinanceKline[];
}

/**
 * G1 provider: real historical OHLCV with venue fallback and honest unavailability for
 * metrics no reachable source serves. Never fabricates (final lock §18).
 */
export class G1HistoricalDataAdapter implements HistoricalDataProvider {
  readonly providerId = "g1/historical-data";
  readonly capabilities = G1_CAPABILITIES;
  readonly limitations: readonly string[] = [
    "G1 serves OHLCV candle history only; funding/open-interest/liquidation history is not available from any reachable source and is never fabricated",
    "when api.bitget.com is unreachable from the deployment network, candles are served by the Binance Vision public mirror (venue recorded in provenance)",
    "Binance Vision serves spot OHLCV only; futures historical depth depends on Bitget reachability",
  ];
  readonly freshnessProfile = HISTORICAL_PROFILE_ID;

  constructor(
    /** Primary venue transport (Bitget REST). */
    private readonly bitgetRest: RestTransport,
    /** Fallback venue transport (Binance Vision public mirror). */
    private readonly visionRest: RestTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Registry execution path (capability-first; the engine never names a tool).
   *
   * Capability defaults (reliability-phase precedent): a plan that names the capability without
   * supplying a full HistoricalQuery (e.g. the generic adaptive loop passes only `{asset}`)
   * gets a valid default envelope — symbol from asset, metric ohlcv, 3-year daily lookback —
   * instead of an opaque SCHEMA failure. Explicit params always win.
   */
  async execute(capability: string, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "HISTORICAL_COMPARISON") {
      throw new TransportError("SCHEMA_ERROR", `${this.providerId} has no mapping for capability ${capability}`, { retriable: false });
    }
    return this.query(this.withDefaults(params));
  }

  /** Fill unset query fields with capability defaults; explicit values are never overridden. */
  private withDefaults(params: Record<string, unknown>): HistoricalQuery {
    const p = params as Partial<HistoricalQuery> & { asset?: string };
    const asset = typeof p.asset === "string" ? p.asset.toUpperCase() : undefined;
    const symbol = p.symbol ?? (asset !== undefined ? (asset.includes("/") ? asset : `${asset}/USDT`) : "BTC/USDT");
    const nowMs = this.now().getTime();
    return {
      symbol,
      metric: p.metric ?? "ohlcv",
      from: p.from ?? new Date(nowMs - 3 * 365 * 86_400_000).toISOString(),
      to: p.to ?? new Date(nowMs).toISOString(),
      ...(p.interval !== undefined ? { interval: p.interval } : { interval: "1d" }),
    };
  }

  /** HistoricalQuery path (interface method). */
  async query(query: HistoricalQuery): Promise<ToolResultInput> {
    const at = this.now();
    // Metric gate FIRST: unmirrored metrics fail honestly without touching the network.
    if (!SERVABLE_METRICS.includes(query.metric as ServableMetric)) {
      return this.unavailableResult(query, at,
        `historical ${query.metric} is not available from any reachable source (Bitget REST unreachable from this deployment; Binance Vision mirrors spot OHLCV only)`);
    }
    const interval = query.interval ?? "1d";
    const fromMs = isoToMs(query.from);
    const toMs = isoToMs(query.to);
    if (fromMs > toMs) {
      throw new TransportError("SCHEMA_ERROR", `historical query from (${query.from}) is after to (${query.to})`, { retriable: false });
    }

    try {
      const fetch = await this.fetchOhlcv(query, interval, fromMs, toMs);
      if (fetch.candles.length === 0) {
        return this.emptyResult(query, fetch.venue, fetch.rawReference, at,
          `no candles in the requested window (${query.from} → ${query.to}); the range may predate the venue's listing or use an unsupported interval`);
      }
      return this.successResult(query, interval, fetch, at);
    } catch (error) {
      // Both venues failed: honest typed failure — never an empty "no data" answer.
      const message = error instanceof Error ? error.message : String(error);
      return {
        tool: this.providerId,
        capability: "HISTORICAL_COMPARISON",
        transport: "rest:historical-ohlcv",
        params: { ...query },
        completeness: "EMPTY",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: `both historical venues failed: ${message}`, retriable: true },
        limitations: this.limitations,
      };
    }
  }

  /** Venue priority: Bitget REST first, Binance Vision fallback. */
  private async fetchOhlcv(query: HistoricalQuery, interval: string, fromMs: number, toMs: number): Promise<VenueFetch> {
    try {
      return await this.fetchBitgetCandles(query, interval, fromMs, toMs);
    } catch (bitgetError) {
      const bitgetMessage = bitgetError instanceof Error ? bitgetError.message : String(bitgetError);
      try {
        return await this.fetchVisionCandles(query, interval, fromMs, toMs);
      } catch (visionError) {
        const visionMessage = visionError instanceof Error ? visionError.message : String(visionError);
        throw new TransportError("PROVIDER_ERROR",
          `bitget: ${bitgetMessage}; binance-vision: ${visionMessage}`,
          { retriable: true });
      }
    }
  }

  /** Primary venue: Bitget v2 candles (spot path; mix path when explicitly futures). */
  private async fetchBitgetCandles(query: HistoricalQuery, interval: string, fromMs: number, toMs: number): Promise<VenueFetch> {
    const symbol = restSymbol(query.symbol);
    const marketType = (query as HistoricalQuery & { marketType?: string }).marketType === "futures" ? "futures" : "spot";
    const path = marketType === "futures" ? BITGET_FUTURES_CANDLES_PATH : BITGET_SPOT_CANDLES_PATH;
    const candles: HistoricalCandle[] = [];
    let rawReference = "";
    let attempts = 0;
    // Bitget v2 candles paginate with startTime/endTime; walk forward from `from`.
    let windowStart = fromMs;
    for (let page = 0; page < MAX_PAGES && windowStart <= toMs; page++) {
      const outcome = await this.bitgetRest.get(path, {
        params: {
          symbol,
          granularity: interval,
          startTime: String(windowStart),
          endTime: String(toMs),
          limit: String(MAX_CANDLES_PER_CALL),
        },
      });
      rawReference = outcome.rawReference;
      attempts += outcome.attempts;
      const rows = parseBitgetCandles(outcome.body, path);
      if (rows.length === 0) break;
      for (const c of rows) candles.push(toHistoricalCandle(c, interval));
      const lastMs = Number(rows[rows.length - 1]!.ts);
      if (lastMs <= windowStart) break; // defensive: no forward progress
      windowStart = lastMs + intervalMsFor(interval);
      if (rows.length < MAX_CANDLES_PER_CALL) break;
    }
    return { candles: dedupeAndSort(candles), venue: "bitget-rest", rawReference, attempts };
  }

  /** Fallback venue: Binance Vision klines (official Market-Data-Only URL, no auth). */
  private async fetchVisionCandles(query: HistoricalQuery, interval: string, fromMs: number, toMs: number): Promise<VenueFetch> {
    const symbol = restSymbol(query.symbol);
    const binanceInterval = binanceIntervalFor(interval);
    const intervalMs = intervalMsFor(interval);
    const candles: HistoricalCandle[] = [];
    let rawReference = "";
    let attempts = 0;
    let windowStart = fromMs;
    for (let page = 0; page < MAX_PAGES && windowStart <= toMs; page++) {
      const outcome = await this.visionRest.get("/api/v3/klines", {
        params: {
          symbol,
          interval: binanceInterval,
          startTime: String(windowStart),
          endTime: String(toMs),
          limit: String(MAX_CANDLES_PER_CALL),
        },
      });
      rawReference = outcome.rawReference;
      attempts += outcome.attempts;
      const rows = parseBinanceKlines(outcome.body);
      if (rows.length === 0) break;
      for (const k of rows) candles.push(toHistoricalCandleFromKline(k));
      const lastOpenMs = rows[rows.length - 1]![0];
      if (lastOpenMs <= windowStart) break; // defensive: no forward progress
      windowStart = lastOpenMs + intervalMs;
      if (rows.length < MAX_CANDLES_PER_CALL) break;
    }
    return { candles: dedupeAndSort(candles), venue: "binance-vision", rawReference, attempts };
  }

  /** Success result: candles as QUANTITATIVE_OBSERVATIONs with exact timestamps + provenance.
   *
   * Packaging law: candles are chunked into MONTHLY blocks — one evidence object per candle
   * floods the research graph (2190 objects for a 3-year daily query) and degrades every
   * downstream context build. Each candle is preserved VERBATIM inside its block (exact ISO
   * timestamps, numeric OHLCV) — chunking changes packaging, never values or classification.
   */
  private successResult(query: HistoricalQuery, interval: string, fetch: VenueFetch, _at: Date): ToolResultInput {
    const symbol = restSymbol(query.symbol);
    const outputs: ToolOutput[] = chunkByMonth(fetch.candles).map((chunk) => ({
      outputClass: "QUANTITATIVE_OBSERVATION" as const,
      content: {
        month: chunk.month,
        candleCount: chunk.candles.length,
        candles: chunk.candles,
      },
      about: symbol,
      timeframe: interval,
    }));
    const lastCandle = fetch.candles.at(-1);
    if (lastCandle === undefined) {
      throw new TransportError("SCHEMA_ERROR", "success result with no candles (caller must check emptiness first)", { retriable: false });
    }
    return {
      tool: this.providerId,
      capability: "HISTORICAL_COMPARISON",
      transport: `rest:historical-ohlcv:${fetch.venue}`,
      params: { ...query },
      rawReference: fetch.rawReference,
      outputs,
      completeness: "COMPLETE",
      validation: "VALID",
      sourceTimestamp: lastCandle.closeTime,
      freshness: "HISTORICAL",
      limitations: this.limitations,
    };
  }

  /** Empty window: honest EMPTY result (absence of data is not evidence of anything). */
  private emptyResult(query: HistoricalQuery, venue: string, rawReference: string, _at: Date, message: string): ToolResultInput {
    return {
      tool: this.providerId,
      capability: "HISTORICAL_COMPARISON",
      transport: `rest:historical-ohlcv:${venue}`,
      params: { ...query },
      ...(rawReference !== "" ? { rawReference } : {}),
      outputs: [],
      completeness: "EMPTY",
      validation: "VALID",
      failure: { type: "EMPTY_RESULT", message, retriable: false },
      limitations: this.limitations,
    };
  }

  /** Unmirrored metric: honest UNAVAILABLE outputs — the absence is stated, not papered over. */
  private unavailableResult(query: HistoricalQuery, _at: Date, message: string): ToolResultInput {
    return {
      tool: this.providerId,
      capability: "HISTORICAL_COMPARISON",
      transport: "rest:historical-ohlcv",
      params: { ...query },
      outputs: [
        {
          outputClass: "UNAVAILABLE" as const,
          content: { metric: query.metric, reason: message },
          about: restSymbol(query.symbol),
        },
      ],
      completeness: "EMPTY",
      validation: "VALID",
      failure: { type: "UNAVAILABLE", message, retriable: false },
      limitations: this.limitations,
    };
  }
}
