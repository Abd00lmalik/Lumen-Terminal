/**
 * Canonical non-equity instrument resolution (target-resolution law).
 *
 * Commodities, metals, FX pairs, and indices have canonical Yahoo-tradable symbols.
 * Without this dictionary, a question like "What is driving oil prices this week?"
 * resolves NO target (the ticker regex only matches uppercase ticker-shaped tokens),
 * every symbol-scoped capability fails SCHEMA_ERROR, and the provider chain falls
 * through to domain-wrong fallbacks (the live contamination path: crypto RSS feeds
 * answering an oil question). Resolution here is a FACT about the language (asset
 * name -> canonical instrument), not a Flow->provider mapping; the capability registry
 * remains the only provider authority.
 *
 * Equity tickers (AAPL, NVDA, TSLA) and crypto (BTC, ETH) resolve through the
 * existing ticker/asset paths and are intentionally NOT listed here.
 */

export interface InstrumentResolution {
  /** Canonical Yahoo-tradable symbol (CL=F, GC=F, EURUSD=X, ^GSPC, ...). */
  readonly symbol: string;
  /** Human asset name (drives subject-term extraction and provider params). */
  readonly name: string;
  readonly kind: "commodity" | "metal" | "fx" | "index" | "volatility";
  /** Subject terms this instrument answers to (evidence relevance gate). */
  readonly subjectTerms: readonly string[];
}

/** Ordered most-specific first: FX pairs before single-word bases ("euro"), Brent before generic oil. */
const INSTRUMENTS: readonly { readonly match: RegExp; readonly resolution: InstrumentResolution }[] = [
  { match: /\bbrent\b/i, resolution: { symbol: "BZ=F", name: "Brent Crude Oil", kind: "commodity", subjectTerms: ["BRENT", "BZ"] } },
  { match: /\bwti\b/i, resolution: { symbol: "CL=F", name: "WTI Crude Oil", kind: "commodity", subjectTerms: ["WTI", "CL"] } },
  {
    match: /\bcrude(?:\s+oil)?\b|\boil\b(?:\s+price|\s+market|\s+futures)?(?=[\s,.?]|$)/i,
    resolution: { symbol: "CL=F", name: "Crude Oil", kind: "commodity", subjectTerms: ["OIL", "CRUDE", "WTI", "BRENT", "OPEC", "CL"] },
  },
  { match: /\bnatural\s+gas\b/i, resolution: { symbol: "NG=F", name: "Natural Gas", kind: "commodity", subjectTerms: ["NATURAL", "GAS", "HENRY", "NG"] } },
  { match: /\bgold\b/i, resolution: { symbol: "GC=F", name: "Gold", kind: "metal", subjectTerms: ["GOLD", "XAU", "GC"] } },
  { match: /\bsilver\b/i, resolution: { symbol: "SI=F", name: "Silver", kind: "metal", subjectTerms: ["SILVER", "XAG", "SI"] } },
  { match: /\bcopper\b/i, resolution: { symbol: "HG=F", name: "Copper", kind: "metal", subjectTerms: ["COPPER", "HG"] } },
  { match: /\bplatinum\b/i, resolution: { symbol: "PL=F", name: "Platinum", kind: "metal", subjectTerms: ["PLATINUM"] } },
  { match: /\bpalladium\b/i, resolution: { symbol: "PA=F", name: "Palladium", kind: "metal", subjectTerms: ["PALLADIUM"] } },
  { match: /\bUSD\/?JPY\b|\byen\b/i, resolution: { symbol: "USDJPY=X", name: "USD/JPY", kind: "fx", subjectTerms: ["YEN", "JPY", "DOLLAR"] } },
  { match: /\bGBP\/?USD\b|\bpound\b|\bsterling\b/i, resolution: { symbol: "GBPUSD=X", name: "GBP/USD", kind: "fx", subjectTerms: ["POUND", "STERLING", "GBP"] } },
  { match: /\bEUR\/?USD\b|\beuro\b/i, resolution: { symbol: "EURUSD=X", name: "EUR/USD", kind: "fx", subjectTerms: ["EURO", "EUR"] } },
  { match: /\bDXY\b|\bdollar(?:\s+index)?\b/i, resolution: { symbol: "DX-Y.NYB", name: "US Dollar Index", kind: "fx", subjectTerms: ["DXY", "DOLLAR"] } },
  { match: /\bS\s*&\s*P\b|\bS&P\b|\bSPX\b/i, resolution: { symbol: "^GSPC", name: "S&P 500", kind: "index", subjectTerms: ["SPX", "SP500"] } },
  { match: /\bnasdaq\b/i, resolution: { symbol: "^IXIC", name: "Nasdaq Composite", kind: "index", subjectTerms: ["NASDAQ", "IXIC"] } },
  { match: /\bdow\b/i, resolution: { symbol: "^DJI", name: "Dow Jones Industrial Average", kind: "index", subjectTerms: ["DOW"] } },
  { match: /\bVIX\b|\bvolatility\s+index\b/i, resolution: { symbol: "^VIX", name: "VIX", kind: "volatility", subjectTerms: ["VIX"] } },
];

/**
 * Resolve a question/objective text to its canonical non-equity instrument.
 * Deterministic: first pattern match wins (ordering above encodes specificity).
 */
export function resolveInstrument(text: string | undefined): InstrumentResolution | undefined {
  if (text === undefined) return undefined;
  for (const { match, resolution } of INSTRUMENTS) {
    if (match.test(text)) return resolution;
  }
  return undefined;
}

/**
 * Subject terms of a research question for the evidence relevance gate: the resolved
 * instrument's subject terms plus ticker-shaped tokens found in the text. Domain-neutral
 * market vocabulary is NOT a subject term ("prices", "market", "drivers") — an item about
 * a different subject must not match through it.
 */
export function subjectTermsOf(text: string | undefined, resolvedAsset?: string): Set<string> | undefined {
  const terms = new Set<string>();
  const instrument = resolveInstrument(text);
  for (const t of instrument?.subjectTerms ?? []) terms.add(t.toUpperCase());
  if (resolvedAsset !== undefined && resolvedAsset.trim() !== "") terms.add(resolvedAsset.trim().toUpperCase());
  if (text !== undefined) {
    const upper = text.toUpperCase();
    // Ticker-shaped tokens (NVDA, AAPL, BTC): a ticker in the question is a fact about the
    // question. Matched case-SENSITIVELY against the original text: uppercasing first made
    // EVERY 2-6 letter word "ticker-shaped", so ordinary words (FAVOR, ASSETS, MACRO,
    // RIGHT) became subject terms and the gate then rejected valid evidence for any
    // question that named no real instrument (live: the macro risk-assets question kept
    // 1 of 20 observations). A genuinely uppercase token is a ticker; a lowercase word is not.
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)) {
      const token = m[0];
      if (!GENERIC_TOKENS.has(token)) terms.add(token);
    }
    // Crypto aliases: "Bitcoin" is not ticker-shaped (7 chars) but IS a subject. Both the
    // name and the ticker become subject terms so klines (BTCUSDT) and headlines (Bitcoin)
    // both match.
    for (const [name, ticker] of CRYPTO_ALIASES) {
      if (upper.includes(name)) {
        terms.add(name);
        terms.add(ticker);
      }
    }
    // Instrument name words (CRUDE, OIL, GOLD...) when an instrument resolved.
    if (instrument !== undefined) {
      for (const w of instrument.name.toUpperCase().split(/[^A-Z]+/)) {
        if (w.length >= 3 && !GENERIC_TOKENS.has(w)) terms.add(w);
      }
    }
  }
  return terms.size > 0 ? terms : undefined;
}

/** Well-known crypto name<->ticker aliases (crypto market data resolves via its own path; these only feed subject terms). */
const CRYPTO_ALIASES: readonly (readonly [name: string, ticker: string])[] = [
  ["BITCOIN", "BTC"], ["ETHEREUM", "ETH"], ["RIPPLE", "XRP"], ["SOLANA", "SOL"],
  ["DOGECOIN", "DOGE"], ["CARDANO", "ADA"], ["LITECOIN", "LTC"], ["ZCASH", "ZEC"],
  ["POLKADOT", "DOT"], ["CHAINLINK", "LINK"], ["AVALANCHE", "AVAX"], ["TRON", "TRX"],
];

/** Tokens that identify no subject (they appear in questions about any subject). */
const GENERIC_TOKENS = new Set([
  "A", "I", "AN", "THE", "AND", "OR", "OF", "ON", "IN", "TO", "FOR", "IS", "ARE", "WAS", "WERE", "IT", "ITS",
  "WHAT", "WHY", "HOW", "WHEN", "WHICH", "WHO", "COULD", "WOULD", "SHOULD", "CAN", "MAY", "WILL", "DID", "DOES",
  "THIS", "THAT", "THESE", "THOSE", "THERE", "MY", "OUR", "US", "WE",
  "PRICE", "PRICES", "MARKET", "MARKETS", "DATA", "WEEK", "MONTH", "TODAY", "NOW", "CURRENT", "CURRENTLY",
  "RECENT", "RECENTLY", "LAST", "NEXT", "DRIVING", "DRIVERS", "DRIVE", "AFFECT", "AFFECTING", "AFFECTS",
  "IMPACT", "IMPACTS", "FACTOR", "FACTORS", "HAPPEN", "HAPPENED", "HAPPENING", "MOVE", "MOVED", "MOVING",
  "EARNINGS", "REPORT", "REPORTS", "NEWS", "SETUP", "BEFORE", "AROUND", "ABOUT", "RESEARCH", "ANALYSIS",
  "VIEW", "VIEWS", "RIGHT", "THERE", "SAY", "SAYS", "ALL", "MOST", "MORE",
  "THESIS", "HOLD", "HOLDS", "PROVE", "WRONG", "SEARCH", "SIMILAR", "PATTERN", "PATTERNS",
  "HISTORICAL", "COMPARE", "CORRELATED", "CORRELATION", "RISK", "RISKS", "OUTLOOK", "EVENT",
  "EVENTS", "TREND", "TRENDS", "LEVEL", "LEVELS", "EXPECTED", "EXPECTATIONS", "ESTIMATE",
  "ESTIMATES", "CONSENSUS", "CALENDAR", "DATE", "RESULTS", "RESULT", "GUIDANCE", "STILL",
]);
