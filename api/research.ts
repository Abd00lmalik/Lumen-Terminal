/**
 * Vercel Functions adapter — the production API boundary (DEPLOYMENT.md "Vercel architecture").
 *
 * This file contains NO research logic. It hosts the SAME Fastify application used by
 * `npm run api` (buildApi → registerRoutes → ResearchApp → LUI → engine → capability
 * registry) inside the Vercel Node.js runtime.
 *
 * Why the internal-server bridge: Vercel's production runtime passes handlers a wrapped
 * response object that is NOT a real `http.ServerResponse`, so Fastify's raw
 * `app.routing(req, res)` crashes (`this.raw.getHeader is not a function`); `vercel dev`
 * hands the function real Node streams and therefore masks the mismatch. The bridge below
 * gives Fastify exactly what it wants — a real IncomingMessage/ServerResponse pair on a
 * localhost listener per warm instance — and streams the upstream response (including SSE
 * progress events) back to the client unbuffered via pipe. Verified against the packaged
 * `.vercel/output` function and under `vercel dev`.
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
import type { AddressInfo } from "node:net";
import http from "node:http";
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

/** One internal localhost server per warm instance, hosting the Fastify app. */
let serverPromise: Promise<http.Server> | undefined;

function getServer(): Promise<http.Server> {
  serverPromise ??= (async () => {
    const { app } = await getApp();
    await app.ready();
    const server = http.createServer((rawReq, rawRes) => {
      app.routing(rawReq, rawRes);
    });
    server.keepAliveTimeout = 65_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return server;
  })();
  return serverPromise;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const server = await getServer();
  const { port } = server.address() as AddressInfo;

  const headers = { ...req.headers };
  delete headers["content-length"];
  delete headers["transfer-encoding"];
  delete headers.connection;
  headers.host = `127.0.0.1:${port}`;

  const upstream = http.request(
    { host: "127.0.0.1", port, path: req.url, method: req.method, headers },
    (upstreamRes) => {
      // Forward the response unbuffered (SSE progress streams included), stripping
      // hop-by-hop headers that must never cross a proxy boundary.
      const headers = { ...upstreamRes.headers };
      delete headers["connection"];
      delete headers["transfer-encoding"];
      delete headers["keep-alive"];
      res.writeHead(upstreamRes.statusCode ?? 500, headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    // Logged (never leaked to the client beyond a generic 502 body): this is the one
    // failure mode of the bridge worth diagnosing from function logs.
    console.error("[api] internal bridge request failed:", err);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "api bridge failure" }));
  });

  // Vercel parses the body for us (req.body); a raw stream (vercel dev) is piped through.
  if (req.body !== undefined && req.body !== null) {
    const payload = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (!headers["content-type"]) headers["content-type"] = "application/json";
    upstream.setHeader("content-type", headers["content-type"]);
    upstream.end(payload);
  } else if (typeof (req as unknown as { pipe?: unknown }).pipe === "function") {
    req.pipe(upstream);
  } else {
    upstream.end();
  }

  // If the client disconnects mid-research, stop feeding the upstream request.
  // NOTE: this must be detected on the RESPONSE stream (closed before it finished
  // writing), not on `req` "close": a request message completes as soon as its body
  // ends (immediately for GET, and long before the SSE reply streams for POST), so a
  // req-based check would abort every request before any response arrived.
  if (typeof res.on === "function") {
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
  }
}
