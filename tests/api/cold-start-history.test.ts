/**
 * Phase B acceptance (B6): "ChatGPT-style history survives process restart."
 *
 * Scenario, run over BOTH persistence paths (file-backed dev/prod-like store, and the
 * production Vercel Blob store driven through its injectable client):
 *
 *   1. create research runs (more than one)
 *   2. capture their aggregates from the FIRST process
 *   3. destroy the process (new app instance; empty in-memory archive + fresh workspace load)
 *   4. reload the workspace from persistence
 *   5. open every run again
 *   6. assert the SAME researchRef, question, judgment, question resolution, actionable
 *      insight, confidence, evidence, provenance and timestamps
 *
 * The second process is given a model provider with NO scripted responses: reopening history
 * must never require re-running research or calling the model.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FileStore, type WorkspaceStore } from "../../src/persistence/index.js";
import { VercelBlobStore } from "../../src/persistence/vercel-edge.js";
import { FakeBlob } from "../persistence/fake-blob.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

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

/** Full LUI + research scripting, so a POST reaches a COMPLETED run with an answer. */
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

/** A cold process: fresh app, EMPTY model scripts, store reloaded from persistence. */
async function coldApp(store: WorkspaceStore): Promise<FastifyInstance> {
  const { app } = await buildApi({ provider: new FakeModelProvider(new Map()), registry: registryWith("NEWS_ANALYSIS"), store });
  return app;
}

type Aggregate = Record<string, any>;

async function aggregateOf(app: FastifyInstance, ref: string): Promise<Aggregate> {
  const res = await app.inject({ method: "GET", url: `/api/research/${ref}` });
  expect(res.statusCode).toBe(200);
  return res.json() as Aggregate;
}

/**
 * The fields that must survive a restart verbatim. The reopened run is compared to the
 * FIRST process's aggregate, not to a fresh expectation — so this proves persistence rather
 * than re-deriving the answer.
 */
function expectSameRun(before: Aggregate, after: Aggregate): void {
  expect(after.researchRef).toBe(before.researchRef);
  expect(after.ref).toBe(before.ref);
  expect(after.question).toBe(before.question);
  expect(after.status).toBe(before.status);
  expect(after.createdAt).toBe(before.createdAt);
  expect(after.updatedAt).toBe(before.updatedAt);
  expect(after.answer).toEqual(before.answer);
  // Evidence was NOT duplicated into the stored record: it is rehydrated from the graph by
  // ref, so equality here proves the dedupe policy loses nothing.
  expect(after.evidence).toEqual(before.evidence);
  expect(after.evidenceRefs).toEqual(before.evidenceRefs);
  expect(after.judgments).toEqual(before.judgments);
  expect(after.judgmentRef).toBe(before.judgmentRef);
  expect(after.confidence).toBe(before.confidence);
  expect(after.questionResolution).toEqual(before.questionResolution);
  expect(after.actionableInsight).toEqual(before.actionableInsight);
  expect(after.watchNext).toEqual(before.watchNext);
  expect(after.stoppedBecause).toBe(before.stoppedBecause);
  expect(after.researchGaps).toEqual(before.researchGaps);
  expect(after.limitations).toEqual(before.limitations);
  expect(after.researchDiagnostics).toEqual(before.researchDiagnostics);
  expect(after.provenance).toEqual(before.provenance);
  expect(after.summary).toEqual(before.summary);
  expect(after.saved).toBe(before.saved);
  expect(after.recordTier).toBe("FULL");
  expect(after.degraded).toBe(false);
}

const QUESTIONS = [
  "What is affecting BTC right now?",
  "Why did oil move this week?",
  "Is gold breaking out?",
];

beforeEach(() => resetIdCounters());

describe("Phase B cold start: history survives a process restart (file store)", () => {
  it("reopens every run with identical content after the process is gone", { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "phase-b-cold-"));
    const filePath = join(dir, "workspace.json");

    // ---- process 1: create runs, capture their aggregates ----
    const first = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store: new FileStore(filePath) });
    const refs: string[] = [];
    for (const question of QUESTIONS) {
      const res = await first.app.inject({ method: "POST", url: "/api/research", payload: { message: question } });
      expect(res.statusCode).toBe(200);
      refs.push(String((res.json() as { researchRef: string }).researchRef));
    }
    const before = new Map<string, Aggregate>();
    for (const ref of refs) before.set(ref, await aggregateOf(first.app, ref));
    // The first process needs no further work; its in-memory state dies here.
    await first.app.close();

    // ---- process 2 (cold): everything must come from persistence ----
    const second = await coldApp(new FileStore(filePath));
    const history = (await second.inject({ method: "GET", url: "/api/research" })).json() as { ref: string }[];
    expect(history.length).toBe(QUESTIONS.length);
    expect(new Set(history.map((h) => h.ref))).toEqual(new Set(refs));

    // Reopen the OLDEST run last, to prove no later run overwrote it.
    for (const ref of [...refs].reverse()) {
      expectSameRun(before.get(ref)!, await aggregateOf(second, ref));
    }
    await second.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("Phase B cold start: history survives a process restart (Vercel Blob, production path)", () => {
  it("serves the retained run with no in-memory archive behind it", { timeout: 60_000 }, async () => {
    const blob = new FakeBlob();

    // ---- process 1: a real instance writing through the production store ----
    const first = await buildApi({
      provider: scriptedProvider(),
      registry: registryWith("NEWS_ANALYSIS"),
      store: new VercelBlobStore(blob.client()),
    });
    const refs: string[] = [];
    for (const question of QUESTIONS) {
      const res = await first.app.inject({ method: "POST", url: "/api/research", payload: { message: question } });
      expect(res.statusCode).toBe(200);
      refs.push(String((res.json() as { researchRef: string }).researchRef));
    }
    const before = new Map<string, Aggregate>();
    for (const ref of refs) before.set(ref, await aggregateOf(first.app, ref));
    await first.app.close();

    // ---- a completely different instance, sharing only the blob ----
    const second = await coldApp(new VercelBlobStore(blob.client()));
    const history = (await second.inject({ method: "GET", url: "/api/research" })).json() as { ref: string; degraded?: boolean }[];
    expect(history.length).toBe(QUESTIONS.length);
    expect(history.some((h) => h.degraded === true)).toBe(false);
    for (const ref of refs) expectSameRun(before.get(ref)!, await aggregateOf(second, ref));

    // The aggregate is complete (not just the answer text): evidence rehydrated from the
    // graph by ref, judgments intact, diagnostics disclosure present.
    const reopened = await aggregateOf(second, refs[0]!);
    expect(reopened.evidence.length).toBeGreaterThan(0);
    expect(reopened.researchDiagnostics).toBeDefined();
    await second.close();

    // ---- and a THIRD instance, to prove nothing depends on instance 2 warming anything ----
    const third = await coldApp(new VercelBlobStore(blob.client()));
    for (const ref of refs) expectSameRun(before.get(ref)!, await aggregateOf(third, ref));
    await third.close();
  });
});
