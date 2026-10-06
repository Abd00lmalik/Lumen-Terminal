/**
 * INTENT COHERENCE (Phase 2): ONE vocabulary, three readers.
 *
 * The dispatch guard (flow-guard), the ledger's mode detection (primaryFlowOf/chainedFlowsOf)
 * and the answer-shape classifier (questionTypeOf) previously carried two hand-maintained
 * regex sets and drifted: the audit found 3/17 fixtures where the guard's flow was not the
 * ledger's primary mode ("Does my thesis that BTC remains bullish still hold?" routed WHY at
 * dispatch and DOES_MY_THESIS_HOLD in the ledger), and both flow layers missed natural trader
 * phrasings entirely ("What would invalidate my thesis?", "Evaluate this according to my risk
 * framework.", "Has Bitcoin reacted like this to similar CPI surprises before?", "Is the
 * current move mainly driven by ETF flows or macro?").
 *
 * All three readers now consume MODE_PATTERNS (src/research/modes.ts). This suite pins that
 * coherence on the audit fixtures:
 *   1. the guard's flow IS the ledger's primary mode for every fixture (D1 = 0);
 *   2. each fixture's ground-truth flow is what the trader's sentence actually asks for;
 *   3. compound questions chain both investigation legs with the primary first;
 *   4. comparison stays flow-less (verify-first product decision) and classifies COMPARISON;
 *   5. the resulting requirement ledger satisfies its flow contract — zero violations.
 */
import { describe, expect, it } from "vitest";
import { guardFlow } from "../../src/lui/flow-guard.js";
import { chainedFlowsOf, primaryFlowOf } from "../../src/research/modes.js";
import {
  completeRequirements,
  dimensionOfRequirement,
  questionTypeOf,
} from "../../src/research/requirements.js";
import { assertFlowContract, contractFor } from "../../src/research/flow-contract.js";

/** [sentence, ground-truth flow] — undefined means the question routes no flow at all. */
const FIXTURES: readonly [string, string | undefined][] = [
  ["What happened to ETH after the ETF announcement?", "WHAT_HAPPENED"],
  ["Why did BTC dump today?", "WHY_IT_HAPPENED"],
  ["Is the current move mainly driven by ETF flows or macro?", "WHY_IT_HAPPENED"],
  ["Does my thesis that BTC remains bullish still hold?", "DOES_MY_THESIS_HOLD"],
  ["Has Bitcoin reacted like this to similar CPI surprises before?", "HAS_THIS_HAPPENED_BEFORE"],
  ["Take everything you've found and tell me what the evidence actually supports.", undefined],
  ["What would invalidate my thesis?", "WHAT_COULD_PROVE_ME_WRONG"],
  ["Evaluate this according to my risk framework.", "EVALUATE_WITH_MY_FRAMEWORK"],
  ["Compare this move with ETH.", undefined],
  ["Compare BTC with ETH performance this month.", undefined],
  [
    "What happened to Bitcoin over the last 24 hours? Give me only the factual sequence of price movement and dated market events. Do not analyze causes, drivers, mechanisms, theses, counterevidence, materiality, or trading implications.",
    "WHAT_HAPPENED",
  ],
  ["What could affect Bitcoin over the next few days?", "WHAT_COULD_AFFECT_IT"],
  ["Why did Bitcoin move down today?", "WHY_IT_HAPPENED"],
  ["What does all the information say about the current market?", "WHAT_DOES_ALL_INFORMATION_SAY"],
  ["Why did BTC fall, and does my bullish thesis still hold?", "DOES_MY_THESIS_HOLD"],
  ["What happened, and why?", "WHY_IT_HAPPENED"],
  ["Go deeper on ETF flows.", undefined],
];

describe("the dispatch guard and the ledger agree on what every question is", () => {
  it.each(FIXTURES)("guard flow equals primary mode for %j", (sentence, expected) => {
    const guarded = guardFlow({ message: sentence }).flow ?? undefined;
    const primary = primaryFlowOf(sentence);
    expect(guarded).toBe(expected);
    expect(primary).toBe(expected);
    // Same first reader result: the guard's selection and the ledger's primary must be
    // the identical value, not merely two values that happen to equal the expectation.
    expect(guarded).toBe(primary);
  });

  it("resolves each fixture without a model classification (determined from the message)", () => {
    for (const [sentence, expected] of FIXTURES) {
      const result = guardFlow({ message: sentence });
      expect(result.flow ?? undefined, sentence).toBe(expected);
      expect(result.source, sentence).toBe(expected === undefined ? "none" : "determined");
    }
  });
});

describe("the shared vocabulary catches the trader's natural phrasings the old pairs missed", () => {
  it("falsification without the word 'prove': 'What would invalidate my thesis?'", () => {
    expect(guardFlow({ message: "What would invalidate my thesis?" }).flow).toBe(
      "WHAT_COULD_PROVE_ME_WRONG",
    );
  });

  it("thesis-hold with modifiers between determiner and 'hold'", () => {
    const message = "Does my thesis that BTC remains bullish still hold?";
    expect(guardFlow({ message }).flow).toBe("DOES_MY_THESIS_HOLD");
    expect(primaryFlowOf(message)).toBe("DOES_MY_THESIS_HOLD");
  });

  it("framework with an intervening noun: 'according to my risk framework'", () => {
    expect(guardFlow({ message: "Evaluate this according to my risk framework." }).flow).toBe(
      "EVALUATE_WITH_MY_FRAMEWORK",
    );
  });

  it("historical analogue without the word 'happened'", () => {
    const message = "Has Bitcoin reacted like this to similar CPI surprises before?";
    expect(guardFlow({ message }).flow).toBe("HAS_THIS_HAPPENED_BEFORE");
    expect(questionTypeOf(message)).toBe("HISTORICAL");
  });

  it("causal driver phrasing without the word 'why'", () => {
    const message = "Is the current move mainly driven by ETF flows or macro?";
    expect(guardFlow({ message }).flow).toBe("WHY_IT_HAPPENED");
    expect(primaryFlowOf(message)).toBe("WHY_IT_HAPPENED");
  });

  it("bare causal leg joined by a conjunction: 'What happened, and why?'", () => {
    expect(guardFlow({ message: "What happened, and why?" }).flow).toBe("WHY_IT_HAPPENED");
  });
});

describe("compound questions chain both legs, primary first", () => {
  it("'What happened, and why?' chains causal over observational", () => {
    expect(chainedFlowsOf("What happened, and why?")).toEqual([
      "WHY_IT_HAPPENED",
      "WHAT_HAPPENED",
    ]);
  });

  it("thesis compound chains the causal premise behind the evaluation", () => {
    expect(chainedFlowsOf("Why did BTC fall, and does my bullish thesis still hold?")).toEqual([
      "DOES_MY_THESIS_HOLD",
      "WHY_IT_HAPPENED",
    ]);
  });

  it("a single-clause question never chains an incidental second pattern", () => {
    // "Why did BTC fall" also contains no thesis language, but a sentence that merely
    // mentions a thesis while asking one thing stays single-mode.
    expect(chainedFlowsOf("Why did BTC fall?")).toEqual(["WHY_IT_HAPPENED"]);
  });
});

describe("comparison questions stay flow-less (verify-first product decision)", () => {
  it.each([
    "Compare this move with ETH.",
    "Compare BTC with ETH performance this month.",
  ])("%j routes no flow and classifies COMPARISON", (sentence) => {
    expect(guardFlow({ message: sentence }).flow).toBeUndefined();
    expect(primaryFlowOf(sentence)).toBeUndefined();
    expect(questionTypeOf(sentence)).toBe("COMPARISON");
  });
});

describe("every fixture's requirement ledger satisfies its flow contract", () => {
  it.each(FIXTURES)("zero violations for %j", (sentence, expectedFlow) => {
    const flow = guardFlow({ message: sentence }).flow;
    expect(flow ?? undefined).toBe(expectedFlow);
    if (flow === undefined) return;

    const chain = chainedFlowsOf(sentence);
    const ledger = completeRequirements(sentence, [], {
      subject: "the subject",
      flow,
    });
    const check = assertFlowContract({
      flow,
      flows: chain as readonly string[],
      requirements: ledger.map((r) => ({ id: r.id, description: r.description, role: r.role })),
      dimensionOf: (d, role) => dimensionOfRequirement(d, role),
    });
    expect(check.violations, JSON.stringify(check.violations)).toHaveLength(0);
    expect(check.ok).toBe(true);
    expect(ledger.length).toBeGreaterThan(0);
    expect(contractFor(flow)).toBeDefined();
  });
});
