/**
 * FIELD-LEVEL COVERAGE regression tests (research-integrity mandate).
 *
 * THE REPRODUCTION these tests exist for, verbatim and never paraphrased:
 *
 *   "What was the Bitcoin price path during that 24-hour window? Give me the observed high,
 *    low, opening/reference price, closing/current price, timestamps, and volume. Use only
 *    market-data observations. If any of these are unavailable, explicitly say which ones
 *    are unavailable."
 *
 * It produced a single CoinGecko /simple/price snapshot
 *   {coin, priceUsd, change24hPct, marketCapUsd, volume24hUsd, asOf, source}
 * and then reported the requirement
 *   "Retrieve Bitcoin price sequence, high, low, and volume data for the last 24 hours."
 * as SATISFIED with 9 evidence, EVIDENCE_SUFFICIENT, GAPS: [] and an answer that said
 * "Nothing outstanding: every requirement of this question was established."
 *
 * WHAT IS PROVEN HERE — the coverage law, not the wording of any answer:
 *  - a requirement is decomposed into ATOMIC rows, one per requested data shape,
 *  - an observation may satisfy an atomic row ONLY by carrying the shape that row asks
 *    for and covering the window it asks for,
 *  - SUBJECT OVERFLOW IS NEVER COVERAGE: the asset name alone never satisfies a row,
 *  - a current snapshot is not a path, a 24h percentage change is not a high, and an
 *    aggregate 24h volume is not a windowed volume series,
 *  - reported news never satisfies a market-data shape by naming the asset,
 *  - byte-identical payloads from one provider response are ONE observation,
 *  - and when only the snapshot exists, the run ends with the missing SHAPES NAMED.
 *
 * Every negative case below FAILS against the pre-fix implementation (see the
 * git-stash negative control in the commit message): there, matchRequirement returns
 * SATISFIES for every one of them on subject overlap alone.
 */
import { describe, expect, it } from "vitest";
import {
  assessCoverage,
  CAPABILITY_SUPPORT,
  capabilitiesForRequirement,
  completeRequirements,
  coverageItemOf,
  distinctEvidenceCount,
  explicitWindowDays,
  mandatoryCapabilities,
  matchRequirement,
  requiredFacetsOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";
import { questionIntentOf, requiredDimensionsFor } from "../../src/research/question-resolution.js";
import { G1_CAPABILITIES } from "../../src/adapters/g1-historical.js";
import { CoinGeckoMarketDataAdapter } from "../../src/adapters/coingecko.js";
import { requestedWindowHours, servedFacets } from "../../src/research/data-facets.js";
import { gapsOf, renderObservationResponse } from "../../src/research/observation-response.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import type { Evidence } from "../../src/domain/objects.js";


/** The exact production question. Never paraphrased. */
const REPRO =
  "What was the Bitcoin price path during that 24-hour window? Give me the observed high, low, opening/reference price, closing/current price, timestamps, and volume. Use only market-data observations. If any of these are unavailable, explicitly say which ones are unavailable.";

/** The exact requirement the production UI reported as SATISFIED with 9 evidence. */
const PLANNER_ROW = "Retrieve Bitcoin price sequence, high, low, and volume data for the last 24 hours.";

const NOW = new Date("2026-10-05T16:00:00.000Z");
const ORIGIN = { kind: "tool" as const, detail: "test", toolRef: "t", invocation: { params: {} } };
const OPTS = { subjectTerms: new Set(["BTC", "BITCOIN"]), questionMarketClass: "CRYPTO" as const, now: NOW };

/**
 * The ONE observation the production run actually retrieved: a CoinGecko simple-price
 * snapshot. It contains a current price, a 24h percentage change, market cap, a rolling 24h
 * volume total and a single asOf instant. It contains NO high, NO low, NO open, NO close,
 * NO series and NO window boundary.
 */
const COINGECKO_SNAPSHOT: CoverageEvidence = (() => {
  const result = {
    tool: "fallback/coingecko-market",
    capability: "CRYPTO_MARKET_DATA",
    transport: "rest:api.coingecko.com",
    outputs: [
      {
        outputClass: "QUANTITATIVE_OBSERVATION" as const,
        content: {
          coin: "bitcoin",
          priceUsd: 85335,
          change24hPct: 0.002039,
          marketCapUsd: 1.7e12,
          volume24hUsd: 3.12e10,
          asOf: "2026-10-05T15:49:50.000Z",
          source: "CoinGecko",
        },
        about: "bitcoin",
      },
    ],
    validation: "VALID" as const,
    freshness: "CURRENT" as const,
    failure: { type: "NONE" as const, retriable: false },
    completeness: "COMPLETE" as const,
    limitations: [],
    sourceTimestamp: "2026-10-05T15:49:50.000Z",
  };
  return coverageItem(evidenceFromToolResult(result, result.outputs[0]!, ORIGIN, {}, NOW));
})();

/**
 * A genuinely windowed hourly candle set — the shape the question actually asked for.
 * Built through the REAL ingestion boundary so its facets and its spanned hours are measured
 * from the payload, never asserted by the test.
 */
function hourlyCandles(count = 24): CoverageEvidence {
  const start = Date.parse("2026-10-04T16:00:00.000Z");
  const rows = Array.from({ length: count }, (_, i) => ({
    ts: (start + i * 3_600_000) / 1000,
    open: 84000 + i * 50,
    high: 84100 + i * 55,
    low: 83950 + i * 45,
    close: 84050 + i * 50,
    baseVol: 1000 + i,
    quoteVol: 84_000_000 + i * 100_000,
  }));
  return coverageItem(
    evidenceFromCandles(rows, new Date(start + count * 3_600_000).toISOString()),
  );
}

function evidenceFromCandles(rows: readonly unknown[], sourceTimestamp: string): Evidence {
  const result = {
    tool: "bitget-signal/market-intel",
    capability: "CRYPTO_MARKET_DATA",
    transport: "mcp:crypto_market",
    outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION" as const, content: rows, about: "BTCUSDT", timeframe: "1h" }],
    validation: "VALID" as const,
    freshness: "CURRENT" as const,
    failure: { type: "NONE" as const, retriable: false },
    completeness: "COMPLETE" as const,
    limitations: [],
    sourceTimestamp,
  };
  return evidenceFromToolResult(result, result.outputs[0]!, ORIGIN, {}, NOW);
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

describe("field-level coverage: the atomic-shape law", () => {
  // -------------------------------------------------------------------------
  it("TEST A — a current snapshot must NOT satisfy a historical sequence requirement", () => {
    const req = requirement("Retrieve Bitcoin price sequence for the last 24 hours.");
    expect(matchRequirement(req, COINGECKO_SNAPSHOT, OPTS)).not.toBe("SATISFIES");
  });

  it("TEST B — a current snapshot must NOT satisfy a 24-hour high/low requirement", () => {
    const req = requirement("Retrieve Bitcoin's 24-hour high and low.");
    expect(matchRequirement(req, COINGECKO_SNAPSHOT, OPTS)).not.toBe("SATISFIES");
  });

  it("TEST C — a price-only snapshot must NOT satisfy a volume requirement", () => {
    const req = requirement("Retrieve Bitcoin volume for the last 24 hours.");
    const priceOnly: CoverageEvidence = {
      ...COINGECKO_SNAPSHOT,
      ref: "ev_price_only",
      text: JSON.stringify({ coin: "bitcoin", priceUsd: 85335, asOf: "2026-10-05T15:49:50.000Z" }),
    };
    expect(matchRequirement(req, priceOnly, OPTS)).not.toBe("SATISFIES");
  });

  it("TEST D — one timestamp is NOT hourly coverage for the last 24 hours", () => {
    const req = requirement("Retrieve hourly Bitcoin prices for the last 24 hours.");
    expect(matchRequirement(req, COINGECKO_SNAPSHOT, OPTS)).not.toBe("SATISFIES");
  });

  it("TEST E — properly windowed hourly OHLCV DOES satisfy the sequence requirement", () => {
    const req = requirement("Retrieve Bitcoin price sequence for the last 24 hours.");
    expect(matchRequirement(req, hourlyCandles(), OPTS)).toBe("SATISFIES");
  });

  it("TEST F — subject overlap alone is insufficient: news cannot satisfy a high/low requirement", () => {
    const req = requirement("Retrieve Bitcoin's 24-hour high and low.");
    const news: CoverageEvidence = {
      ref: "ev_news1",
      text: "Bitcoin climbed through the overnight session and price movement was heavy as traders repositioned.",
      evidenceType: "NEWS",
      subject: "bitcoin",
      observedAt: "2026-10-05T11:00:00.000Z",
      sourceProvider: "bitget-signal/news-briefing",
      sourceType: "SECONDARY",
    };
    expect(matchRequirement(req, news, OPTS)).not.toBe("SATISFIES");
  });

  it("TEST F2 — a 24h percentage change is NOT a 24-hour high or low", () => {
    const req = requirement("Retrieve Bitcoin's 24-hour high and low.");
    // The snapshot DOES carry change24hPct. That must not stand in for the high or the low.
    expect(COINGECKO_SNAPSHOT.text).toContain("change24hPct");
    expect(matchRequirement(req, COINGECKO_SNAPSHOT, OPTS)).not.toBe("SATISFIES");
  });

  it("TEST F3 — a current-price requirement IS satisfied by the snapshot (the positive control)", () => {
    const req = requirement("Retrieve the current Bitcoin price.");
    expect(matchRequirement(req, COINGECKO_SNAPSHOT, OPTS)).toBe("SATISFIES");
  });
});

describe("field-level coverage: the reported requirement decomposes", () => {
  it("the production ledger does not leave the field ask as one opaque row", () => {
    const ledger = completeRequirements(
      REPRO,
      [
        {
          ...requirement(PLANNER_ROW),
          evidenceClasses: ["OHLCV", "PRICE"],
          retrievalObjective: PLANNER_ROW,
        },
      ],
      { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" },
    );
    const text = ledger.map((r) => r.description).join(" | ");
    // Every requested shape is its own requirement, so one snapshot can satisfy at most
    // the shape it actually contains.
    expect(ledger.length).toBeGreaterThanOrEqual(4);
    expect(text).toMatch(/high/i);
    expect(text).toMatch(/low/i);
    expect(text).toMatch(/volume/i);
    expect(text).toMatch(/(sequence|path|timeline|chronolog)/i);
  });

  it("each decomposed row carries the facets it demands and the window it demands", () => {
    const ledger = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" });
    const withFacets = ledger.filter((r) => (r.dataFacets ?? []).length > 0);
    expect(withFacets.length).toBeGreaterThanOrEqual(3);
    const highRow = ledger.find((r) => /high/i.test(r.description) && !/low/i.test(r.description));
    expect(highRow?.dataFacets).toContain("HIGH");
    expect(requestedWindowHours(highRow?.description ?? "")).toBeGreaterThan(0);
  });

  it("TEST H — the snapshot-only run leaves the missing shapes as unresolved gaps", () => {
    const ledger = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" });
    const assessed = assessCoverage(ledger, [COINGECKO_SNAPSHOT], OPTS);
    const gaps = gapsOf(assessed);
    expect(gaps.length).toBeGreaterThan(0);
    expect(assessed.some((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED")).toBe(true);
  });

  it("TEST H2 — the rendered answer names what could not be established, and never claims completeness", () => {
    const ledger = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" });
    const assessed = assessCoverage(ledger, [COINGECKO_SNAPSHOT], OPTS);
    const rendered = renderObservationResponse({
      evidence: [evidenceOf("ev_cg1", COINGECKO_SNAPSHOT)],
      requirements: assessed,
    });
    expect(rendered.answer).not.toContain("Nothing outstanding");
    expect(rendered.answer.toLowerCase()).not.toContain("every requirement");
    expect(rendered.gaps.length).toBeGreaterThan(0);
  });

  it("TEST H3 — a properly windowed OHLCV run resolves the shape requirements it actually has", () => {
    const ledger = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" });
    const items = [hourlyCandles()];
    const assessed = assessCoverage(ledger, items, OPTS);
    expect(assessed.some((r) => r.status === "SATISFIED")).toBe(true);
    // A windowed candle set is not a completeness certificate: rows demanding something it
    // does not carry (a dated reported event, for instance) stay unresolved.
    const stillOpen = assessed.filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED");
    expect(stillOpen.map((r) => r.description).join(" ")).not.toMatch(/high|low/);
  });
});

describe("field-level coverage: temporal windows are checked explicitly", () => {
  it("reads a window from the requirement's own wording", () => {
    expect(requestedWindowHours("Retrieve Bitcoin price sequence for the last 24 hours.")).toBe(24);
    expect(requestedWindowHours("hourly Bitcoin prices for the last 24 hours")).toBe(24);
    expect(requestedWindowHours("the last 48 hours")).toBe(48);
    expect(requestedWindowHours("over the last 7 days")).toBe(168);
    expect(requestedWindowHours("today's Bitcoin price")).toBe(24);
    expect(requestedWindowHours("the drivers behind Bitcoin")).toBeUndefined();
  });

  it("a 48-hour ask is not met by 24 hours of candles", () => {
    const req = requirement("Retrieve Bitcoin price sequence for the last 48 hours.");
    expect(matchRequirement(req, hourlyCandles(24), OPTS)).not.toBe("SATISFIES");
    expect(matchRequirement(req, hourlyCandles(48), OPTS)).toBe("SATISFIES");
  });

  it("the window is read from the requirement, never from the payload's own age", () => {
    // Freshness law (unchanged): a CURRENT requirement tolerates a fresh quote. That law is
    // about AGE. Window coverage is a different axis and is checked separately.
    const req = requirement("Retrieve Bitcoin's current price.");
    expect(explicitWindowDays(req.description)).toBeUndefined();
    expect(requestedWindowHours(req.description)).toBeUndefined();
    expect(matchRequirement(req, COINGECKO_SNAPSHOT, OPTS)).toBe("SATISFIES");
  });
});

describe("field-level coverage: the measured shape and span REACH the matcher", () => {
  // These tests exist because the runners built their own CoverageEvidence field list and
  // omitted dataFacets, coverageHours and payloadIdentity. matchRequirement therefore saw no
  // span at all, and `windowCovers` refuses an unknown span: every window-bearing row became
  // unsatisfiable by ANY evidence. The unit fixtures above passed because they hand-built
  // coverage items; the browser scenarios missed it because they only asserted which rows were
  // left UNRESOLVED, never that a correct OHLCV payload could satisfy one.

  it("TEST I — the mapping carries the facets the ingestion boundary measured", () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      ts: (Date.parse("2026-10-04T16:00:00.000Z") + i * 3_600_000) / 1000,
      open: 84000 + i * 50, high: 84100 + i * 55, low: 83950 + i * 45,
      close: 84050 + i * 50, baseVol: 1000 + i,
    }));
    const item = coverageItem(evidenceFromCandles(rows, "2026-10-05T16:00:00.000Z"));
    expect(item.dataFacets).toEqual(expect.arrayContaining(["SERIES", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "TIMESTAMP"]));
    expect(item.coverageHours).toBeGreaterThanOrEqual(24);
    expect(item.payloadIdentity).toBeDefined();
  });

  it("TEST I2 — a snapshot carries no span, so it can never serve a windowed row", () => {
    const item = coverageItem(evidenceOf("ev_snap", COINGECKO_SNAPSHOT));
    expect(item.coverageHours).toBe(0);
    expect(item.dataFacets).toEqual(expect.arrayContaining(["SNAPSHOT", "CLOSE", "AGGREGATE_VOLUME"]));
    expect(item.dataFacets).not.toContain("HIGH");
    expect(item.dataFacets).not.toContain("LOW");
    expect(item.dataFacets).not.toContain("SERIES");
  });

  it("TEST I3 — real windowed candles SATISFY the sequence row through the production mapping", () => {
    // The mirror of the original defect: correct data must be able to establish what it has.
    const req = requirement("Retrieve Bitcoin price sequence for the last 24 hours.");
    const assessed = assessCoverage([req], [hourlyCandles()], OPTS);
    expect(assessed[0]?.status).toBe("SATISFIED");
    expect(assessed[0]?.evidenceRefs).toHaveLength(1);
  });

  it("TEST I4 — through the production mapping, a snapshot still cannot satisfy it", () => {
    const req = requirement("Retrieve Bitcoin price sequence for the last 24 hours.");
    const assessed = assessCoverage([req], [coverageItem(evidenceOf("ev_snap", COINGECKO_SNAPSHOT))], OPTS);
    expect(assessed[0]?.status).not.toBe("SATISFIED");
    expect(assessed[0]?.evidenceRefs).toHaveLength(0);
  });
});

describe("field-level coverage: duplicate payloads are one observation", () => {
  it("TEST G — the same byte-identical payload under two capability names is ONE observation", () => {
    const result = COINGECKO_RESULT();

    const first = evidenceFromToolResult(result, result.outputs[0]!, ORIGIN, {}, NOW);
    const second = evidenceFromToolResult(
      { ...result, capability: "MARKET_DATA_ANALYSIS" },
      { ...result, capability: "MARKET_DATA_ANALYSIS" }.outputs[0]!,
      ORIGIN,
      {},
      NOW,
    );

    expect(first.id).not.toBe(second.id);
    expect(first.observation).toBe(second.observation);
    // Same underlying provider response ⇒ one payload identity.
    expect(first.payloadIdentity).toBeDefined();
    expect(first.payloadIdentity).toBe(second.payloadIdentity);

    const req = requirement("Retrieve the current Bitcoin price.");
    const assessed = assessCoverage([req], [coverageItem(first), coverageItem(second)], OPTS);
    // Both evidence OBJECTS still exist with their own ids and capability attribution —
    // provenance is not erased. What must not happen is the requirement counting them as two
    // facts: the row cites ONE observation and records the re-served copy as a duplicate.
    expect(assessed[0]?.evidenceRefs.length).toBe(1);
    expect(assessed[0]?.duplicateEvidenceRefs).toEqual([second.id]);
    expect(assessed[0]?.sourceDiversity).toBe(1);
    expect(assessed[0]?.status).toBe("SATISFIED");
  });

  it("TEST G3 — the informational evidence count the UI reports cannot inflate", () => {
    const result = COINGECKO_RESULT();
    const first = evidenceFromToolResult(result, result.outputs[0]!, ORIGIN, {}, NOW);
    const second = evidenceFromToolResult(
      { ...result, capability: "MARKET_DATA_ANALYSIS" },
      { ...result, capability: "MARKET_DATA_ANALYSIS" }.outputs[0]!,
      ORIGIN,
      {},
      NOW,
    );
    const assessed = assessCoverage(
      [requirement("Retrieve the current Bitcoin price.")],
      [coverageItem(first), coverageItem(second)],
      OPTS,
    );
    // What the trader reads as "N observations" is the distinct set, not the re-served copies.
    expect(distinctEvidenceCount(assessed[0]!)).toBe(1);
  });

  it("TEST G2 — genuinely distinct payloads are not collapsed", () => {
    const a = evidenceOf("ev_a", { ...COINGECKO_SNAPSHOT, ref: "ev_a" });
    const b = evidenceOf("ev_b", {
      ...COINGECKO_SNAPSHOT,
      ref: "ev_b",
      text: JSON.stringify({ coin: "bitcoin", priceUsd: 86100, asOf: "2026-10-05T14:00:00.000Z" }),
      observedAt: "2026-10-05T14:00:00.000Z",
    });
    expect(a.payloadIdentity).not.toBe(b.payloadIdentity);
  });
});

describe("field-level coverage: what the snapshot can still serve", () => {
  it("serves a current-state row and nothing else", () => {
    const served = servedFacets(COINGECKO_SNAPSHOT);
    expect(served).toContain("SNAPSHOT");
    // A spot print IS the last close, so CLOSE is honest here — and is exactly why the WINDOW
    // check exists: the snapshot still cannot answer "the closing price OVER that window".
    expect(served).toContain("CLOSE");
    expect(served).not.toContain("SERIES");
    expect(served).not.toContain("HIGH");
    expect(served).not.toContain("LOW");
    expect(served).not.toContain("OPEN");
    expect(served).not.toContain("WINDOW");
    // And it spans nothing: fresh, and covering zero hours.
    expect(COINGECKO_SNAPSHOT.coverageHours).toBe(0);
  });

  it("serves every shape a windowed candle set carries", () => {
    const served = servedFacets(hourlyCandles());
    for (const facet of ["SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"] as const) {
      expect(served).toContain(facet);
    }
  });

  it("an aggregate 24h volume total is not a windowed volume series", () => {
    // CoinGecko's volume24hUsd is a rolling total with no window boundary and no series.
    expect(servedFacets(COINGECKO_SNAPSHOT)).not.toContain("VOLUME");
    expect(servedFacets(COINGECKO_SNAPSHOT)).toContain("AGGREGATE_VOLUME");
  });

  it("a windowed close is still unsatisfied by the snapshot the window check applies", () => {
    // The snapshot serves CLOSE as a shape, and still cannot answer a WINDOWED close: this is
    // the separation the freshness law never made on its own.
    const unwindowed = requirement("Retrieve the current Bitcoin price.");
    const windowed = requirement("Retrieve Bitcoin's closing price for the last 24 hours.");
    expect(matchRequirement(unwindowed, COINGECKO_SNAPSHOT, OPTS)).toBe("SATISFIES");
    expect(matchRequirement(windowed, COINGECKO_SNAPSHOT, OPTS)).not.toBe("SATISFIES");
  });
});

/** The exact CoinGecko simple-price tool result the production run served, as a factory. */
function COINGECKO_RESULT() {
  return {
    tool: "fallback/coingecko-market",
    capability: "CRYPTO_MARKET_DATA",
    transport: "rest:api.coingecko.com",
    params: { coinId: "bitcoin" },
    outputs: [
      {
        outputClass: "QUANTITATIVE_OBSERVATION" as const,
        content: {
          coin: "bitcoin",
          priceUsd: 85335,
          change24hPct: 0.002039,
          marketCapUsd: 1.7e12,
          volume24hUsd: 3.12e10,
          asOf: "2026-10-05T15:49:50.000Z",
          source: "CoinGecko",
        },
        about: "bitcoin",
      },
    ],
    completeness: "COMPLETE" as const,
    freshness: "CURRENT" as const,
    validation: "VALID" as const,
    failure: { type: "NONE" as const, retriable: false },
    sourceTimestamp: "2026-10-05T15:49:50.000Z",
  };
}

describe("field-level coverage: the capability layer sees shapes too", () => {
  it("reads the reported question as a reconstruction, not a current-state question", () => {
    // It never says "what happened"; it enumerates observational fields. Shape beats phrasing.
    expect(questionIntentOf(REPRO)).toBe("WHAT_HAPPENED");
    expect(requiredDimensionsFor(questionIntentOf(REPRO))).toEqual(["WHAT_HAPPENED", "RECENCY"]);
  });

  it("never schedules a commodity chain for a crypto subject", () => {
    // The production floor resolved COMMODITY_MARKET_DATA + CRYPTO_MARKET_DATA on an
    // alphabetical tie-break; the commodity chain had ZERO providers and burned the round.
    const ledger = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" });
    const floor = mandatoryCapabilities(ledger, { isAvailable: () => true, marketClass: "CRYPTO" });
    expect(floor).not.toContain("COMMODITY_MARKET_DATA");
    expect(floor).not.toContain("FX_MARKET_DATA");
    expect(floor).not.toContain("EQUITY_MARKET_DATA");
    expect(floor[0]).toBe("CRYPTO_MARKET_DATA");
  });

  it("a capability that declares the demanded shapes outranks one that cannot produce them", () => {
    const seriesRow = requirement("Retrieve Bitcoin price sequence for the last 24 hours.");
    const ranked = capabilitiesForRequirement(seriesRow, { marketClass: "CRYPTO" });
    expect(ranked[0]).toBe("CRYPTO_MARKET_DATA");
    expect(CAPABILITY_SUPPORT.CRYPTO_MARKET_DATA.facets).toContain("SERIES");
    expect(CAPABILITY_SUPPORT.NEWS_ANALYSIS.facets).not.toContain("SERIES");
  });

  it("the exchange candle provider that could answer this question is reachable", () => {
    // G1 serves real OHLCV from Bitget/Binance Vision. It was registered for historical
    // comparison alone, so a plain "the last 24 hours" question could never reach it.
    expect(G1_CAPABILITIES).toContain("CRYPTO_MARKET_DATA");
    expect(G1_CAPABILITIES).toContain("HISTORICAL_COMPARISON");
  });

  it("CoinGecko declares only the shapes it actually serves", () => {
    const adapter = new CoinGeckoMarketDataAdapter();
    expect(adapter.dataFacets).toContain("SNAPSHOT");
    expect(adapter.dataFacets).not.toContain("SERIES");
    expect(adapter.dataFacets).not.toContain("HIGH");
    expect(adapter.dataFacets).not.toContain("LOW");
    expect(adapter.dataFacets).not.toContain("VOLUME");
  });

  it("a requirement naming no data shape is untouched by the facet law", () => {
    for (const text of [
      "the current drivers and catalysts behind BTC",
      "evidence that weakens or contradicts the leading conclusion",
      "support for the trader's thesis that BTC weakens",
      "transmission evidence for how the move in oil reached inflation",
    ]) {
      expect(requiredFacetsOf({ description: text, engineRequired: false }).size).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------


function evidenceOf(id: string, item: CoverageEvidence): Evidence {
  const result = {
    tool: item.sourceProvider ?? "test-provider",
    capability: item.evidenceType ?? "CRYPTO_MARKET_DATA",
    transport: "test:transport",
    outputs: [
      {
        outputClass: "QUANTITATIVE_OBSERVATION" as const,
        content: safeJson(item.text),
        ...(item.subject !== undefined ? { about: item.subject } : {}),
      },
    ],
    validation: "VALID" as const,
    freshness: "CURRENT" as const,
    failure: { type: "NONE" as const, retriable: false },
    completeness: "COMPLETE" as const,
    limitations: [],
    ...(item.observedAt !== undefined ? { sourceTimestamp: item.observedAt } : {}),
  };
  return evidenceFromToolResult(result, result.outputs[0]!, ORIGIN, {}, NOW);
}

/**
 * THE PRODUCTION MAPPING, used directly.
 *
 * This used to be a LOCAL copy of the Evidence -> CoverageEvidence field list. That is how the
 * real defect survived a green suite: the copy carried `dataFacets`, `coverageHours` and
 * `payloadIdentity`, while the runners dropped all three. Every test passed against a mapping
 * no production request ever uses. It is the engine's own function now, so a field the matcher
 * depends on cannot be forgotten here without also breaking these tests.
 */
function coverageItem(e: Evidence): CoverageEvidence {
  return coverageItemOf(e);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}