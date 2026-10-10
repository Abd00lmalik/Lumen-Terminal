/**
 * Transport resilience primitives; throttling, bounded retry/backoff, failure classification,
 * and raw-response capture. Provider-neutral: the Bitget transports (M1) compose these; the
 * research engine never sees any of it.
 *
 * Architectural basis:
 * - failure-recovery.md §11 (automatic recovery only for transient failures, retry limits),
 *   §12 (bounded RETRY policy), §13 (retry limits depend on failure type), §14 (exponential /
 *   adaptive backoff; rate-limit failures respect provider constraints), §20 (only successfully
 *   retrieved and validated information enters the evidence layer).
 * - FINDINGS.md R6: MCP/REST rate limits are UNKNOWN → client-side throttling from day one.
 * - Final lock §7: raw responses must be referenceable for provenance (rawReference).
 */

import type { ToolFailureType } from "../../domain/tool-result.js";

/** Failure types a transport can produce. */
export type TransportFailureType = Extract<
  ToolFailureType,
  "TIMEOUT" | "RATE_LIMIT" | "AUTHENTICATION_FAILURE" | "UNAVAILABLE" | "INVALID_RESPONSE" | "PROVIDER_ERROR" | "SCHEMA_ERROR" | "EMPTY_RESULT"
>;

/**
 * Typed transport failure. `retriable` follows failure-recovery.md §11: only transient failures
 * (network errors, temporary provider errors, rate limits, timeouts) are retriable. Schema and
 * invalid-response problems are permanent for the same request; retrying cannot fix them.
 */
export class TransportError extends Error {
  readonly failureType: TransportFailureType;
  readonly retriable: boolean;
  readonly status?: number;
  /** Honored from a provider Retry-After header when present (failure-recovery.md §14). */
  readonly retryAfterMs?: number;

  constructor(
    failureType: TransportFailureType,
    message: string,
    options: { retriable: boolean; status?: number; retryAfterMs?: number } = { retriable: false },
  ) {
    super(message);
    this.name = "TransportError";
    this.failureType = failureType;
    this.retriable = options.retriable;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

/** Is this failure transient (failure-recovery.md §11)? */
export function isTransientFailure(error: unknown): boolean {
  return error instanceof TransportError && error.retriable;
}

/**
 * Classify a fetch/HTTP outcome into a transport failure (failure-recovery.md §10 taxonomy).
 * 429 → RATE_LIMIT (retriable, respects Retry-After); 401/403 → AUTHENTICATION_FAILURE;
 * 5xx and network errors → PROVIDER_ERROR (transient); other 4xx → PROVIDER_ERROR (permanent
 * for this request); aborted → TIMEOUT (transient).
 */
export function classifyHttpFailure(status: number, body: string, retryAfterHeader?: string | null): TransportError {
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (status === 429) {
    return new TransportError("RATE_LIMIT", `HTTP 429 rate limited${body ? `: ${truncate(body)}` : ""}`, {
      retriable: true,
      status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (status === 401 || status === 403) {
    return new TransportError("AUTHENTICATION_FAILURE", `HTTP ${status}: ${truncate(body)}`, { retriable: false, status });
  }
  if (status >= 500) {
    return new TransportError("PROVIDER_ERROR", `HTTP ${status} upstream error: ${truncate(body)}`, { retriable: true, status });
  }
  if (status >= 400) {
    return new TransportError("PROVIDER_ERROR", `HTTP ${status} request rejected: ${truncate(body)}`, { retriable: false, status });
  }
  return new TransportError("PROVIDER_ERROR", `HTTP ${status}: ${truncate(body)}`, { retriable: false, status });
}

/** Classify an aborted/timed-out request (failure-recovery.md §10: TIMEOUT, transient). */
export function timeoutError(what: string, timeoutMs: number): TransportError {
  return new TransportError("TIMEOUT", `${what} timed out after ${timeoutMs}ms`, { retriable: true });
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

// ---------------------------------------------------------------------------
// Throttling; client-side rate limiting (FINDINGS.md R6: provider limits UNKNOWN)
// ---------------------------------------------------------------------------

export interface ThrottlerOptions {
  /** Minimum spacing between consecutive requests, in milliseconds. */
  readonly minIntervalMs: number;
  /** Injectable clock/sleep for deterministic tests. Defaults to real time. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Serializes calls and enforces minimum spacing between request starts.
 * Provider constraints are respected before they are hit (failure-recovery.md §14).
 */
export class Throttler {
  private nextAllowedAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ThrottlerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Reserve the time slot SYNCHRONOUSLY before any await: two concurrent callers must never
    // read the same nextAllowedAt and start together (min-spacing guarantee).
    const reservedStart = Math.max(this.now(), this.nextAllowedAt);
    this.nextAllowedAt = reservedStart + this.options.minIntervalMs;
    const waitMs = reservedStart - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    return fn();
  }
}

// ---------------------------------------------------------------------------
// Bounded retry with exponential backoff + full jitter (failure-recovery.md §12–14)
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Total attempts including the first. 1 = no retries. Bounded; retries never run indefinitely. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Respect a provider Retry-After delay even if longer than the computed backoff. Default true. */
  readonly honorRetryAfter?: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  honorRetryAfter: true,
};

/** Raised when all attempts are exhausted; carries the last failure's classification. */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: TransportError;

  constructor(attempts: number, lastError: TransportError) {
    super(`${lastError.message} (after ${attempts} attempt${attempts === 1 ? "" : "s"})`);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export interface RetryOptions {
  readonly policy: RetryPolicy;
  /** Injectable clock for deterministic tests (used for the deadline stop). */
  readonly now?: () => number;
  /** Injectable sleep for deterministic tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Test/observability hook: invoked before each retry with the wait actually applied. */
  readonly onRetry?: (error: TransportError, attempt: number, delayMs: number) => void;
  /**
   * Shared wall-clock deadline (epoch ms): once reached, NO further attempt is started, no
   * matter how many policy attempts remain (capability time budgets: retries must never
   * consume the whole investigation budget). The last failure is surfaced as
   * RetryExhaustedError so the typed classification survives.
   */
  readonly deadlineMs?: number;
}

/**
 * Retry a transport call with exponential backoff and full jitter. Only transient failures
 * (failure-recovery.md §11) are retried; permanent failures propagate immediately. Bounded by
 * `policy.maxAttempts` AND by `deadlineMs` when given; never indefinite.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const { policy } = options;

  let lastError: TransportError | undefined;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      const isLastAttempt = attempt === policy.maxAttempts;
      // Permanent failures propagate immediately as themselves; retrying cannot fix them and
      // wrapping them in RetryExhaustedError would misrepresent the failure (failure-recovery.md §11).
      if (!error.retriable) throw error;
      lastError = error;
      if (isLastAttempt) break;
      // Deadline stop: the shared investigation budget outranks policy attempts — a retry
      // that would START after the deadline must not start at all.
      if (options.deadlineMs !== undefined && now() >= options.deadlineMs) break;

      let delayMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      delayMs = Math.floor(delayMs * (0.5 + Math.random() * 0.5)); // full jitter
      if (policy.honorRetryAfter !== false && error.retryAfterMs !== undefined) {
        delayMs = Math.max(delayMs, error.retryAfterMs);
      }
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw new RetryExhaustedError(policy.maxAttempts, lastError!);
}

// ---------------------------------------------------------------------------
// Raw capture; provenance requires referenceable raw responses (final lock §7)
// ---------------------------------------------------------------------------

/**
 * Bounded in-memory store of raw provider payloads. Each capture gets a stable reference that
 * TOOL_RESULT.rawReference points at, so provenance is real (inspectable within the process),
 * not invented. Secrets never pass through here: adapters capture what the provider returned.
 */
export class RawCapture {
  private readonly entries = new Map<string, { at: string; payload: string }>();
  private sequence = 0;

  constructor(private readonly maxEntries = 200) {}

  /** Store a raw payload; returns its provenance reference. */
  capture(kind: string, locator: string, payload: string, at = new Date()): string {
    this.sequence += 1;
    const reference = `${kind}:${locator}#raw-${this.sequence}`;
    this.entries.set(reference, { at: at.toISOString(), payload });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return reference;
  }

  /** Retrieve a raw payload by reference (provenance traversal, research-object-model.md §21). */
  get(reference: string): { at: string; payload: string } | undefined {
    return this.entries.get(reference);
  }

  get size(): number {
    return this.entries.size;
  }
}

// ---------------------------------------------------------------------------
// Full-exchange fetch: headers AND body under ONE deadline, caller-cancellable
// ---------------------------------------------------------------------------

/**
 * Compose multiple abort signals without AbortSignal.any (engines: node >=20.0; .any needs
 * 20.3). The combined signal aborts when ANY input aborts; cleanup removes every listener so
 * a completed request never leaks listeners on long-lived caller signals.
 */
export function combineSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  for (const s of signals) {
    if (s === undefined) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    const onAbort = (): void => controller.abort(s.reason);
    s.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => s.removeEventListener("abort", onAbort));
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

export interface FullExchangeOptions {
  /** Hard wall-clock ceiling covering headers AND complete body consumption. */
  readonly timeoutMs: number;
  /** Caller cancellation (budget expiry, engine abort): propagated through fetch + body read. */
  readonly signal?: AbortSignal;
  /** Human-readable request identity for error messages. */
  readonly what: string;
}

export interface FullExchangeResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly text: string;
}

/**
 * Perform one HTTP exchange where the abort signal stays active until the response BODY has
 * been fully read (production defect this replaces: transports cleared their timeout after
 * headers arrived, so an SSE keep-alive stream could hold `response.text()` past every
 * budget — the capability stayed pending indefinitely). Classification:
 * - own deadline fires → TIMEOUT (retriable; a bounded retry may still fit the budget)
 * - CALLER signal fires → TIMEOUT, retriable: FALSE (the budget that cancelled this call
 *   will cancel the retry too; retrying would starve the investigation)
 * - other network failures → PROVIDER_ERROR (retriable), never a hang.
 * Timers and abort listeners are cleared on every exit path.
 */
export async function fetchWithDeadline(
  fetchImpl: typeof fetch,
  url: string | URL,
  init: RequestInit,
  options: FullExchangeOptions,
): Promise<FullExchangeResponse> {
  const deadlineController = new AbortController();
  const timer = setTimeout(() => deadlineController.abort(), options.timeoutMs);
  const combined = combineSignals(init.signal ?? undefined, deadlineController.signal, options.signal);
  const cleanup = (): void => {
    clearTimeout(timer);
    combined.cleanup();
  };
  const abortedError = (phase: "headers" | "body"): TransportError => {
    if (options.signal?.aborted === true) {
      return new TransportError("TIMEOUT", `${options.what} cancelled by caller during ${phase}`, { retriable: false });
    }
    return timeoutError(`${options.what} (${phase} phase)`, options.timeoutMs);
  };
  const isAbort = (error: unknown): boolean =>
    deadlineController.signal.aborted ||
    options.signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError");

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: combined.signal });
    } catch (error) {
      if (isAbort(error)) throw abortedError("headers");
      throw new TransportError(
        "PROVIDER_ERROR",
        `network error calling ${options.what}: ${error instanceof Error ? error.message : String(error)}`,
        { retriable: true },
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (isAbort(error)) throw abortedError("body");
      throw new TransportError(
        "PROVIDER_ERROR",
        `network error reading response body from ${options.what}: ${error instanceof Error ? error.message : String(error)}`,
        { retriable: true },
      );
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, headers, text };
  } finally {
    cleanup();
  }
}
