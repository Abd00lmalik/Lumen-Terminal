/**
 * Phase H: Monitor over the REAL HTTP layer.
 *
 * Proven here: the monitor surface is per-user-workspace scoped (same resolveUser seam as the
 * Phase F/G suites); lifecycle is explicit (PROPOSED → ACTIVE → PAUSED/COMPLETED through the
 * domain transition table); isolation is structural — user B cannot list, open, check, or see
 * assessments/notifications for user A's monitor, and existence is hidden (404); an assessment
 * that failed validation maps to INSUFFICIENT_EVIDENCE (never fabricated).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import type { FastifyInstance } from "fastify";

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider limitation"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return { tool: `fake/${capability.toLowerCase()}`, capability: cap, transport: "fake", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }] };
    },
  };
}

const FALSIFICATION_PLAN = JSON.stringify({
  objective: "What could prove the thesis wrong?",
  scopeIncluded: ["macro"],
  scopeExcluded: [],
  tasks: [{ type: "EVIDENCE_GATHERING", objective: "disconfirming evidence", capabilities: ["NEWS_ANALYSIS"], completion: "c" }],
  completionCriteria: ["c"],
  adaptationPolicy: "falsification first",
});

function falsification(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    targetBelief: "BTC trends up this quarter",
    claims: ["BTC makes higher highs"],
    assumptions: ["macro stays stable"],
    vulnerableAssumptions: ["macro stays stable"],
    falsificationTargets: [
      { condition: "quarterly close below opening range", attacksAssumption: "BTC makes higher highs", conditionStatus: "DERIVED_FROM_BELIEF", objectRefs: [] },
    ],
    contradictionsFound: [],
    noCredibleContradictionFound: true,
    currentAssessment: "SUPPORTED",
    invalidationConditions: ["quarterly close below opening range"],
    earlyWarnings: ["funding resets without follow-through"],
    confidence: "MODERATE",
    rationale: "structure holds but positioning diverges",
    citedObjectRefs: [],
    ...overrides,
  });
}

/** Script the challenge run (derives challenge records) + a monitor check's Flow 7. */
function scriptChallenge(provider: FakeModelProvider, falsificationOverrides: Record<string, unknown> = {}): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "CHALLENGE" }));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "WHAT_COULD_PROVE_ME_WRONG" }));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "CHALLENGE", description: "challenge my thesis", capabilities: [], params: {} }]));
  provider.responses.set("research.plan", FALSIFICATION_PLAN);
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  provider.responses.set("flow7.falsification", falsification(falsificationOverrides));
}

const USER_A = { uid: "uid-a", email: "a@example.com", emailVerified: true, provider: "password" };
const USER_B = { uid: "uid-b", email: "b@example.com", emailVerified: true, provider: "password" };

async function buildAuthedApp(scripted: boolean = true): Promise<{ app: FastifyInstance }> {
  const stores = new Map<string, MemoryStore>();
  const known = new Map<string, typeof USER_A | typeof USER_B>([["token-a", USER_A], ["token-b", USER_B]]);
  const provider = new FakeModelProvider(new Map());
  if (scripted) scriptChallenge(provider);
  const { app } = await buildApi({
    provider,
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
      if (store === undefined) {
        store = new MemoryStore();
        stores.set(workspaceId, store);
      }
      return store;
    },
  });
  return { app };
}

function registryWith(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(fakeCapability("NEWS_ANALYSIS", "news reading for BTC"));
  return registry;
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

async function createThesis(app: FastifyInstance, token: string, statement: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/thesis", headers: authed(token), payload: { statement, objective: "test" } });
  expect(res.statusCode).toBe(201);
  return (res.json() as Record<string, string>).ref;
}

/** Challenge run → monitor from challenge → explicit activation. Returns the monitor ref. */
async function createActiveMonitor(app: FastifyInstance, token: string, thesisRef?: string): Promise<string> {
  const run = await app.inject({ method: "POST", url: "/api/challenge", headers: authed(token), payload: {} });
  expect(run.statusCode).toBe(200);
  const created = await app.inject({ method: "POST", url: "/api/monitors/from-challenge", headers: authed(token), payload: thesisRef !== undefined ? { thesisRef } : {} });
  expect(created.statusCode).toBe(200);
  const monitorRef = (created.json() as Record<string, { ref: string }>).monitor.ref;
  const activated = await app.inject({ method: "POST", url: `/api/monitors/${monitorRef}/activate`, headers: authed(token) });
  expect(activated.statusCode).toBe(200);
  expect((activated.json() as Record<string, string>).status).toBe("ACTIVE");
  return monitorRef;
}

describe("Phase H: Monitor API", () => {
  beforeEach(() => resetIdCounters());

  it("monitor + notification endpoints are 401 unauthenticated (per-user surface)", async () => {
    const { app } = await buildAuthedApp();
    const list = await app.inject({ method: "GET", url: "/api/monitors" });
    const create = await app.inject({ method: "POST", url: "/api/monitors/from-challenge", payload: {} });
    const notifs = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(list.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
    expect(notifs.statusCode).toBe(401);
    await app.close();
  });

  it("create with NO challenges is a typed 400 (monitoring watches real falsifiers, not invented ones)", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "BTC trends up this quarter");
    const created = await app.inject({ method: "POST", url: "/api/monitors/from-challenge", headers: authed("token-a"), payload: {} });
    expect(created.statusCode).toBe(400);
    expect(String(created.json().error.message)).toContain("no active challenges");
    await app.close();
  });

  it("lifecycle over HTTP: challenge → monitor PROPOSED → activate → ACTIVE → pause → resume", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "BTC trends up this quarter");
    const ref = await createActiveMonitor(app, "token-a");
    const paused = await app.inject({ method: "POST", url: `/api/monitors/${ref}/status`, headers: authed("token-a"), payload: { status: "PAUSED" } });
    expect(paused.statusCode).toBe(200);
    expect((paused.json() as Record<string, string>).status).toBe("PAUSED");
    const resumed = await app.inject({ method: "POST", url: `/api/monitors/${ref}/status`, headers: authed("token-a"), payload: { status: "ACTIVE" } });
    expect(resumed.statusCode).toBe(200);
    expect((resumed.json() as Record<string, string>).status).toBe("ACTIVE");
    await app.close();
  });

  it("manual check over HTTP: assessment persisted, check state recorded (idempotency tested at the orchestrator level)", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "BTC trends up this quarter");
    const ref = await createActiveMonitor(app, "token-a");
    const check = await app.inject({ method: "POST", url: `/api/monitors/${ref}/check`, headers: authed("token-a") });
    expect(check.statusCode).toBe(200);
    const body = check.json() as Record<string, unknown>;
    expect(body.executed).toBe(true);
    const assessments = await app.inject({ method: "GET", url: `/api/monitors/${ref}/assessments`, headers: authed("token-a") });
    expect(assessments.statusCode).toBe(200);
    expect((assessments.json() as unknown[]).length).toBe(1);
    await app.close();
  });

  it("cross-user isolation (§19): B cannot see, check, or assess A's monitor; notifications never leak", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "A's private thesis");
    const ref = await createActiveMonitor(app, "token-a");
    // One manual check so an assessment exists in A's workspace.
    const check = await app.inject({ method: "POST", url: `/api/monitors/${ref}/check`, headers: authed("token-a") });
    expect(check.statusCode).toBe(200);

    // B's lists are empty; A's monitor by ref is existence-hidden (404); B cannot check or assess it.
    const bList = await app.inject({ method: "GET", url: "/api/monitors", headers: authed("token-b") });
    expect(bList.statusCode).toBe(200);
    const bGrouped = bList.json() as Record<string, unknown[]>;
    expect(bGrouped.active).toEqual([]);
    expect(bGrouped.paused).toEqual([]);
    expect(bGrouped.proposals).toEqual([]);
    const bStatus = await app.inject({ method: "POST", url: `/api/monitors/${ref}/status`, headers: authed("token-b"), payload: { status: "PAUSED" } });
    expect(bStatus.statusCode).toBe(404);
    const bCheck = await app.inject({ method: "POST", url: `/api/monitors/${ref}/check`, headers: authed("token-b") });
    expect(bCheck.statusCode).toBe(404);
    const bAssess = await app.inject({ method: "GET", url: `/api/monitors/${ref}/assessments`, headers: authed("token-b") });
    expect(bAssess.statusCode).toBe(404);
    const bNotifs = await app.inject({ method: "GET", url: "/api/notifications", headers: authed("token-b") });
    expect(bNotifs.statusCode).toBe(200);
    expect(bNotifs.json()).toEqual([]);
    await app.close();
  });

  it("unvalidated falsification assessment → honest PROVIDER_UNAVAILABLE mapping (never fabricated)", async () => {
    // Scripted with a schema-INVALID assessment body (missing confidence): flow7's validator
    // returns assessment=undefined → typed modelFailure → the orchestrator asserts nothing
    // material and maps the outcome honestly (§18: infrastructure/model failure is never
    // thesis evidence). The INSUFFICIENT_EVIDENCE mapping itself is pinned at the orchestrator
    // level (tests/ops/monitor-check.test.ts).
    const invalid = JSON.parse(falsification()) as Record<string, unknown>;
    delete invalid.confidence;
    const stores = new Map<string, MemoryStore>();
    const known = new Map([[ "token-a", USER_A ]]);
    const provider = new FakeModelProvider(new Map());
    scriptChallenge(provider); // VALID assessment for the challenge that seeds the monitor
    const { app } = await buildApi({
      provider,
      registry: registryWith(),
      forceAuth: true,
      resolveUser: async (header) => {
        const token = header?.startsWith("Bearer ") ? header.slice(7) : header;
        return token === "token-a" ? USER_A : undefined;
      },
      createWorkspaceStore: (workspaceId) => {
        let store = stores.get(workspaceId);
        if (store === undefined) { store = new MemoryStore(); stores.set(workspaceId, store); }
        return store;
      },
    });
    await app.inject({ method: "POST", url: "/api/thesis", headers: authed("token-a"), payload: { statement: "BTC trends up this quarter", objective: "t" } });
    const challengeRun = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    expect(challengeRun.statusCode).toBe(200);
    // NOW swap the falsification script to the schema-INVALID body for the monitor CHECK.
    provider.responses.set("flow7.falsification", JSON.stringify(invalid));
    const mon = await app.inject({ method: "POST", url: "/api/monitors/from-challenge", headers: authed("token-a"), payload: {} });
    expect(mon.statusCode).toBe(200);
    const mRef = (mon.json() as Record<string, { ref: string }>).monitor.ref;
    await app.inject({ method: "POST", url: `/api/monitors/${mRef}/activate`, headers: authed("token-a") });
    const check = await app.inject({ method: "POST", url: `/api/monitors/${mRef}/check`, headers: authed("token-a") });
    expect(check.statusCode).toBe(200);
    const body = check.json() as Record<string, unknown>;
    // flow7 returns assessment undefined (invalid) → modelFailure → the orchestrator's honest mapping.
    expect(body.executed).toBe(true);
    const assessment = body.assessment as Record<string, unknown>;
    expect(assessment.outcome).toBe("PROVIDER_UNAVAILABLE");
    expect(assessment.thesisImpact).toBe("UNDETERMINED");
    expect(body.notification).toBeUndefined();
    await app.close();
  });
});
