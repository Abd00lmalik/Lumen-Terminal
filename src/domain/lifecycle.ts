/**
 * Object lifecycle state machines.
 *
 * Architectural basis: docs/architecture/object-lifecycle-state-machine.md
 * - Per-object lifecycles (research/branch/evidence/claim/hypothesis/judgment).
 * - "STALE does not mean INVALID. SUPERSEDED does not mean destroyed."
 * - Deletion is a state-management operation, not a lifecycle state.
 * - Invalid transitions must be rejected, not silently coerced.
 */

export type ObjectStatus =
  // universal vocabulary (subset used by M0 object kinds)
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "SUPERSEDED"
  | "STALE"
  | "INVALID"
  | "STOPPED"
  | "ARCHIVED"
  // object-specific states
  | "CANCELLED" // branch
  | "UNTESTED" // claim
  | "RESOLVED" // claim
  // evidentiary statuses (evidence)
  | "VERIFIED"
  | "CONTESTED"
  // hypothesis
  | "CANDIDATE"
  | "UNDER_INVESTIGATION"
  | "LEADING"
  | "SUPPORTED"
  | "WEAKENED"
  | "REJECTED"
  | "INCONCLUSIVE"
  | "HISTORICAL";

export type ObjectKind = "research" | "branch" | "evidence" | "claim" | "hypothesis" | "judgment";

const RESEARCH: ReadonlySet<ObjectStatus> = new Set([
  "DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "SUPERSEDED", "STALE", "INVALID", "STOPPED", "ARCHIVED",
]);

const BRANCH: ReadonlySet<ObjectStatus> = new Set([
  "DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "ARCHIVED",
]);

const EVIDENCE: ReadonlySet<ObjectStatus> = new Set([
  "ACTIVE", "VERIFIED", "CONTESTED", "STALE", "INVALID", "ARCHIVED",
]);

const CLAIM: ReadonlySet<ObjectStatus> = new Set(["UNTESTED", "ACTIVE", "RESOLVED", "ARCHIVED"]);

const HYPOTHESIS: ReadonlySet<ObjectStatus> = new Set([
  "CANDIDATE", "UNDER_INVESTIGATION", "LEADING", "SUPPORTED", "WEAKENED", "REJECTED",
  "INCONCLUSIVE", "HISTORICAL",
]);

const JUDGMENT: ReadonlySet<ObjectStatus> = new Set(["ACTIVE", "SUPERSEDED", "ARCHIVED"]);

const STATES_BY_KIND: Record<ObjectKind, ReadonlySet<ObjectStatus>> = {
  research: RESEARCH,
  branch: BRANCH,
  evidence: EVIDENCE,
  claim: CLAIM,
  hypothesis: HYPOTHESIS,
  judgment: JUDGMENT,
};

/**
 * Allowed status→status transitions per object kind (from the lifecycle spec, "typical transitions").
 * Partial per kind: each object kind uses only the states appropriate to its role.
 */
export const TRANSITIONS: Record<ObjectKind, Readonly<Partial<Record<ObjectStatus, readonly ObjectStatus[]>>>> = {
  research: {
    DRAFT: ["ACTIVE"],
    ACTIVE: ["PAUSED", "COMPLETED", "STOPPED", "STALE", "INVALID", "SUPERSEDED"],
    PAUSED: ["ACTIVE"],
    COMPLETED: ["SUPERSEDED", "STALE", "ARCHIVED"],
    STOPPED: ["ARCHIVED"],
    STALE: ["ACTIVE"],
    INVALID: ["ACTIVE"],
    SUPERSEDED: [],
    ARCHIVED: [],
  },
  branch: {
    DRAFT: ["ACTIVE"],
    ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
    PAUSED: ["ACTIVE"],
    COMPLETED: ["ARCHIVED"],
    CANCELLED: ["ARCHIVED"],
    ARCHIVED: [],
  },
  evidence: {
    ACTIVE: ["VERIFIED", "CONTESTED", "STALE", "INVALID"],
    VERIFIED: ["CONTESTED", "STALE", "INVALID"],
    CONTESTED: ["VERIFIED", "INVALID"],
    STALE: ["ACTIVE"],
    INVALID: ["ACTIVE"],
    ARCHIVED: [],
  },
  claim: {
    UNTESTED: ["ACTIVE"],
    ACTIVE: ["RESOLVED", "ARCHIVED"],
    RESOLVED: ["ARCHIVED"],
    ARCHIVED: [],
  },
  hypothesis: {
    CANDIDATE: ["UNDER_INVESTIGATION"],
    UNDER_INVESTIGATION: ["LEADING", "SUPPORTED", "WEAKENED", "REJECTED", "INCONCLUSIVE"],
    LEADING: ["SUPPORTED", "WEAKENED", "REJECTED"],
    SUPPORTED: ["WEAKENED"],
    WEAKENED: ["UNDER_INVESTIGATION"],
    REJECTED: ["HISTORICAL"],
    INCONCLUSIVE: ["UNDER_INVESTIGATION"],
    HISTORICAL: [],
  },
  judgment: {
    ACTIVE: ["SUPERSEDED", "ARCHIVED"],
    SUPERSEDED: ["ARCHIVED"],
    ARCHIVED: [],
  },
};

export function canTransition(kind: ObjectKind, from: ObjectStatus, to: ObjectStatus): boolean {
  if (!STATES_BY_KIND[kind].has(from) || !STATES_BY_KIND[kind].has(to)) return false;
  return TRANSITIONS[kind][from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly kind: ObjectKind,
    public readonly from: ObjectStatus,
    public readonly to: ObjectStatus,
  ) {
    super(`Invalid lifecycle transition for ${kind}: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Guarded transition: returns the new status or throws. The caller records provenance. */
export function applyTransition(kind: ObjectKind, from: ObjectStatus, to: ObjectStatus): ObjectStatus {
  if (!canTransition(kind, from, to)) throw new InvalidTransitionError(kind, from, to);
  return to;
}

/** Only certain statuses may participate in current decision-making. */
export function isUsableForCurrentResearch(status: ObjectStatus): boolean {
  return status === "ACTIVE" || status === "VERIFIED" || status === "UNDER_INVESTIGATION" || status === "LEADING";
}
