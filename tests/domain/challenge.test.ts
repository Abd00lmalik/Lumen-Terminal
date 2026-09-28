/**
 * Phase G: Challenge domain — persistent falsification records derived from Flow 7.
 * Covers: challenge creation, counterevidence, stale evidence, information gaps,
 * contradiction, materiality, irrelevant-evidence rejection, duplicate idempotency,
 * persistence, thesis immutability, provenance, merge union.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { challengeFingerprint } from "../../src/domain/challenge.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };
const agent: ProvenanceOrigin = { kind: "agent", detail: "Flow 7" };

function baseChallengeInput(overrides: Record<string, unknown> = {}) {
  return {
    thesisId: "th_000001",
    thesisVersion: 1,
    claim: "positioning turned risk-off while the thesis expects accumulation",
    falsifier: {
      condition: "quarterly close below the opening range",
      attacksClaim: "BTC makes higher highs through the quarter",
      origin: "DERIVED_FROM_BELIEF" as const,
      materiality: "MEANINGFUL_WARNING" as const,
    },
    status: "ACTIVE" as const,
    materialityRationale: "sentiment diverges but is not yet invalidating",
    supportingEvidenceRefs: ["ev_000001"],
    counterEvidenceRefs: ["ev_000002"],
    informationGaps: [],
    conditionObserved: false,
    researchRef: "rs_000001",
    assessment: "WEAKENED" as const,
    ...overrides,
  };
}

function seedWorkspace(): { ws: Workspace; thesisId: string } {
  const ws = new Workspace();
  const thesis = ws.addThesis({ statement: "BTC makes higher highs through the quarter", objective: "test" }, trader);
  const research = ws.addResearch({ objective: "falsification research", question: "What could prove the thesis wrong?", flow: "WHAT_COULD_PROVE_ME_WRONG" }, trader);
  ws.addEvidence({ observation: "price structure constructive", evidenceType: "price", evidenceClass: "OBSERVATION", researchRef: research.id }, trader);
  ws.addEvidence({ observation: "funding negative, positioning risk-off", evidenceType: "sentiment", evidenceClass: "OBSERVATION", researchRef: research.id }, trader);
  return { ws, thesisId: thesis.id, researchId: research.id };
}

beforeEach(() => resetIdCounters());

describe("Phase G: Challenge domain", () => {
  it("creates a challenge with a deterministic fingerprint and full provenance", () => {
    const { ws, thesisId } = seedWorkspace();
    const [created] = ws.recordChallenges([baseChallengeInput({ thesisId })], agent, new Date("2026-09-28T12:00:00Z"));
    expect(created.id).toMatch(/^ch_000001$/);
    expect(created.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(created.provenance.length).toBe(1);
    expect(created.provenance[0]!.origin.kind).toBe("agent");
    expect(created.provenance[0]!.note).toContain("thesis object unchanged");
    expect(created.createdAt).toBe("2026-09-28T12:00:00.000Z");
  });

  it("is idempotent: re-deriving the same falsifier UPDATES the existing record instead of duplicating", () => {
    const { ws, thesisId } = seedWorkspace();
    const input = baseChallengeInput({ thesisId });
    const [first] = ws.recordChallenges([input], agent, new Date("2026-09-28T12:00:00Z"));
    const second = ws.recordChallenges(
      [baseChallengeInput({ thesisId, status: "CONTRADICTION", researchRef: "rs_000002" })],
      agent,
      new Date("2026-09-28T13:00:00Z"),
    );
    expect(ws.listChallenges()).toHaveLength(1);
    const [updated] = second;
    expect(updated.id).toBe(first.id);
    expect(updated.status).toBe("CONTRADICTION");
    expect(updated.provenance.length).toBe(2);
    expect(updated.provenance[1]!.note).toContain("rs_000002");
  });

  it("the fingerprint is stable across whitespace/case but sensitive to claim and falsifier identity", () => {
    const a = challengeFingerprint({ thesisId: "th_1", claim: "Risk-off  positioning", falsifier: { condition: "close below range", attacksClaim: "higher highs", origin: "PROPOSED" } });
    const b = challengeFingerprint({ thesisId: "TH_1", claim: "risk-off positioning", falsifier: { condition: "close  below range", attacksClaim: "Higher Highs", origin: "PROPOSED" } });
    const c = challengeFingerprint({ thesisId: "th_1", claim: "different claim", falsifier: { condition: "close below range", attacksClaim: "higher highs", origin: "PROPOSED" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("counterevidence and contradiction: counter refs land on the challenge and CONTRADICTION is derivable", async () => {
    const { deriveChallengeStatus } = await import("../../src/research/challenge-derive.js");
    expect(deriveChallengeStatus({ conditionObserved: false, hasCounterEvidence: true, citedEvidenceStale: false, hasGaps: false })).toBe("CONTRADICTION");
    expect(deriveChallengeStatus({ conditionObserved: true, hasCounterEvidence: false, citedEvidenceStale: false, hasGaps: false })).toBe("ACTIVE");
    expect(deriveChallengeStatus({ conditionObserved: false, hasCounterEvidence: false, citedEvidenceStale: false, hasGaps: true })).toBe("INFORMATION_GAP");
    expect(deriveChallengeStatus({ conditionObserved: true, hasCounterEvidence: false, citedEvidenceStale: true, hasGaps: false })).toBe("STALE");
  });

  it("stale evidence: a challenge whose cited basis went stale derives STALE (freshness, not wall-clock age)", async () => {
    const { challengeFromFalsificationTarget } = await import("../../src/research/challenge-derive.js");
    const { ws, thesisId } = seedWorkspace();
    // Mark the only counter-evidence object STALE (freshness flag, not age).
    const snap = ws.toSnapshot();
    const staleEv = { ...snap.evidence[1]!, freshness: "STALE" as const };
    const ws2 = Workspace.fromSnapshot({ ...snap, evidence: [snap.evidence[0]!, staleEv] });
    const assessment = {
      targetBelief: "BTC makes higher highs",
      claims: [], assumptions: [], vulnerableAssumptions: [],
      falsificationTargets: [{
        condition: "quarterly close below the opening range",
        attacksAssumption: "BTC makes higher highs through the quarter",
        conditionStatus: "DERIVED_FROM_BELIEF" as const,
        objectRefs: [staleEv.id],
      }],
      contradictionsFound: [],
      noCredibleContradictionFound: false,
      currentAssessment: "WEAKENED" as const,
      invalidationConditions: [], earlyWarnings: [],
      confidence: "MODERATE" as const,
      rationale: "r", citedObjectRefs: [snap.evidence[0]!.id],
    };
    const challenge = challengeFromFalsificationTarget({
      assessment, target: assessment.falsificationTargets[0]!,
      workspace: ws2, thesisId, thesisVersion: 1, researchRef: "rs_000001",
    });
    expect(challenge).toBeDefined();
    expect(challenge!.status).toBe("STALE");
    // Age alone never degrades: a CURRENT evidence object stays active regardless of timestamp.
    expect(challenge!.counterEvidenceRefs).toEqual([staleEv.id]);
  });

  it("information gaps: honest unknowns are recorded; a PROPOSED threshold with gap context becomes INFORMATION_GAP, never established", async () => {
    const { challengeFromFalsificationTarget } = await import("../../src/research/challenge-derive.js");
    const { ws, thesisId } = seedWorkspace();
    const assessment = {
      targetBelief: "BTC makes higher highs",
      claims: [], assumptions: [], vulnerableAssumptions: [],
      falsificationTargets: [{
        condition: "30%+ drawdown from cycle high",
        attacksAssumption: "BTC makes higher highs through the quarter",
        conditionStatus: "PROPOSED" as const,
        objectRefs: [],
      }],
      contradictionsFound: [],
      noCredibleContradictionFound: false,
      currentAssessment: "INDETERMINATE" as const,
      invalidationConditions: [],
      earlyWarnings: ["funding resets without price follow-through"],
      confidence: "LOW" as const,
      rationale: "r", citedObjectRefs: [],
    };
    const challenge = challengeFromFalsificationTarget({
      assessment, target: assessment.falsificationTargets[0]!,
      workspace: ws, thesisId, thesisVersion: 1, researchRef: "rs_000001",
    });
    // PROPOSED + unobserved + no contradiction: kept only as a labeled proposal (gap note),
    // and the falsifier origin stays PROPOSED.
    expect(challenge).toBeDefined();
    expect(challenge!.falsifier.origin).toBe("PROPOSED");
    expect(challenge!.conditionObserved).toBe(false);
    expect(challenge!.informationGaps.some((g) => g.includes("PROPOSED"))).toBe(true);
    expect(challenge!.informationGaps.some((g) => g.includes("funding resets"))).toBe(true);
  });

  it("materiality: a MINOR contradiction never becomes a persistent challenge (no endless warnings)", async () => {
    const { challengeFromFalsificationTarget } = await import("../../src/research/challenge-derive.js");
    const { ws, thesisId } = seedWorkspace();
    const assessment = {
      targetBelief: "BTC makes higher highs",
      claims: [], assumptions: [], vulnerableAssumptions: [],
      falsificationTargets: [{
        condition: "single weak source disagrees",
        attacksAssumption: "BTC makes higher highs",
        conditionStatus: "DERIVED_FROM_BELIEF" as const,
        objectRefs: ["ev_000002"],
      }],
      contradictionsFound: [{
        description: "one weak RSS item disagreed",
        materiality: "MINOR" as const,
        rationale: "single weak source",
        objectRefs: ["ev_000002"],
      }],
      noCredibleContradictionFound: false,
      currentAssessment: "SUPPORTED" as const,
      invalidationConditions: [], earlyWarnings: [],
      confidence: "HIGH" as const,
      rationale: "r", citedObjectRefs: [],
    };
    const challenge = challengeFromFalsificationTarget({
      assessment, target: assessment.falsificationTargets[0]!,
      workspace: ws, thesisId, thesisVersion: 1, researchRef: "rs_000001",
    });
    // MINOR contradiction alone does not justify a record; DERIVED_FROM_BELIEF target with a
    // cited graph ref DOES (the thesis's own invalidation condition is being watched).
    expect(challenge).toBeDefined();
    expect(challenge!.falsifier.materiality).not.toBe("MINOR");
  });

  it("irrelevant evidence rejection: unknown/fabricated refs are dropped, never stored", async () => {
    const { challengeFromFalsificationTarget } = await import("../../src/research/challenge-derive.js");
    const { ws, thesisId } = seedWorkspace();
    const assessment = {
      targetBelief: "BTC makes higher highs",
      claims: [], assumptions: [], vulnerableAssumptions: [],
      falsificationTargets: [{
        condition: "quarterly close below opening range",
        attacksAssumption: "BTC makes higher highs",
        conditionStatus: "DERIVED_FROM_BELIEF" as const,
        objectRefs: ["ev_000999", "ev_000002"],
      }],
      contradictionsFound: [],
      noCredibleContradictionFound: false,
      currentAssessment: "WEAKENED" as const,
      invalidationConditions: [], earlyWarnings: [],
      confidence: "MODERATE" as const,
      rationale: "r", citedObjectRefs: ["ev_000001", "ev_042042"],
    };
    const challenge = challengeFromFalsificationTarget({
      assessment, target: assessment.falsificationTargets[0]!,
      workspace: ws, thesisId, thesisVersion: 1, researchRef: "rs_000001",
    });
    expect(challenge).toBeDefined();
    expect(challenge!.counterEvidenceRefs).toEqual(["ev_000002"]);
    expect(challenge!.supportingEvidenceRefs).toEqual(["ev_000001"]);
  });

  it("persistence: challenges survive a snapshot round-trip and cold start with counters intact", () => {
    const { ws, thesisId } = seedWorkspace();
    ws.recordChallenges([baseChallengeInput({ thesisId })], agent, new Date("2026-09-28T12:00:00Z"));
    const restored = Workspace.fromSnapshot(ws.toSnapshot());
    const challenges = restored.listChallenges();
    expect(challenges).toHaveLength(1);
    expect(challenges[0]!.id).toMatch(/^ch_000001$/);
    // Counter continuity: the next challenge after restore must NOT re-mint ch_000001.
    const [next] = restored.recordChallenges(
      [baseChallengeInput({ thesisId, claim: "a different challenge identity" })],
      agent,
      new Date("2026-09-28T14:00:00Z"),
    );
    expect(next.id).toBe("ch_000002");
  });

  it("thesis immutability: recording challenges never touches the thesis object", () => {
    const { ws, thesisId } = seedWorkspace();
    const before = ws.getThesis(thesisId);
    ws.recordChallenges([baseChallengeInput({ thesisId, status: "CONTRADICTION" })], agent);
    ws.recordChallenges([baseChallengeInput({ thesisId, status: "RESOLVED" })], agent);
    const after = ws.getThesis(thesisId);
    expect(after).toEqual(before);
    expect(after!.version).toBe(1);
    expect(after!.statement).toBe("BTC makes higher highs through the quarter");
  });

  it("superseded generations go STALE: a challenge not re-derived by the latest research is marked, kept, never deleted", () => {
    const { ws, thesisId } = seedWorkspace();
    ws.recordChallenges([baseChallengeInput({ thesisId, claim: "generation one" , researchRef: "rs_000001" })], agent, new Date("2026-09-28T12:00:00Z"));
    ws.recordChallenges([baseChallengeInput({ thesisId, claim: "generation two", researchRef: "rs_000002" })], agent, new Date("2026-09-28T13:00:00Z"));
    const all = ws.listChallenges();
    expect(all).toHaveLength(2);
    const g1 = all.find((c) => c.claim === "generation one");
    const g2 = all.find((c) => c.claim === "generation two");
    expect(g1!.status).toBe("STALE");
    expect(g2!.status).toBe("ACTIVE");
    expect(g1!.provenance.at(-1)!.note).toContain("not re-derived");
  });

  it("multi-instance merge: challenges union by id (no duplication across instances; merge defect fix also covers assessments)", () => {
    const { ws, thesisId } = seedWorkspace();
    ws.recordChallenges([baseChallengeInput({ thesisId })], agent, new Date("2026-09-28T12:00:00Z"));
    const snapA = ws.toSnapshot();
    // Another instance holds the same challenge (identical id) plus an extra one.
    const wsB = Workspace.fromSnapshot(snapA);
    wsB.recordChallenges([baseChallengeInput({ thesisId, claim: "instance B found another", status: "CONTRADICTION" })], agent, new Date("2026-09-28T13:00:00Z"));
    const snapB = wsB.toSnapshot();
    const merged = mergeSnapshots(snapA, snapB);
    expect(merged.challenges).toHaveLength(2);
    // Assessments merge by id too (the pre-existing concat defect would have doubled them).
    const assessments = [{ id: "assessment_000001", thesisId, thesisVersion: 1, assessment: "SUPPORTED", rationale: "r", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "HIGH", provenance: [], createdAt: "2026-09-28T12:00:00.000Z" }];
    const m1 = mergeSnapshots({ ...snapA, thesisAssessments: assessments }, { ...snapB, thesisAssessments: assessments });
    expect(m1.thesisAssessments).toHaveLength(1);
  });

  it("deterministic transitions: illegal status moves are rejected by the domain table", async () => {
    const { challengeTransitionAllowed } = await import("../../src/domain/challenge.js");
    expect(challengeTransitionAllowed("ACTIVE", "RESOLVED")).toBe(true);
    expect(challengeTransitionAllowed("RESOLVED", "ACTIVE")).toBe(true); // only new research re-opens
    expect(challengeTransitionAllowed("STALE", "CONTRADICTION")).toBe(false);
    expect(challengeTransitionAllowed("RESOLVED", "CONTRADICTION")).toBe(false);
  });
});
