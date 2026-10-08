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
  /**
   * FOLLOW-UP LINEAGE: the run this submission continues (undefined = ROOT), and its depth.
   * Stamped onto every Research object the submission creates so a follow-up is durably a
   * CHILD of its parent — history nests it there instead of listing it as unrelated research.
   */
  readonly parentResearchId?: string;
  readonly followUpDepth?: number;
  /**
   * EXECUTION MODE (follow-up contract): how THIS submission is allowed to execute.
   * ROOT_RESEARCH = a fresh investigation (full planner + retrieval).
   * FOLLOW_UP_EVIDENCE_ONLY = a continuation that must synthesize from the parent's existing
   * evidence and findings — NO new external retrieval, NO root research planner, NO fresh
   * requirement expansion, NO independent flow classification.
   * FOLLOW_UP_WITH_NEW_RESEARCH = a continuation that may retrieve (the default follow-up).
   * Determined by the application layer from the trader's own words + parent context, and
   * enforced at the orchestration layer — never left to prompt wording (FOLLOW_UP +
   * EVIDENCE_ONLY = NO_NEW_RETRIEVAL).
   */
  readonly executionMode?: ResearchExecutionMode;
}

/** The execution mode a submission runs under (see ResearchRun.executionMode). */
export type ResearchExecutionMode =
  | "ROOT_RESEARCH"
  | "FOLLOW_UP_EVIDENCE_ONLY"
  | "FOLLOW_UP_WITH_NEW_RESEARCH";

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
