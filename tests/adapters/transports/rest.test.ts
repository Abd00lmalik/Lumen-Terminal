import { beforeEach, describe, expect, it } from "vitest";
import { RestTransport, DEFAULT_REST_BASE_URL, type Candle } from "../../../src/adapters/transports/rest.js";
import { TransportError } from "../../../src/adapters/transports/resilience.js";

function candlesResponse(candles: Candle[]): string {
  return JSON.stringify({ code: "00000", msg: "success", data: candles });
}

function candle(ts: string, close: string): Candle {
  return { ts, open: close, high: close, low: close, close, baseVolume: "1", quoteVolume: "1" };
}

function scriptedFetch(responses: Array<{ status?: number; body?: string; headers?: Record<string, string> }>, log?: string[]) {
  let call = 0;
  return (async (url: unknown) => {
    log?.push(String(url));
    const step = responses[Math.min(call, responses.length - 1)];
    call++;
    return new Response(step.body ?? "", { status: step.status ?? 200, headers: step.headers ?? {} });
  }) as typeof fetch;
}

describe("REST transport boundary (technical-analysis data path, FINDINGS.md §2.4)", () => {
  let sleeps: number[];
  let fakeSleep: (ms: number) => Promise<void>;

  beforeEach(() => {
    sleeps = [];
    fakeSleep = (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
  });

  it("GETs the public candles endpoint with query params and returns parsed body + raw reference", async () => {
    const urls: string[] = [];
    const transport = new RestTransport({
      baseUrl: DEFAULT_REST_BASE_URL,
      fetchImpl: scriptedFetch([{ body: candlesResponse([candle("1700000000000", "42000")]) }], urls),
    });

    const outcome = await transport.get("/api/v2/spot/market/candles", {
      params: { symbol: "BTCUSDT", granularity: "1h", limit: "200" },
    });

    expect(urls[0]).toContain(`${DEFAULT_REST_BASE_URL}/api/v2/spot/market/candles`);
    expect(urls[0]).toContain("symbol=BTCUSDT");
    expect(urls[0]).toContain("granularity=1h");
    const body = outcome.body as { code: string; data: Candle[] };
    expect(body.code).toBe("00000");
    expect(body.data).toHaveLength(1);
    expect(transport.rawCapture.get(outcome.rawReference)?.payload).toContain("42000");
  });

  it("classifies 429 as retriable RATE_LIMIT and honors Retry-After", async () => {
    const transport = new RestTransport({
      fetchImpl: scriptedFetch([
        { status: 429, body: "rate limited", headers: { "retry-after": "2" } },
        { body: candlesResponse([]) },
      ]),
      retryOptions: { sleep: fakeSleep },
      throttler: { minIntervalMs: 0 },
    });
    const outcome = await transport.get("/api/v2/spot/market/candles", { params: { symbol: "BTCUSDT" } });
    expect(outcome.attempts).toBe(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
  });

  it("classifies 5xx as transient PROVIDER_ERROR with bounded retries; 401 as permanent", async () => {
    const transient = new RestTransport({
      fetchImpl: scriptedFetch([{ status: 502, body: "bad gateway" }]),
      retryPolicy: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 50 },
      retryOptions: { sleep: fakeSleep },
      throttler: { minIntervalMs: 0 },
    });
    const err = await transient.get("/api/v2/spot/market/candles").catch((e) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect(err.failureType).toBe("PROVIDER_ERROR");
    expect(err.retriable).toBe(true);
    expect(sleeps).toHaveLength(1); // bounded: 1 retry between 2 attempts

    const permanent = new RestTransport({
      fetchImpl: scriptedFetch([{ status: 403, body: "forbidden" }]),
      retryOptions: { sleep: fakeSleep },
      throttler: { minIntervalMs: 0 },
    });
    const err2 = await permanent.get("/api/v2/spot/market/candles").catch((e) => e);
    expect(err2.failureType).toBe("AUTHENTICATION_FAILURE");
    expect(err2.retriable).toBe(false);
    expect(sleeps).toHaveLength(1); // unchanged — permanent failures don't retry
  });

  it("non-JSON body → INVALID_RESPONSE (permanent); failed responses are raw-captured for provenance", async () => {
    const transport = new RestTransport({
      fetchImpl: scriptedFetch([{ body: "<html>oops</html>" }]),
      retryOptions: { sleep: fakeSleep },
      throttler: { minIntervalMs: 0 },
    });
    const err = await transport.get("/api/v2/spot/market/candles").catch((e) => e);
    expect(err.failureType).toBe("INVALID_RESPONSE");
    expect(err.retriable).toBe(false);
    // Even failed responses are inspectable (provenance), nothing silently swallowed:
    expect(transport.capturedRawCount).toBe(1);
  });
});
