/**
 * Phase D regression: TOMBSTONE COUNTER CONTINUITY.
 *
 * Production bug (live on asklumen.vercel.app): a saved artifact was created (POST /api/saved
 * → 201) yet every later GET returned `[]`, forever. Mechanism:
 *   1. earlier unsave/cleanup runs persisted `savedTombstones` for `sa_000001`..`sa_000003`;
 *   2. id counters were seeded from ARTIFACT ids only, so after the deletions the counter
 *      rewound and the next save re-minted a TOMBSTONED id (`sa_000001` again);
 *   3. the create then persisted, but every later merge (mergeSnapshots) and every absorb
 *      (absorbSavedState) — correctly applying the tombstone-wins law — dropped the new
 *      artifact whose id carried a tombstone. The blob byte-verified this: identical size
 *      before/after a real upload.
 * Fix: bump the `sa` counter past tombstoned ids on both load paths (fromSnapshot,
 * absorbSavedState), so a new artifact can never inherit a dead id. Tombstone semantics
 * themselves are untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { newId, idPrefixes, resetIdCounters } from "../../src/domain/ids.js";
import type { WorkspaceSnapshot } from "../../src/domain/workspace.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

/** Build a snapshot where `sa_000001`..`sa_000003` are tombstoned and no artifacts exist. */
function snapshotWithTombstones(): WorkspaceSnapshot {
  const ws = new Workspace();
  ws.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
  const base = ws.toSnapshot();
  return {
    ...base,
    savedArtifacts: [],
    savedTombstones: [
      { id: "sa_000001", at: "2026-09-26T00:00:00.000Z" },
      { id: "sa_000002", at: "2026-09-26T00:00:01.000Z" },
      { id: "sa_000003", at: "2026-09-26T00:00:02.000Z" },
    ],
  };
}

beforeEach(() => resetIdCounters());

describe("tombstone counter continuity (create-then-invisible production bug)", () => {
  it("a fresh save after unsaves NEVER mints a tombstoned id (the actual production sequence)", async () => {
    // Instance A holds the production state: three tombstones, no artifacts, counter not seeded.
    const storeWs = Workspace.fromSnapshot(snapshotWithTombstones());

    // The create path: absorb fresh state (as createSaved does), then save a new artifact.
    storeWs.absorbSavedState(snapshotWithTombstones());
    const research = storeWs.listResearch()[0]!;
    const { artifact } = storeWs.upsertSavedArtifact(
      { kind: "RESEARCH", researchRef: research.id, sourceRef: research.id, content: "fresh save" },
      trader,
    );
    // sa_000001..sa_000003 are DEAD ids; the new artifact must skip past all of them.
    expect(artifact.id).toBe("sa_000004");

    // The read path (what every later GET does): absorb the persisted state again.
    // Before the fix this deleted the fresh artifact (its id carried a tombstone) → GET [].
    storeWs.absorbSavedState(storeWs.toSnapshot());
    expect(storeWs.getSavedArtifact(artifact.id)).toBeDefined();
    expect(storeWs.listSavedArtifacts().map((a) => a.id)).toEqual([artifact.id]);
  });

  it("fromSnapshot (cold start) also seeds past tombstoned ids", () => {
    const ws = Workspace.fromSnapshot(snapshotWithTombstones());
    expect(ws.listSavedArtifacts()).toHaveLength(0); // tombstones still win
    expect(newId(idPrefixes.artifact)).toBe("sa_000004"); // not sa_000001 again
  });

  it("mergeSnapshots still enforces tombstone-wins for genuinely deleted ids (unchanged law)", () => {
    const local = Workspace.fromSnapshot(snapshotWithTombstones());
    const research = local.listResearch()[0]!;
    local.upsertSavedArtifact({ kind: "RESEARCH", researchRef: research.id, sourceRef: research.id, content: "alive" }, trader);
    const merged = mergeSnapshots(local.toSnapshot(), snapshotWithTombstones());
    // The fresh artifact uses a NEW id (no tombstone) → survives the merge…
    expect(merged.savedArtifacts).toHaveLength(1);
    // …while a stale artifact reusing a tombstoned id would still be dropped.
    const stale = Workspace.fromSnapshot(snapshotWithTombstones());
    const staleResearch = stale.listResearch()[0]!;
    stale.upsertSavedArtifact({ kind: "RESEARCH", researchRef: staleResearch.id, sourceRef: staleResearch.id, content: "stale resurrect" }, trader);
    const staleArtifact = { ...stale.listSavedArtifacts()[0]!, id: "sa_000002" };
    const resurrectMerged = mergeSnapshots(
      { ...local.toSnapshot(), savedArtifacts: [staleArtifact] },
      snapshotWithTombstones(),
    );
    expect(resurrectMerged.savedArtifacts).toHaveLength(0); // tombstone still wins over stale union
  });

  it("warm instance absorbs tombstones from another instance and skips the dead ids", () => {
    // Warm instance loaded BEFORE the tombstones existed, counter at sa_000003.
    const warm = new Workspace();
    warm.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const research = warm.listResearch()[0]!;
    for (let i = 0; i < 3; i += 1) {
      warm.upsertSavedArtifact({ kind: "RESEARCH", researchRef: research.id, sourceRef: `src-${i}`, content: `c${i}` }, trader);
    }
    expect(warm.listSavedArtifacts()).toHaveLength(3);

    // Another instance deleted all three; the warm instance absorbs that state.
    const other = Workspace.fromSnapshot(warm.toSnapshot());
    for (const a of other.listSavedArtifacts()) other.removeSavedArtifact(a.id);
    warm.absorbSavedState(other.toSnapshot());
    expect(warm.listSavedArtifacts()).toHaveLength(0);

    // The next save on the warm instance must NOT re-mint any deleted id.
    const { artifact } = warm.upsertSavedArtifact(
      { kind: "RESEARCH", researchRef: research.id, sourceRef: "src-new", content: "after unsave" },
      trader,
    );
    expect(["sa_000001", "sa_000002", "sa_000003"]).not.toContain(artifact.id);
    expect(artifact.id).toBe("sa_000004");
  });

  it("unsaving on the SAME workspace also protects its own future ids (local tombstone set)", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const { artifact } = ws.upsertSavedArtifact(
      { kind: "RESEARCH", researchRef: research.id, sourceRef: research.id, content: "c" },
      trader,
    );
    ws.removeSavedArtifact(artifact.id);
    const next = ws.upsertSavedArtifact(
      { kind: "RESEARCH", researchRef: research.id, sourceRef: "other", content: "c2" },
      trader,
    );
    expect(next.artifact.id).not.toBe(artifact.id);
    expect(ws.listSavedArtifacts().map((a) => a.id)).toEqual([next.artifact.id]);
  });
});
