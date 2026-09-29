/**
 * Phase H §22: critical negative contracts. Each pins something that MUST NOT happen.
 * (Isolation, paused-execution, duplicate-assessment/notification, provider-failure and
 * thesis-immutability negatives are pinned in monitor-check.test.ts, api/monitor.test.ts and
 * benchmark/monitor-scenarios.test.ts; this file covers the remaining epistemic contracts.)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ResearchApp } from "../../src/api/research-app.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { runMonitorCheck } from "../../src/ops/monitor-check.js";

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
    targetBelief: "BTC strength rests on liquidity", claims: [], assumptions: [], vulnerableAssumptions: [],
    falsificationTargets: [{ condition: "liquidity conditions deteriorate while institutional demand fails to offset", attacksAssumption: "liquidity support", conditionStatus: "DERIVED_FROM_BELIEF", objectRefs: [] }],
    contradictionsFound: [], noCredibleContradictionFound: true, currentAssessment: "SUPPORTED", invalidationConditions: [], earlyWarnings: [],
    confidence: "MODERATE", rationale: "nothing credible found", citedObjectRefs: [], ...overrides,
  });
}

function scriptFlow7(provider: FakeModelProvider, overrides: Record<string, unknown> = {}): void {
  provider.responses.set("research.plan", FALSIFICATION_PLAN);
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  provider.responses.set("flow7.falsification", falsification(overrides));
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
    target: "BTC liquidity",
    conditions: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", kind: "INVALIDATION", triggerType: "CONTRADICTION", conditionStatus: "DERIVED_FROM_THESIS", rationale: "challenge-derived", evidenceDependencies: [challenge!.id] }],
    triggerRationale: "challenge-derived", thesisRef: thesis.id, thesisVersion: 1, cadence: "MANUAL", linkedChallengeRefs: [challenge!.id],
  }, trader);
  ws.activateMonitor(monitor.id, trader, "test activation");
  return monitor.id;
}

beforeEach(() => resetIdCounters());

describe("Phase H §22 negative contracts", () => {
  it("§22.1/§22.2: price movement alone / one stale article → NO material alert", async () => {
    const provider = new FakeModelProvider(new Map());
    // The model reports a contradiction whose ONLY support is a STALE article: Phase G's law
    // (an assertion is not evidence) and the freshness gate reject it — no material change.
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MATERIAL_CONTRADICTION", rationale: "old conflicting article says so", objectRefs: [] }],
    });
    const result = await runMonitorCheck(app, ref, system, { force: true });
    expect(result.assessment.outcome).toBe("NO_MATERIAL_CHANGE");
    expect(result.notification).toBeUndefined();
  });

  it("§22.4: missing data is NOT negative change — NO DATA never becomes evidence against the thesis", async () => {
    const provider = new FakeModelProvider(new Map());
    // Provider returns a VALID assessment that reports it could not gather evidence:
    // INDETERMINATE, no contradictions. The orchestrator must record NO_MATERIAL_CHANGE with
    // the uncertainty surfaced — never NEGATIVE_CHANGE / thesis weakened.
    scriptFlow7(provider, { currentAssessment: "INDETERMINATE", confidence: "LOW", rationale: "no reachable data sources; nothing assessed" });
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const result = await runMonitorCheck(app, ref, system, { force: true });
    expect(result.assessment.outcome).toBe("NO_MATERIAL_CHANGE");
    expect(result.assessment.thesisImpact).toBe("NO_IMPACT");
    expect(result.notification).toBeUndefined();
  });

  it("§22.12: monitoring never DIRECTLY mutates challenges — no CONTRADICTION without the engine's evidence gate, no fabricated links", async () => {
    const provider = new FakeModelProvider(new Map());
    // No contradiction found by the check's research: the watched challenge may only move
    // through derivation-legal states (ACTIVE/STALE, plus honest INFORMATION_GAP records the
    // ENGINE derives). It must NEVER become CONTRADICTION, and no counter-evidence link may
    // appear without the assessment citing real evidence (the monitor itself writes nothing).
    scriptFlow7(provider); // noCredibleContradictionFound: true, evidence-less
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const ws = app.getWorkspace();
    await runMonitorCheck(app, ref, system, { force: true });
    for (const c of ws.listChallenges(ws.getMonitor(ref)!.thesisRef!)) {
      expect(c.status).not.toBe("CONTRADICTION");
      expect(c.counterEvidenceRefs).toEqual([]);
      expect(c.conditionObserved).toBe(false);
    }
  });

  it("§22.13: a monitoring check NEVER creates a Saved artifact (Saved is explicit user intent)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MATERIAL_CONTRADICTION", rationale: "observed", objectRefs: ["ev_000001", "ev_000002"] }],
    });
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    await runMonitorCheck(app, ref, system, { force: true });
    await app.persistAfterMonitorCheck();
    expect(app.getWorkspace().listSavedArtifacts()).toHaveLength(0);
  });

  it("§22.14/§22.15: no autonomous trading action, no buy/sell language in any persisted output", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MATERIAL_CONTRADICTION", rationale: "observed", objectRefs: ["ev_000001", "ev_000002"] }],
    });
    const app = await makeApp(provider);
    const ref = await seedMonitor(app);
    const result = await runMonitorCheck(app, ref, system, { force: true });
    await app.persistAfterMonitorCheck();
    const allText = [
      result.assessment.summary,
      result.notification?.title ?? "",
      result.notification?.summary ?? "",
      JSON.stringify(app.getWorkspace().toSnapshot()),
    ].join(" ").toLowerCase();
    expect(allText).not.toMatch(/\b(buy|sell|short|long|enter|exit|stop[- ]?loss|take[- ]?profit)\b/);
  });
});
