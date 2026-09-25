/**
 * Phase B: research history + run identity (audit B1/B2/B3/B4/B8).
 *
 * The product defect these tests lock down: clicking a history entry navigated with the
 * run's requestId (a crypto UUID) instead of the research ref, monitor rows leaked into the
 * research list, and the list/open paths could disagree about identity — so reopening past
 * research failed with "the linked research run could not be loaded". These tests prove:
 *
 *  - the list and the open path use the SAME identifier (the research ref);
 *  - a requestId can never be used as a research ref (typed NOT_FOUND, never a wrong run);
 *  - monitor refs never resolve as research and never appear in research history;
 *  - two runs stay distinct and a later run cannot overwrite an earlier one;
 *  - genuinely old (pre-record) research still opens with its real judgment, honestly
 *    marked as degraded rather than fabricated;
 *  - a missing research returns a TYPED not-found result;
 *  - the run aggregate carries the presentation contract in one call;
 *  - the history list is lightweight and windowed (limit/offset/sort/status/search).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import type { FastifyInstance } from "fastify";
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

function scriptLuiDefaults(provider: FakeModelProvider, plan: unknown): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest());
  provider.responses.set("lui.resolved_target", responses.resolvedTarget());
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

const ADAPTIVE_PLAN = [{ action: "RESEARCH", description: "research BTC", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }];

beforeEach(() => resetIdCounters());

async function makeApp(opts: { seed?: (ws: Workspace) => void } = {}) {
  const provider = new FakeModelProvider(new Map());
  scriptLuiDefaults(provider, ADAPTIVE_PLAN);
  provider.responses.set("research.plan", responses.researchPlan());
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  const store = new MemoryStore();
  if (opts.seed) {
    const ws = new Workspace();
    opts.seed(ws);
    await store.save(ws.toSnapshot());
  }
  return buildApi({ provider, registry: registryWith("NEWS_ANALYSIS"), store });
}

type App = { app: FastifyInstance };

async function completeRun(app: FastifyInstance, message: string): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "POST", url: "/api/research", payload: { message } });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

async function listHistory(app: FastifyInstance, query = ""): Promise<Record<string, unknown>[]> {
  const res = await app.inject({ method: "GET", url: `/api/research${query}` });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>[];
}

describe("Phase B: history identity (list and open use the same research ref)", () => {
  it("lists a lightweight entry per run and opens it on the SAME ref", { timeout: 30_000 }, async () => {
    const { app } = (await makeApp()) as App;
    const run = await completeRun(app, "What is affecting BTC right now?");

    const history = await listHistory(app);
    expect(history.length).toBe(1);
    const entry = history[0]!;

    // The entry is a history row, not an object dump: question + status + timing + verdicts.
    expect(String(entry.ref)).toMatch(/^rs_/);
    expect(entry.question).toBe("What is affecting BTC right now?");
    expect(typeof entry.isCurrent).toBe("boolean");
    expect(typeof entry.createdAt).toBe("string");
    expect(typeof entry.updatedAt).toBe("string");
    expect(entry.status).toBe("COMPLETED");
    // Lightweight: no evidence/judgment/object arrays on a history row.
    expect(entry.evidence).toBeUndefined();
    expect(entry.judgments).toBeUndefined();
    expect(entry.researchDiagnostics).toBeUndefined();

    // Opening uses the identifier the list exposed — and it is the run the POST created.
    const opened = await app.inject({ method: "GET", url: `/api/research/${String(entry.ref)}` });
    expect(opened.statusCode).toBe(200);
    const body = opened.json() as Record<string, unknown>;
    expect(body.ref).toBe(entry.ref);
    expect(body.researchRef).toBe(entry.ref); // canonical open identity, always the requested ref
    expect(body.researchRef).toBe(run.researchRef);
    expect(body.question).toBe(entry.question);
    expect(body.recordTier).toBe("FULL");
    expect(body.degraded).toBe(false);
    await app.close();
  });

  it("carries the run presentation contract in ONE call (aggregate, not stitched reads)", { timeout: 30_000 }, async () => {
    const { app } = (await makeApp()) as App;
    await completeRun(app, "What is affecting BTC right now?");
    const [entry] = await listHistory(app);

    const body = (await app.inject({ method: "GET", url: `/api/research/${String(entry!.ref)}` })).json() as Record<string, any>;

    // Answer surface.
    expect(body.answer.answer).toBeTruthy();
    expect(body.answer.confidence).toBeTruthy();
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.judgments.length).toBeGreaterThan(0);
    expect(Array.isArray(body.researchGaps)).toBe(true);
    // Hoisted presentation fields (the frontend must not re-derive them from diagnostics).
    if (body.researchDiagnostics?.questionResolution !== undefined) {
      expect(body.questionResolution).toEqual(body.researchDiagnostics.questionResolution);
      expect(body.actionableInsight).toEqual(body.researchDiagnostics.questionResolution.actionableInsight);
      expect(body.watchNext).toEqual(body.researchDiagnostics.questionResolution.actionableInsight.watchItems);
    }
    if (body.researchDiagnostics !== undefined) {
      expect(body.stoppedBecause).toBe(body.researchDiagnostics.completionGate);
      expect(body.confidence).toBe(body.researchDiagnostics.confidence ?? body.answer.confidence);
    }
    // Counts, provenance, associations, timing. The retained record is authoritative: the run
    // summary must agree with the evidence/judgments the view actually renders.
    expect(body.summary.evidenceCount).toBe(body.evidence.length);
    expect(body.summary.judgmentCount).toBe(body.judgments.length);
    expect(Array.isArray(body.provenance)).toBe(true);
    expect(body.provenance.length).toBeGreaterThan(0);
    expect(body.saved).toBe(false);
    expect(body.thesisAssessments).toEqual([]);
    // Internal engine state stays behind the diagnostics disclosure (no new dumps).
    expect(body.modelFailure).toBeUndefined();
    await app.close();
  });

  it("never treats a requestId (UUID) as a research ref", { timeout: 30_000 }, async () => {
    const { app } = (await makeApp()) as App;
    const run = await completeRun(app, "What is affecting BTC right now?");
    const requestId = String(run.requestId);
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(requestId).not.toBe(run.researchRef);

    // The old bug navigated with the requestId; it must 404 typedly, never resolve a run.
    const res = await app.inject({ method: "GET", url: `/api/research/${requestId}` });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string; message: string } }).error.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("never resolves or lists a monitor ref as research", { timeout: 30_000 }, async () => {
    const { app, researchApp } = await makeApp();
    await completeRun(app, "What is affecting BTC right now?");
    // A monitor exists in the same workspace (proposal; inert, as the domain mandates).
    const monitor = researchApp.getWorkspace().addMonitorProposal(
      {
        target: "BTC macro thesis",
        conditions: [{ description: "CPI prints above expectation", kind: "INVALIDATION", triggerType: "EVENT", conditionStatus: "OPEN", rationale: "thesis risk", evidenceDependencies: [] }],
        triggerRationale: "thesis invalidation tracking",
      },
      trader,
    );

    const res = await app.inject({ method: "GET", url: `/api/research/${monitor.id}` });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");

    // And research history lists ONLY research objects (monitor rows cannot pollute it).
    const history = await listHistory(app);
    expect(history.every((h) => String(h.ref).startsWith("rs_"))).toBe(true);
    expect(history.some((h) => h.ref === monitor.id)).toBe(false);
    await app.close();
  });

  it("keeps two concurrent runs distinct and never lets a later run overwrite an earlier one", { timeout: 30_000 }, async () => {
    const { app } = (await makeApp()) as App;
    const runA = await completeRun(app, "What is affecting BTC right now?");
    const runB = await completeRun(app, "Why did oil move this week?");
    expect(runA.researchRef).not.toBe(runB.researchRef);

    const history = await listHistory(app);
    expect(history.length).toBe(2);
    const entryA = history.find((h) => h.ref === runA.researchRef)!;
    const entryB = history.find((h) => h.ref === runB.researchRef)!;
    expect(entryA.question).toBe("What is affecting BTC right now?");
    expect(entryB.question).toBe("Why did oil move this week?");

    // Open the OLDER run after the newer completed: it must still be A's own research.
    const openedA = (await app.inject({ method: "GET", url: `/api/research/${String(runA.researchRef)}` })).json() as Record<string, any>;
    const openedB = (await app.inject({ method: "GET", url: `/api/research/${String(runB.researchRef)}` })).json() as Record<string, any>;
    expect(openedA.question).toBe("What is affecting BTC right now?");
    expect(openedB.question).toBe("Why did oil move this week?");
    expect(openedA.judgmentRef).not.toBe(openedB.judgmentRef);
    expect(openedA.ref).not.toBe(openedB.ref);
    await app.close();
  });

  it("returns a TYPED not-found for research that genuinely does not exist", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/research/rs_999999" });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain("stack");
    await app.close();
  });

  it("opens legitimately OLD research (pre-record) from its real judgment, honestly degraded", async () => {
    // A legacy run: completed, judged, but with no persisted presentation record.
    const { app } = await makeApp({
      seed: (ws) => {
        const r = ws.addResearch({ objective: "legacy objective", question: "legacy internal question", flow: "WHAT_HAPPENED" }, trader);
        ws.transitionResearch(r.id, "ACTIVE", trader, "run started", new Date());
        ws.addJudgment(
          {
            researchRef: r.id,
            statement: "BTC was range-bound over the legacy window",
            basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] },
            confidence: "MODERATE",
            uncertainty: ["no volume data"],
            implications: ["range strategies favoured"],
            unresolvedQuestions: [],
          },
          trader,
        );
        ws.transitionResearch(r.id, "COMPLETED", trader, "run completed", new Date());
        ws.saveArtifact({ type: "research", content: "saved legacy finding", rationale: "kept for later", researchRef: r.id }, trader);
      },
    });

    const history = await listHistory(app);
    expect(history.length).toBe(1);
    const entry = history[0]!;
    // Honest listing: no record retained, and the SAVE that derived from this run is marked.
    expect(entry.degraded).toBe(true);
    expect(entry.saved).toBe(true);
    expect(entry.judgmentPreview).toBe("BTC was range-bound over the legacy window");

    // Opening it still yields the REAL persisted conclusion (never a refusal, never a fake).
    const body = (await app.inject({ method: "GET", url: `/api/research/${String(entry.ref)}` })).json() as Record<string, any>;
    expect(body.recordTier).toBe("JUDGMENT");
    expect(body.degraded).toBe(true);
    expect(body.answer.answer).toBe("BTC was range-bound over the legacy window");
    expect(body.answer.confidence).toBe("MODERATE");
    expect(body.answer.keyUncertainty).toBe("no volume data");
    expect(body.saved).toBe(true);
    expect(body.provenance.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});

describe("Phase B: history list window + filters (B4)", () => {
  it("supports limit, offset, sort, status and search without a query language", { timeout: 60_000 }, async () => {
    const { app } = (await makeApp()) as App;
    await completeRun(app, "What is affecting BTC right now?");
    await completeRun(app, "Why did oil move this week?");
    await completeRun(app, "Is gold breaking out?");

    const all = await listHistory(app);
    expect(all.length).toBe(3);
    const newestFirst = all.map((h) => String(h.ref));

    // Default order: newest first.
    const recent = await listHistory(app, "?sort=recent");
    expect(recent.map((h) => String(h.ref))).toEqual(newestFirst);
    const oldest = await listHistory(app, "?sort=oldest");
    expect(oldest.map((h) => String(h.ref))).toEqual([...newestFirst].reverse());

    // Window.
    const page1 = await listHistory(app, "?limit=2");
    expect(page1.length).toBe(2);
    expect(page1.map((h) => String(h.ref))).toEqual(newestFirst.slice(0, 2));
    const page2 = await listHistory(app, "?limit=2&offset=2");
    expect(page2.length).toBe(1);
    expect(page2[0]!.ref).toBe(newestFirst[2]);

    // Exact status + substring search.
    expect((await listHistory(app, "?status=COMPLETED")).length).toBe(3);
    expect((await listHistory(app, "?status=STOPPED")).length).toBe(0);
    const searched = await listHistory(app, "?q=oil");
    expect(searched.length).toBe(1);
    expect(searched[0]!.question).toBe("Why did oil move this week?");
    expect((await listHistory(app, "?q=OIL")).length).toBe(1); // case-insensitive
    expect((await listHistory(app, "?q=nothing-matches-this")).length).toBe(0);

    // Invalid windows fail loudly instead of silently returning something else.
    for (const bad of ["?limit=0", "?limit=999", "?limit=abc", "?offset=-1", "?sort=sideways"]) {
      const res = await app.inject({ method: "GET", url: `/api/research${bad}` });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    }
    await app.close();
  });

  it("a COMPLETED run whose record write never landed is listed and opened HONESTLY, not hidden", { timeout: 30_000 }, async () => {
    // The production shape this locks down: the engine had already persisted the research
    // object as COMPLETED when the invocation died (the platform's 300s limit, or a blob write
    // that stopped answering) — so no presentation record and no completion judgment landed.
    // History must still show the run and say what is missing instead of inventing a result.
    const { app } = await makeApp({
      seed: (ws) => {
        const r = ws.addResearch({ objective: "Research what is driving gold prices", question: "What is driving gold prices this week?", flow: "WHAT_HAPPENED" }, trader);
        ws.transitionResearch(r.id, "ACTIVE", trader, "run started", new Date());
        ws.transitionResearch(r.id, "COMPLETED", trader, "research loop completed", new Date());
      },
    });

    const history = await listHistory(app);
    expect(history.length).toBe(1); // never hidden from the user
    const entry = history[0]!;
    expect(entry.question).toBe("What is driving gold prices this week?");
    expect(entry.status).toBe("COMPLETED");
    expect(entry.degraded).toBe(true); // the listing tells the truth up front
    expect(entry.confidence).toBeUndefined();
    expect(entry.insightPreview).toBeUndefined();

    const body = (await app.inject({ method: "GET", url: `/api/research/${String(entry.ref)}` })).json() as Record<string, any>;
    expect(body.recordTier).toBe("SUMMARY");
    expect(body.degraded).toBe(true);
    expect(body.question).toBe("What is driving gold prices this week?"); // the run is identified exactly
    expect(body.researchRef).toBe(entry.ref);
    expect(body.answer).toBeUndefined(); // no answer is invented from nothing
    expect(body.judgments).toBeUndefined(); // no judgment is fabricated
    expect(body.evidence).toBeUndefined();
    expect(body.provenance.length).toBeGreaterThanOrEqual(2); // the REAL trail survives
    expect(body.summary).toEqual({ evidenceCount: 0, claimCount: 0, hypothesisCount: 0, judgmentCount: 0 });
    await app.close();
  });

  it("every listed entry is openable (listing and opening can never disagree)", { timeout: 60_000 }, async () => {
    const { app } = (await makeApp()) as App;
    await completeRun(app, "What is affecting BTC right now?");
    await completeRun(app, "Why did oil move this week?");

    for (const entry of await listHistory(app)) {
      const res = await app.inject({ method: "GET", url: `/api/research/${String(entry.ref)}` });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { researchRef: string }).researchRef).toBe(entry.ref);
    }
    await app.close();
  });
});
