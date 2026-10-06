/**
 * GENERALIZATION regression tests (product-level mandate).
 *
 * The Bitcoin / 24-hour question is ONE case here, never the architecture. These tests prove the
 * ENGINE generalizes along four axes the product must support:
 *
 *   - RESOLUTION (granularity): a daily candle must not satisfy an hourly-sequence requirement,
 *     and a finer series must satisfy a coarser ask. Window span and sampling detail are
 *     separate axes.
 *   - TIME: temporal intent is parsed generally (rolling, calendar, explicit range, since-anchor,
 *     occurrence count) instead of a handful of hardcoded phrases.
 *   - MODES: a compound question chains its research modes (observation feeding a causal
 *     investigation feeding a thesis evaluation) instead of collapsing to one flow.
 *   - ASSETS: the market CLASS is derived for any known crypto asset, not a hardcoded few.
 *
 * Nothing here is asset-specific or phrasing-specific in the ENGINE; the phrases below are the
 * trader's natural language, which the engine must understand in general.
 */
import { describe, expect, it } from "vitest";
import {
  assessCoverage,
  completeRequirements,
  matchRequirement,
  requiredResolutionOf,
  subjectMarketClassOf,
  type CoverageEvidence,
} from "../../src/research/requirements.js";
import {
  impliedResolutionForWindow,
  intervalTokenFor,
  namedResolutionOf,
  resolutionCovers,
  resolutionOfStamps,
  resolutionOfTimeframe,
} from "../../src/research/resolution.js";
import { temporalIntentOf, temporalWindowHours } from "../../src/research/temporal.js";
import { chainedFlowsOf, primaryFlowOf } from "../../src/research/modes.js";
import { answerShapeFor, answerShapeGuidance } from "../../src/research/synthesis.js";
import { mentionsCryptoAsset } from "../../src/domain/instruments.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const OPTS = { subjectTerms: new Set(["BTC", "BITCOIN"]), questionMarketClass: "CRYPTO" as const, now: NOW };

/** A price series item with an explicit granularity and span, built directly for the gate. */
function series(symbol: string, resolution: string, coverageHours: number): CoverageEvidence {
  return {
    ref: `ev_${resolution}`,
    text: JSON.stringify({ symbol, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }),
    evidenceType: "CRYPTO_MARKET_DATA",
    freshness: "CURRENT",
    observedAt: NOW.toISOString(),
    subject: symbol,
    dataFacets: ["SERIES", "OPEN", "HIGH", "LOW", "CLOSE", "VOLUME", "TIMESTAMP"],
    coverageHours,
    resolution,
  };
}

// ---------------------------------------------------------------------------
// RESOLUTION
// ---------------------------------------------------------------------------

describe("resolution: granularity is a first-class dimension", () => {
  it("reads a named granularity from text, finest-wins", () => {
    expect(namedResolutionOf("hourly Bitcoin prices over the last 30 days")).toBe("HOUR");
    expect(namedResolutionOf("the daily close")).toBe("DAY");
    expect(namedResolutionOf("a 15-minute sequence")).toBe("MINUTE");
    expect(namedResolutionOf("weekly candles")).toBe("WEEK");
    expect(namedResolutionOf("the drivers behind Bitcoin")).toBeUndefined();
  });

  it("buckets declared bar sizes and measures payload spacing", () => {
    expect(resolutionOfTimeframe("1h")).toBe("HOUR");
    expect(resolutionOfTimeframe("4h")).toBe("HOUR");
    expect(resolutionOfTimeframe("15m")).toBe("MINUTE");
    expect(resolutionOfTimeframe("1d")).toBe("DAY");
    expect(resolutionOfTimeframe("1w")).toBe("WEEK");
    expect(resolutionOfTimeframe(undefined)).toBeUndefined();
    const hourly = Array.from({ length: 24 }, (_, i) => Date.parse("2026-10-05T12:00:00Z") + i * 3_600_000);
    expect(resolutionOfStamps(hourly)).toBe("HOUR");
    expect(resolutionOfStamps([hourly[0]!])).toBeUndefined(); // one print is sampled at no rate
  });

  it("a finer series covers a coarser ask; a coarser one never covers a finer ask", () => {
    expect(resolutionCovers("DAY", "HOUR")).toBe(true);
    expect(resolutionCovers("HOUR", "MINUTE")).toBe(true);
    expect(resolutionCovers("HOUR", "DAY")).toBe(false);
    expect(resolutionCovers("MINUTE", "HOUR")).toBe(false);
    expect(resolutionCovers("HOUR", undefined)).toBe(false); // unproven is not proven fine enough
  });

  it("window implies a request-resolution (provider selection, never the gate)", () => {
    expect(impliedResolutionForWindow(24)).toBe("HOUR");
    expect(impliedResolutionForWindow(1)).toBe("MINUTE");
    expect(impliedResolutionForWindow(24 * 365)).toBe("MONTH");
    expect(intervalTokenFor("HOUR")).toBe("1h");
    expect(intervalTokenFor("DAY")).toBe("1d");
  });

  it("req: a DAILY series does NOT satisfy an hourly-sequence row (the law)", () => {
    const req = {
      id: "rq_01", description: "Retrieve BTC hourly price sequence for the last 24 hours.",
      importance: "CRITICAL" as const, role: "CORE" as const, timeSensitivity: "CURRENT" as const,
      domains: ["PRICE_MARKET" as const], status: "PENDING" as const, evidenceRefs: [], staleOnlyRefs: [],
      recoveryAttempts: 0, engineRequired: false,
    };
    expect(requiredResolutionOf(req)).toBe("HOUR");
    expect(matchRequirement(req, series("BTCUSDT", "DAY", 48), OPTS)).not.toBe("SATISFIES");
    expect(matchRequirement(req, series("BTCUSDT", "HOUR", 24), OPTS)).toBe("SATISFIES");
    expect(matchRequirement(req, series("BTCUSDT", "MINUTE", 24), OPTS)).toBe("SATISFIES");
  });

  it("req: a finer series DOES satisfy a coarser row", () => {
    const req = {
      id: "rq_01", description: "Retrieve BTC daily closes for the last 30 days.",
      importance: "CRITICAL" as const, role: "CORE" as const, timeSensitivity: "CURRENT" as const,
      domains: ["PRICE_MARKET" as const], status: "PENDING" as const, evidenceRefs: [], staleOnlyRefs: [],
      recoveryAttempts: 0, engineRequired: false,
    };
    expect(matchRequirement(req, series("BTCUSDT", "HOUR", 24 * 30), OPTS)).toBe("SATISFIES");
    expect(matchRequirement(req, series("BTCUSDT", "WEEK", 24 * 30), OPTS)).not.toBe("SATISFIES");
  });

  it("fallback law: a coarser or wrong-shape payload is never a valid fallback for a series ask", () => {
    const req = {
      id: "rq_01", description: "Retrieve BTC hourly price sequence for the last 24 hours.",
      importance: "CRITICAL" as const, role: "CORE" as const, timeSensitivity: "CURRENT" as const,
      domains: ["PRICE_MARKET" as const], status: "PENDING" as const, evidenceRefs: [], staleOnlyRefs: [],
      recoveryAttempts: 0, engineRequired: false,
    };
    const ticker: CoverageEvidence = {
      ref: "ev_ticker", text: JSON.stringify({ symbol: "BTCUSDT", price: 85335 }),
      evidenceType: "CRYPTO_MARKET_DATA", freshness: "CURRENT", observedAt: NOW.toISOString(),
      subject: "BTCUSDT", dataFacets: ["SNAPSHOT", "CLOSE", "TIMESTAMP"], coverageHours: 0, resolution: "TICK",
    };
    const headline: CoverageEvidence = {
      ref: "ev_news", text: "Bitcoin traded actively overnight as traders repositioned.",
      evidenceType: "NEWS", freshness: "CURRENT", observedAt: NOW.toISOString(),
      subject: "bitcoin", sourceType: "SECONDARY",
    };
    expect(matchRequirement(req, ticker, OPTS)).not.toBe("SATISFIES");
    expect(matchRequirement(req, headline, OPTS)).not.toBe("SATISFIES");
  });
});

// ---------------------------------------------------------------------------
// TIME
// ---------------------------------------------------------------------------

describe("temporal intent: general, not a phrase list", () => {
  it("parses rolling windows, including sub-day horizons", () => {
    expect(temporalIntentOf("the last 24 hours", NOW)).toMatchObject({ kind: "ROLLING", hours: 24 });
    expect(temporalIntentOf("the last hour", NOW)).toMatchObject({ kind: "ROLLING", hours: 1 });
    expect(temporalIntentOf("the past 7 days", NOW)).toMatchObject({ kind: "ROLLING", hours: 168 });
    expect(temporalWindowHours(temporalIntentOf("the last 30 minutes", NOW))).toBeCloseTo(0.5);
  });

  it("parses calendar periods", () => {
    expect(temporalIntentOf("today", NOW)).toMatchObject({ kind: "CALENDAR", hours: 24 });
    expect(temporalIntentOf("this week", NOW)).toMatchObject({ kind: "CALENDAR", hours: 168 });
    expect(temporalIntentOf("this month", NOW)).toMatchObject({ kind: "CALENDAR", hours: 720 });
    expect(temporalWindowHours(temporalIntentOf("year to date", NOW))).toBeGreaterThan(0);
  });

  it("parses an explicit range, a since-anchor and an occurrence count (open-ended, no fake hours)", () => {
    expect(temporalIntentOf("the 2020-2021 cycle", NOW)).toMatchObject({ kind: "RANGE", from: 2020, to: 2021 });
    expect(temporalWindowHours(temporalIntentOf("2020-2021", NOW))).toBe(2 * 8_760);
    const since = temporalIntentOf("since the breakout", NOW);
    expect(since.kind).toBe("SINCE");
    expect(since.anchor).toContain("breakout");
    expect(temporalWindowHours(since)).toBeUndefined();
    const occ = temporalIntentOf("the previous three occurrences", NOW);
    expect(occ).toMatchObject({ kind: "OCCURRENCES", count: 3 });
    expect(temporalWindowHours(occ)).toBeUndefined();
  });

  it("a question naming no time dimension is OPEN, not a silent window", () => {
    const open = temporalIntentOf("the drivers behind Bitcoin", NOW);
    expect(open.kind).toBe("OPEN");
    expect(temporalWindowHours(open)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MODES
// ---------------------------------------------------------------------------

describe("research modes: a compound question chains its modes", () => {
  it("detects the primary mode and the chained modes", () => {
    expect(primaryFlowOf("What happened to BTC over the last 24 hours?")).toBe("WHAT_HAPPENED");
    const chain = chainedFlowsOf("Why did BTC fall, and does my bullish thesis still hold?");
    expect(chain).toContain("WHY_IT_HAPPENED");
    expect(chain).toContain("DOES_MY_THESIS_HOLD");
  });

  it("does NOT chain an incidental second pattern in a single-clause question", () => {
    // One clause that happens to contain two mode words is not two investigations.
    expect(chainedFlowsOf("Why did BTC fall")).toEqual(["WHY_IT_HAPPENED"]);
  });

  it("a compound run acquires the UNION of its modes' dimensions", () => {
    const compound = completeRequirements(
      "Why did BTC fall, and does my bullish thesis still hold?",
      [],
      { subject: "BTC", marketClass: "CRYPTO", flow: "DOES_MY_THESIS_HOLD" },
    );
    const text = compound.map((r) => r.description).join(" | ");
    expect(text).toMatch(/drivers and catalysts behind/i); // from the CAUSAL leg
    expect(text).toMatch(/supports the trader's stated thesis/i); // from the THESIS leg
  });

  it("a single-mode run acquires only its own mode's dimensions", () => {
    const single = completeRequirements(
      "Does my bullish thesis still hold?",
      [],
      { subject: "BTC", marketClass: "CRYPTO", flow: "DOES_MY_THESIS_HOLD" },
    );
    const text = single.map((r) => r.description).join(" | ");
    expect(text).toMatch(/thesis/i);
    expect(text).not.toMatch(/drivers and catalysts behind/i);
  });

  it("a factual reconstruction never acquires causal dimensions", () => {
    const obs = completeRequirements(
      "What happened to BTC over the last 24 hours?",
      [],
      { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" },
    );
    const text = obs.map((r) => r.description).join(" | ");
    expect(text).toMatch(/timeline|sequence|high|low|volume/i);
    expect(text).not.toMatch(/supply and producer side|mechanism|transmission/i);
  });
});

// ---------------------------------------------------------------------------
// ASSETS
// ---------------------------------------------------------------------------

describe("assets: the market class generalizes beyond the assets we enumerate", () => {
  it("classifies any known crypto asset as CRYPTO", () => {
    for (const q of ["What is XRP doing today?", "Is DOGE a buy?", "Compare SOL and ETH this week."]) {
      expect(subjectMarketClassOf(q)).toBe("CRYPTO");
    }
  });

  it("keeps the other market classes as taxonomies", () => {
    expect(subjectMarketClassOf("What is gold doing this week?")).toBe("METAL");
    expect(subjectMarketClassOf("crude oil supply this month")).toBe("COMMODITY");
    expect(subjectMarketClassOf("the 10-year treasury yield today")).toBe("RATES");
    expect(subjectMarketClassOf("AAPL earnings next week")).toBe("EQUITY");
  });

  it("the crypto registry answers the entity question word-boundedly", () => {
    expect(mentionsCryptoAsset("XRP and DOGE")).toBe(true);
    expect(mentionsCryptoAsset("bitcoin")).toBe(true);
    expect(mentionsCryptoAsset("one method for gold")).toBe(false); // no ETH inside "method"
  });
});

// ---------------------------------------------------------------------------
// ANSWER SHAPE
// ---------------------------------------------------------------------------

describe("answer shape: each mode owes its own structure", () => {
  it("a factual reconstruction owes a timeline, not drivers", () => {
    const shape = answerShapeFor("WHAT_HAPPENED");
    expect(shape.sections.join(" ")).toMatch(/timeline/i);
    expect(shape.sections.join(" ")).not.toMatch(/driver/i);
  });

  it("a thesis evaluation owes condition -> evidence -> status", () => {
    expect(answerShapeFor("DOES_MY_THESIS_HOLD").sections.join(" ")).toMatch(/thesis condition/i);
  });

  it("a falsification question owes falsification conditions", () => {
    expect(answerShapeFor("WHAT_COULD_PROVE_ME_WRONG").sections.join(" ")).toMatch(/falsification/i);
  });

  it("no resolved mode is GENERIC, and the guidance forbids payload dumps", () => {
    const generic = answerShapeFor(undefined);
    expect(generic.mode).toBe("GENERIC");
    expect(answerShapeGuidance(generic).join(" ")).toMatch(/traceability/i);
  });
});
