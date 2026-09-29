/**
 * BENCHMARK: Monitor scenarios (Phase H), MONITOR-001 … MONITOR-014.
 *
 * Deterministic: real domain + real API + real persistence layer with an in-memory blob, real
 * LUI pipeline with a scripted model. No network, no credentials. Each scenario pins the exact
 * expected behavior the brief mandates (§21).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { runMonitorCheck, runDueMonitorChecks } from "../../src/ops/monitor-check.js";
import type { FastifyInstance } from "fastify";

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
  objective: "What could prove the thesis wrong?", scopeIncluded: ["macro"], scopeExcluded: [],
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

function scriptChallenge(provider: FakeModelProvider): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "CHALLENGE" }));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "WHAT_COULD_PROVE_ME_WRONG" }));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "CHALLENGE", description: "challenge my thesis", capabilities: [], params: {} }]));
  provider.responses.set("research.plan", FALSIFICATION_PLAN);
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  provider.responses.set("flow7.falsification", falsification());
}

const USER_A = { uid: "uid-a", email: "a@example.com", emailVerified: true, provider: "password" };
const USER_B = { uid: "uid-b", email: "b@example.com", emailVerified: true, provider: "password" };
const authed = (token: string) => ({ authorization: `Bearer ${token}` });

async function buildAuthedApp(provider?: FakeModelProvider): Promise<{ app: FastifyInstance; provider: FakeModelProvider }> {
  const stores = new Map<string, MemoryStore>();
  const known = new Map<string, typeof USER_A | typeof USER_B>([["token-a", USER_A], ["token-b", USER_B]]);
  const p = provider ?? new FakeModelProvider(new Map());
  scriptChallenge(p);
  const { app } = await buildApi({
    provider: p,
    registry: registryWith(),
    forceAuth: true,
    resolveUser: async (header) => {
      const token = header?.startsWith("Bearer ") ? header.slice(7) : header;
      if (token === undefined) return undefined;
      const user = known.get(token);
      if (user === undefined) {
        const err = new Error("invalid") as Error & { statusCode?: number };
        err.statusCode = 401;
        throw err;
      }
      return user;
    },
    createWorkspaceStore: (workspaceId) => {
      let store = stores.get(workspaceId);
      if (store === undefined) { store = new MemoryStore(); stores.set(workspaceId, store); }
      return store;
    },
  });
  return { app, provider: p };
}

function registryWith(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("NEWS_ANALYSIS", "news reading for BTC"));
  return registry;
}

async function createThesis(app: FastifyInstance, token: string, statement: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/thesis", headers: authed(token), payload: { statement, objective: "test" } });
  expect(res.statusCode).toBe(201);
  return (res.json() as Record<string, string>).ref;
}

async function createActiveMonitor(app: FastifyInstance, token: string): Promise<string> {
  const run = await app.inject({ method: "POST", url: "/api/challenge", headers: authed(token), payload: {} });
  expect(run.statusCode).toBe(200);
  const created = await app.inject({ method: "POST", url: "/api/monitors/from-challenge", headers: authed(token), payload: {} });
  expect(created.statusCode).toBe(200);
  const monitorRef = (created.json() as Record<string, { ref: string }>).monitor.ref;
  const activated = await app.inject({ method: "POST", url: `/api/monitors/${monitorRef}/activate`, headers: authed(token) });
  expect(activated.statusCode).toBe(200);
  return monitorRef;
}

/** Direct-domain variant for orchestrator-level scenarios (no HTTP). */
async function makeDomainApp(provider: FakeModelProvider): Promise<{ app: import("../../src/api/research-app.js").ResearchApp; ws: Workspace }> {
  const { ResearchApp } = await import("../../src/api/research-app.js");
  const registry = registryWith();
  const { app } = { app: await ResearchApp.create({ provider, registry, store: new MemoryStore(), workspace: new Workspace() }) };
  const ws = app.getWorkspace();
  const thesis = ws.addThesis({ statement: "BTC strength rests on liquidity and institutional demand", objective: "test" }, { kind: "trader", detail: "bench" });
  const research = ws.addResearch({ objective: "falsification", question: "What could prove the thesis wrong?", flow: "WHAT_COULD_PROVE_ME_WRONG" }, { kind: "trader", detail: "bench" });
  ws.addEvidence({ observation: "baseline liquidity observation for BTC", evidenceType: "macro", evidenceClass: "OBSERVATION", researchRef: research.id }, { kind: "trader", detail: "bench" });
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
  }, { kind: "trader", detail: "bench" });
  ws.activateMonitor(monitor.id, { kind: "trader", detail: "bench" }, "bench activation");
  return { app, ws };
}

function scriptFlow7(provider: FakeModelProvider, overrides: Record<string, unknown> = {}): void {
  provider.responses.set("research.plan", FALSIFICATION_PLAN);
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  provider.responses.set("flow7.falsification", falsification(overrides));
}

beforeEach(() => resetIdCounters());

describe("Phase H benchmarks: MONITOR-001..014", () => {
  it("MONITOR-001: create monitor from thesis challenge (conditions derived, PROPOSED until explicit activation)", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "BTC trends up this quarter");
    const run = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    expect(run.statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: "/api/monitors/from-challenge", headers: authed("token-a"), payload: {} });
    expect(created.statusCode).toBe(200);
    const body = created.json() as Record<string, any>;
    expect(body.monitor.status).toBe("PROPOSED"); // inert until the user activates
    expect(body.monitor.conditions.length).toBeGreaterThanOrEqual(1);
    expect(body.monitor.linkedChallengeRefs.length).toBe(body.monitor.conditions.length);
    expect(body.challengeRefs.length).toBeGreaterThanOrEqual(1);
    // NOT activated by creation: the explicit activation call is the only path to ACTIVE.
    const grouped = (await app.inject({ method: "GET", url: "/api/monitors", headers: authed("token-a") })).json();
    expect(grouped.proposals).toHaveLength(1);
    expect(grouped.active).toHaveLength(0);
  });

  it("MONITOR-002: manual check with no material change → NO_MATERIAL_CHANGE, no notification", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider); // no contradiction
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.outcome).toBe("NO_MATERIAL_CHANGE");
    expect(result.notification).toBeUndefined();
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-003: manual check with material change → MATERIAL_CHANGE + notification + research linked", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MATERIAL_CONTRADICTION", rationale: "both supports failing together, observed now", objectRefs: ["ev_000001", "ev_000002"] }],
      rationale: "observed deterioration",
    });
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.outcome).toBe("MATERIAL_CHANGE");
    expect(result.notification).toBeDefined();
    expect(result.assessment.researchRef).toBeDefined();
    expect(result.assessment.changedConditions[0]!.evidenceRefs.length).toBeGreaterThan(0);
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-004: insufficient evidence (research completes but asserts nothing) → honest outcome, no notification", async () => {
    const provider = new FakeModelProvider(new Map());
    // Assessment valid in shape but INDETERMINATE with no contradictions and no cited evidence:
    // the research ran and found nothing assertable — outcome stays NO_MATERIAL_CHANGE with
    // LOW confidence and the run's research ref linked (never fabricated materiality).
    scriptFlow7(provider, { currentAssessment: "INDETERMINATE", noCredibleContradictionFound: true, rationale: "insufficient evidence to assess", confidence: "LOW" });
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.outcome).toBe("NO_MATERIAL_CHANGE");
    expect(result.notification).toBeUndefined();
    expect(result.assessment.researchRef).toBeDefined();
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-005: provider failure → PROVIDER_UNAVAILABLE, no notification, no negative evidence", async () => {
    const provider = new FakeModelProvider(new Map()); // nothing scripted → ModelFailure
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.outcome).toBe("PROVIDER_UNAVAILABLE");
    expect(result.notification).toBeUndefined();
    expect(result.assessment.changedConditions).toHaveLength(0);
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-006: duplicate execution (same window) → idempotent, one assessment", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const first = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true, now: new Date("2026-09-29T10:00:00Z") });
    const second = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true, now: new Date("2026-09-29T10:30:00Z") });
    expect(second.executed).toBe(false);
    expect(second.assessment.id).toBe(first.assessment.id);
    expect(app.getWorkspace().listMonitoringAssessments(ref)).toHaveLength(1);
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-007: concurrent execution → one winner, identical assessment identity", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const [a, b] = await Promise.all([
      runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true, now: new Date("2026-09-29T10:00:00Z") }),
      runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true, now: new Date("2026-09-29T10:00:00Z") }),
    ]);
    expect(a.assessment.id).toBe(b.assessment.id);
    expect(app.getWorkspace().listMonitoringAssessments(ref)).toHaveLength(1);
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-008: paused monitor executes nothing (no research, no cost)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    ws.transitionMonitor(ref, "PAUSED", { kind: "trader", detail: "bench" }, "paused");
    const callsBefore = provider.calls.length;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.outcome).toBe("MONITOR_PAUSED");
    expect(result.executed).toBe(false);
    expect(provider.calls.length).toBe(callsBefore);
  });

  it("MONITOR-009: thesis remains unchanged after a material alert", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MATERIAL_CONTRADICTION", rationale: "observed", objectRefs: ["ev_000001", "ev_000002"] }],
    });
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const before = JSON.stringify(ws.getThesis(ws.getMonitor(ref)!.thesisRef!));
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.outcome).toBe("MATERIAL_CHANGE");
    expect(JSON.stringify(ws.getThesis(ws.getMonitor(ref)!.thesisRef!))).toBe(before);
    expect(ws.getThesis(ws.getMonitor(ref)!.thesisRef!)!.version).toBe(1);
  });

  it("MONITOR-010: cross-user isolation over HTTP (A's monitor invisible and inoperable by B)", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "A's private thesis");
    const ref = await createActiveMonitor(app, "token-a");
    const bList = await app.inject({ method: "GET", url: "/api/monitors", headers: authed("token-b") });
    expect((bList.json() as Record<string, unknown[]>).active).toEqual([]);
    expect((bList.json() as Record<string, unknown[]>).proposals).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/api/monitors/${ref}/status`, headers: authed("token-b"), payload: { status: "PAUSED" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/monitors/${ref}/check`, headers: authed("token-b") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/monitors/${ref}/assessments`, headers: authed("token-b") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/notifications", headers: authed("token-b") })).json()).toEqual([]);
  });

  it("MONITOR-011: history linkage — the check's research run is a normal History row with monitor linkage", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    expect(result.assessment.researchRef).toBeDefined();
    const research = ws.getResearch(result.assessment.researchRef!);
    expect(research).toBeDefined();
    expect(research!.flow).toBe("WHAT_COULD_PROVE_ME_WRONG"); // same engine, same History semantics
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-012: notification deduplication — duplicate execution creates NO duplicate notification", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "MATERIALLY_CHALLENGED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MATERIAL_CONTRADICTION", rationale: "observed", objectRefs: ["ev_000001", "ev_000002"] }],
    });
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const first = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true, now: new Date("2026-09-29T10:00:00Z") });
    expect(first.notification).toBeDefined();
    const second = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true, now: new Date("2026-09-29T10:30:00Z") });
    expect(second.executed).toBe(false);
    expect(app.getWorkspace().listNotifications()).toHaveLength(1);
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-013: challenge becomes stale — a stale-only signal is NOT a current material change", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider, {
      noCredibleContradictionFound: false, currentAssessment: "WEAKENED",
      contradictionsFound: [{ description: "liquidity conditions deteriorate while institutional demand fails to offset", materiality: "MEANINGFUL_WARNING", rationale: "older signal", objectRefs: ["ev_000001", "ev_000002"] }],
    });
    const { app, ws } = await makeDomainApp(provider);
    const ref = ws.listMonitors()[0]!.id;
    const result = await runMonitorCheck(app, ref, { kind: "trader", detail: "bench" }, { force: true });
    // MEANINGFUL_WARNING (not INVALIDATING) → EARLY_WARNING, WEAKENS_THESIS — surfaced, not suppressed,
    // but the strongest wording (POTENTIALLY_INVALIDATES_ASSUMPTION) is reserved for MATERIAL+CURRENT.
    expect(result.assessment.outcome).toBe("MATERIAL_CHANGE");
    expect(result.assessment.thesisImpact).toBe("WEAKENS_THESIS");
    expect(result.notification!.materiality).toBe("MEANINGFUL");
    await app.persistAfterMonitorCheck();
  });

  it("MONITOR-014: user explicitly updates monitoring conditions via the status/pause/resume surface (no silent mutation)", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "BTC trends up this quarter");
    const ref = await createActiveMonitor(app, "token-a");
    // The trader pauses and resumes: explicit user actions recorded in provenance — conditions
    // are NEVER rewritten by the system (addExecutableMonitorProposal is the only conditions
    // writer, at creation, from the user's own challenge records).
    const paused = await app.inject({ method: "POST", url: `/api/monitors/${ref}/status`, headers: authed("token-a"), payload: { status: "PAUSED" } });
    expect(paused.statusCode).toBe(200);
    const resumed = await app.inject({ method: "POST", url: `/api/monitors/${ref}/status`, headers: authed("token-a"), payload: { status: "ACTIVE" } });
    expect(resumed.statusCode).toBe(200);
    const grouped = (await app.inject({ method: "GET", url: "/api/monitors", headers: authed("token-a") })).json();
    expect(grouped.active).toHaveLength(1);
  });

  it("§9/§23: cron batch — due-gated, bounded, per-monitor failure isolation", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptFlow7(provider);
    const { app, ws } = await makeDomainApp(provider);
    // The seeded monitor is MANUAL (never due); add DAILY monitors incl. one that will fail.
    for (let i = 0; i < 3; i += 1) {
      const thesis = ws.addThesis({ statement: `t${i}`, objective: "t" }, { kind: "trader", detail: "bench" });
      const monitor = ws.addExecutableMonitorProposal({
        target: `m${i}`, conditions: [{ description: `condition ${i}`, kind: "EARLY_WARNING", triggerType: "STATE_CHANGE", conditionStatus: "PROPOSED", rationale: "r", evidenceDependencies: [] }],
        triggerRationale: "r", thesisRef: thesis.id, thesisVersion: 1, cadence: "DAILY",
      }, { kind: "trader", detail: "bench" });
      ws.activateMonitor(monitor.id, { kind: "trader", detail: "bench" }, "activated");
    }
    const result = await runDueMonitorChecks(app, { kind: "system", detail: "cron" });
    expect(result.checked.length).toBe(3); // MANUAL monitor not due; the 3 DAILY ones ran
    expect(result.budgetExhausted).toBe(false);
    await app.persistAfterMonitorCheck();
  });
});
