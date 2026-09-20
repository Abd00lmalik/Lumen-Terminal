/**
 * Market-regime observables adapter tests; deterministic, scripted transport, no network.
 *
 * Laws under test:
 * - REUSABLE CAPABILITY: serves MACRO_ANALYSIS and MARKET_DATA_ANALYSIS; no question routing.
 * - OBSERVATIONS ONLY: QUANTITATIVE_OBSERVATION outputs carrying instrument, value, asOf,
 *   and upstreamSource provenance; never analysis or derived interpretation.
 * - REQUESTED INSTRUMENT: when the engine resolves a specific regime instrument, only that
 *   one is fetched.
 * - TYPED FAILURE: an unreachable upstream is PROVIDER_ERROR with UNAVAILABLE outputs and
 *   EMPTY completeness — never a fabricated value.
 */
import { describe, expect, it } from "vitest";
import { MarketRegimeAdapter, REGIME_OBSERVABLES } from "../../src/adapters/market-regime.js";
import { RestTransport } from "../../src/adapters/transports/rest.js";

function chartBody(symbol: string, price: number, previous: number): string {
  return JSON.stringify({
    chart: {
      result: [{ meta: { symbol, regularMarketPrice: price, chartPreviousClose: previous, currency: "USD", regularMarketTime: 1789000000 } }],
      error: null,
    },
  });
}

function fakeRest(responses: Record<string, string | number>): RestTransport {
  return new RestTransport({
    baseUrl: "https://query1.finance.yahoo.com",
    retryPolicy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 2, honorRetryAfter: false },
    fetchImpl: (async (url: string | URL | Request) => {
      const href = String(url);
      for (const [symbol, body] of Object.entries(responses)) {
        if (href.includes(encodeURIComponent(symbol))) {
          if (typeof body === "number") return new Response("upstream error", { status: body });
          return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
        }
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
  });
}

describe("market-regime observables", () => {
  it("serves the canonical regime basket as quantitative observations with provenance", async () => {
    const rest = fakeRest({
      "^TNX": chartBody("^TNX", 4.21, 4.18),
      "^IRX": chartBody("^IRX", 3.9, 3.88),
      "^VIX": chartBody("^VIX", 18.4, 17.9),
      "DX-Y.NYB": chartBody("DX-Y.NYB", 101.2, 101.6),
      "^GSPC": chartBody("^GSPC", 5600, 5580),
    });
    const adapter = new MarketRegimeAdapter(rest);
    const result = await adapter.execute("MACRO_ANALYSIS", {});
    expect(result.failure?.type).toBe("NONE");
    expect(result.completeness).toBe("COMPLETE");
    expect(result.freshness).toBe("CURRENT");
    expect(result.outputs?.length).toBe(REGIME_OBSERVABLES.length);
    for (const output of result.outputs ?? []) {
      expect(output.outputClass).toBe("QUANTITATIVE_OBSERVATION");
      const content = output.content as Record<string, unknown>;
      expect(typeof content.value).toBe("number");
      expect(content.upstreamSource).toBe("yahoo-finance");
      expect(content.asOf).toBeDefined();
    }
  });

  it("serves only the requested instrument when the engine resolved one", async () => {
    const rest = fakeRest({ "^TNX": chartBody("^TNX", 4.21, 4.18) });
    const adapter = new MarketRegimeAdapter(rest);
    const result = await adapter.execute("MARKET_DATA_ANALYSIS", { asset: "^TNX" });
    expect(result.outputs?.length).toBe(1);
    expect((result.outputs?.[0]?.content as Record<string, unknown>).instrument).toBe("^TNX");
  });

  it("an unreachable upstream is a typed PROVIDER_ERROR, never a fabricated value", async () => {
    const rest = fakeRest({ "^TNX": 500 });
    const adapter = new MarketRegimeAdapter(rest);
    const result = await adapter.execute("MACRO_ANALYSIS", { asset: "^TNX" });
    expect(result.failure?.type).toBe("PROVIDER_ERROR");
    expect(result.completeness).toBe("EMPTY");
    expect(result.outputs?.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
  });
});
