/**
 * Freshness profiles for the Bitget skills; derived from FINDINGS.md §2 (CONFIRMED lags)
 * and exposed per adapter (final lock §8: "Add freshness profiles based on FINDINGS.md").
 *
 * Freshness is metadata on every TOOL_RESULT; assessed, never assumed. Each profile maps a
 * documented data lag to a verdict:
 *   CURRENT   ; within the profile's freshness window
 *   STALE     ; outside the window (still usable, but the limitation must travel with it)
 *   HISTORICAL; explicitly historical request (event time intentionally in the past)
 *
 * Tool failure is never freshness: a failed call produces no evidence at all (lock §10).
 */

export type FreshnessVerdict = "CURRENT" | "STALE" | "HISTORICAL";

export interface FreshnessProfile {
  /** Stable profile id, e.g. "rss:15-60min". */
  readonly id: string;
  /** Documented lag, from FINDINGS.md §2 (kept verbatim for provenance). */
  readonly documentedLag: string;
  /** Max acceptable age (ms) before data counts as STALE. */
  readonly staleAfterMs: number;
  /** Whether data older than staleAfterMs should downgrade to HISTORICAL instead. */
  readonly historicalAfterMs?: number;
}

/** FINDINGS.md §2; all CONFIRMED, with the source dimension noted. */
export const FRESHNESS_PROFILES = {
  /** §2.5 news-briefing: RSS updates every 15–60 min; not real-time. */
  rss: {
    id: "rss:15-60min",
    documentedLag: "RSS feed updates every 15-60 minutes (FINDINGS.md §2.5); not real-time",
    staleAfterMs: 60 * 60 * 1000,
  },
  /** §2.3 sentiment-analyst: community data ~15 min lag. */
  community: {
    id: "community:~15min",
    documentedLag: "community/sentiment data ~15 min lag (FINDINGS.md §2.3)",
    staleAfterMs: 30 * 60 * 1000,
  },
  /** §2.4 technical-analysis: kline timestamps are exact; interval-aware windows. */
  technical: {
    id: "technical:kline-exact",
    documentedLag: "kline timestamps are exact; freshness judged against interval (FINDINGS.md §2.4)",
    staleAfterMs: 5 * 60 * 1000,
  },
  /** §2.1 macro-analyst: economic data has 1–2 day release lag. */
  macro: {
    id: "economic-release:1-2d-lag",
    documentedLag: "economic data has 1-2 day release lag (FINDINGS.md §2.1); prices stale on weekends",
    staleAfterMs: 48 * 60 * 60 * 1000,
  },
  /** §2.2 market-intel: live public data; no documented refresh cadence. */
  marketStructure: {
    id: "market-structure:live",
    documentedLag: "live public data; refresh cadence undocumented (FINDINGS.md §2.2)",
    staleAfterMs: 10 * 60 * 1000,
  },
} as const satisfies Record<string, FreshnessProfile>;

export type ProfileKey = keyof typeof FRESHNESS_PROFILES;

/**
 * Assess freshness of a result whose data has an observed/source timestamp.
 * `asOf` = now (or a fixed test clock). Event time older than staleAfterMs → STALE;
 * older than historicalAfterMs (when set) → HISTORICAL.
 */
export function assessFreshness(
  profile: FreshnessProfile,
  sourceTimestamp: string | undefined,
  asOf = new Date(),
): FreshnessVerdict {
  if (sourceTimestamp === undefined) {
    // No event time available: the profile's documented lag is the only honest statement.
    return "CURRENT";
  }
  const eventTime = Date.parse(sourceTimestamp);
  if (Number.isNaN(eventTime)) return "CURRENT";
  const age = asOf.getTime() - eventTime;
  if (age > (profile.historicalAfterMs ?? Number.POSITIVE_INFINITY)) return "HISTORICAL";
  if (age > profile.staleAfterMs) return "STALE";
  return "CURRENT";
}

/** Convenience: assess and attach the profile's documented lag to TOOL_RESULT limitations. */
export function freshnessLimitations(profile: FreshnessProfile, verdict: FreshnessVerdict): readonly string[] {
  if (verdict === "STALE") return [`stale relative to profile ${profile.id}: ${profile.documentedLag}`];
  if (verdict === "HISTORICAL") return [`historical relative to profile ${profile.id}: ${profile.documentedLag}`];  return [`freshness profile ${profile.id}: ${profile.documentedLag}`];
}
