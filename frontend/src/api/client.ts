/**
 * Typed API client — the single fetch boundary for the whole frontend.
 * Centralizes base URL, request handling, error normalization, and SSE connection
 * handling. Components consume typed services; no scattered fetch calls.
 *
 * Hard rules preserved here:
 * - The client sends natural-language research messages only — never a flow name.
 * - No credentials of any kind are sent, stored, or referenced (the backend derives
 *   the trader identity server-side). There is nothing here to leak.
 * - SSE is consumed via fetch + ReadableStream (NOT native EventSource, which cannot POST).
 * - Every failure is normalized to a typed ApiError carrying the backend's own vocabulary.
 */

import type { ApiErrorDto } from "./types.js";

const BASE_URL: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL ?? "http://127.0.0.1:3001";

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

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Cannot reach the research backend — is the API server running (`npm run api`)?");
    this.name = "NetworkError";
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
    // non-JSON error body — keep the HTTP fallback above
  }
  throw new ApiError(code, message, res.status, confirmation);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }
  if (!res.ok) await parseErrorBody(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
};

// ---------------------------------------------------------------------------
// SSE — POST /api/research?stream=1
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

  // Parse the event-stream manually: `event:` lines name the event, `data:` lines carry JSON.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleSseChunk(chunk, handlers);
      }
    }
  } catch {
    handlers.onConnectionLost?.();
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
    return; // malformed event — never render garbage
  }
  if (eventName === "progress" && isProgressPayload(payload)) {
    handlers.onProgress({ stage: payload.stage, summary: payload.summary, data: payload.data });
  } else if (eventName === "final") {
    handlers.onFinal(payload);
  } else if (eventName === "error" && isErrorPayload(payload)) {
    handlers.onError(new ApiError(payload.error.code, payload.error.message, 0, payload.error.confirmation));
  }
}

function isProgressPayload(v: unknown): v is { stage: string; summary: string; data?: Record<string, string | number | boolean> } {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).stage === "string" && typeof (v as Record<string, unknown>).summary === "string";
}

function isErrorPayload(v: unknown): v is ApiErrorDto {
  return typeof v === "object" && v !== null && typeof (v as { error?: { code?: unknown } }).error?.code === "string";
}
