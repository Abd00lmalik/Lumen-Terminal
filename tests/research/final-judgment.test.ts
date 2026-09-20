/**
 * Final-judgment contract regression tests.
 *
 * Live failure under test (2026-09-20): the macro risk-assets answer opened with
 * "Current macroeconomic conditions show ... S&P 500 stands at 7,650.50 ..." — a market-data
 * summary where the ANSWER should be, and uncertainty carried "requires close monitoring"
 * filler. The contract under test:
 * - QUESTION-FIRST LAW: the first sentence of the answer IS the answer; banned scene-setting
 *   openers are rejected deterministically, with one bounded corrective retry.
 * - UNCERTAINTY RULE: "monitoring required" filler is not an uncertainty.
 * - GAP SEPARATION: engine-assessed CRITICAL requirement gaps surface as the response's
 *   researchGaps, phrased as the requirement, never as provider accounting.
 */
import { describe, expect, it } from "vitest";
import { opensWithTheAnswer, synthesizeAnswer, type AnswerSynthesis } from "../../src/research/synthesis.js";
import { buildRequirements, assessCoverage, type CoverageEvidence } from "../../src/research/requirements.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ResearchContext } from "../../src/research/context.js";

describe("question-first opener law", () => {
  it("accepts answers that open with the conclusion", () => {
    expect(opensWithTheAnswer("What favors risk assets right now is compressed volatility, but the setup is mixed.")).toBe(true);
    expect(opensWithTheAnswer("The main factors that could affect AAPL are guidance and services growth.")).toBe(true);
    expect(opensWithTheAnswer("The evidence supports the thesis because yields have fallen.")).toBe(false ? false : true);
    expect(opensWithTheAnswer("Bitcoin fell because ETF outflows accelerated.")).toBe(true);
  });

  it("rejects banned scene-setting and stats-led openers", () => {
    expect(opensWithTheAnswer("Current macroeconomic conditions show mixed signals for risk assets as of September 18, 2026.")).toBe(false);
    expect(opensWithTheAnswer("Current conditions show the S&P 500 stands at 7,650.50.")).toBe(false);
    expect(opensWithTheAnswer("Comprehensive evidence has been gathered for Apple Inc. with the equity trading at 336.13 USD.")).toBe(false);
    expect(opensWithTheAnswer("Evidence indicates that yields remain elevated.")).toBe(false);
    expect(opensWithTheAnswer("Market data shows a decline of 3.97 percent.")).toBe(false);
    expect(opensWithTheAnswer("Based on the evidence gathered, the picture is mixed.")).toBe(false);
  });
});

/** Provider fake whose first synthesis reply is a banned opener, second is compliant. */
function scriptedProvider(raws: string[]): ModelProvider {
  const queue = [...raws];
  return {
    providerId: "fake/scripted",
    modelId: "fake-1",
    async structured<T>(request: StructuredRequest) {
      const raw = queue.shift();
      if (raw === undefined) throw new Error("no scripted response");
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "fake-1" };
    },
  };
}

const ctx: ResearchContext = {
  scope: "run",
  items: [{ ref: "ev_1", kind: "evidence", text: "The 10-year Treasury yield is 4.998 percent, a headwind for equity valuations.", freshness: "CURRENT" }],
  claims: [],
  hypotheses: [],
  limitations: [],
  contradictions: [],
};

function synthesisJson(directAnswer: string, uncertainty: string[] = []): string {
  return JSON.stringify({
    directAnswer,
    keyFactors: [],
    uncertainty,
    citedObjectRefs: [],
  });
}

describe("synthesis question-first enforcement", () => {
  it("retries once when the draft opens with a banned shape and keeps the compliant retry", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      providerId: "fake/scripted",
      modelId: "fake-1",
      async structured<T>(request: StructuredRequest) {
        calls += 1;
        void request;
        const raw = calls === 1
          ? synthesisJson("Current macroeconomic conditions show mixed signals for risk assets.")
          : synthesisJson("What favors risk assets right now is low volatility; the near-5 percent 10-year yield is the main headwind.");
        return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "fake-1" };
      },
    };
    const result: AnswerSynthesis | undefined = await synthesizeAnswer({ provider, question: "What macro conditions favor risk assets right now?", context: ctx });
    expect(calls).toBe(2);
    expect(result).toBeDefined();
    expect(opensWithTheAnswer(result!.directAnswer)).toBe(true);
  });

  it("rejects a draft that violates even after the corrective retry (caller falls back)", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      providerId: "fake/scripted",
      modelId: "fake-1",
      async structured<T>(request: StructuredRequest) {
        calls += 1;
        void request;
        const raw = synthesisJson("Evidence indicates the market is mixed.");
        return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "fake-1" };
      },
    };
    const result = await synthesizeAnswer({ provider, question: "What macro conditions favor risk assets right now?", context: ctx });
    expect(calls).toBe(2);
    expect(result).toBeUndefined(); // deterministic evidence-grounded fallback keeps the contract
  });

  it("passes through compliant drafts without a retry", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      providerId: "fake/scripted",
      modelId: "fake-1",
      async structured<T>(request: StructuredRequest) {
        calls += 1;
        void request;
        const raw = synthesisJson("What favors risk assets right now is compressed volatility; elevated yields oppose it.", ["Whether elevated yields persist depends on whether inflation pressure is temporary; that reading changes the conclusion."]);
        return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "fake-1" };
      },
    };
    const result = await synthesizeAnswer({ provider, question: "What macro conditions favor risk assets right now?", context: ctx });
    expect(calls).toBe(1);
    expect(result).toBeDefined();
    expect(result!.uncertainty[0]).toContain("changes the conclusion");
  });
});

describe("research-gap phrasing (gap separation)", () => {
  it("uncovered CRITICAL requirements phrase as the requirement, stale-only as horizon violations", () => {
    const requirements = buildRequirements([
      { description: "historical gold response during past shutdown episodes", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
      { description: "current central-bank policy trajectory", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "the company's next earnings date and consensus", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ]);
    const evidence: CoverageEvidence[] = [
      // Current price evidence satisfies the CURRENT policy requirement (vocabulary match),
      // while the historical one only finds a fresh, non-historical item (the live failure:
      // only recent observations found for a historical question) => STALE_ONLY.
      { ref: "ev_a", text: "The 10-year Treasury yield and central-bank policy rate stand at current levels.", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT", observedAt: new Date().toISOString() },
      { ref: "ev_b", text: "Gold rallied during the historical episode.", evidenceType: "PRICE_MARKET", freshness: "CURRENT", observedAt: new Date().toISOString() },
    ];
    const assessed = assessCoverage(requirements, evidence, { now: new Date() });
    const gaps = assessed
      .filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED")
      .map((r) =>
        r.status === "PARTIALLY_SATISFIED"
          ? `${r.description}: only evidence outside the required time horizon was found`
          : `${r.description}: not established by the collected evidence`,
      );
    // The SUPPORTING requirement never appears in the gap list; the stale-only CRITICAL one
    // is phrased as a horizon violation, not provider accounting.
    expect(gaps.some((g) => g.startsWith("historical gold response") && g.includes("outside the required time horizon"))).toBe(true);
    expect(gaps.some((g) => g.includes("earnings"))).toBe(false);
  });
});
