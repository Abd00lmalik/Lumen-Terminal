/**
 * PAYLOAD IDENTITY — one provider response is ONE observation.
 *
 * A capability-level provider (the CoinGecko fallback declares both MARKET_DATA_ANALYSIS and
 * CRYPTO_MARKET_DATA) is reached under several capability names in one run. Each call mints a
 * NEW evidence object with a NEW id, so the same byte-identical payload came to be reported as
 * several pieces of evidence — and the requirement's evidence count, which the trader reads as
 * corroboration, grew with the number of capability names rather than with information.
 *
 * The identity is a stable fingerprint of the underlying RESPONSE: the serving provider, the
 * response's own timestamp when it has one, and a content digest. It deliberately does NOT
 * include the capability name or the tool-result id — those are the things that differ between
 * two copies of the same response, which is exactly what identity must ignore.
 *
 * Provenance is preserved: every copy keeps its own id, capability attribution and transport.
 * Identity only governs whether two copies count as two facts.
 */
import { createHash } from "node:crypto";
import type { ToolOutput, ToolResult } from "./tool-result.js";

/**
 * Stable fingerprint of a served payload.
 *
 * Deterministic across processes (no randomness, no time of call) so two routes of one
 * response collide by construction rather than by luck.
 */
export function payloadIdentityOf(result: ToolResult, output: ToolOutput): string {
  const origin = servingOrigin(result);
  const content = stableStringify(output.content);
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 32);
  return `${origin}|${result.sourceTimestamp ?? "-"}|${digest}`;
}

/** The serving provider: the one that actually returned the data, never the first attempted. */
function servingOrigin(result: ToolResult): string {
  const attempted = result.attemptedProviders ?? [];
  if (attempted.length > 0) return attempted[attempted.length - 1]?.provider ?? result.tool;
  return result.tool;
}

/**
 * Key order must not change the fingerprint: two payloads that differ only in JSON property
 * order are the same response.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}