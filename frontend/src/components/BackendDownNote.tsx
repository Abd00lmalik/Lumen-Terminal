/**
 * Shared "backend unreachable" notice; the ONLY place that renders transport-level
 * connectivity failure, so the guidance always matches the environment:
 * - development: the local Fastify server isn't running (dev instruction belongs here only)
 * - production:  the service is unavailable (no dev instructions ever shown)
 *
 * User-facing text is plain language (mandate §20); the typed error code stays available
 * behind a collapsed <details> diagnostics line (§21) — never an API key, header, or
 * payload, just code + status + message the backend already sent.
 */
import type { ReactNode } from "react";
import { ApiError, NetworkError } from "../api/client.js";

export function BackendDownNote({ error, children }: { error: unknown; children?: ReactNode }) {
  const isNetwork = error instanceof NetworkError;
  const diagnostic =
    error instanceof ApiError
      ? `code ${error.code} · HTTP ${error.httpStatus} · ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div className="note warn" role="alert">
      <b>{isNetwork ? "Research service unavailable." : "Research could not start."}</b>{" "}
      {isNetwork && error.environment === "development" && (
        <>The research backend is not responding. Start the local API with <code>npm run api</code> and refresh.</>
      )}
      {isNetwork && error.environment === "production" && (
        <>The research service is temporarily unavailable (usually a deployment or cold start). Try again shortly.</>
      )}
      {!isNetwork && <>The request was refused before research began. Try rephrasing, or try again shortly.</>}
      <details style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
        <summary style={{ cursor: "pointer" }}>View diagnostics</summary>
        <span className="mono" style={{ wordBreak: "break-all" }}>{diagnostic}</span>
      </details>
      {children}
    </div>
  );
}
