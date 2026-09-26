/**
 * Phase C API: the Saved workspace endpoints (GET/GET:id/POST/DELETE /api/saved).
 *
 * Contracts under test: typed 400 for invalid params/payloads, typed 404 for unknown ids,
 * explicit DTOs (no internal dumps), idempotent SAVE, research integration for every kind,
 * and — critically — unsave never touches the originating research.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { toRunRecord } from "../../src/api/research-app.js";
import type { ResearchResponseDTO } from "../../src/api/dto.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { FakeModelProvider } from "../model/fakes.js";
import type { FastifyInstance } from "fastify";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

interface Seeded {
  readonly researchId: string;
  readonly evidenceId: string;
  readonly judgmentId: string;
}

/** A completed run with a real evidence object, judgment, and a FULL persisted record. */
function seedRun(ws: Workspace): Seeded {
  const research = ws.addResearch({ objective: "What is affecting BTC right now?", question: "What is affecting BTC right now?", flow: "WHAT_HAPPENED" }, trader);
  ws.transitionResearch(research.id, "ACTIVE", trader, "run started", new Date("2026-03-12T08:00:00.000Z"));
  const evidence = ws.addEvidence(
    { observation: "BTC ETF net inflows +120M over 7d", evidenceType: "ETF flows", evidenceClass: "OBSERVATION", researchRef: research.id },
    trader,
  );
  const judgment = ws.addJudgment(
    { researchRef: research.id, statement: "BTC is bid on sustained ETF inflows", basis: { supportingEvidence: [evidence.id], opposingEvidence: [], keyClaims: [], hypotheses: [] }, confidence: "MODERATE" },
    trader,
  );
  ws.transitionResearch(research.id, "COMPLETED", trader, "run completed", new Date("2026-03-12T08:05:00.000Z"));

  const response = {
    requestId: "req-1",
    action: "RESEARCH",
    outcome: "COMPLETED",
    answer: {
      answer: "BTC is bid on sustained ETF inflows",
      supportingReasons: [],
      opposingReasons: [],
      counterevidenceStatus: "NOT_ASSESSED",
      confidence: "MODERATE",
      keyUncertainty: "",
      implication: "",
      citedObjectRefs: [evidence.id],
    },
    limitations: [],
    researchGaps: [],
    evidenceRefs: [evidence.id],
    judgmentRef: judgment.id,
    researchDiagnostics: {
      requirements: [],
      executions: [],
      floorCapabilities: [],
      recoveryRounds: 0,
      completionGates: ["EVIDENCE_SUFFICIENT"],
      completionGate: "EVIDENCE_SUFFICIENT",
      coverage: "COMPLETE",
      confidence: "MODERATE",
      questionResolution: {
        intent: "CURRENT_DRIVERS",
        temporalScope: "CURRENT",
        status: "ANSWERED",
        dimensions: [],
        unresolvedDimensions: [],
        materiality: "OBSERVED",
        evidenceCount: 1,
        relevantEvidenceCount: 1,
        staleEvidenceCount: 0,
        answerClaimCount: 0,
        claimEvidenceLinks: 0,
        actionableInsight: {
          whatEvidenceShows: ["ETF inflows are positive"],
          whatEvidenceDoesNotShow: [],
          whatItMeans: "Flows currently support the bid",
          whatWouldChangeConclusion: ["sustained outflows"],
          watchItems: ["watch funding", "watch ETF flows daily"],
        },
      },
    },
  } as unknown as ResearchResponseDTO;
  ws.saveResearchResponse(research.id, toRunRecord(response));
  return { researchId: research.id, evidenceId: evidence.id, judgmentId: judgment.id };
}

async function makeApp(seed: (ws: Workspace) => void): Promise<{ app: FastifyInstance; seeded: Seeded }> {
  const store = new MemoryStore();
  const ws = new Workspace();
  seed(ws);
  await store.save(ws.toSnapshot());
  const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
  const restored = await store.load();
  const r = restored!.listResearch()[0]!;
  const evidenceId = r.evidenceRefs[0]!;
  const judgmentId = r.judgmentRefs[0]!;
  return { app, seeded: { researchId: r.id, evidenceId, judgmentId } };
}

async function postSave(app: FastifyInstance, payload: unknown) {
  return app.inject({ method: "POST", url: "/api/saved", payload: payload as never });
}

beforeEach(() => resetIdCounters());

describe("Phase C: Saved API", () => {
  it("saves the research result and lists/opens it with explicit DTOs", async () => {
    const { app, seeded } = await makeApp(seedRun);

    const created = await postSave(app, { researchRef: seeded.researchId, kind: "RESEARCH" });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as Record<string, any>;
    expect(dto.savedId).toMatch(/^sa_/);
    expect(dto.kind).toBe("RESEARCH");
    expect(dto.researchRef).toBe(seeded.researchId);
    expect(dto.origin.question).toBe("What is affecting BTC right now?");
    expect(dto.origin.available).toBe(true);
    expect(dto.provenance.length).toBeGreaterThanOrEqual(1);
    expect(dto.snapshot.recordTier).toBe("FULL");

    const list = (await app.inject({ method: "GET", url: "/api/saved" })).json() as Record<string, any>[];
    expect(list).toHaveLength(1);
    expect(list[0]!.savedId).toBe(dto.savedId);
    // Library rows are summaries: no full content/provenance dump.
    expect(list[0]!.content).toBeUndefined();
    expect(list[0]!.provenance).toBeUndefined();

    const one = (await app.inject({ method: "GET", url: `/api/saved/${dto.savedId}` })).json() as Record<string, any>;
    expect(one.content).toBe("BTC is bid on sustained ETF inflows");
    expect(one.origin.researchRef).toBe(seeded.researchId);
    await app.close();
  });

  it("integrates every kind: research, judgment, evidence, insight, watch next", async () => {
    const { app, seeded } = await makeApp(seedRun);
    const kinds: Array<{ kind: string; sourceRef?: string }> = [
      { kind: "RESEARCH" },
      { kind: "JUDGMENT", sourceRef: seeded.judgmentId },
      { kind: "EVIDENCE", sourceRef: seeded.evidenceId },
      { kind: "INSIGHT" },
      { kind: "WATCH_NEXT", sourceRef: "watch_1" },
    ];
    for (const k of kinds) {
      const res = await postSave(app, { researchRef: seeded.researchId, kind: k.kind, ...(k.sourceRef !== undefined ? { sourceRef: k.sourceRef } : {}) });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { kind: string }).kind).toBe(k.kind);
    }
    const list = (await app.inject({ method: "GET", url: "/api/saved" })).json() as Record<string, any>[];
    expect(list.map((r) => r.kind).sort()).toEqual(["EVIDENCE", "INSIGHT", "JUDGMENT", "RESEARCH", "WATCH_NEXT"]);

    const judgment = list.find((r) => r.kind === "JUDGMENT")!;
    const full = (await app.inject({ method: "GET", url: `/api/saved/${judgment.savedId}` })).json() as Record<string, any>;
    expect(full.sourceRef).toBe(seeded.judgmentId);
    expect(full.snapshot.statement).toBe("BTC is bid on sustained ETF inflows"); // provenance preserved

    const evidence = list.find((r) => r.kind === "EVIDENCE")!;
    const fullEv = (await app.inject({ method: "GET", url: `/api/saved/${evidence.savedId}` })).json() as Record<string, any>;
    expect(fullEv.sourceRef).toBe(seeded.evidenceId); // exact evidence identity preserved
    expect(fullEv.snapshot.observation).toContain("ETF net inflows");

    const watch = list.find((r) => r.kind === "WATCH_NEXT")!;
    const fullWatch = (await app.inject({ method: "GET", url: `/api/saved/${watch.savedId}` })).json() as Record<string, any>;
    expect(fullWatch.snapshot.text).toBe("watch ETF flows daily");
    await app.close();
  });

  it("a duplicate SAVE returns the SAME saved artifact (no uncontrolled duplicates)", async () => {
    const { app, seeded } = await makeApp(seedRun);
    const first = (await postSave(app, { researchRef: seeded.researchId, kind: "RESEARCH" })).json() as Record<string, any>;
    const second = await postSave(app, { researchRef: seeded.researchId, kind: "RESEARCH" });
    expect(second.statusCode).toBe(201);
    expect((second.json() as { savedId: string }).savedId).toBe(first.savedId);
    expect(((await app.inject({ method: "GET", url: "/api/saved" })).json() as unknown[])).toHaveLength(1);
    await app.close();
  });

  it("supports kind filtering, search, sorting and pagination", async () => {
    const { app, seeded } = await makeApp(seedRun);
    await postSave(app, { researchRef: seeded.researchId, kind: "RESEARCH" });
    await postSave(app, { researchRef: seeded.researchId, kind: "JUDGMENT", sourceRef: seeded.judgmentId });
    await postSave(app, { researchRef: seeded.researchId, kind: "EVIDENCE", sourceRef: seeded.evidenceId });

    const judgments = (await app.inject({ method: "GET", url: "/api/saved?kind=JUDGMENT" })).json() as Record<string, any>[];
    expect(judgments).toHaveLength(1);
    expect(judgments[0]!.kind).toBe("JUDGMENT");

    const searched = (await app.inject({ method: "GET", url: "/api/saved?q=ETF" })).json() as Record<string, any>[];
    expect(searched.length).toBeGreaterThanOrEqual(1);
    expect(searched.every((r) => `${r.title} ${r.summary}`.toLowerCase().includes("etf"))).toBe(true);

    const all = (await app.inject({ method: "GET", url: "/api/saved" })).json() as Record<string, any>[];
    const newest = all.map((r) => r.savedId);
    expect((await app.inject({ method: "GET", url: "/api/saved?sort=recent" })).json()).toEqual(all);
    const oldest = (await app.inject({ method: "GET", url: "/api/saved?sort=oldest" })).json() as Record<string, any>[];
    expect(oldest.map((r) => r.savedId)).toEqual([...newest].reverse());

    const page = (await app.inject({ method: "GET", url: "/api/saved?limit=1&offset=1" })).json() as Record<string, any>[];
    expect(page).toHaveLength(1);
    expect(page[0]!.savedId).toBe(newest[1]);
    await app.close();
  });

  it("unsave removes only the saved artifact; the original research is untouched", async () => {
    const { app, seeded } = await makeApp(seedRun);
    const created = (await postSave(app, { researchRef: seeded.researchId, kind: "RESEARCH" })).json() as Record<string, any>;

    // History flags the run as saved.
    const historyBefore = (await app.inject({ method: "GET", url: "/api/research" })).json() as Record<string, any>[];
    expect(historyBefore[0]!.saved).toBe(true);

    const removed = await app.inject({ method: "DELETE", url: `/api/saved/${created.savedId}` });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { removed: string }).removed).toBe(created.savedId);
    expect(((await app.inject({ method: "GET", url: "/api/saved" })).json() as unknown[])).toHaveLength(0);

    // The originating research, its judgment and evidence still exist and still open.
    const opened = await app.inject({ method: "GET", url: `/api/research/${seeded.researchId}` });
    expect(opened.statusCode).toBe(200);
    const body = opened.json() as Record<string, any>;
    expect(body.summary.judgmentCount).toBeGreaterThanOrEqual(1);
    expect(body.evidence.length).toBeGreaterThanOrEqual(1);
    const judgment = await app.inject({ method: "GET", url: "/api/judgments" });
    expect((judgment.json() as unknown[]).length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("returns typed 400 for invalid params/payloads and typed 404 for unknown ids", async () => {
    const { app, seeded } = await makeApp(seedRun);

    for (const bad of ["?limit=0", "?limit=9999", "?limit=abc", "?offset=-1", "?sort=sideways", "?kind=BOGUS"]) {
      const res = await app.inject({ method: "GET", url: `/api/saved${bad}` });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    }

    expect((await postSave(app, { kind: "RESEARCH" })).statusCode).toBe(400); // missing researchRef
    expect((await postSave(app, { researchRef: seeded.researchId })).statusCode).toBe(400); // missing kind
    expect((await postSave(app, { researchRef: seeded.researchId, kind: "ORDER_BOOK" })).statusCode).toBe(400); // unknown kind
    expect((await postSave(app, { researchRef: seeded.researchId, kind: "JUDGMENT" })).statusCode).toBe(400); // missing sourceRef
    expect((await postSave(app, { researchRef: seeded.researchId, kind: "RESEARCH", tags: [1, 2] })).statusCode).toBe(400);
    expect((await postSave(app, { researchRef: "rs_999999", kind: "RESEARCH" })).statusCode).toBe(404);

    const missing = await app.inject({ method: "GET", url: "/api/saved/sa_999999" });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    expect((await app.inject({ method: "DELETE", url: "/api/saved/sa_999999" })).statusCode).toBe(404);
    await app.close();
  });

  it("two instances SAVEing the same identity converge on ONE artifact (cross-instance idempotency)", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const seeded = seedRun(ws);
    await store.save(ws.toSnapshot());
    const deps = { provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store };
    const a = await buildApi(deps);
    const b = await buildApi(deps); // loaded BEFORE either instance saved

    const first = (await postSave(a.app, { researchRef: seeded.researchId, kind: "RESEARCH" })).json() as Record<string, any>;
    const second = await postSave(b.app, { researchRef: seeded.researchId, kind: "RESEARCH" });
    expect(second.statusCode).toBe(201);
    expect((second.json() as Record<string, any>).savedId).toBe(first.savedId);
    expect(((await a.app.inject({ method: "GET", url: "/api/saved" })).json() as unknown[])).toHaveLength(1);
    await a.app.close();
    await b.app.close();
  });

  it("a warm instance sees another instance's SAVE (library read refreshes from the store)", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const seeded = seedRun(ws);
    await store.save(ws.toSnapshot());
    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });

    // ANOTHER instance SAVEs directly to the durable store after this app loaded its graph.
    const other = (await store.load())!;
    other.upsertSavedArtifact(
      { kind: "RESEARCH", researchRef: seeded.researchId, sourceRef: seeded.researchId, content: "saved elsewhere" },
      trader,
    );
    await store.save(other.toSnapshot());

    // The warm instance never saw that write; its library read must still return it.
    const list = (await app.inject({ method: "GET", url: "/api/saved" })).json() as Record<string, any>[];
    expect(list).toHaveLength(1);
    expect(list[0]!.researchRef).toBe(seeded.researchId);

    const one = await app.inject({ method: "GET", url: `/api/saved/${list[0]!.savedId}` });
    expect(one.statusCode).toBe(200);
    expect((one.json() as Record<string, any>).content).toBe("saved elsewhere");
    await app.close();
  });

  it("an UNSAVE from another instance disappears from the warm instance's library", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const seeded = seedRun(ws);
    const { artifact } = ws.upsertSavedArtifact(
      { kind: "RESEARCH", researchRef: seeded.researchId, sourceRef: seeded.researchId, content: "present" },
      trader,
    );
    await store.save(ws.toSnapshot());
    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
    expect(((await app.inject({ method: "GET", url: "/api/saved" })).json() as unknown[])).toHaveLength(1);

    const other = (await store.load())!;
    other.removeSavedArtifact(artifact.id);
    await store.save(other.toSnapshot());

    expect(((await app.inject({ method: "GET", url: "/api/saved" })).json() as unknown[])).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: `/api/saved/${artifact.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it("rejects a source object that belongs to a different run (never saves the wrong artifact)", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const a = seedRun(ws);
    const b = seedRun(ws); // second run with its own judgment/evidence
    await store.save(ws.toSnapshot());
    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });

    // A's judgment saved against B's research is a mismatch, not a silent save.
    const res = await postSave(app, { researchRef: b.researchId, kind: "JUDGMENT", sourceRef: a.judgmentId });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
