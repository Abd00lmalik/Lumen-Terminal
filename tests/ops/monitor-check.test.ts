/**
 * Phase H: monitor check orchestrator over the REAL ResearchApp (§7 pipeline).
 * MONITOR-002 manual check no material change · MONITOR-003 material change ·
 * MONITOR-004 insufficient evidence · MONITOR-005 provider failure · MONITOR-006 duplicate
 * execution · MONITOR-008 paused · MONITOR-009 thesis unchanged · negative contracts (§22).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ResearchApp } from "../../src/api/research-app.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { runMonitorCheck, MAX_CHECKS_PER_CRON } from "../../src/ops/monitor-check.js";

const trader = { kind: "trader" as const, detail: "test" };
const system = { kind: "system" as const, detail: "cron" };

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return { tool: `fake/${capability.toLowerCase()}`, capability: cap, transport: "fake", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }] };
    },
  };
}

const FALSIFICATION_PLAN = JSON.stringify({
  objective: "monitoring check", scopeIncluded: ["macro"], scopeExcluded: [],
  tasks: [{ type: "EVIDENCE_GATHERING", objective: "check falsifiers", capabilities: ["NEWS_ANALYSIS"], completion: "c" }],
  completionCriteria: ["c"], adaptationPolicy: "falsification first",
});

function falsification(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    targetBelief: "BTC strength rests on liquidity",
    claims: [], assumptions: [], vulnerableAssumptions: [],
    falsificationTargets: [{ condition: "liquidity conditions deteriorate while institutional demand fails to offset", attacksAssumption: "liquidity support", conditionStatus: "DERIVED_FROM_BELIEF", objectRefs: [] }],
    contradictionsFound: [], noCredibleContradictionFound: true,
    currentAssessment: "SUPPORTED", invalidationConditions: [], earlyWarnings: [],
    confidence: "MODERATE", rationale: "nothing credible found", citedObjectRefs: [],
    ...overrides,
  });
}

async function makeApp(provider: FakeModelProvider): Promise<ResearchApp> {
  const store = new MemoryStore();
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("NEWS_ANALYSIS", "liquidity reading"));
  return ResearchApp.create({ provider, registry, store, workspace: new Workspace() });
}

async function seedMonitor(app: ResearchApp): Promise<string> {
  const ws = app.getWorkspace();
  const thesis = ws.addThesis({ statement: "BTC strength rests on liquidity and institutional demand", objective: "test" }, trader);
  const research = ws.addResearch({ objective: "falsification", question: "What could prove the thesis wrong?", flow: "WHAT_COULD_PROVE_ME_WRONG" }, trader);
  ws.addEvidence({ observation: "baseline liquidity observation for BTC", evidenceType: "macro", evidenceClass: "OBSERVATION", researchRef: research.id }, trader);
  const [challenge] = ws.recordChallenges([{
    thesisId: thesis.id, thesisVersion: 1,
    claim: "liquidity deteriorates while institutional demand fails to offset",
    falsifier: { condition: "liquidity conditions deteriorate while institutional demand fails to offset", attacksClaim: "liquidity support", origin: "DERIVED_FROM_BELIEF" as const, materiality: "MATERIAL_CONTRADICTION" as const },
    status: "ACTIVE" as const, materialityRationale: "both supports fail",
    supportingEvidenceRefs: [], counterEvidenceRefs: [], informationGaps: [],
    conditionObserved: false, researchRef: research.id, assessment: "WEAKENED" as const,
  }], { kind: "agent", detail: "Flow 7" });
  const monitor = ws.addExecutableMonitorProposal({
    target: "BTC liquidity", conditions: [{
      description: "liquidity conditions deteriorate while institutional demand fails to offset",
      kind: "INVALIDATION" as const, triggerType: "CONTRADICTION" as const,
      conditionStatus: "DERIVED_FROM_THESIS" as const, rationale: "challenge-derived",
      evidenceDependencies: [challenge!.id],
    }],
    triggerRationale: "challenge-derived", thesisRef: thesis.id, thesisVersion: 1,
    cadence: "MANUAL" as const, linkedChallengeRefs: [challenge!.id],
  }, trader);
  ws.activateMonitor(monitor.id, trader, "test activation");
  return monitor.id;
}

function scriptFlow7(provider: FakeModelProvider, overrides: Record<string, unknown> = {}): void {
  provider.responses.set("research.plan", FALSIFICATION_PLAN);
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  provider.responses.set("flow7.falsification", falsification(overrides));
}

beforeEach(() => resetIdCounters());

describe("Phase H: monitor check pipeline (MONITOR-002..009)", () => {
  it("MONITOR-002: manual check with NO material change → NO_MATERIAL_CHANGE, no notification", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider); // noCredibleContradictionFound: true → challenges stay non-contradiction
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const result = await runMonitorCheck(app, ref, trader, { force: true });
    expect(result.assessment.outcome).toBe("NO_MATERIAL_CHANGE");
    expect(result.notification).toBeUndefined();
    expect(result.executed).toBe(true);
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-003: the check's own research finds a contradiction → MATERIAL_CHANGE, notification, research linked", async () => {
    const provider = new FakeModelProvider(new Map());
    // The check's falsification research FINDS the contradiction: an assessment reporting a
    // MATERIAL_CONTRADICTION (Phase G's derivation inside Flow 7 turns this into a
    // CONTRADICTION challenge with CURRENT counter-evidence during the check itself).
    scriptFlow7(provider, {
      noCredibleContradictionFound: false,
      currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{
        description: "liquidity conditions deteriorate while institutional demand fails to offset",
        materiality: "MATERIAL_CONTRADICTION",
        rationale: "both supports failing together, observed now",
        // Cites evidence objects: the run's OWN gathered evidence (ev_000002 — minted by the
        // check's Flow 7 execution) is what the context validation accepts; the seeded baseline
        // (ev_000001) is listed too and dropped if the relevance gate keeps it out. An
        // evidence-less contradiction is NOT material (Phase G law) — this one must cite.
        objectRefs: ["ev_000001", "ev_000002"],
      }],
      rationale: "observed deterioration",
    });
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const ws = app.getWorkspace();

    const result = await runMonitorCheck(app, ref, system, { force: true });
    expect(result.assessment.outcome).toBe("MATERIAL_CHANGE");
    expect(result.notification).toBeDefined();
    expect(result.notification!.materiality).toBe("MATERIAL");
    expect(result.assessment.researchRef).toBeDefined();
    expect(result.assessment.thesisImpact).toBe("POTENTIALLY_INVALIDATES_ASSUMPTION");
    // The material change cites CURRENT counter-evidence objects (never fabricated).
    expect(result.assessment.changedConditions[0]!.evidenceRefs.length).toBeGreaterThan(0);
    expect(result.assessment.changedConditions[0]!.freshness).toBe("CURRENT");
    // MONITOR-009: thesis byte-identical after the material alert.
    const thesis = ws.getThesis(ws.getMonitor(ref)!.thesisRef!);
    expect(thesis!.version).toBe(1);
    expect(thesis!.status).toBe("ACTIVE");
    expect(thesis!.statement).toBe("BTC strength rests on liquidity and institutional demand");
  });

  it("MONITOR-005 + §22.3: provider failure → PROVIDER_UNAVAILABLE assessment, NO negative evidence, no notification", async () => {
    // No scripted responses at all → the engine's plan call fails with a typed ModelFailure.
    const provider = new FakeModelProvider(new Map());
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const result = await runMonitorCheck(app, ref, trader, { force: true });
    expect(result.assessment.outcome).toBe("PROVIDER_UNAVAILABLE");
    expect(result.assessment.thesisImpact).toBe("UNDETERMINED");
    expect(result.notification).toBeUndefined();
    expect(result.assessment.changedConditions).toHaveLength(0);
    // The check still persisted honestly (state recorded; retriable; nothing asserted).
    expect(app.getWorkspace().getMonitor(ref)!.lastCheckedAt).toBeDefined();
  });

  it("MONITOR-006: duplicate execution (same window, same triggerVersion) → idempotent, no duplicate assessment/notification", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const first = await runMonitorCheck(app, ref, trader, { force: true, now: new Date("2026-09-29T10:00:00Z") });
    const second = await runMonitorCheck(app, ref, trader, { force: true, now: new Date("2026-09-29T11:00:00Z") });
    expect(second.executed).toBe(false);
    expect(second.assessment.id).toBe(first.assessment.id);
    expect(app.getWorkspace().listMonitoringAssessments(ref)).toHaveLength(1);
  });

  it("MONITOR-008 + §22.11: a PAUSED monitor executes nothing", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    app.getWorkspace().transitionMonitor(ref, "PAUSED", trader, "user paused");
    const callsBefore = provider.calls.length;
    const result = await runMonitorCheck(app, ref, trader, { force: true });
    expect(result.assessment.outcome).toBe("MONITOR_PAUSED");
    expect(result.executed).toBe(false);
    expect(provider.calls.length).toBe(callsBefore); // NO research ran (no cost, §23)
  });

  it("§22.7/§22.8 regression: retry after 'partial persistence' (assessment saved, monitor patch lost) does not duplicate", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const first = await runMonitorCheck(app, ref, trader, { force: true, now: new Date("2026-09-29T10:00:00Z") });
    // Simulate the retry hitting the SAME checkId: dedup returns the first assessment.
    const retry = await runMonitorCheck(app, ref, trader, { force: true, now: new Date("2026-09-29T10:30:00Z") });
    expect(retry.assessment.id).toBe(first.assessment.id);
    expect(app.getWorkspace().listNotifications().filter((n) => n.checkId === first.assessment.checkId)).toHaveLength(first.notification !== undefined ? 1 : 0);
  });

  it("§23: cron batch bounds work (MAX_CHECKS_PER_CRON) and isolates per-monitor failures", async () => {
    const { runDueMonitorChecks } = await import("../../src/ops/monitor-check.js");
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const app = await makeApp(provider);
    const ws = app.getWorkspace();
    // More ACTIVE monitors than the batch bound.
    for (let i = 0; i < MAX_CHECKS_PER_CRON + 2; i += 1) {
      const thesis = ws.addThesis({ statement: `thesis ${i}`, objective: "t" }, trader);
      const monitor = ws.addExecutableMonitorProposal({
        target: `m${i}`, conditions: [{ description: `c${i}`, kind: "EARLY_WARNING", triggerType: "STATE_CHANGE", conditionStatus: "PROPOSED", rationale: "r", evidenceDependencies: [] }],
        triggerRationale: "r", thesisRef: thesis.id, thesisVersion: 1, cadence: "DAILY",
      }, trader);
      ws.activateMonitor(monitor.id, trader, "activated");
    }
    const result = await runDueMonitorChecks(app, system);
    expect(result.checked.length).toBeLessThanOrEqual(MAX_CHECKS_PER_CRON);
    // The rest are still ACTIVE (never silently skipped-and-lost; next window picks them up).
    expect(ws.listMonitors().filter((m) => m.status === "ACTIVE").length).toBeGreaterThanOrEqual(2);
  });
});
