/**
 * Final-judgment contract regression tests.
 *
 * Live failure under test (2026-09-20): the macro risk-assets answer opened with
 * "Current macroeconomic conditions show ... S&P 500 stands at 7,650.50 ..." — a market-data
 * summary where the ANSWER should be, and uncertainty carried "requires close monitoring"
 * filler. The contract under test:
 * - QUESTION-FIRST LAW: the first sentence of the answer IS the answer; banned scene-setting
 *   openers are rejected deterministically, with one bounded corrective retry.
 * - MODE-SHAPE LAW: the resolved mode's answer owes its sections (factors for a causal
 *   question, per-condition evaluation for a thesis evaluation, conditions to monitor for a
 *   falsification test); sections the mode does not owe are never required, and a draft that
 *   misses an owed section gets one bounded corrective retry, then rejection to fallback.
 * - UNCERTAINTY RULE: "monitoring required" filler is not an uncertainty.
 * - GAP SEPARATION: engine-assessed CRITICAL requirement gaps surface as the response's
 *   researchGaps, phrased as the requirement, never as provider accounting.
 */
import { describe, expect, it } from "vitest";
import {
  answerShapeViolations,
  opensWithTheAnswer,
  synthesizeAnswer,
  type AnswerSynthesis,
} from "../../src/research/synthesis.js";
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
  runEvidenceRefs: ["ev_1"],
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

const whyDraft = (watch: readonly string[]): string =>
  JSON.stringify({
    directAnswer: "Bitcoin fell because ETF outflows accelerated.",
    keyFactors: [
      {
        factor: "ETF outflows",
        mechanism: "persistent outflows reduce spot demand against thin books",
        direction: "negative",
        evidenceRefs: ["ev_1"],
        counterevidenceRefs: [],
        evidenceQuality: "DIRECT_EVIDENCE",
        evidenceDirectness: "DIRECT",
      },
    ],
    whatWouldChangeTheView: [...watch],
    uncertainty: [],
    citedObjectRefs: ["ev_1"],
  });

/** Counts structured calls so a retry (or its absence) is observable. */
function countingProvider(first: string, second: string, calls: { n: number }): ModelProvider {
  return {
    providerId: "fake/scripted",
    modelId: "fake-1",
    async structured<T>(request: StructuredRequest) {
      calls.n += 1;
      const raw = calls.n === 1 ? first : second;
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "fake-1" };
    },
  };
}

describe("synthesis mode-shape law (the sections the resolved mode owes)", () => {
  it("a causal draft missing 'what would change it' is retried once and the compliant retry is kept", async () => {
    const calls = { n: 0 };
    const provider = countingProvider(
      whyDraft([]),
      whyDraft(["Outflows stabilising while price holds the range would weaken the causal reading."]),
      calls,
    );
    const result = await synthesizeAnswer({
      provider,
      question: "Why did Bitcoin dump today?",
      context: ctx,
      mode: "WHY_IT_HAPPENED",
    });
    expect(calls.n).toBe(2);
    expect(result).toBeDefined();
    expect(result!.whatWouldChangeTheView.length).toBeGreaterThan(0);
  });

  it("a causal draft with no factors is retried, not shipped as a bare paragraph", async () => {
    const calls = { n: 0 };
    const factorless = JSON.stringify({
      directAnswer: "Bitcoin fell during the session.",
      keyFactors: [],
      whatWouldChangeTheView: ["A reclaim of the range high would weaken the reading."],
      uncertainty: [],
      citedObjectRefs: [],
    });
    const provider = countingProvider(factorless, whyDraft(["Outflows stabilising would weaken the reading."]), calls);
    const result = await synthesizeAnswer({
      provider,
      question: "Why did Bitcoin dump today?",
      context: ctx,
      mode: "WHY_IT_HAPPENED",
    });
    expect(calls.n).toBe(2);
    expect(result).toBeDefined();
    expect(result!.keyFactors.length).toBeGreaterThan(0);
  });

  it("rejects a causal draft that still misses its sections after the corrective retry", async () => {
    const calls = { n: 0 };
    const provider = countingProvider(whyDraft([]), whyDraft([]), calls);
    const result = await synthesizeAnswer({
      provider,
      question: "Why did Bitcoin dump today?",
      context: ctx,
      mode: "WHY_IT_HAPPENED",
    });
    expect(calls.n).toBe(2);
    expect(result).toBeUndefined(); // the caller keeps its deterministic fallback
  });

  it("passes a compliant causal draft through without a retry", async () => {
    const calls = { n: 0 };
    const provider = countingProvider(
      whyDraft(["Outflows stabilising would weaken the causal reading."]),
      "never used",
      calls,
    );
    const result = await synthesizeAnswer({
      provider,
      question: "Why did Bitcoin dump today?",
      context: ctx,
      mode: "WHY_IT_HAPPENED",
    });
    expect(calls.n).toBe(1);
    expect(result).toBeDefined();
  });

  it("a GENERIC answer never violates — no section is owed and no retry fires", async () => {
    const calls = { n: 0 };
    const provider = countingProvider(synthesisJson("Bitcoin fell during the session."), "never used", calls);
    const result = await synthesizeAnswer({
      provider,
      question: "What happened to Bitcoin?",
      context: ctx,
    });
    expect(calls.n).toBe(1);
    expect(result).toBeDefined();
  });

  it("the violation matrix matches what each mode's shape actually owes", () => {
    const empty = { keyFactors: [], whatWouldChangeTheView: [], causalChain: undefined };
    // Causal and factor modes owe factors AND a "what would change it" section.
    expect(answerShapeViolations("WHY_IT_HAPPENED", empty)).toHaveLength(2);
    expect(answerShapeViolations("WHAT_COULD_AFFECT_IT", empty)).toHaveLength(2);
    // Thesis and framework modes owe the per-item evaluation; they do not owe watch conditions.
    expect(answerShapeViolations("DOES_MY_THESIS_HOLD", empty)).toHaveLength(1);
    expect(answerShapeViolations("EVALUATE_WITH_MY_FRAMEWORK", empty)).toHaveLength(1);
    // Falsification owes the conditions to monitor; it does not owe factors.
    expect(answerShapeViolations("WHAT_COULD_PROVE_ME_WRONG", empty)).toHaveLength(1);
    // Narrative modes (timeline, analogue, cross-domain) have no field mapping: no proxy, no violation.
    expect(answerShapeViolations("WHAT_HAPPENED", empty)).toHaveLength(0);
    expect(answerShapeViolations("HAS_THIS_HAPPENED_BEFORE", empty)).toHaveLength(0);
    expect(answerShapeViolations("WHAT_DOES_ALL_INFORMATION_SAY", empty)).toHaveLength(0);
    expect(answerShapeViolations(undefined, empty)).toHaveLength(0);
    // The structured causal chain satisfies the same sections the top-level fields would.
    const chained = {
      keyFactors: [],
      whatWouldChangeTheView: [],
      causalChain: {
        observation: { description: "o", evidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" },
        drivers: [{ description: "d", evidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" }],
        mechanisms: [],
        transmission: [],
        crossAssetResponse: [],
        implications: [],
        counterEvidence: [],
        forwardWatchConditions: [{ condition: "c", effect: "e", evidenceRefs: [], currentStatus: "open" }],
        overallConfidence: "MODERATE",
        uncertainties: [],
      },
    };
    expect(answerShapeViolations("WHY_IT_HAPPENED", chained)).toHaveLength(0);
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
