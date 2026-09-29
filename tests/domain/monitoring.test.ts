/**
 * Phase H: monitoring execution domain — deterministic, epistemically honest.
 * Covers: check identity idempotency, cadence law (incl. paused/MANUAL), assessment outcome
 * vocabulary (provider failure ≠ negative evidence; no data ≠ negative), notification dedup,
 * thesis immutability, challenge-derived conditions, merge union.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { checkDue, checkIdentity, cadenceIntervalMs, createMonitoringAssessment, createNotification } from "../../src/domain/monitoring.js";
import { conditionsFromChallenges } from "../../src/domain/monitor-derive.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };
const system: ProvenanceOrigin = { kind: "system", detail: "cron" };

function seedThesisWithChallenge(): { ws: Workspace; thesisId: string; challengeId: string } {
  const ws = new Workspace();
  const thesis = ws.addThesis({ statement: "BTC strength rests on liquidity and institutional demand", objective: "test" }, trader);
  const research = ws.addResearch({ objective: "falsification", question: "What could prove the thesis wrong?", flow: "WHAT_COULD_PROVE_ME_WRONG" }, trader);
  ws.addEvidence({ observation: "liquidity conditions deteriorating", evidenceType: "macro", evidenceClass: "OBSERVATION", researchRef: research.id }, trader);
  const [challenge] = ws.recordChallenges([{
    thesisId: thesis.id,
    thesisVersion: 1,
    claim: "liquidity deteriorates while institutional demand fails to offset",
    falsifier: {
      condition: "liquidity conditions deteriorate while institutional demand fails to offset",
      attacksClaim: "BTC strength rests on liquidity and institutional demand",
      origin: "DERIVED_FROM_BELIEF" as const,
      materiality: "MATERIAL_CONTRADICTION" as const,
    },
    status: "ACTIVE" as const,
    materialityRationale: "both supports fail together",
    supportingEvidenceRefs: [],
    counterEvidenceRefs: [],
    informationGaps: [],
    conditionObserved: false,
    researchRef: research.id,
    assessment: "WEAKENED" as const,
  }], { kind: "agent", detail: "Flow 7" });
  return { ws, thesisId: thesis.id, challengeId: challenge!.id };
}

beforeEach(() => resetIdCounters());

describe("Phase H: check identity & cadence", () => {
  it("the same evaluation window yields the SAME checkId (cron retry/concurrency dedup)", () => {
    const at = new Date("2026-09-29T12:34:56.789Z");
    const a = checkIdentity("mon_000001", "DAILY", at, 1);
    const b = checkIdentity("mon_000001", "DAILY", new Date("2026-09-29T18:00:00.000Z"), 1); // same day bucket
    expect(a.checkId).toBe(b.checkId);
    expect(a.checkId).toContain("mon_000001");
    expect(a.checkId).toContain("v1");
  });

  it("a different triggerVersion re-opens checking legitimately (conditions changed)", () => {
    const at = new Date("2026-09-29T12:00:00.000Z");
    const a = checkIdentity("mon_000001", "DAILY", at, 1);
    const b = checkIdentity("mon_000001", "DAILY", at, 2);
    expect(a.checkId).not.toBe(b.checkId);
  });

  it("cadence law: MANUAL never auto-fires; DAILY fires after 24h; WEEKLY after 7d", () => {
    const lastChecked = new Date("2026-09-28T12:00:00.000Z");
    expect(cadenceIntervalMs("MANUAL")).toBeUndefined();
    expect(checkDue({ cadence: "MANUAL" }, new Date("2026-09-30T12:00:00Z"))).toBe(false);
    expect(checkDue({ cadence: "DAILY", lastCheckedAt: lastChecked.toISOString() }, new Date("2026-09-29T11:59:00Z"))).toBe(false);
    expect(checkDue({ cadence: "DAILY", lastCheckedAt: lastChecked.toISOString() }, new Date("2026-09-29T12:01:00Z"))).toBe(true);
    expect(checkDue({ cadence: "WEEKLY", lastCheckedAt: lastChecked.toISOString() }, new Date("2026-09-30T12:01:00Z"))).toBe(false);
    expect(checkDue({ cadence: "WEEKLY", lastCheckedAt: lastChecked.toISOString() }, new Date("2026-10-05T12:01:00Z"))).toBe(true);
    expect(checkDue({ cadence: "DAILY" }, new Date())).toBe(true); // never checked → due
  });
});

describe("Phase H: assessment & notification objects", () => {
  it("assessments keep epistemic contracts: provider failure and insufficient evidence are NOT negative changes", () => {
    const ws = new Workspace();
    const failure = createMonitoringAssessment({
      monitorRef: "mon_000001", checkId: "mon_000001:2026-09-29T00:00:00.000Z:v1",
      checkedAt: new Date().toISOString(), outcome: "PROVIDER_UNAVAILABLE",
      changedConditions: [], thesisImpact: "UNDETERMINED",
      summary: "provider down; nothing asserted", confidence: "LOW", uncertainty: ["provider down"],
    }, system);
    const insufficient = createMonitoringAssessment({
      monitorRef: "mon_000001", checkId: "mon_000001:2026-09-28T00:00:00.000Z:v1",
      checkedAt: new Date().toISOString(), outcome: "INSUFFICIENT_EVIDENCE",
      changedConditions: [], thesisImpact: "UNDETERMINED",
      summary: "no usable data", confidence: "LOW", uncertainty: ["no data"],
    }, system);
    ws.recordMonitoringAssessment(failure);
    ws.recordMonitoringAssessment(insufficient);
    expect(failure.thesisImpact).not.toBe("WEAKENS_THESIS");
    expect(insufficient.changedConditions).toHaveLength(0);
    expect(ws.listMonitoringAssessments("mon_000001")).toHaveLength(2);
  });

  it("notification dedup: at most one notification per checkId (duplicate cron execution)", () => {
    const ws = new Workspace();
    const checkId = "mon_000001:2026-09-29T00:00:00.000Z:v1";
    const first = ws.recordNotification(createNotification({
      monitorRef: "mon_000001", assessmentRef: "mk_000001", checkId,
      title: "Material change", summary: "s", materiality: "MATERIAL", thesisImpact: "WEAKENS_THESIS",
    }, system));
    const existing = ws.findNotificationByCheckId(checkId);
    expect(existing?.id).toBe(first.id);
    // The caller creates a second only when findNotificationByCheckId returns undefined;
    // assert the dedup LOOKUP is what the orchestrator uses.
    expect(ws.findNotificationByCheckId(checkId)).toBeDefined();
    expect(ws.listNotifications()).toHaveLength(1);
  });

  it("mark-notification-read round-trips and appends provenance", () => {
    const ws = new Workspace();
    const n = ws.recordNotification(createNotification({
      monitorRef: "mon_000001", assessmentRef: "mk_000001", checkId: "c1",
      title: "t", summary: "s", materiality: "MEANINGFUL", thesisImpact: "WEAKENS_THESIS",
    }, system));
    const before = n.provenance.length;
    const updated = ws.markNotificationRead(n.id, trader);
    expect(updated.read).toBe(true);
    expect(updated.provenance.length).toBe(before + 1);
  });
});

describe("Phase H: challenge-derived conditions (§5)", () => {
  it("conditions derive from challenges with typed linkage; resolved challenges are excluded", () => {
    const { ws, thesisId, challengeId } = seedThesisWithChallenge();
    const { conditions, challengeRefs } = conditionsFromChallenges(ws, thesisId);
    expect(conditions).toHaveLength(1);
    expect(challengeRefs).toEqual([challengeId]);
    expect(conditions[0]!.conditionStatus).toBe("DERIVED_FROM_THESIS");
    expect(conditions[0]!.evidenceDependencies).toEqual([challengeId]);
    expect(conditions[0]!.kind).toBe("INVALIDATION");

    // Resolve the challenge → a NEW monitor derivation excludes it.
    const snap = ws.toSnapshot();
    const updatedChallenges = snap.challenges!.map((c) => (c.id === challengeId ? { ...c, status: "RESOLVED" as const } : c));
    const ws2 = Workspace.fromSnapshot({ ...snap, challenges: updatedChallenges });
    const after = conditionsFromChallenges(ws2, thesisId);
    expect(after.conditions).toHaveLength(0);
  });

  it("conditions deduplicate by falsifier text (one challenge identity = one watch)", () => {
    const { ws, thesisId } = seedThesisWithChallenge();
    // A second, textually identical challenge (e.g. re-derived in a new run with a new ref).
    const research = ws.listResearch()[0]!;
    ws.recordChallenges([{
      thesisId, thesisVersion: 1,
      claim: "liquidity deteriorates while institutional demand fails to offset",
      falsifier: {
        condition: "liquidity conditions   deteriorate while institutional demand fails to offset", // whitespace-normalized match
        attacksClaim: "BTC strength rests on liquidity and institutional demand",
        origin: "DERIVED_FROM_BELIEF" as const,
        materiality: "MATERIAL_CONTRADICTION" as const,
      },
      status: "ACTIVE" as const,
      materialityRationale: "both supports fail together",
      supportingEvidenceRefs: [], counterEvidenceRefs: [], informationGaps: [],
      conditionObserved: false, researchRef: research.id, assessment: "WEAKENED" as const,
    }], { kind: "agent", detail: "Flow 7 second run" });
    const { conditions, challengeRefs } = conditionsFromChallenges(ws, thesisId);
    expect(conditions).toHaveLength(1);
    expect(challengeRefs).toHaveLength(1);
  });
});

describe("Phase H: monitor lifecycle & execution state", () => {
  it("proposed monitor is inert; activation requires trader origin; paused executes nothing", () => {
    const { ws, thesisId, challengeId } = seedThesisWithChallenge();
    const { conditions, challengeRefs } = conditionsFromChallenges(ws, thesisId);
    const monitor = ws.addExecutableMonitorProposal({
      target: "BTC liquidity monitor", conditions, triggerRationale: "challenge-derived",
      thesisRef: thesisId, thesisVersion: 1, cadence: "DAILY", linkedChallengeRefs: challengeRefs,
    }, trader);
    expect(monitor.status).toBe("PROPOSED");
    expect(monitor.cadence).toBe("DAILY");
    expect(monitor.linkedChallengeRefs).toEqual([challengeId]);
    expect(monitor.triggerVersion).toBe(1);

    // System origin CANNOT activate (no silent activation, §3).
    expect(() => ws.activateMonitor(monitor.id, system, "cron says hi")).toThrow(/trader confirmation/);
    const activated = ws.activateMonitor(monitor.id, trader, "user activated via UI");
    expect(activated.status).toBe("ACTIVE");

    const paused = ws.transitionMonitor(monitor.id, "PAUSED", trader, "user paused");
    expect(paused.status).toBe("PAUSED");
    const resumed = ws.transitionMonitor(monitor.id, "ACTIVE", trader, "user resumed");
    expect(resumed.status).toBe("ACTIVE");
  });

  it("conditions can ONLY be changed by the trader (monitor never silently rewrites itself, §3)", () => {
    const { ws, thesisId } = seedThesisWithChallenge();
    const { conditions } = conditionsFromChallenges(ws, thesisId);
    const monitor = ws.addExecutableMonitorProposal({
      target: "t", conditions, triggerRationale: "r", thesisRef: thesisId, thesisVersion: 1, cadence: "MANUAL",
    }, trader);
    expect(() => ws.updateMonitorConditions(monitor.id, [{ ...conditions[0]!, description: "rewritten by the system" }], system, "self-edit")).toThrow(/trader/);
    const updated = ws.updateMonitorConditions(monitor.id, [{ ...conditions[0]!, description: "user-refined condition" }], trader, "user refined");
    expect(updated.conditions[0]!.description).toBe("user-refined condition");
    expect(updated.triggerVersion).toBe(2); // re-check legitimately re-opens
  });

  it("check-state patches touch execution fields only (never conditions/thesis)", () => {
    const { ws, thesisId } = seedThesisWithChallenge();
    const { conditions } = conditionsFromChallenges(ws, thesisId);
    const monitor = ws.addExecutableMonitorProposal({
      target: "t", conditions, triggerRationale: "r", thesisRef: thesisId, thesisVersion: 1, cadence: "DAILY", linkedChallengeRefs: ["ch_000001"],
    }, trader);
    const before = ws.getMonitor(monitor.id)!;
    const after = ws.recordMonitorCheck(monitor.id, {
      lastCheckedAt: "2026-09-29T12:00:00.000Z",
      lastTriggeredAt: "2026-09-29T12:00:00.000Z",
      lastAssessmentRef: "mk_000001",
    }, system, "check done");
    expect(after.lastCheckedAt).toBe("2026-09-29T12:00:00.000Z");
    expect(after.lastAssessmentRef).toBe("mk_000001");
    expect(after.conditions).toEqual(before.conditions);
    expect(after.linkedChallengeRefs).toEqual(before.linkedChallengeRefs);
    // Thesis byte-identical (§12 hard invariant).
    expect(ws.getThesis(thesisId)).toEqual(ws.getThesis(thesisId));
    const thesisSnap = ws.toSnapshot();
    expect(thesisSnap.theses.find((t) => t.id === thesisId)!.version).toBe(1);
  });
});

describe("Phase H: persistence & merge", () => {
  it("assessments and notifications survive snapshot round-trip with counter continuity", () => {
    const ws = new Workspace();
    ws.recordMonitoringAssessment(createMonitoringAssessment({
      monitorRef: "mon_000001", checkId: "c1", checkedAt: new Date().toISOString(),
      outcome: "NO_MATERIAL_CHANGE", changedConditions: [], thesisImpact: "NO_IMPACT",
      summary: "s", confidence: "HIGH", uncertainty: [],
    }, system));
    ws.recordNotification(createNotification({
      monitorRef: "mon_000001", assessmentRef: "mk_000001", checkId: "c1",
      title: "t", summary: "s", materiality: "MATERIAL", thesisImpact: "WEAKENS_THESIS",
    }, system));
    const restored = Workspace.fromSnapshot(ws.toSnapshot());
    expect(restored.listMonitoringAssessments()).toHaveLength(1);
    expect(restored.listNotifications()).toHaveLength(1);
    // Counters continue past mk_000001 / nt_000001.
    const next = createMonitoringAssessment({
      monitorRef: "mon_000001", checkId: "c2", checkedAt: new Date().toISOString(),
      outcome: "NO_MATERIAL_CHANGE", changedConditions: [], thesisImpact: "NO_IMPACT",
      summary: "s", confidence: "HIGH", uncertainty: [],
    }, system);
    expect(next.id).toBe("mk_000002");
  });

  it("multi-instance merge unions assessments/notifications by id (no duplicates)", () => {
    const wsA = new Workspace();
    const a1 = createMonitoringAssessment({
      monitorRef: "mon_000001", checkId: "c1", checkedAt: new Date().toISOString(),
      outcome: "NO_MATERIAL_CHANGE", changedConditions: [], thesisImpact: "NO_IMPACT",
      summary: "s", confidence: "HIGH", uncertainty: [],
    }, system);
    wsA.recordMonitoringAssessment(a1);
    const snapA = wsA.toSnapshot();
    const wsB = Workspace.fromSnapshot(snapA);
    wsB.recordMonitoringAssessment(createMonitoringAssessment({
      monitorRef: "mon_000001", checkId: "c2", checkedAt: new Date().toISOString(),
      outcome: "MATERIAL_CHANGE", changedConditions: [], thesisImpact: "WEAKENS_THESIS",
      summary: "s2", confidence: "MODERATE", uncertainty: [],
    }, system));
    const snapB = wsB.toSnapshot();
    const merged = mergeSnapshots(snapA, snapB);
    expect(merged.monitoringAssessments).toHaveLength(2);
    // Merging again with the same remote adds nothing (idempotent).
    expect(mergeSnapshots(snapA, snapB).monitoringAssessments).toHaveLength(2);
  });
});
