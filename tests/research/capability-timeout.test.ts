/**
 * BOUNDED CAPABILITY SCHEDULING — deterministic regression tests for the shared engine.
 *
 * Root cause this pins (the BTC observation test exposed it, but nothing here is BTC- or
 * crypto-specific): the engine executed a wave of independent capabilities with `Promise.all`
 * and no per-call bound, so ONE slow or hung capability held the whole wave open — its fast
 * siblings delivered nothing until it returned (never, if it hung), and the run blew its
 * wall-clock budget. The fix is generic: every capability call is raced against its own
 * bounded slice, and the abandoned call yields an honest TIMEOUT TOOL_RESULT (no fabricated
 * evidence) while its independent siblings continue.
 *
 * The same law is asserted for the adaptive loop (all research flows) and the flow runner
 * (Flows 2/6/7...), for several asset classes, so a future capability registered through the
 * existing architecture inherits it without another patch.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import {
  runAdaptiveResearch,
  capabilitySlice,
  memberDeadline,
  CAPABILITY_SLICE_MS,
  type AdaptiveLoopOutcome,
} from "../../src/research/adaptive.js";
import { runFlow, FLOW_OBJECTIVES } from "../../src/research/flow-runner.js";

const origin = { kind: "agent" as const, detail: "capability-timeout test" };
const START = Date.parse("2026-10-09T12:00:00Z");

/** A capability whose provider NEVER settles (a hung transport, not a failed one). */
function hangingCapability(capability: string): ProviderAdapter {
  return {
    providerId: `hang/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: [],
    freshnessProfile: "test:live",
    async execute(): Promise<never> {
      return new Promise<never>(() => {
        /* never settles: the engine must stop WAITING on it */
      });
    },
  };
}

/** A capability that resolves immediately with one on-subject observation. */
function fastCapability(capability: string, about: string): ProviderAdapter {
  return {
    providerId: `fast/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: [],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fast/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [
          { outputClass: "QUANTITATIVE_OBSERVATION" as const, content: `${about} reading this week`, about },
        ],
      };
    },
  };
}

function planFor(question: string, capabilities: string[]): string {
  return JSON.stringify({
    objective: question,
    scopeIncluded: [], scopeExcluded: [],
    tasks: [{ type: "FACT_FINDING", objective: question, capabilities, completion: "c" }],
    requirements: [],
    completionCriteria: [], adaptationPolicy: "n/a",
  });
}

const SYNTHESIS = JSON.stringify({
  direct: "Direct answer grounded in the collected evidence.",
  why: "The validated evidence establishes the factors above.",
  support: [{ statement: "Evidence-grounded support.", refs: [] }],
  oppose: [],
  confidence: "LOW",
  keyUncertainty: "some requirements remain unresearched",
  implication: "monitor the drivers above",
  citedObjectRefs: [],
});

interface Scenario {
  readonly label: string;
  readonly question: string;
  readonly flow: string;
  readonly asset: string;
  readonly fast: string;
  readonly hung: string;
}

/**
 * Several asset classes, each a DISTINCT capability pair the registry actually serves, so the
 * bound is proven to be part of the shared scheduler and not an asset-specific branch.
 */
const SCENARIOS: readonly Scenario[] = [
  { label: "crypto", question: "Why did Bitcoin move this week?", flow: "WHY_IT_HAPPENED", asset: "BTC", fast: "SENTIMENT_ANALYSIS", hung: "NEWS_ANALYSIS" },
  { label: "equity", question: "Why did Nvidia stock move this week?", flow: "WHY_IT_HAPPENED", asset: "NVDA", fast: "EQUITY_NEWS", hung: "EQUITY_FUNDAMENTALS" },
  { label: "commodity", question: "What drove the move in crude oil this month?", flow: "WHY_IT_HAPPENED", asset: "CL=F", fast: "MACRO_ANALYSIS", hung: "COMMODITY_MARKET_DATA" },
];

async function runScenario(s: Scenario, sliceMs: number): Promise<{ outcome: AdaptiveLoopOutcome; elapsedMs: number }> {
  const registry = new CapabilityRegistry();
  registry.register(fastCapability(s.fast, s.asset));
  registry.register(hangingCapability(s.hung));
  const provider = new FakeModelProvider(new Map<string, unknown>([
    ["research.plan", planFor(s.question, [s.fast, s.hung])],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ["research.answer_synthesis", SYNTHESIS],
  ]));
  const ws = new Workspace();
  const research = ws.addResearch({ objective: s.question, question: s.question, flow: s.flow }, origin);
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  const startedAt = Date.now();
  const outcome = await runAdaptiveResearch(s.question, research.id, {
    provider, registry, workspace: ws, store: new MemoryStore(),
    capabilityParams: { asset: s.asset, question: s.question },
    capabilitySliceMs: sliceMs,
    maxRounds: 1,
    now: () => new Date(START),
  });
  return { outcome, elapsedMs: Date.now() - startedAt };
}

beforeEach(() => resetIdCounters());

describe("scheduling primitives", () => {
  it("capabilitySlice defaults to one slice and honors an injected test slice", () => {
    expect(capabilitySlice()).toBe(CAPABILITY_SLICE_MS);
    expect(capabilitySlice(undefined)).toBe(CAPABILITY_SLICE_MS);
    expect(capabilitySlice(25)).toBe(25);
    // A non-positive injection is ignored (the production bound always applies).
    expect(capabilitySlice(0)).toBe(CAPABILITY_SLICE_MS);
  });

  it("memberDeadline slices the remaining budget fairly and never extends past the deadline", () => {
    // No deadline or a lone member: unchanged.
    expect(memberDeadline(undefined, START, 3)).toBeUndefined();
    expect(memberDeadline(START + 90_000, START, 1)).toBe(START + 90_000);
    // Two members, 90s left: the first gets half; the second receives the rest.
    expect(memberDeadline(START + 90_000, START, 2)).toBe(START + 45_000);
    expect(memberDeadline(START + 90_000, START + 45_000, 1)).toBe(START + 90_000);
    // Never past the deadline, even for a bounded number of members.
    expect(memberDeadline(START + 90_000, START, 5)).toBe(START + 18_000);
    // Already past: the caller sees the real deadline (the loop then stops honestly).
    expect(memberDeadline(START - 1, START, 2)).toBe(START - 1);
  });
});

describe("bounded capability wave (adaptive loop, cross-asset)", () => {
  for (const s of SCENARIOS) {
    it(`${s.label}: a hung capability is abandoned while its fast sibling's evidence survives`, async () => {
      const sliceMs = 60;
      const { outcome, elapsedMs } = await runScenario(s, sliceMs);

      // The wave settled at the slice, not after an unbounded wait.
      expect(elapsedMs).toBeLessThan(5_000);

      // The hung capability is recorded as an honest TIMEOUT with no evidence — never a crash,
      // never fabricated output, never negative evidence.
      const hung = outcome.executions.find((e) => e.capability === s.hung);
      expect(hung).toBeDefined();
      expect(hung!.result.failure.type).toBe("TIMEOUT");
      expect(hung!.result.completeness).toBe("EMPTY");
      expect(hung!.result.normalizedOutput).toHaveLength(0);
      expect(hung!.evidenceIds).toHaveLength(0);

      // The fast sibling ran and its evidence is preserved in the outcome and the graph.
      const fast = outcome.executions.find((e) => e.capability === s.fast);
      expect(fast).toBeDefined();
      expect(fast!.result.failure.type).toBe("NONE");
      expect(fast!.evidenceIds.length).toBeGreaterThan(0);
      expect(outcome.evidence.length).toBeGreaterThan(0);

      // A hung capability is a capability failure, not a model failure, and the run still
      // produced a valid (partial) result.
      expect(outcome.modelFailure).toBeUndefined();
      expect(outcome.stoppedBecause).not.toBe("MODEL_FAILURE");
      // The hung path is distinguishable from an unavailable/empty source.
      expect(hung!.result.failure.type).not.toBe("UNAVAILABLE");
      expect(hung!.result.failure.type).not.toBe("EMPTY_RESULT");
    });
  }
});

describe("bounded capability execution (shared flow runner)", () => {
  it("Flow 6 abandons a hung dimension while the independent dimension still delivers", async () => {
    const question = "What does all information say about Bitcoin?";
    const PLAN = JSON.stringify({
      objective: question,
      scopeIncluded: [], scopeExcluded: [],
      tasks: [
        { type: "TECH", objective: "technicals", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
        { type: "NEWS", objective: "narratives", capabilities: ["NEWS_ANALYSIS"], completion: "c" },
      ],
      completionCriteria: ["domains covered"], adaptationPolicy: "n/a",
    });
    const registry = new CapabilityRegistry();
    registry.register(fastCapability("TECHNICAL_ANALYSIS", "BTC"));
    registry.register(hangingCapability("NEWS_ANALYSIS"));
    const provider = new FakeModelProvider(new Map<string, unknown>([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: question, question, flow: "WHAT_DOES_ALL_INFORMATION_SAY" }, origin);
    workspace.transitionResearch(research.id, "ACTIVE", origin, "activated");
    const startedAt = Date.now();
    const outcome = await runFlow(question, FLOW_OBJECTIVES.WHAT_DOES_ALL_INFORMATION_SAY!, research.id, {
      provider, registry, workspace, store: new MemoryStore(),
      capabilityParams: { asset: "BTC", question },
      capabilitySliceMs: 60,
    });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    const hung = outcome.executions.find((e) => e.capability === "NEWS_ANALYSIS");
    expect(hung?.result.failure.type).toBe("TIMEOUT");
    expect(hung?.evidenceIds).toHaveLength(0);
    // The independent dimension still produced evidence; the flow did not fail as a whole.
    expect(outcome.executions.some((e) => e.evidenceIds.length > 0)).toBe(true);
    expect(outcome.stoppedBecause).not.toBe("MODEL_FAILURE");
  });
});
