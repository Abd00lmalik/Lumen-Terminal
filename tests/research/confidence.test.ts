/**
 * DETERMINISTIC CONFIDENCE regression tests (decision-quality mandate §13).
 *
 * Confidence is computed from engine state (coverage, freshness, challenge, calculations,
 * recovery) and caps whatever the model states. A fluent answer over an unresolved CORE
 * requirement cannot be HIGH.
 */
import { describe, expect, it } from "vitest";
import { boundConfidence, computeConfidence, renderConfidence } from "../../src/research/confidence.js";
import { buildRequirements, completeRequirements, type ResearchRequirement } from "../../src/research/requirements.js";

function ledger(statuses: Readonly<Record<string, ResearchRequirement["status"]>>): readonly ResearchRequirement[] {
  const base = completeRequirements("What is driving platinum prices this week?", buildRequirements([
    { description: "current platinum price action", importance: "CRITICAL", timeSensitivity: "CURRENT" },
  ]), { subject: "PL=F", marketClass: "METAL" }).map((r) => ({
    ...r,
    status: statuses[r.id] ?? "SATISFIED",
    ...(statuses[r.id] === "SATISFIED" ? { evidenceRefs: ["ev_1"] } : {}),
  }));
  return base.map((r) => (r.role === "CHALLENGE" ? { ...r, recoveryAttempts: 1 } : r));
}

describe("deterministic confidence policy", () => {
  it("is HIGH only when every CORE requirement is covered, the challenge ran and nothing failed", () => {
    const c = computeConfidence({ requirements: ledger({}), stoppedBecause: "EVIDENCE_SUFFICIENT", failedPaths: 0 });
    expect(c.level).toBe("HIGH");
    expect(c.coreCoverage).toBe(1);
    expect(c.unresolvedCore).toHaveLength(0);
  });

  it("an unresolved CORE requirement makes the run LOW, however good the prose", () => {
    const c = computeConfidence({ requirements: ledger({ rq_01: "EXHAUSTED" }), stoppedBecause: "EVIDENCE_SUFFICIENT", failedPaths: 0 });
    expect(c.level).toBe("LOW");
    expect(c.unresolvedCore).toEqual(["rq_01"]);
  });

  it("an honoured insufficiency (engine-stated gap) is LOW, and an un-attempted challenge caps at MODERATE", () => {
    const honest = computeConfidence({
      requirements: ledger({ rq_01: "EXHAUSTED" }).map((r) => (r.role === "CHALLENGE" ? { ...r, status: "EXHAUSTED" as const } : r)),
      stoppedBecause: "REQUIREMENT_GAPS_UNRESOLVED",
      failedPaths: 1,
    });
    expect(honest.level).toBe("LOW");
    expect(honest.honestGap).toBe(true);

    const noChallenge = computeConfidence({
      requirements: ledger({}).map((r) =>
        r.role === "CHALLENGE" ? { ...r, recoveryAttempts: 0, status: "PENDING" as const, evidenceRefs: [] } : r,
      ),
      stoppedBecause: "EVIDENCE_SUFFICIENT",
      failedPaths: 0,
    });
    expect(noChallenge.level).toBe("MODERATE");
    expect(noChallenge.challengeAttempted).toBe(false);
  });

  it("caps a model's stated level and never raises it", () => {
    expect(boundConfidence("HIGH", "LOW")).toBe("LOW");
    expect(boundConfidence("MODERATE", "LOW")).toBe("LOW");
    expect(boundConfidence("LOW", "HIGH")).toBe("LOW");
    expect(boundConfidence(undefined, "HIGH")).toBe("HIGH");
  });

  it("renders a provenance line with the components (diagnostics, not prose)", () => {
    const line = renderConfidence(computeConfidence({ requirements: ledger({}), stoppedBecause: "EVIDENCE_SUFFICIENT", failedPaths: 1 }));
    expect(line).toContain("computed=");
    expect(line).toContain("coreCoverage=100%");
    expect(line).toContain("challenge=attempted");
    expect(line).toContain("failedPaths=1");
  });
});
