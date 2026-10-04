/**
 * READABLE LIMITATIONS (data-availability conditions, in trader language).
 *
 * A limitation is an honest statement that some data could not be retrieved. Stating it well
 * is part of that honesty; stating it as engine output is not. What the answer surface used to
 * render, straight from the context:
 *
 *   **Limitations:** [object Object]; [object Object]
 *   CROSS_DOMAIN_SYNTHESIS invocation failed (PROVIDER_ERROR): HTTP 402 request rejected:
 *   {"detail":"Insufficient credits"} (CROSS_DOMAIN_SYNTHESIS)
 *
 * That is a capability id, a tool id and a provider's raw error body — internal plumbing on the
 * one surface that is supposed to tell a trader what could not be established. The full record
 * stays where it belongs (the run's diagnostics and the evidence archive); here it becomes one
 * plain sentence about what could not be retrieved.
 */
import type { ContextLimitation } from "./context.js";

/** The capabilities the engine can name, in the words a trader would use for them. */
const CAPABILITY_PHRASE: Record<string, string> = {
  CRYPTO_MARKET_DATA: "crypto market data",
  EQUITY_MARKET_DATA: "equity market data",
  COMMODITY_MARKET_DATA: "commodity market data",
  MARKET_DATA_ANALYSIS: "market data",
  NEWS_ANALYSIS: "news search",
  WEB_SEARCH: "news search",
  SOCIAL_SENTIMENT: "social sentiment data",
  ONCHAIN_ANALYSIS: "on-chain data",
  DERIVATIVES_ANALYSIS: "derivatives data",
  MACRO_DATA: "macro data",
  HISTORICAL_COMPARISON: "historical market data",
  CROSS_DOMAIN_SYNTHESIS: "cross-source synthesis",
  FALSIFICATION: "the disconfirmation pass",
  G2_DISCOVER: "source discovery",
  LOCAL_KNOWLEDGE: "the local knowledge base",
};

function phraseFor(capability: string | undefined): string {
  return capability !== undefined ? CAPABILITY_PHRASE[capability] ?? "one data source" : "one data source";
}

/** What could not be retrieved, as one sentence. Says nothing the limitation does not say. */
export function readableLimitation(l: ContextLimitation): string {
  const what = phraseFor(l.capability);
  switch (l.kind) {
    case "tool_failure":
      return `${what} could not be reached for this question`;
    case "empty_result":
      return `${what} returned nothing usable for this question`;
    case "partial_result":
      return `${what} returned only partial results`;
    case "stale_evidence":
      return `${what} returned data outside the freshness window used here`;
    default:
      return `the evidence available was not sufficient for this question (${what})`;
  }
}

/** The same, for a run of limitations, deduplicated and joined into one clause. */
export function readableLimitations(limitations: readonly ContextLimitation[], max = 3): string | undefined {
  const seen = new Set<string>();
  for (const l of limitations) {
    if (seen.size >= max) break;
    seen.add(readableLimitation(l));
  }
  return seen.size === 0 ? undefined : [...seen].join("; ");
}