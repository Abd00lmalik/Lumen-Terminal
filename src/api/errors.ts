/**
 * F0 error mapping — transport-safe typed errors (F0 mandate §17).
 *
 * Distinctions preserved (never collapsed into HTTP 500):
 * - invalid request → 400 INVALID_REQUEST
 * - ambiguity/confirmation halt → 409 AWAITING_CONFIRMATION (research uncertainty is NOT an error)
 * - model failure → 503 MODEL_FAILURE (the interpretation layer is unavailable; state is preserved)
 * - persistence failure → 500 PERSISTENCE_FAILURE (reported honestly, never as success)
 * - unknown route/object → 404 NOT_FOUND
 * - anything else → 500 INTERNAL_ERROR (sanitized message; no stack traces, no internals)
 */

import type { ApiErrorDTO } from "./dto.js";

export interface MappedError {
  readonly statusCode: number;
  readonly body: ApiErrorDTO;
}

/** Classify an ApiError into a transport-safe response (no stack traces, no internals). */
export function mapApiError(err: unknown): MappedError {
  if (err instanceof ApiFailure) return err.toMapped();
  if (err instanceof InvalidRequestError) {
    return { statusCode: 400, body: { error: { code: "INVALID_REQUEST", message: safeMessage(err.message) } } };
  }
  if (err instanceof ModelFailureError) {
    return { statusCode: 503, body: { error: { code: "MODEL_FAILURE", message: safeMessage(err.failure.message) } } };
  }
  if (err instanceof PersistenceFailureError) {
    return { statusCode: 500, body: { error: { code: "PERSISTENCE_FAILURE", message: safeMessage(err.message) } } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { statusCode: 500, body: { error: { code: "INTERNAL_ERROR", message: safeMessage(message) } } };
}

/** Strip anything that could leak internals: env values, file paths, absolute paths, stack shape. */
function safeMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[path]") // Windows paths
    .replace(/(\/[\w.\-]+){2,}/g, "[path]") // POSIX paths
    .replace(/AIza[\w\-]{10,}/g, "[redacted]") // Gemini key shape
    .slice(0, 400);
}

/** Domain-facing failure shape (mirrors the ModelFailure taxonomy for the research path). */
export interface FailureShape {
  readonly type: string;
  readonly message: string;
}

export class ApiFailure extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorDTO["error"]["code"],
    message: string,
    public readonly confirmation?: { readonly stepIndex: number; readonly reason: string },
  ) {
    super(message);
  }
  toMapped(): MappedError {
    return {
      statusCode: this.statusCode,
      body: { error: { code: this.code, message: safeMessage(this.message), ...(this.confirmation !== undefined ? { confirmation: this.confirmation } : {}) } },
    };
  }
}

export class InvalidRequestError extends ApiFailure {
  constructor(message: string) {
    super(400, "INVALID_REQUEST", message);
  }
}

export class NotFoundError extends ApiFailure {
  constructor(what: string) {
    super(404, "NOT_FOUND", `${what} not found`);
  }
}

export class ModelFailureError extends ApiFailure {
  constructor(public readonly failure: FailureShape) {
    super(503, "MODEL_FAILURE", failure.message);
  }
}

export class PersistenceFailureError extends ApiFailure {
  constructor(cause: unknown) {
    super(500, "PERSISTENCE_FAILURE", cause instanceof Error ? `persistence failure: ${cause.message}` : "persistence failure");
  }
}
