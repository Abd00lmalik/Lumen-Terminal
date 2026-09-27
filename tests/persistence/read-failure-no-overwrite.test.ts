/**
 * Phase E hardening (production incident rs_000244): the store's old "read hiccup degrades
 * to an unconditional write" path ERASED a completed run in production — a read that THROWS
 * means we do not know what the blob holds, so an unmerged write is a lost-update with the
 * failure hidden. The fix aborts the save honestly (BlobReadUnavailableError) instead of
 * writing over unreadable content, and a read error before our FIRST write is no longer
 * swallowed into an empty-workspace save.
 *
 * Also proves the recovery-write path stays available: content that READS fine but does not
 * PARSE (corruption) is still replaced by a valid snapshot, and a transient read failure
 * that clears on retry still merges.
 */
import { describe, expect, it } from "vitest";
import { VercelBlobStore, BlobReadUnavailableError } from "../../src/persistence/vercel-edge.js";
import { FakeBlob } from "./fake-blob.js";
import { Workspace, type WorkspaceSnapshot } from "../../src/domain/workspace.js";

function emptySnapshot(): WorkspaceSnapshot {
  return {
    researches: [], sources: [], evidence: [], claims: [], hypotheses: [],
    analyses: [], judgments: [], branches: [], theses: [], savedArtifacts: [],
    memories: [], monitors: [], thesisAssessments: [],
  };
}

describe("Phase E: a failed origin read never enables an unmerged overwrite", () => {
  it("aborts the save when the origin read throws (no blind write over unknown content)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    const existing = { ...emptySnapshot(), researches: [] };
    await store.save(existing); // blob now exists with our first write

    // Another instance completed a run we have not seen.
    const other = Workspace.fromSnapshot(existing);
    void other;
    const remote = { ...emptySnapshot(), researches: [] };
    blob.put(JSON.stringify({ ...remote, researches: [], researchResponses: [{ researchId: "rs_000001", response: { answer: { answer: "other instance run" } } }] }));

    // Our reads now fail at the transport level; writes would still "work" — that is the trap.
    blob.failReads = new Error("read timeout");
    await expect(store.save({ ...emptySnapshot(), researches: [] })).rejects.toBeInstanceOf(BlobReadUnavailableError);
    // The other instance's record is still intact: we did NOT write blind.
    const after = JSON.parse(blob.body()!) as WorkspaceSnapshot;
    expect((after.researchResponses ?? []).some((r) => r.researchId === "rs_000001")).toBe(true);
  });

  it("a read failure before the first write is NOT swallowed into an empty-workspace save", async () => {
    const blob = new FakeBlob();
    blob.failReads = new Error("network unreachable");
    const store = new VercelBlobStore(blob.client());
    await expect(store.save({ ...emptySnapshot(), researches: [] })).rejects.toBeInstanceOf(BlobReadUnavailableError);
    expect(blob.body()).toBeUndefined(); // nothing was written over the unreadable store
  });

  it("a transient read failure that clears on retry still merges (write succeeds)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save({ ...emptySnapshot(), researches: [] });
    blob.put(JSON.stringify({ ...emptySnapshot(), researchResponses: [{ researchId: "rs_000009", response: { answer: { answer: "concurrent" } } }] }));
    blob.failReads = new Error("blip");
    blob.failReadsOnce = true; // clears after the first failing read → the retry succeeds
    await expect(store.save({ ...emptySnapshot(), researches: [] })).resolves.toBeUndefined();
    const after = JSON.parse(blob.body()!) as WorkspaceSnapshot;
    expect((after.researchResponses ?? []).some((r) => r.researchId === "rs_000009")).toBe(true);
  });

  it("corrupt (unparseable but readable) content is still replaced by a valid snapshot", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    blob.put("not json at all");
    await expect(store.save({ ...emptySnapshot(), researches: [] })).resolves.toBeUndefined();
    expect(JSON.parse(blob.body()!)).toBeDefined();
  });
});
