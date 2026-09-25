/**
 * DRIVER-ADMISSION LAW (semantic evidence-admission hardening, ACTIONABLE_INSIGHT v1 audit).
 *
 * Core invariant:
 *   TARGET RELEVANCE != TARGET STATE != TARGET DRIVER != CAUSAL EXPLANATION
 *   CURRENT STATE of the target can never satisfy a CURRENT DRIVERS requirement
 *   unless the evidence itself carries driver/explanatory content.
 *
 * The false-positive path this pins: requirement matching let an item satisfy a
 * driver-shaped requirement through SUBJECT MENTION alone (subject token as shared
 * vocabulary, or the NEWS evidence-class path), so a price quote, an RSI/MACD payload,
 * or a narrative headline quoting the price silently satisfied "the current drivers
 * behind X". Evidence admission is generic: question-shape vocabulary only, never an
 * asset or question list.
 *
 * Deterministic; no network, no model.
 */
import { describe, expect, it } from "vitest";
import {
  assessCoverage,
  buildRequirements,
  completeRequirements,
  matchRequirement,
  questionTypeOf,
  type CoverageEvidence,
} from "../../src/research/requirements.js";
import {
  classifyClaimLevel,
  evaluateQuestionResolution,
  questionIntentOf,
  resolutionConfidenceCeiling,
} from "../../src/research/question-resolution.js";
import { subjectTermsOf } from "../../src/domain/instruments.js";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const DAY_MS = 86_400_000;
const QUESTION = "What is affecting BTC right now?";
const SUBJECT_TERMS = subjectTermsOf(QUESTION)!;

function item(partial: Partial<CoverageEvidence> & { ref: string; text: string }): CoverageEvidence {
  return { evidenceType: "NEWS_ANALYSIS", freshness: "CURRENT", ...partial };
}

/** STATE / OBSERVATION evidence: the target's own price, change and technical readings. */
const priceQuote = item({
  ref: "ev_price",
  evidenceType: "CRYPTO_MARKET_DATA",
  subject: "BTC",
  text: '{"symbol":"BTC","metric":"spot_latest","price":86000,"change24h":-3.2}',
});
const change24h = item({
  ref: "ev_change",
  evidenceType: "CRYPTO_MARKET_DATA",
  subject: "BTC",
  text: '{"symbol":"BTC","metric":"daily_return","returnPct":-3.2}',
});
const rsiMacd = item({
  ref: "ev_rsi",
  evidenceType: "TECHNICAL_ANALYSIS",
  subject: "BTC",
  text: "BTC RSI(14) reads 38 and the MACD line crossed below its signal.",
});
/** NARRATIVE that only quotes/mentions the target (target mention, no mechanism). */
const priceNarrative = item({
  ref: "ev_narr",
  evidenceType: "NEWS_ANALYSIS",
  subject: "BTC",
  text: "Bitcoin rises to $86,000 as markets trade higher; volume was light.",
});
const macroAlongsideSubject = item({
  ref: "ev_macro",
  evidenceType: "NEWS_ANALYSIS",
  subject: "BTC",
  text: "Bitcoin price holds near $86,000. The Fed kept rates elevated and payroll growth surprised to the upside.",
});

/** DRIVER evidence: a factor bound to the target in the evidence itself. */
const etfFlow = item({
  ref: "ev_flow",
  evidenceType: "NEWS_ANALYSIS",
  subject: "BTC",
  text: "Bitcoin spot ETF inflows reached $1.2 billion this week as institutional demand returned.",
});
const positioning = item({
  ref: "ev_pos",
  evidenceType: "DERIVATIVES_ANALYSIS",
  subject: "BTC",
  text: "BTC perpetual funding rates flipped positive as longs added leverage into the rally.",
});
const eventDriver = item({
  ref: "ev_evt",
  evidenceType: "NEWS_ANALYSIS",
  subject: "BTC",
  text: "Bitcoin fell after regulators announced a sweeping exchange crackdown.",
});
const historicalDriver = item({
  ref: "ev_old",
  evidenceType: "NEWS_ANALYSIS",
  subject: "BTC",
  freshness: "CURRENT",
  observedAt: new Date(NOW.getTime() - 400 * DAY_MS).toISOString(),
  text: "Bitcoin rallied as ETF approvals opened institutional access to the asset.",
});

function ledgerFor(question: string, seedDescriptions: readonly string[], subject: string) {
  const seeds = buildRequirements(
    seedDescriptions.map((description) => ({ description, importance: "CRITICAL" as const, timeSensitivity: "CURRENT" as const })),
  );
  return completeRequirements(question, seeds, { subject });
}

const BTC_STATE_AND_DRIVER_SEEDS = ["current BTC price level and condition", "current factors affecting BTC"];

function driverRowsOf(ledger: ReturnType<typeof ledgerFor>) {
  return ledger.filter((r) => /\b(driv\w*|catalysts?|factors?|reasons?)\b/i.test(r.description));
}

describe("question shape: 'what is affecting X right now' is a driver question", () => {
  it("classifies the intent as CURRENT_DRIVERS", () => {
    expect(questionIntentOf(QUESTION)).toBe("CURRENT_DRIVERS");
  });

  it("routes the question type to CAUSAL so the engine adds its own driver row", () => {
    expect(questionTypeOf(QUESTION)).toBe("CAUSAL");
    const ledger = ledgerFor(QUESTION, BTC_STATE_AND_DRIVER_SEEDS, "BTC");
    expect(ledger.some((r) => r.engineRequired === true && /drivers and catalysts behind/.test(r.description))).toBe(true);
    expect(driverRowsOf(ledger).length).toBeGreaterThanOrEqual(2);
  });
});

describe("driver requirement admission (state/narrative never satisfies a driver row)", () => {
  const ledger = ledgerFor(QUESTION, BTC_STATE_AND_DRIVER_SEEDS, "BTC");
  const engineDriverRow = ledger.find((r) => /drivers and catalysts behind/.test(r.description))!;
  const modelDriverRow = ledger.find((r) => r.description === "current factors affecting BTC")!;
  const stateRow = ledger.find((r) => r.description === "current BTC price level and condition")!;

  it.each([
    ["price quote", priceQuote],
    ["24h change", change24h],
    ["RSI/MACD payload", rsiMacd],
    ["headline quoting the price", priceNarrative],
    ["subject mention beside unrelated macro commentary", macroAlongsideSubject],
  ])("%s does not satisfy the engine driver row", (_name, evidence) => {
    expect(matchRequirement(engineDriverRow, evidence, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("NO_MATCH");
  });

  it.each([
    ["price quote", priceQuote],
    ["headline quoting the price", priceNarrative],
    ["subject mention beside unrelated macro commentary", macroAlongsideSubject],
  ])("%s does not satisfy a model-declared driver row", (_name, evidence) => {
    expect(matchRequirement(modelDriverRow, evidence, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("NO_MATCH");
  });

  it.each([
    ["ETF flow news", etfFlow],
    ["derivatives positioning", positioning],
    ["policy event with subject linkage", eventDriver],
  ])("%s satisfies the driver rows", (_name, evidence) => {
    expect(matchRequirement(engineDriverRow, evidence, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("SATISFIES");
    expect(matchRequirement(modelDriverRow, evidence, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("SATISFIES");
  });

  it("state evidence still satisfies a state row (no over-block)", () => {
    expect(matchRequirement(stateRow, priceQuote, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("SATISFIES");
    expect(matchRequirement(stateRow, priceNarrative, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("SATISFIES");
  });
});

describe("temporal law for driver evidence", () => {
  const currentDriverRow = ledgerFor(QUESTION, BTC_STATE_AND_DRIVER_SEEDS, "BTC").find(
    (r) => /drivers and catalysts behind/.test(r.description),
  )!;
  const historicalRow = buildRequirements([
    { description: "how comparable past BTC driver episodes resolved previously", timeSensitivity: "HISTORICAL" },
  ])[0]!;

  it("a genuine driver outside the current window is stale-only, never current satisfaction", () => {
    expect(matchRequirement(currentDriverRow, historicalDriver, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("STALE_ONLY");
  });

  it("the same historical driver material may satisfy a historical requirement", () => {
    expect(matchRequirement(historicalRow, historicalDriver, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("SATISFIES");
  });

  it("a live quote still cannot satisfy the historical driver requirement (mirror law)", () => {
    expect(matchRequirement(historicalRow, priceQuote, { subjectTerms: SUBJECT_TERMS, now: NOW })).toBe("NO_MATCH");
  });
});

function resolve(input: {
  readonly seedDescriptions: readonly string[];
  readonly items: readonly CoverageEvidence[];
  readonly prose: string;
  readonly evidenceTypes?: readonly string[];
}) {
  const raw = ledgerFor(QUESTION, input.seedDescriptions, "BTC");
  const ledger = assessCoverage(raw, input.items, { subjectTerms: SUBJECT_TERMS, now: NOW });
  return evaluateQuestionResolution({
    question: QUESTION,
    ledger,
    evidenceText: input.items.map((i) => `${i.text} ${i.subject ?? ""}`).join(" "),
    prose: input.prose,
    executedCapabilities: [...new Set(input.items.map((i) => i.evidenceType ?? "NEWS_ANALYSIS"))],
    ...(input.evidenceTypes !== undefined
      ? { evidenceTypes: input.evidenceTypes }
      : { evidenceTypes: [...new Set(input.items.map((i) => i.evidenceType ?? "NEWS_ANALYSIS"))] }),
    evidenceCount: input.items.length,
  });
}

/** A trader-facing answer that SOUNDS like it explains the move (prose must not decide). */
const DRIVER_SOUNDING_PROSE =
  "BTC's move this session is driven by macro liquidity conditions and ETF positioning rotation, while momentum remains constructive. " +
  "What would change this view: a reversal in ETF flows. What to watch: funding rates. [ev_price]";

describe("question resolution: state-only evidence never resolves a driver question", () => {
  const stateOnlyItems = [priceQuote, change24h, rsiMacd, priceNarrative, macroAlongsideSubject, historicalDriver];

  it("reports NOT_ANSWERED or PARTIALLY_ANSWERED, never ANSWERED, despite reasonable prose", () => {
    const resolution = resolve({
      seedDescriptions: BTC_STATE_AND_DRIVER_SEEDS,
      items: stateOnlyItems,
      prose: DRIVER_SOUNDING_PROSE,
      evidenceTypes: ["CRYPTO_MARKET_DATA", "TECHNICAL_ANALYSIS", "NEWS_ANALYSIS"],
    });
    expect(["NOT_ANSWERED", "PARTIALLY_ANSWERED"]).toContain(resolution.status);
    const drivers = resolution.dimensions.find((d) => d.dimension === "CURRENT_DRIVERS");
    expect(drivers?.fit).not.toBe("SATISFIED");
    expect(resolution.unresolvedDimensions).toContain("CURRENT_DRIVERS");
    expect(resolutionConfidenceCeiling(resolution.status)).not.toBe("HIGH");
  });

  it("genuine current driver evidence can satisfy the CURRENT_DRIVERS dimension", () => {
    const resolution = resolve({
      seedDescriptions: BTC_STATE_AND_DRIVER_SEEDS,
      items: [priceQuote, etfFlow, positioning, eventDriver],
      prose: DRIVER_SOUNDING_PROSE,
      evidenceTypes: ["CRYPTO_MARKET_DATA", "NEWS_ANALYSIS", "DERIVATIVES_ANALYSIS"],
    });
    const drivers = resolution.dimensions.find((d) => d.dimension === "CURRENT_DRIVERS");
    expect(drivers?.fit).toBe("SATISFIED");
  });

  it("a CURRENT_DRIVERS intent is never ANSWERED when the ledger holds no driver row at all", () => {
    const handBuilt = assessCoverage(
      buildRequirements([{ description: "current BTC price level and condition", importance: "CRITICAL", timeSensitivity: "CURRENT" }]),
      [priceQuote],
      { subjectTerms: SUBJECT_TERMS, now: NOW },
    );
    const resolution = evaluateQuestionResolution({
      question: QUESTION,
      ledger: handBuilt,
      evidenceText: priceQuote.text,
      prose: DRIVER_SOUNDING_PROSE,
      executedCapabilities: ["CRYPTO_MARKET_DATA"],
      evidenceTypes: ["CRYPTO_MARKET_DATA"],
      evidenceCount: 1,
    });
    expect(["NOT_ANSWERED", "PARTIALLY_ANSWERED"]).toContain(resolution.status);
  });
});

describe("claim support: observation is not a driver claim", () => {
  it("keeps a measurement at OBSERVATION level", () => {
    expect(classifyClaimLevel("BTC ETF outflows were $450 million over the past week.")).toBe("OBSERVATION");
  });

  it("classifies 'currently affecting' phrasing as a DRIVER_CLAIM", () => {
    expect(classifyClaimLevel("ETF outflows are currently affecting BTC.")).toBe("DRIVER_CLAIM");
  });

  it("classifies 'the dominant driver' phrasing as a DRIVER_CLAIM", () => {
    expect(classifyClaimLevel("ETF outflows are the dominant driver of BTC.")).toBe("DRIVER_CLAIM");
  });
});
