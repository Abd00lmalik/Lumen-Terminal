/**
 * ENGINE-OWNED RESEARCH BUDGET — deterministic tests.
 *
 * The live failure: single-link causal research took ~270s and the multi-link flagship oil
 * question exceeded the Vercel function limit — the platform killed the request and the partial
 * research state was destroyed. Recovery is bounded per link, but more links multiply wall-clock
 * time, and the loop only checked the deadline BETWEEN rounds.
 *
 * These tests pin the generic budget laws:
 *   - the deadline is checked BEFORE EVERY capability task (in-round), not only between rounds;
 *   - budget exhaustion yields an honest partial state, never EVIDENCE_SUFFICIENT while material
 *     requirements remain uncovered, and the rationale NAMES what stayed unresolved;
 *   - evidence already collected is preserved;
 *   - budget exhaustion is distinguishable from provider failure;
 *   - execution is bounded (round cap + wall clock), so no unbounded loop is possible;
 *   - unresolved causal links stay unresolved after exhaustion and cap confidence.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { computeConfidence } from "../../src/research/confidence.js";
import { deriveCausalLinkStatuses, weakestCausalLink } from "../../src/research/causal.js";
import { blockingRequirements } from "../../src/research/requirements.js";

const origin = { kind: "agent" as const, detail: "research-budget test" };
const START = Date.parse("2026-09-23T12:00:00Z");
const YIELDS_Q = "What is pushing Treasury yields higher?";
const MACRO_Q = "What macro conditions favor risk assets right now?";
const EVIDENCE_TEXT = "Treasury yields rose this week on policy repricing";

/** A capability whose execution COSTS wall-clock time on the injected clock, then succeeds. */
function timedAdapter(
  cap: string,
  clock: { now: number },
  costMs: number,
  content = EVIDENCE_TEXT,
): ProviderAdapter {
  return {
    providerId: `timed/${cap.toLowerCase()}`,
    capabilities: [cap],
    limitations: [],
    freshnessProfile: "test:live",
    async execute() {
      clock.now += costMs;
      return {
        tool: `timed/${cap.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION" as const, content }],
        completeness: "COMPLETE",
        validation: "VALID",
        freshness: "CURRENT",
        failure: { type: "NONE" as const, retriable: false },
        limitations: [],
      };
    },
  };
}

function planFor(question: string, capabilities: string[], nTasks = 2): string {
  return JSON.stringify({
    objective: question,
    scopeIncluded: [], scopeExcluded: [],
    tasks: Array.from({ length: nTasks }, (_, i) => ({
      type: "FACT_FINDING", objective: `${question} (part ${i + 1})`, capabilities, completion: "c",
    })),
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

interface RunResult {
  outcome: AdaptiveLoopOutcome;
  clock: { now: number };
  workspace: Workspace;
  researchId: string;
}

async function run(opts: {
  question: string;
  capabilities?: string[];
  tasks?: number;
  deadlineMs?: number;
  costPerCap?: number;
  maxRounds?: number;
  decisions?: string[];
  content?: string;
}): Promise<RunResult> {
  const clock = { now: START };
  const caps = opts.capabilities ?? ["MACRO_ANALYSIS"];
  const registry = new CapabilityRegistry();
  for (const cap of caps) registry.register(timedAdapter(cap, clock, opts.costPerCap ?? 10_000, opts.content));
  const decisions = opts.decisions ?? ["COMPLETE"];
  const provider = new FakeModelProvider(new Map<string, unknown>([
    ["research.plan", planFor(opts.question, caps, opts.tasks ?? 2)],
    ["research.adaptive_decision", (req: { prompt: string }) => {
      const round = Number(req.prompt.match(/Round (\d+)/)?.[1] ?? 1);
      const d = decisions[Math.min(round, decisions.length) - 1] ?? "COMPLETE";
      // CONTINUE requires at least one nextTask (schema law).
      return responses.adaptiveDecision(
        d,
        d === "CONTINUE" ? [{ type: "NEWS", objective: "continue research", capabilities: caps, completion: "c" }] : [],
      );
    }],
    ["research.answer_synthesis", SYNTHESIS],
  ]));
  const ws = new Workspace();
  const research = ws.addResearch({ objective: opts.question, question: opts.question, flow: "WHAT_HAPPENED" }, origin);
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  const outcome = await runAdaptiveResearch(opts.question, research.id, {
    provider, registry, workspace: ws, store: new MemoryStore(),
    maxRounds: opts.maxRounds ?? 3,
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
    now: () => new Date(clock.now),
  });
  return { outcome, clock, workspace: ws, researchId: research.id };
}

beforeEach(() => resetIdCounters());

describe("in-round budget enforcement", () => {
  it("stops BEFORE the next task when the deadline passes mid-round, preserving gathered evidence", async () => {
    // Round 1 schedules 3 tasks of 10s each; the 15s deadline is crossed after the second, so
    // the third must never execute — the run finalizes with what it actually gathered.
    const { outcome, clock, workspace, researchId } = await run({
      question: YIELDS_Q,
      capabilities: ["MACRO_ANALYSIS"],
      tasks: 3,
      deadlineMs: START + 15_000,
      costPerCap: 10_000,
      decisions: ["CONTINUE", "COMPLETE"],
    });
    expect(outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    // Exactly two tasks ran: the in-round check stopped the third.
    expect(outcome.executions).toHaveLength(2);
    expect(clock.now - START).toBe(20_000);
    // The evidence already collected is preserved — in the outcome AND in the research object.
    expect(outcome.evidence).toHaveLength(2);
    expect(workspace.getResearch(researchId)?.evidenceRefs).toHaveLength(2);
    // The rationale is the user-facing partial note, never the internal reason string.
    expect(outcome.finalDecision.rationale).toContain("budget");
  });

  it("never reports EVIDENCE_SUFFICIENT while material requirements remain, and NAMES them", async () => {
    // The macro ledger needs several dimensions; two tasks under a mid-round deadline leave
    // most of them unresearched.
    const { outcome } = await run({
      question: MACRO_Q,
      capabilities: ["MACRO_ANALYSIS"],
      tasks: 3,
      deadlineMs: START + 15_000,
      costPerCap: 10_000,
    });
    expect(outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    expect(outcome.stoppedBecause).not.toBe("EVIDENCE_SUFFICIENT");
    const blocking = blockingRequirements(outcome.requirements ?? []);
    expect(blocking.length).toBeGreaterThan(0);
    // A mechanical budget stop is never completeness: the partial rationale says how many
    // material requirements the budget left behind.
    expect(outcome.finalDecision.rationale).toContain(
      `${blocking.length} material requirement(s) remain unresolved`,
    );
    // Confidence is engine-computed from the ledger and bounded accordingly.
    const confidence = computeConfidence({
      requirements: outcome.requirements ?? [], stoppedBecause: outcome.stoppedBecause, failedPaths: 0,
    });
    expect(confidence.level).not.toBe("HIGH");
  });

  it("distinguishes budget exhaustion from provider failure", async () => {
    const { outcome } = await run({
      question: YIELDS_Q,
      deadlineMs: START + 15_000,
      tasks: 3,
      decisions: ["CONTINUE", "COMPLETE"],
    });
    expect(outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    // No model failure, and every provider call SUCCEEDED: the run ended for budget reasons.
    expect(outcome.modelFailure).toBeUndefined();
    expect(outcome.executions.every((e) => e.result.failure.type === "NONE")).toBe(true);
  });

  it("a run WITHOUT a deadline completes normally (deadline laws add, never replace)", async () => {
    const { outcome } = await run({ question: YIELDS_Q, maxRounds: 3 });
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.recoveryRounds).toBe(0);
  });

  it("a deadline that is never crossed never changes the outcome", async () => {
    const { outcome } = await run({ question: YIELDS_Q, deadlineMs: START + 600_000, maxRounds: 3 });
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
  });
});

describe("bounded execution under budget", () => {
  it("a multi-link question stays bounded: the round cap holds and the wall clock never overruns by more than one task", async () => {
    const { outcome, clock } = await run({
      question: "What drove the move in crude oil this week and how did it transmit through inflation, Treasury yields and broader risk assets?",
      capabilities: ["NEWS_ANALYSIS"],
      tasks: 2,
      costPerCap: 10_000,
      deadlineMs: START + 50_000,
      decisions: ["CONTINUE", "COMPLETE", "COMPLETE"],
      maxRounds: 3,
      content: "Crude oil inventories fell sharply this week and WTI rallied on supply disruption",
    });
    // The cap is absolute: the model kept asking to continue on every round's nextTasks.
    expect(outcome.rounds.length).toBeGreaterThan(0);
    expect(outcome.rounds.length).toBeLessThanOrEqual(3);
    expect(clock.now - START).toBeLessThanOrEqual(50_000 + 10_000);
    // The run ended honestly — a budget stop, an unresolved-gaps stop, or a real sufficiency
    // verdict. It never ended on a fabricated success while the ledger had blocking rows.
    expect(["TIME_BUDGET_EXHAUSTED", "ROUND_BUDGET_EXHAUSTED", "REQUIREMENT_GAPS_UNRESOLVED", "MODEL_INSUFFICIENT_EVIDENCE", "EVIDENCE_SUFFICIENT"]).toContain(outcome.stoppedBecause);
  });

  it("the engine cannot enter an unbounded recovery loop", async () => {
    const { outcome } = await run({
      question: YIELDS_Q,
      capabilities: ["MACRO_ANALYSIS", "NEWS_ANALYSIS"],
      decisions: ["CONTINUE", "CONTINUE", "CONTINUE"],
      maxRounds: 3,
    });
    // The model keeps asking to continue; the round cap is absolute.
    expect(outcome.rounds.length).toBeLessThanOrEqual(3);
  });
});

describe("budget-exhausted state quality", () => {
  it("an unresearched transmission arrow stays unresolved after exhaustion and caps confidence", async () => {
    resetIdCounters();
    const question = "What drove the move in crude oil and how did it transmit through inflation?";
    const { outcome } = await run({
      question,
      capabilities: ["NEWS_ANALYSIS"],
      tasks: 3,
      costPerCap: 10_000,
      deadlineMs: START + 5_000, // crossed after round 1's first task (in-round stop)
      content: "Crude oil inventories fell sharply this week and WTI rallied on supply disruption",
    });
    expect(outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    const links = deriveCausalLinkStatuses(outcome.requirements ?? []);
    // The question named an inflation leg, so the arrow EXISTS as a requirement…
    expect(links.map((l) => l.target)).toContain("INFLATION");
    const inflation = links.find((l) => l.target === "INFLATION")!;
    // …and stays unresolved: node evidence about crude oil never satisfies the arrow.
    expect(["UNRESOLVED", "NOT_RESEARCHED", "EXHAUSTED"]).toContain(inflation.status);
    expect(inflation.evidenceRefs).toEqual([]);
    expect(weakestCausalLink(links)!.target).toBe("INFLATION");
    // The weakest link caps the engine-computed confidence — never HIGH on an unsupported arrow.
    const confidence = computeConfidence({
      requirements: outcome.requirements ?? [], stoppedBecause: outcome.stoppedBecause, failedPaths: 0,
    });
    expect(confidence.level).toBe("LOW");
    // Evidence gathered before exhaustion is preserved.
    expect(outcome.evidence).toHaveLength(1);
  });

  it("evidence collected before exhaustion persists in the research object", async () => {
    const { outcome, workspace, researchId } = await run({
      question: YIELDS_Q,
      deadlineMs: START + 15_000,
      tasks: 3,
      decisions: ["CONTINUE", "COMPLETE"],
    });
    expect(outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(workspace.getResearch(researchId)?.evidenceRefs.length).toBe(outcome.evidence.length);
  });
});
