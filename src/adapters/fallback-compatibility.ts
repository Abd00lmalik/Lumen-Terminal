/**
 * Fallback-compatibility validators (pure; no research imports — the registry layer stays
 * free of research-domain coupling).
 *
 * Purpose: a capability-level fallback can "succeed" (failure NONE, non-UNAVAILABLE outputs)
 * yet still be unable to answer the request that reached it: the wrong instrument, a
 * snapshot standing in for a series, a STALE result presented as a live answer. The registry
 * previously accepted any non-UNAVAILABLE output, so such answers closed the capability
 * silently. These validators give each fallback domain a strict, inspectable gate: reject
 * with reasons so the next provider in the chain gets a chance (and the attempt trail keeps
 * the rejection readable).
 *
 * Laws preserved:
 * - the PRIMARY attempt is never gated (coverage-only failover law) — these validators run
 *   only on fallback candidates
 * - identity is compared only when BOTH sides expose an instrument (never inventing one)
 * - STALE is rejected for live requests; HISTORICAL is acceptable only when the request
 *   itself asked for a historical window (research-object-model freshness semantics)
 * - a validator never fabricates, never mutates the result — it only says compatible or not
 */

import type { ToolResult, ToolOutput } from "../domain/tool-result.js";

export type FallbackGate =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reasons: readonly string[] };

const compatible: FallbackGate = { compatible: true };

/** Instrument token from a request param (loose: asset/symbol/coin/ticker). */
function requestedInstrument(params: Record<string, unknown>): string | undefined {
  for (const key of ["asset", "symbol", "coin", "ticker"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim() !== "") {
      return normalizeInstrument(value);
    }
  }
  return undefined;
}

/** Normalize for identity comparison: uppercase, strip separators, first segment. */
function normalizeInstrument(raw: string): string {
  return raw.trim().toUpperCase().split(/[\s/:\-]/)[0] ?? "";
}

/**
 * Instrument each output claims to describe (`about`, or content fields). Returns undefined
 * when the output exposes none — identity is compared only when both sides speak it.
 */
function outputInstruments(outputs: readonly ToolOutput[]): readonly string[] {
  const found = new Set<string>();
  for (const output of outputs) {
    if (typeof output.about === "string" && output.about.trim() !== "") {
      found.add(normalizeInstrument(output.about));
    }
    const content = output.content;
    if (typeof content === "object" && content !== null && !Array.isArray(content)) {
      const record = content as Record<string, unknown>;
      for (const key of ["symbol", "coin", "ticker", "about"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim() !== "") {
          found.add(normalizeInstrument(value));
        }
      }
    }
  }
  return [...found];
}

/** Was the result produced by a provider different from `primaryTool`? (trivially true at gate time). */
function freshnessCheck(
  result: ToolResult,
  params: Record<string, unknown>,
  reasons: string[],
  what: string,
): void {
  const freshness = result.freshness;
  const windowRequested =
    params["historical"] === true ||
    typeof params["from"] === "string" ||
    typeof params["since"] === "string" ||
    typeof params["period"] === "string" ||
    typeof params["range"] === "string" ||
    // The engine's lookback brief (MC-5): a bounded window request (e.g. "last 24 hours")
    // makes a provider's bounded historical slice the CORRECT answer, not a wrong one —
    // G1 marks every result HISTORICAL even when it serves today's candles.
    (typeof params["requiredWindowHours"] === "number" && params["requiredWindowHours"] > 0);
  if (freshness === "STALE" && !windowRequested) {
    reasons.push(`${what} returned a STALE result for a live request`);
  }
  if (freshness === "HISTORICAL" && !windowRequested) {
    reasons.push(`${what} returned a HISTORICAL result but no historical window was requested`);
  }
}

/**
 * Crypto market-data fallback gate (CoinGecko, G1-crypto paths): instrument identity plus
 * freshness. A snapshot cannot be rejected for lacking series fields here — facet checks are
 * the requesting flow's job (the dataFacets contract already prevents over-crediting) — but
 * a wrong coin or a stale snapshot must not close the capability.
 */
export function validateCryptoMarketFallback(
  params: Record<string, unknown>,
  result: ToolResult,
): FallbackGate {
  const reasons: string[] = [];
  const requested = requestedInstrument(params);
  const provided = outputInstruments(result.normalizedOutput);
  if (requested !== undefined && provided.length > 0 && !provided.includes(requested)) {
    // crypto ids are words ("bitcoin") while requests are tickers ("BTC"): only reject when
    // the provided set is disjoint AND none of the provided tokens is a plausible alias of
    // the request (substring containment covers "bitcoin" vs "BITCOIN").
    const plausible = provided.some(
      (p) => p.includes(requested) || requested.includes(p) || aliasTable(requested).has(p),
    );
    if (!plausible) {
      reasons.push(`crypto fallback answered with instrument ${provided.join("/")}, not the requested ${requested}`);
    }
  }
  freshnessCheck(result, params, reasons, "crypto fallback");
  return reasons.length === 0 ? compatible : { compatible: false, reasons };
}

/** Small alias table so "BTC" ↔ "XBT" style equivalents are not false mismatches. */
const INSTRUMENT_ALIASES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["BTC", new Set(["XBT", "BITCOIN"])],
  ["XBT", new Set(["BTC", "BITCOIN"])],
  ["BITCOIN", new Set(["BTC", "XBT"])],
  ["ETH", new Set(["ETHEREUM"])],
  ["ETHEREUM", new Set(["ETH"])],
]);

function aliasTable(token: string): ReadonlySet<string> {
  return INSTRUMENT_ALIASES.get(token) ?? new Set();
}

/**
 * Equity/commodity/FX market-data fallback gate: ticker identity plus freshness. The equity
 * chain (Yahoo primary → Stooq fallback inside one adapter; adapter-level fallbacks across
 * adapters) must never let an unrelated ticker's quote stand in for the requested one.
 */
export function validateEquityMarketFallback(
  params: Record<string, unknown>,
  result: ToolResult,
): FallbackGate {
  const reasons: string[] = [];
  const requested = requestedInstrument(params);
  const provided = outputInstruments(result.normalizedOutput);
  if (requested !== undefined && provided.length > 0 && !provided.includes(requested)) {
    reasons.push(`equity fallback answered with instrument ${provided.join("/")}, not the requested ${requested}`);
  }
  freshnessCheck(result, params, reasons, "equity fallback");
  return reasons.length === 0 ? compatible : { compatible: false, reasons };
}
