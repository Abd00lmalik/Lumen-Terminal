/**
 * Phase B persistence policy (B5): the durable run record, tested explicitly.
 *
 * The audit found the response archive had a 100-run cap that silently degraded older runs
 * to bare summaries. The fix is a POLICY, not a bigger cap:
 *
 *   - one SLIM record per completed run, retained without eviction (history preserves the
 *     record itself);
 *   - the record does NOT duplicate the evidence/judgment objects the graph already holds —
 *     the read path rehydrates those arrays from the graph by ref;
 *   - the version marker is explicit, so legacy (v1) records that stored the complete
 *     response verbatim are still read correctly (migration by version, never by guessing).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { toRunRecord, RUN_RECORD_VERSION } from "../../src/api/research-app.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import type { ResearchResponseDTO } from "../../src/api/dto.js";

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

beforeEach(() => resetIdCounters());

describe("Phase B: durable run record shape", () => {
  it("strips the duplicated object arrays at write time and marks the record version", () => {
    const response = {
      requestId: "req-1",
      action: "RESEARCH",
      outcome: "COMPLETED",
      answer: { answer: "BTC moved", supportingReasons: [], opposingReasons: [], counterevidenceStatus: "NONE_FOUND", confidence: "LOW", keyUncertainty: "", implication: "", citedObjectRefs: [] },
      limitations: ["one limitation"],
      researchGaps: ["one gap"],
      researchRef: "rs_000001",
      evidenceRefs: ["ev_000001", "ev_000002"],
      judgmentRef: "jd_000001",
      evidence: [{ ref: "ev_000001" }, { ref: "ev_000002" }],
      judgments: [{ ref: "jd_000001" }],
    } as unknown as ResearchResponseDTO;

    const record = toRunRecord(response);
    expect(record.recordVersion).toBe(RUN_RECORD_VERSION);
    // No second copy of the graph objects, but every ref and all presentation content stays.
    expect("evidence" in record.response).toBe(false);
    expect("judgments" in record.response).toBe(false);
    expect(record.response.evidenceRefs).toEqual(["ev_000001", "ev_000002"]);
    expect(record.response.judgmentRef).toBe("jd_000001");
    expect(record.response.answer.answer).toBe("BTC moved");
    expect(record.response.limitations).toEqual(["one limitation"]);
    expect(record.response.researchGaps).toEqual(["one gap"]);
  });

  it("stores ONE slim record per run, with the evidence objects living once in the graph", { timeout: 30_000 }, async () => {
    const store = new MemoryStore();
    const { app, researchApp } = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "What is affecting BTC right now?" } });
    expect(res.statusCode).toBe(200);
    const response = res.json() as ResearchResponseDTO;

    const snapshot = researchApp.getWorkspace().toSnapshot();
    const records = snapshot.researchResponses ?? [];
    expect(records.length).toBe(1);
    const stored = records[0]!.response as { recordVersion: number; response: Record<string, unknown> };
    expect(stored.recordVersion).toBe(RUN_RECORD_VERSION);
    expect(stored.response.evidence).toBeUndefined(); // deduplicated
    expect(stored.response.judgments).toBeUndefined();
    expect(stored.response.answer).toBeDefined();
    expect((stored.response.evidenceRefs as readonly string[]).length).toBe(response.evidence.length);
    // The graph still holds each evidence object exactly once (the source of truth).
    expect(snapshot.evidence.length).toBe(response.evidence.length);
    await app.close();
  });

  it("serves the slim record complete: answer, gaps, diagnostics AND rehydrated evidence", { timeout: 30_000 }, async () => {
    const store = new MemoryStore();
    const first = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
    const posted = (await first.app.inject({ method: "POST", url: "/api/research", payload: { message: "What is affecting BTC right now?" } })).json() as ResearchResponseDTO;
    await first.app.close();

    // Cold instance: no in-memory archive, so the SLIM record is what serves this read.
    const second = await buildApi({ provider: new FakeModelProvider(new Map()), registry: registryWith("NEWS_ANALYSIS"), store });
    const reopened = (await second.app.inject({ method: "GET", url: `/api/research/${String(posted.researchRef)}` })).json() as Record<string, any>;
    expect(reopened.recordTier).toBe("FULL");
    expect(reopened.answer).toEqual(posted.answer);
    expect(reopened.researchGaps).toEqual(posted.researchGaps);
    expect(reopened.limitations).toEqual(posted.limitations);
    expect(reopened.researchDiagnostics).toEqual(posted.researchDiagnostics);
    expect(reopened.evidence).toEqual(posted.evidence); // rehydrated from the graph by ref
    expect(reopened.judgments).toEqual(posted.judgments);
    await second.app.close();
  });

  it("still reads a LEGACY (v1) record that stored the complete response verbatim", { timeout: 30_000 }, async () => {
    const store = new MemoryStore();
    const first = await buildApi({ provider: scriptedProvider(), registry: registryWith("NEWS_ANALYSIS"), store });
    const posted = (await first.app.inject({ method: "POST", url: "/api/research", payload: { message: "What is affecting BTC right now?" } })).json() as ResearchResponseDTO;
    // Pre-Phase-B instances wrote the bare response object (no version wrapper).
    first.researchApp.getWorkspace().saveResearchResponse(String(posted.researchRef), posted);
    await store.save(first.researchApp.getWorkspace().toSnapshot());
    await first.app.close();

    const second = await buildApi({ provider: new FakeModelProvider(new Map()), registry: registryWith("NEWS_ANALYSIS"), store });
    const reopened = (await second.app.inject({ method: "GET", url: `/api/research/${String(posted.researchRef)}` })).json() as Record<string, any>;
    expect(reopened.recordTier).toBe("FULL");
    expect(reopened.answer).toEqual(posted.answer);
    expect(reopened.evidence).toEqual(posted.evidence);
    expect(reopened.judgments).toEqual(posted.judgments);
    await second.app.close();
  });
});
