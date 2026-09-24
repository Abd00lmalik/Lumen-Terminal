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
}

const DAY_MS = 86_400_000;
/** A CURRENT requirement is not satisfied by observations older than this (market data is fast-moving). */
const CURRENT_MAX_AGE_DAYS = 21;
/** A RECENT requirement tolerates this much age. */
const RECENT_MAX_AGE_DAYS = 120;

/**
 * TEMPORAL LAW (research mandate Part 4): when a requirement names an explicit recency
 * window, EVENT-DATED coverage (headlines/news) must fall inside it. A headline from three
 * weeks ago does not answer a "this week" catalyst requirement, however valid it is as
 * background. Market quotes keep the data-freshness window instead: a quote carries its own
 * timestamp, and a yield level is a state, not an event-dated development.
 */
const EXPLICIT_WINDOWS: readonly { readonly pattern: RegExp; readonly days: number }[] = [
  { pattern: /\b(today|right now|currently|intraday|tonight|at the moment)\b/i, days: 3 },
  { pattern: /\b(this week|this week's|week to date|this-week|weekly)\b/i, days: 7 },
  { pattern: /\b(this month|month to date|monthly)\b/i, days: 31 },
];

/** Days named by a requirement's own recency phrasing, when it names one. */
export function explicitWindowDays(description: string): number | undefined {
  for (const window of EXPLICIT_WINDOWS) if (window.pattern.test(description)) return window.days;
  return undefined;
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
  { domain: "DERIVATIVES", patterns: [/\b(funding|funding rate|perpetual|futures basis|liquidations|leverage)\b/i] },
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
  return token;
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
  if (/\b(right now|now|today|currently|current|this week|this month|latest|moment)\b/i.test(text)) return "CURRENT";
  if (/\b(recent|recently|these days|near term|lately)\b/i.test(text)) return "RECENT";
  if (/\bhistor\w*|\bpast\b|\bpreviously\b|\bbefore\b|\bsince \d{4}\b|\bin \d{4}\b/i.test(text)) return "HISTORICAL";
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
    const timeSensitivity = seed.timeSensitivity ?? timeSensitivityOf(description);
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
      ...(seed.evidenceClasses !== undefined && seed.evidenceClasses.length > 0
        ? { evidenceClasses: [...seed.evidenceClasses] }
        : {}),
      ...(seed.relationshipType !== undefined ? { relationshipType: seed.relationshipType } : {}),
      ...(seed.targetTerms !== undefined && seed.targetTerms.length > 0 ? { targetTerms: [...seed.targetTerms] } : {}),
      retrievalObjective: retrievalObjectiveFor(description, timeSensitivity, role),
    };
  });
}

export type QuestionType =
  | "COMPARISON" | "CAUSAL" | "EVENT" | "MACRO_REGIME" | "THESIS" | "FALSIFICATION" | "HISTORICAL" | "SYNTHESIS";

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
  if (/\bcrypto|\bbitcoin|\bbtc\b|\bether|\beth\b|\bsolana|\bsol\b|\btoken\b|\bonchain\b/.test(q)) return "CRYPTO";
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
  const q = question.toLowerCase();
  if (/\bprove\b.*\bwrong\b|\binvalidate\b|\bfalsif\w*|\bwhat would change\b|\bdisconfirm\w*/.test(q)) return "FALSIFICATION";
  if (/\bhas (this|it|that|the .*? setup)\b.*\bhappened\b|\bhistor\w*|\bsimilar setup\b|\bhappened before\b|\banalog\w*|\bcomparable episodes?\b/.test(q)) return "HISTORICAL";
  if (/\bmy thesis\b|\bthesis\b|\bmy (view|framework|position|read|call)\b|\baccording to my\b|\bdoes (this|the) (hold|still hold)\b/.test(q)) return "THESIS";
  if (/\bcompare\w*|\bcompared (with|to)\b|\bversus\b|\bvs\.?\b|\bweek over week\b|\bweek[- ]over[- ]week\b|\bmonth over month\b|\bbetter than\b|\bperformance (vs|versus)\b/.test(q)) return "COMPARISON";
  if (/\bearnings\b|\breport\b|\bresults\b|\bfomc\b|\bcpi print\b|\bupcoming\b|\baround its next\b|\bnext (earnings|report|meeting|print)\b/.test(q)) return "EVENT";
  if (/\bmacro\b|\brisk assets\b|\brisk[- ]on\b|\brisk appetite\b|\bregime\b|\bconditions?\b|\bfinancial conditions\b|\bliquidity\b/.test(q)) return "MACRO_REGIME";
  if (/\bdriv\w*|\bdriving\b|\bwhy\b|\bwhat happened\b|\bwhat.s (behind|pushing|pressuring|moving)\b|\bpressur\w*|\bcaus\w*|\bexplain\w*/.test(q)) return "CAUSAL";
  return "SYNTHESIS";
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
      evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK", "NEWS"],
      covers: /challeng|contradict|against the thesis|weaken|oppos/i,
    },
  ],
  FALSIFICATION: [
    {
      description: (s) => `disconfirming evidence that would falsify the leading conclusion for ${s}`,
      role: "CHALLENGE", importance: "CRITICAL", timeSensitivity: "CURRENT",
      evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK", "NEWS"],
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
};

/**
 * Complete the ledger against the question's decision type: every missing engine-required
 * dimension is ADDED (never downgraded, never silently dropped), and every question gets a
 * CHALLENGE requirement so disconfirmation cannot be skipped. Returns the ledger in a stable
 * order: model requirements first, then engine-added dimensions.
 */
export function completeRequirements(
  question: string,
  requirements: readonly ResearchRequirement[],
  opts: { readonly subject?: string; readonly marketClass?: SubjectMarketClass } = {},
): readonly ResearchRequirement[] {
  const subject = (opts.subject ?? "the subject").trim();
  const marketClass = opts.marketClass ?? "UNKNOWN";
  const questionType = questionTypeOf(question);
  const specs: EngineRequirementSpec[] = [...ENGINE_REQUIRED[questionType]].filter(
    (spec) => spec.markets === undefined || spec.markets.includes(marketClass),
  );
  // CHALLENGE IS ALWAYS REQUIRED for a completed judgment (question type adds its own when it
  // has a more specific one).
  specs.push({
    description: () => "evidence that weakens or contradicts the leading conclusion (counterevidence)",
    role: "CHALLENGE", importance: "CRITICAL", timeSensitivity: "CURRENT",
    evidenceClasses: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK", "NEWS"],
    covers: /contradict|weaken|oppos|counter.?evidence|disconfirm|falsif|downside|against/i,
  });

  const out: ResearchRequirement[] = [...requirements];
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
      // generic endpoint feed.
      const description = `transmission evidence for how the move in ${subject} reached ${targetLabel(link.target)}`;
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
        const description = `material alternative explanations for the ${subject} move and for the transmission links (competing drivers that could account for the same observations)`;
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
    if (questionType === "CAUSAL") {
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
  }
  return false;
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
      const explicit = explicitWindowDays(req.description);
      const limit = explicit !== undefined && domainOfEvidenceType(item.evidenceType) === "NEWS" ? Math.min(base, explicit) : base;
      if (ageDays > limit) return false;
    }
  }
  return true;
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
  const itemTokens = meaningfulTokens(`${item.text} ${itemDomain}`, { stripCurrencyUnits: concernsForeignCrypto });
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
  return freshnessSufficient(req, item, now) ? "SATISFIES" : "STALE_ONLY";
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
export function assessCoverage(
  requirements: readonly ResearchRequirement[],
  items: readonly CoverageEvidence[],
  opts: MatchOptions = {},
): readonly ResearchRequirement[] {
  return foldDuplicateChallengeRows(requirements).map((req) => {
    if (req.status === "EXHAUSTED" || req.status === "UNAVAILABLE") return req;
    const satisfied: string[] = [];
    const staleOnly: string[] = [];
    for (const item of items) {
      const result = matchRequirement(req, item, opts);
      if (result === "SATISFIES") satisfied.push(item.ref);
      else if (result === "STALE_ONLY") staleOnly.push(item.ref);
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
}

export const CAPABILITY_SUPPORT: Readonly<Record<string, CapabilitySupport>> = {
  MARKET_DATA_ANALYSIS: { domains: ["PRICE_MARKET", "TECHNICAL"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  TECHNICAL_ANALYSIS: { domains: ["TECHNICAL", "PRICE_MARKET"], dataTypes: ["INDICATOR", "TREND", "MOMENTUM", "SETUP"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  SENTIMENT_ANALYSIS: { domains: ["SENTIMENT", "PRICE_MARKET"], dataTypes: ["SENTIMENT", "POSITIONING", "PROXY"], freshness: ["CURRENT", "RECENT"] },
  NEWS_ANALYSIS: { domains: ["NEWS", "MACRO", "PRICE_MARKET"], dataTypes: ["NEWS", "HEADLINE", "EVENT", "DRIVER", "DEVELOPMENT", "TRANSMISSION", "RELATIONSHIP"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  MACRO_ANALYSIS: { domains: ["MACRO"], dataTypes: ["POLICY", "RATE", "YIELD", "INFLATION", "GROWTH", "LABOR", "LIQUIDITY", "CREDIT", "USD", "DOLLAR", "VOLATILITY", "REGIME", "TRANSMISSION", "RELATIONSHIP"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  DERIVATIVES_ANALYSIS: { domains: ["DERIVATIVES"], dataTypes: ["FUNDING", "OPEN_INTEREST", "POSITIONING", "LIQUIDATION"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  HISTORICAL_COMPARISON: { domains: ["HISTORICAL", "PRICE_MARKET", "TECHNICAL", "GENERAL"], dataTypes: ["OHLCV", "EPISODE", "OUTCOME", "CYCLE", "ANALOGUE"], freshness: ["HISTORICAL", "ANY"] },
  FALSIFICATION: { domains: ["GENERAL", "NEWS"], dataTypes: ["DISCONFIRMING", "RISK", "COUNTEREVIDENCE"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  SOURCE_VALIDATION: { domains: ["GENERAL", "NEWS"], dataTypes: ["PRIMARY", "VERIFICATION", "PROVENANCE"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  WEB_SEARCH: { domains: ["GENERAL", "NEWS", "PROJECT", "MACRO", "FUNDAMENTALS"], dataTypes: ["SEARCH", "PRIMARY", "DEVELOPMENT", "NARRATIVE", "TRANSMISSION", "RELATIONSHIP"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  CROSS_DOMAIN_SYNTHESIS: { domains: ["GENERAL"], dataTypes: ["BROAD_RESEARCH", "SYNTHESIS", "RECOVERY", "TRANSMISSION", "RELATIONSHIP", "CROSS_ASSET", "SPILLOVER", "PASS_THROUGH", "MECHANISM"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  ONCHAIN_ANALYSIS: { domains: ["ONCHAIN"], dataTypes: ["ADDRESS", "HOLDER", "TRANSACTION", "RESERVE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  DEFI_ANALYSIS: { domains: ["DEFI"], dataTypes: ["TVL", "PROTOCOL", "LIQUIDITY", "STAKING"], freshness: ["CURRENT", "RECENT"] },
  PROJECT_RESEARCH: { domains: ["PROJECT", "NEWS", "ONCHAIN", "DEFI"], dataTypes: ["DESCRIPTION", "ECOSYSTEM", "NARRATIVE", "TEAM", "ROADMAP"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
  EQUITY_MARKET_DATA: { domains: ["PRICE_MARKET", "MACRO"], dataTypes: ["PRICE", "OHLCV", "VOLUME", "QUOTE", "YIELD", "VOLATILITY", "USD", "INDEX", "RATE"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  EQUITY_FUNDAMENTALS: { domains: ["FUNDAMENTALS"], dataTypes: ["REVENUE", "MARGIN", "VALUATION", "SHARES", "BALANCE_SHEET"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  EARNINGS_CALENDAR: { domains: ["EARNINGS"], dataTypes: ["EARNINGS_DATE", "CONSENSUS", "ESTIMATE", "GUIDANCE", "REPORT"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  OPTIONS_CHAIN_ANALYSIS: { domains: ["OPTIONS"], dataTypes: ["CHAIN", "IMPLIED_VOLATILITY", "OPEN_INTEREST", "STRIKE", "POSITIONING"], freshness: ["CURRENT", "RECENT"] },
  EQUITY_NEWS: { domains: ["NEWS", "EARNINGS", "FUNDAMENTALS"], dataTypes: ["HEADLINE", "COMPANY_EVENT", "ANNOUNCEMENT", "CATALYST"], freshness: ["CURRENT", "RECENT", "HISTORICAL"] },
  LOCAL_KNOWLEDGE_RETRIEVAL: { domains: ["GENERAL"], dataTypes: ["FRAMEWORK", "SAVED_RESEARCH", "METHODOLOGY", "NOTE"], freshness: ["CURRENT", "RECENT", "HISTORICAL", "ANY"] },
};

/**
 * Capabilities that can satisfy a requirement, ranked deterministically by declared domain
 * overlap, data-type vocabulary overlap, freshness-horizon compatibility, and whether the
 * registry actually has a provider registered for them. Never inspects the question text
 * beyond the requirement itself, and never names a provider.
 */
export function capabilitiesForRequirement(
  requirement: ResearchRequirement,
  opts: { readonly isAvailable?: (cap: string) => boolean; readonly limit?: number } = {},
): readonly string[] {
  const reqTokens = meaningfulTokens(`${requirement.description} ${requirement.domains.join(" ")}`);
  const scored: { readonly cap: string; readonly score: number }[] = [];
  for (const [cap, support] of Object.entries(CAPABILITY_SUPPORT)) {
    const domainHits = support.domains.filter((d) => requirement.domains.includes(d)).length;
    if (domainHits === 0) continue;
    const freshnessOk =
      requirement.timeSensitivity === "ANY" || support.freshness.includes(requirement.timeSensitivity);
    if (!freshnessOk) continue; // a historical-only capability cannot serve a CURRENT need
    let typeHits = 0;
    for (const dt of support.dataTypes) if (reqTokens.has(dt)) typeHits += 1;
    // AVAILABILITY IS A FILTER, NOT A PREFERENCE: scheduling a capability no provider serves
    // spends a round on a guaranteed empty result (the caller's intent — "recovery never
    // schedules a capability the deployment cannot execute" — was only affecting the score).
    if (opts.isAvailable !== undefined && !opts.isAvailable(cap)) continue;
    scored.push({
      cap,
      score: domainHits * 10 + typeHits * 4 + 2 + (support.freshness.includes("ANY") ? 0 : 1),
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
  opts: { readonly isAvailable?: (cap: string) => boolean; readonly limit?: number; readonly exclude?: readonly string[] } = {},
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
  if (out.length === 0) out.push("WEB_SEARCH", "CROSS_DOMAIN_SYNTHESIS");
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
  "EARNINGS_CALENDAR", "OPTIONS_CHAIN_ANALYSIS", "EQUITY_NEWS", "DERIVATIVES_ANALYSIS",
  "ONCHAIN_ANALYSIS", "DEFI_ANALYSIS",
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

  // Source diversity: count unique providers/sources
  const uniqueSources = new Set(
    evidenceItems
      .map((e) => e.sourceProvider ?? "unknown")
      .filter((s) => s !== "unknown")
  );
  const sourceDiversity = Math.max(uniqueSources.size, 1);

  // Directness: primary sources vs secondary reporting/analysis
  const hasPrimarySource = evidenceItems.some((e) => e.sourceType === "PRIMARY");
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
