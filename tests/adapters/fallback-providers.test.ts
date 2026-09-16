/**
 * Provider-failover laws (mandate §3/§4); deterministic, no network.
 *
 * Under test:
 * - REGISTRY-OWNED failover: primary fails → fallback serves; the flow never names providers.
 * - FALLBACK MUST NOT ERASE THE PRIMARY'S FAILURE: attemptedProviders + limitation trail.
 * - A provider failure is never negative evidence; all-fail → typed failure, no outputs.
 * - Epistemic honesty of each fallback: RSS = FACTUAL_OBSERVATION (secondary reporting),
 *   Fear&Greed = SENTIMENT_SIGNAL with explicit proxyBasis (never upgraded to observation),
 *   World Bank = QUANTITATIVE_OBSERVATION but freshness STALE (annual lag is never CURRENT).
 * - Each fallback states what it does NOT provide (no invented funding/OI/positioning).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { NewsFallbackAdapter, SentimentFallbackAdapter, MacroFallbackAdapter } from "../../src/adapters/fallback-providers.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

beforeEach(() => resetIdCounters());

/** Primary adapter that always fails the way the real Bitget MCP path would. */
function failingPrimary(capability: string): ProviderAdapter {
  return {
    providerId: `bitget-signal/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake primary"],
    freshnessProfile: "test",
    async execute() {
      throw new Error("simulated primary outage");
    },
  };
}

/** Deterministic fetch fake returning canned bodies per URL substring. */
function fakeFetch(routes: Record<string, string>) {
  return (async (url: URL | string): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString();
    for (const [fragment, body] of Object.entries(routes)) {
      if (u.includes(fragment)) {
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("registry-owned provider failover (mandate §4)", () => {
  it("primary failure → fallback serves; flow-level execute() is provider-agnostic", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("NEWS_ANALYSIS"), 100);
    registry.register(new NewsFallbackAdapter(fakeFetch({
      "coindesk.com": "<rss><channel><item><title>BTC ETF inflows hit record</title><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</title></item></channel></rss>",
    })), 200);

    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toBe("fallback/news-rss");
    // Outputs survive normalization with their epistemic class intact.
    expect(result.normalizedOutput.length).toBeGreaterThan(0);
    expect(result.normalizedOutput[0]?.outputClass).toBe("FACTUAL_OBSERVATION");
  });

  it("a serving fallback must NOT erase the primary's failure (attemptedProviders + limitation trail)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("NEWS_ANALYSIS"), 100);
    registry.register(new NewsFallbackAdapter(fakeFetch({
      "cointelegraph.com": "<rss><channel><item><title>Macro: rates steady</title></item></channel></rss>",
    })), 200);

    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.attemptedProviders).toEqual([
      { provider: "bitget-signal/news_analysis", outcome: "threw" },
    ]);
    const fallbackNote = result.limitations.find((l) => l.includes("provider fallback"));
    expect(fallbackNote).toBeDefined();
    expect(fallbackNote).toContain("bitget-signal/news_analysis");
    expect(fallbackNote).toContain("research continued using fallback/news-rss");
  });

  it("no fallback needed → no attempt trail (primary served cleanly)", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "bitget-signal/primary-ok",
      capabilities: ["SENTIMENT_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute(cap) {
        return {
          tool: "bitget-signal/primary-ok",
          capability: cap,
          transport: "fake",
          outputs: [{ outputClass: "SENTIMENT_SIGNAL", content: { value: 55 } }],
        };
      },
    }, 100);
    registry.register(new SentimentFallbackAdapter(), 200);

    const result = await registry.execute("SENTIMENT_ANALYSIS", {}, origin);
    expect(result.tool).toBe("bitget-signal/primary-ok");
    expect(result.attemptedProviders).toBeUndefined();
    expect(result.limitations.find((l) => l.includes("provider fallback"))).toBeUndefined();
  });

  it("primary AND fallback both fail → typed failure, no evidence-grade outputs (never negative evidence)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("MACRO_ANALYSIS"), 100);
    // Network-less fetch: every request throws.
    registry.register(new MacroFallbackAdapter((async () => { throw new Error("offline"); }) as typeof fetch), 200);

    const result = await registry.execute("MACRO_ANALYSIS", {}, origin);
    expect(result.failure.type).not.toBe("NONE");
    expect(result.failure.retriable).toBe(true);
    expect(result.completeness).toBe("EMPTY");
    expect(result.attemptedProviders).toBeDefined();
    // No fabricated outputs: the only outputs are UNAVAILABLE diagnostics (never evidence).
    expect(result.normalizedOutput.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
  });

  it("primary succeeds but with EMPTY coverage → fallback is attempted and serves (insufficient-coverage failover)", async () => {
    const registry = new CapabilityRegistry();
    // Primary that "succeeds" (no failure) but provides zero evidence-grade outputs
    // the exact shape observed when an upstream returns an empty-but-valid payload.
    registry.register({
      providerId: "bitget-signal/news-empty",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["fake primary: empty coverage"],
      freshnessProfile: "test",
      async execute(cap) {
        return { tool: "bitget-signal/news-empty", capability: cap, transport: "fake", outputs: [] };
      },
    }, 100);
    registry.register(new NewsFallbackAdapter(fakeFetch({
      "coindesk.com": "<rss><channel><item><title>Sentiment improves as ETF flows resume</title><pubDate>Tue, 15 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>",
    })), 200);

    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.tool).toBe("fallback/news-rss");
    expect(result.failure.type).toBe("NONE");
    expect(result.normalizedOutput.length).toBeGreaterThan(0);
    expect(result.attemptedProviders).toEqual([
      { provider: "bitget-signal/news-empty", outcome: "empty (no coverage)" },
    ]);
    const fallbackNote = result.limitations.find((l) => l.includes("provider fallback"));
    expect(fallbackNote).toBeDefined();
  });

  it("ALL providers empty → honest EMPTY with the trail intact (never fabricated coverage)", async () => {
    const registry = new CapabilityRegistry();
    const emptyProvider = (id: string): ProviderAdapter => ({
      providerId: id,
      capabilities: ["SENTIMENT_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute(cap) {
        return { tool: id, capability: cap, transport: "fake", outputs: [] };
      },
    });
    registry.register(emptyProvider("primary-empty"), 100);
    registry.register(emptyProvider("fallback-empty"), 200);

    const result = await registry.execute("SENTIMENT_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("NONE"); // no technical failure anywhere…
    expect(result.completeness).toBe("EMPTY"); // …but honestly no coverage either
    expect(result.normalizedOutput.length).toBe(0);
    expect(result.attemptedProviders?.map((a) => a.provider)).toEqual(["primary-empty"]);
    expect(result.tool).toBe("fallback-empty");
  });

  it("priority ordering: primary (100) is attempted before fallback (200)", async () => {
    const registry = new CapabilityRegistry();
    const callOrder: string[] = [];
    const tracking = (id: string, ok: boolean): ProviderAdapter => ({
      providerId: id,
      capabilities: ["MACRO_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute(cap) {
        callOrder.push(id);
        if (!ok) throw new Error("down");
        return { tool: id, capability: cap, transport: "fake", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: { v: 1 } }] };
      },
    });
    registry.register(tracking("bitget-signal/macro-analyst", false), 100);
    registry.register(tracking("fallback/world-bank", true), 200);

    const result = await registry.execute("MACRO_ANALYSIS", {}, origin);
    expect(callOrder).toEqual(["bitget-signal/macro-analyst", "fallback/world-bank"]);
    expect(result.tool).toBe("fallback/world-bank");
  });
});

describe("fallback epistemic honesty (mandate §3A–3C)", () => {
  it("NEWS fallback items carry publisher + timestamp + url; unparseable feeds stay UNAVAILABLE", async () => {
    const adapter = new NewsFallbackAdapter(fakeFetch({
      "coindesk.com": "<rss><channel><item><title>A</title><pubDate>Wed, 16 Sep 2026 01:00:00 GMT</pubDate></item></channel></rss>",
      "cointelegraph.com": "this is not xml at all",
    }));
    const result = await adapter.execute("NEWS_ANALYSIS", {}, );
    expect(result.failure.type).toBe("NONE");
    expect(result.completeness).toBe("PARTIAL"); // one feed dead; honestly partial
    const item = result.outputs?.[0];
    expect(item?.outputClass).toBe("FACTUAL_OBSERVATION");
    expect((item?.content as { publisher: string }).publisher).toBe("CoinDesk");
    expect((item?.content as { publishedAt?: string }).publishedAt).toContain("2026");
  });

  it("NEWS fallback keyword filtering keeps only matching items", async () => {
    const adapter = new NewsFallbackAdapter(fakeFetch({
      "coindesk.com": "<rss><channel><item><title>BTC ETF approved</title></item><item><title>Altcoin news</title></item></channel></rss>",
      "cointelegraph.com": "<rss><channel><item><title>BTC halving recap</title></item></channel></rss>",
    }));
    const result = await adapter.execute("NEWS_ANALYSIS", { keyword: "BTC" });
    expect(result.outputs?.every((o) => ((o.content as { title: string }).title).includes("BTC"))).toBe(true);
    expect(result.outputs?.length).toBe(2);
  });

  it("SENTIMENT fallback is SENTIMENT_SIGNAL with explicit proxyBasis; never upgraded to observation", async () => {
    const adapter = new SentimentFallbackAdapter();
    // Inject the fake transport outcome by stubbing fetch through the RestTransport seam is
    // not exposed; instead assert against a live-shaped payload via a local fake server
    // simplest deterministic path: replace the adapter's private rest with a scripted one.
    const scripted = {
      get: async () => ({
        body: { data: [{ value: "71", value_classification: "Greed", timestamp: "1789507200" }] },
        rawReference: "rest:GET /fng/#raw-test",
        attempts: 1,
        durationMs: 1,
        status: 200,
      }),
    };
    (adapter as unknown as { rest: unknown }).rest = scripted;
    const result = await adapter.execute("SENTIMENT_ANALYSIS", {});
    expect(result.failure.type).toBe("NONE");
    const output = result.outputs?.[0];
    expect(output?.outputClass).toBe("SENTIMENT_SIGNAL");
    expect(output?.proxyBasis).toContain("proxy");
    // Explicit non-provision law: the limitations name what is NOT provided.
    expect(adapter.limitations.join(" ")).toContain("does NOT provide funding, open interest");
  });

  it("MACRO fallback freshness is STALE (annual-lag official data is never CURRENT)", async () => {
    const adapter = new MacroFallbackAdapter();
    const scripted = {
      get: async () => ({
        body: [null, [{ date: "2024", value: 2.9 }]],
        rawReference: "rest:GET /v2/country/US/indicator#raw-test",
        attempts: 1,
        durationMs: 1,
        status: 200,
      }),
    };
    (adapter as unknown as { rest: unknown }).rest = scripted;
    const result = await adapter.execute("MACRO_ANALYSIS", {});
    expect(result.failure.type).toBe("NONE");
    expect(result.freshness).toBe("STALE");
    expect(result.outputs?.[0]?.outputClass).toBe("QUANTITATIVE_OBSERVATION");
    expect((result.outputs?.[0]?.content as { source: string }).source).toBe("World Bank");
  });

  it("every fallback adapter declares what it does NOT provide (no invented datasets)", () => {
    expect(new NewsFallbackAdapter().limitations.join(" ")).toContain("secondary reporting");
    expect(new SentimentFallbackAdapter().limitations.join(" ")).toContain("does NOT provide funding, open interest, liquidations, or trader positioning");
    expect(new MacroFallbackAdapter().limitations.join(" ")).toContain("NOT real-time macro data");
  });
});
