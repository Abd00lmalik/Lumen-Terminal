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

/** Identity of the turn that may render as the ACTIVE result, or undefined (none). */
export function selectActiveTurnRef(input: ActiveViewInput): string | undefined {
  if (input.running) return undefined; // rule 1: a new run owns the active area
  if (input.viewedRef !== undefined && input.viewedRef !== "") return input.viewedRef; // rule 2
  if (input.liveRef !== undefined && input.liveRef !== "") return input.liveRef;
  // rule 3: newest turn carrying an identity
  for (let i = input.turns.length - 1; i >= 0; i -= 1) {
    const ref = input.turns[i]?.researchRef;
    if (ref !== undefined && ref !== "") return ref;
  }
  return undefined;
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
