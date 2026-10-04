/**
 * NEW RESEARCH, SERVER SIDE (the manual acceptance failure).
 *
 * A trader with a populated investigation pressed "New research" and the product answered
 * with three contradictory truths at once: a clean composer, the previous investigation's
 * title, and that investigation's finished report — while the same page said "0 research
 * runs". Nothing was deleted (History keeps everything), but the page could not be trusted
 * about which conversation it was showing.
 *
 * Two laws are pinned here, both server-side:
 *   1. `startNewInvestigation` leaves NO current investigation — not a fallback to the newest
 *      thread, not a stale pointer that a refresh resurrects.
 *   2. The thread read path is SCOPED: asking for one investigation's runs can never return
 *      another investigation's runs. The client relies on that to keep a reset thread empty.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import type { StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";

const trader = { kind: "trader" as const, detail: "test" };
const Q1 = "Why did Bitcoin move down today?";
const Q2 = "Focus specifically on ETF flows.";
const Q3 = "What is happening with Ethereum today?";

const stubAdapter: ProviderAdapter = {
  providerId: "stub-market",
  capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION"],
  limitations: ["test stub"],
  freshnessProfile: "test:live",
  async execute(capability: string) {
    return {
      tool: "stub-market",
      capability,
      transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({ symbol: "BTC", price: 84821, observed_at: "2026-10-03T12:49:40.000Z" }),
        about: "BTC",
      }],
    };
  },
};

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", flow: "WHY_IT_HAPPENED", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{ action: "RESEARCH", description: question, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: question, question } }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: question, scopeIncluded: ["market"], scopeExcluded: [],
        tasks: [{ type: "FACT_FINDING", objective: question, capabilities: ["CRYPTO_MARKET_DATA"], completion: "observations" }],
        requirements: [], completionCriteria: ["observations"], adaptationPolicy: "stop when covered",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "observations collected", nextTasks: [] });
    case "research.answer_synthesis":
      return JSON.stringify({
        directAnswer: `Findings for: ${question}`,
        keyFactors: [{ factor: "flow", mechanism: "observed", direction: "current", evidenceRefs: [], counterevidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" }],
        whatWouldChangeTheView: [], implication: "", uncertainty: [], confidence: "MODERATE", citedObjectRefs: [],
      });
    default:
      return JSON.stringify({});
  }
}

async function app(): Promise<ResearchApp> {
  const store = new MemoryStore();
  const workspace = new Workspace();
  await store.save(workspace.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  const provider = {
    providerId: "reset/scripted",
    modelId: "scripted-1",
    async structured<T>(request: StructuredRequest) {
      const raw = scripted(request.schemaName, "Focus specifically on ETF flows.");
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
  return ResearchApp.create({ provider, registry, store, workspace });
}

beforeEach(() => { resetIdCounters(); endRun(); });

describe("NEW RESEARCH leaves no current investigation", () => {
  it("clears the selection, keeps every thread, and stays cleared after a reload", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2);
    const before = a.listInvestigations();
    expect(before.find((i) => i.isCurrent)).toBeDefined();

    await a.startNewInvestigation();

    // No current thread: not the old one, not a silent fallback to the newest.
    const after = a.listInvestigations();
    expect(after.filter((i) => i.isCurrent)).toHaveLength(0);
    // Nothing was deleted — History still holds the investigation and its runs.
    expect(after).toHaveLength(before.length);
    expect(after.find((i) => i.id === before.find((x) => x.isCurrent)!.id)?.runs.length).toBe(
      before.find((x) => x.isCurrent)!.runs.length,
    );
  });

  it("the cleared state survives persistence: a reload does not resurrect the thread", async () => {
    const store = new MemoryStore();
    const workspace = new Workspace();
    await store.save(workspace.toSnapshot());
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const provider = {
      providerId: "reset/scripted",
      modelId: "scripted-1",
      async structured<T>(request: StructuredRequest) {
        const raw = scripted(request.schemaName, Q1);
        return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
      },
    };
    const first = await ResearchApp.create({ provider, registry, store, workspace });
    await first.submitResearchRequest(Q1);
    await first.startNewInvestigation();

    // A COLD instance (the deployed, serverless reality) loading the persisted snapshot.
    const reloaded = await store.load();
    expect(reloaded).toBeDefined();
    expect(reloaded!.currentInvestigation()).toBeUndefined();

    const second = await ResearchApp.create({ provider, registry, store, workspace: reloaded });
    expect(second.listInvestigations().filter((i) => i.isCurrent)).toHaveLength(0);
  });
});

describe("THREAD READS ARE SCOPED TO ONE INVESTIGATION", () => {
  it("asking for one investigation's runs never returns another's", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2);
    const btc = a.listInvestigations().find((i) => i.title === Q1)!;
    const btcRuns = btc.runs.map((r) => r.ref);

    await a.submitResearchRequest(Q3); // a genuinely new investigation (topic switch)
    const eth = a.listInvestigations().find((i) => i.title === Q3)!;
    const ethRuns = eth.runs.map((r) => r.ref);

    const scopedBtc = a.listResearch({ investigationRef: btc.id }).map((r) => r.ref);
    const scopedEth = a.listResearch({ investigationRef: eth.id }).map((r) => r.ref);

    expect(scopedBtc.length).toBeGreaterThan(0);
    expect(scopedEth.length).toBeGreaterThan(0);
    // No cross-contamination in either direction.
    for (const ref of scopedBtc) expect(ethRuns).not.toContain(ref);
    for (const ref of scopedEth) expect(btcRuns).not.toContain(ref);
    // History (no scope) still sees everything.
    expect(a.listResearch({}).length).toBeGreaterThanOrEqual(scopedBtc.length + scopedEth.length);
  });
});