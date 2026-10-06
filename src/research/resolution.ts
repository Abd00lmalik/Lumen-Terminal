/**
 * RESOLUTION — the GRANULARITY of an observation.
 *
 * SPAN and RESOLUTION are different axes, and the engine only ever had the first:
 *   - SPAN (`coverageHours`) asks "how far back does this data reach?" — a 24x1h candle set
 *     reaches 24 hours back.
 *   - RESOLUTION asks "how finely is that time sampled?" — the same 24-hour reach can be
 *     served by 1-minute candles, hourly candles, or two daily candles, and those are three
 *     different answers to "give me the price path over the last 24 hours".
 *
 * Without this axis, `SERIES` was resolution-free: a DAILY candle set satisfied a request for
 * an HOURLY sequence, because both are "a series that spans the window". That is the same class
 * of defect as a snapshot satisfying a 24-hour high: the evidence carried the *shape* the row
 * named and not the *detail* it named.
 *
 * THE LAW (mirror of the window law, and deliberately conservative):
 *   - A requirement that names an explicit resolution ("hourly", "daily", "15-minute") may be
 *     satisfied only by evidence whose own resolution is AT LEAST AS FINE (served rank <=
 *     required rank). A daily candle never satisfies an hourly-sequence requirement.
 *   - A requirement that names NO resolution is not subject to the gate; its window still is.
 *     Resolution is a request-side signal for provider selection (the engine asks for an
 *     interval appropriate to the horizon) and never a new vocabulary every row must satisfy.
 *   - When the requirement names a resolution and the observation's resolution cannot be
 *     determined, the gate refuses: an unproven resolution is not a proven fine enough one.
 *
 * Deterministic and asset-agnostic: this module names TIME MAGNITUDES, never instruments,
 * providers or questions.
 */

/** How finely a window is sampled. Ordered finest (TICK) to coarsest (MONTH). */
export type Resolution = "TICK" | "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH";

/** Rank ordering: a SMALLER rank is FINER. */
const RANK: Readonly<Record<Resolution, number>> = {
  TICK: 0,
  MINUTE: 1,
  HOUR: 2,
  DAY: 3,
  WEEK: 4,
  MONTH: 5,
};

/** A resolution named explicitly by a text's own wording, if any. */
const UNIT_WORDS: readonly (readonly [Resolution, RegExp])[] = [
  ["TICK", /\b(?:tick|tick[- ]by[- ]tick|per[- ]tick|second|seconds|secondly|real[- ]?time tick)\b/i],
  ["MINUTE", /\b(?:minute|minutes|minutely|15[- ]?minute|5[- ]?minute|1[- ]?minute)\b/i],
  ["HOUR", /\b(?:hour|hours|hourly)\b/i],
  ["DAY", /\b(?:day|days|daily)\b/i],
  ["WEEK", /\b(?:week|weeks|weekly)\b/i],
  ["MONTH", /\b(?:month|months|monthly)\b/i],
];

/**
 * The resolution a text NAMES, or undefined when it names none.
 *
 * When a text names several, the FINEST named wins: a request for "hourly candles over the
 * last 30 days" names hour and day, and it is an hourly request. The window ("30 days") is a
 * separate axis and is read elsewhere.
 */
export function namedResolutionOf(text: string): Resolution | undefined {
  let finest: Resolution | undefined;
  for (const [res, re] of UNIT_WORDS) {
    if (!re.test(text)) continue;
    if (finest === undefined || RANK[res] < RANK[finest]) finest = res;
  }
  return finest;
}

/** Bucket a sampling interval (milliseconds) into a resolution. */
export function resolutionOfDurationMs(ms: number): Resolution {
  if (!Number.isFinite(ms) || ms <= 0) return "TICK";
  if (ms <= 5_000) return "TICK";
  if (ms <= 30 * 60_000) return "MINUTE";
  if (ms <= 6 * 3_600_000) return "HOUR";
  if (ms <= 3 * 86_400_000) return "DAY";
  if (ms <= 21 * 86_400_000) return "WEEK";
  return "MONTH";
}

/** Unit vocabulary -> milliseconds, for a timeframe/interval token like "15m", "4h", "1d", "1w". */
function unitMs(amount: number, unit: string): number | undefined {
  const u = unit.toLowerCase();
  if (u === "s" || u === "sec" || u === "secs" || u === "second" || u === "seconds") return amount * 1_000;
  if (u === "m" || u === "min" || u === "mins" || u === "minute" || u === "minutes") return amount * 60_000;
  if (u === "h" || u === "hr" || u === "hrs" || u === "hour" || u === "hours") return amount * 3_600_000;
  if (u === "d" || u === "day" || u === "days") return amount * 86_400_000;
  if (u === "w" || u === "week" || u === "weeks") return amount * 7 * 86_400_000;
  if (u === "mo" || u === "month" || u === "months") return amount * 30 * 86_400_000;
  return undefined;
}

/**
 * Resolution of a declared bar size ("1h", "4h", "15m", "1d", "1w"), or undefined when the
 * token is not a bar size this module understands.
 */
export function resolutionOfTimeframe(timeframe: string | undefined): Resolution | undefined {
  if (timeframe === undefined) return undefined;
  const token = timeframe.trim();
  if (token === "") return undefined;
  const match = /^(\d{1,4})\s*([A-Za-z]+)$/.exec(token);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const ms = unitMs(Number(match[1]), match[2]);
    if (ms !== undefined) return resolutionOfDurationMs(ms);
  }
  // A token that names a unit without an amount ("hourly", "daily").
  return namedResolutionOf(token);
}

/**
 * Resolution measured from a payload's OWN timestamps: the median gap between consecutive
 * observations. One print has no gap and therefore no resolution — which is the honest answer,
 * because a single instant is not sampled at ANY granularity.
 */
export function resolutionOfStamps(stamps: readonly number[]): Resolution | undefined {
  if (stamps.length < 2) return undefined;
  const sorted = [...stamps].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const delta = sorted[i]! - sorted[i - 1]!;
    if (delta > 0) gaps.push(delta);
  }
  if (gaps.length === 0) return undefined;
  gaps.sort((a, b) => a - b);
  return resolutionOfDurationMs(gaps[Math.floor(gaps.length / 2)]!);
}

/**
 * RESOLUTION COVERAGE LAW. `served` establishes a requirement that asked for `required` only
 * when it is the same resolution or FINER. A finer resolution always answers a coarser ask.
 */
export function resolutionCovers(required: Resolution, served: Resolution | undefined): boolean {
  if (served === undefined) return false;
  return RANK[served] <= RANK[required];
}

/** The canonical provider interval token for a resolution (used to request the right bars). */
export function intervalTokenFor(resolution: Resolution): string {
  switch (resolution) {
    case "TICK": return "1min";
    case "MINUTE": return "1min";
    case "HOUR": return "1h";
    case "DAY": return "1d";
    case "WEEK": return "1w";
    case "MONTH": return "1M";
  }
}

/**
 * The resolution a window of `hours` implies for a SERIES request, when no explicit resolution
 * is named. This drives PROVIDER SELECTION (what interval to ask for), never the coverage gate:
 * a short window wants fine bars, a multi-year window wants coarse ones.
 */
export function impliedResolutionForWindow(hours: number | undefined): Resolution | undefined {
  if (hours === undefined) return undefined;
  if (hours <= 6) return "MINUTE";
  if (hours <= 72) return "HOUR";
  if (hours <= 24 * 45) return "DAY";
  if (hours <= 24 * 120) return "WEEK";
  return "MONTH";
}

/** Is this a resolution this module knows? (Guards untyped data crossing the boundary.) */
export function isResolution(value: unknown): value is Resolution {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RANK, value);
}
