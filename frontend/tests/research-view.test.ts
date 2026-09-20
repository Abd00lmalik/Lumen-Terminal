/**
 * Active-research selection tests (state-isolation mandate); deterministic, DOM-free.
 *
 * Laws under test:
 * - RUNNING OWNS THE ACTIVE AREA: while a new run is in flight, no previous turn is the
 *   active result (the "oil question shows the NVDA answer" production bug).
 * - ONE RESEARCH PER RESULT: the active view renders exactly one research identity; the
 *   explicit user selection wins, otherwise the newest identified run.
 * - RAIL SCOPING: the workspace rail's judgment may render only for the active research;
 *   never beside an unselected snapshot or during a run.
 */
import { describe, expect, it } from "vitest";
import { isExpandedTurn, railBelongsToActive, selectActiveTurnRef, type IdentifiedTurn } from "../src/pages/researchView.js";

const turns: readonly IdentifiedTurn[] = [
  { question: "What could affect NVDA around earnings?", requestId: "r1", researchRef: "rs_000051" },
  { question: "What is driving oil prices this week?", requestId: "r2", researchRef: "rs_000052" },
];

describe("active research selection", () => {
  it("while a new run is in flight, NO previous turn is the active result", () => {
    const active = selectActiveTurnRef({ turns, running: true, viewedRef: "rs_000051" });
    expect(active).toBeUndefined();
    for (const turn of turns) expect(isExpandedTurn(turn, active, true)).toBe(false);
  });

  it("after completion the new run's identity is the only expanded result", () => {
    const active = selectActiveTurnRef({ turns, running: false, liveRef: "rs_000053" });
    expect(active).toBe("rs_000053");
    expect(isExpandedTurn(turns[0]!, active, false)).toBe(false);
    expect(isExpandedTurn(turns[1]!, active, false)).toBe(false);
  });

  it("an explicit history selection wins (and only that research expands)", () => {
    const active = selectActiveTurnRef({ turns, running: false, viewedRef: "rs_000051", liveRef: "rs_000052" });
    expect(active).toBe("rs_000051");
    expect(isExpandedTurn(turns[0]!, active, false)).toBe(true);
    expect(isExpandedTurn(turns[1]!, active, false)).toBe(false);
  });

  it("falls back to the newest identified run when nothing is selected", () => {
    expect(selectActiveTurnRef({ turns, running: false })).toBe("rs_000052");
  });

  it("a run that finishes AFTER a newer one starts cannot become the active view", () => {
    // A completes late: the stream still reports the newer run as running, so A's identity
    // must not take over the active area.
    const active = selectActiveTurnRef({ turns, running: true, liveRef: "rs_000052" });
    expect(active).toBeUndefined();
  });
});

describe("rail scoping", () => {
  it("never renders rail judgment while a run is in flight", () => {
    expect(railBelongsToActive({ running: true, snapshotRef: "rs_000051", activeRef: "rs_000051" })).toBe(false);
  });

  it("renders only when the snapshot describes the active research", () => {
    expect(railBelongsToActive({ running: false, snapshotRef: "rs_000051", activeRef: "rs_000051" })).toBe(true);
    expect(railBelongsToActive({ running: false, snapshotRef: "rs_000051", activeRef: "rs_000052" })).toBe(false);
    expect(railBelongsToActive({ running: false, snapshotRef: "rs_000051", activeRef: undefined })).toBe(false);
    expect(railBelongsToActive({ running: false, activeRef: "rs_000052" })).toBe(false);
  });
});
