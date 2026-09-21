/**
 * RESEARCH CONTRACT regression tests (decision-quality mandate §2/§3/§5/§9).
 *
 * The engine — not the model — decides which decision dimensions a question requires. These tests
 * pin the generic laws:
 *  - question type is inferred from the question's own wording (no asset list, no question list),
 *  - an omitted dimension is ADDED with a role, never invented evidence,
 *  - market-class-specific dimensions apply only to their class (supply/demand is a commodity
 *    dimension, not a yields dimension),
 *  - every ledger carries a CHALLENGE requirement, and an unattempted challenge blocks completion
 *    while an attempted one does not,
 *  - the retrieval brief handed to recovery workers names the requirement, not just the question.
 */
import { describe, expect, it } from "vitest";
import {
  blockingRequirements,
  buildRequirements,
  completeRequirements,
  markChallengeAttempted,
  markUnattemptableChallenges,
  questionTypeOf,
  subjectMarketClassOf,
} from "../../src/research/requirements.js";
import { engineMarketClass, retrievalBrief } from "../../src/research/adaptive.js";

const EVENT_QUESTION = "What could affect NVDA around its next earnings?";

describe("research contract: question type is read from the question", () => {
  it("classifies unseen questions by their decision shape", () => {
    expect(questionTypeOf("How is TSLA trading compared with last week?")).toBe("COMPARISON");
    expect(questionTypeOf("What is driving platinum prices this week?")).toBe("CAUSAL");
    expect(questionTypeOf(EVENT_QUESTION)).toBe("EVENT");
    expect(questionTypeOf("What macro conditions favor risk assets right now?")).toBe("MACRO_REGIME");
    expect(questionTypeOf("Does my thesis that copper demand is weakening still hold?")).toBe("THESIS");
    expect(questionTypeOf("What could prove my NVDA thesis wrong?")).toBe("FALSIFICATION");
    expect(questionTypeOf("Has the current TSLA setup happened before?")).toBe("HISTORICAL");
    expect(questionTypeOf("What does all the information say about NVDA?")).toBe("SYNTHESIS");
  });

  it("reads the subject market class from the question's own vocabulary", () => {
    expect(subjectMarketClassOf("What is driving platinum prices this week?")).toBe("METAL");
    expect(subjectMarketClassOf("What is pushing Treasury yields higher?")).toBe("RATES");
    expect(subjectMarketClassOf("What could affect EUR/USD?")).toBe("FX");
    expect(subjectMarketClassOf("What is happening with bitcoin today?")).toBe("CRYPTO");
    expect(engineMarketClass(EVENT_QUESTION, "NVDA")).toBe("EQUITY");
  });
});

describe("research contract: the engine completes the ledger", () => {
  it("requires commodity supply AND demand for a commodity causal question the model under-specified", () => {
    const q = "What is driving platinum prices this week?";
    const model = buildRequirements([{ description: "current platinum price action", importance: "CRITICAL", timeSensitivity: "CURRENT" }]);
    const ledger = completeRequirements(q, model, { subject: "PL=F", marketClass: "METAL" });
    const added = ledger.filter((r) => r.engineRequired === true);
    expect(added.map((r) => r.role)).toContain("CORE");
    expect(added.filter((r) => r.role === "CORE").length).toBe(2); // supply + demand
    // The model's own requirement is preserved, never downgraded.
    expect(ledger[0]?.description).toBe(model[0]?.description);
    expect(ledger[0]?.importance).toBe("CRITICAL");
  });

  it("does not impose commodity supply/demand on a rates question", () => {
    const q = "What is pushing Treasury yields higher?";
    const ledger = completeRequirements(q, [], { marketClass: "RATES" });
    const descriptions = ledger.map((r) => r.description).join(" | ");
    expect(descriptions).not.toMatch(/supply|demand|inventor/i);
    // Every ledger still carries the challenge dimension.
    expect(ledger.some((r) => r.role === "CHALLENGE")).toBe(true);
  });

  it("role, not vocabulary alone, decides whether a dimension is already asked", () => {
    // A CORE requirement that happens to contain challenge vocabulary must not satisfy the
    // CHALLENGE dimension (the live defect: "supports the thesis that NVDA is weakening").
    const thesis = completeRequirements("Does my thesis that NVDA is weakening still hold?", buildRequirements([
      { description: "evidence that supports the thesis that NVDA is weakening", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ]), { subject: "NVDA", marketClass: "EQUITY" });
    expect(thesis.some((r) => r.role === "CHALLENGE")).toBe(true);

    // A real CHALLENGE requirement does satisfy it (no duplicate dimension).
    const falsification = completeRequirements(
      "What could prove my NVDA thesis wrong?",
      [{ ...buildRequirements([{ description: "challenge evidence that would weaken the thesis", importance: "CRITICAL", timeSensitivity: "CURRENT" }])[0]!, role: "CHALLENGE" }],
      { subject: "NVDA", marketClass: "EQUITY" },
    );
    expect(falsification.filter((r) => r.role === "CHALLENGE")).toHaveLength(1);
  });

  it("requires the event's timing and consensus, and a historical question's outcomes", () => {
    const event = completeRequirements(EVENT_QUESTION, [], { subject: "NVDA", marketClass: "EQUITY" });
    expect(event.map((r) => r.description).join(" | ")).toMatch(/timing of the upcoming event/);
    expect(event.map((r) => r.description).join(" | ")).toMatch(/consensus expectations/);

    const historical = completeRequirements("Has the current TSLA setup happened before?", [], { subject: "TSLA", marketClass: "INDEX" });
    expect(historical.map((r) => r.description).join(" | ")).toMatch(/resolved afterwards/);
    expect(historical.find((r) => /resolved afterwards/.test(r.description))?.calculation).toBe("EPISODE_SIMILARITY");
  });
});

describe("research contract: completion laws by role", () => {
  const ledger = completeRequirements("What is driving platinum prices this week?", buildRequirements([
    { description: "current platinum price action", importance: "CRITICAL", timeSensitivity: "CURRENT" },
  ]), { subject: "PL=F", marketClass: "METAL" });

  it("an unattempted CHALLENGE blocks completion; attempting it does not", () => {
    expect(blockingRequirements(ledger).some((r) => r.role === "CHALLENGE")).toBe(true);
    const attempted = markChallengeAttempted(ledger, ["FALSIFICATION"]);
    expect(blockingRequirements(attempted).some((r) => r.role === "CHALLENGE")).toBe(false);
    // Only a disconfirmation-capable capability counts as an attempt.
    expect(blockingRequirements(markChallengeAttempted(ledger, ["NEWS_ANALYSIS"])).some((r) => r.role === "CHALLENGE")).toBe(true);
  });

  it("a deployment with no disconfirmation route records the blocker instead of blocking forever", () => {
    const noRoute = markUnattemptableChallenges(ledger, (cap) => cap === "NEWS_ANALYSIS");
    const challenge = noRoute.find((r) => r.role === "CHALLENGE");
    expect(challenge?.status).toBe("UNAVAILABLE");
    expect(challenge?.missingReason).toMatch(/disconfirmation-capable provider/);
    expect(blockingRequirements(noRoute).some((r) => r.role === "CHALLENGE")).toBe(false);
    // A registered route leaves the requirement intact (it must then be attempted).
    expect(markUnattemptableChallenges(ledger, (cap) => cap === "FALSIFICATION").find((r) => r.role === "CHALLENGE")?.status).toBe("PENDING");
  });

  it("CONTEXT never blocks completion", () => {
    const withContext = [...ledger, { ...ledger[0]!, id: "rq_context", role: "CONTEXT", description: "background market history" }];
    expect(blockingRequirements(withContext).some((r) => r.id === "rq_context")).toBe(false);
  });
});

describe("research contract: retrieval is requirement-scoped", () => {
  it("the recovery brief names each unresolved requirement, its window and its evidence classes", () => {
    const unresolved = completeRequirements("What is driving platinum prices this week?", [], { subject: "PL=F", marketClass: "METAL" })
      .filter((r) => r.role === "CORE");
    const brief = retrievalBrief("What is driving platinum prices this week?", unresolved);
    expect(brief).toContain("What is driving platinum prices this week?");
    expect(brief).toMatch(/supply and producer side factors/);
    expect(brief).toMatch(/Evidence classes:/);
    expect(brief).toMatch(/do not answer the whole question/i);
    // It carries requirement text, not just the question.
    expect(brief.length).toBeGreaterThan("What is driving platinum prices this week?".length * 2);
  });
});
