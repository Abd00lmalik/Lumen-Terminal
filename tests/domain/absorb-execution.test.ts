/**
 * Execution-state absorption (remediation D4/D5/D7).
 *
 * A warm serverless instance loads the workspace ONCE; another instance's completed runs
 * land only in the store. `absorbExecutionState` unions the execution collections into the
 * warm graph before reads, scoped to those collections so an in-flight local run is never
 * clobbered.
 *
 * Laws under test:
 * - D4 (judgment id reuse): absorbing another instance's objects bumps the id counters past
 *   them, so a warm instance can never RE-MINT a persisted judgment id.
 * - D5 (CURRENT pointer): the continuity snapshot's CURRENT research is the NEWEST COMPLETED
 *   run by lifecycle timestamp — Map insertion order is not run order.
 * - Union law: newer-wins by provenance volume; equal-or-staler remote state never ages a
 *   local record backward (local in-flight writes win ties).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const trader = { kind: "trader" as const, detail: "test" };

const T0 = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => resetIdCounters());

/** A research run created at T0 and completed at `completedAt` (2 provenance steps + create). */
function completedRun(ws: Workspace, question: string, completedAt: string, createdAt: string = T0.toISOString()): string {
  // Runs are CREATED at distinct times in reality; CURRENT is selected by submission order
  // (creation), never by completion order, so the helper models a distinct creation instant
  // and keeps the completion instant separately.
  const created = new Date(createdAt);
  const r = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, trader, created);
  ws.transitionResearch(r.id, "ACTIVE", trader, "run started", created);
  ws.transitionResearch(r.id, "COMPLETED", trader, "run completed", new Date(completedAt));
  return r.id;
}

function judgmentInput(researchRef: string, statement: string) {
  return {
    researchRef,
    statement,
    basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] },
    confidence: "LOW" as const,
  };
}

describe("absorbExecutionState (D4/D5/D7)", () => {
  it("D4: absorbing another instance's judgments bumps the id counter past them (no re-minted ids)", () => {
    const other = new Workspace();
    const rid = completedRun(other, "What happened to BTC?", "2026-01-02T00:00:00.000Z");
    const foreign = [1, 2, 3].map((n) => other.addJudgment(judgmentInput(rid, `persisted judgment ${n}`), trader).id);
    const snap = other.toSnapshot();

    // The warm instance is a FRESH process: its counters restart at zero while the store
    // already holds jd_000001..jd_000003 (the observed production collision).
    resetIdCounters();
    const warm = new Workspace();
    warm.absorbExecutionState(snap);

    expect(warm.listJudgments().map((j) => j.id).sort()).toEqual([...foreign].sort());
    const minted = warm.addJudgment(judgmentInput(rid, "new local judgment"), trader);
    expect(foreign).not.toContain(minted.id);
    expect(minted.id).toBe("jd_000004"); // counter resumed past the absorbed ids, never at 1
  });

  it("D5: CURRENT is the NEWEST COMPLETED research by timestamp, never Map insertion order", () => {
    const other = new Workspace();
    // Insertion order: newer FIRST, older LAST — the pre-fix selection (insertion order)
    // pointed CURRENT at the older run after the merge/absorb reordered the graph.
    const newer = completedRun(other, "newer run", "2026-01-05T00:00:00.000Z", "2026-01-04T00:00:00.000Z");
    const older = completedRun(other, "older run", "2026-01-03T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    const snap = other.toSnapshot();
    expect(snap.researches.map((r) => r.id)).toEqual([newer, older]); // insertion order ≠ run order

    const warm = new Workspace();
    warm.absorbExecutionState(snap);
    expect(warm.getContinuitySnapshot().activeResearchTarget?.id).toBe(newer);

    // Direct selection (no absorption involved) applies the same law.
    const direct = Workspace.fromSnapshot(snap);
    expect(direct.getContinuitySnapshot().activeResearchTarget?.id).toBe(newer);
  });

  it("a run that finishes LAST is not CURRENT when it was submitted first", () => {
    const other = new Workspace();
    // Submitted first, finishes last (slow providers, gap recovery). CURRENT is the run the
    // trader asked for last, not the one that happened to complete last.
    const submittedFirst = completedRun(other, "slow run", "2026-01-09T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    const submittedLast = completedRun(other, "fast run", "2026-01-03T00:00:00.000Z", "2026-01-08T00:00:00.000Z");
    expect(other.getContinuitySnapshot().activeResearchTarget?.id).toBe(submittedLast);
    expect(other.getContinuitySnapshot().activeResearchTarget?.id).not.toBe(submittedFirst);
  });

  it("union newer-wins: a staler snapshot never ages a local record; a fresher one catches it up", () => {
    const base = new Workspace();
    const r = base.addResearch({ objective: "run", question: "run", flow: "WHAT_HAPPENED" }, trader, T0);
    base.transitionResearch(r.id, "ACTIVE", trader, "run started", T0);
    const activeSnap = base.toSnapshot(); // fewer provenance entries (pre-completion)
    base.transitionResearch(r.id, "COMPLETED", trader, "run completed", new Date("2026-01-02T00:00:00.000Z"));
    const completedSnap = base.toSnapshot(); // more provenance entries (post-completion)

    // A warm instance holding the COMPLETED record is never aged backward by a stale copy.
    const warm = Workspace.fromSnapshot(completedSnap);
    warm.absorbExecutionState(activeSnap);
    expect(warm.getResearch(r.id)?.status).toBe("COMPLETED");

    // A warm instance that predates completion catches up from the fresher snapshot — the
    // Save path resolves researchRef against this graph (D7: the target must exist here).
    const stale = Workspace.fromSnapshot(activeSnap);
    expect(stale.getResearch(r.id)?.status).toBe("ACTIVE");
    stale.absorbExecutionState(completedSnap);
    expect(stale.getResearch(r.id)?.status).toBe("COMPLETED");
    expect(stale.getContinuitySnapshot().activeResearchTarget?.id).toBe(r.id);
  });

  it("absorbs evidence and responses with the same law; unknown ids are added, local-only state is untouched", () => {
    const other = new Workspace();
    const rid = completedRun(other, "remote run", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const ev = other.addEvidence(
      { observation: "remote evidence", evidenceType: "market", evidenceClass: "OBSERVATION", researchRef: rid },
      trader,
    );
    const snap = other.toSnapshot();

    const warm = new Workspace();
    const localRid = completedRun(warm, "local in-flight run", "2026-01-04T00:00:00.000Z", "2026-01-03T00:00:00.000Z");
    warm.absorbExecutionState(snap);

    expect(warm.getResearch(rid)).toBeDefined(); // remote run added
    expect(warm.getEvidence(ev.id)).toBeDefined(); // remote evidence added
    expect(warm.getResearch(localRid)).toBeDefined(); // local-only state untouched
    // CURRENT follows the newest COMPLETED across both graphs.
    expect(warm.getContinuitySnapshot().activeResearchTarget?.id).toBe(localRid);
  });
});
