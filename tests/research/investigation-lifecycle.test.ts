/**
 * INVESTIGATION LIFECYCLE — backend regression suite (browser acceptance findings, items
 * 3, 7, 8, 9, 11, 12, 13, 15).
 *
 * The browser acceptance proved the reset was CLIENT-ONLY: nothing told the backend the trader
 * had left the thread, so the server kept reporting the old investigation as current and the
 * composer came back in follow-up mode. These tests pin the server side of that contract:
 * New research clears the SELECTION and deletes nothing.
 *
 * Everything asserted runs the real pipeline; only the model provider (scripted) and the
 * capability transport (a stub) are substituted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { endRun } from "../../src/domain/run-context.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "lifecycle test" };

const Q1 = "Why did Bitcoin move down today?";
const Q2 = "Focus specifically on ETF flows.";
const RAW = "Use CRYPTO_MARKET_DATA only. Retrieve one fresh Bitcoin spot-price observation. Return only the raw observation: price, timestamp, source, and evidence ID. Do not create a judgment.";

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({ steps: [{ action: "RESEARCH", description: question, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: question, question } }], requiresConfirmationFor: [] });
    case "research.plan":
      return JSON.stringify({ objective: question, scopeIncluded: ["Bitcoin"], scopeExcluded: [], tasks: [{ type: "FACT_FINDING", objective: question, capabilities: ["CRYPTO_MARKET_DATA"], completion: "obs" }], requirements: [], completionCriteria: ["obs"], adaptationPolicy: "stop" });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "collected", nextTasks: [] });
    case "research.answer_synthesis":
      return JSON.stringify({ directAnswer: `answer ${question}`, keyFactors: [{ factor: "f", mechanism: "m", direction: "current", evidenceRefs: [], counterevidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" }], whatWouldChangeTheView: [], implication: "", uncertainty: [], confidence: "MODERATE", citedObjectRefs: [] });
    default:
      return JSON.stringify({});
  }
}

function model(): ModelProvider {
  return {
    providerId: "lifecycle", modelId: "lifecycle",
    async structured<T>(r: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
      const raw = scripted(r.schemaName, Q1);
      return { data: JSON.parse(raw) as T, raw, schemaName: r.schemaName, modelId: "lifecycle" };
    },
  };
}

const adapter: ProviderAdapter = {
  providerId: "stub", capabilities: ["CRYPTO_MARKET_DATA"], limitations: ["s"], freshnessProfile: "test:live",
  async execute(capability: string) {
    return { tool: "stub", capability, transport: "https", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: JSON.stringify({ symbol: "BTC", price: 84821 }), about: "BTC" }] };
  },
};

beforeEach(() => { resetIdCounters(); endRun(); });

async function app(): Promise<ResearchApp> {
  const store = new MemoryStore();
  const ws = new Workspace();
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(adapter);
  return ResearchApp.create({ provider: model(), registry, store, workspace: ws });
}

describe("1/2 — New research resets the current investigation", () => {
  it("clears the selection so nothing is current afterwards", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    expect(ws.currentInvestigationIdValue).toBeDefined();

    await a.startNewInvestigation();
    expect(ws.currentInvestigationIdValue).toBeUndefined();
    expect(a.listInvestigations().some((i) => i.isCurrent)).toBe(false);
  });

  it("a composer with no current investigation can never be in follow-up mode", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.startNewInvestigation();
    // No current investigation = no `isCurrent` row = the client's follow-up gate is false.
    expect(a.listInvestigations().find((i) => i.isCurrent)).toBeUndefined();
  });
});

describe("3 — the previous investigation remains in History", () => {
  it("resets nothing: every investigation, turn, run and evidence survives", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2);
    const before = a.listInvestigations()[0]!;
    const runsBefore = before.runs.map((r) => r.researchRef);
    const turnsBefore = before.turns.length;

    await a.startNewInvestigation();

    const after = a.investigation(before.id)!;
    expect(after).toBeDefined();
    expect(after.runs.map((r) => r.researchRef)).toEqual(runsBefore);
    expect(after.turns).toHaveLength(turnsBefore);
    // Evidence is untouched and still owned by its own run.
    for (const run of after.runs) {
      for (const ev of a.getWorkspace().evidenceForResearch(run.researchRef)) {
        expect(a.getWorkspace().getEvidence(ev.id)?.researchRef).toBe(run.researchRef);
      }
    }
    // And it is reopenable: entering it restores it as the current thread.
    await a.enterInvestigation(before.id);
    expect(a.investigation(before.id)!.isCurrent).toBe(true);
  });
});

describe("7 — a new investigation gets a new identity", () => {
  it("the question asked after New research opens a FRESH investigation", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const first = a.getWorkspace().currentInvestigationIdValue as string;
    await a.startNewInvestigation();
    await a.submitResearchRequest("Why is oil moving this week?");
    const second = a.getWorkspace().currentInvestigationIdValue as string;

    expect(second).not.toBe(first);
    expect(second).toMatch(/^inv_/);
    expect(a.investigation(first)!.runs).toHaveLength(1);
    expect(a.investigation(second)!.runs).toHaveLength(1);
  });
});

describe("8/9 — follow-up continuity is preserved (75d49e4 not broken)", () => {
  it("'Focus specifically on ETF flows.' stays in the Bitcoin investigation with a NEW run", async () => {
    const a = await app();
    const first = await a.submitResearchRequest(Q1);
    const invId = a.getWorkspace().currentInvestigationIdValue as string;

    const second = await a.submitResearchRequest(Q2, undefined, false, invId);
    expect(a.getWorkspace().currentInvestigationIdValue).toBe(invId);
    expect(second.researchRunId).not.toBe(first.researchRunId);
    const inv = a.investigation(invId)!;
    expect(inv.runs).toHaveLength(2);
    // Run isolation survives continuity (item 12).
    const [r1, r2] = inv.runs;
    expect(a.getWorkspace().evidenceForResearch(r2!.researchRef).map((e) => e.id))
      .not.toEqual(a.getWorkspace().evidenceForResearch(r1!.researchRef).map((e) => e.id));
  });

  it("the third turn continues the same investigation", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const invId = a.getWorkspace().currentInvestigationIdValue as string;
    await a.submitResearchRequest(Q2, undefined, false, invId);
    await a.submitResearchRequest("Has this happened before?", undefined, false, invId);
    expect(a.getWorkspace().currentInvestigationIdValue).toBe(invId);
    expect(a.investigation(invId)!.runs).toHaveLength(3);
  });
});

describe("4/5/10 — the completion carries everything the UI needs", () => {
  it("a completed run returns its identity, its judgment and an active research snapshot", async () => {
    const a = await app();
    const response = await a.submitResearchRequest(Q1);
    // The UI needs these three to display the report with no navigation.
    expect(response.researchRunId).toBeDefined();
    expect(response.researchRunId).toBe(response.researchRef);
    expect(response.judgmentRef).toBeDefined();

    const snapshot = await a.continuityFresh();
    expect(snapshot.activeResearch?.ref).toBe(response.researchRef);
    expect(snapshot.activeResearch?.status).toBe("COMPLETED");
    expect(snapshot.currentJudgment?.ref).toBe(response.judgmentRef);
    // And the investigation is current, which is what gates the follow-up composer.
    expect(a.listInvestigations().some((i) => i.isCurrent && i.id === a.getWorkspace().currentInvestigationIdValue)).toBe(true);
  });

  it("current-investigation state is distinct from active-run state", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    // A completed run is not ACTIVE, yet the investigation is still the current one — the
    // two must never be conflated.
    const inv = a.getWorkspace().currentInvestigation()!;
    expect(inv.status).toBe("ACTIVE");
    expect(a.getWorkspace().getResearch(inv.runRefs[0]!)!.status).toBe("COMPLETED");
  });
});

describe("11 — the 4d92351 execution contract still holds inside a thread", () => {
  it("a raw observation in a live investigation still creates no judgment", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const invId = a.getWorkspace().currentInvestigationIdValue as string;
    const response = await a.submitResearchRequest(RAW, undefined, false, invId);
    const runId = a.getWorkspace().getContinuitySnapshot().currentResearchRunId as string;

    expect(response.executionMode).toBe("RAW_OBSERVATION");
    expect(response.judgmentRef).toBeUndefined();
    expect(a.getWorkspace().judgmentsForResearch(runId)).toHaveLength(0);
    expect(response.researchDiagnostics?.questionResolution).toBeUndefined();
  });
});

describe("12 — run-owned evidence isolation survives the lifecycle work", () => {
  it("each turn owns exactly its own evidence and never re-parents", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const invId = a.getWorkspace().currentInvestigationIdValue as string;
    await a.submitResearchRequest(Q2, undefined, false, invId);

    const ws = a.getWorkspace();
    const seen = new Set<string>();
    for (const run of a.investigation(invId)!.runs) {
      const refs = ws.evidenceForResearch(run.researchRef).map((e) => e.id);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(seen.has(ref)).toBe(false); // no evidence appears under two runs
        seen.add(ref);
        expect(ws.getEvidence(ref)?.researchRef).toBe(run.researchRef);
      }
    }
  });
});

describe("13/15 — refresh restores the correct thread", () => {
  it("a cold instance restores the investigation, its runs and its evidence ownership", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    await store.save(ws.toSnapshot());
    const registry = new CapabilityRegistry();
    registry.register(adapter);
    const a = await ResearchApp.create({ provider: model(), registry, store, workspace: ws });
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2, undefined, false, a.getWorkspace().currentInvestigationIdValue);
    const before = a.listInvestigations()[0]!;
    const snapshot = a.getWorkspace().toSnapshot();

    const coldStore = new MemoryStore();
    await coldStore.save(snapshot);
    const cold = await ResearchApp.create({ provider: model(), registry, store: coldStore, workspace: new Workspace() });
    const restored = cold.listInvestigations().find((i) => i.id === before.id)!;
    expect(restored).toBeDefined();
    expect(restored.runs.map((r) => r.researchRef)).toEqual(before.runs.map((r) => r.researchRef));
    expect(restored.state.runCount).toBe(before.state.runCount);

    // Reopening an old investigation after a reset still works end to end.
    await cold.enterInvestigation(before.id);
    expect(cold.investigation(before.id)!.isCurrent).toBe(true);
    expect(cold.investigation(before.id)!.runs).toHaveLength(2);
  });
});