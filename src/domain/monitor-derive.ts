/**
 * Phase H: derive MONITORING CONDITIONS from Challenge records (§5 core product behavior).
 *
 * The model may propose emphases, but the CONDITIONS come from existing workspace objects:
 * active challenges/falsifiers, thesis assumptions/invalidation conditions, unresolved gaps.
 * Conditions keep `conditionStatus` honest (DERIVED_FROM_THESIS vs PROPOSED) and stay
 * linked to their challenge so a later challenge change can be surfaced (§17), never
 * silently absorbed.
 */
import type { Workspace } from "./workspace.js";
import type { MonitorCondition } from "./memory.js";
import type { Challenge } from "./challenge.js";

/** Map a Challenge status/falsifier to the monitor condition kind (invalidation vs warning). */
function kindFor(challenge: Challenge): MonitorCondition["kind"] {
  if (challenge.falsifier.materiality === "INVALIDATING" || challenge.falsifier.materiality === "MATERIAL_CONTRADICTION") return "INVALIDATION";
  return "EARLY_WARNING";
}

function triggerTypeFor(challenge: Challenge): MonitorCondition["triggerType"] {
  if (challenge.counterEvidenceRefs.length > 0) return "CONTRADICTION";
  if (challenge.conditionObserved) return "STATE_CHANGE";
  if (challenge.falsifier.origin === "DERIVED_FROM_BELIEF") return "THRESHOLD";
  return "NEW_EVIDENCE";
}

/**
 * Build monitoring conditions from a workspace's challenge set for a thesis. Conditions are
 * DEDUPLICATED by falsifier condition text (one challenge = one watched condition); each
 * carries its challengeRef in evidenceDependencies as a typed linkage (challengeRef is also
 * stored at the monitor level via `linkedChallengeRefs`).
 */
export function conditionsFromChallenges(workspace: Workspace, thesisId: string): { conditions: readonly MonitorCondition[]; challengeRefs: readonly string[] } {
  const challenges = workspace.listChallenges(thesisId);
  const conditions: MonitorCondition[] = [];
  const challengeRefs: string[] = [];
  const seen = new Set<string>();
  for (const challenge of challenges) {
    if (challenge.status === "RESOLVED") continue; // a resolved challenge is not an active watch
    const key = challenge.falsifier.condition.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    challengeRefs.push(challenge.id);
    conditions.push({
      description: challenge.falsifier.condition,
      kind: kindFor(challenge),
      triggerType: triggerTypeFor(challenge),
      conditionStatus: challenge.falsifier.origin === "DERIVED_FROM_BELIEF" ? "DERIVED_FROM_THESIS" : "PROPOSED",
      rationale: challenge.materialityRationale,
      // Typed linkage: the challenge this condition watches (§17: challenge changes surface
      // to the user; the monitor never silently rewrites its conditions).
      evidenceDependencies: [challenge.id],
    });
  }
  return { conditions, challengeRefs };
}
