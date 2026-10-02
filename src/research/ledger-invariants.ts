/**
 * LEDGER INVARIANTS (research contract): the requirement ledger is not a display list — it is
 * the ENGINE'S EVIDENCE STATE. Coverage (blockingRequirements), the completion law, question
 * resolution, and the confidence computation all read `status` together with `evidenceRefs` /
 * `staleOnlyRefs`. A row whose status contradicts its own refs is therefore a corrupted input to
 * every downstream law: "SATISFIED with nothing behind it" silently promotes completion and
 * confidence, and a terminal row carrying fresh evidence hides coverage the verdict never saw.
 *
 * The production writers maintain these invariants by construction (assessCoverage only marks
 * SATISFIED when it matched fresh evidence, PARTIALLY_SATISFIED when it matched stale-only
 * evidence, and exhaustUnresolved only terminates rows that were never SATISFIED) — so this
 * checker exists to make a breach LOUD instead of quietly compounding it: it runs at the shared
 * contract boundary, the one place every research path passes through.
 *
 * RECORD, NEVER THROW: a hand-built fixture, a persisted ledger from an older schema, or a
 * degraded run must not crash the boundary. Violations are appended to the boundary's
 * violationReport with action RECORDED (the prose was not touched — there is no claim to strip);
 * they never alter stopping, confidence, or the prose themselves. Honesty of the record is the
 * whole point: the report shows every rejection AND every integrity breach the boundary saw.
 */
import type { ResearchRequirement } from "./requirements.js";

/** One ledger integrity breach (diagnostic record; no behavior is changed by it). */
export interface LedgerInvariantViolation {
  /** Stable, greppable violation id (never a free-form sentence). */
  readonly type:
    | "LEDGER_SATISFIED_WITHOUT_EVIDENCE"
    | "LEDGER_PARTIAL_WITHOUT_STALE_EVIDENCE"
    | "LEDGER_TERMINAL_WITH_FRESH_EVIDENCE"
    | "LEDGER_DUPLICATE_REQUIREMENT_ID";
  /** Which row broke the invariant and how (never user-facing prose). */
  readonly detail: string;
}

/**
 * Check every ledger row against its own evidence refs. Pure: same ledger in, same records out.
 * Order follows ledger order so a report is stable for a given ledger.
 */
export function ledgerInvariantViolations(
  ledger: readonly ResearchRequirement[],
): readonly LedgerInvariantViolation[] {
  const violations: LedgerInvariantViolation[] = [];
  const seenIds = new Set<string>();
  for (const row of ledger) {
    if (seenIds.has(row.id)) {
      violations.push({
        type: "LEDGER_DUPLICATE_REQUIREMENT_ID",
        detail:
          `requirement id "${row.id}" appears more than once in the ledger ` +
          `(${row.description}); duplicate rows make coverage and blocking ambiguous`,
      });
    } else {
      seenIds.add(row.id);
    }

    switch (row.status) {
      case "SATISFIED":
        // assessCoverage only marks SATISFIED with >= 1 fresh match; a SATISFIED row with no
        // fresh ref (with or without stale refs) claims coverage the ledger does not hold.
        if (row.evidenceRefs.length === 0) {
          violations.push({
            type: "LEDGER_SATISFIED_WITHOUT_EVIDENCE",
            detail:
              `requirement "${row.id}" (${row.description}) is SATISFIED but carries no ` +
              `fresh evidence reference (evidenceRefs=0, staleOnlyRefs=${row.staleOnlyRefs.length})`,
          });
        }
        break;
      case "PARTIALLY_SATISFIED":
        // PARTIALLY_SATISFIED means "attempted; only stale evidence found" (renderCoverage says
        // so). With no stale ref either, the row is a gap dressed as partial coverage.
        if (row.staleOnlyRefs.length === 0) {
          violations.push({
            type: "LEDGER_PARTIAL_WITHOUT_STALE_EVIDENCE",
            detail:
              `requirement "${row.id}" (${row.description}) is PARTIALLY_SATISFIED but carries ` +
              `no stale evidence reference (evidenceRefs=${row.evidenceRefs.length})`,
          });
        }
        break;
      case "EXHAUSTED":
      case "UNAVAILABLE":
        // Terminal rows are honest "nothing satisfied this" states (exhaustUnresolved only
        // terminates non-SATISFIED rows). Fresh evidence refs on one contradict its own reason.
        if (row.evidenceRefs.length > 0) {
          violations.push({
            type: "LEDGER_TERMINAL_WITH_FRESH_EVIDENCE",
            detail:
              `requirement "${row.id}" (${row.description}) is ${row.status} but still carries ` +
              `${row.evidenceRefs.length} fresh evidence reference(s); a terminal row must not hold ` +
              `satisfied evidence`,
          });
        }
        break;
      default:
        // PENDING rows carry no evidence state to contradict — nothing to check.
        break;
    }
  }
  return violations;
}
