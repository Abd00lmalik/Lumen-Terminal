/**
 * DATA FACETS — the SHAPE an observation actually carries.
 *
 * WHY THIS EXISTS (research-integrity mandate). Coverage used to be a vocabulary test: a
 * requirement matched an observation when they shared ONE token, so "BITCOIN" — the asset
 * name, present on both sides — established that a CoinGecko /simple/price snapshot satisfied
 *
 *   "Retrieve Bitcoin price sequence, high, low, and volume data for the last 24 hours."
 *
 * The snapshot contains no high, no low, no open, no close, no series and no window boundary.
 * A 24h percentage change is not a high. An aggregate volume total is not a windowed volume
 * series. One timestamp is not a path.
 *
 * A facet is a property of the PAYLOAD, decided at the ingestion boundary from the data the
 * adapter actually received — never from the provider's name, never from the fact that the
 * call succeeded, and never from the question's vocabulary. Two laws follow:
 *
 *  1. SATISFACTION IS CONTENT: an observation can only serve a requirement whose demanded
 *     facets it actually carries. Subject overlap remains an ADMISSION gate (is this about my
 *     subject?), never a COVERAGE proof.
 *  2. WINDOW COVERAGE IS SEPARATE FROM FRESHNESS: a fresh quote is current, and a single
 *     instant is not the last 24 hours. Age and span are different axes and both are checked.
 *
 * Deterministic and asset-agnostic: this module names data SHAPES, never instruments,
 * providers or questions.
 */

/** The data shapes an observation can carry. */
export type DataFacet =
  /** One point-in-time reading (a spot quote, a level, a single print). */
  | "SNAPSHOT"
  /** Two or more timestamped observations — a path, a series, a trajectory. */
  | "SERIES"
  /** Per-period open and close. */
  | "OPEN"
  /** A complete open/high/low/close record for each observation. */
  | "OHLC"
  /** The high actually present in the payload (a candle's high, or an explicit 24h high). */
  | "HIGH"
  /** The low actually present in the payload. */
  | "LOW"
  /** Per-period close (or the current price, which is the last point's close). */
  | "CLOSE"
  /** Volume attached to each observation (a per-bar or per-point volume). */
  | "VOLUME"
  /**
   * A single rolling total ("24h volume", "average volume"), with no window boundary and no
   * per-observation breakdown. NOT `VOLUME`: it answers "how much traded over the provider's
   * own trailing window", which is a different question from "the volume over THIS window".
   */
  | "AGGREGATE_VOLUME"
  /** Every observation carries its own time. */
  | "TIMESTAMP"
  /** The payload states the window it covers (start/end, or a dated range). */
  | "WINDOW"
  /** A reported statement ABOUT an event (headline, announcement, analyst note). */
  | "REPORTED_EVENT";

/**
 * What each facet necessarily carries with it.
 *
 * These are the only inferences the law permits, and every one of them is a logical
 * implication of the payload's own structure:
 *  - a candle has an open, a high, a low, a close, a volume and a time,
 *  - a series is made of timestamped observations, so it implies SNAPSHOT for its last point
 *    (a path DOES contain its endpoint) but never the reverse,
 *  - an explicit window statement implies the payload knows its own bounds.
 *
 * Nothing here may infer a field the payload does not carry: `AGGREGATE_VOLUME` implies
 * nothing about `VOLUME`, and `SNAPSHOT` implies nothing about `SERIES`.
 */
const FACET_IMPLIES: Readonly<Record<DataFacet, readonly DataFacet[]>> = {
  SNAPSHOT: [],
  SERIES: ["SNAPSHOT", "TIMESTAMP"],
  OPEN: [],
  OHLC: ["OPEN", "HIGH", "LOW", "CLOSE"],
  HIGH: [],
  LOW: [],
  CLOSE: [],
  VOLUME: [],
  AGGREGATE_VOLUME: [],
  TIMESTAMP: [],
  WINDOW: [],
  REPORTED_EVENT: [],
};

/** A facet implied by carrying `facet` (transitively, with a depth guard). */
export function impliedFacets(facets: ReadonlySet<DataFacet>): ReadonlySet<DataFacet> {
  const out = new Set<DataFacet>(facets);
  for (const facet of facets) {
    for (const implied of FACET_IMPLIES[facet]) {
      if (implied === "SERIES") continue; // a single point never becomes a path
      out.add(implied);
    }
  }
  // SERIES is the one facet that is genuinely implied by a set of open/high/low/close/volume
  // fields carried by MORE THAN ONE observation: a table of candles IS a series. That is read
  // off the payload's arity at inference time (see facetsOfPayload), never assumed here.
  return out;
}

/**
 * OHLCV as one composite. Kept as a convenience alias for adapters and capability
 * declarations that describe a candle feed in one word.
 */
export const OHLCV_FACETS: readonly DataFacet[] = ["SERIES", "OPEN", "HIGH", "LOW", "VOLUME", "TIMESTAMP"];

// ---------------------------------------------------------------------------
// REQUIREMENT SIDE: what shape does this requirement demand?
// ---------------------------------------------------------------------------

/**
 * Facets a requirement demands, read from its OWN wording.
 *
 * A requirement that names no data shape (a driver row, a thesis row, a counterevidence row)
 * demands nothing and is matched exactly as before. That is deliberate: the facet law is an
 * addition to coverage, never a new vocabulary every row must satisfy.
 */
export function facetsOfRequirementText(text: string): readonly DataFacet[] {
  const out = new Set<DataFacet>();
  const t = text.toLowerCase();

  // SERIES first, and on the strongest phrasing only. "price path", "price sequence" and
  // "sequence of price movement" are explicit requests for a TRAJECTORY; a plain mention of
  // "prices" is not.
  if (
    /\b(price path|price trajectory|price sequence|price history|price series|sequence of (?:prices?|price movement)|historical prices?|hourly|daily|candles?|ohlcv|ohlc|klines?|bars?)\b/.test(t)
  ) {
    out.add("SERIES");
    out.add("TIMESTAMP");
  }
  if (/\bpath\b|\btrajectory\b|\bover (?:the|that) (?:last )?(?:\d+\s*(?:hour|day|minute|week)s?|session|period|window)\b/.test(t)) {
    out.add("SERIES");
    out.add("TIMESTAMP");
  }
  // The window's HIGH and LOW. Demanded whenever high or low is named as an observation —
  // never inferred from a percentage change or from a snapshot.
  if (/\bhigh(?:est)?\b|\bpeak\b|\bmaximum\b/.test(t)) out.add("HIGH");
  if (/\blow(?:est)?\b|\btrough\b|\bminimum\b/.test(t)) out.add("LOW");
  if (/\bopening\b|\bopen price\b|\bopen\b(?!\s+interest)/.test(t)) out.add("OPEN");
  if (/\bclosing\b|\bclose price\b|\bclose\b(?!\s+of)/.test(t)) out.add("CLOSE");
  // "current/latest price" is a SNAPSHOT ask. Independent of the shape below: a question can
  // ask for both a current reading and a windowed volume, and the two must not shadow each
  // other (an `else if` here is exactly what silently dropped the volume shape).
  if (/\bcurrent(?:ly)? (?:price|quote|level|value|reading)\b|\blatest price\b|\bspot price\b/.test(t)) {
    out.add("SNAPSHOT");
  }
  if (/\bvolume\b/.test(t)) {
    // Aggregate volume ("24h volume", "average volume", "trading volume") is only equivalent
    // to a volume series when the request is explicitly for that aggregate. A windowed volume
    // ask demands the per-observation field.
    const explicitlyAggregate =
      /\b(24 ?h|24-hour|average|aggregate|rolling)\b[^.]{0,20}\bvolume\b|\bvolume[^.]{0,20}\b(aggregate|average)\b/.test(t);
    out.add(explicitlyAggregate && requestedWindowHours(t) === undefined ? "AGGREGATE_VOLUME" : "VOLUME");
  }
  if (/\btimestamps?\b|\bdated\b|\bwhen\b|\bchronolog|\btimeline\b|\bsequence\b/.test(t)) {
    out.add("TIMESTAMP");
  }
  if (/\breported\b|\bnews\b|\bheadline|\bannouncement\b|\bpress release\b|\bstatement\b/.test(t)) {
    out.add("REPORTED_EVENT");
  }
  return [...out];
}

/**
 * The window a requirement asks for, in hours, read from its OWN wording.
 * Undefined means the requirement named no window (an instantaneous ask, or an open one).
 */
export function requestedWindowHours(text: string): number | undefined {
  const t = text.toLowerCase();
  const hourMatch = /\b(\d{1,3})\s*-?\s*(?:h|hr|hour|hours)\b/.exec(t);
  if (hourMatch?.[1] !== undefined) return Number(hourMatch[1]);
  const dayMatch = /\b(\d{1,3})\s*-?\s*(?:d|day|days)\b/.exec(t);
  if (dayMatch?.[1] !== undefined) return Number(dayMatch[1]) * 24;
  if (/\b(today|intraday|this session|the session)\b/.test(t)) return 24;
  if (/\bthis week\b|\bweek to date\b/.test(t)) return 168;
  if (/\byesterday\b/.test(t)) return 24;
  if (/\bthis month\b|\bmonth to date\b/.test(t)) return 720;
  return undefined;
}

// ---------------------------------------------------------------------------
// EVIDENCE SIDE: what shape does this payload actually carry?
// ---------------------------------------------------------------------------

const PRICE_KEYS = new Set(["price", "priceusd", "last", "lastprice", "close", "rate", "usd", "mid", "markprice", "indexprice", "value", "level", "changepct", "change24hpct", "percentchange24h", "marketcap", "marketcapusd"]);
const OPEN_KEYS = new Set(["open", "o", "openprice", "openusd"]);
const HIGH_KEYS = new Set(["high", "h", "high24h", "high_24h", "dayhigh", "highest", "high24hours"]);
const LOW_KEYS = new Set(["low", "l", "low24h", "low_24h", "daylow", "lowest", "low24hours"]);
const CLOSE_KEYS = new Set(["close", "c", "last", "lastprice", "closeprice", "closeusd", "price", "priceusd"]);
const VOLUME_KEYS = new Set(["volume", "vol", "basevol", "quotevol", "volumes", "volumefrom", "volumeto", "volumeusd", "basevolume", "quotevolume", "amount"]);
const AGGREGATE_VOLUME_KEYS = new Set(["usd24hvol", "volumes24h", "volume24h", "totalvolume", "avgvolume", "averagevolume", "volumetotal", "quote24hvol", "volume24husd", "volumeusd24h", "totalvolumebase", "totalvolumequote"]);
const TIMESTAMP_KEYS = new Set(["ts", "time", "timestamp", "datetime", "date", "asof", "openTime", "opentime", "closetime", "lastupdatedat", "t"]);
const WINDOW_KEYS = new Set(["from", "to", "start", "end", "starttime", "endtime", "since", "until", "window", "range", "fromms", "toms"]);

/** A candle/observation row: a time plus at least one price-like field. */
function rowFacets(row: Record<string, unknown>): Set<DataFacet> {
  const out = new Set<DataFacet>();
  const keys = new Set(Object.keys(row).map((k) => k.toLowerCase()));
  const has = (set: ReadonlySet<string>) => [...set].some((k) => keys.has(k));
  if (has(OPEN_KEYS)) out.add("OPEN");
  if (has(HIGH_KEYS)) out.add("HIGH");
  if (has(LOW_KEYS)) out.add("LOW");
  if (has(CLOSE_KEYS)) out.add("CLOSE");
  if (out.has("OPEN") && out.has("HIGH") && out.has("LOW") && out.has("CLOSE")) out.add("OHLC");
  if ([...VOLUME_KEYS].some((k) => keys.has(k))) out.add("VOLUME");
  // An aggregate total is its OWN shape and never also a per-observation volume field: a
  // rolling "24h volume" says how much traded over the provider's window, and says nothing
  // about any single observation.
  if ([...AGGREGATE_VOLUME_KEYS].some((k) => keys.has(k))) out.add("AGGREGATE_VOLUME");
  if ([...TIMESTAMP_KEYS].some((k) => keys.has(k))) out.add("TIMESTAMP");
  if ([...WINDOW_KEYS].some((k) => keys.has(k))) out.add("WINDOW");
  // A row with a price-like field is at minimum a point reading, whatever else it carries.
  // A quote that also happens to report market cap or a 24h change is STILL one instant.
  if ([...PRICE_KEYS].some((k) => keys.has(k))) out.add("SNAPSHOT");
  return out;
}

/** Union of the facets of every row; arity decides SERIES. */
function tableFacets(rows: readonly Record<string, unknown>[]): Set<DataFacet> {
  const out = new Set<DataFacet>();
  for (const row of rows) for (const facet of rowFacets(row)) out.add(facet);
  // MORE THAN ONE priced observation is a path. One observation is never a series, however
  // many fields it carries.
  const priced = rows.filter((row) => {
    const keys = new Set(Object.keys(row).map((k) => k.toLowerCase()));
    return [...PRICE_KEYS].some((k) => keys.has(k)) || [...CLOSE_KEYS].some((k) => keys.has(k));
  });
  if (priced.length > 1) out.add("SERIES");
  return out;
}

/** Is this array a table of observations, or just a list of strings/objects? */
function observationRows(value: readonly unknown[]): readonly Record<string, unknown>[] {
  return value.filter(
    (v): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0,
  );
}

/**
 * Facets carried by a raw adapter payload.
 *
 * This is CONTENT INSPECTION of what the provider actually returned. It never consults the
 * provider's identity: a provider that upgrades to OHLCV gains the facets here without a
 * single registry edit, and a provider that quietly returns a spot snapshot cannot keep them.
 */
export function facetsOfPayload(content: unknown): readonly DataFacet[] {
  if (Array.isArray(content)) {
    const rows = observationRows(content);
    if (rows.length === 0) return [];
    return [...tableFacets(rows)];
  }
  if (typeof content !== "object" || content === null) return [];
  const row = content as Record<string, unknown>;
  // A payload that nests its observations under a conventional key is still a table.
  for (const key of ["candles", "klines", "ohlcv", "data", "prices", "series", "points", "bars", "result", "items"]) {
    const nested = row[key];
    if (Array.isArray(nested)) {
      const rows = observationRows(nested);
      if (rows.length > 0) {
        const out = tableFacets(rows);
        for (const facet of rowFacets(row)) out.add(facet);
        return [...out];
      }
    }
  }
  return [...rowFacets(row)];
}

/**
 * Facets an observation serves, from the EXPLICIT declaration when the adapter made one and
 * otherwise from the payload's own shape.
 *
 * A REPORTED_CLAIM is a claim ABOUT the world: its domain decides, and it never inherits the
 * facets of the numbers quoted inside a headline. This is what stops "Bitcoin price movement
 * was heavy" from serving a market-data high/low requirement through vocabulary alone.
 */
export interface ShapeInput {
  readonly text: string;
  readonly dataFacets?: readonly DataFacet[];
  /** Reported-vs-observed classification resolved at the ingestion boundary. */
  readonly reported?: boolean;
  /** The evidence domain the layer already derived (NEWS for a headline). */
  readonly newsDomain?: boolean;
  /** The layer's evidence-type tag, when no domain has been derived for it yet. */
  readonly evidenceType?: string;
  readonly sourceType?: string;
}

/**
 * A REPORTED claim carries no market-data shape. The evidence type is consulted here only when
 * no domain was derived for it, so a caller that already resolved the domain never re-decides it.
 */
function isReportedShape(input: ShapeInput): boolean {
  if (input.reported === true || input.newsDomain === true) return true;
  // Only an EXPLICIT reporting kind makes an item a claim. "no declared source type" is an
  // absence of metadata, not a demotion, and must never strip a quantitative feed's shapes.
  if (input.sourceType === "SECONDARY" || input.sourceType === "COMMUNITY" || input.sourceType === "ANALYSIS") return true;
  if (input.newsDomain === undefined && typeof input.evidenceType === "string") {
    return /\b(news|headline|rss|article|press)\b/i.test(input.evidenceType);
  }
  return false;
}

export function servedFacetsOf(input: ShapeInput): ReadonlySet<DataFacet> {
  if (isReportedShape(input)) return new Set<DataFacet>(["REPORTED_EVENT"]);
  const declared = input.dataFacets;
  if (declared !== undefined) return impliedFacets(new Set<DataFacet>(declared));
  return impliedFacets(new Set<DataFacet>(facetsOfPayload(safeParse(input.text))));
}

/** Alias used by callers that pass a coverage item straight through. */
export const servedFacets = servedFacetsOf;

function safeParse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

/**
 * Facets a requirement demands, after implication. A row that demands SERIES thereby demands
 * SNAPSHOT and TIMESTAMP too (every path has endpoints and times); it never thereby demands a
 * high, a low or a volume, which is why a candle-free quote can never close a path row.
 */
export function requiredFacetsOf(facets: readonly DataFacet[]): ReadonlySet<DataFacet> {
  return impliedFacets(new Set<DataFacet>(facets));
}

/**
 * The facets whose coverage is a question of SPAN rather than of age.
 *
 * A 24-hour high, a 24-hour volume and an hourly price sequence are claims about a WINDOW: only
 * data reaching back across it can establish them. A REPORTED_CLAIM is not — a dated item inside
 * the window is exactly what answers it, and its position is already governed by the freshness
 * law. An instantaneous SNAPSHOT has no span at all, so demanding one of it would be nonsense.
 */
export const SPAN_FACETS: ReadonlySet<DataFacet> = new Set<DataFacet>([
  "SERIES",
  "OHLC",
  "HIGH",
  "LOW",
  "OPEN",
  "CLOSE",
  "VOLUME",
  "WINDOW",
]);

/** Does this demand need evidence that REACHES BACK across the requested window? */
export function demandsSpan(required: ReadonlySet<DataFacet>): boolean {
  for (const facet of required) if (SPAN_FACETS.has(facet)) return true;
  return false;
}

/** Coverage of a requirement's demanded facets by an observation's served facets. */
export type FacetCoverage = "FULL" | "PARTIAL" | "NONE";

export function facetCoverage(required: ReadonlySet<DataFacet>, served: ReadonlySet<DataFacet>): FacetCoverage {
  if (required.size === 0) return "FULL";
  let covered = 0;
  for (const facet of required) if (served.has(facet)) covered += 1;
  if (covered === 0) return "NONE";
  return covered === required.size ? "FULL" : "PARTIAL";
}

/**
 * WINDOW COVERAGE LAW: an observation that spans `observedHours` of time can serve a
 * windowed requirement only when it actually reaches back across that window.
 *
 * The span is measured on the payload's own timestamps — never on the age of the newest point,
 * which is why a snapshot fetched one second ago spans ZERO hours and cannot answer "the last
 * 24 hours".
 */
export function windowCovers(requirementHours: number | undefined, observedHours: number | undefined): boolean {
  if (requirementHours === undefined) return true;
  if (observedHours === undefined) return false;
  // One observation bar's own width is not elapsed span: a 24x1h candle set spans 24h from
  // its first open to the close of its last bar, and the adapter reports the span it computed.
  return observedHours + 1e-9 >= requirementHours;
}