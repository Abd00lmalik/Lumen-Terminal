/**
 * PREMISE VALIDATION regression.
 *
 * The governing law: a trader's premise ("Bitcoin moved down today") is a claim about the
 * world, not a fact. When the run's OWN evidence contradicts it, Lumen says so before it
 * analyzes anything; when nothing in the evidence can speak to it, Lumen says nothing.
 *
 * The check is deterministic and evidence-bound: it may only report a direction and a
 * percentage that appear in an admitted observation ABOUT THE SUBJECT. It never infers a move
 * from evidence about some other instrument, and it never invents one.
 */
import { describe, it, expect } from "vitest";
import { checkQuestionPremise } from "../../src/research/premise.js";

const btcUp = (pct: number): string =>
  JSON.stringify({ coin: "bitcoin", priceUsd: 85261, change24hPct: pct, asOf: "2026-10-04T09:43:00.000Z", source: "CoinGecko" });
const ethUp = (pct: number): string =>
  JSON.stringify({ coin: "ethereum", priceUsd: 3120, change24hPct: pct, asOf: "2026-10-04T09:43:00.000Z", source: "CoinGecko" });
const spxDown = (pct: number): string =>
  JSON.stringify({ metric: "market_regime_observable", instrument: "^GSPC", label: "S&P 500 index", value: 7722.72, previousClose: 7743.41, changePct: pct, asOf: "2026-10-02T21:00:00.000Z" });

describe("premise validation", () => {
  it("flags a contradicted direction and says so in trader language", () => {
    const check = checkQuestionPremise({
      question: "Why did Bitcoin move down today?",
      subject: "BTC",
      evidence: [{ ref: "ev_1", observation: btcUp(0.81) }],
    });
    expect(check).toBeDefined();
    expect(check?.verdict).toBe("CONTRADICTED");
    expect(check?.assertedDirection).toBe("DOWN");
    expect(check?.observedDirection).toBe("UP");
    expect(check?.observedChangePct).toBeCloseTo(0.81);
    expect(check?.evidenceRef).toBe("ev_1");
    expect(check?.note).toContain("does not match the premise");
    // Trader language only: no engine identifiers, no run/requirement vocabulary.
    expect(check?.note).not.toMatch(/rq_\d|rs_\d|ev_\d|capability|requirement/i);
  });

  it("confirms a premise the evidence supports by saying nothing", () => {
    const check = checkQuestionPremise({
      question: "Why did Ethereum fall today?",
      subject: "ETH",
      evidence: [{ ref: "ev_1", observation: ethUp(-1.4) }],
    });
    expect(check).toBeUndefined();
  });

  it("flags a contradicted magnitude ('fell 8%' against -0.4%)", () => {
    const check = checkQuestionPremise({
      question: "Why did ETH fall 8%?",
      subject: "ETH",
      evidence: [{ ref: "ev_1", observation: ethUp(-0.4) }],
    });
    expect(check?.verdict).toBe("CONTRADICTED");
    expect(check?.assertedMagnitudePct).toBe(8);
    expect(check?.note).toContain("about 8%");
  });

  it("never reads a NEGATED premise as an assertion ('why didn't it fall')", () => {
    const check = checkQuestionPremise({
      question: "Why didn't Bitcoin fall today?",
      subject: "BTC",
      evidence: [{ ref: "ev_1", observation: btcUp(2.1) }],
    });
    expect(check).toBeUndefined();
  });

  it("ignores evidence about a DIFFERENT subject (an S&P move is not a Bitcoin move)", () => {
    const check = checkQuestionPremise({
      question: "Why did Bitcoin move down today?",
      subject: "BTC",
      evidence: [{ ref: "ev_1", observation: spxDown(-0.27) }],
    });
    expect(check).toBeUndefined();
  });

  it("stays silent when the question asserts no direction ('why did BTC move?')", () => {
    const check = checkQuestionPremise({
      question: "Why did BTC move today?",
      subject: "BTC",
      evidence: [{ ref: "ev_1", observation: btcUp(0.81) }],
    });
    expect(check).toBeUndefined();
  });

  it("stays silent when the run holds no observation about the subject", () => {
    const check = checkQuestionPremise({
      question: "Why did Bitcoin move down today?",
      subject: "BTC",
      evidence: [{ ref: "ev_1", observation: "no market data was returned by this provider" }],
    });
    expect(check).toBeUndefined();
  });

  it("stays silent on a move too small to be the move the trader described", () => {
    const check = checkQuestionPremise({
      question: "Why did Bitcoin move down today?",
      subject: "BTC",
      evidence: [{ ref: "ev_1", observation: btcUp(0.02) }],
    });
    expect(check).toBeUndefined();
  });

  it("never fabricates: the reported percentage always appears in the cited observation", () => {
    const observation = btcUp(-1.23);
    const check = checkQuestionPremise({
      question: "Why did Bitcoin rally today?",
      subject: "BTC",
      evidence: [{ ref: "ev_9", observation }],
    });
    expect(check?.verdict).toBe("CONTRADICTED");
    expect(observation).toContain(String(check?.observedChangePct));
  });
});