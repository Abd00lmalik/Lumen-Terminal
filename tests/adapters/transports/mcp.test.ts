import { beforeEach, describe, expect, it } from "vitest";
import { McpTransport, DEFAULT_MCP_ENDPOINT } from "../../../src/adapters/transports/mcp.js";
import { TransportError, Throttler } from "../../../src/adapters/transports/resilience.js";

/**
 * Handshake-aware fetch stub (live-discovered 2026-09-13, see module doc in mcp.ts):
 * - POST initialize → 200, `mcp-session-id` header, SSE-framed initialize result
 * - POST notifications/initialized → 202, empty body
 * - everything else consumes the next scripted step (steps are tool-call outcomes only
 *   handshake requests do NOT consume steps).
 */
function sessionAwareFetch(
  steps: Array<string | { status?: number; body?: string; headers?: Record<string, string>; throw?: Error }>,
  log?: Array<{ method?: string; headers?: Record<string, string> }>,
  options: { sessionHeader?: boolean; initStatus?: number } = {},
) {
  let toolStep = 0;
  return (async (_url: unknown, init?: RequestInit) => {
    const bodyText = init?.body === undefined ? "" : String(init.body);
    const parsed = (() => { try { return JSON.parse(bodyText) as { method?: string; id?: number }; } catch { return {}; } })();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    log?.push({ method: parsed.method, headers });

    if (parsed.method === "initialize") {
      const sid = "session-test-0001";
      const result = JSON.stringify({
        jsonrpc: "2.0", id: parsed.id ?? 0,
        result: { protocolVersion: "2025-03-26", serverInfo: { name: "market-data-mcp", version: "1.26.0" }, capabilities: {} },
      });
      return new Response(`event: message\ndata: ${result}\n\n`, {
        status: options.initStatus ?? 200,
        headers: {
          "content-type": "text/event-stream",
          ...(options.sessionHeader === false ? {} : { "mcp-session-id": sid }),
        },
      });
    }
    if (parsed.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    const step = steps[Math.min(toolStep, steps.length - 1)];
    toolStep++;
    if (typeof step === "string") {
      return new Response(step, { status: 200, headers: { "content-type": "application/json" } });
    }
    if (step.throw) throw step.throw;
    return new Response(step.body ?? "", {
      status: step.status ?? 200,
      headers: step.headers ?? { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function okJsonRpc(content: unknown[], isError = false): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 99, result: { content, isError } });
}

describe("MCP transport; session handshake (DISCOVERED live 2026-09-13)", () => {
  let sleeps: number[];
  let fakeSleep: (ms: number) => Promise<void>;

  beforeEach(() => {
    sleeps = [];
    fakeSleep = (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
  });

  it("performs initialize → notifications/initialized before the first tools/call and reuses the session", async () => {
    const log: Array<{ method?: string; headers?: Record<string, string> }> = [];
    const transport = new McpTransport({
      endpoint: DEFAULT_MCP_ENDPOINT,
      fetchImpl: sessionAwareFetch([okJsonRpc([{ type: "text", text: "ok" }]), okJsonRpc([{ type: "text", text: "ok-2" }])], log),
    });

    await transport.callTool("news_feed", { action: "latest" });
    await transport.callTool("macro_indicators", {});

    const methods = log.map((l) => l.method);
    // initialize → notifications/initialized precede the first call; session established once.
    expect(methods[0]).toBe("initialize");
    expect(methods[1]).toBe("notifications/initialized");
    expect(methods[2]).toBe("tools/call");
    expect(methods.filter((m) => m === "initialize")).toHaveLength(1);
    // tools/call requests carry the session id header (live: bare calls → 400 Missing session ID)
    expect(log[2]!.headers["mcp-session-id"]).toBe("session-test-0001");
    expect(log[3]!.headers["mcp-session-id"]).toBe("session-test-0001");
    // notifications carry no id; tools/call does
    expect(transport.connectedServerInfo).toEqual({ name: "market-data-mcp", version: "1.26.0", protocolVersion: "2025-03-26" });
  });

  it("re-handshakes and replays when the server reports a missing session (transient transport state)", async () => {
    let firstCall = true;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const bodyText = String(init?.body ?? "");
      const parsed = JSON.parse(bodyText) as { method?: string };
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (parsed.method === "initialize") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-03-26", serverInfo: { name: "m", version: "1" }, capabilities: {} } }),
          { status: 200, headers: { "mcp-session-id": "sid-2" } },
        );
      }
      if (parsed.method === "notifications/initialized") return new Response("", { status: 202 });
      if (firstCall) {
        firstCall = false;
        // Live-discovered rejection for lost/expired sessions (HTTP 400, JSON-RPC -32600).
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Bad Request: Missing session ID" } }), { status: 400 });
      }
      expect(headers["mcp-session-id"]).toBe("sid-2");
      return new Response(okJsonRpc([{ type: "text", text: "recovered" }]), { status: 200 });
    }) as typeof fetch;

    const transport = new McpTransport({ fetchImpl, retryOptions: { sleep: fakeSleep }, throttler: { minIntervalMs: 0 } });
    const outcome = await transport.callTool("news_feed", {});
    expect(outcome.content).toEqual([{ type: "text", text: "recovered" }]);
    expect(outcome.attempts).toBe(2); // replay after re-handshake, bounded retry engaged
  });

  it("initialize without an mcp-session-id header is INVALID_RESPONSE (permanent; retry cannot fix it)", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([], undefined, { sessionHeader: false }),
      retryOptions: { sleep: fakeSleep },
      throttler: { minIntervalMs: 0 },
    });
    const error = await transport.callTool("news_feed", {}).catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.failureType).toBe("INVALID_RESPONSE");
    expect(error.retriable).toBe(false);
    expect(sleeps).toHaveLength(0);
  });

  it("initialize failure surfaces with its HTTP classification", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([], undefined, { initStatus: 503 }),
      retryOptions: { sleep: fakeSleep },
      throttler: { minIntervalMs: 0 },
    });
    const error = await transport.callTool("news_feed", {}).catch((e) => e);
    expect(error.failureType).toBe("PROVIDER_ERROR"); // 5xx → transient upstream
    expect(error.retriable).toBe(true);
  });
});

describe("MCP transport boundary (final lock §7, failure-recovery.md §12–14)", () => {
  let sleeps2: number[];
  let fakeSleep2: (ms: number) => Promise<void>;

  beforeEach(() => {
    sleeps2 = [];
    fakeSleep2 = (ms) => {
      sleeps2.push(ms);
      return Promise.resolve();
    };
  });

  it("invokes tools/call over HTTP and returns tool content + raw reference", async () => {
    const log: Array<{ method?: string; headers?: Record<string, string> }> = [];
    const transport = new McpTransport({
      endpoint: DEFAULT_MCP_ENDPOINT,
      fetchImpl: sessionAwareFetch([okJsonRpc([{ type: "text", text: "RISK-OFF" }])], log),
    });

    const outcome = await transport.callTool("macro_indicators", { action: "multi_indicator" });

    expect(outcome.isError).toBe(false);
    expect(outcome.content).toEqual([{ type: "text", text: "RISK-OFF" }]);
    expect(outcome.rawReference).toMatch(/^mcp:macro_indicators@https:\/\/datahub\.noxiaohao\.com\/mcp#raw-\d+$/);
    expect(outcome.attempts).toBe(1);
    // JSON-RPC 2.0 tools/call body with method+params (provenance: params are recorded)
    const callLog = log.find((l) => l.method === "tools/call")!;
    expect(callLog).toBeDefined();
    // raw payload is retrievable by reference (provenance traversal, §21)
    expect(transport.rawCapture.get(outcome.rawReference)?.payload).toContain("RISK-OFF");
  });

  it("preserves the documented endpoint and does not send auth headers (FINDINGS.md §1: no key)", async () => {
    const log: Array<{ method?: string; headers?: Record<string, string> }> = [];
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([okJsonRpc([{ type: "text", text: "ok" }])], log),
    });
    await transport.callTool("news_feed", { action: "latest" });
    for (const entry of log) {
      expect(entry.headers["authorization"]).toBeUndefined();
      expect(entry.headers["x-api-key"]).toBeUndefined();
    }
  });

  it("classifies HTTP 429 as retriable RATE_LIMIT and honors Retry-After", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([
        { status: 429, body: "slow down", headers: { "retry-after": "1" } },
        { body: okJsonRpc([{ type: "text", text: "ok" }]) },
      ]),
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });

    const outcome = await transport.callTool("sentiment_index", { action: "current" });
    expect(outcome.attempts).toBe(2);
    expect(sleeps2[0]).toBeGreaterThanOrEqual(1000); // Retry-After respected (failure-recovery §14)
  });

  it("classifies 401/403 as AUTHENTICATION_FAILURE and does NOT retry permanent failures", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([{ status: 401, body: "denied" }]),
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });
    await expect(transport.callTool("macro_indicators", { action: "multi_indicator" })).rejects.toMatchObject({
      failureType: "AUTHENTICATION_FAILURE",
      retriable: false,
    });
    expect(sleeps2).toHaveLength(0); // no backoff wasted on permanent failure
  });

  it("classifies 5xx as transient PROVIDER_ERROR and exhausts bounded retries with backoff", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([{ status: 503, body: "upstream down" }]),
      retryPolicy: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });

    const error = await transport.callTool("crypto_market", { action: "overview" }).catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.failureType).toBe("PROVIDER_ERROR");
    expect(error.retriable).toBe(true);
    expect(sleeps2).toHaveLength(2); // 2 retries between 3 attempts (bounded, failure-recovery §12)
    expect(sleeps2[0]).toBeGreaterThanOrEqual(50); // jittered backoff ≥ half base
    expect(sleeps2[1]).toBeGreaterThanOrEqual(sleeps2[0]); // non-decreasing (exponential + jitter)
  });

  it("treats MCP isError:true as retriable tool-level failure (neutral per-source failures, FINDINGS.md §2)", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([
        { body: okJsonRpc([{ type: "text", text: "data temporarily unavailable" }], true) },
        { body: okJsonRpc([{ type: "text", text: "ok" }]) },
      ]),
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });
    const outcome = await transport.callTool("derivatives_sentiment", { action: "long_short" });
    expect(outcome.attempts).toBe(2);
  });

  it("parses SSE-framed JSON-RPC responses (streamable HTTP variant)", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([
        { body: `event: message\ndata: ${okJsonRpc([{ type: "text", text: "sse-ok" }])}\n\n`, headers: { "content-type": "text/event-stream" } },
      ]),
      throttler: { minIntervalMs: 0 },
    });
    const outcome = await transport.callTool("news_feed", { action: "latest" });
    expect(outcome.content).toEqual([{ type: "text", text: "sse-ok" }]);
  });

  it("maps JSON-RPC method errors (-32601) to permanent failures (retry cannot fix bad method)", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([{ body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } }) }]),
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });
    const error = await transport.callTool("no_such_tool", {}).catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.retriable).toBe(false);
    expect(sleeps2).toHaveLength(0);
  });

  it("aborted requests classify as TIMEOUT (transient, failure-recovery.md §10)", async () => {
    const transport = new McpTransport({
      fetchImpl: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            (e as Error & { name: string }).name = "AbortError";
            reject(e);
          });
        })) as unknown as typeof fetch,
      requestTimeoutMs: 20,
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });
    const error = await transport.callTool("macro_indicators", {}).catch((e) => e);
    expect(error.failureType).toBe("TIMEOUT");
    expect(error.retriable).toBe(true);
  });

  it("non-JSON garbage classifies as INVALID_RESPONSE (permanent for this request)", async () => {
    const transport = new McpTransport({
      fetchImpl: sessionAwareFetch([{ body: "<html>gateway error</html>" }]),
      retryOptions: { sleep: fakeSleep2 },
      throttler: { minIntervalMs: 0 },
    });
    const error = await transport.callTool("news_feed", { action: "latest" }).catch((e) => e);
    expect(error.failureType).toBe("INVALID_RESPONSE");
    expect(error.retriable).toBe(false);
  });

  it("reserves concurrent slots synchronously with min spacing (FINDINGS.md R6 rate limiting)", async () => {
    // Regression: two concurrent callers must never reserve the same time slot. Reservations
    // happen synchronously before any await, so concurrent calls serialize with min spacing.
    // Uses real timers because the guarantee is about real elapsed spacing. The interval is
    // sized so a scheduled 5ms sleep CANNOT overshoot the spacing even under full parallel
    // suite load; the law under test is slot spacing, not machine speed (a tight 20ms
    // interval measured the load, not the throttler, and flaked under parallelism). The
    // tolerance acknowledges timer coalescing under load: the assertion must hold for the
    // throttler's serialization, not for one unlucky 5ms sleep landing late.
    const minIntervalMs = 60;
    const throttler = new Throttler({ minIntervalMs });
    const t0 = Date.now();
    const windows: Array<{ start: number; end: number }> = [];

    const run = () =>
      throttler.run(async () => {
        const start = Date.now() - t0;
        await new Promise((r) => setTimeout(r, 5));
        windows.push({ start, end: Date.now() - t0 });
      });

    await Promise.all([run(), run(), run()]);
    expect(windows).toHaveLength(3);
    const sorted = [...windows].sort((a, b) => a.start - b.start);
    // No overlap between consecutive calls…
    expect(sorted[1]!.start).toBeGreaterThanOrEqual(sorted[0]!.end);
    expect(sorted[2]!.start).toBeGreaterThanOrEqual(sorted[1]!.end);
    // …and total span reflects serialized spacing (slots 0/60/120), not simultaneous starts.
    expect(sorted[2]!.start).toBeGreaterThanOrEqual(2 * minIntervalMs - 15);
  });
});
