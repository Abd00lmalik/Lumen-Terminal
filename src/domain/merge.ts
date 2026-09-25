/**
 * Snapshot merge (multi-instance persistence law).
 *
 * Serverless warm instances hold independent Workspace graphs. A stale instance that
 * saves blindly ERASES runs another instance completed in the meantime (observed live:
 * history shrank between reads and fresh answers degraded to bare summaries). The merge
 * rule is a UNION of every collection with per-object last-write-wins, never whole-
 * snapshot replacement:
 *
 * - keyed collections (researches, evidence, ...): union by id; when an id exists on both
 *   sides, the side whose object carries MORE history entries is newer (history is
 *   append-only and every mutation appends — object-lifecycle-state-machine.md), so more
 *   history = later state. Equal history keeps the LOCAL side (our in-flight writes win).
 * - researchResponses: union by researchId (final answers are immutable once written).
 * - activeThesisId: the side with the newer active-thesis research wins; ties keep local.
 * - id-counter continuity is preserved by unioning (ids are minted monotonically).
 *
 * Provenance is never rewritten: merged objects are exactly the objects some instance
 * persisted, so every sourceRef/provenance chain stays intact.
 */

import type { WorkspaceSnapshot } from "./workspace.js";

interface WithProvenance {
  readonly id: string;
  readonly provenance?: readonly unknown[];
  readonly history?: readonly unknown[];
}

/** Number of recorded lifecycle events (provenance entries + history notes); append-only, so monotonic. */
function revisions(o: WithProvenance): number {
  return (o.provenance?.length ?? 0) + (o.history?.length ?? 0);
}

/** Union two snapshots into a merged snapshot; `local` wins ties. */
export function mergeSnapshots(local: WorkspaceSnapshot, remote: WorkspaceSnapshot): WorkspaceSnapshot {
  const mergeById = <T extends WithProvenance>(
    localItems: readonly T[],
    remoteItems: readonly T[] | undefined,
  ): T[] => {
    const byId = new Map<string, T>();
    for (const item of localItems) byId.set(item.id, item);
    for (const item of remoteItems ?? []) {
      const existing = byId.get(item.id);
      // Remote wins ONLY when strictly newer (more history); equal keeps local.
      if (existing === undefined || revisions(item) > revisions(existing)) byId.set(item.id, item);
    }
    return [...byId.values()];
  };

  // Run records: union by researchId. A missing local record (another instance completed
  // that run while we were idle) is filled from remote; an EXISTING local record keeps the
  // local side (our in-flight write wins — the saving instance holds the fresher state),
  // matching the per-object rule above. Records are immutable once written, so both sides
  // normally hold the identical value.
  const mergedResponses = new Map<string, unknown>(
    (remote.researchResponses ?? []).map((r) => [r.researchId, r.response]),
  );
  for (const r of local.researchResponses ?? []) mergedResponses.set(r.researchId, r.response);

  // Active-thesis selection: prefer the side whose chosen thesis exists in the union.
  const mergedTheses = mergeById(local.theses, remote.theses);
  const thesisIds = new Set(mergedTheses.map((t) => t.id));
  const activeThesisId =
    local.activeThesisId !== undefined && thesisIds.has(local.activeThesisId)
      ? local.activeThesisId
      : remote.activeThesisId !== undefined && thesisIds.has(remote.activeThesisId)
        ? remote.activeThesisId
        : undefined;

  return {
    researches: mergeById(local.researches, remote.researches),
    sources: mergeById(local.sources, remote.sources),
    evidence: mergeById(local.evidence, remote.evidence),
    claims: mergeById(local.claims, remote.claims),
    hypotheses: mergeById(local.hypotheses, remote.hypotheses),
    analyses: mergeById(local.analyses, remote.analyses),
    judgments: mergeById(local.judgments, remote.judgments),
    branches: mergeById(local.branches, remote.branches),
    theses: mergedTheses,
    savedArtifacts: mergeById(local.savedArtifacts, remote.savedArtifacts),
    memories: mergeById(local.memories, remote.memories),
    monitors: mergeById(local.monitors, remote.monitors),
    thesisAssessments: [...(remote.thesisAssessments ?? []), ...(local.thesisAssessments ?? [])],
    ...(activeThesisId !== undefined ? { activeThesisId } : {}),
    ...(mergedResponses.size > 0
      ? { researchResponses: [...mergedResponses.entries()].map(([researchId, response]) => ({ researchId, response })) }
      : {}),
  };
}
