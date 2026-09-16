import { beforeEach, describe, expect, it } from "vitest";
import { runFlow7 } from "../../src/research/flow7.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };
const system = { kind: "agent" as const, detail: "test" };

function fakeCapability(capability: string, value: string, outputClass = "FACTUAL_OBSERVATION"): ProviderAdapter {
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
        outputs: [{ outputClass, content: value, about: "BTC" }],
      };
    },
  };
}

function failingCapability(capability: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake"],
    freshnessProfile: "test:live",
    async execute() {
      throw new ModelFailure("PROVIDER_UNAVAILABLE", "fake capability outage", true);
    },
  };
}

function falsification(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    targetBelief: "BTC trends up this quarter",
    claims: ["BTC makes higher highs through the quarter"],
    assumptions: ["macro conditions stay stable", "no regulatory shock"],
    vulnerableAssumptions: ["macro conditions stay stable"],
    falsificationTargets: [
      {
        condition: "quarterly close below the quarter's opening range",
        attacksAssumption: "BTC makes higher highs through the quarter",
        conditionStatus: "DERIVED_FROM_BELIEF",
        objectRefs: ["ev_000001"],
      },
      {
        condition: "30%+ drawdown from cycle high",
        attacksAssumption: "BTC makes higher highs through the quarter",
        conditionStatus: "PROPOSED",
        objectRefs: [],
      },
    ],
    contradictionsFound: [
      {
        description: "positioning turned risk-off while the thesis expects accumulation",
        materiality: "MEANINGFUL_WARNING",
        rationale: "sentiment observations point the other way but are not yet invalidating",
        objectRefs: ["ev_000001"],
      },
    ],
    noCredibleContradictionFound: false,
    currentAssessment: "WEAKENED",
    invalidationConditions: ["quarterly close below opening range"],
    earlyWarnings: ["funding resets without price follow-through"],
    confidence: "MODERATE",
    rationale: "price structure still supports the thesis but positioning diverges",
    citedObjectRefs: ["ev_000001"],
    ...overrides,
  });
}

const FALSIFICATION_PLAN = JSON.stringify({
  objective: "What could prove the thesis wrong?",
  scopeIncluded: ["technical state", "positioning"],
  scopeExcluded: ["historical comparison (G1 unavailable)"],
  tasks: [
    { type: "EVIDENCE_GATHERING", objective: "disconfirming technical evidence", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
    { type: "EVIDENCE_GATHERING", objective: "disconfirming positioning evidence", capabilities: ["SENTIMENT_ANALYSIS"], completion: "c" },
  ],
  completionCriteria: ["contradictions checked or unavailability recorded"],
  adaptationPolicy: "prioritize falsification value",
});

function newProvider(assessment: string = falsification()): FakeModelProvider {
  return new FakeModelProvider(new Map([
    ["research.plan", FALSIFICATION_PLAN],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ["flow7.falsification", assessment],
  ]));
}

function newRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("TECHNICAL_ANALYSIS", "price structure constructive, RSI 52"));
  registry.register(fakeCapability("SENTIMENT_ANALYSIS", "funding negative, positioning risk-off"));
  return registry;
}

describe("Flow 7; WHAT COULD PROVE ME WRONG? (falsification research)", () => {
  beforeEach(() => resetIdCounters());

  it("retrieves the active trader thesis and stress-tests it without mutating it", async () => {
    const workspace = new Workspace();
    const thesis = workspace.addThesis({ statement: "BTC trends up this quarter", objective: "swing" }, trader);
    const provider = newProvider();
    const result = await runFlow7("Try to prove my thesis wrong", { provider, registry: newRegistry(), workspace, store: new MemoryStore() });
    expect(result.assessment?.targetBelief).toBe("BTC trends up this quarter");
    expect(workspace.getThesis(thesis.id)?.version).toBe(1); // thesis object untouched
    expect(workspace.getThesis(thesis.id)?.statement).toBe("BTC trends up this quarter");
    // Assessment appears in the analysis/judgment layer, not as a thesis mutation.
    expect(result.outcome.analysisId).toBeDefined();
    expect(result.outcome.judgmentId).toBeDefined();
  });

  it("accepts a free-form belief statement without any thesis object", async () => {
    const workspace = new Workspace();
    // Function-form fake: echo the belief actually supplied in the prompt (no hardcoding).
    const provider = new FakeModelProvider(new Map([
      ["research.plan", FALSIFICATION_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow7.falsification", (req) => falsification({ targetBelief: /Trader belief to falsify[^\"]*\"([^\"]+)\"/.exec(req.prompt)?.[1] ?? "" })],
    ]));
    const result = await runFlow7("What would prove this wrong?", {
      provider, registry: newRegistry(), workspace, store: new MemoryStore(),
      beliefStatement: "ETH outperforms BTC into year end",
    });
    expect(result.assessment?.targetBelief).toBe("ETH outperforms BTC into year end");
  });

  it("decomposes the belief into claims and assumptions", async () => {
    const provider = newProvider();
    const result = await runFlow7("Challenge it", {
      provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(result.assessment?.claims.length).toBeGreaterThan(0);
    expect(result.assessment?.assumptions.length).toBeGreaterThan(0);
    expect(result.assessment?.vulnerableAssumptions).toContain("macro conditions stay stable");
  });

  it("labels falsification targets: derived vs proposed; no invented established thresholds", async () => {
    const provider = newProvider();
    const result = await runFlow7("Break it", {
      provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    const targets = result.assessment?.falsificationTargets ?? [];
    expect(targets).toHaveLength(2);
    expect(targets[0]?.conditionStatus).toBe("DERIVED_FROM_BELIEF");
    expect(targets[1]?.conditionStatus).toBe("PROPOSED");
    expect(result.response).toContain("Proposed (not established)");
  });

  it("grades materiality and does not invalidate on one weak source", async () => {
    const provider = newProvider(falsification({
      contradictionsFound: [{ description: "one weak blog disagrees", materiality: "MINOR", rationale: "low reliability secondary source", objectRefs: [] }],
      currentAssessment: "SUPPORTED",
    }));
    const result = await runFlow7("Challenge my thesis", {
      provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(result.assessment?.contradictionsFound[0]?.materiality).toBe("MINOR");
    expect(result.assessment?.currentAssessment).toBe("SUPPORTED"); // a weak source does not flip the assessment
  });

  it("honest absence: no credible contradiction found is NOT confirmation", async () => {
    const provider = newProvider(falsification({
      contradictionsFound: [],
      noCredibleContradictionFound: true,
      currentAssessment: "INDETERMINATE",
      rationale: "search found nothing credible either way in available evidence",
    }));
    const result = await runFlow7("What could prove me wrong?", {
      provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(result.assessment?.noCredibleContradictionFound).toBe(true);
    expect(result.response).toContain("NOT confirmation");
  });

  it("tool failure becomes a limitation, not negative evidence; assessment still grounds in real evidence", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingCapability("TECHNICAL_ANALYSIS"));
    registry.register(fakeCapability("SENTIMENT_ANALYSIS", "positioning risk-off"));
    const provider = newProvider();
    const result = await runFlow7("Falsify it", {
      provider, registry, workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(result.outcome.context.limitations.length).toBeGreaterThan(0); // outage recorded
    expect(result.assessment).toBeDefined(); // partial evidence still supports an assessment
    expect(result.assessment?.citedObjectRefs.every((ref) => ref.startsWith("ev_"))).toBe(true);
  });

  it("malformed assessment entries are dropped, not coerced; bad enums reject the whole output", async () => {
    // Wrong currentAssessment enum → whole output rejected (no fabricated assessment).
    const badEnum = newProvider(falsification({ currentAssessment: "TOTALLY_FINE" }));
    const r1 = await runFlow7("Challenge", {
      provider: badEnum, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(r1.assessment).toBeUndefined();
    expect(r1.modelFailure).toBeDefined();
    // One malformed target among valid ones → entry dropped, valid kept.
    const mixed = newProvider(falsification({
      falsificationTargets: [
        "not an object",
        { condition: "close below opening range", attacksAssumption: "higher highs", conditionStatus: "DERIVED_FROM_BELIEF", objectRefs: [] },
        { condition: "x", attacksAssumption: "y", conditionStatus: "MADE_UP_STATUS", objectRefs: [] },
      ],
    }));
    const r2 = await runFlow7("Challenge", {
      provider: mixed, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(r2.assessment?.falsificationTargets).toHaveLength(1);
    expect(r2.assessment?.falsificationTargets[0]?.condition).toBe("close below opening range");
  });

  it("monitoring stays a PROPOSAL; nothing is activated", async () => {
    const workspace = new Workspace();
    workspace.addThesis({ statement: "BTC trends up this quarter", objective: "swing" }, trader);
    const provider = newProvider();
    const result = await runFlow7("Watch what would break this", {
      provider, registry: newRegistry(), workspace, store: new MemoryStore(),
    });
    expect(result.monitoringProposal?.length).toBeGreaterThan(0); // proposed conditions listed
    expect(result.response).not.toContain("monitor activated");
    // No monitor objects exist in the domain (M5 territory + explicit confirmation).
    expect(workspace.listResearch().every((r) => r.flow !== "MONITORING")).toBe(true);
  });

  it("no belief and no thesis → honest failure, never a fabricated belief", async () => {
    const provider = newProvider();
    const result = await runFlow7("Prove me wrong", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.assessment).toBeUndefined();
    expect(result.response).toContain("no belief or thesis to falsify");
  });

  it("model failure on assessment → typed model failure, research state preserved", async () => {
    const workspace = new Workspace();
    workspace.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    // Fail ONLY the falsification call; the plan/decision calls must succeed so the
    // failure under test is the assessment step, not plan time.
    const provider = new FakeModelProvider(new Map([
      ["research.plan", FALSIFICATION_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow7.falsification", () => { throw new ModelFailure("PROVIDER_UNAVAILABLE", "gemini down", true); }],
    ]));
    const result = await runFlow7("Challenge my thesis", { provider, registry: newRegistry(), workspace, store: new MemoryStore() });
    expect(result.assessment).toBeUndefined();
    // M4 §33: provider failure keeps its type; never laundered into a validation failure.
    expect(result.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
    expect(result.outcome.evidence.length).toBeGreaterThan(0); // collected evidence preserved
  });

  it("invented citation refs are dropped (no fabricated evidence)", async () => {
    const provider = newProvider(falsification({ citedObjectRefs: ["ev_000001", "ev_999999"] }));
    const result = await runFlow7("Challenge", {
      provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore(),
      beliefStatement: "BTC trends up this quarter",
    });
    expect(result.assessment?.citedObjectRefs).toEqual(["ev_000001"]);
  });
});
