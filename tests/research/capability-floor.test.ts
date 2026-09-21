/**
 * Capability-floor and engine-recovery laws (research coverage contract).
 *
 * Live failures under test (2026-09-21):
 * - MISSING DIRECT CAPABILITY: "what is driving Treasury yields higher" planned only a news
 *   capability, so no yield observation was ever retrieved and the run reported the question
 *   could not be answered — without the engine ever trying the capability its own requirement
 *   mapped to. The model proposes capabilities; it may not omit one a CRITICAL engine-derived
 *   requirement depends on.
 * - PREMATURE INSUFFICIENCY: the model's INSUFFICIENT_EVIDENCE ended the run immediately, so
 *   "insufficient" could mean "the first plan came up short" instead of "the registered
 *   evidence paths were exhausted".
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";
import { mandatoryCapabilities } from "../../src/research/requirements.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "capability-floor test" };
const QUESTION = "What is driving Treasury yields higher?";
const REQUIREMENTS = [
  { description: "current Treasury yields levels and recent change", importance: "CRITICAL", timeSensitivity: "CURRENT" },
];

function plan(requirements: unknown[], capabilities: string[]): string {
  return JSON.stringify({
    objective: QUESTION,
    scopeIncluded: ["yields"], scopeExcluded: [],
    tasks: [{ type: "FACT_FINDING", objective: QUESTION, capabilities, completion: "requirements covered or absence recorded" }],
    requirements,
    completionCriteria: ["requirements covered or honest insufficiency"],
    adaptationPolicy: "n/a",
  });
}

const SYNTHESIS = JSON.stringify({
  direct: "Direct answer for the question.",
  why: "Because the validated evidence establishes it.",
  support: [{ statement: "Evidence-grounded support.", refs: [] }], oppose: [],
  factors: [{ factor: "rate expectations", mechanism: "discount-rate channel", direction: "headwind", refs: [] }],
  uncertainty: "What remains unresolved is stated in the ledger.",
});

/** A capture provider: records its executions and returns one observation. */
function capturing(capability: string, observations: readonly string[], executed: string[], about?: string): ProviderAdapter {
  return {
    providerId: `harness/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
      executed.push(cap);
      return {
        tool: `harness/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: observations.map((content) => ({
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          content,
          ...(about !== undefined ? { about } : {}),
        })),
      };
    },
  };
}

async function run(options: {
  readonly plan: string;
  readonly decision: string;
  readonly registry: CapabilityRegistry;
  readonly maxRounds: number;
}): Promise<AdaptiveLoopOutcome> {
  const provider = new FakeModelProvider(new Map([
    ["research.plan", options.plan],
    ["research.adaptive_decision", responses.adaptiveDecision(options.decision)],
    ["research.answer_synthesis", SYNTHESIS],
  ]));
  const ws = new Workspace();
  const research = ws.addResearch({ objective: QUESTION, question: QUESTION, flow: "WHY_IT_HAPPENED" }, origin);
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  return runAdaptiveResearch(QUESTION, research.id, {
    provider, registry: options.registry, workspace: ws, store: new MemoryStore(),
    maxRounds: options.maxRounds, capabilityParams: { asset: "^TNX" },
  });
}

beforeEach(() => resetIdCounters());

describe("engine-owned capability floor", () => {
  it("maps a CRITICAL requirement to capabilities without consulting the question text", () => {
    const floor = mandatoryCapabilities(
      [{ id: "r1", description: "current Treasury yields levels", importance: "CRITICAL", timeSensitivity: "CURRENT", domains: ["MACRO"], status: "PENDING", evidenceRefs: [], staleOnlyRefs: [], recoveryAttempts: 0 }],
      { isAvailable: (cap) => cap === "MACRO_ANALYSIS" || cap === "EQUITY_MARKET_DATA" },
    );
    expect(floor).toContain("MACRO_ANALYSIS");
    // SUPPORTING requirements never spend a mandatory call.
    const supporting = mandatoryCapabilities(
      [{ id: "r2", description: "current Treasury yields levels", importance: "SUPPORTING", timeSensitivity: "CURRENT", domains: ["MACRO"], status: "PENDING", evidenceRefs: [], staleOnlyRefs: [], recoveryAttempts: 0 }],
      { isAvailable: () => true },
    );
    expect(supporting).toHaveLength(0);
    // A capability no provider serves is never scheduled (it would look like work, not be work).
    expect(mandatoryCapabilities(
      [{ id: "r3", description: "current Treasury yields levels", importance: "CRITICAL", timeSensitivity: "CURRENT", domains: ["MACRO"], status: "PENDING", evidenceRefs: [], staleOnlyRefs: [], recoveryAttempts: 0 }],
      { isAvailable: () => false },
    )).toHaveLength(0);
  });

  it("executes the mapped capability even when the plan named only a news capability", async () => {
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    registry.register(capturing("NEWS_ANALYSIS", ["General market commentary with no yield level."], executed, "^TNX"));
    registry.register(capturing("MACRO_ANALYSIS", ["The 10-year Treasury yield is 4.998 percent, up 0.75 percent on the day."], executed, "^TNX"));

    const outcome = await run({ plan: plan(REQUIREMENTS, ["NEWS_ANALYSIS"]), decision: "COMPLETE", registry, maxRounds: 1 });

    expect(executed).toContain("MACRO_ANALYSIS");
    expect(outcome.floorCapabilities).toContain("MACRO_ANALYSIS");
    // And the requirement is genuinely covered by the floor's retrieval, not by the plan's.
    const req = outcome.requirements?.find((r) => r.description.includes("Treasury yields"));
    expect(req?.status).toBe("SATISFIED");
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
  });

  it("attempts disconfirmation for an analytic question instead of leaving opposition to the prompt", async () => {
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    registry.register(capturing("MACRO_ANALYSIS", ["The 10-year Treasury yield is 4.998 percent, up 0.75 percent on the day."], executed, "^TNX"));
    registry.register(capturing("FALSIFICATION", ["Counter-case: the move may be technical positioning rather than a policy shift."], executed, "^TNX"));

    const outcome = await run({ plan: plan(REQUIREMENTS, ["MACRO_ANALYSIS"]), decision: "COMPLETE", registry, maxRounds: 1 });

    expect(executed).toContain("FALSIFICATION");
    expect(outcome.floorCapabilities).toContain("FALSIFICATION");
  });

  it("never schedules a subject-scoped capability for a question that earned no subject", async () => {
    // Observed live on the macro-regime question: the floor dispatched EQUITY_MARKET_DATA and
    // EARNINGS_CALENDAR, which cannot run without a symbol and came back SCHEMA_ERROR — a
    // wasted round recorded as a capability failure.
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    registry.register(capturing("MACRO_ANALYSIS", ["VIX is 14.81; the 10-year Treasury yield is 4.998 percent; the dollar index is 100.215."], executed));
    registry.register(capturing("EQUITY_MARKET_DATA", ["ignored"], executed));
    registry.register(capturing("EARNINGS_CALENDAR", ["ignored"], executed));

    const provider = new FakeModelProvider(new Map([
      ["research.plan", plan(REQUIREMENTS, [])],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["research.answer_synthesis", SYNTHESIS],
    ]));
    const ws = new Workspace();
    const research = ws.addResearch({ objective: QUESTION, question: QUESTION, flow: "WHY_IT_HAPPENED" }, origin);
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
    // NOTE: no capabilityParams — the question earned no asset (subjectless dispatch).
    const outcome = await runAdaptiveResearch(QUESTION, research.id, {
      provider, registry, workspace: ws, store: new MemoryStore(), maxRounds: 1,
    });

    expect(outcome.floorCapabilities).toContain("MACRO_ANALYSIS");
    expect(executed).not.toContain("EQUITY_MARKET_DATA");
    expect(executed).not.toContain("EARNINGS_CALENDAR");
  });

  it("does not duplicate a capability the plan already requested", async () => {
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    registry.register(capturing("MACRO_ANALYSIS", ["The 10-year Treasury yield is 4.998 percent."], executed, "^TNX"));
    registry.register(capturing("EQUITY_MARKET_DATA", ["^TNX 4.998 percent."], executed, "^TNX"));

    const outcome = await run({ plan: plan(REQUIREMENTS, ["MACRO_ANALYSIS"]), decision: "COMPLETE", registry, maxRounds: 1 });

    expect(executed.filter((c) => c === "MACRO_ANALYSIS")).toHaveLength(1);
    expect(outcome.floorCapabilities ?? []).not.toContain("MACRO_ANALYSIS");
  });
});

describe("engine-owned recovery before accepting insufficiency", () => {
  it("a model 'insufficient' cannot end the run while untried evidence paths remain", async () => {
    // The plan requests BOTH capabilities that map to the blocking requirement and both come
    // back empty, so the proactive floor has nothing left to add. The model gives up. The
    // engine must still exhaust the remaining registered paths (the recovery tier) before
    // accepting that the question cannot be answered.
    const executed: string[] = [];
    const empty = (capability: string) => ({
      providerId: `harness/${capability.toLowerCase()}`,
      capabilities: [capability],
      limitations: ["fixture"],
      freshnessProfile: "test:live",
      async execute(cap: string) {
        executed.push(cap);
        return {
          tool: `harness/${capability.toLowerCase()}`, capability: cap, transport: "fake",
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: "no acceptable spot level in payload" }],
          completeness: "EMPTY" as const, freshness: "CURRENT" as const, validation: "VALID" as const,
          failure: { type: "EMPTY_RESULT" as const, message: "no usable outputs", retriable: true },
        };
      },
    });
    const registry = new CapabilityRegistry();
    registry.register(empty("MACRO_ANALYSIS"));
    registry.register(empty("EQUITY_MARKET_DATA"));
    registry.register(capturing("CROSS_DOMAIN_SYNTHESIS", ["Treasury yields rose as fiscal supply concerns met firm growth data."], executed, "^TNX"));

    const outcome = await run({
      plan: plan(REQUIREMENTS, ["MACRO_ANALYSIS", "EQUITY_MARKET_DATA"]),
      decision: "INSUFFICIENT_EVIDENCE",
      registry,
      maxRounds: 3,
    });

    // The engine exhausted the remaining registered path before accepting the conclusion.
    expect(executed).toContain("CROSS_DOMAIN_SYNTHESIS");
    expect(outcome.recoveryRounds).toBeGreaterThan(0);
    // Both mapped capabilities ran exactly once (the floor did not re-run what the plan asked
    // for, and recovery never repeats a path that already returned nothing).
    expect(executed.filter((c) => c === "MACRO_ANALYSIS")).toHaveLength(1);
    expect(executed.filter((c) => c === "EQUITY_MARKET_DATA")).toHaveLength(1);
    expect(["MODEL_INSUFFICIENT_EVIDENCE", "EVIDENCE_SUFFICIENT", "REQUIREMENT_GAPS_UNRESOLVED"]).toContain(outcome.stoppedBecause);
  });

  it("insufficiency stands honestly when no recovery path exists at all", async () => {
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "harness/macro", capabilities: ["MACRO_ANALYSIS"], limitations: ["fixture"], freshnessProfile: "test:live",
      async execute(cap) {
        executed.push(cap);
        return {
          tool: "harness/macro", capability: cap, transport: "fake",
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: "empty" }],
          completeness: "EMPTY", freshness: "CURRENT", validation: "VALID",
          failure: { type: "EMPTY_RESULT" as const, message: "no usable outputs", retriable: true },
        };
      },
    });

    const outcome = await run({ plan: plan(REQUIREMENTS, ["MACRO_ANALYSIS"]), decision: "INSUFFICIENT_EVIDENCE", registry, maxRounds: 2 });

    expect(outcome.stoppedBecause).toBe("MODEL_INSUFFICIENT_EVIDENCE");
    const req = outcome.requirements?.find((r) => r.description.includes("Treasury yields"));
    // Exhausted honestly: the engine records the attempt rather than claiming coverage.
    expect(req?.status).toBe("EXHAUSTED");
    expect(req?.missingReason ?? "").toMatch(/recovery|no relevant evidence/i);
  });
});
