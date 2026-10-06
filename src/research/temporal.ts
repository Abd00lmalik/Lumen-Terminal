/**
 * TEMPORAL INTENT — one general, asset-agnostic reading of a question's time dimension.
 *
 * The engine grew several partial window parsers (`requestedWindowHours` in data-facets.ts,
 * `EXPLICIT_WINDOWS` and `timeSensitivityOf` in requirements.ts, `TEMPORAL_WINDOWS` in
 * question-resolution.ts), each recognising a handful of phrases. Temporal intent is a
 * first-class research dimension, so it lives in ONE place with ONE vocabulary, and every
 * consumer derives its answer from here instead of re-listing phrases.
 *
 * A temporal intent is more than an hour count. A question can ask for:
 *   - a ROLLING window      "the last 24 hours", "the past 7 days", "the last hour"
 *   - a CALENDAR period     "today", "this week", "this month", "year to date"
 *   - an EXPLICIT RANGE     "2020-2021", "between 2020 and 2021"
 *   - a SINCE anchor        "since the breakout", "since the halving", "since my thesis"
 *   - a COUNT of episodes   "the previous three occurrences", "the last two cycles"
 *   - an INSTANT            "right now", "the current price"
 *
 * Only the first three resolve to a fixed number of HOURS (what the window-coverage law needs).
 * SINCE, OCCURRENCES and INSTANT are deliberately open-ended: they are not a duration, and
 * pretending otherwise would let a provider silently substitute a different span.
 *
 * Deterministic and asset-agnostic: it names time words, never instruments, providers or
 * questions. The one clock read (year-to-date) is injectable, so the parser stays testable.
 */

/** The shape of a question's time dimension. */
export type TemporalKind =
  | "INSTANT"
  | "ROLLING"
  | "CALENDAR"
  | "RANGE"
  | "SINCE"
  | "OCCURRENCES"
  | "OPEN";

export interface TemporalIntent {
  readonly kind: TemporalKind;
  /** Lookback in hours, for ROLLING/CALENDAR. Undefined for the open-ended kinds. */
  readonly hours?: number;
  /** The anchor phrase, for SINCE ("the breakout", "my thesis was created"). */
  readonly anchor?: string;
  /** Inclusive start/end years, for RANGE. */
  readonly from?: number;
  readonly to?: number;
  /** Episode count, for OCCURRENCES. */
  readonly count?: number;
  /** The phrase that produced this intent (diagnostics; never a prompt). */
  readonly phrase?: string;
}

const YEAR = 8_760; // hours in a 365-day year; a range's span only needs to be right to a year
const MONTH = 720;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** A quantity/unit pair -> hours, or undefined when the unit is not a time unit. */
function hoursFor(amount: number, unit: string): number | undefined {
  const u = unit.toLowerCase();
  if (u === "minute" || u === "minutes" || u === "min" || u === "mins" || u === "m") return amount / 60;
  if (u === "hour" || u === "hours" || u === "hr" || u === "hrs" || u === "h") return amount;
  if (u === "day" || u === "days" || u === "d") return amount * 24;
  if (u === "week" || u === "weeks" || u === "w") return amount * 168;
  if (u === "month" || u === "months" || u === "mo") return amount * MONTH;
  return undefined;
}

/** Hours from midnight UTC of `now`'s own year to `now`: the "year to date" window. */
function yearToDateHours(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  return Math.max(0, (now.getTime() - start) / 3_600_000);
}

/**
 * The temporal intent of a text, read from its own wording. Order is most-specific first: an
 * explicit range outranks a rolling window, which outranks a bare calendar word, which
 * outranks the instant fallback.
 */
export function temporalIntentOf(text: string, now: Date = new Date()): TemporalIntent {
  const t = text.toLowerCase();

  // 1. EXPLICIT RANGE — "2020-2021", "between 2020 and 2021", "from 2018 to 2020".
  const range = /\b((?:19|20)\d{2})\s*(?:-|–|—|to|through|until|and)\s*((?:19|20)\d{2})\b/.exec(t);
  if (range?.[1] !== undefined && range[2] !== undefined) {
    return { kind: "RANGE", from: Number(range[1]), to: Number(range[2]), phrase: range[0] };
  }

  // 2. SINCE ANCHOR — "since the breakout", "since the halving", "since my thesis was created".
  //    A year after "since" is an anchor too, not a range.
  const since = /\bsince\s+([^,.;?!]{1,48})/.exec(t);
  if (since?.[1] !== undefined) {
    const anchor = since[1].trim().replace(/\s+/g, " ");
    return { kind: "SINCE", ...(anchor !== "" ? { anchor } : {}), phrase: since[0].trim() };
  }

  // 3. OCCURRENCES — "the previous three occurrences", "the last two cycles", "the past 5 times".
  const occ = /\b(?:previous|last|prior|past|preceding)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:occurrences?|times?|instances?|episodes?|cycles?|setups?|cases?)\b/.exec(t);
  if (occ?.[1] !== undefined) {
    const raw = occ[1];
    const count = NUMBER_WORDS[raw] ?? Number(raw);
    if (Number.isFinite(count) && count > 0) {
      return { kind: "OCCURRENCES", count, phrase: occ[0] };
    }
  }

  // 4. ROLLING WINDOW — with a stated quantity.
  const rolling = /\b(?:last|past|previous|trailing|over the last|over the past|in the last|in the past|for the last|for the past|during the last|during the past)\s+(\d{1,3})\s*-?\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|min|m|h|d|w|mo)\b/.exec(t);
  if (rolling?.[1] !== undefined && rolling[2] !== undefined) {
    const hours = hoursFor(Number(rolling[1]), rolling[2]);
    if (hours !== undefined) return { kind: "ROLLING", hours, phrase: rolling[0] };
  }
  // A bare quantity+unit ("the 24-hour window", "a 7-day view", "30 minutes of data").
  const bare = /\b(\d{1,3})\s*-?\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|min|h|d|w|mo)\b/.exec(t);
  if (bare?.[1] !== undefined && bare[2] !== undefined) {
    const hours = hoursFor(Number(bare[1]), bare[2]);
    if (hours !== undefined) return { kind: "ROLLING", hours, phrase: bare[0] };
  }

  // 4b. ROLLING WINDOW — a unit word with no quantity ("the last hour", "the past week").
  const rollingUnit = /\b(?:last|past|previous|trailing|over the last|over the past|in the last|in the past|for the last|for the past)\s+(minute|hour|day|week|month)\b/.exec(t);
  if (rollingUnit?.[1] !== undefined) {
    const hours = hoursFor(1, rollingUnit[1]);
    if (hours !== undefined) return { kind: "ROLLING", hours, phrase: rollingUnit[0] };
  }

  // 5. CALENDAR PERIOD — a named period relative to now.
  if (/\byear[- ]to[- ]date\b|\bytd\b|\bthis year\b|\bso far this year\b/.test(t)) {
    return { kind: "CALENDAR", hours: yearToDateHours(now), phrase: "year to date" };
  }
  if (/\bthis month\b|\bmonth[- ]to[- ]date\b|\bmonth to date\b|\bthis month's\b/.test(t)) {
    return { kind: "CALENDAR", hours: MONTH, phrase: "this month" };
  }
  if (/\bthis week\b|\bweek[- ]to[- ]date\b|\bweek to date\b|\bthis week's\b/.test(t)) {
    return { kind: "CALENDAR", hours: 168, phrase: "this week" };
  }
  if (/\b(today|tonight|yesterday|intraday|this session|the session|today's)\b/.test(t)) {
    return { kind: "CALENDAR", hours: 24, phrase: "today" };
  }

  // 6. INSTANT — an observation of now, with no window at all.
  if (/\b(right now|at the moment|this very moment|as of now|currently|spot price|current price|current level|latest price|current quote)\b/.test(t)) {
    return { kind: "INSTANT", phrase: "now" };
  }

  return { kind: "OPEN" };
}

/**
 * The window (in hours) a temporal intent resolves to, or undefined when it does not name a
 * fixed duration. SINCE, OCCURRENCES and INSTANT are open-ended by construction: they are not
 * a lookback, and returning a made-up number for them is how a provider would silently
 * substitute a different span.
 */
export function temporalWindowHours(intent: TemporalIntent): number | undefined {
  switch (intent.kind) {
    case "ROLLING":
    case "CALENDAR":
      return intent.hours;
    case "RANGE":
      return intent.from !== undefined && intent.to !== undefined ? (intent.to - intent.from + 1) * YEAR : undefined;
    case "SINCE":
    case "OCCURRENCES":
    case "INSTANT":
    case "OPEN":
      return undefined;
  }
}

/**
 * The window (in hours) a text names, in one call. Backed by `temporalIntentOf`, so every
 * phrase the generalized parser understands is understood here too.
 */
export function requestedWindowHoursOf(text: string, now?: Date): number | undefined {
  return temporalWindowHours(temporalIntentOf(text, now));
}

/**
 * Does the text name a temporal dimension at all (a window, a range, an anchor or an instant)?
 * Used to distinguish "the last 24 hours" from a question that names no time at all.
 */
export function namesTemporalDimension(intent: TemporalIntent): boolean {
  return intent.kind !== "OPEN";
}

/** A short human-readable rendering of a temporal intent (diagnostics; never a prompt). */
export function describeTemporalIntent(intent: TemporalIntent): string {
  switch (intent.kind) {
    case "ROLLING": return `rolling window of ${intent.hours ?? "?"} hours${intent.phrase !== undefined ? ` (${intent.phrase})` : ""}`;
    case "CALENDAR": return `calendar period of ${intent.hours ?? "?"} hours${intent.phrase !== undefined ? ` (${intent.phrase})` : ""}`;
    case "RANGE": return `explicit range ${intent.from ?? "?"}-${intent.to ?? "?"}`;
    case "SINCE": return `since ${intent.anchor ?? "an anchor"}`;
    case "OCCURRENCES": return `the previous ${intent.count ?? "?"} occurrences`;
    case "INSTANT": return "the present instant (no window)";
    case "OPEN": return "no named time dimension";
  }
}
