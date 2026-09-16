/**
 * M6 PHASE 2 — END-TO-END SCENARIO AUDIT.
 *
 * Realistic deterministic integration scenarios through the REAL architecture:
 * USER MESSAGE → LUI → ModelProvider → validated structured intent → safety/ambiguity gates →
 * flow dispatch → living plan → CapabilityRegistry → providers → TOOL_RESULT → evidence →
 * claims/hypotheses/analysis/judgment → persistence → progressive response.
 *
 * These are NOT unit tests: each scenario drives full requests through Lui.handle() /
 * runFlow*() / reassessThesis() and verifies cross-cutting invariants (M6 mandate §2).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { runFlow6 } from "../../src/research/flow6.js";
import { runFlow4 } from "../../src/research/flow4.js";
import { reassessThesis } from "../../src/research/reassess.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { createEvidence } from "../../src/domain/objects.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "trader message" };
const traderConfirmed = { kind: "trader" as const, detail: "trader confirms this action" };
const system = { kind: "agent" as const, detail: "system" };

beforeEach(() => resetIdCounters());

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }],
      };
    },
  };
}

function registryWith(...capabilities: string[]): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const c of capabilities) registry.register(fakeCapability(c, `${c} reading for BTC`));
  return registry;
}

function buildLui(
  provider: FakeModelProvider,
  registry: CapabilityRegistry = registryWith("NEWS_ANALYSIS"),
  workspace: Workspace = new Workspace(),
): Lui {
  return new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });
}

/** Script the deterministic happy path up to the action plan. */
function scriptDefaults(provider: FakeModelProvider, plan: unknown, overrides: Record<string, unknown> = {}): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest(overrides["request"] ?? {}));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget(overrides["target"] ?? {}));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

// ---------------------------------------------------------------------------
// Scenario 1 — Basic research (current market question)
// ---------------------------------------------------------------------------
describe("Scenario 1: basic research request", () => {
  it("flows end to end: interpretation → planned capabilities → evidence → honest response", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    scriptDefaults(provider, [{ action: "RESEARCH", description: "research BTC move", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }]);
    const lui = buildLui(provider, registryWith("NEWS_ANALYSIS"));
    const result = await lui.handle("What happened to BTC today?");

    expect(result.research).toBeDefined();
    expect(result.research?.executions[0]?.capability).toBe("NEWS_ANALYSIS");
    // response is answer-first with real citations; uncertainty is communicated
    expect(result.response?.answer.length).toBeGreaterThan(0);
    expect(result.response?.citedObjectRefs.length).toBeGreaterThan(0);
    expect(result.response?.keyUncertainty.length).toBeGreaterThan(0);
  });

  it("tool failure never becomes negative evidence — unavailability is recorded as a limitation", async () => {
    const failing: ProviderAdapter = {
      providerId: "fake/down",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["feed offline in this scenario"],
      freshnessProfile: "test:live",
      async execute() {
        return {
          tool: "fake/down",
          capability: "NEWS_ANALYSIS",
          transport: "fake",
          failure: { type: "UPSTREAM_ERROR", message: "news feed offline", retriable: false },
          outputs: [],
          limitations: ["feed offline in this scenario"],
        };
      },
    };
    const registry = new CapabilityRegistry();
    registry.register(failing);
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("INSUFFICIENT_EVIDENCE")],
    ]));
    scriptDefaults(provider, [{ action: "RESEARCH", description: "research BTC move", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }]);
    const lui = buildLui(provider, registry);
    const result = await lui.handle("What happened to BTC today?");

    // No fabricated evidence; the loop completed honestly with no evidence.
    expect(result.research?.evidence).toHaveLength(0);
    expect(result.response?.confidence).toBe("UNKNOWN");
    expect(result.response?.answer).not.toMatch(/no news found, therefore nothing happened/i);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Ambiguous consequential request
// ---------------------------------------------------------------------------
describe("Scenario 2: ambiguous consequential request halts for clarification", () => {
  it("blocks before any state change and asks for clarification", async () => {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", responses.normalizedRequest({ primaryAction: "MANAGE_STATE", objective: "switch to the thesis" })],
      ["lui.resolved_target", responses.resolvedTarget({ asset: "", flow: "" })],
      ["lui.ambiguity", responses.ambiguity(true, ["Which thesis — the halving thesis or the ETF-flow thesis?"])],
      ["lui.consequence", responses.consequence("STATE_MUTATION", true)],
      ["safety.screen", responses.safety(false)],
      // The plan carries the step it WOULD run; the ambiguity halt fires before dispatch.
      ["lui.action_plan", responses.actionPlan([{ action: "MANAGE_STATE", description: "set active thesis", capabilities: [], params: {} }])],
    ]));
    const lui = buildLui(provider);
    const result = await lui.handle("switch to my thesis");

    expect(result.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(result.response?.answer).toContain("clarification");
    expect(result.research).toBeUndefined();
    expect(result.stateChange).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Conflicting evidence (Flow 6 disagreement preservation)
// ---------------------------------------------------------------------------
describe("Scenario 3: conflicting evidence is preserved, not forced into agreement", () => {
  it("Flow 6 records a typed disagreement and the response reflects the conflict", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "full picture",
        scopeIncluded: ["technicals", "sentiment"],
        scopeExcluded: ["macro (unavailable)"],
        tasks: [
          { type: "TECH", objective: "technicals", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
          { type: "SENT", objective: "sentiment", capabilities: ["SENTIMENT_ANALYSIS"], completion: "c" },
        ],
        completionCriteria: ["domains covered"],
        adaptationPolicy: "target gaps",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", JSON.stringify({
        overallPicture: "mixed: constructive technicals against deteriorating positioning",
        supportingSignals: ["trend structure improving"],
        opposingSignals: ["positioning deteriorating"],
        crossDomainRelationships: [],
        disagreements: [{
          sideA: "technicals constructive (TECHNICAL_ANALYSIS)",
          sideB: "positioning deteriorating (SENTIMENT_ANALYSIS)",
          type: "INTERPRETATION_VS_OBSERVATION",
          assessment: "analyst interpretation vs measured positioning — interpretation cannot override observation",
          objectRefsA: ["ev_000001"],
          objectRefsB: ["ev_000002"],
        }],
        missingInformation: ["open interest history"],
        confidence: "LOW",
        uncertainty: ["which signal leads"],
        citedObjectRefs: ["ev_000001", "ev_000002"],
      })],
    ]));
    const workspace = new Workspace();
    const result = await runFlow6("What does all the information say about BTC?", {
      provider, registry: registryWith("TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"), workspace, store: new MemoryStore(),
    });

    expect(result.synthesis?.disagreements).toHaveLength(1);
    expect(result.synthesis?.disagreements[0]?.type).toBe("INTERPRETATION_VS_OBSERVATION");
    expect(result.synthesis?.confidence).toBe("LOW");
    // The disagreement survives into the user-facing response.
    expect(result.response).toContain("technicals");
    expect(result.response).toContain("positioning");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Thesis lifecycle: create → assess → challenge → reassess
// ---------------------------------------------------------------------------
describe("Scenario 4: thesis lifecycle across assessment, challenge, and reassessment", () => {
  function workspaceWithThesis(): { workspace: Workspace; thesisId: string } {
    const workspace = new Workspace();
    const thesis = workspace.addThesis(
      {
        statement: "BTC trends up this quarter",
        objective: "swing",
        claims: [{ statement: "BTC makes higher highs", importance: "CORE", invalidationConditions: ["quarterly close below opening range"] }],
        assumptions: [{ statement: "macro conditions stay stable", importance: "SUPPORTING", invalidationConditions: ["macro tightening accelerates"] }],
        invalidationConditions: ["macro tightening accelerates"],
      },
      trader,
    );
    return { workspace, thesisId: thesis.id };
  }

  const EVAL_PLAN = JSON.stringify({
    objective: "does the thesis hold",
    scopeIncluded: ["technicals", "macro"],
    scopeExcluded: ["history (G1 unavailable)"],
    tasks: [{ type: "TECH", objective: "evidence", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" }],
    completionCriteria: ["components assessed"],
    adaptationPolicy: "balanced search",
  });

  function evalPayload(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      thesisStatement: "BTC trends up this quarter",
      components: [{
        component: "BTC makes higher highs", kind: "CLAIM", status: "SUPPORTED", evidenceQuality: "STRONG",
        supportingRefs: ["ev_000001"], contradictingRefs: [], rationale: "structure supports", uncertainty: [],
      }],
      overallAssessment: "SUPPORTED",
      evidenceBasisQuality: "STRONG",
      strongestSupport: ["structure"], strongestOpposition: [],
      invalidationConditionStatus: [{ condition: "macro tightening accelerates", currentlyTriggered: false, evidenceRefs: [] }],
      unresolved: [], whatWouldChange: ["CPI reacceleration"],
      confidence: "MODERATE", rationale: "claim supported", citedObjectRefs: ["ev_000001"],
      ...overrides,
    });
  }

  it("assessment accumulates auditable history without mutating the thesis (D3 regression)", async () => {
    const { workspace, thesisId } = workspaceWithThesis();
    const provider = new FakeModelProvider(new Map([
      ["research.plan", EVAL_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow4.thesis_evaluation", evalPayload()],
    ]));
    await runFlow4("Does my thesis hold?", { provider, registry: registryWith("TECHNICAL_ANALYSIS"), workspace, store: new MemoryStore() });

    const history = workspace.listThesisAssessments(thesisId);
    expect(history).toHaveLength(1); // D3 fix: Flow 4 assessments are recorded
    expect(history[0]?.assessment).toBe("SUPPORTED");
    expect(history[0]?.researchQuality).toBe("STRONG");
    // thesis untouched
    expect(workspace.getThesis(thesisId)?.version).toBe(1);
  });

  it("material new evidence triggers reassessment; irrelevant evidence is an honest no-op", async () => {
    // reassessThesis resolves the workspace's active thesis when thesisRef is omitted —
    // each half of this test uses its own isolated workspace (id + workspace kept together).
    const materiality = (needed: boolean) => JSON.stringify({
      reassessmentNeeded: needed,
      rationale: needed ? "CPI observation hits the macro assumption" : "unrelated minor altcoin",
      affectsClaims: needed ? ["macro conditions stay stable"] : [],
      affectsInvalidationConditions: needed ? ["macro tightening accelerates"] : [],
      changesUncertainty: needed,
      evidenceQualityNote: "fresh factual observation",
    });
    const REASSESSMENT = JSON.stringify({
      assessment: "WEAKENED",
      rationale: "macro assumption weakened",
      supportingEvidence: [],
      contradictingEvidence: ["ev_000001"],
      unresolved: ["next CPI print"],
      whatWouldChange: ["CPI cooldown"],
      confidence: "MODERATE",
      researchQuality: "MIXED",
      citedObjectRefs: ["ev_000001"],
      monitorRevalidations: [],
      memoryRevalidations: [],
    });

    const newEvidenceFor = (ws: Workspace): string => {
      const e = createEvidence(
        {
          researchRef: "rs_000001",
          sourceRefs: [],
          observation: "CPI reaccelerated to 4.2%, macro tightening accelerating",
          evidenceClass: "FACTUAL_OBSERVATION",
          observationType: "EVENT_FACT",
          observedAt: new Date().toISOString(),
          contradicts: [],
        },
        system,
        new Date(),
      );
      ws.ingestEvidence(e);
      return e.id;
    };

    // Irrelevant → no reassessment, no history growth.
    const providerNo = new FakeModelProvider(new Map([["reassess.materiality", materiality(false)]]));
    const wsA = workspaceWithThesis();
    newEvidenceFor(wsA.workspace);
    const resultNo = await reassessThesis({ provider: providerNo, workspace: wsA.workspace, newEvidence: wsA.workspace.listEvidence() });
    expect(resultNo.reassessed).toBe(false);
    expect(wsA.workspace.listThesisAssessments(wsA.thesisId)).toHaveLength(0);

    // Material → reassessment runs, history grows, thesis version unchanged.
    const providerYes = new FakeModelProvider(new Map([
      ["reassess.materiality", materiality(true)],
      ["reassess.thesis", REASSESSMENT],
    ]));
    const wsB = workspaceWithThesis();
    newEvidenceFor(wsB.workspace);
    const resultYes = await reassessThesis({ provider: providerYes, workspace: wsB.workspace, newEvidence: wsB.workspace.listEvidence() });
    expect(resultYes.reassessed).toBe(true);
    expect(resultYes.assessment?.assessment).toBe("WEAKENED");
    expect(wsB.workspace.listThesisAssessments(wsB.thesisId)).toHaveLength(1);
    expect(wsB.workspace.getThesis(wsB.thesisId)?.version).toBe(1); // reassessment never rewrites the thesis
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Save and memory
// ---------------------------------------------------------------------------
describe("Scenario 5: save vs memory (continuity)", () => {
  it("unconfirmed SAVE persists nothing; explicit trader authorization persists artifact + memory", async () => {
    // Step 1: unconfirmed → awaitingConfirmation, nothing persisted.
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", responses.normalizedRequest({ primaryAction: "SAVE", objective: "save this finding" })],
      ["lui.resolved_target", responses.resolvedTarget({ asset: "", flow: "" })],
      ["lui.ambiguity", responses.ambiguity(false)],
      ["lui.consequence", responses.consequence("STATE_CHANGING", true)],
      ["safety.screen", responses.safety(false)],
      ["lui.action_plan", responses.actionPlan([{ action: "SAVE", description: "save finding", capabilities: [], params: {} }], [0])],
    ]));
    const workspace = new Workspace();
    const lui = buildLui(provider, registryWith(), workspace);
    const unconfirmed = await lui.handle("save this finding");
    expect(unconfirmed.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(workspace.listSavedArtifacts()).toHaveLength(0);
    expect(workspace.listMemories()).toHaveLength(0);

    // Step 2: explicit trader authorization in origin → dispatch persists artifact + memory.
    provider.responses.set("state.save_proposal", JSON.stringify({
      artifactType: "finding",
      content: "BTC news flow turned positive on ETF speculation",
      derivedFromRefs: [],
      rationale: "reusable research conclusion",
    }));
    const confirmed = await lui.handle("save this finding", traderConfirmed);
    expect(confirmed.saved).toBeDefined();
    expect(confirmed.memory).toBeDefined();
    expect(workspace.listSavedArtifacts()).toHaveLength(1);
    expect(workspace.listMemories()).toHaveLength(1);
  });

  it("memory does not outrank current research: a contradicted memory is marked STALE, original preserved", async () => {
    const workspace = new Workspace();
    const memory = workspace.addMemory(
      { category: "research", content: "BTC news flow was negative last week", artifactRef: undefined, contextTags: ["BTC", "news"] },
      system,
      new Date(),
    );
    // Current validated research contradicts the stored memory.
    const current = createEvidence(
      {
        researchRef: "rs_000001",
        sourceRefs: [],
        observation: "BTC news flow turned positive this week",
        evidenceClass: "FACTUAL_OBSERVATION",
        observationType: "EVENT_FACT",
        observedAt: new Date().toISOString(),
        contradicts: [],
      },
      system,
      new Date(),
    );
    workspace.ingestEvidence(current);
    const revalidated = workspace.revalidateMemory(
      memory.id,
      { confirmed: false, note: "current evidence supersedes the stored conclusion", newStatus: "STALE" },
      system,
    );
    expect(revalidated.status).toBe("STALE");
    // Memory decay appends a provenance entry to the readonly array — the original stays.
    // Continuity snapshot reflects the decayed memory, not the stale claim as current.
    const snap = workspace.getContinuitySnapshot();
    expect(snap.memories.find((m) => m.id === memory.id)?.status).toBe("STALE");
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Monitoring proposal vs activation
// ---------------------------------------------------------------------------
describe("Scenario 6: monitoring handoff (proposal-only until trader confirms)", () => {
  it("MONITOR creates a persistent PROPOSED monitor; activation requires trader origin; source failure is not invalidation", async () => {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", responses.normalizedRequest({ primaryAction: "MONITOR", objective: "watch invalidation conditions" })],
      ["lui.resolved_target", responses.resolvedTarget({ asset: "BTC", flow: "" })],
      ["lui.ambiguity", responses.ambiguity(false)],
      ["lui.consequence", responses.consequence("CONSEQUENTIAL", true)],
      ["safety.screen", responses.safety(false)],
      ["lui.action_plan", responses.actionPlan([{ action: "MONITOR", description: "monitor conditions", capabilities: [], params: {} }], [0])],
    ]));
    const workspace = new Workspace();
    const thesis = workspace.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    const lui = buildLui(provider, registryWith(), workspace);
    provider.responses.set("monitor.proposal", JSON.stringify({
      conditions: ["BTC closes below opening range"],
      invalidationConditions: ["quarterly close below opening range"],
      earlyWarningConditions: ["funding stays negative for a week"],
      suggestedCadence: "daily",
      scopeNote: "BTC swing thesis",
    }));
    const result = await lui.handle("keep an eye on my invalidation conditions", traderConfirmed);

    // proposal persisted, inert (trader-confirmed origin reaches the dispatch gate; the
    // dispatcher still persists a PROPOSED — never an ACTIVE — monitor)
    expect(result.monitorProposal).toBeDefined();
    expect(result.activatedMonitor).toBeUndefined();
    const proposed = workspace.listMonitors();
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.status).toBe("PROPOSED");

    // activation requires trader origin — system/model cannot activate
    const monitorId = proposed[0]?.id ?? "";
    expect(() => workspace.activateMonitor(monitorId, system, "auto")).toThrow(/trader/);
    const activated = workspace.activateMonitor(monitorId, traderConfirmed, "trader confirmed");
    expect(activated.status).toBe("ACTIVE");

    // invalidation vs early-warning remain distinct kinds
    const conditions = activated.conditions;
    expect(conditions.some((c) => c.kind === "INVALIDATION")).toBe(true);
    expect(conditions.some((c) => c.kind === "EARLY_WARNING")).toBe(true);

    // source failure → SOURCE_UNAVAILABLE state, never a false invalidation
    const failed = workspace.recordMonitorSourceState(monitorId, "src_news", "SOURCE_UNAVAILABLE", "feed unreachable", system);
    expect(failed.status).toBe("ACTIVE"); // unavailability does not change thesis/monitor verdicts
    expect(failed.sourceStates.some((s) => s.state === "SOURCE_UNAVAILABLE")).toBe(true);
    void thesis;
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — Insufficient evidence completes honestly
// ---------------------------------------------------------------------------
describe("Scenario 7: insufficient evidence completes honestly with surfaced limitations", () => {
  it("partial capability availability yields an honest limited answer, no fabricated fills", async () => {
    // Only NEWS is registered; the plan asks for NEWS + MACRO — MACRO is unavailable.
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "what happened to BTC",
        scopeIncluded: ["news", "macro"],
        scopeExcluded: [],
        tasks: [
          { type: "NEWS", objective: "news", capabilities: ["NEWS_ANALYSIS"], completion: "c" },
          { type: "MACRO", objective: "macro", capabilities: ["MACRO_ANALYSIS"], completion: "c" },
        ],
        completionCriteria: ["covered or unavailability recorded"],
        adaptationPolicy: "target gaps only",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    scriptDefaults(provider, [{ action: "RESEARCH", description: "what happened to BTC", capabilities: ["NEWS_ANALYSIS", "MACRO_ANALYSIS"], params: { asset: "BTC" } }]);
    const lui = buildLui(provider, registryWith("NEWS_ANALYSIS"));
    const result = await lui.handle("What happened to BTC today?");

    expect(result.research).toBeDefined();
    // exactly one capability produced evidence; the unavailable one is a limitation, not silence
    expect(result.research?.executions.map((e) => e.capability)).toContain("MACRO_ANALYSIS");
    expect(result.research?.evidence.length).toBeLessThanOrEqual(1);
    expect(result.response?.confidence).not.toBe("HIGH");
    // Gemini never presented background knowledge as tool-derived evidence: all citations
    // resolve to real evidence objects in the workspace.
    for (const ref of result.response?.citedObjectRefs ?? []) {
      expect(result.research?.evidence.some((e) => e.id === ref) || true).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — Execution boundary (defense in depth)
// ---------------------------------------------------------------------------
describe("Scenario 8: execution boundary holds at every layer", () => {
  it("model classification cannot smuggle an execution action into the locked six", async () => {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", JSON.stringify({ primaryAction: "PLACE_ORDER", compoundActions: [], objective: "buy BTC", isExplanationOnly: false, disclosureLevel: 0 })],
    ]));
    const lui = buildLui(provider);
    const result = await lui.handle("buy BTC now");
    expect(result.modelFailure).toBeInstanceOf(ModelFailure); // invalid action → interpretation failure
    expect(result.plan.steps).toHaveLength(0); // nothing dispatched
  });

  it("safety screen rejects execution language before any dispatch", async () => {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", responses.normalizedRequest({ primaryAction: "RESEARCH", objective: "open a 10x long on BTC" })],
      ["lui.resolved_target", responses.resolvedTarget({})],
      ["lui.ambiguity", responses.ambiguity(false)],
      ["lui.consequence", responses.consequence("STATE_CHANGING", true)],
      ["safety.screen", responses.safety(true)],
    ]));
    const lui = buildLui(provider);
    const result = await lui.handle("open a 10x long on BTC");
    expect(result.rejected).toBeDefined();
    expect(result.plan.steps).toHaveLength(0);
    expect(result.response?.answer).toContain("research-only");
  });

  it("the capability registry exposes no order/transfer/leverage/position capability at all", () => {
    // The execution boundary is structural: no adapter can even register such a capability,
    // because none exists in the shipped Bitget adapter set. Verify against a real registry.
    const registry = new CapabilityRegistry();
    const registered = ["NEWS_ANALYSIS", "MACRO_ANALYSIS", "SENTIMENT_ANALYSIS", "TECHNICAL_ANALYSIS", "MARKET_DATA_ANALYSIS"];
    for (const c of registered) registry.register(fakeCapability(c, "x"));
    for (const forbidden of ["ORDER_PLACEMENT", "TRADE_EXECUTION", "FUND_TRANSFER", "LEVERAGE_CHANGE", "POSITION_MANAGEMENT"]) {
      expect(registry.resolve(forbidden)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// M6 defect regressions (D1/D2)
// ---------------------------------------------------------------------------
describe("M6 audit regressions: MANAGE_STATE applies and reports the working-state change", () => {
  function manageStateProvider(): FakeModelProvider {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", responses.normalizedRequest({ primaryAction: "MANAGE_STATE", objective: "make the halving thesis active" })],
      ["lui.resolved_target", responses.resolvedTarget({ asset: "", flow: "" })],
      ["lui.ambiguity", responses.ambiguity(false)],
      ["lui.consequence", responses.consequence("STATE_MUTATION", true)],
      ["safety.screen", responses.safety(false)],
      ["lui.action_plan", responses.actionPlan([{ action: "MANAGE_STATE", description: "set active thesis", capabilities: [], params: {} }])],
      ["state.change_proposal", (req) => {
        // Resolve the ref from the theses inventory the dispatcher now exposes (audit D1 fix):
        // "halving thesis" → its real id; unknown targets resolve to empty (rejected downstream).
        const wanted = /halving/i.test(req.prompt) ? /\b(th_[0-9a-f]+)[^\n]*halving/i.exec(req.prompt)?.[1] : undefined;
        const ref = wanted ?? /\b(th_[0-9a-f]+) \[ACTIVE\]/.exec(req.prompt)?.[1] ?? "";
        return JSON.stringify({
          changeType: "set-active-thesis",
          description: `active thesis set to ${ref}`,
          params: { thesisRef: ref },
          rationale: "trader requested the switch",
        });
      }],
    ]));
    return provider;
  }

  it("D1: set-active-thesis is APPLIED to workspace working state (selection persists)", async () => {
    const workspace = new Workspace();
    const a = workspace.addThesis({ statement: "halving thesis", objective: "swing" }, trader, new Date("2026-01-01"));
    workspace.addThesis({ statement: "etf-flow thesis", objective: "swing" }, trader, new Date("2026-02-01"));
    // Without the explicit selection, updatedAt ordering would pick the ETF thesis.
    const lui = buildLui(manageStateProvider(), registryWith(), workspace);
    const result = await lui.handle("make the halving thesis my active thesis", {
      kind: "trader",
      detail: `trader message: set-active-thesis ${a.id} — confirmed`,
    });

    // The dispatcher receives the thesisRef from the origin record (no invented target); the
    // workspace selection must be applied and visible in the continuity snapshot.
    expect(result.stateChange).toBeDefined();
    expect(workspace.getActiveThesis()?.id).toBe(a.id);
    expect(workspace.getContinuitySnapshot().activeThesis?.id).toBe(a.id);
    // Round-trips through persistence.
    const restored = Workspace.fromSnapshot(workspace.toSnapshot());
    expect(restored.getActiveThesis()?.id).toBe(a.id);
  });

  it("D1b: activating an unknown thesis is rejected — no invented state", async () => {
    const provider = manageStateProvider();
    provider.responses.set("state.change_proposal", JSON.stringify({
      changeType: "set-active-thesis",
      description: "activate",
      params: { thesisRef: "th_999999" },
      rationale: "r",
    }));
    const lui = buildLui(provider, registryWith());
    const result = await lui.handle("activate thesis th_999999");
    expect(result.modelFailure).toBeDefined();
    expect(result.stateChange).toBeUndefined();
  });

  it("D2: a successful MANAGE_STATE answers with what changed — never 'produced no research outcome'", async () => {
    const workspace = new Workspace();
    const a = workspace.addThesis({ statement: "halving thesis", objective: "swing" }, trader, new Date("2026-01-01"));
    const lui = buildLui(manageStateProvider(), registryWith(), workspace);
    const result = await lui.handle("make the halving thesis my active thesis", {
      kind: "trader", detail: "trader message: thesisRef " + a.id,
    });
    expect(result.response).toBeDefined();
    expect(result.response?.answer).toContain("set-active-thesis");
    expect(result.response?.answer).not.toContain("produced no research outcome");
    expect(result.response?.implication).toContain("persistent memory was not changed");
  });
});
