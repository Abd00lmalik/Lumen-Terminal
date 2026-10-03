/**
 * Active-research selection (state-isolation law).
 *
 * A research result belongs to exactly ONE researchId, and the ACTIVE view may render only
 * data belonging to the active research. The live failure this encodes: submitting a new
 * question while the previous run's answer/judgment/evidence were still on screen — the
 * previous result appeared as the answer to the new question.
 *
 * Rules (deterministic, DOM-free so they are unit-testable):
 * 1. While a run is in flight, NO previously completed turn is the active result: the active
 *    area is the running research only. Previous turns are archival rows.
 * 2. A user-selected run (history click / linked ref) is the active result, when one is set.
 * 3. Otherwise the newest completed turn with a research identity is the active result.
 * 4. The workspace rail may show a research's judgment/state ONLY when that research IS the
 *    active result; a stale snapshot never renders beside a new question.
 */

export interface IdentifiedTurn {
  readonly question: string;
  readonly requestId: string;
  /** Backend research reference (rs_xxx) when the response carried one. */
  readonly researchRef?: string;
  readonly degraded?: boolean;
}

export interface ActiveViewInput {
  readonly turns: readonly IdentifiedTurn[];
  /** Research explicitly selected by the user (history click or a linked URL ref). */
  readonly viewedRef?: string;
  /** Research identity of the live stream result, when the stream has completed. */
  readonly liveRef?: string;
  readonly running: boolean;
}

/** Identity of the turn that may render as the ACTIVE result, or undefined (none). */export function selectActiveTurnRef(input: ActiveViewInput): string | undefined {
  if (input.running) return undefined; // rule 1: a new run owns the active area
  // rule 2 (revised): a JUST-COMPLETED run outranks an earlier explicit selection. The
  // acceptance failure was a finished run that never became the active result because the
  // trader had once clicked a History entry — so the new answer was there but collapsed, and
  // the only way to see it was to go back to History and click it again.
  if (input.liveRef !== undefined && input.liveRef !== "") return input.liveRef;
  if (input.viewedRef !== undefined && input.viewedRef !== "") return input.viewedRef;
  // rule 3: newest turn carrying an identity
  for (let i = input.turns.length - 1; i >= 0; i -= 1) {
    const ref = input.turns[i]?.researchRef;
    if (ref !== undefined && ref !== "") return ref;
  }
  return undefined;
}

/**
 * WORKSPACE LIFECYCLE (investigation UI state, Phase D).
 *
 * The browser acceptance found the composer and the context rail disagreeing with each other:
 * one rail said "No active research" while another displayed "Investigation / Why did Bitcoin
 * move down today? / 2 research runs", and "New research" left the composer in follow-up mode
 * over a thread the trader had walked away from.
 *
 * That contradiction had a single cause: the page inferred its state from WHETHER A RUN WAS
 * ACTIVE, and read two different sources of truth for "current". A completed investigation has
 * no active run and is still correctly the current investigation; after an explicit New research
 * there is no current investigation even though previous ones exist in History. Neither case is
 * decidable from run status alone, so the five states are named here and computed ONCE.
 */
export type WorkspaceLifecycle =
  /** No current investigation: clean composer, nothing displayed. */
  | "NO_INVESTIGATION"
  /** An investigation is current and a run is in flight. */
  | "RUNNING"
  /** A current investigation whose latest run is still in flight (composer locked to it). */
  | "INVESTIGATION_RUNNING"
  /** A current investigation with at least one usable completed run: the report is displayed. */
  | "COMPLETED"
  /** A current investigation with no completed run yet: the thread exists, nothing to show. */
  | "READY_FOR_FOLLOWUP";

export interface LifecycleInput {
  /** The investigation the backend reports as current (undefined = none). */
  readonly currentInvestigationRef?: string;
  /** Whether that investigation has at least one COMPLETED, usable research run. */
  readonly hasCompletedRun: boolean;
  /** Whether a research run is in flight right now. */
  readonly running: boolean;
  /** An explicit New research was just pressed: no current investigation until the next ask. */
  readonly resetPending: boolean;
}

/**
 * The ONE lifecycle computation. Every surface (composer label, CTA, context rail, report
 * visibility) reads this instead of re-deriving its own notion of "current".
 */
export function workspaceLifecycle(input: LifecycleInput): WorkspaceLifecycle {
  // An explicit reset wins over everything the backend still reports: the trader said "start
  // over", and a stale pointer must not put them back in the previous thread.
  if (input.resetPending) return "NO_INVESTIGATION";
  if (input.currentInvestigationRef === undefined || input.currentInvestigationRef === "") return "NO_INVESTIGATION";
  if (input.running) return "INVESTIGATION_RUNNING";
  if (input.hasCompletedRun) return "COMPLETED";
  return "READY_FOR_FOLLOWUP";
}

/** May the composer offer follow-up? Only inside a current investigation that has results. */
export function followUpAllowed(lifecycle: WorkspaceLifecycle): boolean {
  return lifecycle === "COMPLETED" || lifecycle === "READY_FOR_FOLLOWUP";
}

/**
 * The displayed report's research ref, or undefined when the active area shows a running
 * investigation and nothing has completed yet.
 *
 * A completed investigation shows its newest completed run. The previous "newest turn with an
 * identity" rule could render a COMPLETED run as the active result even after the trader had
 * explicitly selected a different one from History.
 */
export function reportRefForLifecycle(input: {
  readonly lifecycle: WorkspaceLifecycle;
  readonly completedRunRefs: readonly string[];
}): string | undefined {
  if (input.lifecycle !== "COMPLETED") return undefined;
  return input.completedRunRefs[input.completedRunRefs.length - 1];
}

/**
 * Whether a navigation state carries the explicit "New research" handoff (D6). The shell's
 * New research button used to call a bare navigate("/research"), which is a no-op on the
 * same route: the previous thread, viewed run and completed stream all survived. The flag is
 * strict (only `true` counts) so unrelated navigation state (e.g. the home hero's
 * `{ question }`) can never trigger a reset.
 */
export function isNewResearchRequest(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { newResearch?: unknown }).newResearch === true;
}

/** Is this turn the expanded active result (as opposed to an archival row)? */
export function isExpandedTurn(turn: IdentifiedTurn, activeRef: string | undefined, running: boolean): boolean {
  if (running) return false; // rule 1
  if (activeRef === undefined) return false;
  return turn.researchRef === activeRef;
}

export interface RailScopeInput {
  readonly running: boolean;
  /** Research ref of the workspace snapshot's active research (if any). */
  readonly snapshotRef?: string;
  readonly activeRef?: string;
}

/**
 * Whether the workspace rail (research state + current judgment + evidence counts) belongs
 * to the active research. While a run is in flight, or when the snapshot describes a
 * different research, the rail must not present that research's judgment as current.
 */
export function railBelongsToActive(input: RailScopeInput): boolean {
  if (input.running) return false;
  if (input.activeRef === undefined || input.snapshotRef === undefined) return false;
  return input.snapshotRef === input.activeRef;
}
