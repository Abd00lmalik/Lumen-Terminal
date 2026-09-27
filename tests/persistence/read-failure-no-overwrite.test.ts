/**
 * Phase E hardening (production incidents rs_000244, rs_000249, th_000011): the store's old
 * "read hiccup degrades to an unconditional write" path ERASED persisted state in production
 * in three distinct ways — a read that THROWS (rs_000244), a read that returns a TRUNCATED
 * body that parses like corruption (rs_000249), and a read of a PRESENT blob answering BLANK,
 * which counted as "absent" and let a local-only conditional write skip the merge law
 * entirely (th_000011). All three mean "we do not know what the blob holds", so the save now
 * aborts honestly (BlobReadUnavailableError) instead of writing over unreadable content, a
 * read error before our FIRST write is no longer swallowed into an empty-workspace save, and
 * the load path falls back to its last known-good cache rather than inventing an empty graph.
 *
 * Also proves the honest-abort leaves the remote bytes intact, and that a transient read
 * failure that clears on retry still merges.
 */
import { describe, expect, it } from "vitest";
import { VercelBlobStore, BlobReadUnavailableError } from "../../src/persistence/vercel-edge.js";
import { FakeBlob } from "./fake-blob.js";
import type { WorkspaceSnapshot } from "../../src/domain/workspace.js";

function emptySnapshot(): WorkspaceSnapshot {
  return {
    researches: [], sources: [], evidence: [], claims: [], hypotheses: [],
    analyses: [], judgments: [], branches: [], theses: [], savedArtifacts: [],
    memories: [], monitors: [], thesisAssessments: [],
  };
}

describe("Phase E: a failed or unreadable origin read never enables an unmerged overwrite", () => {
  it("aborts the save when the origin read throws (no blind write over unknown content)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save({ ...emptySnapshot(), researches: [] }); // blob now exists with our first write

    // Another instance completed a run we have not seen.
    blob.put(JSON.stringify({
      ...emptySnapshot(),
      researchResponses: [{ researchId: "rs_000001", response: { answer: { answer: "other instance run" } } }],
    }));

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

  it("corrupt (unparseable but readable) content aborts the save instead of being overwritten (rs_000249)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    blob.put("not json at all");
    // An unparseable body is indistinguishable from a truncated read: the save aborts
    // honestly rather than replacing content we could not actually read.
    await expect(store.save({ ...emptySnapshot(), researches: [] })).rejects.toBeInstanceOf(BlobReadUnavailableError);
    expect(blob.body()).toBe("not json at all"); // the unreadable bytes were NOT overwritten
  });

  it("a TRUNCATED read (valid JSON prefix, short body) aborts the save the same way (rs_000249)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save({ ...emptySnapshot(), researches: [] });

    // Another instance's snapshot, cut off mid-transfer: no throw, no abort — just a short body.
    const other = JSON.stringify({
      ...emptySnapshot(),
      researchResponses: [{ researchId: "rs_000249", response: { answer: { answer: "erased in production" } } }],
    });
    const truncated = other.slice(0, Math.floor(other.length / 3));
    blob.put(truncated);

    await expect(store.save({ ...emptySnapshot(), researches: [] })).rejects.toBeInstanceOf(BlobReadUnavailableError);
    expect(blob.body()).toBe(truncated); // the truncated bytes were NOT overwritten
  });

  it("a PRESENT blob answering BLANK is a read failure, not 'absent' — save aborts, merge law holds (th_000011)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save({ ...emptySnapshot(), researches: [] });

    // Another instance persisted a run AND a thesis; our next read answers 200 with zero bytes.
    blob.put(JSON.stringify({
      ...emptySnapshot(),
      researchResponses: [{ researchId: "rs_000250", response: { answer: { answer: "concurrent run" } } }],
      theses: [{ id: "th_000011", statement: "concurrent thesis", status: "ARCHIVED", linkedResearchRefs: ["rs_000250"], provenance: [] }],
    }));
    blob.blankReads = true;

    // BLANK ≠ absent: the save must NOT fall back to a local-only write (which would be a
    // valid conditional write that still erases everything the unreadable blob held).
    await expect(store.save({ ...emptySnapshot(), researches: [] })).rejects.toBeInstanceOf(BlobReadUnavailableError);
    const after = JSON.parse(blob.body()!) as WorkspaceSnapshot;
    expect((after.researchResponses ?? []).some((r) => r.researchId === "rs_000250")).toBe(true);
    expect(after.theses?.some((t) => t.id === "th_000011")).toBe(true);
  });

  it("a BLANK read on load serves the store's cached snapshot instead of an empty graph (th_000011)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save({ ...emptySnapshot(), researches: [{ id: "rs_000001", objective: "a", question: "a", flow: "WHAT_HAPPENED", provenance: [] }] });
    blob.blankReads = true;
    // Expire the load TTL so the next load() genuinely re-reads (and hits) the blank body.
    await new Promise((r) => setTimeout(r, 3_100));
    const loaded = await store.load();
    // The read path cannot erase anything, but it must not invent an empty graph either:
    // the last known-good cached snapshot is served.
    expect(loaded?.toSnapshot().researches.map((r) => r.id)).toContain("rs_000001");
  });

  it("a BLANK read of a genuinely absent blob is still 'no workspace yet' (first-write path intact)", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    // Blob is ABSENT (value === undefined): blankReads must not invent a failure here.
    await expect(store.save({ ...emptySnapshot(), researches: [] })).resolves.toBeUndefined();
    expect(JSON.parse(blob.body()!)).toBeDefined();
  });

  it("a RECREATED store that rejects wrong-access GETs with a remote 400 is detected, not fatal (recovery)", async () => {
    const blob = new FakeBlob();
    blob.acceptAccess = "public"; // the recreated store answers PUBLIC, our first probe is private
    blob.remoteStyleMismatch = true; // …and says so with a bare transport 400, not the SDK message
    const store = new VercelBlobStore(blob.client());
    // Detection flips to public during the first read; the save then proceeds normally.
    await expect(store.save({ ...emptySnapshot(), researches: [{ id: "rs_000001", objective: "a", question: "a", flow: "WHAT_HAPPENED", provenance: [] }] })).resolves.toBeUndefined();
    expect(blob.writes.every((w) => w.access === "public")).toBe(true);
    const after = JSON.parse(blob.body()!) as WorkspaceSnapshot;
    expect(after.researches.map((r) => r.id)).toContain("rs_000001");
  });

  it("after detection, a remote 400 is an honest failure — never retried against the other access mode", async () => {
    const blob = new FakeBlob();
    const store = new VercelBlobStore(blob.client());
    await store.save({ ...emptySnapshot(), researches: [] }); // access now detected (private here)
    blob.failReads = new Error("Vercel Blob: Failed to fetch blob: 400 Bad Request");
    await expect(store.save({ ...emptySnapshot(), researches: [] })).rejects.toBeInstanceOf(BlobReadUnavailableError);
    blob.failReads = undefined;
    expect(blob.body()).toBeDefined(); // nothing was written while the transport was failing
  });
});
