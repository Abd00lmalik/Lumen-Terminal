/**
 * Phase B run-identity regressions (audit B1) — the defect Phase B uncovered in PRODUCTION data.
 *
 * Run ids were minted as `run_NNNNNN` from a counter that is seeded from the ids in the
 * snapshot the instance loaded. A run id is never an object id (it lives only as
 * `Research.runId`), so the counter restarted at 1 on every cold process: two serverless
 * instances — or two cold starts — minted `run_000001` for DIFFERENT submissions.
 *
 * Consequence seen live: one "run" held 85 research objects from many submissions, and a
 * history entry showed one submission's question next to another submission's answer. These
 * tests pin both halves of the fix:
 *   - a minted run id is globally unique (per-invocation token), and
 *   - grouping keys on (runId, verbatim question), so legacy collided data is split into the
 *     submissions it actually came from, with each question paired to ITS OWN answer.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { toRunRecord } from "../../src/api/research-app.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import type { ResearchResponseDTO } from "../../src/api/dto.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider limitation"],
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

function scriptedProvider(): FakeModelProvider {
  const provider = new FakeModelProvider(new Map());
  provider.responses.set("lui.normalized_request", responses.normalizedRequest());
  provider.responses.set("lui.resolved_target", responses.resolvedTarget());
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set(
    "lui.action_plan",
    responses.actionPlan([{ action: "RESEARCH", description: "research BTC", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }]),
  );
  provider.responses.set("research.plan", responses.researchPlan());
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  return provider;
}

/** A minimal valid retained run record whose answer is uniquely identifiable. */
function recordWithAnswer(researchRef: string, verdict: string): ResearchResponseDTO {
  return {
    requestId: `req-${researchRef}`,
    action: "RESEARCH",
    outcome: "COMPLETED",
    answer: {
      answer: verdict,
      supportingReasons: [],
      opposingReasons: [],
      counterevidenceStatus: "NONE_ASSESSED_PLACEHOLDER" as never,
      confidence: "MODERATE",
      keyUncertainty: "",
      implication: "",
      citedObjectRefs: [],
    },
    limitations: [],
    researchGaps: [],
    researchRef,
    evidenceRefs: [],
    evidence: [],
    judgments: [],
  };
}

/** Seed one submission's research object (runId + verbatim question come from run-context). */
function seedSubmission(ws: Workspace, runId: string, userQuestion: string, objective: string, verdict: string) {
  beginRun({ runId, userQuestion });
  const research = ws.addResearch({ objective, question: `internal objective: ${objective}`, flow: "WHAT_HAPPENED" }, trader);
  endRun();
  ws.transitionResearch(research.id, "ACTIVE", trader, "run started", new Date());
  ws.addJudgment(
    {
      researchRef: research.id,
      statement: verdict,
      basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] },
      confidence: "MODERATE",
      uncertainty: [],
      implications: [],
      unresolvedQuestions: [],
    },
    trader,
  );
  ws.transitionResearch(research.id, "COMPLETED", trader, "run completed", new Date());
  ws.saveResearchResponse(research.id, toRunRecord(recordWithAnswer(research.id, verdict)));
  return research.id;
}

beforeEach(() => resetIdCounters());

describe("run identity across instances (B1)", () => {
  it("mints a globally unique run id: two instances submitting concurrently never share one", { timeout: 60_000 }, async () => {
    const storeA = new MemoryStore();
    const storeB = new MemoryStore();
    const first = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store: storeA });
    const second = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store: storeB });

    const runA = (await first.app.inject({ method: "POST", url: "/api/research", payload: { message: "What is affecting BTC right now?" } })).json() as { researchRef: string };
    const runB = (await second.app.inject({ method: "POST", url: "/api/research", payload: { message: "What is driving oil prices this week?" } })).json() as { researchRef: string };
    expect(runA.researchRef).not.toBe(runB.researchRef);

    const entryA = ((await first.app.inject({ method: "GET", url: "/api/research" })).json() as { ref: string; runRef?: string; question: string }[])[0]!;
    const entryB = ((await second.app.inject({ method: "GET", url: "/api/research" })).json() as { ref: string; runRef?: string; question: string }[])[0]!;
    expect(entryA.runRef).toBeDefined();
    expect(entryB.runRef).toBeDefined();
    // The whole bug in one assertion: both instances had counter state at 1, so without the
    // per-invocation token this was `run_000001` on both sides.
    expect(entryA.runRef).not.toBe(entryB.runRef);
    expect(entryA.question).toBe("What is affecting BTC right now?");
    expect(entryB.question).toBe("What is driving oil prices this week?");
    await first.app.close();
    await second.app.close();
  });

  it("advances the readable run counter across a cold start (run ids are seeded now)", { timeout: 60_000 }, async () => {
    const store = new MemoryStore();
    const first = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
    await first.app.inject({ method: "POST", url: "/api/research", payload: { message: "What is affecting BTC right now?" } });
    const firstRun = ((await first.app.inject({ method: "GET", url: "/api/research" })).json() as { runRef: string }[])[0]!.runRef;
    await first.app.close();

    // A brand-new process over the SAME persisted workspace: the counter must resume, not restart.
    resetIdCounters();
    const second = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
    await second.app.inject({ method: "POST", url: "/api/research", payload: { message: "Why did oil move this week?" } });
    const runs = (await second.app.inject({ method: "GET", url: "/api/research" })).json() as { runRef: string; question: string }[];
    const secondRun = runs.find((r) => r.question === "Why did oil move this week?")!.runRef;
    const num = (ref: string): number => Number(/^run_(\d+)/.exec(ref)?.[1] ?? 0);
    expect(num(secondRun)).toBeGreaterThan(num(firstRun));
    await second.app.close();
  });
});

describe("legacy run-id collisions (production data shape)", () => {
  it("lists collided members as separate runs, each question paired with ITS OWN answer", { timeout: 60_000 }, async () => {
    // Reproduces the production workspace: one run id reused by two different submissions.
    const store = new MemoryStore();
    const ws = new Workspace();
    const oil = seedSubmission(ws, "run_000001", "What is driving oil prices this week?", "oil drivers", "Oil: supply shock dominated the week");
    const nvda = seedSubmission(ws, "run_000001", "What is driving Nvidia right now?", "nvidia drivers", "NVDA: earnings are scheduled for 2026-11-17");
    await store.save(ws.toSnapshot());

    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: registryWith("NEWS_ANALYSIS"), store });
    const history = (await app.inject({ method: "GET", url: "/api/research" })).json() as { ref: string; question: string; internalRefs?: string[] }[];

    // Two submissions, two rows — not one row holding both.
    expect(history.length).toBe(2);
    const oilEntry = history.find((h) => h.question === "What is driving oil prices this week?")!;
    const nvdaEntry = history.find((h) => h.question === "What is driving Nvidia right now?")!;
    expect(oilEntry.ref).toBe(oil);
    expect(nvdaEntry.ref).toBe(nvda);
    // Neither submission's objects leak into the other's entry.
    expect(oilEntry.internalRefs ?? []).not.toContain(nvda);
    expect(nvdaEntry.internalRefs ?? []).not.toContain(oil);

    // The identity law that broke in production: the question and the answer agree.
    const openedOil = (await app.inject({ method: "GET", url: `/api/research/${oil}` })).json() as Record<string, any>;
    const openedNvda = (await app.inject({ method: "GET", url: `/api/research/${nvda}` })).json() as Record<string, any>;
    expect(openedOil.question).toBe("What is driving oil prices this week?");
    expect(openedOil.answer.answer).toBe("Oil: supply shock dominated the week");
    expect(openedNvda.question).toBe("What is driving Nvidia right now?");
    expect(openedNvda.answer.answer).toBe("NVDA: earnings are scheduled for 2026-11-17");
    expect(openedOil.recordTier).toBe("FULL");
    expect(openedNvda.recordTier).toBe("FULL");
    await app.close();
  });

  it("keeps legacy objects without a run id as their own entries", { timeout: 60_000 }, async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    // Pre-run-context object: no runId, no userQuestion (history is never rewritten).
    const solo = ws.addResearch({ objective: "solo objective", question: "solo internal question", flow: "WHAT_HAPPENED" }, trader);
    ws.transitionResearch(solo.id, "ACTIVE", trader, "started", new Date());
    ws.transitionResearch(solo.id, "COMPLETED", trader, "done", new Date());
    await store.save(ws.toSnapshot());

    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: registryWith("NEWS_ANALYSIS"), store });
    const history = (await app.inject({ method: "GET", url: "/api/research" })).json() as { ref: string; runRef?: string }[];
    expect(history.length).toBe(1);
    expect(history[0]!.ref).toBe(solo.id);
    expect(history[0]!.runRef).toBeUndefined();
    await app.close();
  });
});
