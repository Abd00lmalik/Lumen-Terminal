/**
 * VercelBlobStore tests (audit B5): the production persistence layer had NO automated coverage,
 * and its merge-before-write had a lost-update race between serverless instances.
 *
 * No network: the store takes an injectable BlobClient, and these tests drive it with an
 * in-memory blob service that enforces the SAME semantics as Vercel Blob — content + ETag,
 * conditional writes (`ifMatch`), create-only first writes, and missing/corrupt blobs.
 *
 * Covered: first write, read after write, update/merge, concurrent writes across instances,
 * a stale (lost-race) conditional write, a failed save that must not poison the queue,
 * corrupted snapshot, missing blob, cold-start hydration of every retained run, record
 * retention across a restart, access-mode auto-detection, the CDN-cache bypass that a stale
 * read would otherwise use to erase runs, and the bounded-I/O deadline.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BLOB_IO_TIMEOUT_MS,
  BlobIoTimeoutError,
  SNAPSHOT_CACHE_CONTROL_MAX_AGE_SECONDS,
  VercelBlobStore,
  snapshotReadOptions,
  snapshotWriteOptions,
} from "../../src/persistence/vercel-edge.js";
import { CdnCachedBlob, FakeBlob } from "./fake-blob.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters, bumpIdCounterPast } from "../../src/domain/ids.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

/** A workspace holding `count` completed runs (each with a persisted run record). */
function workspaceWithRuns(count: number, marker: string): Workspace {
  const ws = new Workspace();
  for (let i = 0; i < count; i += 1) {
    const r = ws.addResearch({ objective: `${marker} objective ${i}`, question: `${marker} question ${i}`, flow: "WHAT_HAPPENED" }, trader);
    ws.saveResearchResponse(r.id, { marker, i });
  }
  return ws;
}

function runIdsOf(snapshot: { researches: readonly { id: string }[] }): string[] {
  return snapshot.researches.map((r) => r.id);
}

beforeEach(() => resetIdCounters());

describe("VercelBlobStore (production persistence, tested with an in-memory blob)", () => {
  it("writes the first snapshot create-only, then conditional writes on the ETag it merged from", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save(workspaceWithRuns(1, "A").toSnapshot());

    // First write against a missing blob is create-only: two instances racing to create the
    // blob resolve through the retry path instead of one silently erasing the other.
    expect(blob.writes[0]!.guard?.createOnly).toBe(true);
    expect(blob.writes[0]!.guard?.ifMatch).toBeUndefined();

    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    // Subsequent writes carry the ETag of the state we merged from (lost-update protection).
    expect(blob.writes[1]!.guard?.ifMatch).toBe("etag-1");
    expect(blob.writes[1]!.guard?.createOnly).toBeUndefined();
  });

  it("reads back exactly what was written (read after write)", async () => {
    const blob = new FakeBlob();
    const first = new VercelBlobStore(blob.client());
    await first.save(workspaceWithRuns(2, "A").toSnapshot());

    const second = new VercelBlobStore(blob.client()); // a cold instance
    const restored = (await second.load())!;
    expect(restored).toBeDefined();
    expect(restored.listResearch().map((r) => r.objective)).toEqual(["A objective 0", "A objective 1"]);
  });

  it("merges remote state on update: a run completed elsewhere is never erased", async () => {
    const blob = new FakeBlob();
    const instanceA = new VercelBlobStore(blob.client());
    await instanceA.save(workspaceWithRuns(1, "A").toSnapshot());

    // Instance B loaded BEFORE A's write (stale in-memory graph) and now saves its own run.
    const instanceB = new VercelBlobStore(blob.client());
    const bWorkspace = workspaceWithRuns(1, "B");
    await instanceB.save(bWorkspace.toSnapshot());

    const after = JSON.parse(blob.body()!) as { researches: readonly { objective: string }[] };
    const objectives = after.researches.map((r) => r.objective);
    expect(objectives).toContain("A objective 0"); // A's run survived B's write
    expect(objectives).toContain("B objective 0");
  });

  it("concurrent saves from two instances keep BOTH instances' runs (no lost update)", async () => {
    const blob = new FakeBlob();
    // Two genuinely independent instances: distinct id spaces, same blob.
    resetIdCounters();
    const wsA = workspaceWithRuns(2, "A");
    bumpIdCounterPast("rs", 100);
    const wsB = workspaceWithRuns(2, "B");
    const instanceA = new VercelBlobStore(blob.client());
    const instanceB = new VercelBlobStore(blob.client());

    await Promise.all([instanceA.save(wsA.toSnapshot()), instanceB.save(wsB.toSnapshot())]);

    const restored = (await new VercelBlobStore(blob.client()).load())!;
    const objectives = restored.listResearch().map((r) => r.objective);
    expect(objectives.filter((o) => o.startsWith("A ")).length).toBe(2);
    expect(objectives.filter((o) => o.startsWith("B ")).length).toBe(2);
    // Every run's record is present too (history opens, not just lists).
    for (const id of runIdsOf(restored.toSnapshot())) expect(restored.getResearchResponse(id)).toBeDefined();
  });

  it("a stale conditional write is rejected, re-read, re-merged and retried (never clobbers)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save(workspaceWithRuns(1, "A").toSnapshot()); // blob: A

    const wsB = workspaceWithRuns(1, "B");
    // Simulate a concurrent winner landing after our merge read but before our write.
    let winnerLanded = false;
    blob.beforeWrite = () => {
      if (winnerLanded) return;
      winnerLanded = true;
      const current = JSON.parse(blob.body()!) as { researches: readonly { id: string; objective: string }[] };
      const winner = { ...current, researches: [...current.researches, { ...current.researches[0]!, id: "rs_999999", objective: "WINNER objective" }] };
      blob.put(JSON.stringify(winner));
    };
    await store.save(wsB.toSnapshot());
    blob.beforeWrite = undefined;

    const after = JSON.parse(blob.body()!) as { researches: readonly { objective: string }[] };
    const objectives = after.researches.map((r) => r.objective);
    expect(objectives).toContain("WINNER objective"); // the concurrent winner survived
    expect(objectives).toContain("B objective 0"); // and our run was re-merged, not dropped
    expect(blob.writes.length).toBeGreaterThanOrEqual(3); // conflict -> retry
  });

  it("a failed save surfaces honestly and does not poison the store for later saves", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    blob.failNextWrite = new Error("BLOB_SERVICE_UNAVAILABLE");
    await expect(store.save(workspaceWithRuns(1, "A").toSnapshot())).rejects.toThrow("BLOB_SERVICE_UNAVAILABLE");
    // The next save still runs (a rejected predecessor must not skip every later write).
    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    expect(blob.body()).toBeDefined();
  });

  it("treats a missing blob as 'no workspace yet' and a corrupt snapshot as no crash", async () => {
    const empty = new FakeBlob();
    expect(await new VercelBlobStore(empty.client()).load()).toBeUndefined();

    const corrupt = new FakeBlob();
    corrupt.put("{ this is not json");
    expect(await new VercelBlobStore(corrupt.client()).load()).toBeUndefined();

    // A corrupt remote also must not discard OUR in-memory state during save.
    const store = new VercelBlobStore(corrupt.client());
    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    const after = JSON.parse(corrupt.body()!) as { researches: readonly unknown[] };
    expect(after.researches.length).toBe(1);
  });

  it("hydrates every retained run and its record after a cold start (no eviction, no loss)", async () => {
    const blob = new FakeBlob();
    await new VercelBlobStore(blob.client()).save(workspaceWithRuns(150, "A").toSnapshot());

    const cold = (await new VercelBlobStore(blob.client()).load())!;
    const ids = runIdsOf(cold.toSnapshot());
    expect(ids.length).toBe(150);
    expect(cold.getResearchResponse(ids[0]!)).toBeDefined(); // oldest run's record retained
    expect(cold.getResearchResponse(ids[ids.length - 1]!)).toBeDefined();
  });

  it("auto-detects the store's access mode and remembers it", async () => {
    const blob = new FakeBlob();
    blob.acceptAccess = "public"; // the store is actually public; our preferred mode is private
    const store = new VercelBlobStore(blob.client());
    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    expect(await store.load()).toBeDefined();
    expect(blob.writes.every((w) => w.access === "public")).toBe(true);

    // Detection is remembered: later reads go straight to the working mode.
    const cold = new VercelBlobStore(blob.client());
    expect(await cold.load()).toBeDefined();
  });

  it("reads the snapshot from origin storage, never a CDN copy, and keeps it out of long caches", async () => {
    // The option builders are the single place this is decided, so assert them directly.
    expect(snapshotReadOptions().useCache).toBe(false);
    expect(snapshotWriteOptions().cacheControlMaxAge).toBe(SNAPSHOT_CACHE_CONTROL_MAX_AGE_SECONDS);
    expect(SNAPSHOT_CACHE_CONTROL_MAX_AGE_SECONDS).toBeLessThanOrEqual(60); // a mutable snapshot, not a month

    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    await new VercelBlobStore(blob.client()).load();

    expect(blob.reads.length).toBeGreaterThan(0);
    expect(blob.reads.every((r) => r.options.useCache === false)).toBe(true);
    expect(blob.writes.every((w) => w.options?.cacheControlMaxAge === SNAPSHOT_CACHE_CONTROL_MAX_AGE_SECONDS)).toBe(true);
  });

  it("a CDN-cached stale snapshot can never erase a run written by another instance", async () => {
    // Production failure mode: get() defaults to useCache:true and a blob is cached for up to
    // a month, so a merge could read a copy that predated another instance's run — and the
    // write (conditioned on that stale ETag) either dropped the run or failed outright.
    const blob = new CdnCachedBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    blob.primeCache(); // the CDN now holds A's snapshot

    // Another instance completes a run: origin storage moves on, the CDN copy does not.
    const other = new VercelBlobStore(blob.client());
    await other.save(workspaceWithRuns(1, "B").toSnapshot());

    // Our (stale-in-memory) instance saves its own run: B's run must survive.
    await store.save(workspaceWithRuns(1, "C").toSnapshot());

    const restored = (await new VercelBlobStore(blob.client()).load())!;
    const objectives = restored.listResearch().map((r) => r.objective);
    expect(objectives.filter((o) => o.startsWith("A ")).length).toBe(1);
    expect(objectives.filter((o) => o.startsWith("B ")).length).toBe(1);
    expect(objectives.filter((o) => o.startsWith("C ")).length).toBe(1);
    // The cache was never consulted (that is the fix); the stale copy was never trusted.
    expect(blob.staleReads).toBe(0);
  });

  it("bounds every blob operation: a hung transport fails fast instead of stalling the invocation", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client(), { ioTimeoutMs: 40 });
    blob.hangWrites = true;
    await expect(store.save(workspaceWithRuns(1, "A").toSnapshot())).rejects.toBeInstanceOf(BlobIoTimeoutError);
    // The default budget is a real ceiling, not zero.
    expect(BLOB_IO_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);

    // The hung operation did not poison the queue: the next save runs normally.
    blob.hangWrites = false;
    await store.save(workspaceWithRuns(1, "A").toSnapshot());
    expect(blob.body()).toBeDefined();
  });

  it("never writes a snapshot that drops the other instance's retained records", async () => {
    const blob = new FakeBlob();
    const instanceA = new VercelBlobStore(blob.client());
    resetIdCounters();
    const wsA = workspaceWithRuns(1, "A");
    const aRun = runIdsOf(wsA.toSnapshot())[0]!;
    await instanceA.save(wsA.toSnapshot());

    bumpIdCounterPast("rs", 100);
    const instanceB = new VercelBlobStore(blob.client());
    await instanceB.save(workspaceWithRuns(1, "B").toSnapshot());

    const cold = (await new VercelBlobStore(blob.client()).load())!;
    expect(cold.getResearchResponse(aRun)).toEqual({ marker: "A", i: 0 });
    expect(cold.getResearchResponse(runIdsOf(cold.toSnapshot()).find((id) => id !== aRun)!)).toEqual({ marker: "B", i: 0 });
  });
});
