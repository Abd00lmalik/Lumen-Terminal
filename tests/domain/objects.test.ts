import { describe, expect, it } from "vitest";
import {
  createClaim,
  createEvidence,
  createHypothesis,
  createJudgment,
  createResearch,
  createSource,
  withStatus,
  appendRef,
} from "../../src/domain/objects.js";
import { InvalidTransitionError } from "../../src/domain/lifecycle.js";

describe("research object model (research-object-model.md)", () => {
  const origin = { kind: "agent" as const, detail: "test" };

  it("creates objects with prefixed ids and provenance", () => {
    const research = createResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, origin);
    expect(research.id).toMatch(/^rs_/);
    expect(research.status).toBe("DRAFT");
    expect(research.provenance.length).toBe(1);

    const evidence = createEvidence(
      { observation: "BTC fell 4% between 14:00–14:15", evidenceType: "price", evidenceClass: "OBSERVATION" },
      origin,
    );
    expect(evidence.id).toMatch(/^ev_/);
    expect(evidence.observedAt).toBeTruthy();
    expect(evidence.freshness).toBe("CURRENT");

    const source = createSource({ type: "news", retrievedAt: new Date().toISOString() }, origin);
    expect(source.id).toMatch(/^src_/);
  });

  it("objects are frozen (no silent mutation)", () => {
    const evidence = createEvidence(
      { observation: "x", evidenceType: "t", evidenceClass: "OBSERVATION" },
      origin,
    );
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.provenance)).toBe(true);
    expect(Object.isFrozen(evidence.supports)).toBe(true);
  });

  it("proxy evidence requires an explicit basis (lock §3/§5)", () => {
    expect(() =>
      createEvidence(
        { observation: "whales moving", evidenceType: "onchain", evidenceClass: "PROXY_EVIDENCE" },
        origin,
      ),
    ).toThrow(/proxyBasis/);

    const proxy = createEvidence(
      {
        observation: "positioning suggests whale accumulation",
        evidenceType: "onchain",
        evidenceClass: "PROXY_EVIDENCE",
        proxyBasis: "derivatives positioning used as whale-activity proxy (market-intel limitation)",
      },
      origin,
    );
    expect(proxy.evidenceClass).toBe("PROXY_EVIDENCE");
    expect(proxy.proxyBasis).toBeTruthy();
  });

  it("withStatus enforces the lifecycle machine and appends provenance", () => {
    const claim = createClaim({ statement: "Liquidations drove the drop" }, origin);
    const active = withStatus("claim", claim, "ACTIVE", origin, "under investigation");
    expect(active.status).toBe("ACTIVE");
    expect(active.provenance.length).toBe(2); // creation + transition entries
    expect(active.provenance[1]!.origin).toEqual(origin);

    expect(() => withStatus("claim", active, "RESOLVED", origin, "resolved")).not.toThrow();
    // ACTIVE → ARCHIVED is a valid additional transition per the lifecycle spec;
    // UNTESTED → ARCHIVED is not (UNTESTED may only become ACTIVE).
    const untested = createClaim({ statement: "never investigated" }, origin);
    expect(() => withStatus("claim", untested, "ARCHIVED", origin, "skipping ACTIVE")).toThrow(
      InvalidTransitionError,
    );
  });

  it("appendRef appends without mutating the original", () => {
    const research = createResearch({ objective: "o", question: "q", flow: "f" }, origin);
    const next = appendRef(research, "branchRefs", "br_000001");
    expect(next.branchRefs).toEqual(["br_000001"]);
    expect(research.branchRefs).toEqual([]);
    expect(Object.isFrozen(next.branchRefs)).toBe(true);
  });

  it("judgments carry basis, uncertainty, and unresolved questions (lock §12)", () => {
    const judgment = createJudgment(
      {
        statement: "Liquidations appear to have been the primary driver.",
        basis: { supportingEvidence: ["ev_000001"], opposingEvidence: [], keyClaims: ["cl_000001"], hypotheses: ["hy_000001"] },
        confidence: "MODERATE",
        uncertainty: ["funding data window incomplete"],
        unresolvedQuestions: ["was the macro announcement the initiating catalyst?"],
      },
      origin,
    );
    expect(judgment.basis.supportingEvidence).toEqual(["ev_000001"]);
    expect(judgment.uncertainty).toHaveLength(1);
    expect(judgment.unresolvedQuestions).toHaveLength(1);
  });
});
