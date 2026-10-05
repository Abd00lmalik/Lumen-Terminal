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

  // CURRENT INVESTIGATION (working-state pointer, single-trader workbench).
  //
  // This pointer was previously omitted from the merged result on the theory that "which
  // thread the trader is in" is local state and one instance must not drag another into it.
  // That reasoning is sound for a MULTI-TRADER system and wrong for this one: omitting the
  // field does not make it instance-local, it makes it UNREACHABLE. Every persisted write
  // goes through this merge, so the pointer was dropped on EVERY production save — after the
  // first completed run the restored workspace had no current investigation, so no
  // investigation reported `isCurrent`, so the UI read the thread as absent and showed
  // "Research" + "No active research" over a live investigation with completed runs.
  // Measured: local `inv_000001` → merged `undefined` → every `isCurrent` false.
  //
  // The pointer is resolved the same way as every other selection field: the LOCAL side wins
  // when it names an investigation that exists in the union, because the local instance is
  // the one that just acted on the trader's behalf (the write that triggered this merge).
  // Otherwise the remote pointer is kept if its investigation survives the union. A pointer
  // naming an investigation neither side still holds is dropped rather than resurrected into
  // a dangling thread — this can only happen if that investigation was deleted.
  const mergedInvestigationIds = new Set(mergeById(local.investigations ?? [], remote.investigations ?? []).map((i) => i.id));
  const currentInvestigationId =
    local.currentInvestigationId !== undefined && mergedInvestigationIds.has(local.currentInvestigationId)
      ? local.currentInvestigationId
      : remote.currentInvestigationId !== undefined && mergedInvestigationIds.has(remote.currentInvestigationId)
        ? remote.currentInvestigationId
        : undefined;

  // Active-thesis selection: prefer the side whose chosen thesis exists in the union.
  const mergedTheses = mergeById(local.theses, remote.theses);
  const thesisIds = new Set(mergedTheses.map((t) => t.id));
  const activeThesisId =
    local.activeThesisId !== undefined && thesisIds.has(local.activeThesisId)
      ? local.activeThesisId
      : remote.activeThesisId !== undefined && thesisIds.has(remote.activeThesisId)
        ? remote.activeThesisId
        : undefined;

  // Phase C unsave tombstones: union both sides, then DROP any saved artifact whose id the
  // trader explicitly unsaved. Without this a stale instance's union would resurrect a
  // removed artifact (the merge is per-object last-write-wins, not a deletion system).
  const mergedTombstones = new Map<string, string>();
  for (const t of remote.savedTombstones ?? []) mergedTombstones.set(t.id, t.at);
  for (const t of local.savedTombstones ?? []) mergedTombstones.set(t.id, t.at);
  const mergedSavedArtifacts = mergeById(local.savedArtifacts, remote.savedArtifacts)
    .filter((a) => !mergedTombstones.has(a.id));

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
    savedArtifacts: mergedSavedArtifacts,
    ...(mergedTombstones.size > 0
      ? { savedTombstones: [...mergedTombstones.entries()].map(([id, at]) => ({ id, at })) }
      : {}),
    memories: mergeById(local.memories, remote.memories),
    monitors: mergeById(local.monitors, remote.monitors),
    thesisAssessments: mergeById(local.thesisAssessments, remote.thesisAssessments),
    challenges: mergeById(local.challenges ?? [], remote.challenges ?? []),
    // Phase H: assessments and notifications are immutable records → union by id (idempotent
    // across instances; checkId dedup happens at creation). Monitor objects merge like theses.
    monitoringAssessments: mergeById(local.monitoringAssessments ?? [], remote.monitoringAssessments ?? []),
    monitorNotifications: mergeById(local.monitorNotifications ?? [], remote.monitorNotifications ?? []),
    // CONVERSATION MERGE: investigations are append-only threads (union by id, the more-revised
    // object wins); turns are immutable records (union by id). Merging by ARRAY CONCAT would
    // duplicate every turn on each multi-instance merge — the exact bug Phase G hit with thesis
    // assessments. `currentInvestigationId` IS merged (see the CURRENT INVESTIGATION block
    // above): it is a single-trader workbench pointer, and dropping it on write made every
    // persisted investigation un-current after a reload.
    investigations: mergeById(local.investigations ?? [], remote.investigations ?? []),
    conversationTurns: mergeById(local.conversationTurns ?? [], remote.conversationTurns ?? []),
    ...(currentInvestigationId !== undefined ? { currentInvestigationId } : {}),
    ...(activeThesisId !== undefined ? { activeThesisId } : {}),
    ...(mergedResponses.size > 0
      ? { researchResponses: [...mergedResponses.entries()].map(([researchId, response]) => ({ researchId, response })) }
      : {}),
  };
}
