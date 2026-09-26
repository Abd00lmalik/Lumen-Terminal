/**
 * Phase D: SAVED-RUN-001..007. Server-side filtering of the Saved library by originating run.
 *
 * The point: "what did I save from this research?" is answered by the BACKEND, using the
 * artifact's existing `researchRef` identity field (no second relationship field), so the
 * client never fetches the whole library to filter it and no cross-run leakage is possible.
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

async function makeApp(): Promise<{ app: FastifyInstance; runA: string; runB: string; evA: string }> {
  const store = new MemoryStore();
  const ws = new Workspace();
  const runA = seedRun(ws, "A: AAPL earnings");
  const runB = seedRun(ws, "B: BTC dominance");
  const evA = ws.getResearch(runA)?.evidenceRefs[0] ?? "";
  await store.save(ws.toSnapshot());
  const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
  return { app, runA, runB, evA };
}

const listSaved = async (app: FastifyInstance, query: string) =>
  (await app.inject({ method: "GET", url: `/api/saved${query}` })).json() as Record<string, any>[];
const save = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/saved", payload: payload as never });

beforeEach(() => resetIdCounters());

describe("SAVED-RUN: filter Saved by originating research run", () => {
  it("SAVED-RUN-001: GET /api/saved?researchRef=rs_A returns only rs_A", async () => {
    const { app, runA, runB } = await makeApp();
    await save(app, { researchRef: runA, kind: "RESEARCH" });
    await save(app, { researchRef: runB, kind: "RESEARCH" });
    const rows = await listSaved(app, `?researchRef=${runA}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.researchRef).toBe(runA);
    await app.close();
  });

  it("SAVED-RUN-002: GET /api/saved?researchRef=rs_B never returns rs_A", async () => {
    const { app, runA, runB } = await makeApp();
    await save(app, { researchRef: runA, kind: "RESEARCH" });
    await save(app, { researchRef: runB, kind: "RESEARCH" });
    const rows = await listSaved(app, `?researchRef=${runB}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.researchRef).toBe(runB);
    expect(rows.some((r) => r.researchRef === runA)).toBe(false);
    await app.close();
  });

  it("SAVED-RUN-003: researchRef + kind + q + pagination compose correctly", async () => {
    const { app, runA, evA } = await makeApp();
    await save(app, { researchRef: runA, kind: "RESEARCH" });
    await save(app, { researchRef: runA, kind: "EVIDENCE", sourceRef: evA });

    const evidenceOnly = await listSaved(app, `?researchRef=${runA}&kind=EVIDENCE`);
    expect(evidenceOnly).toHaveLength(1);
    expect(evidenceOnly[0]!.kind).toBe("EVIDENCE");
    expect(evidenceOnly[0]!.researchRef).toBe(runA);

    const searched = await listSaved(app, `?researchRef=${runA}&q=observation`);
    expect(searched.length).toBeGreaterThanOrEqual(1);
    expect(searched.every((r) => r.researchRef === runA)).toBe(true);

    const page = await listSaved(app, `?researchRef=${runA}&limit=1&offset=1`);
    expect(page).toHaveLength(1);
    expect(page[0]!.researchRef).toBe(runA);
    await app.close();
  });

  it("SAVED-RUN-005: an opened saved artifact preserves its exact researchRef", async () => {
    const { app, runA } = await makeApp();
    const created = (await save(app, { researchRef: runA, kind: "RESEARCH" })).json() as Record<string, any>;
    const one = (await app.inject({ method: "GET", url: `/api/saved/${created.savedId}` })).json() as Record<string, any>;
    expect(one.researchRef).toBe(runA);
    expect(one.origin.researchRef).toBe(runA);
    await app.close();
  });

  it("SAVED-RUN-006: unsave removes the artifact from the run-filtered view", async () => {
    const { app, runA } = await makeApp();
    const created = (await save(app, { researchRef: runA, kind: "RESEARCH" })).json() as Record<string, any>;
    expect(await listSaved(app, `?researchRef=${runA}`)).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/api/saved/${created.savedId}` });
    expect(await listSaved(app, `?researchRef=${runA}`)).toHaveLength(0);
    await app.close();
  });

  it("SAVED-RUN-007: an unsave from another instance does not resurrect in the filtered view", async () => {
    const { app, runA } = await makeApp();
    const created = (await save(app, { researchRef: runA, kind: "RESEARCH" })).json() as Record<string, any>;
    // A second instance unsaves through the same durable store.
    const other = (await app.inject({ method: "GET", url: `/api/saved?researchRef=${runA}` })).json() as Record<string, any>[];
    expect(other).toHaveLength(1);
    await app.inject({ method: "DELETE", url: `/api/saved/${created.savedId}` });
    expect(await listSaved(app, `?researchRef=${runA}`)).toHaveLength(0);
    expect(await listSaved(app, "?researchRef=rs_999999")).toHaveLength(0); // unknown ref = honest empty
    await app.close();
  });

  it("a malformed researchRef is a typed 400 (transport error), never a silent empty page", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/saved?researchRef=not-a-ref" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    await app.close();
  });
});
