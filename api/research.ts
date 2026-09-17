/**
 * Vercel Functions adapter — the production API boundary (DEPLOYMENT.md "Vercel architecture").
 *
 * This file contains NO research logic. It hosts the SAME Fastify application used by
 * `npm run api` (buildApi → registerRoutes → ResearchApp → LUI → engine → capability
 * registry) inside the Vercel Node.js runtime.
 *
 * Why a dual-transport bridge: Vercel's production runtime passes handlers a wrapped
 * response object that is NOT a real `http.ServerResponse`, so Fastify's raw
 * `app.routing(req, res)` crashes. Two transports cover every environment:
 *
 * 1. SOCKET transport (preferred): the app is hosted on an internal loopback
 *    `node:http` server per warm instance and the request is proxied to it. This gives
 *    Fastify exactly what it wants (a real IncomingMessage/ServerResponse pair) and
 *    streams SSE progress unbuffered. A one-time self-check proves the loopback works;
 *    if sockets are unavailable (sandbox restriction), the instance falls back to:
 * 2. INJECT transport: Fastify's own `app.inject()` performs the request in-process —
 *    no sockets at all. The response is delivered complete (SSE events arrive in one
 *    body rather than progressively; the client parses events either way).
 *
 * The transport choice is made ONCE per warm instance and is sticky; both paths return
 * the same bytes for the same request.
 *
 * Error containment: an unexpected failure inside this adapter must never escape as an
 * opaque FUNCTION_INVOCATION_FAILED — it is logged and returned as a typed JSON error
 * (safe message only; no secrets, no stack internals, no env details).
 *
 * Persistence honesty (mandate §2/§6): serverless instances have ephemeral local disks,
 * so unless WORKSPACE_FILE is explicitly provided, the production API uses an in-memory
 * store. Workspace state is per-function-instance — it survives across requests on a
 * warm instance and is lost on cold starts. Documented in DEPLOYMENT.md; never claimed
 * to be durable.
 *
 * Secrets: GEMINI_API_KEY / GEMINI_MODEL are read only inside the Gemini provider from
 * Vercel's encrypted server-side env. Nothing here exposes them; they never cross the
 * API surface into responses.
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

// ---------------------------------------------------------------------------
// Transport selection (once per warm instance, sticky)
// ---------------------------------------------------------------------------

type Transport = "socket" | "inject";
/** Sticky per-instance transport result; holds the mode plus the live server (socket mode). */
let transportPromise: Promise<{ mode: Transport; server?: http.Server }> | undefined;

/** Start the loopback server hosting the Fastify app; resolves ready or throws. */
function startLoopbackServer(): Promise<http.Server> {
  return (async () => {
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
}

/**
 * Prove the loopback transport end-to-end ONCE: server listening AND a real
 * /api/health round-trip through it returns 200. Any failure (listen blocked,
 * connect refused, timeout) leaves the "socket" transport unavailable for this
 * instance and selects "inject" instead. Bounded by a 5s self-check timeout so a
 * hostile sandbox cannot stall the first request.
 */
function detectTransport(): Promise<{ mode: Transport; server?: http.Server }> {
  transportPromise ??= (async () => {
    try {
      const server = await startLoopbackServer();
      const healthy = await new Promise<boolean>((resolve) => {
        const { port } = server.address() as AddressInfo;
        const req = http.get(
          { host: "127.0.0.1", port, path: "/api/health", timeout: 5000 },
          (res) => {
            res.resume();
            resolve(res.statusCode === 200);
          },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      });
      if (healthy) return { mode: "socket" as const, server };
      server.close();
      return { mode: "inject" as const };
    } catch {
      return { mode: "inject" as const };
    }
  })();
  return transportPromise;
}

// ---------------------------------------------------------------------------
// SOCKET transport: proxy through the loopback server (true SSE streaming)
// ---------------------------------------------------------------------------

function hopByHopRequestHeaders(req: VercelRequest, port: number): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length" || lower === "transfer-encoding" || lower === "keep-alive" || lower === "accept-encoding") continue;
    if (value === undefined) continue;
    headers[key] = value;
  }
  headers.host = `127.0.0.1:${port}`;
  return headers;
}

function writeViaVercelResponse(
  res: VercelResponse,
  statusCode: number,
  headers: Record<string, string | string[]>,
): void {
  // VercelResponse is Node-like but not exactly Node's ServerResponse: prefer
  // writeHead when present, fall back to status/setHeader.
  if (typeof res.writeHead === "function") {
    res.writeHead(statusCode, headers as Record<string, string>);
    return;
  }
  if (typeof res.status === "function") res.status(statusCode);
  for (const [key, value] of Object.entries(headers)) {
    if (typeof res.setHeader === "function") res.setHeader(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
}

async function proxyThroughSocket(req: VercelRequest, res: VercelResponse, server: http.Server): Promise<void> {
  const { port } = server.address() as AddressInfo;
  const headers = hopByHopRequestHeaders(req, port);

  const upstream = http.request(
    { host: "127.0.0.1", port, path: req.url, method: req.method, headers },
    (upstreamRes) => {
      // Forward the response unbuffered (SSE progress streams included), stripping
      // hop-by-hop headers that must never cross a proxy boundary.
      const outHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        const lower = key.toLowerCase();
        if (lower === "connection" || lower === "transfer-encoding" || lower === "keep-alive") continue;
        if (value === undefined) continue;
        outHeaders[key] = value;
      }
      writeViaVercelResponse(res, upstreamRes.statusCode ?? 500, outHeaders);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    // Logged (never leaked to the client beyond a typed JSON body): this is the one
    // failure mode of the bridge worth diagnosing from function logs.
    console.error("[api] internal bridge request failed:", err);
    respondTypedError(res, 502, "BRIDGE_FAILURE", "The API's internal request bridge failed; the research service is temporarily unavailable.");
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

// ---------------------------------------------------------------------------
// INJECT transport: Fastify app.inject(), zero sockets
// ---------------------------------------------------------------------------

function safeOutgoingHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "connection" || lower === "keep-alive") continue;
    if (value === undefined || value === null) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

async function respondViaInject(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { app } = await getApp();
  await app.ready();

  const [path, queryPart] = (req.url ?? "/").split("?");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length" || lower === "transfer-encoding" || lower === "accept-encoding") continue;
    if (typeof value === "string") headers[key] = value;
  }

  const payload =
    req.body === undefined || req.body === null
      ? undefined
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);
  if (payload !== undefined && headers["content-type"] === undefined) headers["content-type"] = "application/json";

  const response = await app.inject({
    method: (req.method ?? "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS",
    url: path,
    ...(queryPart ? { query: Object.fromEntries(new URLSearchParams(queryPart)) } : {}),
    headers,
    ...(payload !== undefined ? { payload } : {}),
  });

  writeViaVercelResponse(res, response.statusCode, safeOutgoingHeaders(response.headers as Record<string, unknown>));
  if (req.method !== "HEAD") res.end(response.body);
  else res.end();
}

// ---------------------------------------------------------------------------
// Typed error containment (never an opaque FUNCTION_INVOCATION_FAILED)
// ---------------------------------------------------------------------------

function respondTypedError(res: VercelResponse, statusCode: number, code: string, message: string): void {
  try {
    const body = JSON.stringify({ error: { code, message } });
    if (typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
      res.end(body);
    } else if (typeof res.status === "function") {
      if (typeof res.setHeader === "function") res.setHeader("content-type", "application/json; charset=utf-8");
      res.status(statusCode).end(body);
    } else {
      res.statusCode = statusCode;
      res.end(body);
    }
  } catch {
    // Nothing further can be done if even the error path fails.
  }
}

/** Production handler: same app, transport chosen by environment capability. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const transport = await detectTransport();
    if (transport.mode === "socket" && transport.server) {
      await proxyThroughSocket(req, res, transport.server);
      return;
    }
    await respondViaInject(req, res);
  } catch (err) {
    console.error("[api] handler failure:", err);
    respondTypedError(
      res,
      500,
      "INTERNAL_ERROR",
      "The research API failed to handle this request. No research content was fabricated; try again shortly.",
    );
  }
}
