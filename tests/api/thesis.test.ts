/**
 * Phase D: the Thesis API. A thesis is trader-owned; creation is explicit and may derive its
 * statement VERBATIM from a research run or a saved artifact; updates are explicit trader edits;
 * lifecycle moves are deterministic; linked Saved artifacts never duplicate or corrupt the thesis.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { FakeModelProvider } from "../model/fakes.js";
import type { FastifyInstance } from "fastify";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

function seedRun(ws: Workspace, question: string): string {
  const r = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, trader);
  ws.transitionResearch(r.id, "ACTIVE", trader, "run started");
  ws.addEvidence({ observation: `${question} observation`, evidenceType: "OBS", evidenceClass: "OBSERVATION", researchRef: r.id }, trader);
  ws.addJudgment({ researchRef: r.id, statement: `${question} judgment`, basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] }, confidence: "MODERATE" }, trader);
  ws.transitionResearch(r.id, "COMPLETED", trader, "done");
  return r.id;
}

async function makeApp(): Promise<{ app: FastifyInstance; run: string; ev: string }> {
  const store = new MemoryStore();
  const ws = new Workspace();
  const run = seedRun(ws, "BTC holds above support this quarter");
  const ev = ws.getResearch(run)?.evidenceRefs[0] ?? "";
  await store.save(ws.toSnapshot());
  const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
  return { app, run, ev };
}

const post = (app: FastifyInstance, url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as never });

beforeEach(() => resetIdCounters());

describe("Phase D: Thesis API", () => {
  it("creates a thesis from natural language, lists it, opens it, updates it explicitly", async () => {
    const { app } = await makeApp();
    const created = await post(app, "/api/thesis", { statement: "Gold rises with real yields falling", asset: "GC=F" });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as Record<string, any>;
    expect(dto.ref).toMatch(/^th_/);
    expect(dto.statement).toBe("Gold rises with real yields falling");
    expect(dto.asset).toBe("GC=F");
    expect(dto.status).toBe("ACTIVE");
    expect(dto.userConfirmed).toBe(true);

    const list = (await app.inject({ method: "GET", url: "/api/thesis" })).json() as Record<string, any>[];
    expect(list).toHaveLength(1);
    expect(list[0]!.ref).toBe(dto.ref);

    const one = (await app.inject({ method: "GET", url: `/api/thesis/${dto.ref}` })).json() as Record<string, any>;
    expect(one.linkedResearch).toEqual([]);
    expect(one.linkedSaved).toEqual([]);

    const patch = await app.inject({ method: "PATCH", url: `/api/thesis/${dto.ref}`, payload: { statement: "Gold rises as real yields fall", materialConditions: ["real yields below 2%"] } });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as Record<string, any>).version).toBe(2);
    expect((patch.json() as Record<string, any>).materialConditions).toEqual(["real yields below 2%"]);
    await app.close();
  });

  it("creates a thesis FROM research, deriving the statement from the run and linking the run", async () => {
    const { app, run } = await makeApp();
    const created = await post(app, "/api/thesis", { researchRef: run });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as Record<string, any>;
    expect(dto.linkedResearchRefs).toContain(run);
    expect(dto.statement.length).toBeGreaterThan(0);
    expect(dto.statement).not.toBe(""); // derived verbatim; never fabricated empty
    expect(dto.linkedResearch[0].available).toBe(true);
    expect(dto.linkedResearch[0].researchRef).toBe(run);
    await app.close();
  });

  it("creates a thesis FROM a Saved artifact and keeps the Saved link by reference", async () => {
    const { app, run } = await makeApp();
    const saved = (await post(app, "/api/saved", { researchRef: run, kind: "RESEARCH" })).json() as Record<string, any>;
    const created = await post(app, "/api/thesis", { savedId: saved.savedId });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as Record<string, any>;
    expect(dto.linkedSavedIds).toContain(saved.savedId);
    expect(dto.linkedSaved[0].available).toBe(true);
    expect(dto.linkedResearchRefs).toContain(run);
    await app.close();
  });

  it("links and unlinks an existing Saved artifact; an unsaved link stays visible as unavailable (thesis intact)", async () => {
    const { app, run } = await makeApp();
    const thesis = (await post(app, "/api/thesis", { statement: "BTC holds", researchRef: run })).json() as Record<string, any>;
    const saved = (await post(app, "/api/saved", { researchRef: run, kind: "RESEARCH" })).json() as Record<string, any>;

    const linked = (await post(app, `/api/thesis/${thesis.ref}/link-saved`, { savedId: saved.savedId })).json() as Record<string, any>;
    expect(linked.linkedSavedIds).toContain(saved.savedId);

    // Unsave the artifact: the thesis must NOT be corrupted or deleted; the link is reported unavailable.
    await app.inject({ method: "DELETE", url: `/api/saved/${saved.savedId}` });
    const after = (await app.inject({ method: "GET", url: `/api/thesis/${thesis.ref}` })).json() as Record<string, any>;
    expect(after.status).toBe("ACTIVE");
    expect(after.linkedSavedIds).toContain(saved.savedId);
    expect(after.linkedSaved[0].available).toBe(false);
    await app.close();
  });

  it("applies deterministic lifecycle transitions and rejects invalid ones (400)", async () => {
    const { app } = await makeApp();
    const t = (await post(app, "/api/thesis", { statement: "s" })).json() as Record<string, any>;
    expect(t.allowedTransitions).toContain("ARCHIVED");

    const paused = await post(app, `/api/thesis/${t.ref}/status`, { status: "PAUSED" });
    expect(paused.statusCode).toBe(200);
    expect((paused.json() as Record<string, any>).status).toBe("PAUSED");

    // PAUSED → CONFIRMED is not an allowed transition.
    const bad = await post(app, `/api/thesis/${t.ref}/status`, { status: "CONFIRMED" });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as Record<string, any>).error.code).toBe("INVALID_REQUEST");

    // Unknown status is a typed 400.
    expect((await post(app, `/api/thesis/${t.ref}/status`, { status: "SIDEWAYS" })).statusCode).toBe(400);
    await app.close();
  });

  it("archives (soft delete) a thesis; it remains listed, never hard-deleted", async () => {
    const { app } = await makeApp();
    const t = (await post(app, "/api/thesis", { statement: "s" })).json() as Record<string, any>;
    const del = await app.inject({ method: "DELETE", url: `/api/thesis/${t.ref}` });
    expect(del.statusCode).toBe(200);
    expect((del.json() as Record<string, any>).archived).toBe(t.ref);
    const one = (await app.inject({ method: "GET", url: `/api/thesis/${t.ref}` })).json() as Record<string, any>;
    expect(one.status).toBe("ARCHIVED");
    await app.close();
  });

  it("supports status and search filters, typed 400s and typed 404s", async () => {
    const { app } = await makeApp();
    await post(app, "/api/thesis", { statement: "The dollar weakens this year", asset: "DX-Y.NYB" });
    await post(app, "/api/thesis", { statement: "Oil stays range-bound", asset: "CL=F" });

    const oil = (await app.inject({ method: "GET", url: "/api/thesis?q=oil" })).json() as Record<string, any>[];
    expect(oil).toHaveLength(1);
    expect(oil[0]!.statement).toContain("Oil");

    const activeOnly = (await app.inject({ method: "GET", url: "/api/thesis?status=ACTIVE" })).json() as Record<string, any>[];
    expect(activeOnly).toHaveLength(2);
    expect(((await app.inject({ method: "GET", url: "/api/thesis?status=ARCHIVED" })).json() as unknown[])).toHaveLength(0);

    expect((await post(app, "/api/thesis", {})).statusCode).toBe(400); // no statement and no source
    expect((await post(app, "/api/thesis", { researchRef: "rs_999999" })).statusCode).toBe(404);
    expect((await post(app, "/api/thesis", { savedId: "sa_999999" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/thesis/th_999999" })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: "/api/thesis/th_999999", payload: { statement: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/api/thesis/${(await post(app, "/api/thesis", { statement: "z" })).json().ref}`, payload: {} })).statusCode).toBe(400);
    await app.close();
  });
});
