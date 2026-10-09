/**
 * Execution/monitor READ FRESHNESS over the HTTP layer (remediation D4/D5/D7 + D9).
 *
 * A warm instance loads its graph ONCE; another instance's completed runs and monitor
 * checks land only in the store. The fresh read paths absorb before serving, so:
 * - D7: a run completed elsewhere OPENS (200) instead of 404ing (the Save path's target);
 * - D5: CURRENT (isCurrent) follows the newest COMPLETED run by timestamp, not load order;
 * - D9: the monitor list carries the other instance's check timestamps (attempted ≠ completed).
 *
 * The pre-fix behavior: `GET /api/research/:ref` resolved against the warm graph only
 * (404 for runs completed elsewhere) and `GET /api/monitors` served monitor execution
 * state captured at load time (stale lastCheckedAt forever).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { toRunRecord } from "../../src/api/research-app.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { FakeModelProvider } from "../model/fakes.js";
import type { FastifyInstance } from "fastify";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";
import type { ResearchResponseDTO } from "../../src/api/dto.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };
const T0 = new Date("2026-03-01T08:00:00.000Z");

beforeEach(() => resetIdCounters());

async function warmApp(store: MemoryStore): Promise<FastifyInstance> {
  const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: new CapabilityRegistry(), store });
  return app;
}

/** A completed run with evidence + judgment (the Save target shape). */
function completedRun(ws: Workspace, question: string, completedAt: Date): string {
  const r = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, trader, T0);
  ws.transitionResearch(r.id, "ACTIVE", trader, "run started", T0);
  const ev = ws.addEvidence(
    { observation: `${question}: observed`, evidenceType: "market", evidenceClass: "OBSERVATION", researchRef: r.id },
    trader,
  );
  ws.addJudgment(
    {
      researchRef: r.id,
      statement: `${question} → judged`,
      basis: { supportingEvidence: [ev.id], opposingEvidence: [], keyClaims: [], hypotheses: [] },
      confidence: "MODERATE",
    },
    trader,
  );
  ws.transitionResearch(r.id, "COMPLETED", trader, "run completed", completedAt);
  return r.id;
}

describe("fresh aggregate read (D7/D5): GET /api/research/:ref", () => {
  it("opens a run completed on ANOTHER instance after this app loaded (was 404)", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const olderId = completedRun(ws, "What happened to BTC?", new Date("2026-03-01T08:05:00.000Z"));
    await store.save(ws.toSnapshot());
    const app = await warmApp(store); // loads BEFORE the second run exists

    // Another instance completes a NEWER run and persists it.
    const other = (await store.load())!;
    const newerId = completedRun(other, "What happened to ETH?", new Date("2026-03-12T08:05:00.000Z"));
    await store.save(other.toSnapshot());

    // D7: the aggregate resolves (200) — its evidence/judgment ride the absorption too.
    const newer = await app.inject({ method: "GET", url: `/api/research/${newerId}` });
    expect(newer.statusCode).toBe(200);
    const body = newer.json() as Record<string, unknown>;
    expect(body.researchRef).toBe(newerId);
    expect(body.isCurrent).toBe(true); // D5: newest COMPLETED run owns CURRENT

    // D5: the older run stays openable but is no longer CURRENT.
    const older = await app.inject({ method: "GET", url: `/api/research/${olderId}` });
    expect(older.statusCode).toBe(200);
    expect((older.json() as Record<string, unknown>).isCurrent).toBe(false);

    await app.close();
  });

  it("a transient store read failure degrades to the local graph (reads never fail for freshness)", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const id = completedRun(ws, "What happened to BTC?", new Date("2026-03-01T08:05:00.000Z"));
    await store.save(ws.toSnapshot());
    const app = await warmApp(store);

    const res = await app.inject({ method: "GET", url: `/api/research/${id}` });
    expect(res.statusCode).toBe(200); // served from the warm graph

    const missing = await app.inject({ method: "GET", url: "/api/research/rs_999999" });
    expect(missing.statusCode).toBe(404); // honest NOT_FOUND, not a freshness artifact
    await app.close();
  });
});

/** A minimal valid retained run record whose outcome is the record's own verdict. */
function recordWithOutcome(researchRef: string, outcome: ResearchResponseDTO["outcome"]): ResearchResponseDTO {
  return {
    requestId: `req-${researchRef}`,
    action: "RESEARCH",
    outcome,
    answer: {
      answer: "recorded verdict",
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

describe("fresh history list (R1): GET /api/research", () => {
  it("absorbs the other instance's run record, so the row carries the record's OUTCOME beside its FAILED lifecycle status", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const question = "What happened to BTC?";
    const r = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, trader, T0);
    ws.transitionResearch(r.id, "ACTIVE", trader, "run started", T0);
    // The production symptom's lifecycle half: the run ended FAILED on this instance.
    ws.transitionResearch(r.id, "FAILED", trader, "run could not complete", T0);
    await store.save(ws.toSnapshot());
    const app = await warmApp(store); // loads with NO retained record for this run

    type Row = { ref: string; status: string; outcome?: string; degraded?: boolean };
    const list = async (): Promise<Row[]> => (await app.inject({ method: "GET", url: "/api/research" })).json() as Row[];

    // Warm read: no record here → no outcome, honest degraded flag, lifecycle status only.
    const beforeRow = (await list()).find((row) => row.ref === r.id)!;
    expect(beforeRow.status).toBe("FAILED");
    expect(beforeRow.outcome).toBeUndefined();
    expect(beforeRow.degraded).toBe(true);

    // Another instance retains the REAL record for the SAME run — its own outcome: INSUFFICIENT.
    const other = (await store.load())!;
    other.saveResearchResponse(r.id, toRunRecord(recordWithOutcome(r.id, "INSUFFICIENT")));
    await store.save(other.toSnapshot());

    // Absorb-then-list: the row now speaks the record's vocabulary — FAILED (lifecycle,
    // untouched) beside INSUFFICIENT (the record), no degraded flag. Before the fix the warm
    // instance served the first read forever: History said FAILED, the opened run said
    // INSUFFICIENT, for one and the same record.
    const row = (await list()).find((entry) => entry.ref === r.id)!;
    expect(row.outcome).toBe("INSUFFICIENT");
    expect(row.status).toBe("FAILED");
    expect(row.degraded).toBeUndefined();

    await app.close();
  });
});

describe("fresh monitor read (D9): GET /api/monitors", () => {
  it("carries another instance's check timestamps — attempted ≠ completed", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    const thesis = ws.addThesis({ statement: "BTC strength rests on liquidity", objective: "test" }, trader);
    const monitor = ws.addExecutableMonitorProposal(
      {
        target: "BTC liquidity",
        conditions: [{
          description: "liquidity conditions deteriorate while institutional demand fails to offset",
          kind: "INVALIDATION" as const,
          triggerType: "CONTRADICTION" as const,
          conditionStatus: "DERIVED_FROM_THESIS" as const,
          rationale: "challenge-derived",
          evidenceDependencies: [],
        }],
        triggerRationale: "test",
        thesisRef: thesis.id,
        thesisVersion: 1,
        cadence: "MANUAL" as const,
      },
      trader,
    );
    ws.activateMonitor(monitor.id, trader, "explicit activation");
    await store.save(ws.toSnapshot());
    const app = await warmApp(store); // loaded BEFORE the check ran anywhere

    // Another instance runs a check: attempt stamped first, completion second. The
    // timestamps are AFTER activation so the remote monitor record is the newer side of
    // the merge (activation ran at wall-clock now).
    const other = (await store.load())!;
    const checkedAt = new Date(Date.now() + 60_000);
    const attemptedAt = new Date(checkedAt.getTime() - 5_000);
    other.recordMonitorCheck(
      monitor.id,
      { lastAttemptedCheckAt: attemptedAt.toISOString(), lastCheckedAt: checkedAt.toISOString() },
      trader,
      "check done",
      checkedAt,
    );
    await store.save(other.toSnapshot());

    const res = await app.inject({ method: "GET", url: "/api/monitors" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { active: Array<{ ref: string; lastCheckedAt?: string; lastAttemptedCheckAt?: string }> };
    const row = body.active.find((m) => m.ref === monitor.id);
    expect(row).toBeDefined();
    expect(row!.lastCheckedAt).toBe(checkedAt.toISOString());
    expect(row!.lastAttemptedCheckAt).toBe(attemptedAt.toISOString());

    await app.close();
  });
});
