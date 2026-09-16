/**
 * M4 cross-flow tests — routing through the LUI, capability-first behavior, failure semantics,
 * safety boundary, and persistence across Flow 2 / Flow 6 / Flow 7.
 *
 * Architectural basis:
 * - M4 §4: the flow defines objective + analytical mode; NO Flow→Tool hardcoding.
 * - M4 §33: failure laws (model failure ≠ research failure; tool failure ≠ negative evidence).
 * - M4 §31: research state persists via the existing WorkspaceStore; SAVE stays the only path
 *   into reusable persistent memory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { createThesis } from "../../src/domain/thesis.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import { FLOW_OBJECTIVES } from "../../src/research/flow-runner.js";
import { FLOW3_OBJECTIVE } from "../../src/research/flow3.js";
import { FLOW4_OBJECTIVE } from "../../src/research/flow4.js";
import { FLOW8_OBJECTIVE } from "../../src/research/flow8.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };

function fakeCapability(capability: string, value: string, outputClass = "QUANTITATIVE_OBSERVATION"): ProviderAdapter {
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

function registryWith(...capabilities: string[]): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const c of capabilities) registry.register(fakeCapability(c, `${c} reading for BTC`));
  return registry;
}

function scriptDefaults(provider: FakeModelProvider, plan: unknown, overrides: Record<string, Record<string, unknown>> = {}): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest(overrides["request"] ?? {}));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget(overrides["target"] ?? {}));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

/** Generic M4 flow synthesis payload (all enum values valid so validation passes). */
function flowSynthesis(flow: "flow2" | "flow6" | "flow7", overrides: Record<string, unknown> = {}): string {
  if (flow === "flow2") {
    return JSON.stringify({
      eventDefinition: "BTC fell 4% in 2 hours",
      leadingExplanation: "liquidation cascade",
      supportingReasons: ["funding reset aligned"],
      competingExplanations: ["macro risk-off"],
      contradictions: ["macro indices stable"],
      causalStatus: "PLAUSIBLE_MECHANISM",
      confidence: "LOW",
      uncertainty: ["liquidation data unavailable"],
      whatWouldChange: ["liquidation data showing no cascade"],
      citedObjectRefs: ["ev_000001"],
      ...overrides,
    });
  }
  if (flow === "flow6") {
    return JSON.stringify({
      overallPicture: "consolidation with cautious positioning",
      supportingSignals: ["structure improving"],
      opposingSignals: ["positioning risk-off"],
      crossDomainRelationships: ["funding reset + base building"],
      disagreements: [{ sideA: "technicals", sideB: "positioning", type: "DIFFERENT_TIME_HORIZON", assessment: "horizons differ", objectRefsA: [], objectRefsB: [] }],
      missingInformation: ["OI history"],
      confidence: "MODERATE",
      uncertainty: ["freshness"],
      citedObjectRefs: ["ev_000001"],
      ...overrides,
    });
  }
  return JSON.stringify({
    targetBelief: "BTC trends up this quarter",
    claims: ["higher highs"],
    assumptions: ["macro stable"],
    vulnerableAssumptions: ["macro stable"],
    falsificationTargets: [{ condition: "close below opening range", attacksAssumption: "higher highs", conditionStatus: "DERIVED_FROM_BELIEF", objectRefs: [] }],
    contradictionsFound: [{ description: "positioning risk-off", materiality: "MEANINGFUL_WARNING", rationale: "not yet invalidating", objectRefs: ["ev_000001"] }],
    noCredibleContradictionFound: false,
    currentAssessment: "WEAKENED",
    invalidationConditions: ["close below opening range"],
    earlyWarnings: ["funding resets"],
    confidence: "MODERATE",
    rationale: "structure holds but positioning diverges",
    citedObjectRefs: ["ev_000001"],
    ...overrides,
  });
}

const FLOW_PLANS: Record<string, string> = {
  "WHY_IT_HAPPENED": JSON.stringify({
    objective: "Why did BTC move?",
    scopeIncluded: ["technicals", "news"],
    scopeExcluded: ["on-chain (no provider)"],
    tasks: [{ type: "EVIDENCE_GATHERING", objective: "event window evidence", capabilities: ["TECHNICAL_ANALYSIS", "NEWS_ANALYSIS"], completion: "c" }],
    completionCriteria: ["evidence or unavailability recorded"],
    adaptationPolicy: "distinguish competing explanations",
  }),
  "WHAT_DOES_ALL_INFORMATION_SAY": JSON.stringify({
    objective: "Full picture on BTC",
    scopeIncluded: ["technicals", "sentiment"],
    scopeExcluded: ["macro (not material here)"],
    tasks: [
      { type: "TECH", objective: "technical state", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
      { type: "SENTIMENT", objective: "positioning", capabilities: ["SENTIMENT_ANALYSIS"], completion: "c" },
    ],
    completionCriteria: ["dimensions covered or unavailability recorded"],
    adaptationPolicy: "prioritize cross-domain contradictions",
  }),
};

const FLOW7_PLAN = JSON.stringify({
  objective: "Falsify the thesis",
  scopeIncluded: ["technical", "positioning"],
  scopeExcluded: ["history (G1 unavailable)"],
  tasks: [{ type: "FALSIFICATION", objective: "disconfirming evidence", capabilities: ["TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"], completion: "c" }],
  completionCriteria: ["contradictions checked"],
  adaptationPolicy: "maximize falsification value",
});

function buildLui(provider: FakeModelProvider, registry: CapabilityRegistry): { lui: Lui; workspace: Workspace } {
  const workspace = new Workspace();
  const lui = new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });
  return { lui, workspace };
}

beforeEach(() => resetIdCounters());

describe("cross-flow: natural-language routing through the LUI", () => {
  it("routes a causal question to Flow 2 and returns a progressive-disclosure response", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "explain the BTC move", capabilities: [], params: { flow: "WHY_IT_HAPPENED", objective: "Why did BTC drop?" } },
    ]);
    provider.responses.set("research.plan", FLOW_PLANS["WHY_IT_HAPPENED"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow2.causal_synthesis", flowSynthesis("flow2"));
    const registry = registryWith("TECHNICAL_ANALYSIS", "NEWS_ANALYSIS");
    const { lui } = buildLui(provider, registry);
    const result = await lui.handle("Why did BTC drop today?");
    expect(result.flow2).toBeDefined();
    expect(result.flow2?.synthesis?.leadingExplanation).toBe("liquidation cascade");
    expect(result.response?.answer).toContain("liquidation cascade");
    expect(result.response?.confidence).toBe("LOW");
    expect(result.response?.opposingReasons).toContain("macro indices stable");
  });

  it("routes a full-picture request to Flow 6 with parallel dimension research", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "full picture", capabilities: [], params: { flow: "WHAT_DOES_ALL_INFORMATION_SAY", objective: "What does everything say about BTC?" } },
    ]);
    provider.responses.set("research.plan", FLOW_PLANS["WHAT_DOES_ALL_INFORMATION_SAY"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow6.cross_domain_synthesis", flowSynthesis("flow6"));
    const registry = registryWith("TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS");
    const { lui } = buildLui(provider, registry);
    const result = await lui.handle("Give me the full picture on BTC");
    expect(result.flow6).toBeDefined();
    expect(result.flow6?.synthesis?.disagreements[0]?.type).toBe("DIFFERENT_TIME_HORIZON");
    expect(result.response?.answer).toContain("consolidation");
  });

  it("routes CHALLENGE with a falsification objective to Flow 7 — thesis never mutated", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "CHALLENGE", description: "falsify the thesis", capabilities: [], params: { flow: "WHAT_COULD_PROVE_ME_WRONG", objective: "What could prove me wrong?" } },
    ]);
    provider.responses.set("research.plan", FLOW7_PLAN);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow7.falsification", flowSynthesis("flow7"));
    const { lui, workspace } = buildLui(provider, registryWith("TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"));
    const thesis = workspace.addThesis({ statement: "BTC trends up this quarter", objective: "swing" }, trader);
    const result = await lui.handle("Try to prove my thesis wrong");
    expect(result.flow7).toBeDefined();
    expect(result.flow7?.assessment?.currentAssessment).toBe("WEAKENED");
    expect(workspace.getThesis(thesis.id)?.version).toBe(1);
  });

  it("compound request decomposes into ordered flow actions (research + challenge)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "full picture", capabilities: [], params: { flow: "WHAT_DOES_ALL_INFORMATION_SAY", objective: "Full picture on BTC" } },
      { action: "CHALLENGE", description: "falsify thesis", capabilities: [], params: { flow: "WHAT_COULD_PROVE_ME_WRONG", objective: "Challenge the thesis" } },
    ]);
    provider.responses.set("research.plan", FLOW_PLANS["WHAT_DOES_ALL_INFORMATION_SAY"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow6.cross_domain_synthesis", flowSynthesis("flow6"));
    provider.responses.set("flow7.falsification", flowSynthesis("flow7"));
    const { lui, workspace } = buildLui(provider, registryWith("TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"));
    workspace.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    const result = await lui.handle("Give me the full picture on BTC and challenge my thesis");
    expect(result.flow6).toBeDefined();
    expect(result.flow7).toBeDefined();
    expect(provider.calls.filter((c) => c.schemaName === "research.plan")).toHaveLength(2); // two flows, two plans
  });
});

describe("cross-flow: capability-first execution (no Flow→Tool hardcoding)", () => {
  it("the engine only executes capabilities in the validated plan — never a fixed flow kit", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "explain move", capabilities: [], params: { flow: "WHY_IT_HAPPENED", objective: "Why?" } },
    ]);
    // Plan deliberately excludes macro/sentiment — the engine must not add them.
    provider.responses.set("research.plan", JSON.stringify({
      objective: "Why?",
      scopeIncluded: ["technicals"],
      scopeExcluded: ["macro", "sentiment"],
      tasks: [{ type: "TECH", objective: "price structure", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" }],
      completionCriteria: ["c"],
      adaptationPolicy: "stop when sufficient",
    }));
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow2.causal_synthesis", flowSynthesis("flow2"));
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    for (const cap of ["TECHNICAL_ANALYSIS", "MACRO_ANALYSIS", "SENTIMENT_ANALYSIS", "NEWS_ANALYSIS"]) {
      registry.register({
        providerId: `fake/${cap.toLowerCase()}`,
        capabilities: [cap],
        limitations: [],
        freshnessProfile: "test:live",
        async execute(cap) {
          executed.push(cap);
          return { tool: `fake/${cap.toLowerCase()}`, capability: cap, transport: "fake", outputs: [] };
        },
      });
    }
    const { lui } = buildLui(provider, registry);
    await lui.handle("Why did BTC move?");
    expect(executed).toEqual(["TECHNICAL_ANALYSIS"]); // only planned capabilities ran
    expect(executed).not.toContain("MACRO_ANALYSIS");
    expect(executed).not.toContain("SENTIMENT_ANALYSIS");
  });

  it("unmapped flow labels keep the M3 adaptive loop (no invented M4 routing)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "news check", capabilities: [], params: { flow: "WHAT_HAPPENED" } },
    ]);
    provider.responses.set("research.plan", responses.researchPlan());
    // CONTINUE then COMPLETE: the loop runs one round of news research before stopping.
    provider.responses.set("research.adaptive_decision", (req) =>
      req.prompt.includes("Round 1") ? responses.adaptiveDecision("CONTINUE", [{ type: "NEWS", objective: "more news", capabilities: ["NEWS_ANALYSIS"], completion: "c" }]) : responses.adaptiveDecision("COMPLETE"));
    const { lui } = buildLui(provider, registryWith("NEWS_ANALYSIS"));
    const result = await lui.handle("What happened to BTC?");
    expect(result.flow2).toBeUndefined();
    expect(result.flow6).toBeUndefined();
    expect(result.flow7).toBeUndefined();
    expect(result.research).toBeDefined(); // M3 loop handled it
    // Deterministic L0 response comes from the loop's final decision, not a scripted answer.
    expect(result.response?.answer).toContain("evidence assessed");
    expect(result.research?.evidence.length).toBeGreaterThan(0);
  });
});

describe("cross-flow: failure semantics and safety", () => {
  it("model failure during a flow synthesis → typed failure, honest response, state preserved", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "explain move", capabilities: [], params: { flow: "WHY_IT_HAPPENED", objective: "Why?" } },
    ]);
    provider.responses.set("research.plan", FLOW_PLANS["WHY_IT_HAPPENED"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    // Synthesis call fails as provider unavailability — typed failure must survive (M4 §33).
    provider.responses.set("flow2.causal_synthesis", () => {
      throw new ModelFailure("PROVIDER_UNAVAILABLE", "gemini 503", true);
    });
    const { lui, workspace } = buildLui(provider, registryWith("TECHNICAL_ANALYSIS", "NEWS_ANALYSIS"));
    const result = await lui.handle("Why did BTC move?");
    expect(result.flow2?.synthesis).toBeUndefined();
    expect(result.flow2?.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
    expect(result.response?.answer).toContain("could not be completed");
    expect(workspace.listResearch().length).toBeGreaterThan(0); // research state survived
  });

  it("capability failure inside a flow → limitation recorded, judgment still grounded in real evidence", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "explain move", capabilities: [], params: { flow: "WHY_IT_HAPPENED", objective: "Why?" } },
    ]);
    provider.responses.set("research.plan", FLOW_PLANS["WHY_IT_HAPPENED"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow2.causal_synthesis", flowSynthesis("flow2", { citedObjectRefs: [] }));
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/outage",
      capabilities: ["TECHNICAL_ANALYSIS"],
      limitations: ["fake"],
      freshnessProfile: "test:live",
      async execute() {
        throw new ModelFailure("PROVIDER_UNAVAILABLE", "bitget mcp unreachable", true);
      },
    });
    const { lui } = buildLui(provider, registry);
    const result = await lui.handle("Why did BTC move?");
    expect(result.flow2?.outcome.context.limitations.length).toBeGreaterThan(0);
    // The synthesis still completed from remaining evidence; no fabricated citations.
    expect(result.flow2?.synthesis?.citedObjectRefs).toEqual([]);
  });

  it("execution-like model output is rejected before dispatch — no trading surface via flows", async () => {
    const provider = new FakeModelProvider(new Map());
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "RESEARCH", objective: "buy BTC" }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget());
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(true)); // screen flags execution intent
    const { lui } = buildLui(provider, registryWith("TECHNICAL_ANALYSIS"));
    const result = await lui.handle("buy BTC and place an order");
    expect(result.rejected).toBeDefined();
    expect(result.rejected?.violations.length).toBeGreaterThan(0);
    expect(result.flow2).toBeUndefined();
    expect(result.flow6).toBeUndefined();
    expect(result.flow7).toBeUndefined();
  });
});

describe("cross-flow: persistence", () => {
  it("flow research state persists through the existing WorkspaceStore — no second storage path", async () => {
    const store = new MemoryStore();
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "full picture", capabilities: [], params: { flow: "WHAT_DOES_ALL_INFORMATION_SAY", objective: "Full picture" } },
    ]);
    provider.responses.set("research.plan", FLOW_PLANS["WHAT_DOES_ALL_INFORMATION_SAY"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow6.cross_domain_synthesis", flowSynthesis("flow6"));
    const workspace = new Workspace();
    workspace.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    const lui = new Lui({ provider, workspace, store, registry: registryWith("TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"), now: () => new Date() });
    await lui.handle("Full picture on BTC");
    const reloaded = await store.load(workspace.id);
    expect(reloaded.id).toBe(workspace.id);
    expect(reloaded.listResearch().length).toBeGreaterThan(0);
    expect(reloaded.listEvidence().length).toBeGreaterThan(0);
    // Thesis untouched by research; promotion to memory still requires SAVE.
    expect(reloaded.getThesis(workspace.activeTheses()[0]?.id ?? "")?.version).toBe(1);
  });
});

// ===========================================================================
// M4b cross-flow additions — Flows 3/4/8
// ===========================================================================

function flow3Synthesis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overallAssessment: "macro liquidity and ETF momentum dominate",
    factors: [
      { name: "Fed rate path", mechanism: "liquidity channel", status: "OBSERVED_CURRENT_DRIVER", wouldMatterWhen: ["FOMC"], supportingRefs: ["ev_000001"], contradictingRefs: [], uncertainty: [] },
      { name: "ETF approval wave", mechanism: "structural demand", status: "CATALYST", wouldMatterWhen: ["approvals"], supportingRefs: [], contradictingRefs: [], uncertainty: ["timing"] },
    ],
    unresolvedFactors: ["regulatory posture"],
    missingInformation: ["ETF flow data"],
    confidence: "MODERATE",
    uncertainty: ["data freshness"],
    whatWouldChange: ["flow data availability"],
    citedObjectRefs: ["ev_000001"],
    ...overrides,
  });
}

function flow4Synthesis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    thesisStatement: "BTC trends up this quarter",
    components: [
      { component: "higher highs", kind: "CLAIM", status: "SUPPORTED", evidenceQuality: "MIXED", supportingRefs: ["ev_000001"], contradictingRefs: [], rationale: "structure", uncertainty: [] },
    ],
    overallAssessment: "WEAKENED",
    evidenceBasisQuality: "MIXED",
    strongestSupport: ["structure"],
    strongestOpposition: ["CPI"],
    invalidationConditionStatus: [{ condition: "close below opening range", currentlyTriggered: false, evidenceRefs: [] }],
    unresolved: [],
    whatWouldChange: ["macro shift"],
    confidence: "MODERATE",
    rationale: "holds but assumption weakened",
    citedObjectRefs: ["ev_000001"],
    ...overrides,
  });
}

function flow8Synthesis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    frameworkRef: "sa_000001",
    frameworkSummary: "liquidity/structure/positioning framework",
    scoringUsed: "QUALITATIVE",
    criteria: [
      { criterion: "liquidity expanding", status: "SATISFIED", rationale: "macro evidence", supportingRefs: ["ev_000001"], contradictingRefs: [] },
      { criterion: "leverage reset", status: "INSUFFICIENT_EVIDENCE", rationale: "no positioning data", supportingRefs: [], contradictingRefs: [], evidenceNeeded: "funding/OI data" },
    ],
    overallAssessment: "one satisfied, one unverifiable",
    contradictions: [],
    unresolved: ["positioning data"],
    whatWouldChange: ["derivatives availability"],
    confidence: "MODERATE",
    citedObjectRefs: ["ev_000001"],
    ...overrides,
  });
}

const M4B_PLANS: Record<string, string> = {
  "WHAT_COULD_AFFECT_IT": JSON.stringify({
    objective: "factors", scopeIncluded: ["macro"], scopeExcluded: [],
    tasks: [{ type: "MACRO", objective: "macro factors", capabilities: ["MACRO_ANALYSIS"], completion: "c" }],
    completionCriteria: ["c"], adaptationPolicy: "p",
  }),
  "DOES_MY_THESIS_HOLD": JSON.stringify({
    objective: "thesis evidence", scopeIncluded: ["technicals"], scopeExcluded: [],
    tasks: [{ type: "TECH", objective: "claim evidence", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" }],
    completionCriteria: ["c"], adaptationPolicy: "p",
  }),
  "EVALUATE_WITH_MY_FRAMEWORK": JSON.stringify({
    objective: "criterion evidence", scopeIncluded: ["macro"], scopeExcluded: [],
    tasks: [{ type: "MACRO", objective: "liquidity criterion", capabilities: ["MACRO_ANALYSIS"], completion: "c" }],
    completionCriteria: ["c"], adaptationPolicy: "p",
  }),
};

beforeEach(() => resetIdCounters());

describe("M4b cross-flow: shared runner + no Flow→Tool hardcoding", () => {
  it("Flows 3/4/8 are registered as flow objectives — objectives live with flows, execution with the engine", () => {
    // All five implemented flows are known to the runner's objective registry (metadata only).
    expect(Object.keys(FLOW_OBJECTIVES)).toEqual(expect.arrayContaining([
      "WHY_IT_HAPPENED", "WHAT_DOES_ALL_INFORMATION_SAY", "WHAT_COULD_PROVE_ME_WRONG",
      "WHAT_COULD_AFFECT_IT", "DOES_MY_THESIS_HOLD", "EVALUATE_WITH_MY_FRAMEWORK",
    ]));
    // Objectives carry analytical mode + guidance — never capability lists.
    expect(FLOW3_OBJECTIVE.mode).toBe("EXPLORATORY");
    expect(FLOW4_OBJECTIVE.mode).toBe("EVALUATION");
    expect(FLOW8_OBJECTIVE.mode).toBe("EVALUATION");
    for (const objective of [FLOW3_OBJECTIVE, FLOW4_OBJECTIVE, FLOW8_OBJECTIVE]) {
      expect(JSON.stringify(objective.schedulerGuidance)).not.toMatch(/macro-analyst|market-intel|news-briefing|sentiment-analyst|technical-analysis/); // no vendor tools in objectives
    }
  });

  it("routes a factor question to Flow 3 through the LUI with the shared runner", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "factors", capabilities: [], params: { flow: "WHAT_COULD_AFFECT_IT", objective: "What could affect BTC?" } },
    ]);
    provider.responses.set("research.plan", M4B_PLANS["WHAT_COULD_AFFECT_IT"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow3.factor_landscape", flow3Synthesis());
    const { lui } = buildLui(provider, registryWith("MACRO_ANALYSIS"));
    const result = await lui.handle("What could affect Bitcoin over the next few weeks?");
    expect(result.flow3).toBeDefined();
    expect(result.flow3?.landscape?.factors[0]?.status).toBe("OBSERVED_CURRENT_DRIVER");
    expect(result.response?.answer).toContain("macro liquidity");
  });

  it("routes thesis-evaluation to Flow 4 — thesis stays trader-owned, distinct from Flow 7 falsification", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "evaluate thesis", capabilities: [], params: { flow: "DOES_MY_THESIS_HOLD", objective: "Does my thesis still hold?" } },
    ]);
    provider.responses.set("research.plan", M4B_PLANS["DOES_MY_THESIS_HOLD"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow4.thesis_evaluation", flow4Synthesis());
    const { lui, workspace } = buildLui(provider, registryWith("TECHNICAL_ANALYSIS"));
    const thesis = workspace.addThesis({ statement: "BTC trends up this quarter", objective: "swing" }, trader);
    const result = await lui.handle("Does my thesis still hold?");
    expect(result.flow4).toBeDefined();
    expect(result.flow4?.evaluation?.overallAssessment).toBe("WEAKENED");
    expect(result.flow7).toBeUndefined(); // Flow 4 is evaluation, not falsification
    expect(workspace.getThesis(thesis.id)?.version).toBe(1);
  });

  it("routes framework evaluation to Flow 8 — no framework → no silent generic fallback", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "framework eval", capabilities: [], params: { flow: "EVALUATE_WITH_MY_FRAMEWORK", objective: "Evaluate BTC with my framework" } },
    ]);
    provider.responses.set("research.plan", M4B_PLANS["EVALUATE_WITH_MY_FRAMEWORK"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow8.framework_evaluation", flow8Synthesis());
    const { lui, workspace } = buildLui(provider, registryWith("MACRO_ANALYSIS"));
    const frameworkId = workspace.saveArtifact({ type: "framework", content: "liquidity + positioning criteria", derivedFromRefs: [], rationale: "trader framework" }, trader).id;
    const result = await lui.handle("Evaluate BTC using my framework");
    expect(result.flow8).toBeDefined();
    expect(result.flow8?.evaluation?.frameworkRef).toBe(frameworkId);
    expect(result.flow8?.evaluation?.scoringUsed).toBe("QUALITATIVE");
  });

  it("Flow 8 without a saved framework fails honestly — never substitutes a generic framework", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "framework eval", capabilities: [], params: { flow: "EVALUATE_WITH_MY_FRAMEWORK", objective: "Evaluate with my framework" } },
    ]);
    const { lui } = buildLui(provider, registryWith("MACRO_ANALYSIS"));
    const result = await lui.handle("Evaluate this using my framework");
    expect(result.flow8).toBeDefined(); // flow ran
    expect(result.flow8?.evaluation).toBeUndefined(); // but produced no evaluation
    expect(result.flow8?.response).toContain("no saved framework available");
  });

  it("capability registry remains the only execution boundary for M4b flows (no provider names in flow code)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "factors", capabilities: [], params: { flow: "WHAT_COULD_AFFECT_IT", objective: "factors?" } },
    ]);
    provider.responses.set("research.plan", M4B_PLANS["WHAT_COULD_AFFECT_IT"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow3.factor_landscape", flow3Synthesis());
    const executed: string[] = [];
    const registry = new CapabilityRegistry();
    for (const cap of ["MACRO_ANALYSIS", "SENTIMENT_ANALYSIS", "NEWS_ANALYSIS", "TECHNICAL_ANALYSIS"]) {
      registry.register({
        providerId: `fake/${cap.toLowerCase()}`, capabilities: [cap], limitations: [], freshnessProfile: "test:live",
        async execute(cap) { executed.push(cap); return { tool: `fake/${cap.toLowerCase()}`, capability: cap, transport: "fake", outputs: [] }; },
      });
    }
    const { lui } = buildLui(provider, registry);
    await lui.handle("What could affect BTC?");
    expect(executed).toEqual(["MACRO_ANALYSIS"]); // only planned capability; no fixed flow kit
  });

  it("evidence rules stay shared: capability failure is a limitation, never negative evidence, in M4b flows too", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "factors", capabilities: [], params: { flow: "WHAT_COULD_AFFECT_IT", objective: "factors?" } },
    ]);
    provider.responses.set("research.plan", M4B_PLANS["WHAT_COULD_AFFECT_IT"]);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow3.factor_landscape", flow3Synthesis());
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/outage", capabilities: ["MACRO_ANALYSIS"], limitations: [], freshnessProfile: "test:live",
      async execute() { throw new ModelFailure("PROVIDER_UNAVAILABLE", "outage", true); },
    });
    const { lui } = buildLui(provider, registry);
    const result = await lui.handle("What could affect BTC?");
    expect(result.flow3?.outcome.context.limitations.length).toBeGreaterThan(0);
    // No negative-evidence fabrication: failed calls produced no evidence objects.
    expect(result.flow3?.outcome.evidence).toHaveLength(0);
  });

  it("no autonomous execution: M4b flow steps cannot create trading/execution actions", async () => {
    const provider = new FakeModelProvider(new Map());
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "EXECUTE_TRADE" })); // outside locked six
    const { lui } = buildLui(provider, registryWith("MACRO_ANALYSIS"));
    const result = await lui.handle("buy BTC now");
    expect(result.modelFailure).toBeInstanceOf(ModelFailure);
    expect(result.flow3).toBeUndefined();
    expect(result.flow4).toBeUndefined();
    expect(result.flow8).toBeUndefined();
  });
});
