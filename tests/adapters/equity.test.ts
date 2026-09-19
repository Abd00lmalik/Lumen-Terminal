/**
 * Equity capability tests (capability-expansion mandate §3–§9, §39); deterministic, no network.
 *
 * Laws under test:
 * - CAPABILITY COVERAGE: EQUITY_MARKET_DATA, EQUITY_FUNDAMENTALS, EARNINGS_CALENDAR,
 *   EQUITY_NEWS resolve through the generic registry; the engine asks for capabilities,
 *   never providers (no Flow→provider hardcoding).
 * - EPISTEMIC HONESTY: prices/OHLCV are QUANTITATIVE_OBSERVATION; fundamentals carry an
 *   explicit kind (HISTORICAL_ACTUAL / ESTIMATE / DERIVED_METRIC) so estimates can never
 *   masquerade as reported actuals; news is FACTUAL_OBSERVATION (secondary reporting).
 * - FALLBACK WITH PROVENANCE: when Yahoo chart fails, Stooq serves AND the limitation trail
 *   records the primary failure; the registry's attemptedProviders law is preserved.
 * - HONEST FAILURE: no data from any source → typed EMPTY_RESULT failure, UNAVAILABLE
 *   output, never fabricated evidence, never negative evidence.
 * - SCHEMA GUARD: a question without a resolved ticker yields SCHEMA_ERROR, not a crash.
 * - ARBITRARY SYMBOLS: no hardcoded ticker list (AAPL, MSFT, ZZTEST all resolve via params).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { EquityMarketDataAdapter, EquityFundamentalsAdapter, EarningsCalendarAdapter, EquityNewsAdapter } from "../../src/adapters/equity.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

beforeEach(() => resetIdCounters());

// ---------------------------------------------------------------------------
// Fetch fakes (mirror the real provider shapes probed live 2026-09-18)
// ---------------------------------------------------------------------------

const YAHOO_CHART_BODY = {
  chart: {
    result: [{
      meta: {
        symbol: "AAPL",
        regularMarketPrice: 337.0,
        chartPreviousClose: 326.57,
        currency: "USD",
        fullExchangeName: "NasdaqGS",
        regularMarketTime: 1758067200,
        shortName: "Apple Inc.",
      },
      timestamp: [1757980800, 1758067200],
      indicators: { quote: [{ open: [328.1, 330.2], high: [331.0, 338.0], low: [325.4, 329.9], close: [326.57, 337.0], volume: [41000000, 36632800] }] },
    }],
  },
};

const YAHOO_SUMMARY_BODY = {
  quoteSummary: {
    result: [{
      financialData: {
        totalRevenue: { raw: 416160000000 },
        grossMargins: { raw: 0.469 },
        targetMeanPrice: { raw: 260.5 },
        freeCashflow: { raw: 109800000000 },
      },
      defaultKeyStatistics: { marketCap: { raw: 4918238773248 }, sharesOutstanding: { raw: 14594180000 } },
      summaryDetail: { trailingPE: { raw: 41.2 } },
    }],
  },
};

const YAHOO_CALENDAR_BODY = {
  quoteSummary: {
    result: [{
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1793304000, fmt: "2026-10-29" }],
          isEarningsDateEstimate: false,
          earningsAverage: { raw: 1.98 },
        },
      },
    }],
  },
};

const YAHOO_RSS_XML = `<?xml version="1.0"?><rss><channel><item><title>Apple chip strategy</title><pubDate>Fri, 18 Sep 2026 06:00:00 +0000</pubDate><link>https://example.com/a</link></item><item><title>Apple supply chain</title><pubDate>Thu, 17 Sep 2026 23:00:00 +0000</pubDate><link>https://example.com/b</link></item></channel></rss>`;

const STOOQ_CSV = `Date,Open,High,Low,Close,Volume\n2026-09-16,325.0,330.0,324.5,326.57,40000000\n2026-09-17,330.2,338.0,329.9,337.0,36632800\n`;

/** RestTransport double: records calls, returns per-host scripted bodies. */
function fakeRest(hosts: Record<string, () => unknown>) {
  const calls: { url: string; options: Record<string, unknown> }[] = [];
  const transport = {
    calls,
    rawCapture: { capture: (_k: string, label: string, _b: string) => `raw:${label}` },
    async get(path: string, options: Record<string, unknown> = {}) {
      const url = `${path}`;
      calls.push({ url, options });
      for (const [host, produce] of Object.entries(hosts)) {
        if (url.includes(host)) {
          const body = produce();
          return { body, rawReference: `raw:${host}${path}`, attempts: 1, durationMs: 1, status: 200 };
        }
      }
      throw new Error(`no fake for ${path}`);
    },
  };
  return transport as unknown as import("../../src/adapters/transports/rest.js").RestTransport & { calls: { url: string; options: Record<string, unknown> }[] };
}

function yahooHosts(overrides: Partial<Record<"chart" | "summary" | "calendar" | "rss", () => unknown>> = {}) {
  return {
    "v8/finance/chart": overrides.chart ?? (() => YAHOO_CHART_BODY),
    "v10/finance/quoteSummary": overrides.summary ?? (() => YAHOO_SUMMARY_BODY),
    "rss/2.0/headline": overrides.rss ?? (() => YAHOO_RSS_XML),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Capability coverage + classification
// ---------------------------------------------------------------------------

describe("equity capabilities through the generic registry", () => {
  it("resolves equity capabilities without any Flow→provider hardcoding", () => {
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(fakeRest(yahooHosts())));
    registry.register(new EquityFundamentalsAdapter(fakeRest(yahooHosts())));
    registry.register(new EarningsCalendarAdapter(fakeRest(yahooHosts())));
    registry.register(new EquityNewsAdapter(fakeRest(yahooHosts())));
    expect(registry.resolve("EQUITY_MARKET_DATA").length).toBe(1);
    expect(registry.resolve("EQUITY_FUNDAMENTALS").length).toBe(1);
    expect(registry.resolve("EARNINGS_CALENDAR").length).toBe(1);
    expect(registry.resolve("EQUITY_NEWS").length).toBe(1);
    // The shared NEWS_ANALYSIS capability is also served (registry-level substitution).
    expect(registry.resolve("NEWS_ANALYSIS").map((r) => r.adapter.providerId)).toContain("equity/yahoo-headlines");
  });

  it("EQUITY_MARKET_DATA: live-quote observation + OHLCV observations, arbitrary symbols", async () => {
    const registry = new CapabilityRegistry();
    const rest = fakeRest(yahooHosts());
    registry.register(new EquityMarketDataAdapter(rest));
    for (const symbol of ["AAPL", "MSFT", "NVDA", "ZZTEST"]) {
      const result = await registry.execute("EQUITY_MARKET_DATA", { symbol, limit: 5 }, origin);
      expect(result.failure.type).toBe("NONE");
      expect(result.tool).toBe("equity/yahoo-chart");
      const quote = result.normalizedOutput[0]!;
      expect(quote.outputClass).toBe("QUANTITATIVE_OBSERVATION");
      expect((quote.content as { symbol: string }).symbol).toBe(symbol);
    }
    // The transport actually queried the requested ticker (no hardcoded list).
    expect(rest.calls.some((c) => c.url.includes("ZZTEST"))).toBe(true);
  });

  it("EQUITY_MARKET_DATA: week summaries + week-over-week comparison accompany the candles", async () => {
    // Live TSLA run: the synthesis received a 5-session trailing window yet claimed "lacks
    // historical price data from the previous week" because no prior-week baseline existed.
    // The adapter must derive latestWeek + previousWeek + the direct WoW comparison from the
    // retrieved candles when the range spans two weeks.
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(fakeRest(yahooHosts())));
    const result = await registry.execute("EQUITY_MARKET_DATA", { symbol: "TSLA", limit: 5 }, origin);
    expect(result.failure.type).toBe("NONE");
    const metrics = result.normalizedOutput.map((o) => (o.content as { metric?: string }).metric);
    const latest = result.normalizedOutput.find((o) => (o.content as { metric?: string }).metric === "ohlcv_latestWeek");
    expect(latest).toBeDefined();
    const lc = latest!.content as { weekOpen: number; weekClose: number; weekChangePct: number; sessions: number; basis: string };
    expect(typeof lc.weekOpen).toBe("number");
    expect(typeof lc.weekClose).toBe("number");
    expect(typeof lc.weekChangePct).toBe("number");
    // Single-week fixture (2 candles, one calendar week): latestWeek present; previousWeek/
    // WoW appear only when the retrieved range truly spans two weeks (never fabricated).
    expect(metrics).not.toContain("ohlcv_weekOverWeek");

    // Two-week fixture: both windows + the WoW comparison must appear.
    const chartTwoWeeks = {
      chart: {
        result: [{
          meta: { symbol: "TSLA", regularMarketPrice: 364.27, chartPreviousClose: 330, currency: "USD", fullExchangeName: "NasdaqGS", regularMarketTime: 1789516800, shortName: "Tesla, Inc." },
          // Two distinct calendar weeks in Sep 2026: Tue Sep 8, Wed Sep 9 (week 1) and
          // Mon Sep 14, Tue Sep 15, Wed Sep 16 (week 2, the latest).
          timestamp: [1788825600, 1788912000, 1789344000, 1789430400, 1789516800],
          indicators: { quote: [
            { open: [330.1, 332.0, 359.78, 358.75, 369.0], high: [331.0, 334.0, 367.73, 365.1, 370.9], low: [325.4, 328.0, 357.04, 354.85, 360.75], close: [330.5, 333.2, 366.2, 364.27, 364.27], volume: [41000000, 36632800, 51000000, 52000000, 51819200] },
          ] },
        }],
      },
    };
    const rest2 = fakeRest({ "v8/finance/chart": () => chartTwoWeeks });
    const registry2 = new CapabilityRegistry();
    registry2.register(new EquityMarketDataAdapter(rest2));
    const result2 = await registry2.execute("EQUITY_MARKET_DATA", { symbol: "TSLA", limit: 5 }, origin);
    const metrics2 = result2.normalizedOutput.map((o) => (o.content as { metric?: string }).metric);
    expect(metrics2).toContain("ohlcv_latestWeek");
    expect(metrics2).toContain("ohlcv_previousWeek");
    const wow = result2.normalizedOutput.find((o) => (o.content as { metric?: string }).metric === "ohlcv_weekOverWeek");
    expect(wow).toBeDefined();
    const wc = wow!.content as { previousWeekClose: number; latestWeekClose: number; weekOverWeekChangePct: number };
    expect(wc.previousWeekClose).toBeCloseTo(333.2, 1);
    expect(wc.latestWeekClose).toBeCloseTo(364.27, 1);
    expect(typeof wc.weekOverWeekChangePct).toBe("number");
  });

  it("EQUITY_MARKET_DATA defaults to a 1mo range so week-over-week windows exist", async () => {
    // 5d yielded exactly ONE calendar week; "compare with last week" had no baseline.
    const registry = new CapabilityRegistry();
    const rest = fakeRest(yahooHosts());
    registry.register(new EquityMarketDataAdapter(rest));
    await registry.execute("EQUITY_MARKET_DATA", { symbol: "TSLA" }, origin);
    const chartCall = rest.calls.find((c) => c.url.includes("v8/finance/chart"));
    expect((chartCall!.options.params as { range: string }).range).toBe("1mo");
  });

  it("EQUITY_FUNDAMENTALS: every field carries kind; estimates never presented as actuals", async () => {
    const registry = new CapabilityRegistry();
    registry.register(new EquityFundamentalsAdapter(fakeRest(yahooHosts())));
    const result = await registry.execute("EQUITY_FUNDAMENTALS", { symbol: "AAPL" }, origin);
    expect(result.failure.type).toBe("NONE");
    const contents = result.normalizedOutput.map((o) => o.content as { field: string; kind: string; value: unknown });
    const byField = new Map(contents.map((c) => [c.field, c]));
    expect(byField.get("totalRevenue")?.kind).toBe("HISTORICAL_ACTUAL");
    expect(byField.get("grossMargins")?.kind).toBe("DERIVED_METRIC");
    expect(byField.get("targetMeanPrice")?.kind).toBe("ESTIMATE");
    expect(byField.get("marketCap")?.value).toBe(4918238773248);
    for (const c of contents) expect(["HISTORICAL_ACTUAL", "ESTIMATE", "DERIVED_METRIC"]).toContain(c.kind);
  });

  it("EARNINGS_CALENDAR: announcement date preserved verbatim with its estimate flag", async () => {
    const registry = new CapabilityRegistry();
    registry.register(new EarningsCalendarAdapter(fakeRest(yahooHosts({ summary: () => YAHOO_CALENDAR_BODY }))));
    const result = await registry.execute("EARNINGS_CALENDAR", { symbol: "AAPL" }, origin);
    expect(result.failure.type).toBe("NONE");
    const announcement = result.normalizedOutput[0]!.content as { event: string; announcedDate: string; isEstimate: boolean };
    expect(announcement.event).toBe("earnings_announcement");
    expect(announcement.announcedDate).toBe("2026-10-29");
    expect(announcement.isEstimate).toBe(false);
  });

  it("EQUITY_NEWS: headline items are secondary-reporting observations with publisher + timestamp + url", async () => {
    const registry = new CapabilityRegistry();
    registry.register(new EquityNewsAdapter(fakeRest(yahooHosts())));
    const result = await registry.execute("EQUITY_NEWS", { symbol: "AAPL" }, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.normalizedOutput.length).toBe(2);
    const item = result.normalizedOutput[0]!;
    expect(item.outputClass).toBe("FACTUAL_OBSERVATION");
    expect((item.content as { publisher: string }).publisher).toBe("Yahoo Finance");
    expect((item.content as { url: string }).url).toContain("https://");
    expect(result.limitations.some((l) => l.includes("secondary reporting"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fallback + honest failure
// ---------------------------------------------------------------------------

describe("equity market data fallback and failure semantics", () => {
  it("Yahoo failure → Stooq serves with the primary failure preserved in limitations", async () => {
    const registry = new CapabilityRegistry();
    const rest = fakeRest({
      ...yahooHosts({ chart: () => { throw new Error("HTTP 429 edge rejection"); } }),
      "q/d/l": () => STOOQ_CSV,
    });
    registry.register(new EquityMarketDataAdapter(rest, rest));
    const result = await registry.execute("EQUITY_MARKET_DATA", { symbol: "AAPL" }, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toBe("equity/yahoo-chart"); // adapter id; Stooq served inside it
    expect(result.limitations.some((l) => l.includes("Stooq CSV fallback"))).toBe(true);
    const quote = result.normalizedOutput[0]!.content as { price: number; source: string };
    expect(quote.source).toBe("Stooq");
    expect(quote.price).toBe(337.0);
  });

  it("all sources empty → typed EMPTY_RESULT with UNAVAILABLE output; never fabricated evidence", async () => {
    const registry = new CapabilityRegistry();
    const rest = fakeRest({
      ...yahooHosts({
        chart: () => ({ chart: { result: [] } }), // Yahoo: no data
        "q/d/l": () => "Date,Open,High,Low,Close,Volume\n", // Stooq: header only
      }),
    });
    registry.register(new EquityMarketDataAdapter(rest, rest));
    const result = await registry.execute("EQUITY_MARKET_DATA", { symbol: "NOPE" }, origin);
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.completeness).toBe("EMPTY");
    expect(result.normalizedOutput[0]!.outputClass).toBe("UNAVAILABLE");
  });

  it("missing ticker symbol → typed SCHEMA_ERROR (a question without a target cannot fetch market data)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(fakeRest(yahooHosts())));
    const result = await registry.execute("EQUITY_MARKET_DATA", {}, origin);
    expect(result.failure.type).toBe("SCHEMA_ERROR");
    expect(result.normalizedOutput[0]!.outputClass).toBe("UNAVAILABLE");
  });

  it("named commodities resolve to real futures symbols (gold → GC=F) and return live-style observations", async () => {
    const registry = new CapabilityRegistry();
    const rest = fakeRest(yahooHosts());
    registry.register(new EquityMarketDataAdapter(rest));
    const result = await registry.execute("EQUITY_MARKET_DATA", { asset: "gold", limit: 5 }, origin);
    expect(result.failure.type).toBe("NONE");
    expect(decodeURIComponent(rest.calls[0]?.url ?? "")).toContain("GC=F");
    expect(result.normalizedOutput[0]!.outputClass).toBe("QUANTITATIVE_OBSERVATION");
  });

  it("crypto assets are quietly not-applicable in equity market data (EMPTY_RESULT, no failure noise)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(fakeRest(yahooHosts())));
    const result = await registry.execute("EQUITY_MARKET_DATA", { asset: "BTC" }, origin);
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.failure.message).toContain("not applicable");
    expect(result.normalizedOutput[0]!.outputClass).toBe("UNAVAILABLE");
  });

  it("empty RSS feed → typed EMPTY_RESULT (retrieval emptiness is technical, never negative evidence)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(new EquityNewsAdapter(fakeRest(yahooHosts({ rss: () => `<?xml version="1.0"?><rss><channel></channel></rss>` }))));
    const result = await registry.execute("EQUITY_NEWS", { symbol: "AAPL" }, origin);
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.normalizedOutput[0]!.outputClass).toBe("UNAVAILABLE");
  });

  it("registry-level failover: a failed equity news adapter hands off to a lower-priority NEWS_ANALYSIS provider", async () => {
    const registry = new CapabilityRegistry();
    const failingEquity: ProviderAdapter = {
      providerId: "equity/yahoo-headlines",
      capabilities: ["EQUITY_NEWS", "NEWS_ANALYSIS"],
      limitations: ["fake equity news"],
      freshnessProfile: "rss",
      async execute() { throw new Error("simulated Yahoo outage"); },
    };
    const workingFallback: ProviderAdapter = {
      providerId: "fallback/news-rss",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["fake crypto rss"],
      freshnessProfile: "rss",
      async execute() {
        return {
          tool: "fallback/news-rss",
          capability: "NEWS_ANALYSIS",
          transport: "web:rss",
          params: {},
          outputs: [{ outputClass: "FACTUAL_OBSERVATION" as const, content: { title: "market wide headline" } }],
          completeness: "COMPLETE" as const,
          freshness: "CURRENT" as const,
          validation: "VALID" as const,
          failure: { type: "NONE" as const, retriable: false },
        };
      },
    };
    registry.register(failingEquity, 100);
    registry.register(workingFallback, 200);
    const result = await registry.execute("NEWS_ANALYSIS", { symbol: "AAPL" }, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toBe("fallback/news-rss");
    // The primary's failure is preserved (never erased by the serving fallback).
    expect(result.limitations.some((l) => l.includes("provider fallback"))).toBe(true);
  });
});
