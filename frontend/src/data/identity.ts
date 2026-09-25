/**
 * Run identity (Phase B / B1): the ref that LISTS a research run is the ref that OPENS it.
 *
 * The production history defect this module exists to prevent: the open affordance navigated
 * with the turn's `requestId` — a crypto UUID minted per submit — so `/research/<uuid>` could
 * never resolve and every history click fell through to "the linked research run could not be
 * loaded". Identity is decided HERE, once, as pure DOM-free logic so it is unit-testable.
 *
 * Object id vocabularies (src/domain/ids.ts): research `rs_`, branch `br_`, claim `cl_`,
 * evidence `ev_`, hypothesis `hy_`, judgment `jd_`, thesis `th_`, artifact `sa_`, memory
 * `mem_`, monitor `mon_`, run `run_`. Only a research ref names something the research
 * endpoint can open.
 */

/** A reference that names a research object (`rs_000001`). */
export function isResearchRef(ref: unknown): ref is string {
  return typeof ref === "string" && /^rs_/.test(ref);
}

/**
 * Canonical ref for OPENING a run, or undefined when the turn carries no research identity
 * (e.g. a transport failure turn) — in which case the UI must not offer an open affordance.
 */
export function runOpenRef(turn: { readonly researchRef?: string; readonly requestId?: string }): string | undefined {
  if (isResearchRef(turn.researchRef)) return turn.researchRef;
  // Degraded history summaries use the research ref as their turn identity.
  if (isResearchRef(turn.requestId)) return turn.requestId;
  return undefined;
}

/**
 * Stable identity of a turn: the research ref when the turn has one, else its request id.
 * Dedupe uses this — comparing request ids compared a UUID against a ref, never matched, and
 * appended a duplicate turn on every reopen.
 */
export function turnIdentity(turn: { readonly researchRef?: string; readonly requestId: string }): string {
  return isResearchRef(turn.researchRef) ? turn.researchRef : turn.requestId;
}

/**
 * Which turn wins when the same run arrives twice: a FULL record always beats a degraded one,
 * so a partial reconstruction never displaces the answer already on screen.
 */
export function preferTurn(
  existing: { readonly degraded?: boolean } | undefined,
  incoming: { readonly degraded?: boolean },
): "existing" | "incoming" {
  if (existing !== undefined && incoming.degraded === true && existing.degraded !== true) return "existing";
  return "incoming";
}
