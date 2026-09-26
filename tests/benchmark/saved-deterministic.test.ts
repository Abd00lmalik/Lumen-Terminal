/**
 * BENCHMARK; Saved workspace (Phase C), SAVED-001 … SAVED-010.
 *
 * Deterministic: real domain + real API + real persistence layer with an in-memory blob, real
 * LUI pipeline with a scripted model. No network, no credentials.
 *
 * The product law under test: HISTORY is everything Lumen researched; SAVED is exactly what the
 * trader chose to keep, with durable provenance, idempotent SAVE, and honest failure semantics.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { toRunRecord } from "../../src/api/research-app.js";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore, type WorkspaceStore } from "../../src/persistence/index.js";
import { VercelBlobStore } from "../../src/persistence/vercel-edge.js";
import { FakeBlob } from "../persistence/fake-blob.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import type { FastifyInstance } from "fastify";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";
import type { ResearchResponseDTO } from "../../src/api/dto.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "benchmark" };

interface Seeded {
  readonly researchId: string;
  readonly evidenceId: string;
  readonly judgmentId: string;
}

function seedRun(ws: Workspace): Seeded {
  const research = ws.addResearch({ objective: "What is affecting BTC right now?", question: "What is affecting BTC right now?", flow: "WHAT_HAPPENED" }, trader);
  const evidence = ws.addEvidence({ observation: "BTC ETF net inflows +120M over 7d", evidenceType: "ETF flows", evidenceClass: "OBSERVATION", researchRef: research.id }, trader);
  const judgment = ws.addJudgment({ researchRef: research.id, statement: "BTC is bid on sustained ETF inflows", basis: { supportingEvidence: [evidence.id], opposingEvidence: [], keyClaims: [], hypotheses: [] }, confidence: "MODERATE" }, trader);
  ws.saveResearchResponse(research.id, toRunRecord({
    requestId: "r", action: "RESEARCH", outcome: "COMPLETED",
    answer: { answer: "BTC is bid on sustained ETF inflows", supportingReasons: [], opposingReasons: [], counterevidenceStatus: "NOT_ASSESSED", confidence: "MODERATE", keyUncertainty: "", implication: "", citedObjectRefs: [evidence.id] },
    limitations: [], researchGaps: [], evidenceRefs: [evidence.id], judgmentRef: judgment.id,
    researchDiagnostics: {
      requirements: [], executions: [], floorCapabilities: [], recoveryRounds: 0, completionGates: [], completionGate: "EVIDENCE_SUFFICIENT", coverage: "COMPLETE",
      questionResolution: {
        intent: "CURRENT_DRIVERS", temporalScope: "CURRENT", status: "ANSWERED", dimensions: [], unresolvedDimensions: [], materiality: "OBSERVED",
        evidenceCount: 1, relevantEvidenceCount: 1, staleEvidenceCount: 0, answerClaimCount: 0, claimEvidenceLinks: 0,
        actionableInsight: { whatEvidenceShows: ["inflows positive"], whatEvidenceDoesNotShow: [], whatItMeans: "flows support the bid", whatWouldChangeConclusion: [], watchItems: ["watch funding", "watch ETF flows daily"] },
      },
    },
  } as unknown as ResearchResponseDTO));
  return { researchId: research.id, evidenceId: evidence.id, judgmentId: judgment.id };
}

async function makeApp(store: WorkspaceStore, seed?: (ws: Workspace) => void): Promise<{ app: FastifyInstance; seeded: Seeded }> {
  if (seed !== undefined) {
    const ws = new Workspace();
    seed(ws);
    await store.save(ws.toSnapshot());
  }
  const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
  const loaded = await store.load();
  const r = loaded!.listResearch()[0]!;
  return { app, seeded: { researchId: r.id, evidenceId: r.evidenceRefs[0]!, judgmentId: r.judgmentRefs[0]! } };
}

const save = (app: FastifyInstance, payload: unknown) => app.inject({ method: "POST", url: "/api/saved", payload: payload as never });
const list = async (app: FastifyInstance) => (await app.inject({ method: "GET", url: "/api/saved" })).json() as Record<string, any>[];
const open = (app: FastifyInstance, id: string) => app.inject({ method: "GET", url: `/api/saved/${id}` });

beforeEach(() => resetIdCounters());

describe("BENCH SAVED-001: research → save → saved → open → original research", () => {
  it("saves a run, opens it from Saved, and still opens the original research", async () => {
    const { app, seeded } = await makeApp(new MemoryStore(), seedRun);
    const created = (await save(app, { researchRef: seeded.researchId, kind: "RESEARCH" })).json() as Record<string, any>;
    const rows = await list(app);
    expect(rows).toHaveLength(1);
    const full = (await open(app, rows[0]!.savedId)).json() as Record<string, any>;
    expect(full.content).toBe("BTC is bid on sustained ETF inflows");
    const original = await app.inject({ method: "GET", url: `/api/research/${seeded.researchId}` });
    expect(original.statusCode).toBe(200);
    expect((original.json() as { researchRef: string }).researchRef).toBe(seeded.researchId);
    expect(created.savedId).toBe(rows[0]!.savedId);
    await app.close();
  });
});

describe("BENCH SAVED-002: save judgment → verify provenance", () => {
  it("keeps the exact originating judgment ref and its statement", async () => {
    const { app, seeded } = await makeApp(new MemoryStore(), seedRun);
    await save(app, { researchRef: seeded.researchId, kind: "JUDGMENT", sourceRef: seeded.judgmentId });
    const rows = await list(app);
    const full = (await open(app, rows[0]!.savedId)).json() as Record<string, any>;
    expect(full.kind).toBe("JUDGMENT");
    expect(full.sourceRef).toBe(seeded.judgmentId);
    expect(full.snapshot.statement).toContain("ETF inflows");
    expect(full.origin.researchRef).toBe(seeded.researchId);
    await app.close();
  });
});

describe("BENCH SAVED-003: save evidence → verify evidence identity", () => {
  it("keeps the exact originating evidence ref and observation", async () => {
    const { app, seeded } = await makeApp(new MemoryStore(), seedRun);
    await save(app, { researchRef: seeded.researchId, kind: "EVIDENCE", sourceRef: seeded.evidenceId });
    const rows = await list(app);
    const full = (await open(app, rows[0]!.savedId)).json() as Record<string, any>;
    expect(full.sourceRef).toBe(seeded.evidenceId);
    expect(full.snapshot.observation).toContain("ETF net inflows");
    await app.close();
  });
});

describe("BENCH SAVED-004: duplicate SAVE → exactly one artifact", () => {
  it("saving twice yields one artifact with the same id", async () => {
    const { app, seeded } = await makeApp(new MemoryStore(), seedRun);
    const first = (await save(app, { researchRef: seeded.researchId, kind: "RESEARCH" })).json() as Record<string, any>;
    const second = (await save(app, { researchRef: seeded.researchId, kind: "RESEARCH" })).json() as Record<string, any>;
    expect(second.savedId).toBe(first.savedId);
    expect(await list(app)).toHaveLength(1);
    await app.close();
  });
});

describe("BENCH SAVED-005: unsave → original research remains", () => {
  it("removes only the saved artifact", async () => {
    const { app, seeded } = await makeApp(new MemoryStore(), seedRun);
    const created = (await save(app, { researchRef: seeded.researchId, kind: "JUDGMENT", sourceRef: seeded.judgmentId })).json() as Record<string, any>;
    await app.inject({ method: "DELETE", url: `/api/saved/${created.savedId}` });
    expect(await list(app)).toHaveLength(0);
    const opened = await app.inject({ method: "GET", url: `/api/research/${seeded.researchId}` });
    expect(opened.statusCode).toBe(200);
    expect((opened.json() as Record<string, any>).summary.judgmentCount).toBeGreaterThanOrEqual(1);
    await app.close();
  });
});

describe("BENCH SAVED-006: persistence survives cold start", () => {
  it("a fresh store instance over the same blob still has the artifact", async () => {
    const blob = new FakeBlob();
    const first = new VercelBlobStore(blob.client());
    const { app, seeded } = await makeApp(first, seedRun);
    await save(app, { researchRef: seeded.researchId, kind: "RESEARCH" });
    await app.close();

    const cold = new VercelBlobStore(blob.client());
    const restored = await cold.load();
    expect(restored!.listSavedArtifacts()).toHaveLength(1);
    expect(restored!.listSavedArtifacts()[0]!.content).toContain("ETF inflows");
  });
});

describe("BENCH SAVED-007: concurrent research/save does not erase unrelated saved artifacts", () => {
  it("a stale instance's write unions rather than erases", async () => {
    const a = new Workspace();
    const seedA = seedRun(a);
    a.upsertSavedArtifact({ kind: "RESEARCH", researchRef: seedA.researchId, sourceRef: seedA.researchId, content: "A artifact" }, trader);
    // Spacer keeps the two instances' ids disjoint.
    seedRun(new Workspace());
    const b = new Workspace();
    const seedB = seedRun(b);
    b.upsertSavedArtifact({ kind: "RESEARCH", researchRef: seedB.researchId, sourceRef: seedB.researchId, content: "B artifact" }, trader);

    const merged = mergeSnapshots(a.toSnapshot(), b.toSnapshot());
    expect(merged.savedArtifacts.map((s) => s.content).sort()).toEqual(["A artifact", "B artifact"]);
  });
});

describe("BENCH SAVED-008: persistence failure does not produce a false Saved", () => {
  it("a failing write surfaces as PERSISTENCE_FAILURE and the library is unchanged", async () => {
    const inner = new MemoryStore();
    const seeded = new Workspace();
    seedRun(seeded);
    await inner.save(seeded.toSnapshot());
    const failing: WorkspaceStore = {
      load: () => inner.load(),
      save: async () => { throw new Error("blob write failed"); },
    };
    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store: failing });
    const researchRef = (await inner.load())!.listResearch()[0]!.id;
    const res = await save(app, { researchRef, kind: "RESEARCH" });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: { code: string } }).error.code).toBe("PERSISTENCE_FAILURE");
    expect(await list(app)).toHaveLength(0); // persisted state holds no artifact
    await app.close();
  });
});

describe("BENCH SAVED-009: legacy workspace without a saved collection remains valid", () => {
  it("loads with an empty Saved library", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    ws.addResearch({ objective: "legacy", question: "legacy", flow: "WHAT_HAPPENED" }, trader);
    const snapshot = ws.toSnapshot() as Record<string, unknown>;
    delete snapshot.savedArtifacts;
    await store.save(snapshot as never);
    const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
    expect(await list(app)).toEqual([]);
    await app.close();
  });
});

describe("BENCH SAVED-010: natural-language \"Save this\" resolves the current active research", () => {
  it("creates a research-anchored artifact through the LUI pipeline", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.save_proposal", JSON.stringify({ artifactType: "research-conclusion", kind: "RESEARCH", content: "BTC is bid on ETF inflows", derivedFromRefs: [], rationale: "keep" })],
    ]));
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "SAVE", objective: "save this" }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "" }));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence("CONSEQUENTIAL", true));
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "SAVE", description: "save this", capabilities: [], params: {} }]));
    const workspace = new Workspace();
    const researchId = seedRun(workspace).researchId;
    const lui = new Lui({ provider, workspace, store: newStore(), registry: new CapabilityRegistry(), now: () => new Date("2026-03-12T10:00:00.000Z") });
    const result = await lui.handle("Save this research", { kind: "trader", detail: "trader confirmed SAVE" });
    expect(result.saved).toBeDefined();
    expect(result.saved!.researchRef).toBe(researchId);
    expect(workspace.listSavedArtifacts()).toHaveLength(1);
  });
});
