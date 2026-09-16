/**
 * Flow 5 historical-episode analysis; deterministic, look-ahead-safe.
 *
 * Architectural basis:
 * - research-flows.md FLOW 5: the answer to "Has this happened before?" is a set of past
 *   analogous episodes with explained similarity and documented subsequent outcomes; NOT a
 *   prediction. Mandate laws honored here:
 *   - §5 EXPLAINABILITY: similarity is never a bare score; every match names the dimensions
 *     that matched, the dimensions that differed, the compared periods, and the evidence.
 *   - §7 CURRENT SETUP: the comparison target is stated explicitly (trend/momentum/volatility/
 *     range position); computed ONLY from the historical record itself (the trailing segment
 *     of the retrieved window), never invented, never silently pulled from other capabilities.
 *     When no current-setup evidence exists in the record, the analysis says so.
 *   - §8 OUTCOMES: subsequent windows (7/14/30 days here) report forward return, max favorable
 *     excursion (MFE), max adverse excursion (MAE), and whether direction persisted; historical
 *     description, not a trading strategy.
 *   - §9 LOOK-AHEAD BIAS: episode features are computed strictly from candles at or before the
 *     episode's anchor day. Future candles enter ONLY the outcome analysis. `analyzeEpisodes`
 *     takes the reference segment explicitly so leakage is structurally impossible; the
 *     reference segment is NEVER part of the episode candidate pool.
 * - Evidence integrity: everything here is arithmetic over REAL G1 candles (QUANTITATIVE_
 *   OBSERVATIONs). No model input, no invented data. Gemini may later interpret the validated
 *   result (§10); it never produces it.
 *
 * Volume note: Bitget/Vision payloads carry baseVolume; if a candle lacks it, volume dimensions
 * are reported as unavailable; never substituted with another feature (mandate §5).
 */

/** A single daily candle as stored by the G1 adapter (verbatim inside monthly chunks). */
export interface AnalysisCandle {
  readonly openTime: string; // ISO
  readonly closeTime: string; // ISO
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly baseVolume?: number;
}

export interface EpisodeFeatures {
  /** Absolute % change of close over the episode window. */
  readonly movePct: number;
  /** Sign of the move: "up" | "down" | "flat". */
  readonly direction: "up" | "down" | "flat";
  /** Annualized-style daily volatility: mean absolute daily return over the window, in %. */
  readonly volatilityPct: number;
  /** Max drawdown from the window's running high, in %. */
  readonly drawdownPct: number;
  /** Momentum: last-3-day close change, in %. */
  readonly momentum3dPct: number;
  /** Range expansion: window's average daily range vs the pre-window baseline, ratio. */
  readonly rangeExpansion: number;
  /** Position of the final close within the window's total range (0=low, 1=high). */
  readonly rangePosition: number;
  /** Average daily base volume vs pre-window baseline, ratio (undefined when volume missing). */
  readonly volumeRatio: number | undefined;
  readonly volumeAvailable: boolean;
}

export interface OutcomeWindow {
  readonly days: number;
  /** Close-to-close return over the window, in %. */
  readonly forwardReturnPct: number;
  /** Max favorable excursion from anchor close within the window, in %. */
  readonly mfePct: number;
  /** Max adverse excursion from anchor close within the window, in %. */
  readonly maePct: number;
  /** Did the episode's direction persist through the window? */
  readonly directionPersisted: boolean;
}

export interface HistoricalEpisode {
  /** Anchor day (episode end = feature window end); ISO date. */
  readonly anchorDate: string;
  /** ISO dates of the feature window [start, end]. */
  readonly window: { from: string; to: string };
  readonly features: EpisodeFeatures;
  /** Subsequent-outcome windows (computed from FUTURE candles; never used for matching). */
  readonly outcomes: readonly OutcomeWindow[];
  /** Evidence references (tool-result-backed evidence ids) covering this episode. */
  readonly evidenceRefs: readonly string[];
}

export interface SimilarityDimension {
  readonly dimension: string;
  readonly referenceValue: string;
  readonly episodeValue: string;
  readonly matched: boolean;
}

export interface EpisodeMatch {
  readonly episode: HistoricalEpisode;
  /** Count of matched dimensions; never surfaced alone, always with the breakdown. */
  readonly matchedCount: number;
  readonly dimensions: readonly SimilarityDimension[];
  readonly differences: readonly string[];
}

export interface CurrentSetup {
  readonly asOf: string;
  readonly trendState: string;
  readonly momentumState: string;
  readonly volatilityState: string;
  readonly rangePositionState: string;
  readonly volumeState: string;
  readonly basis: string;
}

export interface EpisodeAnalysis {
  readonly currentSetup: CurrentSetup | undefined;
  readonly episodesEvaluated: number;
  readonly matches: readonly EpisodeMatch[];
  readonly interpretiveNote: string;
}

// ---------------------------------------------------------------------------
// Feature extraction; strictly uses candles up to and including the anchor.
// ---------------------------------------------------------------------------

const EPISODE_WINDOW_DAYS = 10;

interface CandleSeries {
  readonly candles: readonly AnalysisCandle[]; // ascending by openTime
  readonly closes: readonly number[];
  readonly times: readonly string[];
}

function toSeries(candles: readonly AnalysisCandle[]): CandleSeries {
  // One candle per calendar day: the analysis is daily-candle-based, and venue pagination
  // can overlap. Keep the LAST occurrence per date (most recent write wins) and sort ascending.
  const byDate = new Map<string, AnalysisCandle>();
  for (const c of candles) byDate.set(c.openTime.slice(0, 10), c);
  const sorted = [...byDate.values()].sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime));
  return {
    candles: sorted,
    closes: sorted.map((c) => c.close),
    times: sorted.map((c) => c.openTime),
  };
}

function pct(from: number, to: number): number {
  return from === 0 ? 0 : ((to - from) / from) * 100;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function fmt(value: number): string {
  return `${round(value)}%`;
}

/**
 * Extract episode features for the window ENDING at `anchorIndex` (inclusive), spanning
 * EPISODE_WINDOW_DAYS candles. A pre-window baseline (the EPISODE_WINDOW_DAYS candles BEFORE
 * the window) anchors volatility/range/volume ratios. Returns undefined when there is not
 * enough history before the anchor for the baseline (prevents window-edge artifacts).
 */
export function extractEpisodeFeatures(
  series: CandleSeries,
  anchorIndex: number,
): EpisodeFeatures | undefined {
  const windowStart = anchorIndex - EPISODE_WINDOW_DAYS + 1;
  const baselineStart = windowStart - EPISODE_WINDOW_DAYS;
  if (windowStart < 0 || baselineStart < 0) return undefined;

  const window = series.candles.slice(windowStart, anchorIndex + 1);
  const baseline = series.candles.slice(baselineStart, windowStart);
  if (window.length < EPISODE_WINDOW_DAYS || baseline.length < EPISODE_WINDOW_DAYS) return undefined;

  const first = window[0]!;
  const last = window[window.length - 1]!;
  const closes = window.map((c) => c.close);
  const dailyReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push(Math.abs(pct(closes[i - 1]!, closes[i]!)));
  }

  let runningHigh = window[0]!.high;
  let maxDrawdown = 0;
  for (const c of window) {
    runningHigh = Math.max(runningHigh, c.high);
    const dd = pct(runningHigh, c.low);
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  const windowRangeAvg = mean(window.map((c) => (c.high - c.low) / c.low * 100));
  const baselineRangeAvg = mean(baseline.map((c) => (c.high - c.low) / c.low * 100));

  const volumeWindow = window.map((c) => c.baseVolume);
  const volumeBaseline = baseline.map((c) => c.baseVolume);
  const volumeAvailable = volumeWindow.every((v) => typeof v === "number") && volumeBaseline.every((v) => typeof v === "number");

  const rangeLow = Math.min(...window.map((c) => c.low));
  const rangeHigh = Math.max(...window.map((c) => c.high));

  return {
    movePct: round(pct(first.close, last.close)),
    direction: last.close > first.close * 1.005 ? "up" : last.close < first.close * 0.995 ? "down" : "flat",
    volatilityPct: round(mean(dailyReturns)),
    drawdownPct: round(maxDrawdown),
    momentum3dPct: round(pct(closes[closes.length - 4]!, last.close)),
    rangeExpansion: round(windowRangeAvg / (baselineRangeAvg === 0 ? 1 : baselineRangeAvg)),
    rangePosition: round(rangeHigh === rangeLow ? 0.5 : (last.close - rangeLow) / (rangeHigh - rangeLow), 3),
    volumeRatio: volumeAvailable ? round(mean(volumeWindow as number[]) / (mean(volumeBaseline as number[]) || 1)) : undefined,
    volumeAvailable,
  };
}

// ---------------------------------------------------------------------------
// Outcome windows; the ONLY place future candles are touched.
// ---------------------------------------------------------------------------

const OUTCOME_DAYS = [7, 14, 30] as const;

export function extractOutcomes(series: CandleSeries, anchorIndex: number): OutcomeWindow[] {
  const anchor = series.candles[anchorIndex];
  if (anchor === undefined) return [];
  const results: OutcomeWindow[] = [];
  for (const days of OUTCOME_DAYS) {
    const endIndex = anchorIndex + days;
    if (endIndex >= series.candles.length) continue;
    const end = series.candles[endIndex]!;
    let mfe = 0;
    let mae = 0;
    for (let i = anchorIndex + 1; i <= endIndex; i++) {
      const c = series.candles[i]!;
      mfe = Math.max(mfe, pct(anchor.close, c.high));
      mae = Math.min(mae, pct(anchor.close, c.low));
    }
    const forwardReturn = pct(anchor.close, end.close);
    results.push({
      days,
      forwardReturnPct: round(forwardReturn),
      mfePct: round(mfe),
      maePct: round(mae),
      directionPersisted:
        anchorDirection(anchor, series.candles[anchorIndex - 1]) === "up"
          ? forwardReturn > 0
          : anchorDirection(anchor, series.candles[anchorIndex - 1]) === "down"
            ? forwardReturn < 0
            : true,
    });
  }
  return results;
}

function anchorDirection(anchor: AnalysisCandle | undefined, prev: AnalysisCandle | undefined): "up" | "down" | "flat" {
  if (anchor === undefined || prev === undefined) return "flat";
  return anchor.close > prev.close * 1.005 ? "up" : anchor.close < prev.close * 0.995 ? "down" : "flat";
}

// ---------------------------------------------------------------------------
// Episode detection + explainable similarity.
// ---------------------------------------------------------------------------

export interface EpisodeDetectionOptions {
  /** Similarity thresholds per dimension (defaults below). */
  readonly thresholds?: Partial<EpisodeThresholds>;
  /** Maximum reported analogues, ranked by matchedCount then |movePct| closeness. */
  readonly maxMatches?: number;
  /** Minimum required matched dimensions for an episode to count as an analogue. */
  readonly minMatchedDimensions?: number;
}

export interface EpisodeThresholds {
  readonly movePctPts: number; // |reference - episode| in percentage points
  readonly volatilityPts: number;
  readonly drawdownPts: number;
  readonly momentumPts: number;
  readonly rangeExpansionRatio: number; // |ref/ep - 1|
  readonly rangePosition: number; // absolute 0..1
}

const DEFAULT_THRESHOLDS: EpisodeThresholds = {
  movePctPts: 6,
  volatilityPts: 2,
  drawdownPts: 6,
  momentumPts: 6,
  rangeExpansionRatio: 0.5,
  rangePosition: 0.35,
};

/**
 * Detect historical episodes across the series and score them against the reference features.
 *
 * LOOK-AHEAD SAFETY: the caller passes `referenceFeatures` computed from a segment the episode
 * pool EXCLUDES (the pool only scans indices < referenceStart). Outcome windows use future
 * candles but are attached AFTER matching; matching itself never sees them.
 */
export function detectEpisodes(
  series: CandleSeries,
  referenceFeatures: EpisodeFeatures,
  referenceStart: number,
  evidenceRefFor: (anchorIndex: number) => string | undefined,
  options: EpisodeDetectionOptions = {},
): { matches: EpisodeMatch[]; episodesEvaluated: number } {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const maxMatches = options.maxMatches ?? 5;
  const minMatched = options.minMatchedDimensions ?? 4;

  const matches: EpisodeMatch[] = [];
  let evaluated = 0;
  let lastMatchedAnchor = -Infinity; // non-maximum suppression: no overlapping-window duplicates

  // Pool: every anchor index with a full feature window AND a full baseline, strictly BEFORE
  // the reference segment (look-ahead protection), and with at least one outcome candle.
  for (let i = EPISODE_WINDOW_DAYS * 2 - 1; i < referenceStart; i++) {
    if (i + 1 >= series.candles.length) break;
    // Suppress near-duplicates: an anchor within EPISODE_WINDOW_DAYS-1 of an already-matched
    // anchor describes a mostly-overlapping window; presenting both as independent analogues
    // would double-count one historical episode.
    if (i - lastMatchedAnchor < EPISODE_WINDOW_DAYS) continue;
    const features = extractEpisodeFeatures(series, i);
    if (features === undefined) continue;
    evaluated += 1;

    const dimensions = scoreDimensions(referenceFeatures, features, thresholds);
    const matchedCount = dimensions.filter((d) => d.matched).length;
    if (matchedCount < minMatched) continue;

    lastMatchedAnchor = i;

    const differences = dimensions.filter((d) => !d.matched).map((d) => d.dimension);
    matches.push({
      episode: {
        anchorDate: series.times[i]!.slice(0, 10),
        window: { from: series.times[i - EPISODE_WINDOW_DAYS + 1]!.slice(0, 10), to: series.times[i]!.slice(0, 10) },
        features,
        outcomes: extractOutcomes(series, i),
        evidenceRefs: [evidenceRefFor(i) ?? "unreferenced"],
      },
      matchedCount,
      dimensions,
      differences,
    });
  }

  matches.sort((a, b) =>
    b.matchedCount - a.matchedCount ||
    Math.abs(a.episode.features.movePct - referenceFeatures.movePct) - Math.abs(b.episode.features.movePct - referenceFeatures.movePct),
  );
  return { matches: matches.slice(0, maxMatches), episodesEvaluated: evaluated };
}

function scoreDimensions(
  ref: EpisodeFeatures,
  ep: EpisodeFeatures,
  t: EpisodeThresholds,
): SimilarityDimension[] {
  const dims: SimilarityDimension[] = [
    dim("10-day move", fmt(ref.movePct), fmt(ep.movePct), Math.abs(ref.movePct - ep.movePct) <= t.movePctPts),
    dim("direction", ref.direction, ep.direction, ref.direction === ep.direction),
    dim("daily volatility", fmt(ref.volatilityPct), fmt(ep.volatilityPct), Math.abs(ref.volatilityPct - ep.volatilityPct) <= t.volatilityPts),
    dim("max drawdown", fmt(ref.drawdownPct), fmt(ep.drawdownPct), Math.abs(ref.drawdownPct - ep.drawdownPct) <= t.drawdownPts),
    dim("3-day momentum", fmt(ref.momentum3dPct), fmt(ep.momentum3dPct), Math.abs(ref.momentum3dPct - ep.momentum3dPct) <= t.momentumPts),
    dim(
      "range expansion",
      `${ref.rangeExpansion}x baseline`,
      `${ep.rangeExpansion}x baseline`,
      Math.abs(ref.rangeExpansion / (ep.rangeExpansion || 1) - 1) <= t.rangeExpansionRatio,
    ),
    dim("range position", `${round(ref.rangePosition * 100)}%`, `${round(ep.rangePosition * 100)}%`, Math.abs(ref.rangePosition - ep.rangePosition) <= t.rangePosition),
  ];
  // Volume participates ONLY when both sides have it; never silently substituted (§5).
  if (ref.volumeAvailable && ep.volumeAvailable && ref.volumeRatio !== undefined && ep.volumeRatio !== undefined) {
    dims.push(dim(
      "volume vs baseline",
      `${ref.volumeRatio}x`,
      `${ep.volumeRatio}x`,
      Math.abs(ref.volumeRatio / (ep.volumeRatio || 1) - 1) <= 0.5,
    ));
  }
  return dims;
}

function dim(dimension: string, referenceValue: string, episodeValue: string, matched: boolean): SimilarityDimension {
  return { dimension, referenceValue, episodeValue, matched };
}

// ---------------------------------------------------------------------------
// Reference ("current") setup; computed from the record's trailing segment.
// ---------------------------------------------------------------------------

/**
 * The comparison target is the TRAILING segment of the retrieved historical window (the most
 * recent EPISODE_WINDOW_DAYS days). This is the only current-setup the architecture permits
 * here: it is real retrieved data, not a cross-capability current reading (which the Flow 5
 * scope guard forbids) and not model knowledge. `asOf` is the last candle's date.
 */
export function currentSetupFromRecord(series: CandleSeries): { setup: CurrentSetup; features: EpisodeFeatures; endIndex: number } | undefined {
  const endIndex = series.candles.length - 1;
  const features = extractEpisodeFeatures(series, endIndex);
  if (features === undefined) return undefined;
  const last = series.candles[endIndex]!;
  return {
    setup: {
      asOf: last.openTime.slice(0, 10),
      trendState: features.movePct > 2 ? `upward over the last 10 days (${fmt(features.movePct)})` : features.movePct < -2 ? `downward over the last 10 days (${fmt(features.movePct)})` : `rangebound over the last 10 days (${fmt(features.movePct)})`,
      momentumState: `3-day momentum ${fmt(features.momentum3dPct)}`,
      volatilityState: `average daily move ${fmt(features.volatilityPct)} with range expansion ${features.rangeExpansion}x baseline`,
      rangePositionState: `close at ${round(features.rangePosition * 100)}% of the 10-day range`,
      volumeState: features.volumeAvailable && features.volumeRatio !== undefined ? `volume ${features.volumeRatio}x the prior baseline` : "volume data unavailable in the retrieved record",
      basis: `computed from the retrieved G1 candle record (final 10 days ending ${last.openTime.slice(0, 10)}); not a live cross-capability reading`,
    },
    features,
    endIndex,
  };
}

// ---------------------------------------------------------------------------
// Public entry: full analysis over the G1 evidence record.
// ---------------------------------------------------------------------------

/** Parse the monthly-chunk evidence observations emitted by the G1 adapter. */
export function candlesFromEvidence(observations: readonly string[]): { candles: AnalysisCandle[]; malformedChunks: number } {
  const candles: AnalysisCandle[] = [];
  let malformedChunks = 0;
  for (const raw of observations) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      malformedChunks += 1;
      continue;
    }
    const arr = (parsed as { candles?: unknown }).candles;
    if (!Array.isArray(arr)) {
      malformedChunks += 1;
      continue;
    }
    for (const c of arr as Record<string, unknown>[]) {
      if (
        typeof c.openTime === "string" && typeof c.closeTime === "string" &&
        typeof c.open === "number" && typeof c.high === "number" &&
        typeof c.low === "number" && typeof c.close === "number"
      ) {
        candles.push({
          openTime: c.openTime,
          closeTime: c.closeTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          ...(typeof c.baseVolume === "number" ? { baseVolume: c.baseVolume } : {}),
        });
      }
    }
  }
  return { candles, malformedChunks };
}

/**
 * Full deterministic analysis: current setup from the record's trailing segment, analogue
 * detection over the PRIOR record (look-ahead-safe), explained matches with outcomes.
 */
export function analyzeEpisodes(
  observations: readonly string[],
  evidenceRefForIndex: (anchorIndex: number) => string | undefined = () => undefined,
): EpisodeAnalysis {
  const { candles } = candlesFromEvidence(observations);
  if (candles.length < EPISODE_WINDOW_DAYS * 2 + 2) {
    return {
      currentSetup: undefined,
      episodesEvaluated: 0,
      matches: [],
      interpretiveNote:
        "Insufficient historical coverage for episode analysis: the retrieved record is too short to construct a current 10-day setup with a baseline plus comparable prior episodes. Nothing is fabricated; retrieve a longer window or reduce the required granularity.",
    };
  }
  const series = toSeries(candles);
  const ref = currentSetupFromRecord(series);
  if (ref === undefined) {
    return {
      currentSetup: undefined,
      episodesEvaluated: 0,
      matches: [],
      interpretiveNote: "The record could not yield a well-formed current setup (insufficient baseline history).",
    };
  }

  // Look-ahead protection: episode candidates may only use candles strictly before the
  // reference window's start. extractEpisodeFeatures additionally requires a full baseline.
  const referenceStartIndex = ref.endIndex - EPISODE_WINDOW_DAYS + 1;
  const { matches, episodesEvaluated } = detectEpisodes(series, ref.features, referenceStartIndex, evidenceRefForIndex);

  const interpretiveNote =
    matches.length === 0
      ? `No comparable episodes found among ${episodesEvaluated} candidate windows under the stated thresholds. "No comparable episodes" is a description of the historical record against THIS setup; it is not evidence about what happens next.`
      : `${matches.length} comparable episode(s) found among ${episodesEvaluated} candidate windows. These are historical descriptions of what FOLLOWED similar setups; the historical record does not establish that any pattern must recur, and this analysis is not a prediction or a trading recommendation.`;

  return { currentSetup: ref.setup, episodesEvaluated, matches, interpretiveNote };
}

// ---------------------------------------------------------------------------
// Response rendering.
// ---------------------------------------------------------------------------

export function renderEpisodeAnalysis(analysis: EpisodeAnalysis): string[] {
  const lines: string[] = [];
  if (analysis.currentSetup !== undefined) {
    const s = analysis.currentSetup;
    lines.push(`**Current setup (as of ${s.asOf}):** ${s.trendState}; ${s.momentumState}; ${s.volatilityState}; ${s.rangePositionState}; ${s.volumeState}.`);
    lines.push(`**Setup basis:** ${s.basis}.`);
  } else {
    lines.push("**Current setup:** could not be constructed from the retrieved record (insufficient coverage).");
  }

  if (analysis.matches.length === 0) {
    lines.push(`**Historical analogues:** none comparable; ${analysis.interpretiveNote}`);
    return lines;
  }

  lines.push(`**Historical analogues:** ${analysis.matches.length} comparable episode(s):`);
  for (const m of analysis.matches) {
    const ep = m.episode;
    const matched = m.dimensions.filter((d) => d.matched).map((d) => `${d.dimension} (${d.referenceValue} vs ${d.episodeValue})`);
    lines.push(
      `- **${ep.window.from} → ${ep.window.to}**; matched: ${matched.join("; ")}. Differences: ${m.differences.length > 0 ? m.differences.join(", ") : "none within thresholds"}.`,
    );
    if (ep.outcomes.length > 0) {
      const o = ep.outcomes.map((w) => `${w.days}d: ${fmt(w.forwardReturnPct)} (best ${fmt(w.mfePct)}, worst ${fmt(w.maePct)})`).join("; ");
      lines.push(`  What followed: ${o}.`);
    } else {
      lines.push("  What followed: outcome window extends beyond the retrieved record; unknown, not assumed.");
    }
  }
  lines.push(`**What this does not establish:** ${analysis.interpretiveNote}`);
  return lines;
}
