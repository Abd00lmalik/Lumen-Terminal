/**
 * INVESTIGATION / CONVERSATION REGRESSION SUITE (Phase 12, tests 1–12).
 *
 * The governing law throughout: an INVESTIGATION is conversational continuity and a RESEARCH RUN
 * is isolated execution. A conversation may contain many runs; a run must never silently inherit
 * another run's evidence ownership.
 *
 * Everything asserted here runs the REAL pipeline (routing -> LUI -> adaptive loop -> capability
 * registry -> evidence -> judgment backstop -> response assembly). Only the model provider
 * (scripted, for determinism) and the capability transport (a stub) are substituted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import { routeConversation, topicSwitchVerdict } from "../../src/lui/conversation-routing.js";
import { buildInvestigationContext, renderInvestigationContext } from "../../src/research/investigation-context.js";
import { deriveInvestigationState } from "../../src/research/investigation-state.js";
import { cumulativeSynthesisResponse } from "../../src/lui/lui.js";
import type { LuiResult } from "../../src/lui/lui.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "investigation test" };

/** The reproduction requests from the brief. */
const Q1 = "Why did Bitcoin move down today?";
const Q2 = "Focus specifically on ETF flows.";
const Q3 = "Has this happened before?";
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
      return JSON.stringify({
        steps: [{ action: "RESEARCH", description: question, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: question, question } }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: question, scopeIncluded: ["Bitcoin"], scopeExcluded: [],
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

function providerFor(question: string): ModelProvider {
  return {
    providerId: "investigation/scripted", modelId: "scripted-1",
    async structured<T>(request: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
      const raw = scripted(request.schemaName, question);
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
}

const stubAdapter: ProviderAdapter = {
  providerId: "stub-market", capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION"],
  limitations: ["test stub"], freshnessProfile: "test:live",
  async execute(capability: string) {
    return {
      tool: "stub-market", capability, transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({ symbol: "BTC", price: 84821, observed_at: "2026-10-03T12:49:40.000Z" }),
        about: "BTC",
      }],
    };
  },
};

beforeEach(() => { resetIdCounters(); endRun(); });

async function app(question = Q1): Promise<ResearchApp> {
  const store = new MemoryStore();
  const ws = new Workspace();
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  return ResearchApp.create({ provider: providerFor(question), registry, store, workspace: ws });
}

/** A completed run with evidence + a judgment, seeded the way the engine leaves one. */
function seedRun(ws: Workspace, question: string, flow: string, statement: string, evidence: string, at: string): string {
  const runId = `run_seed_${Math.random().toString(36).slice(2, 8)}`;
  beginRun({ runId, userQuestion: question });
  const r = ws.addResearch({ objective: question, question, flow }, trader, new Date(at));
  ws.transitionResearch(r.id, "ACTIVE", trader, "activated", new Date(at));
  const ev = ws.addEvidence(
    { observation: evidence, evidenceType: "market_data", evidenceClass: "RAW_DATA", timestamp: at },
    trader, new Date(at),
  );
  ws.ingestEvidence(ev, r.id);
  const jd = ws.addJudgment(
    { researchRef: r.id, statement, basis: { supportingEvidence: [ev.id], opposingEvidence: [], keyClaims: [], hypotheses: [] } },
    trader, new Date(at),
  );
  ws.transitionResearch(r.id, "COMPLETED", trader, "completed", new Date(at));
  endRun(runId);
  return r.id;
}

// ---------------------------------------------------------------------------

describe("TEST 1 — multiple turns", () => {
  it("one investigation, three turns, three runs, correctly linked", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2);
    await a.submitResearchRequest(Q3);
    const threads = a.listInvestigations();
    expect(threads).toHaveLength(1);
    const inv = threads[0]!;
    const traderTurns = inv.turns.filter((t) => t.role === "TRADER");
    expect(traderTurns).toHaveLength(3);
    // The FIRST turn opens the thread; the follow-ups continue it.
    expect(traderTurns[0]!.continuedInvestigation).toBe(false);
    expect(traderTurns.slice(1).every((t) => t.continuedInvestigation)).toBe(true);
    expect(inv.runs).toHaveLength(3);
    expect(new Set(inv.runs.map((r) => r.researchRef)).size).toBe(3);
    // Every turn names the run it produced.
    expect(traderTurns.every((t) => t.researchRunId !== undefined)).toBe(true);
    expect(new Set(traderTurns.map((t) => t.researchRunId)).size).toBe(3);
  });
});

describe("TEST 2 — follow-up context", () => {
  it("the second turn receives the first turn's findings as prior context", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const firstRun = ws.investigationRuns(inv.id)[0]!;
    ws.addJudgment(
      { researchRef: firstRun.id, statement: "ETF flows were negative", basis: { supportingEvidence: ws.evidenceForResearch(firstRun.id).map((e) => e.id), opposingEvidence: [], keyClaims: [], hypotheses: [] } },
      trader,
    );

    const ctx = buildInvestigationContext({ workspace: ws, investigation: inv, question: Q2 });
    expect(ctx.findings.map((f) => f.text)).toContain("ETF flows were negative");
    expect(ctx.findings[0]?.runId).toBe(firstRun.id);
    // The prior findings are labelled, and the boundary is explicit.
    expect(renderInvestigationContext(ctx)).toMatch(/prior context/i);
    expect(renderInvestigationContext(ctx)).toMatch(/NOT evidence for this run/i);
  });
});

describe("TEST 3 — evidence isolation", () => {
  it("run 2 does not own or re-parent run 1's evidence", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const [run1] = ws.investigationRuns(inv.id);
    const evidenceOfRun1 = ws.evidenceForResearch(run1!.id).map((e) => e.id);

    await a.submitResearchRequest(Q2, undefined, false, inv.id);
    const runs = ws.investigationRuns(inv.id);
    const run2 = runs[1]!;
    const evidenceOfRun2 = ws.evidenceForResearch(run2.id).map((e) => e.id);

    expect(evidenceOfRun1.length).toBeGreaterThan(0);
    expect(evidenceOfRun2.length).toBeGreaterThan(0);
    expect(evidenceOfRun1.filter((id) => evidenceOfRun2.includes(id))).toHaveLength(0);
    // Ownership is immutable: every evidence object still names its own run.
    for (const id of evidenceOfRun1) expect(ws.getEvidence(id)?.researchRef).toBe(run1!.id);
    for (const id of evidenceOfRun2) expect(ws.getEvidence(id)?.researchRef).toBe(run2.id);
    // Both runs belong to the SAME investigation — that is the continuity, not the ownership.
    expect(ws.getResearch(run2.id)?.investigationRef).toBe(inv.id);
  });
});

describe("TEST 4 — historical follow-up", () => {
  it("a historical run joins the investigation and keeps its own run identity", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q3);
    const inv = a.listInvestigations()[0]!;
    expect(inv.runs).toHaveLength(2);
    expect(inv.runs.map((r) => r.researchRef)[1]).not.toBe(inv.runs[0]!.researchRef);
    const historicalTurn = inv.turns.find((t) => t.intent === "HISTORICAL");
    expect(historicalTurn).toBeDefined();
    expect(historicalTurn!.researchRunId).toBeDefined();
  });
});

describe("TEST 5 — thesis continuity", () => {
  it("an explicit thesis statement resolves to the investigation's thesis on a later ask", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const thesis = ws.addThesis(
      { title: "Liquidity driver", statement: "Liquidity conditions are the primary driver", objective: "Test the liquidity thesis", asset: "BTC", userConfirmed: true },
      trader,
    );
    ws.attachInvestigationThesis(inv.id, thesis.id);

    const route = routeConversation({
      message: "Does my thesis hold?",
      investigation: ws.getInvestigation(inv.id),
      hasPriorResearch: true,
      hasInvestigationThesis: true,
    });
    expect(route.action).toBe("CONTINUE");
    expect(route.intent).toBe("THESIS_EVALUATION");

    const ctx = buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(inv.id), question: "Does my thesis hold?" });
    expect(ctx.thesis?.text).toBe("Liquidity conditions are the primary driver");
    expect(a.investigation(inv.id)?.thesis?.statement).toBe("Liquidity conditions are the primary driver");
  });
});

describe("TEST 6 — falsification continuity", () => {
  it("'what could prove me wrong?' continues the investigation and carries its thesis", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const thesis = ws.addThesis(
      { title: "t", statement: "Liquidity is the driver", objective: "o", asset: "BTC", userConfirmed: true },
      trader,
    );
    ws.attachInvestigationThesis(inv.id, thesis.id);

    const route = routeConversation({
      message: "What could prove me wrong?",
      investigation: ws.getInvestigation(inv.id),
      hasPriorResearch: true,
      hasInvestigationThesis: true,
    });
    expect(route.intent).toBe("FALSIFICATION");
    expect(route.continuedInvestigation).toBe(true);
    const ctx = buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(inv.id), question: "What could prove me wrong?" });
    expect(ctx.thesis?.text).toBe("Liquidity is the driver");
  });
});

describe("TEST 7 — topic switch", () => {
  it("moving from Bitcoin to Ethereum does not inherit Bitcoin evidence", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const btcInvestigation = ws.currentInvestigation()!;
    const btcRun = ws.investigationRuns(btcInvestigation.id)[0]!;
    const btcEvidence = ws.evidenceForResearch(btcRun.id).map((e) => e.id);
    expect(btcEvidence.length).toBeGreaterThan(0);

    // The trader names the Bitcoin thread but asks about Ethereum: the ROUTER decides to
    // switch, and the client cannot force continuity it did not earn.
    await a.submitResearchRequest("What is happening with Ethereum?", undefined, false, btcInvestigation.id);
    const threads = a.listInvestigations();
    expect(threads).toHaveLength(2);
    const eth = threads.find((t) => t.id !== btcInvestigation.id)!;
    expect(eth.subject).not.toBe(btcInvestigation.subject);
    // The Bitcoin thread kept exactly its own run and evidence.
    expect(a.investigation(btcInvestigation.id)!.runs.map((r) => r.researchRef)).toEqual([btcRun.id]);
    for (const id of btcEvidence) expect(ws.getEvidence(id)?.researchRef).toBe(btcRun.id);
  });

  it("the router names the switch and its reason", () => {
    const ws = new Workspace();
    const inv = ws.addInvestigation({ title: "BTC", subject: "BTC" }, trader);
    const verdict = topicSwitchVerdict("What is happening with Ethereum?", ws.getInvestigation(inv.id));
    expect(verdict.switch).toBe(true);
    expect(verdict.subject).toBe("ETH");
    expect(verdict.reason).toMatch(/ETH/);
  });

  it("a follow-up that merely names an acronym is NOT a topic switch", () => {
    const ws = new Workspace();
    const inv = ws.addInvestigation({ title: "BTC", subject: "BTC" }, trader);
    // The bug this guards: an uppercase-token scan read "ETF" as the subject and split the
    // single most common follow-up into a new investigation.
    expect(topicSwitchVerdict("Focus specifically on ETF flows.", ws.getInvestigation(inv.id)).switch).toBe(false);
    expect(topicSwitchVerdict("What about liquidations?", ws.getInvestigation(inv.id)).switch).toBe(false);
    expect(topicSwitchVerdict("Why?", ws.getInvestigation(inv.id)).switch).toBe(false);
  });
});

describe("TEST 8 — observation isolation inside a conversation", () => {
  it("a raw observation in a live thread still obeys the 4d92351 execution contract", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;

    const response = await a.submitResearchRequest(RAW, undefined, false, inv.id);
    const runId = ws.getContinuitySnapshot().currentResearchRunId as string;

    expect(response.executionMode).toBe("RAW_OBSERVATION");
    expect(ws.judgmentsForResearch(runId)).toHaveLength(0);
    expect(response.judgmentRef).toBeUndefined();
    expect(response.researchDiagnostics?.questionResolution).toBeUndefined();
    // Only the requested capability ran.
    const executed = response.researchDiagnostics?.executions.map((e) => e.capability) ?? [];
    expect(new Set(executed).size).toBeLessThanOrEqual(1);
    expect(executed.every((c) => c === "CRYPTO_MARKET_DATA")).toBe(true);
  });
});

describe("TEST 9 — refresh persistence", () => {
  it("investigation, turns, run linkage and evidence ownership survive a cold start", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    await store.save(ws.toSnapshot());
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const a = await ResearchApp.create({ provider: providerFor(Q1), registry, store, workspace: ws });
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2);

    const before = a.listInvestigations()[0]!;
    const snapshot = a.getWorkspace().toSnapshot();

    // COLD START: a brand-new app over a store holding only the persisted snapshot.
    const coldStore = new MemoryStore();
    await coldStore.save(snapshot);
    const cold = await ResearchApp.create({ provider: providerFor(Q1), registry, store: coldStore, workspace: new Workspace() });
    const after = cold.listInvestigations()[0]!;

    expect(after.id).toBe(before.id);
    expect(after.turns).toHaveLength(before.turns.length);
    expect(after.runs.map((r) => r.researchRef)).toEqual(before.runs.map((r) => r.researchRef));
    for (const run of before.runs) {
      const live = cold.getWorkspace().investigationRuns(after.id).find((r) => r.id === run.researchRef);
      expect(live?.evidenceRefs).toHaveLength(run.evidenceCount);
      for (const evRef of live?.evidenceRefs ?? []) {
        expect(cold.getWorkspace().getEvidence(evRef)?.researchRef).toBe(run.researchRef);
      }
    }
    expect(after.state.runCount).toBe(before.state.runCount);
  });
});

describe("TEST 10 — previous judgment isolation", () => {
  it("run 2 cannot display run 1's judgment as its current judgment", async () => {
    const ws = new Workspace();
    const run1 = seedRun(ws, Q1, "INDEPENDENT_RESEARCH", "BTC fell because of ETF selling", '{"btc":84500}', "2026-10-01T08:00:00.000Z");
    const inv = ws.addInvestigation({ title: "BTC", subject: "Bitcoin" }, trader);
    expect(ws.judgmentsForResearch(run1)).toHaveLength(1);

    const run2 = seedRun(ws, Q2, "INDEPENDENT_RESEARCH", "ETF flows were negative", '{"etf":-120}', "2026-10-03T09:00:00.000Z");
    const snapshot = ws.getContinuitySnapshot();
    expect(snapshot.currentResearchRunId).toBe(run2);
    expect(snapshot.currentJudgment?.researchRef).toBe(run2);
    // The earlier judgment is untouched on its own run.
    expect(ws.judgmentsForResearch(run1)).toHaveLength(1);
    expect(inv.id).toMatch(/^inv_/);
  });
});

describe("TEST 11 — conversation summary", () => {
  it("'what have we established?' is built from the accumulated investigation state", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const first = ws.investigationRuns(inv.id)[0]!;
    ws.addJudgment(
      { researchRef: first.id, statement: "ETF outflows preceded the decline", basis: { supportingEvidence: ws.evidenceForResearch(first.id).map((e) => e.id), opposingEvidence: [], keyClaims: [], hypotheses: [] } },
      trader,
    );
    await a.submitResearchRequest(Q2, undefined, false, inv.id);

    const state = deriveInvestigationState(ws, ws.getInvestigation(inv.id)!);
    expect(state.findings.map((f) => f.statement)).toContain("ETF outflows preceded the decline");
    expect(state.runCount).toBe(2);

    const response = cumulativeSynthesisResponse(state);
    expect(response.answer).toMatch(/Across 2 research runs/);
    expect(response.answer).toContain("ETF outflows preceded the decline");
    // Decision support, never a recommendation.
    expect(response.answer).not.toMatch(/you should (buy|sell|short|trim|add|exit)/i);
    expect(response.implication).toBe("");
  });

  it("an empty investigation reports nothing established rather than inventing it", () => {
    const ws = new Workspace();
    const inv = ws.addInvestigation({ title: "x", subject: "Bitcoin" }, trader);
    const state = deriveInvestigationState(ws, ws.getInvestigation(inv.id)!);
    expect(state.establishedFacts).toEqual([]);
    expect(state.findings).toEqual([]);
    const response = cumulativeSynthesisResponse(state);
    expect(response.confidence).toBe("UNKNOWN");
    expect(response.answer).toMatch(/research context, not a recommendation/i);
  });
});

describe("TEST 12 — no stale contamination", () => {
  it("a new investigation does not pick up an old run's evidence as its own", async () => {
    const ws = new Workspace();
    const oldRun = seedRun(ws, "What is Bitcoin's price?", "INDEPENDENT_RESEARCH", "BTC is at $83,394", '{"btc":83394}', "2026-10-01T07:41:00.000Z");
    const oldEvidence = ws.evidenceForResearch(oldRun).map((e) => e.id);
    expect(oldEvidence.length).toBeGreaterThan(0);

    const fresh = ws.addInvestigation({ title: "fresh", subject: "Bitcoin" }, trader);
    const state = deriveInvestigationState(ws, ws.getInvestigation(fresh.id)!);
    // The fresh investigation has no runs, so it has established nothing — the old run's
    // evidence is not in scope just because the subject matches.
    expect(state.establishedFacts).toEqual([]);
    expect(state.findings).toEqual([]);
    expect(buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(fresh.id), question: "Why did it move?" }).findings).toEqual([]);
  });
});

describe("routing does not create a ninth canonical flow", () => {
  it("every conversation intent maps to the existing eight flows or to no flow", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const CANONICAL = new Set([
      "WHAT_HAPPENED", "WHY_IT_HAPPENED", "WHAT_COULD_AFFECT_IT", "DOES_MY_THESIS_HOLD",
      "HAS_THIS_HAPPENED_BEFORE", "WHAT_DOES_ALL_INFORMATION_SAY", "WHAT_COULD_PROVE_ME_WRONG",
      "EVALUATE_WITH_MY_FRAMEWORK", "INDEPENDENT_RESEARCH", "RAW_OBSERVATION",
    ]);
    await a.submitResearchRequest(Q3, undefined, false, inv.id);
    for (const run of ws.investigationRuns(inv.id)) expect(CANONICAL.has(run.flow)).toBe(true);
  });
});

describe("conversation turns are immutable history", () => {
  it("a turn records the run it produced and is never re-pointed at another run", async () => {
    const a = await app();
    await a.submitResearchRequest(Q1);
    await a.submitResearchRequest(Q2);
    const inv = a.listInvestigations()[0]!;
    const traderTurns = inv.turns.filter((t) => t.role === "TRADER");
    const refs = traderTurns.map((t) => t.researchRunId);
    expect(new Set(refs).size).toBe(refs.filter((r) => r !== undefined).length);
    for (const t of traderTurns) {
      if (t.researchRunId !== undefined) expect(a.getWorkspace().getResearch(t.researchRunId)).toBeDefined();
    }
    void ({} as LuiResult);
  });
});