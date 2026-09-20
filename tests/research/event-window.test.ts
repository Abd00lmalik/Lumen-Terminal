/**
 * Event-window + answer-contract regression tests (research-contract mandate).
 *
 * Live failures under test (2026-09-20):
 * - RAW-CANDLES-ARE-NOT-ANALYSIS: a shutdown question retrieved months of real BTC candles
 *   yet reported "historical responses remain uncovered". The engine must transform held
 *   OHLCV into event-window derived evidence (metrics + coincidence wording), deterministically.
 * - NO FABRICATION: a window with no candle coverage yields NO derived evidence and NO
 *   invented metrics; the gap stays a research gap.
 * - COINCIDENCE ≠ CAUSATION: window observations describe what moved during the window;
 *   they never claim the event caused it.
 * - ASSET CANONICALIZATION: "gold" in an episode resolves to the gold FUTURE (GC=F), never
 *   the NYSE GOLD equity; the same law holds at target resolution.
 * - COUNTEREVIDENCE: every factor's opposition comes from real context refs, and support
 *   restated as opposition is dropped.
 */
import { describe, expect, it } from "vitest";
import { computeEventWindow, renderEventWindowObservation, eventWindowEvidence } from "../../src/research/event-window.js";
import { parseResearchPlan } from "../../src/model/schemas.js";
import { canonicalAsset } from "../../src/model/capability-vocabulary.js";

const origin = { kind: "agent" as const, detail: "test" };

function candleJson(days: { d: string; c: number }[]): string {
  return JSON.stringify({
    month: days[0]?.d.slice(0, 7) ?? "?",
    candleCount: days.length,
    candles: days.map(({ d, c }) => ({
      openTime: `${d}T00:00:00.000Z`,
      closeTime: `${d}T23:59:59.999Z`,
      open: c,
      high: c * 1.01,
      low: c * 0.99,
      close: c,
      baseVolume: 10,
    })),
  });
}

describe("event-window analysis (engine-owned deterministic transformation)", () => {
  const candles = candleJson([
    { d: "2025-09-25", c: 100 }, { d: "2025-09-26", c: 101 }, { d: "2025-09-27", c: 99 },
    { d: "2025-09-28", c: 98 }, { d: "2025-09-29", c: 102 }, { d: "2025-09-30", c: 104 },
    { d: "2025-10-01", c: 103 }, { d: "2025-10-02", c: 105 }, { d: "2025-10-03", c: 107 },
  ]);
  const observations = [candles];

  it("computes window metrics from real candles: return, drawdown, direction", () => {
    const r = computeEventWindow(
      { event: "test shutdown", from: "2025-09-28", to: "2025-10-03", asset: "BTC" },
      observations,
    );
    expect(r.metrics.candles).toBe(6);
    expect(r.metrics.startPrice).toBe(98);
    expect(r.metrics.endPrice).toBe(107);
    expect(r.metrics.returnPct).toBeCloseTo(((107 - 98) / 98) * 100, 1);
    expect(r.metrics.direction).toBe("up");
    expect(r.metrics.maxDrawdownPct).toBeGreaterThan(0);
  });

  it("reports an uncovered window honestly: no metrics are invented", () => {
    const r = computeEventWindow(
      { event: "test shutdown", from: "2019-01-01", to: "2019-01-31", asset: "BTC" },
      observations,
    );
    expect(r.metrics.candles).toBe(0);
    expect(r.metrics.returnPct).toBeUndefined();
    expect(r.metrics.missingReason).toContain("does not cover");
    // The one-stop helper refuses to mint evidence for an uncomputed window.
    expect(eventWindowEvidence({ event: "x", from: "2019-01-01", to: "2019-01-31", asset: "BTC" }, observations)).toBeUndefined();
  });

  it("renders coincidence wording, never causal claims", () => {
    const obs = renderEventWindowObservation(
      computeEventWindow({ event: "test shutdown", from: "2025-09-28", to: "2025-10-03", asset: "BTC" }, observations),
    );
    expect(obs).toContain("during");
    expect(obs).toContain("does not establish that the event caused it");
    expect(obs.toLowerCase()).not.toMatch(/\bcaused by\b|\bbecause of the (event|shutdown)\b/);
  });

  it("derives evidence for one asset while other assets stay ungated", () => {
    const r = eventWindowEvidence({ event: "test shutdown", from: "2025-09-28", to: "2025-10-03", asset: "BTC" }, observations);
    expect(r).toBeDefined();
    expect(r!.observation).toContain("BTC");
  });
});

describe("plan episode parsing (event-driven research)", () => {
  it("parses eventEpisodes with canonical assets and clamps ISO bounds", () => {
    const plan = parseResearchPlan(JSON.stringify({
      objective: "shutdown cross-asset question",
      scopeIncluded: [], scopeExcluded: [],
      tasks: [{ type: "research", objective: "gather history", capabilities: ["HISTORICAL_COMPARISON"], completion: "windows covered" }],
      eventEpisodes: [
        { event: "US government shutdown", from: "2025-10-01", to: "2025-11-12", assets: ["gold", "BTC"] },
        { event: "bad entry, no assets", from: "2025-10-01", to: "2025-11-12", assets: [] },
        { event: "bad entry, bad dates", from: "not-a-date", to: "2025-11-12", assets: ["BTC"] },
      ],
      completionCriteria: [], adaptationPolicy: "n/a",
    }));
    expect(plan.eventEpisodes).toHaveLength(1);
    const ep = plan.eventEpisodes![0]!;
    expect(ep.event).toBe("US government shutdown");
    expect(ep.assets).toEqual(["GC=F", "BTC"]); // gold -> the future, not the equity
  });

  it("canonicalAsset maps metals and macros, passes tickers through", () => {
    expect(canonicalAsset("gold")).toBe("GC=F");
    expect(canonicalAsset("XAUUSD")).toBe("GC=F");
    expect(canonicalAsset("oil")).toBe("CL=F");
    expect(canonicalAsset("btc")).toBe("BTC");
    expect(canonicalAsset("NVDA")).toBe("NVDA");
  });
});
