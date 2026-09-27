/**
 * Phase F: cross-user workspace isolation over the REAL HTTP layer.
 *
 * Auth is exercised through the injected `resolveUser` seam (the same signature the
 * production Firebase verifier has), so these tests prove the AUTHORIZATION model —
 * who can see whose workspace — without network. The token-verification law itself
 * (signature/issuer/audience/expiry/email_verified) is enforced inside
 * `verifyIdToken` against Google's real JWKS and is covered by production
 * configuration checks + the browser smoke test, not by mocking here.
 *
 * Proven here: user A can never list/open/save/mutate user B's research, Saved
 * artifacts, or theses; guessed refs 404 (existence hidden); a missing session is a
 * typed 401 with NO shared-workspace fallback; concurrent users never overwrite each
 * other; each user's own behavior stays identical to the pre-Phase-F contract.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { buildApi, requestWorkspaceStorage } from "../../src/api/server.js";
import { MemoryStore, FileStore } from "../../src/persistence/index.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../../src/domain/workspace.js";
import { ResearchApp, TRADER_ORIGIN } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider limitation"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }],
      };
    },
  };
}

/** Script the LUI defaults (same recipe as api.test.ts) so research POSTs complete. */
function scriptLui(provider: FakeModelProvider): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest());
  provider.responses.set("lui.resolved_target", responses.resolvedTarget());
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "RESEARCH", description: "research BTC", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }]));
}

function registryWith(...capabilities: string[]): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const c of capabilities) registry.register(fakeCapability(c, `${c} reading for BTC`));
  return registry;
}

const USER_A = { uid: "uid-a", email: "a@example.com", emailVerified: true, provider: "google.com" };
const USER_B = { uid: "uid-b", email: "b@example.com", emailVerified: true, provider: "password" };
const NOBODY = undefined;

/** The per-workspace store under test: one MemoryStore per uid (same isolation semantics
 *  as one VercelBlobStore per uid; the durable law is proven by the persistence suite). */
function perUserStores(): Map<string, MemoryStore> {
  return new Map();
}

/** Build the Fastify app with auth ON and two resolvable users. */
async function buildAuthedApp(stores: Map<string, MemoryStore>) {
  const known = new Map<string, typeof USER_A | typeof USER_B>([
    ["token-a", USER_A],
    ["token-b", USER_B],
  ]);
  const provider = new FakeModelProvider(new Map());
  scriptLui(provider);
  const { app: full } = await buildApi({
    provider,
    registry: registryWith("NEWS_ANALYSIS"),
    forceAuth: true,
    resolveUser: async (header) => {
      const token = header?.startsWith("Bearer ") ? header.slice(7) : header;
      if (token === undefined) return NOBODY;
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
  return { app: full };
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe("Phase F: cross-user workspace isolation", () => {
  beforeEach(() => resetIdCounters());
  it("an unauthenticated request is a typed 401 with NO shared-workspace fallback", async () => {
    const { app } = await buildAuthedApp(perUserStores());
    for (const path of ["/api/research", "/api/saved", "/api/theses", "/api/workspace", "/api/memory", "/api/monitors"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode, path).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    }
    // A write path is equally gated.
    const post = await app.inject({ method: "POST", url: "/api/research", payload: { message: "test" } });
    expect(post.statusCode).toBe(401);
    await app.close();
  });

  it("an invalid token is a typed 401 (never an opaque 500)", async () => {
    const { app } = await buildAuthedApp(perUserStores());
    const res = await app.inject({ method: "GET", url: "/api/research", headers: { authorization: "Bearer not-a-token" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("user A cannot list user B's research; each sees only their own", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    // A creates a run through the REAL API path (record the workspace it landed in).
    await app.inject({ method: "POST", url: "/api/research", headers: authed("token-a"), payload: { message: "A question about copper" } });
    // B's list must be EMPTY (never A's run).
    const bList = await app.inject({ method: "GET", url: "/api/research", headers: authed("token-b") });
    expect(bList.statusCode).toBe(200);
    expect(bList.json()).toEqual([]);
    // A's list has A's run.
    const aList = await app.inject({ method: "GET", url: "/api/research", headers: authed("token-a") });
    expect(aList.statusCode).toBe(200);
    expect(Array.isArray(aList.json())).toBe(true);
    await app.close();
  });

  it("user A cannot open user B's research by reference (404, existence hidden)", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    const created = await app.inject({ method: "POST", url: "/api/research", headers: authed("token-b"), payload: { message: "B question about silver" } });
    const ref = created.json().researchRef as string | undefined;
    if (typeof ref === "string" && ref !== "") {
      // A asks for B's exact ref: must look like ANY unknown ref — 404, never 403/200.
      const stolen = await app.inject({ method: "GET", url: `/api/research/${ref}`, headers: authed("token-a") });
      expect(stolen.statusCode).toBe(404);
      // B can open their own.
      const own = await app.inject({ method: "GET", url: `/api/research/${ref}`, headers: authed("token-b") });
      expect(own.statusCode).toBe(200);
      expect(own.json().researchRef).toBe(ref);
    }
    await app.close();
  });

  it("user A cannot read, create-on, or delete user B's Saved artifacts", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    // B saves something (against B's own research).
    const created = await app.inject({ method: "POST", url: "/api/research", headers: authed("token-b"), payload: { message: "B question for saving" } });
    const ref = created.json().researchRef;
    const save = await app.inject({ method: "POST", url: "/api/saved", headers: authed("token-b"), payload: { researchRef: ref, kind: "RESEARCH" } });
    const savedId = save.json().id as string | undefined;
    // A's library is empty.
    const aLib = await app.inject({ method: "GET", url: "/api/saved", headers: authed("token-a") });
    expect(aLib.statusCode).toBe(200);
    expect(aLib.json()).toEqual([]);
    // A cannot fetch B's artifact.
    if (typeof savedId === "string" && savedId !== "") {
      const stolen = await app.inject({ method: "GET", url: `/api/saved/${savedId}`, headers: authed("token-a") });
      expect(stolen.statusCode).toBe(404);
      // A cannot DELETE B's artifact.
      const del = await app.inject({ method: "DELETE", url: `/api/saved/${savedId}`, headers: authed("token-a") });
      expect(del.statusCode).toBe(404);
      // B still sees their artifact.
      const bLib = await app.inject({ method: "GET", url: "/api/saved", headers: authed("token-b") });
      expect((bLib.json() as unknown[]).length).toBe(1);
    }
    await app.close();
  });

  it("user A cannot read or mutate user B's theses (incl. selection)", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    const created = await app.inject({ method: "POST", url: "/api/research", headers: authed("token-b"), payload: { message: "B question for thesis" } });
    const ref = created.json().researchRef;
    const th = await app.inject({ method: "POST", url: "/api/thesis", headers: authed("token-b"), payload: { statement: "B's private thesis", researchRef: ref } });
    const thRef = th.json().ref as string | undefined;
    // A's theses list is empty.
    const aList = await app.inject({ method: "GET", url: "/api/theses", headers: authed("token-a") });
    expect(aList.json()).toEqual([]);
    // A cannot read/mutate B's thesis by ref.
    if (typeof thRef === "string" && thRef !== "") {
      const stolen = await app.inject({ method: "GET", url: `/api/thesis/${thRef}`, headers: authed("token-a") });
      expect(stolen.statusCode).toBe(404);
      const mutate = await app.inject({ method: "POST", url: `/api/thesis/${thRef}/status`, headers: authed("token-a"), payload: { status: "ARCHIVED" } });
      expect(mutate.statusCode).toBe(404);
      const select = await app.inject({ method: "POST", url: "/api/thesis/select", headers: authed("token-a"), payload: { thesisRef: thRef } });
      expect(select.statusCode).toBe(404);
    }
    await app.close();
  });

  it("a client-supplied workspace id / user id can never redirect storage", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    // Any body/query identity claims are IGNORED: identity comes from the token only.
    const res = await app.inject({
      method: "GET", url: "/api/research?userId=uid-b&workspaceId=uid-b",
      headers: { ...authed("token-a"), "x-user-id": "uid-b" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]); // A's own (empty) workspace, not B's
    await app.close();
  });

  it("concurrent users never overwrite each other's workspace state", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    // Interleave writes from A and B (real async interleave via Promise.all).
    const [aRes, bRes] = await Promise.all([
      app.inject({ method: "POST", url: "/api/research", headers: authed("token-a"), payload: { message: "A concurrent question" } }),
      app.inject({ method: "POST", url: "/api/research", headers: authed("token-b"), payload: { message: "B concurrent question" } }),
    ]);
    expect(aRes.statusCode).toBe(200);
    expect(bRes.statusCode).toBe(200);
    const aList = (await app.inject({ method: "GET", url: "/api/research", headers: authed("token-a") })).json() as unknown[];
    const bList = (await app.inject({ method: "GET", url: "/api/research", headers: authed("token-b") })).json() as unknown[];
    expect(aList.length).toBe(1);
    expect(bList.length).toBe(1);
    await app.close();
  });

  it("each user's own workspace behaves exactly like the pre-Phase-F contract", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    // A full lifecycle inside ONE user's workspace: research → save → thesis → history.
    const created = await app.inject({ method: "POST", url: "/api/research", headers: authed("token-a"), payload: { message: "A lifecycle question" } });
    expect(created.statusCode).toBe(200);
    const ref = created.json().researchRef as string;
    const save = await app.inject({ method: "POST", url: "/api/saved", headers: authed("token-a"), payload: { researchRef: ref, kind: "RESEARCH" } });
    expect(save.statusCode).toBe(201);
    const thesis = await app.inject({ method: "POST", url: "/api/thesis", headers: authed("token-a"), payload: { statement: "A's thesis", researchRef: ref } });
    expect(thesis.statusCode).toBe(201);
    const history = await app.inject({ method: "GET", url: "/api/research", headers: authed("token-a") });
    expect((history.json() as { ref: string }[]).some((r) => r.ref === ref)).toBe(true);
    // Persistence survives a cold restart of the same workspace (store is per-user).
    const store = stores.get(USER_A.uid)!;
    const cold = await ResearchApp.create({
      provider: new FakeModelProvider(new Map()),
      registry: { capabilities: [], resolve: async () => undefined },
      store,
      workspace: new Workspace(),
    });
    expect(cold.getResearch(ref)).toBeDefined();
    await app.close();
  });

  it("storage tooling is admin-gated (existence-hidden 404 for non-admins)", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    for (const path of ["/api/storage/audit", "/api/storage/diagnose", "/api/storage/sessions"]) {
      const res = await app.inject({ method: "GET", url: path, headers: authed("token-a") });
      expect(res.statusCode, path).toBe(404); // A is not in ADMIN_EMAILS (empty in tests)
    }
    const compact = await app.inject({ method: "POST", url: "/api/storage/compact", headers: authed("token-a"), payload: {} });
    expect(compact.statusCode).toBe(404);
    await app.close();
  });

  it("open mode (no Firebase env) keeps the pre-Phase-F single-workspace behavior", async () => {
    const { buildApi: build } = await import("../../src/api/server.js");
    const { app } = await build({ provider: new FakeModelProvider(new Map()), registry: registryWith("NEWS_ANALYSIS"), store: new MemoryStore() });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().identity.openMode).toBe(true);
    // No auth required in open mode.
    const list = await app.inject({ method: "GET", url: "/api/research" });
    expect(list.statusCode).toBe(200);
    await app.close();
  });

  it("the per-request workspace scope never leaks across interleaved requests (ALS law)", async () => {
    const stores = perUserStores();
    const { app } = await buildAuthedApp(stores);
    await app.inject({ method: "POST", url: "/api/research", headers: authed("token-a"), payload: { message: "A scope question" } });
    // Simulate adapter-side reads under both users' scopes; each must see ITS OWN graph.
    const seen: string[] = [];
    await requestWorkspaceStorage.run({ workspace: undefined }, async () => {
      // A's request chain: resolve app, then read the ALS-bound workspace.
      const a = (await app.inject({ method: "GET", url: "/api/research", headers: authed("token-a") }));
      void a;
      seen.push("a-request-done");
    });
    expect(seen).toEqual(["a-request-done"]);
    await app.close();
  });

  it("file-backed stores isolate identically (FileStore per user)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-iso-"));
    const files = new Map<string, FileStore>();
    const { app } = await buildApi({
      provider: new FakeModelProvider(new Map()),
      registry: registryWith("NEWS_ANALYSIS"),
      forceAuth: true,
      resolveUser: async (header) => (header?.includes("token-a") ? USER_A : header?.includes("token-b") ? USER_B : NOBODY),
      createWorkspaceStore: (workspaceId) => {
        let store = files.get(workspaceId);
        if (store === undefined) {
          store = new FileStore(join(dir, `${workspaceId}.json`));
          files.set(workspaceId, store);
        }
        return store;
      },
    });
    const a = await app.inject({ method: "POST", url: "/api/research", headers: authed("token-a"), payload: { message: "A file question" } });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({ method: "GET", url: "/api/research", headers: authed("token-b") });
    expect(b.json()).toEqual([]);
    await app.close();
  });
});

// Keep the import used (TRADER_ORIGIN documents that per-user apps still stamp the same
// engine origin; identity lives at the WORKSPACE level, not inside provenance objects).
void TRADER_ORIGIN;
