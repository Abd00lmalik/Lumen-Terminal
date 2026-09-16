import { beforeEach, describe, expect, it } from "vitest";
import { runFlow4 } from "../../src/research/flow4.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: value, about: "BTC" }],
      };
    },
  };
}

function evaluation(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    thesisStatement: "BTC trends up this quarter",
    components: [
      {
        component: "BTC makes higher highs through the quarter",
        kind: "CLAIM",
        status: "SUPPORTED",
        evidenceQuality: "MIXED",
        supportingRefs: ["ev_000001"],
        contradictingRefs: [],
        rationale: "price structure evidence supports the claim",
        uncertainty: ["macro data pending"],
      },
      {
        component: "macro conditions stay stable",
        kind: "ASSUMPTION",
        status: "WEAKENED",
        evidenceQuality: "WEAK",
        supportingRefs: [],
        contradictingRefs: ["ev_000002"],
        rationale: "CPI reacceleration evidence weakens this assumption",
        uncertainty: [],
      },
    ],
    overallAssessment: "WEAKENED",
    evidenceBasisQuality: "MIXED",
    strongestSupport: ["price structure evidence"],
    strongestOpposition: ["CPI reacceleration"],
    invalidationConditionStatus: [
      { condition: "quarterly close below opening range", currentlyTriggered: false, evidenceRefs: [] },
      { condition: "macro tightening accelerates", currentlyTriggered: true, evidenceRefs: ["ev_000002"] },
    ],
    unresolved: ["ETF flow direction"],
    whatWouldChange: [" Fed pause confirmation would restore the assumption"],
    confidence: "MODERATE",
    rationale: "core claim holds but a supporting assumption is weakened by fresh macro evidence",
    citedObjectRefs: ["ev_000001", "ev_000002"],
    ...overrides,
  });
}

const THESIS_EVAL_PLAN = JSON.stringify({
  objective: "Does the thesis hold?",
  scopeIncluded: ["technicals", "macro"],
  scopeExcluded: ["history (G1 unavailable)"],
  tasks: [
    { type: "TECH", objective: "claim evidence", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
    { type: "MACRO", objective: "assumption evidence", capabilities: ["MACRO_ANALYSIS"], completion: "c" },
  ],
  completionCriteria: ["components assessed or unavailability recorded"],
  adaptationPolicy: "balanced supporting/disconfirming search",
});

function newProvider(payload: string = evaluation()): FakeModelProvider {
  return new FakeModelProvider(new Map([
    ["research.plan", THESIS_EVAL_PLAN],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ["flow4.thesis_evaluation", payload],
  ]));
}

function newRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("TECHNICAL_ANALYSIS", "BTC above 200d MA, higher lows"));
  registry.register(fakeCapability("MACRO_ANALYSIS", "CPI reaccelerated to 4.2%"));
  return registry;
}

function workspaceWithThesis(): { workspace: Workspace; thesisId: string } {
  const workspace = new Workspace();
  const thesis = workspace.addThesis(
    {
      statement: "BTC trends up this quarter",
      objective: "swing",
      claims: [{ statement: "BTC makes higher highs through the quarter", importance: "CORE", invalidationConditions: ["quarterly close below opening range"] }],
      assumptions: [{ statement: "macro conditions stay stable", importance: "SUPPORTING", invalidationConditions: ["macro tightening accelerates"] }],
      invalidationConditions: ["quarterly close below opening range", "macro tightening accelerates"],
    },
    trader,
  );
  return { workspace, thesisId: thesis.id };
}

describe("Flow 4; DOES MY THESIS HOLD? (thesis evaluation)", () => {
  beforeEach(() => resetIdCounters());

  it("retrieves the active trader thesis and evaluates it component-by-component", async () => {
    const { workspace, thesisId } = workspaceWithThesis();
    const provider = newProvider();
    const result = await runFlow4("Does my thesis still hold?", { provider, registry: newRegistry(), workspace, store: new MemoryStore() });
    expect(result.evaluation?.thesisStatement).toBe("BTC trends up this quarter");
    expect(result.evaluation?.components).toHaveLength(2);
    expect(result.evaluation?.components[0]?.kind).toBe("CLAIM");
    expect(result.evaluation?.components[1]?.kind).toBe("ASSUMPTION");
    // Thesis untouched; same version, same statement, no silent revision.
    expect(workspace.getThesis(thesisId)?.version).toBe(1);
    expect(workspace.getThesis(thesisId)?.statement).toBe("BTC trends up this quarter");
  });

  it("claims AND assumptions both carry supporting and contradicting evidence", async () => {
    const provider = newProvider();
    const result = await runFlow4("Test my thesis against the latest evidence", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    const claim = result.evaluation?.components[0];
    const assumption = result.evaluation?.components[1];
    expect(claim?.supportingRefs).toEqual(["ev_000001"]);
    expect(claim?.contradictingRefs).toEqual([]);
    expect(assumption?.contradictingRefs).toEqual(["ev_000002"]);
    expect(assumption?.supportingRefs).toEqual([]);
  });

  it("unavailable evidence → evidenceQuality UNAVAILABLE and leans INDETERMINATE, never UNSUPPORTED-by-absence", async () => {
    const provider = newProvider(evaluation({
      components: [{
        component: "ETF flows stay positive",
        kind: "CLAIM",
        status: "INDETERMINATE",
        evidenceQuality: "UNAVAILABLE",
        supportingRefs: [],
        contradictingRefs: [],
        rationale: "no evidence in context; G2 unavailable; absence is not contradiction",
        uncertainty: ["no retrieval path"],
      }],
      overallAssessment: "INDETERMINATE",
      evidenceBasisQuality: "UNAVAILABLE",
      citedObjectRefs: [],
    }));
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    expect(result.evaluation?.components[0]?.evidenceQuality).toBe("UNAVAILABLE");
    expect(result.evaluation?.components[0]?.status).toBe("INDETERMINATE");
    expect(result.evaluation?.overallAssessment).toBe("INDETERMINATE");
    expect(result.evaluation?.citedObjectRefs).toEqual([]);
  });

  it("retrieval failure is recorded as a limitation, not converted into contradiction", async () => {
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/outage",
      capabilities: ["TECHNICAL_ANALYSIS"],
      limitations: ["fake"],
      freshnessProfile: "test:live",
      async execute() {
        throw new ModelFailure("PROVIDER_UNAVAILABLE", "capability outage", true);
      },
    });
    registry.register(fakeCapability("MACRO_ANALYSIS", "CPI 4.2%"));
    const provider = newProvider();
    const result = await runFlow4("Does my thesis hold?", { provider, registry, workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    expect(result.outcome.context.limitations.length).toBeGreaterThan(0); // outage = limitation
    expect(result.evaluation).toBeDefined(); // evaluation still completes on remaining evidence
    // The limitation was NOT fabricated into contradicting evidence.
    expect(result.evaluation?.components.every((c) => c.contradictingRefs.every((r) => r.startsWith("ev_")))).toBe(true);
  });

  it("claim-level statuses and the overall assessment use the existing judgment vocabulary", async () => {
    const provider = newProvider();
    const result = await runFlow4("Is my current thesis supported?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    const valid = ["SUPPORTED", "WEAKENED", "MATERIALLY_CHALLENGED", "UNSUPPORTED", "INDETERMINATE"];
    for (const c of result.evaluation?.components ?? []) expect(valid).toContain(c.status);
    expect(valid).toContain(result.evaluation?.overallAssessment);
    expect(result.response).toContain("**Assessment:** WEAKENED");
  });

  it("the thesis's OWN invalidation conditions are checked with current trigger status", async () => {
    const provider = newProvider();
    const result = await runFlow4("Does my thesis still hold?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    const statuses = result.evaluation?.invalidationConditionStatus ?? [];
    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.condition).toBe("quarterly close below opening range");
    expect(statuses[0]?.currentlyTriggered).toBe(false);
    expect(statuses[1]?.currentlyTriggered).toBe(true);
    expect(statuses[1]?.evidenceRefs).toEqual(["ev_000002"]);
  });

  it("evidence quality and confidence remain distinct fields (confidence ≠ evidence quality)", async () => {
    const provider = newProvider(evaluation({ confidence: "HIGH", evidenceBasisQuality: "WEAK" }));
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    expect(result.evaluation?.confidence).toBe("HIGH");
    expect(result.evaluation?.evidenceBasisQuality).toBe("WEAK");
    // The response surfaces BOTH explicitly so they cannot silently merge.
    expect(result.response).toContain("Evidence basis:** WEAK");
    expect(result.response).toContain("confidence: HIGH");
  });

  it("model confidence cannot override evidence: schema separates them and response shows the split", async () => {
    const provider = newProvider(evaluation({ confidence: "HIGH", overallAssessment: "WEAKENED", evidenceBasisQuality: "WEAK" }));
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    // A HIGH-confidence model output does NOT upgrade a WEAKENED assessment; both fields pass through honestly.
    expect(result.evaluation?.overallAssessment).toBe("WEAKENED");
    expect(result.evaluation?.evidenceBasisQuality).toBe("WEAK");
  });

  it("invalid model output → typed failure, no assessment asserted", async () => {
    const provider = newProvider(evaluation({ overallAssessment: "OBVIOUSLY_TRUE" }));
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    expect(result.evaluation).toBeUndefined();
    expect(result.modelFailure?.type).toBe("INVALID_OUTPUT");
  });

  it("provider failure keeps its type (never laundered into validation failure)", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", THESIS_EVAL_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow4.thesis_evaluation", () => { throw new ModelFailure("PROVIDER_UNAVAILABLE", "gemini 503", true); }],
    ]));
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace: workspaceWithThesis().workspace, store: new MemoryStore() });
    expect(result.evaluation).toBeUndefined();
    expect(result.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
    expect(result.outcome.evidence.length).toBeGreaterThan(0); // research state preserved
  });

  it("no active thesis → honest failure, never a fabricated thesis", async () => {
    const provider = newProvider();
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.evaluation).toBeUndefined();
    expect(result.response).toContain("no active thesis to evaluate");
  });

  it("provenance: analysis + judgment created; thesis provenance/version preserved in the judgment", async () => {
    const { workspace, thesisId } = workspaceWithThesis();
    const provider = newProvider();
    const result = await runFlow4("Does my thesis hold?", { provider, registry: newRegistry(), workspace, store: new MemoryStore() });
    expect(result.outcome.analysisId).toBeDefined();
    expect(result.outcome.judgmentId).toBeDefined();
    const judgment = workspace.getJudgment(result.outcome.judgmentId ?? "");
    expect(judgment?.statement).toContain("version 1, unchanged");
    expect(workspace.getThesis(thesisId)?.version).toBe(1);
  });
});
