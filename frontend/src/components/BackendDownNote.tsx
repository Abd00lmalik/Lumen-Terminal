/**
 * Shared "backend unreachable" notice; the ONLY place that renders transport-level
 * connectivity failure, so the guidance always matches the environment:
 * - development: the local Fastify server isn't running (dev instruction belongs here only)
 * - production:  the service is unavailable (no dev instructions ever shown)
 *
 * Accepts the raw error so a NetworkError's environment-aware message is preserved instead
 * of being flattened to a string by the page.
 */
import type { ReactNode } from "react";
import { ApiError, NetworkError } from "../api/client.js";

export function BackendDownNote({ error, children }: { error: unknown; children?: ReactNode }) {
  const isNetwork = error instanceof NetworkError;
  return (
    <div className="note warn" role="alert">
      <b>{isNetwork ? "Research service unavailable." : "Request failed."}</b>{" "}
      {error instanceof ApiError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error)}{" "}
      {isNetwork && error.environment === "development" && (
        <>start the local API with <code>npm run api</code> and refresh.</>
      )}
      {isNetwork && error.environment === "production" && (
        <>try again shortly; if it persists the deployment may need attention.</>
      )}
      {children}
    </div>
  );
}
