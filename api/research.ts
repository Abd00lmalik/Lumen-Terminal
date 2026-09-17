/**
 * Vercel Functions adapter — the production API boundary (DEPLOYMENT.md "Vercel architecture").
 *
 * This file contains NO research logic. It hosts the SAME Fastify application used by
 * `npm run api` (buildApi → registerRoutes → ResearchApp → LUI → engine → capability
 * registry) inside the Vercel Node.js runtime, by delegating raw requests to
 * `app.routing()`. SSE research streaming flows through reply.raw writes, which the
 * Node.js runtime streams natively.
 *
 * Persistence honesty (mandate §2): serverless instances have ephemeral local disks, so
 * unless WORKSPACE_FILE is explicitly provided (e.g. a /tmp path), the production API uses
 * an in-memory store. Workspace state is then per-function-instance — it survives across
 * requests on a warm instance and is lost on cold starts. This is documented in
 * DEPLOYMENT.md; it never claims durable persistence it does not have.
 *
 * Secrets: GEMINI_API_KEY / GEMINI_MODEL are read only inside the Gemini provider from
 * Vercel's encrypted server-side env. Nothing here exposes them; they never cross the API
 * surface into responses.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildApi } from "../src/api/server.js";
import { GeminiProvider } from "../src/model/gemini.js";
import { createBitgetAdapterSet } from "../src/adapters/bitget-skills.js";
import { createStore } from "../src/persistence/index.js";

type AppPromise = ReturnType<typeof buildApi>;
let appPromise: AppPromise | undefined;

/**
 * Persistence selection (DEPLOYMENT.md "Persistence honesty"):
 * - WORKSPACE_FILE set → FileStore at that path (opt-in durable location, e.g. a mounted path).
 * - otherwise → MemoryStore. Serverless local disks are ephemeral: state lives per warm
 *   function instance and is lost on cold start. We surface that honestly instead of
 *   writing to a disk that silently evaporates.
 */
export function createProductionStore(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof createStore> {
  return env.WORKSPACE_FILE !== undefined && env.WORKSPACE_FILE !== ""
    ? createStore("file", env.WORKSPACE_FILE)
    : createStore("memory");
}

/** Build (once per warm instance) the same app the local CLI serves. */
function getApp(): AppPromise {
  appPromise ??= buildApi({
    provider: new GeminiProvider(),
    registry: createBitgetAdapterSet().registry,
    store: createProductionStore(),
  });
  return appPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { app } = await getApp();
  // Fastify's routing consumes Node's raw req/res. Vercel's helpers satisfy the
  // IncomingMessage/ServerResponse surface Fastify needs at runtime (VercelRequest
  // is itself an EventEmitter); only the static types need the bridge.
  await app.ready();
  app.routing(
    req as unknown as import("node:http").IncomingMessage,
    res as unknown as import("node:http").ServerResponse,
  );
}
