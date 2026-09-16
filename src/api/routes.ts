/**
 * F0 HTTP routes — thin transport over the application service (F0 mandate §2/§4/§5/§9–§13).
 *
 * Every route: validate transport input → call ResearchApp → map to DTO / typed error.
 * No research logic, no flow selection, no tool calls, no direct state mutation here.
 * The research POST supports SSE (`?stream=1`) streaming REAL engine progress events.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ResearchApp, TRADER_ORIGIN } from "./research-app.js";
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

/** Optional confirmation flag — mirrors the frontend's explicit confirmation dialog. */
function readConfirmed(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as Record<string, unknown>).confirmed;
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new InvalidRequestError('"confirmed" must be a boolean when present');
  return value;
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
  // Research request (F0 mandate §5) — natural language only; NO flow in the API contract.
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
    // `reply.hijack()` gives this handler exclusive control of the raw stream — the supported
    // Fastify pattern for server-driven streaming (works identically under inject()).
    void reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, sseHeaders());
    raw.write(": research stream opened\n\n");

    const send = (event: SseEvent) => {
      raw.write(formatSseEvent(event));
    };
    const onProgress = (e: ProgressEvent) => send({ event: "progress", data: e });

    try {
      const dto = await researchApp.submitResearchRequest(message, onProgress, confirmed);
      send({ event: "final", data: dto });
    } catch (err) {
      const mapped = mapApiError(err);
      send({ event: "error", data: mapped.body });
    }
    raw.end();
  });

  // ------------------------------------------------------------------
  // Research objects + history (F0 mandate §10) — explicit status fields
  // ------------------------------------------------------------------

  app.get("/api/research", { handler: withErrors(async () => researchApp.listResearch()) });
  app.get("/api/research/:ref", {
    handler: withErrors(async (req) => researchApp.getResearch((req.params as { ref: string }).ref)),
  });
  app.get("/api/evidence", { handler: withErrors(async () => researchApp.listEvidence()) });
  app.get("/api/evidence/:ref", {
    handler: withErrors(async (req) => researchApp.getEvidence((req.params as { ref: string }).ref)),
  });
  app.get("/api/claims", { handler: withErrors(async () => researchApp.listClaims()) });
  app.get("/api/hypotheses", { handler: withErrors(async () => researchApp.listHypotheses()) });
  app.get("/api/judgments", { handler: withErrors(async () => researchApp.listJudgments()) });

  // ------------------------------------------------------------------
  // Thesis workspace (F0 mandate §11) — selection routed through the domain boundary only
  // ------------------------------------------------------------------

  app.get("/api/thesis", { handler: withErrors(async () => researchApp.listTheses()) });
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
  // Memory / saved artifacts (F0 mandate §12) — READ-ONLY; SAVE stays behind the LUI
  // authorization boundary (a natural-language SAVE through /api/research), never a direct
  // HTTP shortcut. No persistMemory route exists — by construction.
  // ------------------------------------------------------------------

  app.get("/api/memory", { handler: withErrors(async () => researchApp.listMemories()) });
  app.get("/api/artifacts", { handler: withErrors(async () => researchApp.listSavedArtifacts()) });

  // ------------------------------------------------------------------
  // Monitoring handoff state (F0 mandate §13) — NO background infrastructure exists or is
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
