import { beforeEach, describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  HistoricalDataStub,
  WebRetrievalStub,
  NotConnectedError,
  type ProviderAdapter,
} from "../../src/adapters/capability-registry.js";
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

  it("resolves providers by capability — the registry API has no flow concept (no hardcoded Flow→Tool maps, lock §18)", () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeAdapter({ id: "a/news" }), 10);
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(registry));
    expect(api).toEqual(expect.arrayContaining(["register", "resolve", "execute"]));
    expect(api).not.toContain("resolveForFlow");
    expect(api).not.toContain("executeForFlow");
  });

  it("ranks providers by priority (ranking is a hint, not a rule — orchestration §8)", () => {
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
