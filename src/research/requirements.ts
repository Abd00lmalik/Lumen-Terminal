/**
 * Requirement-coverage engine (research-engine core).
 *
 * The architectural law: a research run is complete when its INFORMATION REQUIREMENTS are
 * covered by relevant, fresh-enough evidence — never because a provider returned, and never
 * because a model asserted sufficiency. This module is deliberately deterministic and
 * question-agnostic: requirements come from the planner (or are derived from the plan's
 * capabilities), evidence is matched by domain + subject + freshness, gaps map to recovery
 * CAPABILITIES (never to providers or individual questions), and the completion verdict is
 * computed by the engine.
 *
 * Live failure this exists to eliminate: "What macro conditions favor risk assets right now?"
 * answered with annual World Bank CPI/GDP (valid observations, wrong time horizon for a
 * CURRENT question), DXY/VIX/yields/fed/liquidity all missing, then marked COMPLETED.
 */

import { sentencesOf } from "./contract-checks.js";
import {
  demandsSpan,
  facetsOfRequirementText,
  facetCoverage,
  impliedFacets,
  requestedWindowHours,
  servedFacetsOf,
  windowCovers,
  type DataFacet,
} from "./data-facets.js";
import { expandSubjectTerms, mentionsCryptoAsset } from "../domain/instruments.js";
import { withoutProhibitions } from "./execution-mode.js";
import { contractFor } from "./flow-contract.js";
import { isResolution, namedResolutionOf, resolutionCovers, type Resolution } from "./resolution.js";
import { chainedFlowsOf } from "./modes.js";

export type TimeSensitivity = "CURRENT" | "RECENT" | "HISTORICAL" | "ANY";

export type RequirementStatus = "PENDING" | "PARTIALLY_SATISFIED" | "SATISFIED" | "EXHAUSTED" | "UNAVAILABLE";

/**
 * DECISION ROLES (research contract): what a requirement is FOR. Different roles have
 * different completion laws, so a run cannot claim success by satisfying only the easy half
 * of the question:
 * - CORE: must be satisfied, or explicitly named as unresolved, before completion.
 * - SUPPORTING: improves confidence; may remain unresolved.
 * - CHALLENGE: must be actively ATTEMPTED for a completed judgment (disconfirmation is an
 *   engine action, not a prompt convention). Attempted-and-empty is a valid terminal state and
 *   must be reported as such, never as "no counterevidence exists".
 * - CONTEXT: background only; never satisfies a current question and never blocks completion.
 */
export type RequirementRole = "CORE" | "SUPPORTING" | "CHALLENGE" | "CONTEXT";

/** An engine-required CALCULATION the question implies (mandate: calculations are engine-owned). */
export type RequirementCalculation = "PERIOD_OVER_PERIOD" | "PERIOD_CHANGE" | "EPISODE_SIMILARITY";

/**
 * EVIDENCE QUALITY (research contract): the epistemic status of a causal or analytical claim.
 * Every causal relationship should carry an evidence status to prevent silently turning
 * correlation into causation.
 * - DIRECT_EVIDENCE: the evidence directly establishes the claim (e.g., OPEC announcement
 *   explicitly cutting production).
 * - SUPPORTED_INFERENCE: the claim is a reasonable inference from direct evidence, but not
 *   directly stated (e.g., oil prices rose after supply cut announcement, supporting
 *   inflation expectations).
 * - CORRELATIONAL: the evidence shows correlation but not causation (e.g., oil and yields
 *   moved together, but no mechanism is established).
 * - UNRESOLVED: the evidence is insufficient to determine the relationship.
 */
export type EvidenceQuality = "DIRECT_EVIDENCE" | "SUPPORTED_INFERENCE" | "CORRELATIONAL" | "UNRESOLVED";

/**
 * RELATIONSHIP TYPE (research contract): what kind of relationship the evidence supports.
 * Used to structure causal chain output and prevent correlation-causation confusion.
 */
export type RelationshipType = "DRIVER" | "MECHANISM" | "TRANSMISSION" | "CROSS_ASSET" | "IMPLICATION" | "COUNTER_EVIDENCE";

export interface RequirementSeed {
  readonly description: string;
  readonly importance?: "CRITICAL" | "SUPPORTING";
  readonly timeSensitivity?: TimeSensitivity;
  readonly role?: RequirementRole;
  /** Engine-required calculation this requirement's evidence must support. */
  readonly calculation?: RequirementCalculation;
  /** Evidence classes (e.g. the task's own capabilities) that can serve this requirement. */
  readonly evidenceClasses?: readonly string[];
  /** Relationship type this requirement represents in the causal chain. */
  readonly relationshipType?: RelationshipType;
  /** Transmission targets this seed's causal link points into (question-derived links only). */
  readonly targetTerms?: readonly string[];
  /**
   * The data RESOLUTION this requirement asks for ("hourly", "daily"), when it names one.
   * Distinct from the window: a request for an hourly path over 24 hours demands both a
   * 24-hour span AND a sampling at least as fine as hourly.
   */
  readonly resolution?: Resolution;
}

export interface ResearchRequirement {
  readonly id: string;
  /**
   * ARROW ROW (research contract §3): the canonical destination fold this requirement's causal
   * link points INTO. Present only on a first-class arrow row — the row that owns the link.
   * A row carrying this is ABOUT the relationship, never about an endpoint market: its coverage
   * cannot be inherited from either endpoint's node requirement (see `matchRequirement`).
   */
  readonly targetTerms?: readonly string[];
  /**
   * ARROW ROW: the canonical SOURCE fold of the link (the driver side) — "OIL" for
   * OIL→INFLATION. Diagnostics only; the arrow's admission law reads the relationship, so the
   * source is never a licence to satisfy the arrow from source-side node evidence.
   */
  readonly relationshipSource?: string;
  readonly description: string;
  readonly importance: "CRITICAL" | "SUPPORTING";
  readonly role: RequirementRole;
  readonly timeSensitivity: TimeSensitivity;
  readonly domains: readonly EvidenceDomain[];
  readonly status: RequirementStatus;
  readonly evidenceRefs: readonly string[];
  readonly staleOnlyRefs: readonly string[];
  readonly missingReason?: string;
  /** Recovery rounds already spent trying to satisfy this requirement (bounded). */
  readonly recoveryAttempts: number;
  /** Set when the engine inferred this requirement itself (the model omitted the dimension). */
  readonly engineRequired?: boolean;
  /** Engine-required calculation, when the question implies one. */
  readonly calculation?: RequirementCalculation;
  /** Requirement-scoped retrieval objective for research workers (never the whole question). */
  readonly retrievalObjective?: string;
  /**
   * Declared acceptable evidence classes (data types / domains the requirement can be served
   * by). Used ONLY by engine-inferred requirements and ONLY for subject-scoped evidence: an
   * analytically-worded dimension ("the drivers behind X") never contains the literal words a
   * headline uses, so class matching keeps a satisfiable engine requirement from failing for
   * vocabulary reasons. Model-authored requirements stay strictly vocabulary-matched.
   */
  readonly evidenceClasses?: readonly string[];
  /**
   * THE SHAPES THIS REQUIREMENT DEMANDS (research-integrity contract).
   *
   * A requirement that names no data shape — a driver row, a thesis row, a counterevidence
   * row — declares none and is matched exactly as before. A requirement that names ONE
   * declares it here, and only an observation carrying that shape may satisfy it. Subject
   * overlap remains an ADMISSION gate; it is never a coverage proof.
   *
   * Derived from the requirement's own wording when not stated explicitly (see
   * `facetsOfRequirementText`), and preserved verbatim when a caller states it.
   */
  readonly dataFacets?: readonly DataFacet[];
  /**
   * The time window this requirement asks for, in hours, read from its own wording. When set,
   * an observation must actually SPAN it: a snapshot fetched one second ago is fresh and
   * spans zero hours, so it cannot answer "the last 24 hours".
   */
  readonly windowHours?: number;
  /**
   * The GRANULARITY this requirement demands, when it names one ("hourly", "daily"). A
   * requirement that names no resolution demands none; its window still applies. A requirement
   * that names one may only be satisfied by equally fine or finer evidence — a daily candle
   * never satisfies an hourly-sequence row (see resolution.ts).
   */
  readonly resolution?: Resolution;
  /**
   * Evidence refs that matched but carry the SAME payload identity as another ref already on
   * this row: re-served copies, never additional facts. Kept so provenance survives while the
   * informational count stays honest.
   */
  readonly duplicateEvidenceRefs?: readonly string[];
  /** Relationship type this requirement represents in the causal chain. */
  readonly relationshipType?: RelationshipType;
  /** Evidence quality assessment for this requirement's satisfied evidence. */
  readonly evidenceQuality?: EvidenceQuality;
  /** Source diversity: number of independent sources satisfying this requirement. */
  readonly sourceDiversity?: number;
  /** Whether the evidence is direct or inferred. */
  readonly evidenceDirectness?: "DIRECT" | "INFERRED";
}

/** Evidence domains; the matching vocabulary between requirements and observations. */
export type EvidenceDomain =
  | "PRICE_MARKET" | "MACRO" | "NEWS" | "EARNINGS" | "FUNDAMENTALS" | "HISTORICAL"
  | "OPTIONS" | "DERIVATIVES" | "SENTIMENT" | "ONCHAIN" | "DEFI" | "PROJECT" | "TECHNICAL" | "GENERAL";

/** Every EvidenceDomain as a runtime list, for domain-level conformance checks in tests. */
export const EVIDENCE_DOMAINS = [
  "PRICE_MARKET", "MACRO", "NEWS", "EARNINGS", "FUNDAMENTALS", "HISTORICAL",
  "OPTIONS", "DERIVATIVES", "SENTIMENT", "ONCHAIN", "DEFI", "PROJECT", "TECHNICAL", "GENERAL",
] as const satisfies readonly EvidenceDomain[];

type AssertNever<T extends never> = T;
/**
 * Compile-time exhaustiveness anchor: the moment a domain joins `EvidenceDomain` without
 * joining `EVIDENCE_DOMAINS`, this type errors, so the domain-capability conformance test
 * can never silently iterate an outdated list.
 */
export type EvidenceDomainsAreExhaustive = AssertNever<
  Exclude<EvidenceDomain, (typeof EVIDENCE_DOMAINS)[number]>
>;

/** One observation available for coverage assessment (a workspace Evidence, minimized). */
export interface CoverageEvidence {
  readonly ref: string;
  readonly text: string;
  /** Evidence type tag from the evidence layer (EQUITY_MARKET_DATA, MACRO_ANALYSIS, ...). */
  readonly evidenceType?: string;
  /** Freshness tag: CURRENT | RECENT | HISTORICAL | STALE (layer vocabulary). */
  readonly freshness?: string;
  /** Observation timestamp when known. */
  readonly observedAt?: string;
  /**
   * The subject the provider DECLARED for this observation (`about`). It must travel with the
   * coverage item: a real market payload often never names its own ticker (the regime adapter
   * reports "the 10-year Treasury yield is 4.998 percent" for ^TNX), so matching on the
   * rendered text alone dropped valid observations for symbol-shaped subjects.
   */
  readonly subject?: string;
  /** Source provider/capability that produced this evidence. */
  readonly sourceProvider?: string;
  /** Whether this evidence is a primary source or secondary reporting. */
  readonly sourceType?: "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS";
  /** Adapter-flagged repeated content: never adds source diversity (same underlying report). */
  readonly duplicateContent?: boolean;
  /** The data shapes this observation carries, resolved at the ingestion boundary. */
  readonly dataFacets?: readonly DataFacet[];
  /** Hours of time this observation spans on its own timestamps (a single print spans 0). */
  readonly coverageHours?: number;
  /** The sampling granularity this observation carries (a candle set's bar size). */
  readonly resolution?: Resolution;
  /** Identity of the underlying provider response: identical identity ⇒ one observation. */
  readonly payloadIdentity?: string;
  /**
   * GROUP (MC-6): the provider response this segment belongs to. Segments of ONE response
   * (monthly candle chunks) are distinct facts that TOGETHER span the requested window; the
   * coverage engine may satisfy a windowed row from the group's assembled span when no single
   * segment reaches it. Undefined for evidence that did not come from a tool response.
   */
  readonly payloadGroup?: string;
  /** For a MC-6 assembled group item: the segment refs the group stands for. */
  readonly groupRefs?: readonly string[];
}

/**
 * The subset of a stored Evidence object that coverage matching reads.
 */
export interface CoverageEvidenceSource {
  readonly id: string;
  readonly observation: string;
  readonly evidenceType?: string;
  readonly freshness?: string;
  readonly timestamp?: string;
  readonly subject?: string;
  readonly sourceProvider?: string;
  readonly sourceType?: "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS";
  readonly duplicateContent?: boolean;
  readonly dataFacets?: readonly string[];
  readonly coverageHours?: number;
  /** The sampling granularity this observation carries, measured at ingestion. */
  readonly resolution?: string;
  readonly payloadIdentity?: string;
  /** The tool response this evidence was ingested from (the MC-6 group key). */
  readonly toolResultRef?: string;
}

/**
 * THE COVERAGE MAPPING — one place where a stored observation becomes a coverage candidate.
 *
 * This exists because the shape and span measured at ingestion were being dropped on the way
 * to the matcher. The adapter declares its facets and `evidence.ts` measures `coverageHours`
 * from the payload's own timestamps; if neither reaches `matchRequirement`, the matcher is
 * left re-parsing the RENDERED observation text and sees no span at all. `windowCovers`
 * refuses an unknown span, so every window-bearing requirement became unsatisfiable by ANY
 * evidence — the mirror image of the original defect (a snapshot wrongly satisfying a 24-hour
 * high became a correct 24-hour high being unsatisfiable). Both runners use this function so
 * there is exactly one mapping to keep correct.
 */
export function coverageItemOf(e: CoverageEvidenceSource): CoverageEvidence {
  return {
    ref: e.id,
    text: e.observation,
    ...(e.evidenceType !== undefined ? { evidenceType: e.evidenceType } : {}),
    ...(e.freshness !== undefined ? { freshness: e.freshness } : {}),
    // The declared subject travels into coverage: a payload may never name its own ticker.
    ...(e.subject !== undefined ? { subject: e.subject } : {}),
    ...(e.timestamp !== undefined ? { observedAt: e.timestamp } : {}),
    // Provenance-derived source identity/kind feed the requirement's evidence-quality
    // assessment: sourceDiversity counts DISTINCT origins (transport/publisher/upstream),
    // and a primary feed can satisfy a requirement as DIRECT_EVIDENCE.
    ...(e.sourceProvider !== undefined ? { sourceProvider: e.sourceProvider } : {}),
    ...(e.sourceType !== undefined ? { sourceType: e.sourceType } : {}),
    ...(e.duplicateContent === true ? { duplicateContent: true } : {}),
    // The data shape and the span the payload actually has. Facets are narrowed here: they
    // were computed from `DataFacet` constants upstream, and coverage compares them as such.
    ...(e.dataFacets !== undefined ? { dataFacets: e.dataFacets as readonly DataFacet[] } : {}),
    ...(e.coverageHours !== undefined ? { coverageHours: e.coverageHours } : {}),
    // The sampling granularity the payload actually has. Span and resolution are different
    // axes; a windowed requirement checks both.
    ...(isResolution(e.resolution) ? { resolution: e.resolution } : {}),
    // Response identity: one provider response re-served under several capability names is
    // ONE observation, never the corroboration the evidence count would otherwise suggest.
    ...(e.payloadIdentity !== undefined ? { payloadIdentity: e.payloadIdentity } : {}),
    // MC-6 group key: the response this segment was ingested from. Segments of one response
    // assemble into the window they jointly cover; nothing outside a real tool response groups.
    ...(e.toolResultRef !== undefined ? { payloadGroup: e.toolResultRef } : {}),
  };
}

const DAY_MS = 86_400_000;
/** A CURRENT requirement is not satisfied by observations older than this (market data is fast-moving). */
const CURRENT_MAX_AGE_DAYS = 21;
/** A RECENT requirement tolerates this much age. */
const RECENT_MAX_AGE_DAYS = 120;

/**
 * Days named by a requirement's own recency phrasing, when it names one.
 *
 * Backed by the ONE temporal parser (temporal.ts) — `temporalIntentOf` reads rolling windows
 * ("the last 48 hours"), calendar periods ("today", "this week", "this month"), explicit
 * ranges and year-to-date — so every phrase the engine understands anywhere is understood
 * here. A phrase that names no fixed duration ("since the breakout", "the current price")
 * yields undefined and never tightens the freshness limit.
 */
export function explicitWindowDays(description: string): number | undefined {
  const hours = requestedWindowHours(description);
  return hours !== undefined ? hours / 24 : undefined;
}

// ---------------------------------------------------------------------------
// Domain vocabulary: requirement text -> evidence domains, evidence type -> domain.
// Domain vocabulary, not question routing: it maps INFORMATION KINDS to each other.
// ---------------------------------------------------------------------------

const DOMAIN_KEYWORDS: readonly { readonly domain: EvidenceDomain; readonly patterns: readonly RegExp[] }[] = [
  { domain: "PRICE_MARKET", patterns: [/\b(price|prices|quote|level|market data|ohlc|volume|performance|trading)\b/i] },
  {
    domain: "MACRO",
    patterns: [/\b(macro|policy|rate|rates|yield|yields|treasury|fed|central bank|inflation|cpi|ppi|payroll|employment|labor|labour|gdp|growth|recession|liquidity|financial conditions|credit|spread|regime|dollar|dxy|usd|currency|real yield)\b/i],
  },
  { domain: "NEWS", patterns: [/\b(news|headline|development|developments|announcement|statement|catalyst|catalysts|event|events|driver|drivers|what happened|what changed)\b/i] },
  { domain: "EARNINGS", patterns: [/\b(earnings|eps|consensus|estimate|estimates|guidance|expectations|report date|quarterly results)\b/i] },
  { domain: "FUNDAMENTALS", patterns: [/\b(fundamental|fundamentals|revenue|margin|margins|valuation|book value|cash flow|balance sheet|eps growth)\b/i] },
  { domain: "HISTORICAL", patterns: [/\b(histor\w*|past|previous\w*|before|similar setups?|analogue|analog\w*|compare with|cycle|episode\w*)\b/i] },
  { domain: "OPTIONS", patterns: [/\b(options|option chain|implied volatility|strike|positioning|open interest)\b/i] },
  // "open interest" is a derivatives information kind: DERIVATIVES_ANALYSIS (the public perp
  // venues) declares OPEN_INTEREST as one of its data types. It used to classify only under
  // OPTIONS, a domain no capability declares, so an open-interest requirement mapped to
  // NOTHING and the floor never scheduled the provider that actually returns the number.
  { domain: "DERIVATIVES", patterns: [/\b(funding|funding rate|perpetual|futures basis|liquidations|leverage|open interest)\b/i] },
  { domain: "SENTIMENT", patterns: [/\b(sentiment|fear|greed|positioning|crowd|narrative)\b/i] },
  { domain: "ONCHAIN", patterns: [/\b(on-chain|onchain|whale|wallet|holders|exchange reserves|transactions|address)\b/i] },
  { domain: "DEFI", patterns: [/\b(defi|tvl|protocol|liquidity pool|staking|aave|uniswap|l2|layer 2)\b/i] },
  { domain: "PROJECT", patterns: [/\b(project|token|protocol|ecosystem|team|roadmap|narrative)\b/i] },
  { domain: "TECHNICAL", patterns: [/\b(technical|support|resistance|trend|momentum|indicator|rsi|moving average|setup)\b/i] },
];

/** Evidence type tag -> domain (prefix/segment vocabulary of the evidence layer). */
export function domainOfEvidenceType(evidenceType: string | undefined): EvidenceDomain {
  if (evidenceType === undefined) return "GENERAL";
  const t = evidenceType.toUpperCase();
  if (t.includes("MACRO")) return "MACRO";
  if (t.includes("EARNING")) return "EARNINGS";
  if (t.includes("FUNDAMENTAL")) return "FUNDAMENTALS";
  if (t.includes("OPTION")) return "OPTIONS";
  if (t.includes("DERIVATIVE") || t.includes("FUNDING")) return "DERIVATIVES";
  if (t.includes("SENTIMENT")) return "SENTIMENT";
  if (t.includes("ONCHAIN") || t.includes("ON_CHAIN")) return "ONCHAIN";
  if (t.includes("DEFI")) return "DEFI";
  if (t.includes("HISTORICAL")) return "HISTORICAL";
  if (t.includes("TECHNICAL")) return "TECHNICAL";
  if (t.includes("NEWS") || t.includes("HEADLINE")) return "NEWS";
  if (t.includes("MARKET_DATA") || t.includes("PRICE") || t.includes("OHLC")) return "PRICE_MARKET";
  if (t.includes("PROJECT")) return "PROJECT";
  return "GENERAL";
}

/** Domains a requirement description calls for (at least GENERAL). */
export function domainsOfRequirement(description: string): readonly EvidenceDomain[] {
  const domains: EvidenceDomain[] = [];
  for (const { domain, patterns } of DOMAIN_KEYWORDS) {
    if (patterns.some((p) => p.test(description))) domains.push(domain);
  }
  return domains;
}

// ---------------------------------------------------------------------------
// Requirement construction
// ---------------------------------------------------------------------------

const STOP = new Set([
  "THE", "A", "AN", "AND", "OR", "OF", "FOR", "TO", "IN", "ON", "WITH", "IS", "ARE", "WAS", "BE",
  "WHAT", "WHY", "HOW", "CURRENT", "CURRENTLY", "RIGHT", "NOW", "TODAY", "THIS", "WEEK", "MONTH",
  "RECENT", "RECENTLY", "LATEST", "DATA", "INFORMATION", "EVIDENCE", "RESEARCH", "ABOUT",
  "SIMILAR", "SETUP", "SETUPS", "LIKE", "SAME", "DIFFERENT", "POSSIBLE", "MATERIAL", "MAIN", "KEY",
  // Research-meta words: they name no market concept, so a requirement made only of them
  // cannot discriminate relevance (the engine's own placeholder fallback is exactly
  // "relevant evidence for the research question").
  "RELEVANT", "RELEVANCE", "QUESTION", "QUESTIONS",
]);

/**
 * Currency units ("USD", "EUR", "USDT", ...): tokens that denote a price DENOMINATION, not
 * a market. Stripped from an observation's vocabulary ONLY when the observation concerns a
 * crypto subject the question is not about (see meaningfulTokens) — there the fiat code is
 * the quote's unit, never a market claim. Dependency-free: this module is shared by the
 * matcher with no import-cycle risk.
 */
const CURRENCY_UNITS: ReadonlySet<string> = new Set(["USD", "USDT", "USDC", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "CNY", "KRW"]);

/**
 * Crypto assets (tickers AND common names) whose price quotes carry a fiat denomination.
 * An observation naming one of these — when it is NOT among the question's subject terms —
 * gets its currency-unit tokens stripped before requirement matching.
 */
const FOREIGN_CRYPTO_ASSETS: ReadonlySet<string> = new Set([
  "BTC", "BITCOIN", "ETH", "ETHEREUM", "SOL", "SOLANA", "XRP", "RIPPLE", "DOGE", "DOGECOIN",
  "ADA", "CARDANO", "LTC", "LITECOIN", "AVAX", "LINK", "CHAINLINK", "DOT", "POLKADOT", "TRON",
]);

/**
 * Canonical concept vocabulary: market words that name the same information kind are folded
 * together so "CPI" can satisfy an inflation requirement and "Treasury" a rates/yield one,
 * while "yield" can never satisfy an inflation requirement. Domain vocabulary, not question
 * routing: it is the shared language between requirements and observations.
 */
const CONCEPT_SYNONYMS: Readonly<Record<string, string>> = {
  TREASURY: "RATE", TREASURIES: "RATE", YIELD: "RATE", YIELDS: "RATE", TREASURYS: "RATE",
  BILL: "RATE", BILLS: "RATE", NOTE: "RATE", NOTES: "RATE", FED: "RATE", FUNDS: "RATE",
  POLICY: "RATE", RATES: "RATE", RATE: "RATE",
  CPI: "INFLATION", PPI: "INFLATION", INFLATION: "INFLATION",
  DXY: "DOLLAR", USD: "DOLLAR", DOLLAR: "DOLLAR", DOLLARS: "DOLLAR", GREENBACK: "DOLLAR",
  VIX: "VOLATILITY", VOLATILITY: "VOLATILITY", VOL: "VOLATILITY",
  PAYROLL: "LABOR", PAYROLLS: "LABOR", UNEMPLOYMENT: "LABOR", JOBS: "LABOR", LABOR: "LABOR", LABOUR: "LABOR",
  GDP: "GROWTH", GROWTH: "GROWTH", RECESSION: "GROWTH",
  EQUITIES: "EQUITY", STOCKS: "EQUITY", STOCK: "EQUITY", SHARES: "EQUITY",
  PRICES: "PRICE", PRICE: "PRICE", QUOTES: "QUOTE", QUOTE: "QUOTE",
  // RELATIVE PERFORMANCE: a cross-pair ratio and an outperformance claim are the SAME
  // information kind - one asset measured against another - so an ETH/BTC ratio observation
  // can serve a thesis row written as "support for ETH outperformance". Shared market
  // vocabulary, never a per-question bridge: nothing here names an asset or a question.
  RATIO: "RELATIVE_PERFORMANCE", OUTPERFORMANCE: "RELATIVE_PERFORMANCE", OUTPERFORM: "RELATIVE_PERFORMANCE",
  OUTPERFORMS: "RELATIVE_PERFORMANCE", OUTPERFORMED: "RELATIVE_PERFORMANCE", RELATIVE: "RELATIVE_PERFORMANCE",
  HISTORICAL: "HISTORICAL", HISTORICALLY: "HISTORICAL", HISTORY: "HISTORICAL", PRIOR: "HISTORICAL",
};

/**
 * CRYPTO-DOMAIN VOCABULARY (shared language, not a question list): tokens that mark an
 * observation as concerning the crypto asset class — asset names/tickers plus crypto-native
 * market vocabulary. Used by the SEMANTIC DOMAIN GATE in matchRequirement: when the question
 * derives a non-crypto semantic domain, a crypto-asset observation is not ABOUT the question
 * and cannot satisfy its requirements. It is a property of the EVIDENCE, so a macro question
 * that legitimately names Bitcoin keeps matching (the vocabulary is only foreign when the
 * question's own domain is elsewhere).
 */
const CRYPTO_DOMAIN_TOKENS: ReadonlySet<string> = new Set([
  "BTC", "BITCOIN", "ETH", "ETHEREUM", "SOL", "SOLANA", "XRP", "RIPPLE", "DOGE", "DOGECOIN",
  "ADA", "CARDANO", "LTC", "LITECOIN", "AVAX", "AVALANCHE", "CHAINLINK", "DOT",
  "POLKADOT", "TRON", "TRX", "ZEC", "ZCASH", "CRYPTO", "CRYPTOCURRENCY", "ALTCOIN",
  "ONCHAIN", "WHALE", "WHALES", "WALLET", "WALLETS", "STAKING", "TOKEN", "TOKENS",
  "BINANCE", "COINBASE", "DEFI", "TVL", "HALVING", "MEMECOIN", "NFT",
]);

/** Evidence-class names that declare a requirement wants crypto-domain evidence (exempt from the gate). */
const CRYPTO_REQUIREMENT_CLASSES: ReadonlySet<string> = new Set(["CRYPTO", "DERIVATIVES", "ONCHAIN", "DEFI"]);

function canonicalToken(token: string): string {
  if (CONCEPT_SYNONYMS[token] !== undefined) return CONCEPT_SYNONYMS[token]!;
  // Naive plural folding for content words: "margins" -> "MARGIN", "drivers" -> "DRIVER".
  if (token.length > 4 && token.endsWith("S")) return token.slice(0, -1);
  // Light inflection folding (both sides, no vocabulary lists): an observation that the
  // asset "dropped" must share a token with a requirement asking for "the drop", and
  // "positioning" with "positions". Only regular -ed/-ing forms fold, the stem must stay a
  // content-sized word, and a doubled final consonant from the inflection is removed.
  if (token.length >= 6 && token.endsWith("ED")) {
    const stem = undouble(token.slice(0, -2));
    if (stem.length >= 4) return stem;
  } else if (token.length >= 7 && token.endsWith("ING")) {
    const stem = undouble(token.slice(0, -3));
    if (stem.length >= 4) return stem;
  }
  return token;
}

/** Drop a doubled final consonant produced by inflection ("DROPP" -> "DROP", "STOPP" -> "STOP"). */
function undouble(stem: string): string {
  const last = stem.slice(-1);
  return stem.length > 3 && stem.endsWith(last + last) ? stem.slice(0, -1) : stem;
}

function meaningfulTokens(text: string, opts: { stripCurrencyUnits?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    // CURRENCY-UNIT GUARD (item-side, conditional): a crypto price quote's denomination
    // ("80,750 USD") is not evidence about that currency's conditions. When the caller
    // detects the observation concerns an incompatible crypto subject, fiat codes are
    // stripped before matching so the USD->DOLLAR fold cannot satisfy a macro requirement
    // naming the dollar (live benchmark failure: the macro risk-assets requirement was
    // SATISFIED by BTC/ETF quotes through their USD unit). Requirement-side tokens are
    // NEVER stripped: the planner's "USD conditions" means the dollar concept, and genuine
    // macro observations ("USD index rose") keep matching through DXY/dollar/DXY vocabulary.
    if (opts.stripCurrencyUnits === true && CURRENCY_UNITS.has(raw)) continue;
    out.add(canonicalToken(raw));
  }
  return out;
}

/** Time sensitivity of a question/requirement text; the freshness policy driver. */
export function timeSensitivityOf(text: string): TimeSensitivity {
  // Historical material outranks a "current" adjective in the same sentence ("comparable
  // historical episodes for the current setup" is a historical requirement).
  if (/\bhistor\w*|\bpast\b|\bpreviously\b|\bbefore\b|\bsince \d{4}\b|\bin \d{4}\b/i.test(text)) return "HISTORICAL";
  if (/\b(right now|now|today|yesterday|currently|current|this week|this month|latest|moment)\b/i.test(text)) return "CURRENT";
  if (/\b(recent|recently|these days|near term|lately)\b/i.test(text)) return "RECENT";
  return "ANY";
}

/** Requirement id: stable, derived from the description (deterministic across rounds). */
export function requirementId(index: number): string {
  return `rq_${String(index + 1).padStart(2, "0")}`;
}

/**
 * Is this requirement capable of DISCRIMINATING relevance? A requirement whose text carries
 * no market vocabulary and no non-GENERAL domain (the engine's placeholder fallback
 * "relevant evidence for the research question", or a degenerate task objective) states no
 * criterion an observation could meet or fail. Such a requirement still participates in
 * coverage, but it must never EXCLUDE evidence from synthesis: it would empty the context of
 * every run that used it.
 */
export function isDiscriminatingRequirement(req: Pick<ResearchRequirement, "description" | "domains">): boolean {
  return meaningfulTokens(req.description).size > 0 || req.domains.some((d) => d !== "GENERAL");
}

/**
 * Which DECISION DIMENSION a ledger row belongs to, or undefined when it belongs to none.
 *
 * Ordered most-specific-first, because a causal row ("the current drivers behind BTC") also
 * contains "current" (RECENCY) and a challenge row ("evidence that weakens the conclusion")
 * also matches COUNTEREVIDENCE's vocabulary. Role is authoritative where the wording is
 * ambiguous: a CHALLENGE row is a counterevidence row whatever else it says.
 *
 * This is the classifier the FLOW CONTRACT uses to decide whether a row belongs to the selected
 * flow. It is deliberately vocabulary-based and generic (it describes decision shapes, never
 * assets), and an unrecognised row returns undefined so an unattributable requirement is never
 * mistaken for a contract violation.
 */
const DIMENSION_VOCABULARY: readonly (readonly [string, RegExp])[] = [
  ["DRIVER_RELATIONSHIP", /\b(transmission|mechanism|pass[- ]?through|channel|through how|into how|how .* reached|pathway)\b/i],
  ["FALSIFICATION_CONDITIONS", /\b(falsif\w*|disconfirm\w*|prove.{0,12}wrong|invalidate\w*|would (?:be )?break|disprov\w*)\b/i],
  ["THESIS_CHALLENGE", /\b(challenge\w*|contradict\w*|weaken\w*|oppos\w*|against the|counterevidence|counter-evidence|disconfirm\w*)\b/i],
  ["COUNTEREVIDENCE", /\b(against|oppos\w*|counter\w*|disconfirm\w*|risk to|weakens?)\b/i],
  ["THESIS_SUPPORT", /\b(supports?|confirms?|validat\w*) the .{0,24}thesis\b|\bconsistent with the .{0,24}thesis\b/i],
  ["CURRENT_DRIVERS", /\b(driv\w*|catalysts?|what(?:'s| is|s) (?:behind|pushing|moving)|push\w*|pressur\w*|reasons? for)\b/i],
  ["FORWARD_FACTORS", /\b(could affect|would affect|might affect|upcoming|forward[- ]looking|catalysts? ahead|next (?:few )?(?:days|weeks))\b/i],
  // "comparabl\w*" matches "comparable"/"comparability"/"comparably", and the optional
  // "past/prior/previous" gap absorbs the engine's own "comparable PAST episodes" wording — the
  // row was returning no dimension at all, so a HISTORICAL flow's own analogue-retrieval
  // requirement was unattributable and the isolation filter could not check it.
  ["HISTORICAL_EPISODE", /\b(happened before|histor\w*|analog\w*|analogue|comparabl\w*(?: (?:past|prior|previous|similar|historical))? (?:episode|episodes|setups?|instances?|periods?)|precedent|in \d{4})\b/i],
  ["COMPARISON_BASELINE", /\b(previous|prior|baseline|compared? (?:with|to)|versus|period over|week over|month over)\b/i],
  ["FRAMEWORK_CRITERIA", /\b(framework|criteri\w*|checklist|rubric|scoring)\b/i],
  ["CROSS_DOMAIN_COVERAGE", /\b(cross[- ]domain|cross[- ]asset|all (?:the )?(?:information|evidence)|everything (?:known|there is)|spillover|synthesi[sz])\b/i],
  ["MATERIALITY", /\b(material\w*|significan\w*|meaningful|decisive|how much .{0,24}matter)\b/i],
  ["RECENCY", /\b(current\w*|recent\w*|today|this week|latest|fresh\w*|now|timeliness)\b/i],
];

export function dimensionOfRequirement(
  description: string,
  role: RequirementRole,
): string | undefined {
  // Role is authoritative: a CHALLENGE row IS a disconfirmation dimension whatever it says,
  // and a CONTEXT row belongs to no dimension at all.
  if (role === "CONTEXT") return undefined;
  if (role === "CHALLENGE") return "COUNTEREVIDENCE";
  for (const [dimension, pattern] of DIMENSION_VOCABULARY) {
    if (pattern.test(description)) return dimension;
  }
  // A price/range/volume reconstruction row is the descriptive WHAT_HAPPENED dimension.
  if (/\b(price|ohlcv|volume|candle|kline|range|open|high|low|close|timestamp|dated|chronolog|timeline|sequence|performance)\b/i.test(description)) {
    return "WHAT_HAPPENED";
  }
  return undefined;
}

/**
 * Role from the requirement's own wording plus its declared importance. Deterministic and
 * question-agnostic: it reads the CRITERION (does it look for disconfirmation? is it
 * background?), not the subject.
 */
export function roleOf(description: string, importance: "CRITICAL" | "SUPPORTING"): RequirementRole {
  if (/\b(count(er|er-)?evidence|oppos\w*|contradict\w*|disconfirm\w*|falsif\w*|disconfirming|what (could|would) (prove|invalidate|weaken)|downside|bear\w*|risk to|challenge\w*)\b/i.test(description)) {
    return "CHALLENGE";
  }
  if (importance === "SUPPORTING" && /\b(context|background|overview|structural|general|industry (context|background)|for reference)\b/i.test(description)) {
    return "CONTEXT";
  }
  return importance === "CRITICAL" ? "CORE" : "SUPPORTING";
}

/**
 * The atomic observational rows a question's own wording earns.
 *
 * Every spec is a shape the trader NAMED. Nothing is inferred from a provider, and nothing is
 * added when the question named no shape — an observational question that asks only "what is
 * the price" keeps the single current-value row it always had.
 */
function observationalFieldSpecs(
  question: string,
  _subject: string,
): readonly EngineRequirementSpec[] {
  const facets = new Set<DataFacet>(facetsOfRequirementText(question));
  if (facets.size === 0) return [];
  const window = requestedWindowHours(question);
  // The granularity the trader NAMED ("hourly", "daily"). A window alone does not raise the
  // gate: "the last 24 hours" is satisfied by any resolution fine enough to reach it, while
  // "hourly" is satisfied only by hourly-or-finer data.
  const resolution = namedResolutionOf(question);
  const scope = window !== undefined ? ` over the last ${window} hours` : "";
  const out: EngineRequirementSpec[] = [];
  for (const facet of facets) {
    const label = ATOMIC_LABELS[facet];
    const description = (s: string) => `the observed ${label} for ${s}${scope}`;
    out.push({
      description,
      role: "CORE",
      importance: "CRITICAL",
      timeSensitivity: "CURRENT",
      evidenceClasses: fieldEvidenceClassesFor(facet),
      dataFacets: [facet],
      ...(resolution !== undefined ? { resolution } : {}),
      covers: fieldCoverPattern(facet),
    });
  }
  return out;
}

/** Evidence classes that may SERVE a shape. Declarative: a class never confers a shape. */
function fieldEvidenceClassesFor(facet: DataFacet): readonly string[] {
  switch (facet) {
    case "REPORTED_EVENT":
      return ["NEWS", "HEADLINE", "EVENT", "ANNOUNCEMENT"];
    case "VOLUME":
    case "AGGREGATE_VOLUME":
    case "HIGH":
    case "LOW":
    case "OPEN":
    case "CLOSE":
    case "OHLC":
      return ["OHLCV", "PRICE", "MARKET_DATA", "RAW_DATA", "OBSERVATION"];
    default:
      return ["PRICE", "QUOTE", "MARKET_DATA", "RAW_DATA", "OBSERVATION"];
  }
}

/** Does an already-present row already demand this shape? Read from its declared facets. */
function fieldCoverPattern(facet: DataFacet): RegExp {
  const words = ATOMIC_LABELS[facet].split(/\s+/).slice(0, 2).join("\\s+");
  return new RegExp(`\\b${words}\\b`, "i");
}

/**
 * FIELD-LEVEL DECOMPOSITION (research-integrity contract).
 *
 * A trader who enumerates the data they want gets ONE requirement per shape they named. The
 * reproduction made this unmissable:
 *
 *   "Retrieve Bitcoin price sequence, high, low, and volume data for the last 24 hours."
 *
 * as a single row was satisfiable by a CoinGecko spot snapshot, because the row's only test was
 * a shared token. Split, each shape stands or falls on its own: the price sequence needs a
 * series that spans the window, the high needs a high, the low needs a low, the volume needs
 * a volume field. One snapshot then settles exactly one of them and leaves the rest honestly
 * unresolved, which is what the trader's "say which ones are unavailable" asks for.
 *
 * Three laws:
 *  1. The rows KEEP the question's scope. Every atomic row carries the same role, importance,
 *     time sensitivity, domains and window the parent row had — nothing is downgraded to make
 *     it satisfiable, and nothing is dropped.
 *  2. Decomposition is REFINEMENT, never relaxation. A row demanding several shapes is replaced
 *     by rows demanding each; a row demanding one shape is left exactly as it is.
 *  3. Text that names no data shape (a driver row, a thesis row, a counterevidence row) is
 *     untouched, so every non-observational ledger keeps its existing behaviour verbatim.
 */
export function decomposeFieldRequirements(rows: readonly ResearchRequirement[]): ResearchRequirement[] {
  const out: ResearchRequirement[] = [];
  for (const row of rows) {
    // ENGINE ROWS ARE NOT DECOMPOSED FROM THEIR WORDING (see `requiredFacetsOf`): their text
    // describes a decision dimension, and an incidental data word must not manufacture demands
    // the engine never intended. They pass through untouched.
    if (row.engineRequired === true && row.dataFacets === undefined) {
      out.push(row);
      continue;
    }
    // IDEMPOTENCE: a row that already carries ONE explicit shape is already atomic and passes
    // through untouched. Without this, an atomic row's own wording ("the observed high over the
    // requested window") would name several shapes again and be split on every pass.
    const declared = row.dataFacets;
    if (declared !== undefined && declared.length <= 1) {
      out.push(withDerivedShape(row, [...declared]));
      continue;
    }
    const facets = declared ?? facetsOfRequirementText(row.description);
    if (facets.length <= 1) {
      out.push(withDerivedShape(row, facets));
      continue;
    }
    const windowHours = requestedWindowHours(row.description);
    const resolution = row.resolution ?? namedResolutionOf(row.description);
    const subject = /\bfor ([A-Z]{2,6})\b/.exec(row.description)?.[1];
    for (const facet of facets) {
      out.push({
        ...row,
        id: requirementId(out.length),
        description: atomicDescriptionFor(row.description, facet, subject),
        dataFacets: [facet],
        ...(windowHours !== undefined ? { windowHours } : {}),
        ...(resolution !== undefined ? { resolution } : {}),
        recoveryAttempts: 0,
        status: "PENDING",
        evidenceRefs: [],
        staleOnlyRefs: [],
        ...(row.duplicateEvidenceRefs !== undefined ? { duplicateEvidenceRefs: [] } : {}),
        retrievalObjective: retrievalObjectiveFor(atomicDescriptionFor(row.description, facet, subject), row.timeSensitivity, row.role),
      });
    }
  }
  return out.map((row, i) => ({ ...row, id: requirementId(i) }));
}

/** Attach the shape a row derives from its own wording, without touching an explicit one. */
function withDerivedShape(row: ResearchRequirement, facets: readonly DataFacet[]): ResearchRequirement {
  // An ENGINE row declares its shapes; only a planner row has them read from its wording.
  if (row.engineRequired === true) {
    return row.dataFacets === undefined ? row : row;
  }
  const windowHours = requestedWindowHours(row.description);
  const resolution = row.resolution ?? namedResolutionOf(row.description);
  return {
    ...row,
    ...(row.dataFacets !== undefined ? {} : { dataFacets: [...facets] }),
    ...(row.windowHours !== undefined || windowHours === undefined ? {} : { windowHours }),
    ...(resolution !== undefined ? { resolution } : {}),
  };
}

/**
 * The wording of one atomic row. It keeps the parent's request in its own terms and names the
 * shape it now stands for, so the trader's diagnostics read back as the shapes they asked for
 * rather than as an internal schema.
 */
const ATOMIC_LABELS: Readonly<Record<DataFacet, string>> = {
  SNAPSHOT: "current value",
  SERIES: "timestamped price sequence",
  OHLC: "open/high/low/close record for each interval",
  OPEN: "opening price",
  HIGH: "high",
  LOW: "low",
  CLOSE: "closing price",
  VOLUME: "volume",
  AGGREGATE_VOLUME: "aggregate volume",
  TIMESTAMP: "time of each observation",
  WINDOW: "window boundaries",
  REPORTED_EVENT: "reported event dated inside the window",
};

/**
 * Which data shapes a piece of requirement wording names, most specific first.
 *
 * Shared by the atomic-row writer and the enumeration stripper so they can never disagree
 * about what a clause names: a clause that names a shape is that shape's wording, and a
 * clause that names none is context (subject, verb, window) that every atomic row keeps.
 * Pure vocabulary of SHAPES — never an asset, topic or question list.
 */
const FACET_CLAUSE_VOCABULARY: readonly { readonly facet: DataFacet; readonly re: RegExp }[] = [
  { facet: "REPORTED_EVENT", re: /\b(?:dated|events?|headlines?|news|announcements?|developments?)\b/i },
  { facet: "SERIES", re: /\b(?:price\s+)?(?:sequence|path|trajectory|history|series|timeline)\b/i },
  { facet: "OHLC", re: /\bohlc\b/i },
  { facet: "OPEN", re: /\bopen(?:ing)?\b/i },
  { facet: "CLOSE", re: /\bclos(?:e|ing)\b/i },
  { facet: "HIGH", re: /\bhighs?\b/i },
  { facet: "LOW", re: /\blows?\b/i },
  { facet: "AGGREGATE_VOLUME", re: /\b(?:aggregate|total|cumulative)\s+volumes?\b/i },
  { facet: "VOLUME", re: /\bvolumes?\b/i },
  { facet: "TIMESTAMP", re: /\btimestamps?\b|\btime of each observation\b/i },
  { facet: "WINDOW", re: /\bwindow\b/i },
  { facet: "SNAPSHOT", re: /\b(?:price|prices|value|level|quote|current|spot|latest)\b/i },
];

/** The facets a clause names (the FIRST specific match wins a contested word: "price
 * sequence" is a SERIES clause, not a SNAPSHOT one). */
function facetsNamedBy(text: string): ReadonlySet<DataFacet> {
  const named = new Set<DataFacet>();
  for (const entry of FACET_CLAUSE_VOCABULARY) {
    if (!entry.re.test(text)) continue;
    named.add(entry.facet);
    // A clause matched by a specific shape stops claiming the generic ones its words share.
    if (entry.facet === "SERIES") named.delete("SNAPSHOT");
    if (entry.facet === "OHLC") { named.delete("OPEN"); named.delete("HIGH"); named.delete("LOW"); named.delete("CLOSE"); }
    if (entry.facet === "AGGREGATE_VOLUME") named.delete("VOLUME");
  }
  return named;
}

/** Top-level enumeration segments of a requirement text (commas, semicolons, and/or). */
function enumerationClausesOf(text: string): readonly string[] {
  return text
    .split(/(?:,|;|\band\b|\bor\b)+/i)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

function atomicDescriptionFor(parent: string, facet: DataFacet, subject: string | undefined): string {
  const label = ATOMIC_LABELS[facet];
  // CLAUSE-LEVEL DECOMPOSITION (requirement-fidelity law): the atomic row is written from
  // the parent's OWN wording — the clause(s) that name this facet plus every context clause
  // (subject, verb, window) — with the OTHER facets' clauses removed whole. Deleting bare
  // shape nouns in place is what produced mangled rows ("Retrieve current Bitcoin price,
  // today's , today's , and 24-hour"): the possessive and the quantifier were left behind
  // with nothing to modify. The clause survives here with its qualifiers, so no semantic
  // constraint (a metric, a possessive scope, a time range) is silently deleted.
  const clauses = enumerationClausesOf(parent);
  const own = clauses.filter((c) => facetsNamedBy(c).has(facet));
  if (own.length > 0) {
    const context = clauses.filter((c) => facetsNamedBy(c).size === 0);
    const composed = [...context, ...own].join(", ");
    // The window travels: when the parent named a window and the kept wording does not
    // carry it, the parent's own window phrase is appended verbatim (never re-derived).
    const windowPhrase = /(?:\b(?:for|over|across|during)\b\s+(?:the\s+)?(?:last|past|previous)?\s*[\w-]*\s*(?:hours?|days?|weeks?|months?))|(?:\btoday(?:'s)?\b|\btonight\b|\bthis session\b|\bintraday\b|\b24[- ]hour\b|\b48[- ]hour\b|\b12[- ]hour\b)/i.exec(parent)?.[0];
    const scoped = composed.includes("last") || /(?:today|tonight|intraday|session|24[- ]hour|48[- ]hour|12[- ]hour)/i.test(composed) || windowPhrase === undefined
      ? composed
      : `${composed} ${windowPhrase}`;
    // The label is appended only when the kept wording does not already name the shape —
    // a row that reads "high — high" says the same thing twice.
    const labelWords = label.split(/\s+/)[0] ?? "";
    const needsLabel = labelWords !== "" && !new RegExp(`\\b${labelWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(scoped);
    return `${scoped}${needsLabel ? ` — ${label}` : ""}${subject !== undefined ? ` for ${subject}` : ""}`.trim();
  }
  // Fallback (the facet is implied, not named): the parent minus its enumeration segments,
  // with the same no-fragments law.
  const trimmed = stripEnumerations(parent);
  return `${trimmed} — ${label}${subject !== undefined ? ` for ${subject}` : ""}`.trim();
}

/**
 * Remove an enumeration of data shapes from a parent requirement's text, leaving its subject,
 * scope and window intact: "Retrieve Bitcoin price sequence, high, low, and volume data for the
 * last 24 hours." becomes "Retrieve Bitcoin data for the last 24 hours.".
 *
 * Segment law: a clause is dropped ONLY when it names ONLY shape vocabulary; a clause with
 * other content (the subject, the verb, a window) is kept whole. Shape words are never
 * deleted in place — that is the mangling law this function exists to enforce.
 */
function stripEnumerations(text: string): string {
  const clauses = enumerationClausesOf(text);
  const kept = clauses.filter((c) => facetsNamedBy(c).size === 0);
  return (kept.length > 0 ? kept.join(", ") : text)
    .replace(/\s*,(?:\s*,)+\s*/g, ", ")
    .replace(/\bdata\s*,/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*\./g, ".")
    .replace(/\s*[,;]\s*$/, "")
    .trim();
}

/** Requirement-scoped retrieval objective handed to research workers (never the whole question). */
export function retrievalObjectiveFor(description: string, timeSensitivity: TimeSensitivity, role: RequirementRole): string {
  const window = timeSensitivity === "CURRENT" ? "current data only" : timeSensitivity === "RECENT" ? "the recent period" : timeSensitivity === "HISTORICAL" ? "historical periods" : "the relevant period";
  const purpose = role === "CHALLENGE" ? "Find evidence that could WEAKEN or contradict the emerging conclusion for" : "Find dated, attributable evidence for";
  return `${purpose}: ${description} (${window}). Return sources with dates; distinguish primary evidence from secondary reporting; do not return the same syndicated article twice.`;
}

/**
 * Seeds -> requirements. When the planner supplied requirement descriptions, they are used
 * verbatim (it understands the question); the engine adds domains, the freshness policy, the
 * decision role and the retrieval objective.
 */
export function buildRequirements(seeds: readonly RequirementSeed[]): readonly ResearchRequirement[] {
  return seeds.map((seed, i) => {
    const description = seed.description.trim();
    const domains = domainsOfRequirement(description);
    const importance = seed.importance ?? "CRITICAL";
    // The HISTORICAL freshness law (today's live observation never satisfies it) is enforced
    // only when the requirement's own text speaks of historical material. A planner tag alone
    // cannot make a requirement unsatisfiable by the evidence that answers it: "drivers of the
    // drop" or "what happened yesterday" must be judgeable against fresh observations.
    const derived = timeSensitivityOf(description);
    const timeSensitivity = seed.timeSensitivity === "HISTORICAL" && derived !== "HISTORICAL"
      ? derived
      : (seed.timeSensitivity ?? derived);
    const role = seed.role ?? roleOf(description, importance);
    return {
      id: requirementId(i),
      description,
      importance,
      role,
      timeSensitivity,
      domains: domains.length > 0 ? domains : (["GENERAL"] as const),
      status: "PENDING" as const,
      evidenceRefs: [],
      staleOnlyRefs: [],
      recoveryAttempts: 0,
      ...(seed.calculation !== undefined ? { calculation: seed.calculation } : {}),
      ...(seed.resolution !== undefined ? { resolution: seed.resolution } : {}),
      ...(seed.evidenceClasses !== undefined && seed.evidenceClasses.length > 0
        ? { evidenceClasses: [...seed.evidenceClasses] }
        : {}),
      ...(seed.relationshipType !== undefined ? { relationshipType: seed.relationshipType } : {}),
      ...(seed.targetTerms !== undefined && seed.targetTerms.length > 0 ? { targetTerms: [...seed.targetTerms] } : {}),
      retrievalObjective: retrievalObjectiveFor(description, timeSensitivity, role),
    };
  });
}

/**
 * FLOW-OWNED EVIDENCE REQUIREMENTS: DELIBERATELY EMPTY.
 *
 * The first attempt at this fix hardcoded WHAT_HAPPENED's evidence rows (timestamped price
 * movement, window high/low, volume, dated events) as CRITICAL engine requirements. That fixed
 * the reproduction's evidence failure but broke the capability-first seam this engine
 * documents — "no flow→tool hardcoding: swapping providers needs zero changes here" — because
 * CRITICAL rows drive `mandatoryCapabilities`, so the engine started scheduling capabilities
 * the planner never chose. The regression suite caught it (tests/lui/lui.test.ts asserts only
 * the PLANNED capability runs).
 *
 * The correct place for a flow's evidence expectations is the PLANNER'S BRIEF: the resolved
 * flow and its contract are stated to the planner (see `flowGuidance` in adaptive.ts), and the
 * planner — which already chooses capabilities — declares the timestamped price requirements its
 * own methodology needs. The engine still GUARANTEES the dimensions, refuses out-of-contract
 * rows, and refuses to fabricate one: what changed is that the flow informs planning instead of
 * overwriting it.
 */
const FLOW_REQUIRED_EVIDENCE: Readonly<Record<string, readonly EngineRequirementSpec[]>> = {};

export type QuestionType =
  | "COMPARISON" | "CAUSAL" | "EVENT" | "MACRO_REGIME" | "THESIS" | "FALSIFICATION" | "HISTORICAL" | "OBSERVATION" | "SYNTHESIS"
  /** Forward-looking/conditional: "what could affect X over the next few days". */
  | "FORWARD_LOOKING";

/**
 * The question's decision type, read from its own wording. Deterministic and generic: these
 * patterns describe QUESTION SHAPES (compare two periods, explain a move, anticipate an event,
 * assess a regime, test a belief), never assets or topics.
 */
/**
 * The market class the question is about, read from its own vocabulary (a taxonomy of MARKET
 * CLASSES, not a list of questions). Used to decide whether a market-class-specific engine
 * requirement (supply/demand for a commodity, a rate differential for an FX pair) applies at
 * all. Unseen assets of a known class are handled identically to the ones the product has seen.
 */
export function subjectMarketClassOf(question: string): SubjectMarketClass {
  const q = question.toLowerCase();
  if (/\bvolatility index\b|\bvix\b/.test(q)) return "VOLATILITY";
  if (/\byield|\btreasur|\bbond|\brates?\b|\bcurve\b|\bfed funds\b/.test(q)) return "RATES";
  // CRYPTO IS A CLASS, NOT A LIST OF THE ASSETS THE PRODUCT HAS SEEN. The crypto vocabulary
  // below plus the shared asset registry (any known ticker/name) decide the class, so a
  // question about XRP, DOGE or an asset not enumerated here still resolves to CRYPTO and its
  // market-data requirements reach the crypto provider chain instead of the commodity one.
  if (/\bcrypto|\bcryptocurrency|\btoken\b|\bonchain\b|\bon-chain\b|\baltcoin\b|\bdefi\b|\bhalving\b|\bmemecoin\b|\bstablecoin\b/.test(q)) return "CRYPTO";
  if (mentionsCryptoAsset(question)) return "CRYPTO";
  if (/\bgold|\bsilver|\bcopper|\bplatinum|\bpalladium|\bmetal/.test(q)) return "METAL";
  if (/\boil\b|\bcrude|\bbrent|\bwti\b|\bgas\b|\bcommodit|\bbarrel/.test(q)) return "COMMODITY";
  if (/\bdollar|\bdxy\b|\beur|\busd\b|\bjpy\b|\bgbp\b|\bcurrency|\bforex|\bfx\b|\bpair\b|\byen\b|\bpound\b|\beuro\b/.test(q)) return "FX";
  if (/\bs\s*&\s*p\b|\bnasdaq|\bdow\b|\bindex|\bindices|\bequit|\bstocks?\b|\bshares\b|\bsemiconductor|\bsector/.test(q)) return "INDEX";
  if (/\bearnings|\bcompany|\bguidance|\brevenue|\bmargins?\b/.test(q)) return "EQUITY";
  // ABSTRACT SEMANTIC TARGET (no-instrument ≠ no-subject): a broad macro / risk-regime
  // question names no instrument but still names its domain — "macro conditions", "risk
  // assets", "financial conditions". The class constrains which provider output is ABOUT
  // the question; it is derived from the question's own wording, never a question list.
  if (/\bmacro\b|\bmacroeconomic\b|\brisk[- ]?assets?\b|\brisk[- ]?on\b|\brisk[- ]?off\b|\bfinancial conditions\b|\bliquidity conditions\b|\bgrowth conditions\b|\binflation (regime|conditions|outlook)\b|\bthe ( broad )?markets?\b/.test(q)) return "MACRO";
  return "UNKNOWN";
}

/** Map an instrument resolution's market kind onto the research contract's subject class. */
export function subjectClassOfKind(kind: string | undefined): SubjectMarketClass {
  switch (kind) {
    case "commodity": return "COMMODITY";
    case "metal": return "METAL";
    case "fx": return "FX";
    case "index": return "INDEX";
    case "volatility": return "VOLATILITY";
    default: return "UNKNOWN";
  }
}

export function questionTypeOf(question: string): QuestionType {
  // NEGATION-AWARE CLASSIFICATION (execution-contract law): classify what the trader ASKED for,
  // never what they forbade. The reproduction request said "Do not perform synthesis,
  // falsification, counterevidence analysis" and was classified FALSIFICATION — the ban on
  // falsification was read as a request for it, which then earned a real FALSIFICATION round and
  // challenge requirements. Prohibition clauses are removed before any pattern below is tested.
  const q = withoutProhibitions(question).toLowerCase();
  // DESCRIPTIVE-BEFORE-CAUSAL (flow-isolation fix). "what happened", "what occurred", "what
  // took place", "timeline", "chronology", "factual sequence" are RECONSTRUCTION shapes and
  // were matched INSIDE THE CAUSAL BRANCH below, so a trader asking for the factual sequence
  // of a move was classified CAUSAL — the exact inverse of the request — and then earned
  // drivers, mechanism, transmission and counterevidence requirements. They are tested FIRST,
  // before any causal shape, because a descriptive question must never inherit causal work.
  // A genuinely causal phrasing still wins below: "why did it happen" is WHY-shaped, and a
  // question that asks for a cause alongside the timeline ("what happened and what caused
  // it") matches the CAUSAL patterns, which run after this test.
  if (/\bwhat (?:happened|occurred|took place|has happened|was observed)\b|\b(?:the )?(?:factual |chronological |exact )?(?:timeline|chronology|sequence of events)\b|\bwhat(?:'s| has) been going on\b|\brecap\b|\bsequence of (?:price )?(?:movement|events)\b|\bfactual sequence\b/.test(q)) return "OBSERVATION";
  if (/\bprove\b.*\bwrong\b|\binvalidate\b|\bfalsif\w*|\bwhat would change\b|\bdisconfirm\w*/.test(q)) return "FALSIFICATION";
  // RAW OBSERVATION (question-type integrity): "what is Bitcoin's current spot price?",
  // "retrieve one fresh observation", "what is the latest quote" ask for a measurement, not
  // for a conclusion. This type exists because the classifier previously fell through to the
  // catch-all SYNTHESIS, which made every market-data retrieval acquire the analytic
  // dimensions — a counterevidence requirement, a FALSIFICATION round, thesis implications —
  // that the request never asked for.
  if (/\b(spot price|current price|price (?:right )?now|latest price|current (?:quote|spot|price|value|level)|what(?:'s| is) the (?:price|quote|spot price)|retrieve|fetch|pull|observe|observation|quote|reading)\b/.test(q)) return "OBSERVATION";
  // HISTORICAL ("has ... happened before" OR "has ... like this ... before"): the analogue
  // shape does not require the word "happened" — "Has Bitcoin reacted like this to similar
  // CPI surprises before?" is a precedent question, and without this form it fell through to
  // SYNTHESIS (the catch-all) and never earned the HISTORICAL contract's shape.
  if (/\bhas (this|it|that|the .*? setup)\b.*\bhappened\b|\bhistor\w*|\bsimilar setup\b|\bhappened before\b|\banalog\w*|\bcomparable episodes?\b|\bha(?:s|ve)\b[^.?!]{0,80}\b(?:like this|same setup|similar to this)\b[^.?!]{0,60}\bbefore\b/.test(q)) return "HISTORICAL";
    if (/\bmy thesis\b|\bthesis\b|\bmy (view|position|read|call)\b|\baccording to my\b|\bdoes (this|the) (hold|still hold)\b/.test(q)) return "THESIS";
  if (/\bcompare\w*|\bcompared (with|to)\b|\bversus\b|\bvs\.?\b|\bweek over week\b|\bweek[- ]over[- ]week\b|\bmonth over month\b|\bbetter than\b|\bperformance (vs|versus)\b/.test(q)) return "COMPARISON";
  if (/\bearnings\b|\breport\b|\bresults\b|\bfomc\b|\bcpi print\b|\bupcoming\b|\baround its next\b|\bnext (earnings|report|meeting|print)\b/.test(q)) return "EVENT";
  // FORWARD-LOOKING (flow-isolation fix): "what could affect X over the next few days" is a
  // CONDITIONAL question about future drivers and catalysts, and it used to fall through to the
  // SYNTHESIS catch-all, which generates no engine dimension at all. So the WHAT_COULD_AFFECT_IT
  // contract GRANTED FORWARD_FACTORS while nothing in the engine could ever produce it — the
  // grant was decorative. Tested AFTER the EVENT shape so "what could affect NVDA around its next
  // earnings" stays an EVENT question, and BEFORE the CAUSAL shape so a conditional question is
  // not read as an explanation of something that already happened.
  if (/\b(?:could|would|might) affect\b|\bforward[- ]looking\b|\bupcoming (?:events?|catalysts?|decisions?|risks?)\b|\bcatalysts? ahead\b|\bover the next (?:few )?(?:days|weeks|months)\b/.test(q)) return "FORWARD_LOOKING";
    if (/\bmacro\b|\brisk assets\b|\brisk[- ]on\b|\brisk appetite\b|\bregime\b|\bconditions?\b|\bfinancial conditions\b|\bliquidity\b/.test(q)) return "MACRO_REGIME";
  // `drove` is the past tense of `drive` and is NOT matched by the `driv\w*` stem, so an
  // ordinary causal question ("What drove the move in crude oil?") fell through to the
  // SYNTHESIS catch-all and acquired no causal dimensions at all. Verb morphology is part of the
  // question SHAPE, not a phrasing to special-case: the causal family folds to one vocabulary.
  if (/\bdriv\w*|\bdrove\b|\bdriven\b|\bwhy\b|\bwhat(?:'s| is|s) (behind|pushing|pressuring|moving)\b|\bpressur\w*|\bcaus\w*|\bexplain\w*|\b(?:is|are|was|were)\b[^.?!]{0,60}\baffect\w*\b/.test(q)) return "CAUSAL";
  return "SYNTHESIS";
}

/**
 * Does THIS question type ask for a conclusion to be challenged?
 *
 * A raw observation ("what is Bitcoin's current spot price?") and a historical analogue
 * ("has this happened before?") do NOT: there is no leading conclusion to weaken, so a
 * counterevidence requirement is scope contamination, not rigor. Causal, comparison,
 * thesis and falsification questions DO earn one.
 */
export function challengeEarnedBy(questionType: QuestionType): boolean {
  // A raw measurement has no leading conclusion to weaken, so it earns no challenge
  // dimension. Every analytic type keeps its counterevidence requirement.
  return questionType !== "OBSERVATION";
}

/**
 * Market classes an engine-required dimension applies to. A supply/demand dimension belongs on
 * a commodity question and would be nonsense on a yield or index question, so applicability is
 * declared per dimension rather than assumed. Derived from the question's own subject (never
 * from a question list), so an unseen asset of a known class is handled identically.
 */
export type SubjectMarketClass = "COMMODITY" | "METAL" | "FX" | "INDEX" | "VOLATILITY" | "RATES" | "EQUITY" | "CRYPTO" | "MACRO" | "UNKNOWN";

interface EngineRequirementSpec {
  readonly description: (subject: string) => string;
  readonly role: RequirementRole;
  readonly importance: "CRITICAL" | "SUPPORTING";
  readonly timeSensitivity: TimeSensitivity;
  readonly calculation?: RequirementCalculation;
  /** Evidence classes that can serve this dimension (engine-inferred requirements only). */
  readonly evidenceClasses: readonly string[];
  /** Does an existing requirement already state this dimension? */
  readonly covers: RegExp;
  /**
   * The data SHAPES this dimension demands, when it demands one. Absent for every
   * non-observational dimension, which is what leaves driver/thesis/counterevidence rows
   * matched exactly as they always were.
   */
  readonly dataFacets?: readonly DataFacet[];
  /** The granularity this dimension demands, when it names one. */
  readonly resolution?: Resolution;
  /** When present, the domain applies only to these subject market classes. */
  readonly markets?: readonly SubjectMarketClass[];
}

/**
 * ENGINE-REQUIRED DIMENSIONS per question type (research contract): the model may propose
 * requirements, but it cannot omit a dimension the engine requires. An omitted dimension is
 * added with role CORE, so the capability floor must retrieve it and the completion gate
 * must see it covered. Generic by construction: the specs describe DECISION dimensions
 * (previous-period performance, supply/demand drivers, event timing and expectations,
 * regime components, belief support and challenge), not assets or questions.
 */
const ENGINE_REQUIRED: Readonly<Record<QuestionType, readonly EngineRequirementSpec[]>> = {
  COMPARISON: [
    {
      description: (s) => `the previous period's price performance for ${s} (for the comparison the question asks for)`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["OHLCV", "PRICE", "QUOTE", "MARKET_DATA", "HISTORICAL"],
      // MC-2: this is a QUANTITATIVE market-data dimension. It declares the shape it needs, so a
      // news headline (which carries only REPORTED_EVENT) can never satisfy it by naming the
      // subject. The asset name is an admission fact, never a coverage proof.
      dataFacets: ["SNAPSHOT"],
      covers: /previous (week|period|month|quarter|day)|prior (week|month|quarter|period)|last (week|month|quarter)|comparison period/i,
    },
    {
      description: (s) => `the explicit period over period change for ${s} (price, volume and range) as a calculated comparison`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT", calculation: "PERIOD_OVER_PERIOD",
      evidenceClasses: ["OHLCV", "PRICE", "RETURN", "MARKET_DATA", "PERFORMANCE"],
      covers: /period over period|week over week|month over month|calculated comparison|change (vs|from|compared)|\.pct change\b/i,
    },
    {
      description: (s) => `volume and range context for ${s} across the compared periods`,
      role: "SUPPORTING", importance: "SUPPORTING", timeSensitivity: "CURRENT",
      evidenceClasses: ["VOLUME", "OHLCV", "RANGE", "MARKET_DATA"],
      dataFacets: ["VOLUME"],
      covers: /volume|range|high.{0,3}(and|or).{0,3}low/i,
    },
  ],
  CAUSAL: [
    {
      description: (s) => `the current drivers and catalysts behind ${s}`,
      // SUPPORTING, not CORE: the substantive dimensions of a causal question are the ones that
      // explain the move (supply/demand for a commodity, a rate/policy differential for an FX
      // pair), which the engine requires separately. The wrapper dimension improves
      // interpretation and must not block a run whose factors were retrieved under another label.
      role: "SUPPORTING", importance: "SUPPORTING", timeSensitivity: "CURRENT",
      evidenceClasses: ["NEWS", "DRIVER", "HEADLINE", "CATALYST", "DEVELOPMENT", "EVENT"],
      covers: /driver|catalyst|what (is )?(driving|pushing|pressuring)|explanation|reason/i,
    },
    {
      description: (s) => `the supply and producer side factors affecting ${s}`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      markets: ["COMMODITY", "METAL"],
      evidenceClasses: ["SUPPLY", "PRODUCTION", "POLICY", "NEWS", "COMMODITY", "FUNDAMENTALS"],
      covers: /supply|producer|production|opec|output|export/i,
    },
    {
      description: (s) => `the demand, inventory and consumption factors affecting ${s}`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      markets: ["COMMODITY", "METAL"],
      evidenceClasses: ["INVENTORY", "DEMAND", "SUPPLY", "NEWS", "COMMODITY", "FUNDAMENTALS"],
      covers: /demand|inventor|consumption|import|usage/i,
    },
    {
      description: (s) => `the rate, policy or growth differential driving ${s}`,
      role: "SUPPORTING", importance: "SUPPORTING", timeSensitivity: "CURRENT",
      markets: ["FX", "RATES", "INDEX"],
      evidenceClasses: ["RATE", "YIELD", "POLICY", "MACRO", "NEWS", "GROWTH"],
      covers: /differential|policy|rate|growth/i,
    },
  ],
  EVENT: [
    {
      description: (s) => `the timing of the upcoming event for ${s} (date or window)`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["EARNINGS_DATE", "CALENDAR", "DATE", "REPORT", "EVENT"],
      covers: /date|timing|schedul|when\b/i,
    },
    {
      description: (s) => `the consensus expectations for the upcoming event for ${s}`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["CONSENSUS", "ESTIMATE", "GUIDANCE", "FORECAST", "EARNINGS"],
      covers: /consensus|expectation|estimate|forecast|guidance/i,
    },
    {
      description: (s) => `recent fundamentals and company catalysts for ${s}`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "RECENT",
      evidenceClasses: ["FUNDAMENTALS", "NEWS", "COMPANY_EVENT", "ANNOUNCEMENT", "REVENUE", "MARGIN"],
      covers: /fundamental|catalyst|recent .*(development|news)|company development/i,
    },
  ],
  MACRO_REGIME: [
    {
      description: () => "the current interest rate, yield and policy conditions",
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["RATE", "YIELD", "POLICY", "MACRO", "INFLATION"],
      covers: /rate|yield|policy|fed|central bank/i,
    },
    {
      description: () => "the current volatility and risk appetite regime",
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["VOLATILITY", "VIX", "SENTIMENT", "MACRO", "REGIME"],
      covers: /volatil|risk appetite|risk regime|sentiment/i,
    },
    {
      description: () => "the current dollar and liquidity or financial conditions",
      role: "SUPPORTING", importance: "SUPPORTING", timeSensitivity: "CURRENT",
      evidenceClasses: ["USD", "DOLLAR", "LIQUIDITY", "CREDIT", "FX", "MACRO"],
      covers: /dollar|usd|dxy|liquidit|financial condition|credit/i,
    },
    {
      description: () => "the current growth regime (GDP, PMI, employment, activity data)",
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["GROWTH", "GDP", "PMI", "EMPLOYMENT", "LABOR", "MACRO", "ACTIVITY"],
      covers: /gdp|growth|pmi|employ|labor|labour|activity|manufactur|services/i,
    },
    {
      description: () => "the current inflation regime (CPI, PPI, inflation expectations, wage growth)",
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["INFLATION", "CPI", "PPI", "PRICE_LEVEL", "WAGE", "MACRO", "EXPECTATIONS"],
      covers: /inflation|cpi|ppi|price level|wage|expectation|deflation|disinflation/i,
    },
    {
      description: () => "credit spreads, financial conditions index, or banking system health",
      role: "SUPPORTING", importance: "SUPPORTING", timeSensitivity: "CURRENT",
      evidenceClasses: ["CREDIT", "SPREAD", "FINANCIAL_CONDITIONS", "BANKING", "MACRO"],
      covers: /credit|spread|financial condition|banking|lending|loan/i,
    },
  ],
  THESIS: [
    {
      description: () => "evidence that supports the trader's stated thesis",
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["NEWS", "PRICE", "MACRO", "MARKET_DATA", "FUNDAMENTALS", "SENTIMENT"],
      covers: /support|confirm|consistent with|for the thesis/i,
    },
    {
      description: () => "evidence that challenges or contradicts the trader's stated thesis",
      role: "CHALLENGE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      // MC-4: counterevidence is DISCONFIRMING evidence. Ordinary supporting news is not in the
      // admissible set, so a headline that merely names the subject can never stand in for
      // counterevidence; the row is answered only by evidence that votes against the reading.
      evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK"],
      covers: /challeng|contradict|against the thesis|weaken|oppos/i,
    },
  ],
  FALSIFICATION: [
    {
      description: (s) => `disconfirming evidence that would falsify the leading conclusion for ${s}`,
      role: "CHALLENGE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      // MC-4: counterevidence is DISCONFIRMING evidence. Ordinary supporting news is not in the
      // admissible set, so a headline that merely names the subject can never stand in for
      // counterevidence; the row is answered only by evidence that votes against the reading.
      evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK"],
      covers: /falsif|disconfirm|prove.{0,12}wrong|invalidate|weaken/i,
    },
  ],
  HISTORICAL: [
    {
      description: (s) => `comparable past episodes for ${s}`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "HISTORICAL",
      evidenceClasses: ["EPISODE", "OHLCV", "HISTORICAL", "MARKET_DATA", "CYCLE"],
      covers: /episode|analog|similar (setup|period|instance)|historical (instance|period|episode)/i,
    },
    {
      description: (s) => `how comparable past setups for ${s} resolved afterwards, with the sample and similarity criteria`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "HISTORICAL", calculation: "EPISODE_SIMILARITY",
      evidenceClasses: ["OUTCOME", "EPISODE", "OHLCV", "HISTORICAL", "RETURN"],
      covers: /resolved|outcome|after (similar|comparable|prior)|follow(ed|ing) (sessions|weeks|period)/i,
    },
  ],
  SYNTHESIS: [],
  /**
   * FORWARD-LOOKING / CONDITIONAL: the future-facing dimensions of "what could affect X" —
   * the events and conditions ahead, and what would change which of them matter. Deliberately
   * phrased in the FORWARD_FACTORS vocabulary ("upcoming events", "forward-looking conditions",
   * "next few days") and never in CURRENT_DRIVERS' vocabulary ("drivers", "catalysts"): the
   * dimension classifier tests CURRENT_DRIVERS first, and a row worded "upcoming catalysts" was
   * being attributed to the CURRENT_DRIVERS dimension, which the forward-looking contract denies.
   */
  FORWARD_LOOKING: [
    {
      description: (s) => `the upcoming events and scheduled conditions that could affect ${s} over the requested horizon`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["NEWS", "EVENT", "SCHEDULED_EVENT", "CALENDAR", "POLICY", "MACRO", "PRICE", "MARKET_DATA"],
      covers: /upcoming (?:events?|scheduled)|could affect|over the requested horizon|next (?:few )?(?:days|weeks|months)/i,
    },
    {
      description: (s) => `forward-looking conditions over the next few days that would make one factor matter more than another for ${s}`,
      role: "SUPPORTING", importance: "SUPPORTING", timeSensitivity: "CURRENT",
      evidenceClasses: ["NEWS", "MACRO", "POLICY", "SENTIMENT", "EVENT"],
      covers: /forward[- ]looking conditions|make one factor matter|next (?:few )?(?:days|weeks|months)/i,
    },
  ],
  /**
   * RAW OBSERVATION: the single dimension the request actually asks for — the current
   * measurement itself. It carries no counterevidence row (there is no conclusion to weaken),
   * no thesis dimension, and no historical row.
   */
  OBSERVATION: [
    {
      description: (s) => `the current observed value or level for ${s} (a fresh measurement, not an interpretation)`,
      role: "CORE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["PRICE", "QUOTE", "MARKET_DATA", "OHLCV", "RAW_DATA", "OBSERVATION"],
      // MC-2: the measurement dimension declares the shape a measurement carries. A headline or
      // a driver note is not a measurement, whatever subject it names.
      dataFacets: ["SNAPSHOT"],
      covers: /current|spot|quote|observation|reading|level|value/i,
    },
  ],
};

/**
 * MODE-SCOPED LEDGER (execution-contract law): drop the ledger rows whose ROLE the request's
 * execution contract forbids.
 *
 * `completeRequirements` governs the rows the ENGINE adds, but the PLANNER can also propose a
 * requirement, and a plan for "retrieve one fresh observation" happily proposes "evidence that
 * weakens the leading view". Stripping only engine-added rows would leave the planner's
 * counterevidence row in place, where it still drives the capability floor, the coverage
 * assessment and the completion gate. A forbidden role is removed wherever it came from.
 */
export function dropForbiddenRequirementRoles(
  requirements: readonly ResearchRequirement[],
  forbiddenRoles: readonly RequirementRole[],
): readonly ResearchRequirement[] {
  if (forbiddenRoles.length === 0) return requirements;
  const blocked = new Set(forbiddenRoles);
  return requirements.filter((r) => !blocked.has(r.role));
}

/**
 * Complete the ledger against the question's decision type: every missing engine-required
 * dimension is ADDED (never downgraded, never silently dropped), and every ANALYTIC question
 * gets a CHALLENGE requirement so disconfirmation cannot be skipped. A raw observation request
 * gets its measurement dimension only. Returns the ledger in a stable order: model
 * requirements first, then engine-added dimensions.
 */
export function completeRequirements(
  question: string,
  requirements: readonly ResearchRequirement[],
  opts: {
    readonly subject?: string;
    readonly marketClass?: SubjectMarketClass;
    /**
     * CHALLENGE SCOPE (question-type integrity): disconfirmation is required for a question
     * that ASKS for a conclusion to be tested (falsification, thesis hold, causal explanation,
     * comparison, synthesis of a view) and must NOT be injected into a raw observation or
     * historical-analogue request. It previously attached a CRITICAL counterevidence row to
     * EVERY question, which is what made "retrieve one fresh Bitcoin spot-price observation"
     * acquire falsification requirements and a FALSIFICATION round. Defaults to the earned
     * rule; pass an explicit boolean only when the caller knows better.
     */
    readonly challengeRequired?: boolean;
    /**
     * FLOW ISOLATION (the authority hierarchy): the flow the router already RESOLVED.
     *
     * When a canonical flow is supplied it OWNS this ledger. Its contract decides the question
     * type, whether a challenge is earned and whether materiality is owed — and every
     * engine-required dimension is filtered to the flow's grants BEFORE it is added. Without
     * this, `selectedFlow -> generic classifier -> global ledger` meant a WHAT_HAPPENED run was
     * completed from the CAUSAL question type and acquired drivers, mechanism, transmission
     * and counterevidence rows the trader had forbidden in writing.
     *
     * Omit it (or pass a non-canonical marker) and the classifier decides, which is the correct
     * fallback for research that belongs to no flow.
     */
    readonly flow?: string;
  } = {},
): readonly ResearchRequirement[] {
  const subject = (opts.subject ?? "the subject").trim();
  const marketClass = opts.marketClass ?? "UNKNOWN";
  // FLOW OWNERSHIP: a flow that PINS its question type overrides the heuristic classifier; a
  // flow that pins none leaves the classifier's specificity intact and is enforced through its
  // `grants` instead (which is what a broad synthesis flow needs — it spans macro, comparison
  // and earnings questions, and pinning one type for all of them would discard dimensions the
  // flow legitimately owns).
  const contract = contractFor(opts.flow);
  const questionType = contract?.pinnedQuestionType ?? questionTypeOf(question);
  // MULTI-MODE CHAINING (modes.ts): a compound question legitimately invokes several modes
  // ("why did BTC fall, and does my thesis hold?"). Every chained mode contributes its
  // engine-required dimensions and its granted dimensions, so the run acquires the UNION the
  // trader actually asked for instead of only the primary mode's slice. Detection is
  // deterministic and conjunction-gated, so an ordinary single-mode question is untouched.
  const chainFlows = contract !== undefined ? chainedFlowsOf(question) : [];
  const chainContracts = chainFlows
    .map((flow) => contractFor(flow))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const chainedQuestionTypes: readonly QuestionType[] = chainContracts.map(
    (c) => c.pinnedQuestionType ?? c.questionType,
  );
  const modeTypes: readonly QuestionType[] = [...new Set<QuestionType>([questionType, ...chainedQuestionTypes])];
  const specs: EngineRequirementSpec[] = [];
  for (const type of modeTypes) {
    for (const spec of ENGINE_REQUIRED[type]) {
      if (spec.markets !== undefined && !spec.markets.includes(marketClass)) continue;
      specs.push(spec);
    }
  }
  // FLOW-OWNED EVIDENCE: a resolved flow adds the observations its OWN methodology needs. This
  // is the step that makes "what happened over 24 hours" retrieve a price timeline instead of
  // whatever headlines happen to be available — the reproduction's evidence failure.
  if (contract !== undefined) {
    for (const spec of FLOW_REQUIRED_EVIDENCE[contract.flow] ?? []) {
      if (spec.markets !== undefined && !spec.markets.includes(marketClass)) continue;
      specs.push(spec);
    }
  }
  // OBSERVATIONAL FIELD ROWS (research-integrity contract): when the question itself ENUMERATES
  // the data it wants ("the observed high, low, opening/reference price, closing/current price,
  // timestamps, and volume"), the engine owes one CRITICAL row per named shape instead of one
  // generic "current value" row. This is what makes the gap report name the missing shapes, and
  // it is derived from the QUESTION's wording — never from what any provider happened to return.
  //
  // The single generic observation row is RETAINED below: a question that enumerates shapes
  // still genuinely wants a current reading of its subject, and dropping it would weaken the
  // ledger rather than sharpen it.
  const observationalSpecs =
    contract?.flow === "WHAT_HAPPENED" || modeTypes.includes("OBSERVATION")
      ? observationalFieldSpecs(question, subject)
      : [];
  // CHALLENGE is required only where the question asks for a conclusion to be tested.
  // The FLOW decides this when one is resolved: WHAT_HAPPENED owes no counterevidence row.
  // A CHAINED mode that owes disconfirmation makes the run owe it too: a causal leg inside a
  // compound question still needs its counterevidence attempt.
  const modeOwesCounterevidence = contract !== undefined
    ? contract.requiresCounterevidence || chainContracts.some((c) => c.requiresCounterevidence)
    : challengeEarnedBy(questionType);
  const challengeRequired = contract !== undefined
    ? modeOwesCounterevidence && (opts.challengeRequired ?? true)
    : (opts.challengeRequired ?? challengeEarnedBy(questionType));
  if (challengeRequired) {
    specs.push({
      description: () => "evidence that weakens or contradicts the leading conclusion (counterevidence)",
      role: "CHALLENGE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      // MC-4: counterevidence is DISCONFIRMING evidence. Ordinary supporting news is not in the
      // admissible set, so a headline that merely names the subject can never stand in for
      // counterevidence; the row is answered only by evidence that votes against the reading.
      evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK"],
      covers: /contradict|weaken|oppos|counter.?evidence|disconfirm|falsif|downside|against/i,
    });
  }

  const out: ResearchRequirement[] = decomposeFieldRequirements(requirements);

  for (const spec of observationalSpecs) {
    const description = spec.description(subject);
    const covered = out.some((r) => r.role === spec.role && spec.covers.test(r.description));
    if (covered) continue;
    const domains = domainsOfRequirement(description);
    out.push({
      id: requirementId(out.length),
      description,
      importance: spec.importance,
      role: spec.role,
      timeSensitivity: spec.timeSensitivity,
      domains: domains.length > 0 ? domains : (["PRICE_MARKET"] as const),
      status: "PENDING",
      evidenceRefs: [],
      staleOnlyRefs: [],
      recoveryAttempts: 0,
      engineRequired: true,
      evidenceClasses: [...spec.evidenceClasses],
      ...(spec.dataFacets !== undefined ? { dataFacets: [...spec.dataFacets] } : {}),
      ...(spec.resolution !== undefined ? { resolution: spec.resolution } : {}),
      ...(requestedWindowHours(question) !== undefined ? { windowHours: requestedWindowHours(question)! } : {}),
      retrievalObjective: retrievalObjectiveFor(description, spec.timeSensitivity, spec.role),
    });
  }
  for (const spec of specs) {
    // Coverage of a dimension requires the SAME ROLE, not only overlapping vocabulary: a CORE
    // requirement worded "...supports the thesis that NVDA is weakening" must not be mistaken
    // for the CHALLENGE dimension just because it contains "weakening". Role is what the
    // completion law acts on, so role is what decides whether the dimension is already asked.
    const covered = out.some((r) => r.role === spec.role && spec.covers.test(r.description));
    if (covered) continue;
    const description = spec.description(subject);
    const domains = domainsOfRequirement(description);
    out.push({
      id: requirementId(out.length),
      description,
      importance: spec.importance,
      role: spec.role,
      timeSensitivity: spec.timeSensitivity,
      domains: domains.length > 0 ? domains : (["GENERAL"] as const),
      status: "PENDING",
      evidenceRefs: [],
      staleOnlyRefs: [],
      recoveryAttempts: 0,
      engineRequired: true,
      ...(spec.calculation !== undefined ? { calculation: spec.calculation } : {}),
      ...(spec.resolution !== undefined ? { resolution: spec.resolution } : {}),
      evidenceClasses: [...spec.evidenceClasses],
      retrievalObjective: retrievalObjectiveFor(description, spec.timeSensitivity, spec.role),
    });
  }
  
    // TRANSMISSION TARGETS (research contract §3): whenever the question's own wording names
    // causal links ("how did oil transmit through inflation, yields and risk assets"), each
    // named target is a CRITICAL requirement with the target as its declared subject scope, so
    // the subject gate admits evidence about the link target (the question names it) while the
    // generic anti-contamination gates stay fully in force. Gated on the PRESENCE of
    // transmission wording, not on the question's overall type: a question can ask what drove
    // oil AND how it transmitted ("macro regime" wording classifies it as MACRO_REGIME, and
    // the transmission leg is still explicit and required).
    const links = causalLinksOf(question, subject !== "the subject" ? subject : undefined);
    // ONE ARROW PER LINK, ALWAYS ITS OWN ROW. An arrow is never attached to a dimension/node row:
    // inherited coverage made "the inflation regime was observed" read as "the oil move
    // transmitted into inflation". The row's own admission law (relationship evidence) is what
    // keeps endpoint coverage from becoming transmission coverage.
    const seenTargets = new Set<string>();
    for (const link of links) {
      if (seenTargets.has(link.target)) continue;
      seenTargets.add(link.target);
      // The wording carries the DATA TYPE the requirement needs (transmission/relationship),
      // so capability ranking schedules a capability that can actually return it instead of a
      // generic endpoint feed. The description states the LINK'S OWN source fold, never the
      // question's resolved subject: the transmission clause's head can name a market other
      // than the instrument ("How does inflation transmit into Treasury yields?" where the
      // instrument side resolved to Treasury yields) — describing the arrow as "the move in
      // Treasury yields reached Treasury yields" sent retrieval after the wrong transmission.
      const sourceLabel = targetLabel(link.source);
      const description = `transmission evidence for how the move in ${sourceLabel} reached ${targetLabel(link.target)}`;
      const domains = domainsOfRequirement(description);
      out.push({
        id: requirementId(out.length),
        description,
        importance: "CRITICAL",
        role: "CORE",
        timeSensitivity: "CURRENT",
        domains: domains.length > 0 ? domains : (["GENERAL"] as const),
        status: "PENDING",
        evidenceRefs: [],
        staleOnlyRefs: [],
        recoveryAttempts: 0,
        engineRequired: true,
        relationshipType: "TRANSMISSION",
        relationshipSource: link.source,
        // RELATIONSHIP EVIDENCE CLASSES ONLY: an endpoint observation (a price quote, a macro
        // print, a dimension headline) can never be admitted through a declared class here.
        evidenceClasses: [...RELATIONSHIP_EVIDENCE_CLASSES],
        targetTerms: [link.target],
        retrievalObjective: retrievalObjectiveFor(description, "CURRENT", "CORE"),
      });
    }
    if (links.length > 0) {

      // ALTERNATIVE EXPLANATIONS (research contract §8): a transmission question is only answered
      // honestly if a materially plausible competing explanation for the same observations is
      // represented. Non-blocking unless the question explicitly asks whether the explanation
      // could be something else — then it is a CORE decision dimension, not a footnote.
      const wantsAlternatives = asksForAlternatives(question);
      if (!out.some((r) => /alternativ\w*|competing|other (?:driver|explanation|factor)/i.test(r.description))) {
        // The default subject already carries its article ("the subject"); a resolved instrument
        // does not, so the article is added here exactly once (live: "for the the subject move").
        const subjectPhrase = /^the /.test(subject) ? subject : `the ${subject}`;
        const description = `material alternative explanations for ${subjectPhrase} move and for the transmission links (competing drivers that could account for the same observations)`;
        const domains = domainsOfRequirement(description);
        out.push({
          id: requirementId(out.length),
          description,
          importance: wantsAlternatives ? "CRITICAL" : "SUPPORTING",
          role: wantsAlternatives ? "CORE" : "SUPPORTING",
          timeSensitivity: "CURRENT",
          domains: domains.length > 0 ? domains : (["GENERAL"] as const),
          status: "PENDING",
          evidenceRefs: [],
          staleOnlyRefs: [],
          recoveryAttempts: 0,
          engineRequired: true,
          relationshipType: "DRIVER",
          evidenceClasses: ["NEWS", "ANALYSIS", "DRIVER", "CATALYST", "POLICY"],
          retrievalObjective: retrievalObjectiveFor(description, "CURRENT", wantsAlternatives ? "CORE" : "SUPPORTING"),
        });
      }
    }

    // CAUSAL CHAIN REQUIREMENTS (research contract): for CAUSAL questions, add requirements
    // that represent the causal chain structure. This ensures the engine retrieves evidence
    // for each link in the chain, not just the observation.
    if (modeTypes.includes("CAUSAL")) {
      const chainSeeds = causalChainRequirements(question, subject);
      const existingCoreRoles = new Set(out.filter((r) => r.role === "CORE").map((r) => r.role));
      const existingCoreEvidenceClasses = new Set(
        out.filter((r) => r.role === "CORE").flatMap((r) => r.evidenceClasses ?? []),
      );
      for (const seed of chainSeeds) {
        const seedRole = seed.role ?? "CORE";
        const seedEvidenceClasses = new Set(seed.evidenceClasses ?? []);

        // Check if this dimension is already covered:
        // 1. Same role + description text overlap (original check)
        const textCovered = out.some((r) =>
          r.role === seedRole &&
          seed.description.includes(r.description.slice(0, 20)),
        );
        if (textCovered) continue;

        // 2. Same-ROLE + same-RELATIONSHIP overlap: the chain seeds describe dimensions in the
        // loop's own vocabulary ("counter-evidence that would weaken the leading explanation",
        // relationshipType COUNTER_EVIDENCE), while completeRequirements already added the
        // generic CHALLENGE dimension ("evidence that weakens or contradicts ...",
        // relationshipType unset). They are the SAME decision dimension in different words, and
        // treating them as two requirements manufactured a permanently-PENDING CRITICAL row that
        // blocked completion even when the challenge had executed and found evidence.
        const sameRoleAndRelationship = out.some(
          (r) => r.role === seedRole && seed.role !== undefined &&
            seed.relationshipType !== undefined && r.relationshipType === seed.relationshipType,
        );
        if (sameRoleAndRelationship) continue;

        // 2. For CORE DRIVER-type seeds: skip if existing CORE requirements already
        //    cover the same evidence class territory (e.g. supply/demand questions
        //    already have CORE requirements with SUPPLY/DEMAND/NEWS evidence classes).
        if (seedRole === "CORE" && seed.relationshipType === "DRIVER" && existingCoreRoles.has("CORE")) {
          const overlap = [...seedEvidenceClasses].filter((c) => existingCoreEvidenceClasses.has(c));
          // If more than half of this seed's evidence classes are already covered by
          // existing CORE requirements, the dimension is already served.
          if (seedEvidenceClasses.size > 0 && overlap.length >= Math.ceil(seedEvidenceClasses.size / 2)) {
            continue;
          }
        }

        const description = seed.description.trim();
        const domains = domainsOfRequirement(description);
        out.push({
          id: requirementId(out.length),
          description,
          importance: seed.importance ?? "CRITICAL",
          role: seedRole,
          timeSensitivity: seed.timeSensitivity ?? "CURRENT",
          domains: domains.length > 0 ? domains : (["GENERAL"] as const),
          status: "PENDING",
          evidenceRefs: [],
          staleOnlyRefs: [],
          recoveryAttempts: 0,
          engineRequired: true,
          ...(seed.relationshipType !== undefined ? { relationshipType: seed.relationshipType } : {}),
          ...(seed.evidenceClasses !== undefined ? { evidenceClasses: [...seed.evidenceClasses] } : {}),
          retrievalObjective: retrievalObjectiveFor(description, seed.timeSensitivity ?? "CURRENT", seedRole),
        });
      }
    }

    // WATCH-NEXT AS A DECISION DIMENSION (research contract §10): when the question explicitly
    // asks what to watch, the watchlist is a CORE requirement the research must ground — not a
    // generic indicator list generated after synthesis. The requirement's evidence is the
    // forward-looking conditions the retrieved evidence actually supports monitoring.
    if (asksWhatToWatchNext(question)) {
      const description = `forward-looking conditions and indicators to watch next, with what would confirm and what would weaken the current assessment`;
      const domains = domainsOfRequirement(description);
      out.push({
        id: requirementId(out.length),
        description,
        importance: "CRITICAL",
        role: "CORE",
        timeSensitivity: "CURRENT",
        domains: domains.length > 0 ? domains : (["GENERAL"] as const),
        status: "PENDING",
        evidenceRefs: [],
        staleOnlyRefs: [],
        recoveryAttempts: 0,
        engineRequired: true,
        relationshipType: "IMPLICATION",
        evidenceClasses: ["NEWS", "CATALYST", "EVENT", "POLICY", "PRICE", "MARKET_DATA"],
        retrievalObjective: retrievalObjectiveFor(description, "CURRENT", "CORE"),
      });
    }

    // FIELD DECOMPOSITION, LAST: after the engine has added its own rows, so the engine's
    // observational row is split on the same law as a planner's. Idempotent — an already
    // atomic row demands exactly one shape and passes through unchanged.
    out.splice(0, out.length, ...decomposeFieldRequirements(out));

    // FLOW ISOLATION: every row whose decision dimension the resolved flow does NOT GRANT is
    // refused HERE, at ledger construction — never stripped at the UI, where the trader would see
    // an answer that looks complete but was produced under a contract they refused in writing.
    // This runs LAST, after every row exists, so it covers the planner's proposed rows, the
    // engine's dimension specs, the transmission arrows, the challenge row and the watch-next
    // row. A filter placed before those were appended would have passed the WHAT_HAPPENED
    // reproduction tests while still handing the run causal rows.
    if (contract !== undefined) {
      // Every CHAINED mode grants its own dimensions too; the union is what the compound
      // question asks for, and the primary mode still owns the answer shape.
      const granted = new Set<string>([
        ...contract.grants,
        ...chainContracts.flatMap((c) => [...c.grants]),
      ]);
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const row = out[i];
        if (row === undefined || row.role === "CONTEXT") continue;
        const dimension = dimensionOfRequirement(row.description, row.role);
        if (dimension === undefined || granted.has(dimension)) continue;
        out.splice(i, 1);
      }
    }

    return out;
  }

/**
 * Fallback requirement derivation when the planner returned none: one requirement per plan
 * task, described by the task objective (the model's own words), so coverage is still
 * engine-assessed. Never invents domain knowledge beyond the task text.
 */
export function requirementsFromTasks(tasks: readonly { readonly objective: string; readonly capabilities: readonly string[] }[]): readonly ResearchRequirement[] {
  const seeds: RequirementSeed[] = tasks.map((task) => ({
    description: task.objective.trim() !== "" ? task.objective : `evidence for ${task.capabilities.join(", ")}`,
    importance: "CRITICAL",
    // A task-derived requirement can be served by the capability the task itself named (the
    // task's objective is often work vocabulary, not market vocabulary, so a purely
    // vocabulary-based match would leave the plan's own tasks forever unsatisfied).
    evidenceClasses: [...task.capabilities],
  }));
  if (seeds.length === 0) {
    return buildRequirements([{ description: "relevant evidence for the research question", importance: "CRITICAL", timeSensitivity: "ANY" }]);
  }
  return buildRequirements(seeds);
}

// ---------------------------------------------------------------------------
// Matching + coverage
// ---------------------------------------------------------------------------

export interface MatchOptions {
  /** Subject terms of the question (instrument/tickers). When set, items must concern them. */
  readonly subjectTerms?: ReadonlySet<string>;
  /**
   * SEMANTIC SUBJECT GATE (no-instrument ≠ no-subject): the question's abstract market class
   * derived from its own wording (MACRO, RATES, COMMODITY, …). When set and not CRYPTO, an
   * observation whose vocabulary is crypto-native is not ABOUT the question and cannot
   * satisfy its requirements — a provider returning abundant crypto data must not define the
   * target of a broad macro question merely because no instrument resolved to gate it.
   * A MACRO question that explicitly names Bitcoin keeps matching (its own wording puts it
   * in the CRYPTO class or names BTC as a subject term), so this is a property of the
   * QUESTION's domain, never a forbidden-provider list.
   */
  readonly questionMarketClass?: SubjectMarketClass;
  /**
   * TRANSMISSION-LINK TARGETS the question explicitly names (research contract §3): evidence
   * about a named link target is admitted like subject evidence (the question asked for it),
   * while everything else stays gated. Parsed from the question's transmission wording —
   * never a domain whitelist.
   */
  readonly admittedTargets?: ReadonlySet<string>;
  readonly now?: Date;
}

export type MatchResult = "SATISFIES" | "STALE_ONLY" | "NO_MATCH";

/**
 * Whether the requirement ITSELF names a crypto party — a declared link target, a crypto
 * evidence class, or a description that folds onto the shared crypto vocabulary.
 *
 * The semantic domain gate exists to stop a crypto provider from defining a NON-crypto
 * question. It must never suppress the crypto evidence a question explicitly asked about:
 * live benchmark F2 ("How could a stronger dollar affect crypto and emerging markets?") had
 * its CRYPTO arrow row reported EXHAUSTED because the crypto-native item was rejected for a
 * question that named crypto as the affected party. The question's own wording is the licence.
 */
function requirementDeclaresCryptoParty(req: ResearchRequirement): boolean {
  if ((req.evidenceClasses ?? []).some((c) => CRYPTO_REQUIREMENT_CLASSES.has(c.toUpperCase()))) {
    return true;
  }
  if ([...admittedTargetsOf(req)].some((t) => CRYPTO_REQUIREMENT_CLASSES.has(t))) return true;
  return foldMention(req.description).has("CRYPTO");
}

/**
 * Which link targets (if any) does this requirement admit through the subject gate? A
 * transmission requirement admits evidence concerning its own declared targets; all other
 * requirements admit none, so the exemption is exactly as wide as the question's wording.
 */
export function admittedTargetsOf(
  req: Pick<ResearchRequirement, "targetTerms">,
): ReadonlySet<string> {
  const targets = [...(req.targetTerms ?? [])];
  if (targets.length === 0) return new Set<string>();
  return new Set(targets.map((t) => t.toUpperCase()));
}

/**
 * RELATIONSHIP EVIDENCE VOCABULARY (shared market language, not a question list):
 *
 * - `RELATIONSHIP_EVIDENCE_CLASSES` — evidence-type/class names that declare the observation is
 *   ABOUT a relationship between markets (a cross-domain/pass-through analysis) rather than a
 *   single market. Provider lineage carries this: a cross-domain synthesis capability's output is
 *   relationship evidence by construction.
 * - `RELATIONSHIP_MARKERS` — the language an observation uses when it actually states a
 *   transmission/association between markets ("fed into", "passed through", "weighed on",
 *   "co-movement"). A price quote, a CPI print or a dimension headline matches none of them.
 *
 * Both are domain-agnostic: they name relationship grammar, never a market. `oil -> inflation`,
 * `inflation -> rates`, `rates -> risk assets` and any unseen chain use the same law.
 */
const RELATIONSHIP_EVIDENCE_CLASSES: readonly string[] = [
  "TRANSMISSION", "RELATIONSHIP", "CROSS_DOMAIN", "CROSS_ASSET", "SPILLOVER", "PASS_THROUGH", "MECHANISM",
];

const RELATIONSHIP_MARKERS: readonly RegExp[] = [
  /\btransmi(?:t|ts|tted|tting|ssion)\b/i,
  /\bpass(?:ed|es|ing)?\s*(?:-|\s)?through\b/i,
  /\bspill(?:s|ed|ing)?\s*over\b/i,
  /\b(?:fed|feeds|flow(?:s|ed|ing)?)\s+(?:in)?to\b/i,
  /\brippl(?:e|es|ed|ing)\b/i,
  /\bknock[- ]on\b/i,
  /\bcontribut(?:e|es|ed|ing)\s+to\b/i,
  /\b(?:dr(?:ove|ives|iven|iving)|push(?:ed|es|ing)?|lift(?:ed|s|ing)?|drag(?:ged|s|ing)?|weigh(?:ed|s|ing)?|pressure(?:d|s|ing)?|boost(?:ed|s|ing)?|sap(?:ped|s|ing)?|erode(?:d|s|ing)?|amplif(?:ied|ies|ying)|compress(?:ed|es|ing)?|translat(?:ed|es|ing))\b/i,
  /\b(?:because of|due to|on the back of|as a result of|in response to|attributed to|thanks to|owing to)\b/i,
  /\b(?:channel|mechanism|pass-?through|transmission|relationship|correlat(?:ion|ed)|co-?movement|co-?moved|coincided|alongside)\b/i,
  /\b(?:linked to|tied to|track(?:s|ed|ing)?|follo(?:wed|wing)|mirror(?:s|ed|ing)?|tracking)\b/i,
];

/**
 * Does this item carry evidence about a RELATIONSHIP between markets? True when the observation
 * declares a relationship evidence class/type (provider lineage) or states a transmission/
 * association in its own language. Deliberately narrow: evidence about one endpoint market —
 * however strong — is a NODE observation and returns false here.
 */
export function isRelationshipEvidence(item: Pick<CoverageEvidence, "text" | "evidenceType" | "subject">): boolean {
  const lineage = String(item.evidenceType ?? "").toUpperCase();
  if (RELATIONSHIP_EVIDENCE_CLASSES.some((c) => lineage.includes(c))) return true;
  const text = `${item.text} ${item.subject ?? ""}`;
  return RELATIONSHIP_MARKERS.some((m) => m.test(text));
}

/**
 * Canonical market folds an observation's text can be attributed to (for target admission):
 * the observation's own tokens folded through the shared concept vocabulary. A yield quote
 * folds to RATES, an inflation print to INFLATION.
 */
function foldsOfText(text: string): ReadonlySet<string> {
  return foldMention(text, 3);
}

/**
 * Folds that name an ATTRIBUTE of a market rather than a market itself. "Higher oil prices"
 * mentions oil AND the word prices; only oil is a party to a transmission link, so attribute
 * folds are never link sources or targets.
 */
const NON_MARKET_FOLDS: ReadonlySet<string> = new Set(["PRICE", "QUOTE", "HISTORICAL"]);

/** Fold a phrase onto the shared market vocabulary, dropping attribute words and short tokens. */
function foldMention(text: string, minLength = 1): Set<string> {
  const folds = new Set<string>();
  for (const raw of text.toUpperCase().split(/[^A-Z]+/)) {
    if (raw.length < minLength) continue;
    const folded = TRANSMISSION_TARGET_FOLDS[raw] ?? CONCEPT_SYNONYMS[raw];
    if (folded !== undefined && !NON_MARKET_FOLDS.has(folded)) folds.add(folded);
  }
  return folds;
}

/**
 * Does the item concern an ADMITTED transmission target (question-named)? At least one of
 * the item's market folds must be a target the question's transmission wording named.
 */
export function concernsAdmittedTarget(itemText: string, admittedTargets: ReadonlySet<string>): boolean {
  if (admittedTargets.size === 0) return false;
  for (const fold of foldsOfText(itemText)) if (admittedTargets.has(fold)) return true;
  return false;
}

/**
 * ECONOMIC SERIES -> the vocabulary their observations are reported in. A series CODE is how a
 * question names its subject (UNRATE for the labor market, CPI for prices) while providers
 * report the same series in its own words ("labor breadth", "jobless claims", "inflation
 * elevated"): the subject gate compares literal terms, so without this every observation for an
 * economic-series question was rejected at ingestion, the run collected zero evidence and
 * reported NOT_ANSWERED for a question that had perfectly relevant macro evidence in hand.
 * Concept equivalence - a fact about how these series are written about - never a question
 * keyword list: nothing here mentions any question, scenario or asset beyond the series code
 * the question itself resolved to.
 */
const SERIES_SUBJECT_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  UNRATE: ["UNEMPLOYMENT", "LABOR", "LABOUR", "JOBS", "JOBLESS", "PAYROLL", "PAYROLLS", "CLAIMS", "EMPLOYMENT"],
  CPI: ["INFLATION", "PRICES", "PRICE"],
  PPI: ["INFLATION", "PRICES", "PRICE"],
  GDP: ["GROWTH", "RECESSION"],
};

/**
 * Whole-word subject check shared with the context gate (quote pairs included). Exported so
 * the research loop can apply it at INGESTION: wrong-target provider output must not become
 * this run's evidence at all (the context gate remains as defense in depth).
 */
export function concernsSubject(text: string, subjectTerms: ReadonlySet<string>): boolean {
  const upper = text.toUpperCase();
  const tokens = new Set(upper.split(/[^A-Z0-9]+/).filter((t) => t !== ""));
  for (const term of subjectTerms) {
    if (tokens.has(term)) return true;
    for (const suffix of ["USDT", "USD", "USDC", "PERP"]) if (tokens.has(`${term}${suffix}`)) return true;
    // INSTRUMENT-SHAPED TERMS (^TNX, CL=F, DX-Y.NYB, EURUSD=X): the tokenizer above strips
    // punctuation, so a resolved canonical instrument could NEVER match provider text and its
    // evidence was rejected at ingestion (a rates question resolved to ^TNX lost every yield
    // observation). Compare the punctuation-free form, and the term's own token parts (all of
    // them, at least one substantive), so the canonical forms of an instrument count as the
    // same subject as the text providers write.
    if (/[^A-Z0-9]/.test(term)) {
      const squashed = term.replace(/[^A-Z0-9]+/g, "");
      if (tokens.has(squashed)) return true;
      const parts = term.split(/[^A-Z0-9]+/).filter((p) => p !== "");
      if (parts.some((p) => p.length >= 2) && parts.every((p) => tokens.has(p))) return true;
    }
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(upper)) return true;
    for (const concept of SERIES_SUBJECT_VOCABULARY[term] ?? []) {
      if (tokens.has(concept)) return true;
      if (new RegExp(`\\b${concept}\\b`).test(upper)) return true;
    }
  }
  return false;
}

/**
 * The shapes a requirement demands, after implication.
 *
 * An explicit declaration on the row is authoritative; otherwise the shapes are read from the
 * row's OWN wording, which is what lets a planner-authored requirement ("Retrieve Bitcoin price
 * sequence, high, low, and volume data for the last 24 hours.") be held to the contract without
 * the planner having to learn a new schema. A row that names no shape demands nothing.
 */
/** Source kinds that make an item a CLAIM about the world rather than an observation of it. */
function isReportingSourceType(
  sourceType: "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS" | undefined,
): boolean {
  return sourceType === "SECONDARY" || sourceType === "COMMUNITY" || sourceType === "ANALYSIS";
}

/**
 * EVIDENCE CLASSES THAT ADMIT A REPORTED CLAIM (MC-3).
 *
 * A requirement whose declared admissible classes include one of these can legitimately be
 * answered by reporting (a driver, a catalyst, a forward risk, a thesis-supporting development).
 * A requirement whose declared classes are ALL observational (price/OHLCV/macro/rate/volume/...)
 * may not: a headline is a claim ABOUT the market, never a measurement OF it.
 */
const REPORTED_ADMITTING_CLASSES: ReadonlySet<string> = new Set([
  "NEWS", "HEADLINE", "ARTICLE", "PRESS", "RSS", "ANNOUNCEMENT", "EVENT", "REPORTED_EVENT",
  "REPORT", "SECONDARY", "COMMUNITY", "DEVELOPMENT", "CATALYST", "DRIVER", "NARRATIVE",
  // Analytic dimensions are REPORTED or DERIVED by construction: a transmission link, a
  // mechanism, a synthesis or an implication is an analysis of the world, and reporting is
  // exactly the evidence that establishes it. Only purely observational dimensions (price, OHLCV,
  // volume, macro levels, historical series) are closed to news.
  "TRANSMISSION", "RELATIONSHIP", "CROSS_DOMAIN", "CROSS_ASSET", "SPILLOVER", "PASS_THROUGH",
  "MECHANISM", "ANALYSIS", "IMPLICATION",
]);

/**
 * REPORTED EVIDENCE EXCLUSIVITY (MC-3): a reported claim cannot satisfy an engine dimension
 * whose declared admissible classes are purely observational.
 *
 * The subject-name overlap defect: a news headline naming the asset satisfied a quantitative
 * market-data row through vocabulary alone ("Bitcoin" appears on both sides). Subject overlap is
 * an ADMISSION fact — is this about my subject? — and never a coverage proof. A row that declares
 * only measurement classes is served only by measurement evidence. Analytic dimensions
 * (drivers, forward factors, thesis support) declare a reported class and are untouched, so
 * this law narrows nothing the question legitimately asked for.
 */
function admitsReportedEvidence(classes: readonly string[]): boolean {
  return classes.some((c) => REPORTED_ADMITTING_CLASSES.has(c.toUpperCase()));
}

/**
 * Is this coverage item a REPORTED NEWS claim rather than an observation?
 *
 * The NEWS DOMAIN is the signal (the evidence layer tagged this item as news/headline material).
 * The conservative source-kind default is deliberately NOT used: a textual FACTUAL payload with
 * no declared source class defaults to SECONDARY, and treating that default as "this is a
 * headline" would demote genuine quantitative feeds that simply did not declare a class. The
 * property the law needs is what the item IS (its class), decided by the ingestion boundary.
 */
function isNewsClaim(itemDomain: EvidenceDomain): boolean {
  return itemDomain === "NEWS";
}

/**
 * The shapes a requirement demands, after implication.
 */
export function requiredFacetsOf(req: Pick<ResearchRequirement, "dataFacets" | "description" | "engineRequired">): ReadonlySet<DataFacet> {
  const declared = req.dataFacets;
  if (declared !== undefined) return impliedFacets(new Set<DataFacet>(declared));
  // ENGINE ROWS MUST DECLARE. An engine dimension's wording describes the DECISION it serves,
  // not a data shape to retrieve: "the explicit period over period change for X (price, volume
  // and range) as a calculated comparison" is a CALCULATION the engine computes from other
  // evidence, and letting the word "volume" turn it into a demand for a retrieved volume series
  // would have made a correct comparison run unsatisfiable. Only a planner-authored row has its
  // shapes read from its own wording, and an engine row opts in by declaring them.
  if (req.engineRequired === true) return new Set<DataFacet>();
  return impliedFacets(new Set<DataFacet>(facetsOfRequirementText(req.description)));
}

/** The window a requirement asks for, in hours; an explicit declaration wins over wording. */
export function requirementWindowHours(req: Pick<ResearchRequirement, "windowHours" | "description">): number | undefined {
  return req.windowHours ?? requestedWindowHours(req.description);
}

/** Metric shapes a CURRENT market-data ask is made of (price/high/low/volume family).
 *  TIMESTAMP/WINDOW are included: the atomic observation-time row of a current-window price
 *  requirement is itself a current-data row (its staleness is the same staleness). */
const CURRENT_METRIC_FACETS: ReadonlySet<DataFacet> = new Set([
  "SNAPSHOT", "HIGH", "LOW", "VOLUME", "AGGREGATE_VOLUME", "OPEN", "CLOSE", "OHLC", "TIMESTAMP", "WINDOW",
]);
const CURRENT_METRIC_WORDS = /\b(?:current|latest|today(?:'s)?|24[- ]?hour(?:ly)?|24h|intraday)\b[^.?!]{0,40}\b(?:price|high|low|volume|candles?|observation)s?\b|\b(?:price|high|low|volume)\b[^.?!]{0,30}\b(?:today|now|currently|24)\b/i;

/**
 * CURRENT-DATA METRIC ROW (fail-fast contract): a mandatory row that asks for current-window
 * market metrics (current price, today's high/low, 24h volume) — the rows a simple market-data
 * query either satisfies or provably cannot. When every blocking row is one of these and the
 * run's registered market-data paths are spent, waiting out the rest of the budget cannot help;
 * the loop must stop and name the gap instead of burning minutes on inadequate evidence.
 */
export function isCurrentWindowMetricRow(req: ResearchRequirement): boolean {
  const hours = requirementWindowHours(req);
  if (hours === undefined || hours > 48) return false;
  const facets = requiredFacetsOf(req);
  if (facets.size === 0) return CURRENT_METRIC_WORDS.test(req.description);
  for (const facet of facets) if (CURRENT_METRIC_FACETS.has(facet)) return true;
  return false;
}

/**
 * The resolution a requirement demands, when it demands one; an explicit declaration wins over
 * wording. Undefined means the requirement names no granularity and is not gated on it.
 */
export function requiredResolutionOf(
  req: Pick<ResearchRequirement, "resolution" | "description">,
): Resolution | undefined {
  return req.resolution ?? namedResolutionOf(req.description);
}

/** Is the observation fresh enough for this requirement's time sensitivity? */
export function freshnessSufficient(req: Pick<ResearchRequirement, "timeSensitivity" | "description">, item: CoverageEvidence, now: Date): boolean {
  if (req.timeSensitivity === "ANY") return true;
  const tag = (item.freshness ?? "").toUpperCase();
  if (req.timeSensitivity === "HISTORICAL") {
    // The freshness law's mirror: a HISTORICAL requirement ("has this happened before") is
    // not satisfied by today's live observation. It needs material tagged historical or an
    // observation older than a year; a live quote answering it is stale-only at best.
    if (tag === "HISTORICAL" || tag === "STALE") return true;
    const observedAt = item.observedAt !== undefined ? Date.parse(item.observedAt) : Number.NaN;
    return !Number.isNaN(observedAt) && (now.getTime() - observedAt) / DAY_MS > 365;
  }
  if (tag === "STALE" || tag === "HISTORICAL") return false; // a stale tag never satisfies a CURRENT/RECENT need
  if (item.observedAt !== undefined) {
    const observed = Date.parse(item.observedAt);
    if (!Number.isNaN(observed)) {
      const ageDays = (now.getTime() - observed) / DAY_MS;
      const base = req.timeSensitivity === "CURRENT" ? CURRENT_MAX_AGE_DAYS : RECENT_MAX_AGE_DAYS;
      // EXPLICIT WINDOW LAW (all evidence kinds): when the requirement's own wording names a
      // window — "today", "this week", "the last 48 hours" — that window bounds how old ANY
      // observation may be, not only event-dated headlines. Age and span are different axes:
      // a candle set from three weeks ago can SPAN 24 hours and still not answer "the last
      // 24 hours", exactly as a headline from three weeks ago does not answer "this week".
      // The window is read by the ONE temporal parser (temporal.ts), so every phrase it
      // understands is understood here — the former second phrase list saw only
      // today/this week/this month and bound only NEWS evidence. A requirement that names no
      // window keeps its base limit, which is what keeps a state ask ("current price")
      // satisfied by a fresh quote. min(): a named window can TIGHTEN the limit, never loosen it.
      const explicitHours = requestedWindowHours(req.description);
      const limit = explicitHours !== undefined ? Math.min(base, explicitHours / 24) : base;
      if (ageDays > limit) return false;
    }
  }
  return true;
}

/**
 * DRIVER-ADMISSION LAW (evidence type is not evidence content): a requirement that asks for
 * DRIVERS, CAUSES, REASONS or FACTORS may only be satisfied by evidence that itself carries
 * driver content — a causal marker or a named factor in a sentence BOUND TO THE TARGET.
 * Vocabulary overlap alone (the target's own ticker appearing in a quote, or a fresh news
 * item mentioning the target) is TARGET RELEVANCE, never TARGET DRIVER: "BTC is trading at
 * 86,000", "BTC RSI reads 38" and "Bitcoin rises as volume was light" never establish what
 * is driving BTC. Generic question-shape vocabulary only — no asset or question list; state
 * requirements ("current price level", "previous period performance") are untouched, and the
 * subject-name equivalence used below is entity vocabulary, not driver vocabulary.
 */
const DRIVER_REQUIREMENT_SHAPE =
  /\b(driv\w*|catalysts?|reasons?|explanations?|factors?|supply|demand|differentials?|pressur\w*|push\w*|behind)\b/i;

/** Sentence-level causal mechanisms (never bare price movement): cause, effect, attribution. */
const DRIVER_CAUSAL_MARKERS =
  /\b(driv\w*|drove|because of|due to|as a result|resulted in|led to|caused|causing|triggered|sparked|pushed|pushing|pressur\w*|weigh\w* on|fuell?ed|fuelling|fueling|stemming from|on the back of|in response to|attributed to|behind|transmit\w*|pass[- ]through)\b|\b(?:fell|drop\w*|rallied|rose|climbed|surged|plunged|tumbled|jumped|gained|slipped|declined|advanced|rebounded|revers\w*|spiked|slid)\b[^.?!]{0,40}\b(?:after|following)\b/i;

/**
 * Named factor vocabulary (flows, positioning, policy, supply/demand, macro prints, corporate
 * events): what drivers are MADE OF. Deliberately excludes price/state/technical vocabulary
 * (price, level, volume, RSI, MACD, % change) so target-state evidence can never qualify.
 */
const DRIVER_FACTOR_VOCABULARY =
  /\b(inflows?|outflows?|flows?|positioning|liquidations?|funding|leverage|shorts|longs|halvings?|forks?|hacks?|exploits?|airdrops?|unlocks?|whales?|reserves?|listings?|delistings?|approvals?|adoption|partnerships?|upgrades?|downgrades?|regulations?|regulators?|policy|tariffs?|sanctions?|elections?|geopolitics?|wars?|conflicts?|strikes?|shutdowns?|ceilings?|budgets?|issuance|opec|production|output|supply|demand|inventor\w*|shipments?|weather|earnings?|revenues?|guidance|margins?|deliver\w*|estimates?|forecasts?|rates?|yields?|inflation|cpi|ppi|payrolls?|pmi|recession|liquidity|dollar|central[- ]banks?|gdp|pce|unemployment)\b/i;

/** Does this requirement ask for driver/explanation content (vs state, timing, baseline...)? */
function asksForDriverEvidence(req: ResearchRequirement): boolean {
  if (req.relationshipType === "DRIVER") return true;
  return DRIVER_REQUIREMENT_SHAPE.test(req.description);
}

/**
 * Does the item itself carry driver content? SENTENCE-LEVEL binding: when the text mentions
 * the target, some single sentence must mention the target AND state a mechanism/factor — a
 * factor sentence about an unrelated subject beside a target sentence never counts. Structured
 * payloads that never spell the target (declared `about` only) are admitted on factor content
 * alone: a supply/inventory series IS factor data even when its JSON contains no asset name.
 */
function carriesDriverContent(item: CoverageEvidence, subjectTerms: ReadonlySet<string> | undefined): boolean {
  const declared = new Set<string>(
    (item.subject ?? "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 2),
  );
  const binding = expandSubjectTerms(new Set([...(subjectTerms ?? []), ...declared]));
  const textMentionsSubject = concernsSubject(item.text, binding);
  for (const sentence of sentencesOf(item.text)) {
    const subjectBound = !textMentionsSubject || concernsSubject(sentence, binding);
    if (subjectBound && (DRIVER_CAUSAL_MARKERS.test(sentence) || DRIVER_FACTOR_VOCABULARY.test(sentence))) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministic match: an item satisfies a requirement when it concerns the question's
 * subject (when one resolved) AND its domain or vocabulary overlaps the requirement AND it
 * is fresh enough for the requirement's time horizon. Freshness failure with everything else
 * matching is STALE_ONLY (valid background, never current satisfaction).
 */
export function matchRequirement(req: ResearchRequirement, item: CoverageEvidence, opts: MatchOptions = {}): MatchResult {
  const now = opts.now ?? new Date();
  const declaredSubject = item.subject ?? "";
  // TARGET-SCOPED SUBJECT GATE (research contract §3): a question-named transmission link
  // target counts as the question's subject for evidence about THAT target — the question
  // explicitly asked how its subject transmits into it. Everything else stays gated.
  // The requirement's OWN declared link targets are always admitted (the question named them);
  // a caller may add run-level targets on top. No caller-side wiring is required, so the
  // exemption cannot silently disappear if a gate forgets to pass it.
  const declaredTargets = admittedTargetsOf(req);
  const admittedTargets = new Set<string>([...(opts.admittedTargets ?? []), ...declaredTargets]);
  const concernsTarget = concernsAdmittedTarget(`${item.text} ${declaredSubject}`, admittedTargets);
  // NODE vs ARROW (research contract §3): an ARROW row (`targetTerms`) is ABOUT THE RELATIONSHIP.
  // Evidence about the question's subject — or about the link's target — establishes an ENDPOINT
  // NODE of the chain, never the arrow between them, so an arrow row admits only evidence that
  // itself concerns the link's target AND carries relationship evidence.
  const isArrowRow = (req.targetTerms ?? []).length > 0;
  if (opts.subjectTerms !== undefined && opts.subjectTerms.size > 0) {
    if (isArrowRow) {
      if (!concernsTarget) return "NO_MATCH";
    } else if (
      !concernsSubject(`${item.text} ${declaredSubject}`, opts.subjectTerms) &&
      !concernsTarget
    ) {
      return "NO_MATCH";
    }
  }
  const itemDomain = domainOfEvidenceType(item.evidenceType);
  // REPORTED EVIDENCE EXCLUSIVITY (MC-3): position AFTER the subject gates (a headline about a
  // different subject is already NO_MATCH) and BEFORE any vocabulary/class overlap so overlap can
  // never produce SATISFIES for a purely observational dimension. Engine dimensions are the ones
  // that carry declared admissible classes; a planner row keeps its own vocabulary law.
  if (
    req.engineRequired === true &&
    // QUANTITATIVE MARKET-DATA dimensions only: the acceptance law is about market data (a price
    // path, a high/low, a volume, a previous-period performance). Macro/analyst dimensions keep
    // their own class law, so a capability that legitimately reports a macro level is not demoted
    // by the tag on its envelope.
    req.domains.includes("PRICE_MARKET") &&
    req.evidenceClasses !== undefined &&
    req.evidenceClasses.length > 0 &&
    !admitsReportedEvidence(req.evidenceClasses) &&
    isNewsClaim(itemDomain)
  ) {
    return "NO_MATCH";
  }
  // SEMANTIC SUBJECT GATE (no-instrument ≠ no-subject): when the question derives an abstract
  // non-crypto domain, crypto-native observations are not about the question. The declared
  // subject counts as vocabulary too (a provider tags a BTC payload "BTC" without naming it
  // in text). A requirement that ITSELF declares crypto evidence classes is exempt — the
  // question asked for crypto evidence. Never a provider list: the item's own vocabulary
  // decides, and the question's wording decides the domain.
  if (
    opts.questionMarketClass !== undefined &&
    opts.questionMarketClass !== "UNKNOWN" &&
    opts.questionMarketClass !== "CRYPTO" &&
    !requirementDeclaresCryptoParty(req)
  ) {
    const itemVocab = `${item.text} ${declaredSubject}`.toUpperCase();
    const itemTokenSet2 = new Set(itemVocab.split(/[^A-Z0-9]+/));
    const cryptoNative = [...CRYPTO_DOMAIN_TOKENS].some((t) => itemTokenSet2.has(t)) || itemDomain === "ONCHAIN" || itemDomain === "DEFI";
    if (cryptoNative) return "NO_MATCH";
  }
  // DATA-SHAPE LAW (research-integrity contract): coverage is decided by what the observation
  // CONTAINS. This gate runs AFTER every relevance gate above (is this about my subject? is it
  // about the right domain?) and BEFORE vocabulary overlap can ever produce SATISFIES, because
  // overlap only ever answered "is this about the right thing" — never "does it contain what
  // was asked for".
  //
  // The reproduction: "Retrieve Bitcoin price sequence, high, low, and volume data for the last
  // 24 hours" was SATISFIED by a CoinGecko /simple/price snapshot. The only shared token was
  // BITCOIN. This gate is why the asset name is now an admission fact and never a coverage proof.
  //
  // Two checks, in this order:
  //  1. SHAPE: the observation must carry every shape the row demands. A row that demands no
  //     shape is untouched — drivers, thesis and counterevidence rows keep their own law.
  //  2. WINDOW: when the row asks for a window, the observation must actually SPAN it. Age and
  //     span are different axes: a snapshot one second old is fresh and spans zero hours.
  const demandedFacets = requiredFacetsOf(req);
  if (demandedFacets.size > 0) {
    const served = servedFacetsOf({
      text: item.text,
      ...(item.dataFacets !== undefined ? { dataFacets: item.dataFacets } : {}),
      // A REPORTING source kind marks a claim ABOUT the world. An UNKNOWN kind is not a claim:
      // "this item has no declared source type" must never silently demote a primary
      // quantitative feed that simply did not declare one.
      ...(isReportingSourceType(item.sourceType) ? { reported: true } : {}),
      newsDomain: itemDomain === "NEWS",
    });
    if (facetCoverage(demandedFacets, served) !== "FULL") return "NO_MATCH";
    // SPAN LAWS apply only to a row that actually asks for a window of data (a series, a
    // candle, a high/low/open/close, a volume series). A REPORTED_EVENT row asks for a dated
    // claim inside the window, and a claim has neither span nor granularity: gating it here
    // would make every news requirement unsatisfiable (the freshness law already governs it).
    if (demandsSpan(demandedFacets)) {
      const windowHours = req.windowHours ?? requestedWindowHours(req.description);
      if (windowHours !== undefined && !windowCovers(windowHours, item.coverageHours)) {
        return "NO_MATCH";
      }
      // GRANULARITY LAW (resolution.ts): when the row NAMES a resolution ("hourly", "daily"),
      // only evidence sampled at least that finely can establish it. Span and resolution are
      // separate axes: 24 hourly candles and 2 daily candles both reach 24 hours, and only the
      // first answers "the hourly price path". A row naming no resolution keeps its window law
      // and is untouched here.
      const requiredResolution = requiredResolutionOf(req);
      if (requiredResolution !== undefined && !resolutionCovers(requiredResolution, item.resolution)) {
        return "NO_MATCH";
      }
    }
  }
  // ARROW ADMISSION LAW (research contract §3): an arrow row has its OWN admission law and never
  // falls through to the dimension vocabulary/class paths. Endpoint coverage is not transmission
  // coverage — strong evidence for both endpoints must never make an unsupported arrow supported.
  //   SATISFIES when the item concerns the link target AND carries relationship evidence;
  //   STALE_ONLY when that relationship evidence is outside the requirement's time horizon.
  // Everything else is NO_MATCH, so the arrow stays PENDING until researched, EXHAUSTED after
  // bounded recovery, and never inherits a node row's refs.
  if (isArrowRow) {
    if (!concernsTarget) return "NO_MATCH";
    if (!isRelationshipEvidence(item)) return "NO_MATCH";
    return freshnessSufficient(req, item, now) ? "SATISFIES" : "STALE_ONLY";
  }
  const reqTokens = meaningfulTokens(req.description);
  // CURRENCY-UNIT GUARD (VALID ≠ RELEVANT): when the observation concerns a crypto asset the
  // question is NOT about (subject terms resolved but lacking it, or no subject resolved at
  // all), its fiat codes are price denominations, not dollar evidence — strip them so a
  // BTC/ETF quote cannot satisfy a macro requirement through the USD->DOLLAR fold.
  const itemTokenSet = new Set(item.text.toUpperCase().split(/[^A-Z0-9]+/));
  const questionSubjects = opts.subjectTerms ?? new Set<string>();
  const concernsForeignCrypto = [...FOREIGN_CRYPTO_ASSETS].some((t) => itemTokenSet.has(t) && !questionSubjects.has(t));
  // The item's domain label joins its vocabulary because it is a fact about the observation
  // itself ("this IS historical material"): that is what lets a historical-comparison
  // requirement meet the historical item while a live quote — whose folded label is
  // PRICE_MARKET — never does. Domain agreement as a match PATH still has its own clause below,
  // accepted only when the requirement carries no distinguishing vocabulary.
  const itemTokens = meaningfulTokens(`${item.text} ${itemDomain}`, { stripCurrencyUnits: concernsForeignCrypto });
  // DECLARED-SUBJECT ALIASES ARE THE SAME ENTITY: a provider tags an observation about
  // "Bitcoin" while the requirement says "BTC" (or the reverse). The declared subject's own
  // spellings join the item's vocabulary as ENTITY words — this only re-admits the same
  // subject under its other name; driver content is still decided by the sentence-level law
  // below, so a quote declared BTC can never satisfy a driver requirement this way.
  if (declaredSubject.trim() !== "") {
    const declaredTerms = expandSubjectTerms(
      new Set(declaredSubject.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 2)),
    );
    for (const alias of declaredTerms) itemTokens.add(canonicalToken(alias));
  }
  // SUBJECT IS THE ENTITY, NEVER THE CONTENT VOCABULARY — for ENGINE-DERIVED rows served by
  // quote evidence. The resolved subject is already the gate above: it says WHO the observation
  // is about. An engine row is phrased analytically ("the drivers behind X", "the supply
  // factors affecting X"), and a quote/series payload repeats the subject while carrying only
  // numbers — so subject overlap alone let a price snapshot satisfy the drivers requirement and
  // a quote satisfy the supply requirement (benchmark A / L / oil: a drivers question answered
  // with pure price data reported ANSWERED). Those rows must match on their own criterion — a
  // declared evidence class or their analytic vocabulary.
  // Against NON-quote evidence the engine row keeps the subject as vocabulary: an earnings-date
  // observation IS the event evidence a row asks for when nothing else was retrieved, and a
  // headline about the subject is content, not filler.
  // MODEL-DECLARED requirements always keep the subject word: their text carries the model's
  // own criterion ("current oil price movement this week", "price level of the dollar"), where
  // naming the subject is part of what was asked for, and the pinned target relevance law
  // requires subject-scoped evidence to satisfy them.
  const quoteEvidence = /(^|_)MARKET_DATA$/i.test(String(item.evidenceType ?? ""));
  if (req.engineRequired === true && quoteEvidence && opts.subjectTerms !== undefined) {
    // Expanded spellings too (BTC AND BITCOIN): otherwise the declared-alias union above
    // would hand the quote its subject back and re-open the very path this strip closes.
    for (const subject of expandSubjectTerms(opts.subjectTerms)) {
      reqTokens.delete(subject);
      itemTokens.delete(subject);
    }
  }
  // Vocabulary overlap is REQUIRED (a whole domain of observations cannot satisfy every
  // requirement in that domain: a yield quote is not inflation evidence). Domain agreement
  // is accepted only when the requirement itself has no distinguishing vocabulary left.
  let overlaps = false;
  for (const t of itemTokens) {
    if (reqTokens.has(t)) {
      overlaps = true;
      break;
    }
  }
  if (!overlaps && reqTokens.size === 0 && req.domains.includes(itemDomain)) overlaps = true;
  // DECLARED EVIDENCE CLASSES (engine-inferred dimensions only, subject-scoped items only):
  // an engine requirement phrased analytically ("the drivers behind X") can never share
  // vocabulary with a headline; it is served by an item of a CLASS the requirement declares
  // (news/driver, OHLCV, calendar, macro observation), which must still pass the subject,
  // temporal and freshness gates. Model-authored requirements keep the strict vocabulary rule,
  // so a technically-valid but irrelevant observation still cannot satisfy them.
  if (
    !overlaps &&
    req.engineRequired === true &&
    req.evidenceClasses !== undefined &&
    opts.subjectTerms !== undefined &&
    opts.subjectTerms.size > 0 &&
    req.evidenceClasses.some((c) => itemTokens.has(canonicalToken(c)) || canonicalToken(c) === itemDomain)
  ) {
    overlaps = true;
  }
  // CAPABILITY-DERIVED EVIDENCE CLASS (task-derived requirements only): requirements derived
  // from the plan's own tasks describe the work, not the subject ("define the move", "collect
  // developments"), and the task already NAMED its capability — so an observation produced by
  // that same capability for this run is exactly the evidence the task asked for. The
  // requirement's declared domain still applies when it is non-GENERAL (a task scoped to NEWS
  // cannot be satisfied by an unrelated observation class), and subject/freshness gates above
  // always apply. Model-authored requirements with their own vocabulary and engine-required
  // dimensions with their own class declarations keep the strict rules, so an irrelevant
  // observation cannot satisfy them through a source label.
  if (
    !overlaps &&
    req.engineRequired !== true &&
    req.evidenceClasses !== undefined &&
    req.evidenceClasses.length > 0 &&
    req.evidenceClasses.some(
      (c) => canonicalToken(c) === itemDomain || canonicalToken(c) === canonicalToken(String(item.evidenceType ?? "")),
    ) &&
    (req.domains.includes(itemDomain) || (req.domains.length === 1 && req.domains[0] === "GENERAL"))
  ) {
    overlaps = true;
  }
  if (!overlaps) return "NO_MATCH";
  // DRIVER ADMISSION: overlapping vocabulary proves the item is ABOUT the target's driver
  // question — only sentence-level mechanism/factor content proves it IS driver evidence.
  // Placed before freshness so state evidence reads NO_MATCH (it is not stale driver
  // evidence — it is not driver evidence at all), while a genuine driver outside the window
  // still reads STALE_ONLY.
  if (asksForDriverEvidence(req) && !carriesDriverContent(item, opts.subjectTerms)) return "NO_MATCH";
  return freshnessSufficient(req, item, now) ? "SATISFIES" : "STALE_ONLY";
}

/**
 * MC-6 GROUP ASSEMBLY.
 *
 * A chunked provider serves ONE provider response as several segments (G1 emits one evidence
 * object per month: `{month, candleCount, candles}`). Each segment honestly measures only its
 * own span, so a row demanding a 12-month window could never be satisfied by any single chunk —
 * the data that answers the question existed, arrived, and was ruled out piece by piece.
 *
 * The engine assembles each multi-segment response into ONE additional candidate observation:
 * the union of its segments' facts (union facets, max span, finest resolution, earliest
 * timestamp, single declared subject) with a payloadIdentity DERIVED from the group key (so
 * the same response re-served under another capability still dedupes) and `groupRefs` naming
 * the real segment evidence ids. A group is matched ONLY in addition to its segments, and the
 * segment gates (subject, domain, freshness) bind it: assembly widens SPAN, never relevance.
 * Single-segment payloads are not duplicated here — they already match as themselves.
 */
function assembledGroupItems(items: readonly CoverageEvidence[]): readonly CoverageEvidence[] {
  const groups = new Map<string, CoverageEvidence[]>();
  for (const item of items) {
    const group = item.payloadGroup;
    if (group === undefined) continue;
    const members = groups.get(group) ?? [];
    members.push(item);
    groups.set(group, members);
  }
  const assembled: CoverageEvidence[] = [];
  for (const [group, members] of groups) {
    if (members.length < 2) continue; // a lone segment already matches as itself
    const first = members[0];
    if (first === undefined) continue;
    const withFacets = members.filter((m) => m.dataFacets !== undefined);
    const facets = withFacets.length === 0 ? undefined : [...new Set(withFacets.flatMap((m) => m.dataFacets ?? []))];
    const withSpan = members.filter((m) => m.coverageHours !== undefined);
    const span = withSpan.length === 0 ? undefined : Math.max(...withSpan.map((m) => m.coverageHours ?? 0));
    const resolutions = members
      .map((m) => m.resolution)
      .filter((r): r is Resolution => r !== undefined);
    const resolution = resolutions.length === 0 ? undefined : finestOf(resolutions);
    const observedAt = members
      .map((m) => m.observedAt)
      .filter((t): t is string => t !== undefined)
      .sort()[0];
    const subjects = [...new Set(members.map((m) => m.subject).filter((s): s is string => s !== undefined && s.trim() !== ""))];
    const freshness = members.every((m) => m.freshness === first.freshness) ? first.freshness : undefined;
    assembled.push({
      ref: `group:${group}`,
      text: members.map((m) => m.text).join(" "),
      ...(first.evidenceType !== undefined ? { evidenceType: first.evidenceType } : {}),
      ...(freshness !== undefined ? { freshness } : {}),
      ...(observedAt !== undefined ? { observedAt } : {}),
      ...(subjects.length === 1 ? { subject: subjects[0] } : {}),
      ...(first.sourceProvider !== undefined ? { sourceProvider: first.sourceProvider } : {}),
      ...(first.sourceType !== undefined ? { sourceType: first.sourceType } : {}),
      ...(facets !== undefined ? { dataFacets: facets } : {}),
      ...(span !== undefined ? { coverageHours: span } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      // Identity derived from the group key, not from any single segment: the SAME response
      // re-served under another capability name carries the same toolResultRef, so it still
      // dedupes to one observation.
      payloadIdentity: `group:${group}`,
      payloadGroup: group,
      groupRefs: members.map((m) => m.ref),
    });
  }
  return assembled;
}

/** The finest resolution in a set (resolution.ts ladder order; first wins ties). */
function finestOf(resolutions: readonly Resolution[]): Resolution | undefined {
  const order: readonly Resolution[] = ["TICK", "MINUTE", "HOUR", "DAY", "WEEK", "MONTH"];
  let finest: Resolution | undefined;
  for (const r of resolutions) {
    if (finest === undefined || order.indexOf(r) < order.indexOf(finest)) finest = r;
  }
  return finest;
}

/**
 * Coverage assessment: match every item against every requirement and derive statuses.
 * PENDING requirements with evidence become SATISFIED (fresh match) or PARTIALLY_SATISFIED
 * (stale-only match). EXHAUSTED/UNAVAILABLE are terminal states owned by the recovery loop.
 * 
 * EVIDENCE QUALITY ASSESSMENT (research contract): for each satisfied requirement, assess
 * the quality of the evidence based on source diversity, directness, and consistency.
 * This prevents the model from treating correlation as causation.
 */
/**
 * How many DISTINCT observations actually back a requirement.
 *
 * This is the number the trader reads as evidence. Re-served copies of one provider response
 * are excluded: a capability-level provider reached under several capability names used to
 * report one snapshot as several observations, which reads as corroboration and is not.
 */
export function distinctEvidenceCount(
  req: Pick<ResearchRequirement, "evidenceRefs" | "duplicateEvidenceRefs">,
): number {
  return req.evidenceRefs.length;
}

export function assessCoverage(
  requirements: readonly ResearchRequirement[],
  items: readonly CoverageEvidence[],
  opts: MatchOptions = {},
): readonly ResearchRequirement[] {
  return foldDuplicateChallengeRows(requirements).map((req) => {
    if (req.status === "EXHAUSTED" || req.status === "UNAVAILABLE") return req;
    const satisfied: string[] = [];
    const staleOnly: string[] = [];
    // RESPONSE-IDENTITY LAW: one provider response re-served under another capability name is
    // ONE observation. Its ref is preserved (provenance is not erased) and recorded as a
    // duplicate, but it never becomes a second fact and never inflates the informational
    // count the trader reads as corroboration.
    const satisfiedIdentity = new Map<string, string>();
    const duplicates: string[] = [];
    // MC-6 GROUP ASSEMBLY: a chunked provider (G1 monthly candle blocks) serves ONE response as
    // several segments; no single segment spans the window, so the matcher read each segment as
    // NO_MATCH and a correct series was unresolvable. The engine assembles each response's
    // segments into one additional candidate observation carrying the GROUP's span, facets,
    // resolution and provenance, and matches THAT when at least one segment matched alone (the
    // per-segment subject/temporal gates are the ones that must hold; the leading segment may
    // short-circuit on the very span gate the group exists to satisfy). Segment refs stay
    // segment refs — the group's evidence is its members, never a fabricated single fact.
    // MC-6: assemble one observation per provider response that arrived as multiple segments
    // (share a toolResultRef) and let each windowed row read the group's assembled span.
    const assembled = assembledGroupItems(items);
    for (const item of [...items, ...assembled]) {
      const result = matchRequirement(req, item, opts);
      if (result === "SATISFIES") {
        const identity = item.payloadIdentity;
        if (identity !== undefined && satisfiedIdentity.has(identity)) {
          duplicates.push(item.ref);
          continue;
        }
        if (identity !== undefined) satisfiedIdentity.set(identity, item.ref);
        satisfied.push(...(item.groupRefs ?? [item.ref]));
      } else if (result === "STALE_ONLY") staleOnly.push(item.ref);
    }
    const status: RequirementStatus =
      satisfied.length > 0 ? "SATISFIED" : staleOnly.length > 0 ? "PARTIALLY_SATISFIED" : req.status === "PARTIALLY_SATISFIED" ? "PARTIALLY_SATISFIED" : "PENDING";

    // EVIDENCE QUALITY ASSESSMENT: for satisfied requirements, assess the quality
    const updatedReq = { ...req, status, evidenceRefs: satisfied, staleOnlyRefs: staleOnly };
    if (status === "SATISFIED" && satisfied.length > 0) {
      const satisfiedEvidence = items.filter((item) => satisfied.includes(item.ref));
      const qualityAssessment = assessEvidenceQuality(updatedReq, satisfiedEvidence);
      return {
        ...updatedReq,
        ...(duplicates.length > 0 ? { duplicateEvidenceRefs: duplicates } : {}),
        evidenceQuality: qualityAssessment.quality,
        evidenceDirectness: qualityAssessment.directness,
        sourceDiversity: qualityAssessment.sourceDiversity,
      };
    }
    
    return updatedReq;
  });
}

/**
 * Blocking requirements: CRITICAL ones that are not SATISFIED (stale-only counts as a gap).
 * ROLE LAWS (research contract §3):
 * - CONTEXT is background and never blocks completion.
 * - CHALLENGE un-attempted BLOCKS even though its evidence may be absent: a judgment may only
 *   state that no counterevidence was found once a disconfirmation-capable capability actually
 *   executed (recorded as an attempt on the requirement by markChallengeAttempted).
 */
export function blockingRequirements(requirements: readonly ResearchRequirement[]): readonly ResearchRequirement[] {
  return requirements.filter((r) => {
    if (r.status === "SATISFIED" || r.status === "UNAVAILABLE" || r.status === "EXHAUSTED") return false;
    if (r.role === "CONTEXT") return false;
    if (r.role === "CHALLENGE") return r.recoveryAttempts === 0;
    return r.importance === "CRITICAL";
  });
}

/**
 * CHALLENGE-ATTEMPT LAW: records, on every CHALLENGE requirement, that the engine actually
 * attempted disconfirmation. `executedCapabilities` are the capabilities that ran this run;
 * a capability counts as a disconfirmation attempt only when its declaration says it returns
 * counterevidence (or disconfirming) material. Absence of a challenge is therefore never
 * confused with absence of counterevidence, and the engine can honestly render
 * "attempted; nothing credible found" versus "not attempted".
 */
/**
 * When NO disconfirmation-capable provider is registered for this deployment, the engine has no
 * route to attempt a challenge at all. Rather than blocking every run forever (which would turn
 * a missing provider into a fake research gap) or silently dropping the requirement (which would
 * let a judgment claim counterevidence was sought), the challenge is marked UNAVAILABLE with the
 * blocker recorded — the honest state, rendered as such and never as "no counterevidence found".
 */
export function markUnattemptableChallenges(
  requirements: readonly ResearchRequirement[],
  isAvailable: (capability: string) => boolean,
): readonly ResearchRequirement[] {
  const hasRoute = DISCONFIRMATION_CAPABILITIES.some((cap) => isAvailable(cap));
  if (hasRoute) return requirements;
  return requirements.map((r) =>
    r.role === "CHALLENGE" && r.status !== "SATISFIED"
      ? {
          ...r,
          status: "UNAVAILABLE" as const,
          missingReason: "no disconfirmation-capable provider is registered for this deployment (counterevidence could not be sought)",
        }
      : r,
  );
}

export function markChallengeAttempted(
  requirements: readonly ResearchRequirement[],
  executedCapabilities: readonly string[],
): readonly ResearchRequirement[] {
  const attempted = executedCapabilities.some((cap) => DISCONFIRMATION_CAPABILITIES.includes(cap));
  if (!attempted) return requirements;
  return requirements.map((r) =>
    r.role === "CHALLENGE" && r.status !== "SATISFIED"
      ? { ...r, recoveryAttempts: Math.max(r.recoveryAttempts, 1) }
      : r,
  );
}

/**
 * CHALLENGE DIMENSION IDENTITY: the loop's own causal-chain vocabulary describes the challenge
 * dimension in different words ("counter-evidence that would weaken the leading explanation",
 * relationshipType COUNTER_EVIDENCE) than the generic CHALLENGE requirement ("evidence that
 * weakens or contradicts ..."). They are the SAME decision dimension: when a chain seed names
 * the challenge role, fold its attempt/satisfaction state into the existing CHALLENGE rows
 * instead of keeping a second permanently-pending CRITICAL row that blocks completion even
 * after disconfirmation executed and found nothing. Role — not wording — owns identity.
 */
function foldDuplicateChallengeRows(requirements: readonly ResearchRequirement[]): readonly ResearchRequirement[] {
  const challengeRows = requirements.filter((r) => r.role === "CHALLENGE");
  if (challengeRows.length <= 1) return requirements;
  const primary = challengeRows.reduce((best, r) =>
    r.status === "SATISFIED" || best.status === "SATISFIED"
      ? (r.status === "SATISFIED" ? r : best)
      : (r.recoveryAttempts > best.recoveryAttempts ? r : best),
  );
  const primaryId = primary.id;
  return requirements
    .filter((r) => r.role !== "CHALLENGE" || r.id === primaryId)
    .map((r) =>
      r.id === primaryId
        ? {
            ...r,
            recoveryAttempts: Math.max(...challengeRows.map((c) => c.recoveryAttempts)),
            evidenceRefs: [...new Set(challengeRows.flatMap((c) => c.evidenceRefs))],
            staleOnlyRefs: [...new Set(challengeRows.flatMap((c) => c.staleOnlyRefs))],
            status: challengeRows.some((c) => c.status === "SATISFIED")
              ? "SATISFIED"
              : challengeRows.every((c) => c.status === "EXHAUSTED" || c.status === "UNAVAILABLE")
                ? primary.status
                : r.status,
          }
        : r,
    );
}

/** The engine's completion verdict: complete only when no CRITICAL requirement is blocking. */
export function coverageVerdict(requirements: readonly ResearchRequirement[]): { readonly complete: boolean; readonly blocking: readonly ResearchRequirement[] } {
  const blocking = blockingRequirements(requirements);
  return { complete: blocking.length === 0, blocking };
}

// ---------------------------------------------------------------------------
// Capability catalog: each capability DECLARES what it can provide, and the engine matches
// requirements to capabilities. This is the reverse of question routing: nothing here knows
// about oil, macro, NVDA, or any individual question; capabilities declare domains, data
// types, and the freshness horizons they can serve, and recovery is a lookup against those
// declarations. A capability added without a declaration fails the catalog conformance test.
// ---------------------------------------------------------------------------

export interface CapabilitySupport {
  readonly domains: readonly EvidenceDomain[];
  readonly dataTypes: readonly string[];
  readonly freshness: readonly TimeSensitivity[];
  /**
   * THE SHAPES THIS CAPABILITY CAN PRODUCE (research-integrity contract).
   *
   * A declaration is a RANKING signal, never a coverage guarantee: it says what a capability is
   * able to return when its provider is healthy, so a request for a price PATH ranks the candle
   * path above a spot-quote path instead of tying on vocabulary and letting the alphabetical
   * tie-break pick the poorer one (the production failure scheduled COMMODITY_MARKET_DATA — zero
   * providers — ahead of the crypto one). The guarantee lives where it can be observed for
   * certain, at the evidence layer: `matchRequirement` still decides satisfaction from what a
   * payload ACTUALLY carries, so an over-optimistic declaration costs ranking points, never a
   * false SATISFIED.
   *
   * Market-class scope is the second half of the same fix: a commodity, FX or equity market-data
   * capability must never be scheduled for a crypto subject, however well its vocabulary scored.
   */
  readonly facets?: readonly DataFacet[];
  /** Market classes this capability can serve; absent means "any class it is offered for". */
  readonly marketClasses?: readonly SubjectMarketClass[];
}

export const CAPABILITY_SUPPORT: Readonly<Record<string, CapabilitySupport>> = {
  MARKET_DATA_ANALYSIS: { domains: ["PRICE_MARKET", "TECHNICAL"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["SNAPSHOT", "SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"] },
  SENTIMENT_ANALYSIS: { domains: ["SENTIMENT", "PRICE_MARKET"], dataTypes: ["SENTIMENT", "POSITIONING", "PROXY"], freshness: ["CURRENT", "RECENT"] },
  NEWS_ANALYSIS: { domains: ["NEWS", "MACRO", "PRICE_MARKET"], dataTypes: ["NEWS", "HEADLINE", "EVENT", "DRIVER", "DEVELOPMENT", "TRANSMISSION", "RELATIONSHIP"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["REPORTED_EVENT", "TIMESTAMP"] },
  MACRO_ANALYSIS: { domains: ["MACRO"], dataTypes: ["POLICY", "RATE", "YIELD", "INFLATION", "GROWTH", "LABOR", "LIQUIDITY", "CREDIT", "USD", "DOLLAR", "VOLATILITY", "REGIME", "TRANSMISSION", "RELATIONSHIP"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  DERIVATIVES_ANALYSIS: { domains: ["DERIVATIVES"], dataTypes: ["FUNDING", "OPEN_INTEREST", "POSITIONING", "LIQUIDATION"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  HISTORICAL_COMPARISON: { domains: ["HISTORICAL", "PRICE_MARKET", "TECHNICAL", "GENERAL"], dataTypes: ["OHLCV", "EPISODE", "OUTCOME", "CYCLE", "ANALOGUE"], freshness: ["HISTORICAL", "ANY"], facets: ["SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"] },
  FALSIFICATION: { domains: ["GENERAL", "NEWS"], dataTypes: ["DISCONFIRMING", "RISK", "COUNTEREVIDENCE"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  SOURCE_VALIDATION: { domains: ["GENERAL", "NEWS"], dataTypes: ["PRIMARY", "VERIFICATION", "PROVENANCE"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  // WEB_SEARCH also declares OPTIONS: it is the only registered, provider-backed path for
  // options-kind information (no options-chain source exists; OPTIONS_CHAIN_ANALYSIS stays out
  // of the vocabulary until one does). Without this, an OPTIONS requirement — "implied
  // volatility", "option chain", "strike" — mapped to no capability at all, so the floor
  // scheduled nothing and only recovery's empty-candidates backstop reached WEB_SEARCH.
  WEB_SEARCH: { domains: ["GENERAL", "NEWS", "PROJECT", "MACRO", "FUNDAMENTALS", "OPTIONS"], dataTypes: ["SEARCH", "PRIMARY", "DEVELOPMENT", "NARRATIVE", "TRANSMISSION", "RELATIONSHIP"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  ONCHAIN_ANALYSIS: { domains: ["ONCHAIN"], dataTypes: ["ADDRESS", "HOLDER", "TRANSACTION", "RESERVE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  DEFI_ANALYSIS: { domains: ["DEFI"], dataTypes: ["TVL", "PROTOCOL", "LIQUIDITY", "STAKING"], freshness: ["CURRENT", "RECENT"] },
  PROJECT_RESEARCH: { domains: ["PROJECT", "NEWS", "ONCHAIN", "DEFI"], dataTypes: ["DESCRIPTION", "ECOSYSTEM", "NARRATIVE", "TEAM", "ROADMAP"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  EQUITY_MARKET_DATA: { domains: ["PRICE_MARKET", "MACRO"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE", "YIELD", "VOLATILITY", "USD", "INDEX", "RATE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["SNAPSHOT", "SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"], marketClasses: ["EQUITY", "INDEX"] },
  EQUITY_FUNDAMENTALS: { domains: ["FUNDAMENTALS"], dataTypes: ["REVENUE", "MARGIN", "VALUATION", "SHARES", "BALANCE_SHEET"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  EARNINGS_CALENDAR: { domains: ["EARNINGS"], dataTypes: ["EARNINGS_DATE", "CONSENSUS", "ESTIMATE", "GUIDANCE", "REPORT"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  EQUITY_NEWS: { domains: ["NEWS", "EARNINGS", "FUNDAMENTALS"], dataTypes: ["HEADLINE", "COMPANY_EVENT", "ANNOUNCEMENT", "CATALYST"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  LOCAL_KNOWLEDGE_RETRIEVAL: { domains: ["GENERAL"], dataTypes: ["FRAMEWORK", "SAVED_RESEARCH", "METHODOLOGY", "NOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  // SHAPE DECLARATIONS: what each market-data chain can actually return.
  //  - CRYPTO: exchange-native candles via the market-intel/klines paths, plus a keyless
  //    aggregate spot fallback. It can serve a PATH, not only a quote.
  //  - COMMODITY / FX / EQUITY: quotes, volumes and series from their own venues.
  //  - TECHNICAL_ANALYSIS: raw OHLCV candles (TechnicalKlinesRestAdapter) as well as indicators,
  //    which is what makes a "give me the price path" request reachable at all — before this it
  //    declared only INDICATOR/TREND/MOMENTUM/SETUP and could never win a series requirement.
  CRYPTO_MARKET_DATA: { domains: ["PRICE_MARKET"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["SNAPSHOT", "SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"], marketClasses: ["CRYPTO"] },
  COMMODITY_MARKET_DATA: { domains: ["PRICE_MARKET"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["SNAPSHOT", "SERIES", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"], marketClasses: ["COMMODITY", "METAL"] },
  FX_MARKET_DATA: { domains: ["PRICE_MARKET"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["SNAPSHOT", "SERIES", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"], marketClasses: ["FX"] },
  TECHNICAL_ANALYSIS: { domains: ["TECHNICAL", "PRICE_MARKET"], dataTypes: ["INDICATOR", "TREND", "MOMENTUM", "SETUP", "OHLCV", "VOLUME"], freshness: ["CURRENT", "RECENT", "HISTORICAL"], facets: ["SERIES", "OHLC", "HIGH", "LOW", "OPEN", "CLOSE", "VOLUME", "TIMESTAMP"] },
};

/**
 * Capabilities that can satisfy a requirement, ranked deterministically by declared domain
 * overlap, data-type vocabulary overlap, freshness-horizon compatibility, and whether the
 * registry actually has a provider registered for them. Never inspects the question text
 * beyond the requirement itself, and never names a provider.
 */
export function capabilitiesForRequirement(
  requirement: ResearchRequirement,
  opts: {
    readonly isAvailable?: (cap: string) => boolean;
    readonly limit?: number;
    /** The question's resolved market class, used to keep cross-asset chains out. */
    readonly marketClass?: SubjectMarketClass;
  } = {},
): readonly string[] {
  const reqTokens = meaningfulTokens(`${requirement.description} ${requirement.domains.join(" ")}`);
  const demanded = requiredFacetsOf(requirement);
  const scored: { readonly cap: string; readonly score: number }[] = [];
  for (const [cap, support] of Object.entries(CAPABILITY_SUPPORT)) {
    const domainHits = support.domains.filter((d) => requirement.domains.includes(d)).length;
    if (domainHits === 0) continue;
    // MARKET-CLASS SCOPE: a commodity chain cannot serve a crypto subject and vice versa. The
    // production failure scheduled COMMODITY_MARKET_DATA for a Bitcoin question purely on an
    // alphabetical tie-break; it returned nothing and burned the round the crypto path needed.
    if (opts.marketClass !== undefined && support.marketClasses !== undefined && !support.marketClasses.includes(opts.marketClass)) continue;
    const freshnessOk =
      requirement.timeSensitivity === "ANY" || support.freshness.includes(requirement.timeSensitivity);
    if (!freshnessOk) continue; // a historical-only capability cannot serve a CURRENT need
    // DISTINCT CONCEPTS, NOT DECLARATIONS: requirement tokens are canonicalized ("funding" ->
    // "FUND") and concept-folded ("policy"/"yields" -> "RATE"), while dataType strings are
    // declared raw, so two corrections make typeHits count what the name promises:
    //  1. fold the dataType the same way the description was folded, so FUNDING, POSITIONING
    //     and OPEN_INTEREST can score at all (an unfoldered compare never matched them, and
    //     the only capability returning open interest kept losing to capabilities that merely
    //     mention rates);
    //  2. count each matched CONCEPT once: POLICY, RATE and YIELD all fold to RATE, and
    //     counting one concept three times let a broad dataType list outrank the capability
    //     that actually returns the data the requirement names.
    const hitConcepts = new Set<string>();
    for (const dt of support.dataTypes) {
      if (reqTokens.has(dt)) { hitConcepts.add(dt); continue; }
      for (const t of meaningfulTokens(dt)) {
        if (reqTokens.has(t)) { hitConcepts.add(t); break; }
      }
    }
    const typeHits = hitConcepts.size;
    // AVAILABILITY IS A FILTER, NOT A PREFERENCE: scheduling a capability no provider serves
    // spends a round on a guaranteed empty result (the caller's intent — "recovery never
    // schedules a capability the deployment cannot execute" — was only affecting the score).
    if (opts.isAvailable !== undefined && !opts.isAvailable(cap)) continue;
    // SHAPE AFFINITY: a capability that declares the demanded shapes outranks one that can only
    // return a quote, so "give me the price path" ranks the candle path first. This is ranking
    // only — `matchRequirement` still decides satisfaction from the evidence itself.
    const servedFacets = support.facets ?? [];
    const shapeHits = [...demanded].filter((f) => servedFacets.includes(f)).length;
    scored.push({
      cap,
      score: domainHits * 10 + typeHits * 4 + shapeHits * 6 + 2 + (support.freshness.includes("ANY") ? 0 : 1),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.cap.localeCompare(b.cap));
  return scored.slice(0, opts.limit ?? 3).map((s) => s.cap);
}

/**
 * Capabilities that return disconfirming material (the engine's challenge tier). Used by
 * recovery when the unresolved requirement IS the challenge itself, and by the attempt law.
 */
export const DISCONFIRMATION_CAPABILITIES: readonly string[] = Object.entries(CAPABILITY_SUPPORT)
  .filter(([, support]) => support.dataTypes.some((t) => t === "COUNTEREVIDENCE" || t === "DISCONFIRMING"))
  .map(([cap]) => cap);

/**
 * Recovery plan for a set of blocking requirements: the capabilities their domains map to,
 * in priority order, bounded so one round cannot explode into dozens of calls.
 */
export function recoveryCapabilities(
  blocking: readonly ResearchRequirement[],
  opts: {
    readonly isAvailable?: (cap: string) => boolean;
    readonly limit?: number;
    readonly exclude?: readonly string[];
    /** The question's resolved market class; keeps cross-asset chains out of recovery. */
    readonly marketClass?: SubjectMarketClass;
  } = {},
): readonly string[] {
  const limit = opts.limit ?? 4;
  const excluded = new Set(opts.exclude ?? []);
  const out: string[] = [];
  for (const req of blocking) {
    // A blocking CHALLENGE requirement is recovered with DISCONFIRMATION capabilities only:
    // the gap is "no challenge was attempted", so the fix is a challenge attempt, never an
    // unrelated capability that happens to share the challenge's domain.
    const candidates =
      req.role === "CHALLENGE"
        ? DISCONFIRMATION_CAPABILITIES.filter((cap) => opts.isAvailable === undefined || opts.isAvailable(cap))
        : capabilitiesForRequirement(req, { ...opts, limit: 2 });
    for (const cap of candidates) {
      if (excluded.has(cap) || out.includes(cap)) continue;
      out.push(cap);
      if (out.length >= limit) return out;
    }
  }
  // The last-resort default is WEB_SEARCH alone. CROSS_DOMAIN_SYNTHESIS used to sit beside it
  // as a "buy a generated research answer" capability; it was removed from the vocabulary on
  // 2026-10-05 because its only providers cost credits per call and were being invoked as an
  // automatic backstop. A gap that cannot be covered by retrieval must stay a gap — the run
  // reports the limitation instead of buying an answer.
  if (out.length === 0) out.push("WEB_SEARCH");
  return out;
}

/**
 * Capabilities that CANNOT run without a resolved subject/instrument: they are symbol-scoped,
 * so dispatching one for a subjectless question ("what macro conditions favor risk assets right
 * now") spends a round on a guaranteed SCHEMA_ERROR — observed live: the floor's
 * EQUITY_MARKET_DATA and EARNINGS_CALENDAR calls for a macro-regime question both came back
 * unusable. The floor and recovery skip them when the question earned no asset.
 */
export const SUBJECT_REQUIRED_CAPABILITIES: readonly string[] = [
  "MARKET_DATA_ANALYSIS", "TECHNICAL_ANALYSIS", "EQUITY_MARKET_DATA", "EQUITY_FUNDAMENTALS",
  "EARNINGS_CALENDAR", "EQUITY_NEWS", "DERIVATIVES_ANALYSIS",
  "ONCHAIN_ANALYSIS", "DEFI_ANALYSIS",
  "CRYPTO_MARKET_DATA", "COMMODITY_MARKET_DATA", "FX_MARKET_DATA",
];

/**
 * CAPABILITY FLOOR (research contract): the capabilities a question's CRITICAL requirements
 * make MANDATORY, independent of what the model planned. The model may propose capabilities,
 * but it cannot omit one an engine-derived requirement depends on — the live failure this
 * prevents: a yields question whose plan named no direct market capability, so no yield
 * observation was ever retrieved and the run ended "insufficient" without trying.
 *
 * Same lookup as recovery (CAPABILITY_SUPPORT declarations), but proactive: it runs in the
 * FIRST round against requirements that are still PENDING, so a plan that omitted a mapped
 * capability cannot leave an engine-required dimension unattempted.
 */
export function mandatoryCapabilities(
  requirements: readonly ResearchRequirement[],
  opts: {
    readonly isAvailable?: (cap: string) => boolean;
    readonly exclude?: readonly string[];
    readonly limit?: number;
    /** The question's resolved market class; keeps cross-asset chains out of the floor. */
    readonly marketClass?: SubjectMarketClass;
    /**
     * Capabilities the plan EXPLICITLY excluded from scope (the plan's scopeExcluded, mapped by
     * the planner to capability names). The floor must not silently undo a declared exclusion:
     * the trader's scope is a constraint, and the floor exists to close gaps, not to widen
     * scope the question already excluded.
     */
    readonly excludedFromScope?: readonly string[];
  } = {},
): readonly string[] {
  const limit = opts.limit ?? 4;
  const excluded = new Set([...(opts.exclude ?? []), ...(opts.excludedFromScope ?? [])]);
  const out: string[] = [];
  for (const req of requirements) {
    // CHALLENGE is excluded on purpose: the engine's disconfirmation action is the dedicated
    // counterevidence floor (FALSIFICATION), not an arbitrary capability that happens to share
    // the challenge's domain. Mapping it generically made the floor schedule a deep-research
    // agent in round 1 of a question whose plan had not asked for one.
    if (req.role === "CHALLENGE") continue;
    if (req.importance !== "CRITICAL" || !isDiscriminatingRequirement(req)) continue;
    for (const cap of capabilitiesForRequirement(req, { ...opts, limit: 2 })) {
      if (excluded.has(cap) || out.includes(cap)) continue;
      // Only capabilities the deployment can actually execute: the floor must not spend a
      // round on a capability no provider serves (that would look like retrieval work while
      // being a guaranteed empty result).
      if (opts.isAvailable !== undefined && !opts.isAvailable(cap)) continue;
      out.push(cap);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Requirements marked EXHAUSTED after recovery could not satisfy them (terminal, honest). */
export function exhaustUnresolved(requirements: readonly ResearchRequirement[], attempted: readonly string[]): readonly ResearchRequirement[] {
  return requirements.map((r) =>
    r.status === "SATISFIED"
      ? r
      : {
          ...r,
          status: "EXHAUSTED" as const,
          recoveryAttempts: r.recoveryAttempts + 1,
          missingReason:
            r.staleOnlyRefs.length > 0
              ? `only stale evidence was found (${r.staleOnlyRefs.length} observation(s) outside the requirement's time horizon) after recovery via ${attempted.join(", ")}`
              : `no relevant evidence was found after recovery via ${attempted.join(", ")}`,
        },
  );
}

/** Human-readable coverage report for the synthesis context (never the user-facing answer). */
export function renderCoverage(requirements: readonly ResearchRequirement[]): string {
  if (requirements.length === 0) return "REQUIREMENT COVERAGE: none declared.";
  const lines = requirements.map((r) => {  // role and calculation are part of the engine's ledger state
    const detail =
      r.status === "SATISFIED" ? `${r.evidenceRefs.length} observation(s)`
      : r.status === "PARTIALLY_SATISFIED" ? `STALE ONLY (${r.staleOnlyRefs.length} observation(s) outside the ${r.timeSensitivity} time horizon)`
      : r.status === "EXHAUSTED" ? `EXHAUSTED: ${r.missingReason ?? "no relevant evidence after recovery"}`
      : r.status === "UNAVAILABLE" ? "UNAVAILABLE"
      : "no relevant evidence yet";
    const challenge =
      r.role === "CHALLENGE"
        ? r.recoveryAttempts > 0
          ? " [challenge attempted]"
          : " [challenge NOT attempted; do not claim counterevidence was sought]"
        : "";
    const calc = r.calculation !== undefined ? ` [required calculation: ${r.calculation}]` : "";
    const quality = r.evidenceQuality !== undefined ? ` [quality: ${r.evidenceQuality}]` : "";
    const diversity = r.sourceDiversity !== undefined && r.sourceDiversity > 0 ? ` [sources: ${r.sourceDiversity}]` : "";
    const directness = r.evidenceDirectness !== undefined ? ` [${r.evidenceDirectness}]` : "";
    return `- [${r.id}] (${r.role}/${r.importance}, ${r.timeSensitivity}) ${r.description}: ${r.status} (${detail})${calc}${challenge}${quality}${diversity}${directness}`;
  });
  const verdict = coverageVerdict(requirements);
  return [
    "REQUIREMENT COVERAGE (engine-assessed; a provider returning data is NOT coverage):",
    ...lines,
    verdict.complete
      ? "VERDICT: all CRITICAL requirements covered."
      : `VERDICT: ${verdict.blocking.length} CRITICAL requirement(s) UNCOVERED (${verdict.blocking.map((b) => b.id).join(", ")}). If evidence for these was not obtained after recovery, state exactly which requirement is missing; do not substitute unrelated observations.`,
  ].join("\n");
}

/**
 * ASSESS EVIDENCE QUALITY (research contract): for a satisfied requirement, assess the
 * quality of the evidence based on source diversity, directness, and consistency.
 * This prevents the model from treating correlation as causation.
 */
export function assessEvidenceQuality(
  _requirement: ResearchRequirement,
  evidenceItems: readonly CoverageEvidence[],
): { quality: EvidenceQuality; directness: "DIRECT" | "INFERRED"; sourceDiversity: number } {
  if (evidenceItems.length === 0) {
    return { quality: "UNRESOLVED", directness: "INFERRED", sourceDiversity: 0 };
  }

  // Source diversity: count UNIQUE, INDEPENDENT origins. Two laws keep repeated reporting
  // from manufacturing corroboration (research contract §evidence quality):
  // 1. An adapter-flagged duplicate never ADDS an origin: it is the same underlying report,
  //    not independent confirmation.
  // 2. Identical payloads naming the same origin collapse to ONE origin (re-served copies of
  //    the same report must not be counted once per copy). The origin string is the whole
  //    key: no content-based dedup here, that is the adapter layer's declared job (G2 flags
  //    repeated content per item; the engine honors the flag rather than re-deriving it).
  const distinct = new Set<string>();
  for (const item of evidenceItems) {
    if (item.duplicateContent === true) continue;
    distinct.add(item.sourceProvider ?? `content:${item.text}`);
  }
  const sourceDiversity = Math.max(distinct.size, 1);

  // Directness: primary sources vs secondary reporting/analysis. Duplicate-flagged items do
  // not establish directness either; a duplicate of an already-counted origin adds nothing.
  const hasPrimarySource = evidenceItems.some((e) => e.sourceType === "PRIMARY" && e.duplicateContent !== true);
  const hasTypedSource = evidenceItems.some((e) => e.sourceType !== undefined);
  const hasOnlySecondary = evidenceItems.every(
    (e) => e.sourceType === "SECONDARY" || e.sourceType === "COMMUNITY" || e.sourceType === "ANALYSIS"
  );
  const directness: "DIRECT" | "INFERRED" = hasPrimarySource ? "DIRECT" : "INFERRED";

  // Evidence quality assessment
  let quality: EvidenceQuality;
  
  if (sourceDiversity >= 3 && hasPrimarySource) {
    // Multiple independent primary sources = strong evidence
    quality = "DIRECT_EVIDENCE";
  } else if (sourceDiversity >= 2 || hasPrimarySource) {
    // Either multiple sources or one primary source = supported inference
    quality = "SUPPORTED_INFERENCE";
  } else if (hasOnlySecondary) {
    // Only secondary reporting = correlational at best
    quality = "CORRELATIONAL";
  } else if (!hasTypedSource) {
    // Satisfied evidence with no source-type metadata: correlational (weak provenance),
    // never UNRESOLVED — UNRESOLVED means the claim itself could not be tied to evidence.
    quality = "CORRELATIONAL";
  } else {
    // Insufficient data
    quality = "UNRESOLVED";
  }

  return { quality, directness, sourceDiversity };
}

/**
 * UPDATE REQUIREMENT QUALITY (research contract): update a requirement's evidence quality
 * assessment after coverage is satisfied. Returns the updated requirement.
 */
export function updateRequirementQuality(
  requirement: ResearchRequirement,
  evidenceItems: readonly CoverageEvidence[],
): ResearchRequirement {
  if (requirement.status !== "SATISFIED") return requirement;
  
  const { quality, directness, sourceDiversity } = assessEvidenceQuality(requirement, evidenceItems);
  
  return {
    ...requirement,
    evidenceQuality: quality,
    evidenceDirectness: directness,
    sourceDiversity,
  };
}

/**
 * CAUSAL CHAIN REQUIREMENTS (research contract): for CAUSAL questions, derive additional
 * requirements that represent the causal chain structure. This ensures the engine retrieves
 * evidence for each link in the chain, not just the observation.
 */
export function causalChainRequirements(
  question: string,
  subject: string,
): readonly RequirementSeed[] {
  const questionType = questionTypeOf(question);
  if (questionType !== "CAUSAL") return [];

  return [
    {
      description: `observation of what actually happened to ${subject}`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "DRIVER",
      evidenceClasses: ["PRICE", "OHLCV", "MARKET_DATA", "QUOTE"],
    },
    {
      description: `direct drivers behind the ${subject} move (supply/demand factors, policy, geopolitics)`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "DRIVER",
      evidenceClasses: ["NEWS", "DRIVER", "CATALYST", "POLICY", "SUPPLY", "DEMAND"],
    },
    {
      description: `mechanism through which drivers could produce the observed ${subject} move`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "MECHANISM",
      evidenceClasses: ["ANALYSIS", "MECHANISM", "TRANSMISSION"],
    },
    {
      description: `transmission into related markets (rates, equities, crypto, FX)`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "TRANSMISSION",
      evidenceClasses: ["MACRO", "RATE", "YIELD", "EQUITY", "INDEX"],
    },
    {
      description: `cross-asset response confirming or contradicting the transmission chain`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "CROSS_ASSET",
      evidenceClasses: ["PRICE", "MARKET_DATA", "QUOTE", "INDEX"],
    },
    {
      description: `counter-evidence that would weaken the leading explanation`,
      importance: "CRITICAL",
      timeSensitivity: "CURRENT",
      role: "CHALLENGE",
      relationshipType: "COUNTER_EVIDENCE",
      evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK"],
    },
    {
      description: `forward-looking conditions to watch that would strengthen or weaken the thesis`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "IMPLICATION",
      evidenceClasses: ["NEWS", "CATALYST", "EVENT", "POLICY"],
    },
    {
      description: `material alternative explanations for the ${subject} move (competing drivers that could account for the same observation)`,
      importance: "SUPPORTING",
      timeSensitivity: "CURRENT",
      role: "SUPPORTING",
      relationshipType: "DRIVER",
      evidenceClasses: ["NEWS", "ANALYSIS", "DRIVER", "CATALYST"],
    },
  ];
}

// ---------------------------------------------------------------------------
// TRANSMISSION ANALYSIS (research contract §3: causal/transmission validation)
// ---------------------------------------------------------------------------

/**
 * Link target vocabulary (market CLASSES, not questions): how a market name in the question's
 * transmission wording folds onto the shared concept vocabulary. Generic — any market word in
 * a transmission clause resolves through this map plus CONCEPT_SYNONYMS; unseen assets of a
 * known class behave identically.
 */
const TRANSMISSION_TARGET_FOLDS: Readonly<Record<string, string>> = {
  OIL: "OIL", CRUDE: "OIL", WTI: "OIL", BRENT: "OIL",
  GOLD: "GOLD", COPPER: "COPPER", SILVER: "SILVER", COMMODITY: "COMMODITY", COMMODITIES: "COMMODITY",
  INFLATION: "INFLATION", CPI: "INFLATION",
  YIELD: "RATES", YIELDS: "RATES", TREASURY: "RATES", TREASURIES: "RATES", RATES: "RATES", BONDS: "RATES",
  DOLLAR: "DOLLAR", DXY: "DOLLAR", USD: "DOLLAR", CURRENCY: "DOLLAR", FX: "DOLLAR",
  EQUITIES: "EQUITIES", EQUITY: "EQUITIES", STOCKS: "EQUITIES", STOCK: "EQUITIES", SHARES: "EQUITIES",
  RISK: "RISK_ASSETS", EMERGING: "EMERGING_MARKETS", CRYPTO: "CRYPTO", BITCOIN: "CRYPTO", BTC: "CRYPTO",
};

/**
 * Transmission wording (question SHAPES, not questions): "how did X transmit through/into Y",
 * "how did X affect Y", "the impact of X on Y", "X feed into Y", "flow through". Each match
 * is a causal link the question explicitly requests; the engine derives requirements for it.
 */
const TRANSMISSION_CLAUSES: readonly { readonly pattern: RegExp; readonly fromIndex: number; readonly toIndex: number }[] = [
  { pattern: /\b(?:how (?:did|does|could|would|might)|what (?:impact|effect) (?:did|does|could|would|might))?[^.?!]{1,80}?\btransmit\w*\s+(?:through|into|to)\s+([^.?!]{3,90})/i, fromIndex: 0, toIndex: 1 },
  { pattern: /\b(?:how (?:did|does|could|would|might))[^.?!]{1,80}?\b(?:affect|impact|hit|drive|move)\s+([^.?!]{3,90})/i, fromIndex: 0, toIndex: 1 },
  { pattern: /\b(?:impact|effect|effect[s]?|influence)\s+(?:of|on)\s+([^.?!]{3,60})\s+(?:on|into|through)\s+([^.?!]{3,90})/i, fromIndex: 1, toIndex: 2 },
  { pattern: /\b(?:feed|feeds|fed|flow|flows|flowed|feeds through|spill|spills|spilled)\w*\s+(?:through|into|to|over)\s+(?:to\s+)?([^.?!]{3,90})/i, fromIndex: 0, toIndex: 1 },
];

/**
 * Parse the market/market-class names a question's transmission wording points INTO.
 * Returns canonical target folds (INFLATION, RATES, EQUITIES, ...). Generic: reads the
 * question's own causal grammar, never a question list. Empty when the question requests
 * no transmission.
 */
export function transmissionTargetsOf(question: string): readonly string[] {
  const targets = new Set<string>();
  for (const clause of TRANSMISSION_CLAUSES) {
    const match = question.match(clause.pattern);
    if (match === null) continue;
    for (const folded of foldMention(match[clause.toIndex] ?? "")) targets.add(folded);
  }
  return [...targets];
}

/**
 * Does the question EXPLICITLY ask what to watch next / what would change the view? A generic
 * forward-looking IMPLICATION requirement is already added to every causal chain; this detects
 * the questions that make monitoring a DECISION dimension ("what should a trader watch next",
 * "what would confirm or invalidate").
 */
export function asksWhatToWatchNext(question: string): boolean {
  return /\b(what should (?:a |the )?(?:trader|i|we) (?:watch|monitor)|what to watch|watch next|monitor next|what would (?:confirm|invalidate|change)|what(?:'s| is) the signal|key (?:levels?|indicator[s]?|signs?) to watch)\b/i.test(question);
}

/**
 * Does the question explicitly ask whether the explanation could be different (alternative
 * explanations / competing drivers)?
 */
export function asksForAlternatives(question: string): boolean {
  return /\b(alternativ\w* explanation|other (?:explanation|driver|factor)|what else could|competing (?:driver|explanation|theory))\b/i.test(question);
}

/** One derived causal link between two named parties in the question's transmission wording. */
export interface CausalLinkSpec {
  /** Canonical source market fold (the driver side). */
  readonly source: string;
  /** Canonical target market fold (the receiver side). */
  readonly target: string;
}

/**
 * Derive the causal links a question's transmission wording explicitly requests, as ordered
 * (source -> target) pairs of canonical folds. "How could higher oil prices affect inflation
 * and emerging markets" derives OIL->INFLATION and OIL->EMERGING_MARKETS. Generic: pure
 * grammar over the question's own nouns; no question list.
 */
export function causalLinksOf(question: string, subject?: string): readonly CausalLinkSpec[] {
  const links: { source: string; target: string }[] = [];
  const subjectFold =
    subject !== undefined && subject.trim() !== "" ? (TRANSMISSION_TARGET_FOLDS[subject.toUpperCase()] ?? CONCEPT_SYNONYMS[subject.toUpperCase()]) : undefined;
  for (const clause of TRANSMISSION_CLAUSES) {
    const match = question.match(clause.pattern);
    if (match === null) continue;
    const head = (match[clause.fromIndex] ?? "").toUpperCase();
    const tail = (match[clause.toIndex] ?? "").toUpperCase();
    const foldTail = (text: string): Set<string> => foldMention(text);
    const headFolds = foldTail(head);
    if (headFolds.size === 0 && subjectFold !== undefined) headFolds.add(subjectFold);
    if (headFolds.size === 0) {
      // The clause head names no market ("how did those drivers transmit ..."): the source
      // side is the market(s) the question named BEFORE the transmission clause — the
      // question's subject side. Folds that also appear in the tail are targets, not sources.
      const tailFolds = foldTail(tail);
      for (const f of foldTail(question.slice(0, match.index ?? 0).toUpperCase())) {
        if (!tailFolds.has(f)) headFolds.add(f);
      }
    }
    for (const target of foldTail(tail)) {
      for (const source of headFolds) {
        if (source !== target) links.push({ source, target });
      }
    }
  }
  // Deterministic de-dup, preserving question order.
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = `${l.source}->${l.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Human label for a canonical transmission-target fold (diagnostics + requirement wording). */
export function targetLabel(target: string): string {
  switch (target) {
    case "RATES": return "Treasury yields and rate markets";
    case "EQUITIES": return "broader equity and risk-asset markets";
    case "RISK_ASSETS": return "broader risk assets";
    case "EMERGING_MARKETS": return "emerging-market assets";
    case "INFLATION": return "inflation";
    case "DOLLAR": return "the dollar";
    case "CRYPTO": return "crypto markets";
    case "OIL": return "crude oil";
    case "GOLD": return "gold";
    case "COPPER": return "copper";
    case "SILVER": return "silver";
    case "COMMODITY": return "commodity markets";
    default: return target.toLowerCase().replace(/_/g, " ");
  }
}

// (The carrier/parent-node concept for arrows is GONE: `requirementCarriesTarget` used to attach
// an arrow to whichever row already owned the target dimension, and the arrow then inherited that
// row's coverage. Every arrow is now its own first-class row with its own admission law.)
