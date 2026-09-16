/**
 * F0 API server bootstrap — Fastify application factory + CLI entrypoint (F0 mandate §3/§20/§21).
 *
 * - Dev CORS: localhost origins only, documented development behavior (no production claims).
 * - Health: reports ONLY that the API process is up. It does NOT claim Gemini/Bitget health
 *   (nothing is probed), never claims "monitoring active", and never mentions trading.
 * - Secrets: nothing here reads or returns credentials; the Gemini provider reads env inside
 *   its own adapter and the key never crosses the API surface.
 * - The factory is injectable (fake provider/registry/store) so deterministic tests drive the
 *   REAL HTTP layer — the E2E seam test proves API → LUI → engine → capabilities → DTO.
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
}

/**
 * Build the Fastify app over the given engine wiring. Does not listen — tests use
 * `inject()`; `startApi` listens when run as a process.
 */
export async function buildApi(deps: ApiDeps): Promise<{ app: FastifyInstance; researchApp: ResearchApp }> {
  const app = Fastify({ logger: false });

  // Dev CORS: localhost development origins only (F0 mandate §20). This is explicitly a
  // development convenience — no broad production assumptions are made here.
  await app.register(cors, {
    origin: ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"],
    methods: ["GET", "POST"],
  });

  // No global auth: single local trader identity for the hackathon MVP
  // (FRONTEND_ARCHITECTURE.md §16/§18 — auth is a future migration step).

  const store = deps.store ?? new MemoryStore();
  const researchApp = await ResearchApp.create({
    provider: deps.provider,
    registry: deps.registry,
    store,
    workspace: new Workspace(), // initial workspace when the store is empty
  });

  // ------------------------------------------------------------------
  // Health (F0 mandate §21) — availability of THIS process only. No false signals:
  // it does not claim Gemini/Bitget reachability, monitoring activity, or trading.
  // ------------------------------------------------------------------
  app.get("/api/health", async () => ({
    status: "ok",
    api: "f0",
    timestamp: new Date().toISOString(),
    note: "API process availability only — provider reachability is not probed; no background monitoring exists; this workbench performs research only (no trading).",
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
}): Promise<void> {
  const { app } = await buildApi(opts);
  const port = opts.port ?? Number(process.env.API_PORT ?? 3001);
  const host = opts.host ?? process.env.API_HOST ?? "127.0.0.1";
  await app.listen({ port, host });
}
