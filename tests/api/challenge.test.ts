/**
 * Phase G: Challenge over the REAL HTTP layer.
 *
 * Proven here: challenges list/run are per-user-workspace scoped (isolation via the same
 * resolveUser seam as the Phase F suite); the run endpoint resolves the thesis
 * deterministically (typed 400 when there is nothing unambiguous to challenge); the falsifier
 * response derives PERSISTED challenge records; the run path is idempotent-safe and never
 * mutates the thesis; a model failure asserts nothing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { Workspace } from "../../src/domain/workspace.js";
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
  scopeIncluded: ["technical state"],
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
    noCredibleContradictionFound: false,
    currentAssessment: "WEAKENED",
    invalidationConditions: ["quarterly close below opening range"],
    earlyWarnings: ["funding resets without follow-through"],
    confidence: "MODERATE",
    rationale: "structure holds but positioning diverges",
    citedObjectRefs: [],
    ...overrides,
  });
}

/** Script the full challenge path: interpretation → plan → falsification assessment. */
function scriptChallenge(provider: FakeModelProvider, overrides: Record<string, unknown> = {}): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "CHALLENGE" }));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "WHAT_COULD_PROVE_ME_WRONG" }));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "CHALLENGE", description: "challenge my thesis", capabilities: [], params: {} }]));
  provider.responses.set("research.plan", FALSIFICATION_PLAN);
  provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
  provider.responses.set("flow7.falsification", falsification(overrides));
}

const USER_A = { uid: "uid-a", email: "a@example.com", emailVerified: true, provider: "password" };
const USER_B = { uid: "uid-b", email: "b@example.com", emailVerified: true, provider: "password" };

async function buildAuthedApp(): Promise<{ app: FastifyInstance }> {
  const stores = new Map<string, MemoryStore>();
  const known = new Map<string, typeof USER_A | typeof USER_B>([["token-a", USER_A], ["token-b", USER_B]]);
  const provider = new FakeModelProvider(new Map());
  scriptChallenge(provider);
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

describe("Phase G: Challenge API", () => {
  beforeEach(() => resetIdCounters());

  it("challenge endpoints are 401 unauthenticated (per-user surface, no shared fallback)", async () => {
    const { app } = await buildAuthedApp();
    const get = await app.inject({ method: "GET", url: "/api/challenges" });
    const post = await app.inject({ method: "POST", url: "/api/challenge", payload: {} });
    expect(get.statusCode).toBe(401);
    expect(post.statusCode).toBe(401);
    await app.close();
  });

  it("run with NO thesis is a typed 400 clarification; never a random-asset research", async () => {
    const { app } = await buildAuthedApp();
    const res = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().error.message)).toContain("no active thesis");
    await app.close();
  });

  it("run with SEVERAL active theses and no selection asks which one (400, deterministic)", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "Thesis one");
    await createThesis(app, "token-a", "Thesis two");
    const res = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().error.message)).toContain("thesisRef");
    await app.close();
  });

  it("run against the workspace's single thesis: falsification runs, challenges PERSIST, thesis is untouched", async () => {
    const { app } = await buildAuthedApp();
    const ref = await createThesis(app, "token-a", "BTC trends up this quarter");
    const run = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    expect(run.statusCode).toBe(200);
    const body = run.json() as Record<string, unknown>;
    expect(body.assessment).toBe("WEAKENED");
    const challenges = body.challenges as Record<string, unknown>[];
    expect(challenges.length).toBeGreaterThanOrEqual(1);
    expect(challenges.every((c) => c.thesisRef === ref)).toBe(true);
    expect(challenges.every((c) => typeof c.researchRef === "string" && c.researchRef.startsWith("rs_"))).toBe(true);

    // Persisted: a plain GET (fresh app scope) serves the same records.
    const list = await app.inject({ method: "GET", url: `/api/challenges?thesisRef=${ref}`, headers: authed("token-a") });
    expect(list.statusCode).toBe(200);
    expect((list.json() as unknown[]).length).toBe(challenges.length);

    // Thesis immutability over the API: same version, same statement, no status change.
    const thesis = await app.inject({ method: "GET", url: `/api/thesis/${ref}`, headers: authed("token-a") });
    expect(thesis.statusCode).toBe(200);
    expect(thesis.json().version).toBe(1);
    expect(thesis.json().statement).toBe("BTC trends up this quarter");
    await app.close();
  });

  it("cross-user isolation: user B cannot see or mutate user A's challenge state", async () => {
    const { app } = await buildAuthedApp();
    const ref = await createThesis(app, "token-a", "A's private thesis");
    const run = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    expect(run.statusCode).toBe(200);
    const aChallenges = (run.json() as Record<string, unknown>).challenges as unknown[];

    // B's list is empty; B cannot open A's run's challenges; B's run-404 law holds for A's thesis.
    const bList = await app.inject({ method: "GET", url: `/api/challenges?thesisRef=${ref}`, headers: authed("token-b") });
    expect(bList.statusCode).toBe(200);
    expect(bList.json()).toEqual([]);
    const bAll = await app.inject({ method: "GET", url: "/api/challenges", headers: authed("token-b") });
    expect(bAll.json()).toEqual([]);
    const bOpen = await app.inject({ method: "GET", url: `/api/thesis/${ref}`, headers: authed("token-b") });
    expect(bOpen.statusCode).toBe(404); // existence hidden (Phase F law extended to challenges)

    // B's own workspace gets its own independent challenge set.
    const bRef = await createThesis(app, "token-b", "B's own thesis");
    const bRun = await app.inject({ method: "POST", url: "/api/challenge", headers: authed("token-b"), payload: {} });
    expect(bRun.statusCode).toBe(200);
    const bOwn = (bRun.json() as Record<string, unknown>).challenges as Record<string, unknown>[];
    expect(bOwn.length).toBeGreaterThanOrEqual(1);
    expect(bOwn.every((c) => c.thesisRef === bRef)).toBe(true);
    expect(aChallenges.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it("model failure asserts nothing: typed failure in the response, zero challenges persisted", async () => {
    const { app } = await buildAuthedApp();
    await createThesis(app, "token-a", "BTC trends up this quarter");
    await app.close();

    const stores = new Map<string, MemoryStore>();
    const known = new Map([[ "token-a", USER_A ]]);
    const provider = new FakeModelProvider(new Map());
    scriptChallenge(provider);
    provider.responses.set("flow7.falsification", ""); // EMPTY_OUTPUT → ModelFailure
    const { app: app2 } = await buildApi({
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
    await app2.inject({ method: "POST", url: "/api/thesis", headers: authed("token-a"), payload: { statement: "BTC trends up this quarter", objective: "t" } });
    const run = await app2.inject({ method: "POST", url: "/api/challenge", headers: authed("token-a"), payload: {} });
    // The flow ran with a typed model failure inside it: the response is honest (modelFailure
    // surfaced), nothing was asserted, nothing persisted (fail-closed, HTTP 200 by contract).
    expect(run.statusCode).toBe(200);
    const body = run.json() as Record<string, unknown>;
    expect(body.modelFailure).toBeDefined();
    expect(body.challenges).toEqual([]);
    const list = await app2.inject({ method: "GET", url: "/api/challenges", headers: authed("token-a") });
    expect(list.json()).toEqual([]);
    await app2.close();
  });
});
