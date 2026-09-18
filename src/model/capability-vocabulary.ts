/**
 * Canonical planner capability vocabulary + normalization (zero-dead-end mandate §3/§21).
 *
 * The planner prompt lists the canonical names; models still occasionally emit near-misses
 * ("web_search", "FINANCIAL_DATA_API"). Every parsed plan passes through
 * normalizePlanCapabilities, which:
 *   1. uppercases and canonicalizes separators (spaces/hyphens -> underscores),
 *   2. maps known aliases onto the canonical capability they mean,
 *   3. DROPS anything still unknown (it would only become "no provider registered" noise),
 *      and reports the dropped names so diagnostics stay honest.
 *
 * This module must stay dependency-free (no imports) so both src/model and src/research can
 * consume it without import cycles.
 */

/** Every capability the engine can ever schedule (planner + flow-internal ones). */
export const CANONICAL_CAPABILITIES: readonly string[] = [
  "MARKET_DATA_ANALYSIS", "TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS", "NEWS_ANALYSIS", "MACRO_ANALYSIS",
  "DERIVATIVES_ANALYSIS", "HISTORICAL_COMPARISON", "FALSIFICATION", "SOURCE_VALIDATION", "WEB_SEARCH",
  "CROSS_DOMAIN_SYNTHESIS", "ONCHAIN_ANALYSIS", "DEFI_ANALYSIS", "PROJECT_RESEARCH",
  "EQUITY_MARKET_DATA", "EQUITY_FUNDAMENTALS", "EQUITY_EARNINGS", "EARNINGS_CALENDAR", "OPTIONS_CHAIN_ANALYSIS", "EQUITY_NEWS",
  "LOCAL_KNOWLEDGE_RETRIEVAL",
];

const CANONICAL = new Set<string>(CANONICAL_CAPABILITIES);

/** Bounded alias map: model-invented near-misses -> the canonical capability they mean. */
const ALIASES: Readonly<Record<string, string>> = {
  // generic market data
  MARKET_DATA: "MARKET_DATA_ANALYSIS",
  PRICE_DATA: "MARKET_DATA_ANALYSIS",
  FINANCIAL_DATA: "MARKET_DATA_ANALYSIS",
  FINANCIAL_DATA_API: "MARKET_DATA_ANALYSIS",
  MARKET_DATA_API: "MARKET_DATA_ANALYSIS",
  QUOTES: "MARKET_DATA_ANALYSIS",
  // search
  SEARCH: "WEB_SEARCH",
  WEBSEARCH: "WEB_SEARCH",
  WEB: "WEB_SEARCH",
  INTERNET_SEARCH: "WEB_SEARCH",
  // news / sentiment / macro
  NEWS: "NEWS_ANALYSIS",
  NEWS_SEARCH: "NEWS_ANALYSIS",
  SENTIMENT: "SENTIMENT_ANALYSIS",
  MACRO: "MACRO_ANALYSIS",
  MACRO_DATA: "MACRO_ANALYSIS",
  MACROECONOMICS: "MACRO_ANALYSIS",
  // derivatives
  DERIVATIVES: "DERIVATIVES_ANALYSIS",
  FUNDING: "DERIVATIVES_ANALYSIS",
  OPEN_INTEREST: "DERIVATIVES_ANALYSIS",
  FUNDING_RATE: "DERIVATIVES_ANALYSIS",
  // history / falsification
  HISTORICAL_DATA: "HISTORICAL_COMPARISON",
  HISTORICAL_ANALYSIS: "HISTORICAL_COMPARISON",
  HISTORICAL_MARKET_DATA: "HISTORICAL_COMPARISON",
  FALSIFY: "FALSIFICATION",
  DISCONFIRM: "FALSIFICATION",
  DISCONFIRMING_EVIDENCE: "FALSIFICATION",
  // sources
  SEC_RESEARCH: "SOURCE_VALIDATION",
  SEC_FILINGS: "SOURCE_VALIDATION",
  PRIMARY_SOURCES: "SOURCE_VALIDATION",
  // equities
  EQUITY_DATA: "EQUITY_MARKET_DATA",
  STOCK_DATA: "EQUITY_MARKET_DATA",
  FUNDAMENTALS: "EQUITY_FUNDAMENTALS",
  EQUITY_FUNDAMENTAL_DATA: "EQUITY_FUNDAMENTALS",
  EARNINGS: "EQUITY_EARNINGS",
  EARNINGS_DATA: "EQUITY_EARNINGS",
  EARNINGS_HISTORY: "EQUITY_EARNINGS",
  EARNINGS_ESTIMATES: "EQUITY_EARNINGS",
  OPTIONS: "OPTIONS_CHAIN_ANALYSIS",
  OPTIONS_DATA: "OPTIONS_CHAIN_ANALYSIS",
  OPTIONS_CHAIN: "OPTIONS_CHAIN_ANALYSIS",
  // crypto domains
  ONCHAIN: "ONCHAIN_ANALYSIS",
  ON_CHAIN: "ONCHAIN_ANALYSIS",
  ON_CHAIN_DATA: "ONCHAIN_ANALYSIS",
  DEFI: "DEFI_ANALYSIS",
  DEFI_DATA: "DEFI_ANALYSIS",
  TVL: "DEFI_ANALYSIS",
  PROJECT: "PROJECT_RESEARCH",
  PROJECT_INFO: "PROJECT_RESEARCH",
  // synthesis
  CROSS_DOMAIN: "CROSS_DOMAIN_SYNTHESIS",
  SYNTHESIS: "CROSS_DOMAIN_SYNTHESIS",
  DEEP_RESEARCH: "CROSS_DOMAIN_SYNTHESIS",
  // local knowledge
  LOCAL_KNOWLEDGE: "LOCAL_KNOWLEDGE_RETRIEVAL",
  LOCAL_MEMORY: "LOCAL_KNOWLEDGE_RETRIEVAL",
  USER_FRAMEWORK: "LOCAL_KNOWLEDGE_RETRIEVAL",
};

export interface NormalizedCapabilities {
  readonly capabilities: string[];
  /** Model-emitted names that could not be resolved; diagnostics only, never user-facing. */
  readonly dropped: string[];
}

/** Canonicalize one raw planner-emitted capability name, or null when unresolvable. */
export function canonicalCapability(raw: string): string | null {
  const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (upper === "") return null;
  if (CANONICAL.has(upper)) return upper;
  return ALIASES[upper] ?? null;
}

/** Normalize a planner-emitted capability list: casing/separators, aliases, drop unknowns. */
export function normalizePlanCapabilities(raw: readonly unknown[]): NormalizedCapabilities {
  const capabilities: string[] = [];
  const dropped: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue; // shape errors are rejected by the schema parsers
    const canonical = canonicalCapability(entry);
    if (canonical === null) {
      dropped.push(entry);
      continue;
    }
    if (!capabilities.includes(canonical)) capabilities.push(canonical);
  }
  return { capabilities, dropped };
}
