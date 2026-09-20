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
}

let active: ResearchRun | undefined;

export function beginRun(run: ResearchRun): void {
  active = run;
}

export function currentRun(): ResearchRun | undefined {
  return active;
}

/** Clear the context; safe to call in a finally even when no run was begun. */
export function endRun(): void {
  active = undefined;
}
