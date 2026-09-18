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
      <b>{isNetwork ? "Research service unavailable." : "Workspace state could not load."}</b>{" "}
      {isNetwork && error.environment === "development" && (
        <>The research backend is not responding. Start the local API with <code>npm run api</code> and refresh.</>
      )}
      {isNetwork && error.environment === "production" && (
        <>The research service is temporarily unavailable (usually a deployment or cold start). Try again shortly.</>
      )}
      {!isNetwork && (
        <>
          {/* This note also renders for workspace-snapshot loads, which are independent of
              submissions: research itself may be running or completed while this read failed.
              The old wording ("Research could not start / request refused") mislabeled that
              condition and made it look like the submission was blocked. */}
          Your workspace state (history, evidence, thesis) could not be loaded. Submitting new
          research still works; the result will appear here and in history once the connection
          recovers. Try Refresh state in a moment.
        </>
      )}
      <details style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
        <summary style={{ cursor: "pointer" }}>View diagnostics</summary>
        <span className="mono" style={{ wordBreak: "break-all" }}>{diagnostic}</span>
      </details>
      {children}
    </div>
  );
}
