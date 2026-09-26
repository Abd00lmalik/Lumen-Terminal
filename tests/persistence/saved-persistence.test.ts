/**
 * Phase C persistence: Saved artifacts must survive reload, cold start and multiple instances,
 * and an unsave must survive a stale instance's later write (tombstones).
 *
 * Driven through the REAL VercelBlobStore with an in-memory blob that enforces the same
 * ETag/conditional-write semantics, so no network is involved.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VercelBlobStore } from "../../src/persistence/vercel-edge.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { Workspace, type WorkspaceSnapshot } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeBlob } from "./fake-blob.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test confirmed save" };

function workspaceWithSaved(research: string, content: string): Workspace {
  const ws = new Workspace();
  ws.addResearch({ objective: research, question: research, flow: "WHAT_HAPPENED" }, trader);
  ws.upsertSavedArtifact({ kind: "RESEARCH", researchRef: ws.listResearch()[0]!.id, sourceRef: ws.listResearch()[0]!.id, content }, trader);
  return ws;
}

beforeEach(() => resetIdCounters());

describe("Saved persistence", () => {
  it("survives a reload and a cold start (a fresh store instance)", async () => {
    const blob = new FakeBlob();
    const first = new VercelBlobStore(blob.client());
    await first.save(workspaceWithSaved("Why did BTC move?", "BTC moved on ETF flows").toSnapshot());

    // Same process, reloaded from the shared blob.
    const reloaded = await first.load();
    expect(reloaded?.listSavedArtifacts()).toHaveLength(1);
    expect(reloaded?.listSavedArtifacts()[0]?.content).toBe("BTC moved on ETF flows");

    // COLD START: a brand new store object over the same blob (a new serverless instance).
    const cold = new VercelBlobStore(blob.client());
    const fromCold = await cold.load();
    expect(fromCold?.listSavedArtifacts()).toHaveLength(1);
    expect(fromCold?.listSavedArtifacts()[0]?.kind).toBe("RESEARCH");
  });

  it("concurrent instances preserve each other's unrelated saved artifacts (union merge)", async () => {
    const instanceA = workspaceWithSaved("A: AAPL earnings", "A saved artifact");
    // Spacer so the two instances mint disjoint ids (real instances seed from the shared blob).
    workspaceWithSaved("spacer", "spacer");
    const instanceB = workspaceWithSaved("B: BTC dominance", "B saved artifact");

    const merged = mergeSnapshots(instanceA.toSnapshot(), instanceB.toSnapshot());
    const contents = merged.savedArtifacts.map((a) => a.content).sort();
    expect(contents).toEqual(["A saved artifact", "B saved artifact"]);
    // And the merged snapshot round-trips through the domain.
    const restored = Workspace.fromSnapshot(merged);
    expect(restored.listSavedArtifacts()).toHaveLength(2);
  });

  it("loadFresh() bypasses the TTL cache so a warm instance can read another instance's save", async () => {
    const blob = new FakeBlob();
    const warm = new VercelBlobStore(blob.client());
    await warm.save(workspaceWithSaved("A: AAPL earnings", "A saved artifact").toSnapshot());

    // Another instance saves an unrelated artifact to the SAME blob.
    const other = new VercelBlobStore(blob.client());
    const otherWs = await other.load();
    const otherResearch = otherWs!.addResearch({ objective: "B: BTC dominance", question: "B: BTC dominance", flow: "WHAT_HAPPENED" }, trader);
    otherWs!.upsertSavedArtifact({ kind: "RESEARCH", researchRef: otherResearch.id, sourceRef: otherResearch.id, content: "B saved artifact" }, trader);
    await other.save(otherWs!.toSnapshot());

    // Within the TTL the cached read is stale (it does not see B); the fresh read does.
    const cached = await warm.load();
    expect(cached!.listSavedArtifacts().map((a) => a.content)).toEqual(["A saved artifact"]);
    const fresh = await warm.loadFresh();
    expect(fresh!.listSavedArtifacts().map((a) => a.content).sort()).toEqual(["A saved artifact", "B saved artifact"]);
  });

  it("an unsave is durable: a stale instance's write cannot resurrect the artifact", async () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const { artifact } = ws.upsertSavedArtifact({ kind: "RESEARCH", researchRef: research.id, sourceRef: research.id, content: "keep me" }, trader);

    // The trader unsaves on this instance; a stale instance still holds the artifact.
    ws.removeSavedArtifact(artifact.id);
    const stale = new Workspace();
    const staleResearch = stale.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
    void staleResearch;
    const staleSnapshot: WorkspaceSnapshot = {
      ...ws.toSnapshot(),
      savedArtifacts: [{ ...artifact }],
      savedTombstones: [],
    };

    const merged = mergeSnapshots(ws.toSnapshot(), staleSnapshot);
    expect(merged.savedArtifacts).toHaveLength(0); // tombstone wins over the stale union
    expect(merged.savedTombstones?.map((t) => t.id)).toEqual([artifact.id]);
    expect(Workspace.fromSnapshot(merged).listSavedArtifacts()).toHaveLength(0);
  });

  it("a legacy workspace without a saved collection loads with an empty Saved library", async () => {
    const ws = new Workspace();
    ws.addResearch({ objective: "legacy", question: "legacy", flow: "WHAT_HAPPENED" }, trader);
    const snapshot = ws.toSnapshot() as Record<string, unknown>;
    delete snapshot.savedArtifacts; // pre-Phase-C persistence shape
    const restored = Workspace.fromSnapshot(snapshot as never);
    expect(restored.listSavedArtifacts()).toEqual([]);
    expect(restored.listSavedTombstones()).toEqual([]);
  });

  it("public-store reads genuinely bypass the CDN (useCache:false is a no-op for public in the SDK)", () => {
    // Production finding: @vercel/blob's `useCache:false` only appends its cache-buster for
    // PRIVATE stores, so a public read returned a stale body+ETag and every conditional write
    // failed (POST /api/saved 500). The client must cache-bust public reads itself.
    const source = readFileSync(join(import.meta.dirname, "..", "..", "src", "persistence", "vercel-edge.ts"), "utf8");
    expect(source).toContain('options.useCache === false && access === "public"');
    expect(source).toContain("cachebust=");
    expect(source).toContain("head(pathname");
  });

  it("a failed write surfaces honestly (never swallowed, never reported as success)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    const failing = new Error("network down");
    blob.failNextWrite = failing;
    await expect(store.save(workspaceWithSaved("q", "c").toSnapshot())).rejects.toThrow(/network down/);
    expect(blob.body()).toBeUndefined(); // nothing was persisted
    // The store is not poisoned: a later save succeeds.
    await store.save(workspaceWithSaved("q", "c").toSnapshot());
    expect(blob.body()).toBeDefined();
  });
});
