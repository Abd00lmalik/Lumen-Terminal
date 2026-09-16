import { describe, expect, it } from "vitest";
import {
  applyTransition,
  canTransition,
  InvalidTransitionError,
  isUsableForCurrentResearch,
  type ObjectStatus,
} from "../../src/domain/lifecycle.js";

describe("lifecycle state machines (object-lifecycle-state-machine.md)", () => {
  it("allows typical research transitions", () => {
    expect(canTransition("research", "DRAFT", "ACTIVE")).toBe(true);
    expect(canTransition("research", "ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("research", "ACTIVE", "COMPLETED")).toBe(true);
    expect(canTransition("research", "COMPLETED", "STALE")).toBe(true);
    expect(canTransition("research", "COMPLETED", "SUPERSEDED")).toBe(true);
    expect(canTransition("research", "ACTIVE", "STOPPED")).toBe(true);
    expect(canTransition("research", "STOPPED", "ARCHIVED")).toBe(true);
  });

  it("allows research reopening from STALE/INVALID after revalidation", () => {
    expect(canTransition("research", "STALE", "ACTIVE")).toBe(true);
    expect(canTransition("research", "INVALID", "ACTIVE")).toBe(true);
  });

  it("rejects invalid transitions instead of coercing them", () => {
    expect(canTransition("judgment", "SUPERSEDED", "ACTIVE")).toBe(false);
    expect(() => applyTransition("judgment", "SUPERSEDED", "ACTIVE")).toThrow(InvalidTransitionError);
    // Branches do not use STALE/INVALID/SUPERSEDED (branch lifecycle is execution-only)
    expect(canTransition("branch", "ACTIVE", "STALE")).toBe(false);
    expect(canTransition("branch", "ACTIVE", "CANCELLED")).toBe(true);
    // Evidence: STALE → ACTIVE allowed (revalidation), INVALID → ACTIVE allowed (validity re-established)
    expect(canTransition("evidence", "STALE", "ACTIVE")).toBe(true);
    expect(canTransition("evidence", "CONTESTED", "VERIFIED")).toBe(true);
    expect(canTransition("evidence", "CONTESTED", "INVALID")).toBe(true);
    expect(canTransition("evidence", "VERIFIED", "ACTIVE")).toBe(false);
  });

  it("keeps claim lifecycle deliberately simple", () => {
    expect(canTransition("claim", "UNTESTED", "ACTIVE")).toBe(true);
    expect(canTransition("claim", "ACTIVE", "RESOLVED")).toBe(true);
    expect(canTransition("claim", "UNTESTED", "RESOLVED")).toBe(false);
  });

  it("supports non-linear hypothesis transitions (living objects)", () => {
    expect(canTransition("hypothesis", "UNDER_INVESTIGATION", "LEADING")).toBe(true);
    expect(canTransition("hypothesis", "UNDER_INVESTIGATION", "WEAKENED")).toBe(true);
    expect(canTransition("hypothesis", "WEAKENED", "UNDER_INVESTIGATION")).toBe(true);
    expect(canTransition("hypothesis", "LEADING", "WEAKENED")).toBe(true);
    expect(canTransition("hypothesis", "LEADING", "REJECTED")).toBe(true);
    expect(canTransition("hypothesis", "REJECTED", "HISTORICAL")).toBe(true);
    expect(canTransition("hypothesis", "HISTORICAL", "LEADING")).toBe(false);
  });

  it("judgment history is append-only: no path back to ACTIVE", () => {
    for (const from of ["SUPERSEDED", "ARCHIVED"] as ObjectStatus[]) {
      for (const to of ["ACTIVE", "SUPERSEDED", "ARCHIVED"] as ObjectStatus[]) {
        if (from === to) continue;
        if (from === "SUPERSEDED" && to === "ARCHIVED") continue; // allowed
        expect(canTransition("judgment", from, to)).toBe(false);
      }
    }
  });

  it("stale ≠ invalid: usability gating treats them distinctly from usable states", () => {
    expect(isUsableForCurrentResearch("STALE")).toBe(false);
    expect(isUsableForCurrentResearch("INVALID")).toBe(false);
    expect(isUsableForCurrentResearch("SUPERSEDED")).toBe(false);
    expect(isUsableForCurrentResearch("ACTIVE")).toBe(true);
    expect(isUsableForCurrentResearch("VERIFIED")).toBe(true);
    expect(isUsableForCurrentResearch("LEADING")).toBe(true);
  });
});
