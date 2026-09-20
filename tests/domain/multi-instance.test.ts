/**
 * Multi-instance persistence + target-scoping regression tests (research-agent repair).
 *
 * Laws under test (production failures observed live, 2026-09-19):
 * - MERGE-BEFORE-WRITE: a stale instance's save must UNION with the blob's newer state,
 *   never erase another instance's runs (history shrinking between reads).
 * - PER-OBJECT last-write-wins: the side with more lifecycle history is newer; ties keep
 *   local; ids never collide.
 * - SCOPED CURRENT JUDGMENT: the continuity snapshot's currentJudgment belongs to the
 *   ACTIVE research target; a previous run's verdict must never render for a new run.
 * - HEURIST ERROR-PAYLOAD LAW: an HTTP-200 body with an embedded error object is a
 *   PROVIDER failure, never evidence (live: Caesar 402 became ev_000616 and produced a
 *   false "COMPLETE").
 */
import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { normalizedResult, type ToolResult } from "../../src/domain/tool-result.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import { parseHeuristOutputs } from "../../src/adapters/heurist.js";
import { TransportError } from "../../src/adapters/transports/resilience.js";

const origin = { kind: "agent" as const, detail: "test" };

function makeEvidence(ws: Workspace, observation: string): string {
  const result: ToolResult = normalizedResult(
    {
      tool: "bitget-signal/technical-analysis",
      capability: "TECHNICAL_ANALYSIS",
      transport: "rest:api.bitget.com",
      params: { symbol: "BTCUSDT" },
      outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: observation }],
      validation: "VALID",
    },
    origin,
  );
  const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
  return ws.addEvidence({ ...evidence }, origin).id;
}

function seedRun(objective: string): Workspace {
  const ws = new Workspace();
  const research = ws.addResearch({ objective, question: objective, flow: "WHAT_HAPPENED" }, origin);
  ws.transitionResearch(research.id, "ACTIVE", origin, "started", new Date());
  ws.transitionResearch(research.id, "COMPLETED", origin, "done", new Date());
  makeEvidence(ws, `${objective} evidence`);
  return ws;
}

describe("mergeSnapshots (multi-instance persistence law)", () => {
  it("a stale instance's save unions with remote runs instead of erasing them", () => {
    // Distinct id spaces: real instances seed counters from the shared blob, so ids never
    // collide across instances. Simulate by advancing the counter between graphs.
    const instanceA = seedRun("instance A run: AAPL earnings");
    seedRun("counter spacer (ids must not collide)");
    const instanceB = seedRun("instance B run: BTC dominance");
    const stale = instanceA.toSnapshot();
    const fresh = instanceB.toSnapshot();

    // Stale instance (holding only ITS run) saves; the merge must retain BOTH runs.
    const merged = mergeSnapshots(stale, fresh);
    const objectives = merged.researches.map((r) => r.objective);
    expect(objectives).toContain("instance A run: AAPL earnings");
    expect(objectives).toContain("instance B run: BTC dominance");
    expect(merged.researches.length).toBe(2);
    expect(merged.evidence.length).toBe(2);
  });

  it("per-object last-write-wins: the side with more lifecycle history is newer", () => {
    resetIdCounters();
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "shared objective", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const older = ws.toSnapshot();

    // The same research advances on this instance (ACTIVE transition appends history).
    ws.transitionResearch(research.id, "ACTIVE", origin, "started", new Date());
    const newer = ws.toSnapshot();

    const merged = mergeSnapshots(older, newer);
    expect(merged.researches.length).toBe(1);
    expect(merged.researches[0]!.status).toBe("ACTIVE"); // remote (more history) wins
  });

  it("equal history keeps the local side (in-flight writes win ties)", () => {
    // Same id on both sides (same object), same revision count: local wins.
    const local = seedRun("same objective");
    const remoteSnapshot = structuredClone(local.toSnapshot());
    const merged = mergeSnapshots(local.toSnapshot(), remoteSnapshot);
    expect(merged.researches.length).toBe(1);
    expect(merged.researches[0]!.objective).toBe("same objective");
  });

  it("persisted responses union by researchId and survive the merge", () => {
    resetIdCounters();
    const local = seedRun("local run");
    const remote = seedRun("remote run");
    local.saveResearchResponse("rs_local", { answer: { answer: "local full response" } });
    remote.saveResearchResponse("rs_remote", { answer: { answer: "remote full response" } });
    const merged = mergeSnapshots(local.toSnapshot(), remote.toSnapshot());
    const ids = (merged.researchResponses ?? []).map((r) => r.researchId);
    expect(ids).toContain("rs_local");
    expect(ids).toContain("rs_remote");
  });

  it("merged snapshots round-trip through Workspace.fromSnapshot with intact refs", () => {
    resetIdCounters();
    const a = seedRun("A: AAPL");
    const b = seedRun("B: BTC");
    const merged = mergeSnapshots(a.toSnapshot(), b.toSnapshot());
    const restored = Workspace.fromSnapshot(merged);
    expect(restored.listResearch().length).toBe(2);
    expect(restored.listEvidence().length).toBe(2);
  });
});

describe("continuity judgment scoping", () => {
  it("currentJudgment belongs to the ACTIVE research, never a previous run", () => {
    resetIdCounters();
    const ws = new Workspace();
    const btc = ws.addResearch({ objective: "why did BTC move", question: "why did BTC move", flow: "WHY_IT_HAPPENED" }, origin);
    makeEvidence(ws, "BTC ETF outflows of 450 million dollars");
    ws.addJudgment(
      { statement: "The Clarity Act failure caused the BTC drop", basis: "evidence-weighted", researchRef: btc.id },
      origin,
    );

    // A NEW run starts (no judgment yet). The snapshot must NOT surface the BTC verdict.
    ws.addResearch({ objective: "TSLA weekly comparison", question: "TSLA weekly comparison", flow: "WHAT_DOES_ALL_INFORMATION_SAY" }, origin);
    const snap = ws.getContinuitySnapshot();
    expect(snap.activeResearchTarget!.objective).toBe("TSLA weekly comparison");
    expect(snap.currentJudgment).toBeUndefined();
  });

  it("the active target's own judgment still surfaces", () => {
    resetIdCounters();
    const ws = new Workspace();
    const run = ws.addResearch({ objective: "current run", question: "current run", flow: "WHAT_HAPPENED" }, origin);
    makeEvidence(ws, "TSLA closed at 364.27");
    ws.addJudgment({ statement: "TSLA drifted marginally lower", basis: "evidence-weighted", researchRef: run.id }, origin);
    expect(ws.getContinuitySnapshot().currentJudgment?.statement).toBe("TSLA drifted marginally lower");
  });
});

describe("Heurist error-payload law", () => {
  it("an embedded error object is a TransportError, never a parseable observation", () => {
    expect(() =>
      parseHeuristOutputs({ error: "API request failed: 402, message='Payment Required', url='https://api.caesar.xyz/research'" }, "caesar-research"),
    ).toThrow(TransportError);
  });

  it("status:error payloads are provider failures too", () => {
    expect(() => parseHeuristOutputs({ status: "error", message: "upstream unavailable" }, "ask-heurist")).toThrow(TransportError);
  });

  it("legitimate data payloads still parse after the guard", () => {
    const outputs = parseHeuristOutputs({ content: "AAPL earnings are expected November 2026" }, "caesar-research");
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.outputClass).toBe("ANALYST_INTERPRETATION");
  });
});

describe("snapshot restoration is total (never throws on malformed persisted entries)", () => {
  it("tolerates a malformed id in a persisted collection instead of bricking fromSnapshot", () => {
    const healthy = new Workspace();
    const research = healthy.addResearch({ objective: "r", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const snap = healthy.toSnapshot() as Record<string, unknown>;
    const researches = snap.researches as Array<Record<string, unknown>>;
    researches.push({ ...researches[0]!, id: undefined }); // corrupted persisted entry
    expect(() => Workspace.fromSnapshot(snap as never)).not.toThrow();
    // Restoration still seeds counters past the healthy ids (no id re-minting).
    const restored = Workspace.fromSnapshot(snap as never);
    expect(restored.getResearch(research.id)?.id).toBe(research.id);
  });
});
