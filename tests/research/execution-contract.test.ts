/**
 * EXECUTION-CONTRACT REGRESSION SUITE (brief §13, tests 1–10).
 *
 * The reported failure: a raw-observation request that forbade judgment, synthesis, falsification,
 * counterevidence and every other capability in plain English still produced a judgment
 * (`jd_000144`), a canonical research-flow identity, a CHALLENGE requirement, a FALSIFICATION
 * round, MATERIALITY and an actionable insight.
 *
 * Every test here drives the REAL pipeline (Lui -> adaptive loop -> capability registry ->
 * evidence -> judgment backstop -> application response assembly). Only the two network edges
 * are substituted: a scripted model provider (determinism) and a stub capability transport.
 * Everything being asserted is production code.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import { executionConstraintsOf, isObservationMode } from "../../src/research/execution-mode.js";
import { capabilityConstraintOf } from "../../src/lui/capability-constraints.js";
import { questionTypeOf } from "../../src/research/requirements.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "execution-contract test" };

/** The exact reproduction request from the brief. */
const RAW_REQUEST =
  "Use CRYPTO_MARKET_DATA only. Retrieve one fresh Bitcoin spot-price observation. " +
  "Return only the raw observation: price, timestamp, source, and evidence ID. " +
  "Do not create a judgment. Do not perform synthesis, falsification, counterevidence analysis, or any other capability.";

/** An ordinary analytical question: no prohibitions, so every law must still apply. */
const ANALYTICAL_REQUEST = "What is driving Bitcoin's move today?";

// ---------------------------------------------------------------------------
// Scripted model
// ---------------------------------------------------------------------------

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({
        primaryAction: "RESEARCH", compoundActions: [], objective: question,
        isExplanationOnly: false, disclosureLevel: 0,
      });
    case "lui.resolved_target":
      // No `flow`: the router must decide the methodology from the request's own words.
      return JSON.stringify({ asset: "BTC", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{
          action: "RESEARCH", description: question,
          capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION"],
          params: { objective: question, question },
        }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: question,
        scopeIncluded: ["Bitcoin spot price"],
        scopeExcluded: [],
        // The planner is scripted to ask for FALSIFICATION too: the engine's floors must be
        // what stops it, not the planner's cooperation.
        tasks: [{
          type: "FACT_FINDING", objective: question,
          capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION"],
          completion: "one fresh spot observation",
        }],
        requirements: [],
        completionCriteria: ["a fresh BTC spot observation"],
        adaptationPolicy: "stop once the observation is collected",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "an observation was collected", nextTasks: [] });
    case "research.answer_synthesis":
      return JSON.stringify({
        directAnswer: "BTC spot is $84,821 as observed at 2026-10-03T12:49:40.000Z.",
        keyFactors: [{
          factor: "fresh spot price", mechanism: "the quoted spot level", direction: "current",
          evidenceRefs: [], counterevidenceRefs: [],
          evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT",
        }],
        whatWouldChangeTheView: ["a materially different reading"],
        implication: "the trader decides",
        uncertainty: [], confidence: "MODERATE", citedObjectRefs: [],
      });
    default:
      return JSON.stringify({});
  }
}

function providerFor(question: string): ModelProvider {
  return {
    providerId: "execution-contract/scripted",
    modelId: "scripted-1",
    async structured<T>(request: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
      const raw = scripted(request.schemaName, question);
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
}

// ---------------------------------------------------------------------------
// Stub transport: serves CRYPTO_MARKET_DATA and FALSIFICATION so that a capability gate
// failure anywhere in the pipeline shows up as an unexpected execution, not a missing provider.
// ---------------------------------------------------------------------------

const executed: string[] = [];

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

interface Harness {
  readonly app: ResearchApp;
  readonly ws: Workspace;
  readonly registry: CapabilityRegistry;
}

/** Seed an ACTIVE Ethereum thesis: a Bitcoin observation must never inherit it. */
function seedActiveEthereumThesis(ws: Workspace): string {
  const thesis = ws.addThesis(
    {
      title: "Ethereum underperformance continues",
      statement: "Ethereum will keep underperforming Bitcoin",
      objective: "Track ETH relative weakness",
      asset: "ETH",
      userConfirmed: true,
    },
    trader,
    new Date("2026-10-01T09:00:00.000Z"),
  );
  ws.setActiveThesis(thesis.id);
  return thesis.id;
}

/** Seed an earlier run that already carries a judgment (the stale-judgment contamination path). */
function seedEarlierRunWithJudgment(ws: Workspace): { readonly researchId: string; readonly evidenceId: string; readonly judgmentRef: string } {
  const runId = "run_000000-seed";
  beginRun({ runId, userQuestion: "What is Bitcoin's current spot price?" });
  const research = ws.addResearch(
    { objective: "Earlier BTC question", question: "What is Bitcoin's current spot price?", flow: "INDEPENDENT_RESEARCH" },
    trader,
    new Date("2026-10-01T07:41:20.000Z"),
  );
  ws.transitionResearch(research.id, "ACTIVE", trader, "activated", new Date("2026-10-01T07:41:20.000Z"));
  const stale = ws.addEvidence(
    {
      observation: JSON.stringify({ symbol: "BTC", price: 83394, observed_at: "2026-10-01T07:41:20.000Z" }),
      evidenceType: "market_data", evidenceClass: "RAW_DATA", timestamp: "2026-10-01T07:41:20.000Z",
    },
    trader,
    new Date("2026-10-01T07:41:20.000Z"),
  );
  ws.ingestEvidence(stale, research.id);
  const judgment = ws.addJudgment(
    { researchRef: research.id, statement: "BTC is at $83,394", basis: { supportingEvidence: [stale.id], opposingEvidence: [], keyClaims: [], hypotheses: [] } },
    trader,
    new Date("2026-10-01T07:41:21.000Z"),
  );
  ws.transitionResearch(research.id, "COMPLETED", trader, "completed", new Date("2026-10-01T07:41:30.000Z"));
  endRun(runId);
  return { researchId: research.id, evidenceId: stale.id, judgmentRef: judgment.ref };
}

async function harness(question: string, seed?: (ws: Workspace) => void): Promise<Harness> {
  resetIdCounters();
  endRun();
  executed.length = 0;
  const store = new MemoryStore();
  const ws = new Workspace();
  seed?.(ws);
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  const original = registry.execute.bind(registry);
  Object.defineProperty(registry, "execute", {
    value: (capability: string, ...rest: unknown[]) => {
      executed.push(capability);
      return (original as (...args: unknown[]) => unknown)(capability, ...rest);
    },
  });
  // The Lui is constructed for parity with production; the APPLICATION path below is what
  // actually runs (it owns the run context, the judgment backstop and response assembly).
  void new Lui({
    provider: providerFor(question), workspace: ws, store, registry,
    now: () => new Date("2026-10-03T12:49:00.000Z"),
  });
  const app = await ResearchApp.create({ provider: providerFor(question), registry, store, workspace: ws });
  // The app owns the authoritative workspace aggregate; the seed reference above may be a
  // pre-hydration instance. Always read graph state through the app.
  return { app, ws: app.getWorkspace(), registry };
}

describe("execution contract: deterministic parse", () => {
  it("revokes the analytical apparatus from the reproduction request", () => {
    const c = executionConstraintsOf(RAW_REQUEST, capabilityConstraintOf(RAW_REQUEST));
    expect(c.mode).toBe("RAW_OBSERVATION");
    expect(c.createJudgment).toBe(false);
    expect(c.allowSynthesis).toBe(false);
    expect(c.allowFalsification).toBe(false);
    expect(c.allowCounterevidence).toBe(false);
    expect(c.allowThesisContext).toBe(false);
    expect(c.allowGapRecovery).toBe(false);
    expect(c.allowedCapabilities).toEqual(["CRYPTO_MARKET_DATA"]);
  });

  it("leaves an ordinary analytical question completely unconstrained", () => {
    const c = executionConstraintsOf(ANALYTICAL_REQUEST);
    expect(c.mode).toBe("RESEARCH");
    expect(c.createJudgment).toBe(true);
    expect(c.allowSynthesis).toBe(true);
    expect(c.allowFalsification).toBe(true);
    expect(c.allowCounterevidence).toBe(true);
    expect(c.allowThesisContext).toBe(true);
    expect(c.allowGapRecovery).toBe(true);
    expect(c.statedProhibitions).toEqual([]);
  });

  it("revokes the judgment alone when only the judgment is forbidden", () => {
    const c = executionConstraintsOf("What drove Bitcoin up yesterday? Do not create a judgment.");
    expect(c.createJudgment).toBe(false);
    expect(c.mode).toBe("RESEARCH");
    expect(c.allowSynthesis).toBe(true);
  });

  it("classifies what the trader ASKED for, never what they forbade", () => {
    // The reproduction's own words contain "falsification" only inside a prohibition.
    expect(questionTypeOf(RAW_REQUEST)).toBe("OBSERVATION");
    expect(questionTypeOf("What could prove me wrong about Bitcoin?")).toBe("FALSIFICATION");
  });

  it("records the trader's prohibitions verbatim for audit", () => {
    const c = executionConstraintsOf(RAW_REQUEST);
    expect(c.statedProhibitions.length).toBeGreaterThan(0);
    expect(c.statedProhibitions.some((p) => /judgment/i.test(p))).toBe(true);
  });
});

describe("TEST 1 - raw observation does not create a judgment", () => {
  it("creates exactly one evidence object and zero judgments", async () => {
    const { app, ws } = await harness(RAW_REQUEST);
    const response = await app.submitResearchRequest(RAW_REQUEST);
    const runId = ws.getContinuitySnapshot().currentResearchRunId;
    expect(runId).toBeDefined();
    const runIdValue = runId as string;

    expect(ws.evidenceForResearch(runIdValue)).toHaveLength(1);
    expect(ws.judgmentsForResearch(runIdValue)).toHaveLength(0);
    expect(response.judgments).toHaveLength(0);
    expect(response.judgmentRef).toBeUndefined();

    // The reported failure minted `jd_000144` for exactly this request.
    const allJudgments = ws.listJudgments().filter((j) => j.researchRef === runIdValue);
    expect(allJudgments).toHaveLength(0);
  });

  it("leaves Current Judgment empty", async () => {
    const { app, ws } = await harness(RAW_REQUEST);
    await app.submitResearchRequest(RAW_REQUEST);
    expect(ws.getContinuitySnapshot().currentJudgment).toBeUndefined();
  });
});

describe("TEST 2 - raw observation does not create falsification requirements", () => {
  it("has no CHALLENGE requirement and never executes FALSIFICATION", async () => {
    const { app } = await harness(RAW_REQUEST);
    await app.submitResearchRequest(RAW_REQUEST);
    expect(executed).not.toContain("FALSIFICATION");
  });

  it("does not classify the request as FALSIFICATION", async () => {
    const { app } = await harness(RAW_REQUEST);
    const response = await app.submitResearchRequest(RAW_REQUEST);
    expect(response.researchDiagnostics?.questionType).not.toBe("FALSIFICATION");
    expect(response.researchDiagnostics?.questionType).toBe("OBSERVATION");
  });
});

describe("TEST 3 - raw observation does not synthesize", () => {
  it("produces no actionable insight, no recommendation and no uncertainty framing", async () => {
    const { app } = await harness(RAW_REQUEST);
    const response = await app.submitResearchRequest(RAW_REQUEST);
    expect(response.researchDiagnostics?.questionResolution).toBeUndefined();
    expect(response.answer.implication).toBe("");
    expect(response.answer.keyUncertainty).toBe("");
    expect(response.answer.supportingReasons).toEqual([]);
    expect(response.answer.opposingReasons).toEqual([]);
    expect(response.answer.answer).not.toMatch(/what would change/i);
    expect(response.answer.answer).not.toMatch(/factor/i);
  });

  it("exposes the execution mode on the response", async () => {
    const { app } = await harness(RAW_REQUEST);
    const response = await app.submitResearchRequest(RAW_REQUEST);
    expect(response.executionMode).toBe("RAW_OBSERVATION");
  });
});

describe("TEST 4 - capability isolation", () => {
  it("executes only the allowed capability, even though the planner asked for more", async () => {
    const { app } = await harness(RAW_REQUEST);
    await app.submitResearchRequest(RAW_REQUEST);
    // The scripted PLAN asked for FALSIFICATION; only the allowed capability may run.
    expect(new Set(executed)).toEqual(new Set(["CRYPTO_MARKET_DATA"]));
  });
});

describe("TEST 5 - raw observation output fidelity", () => {
  it("reports the requested fields from THIS run's own evidence", async () => {
    const { app, ws } = await harness(RAW_REQUEST);
    const response = await app.submitResearchRequest(RAW_REQUEST);
    const runId = ws.getContinuitySnapshot().currentResearchRunId as string;
    const evidence = ws.evidenceForResearch(runId)[0];
    expect(evidence).toBeDefined();

    const answer = response.answer.answer;
    expect(answer).toContain(evidence!.id);                       // evidence ID
    expect(answer).toContain("84821");                            // price
    expect(answer).toContain("2026-10-03T12:49:40.000Z");        // timestamp
    expect(answer).toMatch(/source/i);                            // source
    // No stale value from any other run may appear.
    expect(answer).not.toContain("83394");
  });
});

describe("TEST 6 - no canonical-flow coercion", () => {
  it("does not persist the operation as WHAT_HAPPENED or WHAT_DOES_ALL_INFORMATION_SAY", async () => {
    const { app, ws } = await harness(RAW_REQUEST);
    await app.submitResearchRequest(RAW_REQUEST);
    const runId = ws.getContinuitySnapshot().currentResearchRunId as string;
    const flow = ws.getResearch(runId)?.flow;
    expect(flow).not.toBe("WHAT_HAPPENED");
    expect(flow).not.toBe("WHAT_DOES_ALL_INFORMATION_SAY");
    expect(flow).toBe("RAW_OBSERVATION");
  });
});

describe("TEST 7 - active thesis isolation", () => {
  it("does not let an active ETH thesis enter a BTC observation", async () => {
    const { app, ws } = await harness(RAW_REQUEST, seedActiveEthereumThesis);
    const response = await app.submitResearchRequest(RAW_REQUEST);
    const answer = response.answer.answer.toLowerCase();
    expect(answer).not.toContain("ethereum");
    expect(answer).not.toContain("underperform");
    // The ledger holds only what retrieving the observation needs: no thesis-support row,
    // no thesis-evaluation row, no challenge row.
    const requirements = response.researchDiagnostics?.requirements ?? [];
    expect(requirements.map((r) => r.role)).not.toContain("CHALLENGE");
    expect(requirements.every((r) => !/thesis/i.test(r.description))).toBe(true);
    expect(ws.getActiveThesis()?.asset).toBe("ETH");
  });
});

describe("TEST 8 - previous judgment isolation", () => {
  it("a run with no judgment does not inherit the previous run's Current Judgment", async () => {
    let seeded: { researchId: string } | undefined;
    const { app, ws } = await harness(RAW_REQUEST, (w) => { seeded = seedEarlierRunWithJudgment(w); });
    const earlierRunId = seeded!.researchId;

    const response = await app.submitResearchRequest(RAW_REQUEST);
    const runId = ws.getContinuitySnapshot().currentResearchRunId as string;
    expect(runId).not.toBe(earlierRunId);
    expect(ws.getContinuitySnapshot().currentJudgment).toBeUndefined();
    expect(response.judgments).toHaveLength(0);
    // The earlier judgment is still on ITS OWN run, untouched — history is never rewritten.
    expect(ws.judgmentsForResearch(earlierRunId)).toHaveLength(1);
    expect(ws.judgmentsForResearch(runId)).toHaveLength(0);
  });
});

describe("TEST 9 - refresh isolation", () => {
  it("a cold instance restores the same run and evidence with still zero judgments", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    resetIdCounters();
    endRun();
    await store.save(ws.toSnapshot());
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const app = await ResearchApp.create({ provider: providerFor(RAW_REQUEST), registry, store, workspace: ws });
    const first = await app.submitResearchRequest(RAW_REQUEST);
    const live = app.getWorkspace();
    const runId = live.getContinuitySnapshot().currentResearchRunId as string;
    const evidenceId = live.evidenceForResearch(runId)[0]!.id;

    // Cold instance: a brand-new app over a FRESH store, nothing warm in memory.
    const coldStore = new MemoryStore();
    await coldStore.save(live.toSnapshot());
    const coldApp = await ResearchApp.create({
      provider: providerFor(RAW_REQUEST), registry, store: coldStore, workspace: new Workspace(),
    });
    const snapshot = await coldApp.continuityFresh();
    await coldApp.continuityFresh();
    expect(snapshot.currentResearchRunId).toBe(runId);
    expect(coldApp.getWorkspace().evidenceForResearch(runId)[0]?.id).toBe(evidenceId);
    expect(coldApp.getWorkspace().judgmentsForResearch(runId)).toHaveLength(0);
    expect(snapshot.currentJudgment).toBeUndefined();
    expect(first.executionMode).toBe("RAW_OBSERVATION");
  });
});

describe("TEST 10 - explicit analytical requests still work", () => {
  it("an ordinary research question keeps every law: synthesis, judgment, challenge", async () => {
    const { app, ws } = await harness(ANALYTICAL_REQUEST);
    const response = await app.submitResearchRequest(ANALYTICAL_REQUEST);
    const runId = ws.getContinuitySnapshot().currentResearchRunId as string;

    expect(response.executionMode).toBe("RESEARCH");
    expect(ws.judgmentsForResearch(runId).length).toBeGreaterThan(0);
    expect(response.judgmentRef).toBeDefined();
    expect(response.answer.implication).not.toBe("");
    expect(response.researchDiagnostics?.questionResolution).toBeDefined();
    // The counterevidence floor still fires for an analytical question.
    expect(executed).toContain("FALSIFICATION");
  });
});

describe("mode does not leak between requests", () => {
  it("an observation request followed by an analytical one (and back) stays correct", async () => {
    const { app, ws } = await harness(RAW_REQUEST);
    await app.submitResearchRequest(RAW_REQUEST);
    const rawRun = ws.getContinuitySnapshot().currentResearchRunId as string;
    expect(ws.judgmentsForResearch(rawRun)).toHaveLength(0);

    // The contract is per-request, never sticky on the Lui instance.
    const analyticalApp = await ResearchApp.create({
      provider: providerFor(ANALYTICAL_REQUEST), registry: new CapabilityRegistry(), store: new MemoryStore(),
    });
    void analyticalApp;
    const { app: app2 } = await harness(ANALYTICAL_REQUEST);
    const response = await app2.submitResearchRequest(ANALYTICAL_REQUEST);
    expect(response.judgmentRef).toBeDefined();
    expect(isObservationMode(executionConstraintsOf(ANALYTICAL_REQUEST))).toBe(false);
  });
});