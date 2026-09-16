/**
 * Flow 5 historical-episode analysis — deterministic tests.
 *
 * Laws under test (G1-analysis mandate):
 * - §4 EPISODES: real candle-derived episodes with window, features, outcomes, evidence refs.
 * - §5 EXPLAINABILITY: similarity is a per-dimension breakdown (matched vs differing) — never
 *   a bare score; unavailable volume is never substituted.
 * - §8 OUTCOMES: forward return / MFE / MAE / direction-persistence over supported windows.
 * - §9 LOOK-AHEAD: episode MATCHING may only use candles at/before the anchor; the reference
 *   segment is excluded from the candidate pool; outcomes touch future candles ONLY. The
 *   leakage test mutates ONLY future candles of one candidate and asserts the match is
 *   unchanged (it would flip if similarity saw the future).
 * - §10 MODEL ROLE: the analysis is pure arithmetic over parsed candles — no model anywhere.
 */
import { describe, expect, it } from "vitest";
import {
  analyzeEpisodes,
  candlesFromEvidence,
  extractEpisodeFeatures,
  extractOutcomes,
  renderEpisodeAnalysis,
  type AnalysisCandle,
} from "../../src/research/episode-analysis.js";

const DAY = 86_400_000;

/** Deterministic synthetic candle series: gentle uptrend at +0.5%/day with volume. */
function trendingSeries(days: number, startPrice = 100, dailyPct = 0.5, volume = 1000): AnalysisCandle[] {
  const out: AnalysisCandle[] = [];
  let price = startPrice;
  const t0 = Date.UTC(2020, 0, 1);
  for (let i = 0; i < days; i++) {
    const open = price;
    const close = price * (1 + dailyPct / 100);
    out.push({
      openTime: new Date(t0 + i * DAY).toISOString(),
      closeTime: new Date(t0 + i * DAY + DAY - 1).toISOString(),
      open,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      close,
      baseVolume: volume,
    });
    price = close;
  }
  return out;
}

/** Emit observations in the G1 monthly-chunk packaging. */
function chunkObservations(candles: readonly AnalysisCandle[]): string[] {
  const byMonth = new Map<string, AnalysisCandle[]>();
  for (const c of candles) {
    const month = c.openTime.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(c);
    byMonth.set(month, arr);
  }
  return [...byMonth.values()].map((month) =>
    JSON.stringify({ month: month[0]!.openTime.slice(0, 7), candleCount: month.length, candles: month }),
  );
}

function closeSeries(candles: readonly AnalysisCandle[], i: number): number {
  return candles[i]!.close;
}

describe("episode-analysis: candle ingestion", () => {
  it("parses monthly chunks; counts malformed chunks without throwing", () => {
    const good = trendingSeries(40);
    const observations = [
      ...chunkObservations(good),
      "not json at all", // unparseable → malformed chunk
      JSON.stringify({ month: "1999-01" }), // no candles array → malformed chunk
    ];
    const { candles, malformedChunks } = candlesFromEvidence(observations);
    expect(candles.length).toBe(40);
    expect(malformedChunks).toBe(2);
  });

  it("volume-less candles are preserved without inventing volume", () => {
    const candles = trendingSeries(5).map(({ baseVolume, ...rest }) => rest);
    const { candles: parsed } = candlesFromEvidence(chunkObservations(candles).map((o) => JSON.parse(o) && o));
    expect(parsed.length).toBe(5);
    expect(parsed.every((c) => c.baseVolume === undefined)).toBe(true);
  });
});

describe("episode-analysis: features", () => {
  it("up-trend window yields up direction, positive move, low drawdown", () => {
    const series = { candles: trendingSeries(30), closes: [], times: [] } as never as Parameters<typeof extractEpisodeFeatures>[0];
    const built = {
      candles: trendingSeries(30),
      closes: trendingSeries(30).map((c) => c.close),
      times: trendingSeries(30).map((c) => c.openTime),
    };
    void series;
    const features = extractEpisodeFeatures(built, 29);
    expect(features).toBeDefined();
    expect(features!.direction).toBe("up");
    expect(features!.movePct).toBeGreaterThan(4); // ~5% over 10 days at 0.5%/day
    expect(features!.drawdownPct).toBeGreaterThan(-3); // tiny drawdown in a smooth trend
    expect(features!.volumeAvailable).toBe(true);
  });

  it("returns undefined without a full baseline (window-edge protection)", () => {
    const candles = trendingSeries(15); // 15 days: anchor 14 has window but baseline needs 10 before it → index 19 min
    const built = { candles, closes: candles.map((c) => c.close), times: candles.map((c) => c.openTime) };
    expect(extractEpisodeFeatures(built, 14)).toBeUndefined();
    expect(extractEpisodeFeatures(built, 10)).toBeUndefined();
  });
});

describe("episode-analysis: outcome windows (the only future-touching code)", () => {
  it("computes forward return, MFE, MAE from the anchor close", () => {
    const candles = trendingSeries(60);
    const built = { candles, closes: candles.map((c) => c.close), times: candles.map((c) => c.openTime) };
    const anchorIndex = 20;
    const outcomes = extractOutcomes(built, anchorIndex);
    expect(outcomes.map((o) => o.days)).toEqual([7, 14, 30]);
    const d7 = outcomes[0]!;
    // Uptrend at 0.5%/day compounding ≈ +3.6% over 7 days.
    expect(d7.forwardReturnPct).toBeGreaterThan(3);
    expect(d7.forwardReturnPct).toBeLessThan(4.5);
    expect(d7.mfePct).toBeGreaterThanOrEqual(d7.forwardReturnPct);
    expect(d7.maePct).toBeLessThanOrEqual(0);
    expect(d7.directionPersisted).toBe(true);
  });

  it("omits windows extending beyond the record (never assumes them)", () => {
    const candles = trendingSeries(25);
    const built = { candles, closes: candles.map((c) => c.close), times: candles.map((c) => c.openTime) };
    const outcomes = extractOutcomes(built, 20); // only 4 candles after anchor
    expect(outcomes).toHaveLength(0);
  });
});

describe("episode-analysis: full analysis + look-ahead protection", () => {
  it("finds the planted analogue and explains the match (no bare scores)", () => {
    // 90 days: baseline 0.2%/day; days 40-49 a distinctive +2%/day run; trailing 10 days the
    // SAME +2%/day signature → the day-49 anchor should match the trailing reference.
    const candles: AnalysisCandle[] = [];
    let price = 100;
    const t0 = Date.UTC(2020, 0, 1);
    for (let i = 0; i < 90; i++) {
      const dailyPct = i >= 40 && i <= 49 ? 2.0 : i >= 80 ? 2.0 : 0.2;
      const open = price;
      const close = price * (1 + dailyPct / 100);
      candles.push({
        openTime: new Date(t0 + i * DAY).toISOString(),
        closeTime: new Date(t0 + i * DAY + DAY - 1).toISOString(),
        open,
        high: Math.max(open, close) * 1.005,
        low: Math.min(open, close) * 0.995,
        close,
        baseVolume: 1000,
      });
      price = close;
    }
    const analysis = analyzeEpisodes(chunkObservations(candles));
    expect(analysis.currentSetup).toBeDefined();
    expect(analysis.episodesEvaluated).toBeGreaterThan(0);
    const match = analysis.matches.find((m) => m.episode.anchorDate === new Date(t0 + 49 * DAY).toISOString().slice(0, 10));
    expect(match).toBeDefined();
    // Explainability: matched dimensions carry BOTH values; differences named; outcomes present.
    expect(match!.dimensions.every((d) => d.referenceValue !== "" && d.episodeValue !== "")).toBe(true);
    expect(match!.dimensions.filter((d) => d.matched).length).toBeGreaterThanOrEqual(4);
    expect(match!.episode.outcomes.length).toBeGreaterThan(0);
    // Rendering names the periods, matched characteristics, and what followed.
    const text = renderEpisodeAnalysis(analysis).join("\n");
    expect(text).toContain("Historical analogues");
    expect(text).toContain("What followed");
    expect(text).toContain("What this does not establish");
    expect(text).not.toMatch(/[Ss]imilarity[:\s]+\d+%/); // no bare scores
  });

  it("LOOK-AHEAD LEAKAGE: mutating ONLY post-anchor candles never changes that candidate's match", () => {
    // Design: day 30-39 is a distinctive +2.5%/day run (candidate anchor = day 39); days 45-75
    // are the MUTATION ZONE (future relative to the anchor, but BEFORE the trailing reference
    // so the reference itself is identical in both records). If similarity saw future data,
    // the day-39 match would differ between the calm and wild records. Outcomes legitimately
    // differ — they are the ONLY thing allowed to touch those candles.
    const build = (mutate: boolean) => {
      const candles: AnalysisCandle[] = [];
      let price = 100;
      const t0 = Date.UTC(2021, 0, 1);
      for (let i = 0; i < 100; i++) {
        const dailyPct =
          i >= 30 && i <= 39 ? 2.5 : // candidate run (identical in both records)
          mutate && i >= 45 && i <= 75 ? 8 : // future-of-anchor mutation zone
          i >= 90 ? 2.5 : // trailing reference run (identical in both records)
          0.2;
        const open = price;
        const close = price * (1 + dailyPct / 100);
        candles.push({
          openTime: new Date(t0 + i * DAY).toISOString(),
          closeTime: new Date(t0 + i * DAY + DAY - 1).toISOString(),
          open,
          high: Math.max(open, close) * 1.005,
          low: Math.min(open, close) * 0.995,
          close,
          baseVolume: 1000,
        });
        price = close;
      }
      return candles;
    };
    const calm = analyzeEpisodes(chunkObservations(build(false)));
    const wild = analyzeEpisodes(chunkObservations(build(true)));
    const anchorIso = new Date(Date.UTC(2021, 0, 1) + 39 * DAY).toISOString().slice(0, 10);
    const calmAnchor = calm.matches.find((m) => m.episode.anchorDate === anchorIso);
    const wildAnchor = wild.matches.find((m) => m.episode.anchorDate === anchorIso);
    expect(calmAnchor).toBeDefined();
    expect(wildAnchor).toBeDefined();
    // The match (features + per-dimension breakdown) is IDENTICAL despite the extreme future move.
    expect(wildAnchor!.episode.features).toEqual(calmAnchor!.episode.features);
    expect(wildAnchor!.dimensions).toEqual(calmAnchor!.dimensions);
    // Outcomes DO differ — they are the only consumer of post-anchor candles.
    expect(wildAnchor!.episode.outcomes.map((o) => o.forwardReturnPct))
      .not.toEqual(calmAnchor!.episode.outcomes.map((o) => o.forwardReturnPct));
  });

  it("reference segment is never a candidate (no self-match)", () => {
    const candles = trendingSeries(120);
    const analysis = analyzeEpisodes(chunkObservations(candles));
    const lastDay = candles[candles.length - 1]!.openTime.slice(0, 10);
    // The trailing 10-day window's own anchor (the last day) must never appear as an analogue.
    expect(analysis.matches.every((m) => m.episode.anchorDate !== lastDay)).toBe(true);
  });

  it("insufficient coverage → honest insufficiency, no fabricated episodes", () => {
    const analysis = analyzeEpisodes(chunkObservations(trendingSeries(15)));
    expect(analysis.currentSetup).toBeUndefined();
    expect(analysis.matches).toHaveLength(0);
    expect(analysis.interpretiveNote).toContain("Insufficient historical coverage");
  });

  it("volume-less record: analysis proceeds, volume never substituted", () => {
    const noVolume = trendingSeries(90).map(({ baseVolume, ...rest }) => rest);
    void baseVolumeGuard;
    const analysis = analyzeEpisodes(chunkObservations(noVolume));
    expect(analysis.currentSetup).toBeDefined();
    expect(analysis.currentSetup!.volumeState).toContain("unavailable");
    if (analysis.matches.length > 0) {
      const volumeDims = analysis.matches.flatMap((m) => m.dimensions.filter((d) => d.dimension.includes("volume")));
      expect(volumeDims).toHaveLength(0); // volume dimension never fabricated from nothing
    }
  });

  it("no comparable episodes → honest 'none comparable' with the non-prediction note", () => {
    // Alternating up/down days: no window resembles the smooth trailing reference strongly.
    const candles: AnalysisCandle[] = [];
    let price = 100;
    const t0 = Date.UTC(2022, 0, 1);
    for (let i = 0; i < 90; i++) {
      const dailyPct = i % 2 === 0 ? 3 : -3;
      const open = price;
      const close = price * (1 + dailyPct / 100);
      candles.push({
        openTime: new Date(t0 + i * DAY).toISOString(),
        closeTime: new Date(t0 + i * DAY + DAY - 1).toISOString(),
        open,
        high: Math.max(open, close) * 1.005,
        low: Math.min(open, close) * 0.995,
        close,
        baseVolume: 1000,
      });
      price = close;
    }
    const analysis = analyzeEpisodes(chunkObservations(candles));
    if (analysis.matches.length === 0) {
      expect(analysis.interpretiveNote).toContain("No comparable episodes");
      expect(analysis.interpretiveNote).toContain("not evidence about what happens next");
    } else {
      // Even with matches, the non-prediction note is mandatory.
      expect(analysis.interpretiveNote).toContain("not a prediction");
    }
  });

  it("multiple comparable episodes are ranked and each carries evidence refs", () => {
    // Two identical planted runs at days 30-39 and 50-59; trailing 80-89 same signature.
    const candles: AnalysisCandle[] = [];
    let price = 100;
    const t0 = Date.UTC(2023, 0, 1);
    for (let i = 0; i < 100; i++) {
      const dailyPct = (i >= 30 && i <= 39) || (i >= 50 && i <= 59) || i >= 90 ? 1.8 : 0.2;
      const open = price;
      const close = price * (1 + dailyPct / 100);
      candles.push({
        openTime: new Date(t0 + i * DAY).toISOString(),
        closeTime: new Date(t0 + i * DAY + DAY - 1).toISOString(),
        open,
        high: Math.max(open, close) * 1.005,
        low: Math.min(open, close) * 0.995,
        close,
        baseVolume: 1000,
      });
      price = close;
    }
    const evidenceIds = ["ev_a", "ev_b", "ev_c", "ev_d"];
    const analysis = analyzeEpisodes(chunkObservations(candles), (anchorIndex) => evidenceIds[Math.floor(anchorIndex / 30)]);
    expect(analysis.matches.length).toBeGreaterThanOrEqual(2);
    for (const m of analysis.matches) {
      expect(m.episode.evidenceRefs.length).toBeGreaterThan(0);
      expect(m.episode.evidenceRefs[0]).toMatch(/^ev_/);
    }
    // Ranked: first match has >= matchedCount of the last.
    expect(analysis.matches[0]!.matchedCount).toBeGreaterThanOrEqual(analysis.matches[analysis.matches.length - 1]!.matchedCount);
  });
});

// Referenced only to keep the destructuring test honest about unused var linting.
function baseVolumeGuard(): void {}
