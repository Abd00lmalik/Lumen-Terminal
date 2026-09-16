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
