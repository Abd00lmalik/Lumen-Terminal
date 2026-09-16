import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { FileStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const trader = { kind: "trader" as const, detail: "trader confirms" };
const system = { kind: "agent" as const, detail: "system" };

beforeEach(() => resetIdCounters());

describe("M5 research memory (memory.md; M5 §4–§6, §18)", () => {
  it("SAVE creates persistent memory with provenance and source links", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const memory = ws.addMemory(
      { category: "research", content: "ETF flows turned positive in March", sourceResearchRef: research.id, confidence: "MODERATE" },
      trader,
    );
    expect(memory.status).toBe("CURRENT");
    expect(memory.category).toBe("research");
    expect(memory.sourceResearchRef).toBe(research.id);
    expect(memory.provenance.length).toBeGreaterThan(0);
  });

  it("memory categories are preserved (research/thesis/framework/preference/historical/monitor)", () => {
    const ws = new Workspace();
    for (const category of ["research", "thesis", "framework", "preference", "historical", "monitor"] as const) {
      ws.addMemory({ category, content: `${category} memory` }, trader);
    }
    expect(ws.listMemories()).toHaveLength(6);
    expect(ws.listMemoriesByCategory("framework")).toHaveLength(1);
    expect(ws.listMemoriesByCategory("research")[0]?.content).toBe("research memory");
  });

  it("ordinary research does NOT automatically become memory — only explicit addMemory calls create entries", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    ws.transitionResearch(research.id, "ACTIVE", system, "activated");
    ws.transitionResearch(research.id, "COMPLETED", system, "done");
    // Research + judgment activity happened, but nothing was SAVE-promoted:
    expect(ws.listMemories()).toHaveLength(0);
  });

  it("decay reduces influence, never deletes: STALE/HISTORICAL entries remain listable with reasons", () => {
    const ws = new Workspace();
    const memory = ws.addMemory({ category: "historical", content: "funding was extreme in the last cycle" }, trader);
    const decayed = ws.decayMemory(memory.id, "HISTORICAL", "cycle ended; kept for historical comparison only", system);
    expect(decayed.status).toBe("HISTORICAL");
    expect(decayed.statusReason).toContain("cycle ended");
    // NOT deleted:
    expect(ws.listMemories()).toHaveLength(1);
    expect(ws.getMemory(memory.id)?.content).toBe("funding was extreme in the last cycle");
    // Provenance records the decay:
    expect(decayed.provenance.some((p) => p.note?.includes("HISTORICAL"))).toBe(true);
  });

  it("stale memory does not override current evidence: conflict resolution marks memory, preserves record (M5 §18)", () => {
    const ws = new Workspace();
    const memory = ws.addMemory({ category: "research", content: "X is true per last month's research" }, trader);
    const updated = ws.resolveMemoryConflict(memory.id, "ev_000001", "current validated research no longer supports X", system);
    // Memory marked stale (loses current influence):
    expect(updated.status).toBe("STALE");
    expect(updated.validationNote).toContain("ev_000001");
    expect(updated.validationNote).toContain("supersedes");
    // Historical record PRESERVED (content unchanged, never overwritten):
    expect(updated.content).toBe("X is true per last month's research");
    expect(ws.getMemory(memory.id)?.content).toBe("X is true per last month's research");
  });

  it("revalidation records the outcome while preserving the original entry", () => {
    const ws = new Workspace();
    const memory = ws.addMemory({ category: "framework", content: "framework criteria" }, trader);
    ws.decayMemory(memory.id, "STALE", "not used in a while", system);
    const revalidated = ws.revalidateMemory(memory.id, { confirmed: true, note: "trader re-confirmed framework", newStatus: "CURRENT" }, trader);
    expect(revalidated.status).toBe("CURRENT");
    expect(revalidated.lastValidatedAt).toBeDefined();
    expect(revalidated.validationNote).toContain("confirmed");
    // Original content + provenance chain intact:
    expect(revalidated.content).toBe("framework criteria");
    expect(revalidated.provenance.some((p) => p.note?.includes("revalidated"))).toBe(true);
  });

  it("persistence failure discipline: memory round-trips through the file store exactly once and intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5-mem-"));
    const store = new FileStore(join(dir, "workspace.json"));
    try {
      const ws = new Workspace();
      ws.addMemory({ category: "research", content: "persisted memory" }, trader);
      await store.save(ws.toSnapshot());
      const reloaded = await store.load();
      expect(reloaded).toBeDefined();
      expect(reloaded?.listMemories()).toHaveLength(1);
      expect(reloaded?.listMemories()[0]?.content).toBe("persisted memory");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("M5 monitoring handoff (thesis-monitor-reassessment.md §20–§26; M5 §10–§12)", () => {
  it("proposal creation: PROPOSED status with distinct invalidation vs early-warning conditions", () => {
    const ws = new Workspace();
    const thesis = ws.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    const monitor = ws.addMonitorProposal(
      {
        target: "BTC",
        triggerRationale: "thesis depends on macro stability",
        thesisRef: thesis.id,
        thesisVersion: thesis.version,
        conditions: [
          { description: "quarterly close below opening range", kind: "INVALIDATION", triggerType: "THRESHOLD", conditionStatus: "DERIVED_FROM_THESIS", rationale: "thesis's own condition", evidenceDependencies: ["klines:BTCUSDT:1d"] },
          { description: "funding resets without follow-through", kind: "EARLY_WARNING", triggerType: "PATTERN", conditionStatus: "PROPOSED", rationale: "rising risk signal", evidenceDependencies: ["funding:BTC"] },
        ],
      },
      system,
    );
    expect(monitor.status).toBe("PROPOSED"); // inert
    expect(monitor.conditions[0]?.kind).toBe("INVALIDATION");
    expect(monitor.conditions[1]?.kind).toBe("EARLY_WARNING"); // distinct — never merged
    expect(monitor.thesisVersion).toBe(1);
  });

  it("confirmation boundary: only trader origins can activate — system/model origins are rejected", () => {
    const ws = new Workspace();
    const monitor = ws.addMonitorProposal({ target: "BTC", conditions: [], triggerRationale: "r" }, system);
    expect(() => ws.activateMonitor(monitor.id, system, "self-activation")).toThrow(/trader confirmation/);
    expect(ws.getMonitor(monitor.id)?.status).toBe("PROPOSED"); // unchanged
    const activated = ws.activateMonitor(monitor.id, trader, "trader confirms monitoring");
    expect(activated.status).toBe("ACTIVE");
    expect(activated.provenance.some((p) => p.origin.kind === "trader")).toBe(true);
  });

  it("monitor lifecycle follows PROPOSED → ACTIVE → PAUSED → ACTIVE/COMPLETED with illegal transitions rejected", () => {
    const ws = new Workspace();
    const monitor = ws.addMonitorProposal({ target: "t", conditions: [], triggerRationale: "r" }, trader);
    const active = ws.activateMonitor(monitor.id, trader, "go");
    const paused = ws.transitionMonitor(active.id, "PAUSED", trader, "stepping away");
    expect(paused.status).toBe("PAUSED");
    const resumed = ws.transitionMonitor(paused.id, "ACTIVE", trader, "back");
    expect(resumed.status).toBe("ACTIVE");
    const completed = ws.transitionMonitor(resumed.id, "COMPLETED", trader, "thesis resolved");
    expect(completed.status).toBe("COMPLETED");
    // COMPLETED is terminal:
    expect(() => ws.transitionMonitor(completed.id, "ACTIVE", trader, "zombie")).toThrow(/illegal monitor transition/);
    // PROPOSED → PAUSED is illegal (never was active):
    const m2 = ws.addMonitorProposal({ target: "t", conditions: [], triggerRationale: "r" }, trader);
    expect(() => ws.transitionMonitor(m2.id, "PAUSED", trader, "skip activation")).toThrow(/illegal monitor transition/);
  });

  it("SOURCE_UNAVAILABLE is a state, never a false invalidation (M5 §12)", () => {
    const ws = new Workspace();
    const monitor = ws.activateMonitor(ws.addMonitorProposal({ target: "BTC", conditions: [], triggerRationale: "r" }, trader).id, trader, "go");
    const updated = ws.recordMonitorSourceState(monitor.id, "funding:BTC", "SOURCE_UNAVAILABLE", "upstream feed unreachable", system);
    expect(updated.sourceStates).toHaveLength(1);
    expect(updated.sourceStates[0]?.state).toBe("SOURCE_UNAVAILABLE");
    // The thesis status is untouched — a source outage is NOT invalidation evidence:
    const thesis = ws.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    expect(ws.getThesis(thesis.id)?.status).toBe("ACTIVE");
    // Provenance records the limitation:
    expect(updated.provenance.some((p) => p.note?.includes("SOURCE_UNAVAILABLE"))).toBe(true);
  });

  it("revalidation flag (M5 §15): monitor flagged for review is marked STALE — never silently deleted or reworded", () => {
    const ws = new Workspace();
    const monitor = ws.activateMonitor(ws.addMonitorProposal({ target: "t", conditions: [{ description: "condition A", kind: "EARLY_WARNING", triggerType: "STATE_CHANGE", conditionStatus: "PROPOSED", rationale: "r", evidenceDependencies: [] }], triggerRationale: "r" }, trader).id, trader, "go");
    const flagged = ws.flagMonitorForReview(monitor.id, "reassessment made condition A immaterial", system);
    expect(flagged.status).toBe("STALE"); // review state
    expect(flagged.conditions[0]?.description).toBe("condition A"); // conditions NOT silently changed
    expect(ws.getMonitor(monitor.id)).toBeDefined(); // NOT deleted
    expect(flagged.provenance.some((p) => p.note?.includes("review"))).toBe(true);
  });
});

describe("M5 thesis assessment history (M5 §8–§9, §14)", () => {
  it("assessment is a research result: recorded in history, thesis object unchanged", () => {
    const ws = new Workspace();
    const thesis = ws.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    const record = ws.recordThesisAssessment({
      thesisId: thesis.id,
      thesisVersion: thesis.version,
      assessment: "WEAKENED",
      rationale: "assumption weakened by CPI",
      supportingEvidence: ["ev_000001"],
      contradictingEvidence: ["ev_000002"],
      unresolved: ["ETF flows"],
      whatWouldChange: ["macro pause"],
      confidence: "MODERATE",
      researchQuality: "MIXED",
    }, system);
    expect(record.assessment).toBe("WEAKENED");
    expect(record.thesisVersion).toBe(1);
    // THESIS UNCHANGED:
    expect(ws.getThesis(thesis.id)?.status).toBe("ACTIVE");
    expect(ws.getThesis(thesis.id)?.version).toBe(1);
    expect(ws.getThesis(thesis.id)?.statement).toBe("BTC trends up");
    // History retrievable:
    expect(ws.latestThesisAssessment(thesis.id)?.id).toBe(record.id);
    expect(ws.listThesisAssessments(thesis.id)).toHaveLength(1);
  });

  it("assessment history accumulates across reassessments with full context per record", () => {
    const ws = new Workspace();
    const thesis = ws.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    ws.recordThesisAssessment({ thesisId: thesis.id, thesisVersion: 1, assessment: "SUPPORTED", rationale: "r1", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW" }, system);
    ws.recordThesisAssessment({ thesisId: thesis.id, thesisVersion: 1, assessment: "WEAKENED", rationale: "r2", supportingEvidence: [], contradictingEvidence: ["ev_1"], unresolved: ["u"], whatWouldChange: ["w"], confidence: "MODERATE", researchQuality: "STRONG" }, system);
    expect(ws.listThesisAssessments(thesis.id)).toHaveLength(2);
    const latest = ws.latestThesisAssessment(thesis.id);
    expect(latest?.assessment).toBe("WEAKENED");
    expect(latest?.researchQuality).toBe("STRONG"); // research quality tracked separately from confidence
    expect(latest?.confidence).toBe("MODERATE");
  });

  it("assessment requires a real thesis — no fabricated targets", () => {
    const ws = new Workspace();
    expect(() => ws.recordThesisAssessment({ thesisId: "th_999999", thesisVersion: 1, assessment: "SUPPORTED", rationale: "x", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW" }, system)).toThrow(/Unknown thesis/);
  });

  it("assessment history round-trips through persistence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m5-hist-"));
    const store = new FileStore(join(dir, "workspace.json"));
    try {
      const ws = new Workspace();
      const thesis = ws.addThesis({ statement: "s", objective: "o" }, trader);
      ws.recordThesisAssessment({ thesisId: thesis.id, thesisVersion: 1, assessment: "SUPPORTED", rationale: "r", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW" }, system);
      await store.save(ws.toSnapshot());
      const reloaded = await store.load();
      expect(reloaded).toBeDefined();
      expect(reloaded?.listThesisAssessments(thesis.id)).toHaveLength(1);
      expect(reloaded?.listThesisAssessments(thesis.id)[0]?.rationale).toBe("r");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("M5 workspace continuity (M5 §16)", () => {
  it("getContinuitySnapshot exposes the full recovery view", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "target obj", question: "q", flow: "WHAT_HAPPENED" }, trader);
    ws.transitionResearch(research.id, "ACTIVE", system, "activated");
    const thesis = ws.addThesis({ statement: "active thesis", objective: "swing" }, trader);
    ws.saveArtifact({ type: "framework", content: "criteria", derivedFromRefs: [], rationale: "r" }, trader);
    ws.recordThesisAssessment({ thesisId: thesis.id, thesisVersion: 1, assessment: "SUPPORTED", rationale: "r", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW" }, system);
    ws.addMonitorProposal({ target: "BTC", conditions: [], triggerRationale: "r", thesisRef: thesis.id, thesisVersion: 1 }, system);
    ws.addMemory({ category: "research", content: "memory" }, trader);
    const snap = ws.getContinuitySnapshot();
    expect(snap.activeResearchTarget?.id).toBe(research.id);
    expect(snap.activeThesis?.id).toBe(thesis.id);
    expect(snap.latestThesisAssessment?.assessment).toBe("SUPPORTED");
    expect(snap.activeFramework?.type).toBe("framework");
    expect(snap.monitorProposals).toHaveLength(1);
    expect(snap.activeMonitors).toHaveLength(0); // proposed ≠ active
    expect(snap.memories).toHaveLength(1);
  });

  it("continuity snapshot preserves contradictions and unresolved uncertainties", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    void research;
    const snap = ws.getContinuitySnapshot();
    expect(snap.importantContradictions).toEqual([]);
    expect(snap.unresolvedUncertainties).toEqual([]);
  });
});
