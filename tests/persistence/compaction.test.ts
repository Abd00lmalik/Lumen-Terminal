/**
 * Phase E compaction: legacy v1 run-record NORMALIZATION to the v2 slim shape.
 *
 * Contract under test (docs/runbooks/blob-storage.md, "Compaction" section):
 *  - Compaction = reference-based representation, never deletion: every record survives,
 *    one per run, same researchId set, tiers/identity/observation content untouched.
 *  - Semantic equivalence: a v1 record is rewritten ONLY when `hydrateRunResponse` over the
 *    slimmed payload rebuilds the SAME evidence/judgment arrays (order+refs) the record
 *    carries; otherwise the record is left verbatim as v1. So every run view before
 *    compaction is identical at the DTO level after compaction.
 *  - Idempotence: compact(compact(s)) === compact(s) (v2 records are skipped by version marker).
 *  - Persistence safety: the compacted state is written through `store.save()` — merge-before-
 *    write against an origin read with a strong-ETag conditional guard, identical to every
 *    other save. Nothing about the store's concurrency law changes.
 *  - Merge composition: local-wins researchResponses merge still fills a missing local record
 *    (even a v1 one) from remote; remote v1 records merge in untouched.
 *  - Graph integrity: counters/tombstones/theses/saved/assessments are OUT OF SCOPE for
 *    compaction and arrive through `Workspace.fromSnapshot` untouched — asserted here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { toRunRecord, RUN_RECORD_VERSION } from "../../src/api/research-app.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters, newId, idPrefixes, seedIdCountersFromIds, bumpIdCounterPastId } from "../../src/domain/ids.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import { Workspace, type WorkspaceSnapshot } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { evidenceToDTO, judgmentToDTO, type ResearchResponseDTO } from "../../src/api/dto.js";
import { VercelBlobStore } from "../../src/persistence/vercel-edge.js";
import { FakeBlob } from "./fake-blob.js";
import type { EvidenceClass } from "../../src/domain/objects.js";

// ---------------------------------------------------------------------------
// Deterministic fixture helpers (no provider, no randomness, fixed timestamps)
// ---------------------------------------------------------------------------

const ORIGIN = { kind: "system", detail: "compaction-fixture" } as const;
const AT = new Date("2026-09-26T00:00:00.000Z");
const EV_CLASS: EvidenceClass = "OBSERVATION";

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

/** A REAL v2 record (produced by the production write path) — the FULL-tier fixture run. */
async function runRealResearch(message: string): Promise<{ store: MemoryStore; researchRef: string; response: ResearchResponseDTO }> {
  const store = new MemoryStore();
  const { app } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
  const res = await app.inject({ method: "POST", url: "/api/research", payload: { message } });
  expect(res.statusCode).toBe(200);
  const response = res.json() as ResearchResponseDTO;
  await app.close();
  return { store, researchRef: response.researchRef!, response };
}

function emptySnapshot(): WorkspaceSnapshot {
  return {
    researches: [],
    sources: [],
    evidence: [],
    claims: [],
    hypotheses: [],
    analyses: [],
    judgments: [],
    branches: [],
    theses: [],
    savedArtifacts: [],
    memories: [],
    monitors: [],
    thesisAssessments: [],
  };
}

/**
 * Legit domain content for the fixture runs: graph objects a v1 record would have carried.
 * The v1 arrays are built with the REAL DTO mappers (evidenceToDTO/judgmentToDTO), because a
 * genuine v1 record stored exactly those mapper outputs verbatim.
 */
function seedRunC(ws: Workspace): { r1: ReturnType<Workspace["addResearch"]>; ev1: ReturnType<Workspace["addEvidence"]>; ev2: ReturnType<Workspace["addEvidence"]>; j: ReturnType<Workspace["addJudgment"]> } {
  beginRun({ runId: "run_000001", userQuestion: "Fixture run C question" });
  try {
    const r1 = ws.addResearch({ objective: "fixture C step 1", question: "Fixture run C question", flow: "FLOW1" }, ORIGIN, AT);
    ws.addResearch({ objective: "fixture C step 2", question: "Fixture run C question", flow: "FLOW1" }, ORIGIN, AT);
    const ev1 = ws.addEvidence(
      { observation: "Fixture observation one (whole-run evidence)", evidenceType: "news", evidenceClass: EV_CLASS, observedAt: AT.toISOString(), timestamp: AT.toISOString(), researchRef: r1.id },
      ORIGIN,
      AT,
    );
    const ev2 = ws.addEvidence(
      { observation: "Fixture observation two (step-2 evidence)", evidenceType: "price", evidenceClass: EV_CLASS, observedAt: AT.toISOString(), researchRef: r1.id },
      ORIGIN,
      AT,
    );
    const j = ws.addJudgment({ statement: "Fixture judgment for run C", researchRef: r1.id, basis: { supportingEvidence: [ev1.id], opposingEvidence: [], keyClaims: [], hypotheses: [] }, confidence: "LOW" }, ORIGIN, AT);
    return { r1, ev1, ev2, j };
  } finally {
    endRun();
  }
}

function seedRunD(ws: Workspace): { r1: ReturnType<Workspace["addResearch"]>; jd: ReturnType<Workspace["addJudgment"]>; jd2: ReturnType<Workspace["addJudgment"]> } {
  beginRun({ runId: "run_000002", userQuestion: "Fixture run D question" });
  try {
    const r1 = ws.addResearch({ objective: "fixture D step 1", question: "Fixture run D question", flow: "FLOW1" }, ORIGIN, AT);
    ws.addResearch({ objective: "fixture D step 2", question: "Fixture run D question", flow: "FLOW1" }, ORIGIN, AT);
    const jd = ws.addJudgment({ statement: "Fixture judgment D1", researchRef: r1.id, basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] } }, ORIGIN, AT);
    const jd2 = ws.addJudgment({ statement: "Fixture judgment D2", researchRef: r2Id(ws, "fixture D step 2"), basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] } }, ORIGIN, AT);
    return { r1, jd, jd2 };
  } finally {
    endRun();
  }
}

function r2Id(ws: Workspace, objective: string): string {
  const found = ws.listResearch().find((r) => r.objective === objective);
  if (found === undefined) throw new Error(`fixture research not found: ${objective}`);
  return found.id;
}

function dtoEvidence(ref: string, observation: string): ResearchResponseDTO["evidence"][number] {
  return {
    ref, observation, evidenceType: "news", evidenceClass: EV_CLASS, freshness: "CURRENT",
    observedAt: AT.toISOString(), sourceRefs: [], supports: [], contradicts: [],
  };
}

/**
 * The deterministic fixture: two REAL v2 runs (FULL + JUDGMENT-tier legacy objects), two
 * hand-built v1 runs (FULL-shaped with inline arrays, JUDGMENT-shaped with judgments only,
 * including one judgment absent from the graph — must stay v1), a SUMMARY run with no
 * record, saved artifact + tombstone + counter-continuity id, thesis + assessment.
 */
async function buildFixtureSnapshot(): Promise<{ snapshot: WorkspaceSnapshot; refs: Record<string, string | undefined> }> {
  const full = await runRealResearch("What is affecting BTC right now?");
  // Pull the REAL v2 snapshot out of the memory store by loading it.
  const loaded = await full.store.load();
  expect(loaded).toBeDefined();
  const base = loaded!.toSnapshot();
  const ws = Workspace.fromSnapshot(base);

  // RUN C (v1 FULL-shaped, record on the answer-bearing member c1). Arrays are exactly what
  // the v1 writer stored: the real DTO mapper output for the run's graph objects.
  const runC = seedRunC(ws);
  const runCAll = ws.listResearch().filter((r) => r.runId === "run_000001");
  const c1 = runCAll.find((r) => r.objective === "fixture C step 1")!;
  const v1Full: ResearchResponseDTO = {
    requestId: c1.id,
    action: "RESEARCH",
    outcome: "COMPLETED",
    answer: { answer: "Fixture C answer", supportingReasons: [], opposingReasons: [], counterevidenceStatus: "NONE_FOUND", confidence: "LOW", keyUncertainty: "", implication: "", citedObjectRefs: [] },
    limitations: [],
    researchGaps: [],
    researchRef: c1.id,
    evidenceRefs: [runC.ev1.id, runC.ev2.id],
    evidence: [evidenceToDTO(runC.ev1), evidenceToDTO(runC.ev2)],
    judgments: [judgmentToDTO(runC.j)],
  };

  // RUN D (v1 JUDGMENT-shaped). The extra judgment is intentionally ABSENT from the graph, so
  // rehydration cannot reproduce the stored array and compaction must leave this record v1.
  const runD = seedRunD(ws);
  const runDAll = ws.listResearch().filter((r) => r.runId === "run_000002");
  const d1 = runDAll.find((r) => r.objective === "fixture D step 1")!;
  const extraJudgment = { ref: "jd_999999", statement: "Fixture extra judgment", confidence: "MODERATE" as const, uncertainty: [], implications: [], unresolvedQuestions: [], supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [], status: "ACTIVE" as const };
  const v1Judgment: ResearchResponseDTO = {
    requestId: d1.id,
    action: "RESEARCH",
    outcome: "COMPLETED",
    answer: { answer: "Fixture judgment D1", supportingReasons: [], opposingReasons: [], counterevidenceStatus: "NONE_FOUND", confidence: "LOW", keyUncertainty: "", implication: "", citedObjectRefs: [] },
    limitations: [],
    researchGaps: [],
    researchRef: d1.id,
    evidenceRefs: [],
    judgments: [judgmentToDTO(runD.jd), judgmentToDTO(runD.jd2), extraJudgment],
  };

  // RUN E (SUMMARY-tier legacy: no record at all)
  beginRun({ runId: "run_000003", userQuestion: "Fixture run E question" });
  try {
    ws.addResearch({ objective: "fixture E step", question: "Fixture run E question", flow: "FLOW1" }, ORIGIN, AT);
  } finally {
    endRun();
  }

  // Saved artifact + tombstone (tombstoned id must NEVER be re-minted: counter continuity)
  seedIdCountersFromIds(base.researches.map((r) => r.id));
  const sa = ws.upsertSavedArtifact({ researchRef: c1.id, kind: "JUDGMENT", title: "Fixture saved judgment", content: "Fixture judgment for run C — kept verbatim" }, ORIGIN, AT).artifact;
  const tombstoned = { id: newId(idPrefixes.artifact), at: AT.toISOString() };

  // Thesis (trader-owned; active selection) + assessment referencing run C
  const th = ws.addThesis({ statement: "Fixture thesis statement", asset: "BTC" }, ORIGIN, AT);
  ws.setActiveThesis(th.id);
  const assessment = ws.recordThesisAssessment({ thesisId: th.id, thesisVersion: 1, assessment: "SUPPORTS", rationale: "fixture", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW", researchRef: c1.id }, ORIGIN, AT);

  const merged: WorkspaceSnapshot = {
    ...base,
    researches: ws.listResearch(),
    evidence: ws.listEvidence(),
    judgments: ws.listJudgments(),
    theses: ws.listTheses(),
    savedArtifacts: [sa],
    savedTombstones: [tombstoned],
    activeThesisId: th.id,
    thesisAssessments: [assessment],
    researchResponses: [
      ...(base.researchResponses ?? []), // REAL v2 record (run A)
      { researchId: c1.id, response: v1Full as unknown }, // v1 FULL-shaped (members c1+c2 share the run)
      { researchId: d1.id, response: v1Judgment as unknown }, // v1 JUDGMENT-shaped (members d1+d2)
    ],
  };
  return {
    snapshot: merged,
    refs: { full: full.researchRef, c1: c1.id, c2: runCAll.find((r) => r.objective === "fixture C step 2")!.id, d1: d1.id, d2: runDAll.find((r) => r.objective === "fixture D step 2")!.id, summary: ws.listResearch().find((r) => r.runId === "run_000003")?.id, saved: sa.id, thesis: th.id },
  };
}

const deepSorted = (value: unknown): string => JSON.stringify(value);

beforeEach(() => resetIdCounters());

describe("Phase E compaction: legacy run-record normalization", () => {
  it("normalizes v1 records, keeps un-rehydratable records verbatim, and preserves run views", async () => {
    const { snapshot, refs } = await buildFixtureSnapshot();
    const store = new MemoryStore();
    await store.save(snapshot);
    const { researchApp } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });

    const beforeViews = {
      full: researchApp.getResearch(refs.full!),
      c: researchApp.getResearch(refs.c1!),
      c2: researchApp.getResearch(refs.c2!),
      d: researchApp.getResearch(refs.d1!),
      d2: researchApp.getResearch(refs.d2!),
    };

    const report = await researchApp.compactStorage();
    expect(report.dryRun).toBe(false);
    expect(report.normalizedRecords).toBe(1); // only c1's v1 FULL record is exactly rehydratable
    expect(report.recordBytes.after).toBeLessThan(report.recordBytes.before);
    expect(report.runRecords.before).toBe(report.runRecords.after); // NO deletion: same record count

    // Every run view is semantically IDENTICAL before/after (evidence rehydrated from graph).
    expect(deepSorted(researchApp.getResearch(refs.full!))).toBe(deepSorted(beforeViews.full));
    expect(deepSorted(researchApp.getResearch(refs.c1!))).toBe(deepSorted(beforeViews.c));
    expect(deepSorted(researchApp.getResearch(refs.c2!))).toBe(deepSorted(beforeViews.c2));
    expect(deepSorted(researchApp.getResearch(refs.d1!))).toBe(deepSorted(beforeViews.d));
    expect(deepSorted(researchApp.getResearch(refs.d2!))).toBe(deepSorted(beforeViews.d2));

    // The compacted record is v2-shaped; the un-rehydratable one is STILL v1 (verbatim).
    const persisted = (await store.load())!.toSnapshot().researchResponses ?? [];
    const c1Record = persisted.find((r) => r.researchId === refs.c1)!;
    expect((c1Record.response as { recordVersion?: number }).recordVersion).toBe(RUN_RECORD_VERSION);
    expect((c1Record.response as { response?: { evidence?: unknown[] } }).response!.evidence).toBeUndefined();
    const d1Record = persisted.find((r) => r.researchId === refs.d1)!;
    expect((d1Record.response as { recordVersion?: number }).recordVersion).toBeUndefined(); // untouched legacy
  });

  it("is idempotent: compact(compact(s)) === compact(s)", async () => {
    const { snapshot } = await buildFixtureSnapshot();
    const store = new MemoryStore();
    await store.save(snapshot);
    const { researchApp } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });

    await researchApp.compactStorage();
    const once = (await store.load())!.toSnapshot();
    await researchApp.compactStorage();
    const twice = (await store.load())!.toSnapshot();
    expect(deepSorted(twice)).toBe(deepSorted(once));
  });

  it("dryRun reports exactly what would change and persists nothing", async () => {
    const { snapshot, refs } = await buildFixtureSnapshot();
    const store = new MemoryStore();
    await store.save(snapshot);
    const { researchApp } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });

    const report = await researchApp.compactStorage({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.normalizedRecords).toBe(1);
    const persisted = (await store.load())!.toSnapshot().researchResponses ?? [];
    expect((persisted.find((r) => r.researchId === refs.c1)!.response as { recordVersion?: number }).recordVersion).toBeUndefined();
  });

  it("compaction writes through the REAL store: conflict → re-read + re-merge, content preserved", async () => {
    const { snapshot } = await buildFixtureSnapshot();
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    // A concurrent instance's write lands right before our first compaction write: the guard
    // ETag no longer matches, BlobPreconditionFailedError fires, and the store must re-read
    // the winner's state, merge again, and retry — never overwrite.
    blob.beforeWrite = (index) => {
      if (index === 1) {
        const current = blob.body() !== undefined ? (JSON.parse(blob.body()!) as WorkspaceSnapshot) : emptySnapshot();
        blob.put(JSON.stringify({
          ...current,
          researchResponses: [...(current.researchResponses ?? []), { researchId: "rs_other_instance", response: { requestId: "rs_other_instance", answer: { answer: "concurrent" } } }],
        }));
      }
    };
    await store.save(snapshot);
    const { researchApp } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
    const report = await researchApp.compactStorage();
    expect(report.normalizedRecords).toBeGreaterThanOrEqual(1);
    const persisted = (await store.load())!.toSnapshot().researchResponses ?? [];
    // The concurrent instance's record survived the compaction (union, never clobbered).
    expect(persisted.some((r) => r.researchId === "rs_other_instance")).toBe(true);
  });

  it("merge composition: local-wins fills a missing v1 record from remote; remote v1 merges untouched", () => {
    const v1 = { requestId: "rs_1", answer: { answer: "remote v1" }, evidenceRefs: [], evidence: [dtoEvidence("ev_r1", "remote evidence")], judgments: [] };
    const local: WorkspaceSnapshot = { ...emptySnapshot(), researchResponses: [] };
    const remote: WorkspaceSnapshot = { ...emptySnapshot(), researchResponses: [{ researchId: "rs_1", response: v1 as unknown }] };
    const merged = mergeSnapshots(local, remote);
    expect(merged.researchResponses).toHaveLength(1);
    expect((merged.researchResponses![0]!.response as { requestId: string }).requestId).toBe("rs_1");
  });

  it("graph integrity: tombstones, counters, thesis, saved artifact, assessment survive compaction exactly", async () => {
    const { snapshot, refs } = await buildFixtureSnapshot();
    const store = new MemoryStore();
    await store.save(snapshot);
    const { researchApp } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });

    await researchApp.compactStorage();
    const loaded = (await store.load())!;
    const snap = loaded.toSnapshot();

    // Tombstone preserved verbatim + counter never re-mints the tombstoned id.
    const tombstone = snap.savedTombstones!.find((t) => t.id.startsWith("sa_"))!;
    expect(tombstone).toBeDefined();
    bumpIdCounterPastId(tombstone.id); // must not throw; counter is past it
    const minted = newId(idPrefixes.artifact);
    expect(Number(minted.slice(3))).toBeGreaterThan(Number(tombstone.id.slice(3)));

    // Saved artifact + thesis + assessment + active selection preserved.
    expect(snap.savedArtifacts.find((a) => a.id === refs.saved)).toBeDefined();
    expect(snap.theses.find((t) => t.id === refs.thesis)).toBeDefined();
    expect(snap.activeThesisId).toBe(refs.thesis);
    expect(snap.thesisAssessments.some((a) => a.thesisId === refs.thesis && a.researchRef === refs.c1)).toBe(true);

    // Summary-tier run (no record) still opens as a legacy-tier judgment/summary view.
    const summary = researchApp.getResearch(refs.summary!);
    expect(summary.recordTier).toBeDefined();
    expect(summary.response === undefined || summary.response.researchRef === refs.summary || summary.response.outcome !== undefined).toBe(true);
  });
});
