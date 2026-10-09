/**
 * INVESTIGATION UI LIFECYCLE — regression suite for the browser acceptance findings.
 *
 * The four reported symptoms, and the single cause behind all of them:
 *
 *   1. a completed report did not appear on its own;
 *   2. "New research" left the previous investigation on screen;
 *   3. the page showed "No active research" and a live investigation panel at once;
 *   4. the composer stayed in follow-up mode after New research.
 *
 * Cause: the page inferred its state from WHETHER A RUN WAS ACTIVE, and read two different
 * sources of truth for "current". `workspaceLifecycle` now computes the five states once and
 * every surface reads it; "New research" also clears the selection on the SERVER, because a
 * client-only reset left the backend still reporting the old investigation as current.
 *
 * Laws under test:
 *   1. New research resets the current investigation (client AND server).
 *   2. New research resets the composer from follow-up to research.
 *   3. Previous investigations remain in History — the reset deletes nothing.
 *   4. A first completion makes the report the active view without any navigation.
 *   5. Completed research does not require History navigation to appear.
 *   6. Follow-up mode appears ONLY with a genuinely usable current investigation.
 *   7. Investigation state is never confused with active-run state.
 *   8. Every surface reads the one lifecycle, so the rails cannot contradict each other.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  followUpAllowed,
  isExpandedTurn,
  reportRefForLifecycle,
  selectActiveTurnRef,
  workspaceLifecycle,
} from "../src/pages/researchView.js";

const SRC = join(import.meta.dirname, "..", "src");
const readSource = (dir: string, file: string): string =>
  readFileSync(join(SRC, dir, file), "utf8").replace(/\r\n/g, "\n");
const workspacePage = readSource("pages", "ResearchWorkspacePage.tsx");
const researchApi = readSource("api", "research.ts");

// ---------------------------------------------------------------------------
// 1–3, 6, 7: the lifecycle computation
// ---------------------------------------------------------------------------

describe("1/6/7 — lifecycle states", () => {
  it("NO_INVESTIGATION when the backend reports no current investigation", () => {
    const state = workspaceLifecycle({ hasCompletedRun: false, running: false, resetPending: false });
    expect(state).toBe("NO_INVESTIGATION");
    expect(followUpAllowed(state)).toBe(false);
  });

  it("NO_INVESTIGATION after an explicit reset, even with a stale pointer present", () => {
    // The exact browser failure: a reset was pressed, the backend still pointed at the old
    // investigation for a moment, and the composer came back in follow-up mode.
    const state = workspaceLifecycle({
      currentInvestigationRef: "inv_000001",
      hasCompletedRun: true,
      running: false,
      resetPending: true,
    });
    expect(state).toBe("NO_INVESTIGATION");
    expect(followUpAllowed(state)).toBe(false);
  });

  it("INVESTIGATION_RUNNING while a run is in flight inside a current investigation", () => {
    expect(workspaceLifecycle({
      currentInvestigationRef: "inv_000001", hasCompletedRun: true, running: true, resetPending: false,
    })).toBe("INVESTIGATION_RUNNING");
    expect(followUpAllowed(workspaceLifecycle({
      currentInvestigationRef: "inv_000001", hasCompletedRun: true, running: true, resetPending: false,
    }))).toBe(false);
  });

  it("COMPLETED once a current investigation has a completed run and nothing is running", () => {
    const state = workspaceLifecycle({
      currentInvestigationRef: "inv_000001", hasCompletedRun: true, running: false, resetPending: false,
    });
    expect(state).toBe("COMPLETED");
    expect(followUpAllowed(state)).toBe(true);
  });

  it("READY_FOR_FOLLOWUP: an investigation with no completed run is NOT treated as empty", () => {
    // A completed investigation may have no active run and still be the current one. Inferring
    // state from run activity alone is what produced the contradictory rails.
    const state = workspaceLifecycle({
      currentInvestigationRef: "inv_000001", hasCompletedRun: false, running: false, resetPending: false,
    });
    expect(state).toBe("READY_FOR_FOLLOWUP");
    expect(followUpAllowed(state)).toBe(true);
    expect(reportRefForLifecycle({ lifecycle: state, completedRunRefs: [] })).toBeUndefined();
  });

  it("follow-up is refused whenever there is no current investigation", () => {
    for (const running of [true, false]) {
      expect(followUpAllowed(workspaceLifecycle({
        hasCompletedRun: true, running, resetPending: false,
      }))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4, 5: a completion becomes the displayed report without navigation
// ---------------------------------------------------------------------------

describe("4/5 — a completed run is displayed automatically", () => {
  const turns = [
    { question: "q1", requestId: "a", researchRef: "rs_000001" },
    { question: "q2", requestId: "b", researchRef: "rs_000002" },
  ];

  it("the just-finished run expands with no viewedRef and no navigation", () => {
    const active = selectActiveTurnRef({ turns, running: false, liveRef: "rs_000002" });
    expect(active).toBe("rs_000002");
    expect(isExpandedTurn(turns[1]!, active, false)).toBe(true);
    expect(isExpandedTurn(turns[0]!, active, false)).toBe(false);
  });

  it("a completion wins over a stale history selection", () => {
    const active = selectActiveTurnRef({ turns, running: false, viewedRef: "rs_000001", liveRef: "rs_000002" });
    expect(active).toBe("rs_000002");
    expect(isExpandedTurn(turns[1]!, active, false)).toBe(true);
  });

  it("the newest completed run of a current investigation is the report", () => {
    const refs = ["rs_000001", "rs_000002", "rs_000003"];
    expect(reportRefForLifecycle({ lifecycle: "COMPLETED", completedRunRefs: refs })).toBe("rs_000003");
    // Nothing is reported while the investigation has no completed run.
    expect(reportRefForLifecycle({ lifecycle: "INVESTIGATION_RUNNING", completedRunRefs: refs })).toBeUndefined();
    expect(reportRefForLifecycle({ lifecycle: "NO_INVESTIGATION", completedRunRefs: refs })).toBeUndefined();
  });

  it("a run in flight owns the active area (no stale report during research)", () => {
    const active = selectActiveTurnRef({ turns, running: true, liveRef: "rs_000002", viewedRef: "rs_000001" });
    expect(active).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2, 3, 8: source guards — one lifecycle, one truth, server-side reset
// ---------------------------------------------------------------------------

describe("2/3/8 — source guards", () => {
  it("the page computes the lifecycle once and reads it for the composer", () => {
    expect(workspacePage).toMatch(/const lifecycle = workspaceLifecycle\(/);
    // The follow-up affordance is gated on the lifecycle, never on "an investigation object
    // happens to be in state" — that was the stale-composer defect.
    expect(workspacePage).toMatch(/inFollowUp \? "Ask follow-up" : "Research"/);
    expect(workspacePage).not.toMatch(/investigation !== undefined \? "Ask follow-up"/);
  });

  it("the investigation rail is hidden when there is no current investigation", () => {
    // The two rails contradicted each other; now the stale one is simply not rendered.
    expect(workspacePage).toMatch(/investigation !== undefined && lifecycle !== "NO_INVESTIGATION" &&/);
  });

  it("the empty-research hint reflects the lifecycle instead of always saying 'first investigation'", () => {
    // The hint is decided ONCE in the rail's state function, keyed on the thread's existence;
    // the page derives that from the same lifecycle it shows everywhere else.
    const researchView = readFileSync(join(SRC, "pages", "researchView.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(researchView).toMatch(/Ask a question to start a new investigation\./);
    expect(researchView).toMatch(/Open a run from this investigation to see its research state\./);
    expect(workspacePage).toMatch(/hasInvestigation: investigation !== undefined && lifecycle !== "NO_INVESTIGATION"/);
    expect(workspacePage).toMatch(/<ResearchStateRail state=\{railState\}/);
  });

  it("the page never substitutes an older investigation for 'no current investigation'", () => {
    expect(workspacePage).not.toMatch(/rows\.find\(\(r\) => r\.isCurrent\) \?\? rows\[0\]/);
    expect(workspacePage).toMatch(/const current = rows\.find\(\(r\) => r\.isCurrent\);/);
  });

  it("New research clears the selection on the SERVER, not only in client state", () => {
    // A client-only reset left the backend still reporting the old investigation as current,
    // so the next refresh put the trader back into the thread they had left.
    expect(workspacePage).toMatch(/setResetPending\(true\);/);
    expect(workspacePage).toMatch(/void startNewInvestigation\(\)/);
    expect(researchApi).toMatch(/export function startNewInvestigation\(\)/);
    expect(researchApi).toMatch(/"\/api\/investigations\/new"/);
  });

  it("the reset clears the thread, the viewed run and the composer input", () => {
    expect(workspacePage).toMatch(/setRuns\(\[\]\);/);
    expect(workspacePage).toMatch(/setViewedRef\(undefined\);/);
    expect(workspacePage).toMatch(/setInput\(""\);/);
  });
});