import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { normalizedResult, type ToolResult } from "../../src/domain/tool-result.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";

const origin = { kind: "agent" as const, detail: "test" };

function makeEvidence(ws: Workspace, researchRef: string, observation: string): string {
  const result: ToolResult = normalizedResult(
    {
      tool: "bitget-signal/technical-analysis",
      capability: "TECHNICAL_ANALYSIS",
      transport: "rest:api.bitget.com",
      params: { symbol: "BTCUSDT" },
      outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: observation }],
      validation: "VALID",
    },
    origin,
  );
  const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
  return ws.addEvidence({ ...evidence, researchRef }, origin).id;
}

describe("workspace research graph (research-object-model.md §22/§17, lock §11/§12)", () => {
  let ws: Workspace;
  beforeEach(() => {
    resetIdCounters();
    ws = new Workspace();
  });

  it("research owns branches/claims/hypotheses; ids are cross-referenced", () => {
    const research = ws.addResearch(
      { objective: "Reconstruct the BTC drop", question: "What happened to BTC on 2026-09-11?", flow: "WHAT_HAPPENED" },
      origin,
    );
    const branch = ws.addBranch(research.id, "Macro explanation", origin);
    const hypothesis = ws.addHypothesis(
      { statement: "A hawkish Fed remark triggered the drop", researchRef: research.id },
      origin,
    );
    const claim = ws.addClaim({ statement: "The drop started at 14:05 UTC", researchRef: research.id }, origin);

    const stored = ws.getResearch(research.id)!;
    expect(stored.branchRefs).toContain(branch.id);
    expect(stored.hypothesisRefs).toContain(hypothesis.id);
    expect(stored.claimRefs).toContain(claim.id);
    expect(ws.getBranch(branch.id)!.researchRef).toBe(research.id);
  });

  it("exactly one ACTIVE judgment: new material judgment supersedes, history preserved (§9)", () => {
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const evidenceId = makeEvidence(ws, research.id, "BTC -4% in 15 minutes");

    const v1 = ws.addJudgment(
      {
        statement: "Macro news was probably the primary driver.",
        basis: { supportingEvidence: [evidenceId], opposingEvidence: [], keyClaims: [], hypotheses: [] },
        confidence: "LOW",
        researchRef: research.id,
      },
      origin,
      new Date("2026-09-11T14:30:00Z"),
    );
    expect(ws.currentJudgment(research.id)!.id).toBe(v1.id);

    const v2 = ws.addJudgment(
      {
        statement: "Liquidations appear to have been the primary driver, while macro news was an initiating catalyst.",
        basis: { supportingEvidence: [evidenceId], opposingEvidence: [], keyClaims: [], hypotheses: [] },
        confidence: "MODERATE",
        researchRef: research.id,
      },
      origin,
      new Date("2026-09-11T15:00:00Z"),
    );

    expect(ws.currentJudgment(research.id)!.id).toBe(v2.id);
    expect(ws.getJudgment(v1.id)!.status).toBe("SUPERSEDED");
    expect(ws.getJudgment(v1.id)!.statement).toContain("Macro news was probably"); // history intact
    expect(ws.historicalJudgments(research.id).map((j) => j.id)).toEqual([v1.id]);
  });

  it("contradictory evidence is retained on the claim, not discarded (lock §11)", () => {
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHY_HAPPENED" }, origin);
    const claim = ws.addClaim({ statement: "The drop was liquidation-driven" }, origin);
    const supporting = makeEvidence(ws, research.id, "OI dropped 8% during the drop");
    const contradicting = makeEvidence(ws, research.id, "Funding stayed positive through the drop");

    ws.linkEvidenceToClaim(supporting, claim.id, "supports", origin);
    ws.linkEvidenceToClaim(contradicting, claim.id, "contradicts", origin);

    const stored = ws.getClaim(claim.id)!;
    expect(stored.evidenceRefs).toContain(supporting);
    expect(stored.evidenceRefs).toContain(contradicting); // contradiction preserved
    expect(ws.getEvidence(supporting)!.supports).toContain(claim.id);
    expect(ws.getEvidence(contradicting)!.contradicts).toContain(claim.id);
  });

  it("hypotheses are living objects with lifecycle-guarded transitions", () => {
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHY_HAPPENED" }, origin);
    const h = ws.addHypothesis({ statement: "H1: macro caused the drop", researchRef: research.id }, origin);

    const investigating = ws.transitionHypothesis(h.id, "UNDER_INVESTIGATION", origin, "evidence arrived");
    expect(investigating.status).toBe("UNDER_INVESTIGATION");

    const weakened = ws.transitionHypothesis(h.id, "WEAKENED", origin, "contradicting funding data");
    expect(weakened.status).toBe("WEAKENED");

    // non-linear recovery is legal
    expect(() => ws.transitionHypothesis(h.id, "UNDER_INVESTIGATION", origin, "new evidence")).not.toThrow();
  });

  it("evidence→research ownership and freshness co-exist", () => {
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const id = makeEvidence(ws, research.id, "1h candle closed -5%");
    expect(ws.getResearch(research.id)!.evidenceRefs).toContain(id);
    expect(ws.getEvidence(id)!.freshness).toBe("CURRENT");
  });

  it("snapshot round-trip preserves the graph (persistence seam)", async () => {
    const { MemoryStore } = await import("../../src/persistence/index.js");
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const evidenceId = makeEvidence(ws, research.id, "tick");
    const judgment = ws.addJudgment(
      { statement: "s", basis: { supportingEvidence: [evidenceId], opposingEvidence: [], keyClaims: [], hypotheses: [] }, researchRef: research.id },
      origin,
    );

    const store = new MemoryStore();
    await store.save(ws.toSnapshot());
    const restored = (await store.load())!;

    expect(restored.getResearch(research.id)!.currentJudgmentRef).toBe(judgment.id);
    expect(restored.getEvidence(evidenceId)).toBeTruthy();
    expect(restored.currentJudgment(research.id)!.statement).toBe("s");
  });

  it("final responses persist through the snapshot and serve on ANY restored instance", async () => {
    const { MemoryStore } = await import("../../src/persistence/index.js");
    const research = ws.addResearch({ objective: "TSLA week in review", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const response = { requestId: "r1", action: "RESEARCH", outcome: "COMPLETED", answer: { answer: "TSLA fell 3.2% over the last week", supportingReasons: [], opposingReasons: [], confidence: "MODERATE", keyUncertainty: "", implication: "", citedObjectRefs: [] } };
    ws.saveResearchResponse(research.id, response);

    const store = new MemoryStore();
    await store.save(ws.toSnapshot());
    // A different serverless instance restores from the store:
    const restored = (await store.load())!;
    expect(restored.getResearchResponse(research.id)).toEqual(response);
  });

  it("persisted responses are bounded (history depth without unbounded growth)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 105; i += 1) {
      const r = ws.addResearch({ objective: `o${i}`, question: `q${i}`, flow: "WHAT_HAPPENED" }, origin);
      ids.push(r.id);
      ws.saveResearchResponse(r.id, { i });
    }
    expect(ws.getResearchResponse(ids[0]!)).toBeUndefined(); // oldest evicted
    expect(ws.getResearchResponse(ids[ids.length - 1]!)).toEqual({ i: 104 });
  });
});
