import { beforeEach, describe, expect, it } from "vitest";
import { reassessThesis } from "../../src/research/reassess.js";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { createEvidence } from "../../src/domain/objects.js";

const trader = { kind: "trader" as const, detail: "trader confirms" };
const system = { kind: "agent" as const, detail: "system" };

beforeEach(() => resetIdCounters());

/** A validated evidence object to feed the reassessment pathway. */
function newEvidence(workspace: Workspace, observation: string, contradicts: string[] = []): string {
  const evidence = createEvidence(
    {
      researchRef: "rs_000001",
      sourceRefs: [],
      observation,
      evidenceClass: "FACTUAL_OBSERVATION",
      observationType: "EVENT_FACT",
      observedAt: new Date().toISOString(),
      contradicts,
    },
    system,
    new Date(),
  );
  workspace.ingestEvidence(evidence);
  return evidence.id;
}

const MATERIAL = JSON.stringify({
  reassessmentNeeded: true,
  rationale: "new CPI observation directly affects the macro-stability assumption",
  affectsClaims: ["macro conditions stay stable"],
  affectsInvalidationConditions: ["macro tightening accelerates"],
  changesUncertainty: true,
  evidenceQualityNote: "direct factual observation, fresh",
});

const IMMATERIAL = JSON.stringify({
  reassessmentNeeded: false,
  rationale: "the observation concerns a minor altcoin unrelated to the thesis",
  affectsClaims: [],
  affectsInvalidationConditions: [],
  changesUncertainty: false,
  evidenceQualityNote: "low relevance",
});

const REASSESSMENT = JSON.stringify({
  assessment: "WEAKENED",
  rationale: "macro assumption is weakened; core claim still stands",
  supportingEvidence: [],
  contradictingEvidence: ["ev_000001"],
  unresolved: ["next CPI print"],
  whatWouldChange: ["CPI cooldown"],
  confidence: "MODERATE",
  researchQuality: "MIXED",
  citedObjectRefs: ["ev_000001"],
  monitorRevalidations: [{ monitorId: "monitor_000001", outcome: "STILL_RELEVANT", rationale: "conditions remain material" }],
  memoryRevalidations: [{ memoryId: "memory_000001", confirmed: false, note: "current evidence supersedes the stored conclusion" }],
});

describe("M5 reassessment pathway (M5 §13–§15)", () => {
  function setupWorkspace(): Workspace {
    const ws = new Workspace();
    const thesis = ws.addThesis(
      {
        statement: "BTC trends up this quarter",
        objective: "swing",
        claims: [{ statement: "higher highs", importance: "CORE", invalidationConditions: [] }],
        assumptions: [{ statement: "macro conditions stay stable", importance: "SUPPORTING", invalidationConditions: ["macro tightening accelerates"] }],
        invalidationConditions: ["macro tightening accelerates"],
      },
      trader,
    );
    void thesis;
    return ws;
  }

  function setupMonitorAndMemory(ws: Workspace): void {
    const thesis = ws.activeTheses()[0];
    ws.addMonitorProposal(
      { target: "BTC", triggerRationale: "macro watch", thesisRef: thesis?.id, thesisVersion: thesis?.version, conditions: [{ description: "macro tightening accelerates", kind: "INVALIDATION", triggerType: "STATE_CHANGE", conditionStatus: "DERIVED_FROM_THESIS", rationale: "r", evidenceDependencies: [] }] },
      system,
    );
    ws.addMemory({ category: "research", content: "stored: macro was stable last month", thesisRef: thesis?.id, thesisVersion: thesis?.version }, trader);
  }

  it("material evidence triggers reassessment: assessment recorded, thesis UNCHANGED", async () => {
    const ws = setupWorkspace();
    const thesisId = ws.activeTheses()[0]?.id ?? "";
    const versionBefore = ws.getThesis(thesisId)?.version;
    setupMonitorAndMemory(ws);
    newEvidence(ws, "CPI reaccelerated to 4.2%");
    const provider = new FakeModelProvider(new Map([
      ["reassess.materiality", MATERIAL],
      ["reassess.thesis", REASSESSMENT],
    ]));
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    expect(result.reassessed).toBe(true);
    expect(result.assessment?.assessment).toBe("WEAKENED");
    // Thesis object untouched:
    expect(ws.getThesis(thesisId)?.version).toBe(versionBefore);
    expect(ws.getThesis(thesisId)?.statement).toBe("BTC trends up this quarter");
    // Assessment history grew:
    expect(ws.listThesisAssessments(thesisId)).toHaveLength(1);
    expect(ws.latestThesisAssessment(thesisId)?.researchQuality).toBe("MIXED");
  });

  it("irrelevant evidence is honestly non-material: NO reassessment, NO assessment record", async () => {
    const ws = setupWorkspace();
    const thesisId = ws.activeTheses()[0]?.id ?? "";
    setupMonitorAndMemory(ws);
    newEvidence(ws, "minor altcoin delisted on a small exchange");
    const provider = new FakeModelProvider(new Map([
      ["reassess.materiality", IMMATERIAL],
      ["reassess.thesis", REASSESSMENT], // must NOT be called
    ]));
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    expect(result.reassessed).toBe(false);
    expect(result.assessment).toBeUndefined();
    expect(ws.listThesisAssessments(thesisId)).toHaveLength(0); // nothing recorded
    expect(result.response).toContain("non-material");
    // The reassessment model call never happened:
    expect(provider.calls.some((c) => c.schemaName === "reassess.thesis")).toBe(false);
  });

  it("no new evidence → honest no-op without any model call", async () => {
    const ws = setupWorkspace();
    const provider = new FakeModelProvider(new Map());
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [] });
    expect(result.reassessed).toBe(false);
    expect(result.response).toContain("No new evidence");
    expect(provider.calls).toHaveLength(0);
  });

  it("monitor revalidation: STILL_RELEVANT leaves monitors untouched; REVIEW flags for trader (never deletes/rewords)", async () => {
    const ws = setupWorkspace();
    setupMonitorAndMemory(ws);
    newEvidence(ws, "CPI reaccelerated");
    const provider = new FakeModelProvider(new Map([
      ["reassess.materiality", MATERIAL],
      ["reassess.thesis", JSON.stringify({
        ...JSON.parse(REASSESSMENT),
        monitorRevalidations: [
          { monitorId: "monitor_000001", outcome: "REVIEW", rationale: "tightening already happened; condition needs rewording by the trader" },
          { monitorId: "monitor_999999", outcome: "REVIEW", rationale: "invented monitor; must be dropped" },
        ],
      })],
    ]));
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    const monitor = ws.listMonitors()[0];
    expect(monitor?.status).toBe("STALE"); // flagged for review
    expect(monitor?.conditions[0]?.description).toBe("macro tightening accelerates"); // NOT reworded
    expect(ws.listMonitors()).toHaveLength(1); // NOT deleted
    // Invented monitor id was dropped from the proposals:
    expect(result.monitorRevalidations).toHaveLength(1);
    expect(result.monitorRevalidations[0]?.monitorId).toBe("monitor_000001");
  });

  it("memory revalidation: current research outranks memory; memory preserved but marked not-confirmed (M5 §3/§18)", async () => {
    const ws = setupWorkspace();
    setupMonitorAndMemory(ws);
    newEvidence(ws, "CPI reaccelerated to 4.2%");
    const provider = new FakeModelProvider(new Map([
      ["reassess.materiality", MATERIAL],
      ["reassess.thesis", REASSESSMENT],
    ]));
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    expect(result.revalidatedMemories).toHaveLength(1);
    expect(result.revalidatedMemories[0]?.confirmed).toBe(false);
    const memory = ws.listMemories()[0];
    expect(memory?.content).toBe("stored: macro was stable last month"); // original preserved
    expect(memory?.status).toBe("STALE"); // lost current influence
    expect(memory?.validationNote).toContain("NOT confirmed");
  });

  it("invented memory refs are dropped; only real memories are revalidated", async () => {
    const ws = setupWorkspace();
    setupMonitorAndMemory(ws);
    newEvidence(ws, "CPI reaccelerated");
    const provider = new FakeModelProvider(new Map([
      ["reassess.materiality", MATERIAL],
      ["reassess.thesis", JSON.stringify({
        ...JSON.parse(REASSESSMENT),
        memoryRevalidations: [{ memoryId: "memory_424242", confirmed: true, note: "fabricated" }],
      })],
    ]));
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    expect(result.revalidatedMemories).toHaveLength(0);
  });

  it("invalid assessment vocabulary → typed failure, nothing recorded", async () => {
    const ws = setupWorkspace();
    const thesisId = ws.activeTheses()[0]?.id ?? "";
    newEvidence(ws, "CPI reaccelerated");
    const provider = new FakeModelProvider(new Map([
      ["reassess.materiality", MATERIAL],
      ["reassess.thesis", JSON.stringify({ ...JSON.parse(REASSESSMENT), assessment: "OBVIOUSLY_WRONG" })],
    ]));
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    expect(result.reassessed).toBe(false);
    expect(result.modelFailure?.type).toBe("INVALID_OUTPUT");
    expect(ws.listThesisAssessments(thesisId)).toHaveLength(0);
  });

  it("provider failure at the materiality gate → typed failure, honest no-op response", async () => {
    const ws = setupWorkspace();
    newEvidence(ws, "CPI reaccelerated");
    const provider = new FakeModelProvider(new Map(), { failWith: new ModelFailure("PROVIDER_UNAVAILABLE", "gemini down", true) });
    const result = await reassessThesis({ provider, workspace: ws, newEvidence: [ws.listEvidence()[0]] });
    expect(result.reassessed).toBe(false);
    expect(result.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
    expect(result.response).toContain("could not run");
  });
});

describe("M5 LUI continuity integration (M5 §6/§7/§10/§21)", () => {
  function buildLui(provider: FakeModelProvider): { lui: Lui; workspace: Workspace } {
    const workspace = new Workspace();
    const lui = new Lui({ provider, workspace, store: new MemoryStore(), registry: new CapabilityRegistry(), now: () => new Date() });
    return { lui, workspace };
  }

  function scriptDefaults(provider: FakeModelProvider, plan: unknown): void {
    provider.responses.set("lui.normalized_request", responses.normalizedRequest());
    provider.responses.set("lui.resolved_target", responses.resolvedTarget());
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence("CONSEQUENTIAL", true));
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan(plan));
  }

  it("SAVE with confirmed trader origin → artifact + PERSISTENT MEMORY created (M5 §4)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [{ action: "SAVE", description: "save finding", capabilities: [], params: {} }]);
    provider.responses.set("state.save_proposal", JSON.stringify({ artifactType: "finding", content: "ETF flows turned positive", derivedFromRefs: [], rationale: "reusable conclusion" }));
    const { lui, workspace } = buildLui(provider);
    const result = await lui.handle("Save this finding", { kind: "trader", detail: "explicit save request; confirmed" });
    expect(result.saved).toBeDefined();
    expect(result.memory).toBeDefined(); // memory layer entry created
    expect(workspace.listMemories()).toHaveLength(1);
    expect(workspace.listMemories()[0]?.category).toBe("research");
    expect(workspace.listMemories()[0]?.artifactRef).toBe(result.saved?.id);
  });

  it("SAVE without confirmation → awaitingConfirmation, NOTHING persisted (M5 §7)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [{ action: "SAVE", description: "save finding", capabilities: [], params: {} }]);
    provider.responses.set("state.save_proposal", JSON.stringify({ artifactType: "finding", content: "x", derivedFromRefs: [], rationale: "r" }));
    const { lui, workspace } = buildLui(provider);
    const result = await lui.handle("Save this", { kind: "trader", detail: "casual mention" });
    expect(result.saved).toBeUndefined();
    expect(result.memory).toBeUndefined();
    expect(result.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(workspace.listMemories()).toHaveLength(0); // nothing silently persisted
    expect(workspace.listSavedArtifacts()).toHaveLength(0);
  });

  it("MONITOR proposal → persistent PROPOSED monitor with DISTINCT condition kinds; nothing activated (M5 §10/§11)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [{ action: "MONITOR", description: "watch conditions", capabilities: [], params: {} }]);
    provider.responses.set("monitor.proposal", JSON.stringify({
      conditions: ["general condition"],
      invalidationConditions: ["close below opening range"],
      earlyWarningConditions: ["funding resets"],
      suggestedCadence: "daily",
      scopeNote: "watch the thesis invalidation",
      // requiresConfirmation is added by the LUI after validation; the model cannot set it.
    }));
    const { lui, workspace } = buildLui(provider);
    // The trader explicitly asked for this monitor; the request origin records the explicit
    // authorization (M5 §7/§11). The result is still only a PROPOSED monitor: activation is a
    // separate trader-confirmed operation.
    const result = await lui.handle("Monitor the conditions that would invalidate my thesis", { kind: "trader", detail: "explicit monitor request; confirmed" });
    expect(result.monitorProposal?.requiresConfirmation).toBe(true);
    expect(result.monitor).toBeDefined();
    const monitor = workspace.listMonitors()[0];
    expect(monitor?.status).toBe("PROPOSED"); // inert handoff state
    const kinds = monitor?.conditions.map((c) => c.kind);
    expect(kinds).toContain("INVALIDATION");
    expect(kinds).toContain("EARLY_WARNING"); // distinct, never merged
    expect(workspace.listMonitors().every((m) => m.status !== "ACTIVE")).toBe(true); // no silent activation
  });

  it("monitor activation boundary: workspace rejects non-trader origins even post-proposal (M5 §11)", async () => {
    const { workspace } = buildLui(new FakeModelProvider(new Map()));
    const monitor = workspace.addMonitorProposal({ target: "t", conditions: [], triggerRationale: "r" }, system);
    expect(() => workspace.activateMonitor(monitor.id, system, "system tries")).toThrow(/trader confirmation/);
  });

  it("SAVE ≠ MANAGE_STATE: a confirmed save does not change working state and a state change does not create memory", async () => {
    // SAVE path:
    const saveProvider = new FakeModelProvider(new Map());
    scriptDefaults(saveProvider, [{ action: "SAVE", description: "save", capabilities: [], params: {} }]);
    saveProvider.responses.set("state.save_proposal", JSON.stringify({ artifactType: "finding", content: "c", derivedFromRefs: [], rationale: "r" }));
    const saveWs = new Workspace();
    const saveLui = new Lui({ provider: saveProvider, workspace: saveWs, store: newStore(), registry: new CapabilityRegistry(), now: () => new Date() });
    await saveLui.handle("Save this", { kind: "trader", detail: "confirmed save" });
    expect(saveWs.listMemories()).toHaveLength(1);
    expect(saveWs.listTheses()).toHaveLength(0); // no state mutation

    // MANAGE_STATE path:
    const stateProvider = new FakeModelProvider(new Map());
    scriptDefaults(stateProvider, [{ action: "MANAGE_STATE", description: "set active thesis", capabilities: [], params: {} }]);
    stateProvider.responses.set("state.change_proposal", JSON.stringify({ changeType: "set-active-thesis", params: {}, rationale: "r" }));
    const stateWs = new Workspace();
    const stateLui = new Lui({ provider: stateProvider, workspace: stateWs, store: newStore(), registry: new CapabilityRegistry(), now: () => new Date() });
    await stateLui.handle("Make this my active thesis", { kind: "trader", detail: "confirmed state change" });
    expect(stateWs.listMemories()).toHaveLength(0); // NO memory created by MANAGE_STATE
    expect(stateWs.listSavedArtifacts()).toHaveLength(0);
  });

  it("continuity context recovery: a later request resolves thesis/assessment/monitor/memory from persisted state; not conversation memory", async () => {
    const ws = new Workspace();
    const thesis = ws.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    ws.recordThesisAssessment({ thesisId: thesis.id, thesisVersion: 1, assessment: "WEAKENED", rationale: "prior assessment", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW" }, system);
    ws.addMemory({ category: "thesis", content: "thesis context memory", thesisRef: thesis.id, thesisVersion: 1 }, trader);
    // New LUI instance = no conversation memory; everything must come from the workspace:
    const provider = new FakeModelProvider(new Map());
    scriptDefaults(provider, [{ action: "ANALYZE", description: "reassess thesis", capabilities: [], params: { mode: "thesis" } }]);
    provider.responses.set("thesis.assessment", JSON.stringify({
      thesisStatusAssessment: "WEAKENED",
      rationale: "prior assessment stands",
      supportingEvidenceRefs: [],
      contradictingEvidenceRefs: [],
      invalidationConditions: [],
      earlyWarningConditions: [],
      citedObjectRefs: [],
    }));
    const lui = new Lui({ provider, workspace: ws, store: newStore(), registry: new CapabilityRegistry(), now: () => new Date() });
    const result = await lui.handle("Does my thesis still hold?");
    expect(result.thesisAssessment).toBeDefined();
    // The thesis + assessment history came from persisted workspace state:
    expect(ws.activeTheses()[0]?.id).toBe(thesis.id);
    expect(ws.listThesisAssessments(thesis.id).length).toBeGreaterThanOrEqual(1);
  });
});
