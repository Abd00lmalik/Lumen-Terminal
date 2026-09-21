/**
 * Heurist Mesh provider tests (Phase 27); deterministic, no network, no API key required.
 *
 * Laws under test (docs/integrations/heurist.md §5-§6, mandate §10/§11/§24):
 * - TRANSPORT: one POST boundary to mesh.heurist.xyz; the key is sent as Bearer + body but
 *   NEVER echoed into results/logs; credential resolution is deferred (env read at request
 *   time, serverless-safe).
 * - TYPED FAILURES: 401/403 -> AUTHENTICATION_FAILURE (permanent, no retry storm); 429 ->
 *   RATE_LIMIT (retriable); abort -> TIMEOUT; application-level {detail} -> PROVIDER_ERROR;
 *   non-JSON -> INVALID_RESPONSE. Retrieval failure is a technical condition, never
 *   negative evidence: failures come back as EMPTY results with failure metadata.
 * - EPISTEMIC CLASSIFICATION (mandate §11): tool data -> QUANTITATIVE_OBSERVATION with
 *   upstreamSource lineage; agent prose -> ANALYST_INTERPRETATION with interpretationBasis
 *   (the agent's wording never upgrades its epistemic status).
 * - NO DOUBLE COUNT (mandate §10): every output carries upstreamSource so Heurist-served
 *   and directly-served copies of the same upstream can never count as independent
 *   corroboration.
 * - REGISTRY CHAINS: Heurist registers at low priority and only serves when the direct
 *   chain fails; the serving fallback must not erase the primary's failure
 *   (attemptedProviders trail preserved).
 * - NO EXECUTION SURFACE: adapter exposes only data retrieval; no trading operations.
 */
import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import {
  HeuristAgentAdapter,
  HeuristMeshTransport,
  createHeuristAskAdapter,
  createHeuristDefiLlamaAdapter,
  createHeuristFundingRateAdapter,
  createHeuristFredAdapter,
  createHeuristOptionsAdapter,
  createHeuristSecAdapter,
  createHeuristTechnicalAdapter,
  parseHeuristOutputs,
  registerHeuristAdapters,
} from "../../src/adapters/heurist.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";
import type { ToolOutput } from "../../src/domain/tool-result.js";

const origin: ProvenanceOrigin = { kind: "research", id: "test-research" };

/** Scriptable fetch fake: queues JSON bodies (or Error/number to simulate raw failures). */
function fakeFetch(responses: unknown[]): { fetch: typeof fetch; requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const impl = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "number") {
      return new Response(next === 429 ? "rate limited" : "boom", { status: next });
    }
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: impl, requests };
}

/** A fetch fake variant supporting raw status codes (non-JSON bodies). */
function rawFetch(responses: number[]): { fetch: typeof fetch } {
  const queue = [...responses];
  const impl = (async (_url: unknown, _init?: RequestInit) => {
    const next = queue.shift() ?? 500;
    return new Response("raw failure body", { status: next });
  }) as typeof fetch;
  return { fetch: impl };
}

/** A fetch fake that never resolves until the request signal aborts (drives real TIMEOUT). */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    })) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe("HeuristMeshTransport", () => {
  it("posts to /mesh_request with agent_id + tool input and returns the parsed result", async () => {
    const { fetch, requests } = fakeFetch([{ result: { price: 337.42 } }]);
    const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch });

    const { result, rawReference } = await transport.invokeTool("YahooFinanceAgent", "quote_snapshot", { symbols: "AAPL" });

    expect(result).toEqual({ price: 337.42 });
    expect(rawReference).toContain("YahooFinanceAgent.quote_snapshot");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://mesh.heurist.xyz/mesh_request");
    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body.agent_id).toBe("YahooFinanceAgent");
    expect(body.input.tool).toBe("quote_snapshot");
    expect(body.input.tool_arguments).toEqual({ symbols: "AAPL" });
    expect(body.input.raw_data_only).toBe(true); // no LLM summary layer: observations stay data
    expect(body.api_key).toBe("heu_test");
  });

  it("resolves the credential from the environment at REQUEST time (deferred, serverless-safe)", async () => {
    const { fetch, requests } = fakeFetch([{ result: { ok: true } }]);
    const transport = new HeuristMeshTransport({ fetchImpl: fetch });
    expect(transport.hasApiKey).toBe(false); // nothing configured yet

    process.env.HEURIST_API_KEY = "heu_env";
    try {
      expect(transport.hasApiKey).toBe(true);
      await transport.invokeTool("YahooFinanceAgent", "quote_snapshot", {});
      const body = JSON.parse(String(requests[0]!.init.body));
      expect(body.api_key).toBe("heu_env");
    } finally {
      delete process.env.HEURIST_API_KEY;
    }
  });

  it("missing credential -> AUTHENTICATION_FAILURE before any network call", async () => {
    const { fetch } = fakeFetch([]);
    delete process.env.HEURIST_API_KEY;
    const transport = new HeuristMeshTransport({ fetchImpl: fetch });
    await expect(transport.invokeTool("YahooFinanceAgent", "quote_snapshot", {})).rejects.toMatchObject({
      failureType: "AUTHENTICATION_FAILURE",
      retriable: false,
    });
  });

  it("classifies HTTP failures: 401 auth (permanent), 429 rate limit (retriable), 5xx provider error", async () => {
    for (const [status, failureType, retriable] of [
      [401, "AUTHENTICATION_FAILURE", false],
      [429, "RATE_LIMIT", true],
      [503, "PROVIDER_ERROR", true],
    ] as const) {
      const { fetch } = rawFetch([status]);
      const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch });
      await expect(transport.invokeTool("YahooFinanceAgent", "quote_snapshot", {})).rejects.toMatchObject({
        failureType,
        retriable,
      });
    }
  });

  it("request exceeding the deadline -> TIMEOUT (retriable)", async () => {
    const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: hangingFetch(), requestTimeoutMs: 15 });
    await expect(transport.invokeTool("YahooFinanceAgent", "quote_snapshot", {})).rejects.toMatchObject({
      failureType: "TIMEOUT",
      retriable: true,
    });
  }, 5_000);

  it("application-level {detail} error (HTTP 200) -> PROVIDER_ERROR, retriable", async () => {
    const { fetch } = fakeFetch([{ detail: "agent rate limit exceeded" }]);
    const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch });
    await expect(transport.invokeTool("YahooFinanceAgent", "options_chain", { symbol: "AAPL" })).rejects.toMatchObject({
      failureType: "PROVIDER_ERROR",
      retriable: true,
    });
  });

  it("non-JSON body -> INVALID_RESPONSE (permanent for this request)", async () => {
    const { fetch } = rawFetch([200]);
    const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch });
    await expect(transport.invokeTool("YahooFinanceAgent", "quote_snapshot", {})).rejects.toMatchObject({
      failureType: "INVALID_RESPONSE",
      retriable: false,
    });
  });

  it("never echoes the API key into error messages", async () => {
    const { fetch } = rawFetch([401]);
    const transport = new HeuristMeshTransport({ apiKey: "heu_SECRETVALUE", fetchImpl: fetch });
    try {
      await transport.invokeTool("YahooFinanceAgent", "quote_snapshot", {});
      expect.unreachable("expected rejection");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("heu_SECRETVALUE");
    }
  });
});

// ---------------------------------------------------------------------------
// Normalization + classification
// ---------------------------------------------------------------------------

describe("parseHeuristOutputs classification", () => {
  it("array of tool data -> QUANTITATIVE_OBSERVATION with upstreamSource lineage", () => {
    const outputs = parseHeuristOutputs(
      [{ strike: 190, openInterest: 12000, impliedVolatility: 0.31 }, { strike: 195, openInterest: 8000 }],
      "yahoo-finance",
      "AAPL",
    );
    expect(outputs).toHaveLength(2);
    for (const o of outputs) {
      expect(o.outputClass).toBe("QUANTITATIVE_OBSERVATION");
      expect((o.content as { upstreamSource: string }).upstreamSource).toBe("yahoo-finance");
      expect(o.about).toBe("AAPL");
    }
  });

  it("wrapped {data:[...]} payloads are unwrapped", () => {
    const outputs = parseHeuristOutputs({ data: [{ series: "FEDFUNDS", value: 4.33 }] }, "fred");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.outputClass).toBe("QUANTITATIVE_OBSERVATION");
  });

  it("an async job SUBMISSION is not evidence, while a real result that mentions a job id still parses", () => {
    // Live failure: a yields question reached the deep tier, the agent answered with a job
    // submission ({job_id, next_step: "Call check_job_status ..."}), and that envelope alone was
    // ingested as the run's evidence — a pending job satisfying a research requirement.
    expect(() =>
      parseHeuristOutputs(
        { job_id: "d5776eca-b30a", prompt: "Treasury yields", mode: "normal", next_step: "Call check_job_status with job_id 'd5776eca' after 60 sec" },
        "ask-heurist",
      ),
    ).toThrow(/asynchronous job/i);
    expect(() => parseHeuristOutputs({ job_id: "x", status: "queued" }, "ask-heurist")).toThrow(/asynchronous job/i);

    // A completed job id alongside actual content is a result, not a submission.
    const outputs = parseHeuristOutputs({ job_id: "x", status: "completed", answer: "Yields rose on fiscal supply concerns." }, "ask-heurist");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.outputClass).toBe("ANALYST_INTERPRETATION");
  });

  it("agent prose -> ANALYST_INTERPRETATION with interpretationBasis (never self-upgrades to observation)", () => {
    const outputs = parseHeuristOutputs({ content: "AAPL appears to be strengthening because..." }, "yahoo-finance");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.outputClass).toBe("ANALYST_INTERPRETATION");
    expect(outputs[0]!.interpretationBasis).toContain("not a direct market observation");
    expect((outputs[0]!.content as { agentGenerated: boolean }).agentGenerated).toBe(true);
  });

  it("plain string output -> ANALYST_INTERPRETATION with basis", () => {
    const outputs = parseHeuristOutputs("BTC funding looks elevated", "binance-usdm");
    expect(outputs[0]!.outputClass).toBe("ANALYST_INTERPRETATION");
  });

  it("mixed nested objects flatten ONE level; nulls and deeper levels dropped (documented shape)", () => {
    const outputs = parseHeuristOutputs({ quote: { price: 337.42, currency: null, meta: { exchange: "NMS", hidden: { deep: 1 } } } }, "yahoo-finance");
    const content = outputs[0]!.content as Record<string, unknown>;
    expect(content["quote.price"]).toBe(337.42);
    expect(content["currency"]).toBeUndefined();
    expect(content["quote.meta"]).toBeUndefined(); // second nesting level intentionally dropped
  });
});

// ---------------------------------------------------------------------------
// Adapter behavior
// ---------------------------------------------------------------------------

describe("HeuristAgentAdapter", () => {
  it("options adapter builds the right agent/tool call and preserves provenance", async () => {
    const { fetch, requests } = fakeFetch([
      { result: [{ strike: 190, openInterest: 12000, impliedVolatility: 0.31 }] },
    ]);
    const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch });
    const adapter = createHeuristOptionsAdapter(transport);

    const result = await adapter.execute("OPTIONS_CHAIN_ANALYSIS", { asset: "AAPL" });

    expect(result.tool).toBe("heurist/YahooFinanceAgent.options_chain");
    expect(result.transport).toBe("rest:mesh.heurist.xyz");
    expect(result.failure?.type ?? "NONE").toBe("NONE"); // healthy input carries no failure
    expect(result.completeness).toBe("COMPLETE");
    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body.input.tool).toBe("options_chain");
    expect(body.input.tool_arguments.symbol).toBe("AAPL"); // canonical `asset` param mapped
    const output = result.outputs![0] as ToolOutput;
    expect(output.outputClass).toBe("QUANTITATIVE_OBSERVATION");
    expect((output.content as { upstreamSource: string }).upstreamSource).toBe("yahoo-finance");
  });

  it("adapter-level failure returns an honest EMPTY result (never fabricated data, never a throw)", async () => {
    const { fetch } = rawFetch([401]);
    const transport = new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch });
    const adapter = createHeuristFredAdapter(transport);

    const result = await adapter.execute("MACRO_ANALYSIS", { asset: "FEDFUNDS" });

    expect(result.failure.type).toBe("AUTHENTICATION_FAILURE");
    expect(result.completeness).toBe("EMPTY");
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs![0]!.outputClass).toBe("UNAVAILABLE");
    // The key must not leak into the user-visible failure message.
    expect(JSON.stringify(result.outputs![0]!.content)).not.toContain("heu_test");
  });

  it("missing env credential at execute time -> typed throw the registry catches as a failover attempt", async () => {
    delete process.env.HEURIST_API_KEY;
    const adapter = createHeuristFundingRateAdapter(new HeuristMeshTransport({ fetchImpl: fakeFetch([]).fetch }));
    await expect(adapter.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" })).rejects.toMatchObject({
      failureType: "AUTHENTICATION_FAILURE",
      retriable: false,
    });
  });

  it("SEC adapter maps the engine's target into `query` and keeps filing-lineage limitations", async () => {
    const { fetch, requests } = fakeFetch([{ result: { filings: [{ form: "8-K", filedAt: "2026-09-10" }] } }]);
    const adapter = createHeuristSecAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch }));

    const result = await adapter.execute("SOURCE_VALIDATION", { asset: "Apple Inc" });

    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body.agent_id).toBe("SecEdgarAgent");
    expect(body.input.tool_arguments.query).toBe("Apple Inc");
    expect(result.limitations.join(" ")).toContain("primary source");
  });

  it("technical adapter maps `asset` into `symbols` for the Yahoo technical_snapshot", async () => {
    const { fetch, requests } = fakeFetch([{ result: [{ indicator: "RSI", value: 61 }] }]);
    const adapter = createHeuristTechnicalAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch }));

    await adapter.execute("TECHNICAL_ANALYSIS", { asset: "NVDA" });
    const body = JSON.parse(String(requests[0]!.init.body));
    expect(body.input.tool_arguments.symbols).toBe("NVDA");
  });

  it("no subject resolved -> SCHEMA_ERROR without burning credits on a network call", async () => {
    const { fetch, requests } = fakeFetch([]);
    const adapter = createHeuristOptionsAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch }));
    const result = await adapter.execute("OPTIONS_CHAIN_ANALYSIS", {});
    expect(result.failure.type).toBe("SCHEMA_ERROR");
    expect(requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Registry chains (fallback order, provenance trail)
// ---------------------------------------------------------------------------

describe("Heurist registry chains", () => {
  it("OPTIONS_CHAIN_ANALYSIS: Heurist Yahoo is the registered provider (the only working options source)", () => {
    const registry = new CapabilityRegistry();
    registry.register(createHeuristOptionsAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fakeFetch([]).fetch })));
    expect(registry.resolve("OPTIONS_CHAIN_ANALYSIS").map((r) => r.adapter.providerId)).toEqual(["heurist/YahooFinanceAgent"]);
  });

  it("DERIVATIVES_ANALYSIS: Heurist FundingRate serves only after the primary fails; the trail preserves the primary's failure", async () => {
    const registry = new CapabilityRegistry();
    const primaryAttempt: { provider: string } = { provider: "" };
    const failingPrimary = {
      providerId: "fake/bitget-derivatives",
      capabilities: ["DERIVATIVES_ANALYSIS"] as const,
      limitations: ["bitget derivatives down"],
      freshnessProfile: "test",
      async execute() {
        primaryAttempt.provider = "fake/bitget-derivatives";
        throw new Error("connect timeout");
      },
    };
    registry.register(failingPrimary, 100);
    registry.register(
      createHeuristFundingRateAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fakeFetch([{ result: [{ fundingRate: 0.0001, openInterest: 8_100_000_000 }] }]).fetch })),
      300,
    );

    const result = await registry.execute("DERIVATIVES_ANALYSIS", { asset: "BTCUSDT" }, origin);

    expect(result.failure.type).toBe("NONE");
    expect(result.tool).toBe("heurist/FundingRateAgent.get_symbol_oi_and_funding");
    expect(result.limitations.join(" ")).toContain("provider fallback");
    expect(result.limitations.join(" ")).toContain("fake/bitget-derivatives"); // primary failure preserved
    expect(result.attemptedProviders?.map((a) => a.provider)).toContain("fake/bitget-derivatives");
    const output = result.normalizedOutput[0]!;
    expect(output.outputClass).toBe("QUANTITATIVE_OBSERVATION");
    expect((output.content as { upstreamSource: string }).upstreamSource).toBe("binance-usdm");
  });

  it("all Heurist candidates failing -> honest EMPTY with the primary headlined (never fabricated)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(
      createHeuristFredAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: rawFetch([503]).fetch })),
      100,
    );
    registry.register(
      createHeuristFredAdapter(new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: rawFetch([503]).fetch })),
      200,
    );

    const result = await registry.execute("MACRO_ANALYSIS", {}, origin);
    expect(result.failure.type).toBe("PROVIDER_ERROR");
    expect(result.completeness).toBe("EMPTY");
    expect(result.normalizedOutput.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
  });

  it("an async job submission surfaces as EMPTY_RESULT at the registry, never as a satisfied requirement", async () => {
    const registry = new CapabilityRegistry();
    registry.register(
      createHeuristAskAdapter(
        new HeuristMeshTransport({
          apiKey: "heu_test",
          fetchImpl: fakeFetch([{ result: { job_id: "d5776eca", next_step: "Call check_job_status after 60 sec" } }]).fetch,
        }),
      ),
      100,
    );
    const result = await registry.execute("CROSS_DOMAIN_SYNTHESIS", { question: "why are Treasury yields rising" }, origin);
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.completeness).toBe("EMPTY");
    expect(result.normalizedOutput.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
  });

  it("registerHeuristAdapters wires all five agents; ids carry no execution vocabulary", () => {
    const registry = new CapabilityRegistry();
    registerHeuristAdapters(registry);
    const forbidden = /place.?order|submit.?order|execute.?trade|open.?position|close.?position|transfer|withdraw/i;
    const ids = new Set<string>();
    for (const capability of ["OPTIONS_CHAIN_ANALYSIS", "TECHNICAL_ANALYSIS", "SOURCE_VALIDATION", "MACRO_ANALYSIS", "DERIVATIVES_ANALYSIS"]) {
      for (const reg of registry.resolve(capability)) ids.add(reg.adapter.providerId);
    }
    expect([...ids].sort()).toEqual([
      "heurist/FredMacroAgent",
      "heurist/FundingRateAgent",
      "heurist/SecEdgarAgent",
      "heurist/YahooFinanceAgent",
    ]);
    for (const id of ids) expect(forbidden.test(id)).toBe(false);
  });
});

describe("DefiLlama subjectless fallback (zero-dead-end)", () => {
  it("subjectless DEFI_ANALYSIS falls back to get_chain_metrics instead of SCHEMA_ERROR", async () => {
    const { fetch, requests } = fakeFetch([
      { result: { data: { chain: "Ethereum", tvl: { current: "52.02B USD" }, fees: 1_200_000 } } },
    ]);
    const adapter = createHeuristDefiLlamaAdapter(
      new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch }),
    );
    const result = await adapter.execute("DEFI_ANALYSIS", {});

    expect(result.failure?.type ?? "NONE").toBe("NONE"); // healthy result, not a failure
    expect(result.completeness).toBe("COMPLETE");
    expect(result.tool).toBe("heurist/DefiLlamaAgent.get_chain_metrics");
    const body = JSON.parse(String(requests[0]?.init.body ?? "{}")) as {
      input: { tool: string; tool_arguments: Record<string, unknown> };
    };
    expect(body.input.tool).toBe("get_chain_metrics");
    expect(body.input.tool_arguments.chain).toBe("Ethereum");
    // Chain metrics stay quantitative observations with DefiLlama lineage (no double-count).
    expect(result.outputs.some((o) => o.outputClass === "QUANTITATIVE_OBSERVATION")).toBe(true);
  });

  it("a resolved protocol still uses the protocol tool, never the fallback", async () => {
    const { fetch, requests } = fakeFetch([
      { result: { data: { protocol: "uniswap", tvl: "5.1B USD" } } },
    ]);
    const adapter = createHeuristDefiLlamaAdapter(
      new HeuristMeshTransport({ apiKey: "heu_test", fetchImpl: fetch }),
    );
    const result = await adapter.execute("DEFI_ANALYSIS", { protocol: "uniswap" });

    expect(result.failure?.type ?? "NONE").toBe("NONE");
    const body = JSON.parse(String(requests[0]?.init.body ?? "{}")) as {
      input: { tool: string; tool_arguments: Record<string, unknown> };
    };
    expect(body.input.tool).toBe("get_protocol_metrics");
    expect(body.input.tool_arguments.protocol).toBe("uniswap");
  });
});
