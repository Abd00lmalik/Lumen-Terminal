import { beforeEach, describe, expect, it } from "vitest";
import { runFlow3 } from "../../src/research/flow3.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const system = { kind: "agent" as const, detail: "test" };

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

const FACTOR_PLAN = JSON.stringify({
  objective: "What could affect BTC?",
  scopeIncluded: ["macro", "technicals"],
  scopeExcluded: ["on-chain (no provider)"],
  tasks: [
    { type: "MACRO", objective: "macro drivers", capabilities: ["MACRO_ANALYSIS"], completion: "c" },
    { type: "TECH", objective: "technical state", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
  ],
  completionCriteria: ["factors identified or unavailability recorded"],
  adaptationPolicy: "investigate material-uncertain factors once more",
});

function landscape(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overallAssessment: "BTC is exposed to macro liquidity conditions and ETF-flow momentum",
    factors: [
      {
        name: "Fed rate path",
        mechanism: "tighter liquidity reduces risk appetite for crypto assets",
        status: "OBSERVED_CURRENT_DRIVER",
        wouldMatterWhen: ["FOMC meetings", "CPI surprises"],
        supportingRefs: ["ev_000001"],
        contradictingRefs: [],
        uncertainty: ["magnitude unclear"],
      },
      {
        name: "ETF approval wave",
        mechanism: "new issuance channels add structural demand",
        status: "CATALYST",
        wouldMatterWhen: ["approval announcements"],
        supportingRefs: ["ev_000002"],
        contradictingRefs: [],
        uncertainty: ["timing unknowable"],
      },
      {
        name: "exchange insolvency",
        mechanism: "loss of custody confidence triggers sell pressure",
        status: "RISK",
        wouldMatterWhen: ["proof-of-reserve doubts"],
        supportingRefs: [],
        contradictingRefs: ["ev_000001"],
        uncertainty: ["low probability, high impact"],
      },
      {
        name: "Tether reserve transparency",
        mechanism: "stablecoin confidence affects market plumbing",
        status: "DEPENDENCY",
        wouldMatterWhen: ["attestation gaps"],
        supportingRefs: [],
        contradictingRefs: [],
        uncertainty: [],
      },
      {
        name: "halving narrative resurgence",
        mechanism: "sentiment-driven accumulation",
        status: "SPECULATIVE_FACTOR",
        wouldMatterWhen: ["media cycles"],
        supportingRefs: [],
        contradictingRefs: [],
        uncertainty: ["narrative timing"],
      },
    ],
    unresolvedFactors: ["regulatory posture of major jurisdictions"],
    missingInformation: ["ETF flow data (G2 unavailable)"],
    confidence: "MODERATE",
    uncertainty: ["ETF flow data unavailable"],
    whatWouldChange: ["ETF flow data becoming available"],
    citedObjectRefs: ["ev_000001", "ev_000002"],
    ...overrides,
  });
}

function newProvider(payload: string = landscape()): FakeModelProvider {
  return new FakeModelProvider(new Map([
    ["research.plan", FACTOR_PLAN],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ["flow3.factor_landscape", payload],
  ]));
}

function newRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("MACRO_ANALYSIS", "CPI cooling, Fed on hold"));
  registry.register(fakeCapability("TECHNICAL_ANALYSIS", "BTC consolidating above 200d MA"));
  return registry;
}

describe("Flow 3; WHAT COULD AFFECT IT? (factor landscape)", () => {
  beforeEach(() => resetIdCounters());

  it("distinguishes OBSERVED_CURRENT_DRIVER from potential/catalyst/risk/dependency/speculative factors", async () => {
    const provider = newProvider();
    const result = await runFlow3("What could affect BTC over the next few weeks?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    const f = result.landscape?.factors ?? [];
    expect(f).toHaveLength(5);
    const byStatus = (s: string) => f.filter((x) => x.status === s);
    expect(byStatus("OBSERVED_CURRENT_DRIVER")).toHaveLength(1); // evidence-backed only
    expect(byStatus("CATALYST")).toHaveLength(1);
    expect(byStatus("RISK")).toHaveLength(1);
    expect(byStatus("DEPENDENCY")).toHaveLength(1);
    expect(byStatus("SPECULATIVE_FACTOR")).toHaveLength(1);
    // Response preserves the current-vs-conditional distinction.
    expect(result.response).toContain("Observed current drivers");
    expect(result.response).toContain("Potential factors (conditional; not predictions)");
  });

  it("preserves transmission mechanisms and matter-conditions; influence stays conditional", async () => {
    const provider = newProvider();
    const result = await runFlow3("What factors could change this situation?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    const catalyst = result.landscape?.factors.find((f) => f.status === "CATALYST");
    expect(catalyst?.mechanism).toContain("structural demand");
    expect(catalyst?.wouldMatterWhen).toContain("approval announcements");
    expect(result.response).toContain("matters when");
  });

  it("captures supporting AND contradicting evidence per factor; no curation", async () => {
    const provider = newProvider();
    const result = await runFlow3("Risks and catalysts to watch?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    const risk = result.landscape?.factors.find((f) => f.status === "RISK");
    expect(risk?.contradictingRefs).toEqual(["ev_000001"]);
    expect(result.landscape?.citedObjectRefs).toEqual(["ev_000001", "ev_000002"]);
  });

  it("missing data appears as unresolved/missing; never as evidence of absence", async () => {
    const provider = newProvider(landscape({ unresolvedFactors: ["regulatory posture"], missingInformation: ["ETF flow data (G2 unavailable)"] }));
    const result = await runFlow3("What could affect BTC?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.landscape?.unresolvedFactors).toContain("regulatory posture");
    expect(result.response).toContain("missing data is not evidence of absence");
  });

  it("adaptive follow-up: an uncertain material factor triggers another research round", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", FACTOR_PLAN],
      ["research.adaptive_decision", (req) => (req.prompt.includes("Round 1")
        ? responses.adaptiveDecision("CONTINUE", [{ type: "TECH", objective: "clarify technical factor", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" }])
        : responses.adaptiveDecision("COMPLETE"))],
      ["flow3.factor_landscape", landscape()],
    ]));
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("MACRO_ANALYSIS", "macro"));
    registry.register({
      providerId: "fake/counter",
      capabilities: ["TECHNICAL_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test:live",
      async execute(cap) { executed.push(cap); return { tool: "fake/counter", capability: cap, transport: "fake", outputs: [] }; },
    });
    const result = await runFlow3("What could affect BTC?", { provider, registry, workspace: new Workspace(), store: new MemoryStore() });
    expect(result.outcome.rounds.length).toBe(2); // adaptive follow-up happened
    expect(executed.length).toBe(2);
  });

  it("partial capability failure → limitation recorded, landscape still completes on remaining evidence", async () => {
    const registry = new CapabilityRegistry();
    registry.register(failingCapability("MACRO_ANALYSIS"));
    registry.register(fakeCapability("TECHNICAL_ANALYSIS", "BTC consolidating"));
    const provider = newProvider();
    const result = await runFlow3("What could affect BTC?", { provider, registry, workspace: new Workspace(), store: new MemoryStore() });
    expect(result.outcome.context.limitations.length).toBeGreaterThan(0);
    expect(result.landscape).toBeDefined(); // partial evidence still supports a landscape
    expect(result.landscape?.citedObjectRefs.every((r) => r.startsWith("ev_"))).toBe(true);
  });

  it("malformed factor entries are dropped, not coerced; bad status rejects via entry-drop", async () => {
    const provider = newProvider(landscape({
      factors: [
        "not an object",
        { name: "ok", mechanism: "m", status: "POTENTIAL_DRIVER", wouldMatterWhen: [], supportingRefs: [], contradictingRefs: [], uncertainty: [] },
        { name: "bad", mechanism: "m", status: "GUARANTEED_MOON", wouldMatterWhen: [], supportingRefs: [], contradictingRefs: [], uncertainty: [] },
      ],
    }));
    const result = await runFlow3("What could affect BTC?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.landscape?.factors).toHaveLength(1);
    expect(result.landscape?.factors[0]?.name).toBe("ok");
  });

  it("invented citation refs are dropped (no fabricated evidence)", async () => {
    const provider = newProvider(landscape({ citedObjectRefs: ["ev_000001", "ev_424242"] }));
    const result = await runFlow3("What could affect BTC?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.landscape?.citedObjectRefs).toEqual(["ev_000001"]);
  });

  it("no prediction/trading behavior: response contains no signals, targets, or recommendations", async () => {
    const provider = newProvider();
    const result = await runFlow3("What could affect BTC?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.response).toContain("not predictions");
    expect(result.response.toLowerCase()).not.toMatch(/buy|sell|long|short|target price|entry/);
    const judgment = result.outcome.judgmentId !== undefined ? "" : "";
    expect(result.outcome.judgmentId).toBeDefined();
    expect(result.landscape?.factors.every((f) => typeof f.name === "string" && typeof f.mechanism === "string")).toBe(true);
  });

  it("provenance: analysis + judgment objects created and linked to the research", async () => {
    const provider = newProvider();
    const result = await runFlow3("What could affect BTC?", { provider, registry: newRegistry(), workspace: new Workspace(), store: new MemoryStore() });
    expect(result.outcome.analysisId).toBeDefined();
    expect(result.outcome.judgmentId).toBeDefined();
    expect(result.outcome.researchId).toMatch(/^rs_/);
    expect(result.outcome.evidence.length).toBeGreaterThan(0);
  });
});
