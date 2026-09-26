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
import { registerRoutes } from "./routes.js";
import { ResearchApp } from "./research-app.js";
import { Workspace } from "../domain/workspace.js";
import type { ModelProvider } from "../model/provider.js";
import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import type { WorkspaceStore } from "../persistence/index.js";
import { MemoryStore } from "../persistence/index.js";

export interface ApiDeps {
  readonly provider: ModelProvider;
  readonly registry: CapabilityRegistry;
  readonly store?: WorkspaceStore;
  /**
   * Set once buildApi has the live Workspace: local-knowledge adapters resolve the session
   * workspace lazily (the registry exists before any session does).
   */
  readonly bindWorkspaceAccessor?: (accessor: () => Workspace | undefined) => void;
}

/**
 * Build the Fastify app over the given engine wiring. Does not listen; tests use
 * `inject()`; `startApi` listens when run as a process.
 */
export async function buildApi(deps: ApiDeps): Promise<{ app: FastifyInstance; researchApp: ResearchApp }> {
  const app = Fastify({ logger: false });

  const workspaceHolder: { current?: Workspace } = {};
  // The accessor is bound BEFORE the app builds routes; adapters resolve per request.
  deps.bindWorkspaceAccessor?.(() => workspaceHolder.current);

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
    methods: ["GET", "POST", "DELETE"],
  });

  // No global auth: single local trader identity for the hackathon MVP
  // (FRONTEND_ARCHITECTURE.md §16/§18; auth is a future migration step).

  const store = deps.store ?? new MemoryStore();
  const researchApp = await ResearchApp.create({
    provider: deps.provider,
    registry: deps.registry,
    store,
    workspace: new Workspace(), // initial workspace when the store is empty
  });
  workspaceHolder.current = researchApp.getWorkspace();

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
    note: "API process availability only; provider reachability is not probed; no background monitoring exists; this workbench performs research only (no trading).",
  }));

  registerRoutes(app, researchApp);

  return { app, researchApp };
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
