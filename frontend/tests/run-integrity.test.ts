/**
 * Client-side research-integrity guards.
 *
 * The backend enforces run ownership at the domain boundary; the client refuses to DISPLAY a
 * response whose artifacts disagree about which run they belong to. These are the two
 * decisions that stop the reported failure ("a fresh 09:xx observation answered from an
 * 07:xx observation of an earlier run") from reaching the screen even if a payload ever
 * arrives incoherent.
 *
 * No jsdom in this project: these guards are pure functions over the DTOs, so they are
 * exercised directly.
 */
import { describe, expect, it } from "vitest";
import { isCoherentRunResponse, judgmentBelongsToCurrentRun } from "../src/pages/ResearchWorkspacePage.js";
import type {
  ContinuitySnapshotDto, EvidenceDto, JudgmentDto, ResearchResponseDto,
} from "../src/api/types.js";

function evidence(ref: string, researchRunId?: string): EvidenceDto {
  return {
    ref,
    ...(researchRunId !== undefined ? { researchRunId } : {}),
    observation: `${ref} observation`,
    evidenceType: "market_data",
    evidenceClass: "RAW_DATA",
    freshness: "CURRENT",
    observedAt: "2026-10-03T08:46:10.000Z",
    sourceRefs: [],
    supports: [],
    contradicts: [],
  };
}

function judgment(ref: string, researchRunId: string, supporting: readonly string[]): JudgmentDto {
  return {
    ref,
    researchRunId,
    statement: `${ref} statement`,
    uncertainty: [],
    implications: [],
    unresolvedQuestions: [],
    supportingEvidence: supporting,
    opposingEvidence: [],
    keyClaims: [],
    hypotheses: [],
    status: "ACTIVE",
  };
}

function response(over: Partial<ResearchResponseDto> = {}): ResearchResponseDto {
  return {
    requestId: "req-1",
    action: "RESEARCH",
    outcome: "COMPLETED",
    answer: {
      answer: "BTC is at $84,624",
      supportingReasons: [],
      opposingReasons: [],
      counterevidenceStatus: "NOT_ASSESSED",
      confidence: "MODERATE",
      keyUncertainty: "",
      implication: "",
      citedObjectRefs: ["ev_new"],
    },
    limitations: [],
    researchGaps: [],
    researchRef: "rs_new",
    researchRunId: "rs_new",
    evidenceRefs: ["ev_new"],
    evidence: [evidence("ev_new", "rs_new")],
    judgments: [judgment("jd_new", "rs_new", ["ev_new"])],
    ...over,
  };
}

describe("run coherence guard", () => {
  it("accepts a response whose every artifact belongs to the same run", () => {
    expect(isCoherentRunResponse(response())).toBe(true);
  });

  it("rejects an answer citing evidence from another run", () => {
    // The exact production failure: fresh evidence retrieved, older observation cited.
    const staleCitation = response();
    Object.defineProperty(staleCitation.answer, "citedObjectRefs", {
      value: ["ev_old"],
      enumerable: true,
    });
    expect(isCoherentRunResponse(staleCitation)).toBe(false);
  });

  it("rejects the compound-plan mixed-run shape (Test 2 regression): judgments/evidence from a sibling run ride along", () => {
    // Production failure this pins: a compound action plan ran a generic adaptive step AND a
    // flow step; the backend once bound the response to the FIRST run while the flow's
    // judgment/evidence rode along. The guard correctly refused, the stream-done effect
    // silently dropped the completed result, and the finished report appeared only in
    // History. The backend now emits the answer-bearing run only (tests/api/
    // compound-run-ownership.test.ts); this test keeps the guard's refusal of the old shape
    // load-bearing, so the client is never "fixed" by relaxing it.
    const mixed = response({
      evidence: [evidence("ev_new", "rs_new"), evidence("ev_flow", "rs_flow")],
      evidenceRefs: ["ev_new", "ev_flow"],
      judgments: [judgment("jd_flow", "rs_flow", ["ev_flow"]), judgment("jd_new", "rs_new", ["ev_new"])],
    });
    expect(isCoherentRunResponse(mixed)).toBe(false);
  });

  it("accepts the fixed compound-plan shape: one answer-bearing run, all artifacts its own", () => {
    // What the backend now emits for the same submission: the flow's run id, the flow's
    // evidence and the flow's judgment — one run throughout. The guard accepts it and the
    // stream-done effect renders the completed report in place.
    expect(isCoherentRunResponse(response({
      evidence: [evidence("ev_flow", "rs_new")],
      evidenceRefs: ["ev_flow"],
      judgments: [judgment("jd_flow", "rs_new", ["ev_flow"])],
      answer: { answer: "flow conclusion", supportingReasons: [], opposingReasons: [], counterevidenceStatus: "NOT_ASSESSED", confidence: "MODERATE", keyUncertainty: "", implication: "", citedObjectRefs: ["ev_flow"] },
    }))).toBe(true);
  });

  it("rejects a response that lists evidence owned by another run", () => {
    // Even when the citation is fine, an object from another run must never ride along in
    // the current run's evidence list.
    expect(isCoherentRunResponse(response({
      evidence: [evidence("ev_new", "rs_new"), evidence("ev_old", "rs_old")],
      evidenceRefs: ["ev_new", "ev_old"],
    }))).toBe(false);
  });

  it("rejects a judgment belonging to another run", () => {
    expect(isCoherentRunResponse(response({ judgments: [judgment("jd_old", "rs_old", ["ev_new"])] }))).toBe(false);
  });

  it("rejects a judgment whose basis cites an object this run never retrieved", () => {
    const withForeignBasis = response({
      evidence: [evidence("ev_new", "rs_new"), evidence("ev_old", "rs_old")],
      evidenceRefs: ["ev_new", "ev_old"],
      judgments: [judgment("jd_new", "rs_new", ["ev_old"])],
    });
    expect(isCoherentRunResponse(withForeignBasis)).toBe(false);
  });

  it("rejects a response carrying evidence owned by a different run", () => {
    expect(isCoherentRunResponse(response({ evidence: [evidence("ev_old", "rs_old")] }))).toBe(false);
  });

  it("a non-research action (no run) is not rejected", () => {
    expect(isCoherentRunResponse(undefined)).toBe(false);
    const noRun = response({ researchRef: undefined, researchRunId: undefined, judgments: [] });
    expect(isCoherentRunResponse(noRun)).toBe(true);
  });
});

describe("current-run judgment guard", () => {
  const base: ContinuitySnapshotDto = {
    activeResearch: { ref: "rs_new", objective: "q", question: "q", flow: "INDEPENDENT_RESEARCH", status: "COMPLETED", evidenceRefs: [], claimRefs: [], hypothesisRefs: [], judgmentRefs: [], history: [] },
    currentResearchRunId: "rs_new",
    recentEvidence: [],
    currentClaims: [],
    currentHypotheses: [],
    memories: [],
    savedArtifacts: [],
    monitorProposals: [],
    activeMonitors: [],
    unresolvedUncertainties: [],
    importantContradictions: [],
  };

  it("shows the judgment that belongs to the current run", () => {
    expect(judgmentBelongsToCurrentRun({ ...base, currentJudgment: judgment("jd_new", "rs_new", []) })?.ref).toBe("jd_new");
  });

  it("refuses to show a judgment from another run even if the payload carries one", () => {
    expect(judgmentBelongsToCurrentRun({ ...base, currentJudgment: judgment("jd_old", "rs_old", []) })).toBeUndefined();
  });

  it("shows nothing when the current run has no judgment", () => {
    expect(judgmentBelongsToCurrentRun(base)).toBeUndefined();
  });
});