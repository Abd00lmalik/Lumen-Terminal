/**
 * Failure-injection scenarios (repair mandate Phase 18); deterministic, no network.
 *
 * The law under test: A PROVIDER FAILURE IS NOT A RESEARCH FAILURE. Each scenario
 * injects a specific failure into the primary provider and verifies the chain recovers
 * with honest provenance — or, when every path is exhausted, returns an honest typed
 * failure without fabricating evidence.
 *
 * Scenarios (2026-10-05: the paid Heurist Mesh agent tier was removed from the research
 * path; the failover laws are unchanged and are now exercised against the KEYLESS public
 * replacements that took its capabilities, which is the whole point of the replacement —
 * a chain that recovers identically without spending credits):
 * 1. Derivatives: direct primary fails -> keyless public exchange serves
 * 2. Derivatives: direct AND keyless both fail -> honest EMPTY with the full attempt trail
 * 3. Cross-domain: timeout -> retriable failure classified; fallback serves
 * 4. Cross-domain: rate limit -> retriable classification reaches the fallback trail
 * 5. Cross-domain: auth failure skips the provider for the request; next fallback still serves
 */
import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { PublicDerivativesAdapter } from "../../src/adapters/public-derivatives.js";
import { SecEdgarAdapter } from "../../src/adapters/sec-edgar.js";
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
// Scenario 1+2: the derivatives chain (direct primary -> keyless public exchange)
// ---------------------------------------------------------------------------

describe("failure injection: derivatives chain", () => {
  it("direct primary fails -> keyless public exchange serves; primary failure preserved in the trail", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("DERIVATIVES_ANALYSIS", "fake/deriv-down", "connect timeout"), 100);
    registry.register(
      new PublicDerivativesAdapter({
        fetchImpl: fakeFetch([
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", fundingRate: "0.00012", fundingRateTimestamp: "1791180000000" }] } },
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", openInterest: "9500000000", openInterestValue: "820000000000", timestamp: "1791180000000" }] } },
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", buyRatio: "0.58", sellRatio: "0.42", timestamp: "1791180000000" }] } },
        ]).fetch,
      }),
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toContain("fallback/public-derivatives");
    expect(result.limitations.join(" ")).toContain("provider fallback");
    expect(result.limitations.join(" ")).toContain("fake/deriv-down");
    expect(result.attemptedProviders?.map((a) => a.provider)).toContain("fake/deriv-down");
    // Epistemic honesty: every venue figure is an observation labelled with its venue.
    const kinds = result.normalizedOutput.map((o) => (o.content as { kind?: string }).kind);
    expect(kinds).toContain("funding_rate");
    expect(kinds).toContain("open_interest");
  });

  it("direct AND keyless both fail -> honest EMPTY with the full attempt trail (never fabricated, never negative evidence)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("DERIVATIVES_ANALYSIS", "fake/deriv-down", "connect timeout"), 100);
    registry.register(new PublicDerivativesAdapter({ fetchImpl: fakeFetch([new Error("network unreachable")]).fetch }), 300);

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    expect(result.completeness).toBe("EMPTY");
    expect(result.failure.type).not.toBe("NONE");
    // The PRIMARY's failure is the headline (identity in `tool`); the fallback attempt
    // is preserved in the trail. Neither is ever erased by the other.
    expect(result.tool).toContain("fake/deriv-down");
    expect(result.limitations.join(" ")).toContain("provider fallback attempted and failed");
    expect(result.limitations.join(" ")).toContain("fallback/public-derivatives");
    expect(result.attemptedProviders?.map((a) => a.provider)).toContain("fallback/public-derivatives");
    expect(result.normalizedOutput.every((o) => o.outputClass !== "FACTUAL_OBSERVATION")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3-7: cross-domain injection (timeout/rate-limit/auth/SEC)
// ---------------------------------------------------------------------------

describe("failure injection: cross-domain recovery classes", () => {
  it("timeout on primary -> retriable failure classified; fallback serves", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingPrimary("DERIVATIVES_ANALYSIS", "fake/deriv-primary", "The operation was aborted"), 100);
    registry.register(
      new PublicDerivativesAdapter({
        fetchImpl: fakeFetch([
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", fundingRate: "0.00012", fundingRateTimestamp: "1791180000000" }] } },
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", openInterest: "9500000000", timestamp: "1791180000000" }] } },
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", buyRatio: "0.58", sellRatio: "0.42", timestamp: "1791180000000" }] } },
        ]).fetch,
      }),
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toContain("fallback/public-derivatives");
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
      new PublicDerivativesAdapter({
        fetchImpl: fakeFetch([
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", fundingRate: "0.0001", fundingRateTimestamp: "1791180000000" }] } },
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", openInterest: "8000000000", timestamp: "1791180000000" }] } },
          { retCode: 0, result: { list: [{ symbol: "BTCUSDT", buyRatio: "0.55", sellRatio: "0.45", timestamp: "1791180000000" }] } },
        ]).fetch,
      }),
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    // Insufficient-coverage failover: the rate-limited primary produced no usable
    // outputs, so the fallback serves — and the rate limit stays in the trail.
    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toContain("fallback/public-derivatives");
    expect(JSON.stringify(result.limitations) + JSON.stringify(result.attemptedProviders)).toContain("fake/rate-limited");
  });

  it("a body-embedded error (HTTP 200) is a provider failure, never evidence", async () => {
    // The live failure this law encodes: a paid agent answered HTTP 200 with
    // `{error: "402 Payment Required"}`, which parsed as an observation and produced a
    // false "COMPLETE". The keyless exchange surfaces the same shape on quota/billing
    // rejection, so the guard must hold here too.
    const adapter = new PublicDerivativesAdapter({
      fetchImpl: fakeFetch([
        { error: "API request failed: 402, message='Payment Required'" },
        { error: "API request failed: 402, message='Payment Required'" },
        { error: "API request failed: 402, message='Payment Required'" },
      ]).fetch,
    });

    const result = await adapter.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" });

    expect(result.completeness).toBe("EMPTY");
    expect(result.outputs.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
    // The rejection reason survives into the attempt trail for an operator...
    expect(JSON.stringify(result.limitations)).toContain("402");
    // ...and the content states this is a retrieval gap, NOT evidence that positioning
    // was absent or unchanged. A billing failure must never read as a market finding.
    expect(result.outputs[0]!.content).toContain("NOT evidence");
  });
});

// ---------------------------------------------------------------------------
// SEC EDGAR: the keyless SOURCE_VALIDATION replacement
// ---------------------------------------------------------------------------

describe("failure injection: SEC EDGAR chain", () => {
  const TICKER_FILE = { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } };
  const SUBMISSIONS = {
    cik: "0000320193",
    name: "Apple Inc.",
    tickers: ["AAPL"],
    exchanges: ["Nasdaq"],
    sic: "3571",
    sicDescription: "Electronic Computers",
    filings: {
      recent: {
        accessionNumber: ["0000320193-25-000079"],
        filingDate: ["2025-11-01"],
        form: ["10-K"],
        primaryDocument: ["aapl-20250927.htm"],
        reportDate: ["2025-09-27"],
      },
    },
  };

  it("resolves a real filing with its EDGAR URL as provenance (keyless, no credential)", async () => {
    const adapter = new SecEdgarAdapter({ fetchImpl: fakeFetch([TICKER_FILE, SUBMISSIONS]).fetch });
    const result = await adapter.execute("SOURCE_VALIDATION", { symbol: "AAPL" });
    const filing = result.outputs.find((o) => (o.content as { kind?: string }).kind === "filing_index_record");
    expect(filing).toBeDefined();
    const content = filing!.content as { edgarUrl?: string; form?: string; isPrimarySource?: boolean };
    expect(content.form).toBe("10-K");
    expect(content.isPrimarySource).toBe(true);
    // The URL is what makes the reference checkable — it is the provenance, not the payload.
    expect(content.edgarUrl).toContain("sec.gov/Archives/edgar/data/320193/000032019325000079/");
  });

  it("a non-registrant subject resolves to honest UNAVAILABLE, never an unrelated issuer's filings", async () => {
    // The class of bug that produced production garbage elsewhere: an unknown token resolved
    // to SOME company's filings. A crypto asset must not reach SEC registrant data.
    const adapter = new SecEdgarAdapter({ fetchImpl: fakeFetch([]).fetch });
    const result = await adapter.execute("SOURCE_VALIDATION", { symbol: "BTC" });
    expect(result.outputs.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
    expect(result.outputs[0]!.content).toContain("registrant");
  });

  it("an upstream error yields honest EMPTY with the reason preserved", async () => {
    const adapter = new SecEdgarAdapter({ fetchImpl: fakeFetch([new Error("network unreachable")]).fetch });
    const registry = new CapabilityRegistry();
    registry.register(adapter, 300);
    const result = await registry.execute("SOURCE_VALIDATION", { symbol: "AAPL" });
    expect(result.completeness).toBe("EMPTY");
    expect(result.failure.type).not.toBe("NONE");
    expect(result.normalizedOutput.every((o) => o.outputClass !== "FACTUAL_OBSERVATION")).toBe(true);
  });
});