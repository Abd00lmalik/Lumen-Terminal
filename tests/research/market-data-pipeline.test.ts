/**
 * MARKET-DATA RETRIEVAL PIPELINE regression tests (live run rs_000374).
 *
 * THE FAILURE these tests exist for: a "seven-day WTI crude oil price summary" returned
 * INSUFFICIENT / PARTIAL / LOW with TIME_BUDGET_EXHAUSTED. Its provenance showed a Yahoo chart
 * call for CL=F, yet the final evidence held no usable timestamped OHLCV series, and an
 * unrelated issuer's SEC filings were swept into the investigation.
 *
 * WHAT IS PROVEN HERE:
 *  - a windowed request is fetched over a range that COVERS it (a 7-day ask is not fetched
 *    over 5 days),
 *  - the WHOLE retrieved candle table travels as ONE timestamped observation, so a windowed
 *    requirement is matched by the data that actually answers it instead of only by 0-hour
 *    per-candle rows,
 *  - the requested window's open/high/low/close are derived ONLY from retrieved candles and are
 *    reproducible from the attached evidence (high/low are the candles' intraday fields),
 *  - insufficient coverage is stated explicitly and never satisfies the window,
 *  - a missing volume is omitted (never zero-filled) and cannot claim a VOLUME shape,
 *  - malformed/null/mismatched arrays are handled without fabricating or crashing,
 *  - a derivative/index/FX symbol (CL=F) never resolves to an unrelated issuer's filings, and
 *    an unrelated filing cannot concern the subject,
 *  - a failed provider falls back with its failure preserved and observable,
 *  - evidence counts reconcile with the attached evidence (no inflation),
 *  - and a single quote never completes a required time series (honest INSUFFICIENT).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { EquityMarketDataAdapter, rangeForWindowHours } from "../../src/adapters/equity.js";
import { SecEdgarAdapter } from "../../src/adapters/sec-edgar.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import type { ToolOutput, ToolResult } from "../../src/domain/tool-result.js";
import {
  assessCoverage,
  concernsSubject,
  coverageItemOf,
  coverageVerdict,
  distinctEvidenceCount,
  matchRequirement,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";

const NOW = new Date("2026-10-09T16:10:00.000Z");
const ORIGIN = { kind: "tool" as const, detail: "market-data-pipeline test", toolRef: "t", invocation: { params: {} } };
const OIL_TERMS = new Set(["CL=F", "OIL", "CRUDE", "WTI"]);
const OIL_OPTS = { subjectTerms: OIL_TERMS, questionMarketClass: "COMMODITY" as const, now: NOW };

beforeEach(() => resetIdCounters());

// ---------------------------------------------------------------------------
// Fixtures + transport doubles (real provider response shapes)
// ---------------------------------------------------------------------------

/** RestTransport double: records calls, serves per-path scripted bodies. */
function fakeRest(hosts: Record<string, () => unknown>) {
  const calls: { url: string; options: Record<string, unknown> }[] = [];
  const transport = {
    calls,
    rawCapture: { capture: (_k: string, label: string, _b: string) => `raw:${label}` },
    fetchImpl: async (input: string | URL | Request): Promise<Response> =>
      new Response(String(input).includes("getcrumb") ? "testcrumb" : "", { status: 200 }),
    async get(path: string, options: Record<string, unknown> = {}) {
      calls.push({ url: path, options });
      for (const [host, produce] of Object.entries(hosts)) {
        if (path.includes(host)) {
          return { body: produce(), rawReference: `raw:${host}${path}`, attempts: 1, durationMs: 1, status: 200 };
        }
      }
      throw new Error(`no fake for ${path}`);
    },
  };
  return transport as unknown as import("../../src/adapters/transports/rest.js").RestTransport & {
    calls: { url: string; options: Record<string, unknown> }[];
  };
}

/** The last `count` weekday (session) dates ending on `endIso`. */
function weekdayDates(endIso: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${endIso}T00:00:00Z`);
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

function candlesFor(dates: readonly string[]) {
  return dates.map((ts, i) => ({ ts, open: 90 + i, high: 92 + i, low: 88 + i, close: 90.5 + i, volume: 1000 + i }));
}

function yahooChart(
  timestamps: readonly number[],
  quote: Record<string, unknown>,
  meta: Record<string, unknown>,
) {
  return { chart: { result: [{ meta, timestamp: timestamps, indicators: { quote: [quote] } }] } };
}

function stampsOf(dates: readonly string[]): number[] {
  return dates.map((d) => Date.parse(`${d}T00:00:00Z`) / 1000);
}

/** Exactly the shape the equity adapter returns: one candle table + a live quote. */
function chartBody(rows: { ts: string; open: number; high: number; low: number; close: number; volume: number | null }[]) {
  const last = rows[rows.length - 1]!;
  return yahooChart(
    stampsOf(rows.map((r) => r.ts)),
    {
      open: rows.map((r) => r.open),
      high: rows.map((r) => r.high),
      low: rows.map((r) => r.low),
      close: rows.map((r) => r.close),
      volume: rows.map((r) => r.volume),
    },
    {
      symbol: "CL=F",
      regularMarketPrice: last.close,
      chartPreviousClose: last.close - 1,
      currency: "USD",
      fullExchangeName: "NY Mercantile",
      regularMarketTime: Date.parse(`${last.ts}T00:00:00Z`) / 1000,
      shortName: "Crude Oil",
    },
  );
}

/** The output whose payload carries the whole candle table. */
function seriesOutputOf(result: ToolResult): ToolOutput {
  const found = result.normalizedOutput.find((o) => Array.isArray((o.content as { candles?: unknown }).candles));
  if (found === undefined) throw new Error("no series output");
  return found;
}

/** Through the REAL ingestion boundary: facets/span/resolution are measured from the payload. */
function coverageFrom(result: ToolResult, output: ToolOutput): CoverageEvidence {
  return coverageItemOf(evidenceFromToolResult(result, output, ORIGIN, {}, NOW));
}

function requirement(description: string, over: Partial<ResearchRequirement> = {}): ResearchRequirement {
  return {
    id: "rq_01",
    description,
    importance: "CRITICAL",
    role: "CORE",
    timeSensitivity: "CURRENT",
    domains: ["PRICE_MARKET"],
    status: "PENDING",
    evidenceRefs: [],
    staleOnlyRefs: [],
    recoveryAttempts: 0,
    engineRequired: false,
    ...over,
  };
}

function snapshotItem(ref: string, identity: string): CoverageEvidence {
  return {
    ref,
    text: JSON.stringify({ symbol: "CL=F", price: 89.43, previousClose: 88.1, changePct: 1.5, asOf: "2026-10-09T15:57:15.000Z" }),
    evidenceType: "COMMODITY_MARKET_DATA",
    freshness: "CURRENT",
    observedAt: "2026-10-09T15:57:15.000Z",
    subject: "CL=F",
    sourceProvider: "rest:query1.finance.yahoo.com",
    sourceType: "PRIMARY",
    dataFacets: ["SNAPSHOT", "TIMESTAMP"],
    coverageHours: 0,
    resolution: "DAY",
    payloadIdentity: identity,
  };
}

// ---------------------------------------------------------------------------
// Windowed retrieval + the retrieved series as one observation
// ---------------------------------------------------------------------------

describe("market-data: windowed retrieval produces a real timestamped series", () => {
  it("rangeForWindowHours covers the requested lookback", () => {
    expect(rangeForWindowHours(undefined)).toBe("1mo"); // no window named → previous-week baseline
    expect(rangeForWindowHours(24 * 7)).toBe("1mo");
    expect(rangeForWindowHours(24 * 30)).toBe("1mo");
    expect(rangeForWindowHours(24 * 40)).toBe("3mo");
    expect(rangeForWindowHours(24 * 365)).toBe("1y");
    expect(rangeForWindowHours(24 * 400)).toBe("2y");
  });

  it("fetches a covering range and emits ONE series carrying the WHOLE candle table", async () => {
    const dates = weekdayDates("2026-10-09", 22);
    const rows = candlesFor(dates);
    const rest = fakeRest({ "v8/finance/chart": () => chartBody(rows) });
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(rest));

    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F", requiredWindowHours: 168 }, ORIGIN, NOW);
    expect(result.failure.type).toBe("NONE");
    const chartCall = rest.calls.find((c) => c.url.includes("v8/finance/chart"));
    expect((chartCall!.options.params as { range: string }).range).toBe("1mo");

    const series = seriesOutputOf(result);
    const content = series.content as { from: string; to: string; sessions: number; candles: { ts: string }[] };
    // FULL series, not the verbose per-candle list's `limit` (5): that truncation is what left a
    // 7-day window uncovered while the provider had already returned a month of candles.
    expect(content.candles.length).toBe(rows.length);
    expect(content.sessions).toBe(rows.length);
    expect(content.from).toBe(dates[0]);
    expect(content.to).toBe(dates[dates.length - 1]);

    const item = coverageFrom(result, series);
    expect(item.dataFacets).toEqual(expect.arrayContaining(["SERIES", "OHLC", "VOLUME", "WINDOW", "TIMESTAMP"]));
    expect(item.coverageHours ?? 0).toBeGreaterThanOrEqual(168);
    expect(item.resolution).toBe("DAY");

    // AND the series SATISFIES the seven-day windowed requirement (the live defect: it did not).
    const req = requirement("seven-day WTI crude oil price and volume summary with timestamped observations", {
      dataFacets: ["SERIES", "OHLC", "VOLUME", "TIMESTAMP", "WINDOW"],
      windowHours: 168,
    });
    expect(matchRequirement(req, item, OIL_OPTS)).toBe("SATISFIES");
    const assessed = assessCoverage([req], [item], OIL_OPTS);
    expect(assessed[0]!.status).toBe("SATISFIED");
    expect(distinctEvidenceCount(assessed[0]!)).toBe(1);
    expect(coverageVerdict(assessed).complete).toBe(true);
  });

  it("derives the requested window's open/high/low/close ONLY from retrieved candles", async () => {
    const dates = weekdayDates("2026-10-09", 22);
    const rows = candlesFor(dates);
    const rest = fakeRest({ "v8/finance/chart": () => chartBody(rows) });
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(rest));
    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F", requiredWindowHours: 168 }, ORIGIN, NOW);

    const summary = result.normalizedOutput.find((o) => (o.content as { metric?: string }).metric === "ohlcv_window");
    expect(summary).toBeDefined();
    const sc = summary!.content as {
      start: string;
      windowHours: number;
      sessions: number;
      open: number;
      high: number;
      low: number;
      close: number;
      coverageComplete: boolean;
      missingCoverage?: string;
      basis: string;
    };
    const cutoff = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 6); // 7 calendar days inclusive
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const expected = rows.filter((r) => r.ts >= cutoffIso);
    expect(sc.sessions).toBe(expected.length);
    expect(sc.open).toBe(expected[0]!.open);
    expect(sc.close).toBe(expected[expected.length - 1]!.close);
    expect(sc.high).toBe(Math.max(...expected.map((r) => r.high)));
    expect(sc.low).toBe(Math.min(...expected.map((r) => r.low)));
    expect(sc.basis).toContain("intraday high/low fields");
    // A calendar week of sessions is 5 trading days: the honest shortfall is stated, never hidden.
    expect(sc.coverageComplete).toBe(false);
    expect(sc.missingCoverage).toContain("of the requested 168h window");
  });

  it("states insufficient date coverage explicitly and never satisfies the window", async () => {
    const dates = weekdayDates("2026-10-09", 5); // Mon..Fri only: spans 120h
    const rest = fakeRest({ "v8/finance/chart": () => chartBody(candlesFor(dates)) });
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(rest));
    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F", requiredWindowHours: 168 }, ORIGIN, NOW);

    expect(result.limitations.some((l) => l.includes("coverage is reported as partial"))).toBe(true);
    const req = requirement("seven-day WTI crude oil price series with timestamped observations", {
      dataFacets: ["SERIES", "VOLUME"],
      windowHours: 168,
    });
    const item = coverageFrom(result, seriesOutputOf(result));
    expect(matchRequirement(req, item, OIL_OPTS)).toBe("NO_MATCH");
    const assessed = assessCoverage([req], [item], OIL_OPTS);
    expect(assessed[0]!.status).toBe("PENDING");
    expect(assessed[0]!.evidenceRefs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Missing volume + malformed arrays (never fabricate)
// ---------------------------------------------------------------------------

describe("market-data: missing volume and malformed arrays", () => {
  it("omits a missing volume (never zero-fills) and cannot claim a VOLUME shape", async () => {
    const dates = weekdayDates("2026-10-09", 22);
    const rows = candlesFor(dates).map((r) => ({ ...r, volume: null }));
    const rest = fakeRest({ "v8/finance/chart": () => chartBody(rows) });
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(rest));
    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F", requiredWindowHours: 168 }, ORIGIN, NOW);

    const series = seriesOutputOf(result);
    expect(JSON.stringify(series.content)).not.toContain('"volume":null');
    expect(JSON.stringify(series.content)).not.toContain('"volume":0');
    const item = coverageFrom(result, series);
    expect(item.dataFacets ?? []).not.toContain("VOLUME");
    const volReq = requirement("seven-day crude oil volume series for CL=F", { dataFacets: ["VOLUME", "SERIES"], windowHours: 168 });
    expect(matchRequirement(volReq, item, OIL_OPTS)).not.toBe("SATISFIES");
  });

  it("handles null/short/mismatched arrays safely without fabricating observations", async () => {
    const body = yahooChart(
      stampsOf(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]),
      {
        open: [90, 91], // shorter than timestamps
        high: [95, 96, 97, 98],
        low: [85, 86, 87, 88],
        close: [92, null, 94, 95],
        volume: [1000], // much shorter
      },
      { symbol: "CL=F", regularMarketPrice: 95, chartPreviousClose: 92, currency: "USD", regularMarketTime: 1789516800, shortName: "Crude Oil" },
    );
    const rest = fakeRest({ "v8/finance/chart": () => body });
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(rest));
    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F" }, ORIGIN, NOW);

    expect(result.failure.type).toBe("NONE");
    // Only row 0 has all of open/high/low/close; rows 1..3 are dropped, never backfilled.
    const candles = result.normalizedOutput.filter((o) => {
      const c = o.content as { ts?: string; open?: unknown };
      return typeof c.ts === "string" && typeof c.open === "number";
    });
    expect(candles).toHaveLength(1);
    // A single valid remainder is not a series (arity guard): no fabricated multi-candle table.
    expect(result.normalizedOutput.some((o) => Array.isArray((o.content as { candles?: unknown }).candles))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source relevance: unrelated issuers cannot be reached or admitted
// ---------------------------------------------------------------------------

describe("market-data: source relevance", () => {
  it("a futures/index/FX symbol never resolves to an unrelated issuer's filings", async () => {
    const companyTickers = { "0": { cik_str: 764065, ticker: "CLF", title: "CLEVELAND-CLIFFS INC." } };
    const sec = new SecEdgarAdapter({ fetchImpl: async () => new Response(JSON.stringify(companyTickers), { status: 200 }) });
    for (const symbol of ["CL=F", "^GSPC", "EURUSD=X", "DX-Y.NYB"]) {
      const res = await sec.execute("EQUITY_FUNDAMENTALS", { asset: symbol });
      expect(res.failure?.type).toBe("EMPTY_RESULT");
      expect(String(res.outputs?.[0]?.content)).toContain("no SEC registrant");
    }
    // A real corporate ticker still resolves (CLF is not blanket-refused).
    const clf = await sec.execute("EQUITY_FUNDAMENTALS", { asset: "CLF" });
    expect(String(clf.outputs?.[0]?.content ?? "")).not.toContain("no SEC registrant");
  });

  it("an unrelated issuer's filing does not concern a crude-oil subject", () => {
    // The collision that admitted Cleveland-Cliffs: `CL=F` squashed to `CLF`.
    expect(concernsSubject("CLEVELAND-CLIFFS INC. CLF 10-Q quarterly report", OIL_TERMS)).toBe(false);
    // ...while the futures form itself still matches (positive control).
    expect(concernsSubject("CL=F crude oil trades at 89.43.", new Set(["CL=F"]))).toBe(true);

    const filing: CoverageEvidence = {
      ref: "ev_sec",
      text: JSON.stringify({ kind: "filing_index_record", form: "10-Q", ticker: "CLF", edgarUrl: "https://www.sec.gov/Archives/edgar/data/764065/x" }),
      evidenceType: "EQUITY_FUNDAMENTALS",
      freshness: "CURRENT",
      observedAt: NOW.toISOString(),
      subject: "CLF",
      sourceType: "PRIMARY",
    };
    const mdReq = requirement("seven-day WTI crude oil volume series", { dataFacets: ["SERIES", "VOLUME"], windowHours: 168 });
    expect(matchRequirement(mdReq, filing, OIL_OPTS)).toBe("NO_MATCH");
    // A news/dated requirement for the oil subject is likewise not served by the unrelated filing.
    const newsReq = requirement("dated news developments for WTI crude oil", { dataFacets: ["REPORTED_EVENT"], timeSensitivity: "RECENT" });
    expect(matchRequirement(newsReq, filing, OIL_OPTS)).not.toBe("SATISFIES");
  });
});

// ---------------------------------------------------------------------------
// Bounded fallback + observable failure reason
// ---------------------------------------------------------------------------

describe("market-data: provider fallback stays observable", () => {
  it("a failed primary falls back to Stooq with the primary failure preserved", async () => {
    const dates = weekdayDates("2026-10-09", 10);
    const rows = candlesFor(dates);
    const csv = `Date,Open,High,Low,Close,Volume\n${rows.map((r) => `${r.ts},${r.open},${r.high},${r.low},${r.close},${r.volume}`).join("\n")}`;
    const rest = fakeRest({ "v8/finance/chart": () => { throw new Error("HTTP 429 edge rejection"); }, "q/d/l": () => csv });
    const registry = new CapabilityRegistry();
    registry.register(new EquityMarketDataAdapter(rest, rest));

    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F", requiredWindowHours: 168 }, ORIGIN, NOW);
    expect(result.failure.type).toBe("NONE");
    expect(result.limitations.some((l) => l.includes("Stooq CSV fallback"))).toBe(true);
    expect(result.normalizedOutput.some((o) => Array.isArray((o.content as { candles?: unknown }).candles))).toBe(true);
  });

  it("the registry preserves the attempted-provider trail when a provider throws", async () => {
    const registry = new CapabilityRegistry();
    const throwing = {
      providerId: "test/throwing-provider",
      capabilities: ["COMMODITY_MARKET_DATA"] as const,
      limitations: ["primary"],
      freshnessProfile: "test",
      async execute(): Promise<ToolInput> { throw new Error("provider outage"); },
    };
    registry.register(throwing as never, 100);
    const result = await registry.execute("COMMODITY_MARKET_DATA", { asset: "CL=F" }, ORIGIN, NOW);
    expect(result.failure.type).toBe("PROVIDER_ERROR");
    expect(result.failure.message).toContain("provider outage");
  });
});

// ---------------------------------------------------------------------------
// Evidence-count reconciliation + honest INSUFFICIENT
// ---------------------------------------------------------------------------

describe("market-data: evidence counts reconcile and insufficiency is honest", () => {
  it("the same evidence ref is never cited twice (counts match the attached evidence)", () => {
    const req = requirement("current crude oil price", { dataFacets: ["SNAPSHOT"] });
    const first = snapshotItem("ev_1", "identity-1");
    const sameRefDifferentIdentity: CoverageEvidence = { ...first, payloadIdentity: "identity-9" };
    const assessed = assessCoverage([req], [first, sameRefDifferentIdentity], OIL_OPTS);
    expect(assessed[0]!.evidenceRefs).toEqual(["ev_1"]);
    expect(assessed[0]!.duplicateEvidenceRefs).toEqual(["ev_1"]);
    expect(distinctEvidenceCount(assessed[0]!)).toBe(1);
  });

  it("distinctEvidenceCount counts distinct refs, not array length", () => {
    expect(distinctEvidenceCount({ evidenceRefs: ["e1", "e1", "e2"], duplicateEvidenceRefs: [] })).toBe(2);
    expect(distinctEvidenceCount({ evidenceRefs: [], duplicateEvidenceRefs: [] })).toBe(0);
  });

  it("one quote never completes a windowed series requirement", () => {
    const req = requirement("seven-day CL=F price and volume series with timestamps", {
      dataFacets: ["SERIES", "VOLUME", "TIMESTAMP"],
      windowHours: 168,
    });
    const assessed = assessCoverage([req], [snapshotItem("ev_q", "identity-q")], OIL_OPTS);
    expect(assessed[0]!.status).toBe("PENDING");
    expect(assessed[0]!.evidenceRefs).toEqual([]);
    const verdict = coverageVerdict(assessed);
    expect(verdict.complete).toBe(false);
    expect(verdict.blocking.map((r) => r.id)).toContain("rq_01");
  });
});

/** Local alias so the throwing-provider stub's return type is explicit. */
type ToolInput = Awaited<ReturnType<CapabilityRegistry["execute"]>>;
