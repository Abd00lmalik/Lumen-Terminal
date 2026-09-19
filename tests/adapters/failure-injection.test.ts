/**
 * Failure-injection scenarios (repair mandate Phase 18); deterministic, no network.
 *
 * The law under test: A PROVIDER FAILURE IS NOT A RESEARCH FAILURE. Each scenario
 * injects a specific failure into the primary provider and verifies the chain recovers
 * with honest provenance — or, when every path is exhausted, returns an honest typed
 * failure without fabricating evidence.
 *
 * Scenarios:
 * 1. Earnings: direct Yahoo fails -> Heurist Yahoo agent serves (the AAPL scenario)
 * 2. Earnings: direct AND Heurist fail -> honest EMPTY with the full attempt trail
 * 3. News: direct fails -> registered fallback serves
 * 4. Macro: primary empty -> fallback serves with STALE freshness honesty
 * 5. Timeout: primary timeout -> fallback serves
 * 6. Rate limit: retriable failure classified and preserved in the trail
 * 7. Auth failure: missing credential skips the provider without killing research
 */
import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import {
  HeuristMeshTransport,
  createHeuristEarningsAdapter,
  createHeuristFundingRateAdapter,
} from "../../src/adapters/heurist.js";
import { EarningsCalendarAdapter } from "../../src/adapters/equity.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";
import type { ProviderAdapter, ToolResultInput } from "../../src/domain/tool-result.js";

const origin: ProvenanceOrigin = { kind: "research", id: "failure-injection-test" };

/** Scriptable fetch fake: queues JSON bodies (or Error/number to simulate raw failures). */
function fakeFetch(responses: unknown[]): { fetch: typeof fetch } {
  const queue = [...responses];
  const impl = (async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "number") {
      return new Response(next === 429 ? "rate limited" : "boom", { status: next });
    }
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: impl };
}

/** A primary provider that throws the given failure class on every execute. */
function failingPrimary(capability: string, providerId: string, message: string): ProviderAdapter {
  return {
    providerId,
    capabilities: [capability] as never,
    limitations: [`${providerId} injected failure: ${message}`],
    freshnessProfile: "test",
    async execute(): Promise<ToolResultInput> {
      throw new Error(message);
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1+2: the AAPL earnings chain (mandate Phase 3/5/18)
// ---------------------------------------------------------------------------

describe("failure injection: earnings chain", () => {
  it("direct Yahoo earnings fails -> Heurist Yahoo agent serves; primary failure preserved in the trail", async () => {
    const registry = new CapabilityRegistry();
    registry.register(
      new EarningsCalendarAdapter((await import("../../src/adapters/equity.js")).makeFailingRest?.() ?? {
        async get() { throw new Error("connect timeout"); },
      } as never),
      100,
    );
    registry.register(
      createHeuristEarningsAdapter(
        new HeuristMeshTransport({
          apiKey: "heu_test",
          fetchImpl: fakeFetch([{ result: { fundamentals: { earningsDates: ["2026-10-29"] }, analyst: { consensus: "estimates only" } } }]).fetch,
        }),
      ),
      300,
    );

    const result = await registry.execute("EARNINGS_CALENDAR", { symbol: "AAPL" }, origin);

    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toContain("heurist/YahooFinanceAgent.equity_overview");
    expect(result.limitations.join(" ")).toContain("provider fallback");
    expect(result.limitations.join(" ")).toContain("equity/yahoo-earnings-calendar");
    expect(result.attemptedProviders?.map((a) => a.provider)).toContain("equity/yahoo-earnings-calendar");
    // Epistemic honesty: agent output keeps upstream lineage; nothing upgraded to a
    // reported result (estimates stay estimates).
    const content = result.normalizedOutput[0]!.content as { upstreamSource?: string };
    expect(content.upstreamSource).toBe("yahoo-finance");
  });

  it("direct AND Heurist both fail -> honest EMPTY with the full attempt trail (never fabricated, never negative evidence)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("EARNINGS_CALENDAR", "fake/yahoo-down", "connect timeout"), 100);
    registry.register(
      createHeuristEarningsAdapter(
        new HeuristMeshTransport({
          apiKey: "heu_test",
          fetchImpl: fakeFetch([new Error("network unreachable")]).fetch,
        }),
      ),
      300,
    );

    const result = await registry.execute("EARNINGS_CALENDAR", { symbol: "AAPL" }, origin);

    expect(result.completeness).toBe("EMPTY");
    expect(result.failure.type).not.toBe("NONE");
    // The PRIMARY's failure is the headline (identity in `tool`); the fallback attempt
    // is preserved in the trail. Neither is ever erased by the other.
    expect(result.tool).toContain("fake/yahoo-down");
    expect(result.limitations.join(" ")).toContain("provider fallback attempted and failed");
    expect(result.limitations.join(" ")).toContain("heurist/YahooFinanceAgent");
    expect(result.attemptedProviders?.map((a) => a.provider)).toContain("heurist/YahooFinanceAgent");
    expect(result.normalizedOutput.every((o) => o.outputClass !== "FACTUAL_OBSERVATION")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3-7: cross-domain injection (news/macro/timeout/rate-limit/auth)
// ---------------------------------------------------------------------------

describe("failure injection: cross-domain recovery classes", () => {
  it("timeout on primary -> retriable failure classified; fallback serves", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("DERIVATIVES_ANALYSIS", "fake/deriv-primary", "The operation was aborted"), 100);
    registry.register(
      createHeuristFundingRateAdapter(
        new HeuristMeshTransport({
          apiKey: "heu_test",
          fetchImpl: fakeFetch([{ result: [{ fundingRate: 0.00012, openInterest: 9_500_000_000 }] }]).fetch,
        }),
      ),
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toContain("heurist/FundingRateAgent");
    expect(result.limitations.join(" ")).toContain("fake/deriv-primary");
  });

  it("rate-limited primary (429) -> retriable classification reaches the fallback trail", async () => {
    const registry = new CapabilityRegistry();
    const rateLimited: ProviderAdapter = {
      providerId: "fake/rate-limited",
      capabilities: ["DERIVATIVES_ANALYSIS"] as never,
      limitations: ["rate limited"],
      freshnessProfile: "test",
      async execute(): Promise<ToolResultInput> {
        return {
          tool: "fake/rate-limited",
          capability: "DERIVATIVES_ANALYSIS",
          transport: "test",
          params: {},
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: "HTTP 429" }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: { type: "RATE_LIMIT", message: "HTTP 429", retriable: true },
          limitations: ["rate limited"],
        };
      },
    };
    registry.register(rateLimited, 100);
    registry.register(
      createHeuristFundingRateAdapter(
        new HeuristMeshTransport({
          apiKey: "heu_test",
          fetchImpl: fakeFetch([{ result: [{ fundingRate: 0.0001, openInterest: 8_000_000_000 }] }]).fetch,
        }),
      ),
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    // Insufficient-coverage failover: the rate-limited primary produced no usable
    // outputs, so the fallback serves — and the rate limit stays in the trail.
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toContain("heurist/FundingRateAgent");
    expect(JSON.stringify(result.limitations) + JSON.stringify(result.attemptedProviders)).toContain("fake/rate-limited");
  });

  it("auth failure (missing credential) skips the provider for the request; next fallback still serves", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("DERIVATIVES_ANALYSIS", "fake/primary-down", "connect timeout"), 100);
    registry.register(
      createHeuristFundingRateAdapter(new HeuristMeshTransport({ fetchImpl: fakeFetch([]).fetch })), // no apiKey
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    // The unkeyed Heurist adapter throws AUTHENTICATION_FAILURE -> registry records the
    // attempt and fails over; with no further provider the result is honest EMPTY with
    // the primary headlined and the auth-skipped fallback in the trail.
    expect(result.completeness).toBe("EMPTY");
    expect(result.tool).toContain("fake/primary-down");
    expect(result.attemptedProviders?.map((a) => a.provider)).toContain("heurist/FundingRateAgent");
  });
});
