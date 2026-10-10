import { beforeEach, describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  HistoricalDataStub,
  WebRetrievalStub,
  NotConnectedError,
  type ProviderAdapter,
} from "../../src/adapters/capability-registry.js";
import { TransportError } from "../../src/adapters/transports/resilience.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

/** Minimal fake provider for behavioral tests. */
function fakeAdapter(
  overrides: Partial<ProviderAdapter> & {
    id?: string;
    failWith?: Error;
    failTimes?: number;
  },
): ProviderAdapter {
  let calls = 0;
  return {
    providerId: overrides.id ?? "fake/provider",
    capabilities: overrides.capabilities ?? ["NEWS_ANALYSIS"],
    limitations: overrides.limitations ?? ["test limitation"],
    freshnessProfile: "test:fresh",
    async execute(_capability, params) {
      if (overrides.failWith && calls < (overrides.failTimes ?? Number.MAX_SAFE_INTEGER)) {
        calls++;
        throw overrides.failWith;
      }
      return {
        tool: overrides.id ?? "fake/provider",
        capability: "NEWS_ANALYSIS",
        transport: "test",
        params,
        outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: "test observation" }],
        validation: "VALID",
      };
    },
  };
}

describe("capability registry (tool-skill-orchestration.md, lock §6)", () => {
  beforeEach(() => resetIdCounters());

  it("resolves providers by capability; the registry API has no flow concept (no hardcoded Flow→Tool maps, lock §18)", () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({ id: "a/news" }), 10);
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(registry));
    expect(api).toEqual(expect.arrayContaining(["register", "resolve", "execute"]));
    expect(api).not.toContain("resolveForFlow");
    expect(api).not.toContain("executeForFlow");
  });

  it("ranks providers by priority (ranking is a hint, not a rule; orchestration §8)", () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({ id: "a/secondary" }), 200);
    registry.register(fakeAdapter({ id: "a/primary" }), 10);
    const ranked = registry.resolve("NEWS_ANALYSIS");
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.adapter.providerId).toBe("a/primary");
    expect(ranked[1]!.adapter.providerId).toBe("a/secondary");
  });

  it("falls back to the next provider on adapter error (orchestration §21–23)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({ id: "a/failing", failWith: new Error("down"), failTimes: 99 }), 10);
    registry.register(fakeAdapter({ id: "a/backup" }), 100);

    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.tool).toBe("a/backup");
    expect(result.failure.type).toBe("NONE");
  });

  it("returns a failed TOOL_RESULT (never throws, never fabricates) when all providers fail", async () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({ id: "a/only", failWith: new Error("down"), failTimes: 99 }), 1);
    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("PROVIDER_ERROR");
    expect(result.normalizedOutput).toHaveLength(0);
    expect(result.completeness).toBe("EMPTY");
  });

  it("returns UNAVAILABLE (not an exception) when no provider is registered", async () => {
    const registry = new CapabilityRegistry();
    const result = await registry.execute("ONCHAIN_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("UNAVAILABLE");
    expect(result.limitations.join(" ")).toMatch(/no provider registered/);
  });
});

describe("G1/G2 stubs refuse without fabricating (lock §4)", () => {
  beforeEach(() => resetIdCounters());

  it("historical data stub throws NotConnectedError (no invented data)", async () => {
    const stub = new HistoricalDataStub();
    await expect(
      stub.query({ symbol: "BTC", metric: "ohlcv", from: "2020-01-01", to: "2026-01-01" }),
    ).rejects.toThrow(NotConnectedError);
    await expect(stub.execute("HISTORICAL_COMPARISON", {}, origin)).rejects.toThrow(NotConnectedError);
  });

  it("web retrieval stub throws NotConnectedError", async () => {
    const stub = new WebRetrievalStub();
    await expect(stub.discover("bitget announcement BTC")).rejects.toThrow(NotConnectedError);
    await expect(stub.retrieve("https://example.com")).rejects.toThrow(NotConnectedError);
  });
});

/**
 * REGRESSION (2026-10-09): the registry catch hardcoded `failure.type: "PROVIDER_ERROR"`,
 * erasing the transport's TIMEOUT classification — the requirement ledger renders
 * `result.failure.type`, so budget misses were mislabeled as generic provider faults.
 */
describe("capability registry; typed failure propagation (regression 2026-10-09)", () => {
  beforeEach(() => resetIdCounters());

  it("preserves TransportError classification (TIMEOUT stays TIMEOUT, retriable flag intact)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({
      id: "a/hung",
      failWith: new TransportError("TIMEOUT", "MCP request hung in body phase", { retriable: true }),
      failTimes: 99,
    }), 1);
    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("TIMEOUT");
    expect(result.failure.retriable).toBe(true);
  });

  it("preserves SCHEMA_ERROR as permanent (retry-aware callers must not retry it)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({
      id: "a/bad-args",
      failWith: new TransportError("SCHEMA_ERROR", "MCP tool deterministic rejection: Unknown action", { retriable: false }),
      failTimes: 99,
    }), 1);
    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("SCHEMA_ERROR");
    expect(result.failure.retriable).toBe(false);
  });

  it("records the typed failure in the fallback trail (thrown (TIMEOUT) not bare threw)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({
      id: "a/hung",
      failWith: new TransportError("TIMEOUT", "hung", { retriable: true }),
      failTimes: 99,
    }), 10);
    registry.register(fakeAdapter({ id: "a/backup" }), 100);
    const result = await registry.execute("NEWS_ANALYSIS", {}, origin);
    expect(result.tool).toBe("a/backup");
    expect(result.attemptedProviders?.[0]).toEqual(
      expect.objectContaining({ provider: "a/hung", outcome: "threw (TIMEOUT)", failureType: "TIMEOUT" }),
    );
  });

  it("forwards the CapabilityCall (deadlineMs/signal) to the adapter's execute", async () => {
    let seen: { deadlineMs?: number; signal?: AbortSignal } | undefined;
    const adapter: ProviderAdapter = {
      providerId: "a/call-aware",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute(_capability, _params, call) {
        seen = call;
        return {
          tool: "a/call-aware",
          capability: "NEWS_ANALYSIS",
          transport: "test",
          params: {},
          outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: "ok" }],
          validation: "VALID",
        };
      },
    };
    const registry = new CapabilityRegistry();
    registry.register(adapter, 1);
    const controller = new AbortController();
    const deadline = Date.now() + 60_000;
    await registry.execute("NEWS_ANALYSIS", {}, origin, undefined, { deadlineMs: deadline, signal: controller.signal });
    expect(seen?.deadlineMs).toBe(deadline);
    expect(seen?.signal).toBe(controller.signal);
  });
});

/**
 * REGRESSION (2026-10-09): fallback-compatibility gate — a fallback that "succeeds" but
 * answers the WRONG instrument must not close the capability; the chain keeps walking.
 */
describe("capability registry; fallback-compatibility gate (regression 2026-10-09)", () => {
  beforeEach(() => resetIdCounters());

  function marketAdapter(
    id: string,
    about: string,
    gate?: (params: Record<string, unknown>) => { compatible: true } | { compatible: false; reasons: readonly string[] },
  ): ProviderAdapter {
    return {
      providerId: id,
      capabilities: ["MARKET_DATA_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute(_capability, params) {
        return {
          tool: id,
          capability: "MARKET_DATA_ANALYSIS",
          transport: "test",
          params,
          outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: { price: 1 }, about }],
          validation: "VALID",
          freshness: "CURRENT",
        };
      },
      ...(gate !== undefined ? { validateFallback: (_c: string, p: Record<string, unknown>) => gate(p) } : {}),
    };
  }

  /** A primary that always fails: the registry walks to fallbacks. */
  const failingMarketPrimary: ProviderAdapter = {
    providerId: "crypto/primary",
    capabilities: ["MARKET_DATA_ANALYSIS"],
    limitations: [],
    freshnessProfile: "test",
    async execute() {
      throw new TransportError("TIMEOUT", "primary upstream hung", { retriable: true });
    },
  };

  it("rejects an incompatible fallback and continues to the next provider", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingMarketPrimary, 10);
    registry.register(
      marketAdapter("crypto/wrong-coin", "ETH", () => ({ compatible: false, reasons: ["wrong instrument"] })),
      50,
    );
    registry.register(marketAdapter("crypto/right-coin", "BTC"), 100);

    const result = await registry.execute("MARKET_DATA_ANALYSIS", { asset: "BTC" }, origin);
    expect(result.tool).toBe("crypto/right-coin"); // gate rejected the wrong-coin fallback
    expect(result.attemptedProviders?.map((a) => a.provider)).toEqual(
      expect.arrayContaining(["crypto/wrong-coin"]),
    );
    expect(result.attemptedProviders?.find((a) => a.provider === "crypto/wrong-coin")?.outcome).toContain("incompatible");
  });

  it("accepts a compatible fallback (gate returns compatible: true)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingMarketPrimary, 10);
    registry.register(marketAdapter("crypto/coingecko", "BTC", () => ({ compatible: true })), 50);

    const result = await registry.execute("MARKET_DATA_ANALYSIS", { asset: "BTC" }, origin);
    expect(result.tool).toBe("crypto/coingecko");
    expect(result.failure.type).toBe("NONE");
  });

  it("the PRIMARY attempt is never gated (coverage-only failover law)", async () => {
    const registry = new CapabilityRegistry();
    // Primary serves coverage but its own validator would reject it — validators run only at index > 0.
    registry.register(
      marketAdapter("crypto/primary", "BTC", () => ({ compatible: false, reasons: ["should never run for primary"] })),
      10,
    );
    const result = await registry.execute("MARKET_DATA_ANALYSIS", { asset: "ETH" }, origin);
    expect(result.tool).toBe("crypto/primary"); // served despite the validator's opinion
    expect(result.failure.type).toBe("NONE");
  });

  it("when every fallback is incompatible, the honest failure carries the full trail", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingMarketPrimary, 10);
    registry.register(
      marketAdapter("crypto/wrong", "ETH", () => ({ compatible: false, reasons: ["wrong instrument"] })),
      50,
    );

    const result = await registry.execute("MARKET_DATA_ANALYSIS", { asset: "BTC" }, origin);
    expect(result.failure.type).not.toBe("NONE");
    const trail = [...(result.attemptedProviders?.map((a) => a.outcome) ?? []), ...result.limitations].join(" ");
    expect(trail).toContain("incompatible");
    expect(trail).toContain("wrong instrument");
  });
});

/**
 * REGRESSION (2026-10-09): sibling isolation — one capability's transport failure must never
 * cancel or poison a parallel sibling (Promise.all isolation in adaptive.ts). This is the
 * registry-level expression: two concurrent executes with one failing do not interfere.
 */
describe("capability registry; sibling isolation under concurrency (regression 2026-10-09)", () => {
  beforeEach(() => resetIdCounters());

  it("parallel executes: a TIMEOUT in one capability does not affect the sibling's result", async () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({
      id: "a/hung",
      capabilities: ["NEWS_ANALYSIS"],
      failWith: new TransportError("TIMEOUT", "hung", { retriable: true }),
      failTimes: 99,
    }), 1);
    registry.register(fakeAdapter({
      id: "a/healthy",
      capabilities: ["SENTIMENT_ANALYSIS"],
    }), 1);

    const [news, sentiment] = await Promise.all([
      registry.execute("NEWS_ANALYSIS", {}, origin),
      registry.execute("SENTIMENT_ANALYSIS", {}, origin),
    ]);
    expect(news.failure.type).toBe("TIMEOUT");
    expect(sentiment.failure.type).toBe("NONE");
    expect(sentiment.tool).toBe("a/healthy");
  });
});
