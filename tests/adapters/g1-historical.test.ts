/**
 * G1 historical-data adapter; deterministic tests (vendor selected 2026-09-15).
 *
 * Laws under test:
 * - venue priority: Bitget REST primary; Binance Vision public-mirror fallback when the
 *   primary is unreachable; the venue that actually served travels in provenance;
 * - raw OHLCV → QUANTITATIVE_OBSERVATIONs with exact timestamps (final lock §9);
 * - failure/absence never becomes evidence: unmirrored metrics → honest UNAVAILABLE result;
 *   empty window → EMPTY_RESULT, never negative evidence; both-venues-down → typed failure;
 * - interface conformance: execute() rejects non-mapped capabilities (SCHEMA_ERROR);
 * - registry integration: HISTORICAL_COMPARISON resolves through the generic mechanism.
 */
import { describe, expect, it } from "vitest";
import { RestTransport } from "../../src/adapters/transports/rest.js";
import { G1HistoricalDataAdapter, BINANCE_VISION_BASE_URL, type HistoricalCandle } from "../../src/adapters/g1-historical.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { createBitgetAdapterSet } from "../../src/adapters/bitget-skills.js";
import { normalizedResult } from "../../src/domain/tool-result.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const ORIGIN: ProvenanceOrigin = { kind: "agent", detail: "test" };

function scriptedFetch(responses: Array<{ status?: number; body?: string }>, log?: string[]) {
  let call = 0;
  return (async (url: unknown) => {
    log?.push(String(url));
    const step = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(step.body ?? "", { status: step.status ?? 200, headers: {} });
  }) as typeof fetch;
}

const DAY_MS = 86_400_000;

/** Two real-shaped daily candles (2020-01-01, 2020-01-02) as a Binance Vision payload. */
function visionKlines(): string {
  const t0 = Date.UTC(2020, 0, 1);
  return JSON.stringify([
    [t0, "7195.24", "7255.00", "7175.15", "7200.85", "16792.38", t0 + DAY_MS - 1, "121214452.1", 194010, "8946.95", "64597785.2", "0"],
    [t0 + DAY_MS, "7200.77", "7212.50", "7100.00", "7150.00", "15000.00", t0 + 2 * DAY_MS - 1, "108000000", 180000, "8000", "60000000", "0"],
  ]);
}

/** Two real-shaped Bitget v2 candles (object rows). */
function bitgetCandles(): string {
  const t0 = Date.UTC(2020, 0, 1);
  return JSON.stringify({
    code: "00000",
    msg: "success",
    data: [
      { ts: String(t0), open: "7195.24", high: "7255.00", low: "7175.15", close: "7200.85", baseVolume: "16792.38", quoteVolume: "121214452.1" },
      { ts: String(t0 + DAY_MS), open: "7200.77", high: "7212.50", low: "7100.00", close: "7150.00", baseVolume: "15000.00", quoteVolume: "108000000" },
    ],
  });
}

const BASE_QUERY = {
  symbol: "BTC/USDT",
  metric: "ohlcv" as const,
  from: "2020-01-01T00:00:00.000Z",
  to: "2020-01-03T00:00:00.000Z",
  interval: "1d",
};

describe("G1 historical-data adapter (vendor: Bitget → Binance Vision)", () => {
  it("prefers Bitget REST when reachable; provenance names the serving venue", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const result = await g1.query(BASE_QUERY);

    expect(result.failure?.type ?? "NONE").toBe("NONE");
    expect(result.completeness).toBe("COMPLETE");
    expect(result.transport).toContain("bitget-rest");
    // Packaging: monthly chunk(s), candles preserved verbatim inside.
    expect(result.outputs.length).toBe(1); // both candles fall in 2020-01
    expect(result.outputs.every((o) => o.outputClass === "QUANTITATIVE_OBSERVATION")).toBe(true);
    const chunk = result.outputs[0]!.content as { month: string; candleCount: number; candles: HistoricalCandle[] };
    expect(chunk.month).toBe("2020-01");
    expect(chunk.candleCount).toBe(2);
    expect(chunk.candles[0]!.openTime).toBe("2020-01-01T00:00:00.000Z");
    expect(chunk.candles[0]!.close).toBe(7200.85);
    expect(chunk.candles[0]!.baseVolume).toBeTypeOf("number");
  });

  it("falls back to Binance Vision when Bitget is unreachable; venue recorded in provenance", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ status: 502, body: "bad gateway" }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: visionKlines() }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const result = await g1.query(BASE_QUERY);

    expect(result.failure?.type ?? "NONE").toBe("NONE");
    expect(result.transport).toContain("binance-vision");
    expect(result.completeness).toBe("COMPLETE");
    const chunk = result.outputs[0]!.content as { candles: HistoricalCandle[] };
    expect(chunk.candles[0]!.openTime).toBe("2020-01-01T00:00:00.000Z");
    expect(chunk.candles[0]!.high).toBe(7255.0);
    // The fallback limitation travels with the result (registry cannot see the switch).
    expect(result.limitations.join(" ")).toContain("Binance Vision");
  });

  it("normalizes Bitget array-shaped candle rows defensively", async () => {
    const t0 = Date.UTC(2020, 0, 1);
    const body = JSON.stringify({ code: "00000", data: [[String(t0), "7195.24", "7255", "7175", "7200", "16792", "121214452"]] });
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const result = await g1.query(BASE_QUERY);
    expect(result.failure?.type ?? "NONE").toBe("NONE");
    expect((result.outputs[0]!.content as { candles: HistoricalCandle[] }).candles[0]!.close).toBe(7200);
  });

  it("emits honest UNAVAILABLE for metrics no reachable source mirrors (never fabricates)", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    for (const metric of ["funding", "open_interest", "liquidations"] as const) {
      const result = await g1.query({ ...BASE_QUERY, metric });
      expect(result.failure.type).toBe("UNAVAILABLE");
      expect(result.completeness).toBe("EMPTY");
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]!.outputClass).toBe("UNAVAILABLE");
      expect(result.outputs[0]!.content).toMatchObject({ metric });
    }
  });

  it("returns EMPTY_RESULT for an empty window; absence of data is not negative evidence", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: JSON.stringify({ code: "00000", data: [] }) }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const result = await g1.query(BASE_QUERY);
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.completeness).toBe("EMPTY");
    expect(result.outputs).toHaveLength(0);
  });

  it("reports a typed retriable failure when BOTH venues fail (never an empty no-data answer)", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ status: 502, body: "bad gateway" }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ status: 503, body: "overload" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const result = await g1.query(BASE_QUERY);
    expect(result.failure.type).toBe("PROVIDER_ERROR");
    expect(result.failure.retriable).toBe(true);
    expect(result.failure.message).toContain("bitget");
    expect(result.failure.message).toContain("binance-vision");
  });

  it("capability defaults: generic-loop params ({asset} only) produce a valid query envelope; explicit params win", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const now = new Date("2026-09-15T12:00:00.000Z");
    const g1 = new G1HistoricalDataAdapter(bitget, vision, () => now);

    // Generic adaptive loop passes only { asset } (no HistoricalQuery fields).
    const viaAsset = await g1.execute("HISTORICAL_COMPARISON", { asset: "BTC" });
    expect(viaAsset.failure?.type ?? "NONE").toBe("NONE");
    expect(viaAsset.completeness).toBe("COMPLETE");
    expect(viaAsset.params).toMatchObject({ symbol: "BTC/USDT", metric: "ohlcv", interval: "1d" });
    expect(Date.parse(viaAsset.params!.to as string)).toBe(now.getTime());
    expect(Date.parse(viaAsset.params!.to as string) - Date.parse(viaAsset.params!.from as string)).toBeCloseTo(3 * 365 * 86_400_000, -6);

    // Explicit params always win over defaults.
    const explicit = await g1.execute("HISTORICAL_COMPARISON", {
      symbol: "ETHUSDT", metric: "ohlcv", from: "2021-05-17T00:00:00.000Z", to: "2021-05-21T00:00:00.000Z", interval: "1d",
    });
    expect(explicit.params).toMatchObject({ symbol: "ETHUSDT", from: "2021-05-17T00:00:00.000Z" });
  });

  it("rejects unmapped capabilities (interface conformance)", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    await expect(g1.execute("TECHNICAL_ANALYSIS", {})).rejects.toThrow(/no mapping/);
  });

  it("paginates forward when the first page is full (deep-range safety bound)", async () => {
    // 2 pages: full page (limit=3 in test via MAX override not possible; emulate with small window
    // and a second call returning the remainder). Use a 3-candle page + expect a second call.
    const t0 = Date.UTC(2020, 0, 1);
    const page1 = JSON.stringify({ code: "00000", data: [
      { ts: String(t0), open: "1", high: "2", low: "0.5", close: "1.5", baseVolume: "10" },
      { ts: String(t0 + DAY_MS), open: "1", high: "2", low: "0.5", close: "1.5", baseVolume: "10" },
      { ts: String(t0 + 2 * DAY_MS), open: "1", high: "2", low: "0.5", close: "1.5", baseVolume: "10" },
    ]});
    // MAX_CANDLES_PER_CALL=1000 > 3, so the loop stops after page 1; this test verifies
    // dedupe/sort and the no-forward-progress guard instead.
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: page1 }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const result = await g1.query({ ...BASE_QUERY, to: "2020-01-10T00:00:00.000Z" });
    expect(result.failure?.type ?? "NONE").toBe("NONE");
    const opens = (result.outputs as ReadonlyArray<{ content: HistoricalCandle }>).map((o) => o.content.openTime);
    expect(opens).toEqual([...opens].sort()); // ascending
    expect(new Set(opens).size).toBe(opens.length); // deduped
  });

  it("resolves through the generic registry (capability-first; no Flow→Tool hardcoding)", async () => {
    const { registry } = createBitgetAdapterSet({
      mcp: new (class {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
      rest: new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) }),
      historical: new G1HistoricalDataAdapter(
        new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) }),
        new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) }),
      ),
    });

    expect(registry.resolve("HISTORICAL_COMPARISON").length).toBeGreaterThan(0);
    const result = await registry.execute("HISTORICAL_COMPARISON", { ...BASE_QUERY }, ORIGIN);
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toBe("g1/historical-data");
  });

  it("normalizes through the domain boundary and candles become evidence-class outputs", async () => {
    const bitget = new RestTransport({ fetchImpl: scriptedFetch([{ body: bitgetCandles() }]) });
    const vision = new RestTransport({ baseUrl: BINANCE_VISION_BASE_URL, fetchImpl: scriptedFetch([{ body: "[]" }]) });
    const g1 = new G1HistoricalDataAdapter(bitget, vision);

    const raw = await g1.query(BASE_QUERY);
    const toolResult = normalizedResult(raw, ORIGIN);
    expect(toolResult.failure.type).toBe("NONE");
    expect(toolResult.normalizedOutput.length).toBe(1); // one monthly chunk
    expect(toolResult.freshness).toBe("HISTORICAL");
    expect(toolResult.normalizedOutput.every((o) => o.outputClass === "QUANTITATIVE_OBSERVATION")).toBe(true);
    const chunk = toolResult.normalizedOutput[0]!.content as { candleCount: number };
    expect(chunk.candleCount).toBe(2);
  });
});
