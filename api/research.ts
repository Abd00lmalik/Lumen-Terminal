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

/**
 * Build (once per warm instance) the same app the local CLI serves.
 *
 * A FAILED construction must never be cached: `appPromise ??=` would pin a rejected
 * promise for the lifetime of the instance, turning every later request on it (including
 * /api/health and well-formed research POSTs) into an opaque 500 no matter how valid the
 * request was. On failure the attempt is discarded so the next request retries cleanly.
 */
function getApp(): AppPromise {
  if (appPromise === undefined) {
    const attempt = buildApi({
      // deferCredentialCheck: in serverless, a missing GEMINI_API_KEY must NOT crash the whole
      // API at construction (it used to turn even /api/health into an opaque 500 on any instance
      // built before the env vars existed). With deferral the provider validates lazily at first
      // model use: research requests get the same typed AUTH_FAILURE as any model failure and the
      // UI renders an honest MODEL_FAILURE; health/history routes stay up regardless.
      provider: new GeminiProvider({ deferCredentialCheck: true }),
      registry: createBitgetAdapterSet().registry,
      store: createProductionStore(),
    });
    appPromise = attempt;
    attempt.catch(() => {
      if (appPromise === attempt) appPromise = undefined; // allow a clean retry; never pin a rejection
    });
  }
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
      try {
        app.routing(rawReq, rawRes);
      } catch (err) {
        // Fastify internals can throw synchronously for malformed input before its async
        // error pipeline engages (e.g. a JSON body parse error). Classify it: known
        // client-request problems become a typed 400; anything else is contained as a
        // 500 with a safe message. The error code is logged for production diagnosis.
        const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : `(no code: ${String((err as Error)?.name)})`;
        console.error("[api:tag:routing-sync] app.routing sync failure:", code);
        const clientProblem = code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || code === "FST_ERR_CTP_EMPTY_JSON_BODY" || code === "FST_ERR_CTP_INVALID_JSON" || code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH" || code === "FST_ERR_BAD_REQUEST" || (err instanceof SyntaxError && /JSON/i.test(String((err as Error).message)));
        respondTypedError(
          rawRes as unknown as VercelResponse,
          clientProblem ? 400 : 500,
          clientProblem ? "INVALID_REQUEST" : "INTERNAL_ERROR",
          clientProblem
            ? 'The request body could not be parsed. Send application/json with a "message" string.'
            : "The research API failed to handle this request. No research content was fabricated; try again shortly.",
        );
      }
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
// Request body access (production runtime law)
// ---------------------------------------------------------------------------

/**
 * Vercel's runtime implements `req.body` as a LAZY GETTER that THROWS (statusCode 400,
 * message "Invalid JSON") when the client body is malformed. Proven from production logs:
 * an unguarded access inside the proxy escapes the adapter and used to be re-emitted by
 * the last-resort catch as 500 INTERNAL_ERROR — misclassifying a client error. Contain
 * the access: a throwing getter means the REQUEST is malformed → typed 400.
 */
function readRequestBody(req: VercelRequest): { ok: true; body: unknown } | { ok: false } {
  try {
    return { ok: true, body: (req as { body?: unknown }).body };
  } catch {
    return { ok: false };
  }
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

/**
 * Forward the upstream body to the Vercel response and call `onDone` exactly once when the
 * upstream body has fully ended (or failed). `pipe` is used only when the response object is
 * a real stream (vercel dev, real Node); Vercel's production wrapped response is driven
 * manually via write/end, which its runtime guarantees.
 */
function forwardUpstreamResponse(
  res: VercelResponse,
  upstreamRes: http.IncomingMessage,
  onDone: () => void,
): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone();
  };
  const endQuietly = () => {
    try {
      (res as unknown as { end: () => unknown }).end();
    } catch {
      // nothing further can be done if even end() fails
    }
  };
  const streamLike = res as unknown as { pipe?: unknown; on?: unknown; write?: unknown; end?: unknown };
  if (typeof streamLike.pipe === "function" && typeof streamLike.on === "function") {
    upstreamRes.pipe(res as unknown as NodeJS.WritableStream);
    upstreamRes.on("end", finish);
    upstreamRes.on("error", finish);
    return;
  }
  if (typeof streamLike.write === "function" && typeof streamLike.end === "function") {
    upstreamRes.on("data", (chunk: Buffer) => {
      (res as unknown as { write: (c: Buffer) => unknown }).write(chunk);
    });
    upstreamRes.on("end", () => {
      (res as unknown as { end: () => unknown }).end();
      finish();
    });
    upstreamRes.on("error", () => {
      endQuietly();
      finish();
    });
    return;
  }
  // Last resort: buffer the whole body and end once (SSE arrives in one body).
  const chunks: Buffer[] = [];
  upstreamRes.on("data", (c: Buffer) => chunks.push(c));
  upstreamRes.on("end", () => {
    try {
      res.end(Buffer.concat(chunks));
    } catch {
      // nothing further can be done
    }
    finish();
  });
  upstreamRes.on("error", () => {
    endQuietly();
    finish();
  });
}

async function proxyThroughSocket(req: VercelRequest, res: VercelResponse, server: http.Server): Promise<void> {
  const { port } = server.address() as AddressInfo;
  const headers = hopByHopRequestHeaders(req, port);

  // Contain the lazy body getter FIRST (it throws on malformed JSON; see readRequestBody):
  // a malformed request is a client error and must be answered with the typed 400 before
  // any upstream work begins.
  const parsedBody = readRequestBody(req);
  if (!parsedBody.ok) {
    respondTypedError(res, 400, "INVALID_REQUEST", 'The request body could not be parsed. Send application/json with a "message" string.');
    return;
  }
  const requestBody = parsedBody.body;

  // The handler MUST NOT resolve before the upstream response has been fully forwarded:
  // Vercel finalizes the invocation when the handler promise settles, so resolving early
  // would truncate (or entirely drop) the response body and every SSE event.
  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

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
        forwardUpstreamResponse(res, upstreamRes, settle);
      },
    );
    upstream.on("error", (err) => {
      // Logged (never leaked to the client beyond a typed JSON body): this is the one
      // failure mode of the bridge worth diagnosing from function logs.
      console.error("[api] internal bridge request failed:", err);
      respondTypedError(res, 502, "BRIDGE_FAILURE", "The API's internal request bridge failed; the research service is temporarily unavailable.");
      settle();
    });

    // Vercel parses the body for us (already contained above); a raw stream (vercel dev) is piped through.
    if (requestBody !== undefined && requestBody !== null) {
      const payload = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
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
        settle();
      });
    }
  });
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

  // Same lazy-getter containment as the socket transport (see readRequestBody).
  const parsedBody = readRequestBody(req);
  if (!parsedBody.ok) {
    respondTypedError(res, 400, "INVALID_REQUEST", 'The request body could not be parsed. Send application/json with a "message" string.');
    return;
  }
  const requestBody = parsedBody.body;

  const [path, queryPart] = (req.url ?? "/").split("?");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length" || lower === "transfer-encoding" || lower === "accept-encoding") continue;
    if (typeof value === "string") headers[key] = value;
  }

  const payload =
    requestBody === undefined || requestBody === null
      ? undefined
      : typeof requestBody === "string"
        ? requestBody
        : JSON.stringify(requestBody);
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
    console.error("[api:tag:handler-catch] handler failure:", err);
    respondTypedError(
      res,
      500,
      "INTERNAL_ERROR",
      "The research API failed to handle this request. No research content was fabricated; try again shortly.",
    );
  }
}
