import { beforeEach, describe, expect, it } from "vitest";
import { runFlow8 } from "../../src/research/flow8.js";
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

const QUALITATIVE_FRAMEWORK = [
  "1. Liquidity: is global liquidity expanding or contracting for the asset?",
  "2. Structure: does price trade above its 200-day moving average?",
  "3. Positioning: is leverage stretched or reset?",
].join("\n");

function saveFramework(workspace: Workspace, content: string = QUALITATIVE_FRAMEWORK): string {
  const artifact = workspace.saveArtifact(
    { type: "framework", content, derivedFromRefs: [], rationale: "trader's own evaluation framework" },
    trader,
  );
  return artifact.id;
}

function frameworkEval(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    frameworkRef: "sa_000001",
    frameworkSummary: "3-criteria framework: liquidity, structure, positioning",
    scoringUsed: "QUALITATIVE",
    criteria: [
      {
        criterion: "1. Liquidity: is global liquidity expanding or contracting for the asset?",
        status: "SATISFIED",
        rationale: "macro evidence shows liquidity expanding",
        supportingRefs: ["ev_000001"],
        contradictingRefs: [],
      },
      {
        criterion: "2. Structure: does price trade above its 200-day moving average?",
        status: "SATISFIED",
        rationale: "price evidence confirms above 200d MA",
        supportingRefs: ["ev_000002"],
        contradictingRefs: [],
      },
      {
        criterion: "3. Positioning: is leverage stretched or reset?",
        status: "INSUFFICIENT_EVIDENCE",
        rationale: "funding/OI evidence unavailable in context",
        supportingRefs: [],
        contradictingRefs: [],
        evidenceNeeded: "funding-rate and open-interest observations",
      },
    ],
    overallAssessment: "2 of 3 criteria satisfied; positioning criterion lacks evidence",
    contradictions: [],
    unresolved: ["positioning data (derivatives capability unavailable)"],
    whatWouldChange: ["derivatives data becoming available"],
    confidence: "MODERATE",
    citedObjectRefs: ["ev_000001", "ev_000002"],
    ...overrides,
  });
}

const FRAMEWORK_PLAN = JSON.stringify({
  objective: "Evaluate the target against the trader's framework criteria",
  scopeIncluded: ["macro", "technicals"],
  scopeExcluded: ["derivatives (capability unavailable)"],
  tasks: [
    { type: "MACRO", objective: "liquidity criterion", capabilities: ["MACRO_ANALYSIS"], completion: "c" },
    { type: "TECH", objective: "structure criterion", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
  ],
  completionCriteria: ["each criterion assessed or marked insufficient"],
  adaptationPolicy: "research what each criterion needs",
});

function newProvider(payload: string = frameworkEval()): FakeModelProvider {
  return new FakeModelProvider(new Map([
    ["research.plan", FRAMEWORK_PLAN],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ["flow8.framework_evaluation", payload],
  ]));
}

function newRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("MACRO_ANALYSIS", "liquidity expanding"));
  registry.register(fakeCapability("TECHNICAL_ANALYSIS", "BTC above 200d MA"));
  return registry;
}

function workspaceWithFramework(content?: string): { workspace: Workspace; frameworkId: string } {
  const workspace = new Workspace();
  const frameworkId = saveFramework(workspace, content);
  return { workspace, frameworkId };
}

describe("Flow 8 — EVALUATE THIS ACCORDING TO MY FRAMEWORK (framework-constrained evaluation)", () => {
  beforeEach(() => resetIdCounters());

  it("resolves the most recent saved framework artifact and evaluates by it", async () => {
    const { workspace, frameworkId } = workspaceWithFramework();
    const provider = newProvider(frameworkEval({ frameworkRef: frameworkId }));
    const result = await runFlow8("Evaluate this using my framework", { provider, registry: newRegistry(), workspace, store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation?.frameworkRef).toBe(frameworkId);
    expect(result.evaluation?.criteria).toHaveLength(3);
    expect(workspace.getSavedArtifact(frameworkId)?.content).toBe(QUALITATIVE_FRAMEWORK); // unchanged
  });

  it("resolves a specific framework by ref when given", async () => {
    const { workspace, frameworkId } = workspaceWithFramework();
    const provider = newProvider(frameworkEval({ frameworkRef: frameworkId }));
    const result = await runFlow8("Apply my framework", { provider, registry: newRegistry(), workspace, store: new MemoryStore(), frameworkRef: frameworkId, target: "BTC" });
    expect(result.evaluation?.frameworkRef).toBe(frameworkId);
  });

  it("criterion-by-criterion statuses with per-criterion evidence refs", async () => {
    const provider = newProvider();
    const result = await runFlow8("How does BTC perform against my criteria?", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    const criteria = result.evaluation?.criteria ?? [];
    expect(criteria[0]?.status).toBe("SATISFIED");
    expect(criteria[0]?.supportingRefs).toEqual(["ev_000001"]);
    expect(criteria[2]?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(criteria[2]?.evidenceNeeded).toContain("funding-rate");
    expect(result.response).toContain("[SATISFIED]");
    expect(result.response).toContain("[INSUFFICIENT_EVIDENCE]");
  });

  it("missing evidence is reported as INSUFFICIENT_EVIDENCE with what is needed — never manufactured", async () => {
    const provider = newProvider();
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    const missing = result.evaluation?.criteria.find((c) => c.status === "INSUFFICIENT_EVIDENCE");
    expect(missing?.supportingRefs).toEqual([]); // no fabricated refs
    expect(missing?.evidenceNeeded).toBeDefined();
    expect(result.evaluation?.citedObjectRefs.every((r) => r.startsWith("ev_"))).toBe(true);
  });

  it("CONTRADICTED is distinguished from NOT_SATISFIED", async () => {
    const provider = newProvider(frameworkEval({
      criteria: [
        { criterion: "1. Liquidity", status: "CONTRADICTED", rationale: "direct counterevidence: liquidity contracting", supportingRefs: [], contradictingRefs: ["ev_000001"], evidenceNeeded: undefined },
        { criterion: "2. Structure", status: "NOT_SATISFIED", rationale: "price below 200d MA — simply not met", supportingRefs: [], contradictingRefs: [], evidenceNeeded: undefined },
      ],
      overallAssessment: "criteria not met; one contradicted by evidence",
    }));
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation?.criteria[0]?.status).toBe("CONTRADICTED");
    expect(result.evaluation?.criteria[0]?.contradictingRefs).toEqual(["ev_000001"]);
    expect(result.evaluation?.criteria[1]?.status).toBe("NOT_SATISFIED");
    expect(result.evaluation?.criteria[1]?.contradictingRefs).toEqual([]);
  });

  it("qualitative framework stays qualitative — no invented numeric scores", async () => {
    const provider = newProvider();
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation?.scoringUsed).toBe("QUALITATIVE");
    expect(result.evaluation?.frameworkScore).toBeUndefined();
    expect(result.response).toContain("qualitative — the framework defines no numeric scoring");
  });

  it("framework-defined scoring is used when the framework itself defines it", async () => {
    const numericFramework = [
      "Score each 0-10: 1. Liquidity trend; 2. Price vs 200d MA; 3. Leverage reset state.",
      "Overall = sum. Above 20 = favorable.",
    ].join("\n");
    const { workspace, frameworkId } = workspaceWithFramework(numericFramework);
    const provider = newProvider(frameworkEval({
      scoringUsed: "FRAMEWORK_DEFINED",
      frameworkScore: "24/30 — favorable",
      overallAssessment: "favorable per the framework's own sum scoring",
      criteria: [
        { criterion: "1. Liquidity trend", status: "SATISFIED", rationale: "8/10 per framework scale", supportingRefs: ["ev_000001"], contradictingRefs: [] },
        { criterion: "2. Price vs 200d MA", status: "SATISFIED", rationale: "9/10 per framework scale", supportingRefs: ["ev_000002"], contradictingRefs: [] },
        { criterion: "3. Leverage reset state", status: "PARTIALLY_SATISFIED", rationale: "7/10 per framework scale", supportingRefs: [], contradictingRefs: [] },
      ],
    }));
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace, store: new MemoryStore(), frameworkRef: frameworkId, target: "BTC" });
    expect(result.evaluation?.scoringUsed).toBe("FRAMEWORK_DEFINED");
    expect(result.evaluation?.frameworkScore).toBe("24/30 — favorable");
    expect(result.response).toContain("framework score: 24/30 — favorable");
  });

  it("a numeric score with a qualitative framework is REJECTED (guard against invented scoring)", async () => {
    const provider = newProvider(frameworkEval({ scoringUsed: "QUALITATIVE", frameworkScore: "8.5/10" }));
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation).toBeUndefined();
    expect(result.modelFailure?.type).toBe("INVALID_OUTPUT");
  });

  it("no saved framework → clear insufficient-context failure; NO generic fallback, nothing fabricated", async () => {
    const provider = newProvider();
    const result = await runFlow8("Evaluate this using my framework", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation).toBeUndefined();
    expect(result.response).toContain("no saved framework available");
    expect(result.response).toContain("a generic framework is never substituted");
  });

  it("framework remains unchanged and its provenance/version is preserved", async () => {
    const { workspace, frameworkId } = workspaceWithFramework();
    const before = workspace.getSavedArtifact(frameworkId);
    const provider = newProvider(frameworkEval({ frameworkRef: frameworkId }));
    await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace, store: new MemoryStore(), frameworkRef: frameworkId, target: "BTC" });
    const after = workspace.getSavedArtifact(frameworkId);
    expect(after).toEqual(before); // artifact untouched
  });

  it("invented citation refs are dropped (no fabricated evidence)", async () => {
    const provider = newProvider(frameworkEval({ citedObjectRefs: ["ev_000001", "ev_999999"] }));
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation?.citedObjectRefs).toEqual(["ev_000001"]);
  });

  it("provider failure keeps its type; no assessment asserted", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", FRAMEWORK_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow8.framework_evaluation", () => { throw new ModelFailure("PROVIDER_UNAVAILABLE", "gemini 503", true); }],
    ]));
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace: workspaceWithFramework().workspace, store: new MemoryStore(), target: "BTC" });
    expect(result.evaluation).toBeUndefined();
    expect(result.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
  });

  it("provenance: analysis + judgment created and framework artifact referenced", async () => {
    const { workspace, frameworkId } = workspaceWithFramework();
    const provider = newProvider(frameworkEval({ frameworkRef: frameworkId }));
    const result = await runFlow8("Evaluate with my framework", { provider, registry: newRegistry(), workspace, store: new MemoryStore(), frameworkRef: frameworkId, target: "BTC" });
    expect(result.outcome.analysisId).toBeDefined();
    expect(result.outcome.judgmentId).toBeDefined();
    const judgment = workspace.getJudgment(result.outcome.judgmentId ?? "");
    expect(judgment?.statement).toContain(`framework ${frameworkId}, unchanged`);
  });
});
