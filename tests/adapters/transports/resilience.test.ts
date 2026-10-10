import { describe, expect, it } from "vitest";
import {
  Throttler,
  withRetry,
  TransportError,
  RetryExhaustedError,
  RawCapture,
  isTransientFailure,
  classifyHttpFailure,
  DEFAULT_RETRY_POLICY,
  combineSignals,
  fetchWithDeadline,
} from "../../../src/adapters/transports/resilience.js";

describe("resilience primitives (failure-recovery.md §11–15)", () => {
  it("withRetry: retries transient failures up to maxAttempts, then raises RetryExhaustedError", async () => {
    let attempts = 0;
    const error = await withRetry(
      async () => {
        attempts++;
        throw new TransportError("PROVIDER_ERROR", "flaky", { retriable: true });
      },
      { policy: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 10 }, sleep: () => Promise.resolve() },
    ).catch((e) => e);

    expect(attempts).toBe(4); // bounded; never indefinite (failure-recovery.md §12)
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect(error.lastError.failureType).toBe("PROVIDER_ERROR");
    expect(error.attempts).toBe(4);
  });

  it("withRetry: permanent failures propagate immediately without retry", async () => {
    let attempts = 0;
    const error = await withRetry(
      async () => {
        attempts++;
        throw new TransportError("INVALID_RESPONSE", "permanent", { retriable: false });
      },
      { policy: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 10 }, sleep: () => Promise.resolve() },
    ).catch((e) => e);

    expect(attempts).toBe(1);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.retriable).toBe(false);
  });

  it("withRetry: success after transient failures returns the value and stops retrying", async () => {
    let attempts = 0;
    const value = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new TransportError("TIMEOUT", "t", { retriable: true });
        return "ok";
      },
      { policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 }, sleep: () => Promise.resolve() },
    );
    expect(value).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("withRetry: Retry-After overrides computed backoff when larger (failure-recovery.md §14)", async () => {
    const waits: number[] = [];
    await withRetry(
      async () => {
        throw new TransportError("RATE_LIMIT", "429", { retriable: true, retryAfterMs: 5000 });
      },
      {
        policy: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 100 },
        sleep: async (ms) => waits.push(ms),
      },
    ).catch(() => undefined);
    expect(waits[0]).toBeGreaterThanOrEqual(5000);
  });

  it("withRetry: onRetry hook observes each retry (test/observability seam)", async () => {
    const retries: Array<{ attempt: number; type: string }> = [];
    await withRetry(
      async () => {
        throw new TransportError("RATE_LIMIT", "429", { retriable: true });
      },
      {
        policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
        sleep: () => Promise.resolve(),
        onRetry: (error, attempt) => retries.push({ attempt, type: error.failureType }),
      },
    ).catch(() => undefined);
    expect(retries).toEqual([
      { attempt: 1, type: "RATE_LIMIT" },
      { attempt: 2, type: "RATE_LIMIT" },
    ]);
  });

  it("isTransientFailure distinguishes transient from permanent (failure-recovery.md §11)", () => {
    expect(isTransientFailure(new TransportError("TIMEOUT", "t", { retriable: true }))).toBe(true);
    expect(isTransientFailure(new TransportError("RATE_LIMIT", "r", { retriable: true }))).toBe(true);
    expect(isTransientFailure(new TransportError("AUTHENTICATION_FAILURE", "a", { retriable: false }))).toBe(false);
    expect(isTransientFailure(new Error("plain"))).toBe(false);
  });

  it("classifyHttpFailure maps the failure taxonomy (failure-recovery.md §10)", () => {
    expect(classifyHttpFailure(429, "").failureType).toBe("RATE_LIMIT");
    expect(classifyHttpFailure(429, "").retriable).toBe(true);
    expect(classifyHttpFailure(401, "").failureType).toBe("AUTHENTICATION_FAILURE");
    expect(classifyHttpFailure(403, "").retriable).toBe(false);
    expect(classifyHttpFailure(500, "").retriable).toBe(true);
    expect(classifyHttpFailure(503, "").failureType).toBe("PROVIDER_ERROR");
    expect(classifyHttpFailure(400, "").retriable).toBe(false);
    expect(classifyHttpFailure(404, "").retriable).toBe(false);
  });

  it("Throttler serializes sequential calls with minimum spacing", async () => {
    const nowRef = { value: 0 };
    const throttler = new Throttler({
      minIntervalMs: 50,
      now: () => nowRef.value,
      sleep: async (ms) => {
        nowRef.value += ms;
      },
    });
    const marks: number[] = [];
    for (let i = 0; i < 3; i++) {
      await throttler.run(async () => marks.push(nowRef.value));
    }
    expect(marks[1]! - marks[0]!).toBeGreaterThanOrEqual(50);
    expect(marks[2]! - marks[1]!).toBeGreaterThanOrEqual(50);
  });

  it("RawCapture: bounded ring buffer with stable references (provenance, lock §7)", () => {
    const capture = new RawCapture(3);
    const refs: string[] = [];
    for (let i = 0; i < 5; i++) {
      refs.push(capture.capture("mcp", "tool@endpoint", `payload-${i}`));
    }
    expect(capture.size).toBe(3); // oldest evicted
    expect(capture.get(refs[0]!)).toBeUndefined(); // payload-0 evicted
    expect(capture.get(refs[4]!)?.payload).toBe("payload-4");
    expect(refs[4]).toMatch(/^mcp:tool@endpoint#raw-\d+$/);
  });

  it("DEFAULT_RETRY_POLICY is bounded (retries never run indefinitely, failure-recovery.md §12)", () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBeLessThanOrEqual(5);
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBeLessThanOrEqual(10_000);
  });
});

describe("withRetry deadline stop (regression 2026-10-09)", () => {
  it("stops retrying once the deadline is reached, even with attempts remaining", async () => {
    let attempts = 0;
    let clock = 1_000;
    const error = await withRetry(
      async () => {
        attempts++;
        clock += 400; // each attempt consumes 400ms of wall clock
        throw new TransportError("TIMEOUT", "hung upstream", { retriable: true });
      },
      {
        policy: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
        sleep: async () => { /* injected: no real waiting */ },
        now: () => clock,
        deadlineMs: 1_800, // first attempt ends at 1_400 (retry OK); second at 2_000 (deadline passed)
      },
    ).catch((e) => e);

    expect(attempts).toBe(2); // second failure at t=2_000 ≥ deadline 1_800 → no third attempt
    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect(error.lastError.failureType).toBe("TIMEOUT");
  });

  it("does not retry at all when the deadline is already passed before the first attempt", async () => {
    let attempts = 0;
    let clock = 5_000;
    const error = await withRetry(
      async () => {
        attempts++;
        throw new TransportError("TIMEOUT", "budget gone", { retriable: true });
      },
      {
        policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
        sleep: async () => { /* no real waiting */ },
        now: () => clock,
        deadlineMs: 4_000,
      },
    ).catch((e) => e);
    expect(attempts).toBe(1); // first attempt runs (fn is invoked), the retry does not start
    expect(error).toBeInstanceOf(RetryExhaustedError);
  });
});

describe("combineSignals + fetchWithDeadline (full-exchange deadline, regression 2026-10-09)", () => {
  it("combineSignals: aborts when ANY input aborts; aborts immediately when an input is already aborted", () => {
    const a = new AbortController();
    const b = new AbortController();
    const { signal, cleanup } = combineSignals(a.signal, b.signal);
    expect(signal.aborted).toBe(false);
    b.abort();
    expect(signal.aborted).toBe(true);
    cleanup();

    const pre = new AbortController();
    pre.abort();
    const already = combineSignals(undefined, pre.signal);
    expect(already.signal.aborted).toBe(true);
  });

  it("fetchWithDeadline: success path returns status, lowercased headers, and fully-read body", async () => {
    const fetchImpl = (async () =>
      new Response("hello", { status: 200, headers: { "Content-Type": "text/plain" } })) as unknown as typeof fetch;
    const result = await fetchWithDeadline(fetchImpl, "https://example.com", {}, { timeoutMs: 1_000, what: "test" });
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/plain");
    expect(result.text).toBe("hello");
  });

  it("fetchWithDeadline: a body that stalls past the deadline throws retriable TIMEOUT (was: hang past the cleared timeout)", async () => {
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            }, { once: true });
          }),
      })) as unknown as typeof fetch;
    const error = await fetchWithDeadline(fetchImpl, "https://example.com", {}, { timeoutMs: 30, what: "stall test" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.failureType).toBe("TIMEOUT");
    expect(error.retriable).toBe(true);
    expect(error.message).toContain("body phase");
  });

  it("fetchWithDeadline: caller cancellation is non-retriable TIMEOUT (budget that cancelled will cancel the retry)", async () => {
    const caller = new AbortController();
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              reject(e);
            }, { once: true });
          }),
      })) as unknown as typeof fetch;
    const pending = fetchWithDeadline(fetchImpl, "https://example.com", {}, {
      timeoutMs: 10_000,
      signal: caller.signal,
      what: "cancel test",
    });
    setTimeout(() => caller.abort(), 20);
    const error = await pending.catch((e) => e);
    expect(error.failureType).toBe("TIMEOUT");
    expect(error.retriable).toBe(false);
  });

  it("fetchWithDeadline: non-abort network failures are retriable PROVIDER_ERROR (never a hang)", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const error = await fetchWithDeadline(fetchImpl, "https://example.com", {}, { timeoutMs: 1_000, what: "net test" })
      .catch((e) => e);
    expect(error.failureType).toBe("PROVIDER_ERROR");
    expect(error.retriable).toBe(true);
  });
});
