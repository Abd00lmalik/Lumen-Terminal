/**
 * D1 ROUTING GUARD (regression suite): the model proposes a flow classification; the
 * deterministic guard validates it against the message the user actually wrote. Production
 * showed wrong classifications ("What happened to X?" → FALSIFICATION, "Why did X rise?" →
 * FALSIFICATION, an explicit framework evaluation → unknown label). These tests pin:
 *   1. all EIGHT locked flows are reachable from the message's own task language when the
 *      model misclassifies (correction) or classifies nothing (determination);
 *   2. the model WINS whenever it does not contradict the message (no keyword-router takeover);
 *   3. explicit negative constraints veto both task-language routing AND the model's own
 *      classification ("do not explain why" must never reach CAUSAL, no falsification/thesis
 *      assessment through a constraint sentence);
 *   4. explicitConstraints extracts the user's prohibitions (with trimmed phrases) for dispatch;
 *   5. the guard never invents a flow: unknown/absent classification + no task language →
 *      undefined (generic research loop).
 */
import { describe, expect, it } from "vitest";
import { explicitConstraints, guardFlow } from "../../src/lui/flow-guard.js";
import { RESEARCH_FLOWS } from "../../src/model/schemas.js";

describe("the flow guard corrects a wrong model classification from the message's own language", () => {
  it("WHAT_HAPPENED: 'What happened to X?' never routes to falsification", () => {
    const result = guardFlow({
      message: "What happened to Bitcoin this week?",
      classified: "WHAT_COULD_PROVE_ME_WRONG",
    });
    expect(result.flow).toBe("WHAT_HAPPENED");
    expect(result.source).toBe("corrected");
    expect(result.correction?.from).toBe("WHAT_COULD_PROVE_ME_WRONG");
    expect(result.correction?.reason).toContain("task language");
  });

  it("WHY_IT_HAPPENED: 'Why did X rise?' never routes to falsification", () => {
    const result = guardFlow({ message: "Why did oil rise this week?", classified: "WHAT_HAPPENED" });
    expect(result.flow).toBe("WHY_IT_HAPPENED");
    expect(result.source).toBe("corrected");
  });

  it("WHAT_COULD_AFFECT_IT: factor language selects the factor-landscape flow", () => {
    const result = guardFlow({
      message: "What could affect the ETH price this quarter?",
      classified: "WHY_IT_HAPPENED",
    });
    expect(result.flow).toBe("WHAT_COULD_AFFECT_IT");
    expect(result.source).toBe("corrected");
  });

  it("DOES_MY_THESIS_HOLD: thesis-evaluation language selects the thesis flow", () => {
    const result = guardFlow({
      message: "Does my thesis still hold after this CPI print?",
      classified: "WHAT_COULD_PROVE_ME_WRONG",
    });
    expect(result.flow).toBe("DOES_MY_THESIS_HOLD");
    expect(result.source).toBe("corrected");
  });

  it("HAS_THIS_HAPPENED_BEFORE: precedent language selects the historical flow", () => {
    const result = guardFlow({ message: "Has this happened before?", classified: "WHAT_HAPPENED" });
    expect(result.flow).toBe("HAS_THIS_HAPPENED_BEFORE");
    expect(result.source).toBe("corrected");
  });

  it("WHAT_DOES_ALL_INFORMATION_SAY: aggregation language selects synthesis", () => {
    const result = guardFlow({
      message: "What does all the information say about BTC?",
      classified: "WHAT_HAPPENED",
    });
    expect(result.flow).toBe("WHAT_DOES_ALL_INFORMATION_SAY");
    expect(result.source).toBe("corrected");
  });

  it("WHAT_COULD_PROVE_ME_WRONG: falsification intent selects the challenge flow", () => {
    const result = guardFlow({
      message: "What could prove me wrong about my oil call?",
      classified: "DOES_MY_THESIS_HOLD",
    });
    expect(result.flow).toBe("WHAT_COULD_PROVE_ME_WRONG");
    expect(result.source).toBe("corrected");
  });

  it("EVALUATE_WITH_MY_FRAMEWORK: framework language is determined even when the model returned an unknown label", () => {
    const result = guardFlow({
      message:
        "Evaluate these hedges according to this framework: inflation beta weighted 60%, liquidity 40%.",
      classified: "NOT_A_LOCKED_FLOW",
    });
    expect(result.flow).toBe("EVALUATE_WITH_MY_FRAMEWORK");
    expect(result.source).toBe("determined");
    expect(result.correction).toBeUndefined(); // nothing to report from: the model said nothing usable
  });

  it("covers every locked flow: each of the 8 is reachable by its task language", () => {
    const reach = (message: string) => guardFlow({ message, classified: undefined }).flow;
    const reached = new Set(
      [
        reach("What happened to gold?"),
        reach("Why did gold drop?"),
        reach("What could move gold?"),
        reach("Does my thesis hold for gold?"),
        reach("Has this happened before?"),
        reach("What does all the information say about gold?"),
        reach("What could prove me wrong about gold?"),
        reach("Evaluate gold according to this framework: safety 70%."),
      ].filter((f) => f !== undefined),
    );
    expect(reached.size).toBe(RESEARCH_FLOWS.length);
    for (const flow of RESEARCH_FLOWS) expect(reached.has(flow)).toBe(true);
  });
});

describe("the model stays authoritative when the message does not contradict it", () => {
  it("keeps the model's flow when no task language selects one", () => {
    const result = guardFlow({
      message: "Tell me about the copper market.",
      classified: "HAS_THIS_HAPPENED_BEFORE",
    });
    expect(result.flow).toBe("HAS_THIS_HAPPENED_BEFORE");
    expect(result.source).toBe("model");
    expect(result.correction).toBeUndefined();
  });

  it("agreement between model and message reports source=model", () => {
    const result = guardFlow({ message: "What happened to gold?", classified: "WHAT_HAPPENED" });
    expect(result.flow).toBe("WHAT_HAPPENED");
    expect(result.source).toBe("model");
  });
});

describe("explicit negative constraints veto routing", () => {
  it("'do not explain why' suppresses CAUSAL even when the model classified it", () => {
    const result = guardFlow({ message: "Do not explain why it rose this week.", classified: "WHY_IT_HAPPENED" });
    expect(result.flow).toBeUndefined();
    expect(result.source).toBe("none");
    expect(result.correction?.from).toBe("WHY_IT_HAPPENED");
    expect(result.correction?.reason).toContain("constraint");
  });

  it("the same constraint leaves a non-causal model classification alone", () => {
    const result = guardFlow({ message: "Do not explain why it rose this week.", classified: "WHAT_HAPPENED" });
    expect(result.flow).toBe("WHAT_HAPPENED");
    expect(result.source).toBe("model");
  });

  it("no falsification through a constraint sentence: model FALSIFICATION is vetoed", () => {
    const result = guardFlow({ message: "Do not run a falsification on this.", classified: "WHAT_COULD_PROVE_ME_WRONG" });
    expect(result.flow).toBeUndefined();
    expect(result.source).toBe("none");
  });

  it("no thesis assessment: without a usable model flow the generic loop runs", () => {
    const result = guardFlow({ message: "Do not perform a thesis evaluation; just watch the market.", classified: undefined });
    expect(result.flow).toBeUndefined();
    expect(result.source).toBe("none");
  });

  it("a constraint on thesis never vetoes a non-thesis methodology", () => {
    const result = guardFlow({
      message: "Do not perform a thesis evaluation; just watch the market.",
      classified: "EVALUATE_WITH_MY_FRAMEWORK",
    });
    expect(result.flow).toBe("EVALUATE_WITH_MY_FRAMEWORK");
    expect(result.source).toBe("model");
  });
});

describe("the guard never invents a flow", () => {
  it("unknown classification without task language → generic loop", () => {
    const result = guardFlow({ message: "Hello there.", classified: "NOT_A_LOCKED_FLOW" });
    expect(result.flow).toBeUndefined();
    expect(result.source).toBe("none");
  });

  it("no classification and no task language → generic loop", () => {
    const result = guardFlow({ message: "Hello there.", classified: undefined });
    expect(result.flow).toBeUndefined();
    expect(result.source).toBe("none");
  });

  it("only members of the locked 8 are ever returned", () => {
    for (const message of [
      "What happened to Bitcoin?",
      "Why did oil rise?",
      "What could prove me wrong?",
      "Evaluate gold according to this framework: safety 70%.",
    ]) {
      const flow = guardFlow({ message, classified: "SOMETHING_ELSE" }).flow;
      expect(RESEARCH_FLOWS).toContain(flow);
    }
  });
});

describe("explicitConstraints carries the user's prohibitions to dispatch", () => {
  it("extracts each constraint kind with a trimmed phrase", () => {
    const constraints = explicitConstraints(
      "Do not explain why, do not perform a thesis assessment, do not run a falsification, and do not give trading advice.",
    );
    const kinds = constraints.map((c) => c.kind);
    expect(kinds).toContain("NO_CAUSAL");
    expect(kinds).toContain("NO_THESIS");
    expect(kinds).toContain("NO_FALSIFICATION");
    expect(kinds).toContain("NO_TRADING_ADVICE");
    for (const c of constraints) {
      expect(c.phrase).toBe(c.phrase.trim());
      expect(c.phrase.length).toBeGreaterThan(0);
    }
  });

  it("returns an empty list for a message with no prohibitions", () => {
    expect(explicitConstraints("What happened to Bitcoin this week?")).toEqual([]);
  });

  it("NO_TRADING_ADVICE is a dispatch-level constraint, never a flow suppressor", () => {
    // The prohibition travels with the request; it must not redirect the methodology.
    const result = guardFlow({ message: "Do not give trading advice on oil.", classified: "WHY_IT_HAPPENED" });
    expect(result.flow).toBe("WHY_IT_HAPPENED");
    expect(result.source).toBe("model");
    expect(explicitConstraints("Do not give trading advice on oil.").map((c) => c.kind)).toEqual([
      "NO_TRADING_ADVICE",
    ]);
  });
});
