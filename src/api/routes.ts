/**
 * F0 HTTP routes; thin transport over the application service (F0 mandate §2/§4/§5/§9–§13).
 *
 * Every route: validate transport input → call ResearchApp → map to DTO / typed error.
 * No research logic, no flow selection, no tool calls, no direct state mutation here.
 * The research POST supports SSE (`?stream=1`) streaming REAL engine progress events.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ResearchApp, TRADER_ORIGIN, MAX_RESEARCH_LIMIT, type ResearchListOptions } from "./research-app.js";
import { ApiFailure, InvalidRequestError, mapApiError } from "./errors.js";
import { formatSseEvent, sseHeaders, type SseEvent } from "./sse.js";
import type { ProgressEvent } from "../research/progress.js";
import type { ApiErrorDTO } from "./dto.js";

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function requireString(body: unknown, field: string): string {
  if (typeof body !== "object" || body === null) throw new InvalidRequestError("JSON object body required");
  const value = (body as Record<string, unknown>)[field];
  if (!isString(value)) throw new InvalidRequestError(`"${field}" must be a string`);
  return value;
}

/** Optional confirmation flag; mirrors the frontend's explicit confirmation dialog. */
function readConfirmed(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as Record<string, unknown>).confirmed;
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new InvalidRequestError('"confirmed" must be a boolean when present');
  return value;
}

/**
 * Parse + validate the history-list window (?limit&offset&sort&status&q). Deliberately plain:
 * a bounded window, an order, an exact status and a case-insensitive substring — never a
 * query language. Invalid values fail loudly instead of being silently ignored.
 */
function readResearchListOptions(query: unknown): ResearchListOptions {
  const q = (typeof query === "object" && query !== null ? query : {}) as Record<string, unknown>;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  const count = (value: unknown, field: string): number | undefined => {
    const raw = text(value);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) throw new InvalidRequestError(`"${field}" must be an integer`);
    return parsed;
  };
  const limit = count(q.limit, "limit");
  if (limit !== undefined && (limit < 1 || limit > MAX_RESEARCH_LIMIT)) {
    throw new InvalidRequestError(`"limit" must be between 1 and ${MAX_RESEARCH_LIMIT}`);
  }
  const offset = count(q.offset, "offset");
  if (offset !== undefined && offset < 0) throw new InvalidRequestError('"offset" must be >= 0');
  const sort = text(q.sort);
  if (sort !== undefined && sort !== "recent" && sort !== "oldest") {
    throw new InvalidRequestError('"sort" must be "recent" or "oldest"');
  }
  const status = text(q.status);
  const search = text(q.q) ?? text(q.query);
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(search !== undefined ? { q: search } : {}),
  };
}

function handleError(reply: FastifyReply, err: unknown): void {
  const mapped = mapApiError(err);
  void reply.code(mapped.statusCode).send(mapped.body);
}

/** Wrap a handler so domain/app errors become typed transport errors (never raw 500s). */
function withErrors(handler: (req: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const out = await handler(req, reply);
      if (out !== undefined && !reply.sent) return reply.code(reply.statusCode === 200 ? 200 : reply.statusCode).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  };
}

export function registerRoutes(app: FastifyInstance, researchApp: ResearchApp): void {
  // ------------------------------------------------------------------
  // Session / workspace / continuity (F0 mandate §9)
  // ------------------------------------------------------------------

  app.post("/api/session", async (_req, reply) => {
    const snapshot = researchApp.sessionSnapshot();
    return reply.code(201).send({
      workspaceRef: "local", // single-workspace MVP; identity stub per FRONTEND_ARCHITECTURE.md §18
      createdAt: new Date().toISOString(),
      continuity: snapshot.continuity,
    });
  });

  app.get("/api/workspace", { handler: withErrors(async () => researchApp.continuity()) });

  // ------------------------------------------------------------------
  // Research request (F0 mandate §5); natural language only; NO flow in the API contract.
  // ------------------------------------------------------------------

  app.post("/api/research", async (req, reply) => {
    let message: string;
    let confirmed: boolean;
    try {
      message = requireString(req.body, "message");
      confirmed = readConfirmed(req.body);
    } catch (err) {
      handleError(reply, err);
      return;
    }

    const wantsStream = req.query && (req.query as Record<string, unknown>).stream === "1";

    if (!wantsStream) {
      try {
        const dto = await researchApp.submitResearchRequest(message, undefined, confirmed);
        return reply.code(200).send(dto);
      } catch (err) {
        handleError(reply, err);
        return;
      }
    }

    // SSE path: REAL progress events from the engine listener + terminal final/error event.
    // `reply.hijack()` gives this handler exclusive control of the raw stream; the supported
    // Fastify pattern for server-driven streaming (works identically under inject()).
    void reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, sseHeaders());
    raw.write(": research stream opened\n\n");

    // Heartbeats: model calls and capability executions can stay silent for minutes.
    // An SSE comment tick keeps intermediaries (and Vercel's function streaming) from
    // treating the run as stalled. Cleared on every terminal path.
    const heartbeat = setInterval(() => raw.write(": heartbeat\n\n"), 15000);
    const send = (event: SseEvent) => {
      raw.write(formatSseEvent(event));
    };
    const onProgress = (e: ProgressEvent) => send({ event: "progress", data: e });

    try {
      const dto = await researchApp.submitResearchRequest(message, onProgress, confirmed);
      // The terminal event is written, then a padded tail flush follows so no intermediary
      // buffer can sit on the last bytes; the client parses events, never the padding.
      raw.write(formatSseEvent({ event: "final", data: dto }));
      raw.write(" ".repeat(2048) + "\n\n");
      raw.end();
    } catch (err) {
      const mapped = mapApiError(err);
      raw.write(formatSseEvent({ event: "error", data: mapped.body }));
      raw.write(" ".repeat(2048) + "\n\n");
      raw.end();
    } finally {
      clearInterval(heartbeat);
    }
  });

  // ------------------------------------------------------------------
  // Research objects + history (F0 mandate §10); explicit status fields
  // ------------------------------------------------------------------

  app.get("/api/research", {
    handler: withErrors(async (req) => researchApp.listResearch(readResearchListOptions(req.query))),
  });
  app.get("/api/research/:ref", {
    handler: withErrors(async (req) => researchApp.getResearch((req.params as { ref: string }).ref)),
  });
  app.get("/api/evidence", {
    handler: withErrors(async (req) => {
      // Bounded window by default: the evidence archive grows for the life of the
      // workspace and an unbounded list response eventually breaks every client that
      // reads it (observed at 1.28 MB in production). The default window is far beyond
      // a page's render capacity; explicit `?limit=` overrides for full retrieval.
      const rawLimit = (req.query as { limit?: string } | undefined)?.limit;
      const parsed = rawLimit === undefined ? Number.NaN : Number(rawLimit);
      const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 2000) : 300;
      return researchApp.listEvidence().slice(-limit).reverse(); // newest first
    }),
  });
  app.get("/api/evidence/:ref", {
    handler: withErrors(async (req) => researchApp.getEvidence((req.params as { ref: string }).ref)),
  });
  app.get("/api/claims", { handler: withErrors(async () => researchApp.listClaims()) });
  app.get("/api/hypotheses", { handler: withErrors(async () => researchApp.listHypotheses()) });
  app.get("/api/judgments", { handler: withErrors(async () => researchApp.listJudgments()) });

  // ------------------------------------------------------------------
  // Thesis workspace (F0 mandate §11); selection routed through the domain boundary only
  // ------------------------------------------------------------------

  app.get("/api/thesis", { handler: withErrors(async () => researchApp.listTheses()) });
  // Contract alias: the frontend client historically calls the plural path; both resolve
  // to the same handler so neither side's vocabulary can 404 the theses list.
  app.get("/api/theses", { handler: withErrors(async () => researchApp.listTheses()) });
  app.get("/api/thesis/:ref", {
    handler: withErrors(async (req) => researchApp.getThesis((req.params as { ref: string }).ref)),
  });
  app.post("/api/thesis/select", async (req, reply) => {
    try {
      const ref = requireString(req.body, "thesisRef");
      const out = await researchApp.selectThesis(ref);
      return reply.code(200).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.get("/api/assessments", {
    handler: withErrors(async (req) => {
      const q = req.query as Record<string, unknown> | undefined;
      const thesisRef = q !== undefined && isString(q.thesisRef) ? q.thesisRef : undefined;
      return researchApp.listAssessments(thesisRef);
    }),
  });

  // ------------------------------------------------------------------
  // Memory / saved artifacts (F0 mandate §12); READ-ONLY; SAVE stays behind the LUI
  // authorization boundary (a natural-language SAVE through /api/research), never a direct
  // HTTP shortcut. No persistMemory route exists; by construction.
  // ------------------------------------------------------------------

  app.get("/api/memory", { handler: withErrors(async () => researchApp.listMemories()) });
  app.get("/api/artifacts", { handler: withErrors(async () => researchApp.listSavedArtifacts()) });

  // ------------------------------------------------------------------
  // Monitoring handoff state (F0 mandate §13); NO background infrastructure exists or is
  // implied. Activation goes through the domain's trader-confirmation boundary.
  // ------------------------------------------------------------------

  app.get("/api/monitors", { handler: withErrors(async () => researchApp.listMonitors()) });
  app.post("/api/monitors/:ref/activate", {
    handler: withErrors(async (req) => {
      const ref = (req.params as { ref: string }).ref;
      return researchApp.activateMonitor(ref);
    }),
  });

  void TRADER_ORIGIN;
}

// Re-export so the server bootstrap can compose without circular imports.
export { ApiFailure };
export type { ApiErrorDTO };
