/**
 * Equity market-data capabilities: Yahoo Finance primary, Stooq CSV fallback.
 *
 * Mandate §3–§9 (capability expansion): equities gain real, keyless providers through the
 * SAME registry mechanism as every other capability. Laws preserved:
 * - Registry owns selection: these register at priority 100; never referenced by flows.
 * - Provenance: raw capture reference + source timestamps on every result.
 * - Epistemic classes: prices/OHLCV are QUANTITATIVE_OBSERVATION; fundamentals carry an
 *   explicit `kind` (HISTORICAL_ACTUAL / ESTIMATE / DERIVED_METRIC) so an analyst estimate
 *   can never masquerade as a reported actual; news items are FACTUAL_OBSERVATION and
 *   secondary reporting.
 * - Retrieval failure is a technical condition, never negative evidence.
 *
 * Providers (live-probed 2026-09-18; production reachability is tracked separately in the
 * capability matrix and provider diagnostics):
 * - Yahoo Finance v8 chart (keyless, no crumb): OHLCV + quote meta for arbitrary tickers.
 * - Yahoo Finance quoteSummary (needs cookie+crumb, fetched on demand and cached):
 *   calendarEvents (next earnings date + consensus), financialData/keyStatistics (margins,
 *   cashflow, valuation, shares).
 * - Yahoo RSS headline feeds: per-ticker equity news (secondary reporting).
 * - Stooq daily CSV (keyless): OHLCV fallback when the Yahoo chart path fails.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RestTransport } from "./transports/rest.js";

/** Every Yahoo request carries a browser UA (bare clients get 4xx from the edge). */
const YAHOO_UA = "Mozilla/5.0 (compatible; LumenTerminal/1.0; research read-only)";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface YahooChartQuote {
  readonly open?: readonly (number | null)[];
  readonly high?: readonly (number | null)[];
  readonly low?: readonly (number | null)[];
  readonly close?: readonly (number | null)[];
  readonly volume?: readonly (number | null)[];
}

interface YahooChartResult {
  readonly meta?: {
    readonly symbol?: string;
    readonly regularMarketPrice?: number;
    readonly chartPreviousClose?: number;
    readonly previousClose?: number;
    readonly currency?: string;
    readonly fullExchangeName?: string;
    readonly regularMarketTime?: number;
    readonly shortName?: string;
    readonly longName?: string;
  };
  readonly timestamp?: readonly number[];
  readonly indicators?: {
    readonly quote?: readonly YahooChartQuote[];
  };
}

interface Candle {
  readonly ts: string; // ISO date of the session
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
}

function parseYahooChart(body: unknown): { candles: Candle[]; meta: YahooChartResult["meta"] } {
  const result = (body as { chart?: { result?: YahooChartResult[] } }).chart?.result?.[0];
  if (!result) return { candles: [], meta: undefined };
  const meta = result.meta;
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = quote.close?.[i];
    if (close === null || close === undefined) continue; // incomplete session row
    candles.push({
      ts: new Date(timestamps[i]! * 1000).toISOString().slice(0, 10),
      open: quote.open?.[i] ?? close,
      high: quote.high?.[i] ?? close,
      low: quote.low?.[i] ?? close,
      close,
      volume: quote.volume?.[i] ?? null,
    });
  }
  return { candles, meta };
}

/** Stooq daily CSV: Date,Open,High,Low,Close,Volume (US symbols suffixed .us). */
function parseStooqCsv(csv: string): Candle[] {
  const candles: Candle[] = [];
  const lines = csv.trim().split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[0];
    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    if (date === undefined || date === "" || !Number.isFinite(close)) continue;
    candles.push({
      ts: date,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume: cols[5] !== undefined && Number.isFinite(Number(cols[5])) ? Number(cols[5]) : null,
    });
  }
  return candles;
}

function candleOutputs(candles: Candle[], about: string, limit: number): ToolOutput[] {
  return candles.slice(-limit).map((c) => ({
    outputClass: "QUANTITATIVE_OBSERVATION" as const,
    content: c,
    about,
    timeframe: "1d",
  }));
}

/**
 * One-window OHLCV summary (DERIVED_METRIC): first open -> last close with the window's
 * high/low and cumulative return. This gives the synthesis model a directly quotable
 * week-over-week fact — the live TSLA run received five daily candles yet the answer
 * claimed "lacks historical price data from the previous week" because no output stated
 * the window-level comparison. Derived from the SAME candles; no extra provider call.
 */
function windowSummaryOutput(candles: Candle[], about: string): ToolOutput | undefined {
  if (candles.length < 2) return undefined;
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const changePct = first.open !== 0 ? ((last.close - first.open) / first.open) * 100 : undefined;
  return {
    // QUANTITATIVE_OBSERVATION with an explicit derivation basis: computed locally over the
    // SAME candles just retrieved (no second call), so it stays a transparent derived fact.
    outputClass: "QUANTITATIVE_OBSERVATION" as const,
    content: {
      symbol: about,
      metric: "window_ohlcv_summary",
      windowStart: first.ts,
      windowEnd: last.ts,
      sessions: candles.length,
      windowOpen: first.open,
      windowClose: last.close,
      windowHigh: high,
      windowLow: low,
      ...(changePct !== undefined ? { windowChangePct: Number(changePct.toFixed(2)) } : {}),
      basis: `derived from ${candles.length} daily candles (${first.ts} to ${last.ts})`,
    },
    about,
    timeframe: "1d",
  };
}

/**
 * Commodity/FX/index names → tradable Yahoo Finance symbols, resolved at the adapter
 * boundary so a question about "gold" or "EUR/USD" fetches real market data instead of
 * failing ticker resolution. Crypto assets are deliberately NOT here: they belong to the
 * crypto capabilities (MARKET_DATA_ANALYSIS), and are guarded separately below.
 */
const NAMED_TARGETS: ReadonlyMap<string, string> = new Map([
  ["GOLD", "GC=F"], ["XAU", "GC=F"], ["XAUUSD", "GC=F"],
  ["SILVER", "SI=F"], ["XAG", "SI=F"], ["XAGUSD", "SI=F"],
  ["OIL", "CL=F"], ["CRUDE", "CL=F"], ["WTI", "CL=F"], ["BRENT", "BZ=F"],
  ["COPPER", "HG=F"], ["NATGAS", "NG=F"],
  ["SPX", "^GSPC"], ["SP500", "^GSPC"], ["NASDAQ", "^IXIC"], ["DOW", "^DJI"], ["RUSSELL", "^RUT"],
  ["VIX", "^VIX"], ["DXY", "DX-Y.NYB"],
  ["EURUSD", "EURUSD=X"], ["GBPUSD", "GBPUSD=X"], ["USDJPY", "USDJPY=X"], ["USDNGN", "USDNGN=X"],
]);

/** Known crypto assets: requesting them from EQUITY capabilities is a routing mismatch. */
const CRYPTO_ASSETS: ReadonlySet<string> = new Set(["BTC", "BITCOIN", "ETH", "ETHEREUM", "SOL", "XRP", "BNB", "ADA", "DOGE", "AVAX", "LINK", "DOT", "LTC", "TRX", "SHIB", "TON", "MATIC"]);

function symbolOf(params: Record<string, unknown>): string | undefined {
  // The engine's canonical target param is `asset` (LUI resolvedTarget); `symbol` is an
  // accepted alias so the capability also works when called directly with ticker vocabulary.
  const raw = typeof params.asset === "string" && params.asset.trim() !== "" ? params.asset : typeof params.symbol === "string" ? params.symbol : "";
  const token = raw.trim().toUpperCase();
  if (token === "") return undefined;
  return NAMED_TARGETS.get(token) ?? token;
}

function schemaError(tool: string, capability: CapabilityName, params: Record<string, unknown>, message: string): ToolResultInput {
  return {
    tool,
    capability,
    transport: "none",
    params,
    outputs: [{ outputClass: "UNAVAILABLE" as const, content: message }],
    completeness: "EMPTY",
    freshness: "CURRENT",
    validation: "VALID",
    failure: { type: "SCHEMA_ERROR", message, retriable: false },
    limitations: [],
  };
}

// ---------------------------------------------------------------------------
// EQUITY_MARKET_DATA: Yahoo chart primary → Stooq CSV fallback (adapter-level;
// the REGISTRY additionally failovers to other registered providers on throw/empty)
// ---------------------------------------------------------------------------

export class EquityMarketDataAdapter implements ProviderAdapter {
  readonly providerId = "equity/yahoo-chart";
  readonly capabilities: readonly CapabilityName[] = ["EQUITY_MARKET_DATA"];
  readonly limitations: readonly string[] = [
    "Yahoo Finance chart data: delayed US equities; not a licensed real-time feed",
    "daily OHLCV history is provider-limited to the requested range",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "equity:daily-session";

  private readonly yahoo: RestTransport;
  private readonly stooq: RestTransport;

  constructor(yahoo?: RestTransport, stooq?: RestTransport) {
    this.yahoo = yahoo ?? new RestTransport({ baseUrl: "https://query1.finance.yahoo.com", defaultHeaders: { "user-agent": YAHOO_UA } });
    this.stooq = stooq ?? new RestTransport({ baseUrl: "https://stooq.com", defaultHeaders: { "user-agent": YAHOO_UA } });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "EQUITY_MARKET_DATA") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const symbol = symbolOf(params);
    if (symbol === undefined) {
      return schemaError(this.providerId, capability, params, "no ticker symbol resolved for this question; equities require a corporate ticker");
    }
    if (CRYPTO_ASSETS.has(symbol)) {
      // Routing mismatch, not a failure of the question: crypto assets are served by the
      // crypto market-data capability chain. Quiet honest emptiness; never negative evidence.
      return {
        tool: this.providerId,
        capability,
        transport: "none",
        params,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `${symbol} is a crypto asset; market data for it is served by the crypto market-data capability, not equity market data` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: `capability not applicable to ${symbol}`, retriable: false },
        limitations: [],
      };
    }
    const range = typeof params.range === "string" ? params.range : "5d";
    const interval = typeof params.interval === "string" ? params.interval : "1d";
    const limit = typeof params.limit === "number" ? params.limit : 5;

    // Primary: Yahoo v8 chart.
    try {
      const outcome = await this.yahoo.get(`/v8/finance/chart/${encodeURIComponent(symbol)}`, { params: { range, interval } });
      const { candles, meta } = parseYahooChart(outcome.body);
      if (candles.length > 0 && meta !== undefined) {
        const last = candles[candles.length - 1]!;
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        const outputs: ToolOutput[] = [];
        if (meta.regularMarketPrice !== undefined) {
          outputs.push({
            outputClass: "QUANTITATIVE_OBSERVATION" as const,
            content: {
              symbol,
              name: meta.shortName ?? meta.longName,
              price: meta.regularMarketPrice,
              previousClose: prev,
              changePct: prev !== undefined && prev !== 0 ? ((meta.regularMarketPrice - prev) / prev) * 100 : undefined,
              currency: meta.currency,
              exchange: meta.fullExchangeName,
              asOf: meta.regularMarketTime !== undefined ? new Date(meta.regularMarketTime * 1000).toISOString() : undefined,
            },
            about: symbol,
          });
        }
        outputs.push(...candleOutputs(candles, symbol, limit));
        // Window-level summary so synthesis can quote the period comparison directly.
        const summary = windowSummaryOutput(candles.slice(-limit), symbol);
        if (summary !== undefined) outputs.push(summary);
        return {
          tool: this.providerId,
          capability,
          transport: "rest:query1.finance.yahoo.com",
          params: { ...params, symbol, range, interval },
          rawReference: outcome.rawReference,
          outputs,
          completeness: "COMPLETE",
          freshness: "CURRENT",
          validation: "VALID",
          sourceTimestamp: new Date(`${last.ts}T00:00:00Z`).toISOString(),
          limitations: this.limitations,
        };
      }
    } catch {
      // fall through to Stooq; the registry preserves the primary attempt in its trail
    }

    // Fallback: Stooq daily CSV.
    const stooqSymbol = `${symbol.toLowerCase().replace(/\./g, "")}.us`;
    const stooqOutcome = await this.stooq.get("/q/d/l/", { params: { s: stooqSymbol, i: "d" }, responseType: "text" });
    const stooqBody = typeof stooqOutcome.body === "string" ? stooqOutcome.body : String(stooqOutcome.body);
    const candles = parseStooqCsv(stooqBody);
    if (candles.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:stooq.com",
        params: { ...params, symbol },
        rawReference: stooqOutcome.rawReference,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `no equity market data for ${symbol} from Yahoo or Stooq` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: `no data for ${symbol}`, retriable: true },
        limitations: [...this.limitations, "both primary (Yahoo) and fallback (Stooq) returned no data"],
      };
    }
    const last = candles[candles.length - 1]!;
    const prev = candles.length >= 2 ? candles[candles.length - 2]!.close : undefined;
    return {
      tool: this.providerId,
      capability,
      transport: "rest:stooq.com",
      params: { ...params, symbol },
      rawReference: stooqOutcome.rawReference,
      outputs: [
        {
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          content: {
            symbol,
            price: last.close,
            previousClose: prev,
            changePct: prev !== undefined && prev !== 0 ? ((last.close - prev) / prev) * 100 : undefined,
            asOf: `${last.ts} (Stooq daily close)`,
            source: "Stooq",
          },
          about: symbol,
        },
        ...candleOutputs(candles, symbol, limit),
        ...(() => { const s = windowSummaryOutput(candles.slice(-limit), symbol); return s !== undefined ? [s] : []; })(),
      ],
      completeness: "COMPLETE",
      freshness: "CURRENT",
      validation: "VALID",
      sourceTimestamp: new Date(`${last.ts}T00:00:00Z`).toISOString(),
      limitations: [...this.limitations, "served by Stooq CSV fallback after Yahoo chart was unavailable"],
    };
  }
}

// ---------------------------------------------------------------------------
// EQUITY_FUNDAMENTALS: Yahoo quoteSummary (cookie+crumb handshake, cached)
// Every field carries `kind`: HISTORICAL_ACTUAL | ESTIMATE | DERIVED_METRIC.
// ---------------------------------------------------------------------------

function yahooRawValue(v: unknown): number | string | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  if (v !== null && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const r = (v as { raw?: unknown }).raw;
    if (typeof r === "number" || typeof r === "string") return r;
  }
  return undefined;
}

export class EquityFundamentalsAdapter implements ProviderAdapter {
  readonly providerId = "equity/yahoo-quote-summary";
  readonly capabilities: readonly CapabilityName[] = ["EQUITY_FUNDAMENTALS"];
  readonly limitations: readonly string[] = [
    "Yahoo Finance quoteSummary: figures are the provider's latest reported values or derived ratios",
    "derived ratios (margins, returns on capital) are DERIVED_METRIC, never raw company statements",
    "analyst targets/opinions are ESTIMATE; they are never presented as reported actuals",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "equity:quarterly";

  private readonly yahoo: RestTransport;
  private crumbCache: { value: string; cookie: string } | undefined;

  constructor(yahoo?: RestTransport) {
    this.yahoo = yahoo ?? new RestTransport({ baseUrl: "https://query1.finance.yahoo.com", defaultHeaders: { "user-agent": YAHOO_UA } });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "EQUITY_FUNDAMENTALS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const symbol = symbolOf(params);
    if (symbol === undefined) return schemaError(this.providerId, capability, params, "no ticker symbol resolved");

    let crumb: { value: string; cookie: string };
    try {
      crumb = await this.ensureCrumb();
    } catch (error) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params: { ...params, symbol },
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Yahoo crumb handshake failed: ${error instanceof Error ? error.message : String(error)}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: "crumb handshake failed", retriable: true },
        limitations: this.limitations,
      };
    }

    try {
      const outcome = await this.yahoo.get(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
        params: { modules: "financial-data,defaultKeyStatistics,summaryDetail", crumb: crumb.value },
        headers: { cookie: crumb.cookie },
      });
      const summary = (outcome.body as { quoteSummary?: { result?: Record<string, unknown>[]; error?: { description?: string } } }).quoteSummary;
      const result = summary?.result?.[0];
      if (result === undefined) {
        return {
          tool: this.providerId,
          capability,
          transport: "rest:query1.finance.yahoo.com",
          params: { ...params, symbol },
          rawReference: outcome.rawReference,
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Yahoo returned no summary data for ${symbol}` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: { type: "EMPTY_RESULT", message: `no quoteSummary for ${symbol}`, retriable: true },
          limitations: this.limitations,
        };
      }
      const financialData = (result.financialData ?? {}) as Record<string, unknown>;
      const keyStats = (result.defaultKeyStatistics ?? {}) as Record<string, unknown>;
      const summaryDetail = (result.summaryDetail ?? {}) as Record<string, unknown>;
      const pick = (name: string): unknown => financialData[name] ?? keyStats[name] ?? summaryDetail[name];

      // [field, kind]: every output explicitly declares whether it is an actual, an
      // estimate, or a derived metric (mandate §4: never mix estimates with actuals).
      const fields: readonly (readonly [string, "HISTORICAL_ACTUAL" | "ESTIMATE" | "DERIVED_METRIC"])[] = [
        ["totalRevenue", "HISTORICAL_ACTUAL"],
        ["ebitda", "HISTORICAL_ACTUAL"],
        ["freeCashflow", "HISTORICAL_ACTUAL"],
        ["operatingCashflow", "HISTORICAL_ACTUAL"],
        ["totalCash", "HISTORICAL_ACTUAL"],
        ["totalDebt", "HISTORICAL_ACTUAL"],
        ["marketCap", "HISTORICAL_ACTUAL"],
        ["sharesOutstanding", "HISTORICAL_ACTUAL"],
        ["grossMargins", "DERIVED_METRIC"],
        ["operatingMargins", "DERIVED_METRIC"],
        ["profitMargins", "DERIVED_METRIC"],
        ["returnOnEquity", "DERIVED_METRIC"],
        ["returnOnAssets", "DERIVED_METRIC"],
        ["trailingEps", "HISTORICAL_ACTUAL"],
        ["forwardPE", "ESTIMATE"],
        ["trailingPE", "DERIVED_METRIC"],
        ["targetMeanPrice", "ESTIMATE"],
        ["numberOfAnalystOpinions", "HISTORICAL_ACTUAL"],
      ];
      const outputs: ToolOutput[] = [];
      for (const [field, kind] of fields) {
        const value = yahooRawValue(pick(field));
        if (value === undefined) continue;
        outputs.push({
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          content: { symbol, field, value, kind },
          about: symbol,
        });
      }
      if (outputs.length === 0) {
        return {
          tool: this.providerId,
          capability,
          transport: "rest:query1.finance.yahoo.com",
          params: { ...params, symbol },
          rawReference: outcome.rawReference,
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Yahoo returned a summary for ${symbol} but no usable fundamental fields` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: { type: "EMPTY_RESULT", message: `no fundamental fields for ${symbol}`, retriable: true },
          limitations: this.limitations,
        };
      }
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params: { ...params, symbol },
        rawReference: outcome.rawReference,
        outputs,
        completeness: "COMPLETE",
        freshness: "CURRENT",
        validation: "VALID",
        limitations: this.limitations,
      };
    } catch (error) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params: { ...params, symbol },
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Yahoo quoteSummary failed: ${error instanceof Error ? error.message : String(error)}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: error instanceof Error ? error.message : String(error), retriable: true },
        limitations: this.limitations,
      };
    }
  }

  /** Cookie + crumb handshake, cached per adapter instance. */
  private async ensureCrumb(): Promise<{ value: string; cookie: string }> {
    if (this.crumbCache !== undefined) return this.crumbCache;
    // fc.yahoo.com sets the consent cookie; getcrumb returns the crumb bound to it.
    const cookieResp = await fetch("https://fc.yahoo.com", { headers: { "user-agent": YAHOO_UA } }).catch(() => undefined);
    const cookieHeader = cookieResp?.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ") ?? "";
    const crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "user-agent": YAHOO_UA, ...(cookieHeader !== "" ? { cookie: cookieHeader } : {}) },
    });
    if (!crumbResp.ok) throw new Error(`HTTP ${crumbResp.status}`);
    const value = (await crumbResp.text()).trim();
    if (value === "" || value.length > 64) throw new Error("crumb response unusable");
    this.crumbCache = { value, cookie: cookieHeader };
    return this.crumbCache;
  }
}

// ---------------------------------------------------------------------------
// EARNINGS_CALENDAR: next/last earnings dates + consensus (Yahoo calendarEvents).
// Announcement dates are preserved exactly; fiscal vs reported period distinguished
// where the provider states it (isEarningsDateEstimate is carried verbatim).
// ---------------------------------------------------------------------------

interface CalendarEventsBody {
  readonly quoteSummary?: {
    readonly result?: readonly {
      readonly calendarEvents?: {
        readonly earnings?: {
          readonly earningsDate?: readonly { raw?: number; fmt?: string }[];
          readonly earningsCallDate?: readonly { raw?: number; fmt?: string }[];
          readonly isEarningsDateEstimate?: boolean;
          readonly earningsAverage?: { raw?: number };
          readonly earningsLow?: { raw?: number };
          readonly earningsHigh?: { raw?: number };
        };
      };
    }[];
  };
}

export class EarningsCalendarAdapter implements ProviderAdapter {
  readonly providerId = "equity/yahoo-earnings-calendar";
  // EQUITY_EARNINGS is an accepted planner alias for EARNINGS_CALENDAR (the model occasionally
  // emits the shorter name; capability names are user-facing vocabulary, not a provider
  // contract, so both resolve to the same provider instead of an honest-but-useless
  // "no provider registered" note).
  readonly capabilities: readonly CapabilityName[] = ["EARNINGS_CALENDAR", "EQUITY_EARNINGS"];
  readonly limitations: readonly string[] = [
    "Yahoo Finance calendarEvents: next earnings date may be provider-estimated (isEarningsDateEstimate carried verbatim)",
    "consensus EPS figures are ANALYST ESTIMATES, never reported results; reported EPS history is not provided by this source",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "equity:quarterly";

  private readonly yahoo: RestTransport;
  private crumbCache: { value: string; cookie: string } | undefined;

  constructor(yahoo?: RestTransport) {
    this.yahoo = yahoo ?? new RestTransport({ baseUrl: "https://query1.finance.yahoo.com", defaultHeaders: { "user-agent": YAHOO_UA } });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "EARNINGS_CALENDAR" && capability !== "EQUITY_EARNINGS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const symbol = symbolOf(params);
    if (symbol === undefined) return schemaError(this.providerId, capability, params, "no ticker symbol resolved");

    let crumb: { value: string; cookie: string };
    try {
      crumb = await this.ensureCrumb();
    } catch (error) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params: { ...params, symbol },
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Yahoo crumb handshake failed: ${error instanceof Error ? error.message : String(error)}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: "crumb handshake failed", retriable: true },
        limitations: this.limitations,
      };
    }

    try {
      const outcome = await this.yahoo.get(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`, {
        params: { modules: "calendarEvents", crumb: crumb.value },
        headers: { cookie: crumb.cookie },
      });
      const earnings = (outcome.body as CalendarEventsBody).quoteSummary?.result?.[0]?.calendarEvents?.earnings;
      const outputs: ToolOutput[] = [];
      for (const d of earnings?.earningsDate ?? []) {
        if (d.raw === undefined) continue;
        outputs.push({
          outputClass: "FACTUAL_OBSERVATION" as const,
          content: {
            symbol,
            event: "earnings_announcement",
            announcedDate: d.fmt ?? new Date(d.raw * 1000).toISOString().slice(0, 10),
            isEstimate: earnings?.isEarningsDateEstimate ?? true,
          },
          about: symbol,
        });
      }
      for (const d of earnings?.earningsCallDate ?? []) {
        if (d.raw === undefined) continue;
        outputs.push({
          outputClass: "FACTUAL_OBSERVATION" as const,
          content: {
            symbol,
            event: "earnings_call",
            announcedDate: d.fmt ?? new Date(d.raw * 1000).toISOString().slice(0, 10),
            isEstimate: false,
          },
          about: symbol,
        });
      }
      const consensus = earnings?.earningsAverage?.raw;
      if (consensus !== undefined) {
        outputs.push({
          outputClass: "FACTUAL_OBSERVATION" as const,
          content: {
            symbol,
            event: "consensus_eps_estimate",
            value: consensus,
            kind: "ESTIMATE",
            low: earnings?.earningsLow?.raw,
            high: earnings?.earningsHigh?.raw,
          },
          about: symbol,
        });
      }
      if (outputs.length === 0) {
        return {
          tool: this.providerId,
          capability,
          transport: "rest:query1.finance.yahoo.com",
          params: { ...params, symbol },
          rawReference: outcome.rawReference,
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `no earnings calendar data returned for ${symbol}` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: { type: "EMPTY_RESULT", message: `no calendar events for ${symbol}`, retriable: true },
          limitations: this.limitations,
        };
      }
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params: { ...params, symbol },
        rawReference: outcome.rawReference,
        outputs,
        completeness: "COMPLETE",
        freshness: "CURRENT",
        validation: "VALID",
        limitations: this.limitations,
      };
    } catch (error) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params: { ...params, symbol },
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Yahoo calendarEvents failed: ${error instanceof Error ? error.message : String(error)}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: error instanceof Error ? error.message : String(error), retriable: true },
        limitations: this.limitations,
      };
    }
  }

  private async ensureCrumb(): Promise<{ value: string; cookie: string }> {
    if (this.crumbCache !== undefined) return this.crumbCache;
    const cookieResp = await fetch("https://fc.yahoo.com", { headers: { "user-agent": YAHOO_UA } }).catch(() => undefined);
    const cookieHeader = cookieResp?.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ") ?? "";
    const crumbResp = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "user-agent": YAHOO_UA, ...(cookieHeader !== "" ? { cookie: cookieHeader } : {}) },
    });
    if (!crumbResp.ok) throw new Error(`HTTP ${crumbResp.status}`);
    const value = (await crumbResp.text()).trim();
    if (value === "" || value.length > 64) throw new Error("crumb response unusable");
    this.crumbCache = { value, cookie: cookieHeader };
    return this.crumbCache;
  }
}

// ---------------------------------------------------------------------------
// EQUITY_NEWS: Yahoo per-ticker RSS headline feed (secondary reporting).
// Complements the crypto RSS fallback; keyword filtering matches its contract.
// ---------------------------------------------------------------------------

const XML_TITLE = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
const XML_PUBDATE = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/;
const XML_ITEM = /<item[\s\S]*?<\/item>/g;

function parseFeedItems(xml: string, limit: number): { title: string; pubDate?: string; link?: string }[] {
  const items: { title: string; pubDate?: string; link?: string }[] = [];
  for (const match of xml.matchAll(XML_ITEM)) {
    const block = match[0];
    const title = XML_TITLE.exec(block)?.[1]?.trim();
    if (title === undefined) continue;
    const pubDate = XML_PUBDATE.exec(block)?.[1]?.trim();
    const link = /<link[^>]*>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim();
    items.push({ title, ...(pubDate !== undefined ? { pubDate } : {}), ...(link !== undefined ? { link } : {}) });
    if (items.length >= limit) break;
  }
  return items;
}

export class EquityNewsAdapter implements ProviderAdapter {
  readonly providerId = "equity/yahoo-headlines";
  readonly capabilities: readonly CapabilityName[] = ["EQUITY_NEWS", "NEWS_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "Yahoo Finance RSS headline feed: secondary reporting, not primary sources",
    "headline-level aggregation; company announcements should be confirmed against primary sources when material",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "rss";

  private readonly rest: RestTransport;
  private readonly rawCapture: { capture: (kind: string, label: string, body: string) => string };

  constructor(rest?: RestTransport) {
    this.rest = rest ?? new RestTransport({ baseUrl: "https://feeds.finance.yahoo.com", defaultHeaders: { "user-agent": YAHOO_UA } });
    // RawCapture lives on the transport layer; the rawReference comes back per outcome.
    this.rawCapture = { capture: () => "" };
    void this.rawCapture;
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "EQUITY_NEWS" && capability !== "NEWS_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const symbol = symbolOf(params);
    if (symbol === undefined) return schemaError(this.providerId, capability, params, "no ticker symbol resolved");
    const keyword = typeof params.keyword === "string" ? params.keyword.toLowerCase() : undefined;

    const outcome = await this.rest.get("/rss/2.0/headline", { params: { s: symbol, region: "US", lang: "en-US" }, responseType: "text" });
    const xml = typeof outcome.body === "string" ? outcome.body : String(outcome.body);
    const items = parseFeedItems(xml, 10).filter((i) => keyword === undefined || i.title.toLowerCase().includes(keyword));
    if (items.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:feeds.finance.yahoo.com",
        params: { ...params, symbol },
        rawReference: outcome.rawReference,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `no headlines for ${symbol}${keyword !== undefined ? ` matching "${keyword}"` : ""}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: `no headlines for ${symbol}`, retriable: true },
        limitations: this.limitations,
      };
    }
    return {
      tool: this.providerId,
      capability,
      transport: "rest:feeds.finance.yahoo.com",
      params: { ...params, symbol },
      rawReference: outcome.rawReference,
      outputs: items.map((item) => ({
        outputClass: "FACTUAL_OBSERVATION" as const,
        content: { title: item.title, publisher: "Yahoo Finance", publishedAt: item.pubDate, url: item.link, symbol },
        about: symbol,
      })),
      completeness: "COMPLETE",
      freshness: "CURRENT",
      validation: "VALID",
      limitations: this.limitations,
    };
  }
}

// ---------------------------------------------------------------------------
// Registry wiring: equity capabilities, Yahoo primary (priority 100)
// ---------------------------------------------------------------------------

export function registerEquityAdapters(registry: import("./capability-registry.js").CapabilityRegistry): void {
  registry.register(new EquityMarketDataAdapter());
  registry.register(new EquityFundamentalsAdapter());
  registry.register(new EarningsCalendarAdapter());
  registry.register(new EquityNewsAdapter());
}
