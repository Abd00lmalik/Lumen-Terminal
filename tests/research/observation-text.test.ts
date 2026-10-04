/**
 * READABLE OBSERVATION TEXT (presentation of frozen evidence bytes).
 *
 * The evidence object keeps exactly what the provider returned; this module renders those
 * same bytes as prose. The failure it pins is the accumulated-investigation surface answering
 * "what have we established" with raw transport payloads:
 *   Established: - {"title":"Circle Launches Wrapped Bitcoin...","publisher":"Yahoo Finance",...
 */
import { describe, expect, it } from "vitest";
import { readableObservation } from "../../src/research/observation-text.js";

describe("readableObservation", () => {
  it("renders a news payload as its headline, publisher and date, with no JSON and no URL", () => {
    const text = readableObservation(JSON.stringify({
      title: "Bitcoin ETF win streak comes to an end",
      publisher: "CoinDesk",
      publishedAt: "Thu, 01 Oct 2026 16:10:00 +0000",
      url: "https://www.coindesk.com/markets/2026/10/01/bitcoin-etf-win-streak",
    }));
    expect(text).toBe('"Bitcoin ETF win streak comes to an end", CoinDesk, 1 Oct 2026');
    expect(text).not.toContain("{");
    expect(text).not.toContain("http");
  });

  it("renders a crypto quote as the numbers a trader reads", () => {
    const text = readableObservation(JSON.stringify({
      coin: "bitcoin",
      priceUsd: 85285,
      change24hPct: 0.7820900902938607,
      marketCapUsd: 1713841563478.3252,
      volume24hUsd: 15027061341.655998,
      asOf: "2026-10-04T10:59:00.000Z",
      source: "CoinGecko",
    }));
    expect(text).toMatch(/bitcoin at 85,285 USD/);
    expect(text).toMatch(/24h \+0\.78%/);
    expect(text).toMatch(/market cap 1\.71T/);
    expect(text).toMatch(/CoinGecko/);
    expect(text).not.toContain("{");
  });

  it("renders a macro observable with its previous close", () => {
    const text = readableObservation(JSON.stringify({
      metric: "market_regime_observable",
      instrument: "^TNX",
      label: "10-year Treasury yield",
      value: 5.277,
      previousClose: 5.24,
      changePct: 0.706,
      unit: "percent_per_year",
      asOf: "2026-10-02T18:59:55.000Z",
    }));
    expect(text).toMatch(/10-year Treasury yield: 5\.28%/);
    expect(text).toMatch(/previous close 5\.24%/);
  });

  it("never reads a yield or an index level as an amount of money", () => {
    // The defect, verbatim from a manual test: "10-year Treasury yield: 5.28 USD".
    const yieldText = readableObservation(JSON.stringify({
      metric: "market_regime_observable",
      instrument: "^TNX",
      label: "10-year Treasury yield",
      value: 5.277,
      unit: "percent_per_year",
      // A provider quote convention that must NOT be read as the unit.
      currency: "USD",
    }));
    expect(yieldText).not.toMatch(/USD/);

    const indexText = readableObservation(JSON.stringify({
      metric: "market_regime_observable",
      instrument: "^VIX",
      label: "CBOE volatility index",
      value: 16.4,
      unit: "index_points",
      currency: "USD",
    }));
    expect(indexText).toMatch(/16\.4 index points/);
    expect(indexText).not.toMatch(/USD/);

    // Money stays money: a genuinely USD-denominated quote keeps its unit.
    const moneyText = readableObservation(JSON.stringify({
      metric: "market_regime_observable",
      instrument: "CL=F",
      label: "WTI crude oil futures",
      value: 71.4,
      unit: "usd_per_barrel",
      currency: "USD",
    }));
    expect(moneyText).toMatch(/71\.4 USD per barrel/);
  });

  it("summarises a month of candles without printing the series", () => {
    const text = readableObservation(JSON.stringify({
      month: "2023-10",
      candleCount: 2,
      candles: [
        { openTime: "2023-10-06T00:00:00.000Z", open: 27410.39, close: 27931.09 },
        { openTime: "2023-10-07T00:00:00.000Z", open: 27931.09, close: 28120.5 },
      ],
    }));
    expect(text).toBe("2023-10: 2 daily candles, open 27,410.39 to close 28,120.5");
  });

  it("falls back to key/value pairs for an unrecognised payload, dropping transport keys", () => {
    const text = readableObservation(JSON.stringify({ venue: "Binance", fundingRate: 0.0001, url: "https://x", id: "abc" }));
    expect(text).toBe("venue: Binance; fundingRate: 0");
    expect(text).not.toContain("https://x");
  });

  it("returns non-JSON observations unchanged and empty input untouched", () => {
    expect(readableObservation("Price rose steadily through the session")).toBe("Price rose steadily through the session");
    expect(readableObservation("   ")).toBe("   ");
  });

  it("never exceeds the length bound", () => {
    const text = readableObservation(JSON.stringify({ note: "x".repeat(2000) }), 80);
    expect(text.length).toBeLessThanOrEqual(80);
  });
});