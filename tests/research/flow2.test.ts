import { beforeEach, describe, expect, it } from "vitest";
import { runFlow2 } from "../../src/research/flow2.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };
const system = { kind: "agent" as const, detail: "test" };

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake"],
    freshnessProfile: "test:live",
    async execute(cap) {
      // Production FALSIFICATION payloads are counterevidence-class; labeling them so the
      // challenge-attempt law recognizes the attempt (a "no contradiction found" result is a
      // completed challenge, not a failed one).
      const outputClass = cap === "FALSIFICATION" ? "ANALYST_INTERPRETATION" : "FACTUAL_OBSERVATION";
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass, content: value, about: "BTC" }],
      };
    },
  };
}

function causalSynthesis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    eventDefinition: "BTC fell 4% in 2 hours (per price evidence)",
    leadingExplanation: "leveraged liquidation cascade",
    supportingReasons: ["price decline aligns with funding reset"],
    competingExplanations: ["macro risk-off", "exchange outage"],
    contradictions: ["macro indices were stable during the move"],
    causalStatus: "PLAUSIBLE_MECHANISM",
    confidence: "LOW",
    uncertainty: ["liquidation data unavailable"],
    whatWouldChange: ["liquidation records showing forced selling"],
    citedObjectRefs: ["ev_000001"],
    ...overrides,
  });
}

function setup(
  providerResponses: Array<[string, string]>,
  capabilities: string[] = ["TECHNICAL_ANALYSIS", "NEWS_ANALYSIS"],
): { provider: FakeModelProvider; registry: CapabilityRegistry; workspace: Workspace; store: MemoryStore } {
  const provider = new FakeModelProvider(new Map(providerResponses));
  const registry = new CapabilityRegistry();
  for (const c of capabilities) registry.register(fakeCapability(c, `${c} data for BTC`));
  return { provider, registry, workspace: new Workspace(), store: new MemoryStore() };
}

const RESEARCH_PLAN = JSON.stringify({
  objective: "Why did BTC drop today?",
  scopeIncluded: ["market data", "news"],
  scopeExcluded: [],
  tasks: [
    { type: "EVENT", objective: "define the move", capabilities: ["TECHNICAL_ANALYSIS"], completion: "price structure" },
    { type: "FACTS", objective: "collect developments", capabilities: ["NEWS_ANALYSIS"], completion: "narratives" },
  ],
  completionCriteria: ["evidence collected"],
  adaptationPolicy: "pursue distinguishing evidence",
});

const COMPLETE = responses.adaptiveDecision("COMPLETE");

beforeEach(() => resetIdCounters());

describe("Flow 2; WHY DID IT HAPPEN? (causal investigation)", () => {
  it("runs end-to-end: event definition, hypotheses, synthesis, judgment with causal status", async () => {
    const { provider, registry, workspace, store } = setup(
      [
        ["research.plan", RESEARCH_PLAN],
        ["research.adaptive_decision", COMPLETE],
        ["flow2.causal_synthesis", causalSynthesis()],
      ],
      // The floor's counterevidence attempt the assertion below relies on needs a
      // FALSIFICATION provider to schedule; without one the engine's question-fit gate
      // correctly reports the un-attempted challenge row as a requirement gap.
      ["TECHNICAL_ANALYSIS", "NEWS_ANALYSIS", "FALSIFICATION"],
    );
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });

    expect(result.outcome.flow).toBe("WHY_IT_HAPPENED");
    expect(result.outcome.mode).toBe("CAUSAL");
    // The engine's completion gate accepts the COMPLETE because the ledger is covered (BTC
    // evidence from the plan plus the floor's counterevidence attempt).
    expect(result.outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(result.outcome.evidence.length).toBeGreaterThan(0);
    expect(result.synthesis).toBeDefined();
    expect(result.synthesis?.causalStatus).toBe("PLAUSIBLE_MECHANISM");
    // Judgment recorded in the workspace via the existing model:
    const judgment = workspace.currentJudgment(result.outcome.researchId);
    expect(judgment).toBeDefined();
    expect(judgment?.statement).toContain("PLAUSIBLE_MECHANISM");
    // Response structure per M4 §10:
    expect(result.response).toContain("**What happened:**");
    expect(result.response).toContain("**Leading explanation:**");
    expect(result.response).toContain("**Competing explanations:**");
    expect(result.response).toContain("**Confidence:**");
  });

  it("invented citations are dropped; no fabricated evidence (M4 §28)", async () => {
    const { provider, registry, workspace, store } = setup([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]);
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });
    expect(result.synthesis?.citedObjectRefs).toEqual(["ev_000001"]);
    expect(workspace.getEvidence("ev_000001")).toBeDefined();
  });

  it("contradictions are preserved in judgment uncertainty, not deleted (final lock §11)", async () => {
    const { provider, registry, workspace, store } = setup([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis({ contradictions: ["macro indices stable during the move"] })],
    ]);
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });
    const judgment = workspace.currentJudgment(result.outcome.researchId);
    // competing explanations remain explicitly unresolved:
    expect(judgment?.unresolvedQuestions.some((q) => q.includes("not eliminated"))).toBe(true);
    expect(result.response).toContain("**Contradictions:**");
  });

  it("correlation ≠ causation: causalStatus flows into the judgment verbatim", async () => {
    const { provider, registry, workspace, store } = setup([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis({ causalStatus: "TEMPORAL_ASSOCIATION", leadingExplanation: "news timing coincides" })],
    ]);
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });
    expect(result.synthesis?.causalStatus).toBe("TEMPORAL_ASSOCIATION");
    const judgment = workspace.currentJudgment(result.outcome.researchId);
    expect(judgment?.statement).toContain("TEMPORAL_ASSOCIATION");
    expect(judgment?.statement).toContain("correlation is not asserted as causation");
  });

  it("invalid causal status rejected; no silent coercion", async () => {
    const { provider, registry, workspace, store } = setup([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis({ causalStatus: "PROVEN_CAUSATION" })],
    ]);
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });
    expect(result.synthesis).toBeUndefined();
    expect(result.modelFailure).toBeInstanceOf(ModelFailure);
    // no causal judgment was fabricated from invalid output
    const judgment = workspace.currentJudgment(result.outcome.researchId);
    expect(judgment === undefined || !judgment.statement.includes("PROVEN_CAUSATION")).toBe(true);
  });

  it("partial capability failure: failure is a limitation, not negative evidence", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("TECHNICAL_ANALYSIS", "price data"));
    registry.register({
      providerId: "failing/news",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute() { throw new Error("upstream down"); },
    });
    const workspace = new Workspace();
    const store = new MemoryStore();
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });

    expect(result.outcome.executions.some((e) => e.result.failure.type === "PROVIDER_ERROR")).toBe(true);
    expect(result.outcome.context.limitations.some((l) => l.kind === "tool_failure")).toBe(true);
    // research still completed with the available dimension:
    expect(result.synthesis).toBeDefined();
  });

  it("adaptive follow-up: CONTINUE decision triggers distinguishing research before completion", async () => {
    let call = 0;
    const provider = new FakeModelProvider(new Map([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", () => {
        call += 1;
        return call === 1
          ? responses.adaptiveDecision("CONTINUE", [{ objective: "distinguish liquidation vs macro", capabilities: ["SENTIMENT_ANALYSIS"], completion: "distinguishing evidence" }])
          : COMPLETE;
      }],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("TECHNICAL_ANALYSIS", "price"));
    registry.register(fakeCapability("NEWS_ANALYSIS", "news"));
    registry.register(fakeCapability("SENTIMENT_ANALYSIS", "positioning"));
    const workspace = new Workspace();
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store: new MemoryStore(), asset: "BTC" });
    expect(result.outcome.rounds).toHaveLength(2);
    expect(result.outcome.executions.map((e) => e.capability)).toContain("SENTIMENT_ANALYSIS");
  });

  it("no evidence at all → honest model-failure outcome, no fabricated causal claim", async () => {
    const provider = new FakeModelProvider(new Map([["research.plan", "garbage"]]));
    const workspace = new Workspace();
    const result = await runFlow2("Why did BTC drop today?", {
      provider, registry: new CapabilityRegistry(), workspace, store: new MemoryStore(), asset: "BTC",
    });
    expect(result.synthesis).toBeUndefined();
    expect(result.modelFailure).toBeInstanceOf(ModelFailure);
    expect(result.response).toContain("could not be completed");
    expect(workspace.listEvidence()).toHaveLength(0);
  });

  it("provenance: evidence carries tool refs, research registers everything", async () => {
    const { provider, registry, workspace, store } = setup([
      ["research.plan", RESEARCH_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]);
    const result = await runFlow2("Why did BTC drop today?", { provider, registry, workspace, store, asset: "BTC" });
    const research = workspace.getResearch(result.outcome.researchId);
    expect(research?.evidenceRefs.length).toBe(result.outcome.evidence.length);
    for (const evidence of result.outcome.evidence) {
      expect(evidence.toolResultRef).toBeTruthy();
      expect(evidence.provenance.length).toBeGreaterThan(0); // provenance = ordered entry array
    }
  });

  // Honest time budget: a crossed deadline stops the loop with TIME_BUDGET_EXHAUSTED (never a
  // model failure, never fabricated content) and the evidence gathered so far is preserved.
  it("crossed deadline stops the loop honestly with TIME_BUDGET_EXHAUSTED and preserves gathered evidence", async () => {
    const { provider, registry, workspace, store } = setup([
      ["research.plan", RESEARCH_PLAN],
      // Round 1 decides CONTINUE (so the loop re-enters); the deadline then stops round 2.
      ["research.adaptive_decision", responses.adaptiveDecision("CONTINUE", [{ objective: "more news", capabilities: ["NEWS_ANALYSIS"], completion: "more coverage" }])],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]);
    const result = await runFlow2("Why did BTC drop today?", {
      provider, registry, workspace, store, asset: "BTC",
      deadlineMs: Date.now() - 1, // already crossed before round 1's decision
    });
    expect(result.modelFailure).toBeUndefined();
    expect(result.outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    expect(result.outcome.evidence.length).toBeGreaterThan(0); // partial truth is preserved
    expect(workspace.getResearch(result.outcome.researchId)?.status).toBe("COMPLETED");
  });
});
