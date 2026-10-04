/**
 * Current market-regime observables: a REUSABLE capability provider.
 *
 * Family breadth (research mandate Part 5): the basket carries the market-implied macro
 * dimensions ANY regime/inflation-pressure requirement can need — long-curve and mid-curve
 * yields, front-end rate proxy, volatility, USD, broad equity, growth leadership (Nasdaq),
 * and the two inflation-channel commodities (gold, crude). Everything here is a keyless
 * delayed quote from one provider; nothing is derived, interpolated, or fabricated.
 *
 * Why it exists (live failure): a CURRENT macro question ("what macro conditions favor risk
 * assets right now") was answered with annual World Bank CPI/GDP while yields, volatility,
 * and the dollar were reported unavailable. Annual statistical releases are valid observations
 * but they are STALE for a CURRENT requirement (requirements.ts freshness law). This adapter
 * supplies the current, market-implied half of the macro picture from keyless public quotes.
 *
 * Genericity (no question routing): it serves the MACRO_ANALYSIS and MARKET_DATA_ANALYSIS
 * capabilities, so ANY requirement whose domain is MACRO (yield, volatility, USD, rate proxy,
 * index level) can be satisfied by it — regime questions, gold/FX questions, equity questions
 * sensitive to yields, crypto/macro linkage questions. The engine matches requirements to
 * capabilities; nothing here knows which question was asked.
 *
 * Epistemic honesty: these are delayed market QUOTES (quantitative observations), not
 * economic releases, not Fed policy text, and not analyst interpretation. Market-implied
 * series are labeled as such in the limitations; no value is derived or inferred.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RestTransport } from "./transports/rest.js";

const YAHOO_UA = "Mozilla/5.0 (compatible; LumenTerminal/1.0; research read-only)";

interface ChartQuoteResponse {
  readonly chart?: {
    readonly result?: readonly {
      readonly meta?: {
        readonly symbol?: string;
        readonly regularMarketPrice?: number;
        readonly chartPreviousClose?: number;
        readonly previousClose?: number;
        readonly currency?: string;
        readonly exchangeName?: string;
        readonly regularMarketTime?: number;
        readonly shortName?: string;
        readonly longName?: string;
      };
    }[];
    readonly error?: { readonly description?: string } | null;
  };
}

/**
 * Canonical regime instruments: the market-implied macro observables any MACRO requirement can
 * use, each with the UNIT its number is denominated in.
 *
 * UNITS ARE PART OF THE MEASUREMENT, not a label. Yahoo quotes these index series in POINTS
 * and reports `currency: "USD"` for all of them, which is how "10-year Treasury yield: 5.277
 * USD" reached a trader: a yield is not a dollar amount, an index level is not a currency, and
 * a stored observation that says otherwise is semantically wrong at the source — every
 * consumer downstream (evidence, answers, premise checks) would carry the mistake. Each
 * observable therefore declares what its number means, and the stored observation carries that
 * unit; the provider's `currency` field is kept ONLY for instruments that really are money.
 */
export type ObservableUnit = "percent_per_year" | "index_points" | "usd_per_troy_ounce" | "usd_per_barrel";

export const REGIME_OBSERVABLES: readonly { readonly symbol: string; readonly label: string; readonly measures: string; readonly unit: ObservableUnit }[] = [
  { symbol: "^TNX", label: "10-year Treasury yield", measures: "long-term risk-free rate, growth/inflation expectations", unit: "percent_per_year" },
  { symbol: "^FVX", label: "5-year Treasury yield", measures: "mid-curve risk-free rate, policy-rate expectations", unit: "percent_per_year" },
  { symbol: "^IRX", label: "13-week Treasury bill yield", measures: "front-end policy-rate proxy", unit: "percent_per_year" },
  { symbol: "^VIX", label: "CBOE volatility index", measures: "equity risk appetite / implied volatility", unit: "index_points" },
  { symbol: "DX-Y.NYB", label: "US dollar index", measures: "USD strength (global liquidity/risk channel)", unit: "index_points" },
  { symbol: "^GSPC", label: "S&P 500 index", measures: "broad equity risk-asset level", unit: "index_points" },
  { symbol: "^IXIC", label: "Nasdaq Composite index", measures: "growth/technology equity leadership, risk appetite", unit: "index_points" },
  { symbol: "GC=F", label: "Gold futures", measures: "safe-haven demand, real-rate/inflation hedging", unit: "usd_per_troy_ounce" },
  { symbol: "CL=F", label: "WTI crude oil futures", measures: "energy/inflation pressure, supply-demand balance", unit: "usd_per_barrel" },
];

/** Is this number an amount of money (so the provider's currency is meaningful)? */
function isMoneyUnit(unit: ObservableUnit): boolean {
  return unit === "usd_per_troy_ounce" || unit === "usd_per_barrel";
}

export class MarketRegimeAdapter implements ProviderAdapter {
  readonly providerId = "market/yahoo-regime-observables";
  readonly capabilities: readonly CapabilityName[] = ["MACRO_ANALYSIS", "MARKET_DATA_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "market-implied quotes (delayed index/yield/volatility series), not official economic releases or central-bank statements",
    "yields are index quotes (price terms), not bond analytics; volatility is implied, not realized",
    "no monetary-policy text, no credit spreads, no liquidity quantities",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "market:intraday";

  private readonly rest: RestTransport;

  constructor(rest?: RestTransport) {
    this.rest =
      rest ??
      new RestTransport({
        baseUrl: "https://query1.finance.yahoo.com",
        defaultHeaders: { "user-agent": YAHOO_UA, accept: "application/json" },
      });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "MACRO_ANALYSIS" && capability !== "MARKET_DATA_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    // When the caller names a specific regime instrument (or the engine's instrument
    // resolution produced one), serve that; otherwise serve the canonical basket.
    const requested = typeof params.asset === "string" ? params.asset.trim() : typeof params.symbol === "string" ? params.symbol.trim() : "";
    const wanted = requested === ""
      ? REGIME_OBSERVABLES
      : [...REGIME_OBSERVABLES.filter((o) => o.symbol.toUpperCase() === requested.toUpperCase()), ...REGIME_OBSERVABLES.slice(0, 0)];
    const observables = wanted.length > 0 ? wanted : REGIME_OBSERVABLES;

    const outputs: ToolOutput[] = [];
    const errors: string[] = [];
    let lastRaw: string | undefined;
    let observedAsOf: string | undefined;
    for (const observable of observables) {
      try {
        const outcome = await this.rest.get(`/v8/finance/chart/${encodeURIComponent(observable.symbol)}`, {
          params: { range: "5d", interval: "1d" },
        });
        lastRaw = outcome.rawReference;
        const body = typeof outcome.body === "string" ? (JSON.parse(outcome.body) as ChartQuoteResponse) : (outcome.body as ChartQuoteResponse);
        const meta = body.chart?.result?.[0]?.meta;
        if (meta === undefined || typeof meta.regularMarketPrice !== "number") {
          errors.push(`${observable.symbol}: no quote in response`);
          continue;
        }
        const previous = typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : undefined;
        const changePct = previous !== undefined && previous !== 0 ? ((meta.regularMarketPrice - previous) / previous) * 100 : undefined;
        const asOf = typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000).toISOString() : undefined;
        if (asOf !== undefined) observedAsOf = asOf;
        outputs.push({
          outputClass: "QUANTITATIVE_OBSERVATION",
          about: `${observable.label} (${observable.symbol})`,
          content: {
            metric: "market_regime_observable",
            instrument: observable.symbol,
            label: observable.label,
            measures: observable.measures,
            value: meta.regularMarketPrice,
            unit: observable.unit,
            ...(previous !== undefined ? { previousClose: previous } : {}),
            ...(changePct !== undefined ? { changePct: Number(changePct.toFixed(3)) } : {}),
            // The provider's currency field is a QUOTE CONVENTION (Yahoo reports USD for index
            // points too). It is carried only for instruments that are actually money; a yield
            // stored as "5.277 USD" is a wrong measurement, not a wrong label.
            ...(meta.currency !== undefined && isMoneyUnit(observable.unit) ? { currency: meta.currency } : {}),
            ...(asOf !== undefined ? { asOf } : {}),
            upstreamSource: "yahoo-finance",
          },
        });
      } catch (error) {
        errors.push(`${observable.symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (outputs.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:query1.finance.yahoo.com",
        params,
        ...(lastRaw !== undefined ? { rawReference: lastRaw } : {}),
        outputs: errors.map((e) => ({ outputClass: "UNAVAILABLE" as const, content: `market-regime observable error: ${e}` })),
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: `no market-regime observables retrieved: ${errors.join("; ")}`, retriable: true },
        limitations: this.limitations,
      };
    }
    return {
      tool: this.providerId,
      capability,
      transport: "rest:query1.finance.yahoo.com",
      params,
      ...(lastRaw !== undefined ? { rawReference: lastRaw } : {}),
      outputs,
      completeness: errors.length > 0 ? "PARTIAL" : "COMPLETE",
      freshness: "CURRENT",
      ...(observedAsOf !== undefined ? { eventTimestamp: observedAsOf } : {}),
      validation: "VALID",
      failure: { type: "NONE", retriable: false },
      limitations: this.limitations,
    };
  }
}
