/**
 * Typed API client; the single fetch boundary for the whole frontend.
 * Centralizes base URL, request handling, error normalization, and SSE connection
 * handling. Components consume typed services; no scattered fetch calls.
 *
 * Hard rules preserved here:
 * - The client sends natural-language research messages only; never a flow name.
 * - No credentials of any kind are sent, stored, or referenced (the backend derives
 *   the trader identity server-side). There is nothing here to leak.
 * - SSE is consumed via fetch + ReadableStream (NOT native EventSource, which cannot POST).
 * - Every failure is normalized to a typed ApiError carrying the backend's own vocabulary.
 */

import type { ApiErrorDto } from "./types.js";

/**
 * API base URL resolution:
 * - VITE_API_URL set (local dev pointing at the Fastify server) → use it.
 * - Production / any non-dev origin → same-origin `/api` (the Vercel function).
 * - Dev default → the local Fastify server.
 * Production never depends on localhost; local dev never needs a build-time variable.
 */
export function resolveBaseUrl(env: Record<string, string | boolean | undefined> | undefined): string {
  if (typeof env?.VITE_API_URL === "string" && env.VITE_API_URL !== "") return env.VITE_API_URL;
  if (env?.PROD === true) return ""; // same-origin /api in production
  return "http://127.0.0.1:3001";
}

const BASE_URL: string = resolveBaseUrl(
  (import.meta as { env?: Record<string, string | boolean | undefined> }).env,
);

/** Normalized API error carrying the backend's typed vocabulary. */
export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly confirmation?: { readonly stepIndex: number; readonly reason: string };

  constructor(code: string, message: string, httpStatus: number, confirmation?: { readonly stepIndex: number; readonly reason: string }) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    if (confirmation !== undefined) this.confirmation = confirmation;
  }
}

/**
 * Transport-level connection failure. `environment` distinguishes dev-local-unreachable
 * from production-service-unavailable so the UI can show the RIGHT recovery guidance
 * (dev: start the local server; prod: the service is down/redeploying; retry later).
 * A development instruction (`npm run api`) must never reach a production user.
 */
export class NetworkError extends Error {
  readonly environment: "development" | "production";

  constructor(cause: unknown, opts?: { readonly production?: boolean }) {
    const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env;
    const production = opts?.production ?? env?.PROD === true;
    super(
      production
        ? "Research service unavailable; the API is not responding. This is usually temporary (deployment or cold start); try again shortly."
        : "Cannot reach the research backend; is the API server running (`npm run api`)?",
    );
    this.name = "NetworkError";
    this.environment = production ? "production" : "development";
    this.cause = cause;
  }
}

async function parseErrorBody(res: Response): Promise<never> {
  let code = "INTERNAL_ERROR";
  let message = `Request failed (HTTP ${res.status})`;
  let confirmation: { readonly stepIndex: number; readonly reason: string } | undefined;
  try {
    const body = (await res.json()) as ApiErrorDto;
    if (body?.error?.code !== undefined) {
      code = body.error.code;
      message = body.error.message;
      confirmation = body.error.confirmation;
    }
  } catch {
    // non-JSON error body; keep the HTTP fallback above
  }
  throw new ApiError(code, message, res.status, confirmation);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // One automatic retry for transient conditions: serverless cold starts, deploy windows,
  // and platform-level responses whose body is not our typed envelope can produce a single
  // failed workspace/history read; a confirmed double failure surfaces honestly.
  const attempt = async (): Promise<Response> => {
    try {
      return await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch (cause) {
      throw new NetworkError(cause);
    }
  };
  let res: Response;
  try {
    res = await attempt();
    if (!res.ok && res.status >= 500) res = await attempt();
  } catch {
    // First attempt threw (network/abort shape); retry once before giving up.
    res = await attempt();
  }
  if (!res.ok) {
    // A typed {error:{code}} body is OUR app's considered answer (INVALID_REQUEST,
    // AWAITING_CONFIRMATION, ...): never retried, never masked. A status whose body is not
    // our envelope is a platform-level response the app never generated (observed once as
    // a browser-only 400); for safe idempotent reads, retry once before surfacing.
    let typed = true;
    try {
      const probe = res.clone();
      const body = (await probe.json()) as ApiErrorDto;
      typed = body?.error?.code !== undefined;
    } catch {
      typed = false;
    }
    if (!typed && (init?.method === undefined || init.method === "GET")) {
      const retried = await attempt();
      if (retried.ok) {
        res = retried;
      } else {
        await parseErrorBody(retried);
      }
    } else {
      await parseErrorBody(res);
    }
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    // A 200 whose body failed to parse is transport corruption, not app state; one retry.
    const retried = await attempt();
    if (!retried.ok) await parseErrorBody(retried);
    try {
      return (await retried.json()) as T;
    } catch {
      throw new ApiError("INTERNAL_ERROR", `Response failed to parse (${path}); retried once. HTTP ${retried.status}.`, retried.status);
    }
  }
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
};

// ---------------------------------------------------------------------------
// SSE; POST /api/research?stream=1
// ---------------------------------------------------------------------------

export interface StreamHandlers {
  readonly onProgress: (event: { readonly stage: string; readonly summary: string; readonly data?: Record<string, string | number | boolean> }) => void;
  readonly onFinal: (result: unknown) => void;
  readonly onError: (error: ApiError) => void;
  readonly onConnectionLost?: () => void;
}

/**
 * Submit a research request over the SSE stream. Emits REAL backend progress events;
 * terminates on the `final` or `error` event. No simulated stages, no timers.
 */
export async function streamResearch(
  message: string,
  options: { confirmed?: boolean; signal?: AbortSignal },
  handlers: StreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/research?stream=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message, ...(options.confirmed ? { confirmed: true } : {}) }),
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted) return;
    handlers.onError(new ApiError("NETWORK", "Cannot reach the research backend.", 0));
    void cause;
    return;
  }

  if (!res.ok || res.body === null) {
    try {
      await parseErrorBody(res);
    } catch (err) {
      handlers.onError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "Stream failed", res.status));
    }
    return;
  }

  // Terminal-once semantics: after a `final` result has been delivered, later error or
  // connection-lost signals (e.g. a reset during connection teardown) must never
  // overwrite or follow the delivered result with a phantom failure turn.
  let delivered = false;
  const guarded: StreamHandlers = {
    ...handlers,
    onFinal: (result) => {
      delivered = true;
      handlers.onFinal(result);
    },
    onError: (error) => {
      if (!delivered) handlers.onError(error);
    },
    onConnectionLost: handlers.onConnectionLost
      ? () => {
          if (!delivered) handlers.onConnectionLost!();
        }
      : undefined,
  };

  // Parse the event-stream manually: `event:` lines name the event, `data:` lines carry JSON.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // An intermediary may normalize SSE line endings to CRLF; normalize back so the
      // blank-line event separator is always exactly "\n\n" regardless of transport.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleSseChunk(chunk, guarded);
      }
    }
    // The stream can end without a trailing blank line (proxy truncation, early close)
    // and the decoder can hold buffered multi-byte bytes: flush both and drain any
    // complete residual event so a terminal `final`/`error` is never dropped after the
    // last read (a dropped final looked like an eternal "Researching…").
    buffer += decoder.decode();
    if (buffer.trim().length > 0) handleSseChunk(buffer, guarded);
  } catch {
    guarded.onConnectionLost?.();
  }
}

function handleSseChunk(chunk: string, handlers: StreamHandlers): void {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith(":")) continue; // comment/heartbeat
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    // Malformed PROGRESS events are skippable garbage; a malformed TERMINAL event must
    // never fail silently, because silence leaves the UI "researching" forever.
    if (eventName === "final" || eventName === "error") {
      handlers.onError(new ApiError("INTERNAL_ERROR", "The backend sent a malformed terminal event; no result can be rendered.", 0));
    }
    return;
  }
  if (eventName === "progress" && isProgressPayload(payload)) {
    handlers.onProgress({ stage: payload.stage, summary: payload.summary, data: payload.data });
  } else if (eventName === "final") {
    if (isResponsePayload(payload)) handlers.onFinal(payload);
    else handlers.onError(new ApiError("INTERNAL_ERROR", "The backend's final result was malformed; no result can be rendered.", 0));
  } else if (eventName === "error") {
    if (isErrorPayload(payload)) handlers.onError(new ApiError(payload.error.code, payload.error.message, 0, payload.error.confirmation));
    else handlers.onError(new ApiError("INTERNAL_ERROR", "The backend reported a run failure without a typed error payload.", 0));
  }
}

/** Minimal transport-level shape check; rendering itself trusts the backend's typed DTO. */
function isResponsePayload(v: unknown): v is { outcome: string; answer: { answer: string } } {
  if (typeof v !== "object" || v === null) return false;
  const record = v as Record<string, unknown>;
  const answer = record.answer;
  return typeof record.outcome === "string" && typeof answer === "object" && answer !== null && typeof (answer as Record<string, unknown>).answer === "string";
}

function isProgressPayload(v: unknown): v is { stage: string; summary: string; data?: Record<string, string | number | boolean> } {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).stage === "string" && typeof (v as Record<string, unknown>).summary === "string";
}

function isErrorPayload(v: unknown): v is ApiErrorDto {
  return typeof v === "object" && v !== null && typeof (v as { error?: { code?: unknown } }).error?.code === "string";
}
