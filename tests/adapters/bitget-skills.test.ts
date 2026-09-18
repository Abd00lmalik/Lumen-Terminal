import { beforeEach, describe, expect, it } from "vitest";
import {
  createBitgetAdapterSet,
  createNewsBriefingAdapter,
} from "../../src/adapters/bitget-skills.js";
import { FakeMcpTransport, FakeRestTransport } from "./fakes.js";
import { CapabilityRegistry, TransportError, type ProviderAdapter } from "../../src/adapters/capability-registry.js";

const origin = { kind: "agent" as const, detail: "test" };

function candle(ts: string, close: string): Candle {
  return { ts, open: close, high: close, low: close, close, baseVolume: "1", quoteVolume: "1" };
}

describe("five Bitget skills registered through the generic registry (final lock §11)", () => {
  let mcp: FakeMcpTransport;
  let rest: FakeRestTransport;

  beforeEach(() => {
    mcp = new FakeMcpTransport();
    rest = new FakeRestTransport();
  });

  it("all five skills resolve their capabilities; G1 connected (vendor selected); G2 stub remains unconnected", { timeout: 30_000 }, async () => {
    // G1's both-venues path exercises real bounded-retry backoff against the fakes; give it
    // an explicit budget so parallel-suite load can never turn it flaky.
    // fallbacks: false → PRIMARY-only wiring law (fallback ordering asserted separately).
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never, fallbacks: false });

    expect(registry.resolve("MACRO_ANALYSIS").map((r) => r.adapter.providerId)).toEqual(["bitget-signal/macro-analyst"]);
    expect(registry.resolve("MARKET_DATA_ANALYSIS").map((r) => r.adapter.providerId)).toEqual(["bitget-signal/market-intel"]);
    expect(registry.resolve("SENTIMENT_ANALYSIS").map((r) => r.adapter.providerId)).toEqual(["bitget-signal/sentiment-analyst"]);
    // Equity capabilities (2026-09-18) register NEWS_ANALYSIS via the Yahoo headline feed
    // alongside the Bitget primary; everything else stays single-provider here.
    expect(registry.resolve("NEWS_ANALYSIS").map((r) => r.adapter.providerId)).toEqual(["bitget-signal/news-briefing", "equity/yahoo-headlines"]);
    expect(registry.resolve("TECHNICAL_ANALYSIS").map((r) => r.adapter.providerId)).toEqual(["bitget-signal/technical-analysis"]);
    // G1 (vendor selected 2026-09-15): the REAL provider resolves HISTORICAL_COMPARISON
    // execute() no longer throws NotConnectedError (the both-venues-fail typed-failure law
    // is covered in g1-historical.test.ts). Against the fake REST transport it returns a
    // normalized TOOL_RESULT through the generic registry path.
    expect(registry.resolve("HISTORICAL_COMPARISON").map((r) => r.adapter.providerId)).toEqual(["g1/historical-data"]);
    await expect(registry.execute("HISTORICAL_COMPARISON", {}, origin)).resolves.toMatchObject({
      tool: "g1/historical-data",
      capability: "HISTORICAL_COMPARISON",
    });
  });

  it("capability-first: the engine-facing registry has no flow keys and no skill-name routing", () => {
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    // resolve() accepts ONLY capability names; there is no flow→tool table anywhere in the API.
    const registryApi = Object.getOwnPropertyNames(Object.getPrototypeOf(registry));
    expect(registryApi).toContain("resolve");
    expect(registryApi).toContain("execute");
    expect(registryApi).not.toContain("flow");
    // executing by capability routes to the documented tool transparently:
    mcp.script({ content: [{ type: "text", text: " Fear & Greed: 72; Extreme greed " }] });
    void registry.execute("SENTIMENT_ANALYSIS", { symbol: "BTCUSDT" }, origin).then((result) => {
      expect(result.tool).toBe("bitget-signal/sentiment-analyst");
      expect(result.transport).toBe("mcp:derivatives_sentiment");
    });
  });

  it("macro-analyst end-to-end: narrative verdict stays interpretation; numeric series stays observation", async () => {
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    mcp.script({
      content: [
        { type: "text", text: "RISK-OFF: yields rising, DXY strong" },
        { type: "text", text: JSON.stringify({ indicator: "DXY", value: 105.2 }) },
      ],
    });

    const result = await registry.execute("MACRO_ANALYSIS", { window: "30d" }, origin);
    expect(result.failure.type).toBe("NONE");
    const [verdict, data] = result.normalizedOutput;
    expect(verdict!.outputClass).toBe("ANALYST_INTERPRETATION");
    expect(data!.outputClass).toBe("QUANTITATIVE_OBSERVATION");
    expect(data!.proxyBasis).toBeUndefined(); // macro data is direct, not proxy
  });

  it("market-intel: proxy labels preserved through the full TOOL_RESULT path (lock §3)", async () => {
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    mcp.script({ content: [{ type: "text", text: JSON.stringify({ metric: "stablecoin_supply", value: "170B" }) }] });

    const result = await registry.execute("MARKET_DATA_ANALYSIS", {}, origin);
    expect(result.tool).toBe("bitget-signal/market-intel");
    expect(result.limitations.join(" ")).toContain("NOT true on-chain intelligence");
    expect(result.normalizedOutput[0]!.proxyBasis).toContain("NOT direct on-chain or ETF-flow observation");
  });

  it("news-briefing: RSS lag limitation + freshness profile attached (lock §8)", async () => {
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    mcp.script({ content: [{ type: "text", text: "Bitcoin ETF sees $500M inflows, reports say" }] });

    const result = await registry.execute("NEWS_ANALYSIS", { keywords: "ETF" }, origin);
    expect(result.limitations.join(" ")).toContain("RSS updates every 15-60 min");
    expect(result.freshness).toBe("CURRENT");
  });

  it("technical-analysis over REST: klines as quantitative observations with exact timestamps", async () => {
    const now = Date.now();
    rest.script({ body: JSON.stringify({ code: "00000", data: [candle(String(now - 3600_000), "42000"), candle(String(now), "42100")] }) });
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });

    const result = await registry.execute("TECHNICAL_ANALYSIS", { symbol: "BTCUSDT", interval: "1h" }, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.transport).toBe("rest:spot-candles");
    expect(result.normalizedOutput).toHaveLength(2);
    expect(result.normalizedOutput.every((o) => o.outputClass === "QUANTITATIVE_OBSERVATION")).toBe(true);
    expect(result.sourceTimestamp).toBe(new Date(now).toISOString());
    expect(result.freshness).toBe("CURRENT");
  });

  it("technical-analysis: futures marketType routes to the mix/candles path", async () => {
    rest.script({ body: JSON.stringify({ code: "00000", data: [candle(String(Date.now()), "42100")] }) });
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });

    const result = await registry.execute("TECHNICAL_ANALYSIS", { symbol: "BTCUSDT", marketType: "futures" }, origin);
    expect(result.transport).toBe("rest:futures-candles");
    expect(result.invocation.params.symbol).toBe("BTCUSDT");
  });

  it("registry falls back to the next provider on adapter failure (failure-recovery.md §15)", async () => {
    const registry = new CapabilityRegistry();
    const failing: ProviderAdapter = {
      providerId: "fake/primary",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["primary"],
      freshnessProfile: "test",
      async execute() {
        throw new TransportError("UNAVAILABLE", "primary down", { retriable: false });
      },
    };
    mcp.script({ content: [{ type: "text", text: "headline from fallback" }] });
    registry.register(failing, 10); // lower priority = tried first
    registry.register(createNewsBriefingAdapter(mcp as never), 100);

    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toBe("bitget-signal/news-briefing"); // fallback served the capability
  });

  it("all providers failing → PRIMARY's failure headlined with the full fallback trail, no fabricated outputs (lock §18 + failover law)", async () => {
    const registry = new CapabilityRegistry();
    const fail = (id: string): ProviderAdapter => ({
      providerId: id,
      capabilities: ["MACRO_ANALYSIS"],
      limitations: [`${id} limitation`],
      freshnessProfile: "test",
      async execute() {
        throw new TransportError("PROVIDER_ERROR", `${id} exploded`, { retriable: true });
      },
    });
    registry.register(fail("fake/a"), 10);
    registry.register(fail("fake/b"), 20);

    const result = await registry.execute("MACRO_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("PROVIDER_ERROR");
    expect(result.failure.retriable).toBe(true);
    expect(result.completeness).toBe("EMPTY");
    expect(result.normalizedOutput).toHaveLength(0); // nothing invented
    // The PRIMARY's failure is headlined (never erased by a later fallback's failure)...
    expect(result.tool).toBe("fake/a");
    expect(result.limitations.join(" ")).toContain("fake/a limitation");
    // ...and the full fallback trail is preserved for provenance.
    expect(result.limitations.join(" ")).toContain("provider fallback attempted and failed");
    expect(result.limitations.join(" ")).toContain("fake/b");
    expect(result.attemptedProviders?.map((a) => a.provider)).toEqual(["fake/b"]);
  });

  it("no execution surface: no adapter, capability, or registry method exposes trading operations (lock §13/§17)", () => {
    const { registry, mcp: mcpT, rest: restT } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    const forbidden = /place.?order|submit.?order|execute.?trade|open.?position|close.?position|transfer|withdraw|placeOrder|submitOrder|trade/i;
    for (const adapter of ["bitget-signal/macro-analyst", "bitget-signal/market-intel", "bitget-signal/sentiment-analyst", "bitget-signal/news-briefing", "bitget-signal/technical-analysis"]) {
      expect(forbidden.test(adapter)).toBe(false);
    }
    for (const capability of ["MACRO_ANALYSIS", "MARKET_DATA_ANALYSIS", "SENTIMENT_ANALYSIS", "NEWS_ANALYSIS", "TECHNICAL_ANALYSIS"]) {
      expect(forbidden.test(capability)).toBe(false);
    }
    const registryProto = Object.getPrototypeOf(registry) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(registryProto)) {
      expect(forbidden.test(name)).toBe(false);
    }
    // transports expose only read paths (callTool/get)
    expect(typeof (mcpT as unknown as Record<string, unknown>).callTool).toBe("function");
    expect(typeof (restT as unknown as Record<string, unknown>).get).toBe("function");
    expect((restT as unknown as Record<string, unknown>).post).toBeUndefined();
    expect((restT as unknown as Record<string, unknown>).placeOrder).toBeUndefined();
  });

  it("adapters are wired as flat instances; no hidden per-flow branches in the factory", () => {
    // the factory registers 14 providers across the probed capabilities by DEFAULT (5 skills +
    // G1 + G2 + 3 capability fallbacks + 4 equity + 3 Heurist reachable via these capability
    // names). G1 (2026-09-15) and G2 (2026-09-15) both replace their NotConnected stubs.
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    const providers = new Set<string>();
    for (const capability of ["MACRO_ANALYSIS", "MARKET_DATA_ANALYSIS", "SENTIMENT_ANALYSIS", "NEWS_ANALYSIS", "TECHNICAL_ANALYSIS", "HISTORICAL_COMPARISON", "SOURCE_VALIDATION"]) {
      for (const reg of registry.resolve(capability)) providers.add(reg.adapter.providerId);
    }
    expect([...providers].sort()).toEqual([
      "bitget-signal/macro-analyst",
      "bitget-signal/market-intel",
      "bitget-signal/news-briefing",
      "bitget-signal/sentiment-analyst",
      "bitget-signal/technical-analysis",
      "equity/yahoo-headlines",
      "fallback/fear-greed",
      "fallback/news-rss",
      "fallback/world-bank",
      "g1/historical-data",
      "g2/web-retrieval",
      "heurist/FredMacroAgent",
      "heurist/SecEdgarAgent",
      "heurist/YahooFinanceAgent",
    ]);
  });

  // Reliability-phase regression: the engine plans capabilities, not tool args; a plan with no
  // params previously sent action:undefined to the MCP hub ("Unknown action:") and the adapter
  // laundered that into an EMPTY result with no failure. Defaults make the unset-args case a
  // VALID request while explicit params still win.
  it("capability defaults: unset action falls back to a valid request; explicit params win", async () => {
    const { registry } = createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never });
    mcp.script({ content: [{ type: "text", text: JSON.stringify({ btc_dominance: 58 }) }] });
    mcp.script({ content: [{ type: "text", text: JSON.stringify({ error: "" }) }] });
    mcp.script({ content: [{ type: "text", text: JSON.stringify({ item: 1 }) }] });
    await registry.execute("MARKET_DATA_ANALYSIS", {}, origin);
    await registry.execute("SENTIMENT_ANALYSIS", {}, origin);
    await registry.execute("SENTIMENT_ANALYSIS", { action: "taker_ratio", symbol: "ETHUSDT" }, origin);
    expect(mcp.calls[0]?.args).toMatchObject({ action: "global" });
    expect(mcp.calls[1]?.args).toMatchObject({ action: "long_short", symbol: "BTCUSDT" });
    expect(mcp.calls[2]?.args).toMatchObject({ action: "taker_ratio", symbol: "ETHUSDT" });
  });
});
