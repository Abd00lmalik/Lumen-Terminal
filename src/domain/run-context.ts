/**
 * Research RUN context (history law: one user submission = one history entry).
 *
 * A single user question legitimately spawns MANY internal workspace Research objects: the
 * action plan's steps (RESEARCH, ANALYZE, CHALLENGE) and flow phases each create one, with
 * an internal objective as their question text. Listing every such object as top-level
 * "history" is wrong — the trader asked ONE question and must see ONE entry
 * ("What is driving oil prices this week?"), never "Gather current market news..." /
 * "Synthesize the gathered factors...".
 *
 * `beginRun` is called by the application layer around a submission; every Research created
 * while a run is active is stamped with the run id and the trader's original question.
 * History groups members by run id and presents the run's answer-bearing member under the
 * trader's question, so internal steps stay children of the run (findable, never top-level).
 *
 * Scope note: one serverless invocation handles one request, so a module-scoped context is
 * correct here; the workspace (not this module) remains the durable source of truth.
 */

export interface ResearchRun {
  readonly runId: string;
  /** The trader's verbatim question — the only text history may show for the run. */
  readonly userQuestion: string;
  /**
   * INVESTIGATION CONVERSATION (conversational workbench): the conversation this submission is
   * part of. A run is still an ISOLATED execution — this is a REFERENCE to its thread, never an
   * ownership relationship. Two turns of one investigation get different runIds and different
   * investigation-scoped evidence; the id says where the turn happened, not what it may consume.
   */
  readonly investigationId?: string;
}

let active: ResearchRun | undefined;

export function beginRun(run: ResearchRun): void {
  active = run;
}

export function currentRun(): ResearchRun | undefined {
  return active;
}

/**
 * Clear the context; safe to call in a finally even when no run was begun.
 *
 * RACE SAFETY (async integrity): the clear is SCOPED to the run that began it. Two
 * overlapping submissions in one process would otherwise let the first request's `finally`
 * clear the SECOND request's active run, so every Research object the second run creates
 * after that moment would be stamped with no run id at all — an ungroupable, unowned object.
 * Ending a run that is no longer the active one is a no-op.
 */
export function endRun(runId?: string): void {
  if (runId !== undefined && active !== undefined && active.runId !== runId) return;
  active = undefined;
}
