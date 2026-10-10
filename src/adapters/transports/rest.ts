/**
 * Bitget public REST transport (candle/kline endpoints used by technical-analysis).
 *
 * Architectural basis:
 * - FINDINGS.md §2.4: `technical-analysis` reads **direct Bitget public REST**:
 *   `api.bitget.com/api/v2/spot/market/candles` (spot) and `/api/v2/mix/market/candles`
 *   (USDT-futures). Public endpoints; no auth for this capability. Rate limits are UNKNOWN
 *   (FINDINGS.md §2.4) → client-side throttling + bounded retry (failure-recovery.md §12–14).
 * - Final lock §9: technical-analysis supplies exact market timestamps and price structure;
 *   preserve timeframe, kline count, timestamps, data source. Lock §3: indicators are
 *   observations, never automatic trading recommendations.
 *
 * This is a boundary, not an integration: it defines how M1 adapters speak public REST. The
 * indicator math itself belongs to the skill adapter (M2 execution uses the adapter contract).
 */

import {
  Throttler,
  withRetry,
  TransportError,
  RetryExhaustedError,
  classifyHttpFailure,
  fetchWithDeadline,
  RawCapture,
  type RetryPolicy,
  type RetryOptions,
  type ThrottlerOptions,
} from "./resilience.js";

export const DEFAULT_REST_BASE_URL = "https://api.bitget.com";

/** Candle schema returned by Bitget v2 candles endpoints (order per official API docs). */
export interface Candle {
  /** Open time (ms since epoch, string per API). */
  readonly ts: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly baseVolume: string;
  readonly quoteVolume: string;
}

export interface RestGetOptions {
  /** Query parameters; values stringified in order. */
  readonly params?: Record<string, string>;
  readonly requestTimeoutMs?: number;
  /** Per-request headers merged over the transport defaults (e.g. crumb cookies). */
  readonly headers?: Record<string, string>;
  /** "json" (default) parses the body as JSON; "text" returns the raw text (CSV/XML/RSS endpoints). */
  readonly responseType?: "json" | "text";
  /** Shared investigation deadline (epoch ms): bounds attempts AND per-attempt timeout. */
  readonly deadlineMs?: number;
  /** Caller cancellation (engine/budget abort), propagated through fetch + body consumption. */
  readonly signal?: AbortSignal;
}

export interface RestGetOutcome {
  /** Parsed JSON body (structure validated by the caller/adapter). */
  readonly body: unknown;
  readonly rawReference: string;
  readonly attempts: number;
  readonly durationMs: number;
  readonly status: number;
}

export interface RestTransportOptions {
  readonly baseUrl?: string;
  readonly retryPolicy?: RetryPolicy;
  readonly throttler?: ThrottlerOptions;
  readonly retryOptions?: Pick<RetryOptions, "now" | "sleep" | "onRetry">;
  /** Test seam: override the underlying HTTP fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Default headers sent with every request (e.g. a browser User-Agent). */
  readonly defaultHeaders?: Record<string, string>;
}

export class RestTransport {
  private readonly baseUrl: string;
  private readonly retryPolicy: RetryPolicy;
  private readonly throttler: Throttler;
  private readonly retryOptions: Pick<RetryOptions, "now" | "sleep" | "onRetry">;
  /**
   * The HTTP fetch this transport uses. Public so adapters that need an out-of-band handshake
   * (a cookie/crumb exchange on another host) keep the SAME injected fetch as the transport
   * instead of reaching for the global one — a global fetch in an adapter silently bypasses the
   * test seam and makes the deterministic suite depend on the network.
   */
  readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  readonly rawCapture: RawCapture;

  constructor(options: RestTransportOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_REST_BASE_URL;
    this.retryPolicy = options.retryPolicy ?? { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 4_000, honorRetryAfter: true };
    this.throttler = new Throttler(options.throttler ?? { minIntervalMs: 120 });
    this.retryOptions = options.retryOptions ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.rawCapture = new RawCapture();
  }

  /**
   * GET a public REST path with query params; throttled + bounded retry. The same
   * full-exchange deadline law as McpTransport: the abort signal stays active until the body
   * is fully consumed (headers+body under ONE deadline), and `options.deadlineMs` stops
   * retries once the investigation budget is exhausted.
   */
  async get(path: string, options: RestGetOptions = {}): Promise<RestGetOutcome> {
    const startedAt = Date.now();
    const MIN_ATTEMPT_FLOOR_MS = 500;
    const timeoutForAttempt = (): number => {
      const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
      if (options.deadlineMs === undefined) return requestTimeoutMs;
      const remaining = options.deadlineMs - Date.now();
      if (remaining < MIN_ATTEMPT_FLOOR_MS) {
        throw new TransportError("TIMEOUT", `REST GET ${path}: insufficient deadline budget (${remaining}ms left, floor ${MIN_ATTEMPT_FLOOR_MS}ms)`, { retriable: false });
      }
      return Math.min(requestTimeoutMs, remaining);
    };
    return this.throttler.run(async () => {
      let attempts = 0;
      const outcome = await withRetry(async (attempt) => {
        attempts = attempt;
        return this.getOnce(path, options, timeoutForAttempt());
      }, { policy: this.retryPolicy, ...this.retryOptions, ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}) });
      return { ...outcome, attempts, durationMs: Date.now() - startedAt };
    }).catch((error: unknown) => {
      if (error instanceof RetryExhaustedError) throw error.lastError;
      throw error;
    });
  }

  private async getOnce(path: string, options: RestGetOptions, timeoutMs: number): Promise<RestGetOutcome> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }

    // Full-exchange deadline: body read is inside the abort window (a stalling/chunked
    // response can no longer hold the request open past requestTimeoutMs).
    const { status, headers, text } = await fetchWithDeadline(
      this.fetchImpl,
      url,
      { method: "GET", headers: { ...this.defaultHeaders, ...options.headers } },
      {
        timeoutMs,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        what: `REST GET ${path}`,
      },
    );

    if (status < 200 || status >= 300) {
      throw classifyHttpFailure(status, text, headers["retry-after"]);
    }

    // Capture the raw payload BEFORE parsing: even unparseable/failed responses must remain
    // inspectable for provenance (final lock §7); nothing is silently swallowed.
    const rawReference = this.rawCapture.capture("rest", `GET ${path}${url.search}`, text);
    if (options.responseType === "text") {
      return { body: text, rawReference, attempts: 0, durationMs: 0, status };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new TransportError("INVALID_RESPONSE", `REST GET ${path} returned non-JSON body (raw captured: ${rawReference})`, { retriable: false });
    }
    return { body, rawReference, attempts: 0, durationMs: 0, status };
  }

  /** Introspection for tests. */
  get capturedRawCount(): number {
    return this.rawCapture.size;
  }
}
