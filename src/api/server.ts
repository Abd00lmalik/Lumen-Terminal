/**
 * PHASE F per-request workspace scope (AsyncLocalStorage).
 *
 * Module-level so the serverless entrypoint (api/research.ts) can OPEN the scope around
 * each raw request (socket mode wraps app.routing; inject mode wraps app.inject), the
 * onRequest hook fills it with the authenticated workspace, and the adapter accessor
 * reads it — replacing the old module-level "current workspace" variable that would leak
 * user A's graph into user B's LOCAL_KNOWLEDGE call under Fluid-concurrency interleaving.
 */
export const requestWorkspaceStorage = new AsyncLocalStorage<{ workspace?: Workspace }>();

/**
 * F0 API server bootstrap; Fastify application factory + CLI entrypoint (F0 mandate §3/§20/§21).
 *
 * - Dev CORS: localhost origins only, documented development behavior (no production claims).
 * - Health: reports ONLY that the API process is up. It does NOT claim Gemini/Bitget health
 *   (nothing is probed), never claims "monitoring active", and never mentions trading.
 * - Secrets: nothing here reads or returns credentials; the Gemini provider reads env inside
 *   its own adapter and the key never crosses the API surface.
 * - The factory is injectable (fake provider/registry/store) so deterministic tests drive the
 *   REAL HTTP layer; the E2E seam test proves API → LUI → engine → capabilities → DTO.
 */

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyRequest } from "fastify";
import { registerRoutes } from "./routes.js";
import { ResearchApp } from "./research-app.js";
import { Workspace } from "../domain/workspace.js";
import type { ModelProvider } from "../model/provider.js";
import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import type { WorkspaceStore } from "../persistence/index.js";
import { MemoryStore } from "../persistence/index.js";
import { VercelBlobStore, workspaceBlobPath } from "../persistence/vercel-edge.js";
import { readIdentityConfig, verifyIdToken, bearerToken, authEnabled, type AuthenticatedUser, type IdentityConfig } from "./identity.js";
import { WorkspaceSessions } from "./workspace-sessions.js";

export interface ApiDeps {
  readonly provider: ModelProvider;
  readonly registry: CapabilityRegistry;
  /**
   * Phase F: single-workspace store for OPEN mode only (tests/local dev without Firebase
   * env). Multi-user production NEVER uses this — it derives one VercelBlobStore per
   * verified workspace id (see the auth wiring in buildApi).
   */
  readonly store?: WorkspaceStore;
  /**
   * Set once buildApi has the live Workspace: local-knowledge adapters resolve the session
   * workspace lazily (the registry exists before any session does).
   */
  readonly bindWorkspaceAccessor?: (accessor: () => Workspace | undefined) => void;
  /**
   * Phase F test seam: override identity resolution (default: verify the Firebase ID token).
   * Open mode is modeled as `undefined`, mirroring an unauthenticated request.
   */
  readonly resolveUser?: (header: string | undefined) => Promise<AuthenticatedUser | undefined>;
  /** Phase F test seam: force auth on even without Firebase env (exercises the gated path). */
  readonly forceAuth?: boolean;
  /** Phase F test seam: identity config override (default: env). */
  readonly identityConfig?: IdentityConfig;
  /** Phase F test seam: per-workspace store factory (default: VercelBlobStore per uid). */
  readonly createWorkspaceStore?: (workspaceId: string) => WorkspaceStore;
}

/**
 * Build the Fastify app over the given engine wiring. Does not listen; tests use
 * `inject()`; `startApi` listens when run as a process.
 */
export async function buildApi(deps: ApiDeps): Promise<{ app: FastifyInstance; researchApp: ResearchApp }> {
  const app = Fastify({ logger: false });

  const workspaceHolder: { current?: Workspace } = {};
  //
  // PHASE F REQUEST CONTEXT: the adapter accessor must NEVER serve a global "current user"
  // under multi-user traffic (Fluid Compute can interleave two requests on one warm VM;
  // a module-level current-workspace variable would leak user A's graph into user B's
  // LOCAL_KNOWLEDGE capability call). AsyncLocalStorage binds the workspace to the async
  // execution chain of ONE request: the entrypoint (api/research.ts) opens a per-request
  // scope around app.routing/inject, the appForRequest resolver fills it, and the accessor
  // reads it — falling back to the open-mode holder only when no request scope exists
  // (direct app.inject() calls in tests).
  //
  // The accessor is bound BEFORE the app builds routes; adapters resolve per request.
  deps.bindWorkspaceAccessor?.(() => requestWorkspaceStorage.getStore()?.workspace ?? workspaceHolder.current);

  // Typed transport errors for framework-generated failures (body parsing, media type,
  // payload limits). Without this, Fastify's native body ({statusCode, error, message})
  // reaches clients and the frontend cannot classify it — it used to render such 400s as
  // "INTERNAL_ERROR · Request failed (HTTP 400)", collapsing a client error into an
  // internal one. Classification follows HTTP semantics (never code enumeration):
  // framework errors carrying a 4xx status are client request problems (400
  // INVALID_REQUEST); 5xx or status-less framework faults are contained as 500. No
  // internals are exposed.
  app.setErrorHandler((error, _req, reply) => {
    const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
    const status = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 0;
    if (code.startsWith("FST_ERR_")) {
      if (status >= 500 || status === 0) {
        void reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The research API failed to handle this request. No research content was fabricated; try again shortly." } });
        return;
      }
      const parseProblem = code.startsWith("FST_ERR_CTP_") || code === "FST_ERR_BAD_REQUEST";
      void reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: parseProblem
            ? 'The request body could not be parsed. Send application/json with a "message" string.'
            : "Invalid request.",
        },
      });
      return;
    }
    if (status >= 400 && status < 500) {
      // Phase F: our identity layer's 401s (a statusCode we author in the auth hook — never
      // exception text from third parties) pass through typed; every other 4xx stays the
      // sanitized INVALID_REQUEST envelope.
      if (status === 401) {
        void reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Sign in required. Your session is missing or expired." } });
        return;
      }
      void reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid request." } });
      return;
    }
    void reply.send(error);
  });

  // Typed 404s (unknown routes) instead of Fastify's native shape — same taxonomy rule.
  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });

  // Dev CORS: localhost development origins only (F0 mandate §20). This is explicitly a
  // development convenience; no broad production assumptions are made here.
  await app.register(cors, {
    origin: ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });

  // ------------------------------------------------------------------
  // Phase F: authentication + workspace-per-user wiring.
  //
  // Identity comes ONLY from a verified Firebase ID token (Authorization: Bearer), checked
  // against Google's public keys per request. When auth is ENABLED (Firebase configured, or
  // forceAuth in tests) a missing/invalid token is a typed 401 and NO shared-workspace
  // fallback exists — unauthenticated requests cannot touch private APIs. When Firebase is
  // NOT configured (tests, local dev), the API runs in explicit OPEN mode: one workspace,
  // exactly the pre-Phase-F behavior, so the whole existing suite/dev flow is unchanged and
  // production is always gated.
  //
  // Workspace ownership: one VercelBlobStore per verified uid at
  // workspaces/{uid}/snapshot.json (path constructed ONLY here, from the VERIFIED uid —
  // never from client input). One ResearchApp per workspace per warm instance, serialized
  // by the invocation; concurrent instances follow the Phase E merge/conditional-write law
  // per object. The legacy single-workspace blob is write-protected quarantine (user-approved
  // migration policy): it is never written by user-facing code.
  // ------------------------------------------------------------------
  const identityConfig = deps.identityConfig ?? readIdentityConfig();
  const authOn = deps.forceAuth === true || authEnabled(identityConfig);

  const resolveUser: (header: string | undefined) => Promise<AuthenticatedUser | undefined> =
    deps.resolveUser ??
    (async (header) => {
      if (!authOn) return undefined;
      // authOn with no config is impossible by construction (forceAuth in tests provides
      // resolveUser or a config); this guard keeps the type honest without a fallback.
      if (identityConfig === undefined) throw new Error("auth enabled without identity config");
      return await verifyIdToken(bearerToken(header), identityConfig);
    });

  const legacyStore = deps.store ?? new MemoryStore();
  // OPEN mode: the single workspace behaves exactly as before Phase F.
  const openApp = await ResearchApp.create({
    provider: deps.provider,
    registry: deps.registry,
    store: legacyStore,
    workspace: new Workspace(), // initial workspace when the store is empty
  });
  workspaceHolder.current = openApp.getWorkspace();

  // AUTH mode: per-workspace stores/apps. A bounded map avoids duplicating full snapshots
  // in memory per warm instance beyond a fixed ceiling; each store re-reads origin storage
  // per save (the Phase E law), so eviction is correctness-safe.
  const blobAvailable = process.env.BLOB_READ_WRITE_TOKEN !== undefined && process.env.BLOB_READ_WRITE_TOKEN !== "";
  const sessions = new WorkspaceSessions(async (workspaceId) => {
    const store = deps.createWorkspaceStore !== undefined
      ? deps.createWorkspaceStore(workspaceId) // test seam: per-workspace store injection
      : (() => {
          if (!blobAvailable) {
            // Auth without durable per-user storage would silently isolate users into RAM
            // graphs that vanish on cold start. Fail honestly instead of silently making
            // every user's history ephemeral (the runbook documents Blob setup).
            throw new Error("Per-user persistence requires Vercel Blob (BLOB_READ_WRITE_TOKEN); refusing to run authenticated sessions on ephemeral memory");
          }
          return new VercelBlobStore(undefined, { pathname: workspaceBlobPath(workspaceId) });
        })();
    const app = await ResearchApp.create({
      provider: deps.provider,
      registry: deps.registry,
      store,
      workspace: new Workspace(), // initial workspace when the user's snapshot is absent
    });
    // Adapters resolve the session workspace lazily; bind it to THIS app while its request
    // runs (serialized per invocation; cross-instance state is durable, not adapter state).
    workspaceHolder.current = app.getWorkspace();
    return app;
  });

  // AUTH HOOK: resolve the verified user ONCE per request. In OPEN mode this is a no-op
  // (undefined user allowed). In AUTH mode an invalid/missing token throws a typed 401
  // BEFORE any route logic; workspace context is set per request by routes (see routes.ts).
  app.addHook("onRequest", async (req) => {
    if (!authOn) {
      (req as unknown as { user?: AuthenticatedUser | undefined }).user = undefined;
      return;
    }
    const user = await resolveUser(req.headers.authorization);
    if (user === undefined) {
      const err = new Error("Sign in required. Your session is missing or expired.") as Error & { statusCode?: number; code?: string };
      err.statusCode = 401;
      err.code = "UNAUTHORIZED";
      throw err;
    }
    (req as unknown as { user?: AuthenticatedUser }).user = user;
  });

  /** Exposed to routes: resolve the workspace-bearing app for THIS request (auth-aware). */
  const appForRequest = async (req: FastifyRequest): Promise<ResearchApp> => {
    const user = (req as unknown as { user?: AuthenticatedUser }).user;
    if (user === undefined) return openApp; // OPEN mode: single workspace, pre-Phase-F behavior
    const app = await sessions.get(user.uid);
    // Bind THIS request's workspace for the adapter accessor (ALS scope; no global user).
    const scope = requestWorkspaceStorage.getStore();
    if (scope !== undefined) scope.workspace = app.getWorkspace();
    else workspaceHolder.current = app.getWorkspace(); // inject()/tests without an ALS scope
    return app;
  };

  // ------------------------------------------------------------------
  // Health (F0 mandate §21); availability of THIS process only. No false signals:
  // it does not claim Gemini/Bitget reachability, monitoring activity, or trading.
  // ------------------------------------------------------------------
  app.get("/api/health", async () => ({
    status: "ok",
    api: "f0",
    timestamp: new Date().toISOString(),
    // Credential PRESENCE booleans only (never values, never lengths). This makes the
    // classic serverless failure "deployment was built without its env vars" diagnosable
    // from production without exposing anything secret.
    credentials: {
      geminiKeyDefined: process.env.GEMINI_API_KEY !== undefined,
      geminiKeyNonEmpty: process.env.GEMINI_API_KEY !== undefined && process.env.GEMINI_API_KEY !== "",
      groqKeyDefined: process.env.GROQ_API_KEY !== undefined,
      groqKeyNonEmpty: process.env.GROQ_API_KEY !== undefined && process.env.GROQ_API_KEY !== "",
      heuristKeyDefined: process.env.HEURIST_API_KEY !== undefined,
      heuristKeyNonEmpty: process.env.HEURIST_API_KEY !== undefined && process.env.HEURIST_API_KEY !== "",
    },
    // Phase F: identity configuration PRESENCE only (never values). Makes "the deployment
    // was built without its auth env" diagnosable without exposing anything secret.
    identity: {
      firebaseConfigured: identityConfig !== undefined,
      authEnforced: authOn,
      openMode: !authOn,
    },
    note: "API process availability only; provider reachability is not probed; no background monitoring exists; this workbench performs research only (no trading).",
  }));

  registerRoutes(app, { appForRequest, sessions, authOn });

  // OPEN-mode compatibility: the returned `researchApp` is the single workspace's app
  // (tests/destructure it); AUTH mode never uses it — every request resolves its own app.
  return { app, researchApp: openApp };
}

/** CLI entrypoint: `node dist/api/server.js` (or tsx). Env-only configuration. */
export async function startApi(opts: {
  port?: number;
  host?: string;
  provider: ModelProvider;
  registry: CapabilityRegistry;
  store?: WorkspaceStore;
  bindWorkspaceAccessor?: (accessor: () => Workspace | undefined) => void;
}): Promise<void> {
  const { app } = await buildApi(opts);
  const port = opts.port ?? Number(process.env.API_PORT ?? 3001);
  const host = opts.host ?? process.env.API_HOST ?? "127.0.0.1";
  await app.listen({ port, host });
}
