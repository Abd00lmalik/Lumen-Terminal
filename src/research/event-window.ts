/**
 * Event-window analysis (research contract §4/§5: raw historical data MUST become
 * analytical evidence).
 *
 * Live failure this exists to eliminate: a shutdown question retrieved months of real BTC
 * candles, then the answer reported "historical price responses during past shutdowns
 * remain uncovered" — the raw candles satisfied BTC_HISTORICAL_PRICE_DATA but nothing
 * transformed them into BTC_RESPONSE_TO_SHUTDOWNS evidence. The missing step was an
 * ENGINE-owned deterministic transformation: event episode -> window -> metrics -> a
 * DERIVED_OBSERVATION evidence object with lineage back to the source candles.
 *
 * Laws honored here:
 * - No fabrication: a window computed from REAL retrieved candles only. Missing data makes
 *   the metric `undefined` with a reason; it is never invented.
 * - Epistemic class: the output is a DERIVED_OBSERVATION. Coincidence is not causation:
 *   the rendered observation states the move HAPPENED during the window; it never claims
 *   the event caused it.
 * - Determinism: pure arithmetic over (candles, window bounds). No model input.
 */

import { candlesFromEvidence } from "./episode-analysis.js";

export interface EventWindowSpec {
  /** Human event name as the planner stated it (e.g. "US government shutdown, Oct 2025"). */
  readonly event: string;
  /** ISO date bounds of the event window (engine-clamped to available candle coverage). */
  readonly from: string;
  readonly to: string;
  /** The asset the window concerns (symbol or name; used for lineage and labeling). */
  readonly asset: string;
}

export interface EventWindowMetrics {
  readonly from: string;
  readonly to: string;
  /** Candle count inside the window (0 = window not covered by the retrieved record). */
  readonly candles: number;
  readonly startPrice?: number;
  readonly endPrice?: number;
  readonly returnPct?: number;
  /** Max adverse excursion: worst close-to-close drawdown from the window's running high. */
  readonly maxDrawdownPct?: number;
  /** Mean absolute daily close-to-close return, in %. */
  readonly realizedVolPct?: number;
  readonly highPrice?: number;
  readonly lowPrice?: number;
  /** Direction of the net window move. */
  readonly direction?: "up" | "down" | "flat";
  /** Why a metric is missing, when it is (honest absence, never a fabricated zero). */
  readonly missingReason?: string;
}

export interface EventWindowResult {
  readonly event: string;
  readonly asset: string;
  readonly metrics: EventWindowMetrics;
}

function pct(from: number, to: number): number {
  return from === 0 ? 0 : ((to - from) / from) * 100;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Compute the event-window metrics for one asset from the run's collected OHLCV evidence.
 * Bounded and total: any malformed chunk is skipped (candlesFromEvidence counts them); a
 * window with no candle coverage yields an honest `candles: 0` with a missingReason.
 */
export function computeEventWindow(
  spec: EventWindowSpec,
  observations: readonly string[],
): EventWindowResult {
  const { candles } = candlesFromEvidence(observations);
  const fromMs = Date.parse(spec.from);
  const toMs = Date.parse(spec.to);
  const boundsValid = !Number.isNaN(fromMs) && !Number.isNaN(toMs) && fromMs <= toMs;
  const inWindow = boundsValid
    ? candles.filter((c) => Date.parse(c.openTime) >= fromMs && Date.parse(c.openTime) <= toMs)
    : [];
  const sorted = [...inWindow].sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime));
  if (!boundsValid || sorted.length === 0) {
    return {
      event: spec.event,
      asset: spec.asset,
      metrics: {
        from: spec.from,
        to: spec.to,
        candles: 0,
        missingReason: !boundsValid
          ? "the event window bounds are invalid; no window was computed"
          : "the retrieved candle record does not cover this event window; the window was not computed rather than approximated",
      },
    };
  }
  const closes = sorted.map((c) => c.close);
  const startPrice = closes[0]!;
  const endPrice = closes[closes.length - 1]!;
  const highPrice = Math.max(...sorted.map((c) => c.high));
  const lowPrice = Math.min(...sorted.map((c) => c.low));
  const dailyReturns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) dailyReturns.push(pct(closes[i - 1]!, closes[i]!));
  const realizedVol = dailyReturns.length > 0 ? dailyReturns.map(Math.abs).reduce((a, b) => a + b, 0) / dailyReturns.length : undefined;
  let runningHigh = startPrice;
  let maxDrawdown = 0;
  for (const c of closes) {
    runningHigh = Math.max(runningHigh, c);
    if (runningHigh > 0) maxDrawdown = Math.max(maxDrawdown, ((runningHigh - c) / runningHigh) * 100);
  }
  const netReturn = pct(startPrice, endPrice);
  return {
    event: spec.event,
    asset: spec.asset,
    metrics: {
      from: spec.from,
      to: spec.to,
      candles: sorted.length,
      startPrice: round(startPrice),
      endPrice: round(endPrice),
      returnPct: round(netReturn),
      maxDrawdownPct: round(maxDrawdown),
      ...(realizedVol !== undefined ? { realizedVolPct: round(realizedVol) } : {}),
      highPrice: round(highPrice),
      lowPrice: round(lowPrice),
      direction: netReturn > 0.05 ? "up" : netReturn < -0.05 ? "down" : "flat",
    },
  };
}

/**
 * Render the computed window as an evidence observation. COINCIDENCE WORDING, not causation:
 * "X happened during the event window" is an observation; nothing here says the event
 * caused the move (OHLCV alone cannot establish that).
 */
export function renderEventWindowObservation(result: EventWindowResult): string {
  const m = result.metrics;
  const asset = result.asset.toUpperCase();
  if (m.candles === 0) {
    return `Event window analysis for ${asset} around "${result.event}" could not be computed: ${m.missingReason ?? "no candle data"}.`;
  }
  const parts = [
    `Event-window analysis: ${asset} from ${m.from.slice(0, 10)} to ${m.to.slice(0, 10)} during "${result.event}" (${m.candles} daily candles): net move ${m.returnPct}% (${m.direction}), from ${m.startPrice} to ${m.endPrice}; window high ${m.highPrice}, low ${m.lowPrice}; max close-to-close drawdown ${m.maxDrawdownPct}%; mean absolute daily move ${m.realizedVolPct}%.`,
    "This is a historical coincidence observation: the move occurred during the window; candle data alone does not establish that the event caused it.",
  ];
  return parts.join(" ");
}

/** Evidence tag for window-analysis outputs (domain vocabulary of the evidence layer). */
export const EVENT_WINDOW_EVIDENCE_TYPE = "HISTORICAL_EVENT_WINDOW";

/**
 * One-stop transformation used by the research loop: compute + render in one call. Returns
 * undefined when the window is not computable (no candles, invalid bounds) so the caller can
 * report the research gap honestly instead of minting empty evidence.
 */
export function eventWindowEvidence(
  spec: EventWindowSpec,
  observations: readonly string[],
): { observation: string; result: EventWindowResult } | undefined {
  const result = computeEventWindow(spec, observations);
  if (result.metrics.candles === 0) return undefined;
  return { observation: renderEventWindowObservation(result), result };
}
