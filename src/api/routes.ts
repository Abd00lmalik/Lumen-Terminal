/**
 * F0 HTTP routes; thin transport over the application service (F0 mandate §2/§4/§5/§9–§13).
 *
 * Every route: validate transport input → call ResearchApp → map to DTO / typed error.
 * No research logic, no flow selection, no tool calls, no direct state mutation here.
 * The research POST supports SSE (`?stream=1`) streaming REAL engine progress events.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ResearchApp, TRADER_ORIGIN, MAX_RESEARCH_LIMIT, MAX_SAVED_LIMIT, type ResearchListOptions, type SavedListOptions, type ThesisListOptions, type ThesisCreateRequest, type ThesisUpdateRequest } from "./research-app.js";
import { ApiFailure, InvalidRequestError, mapApiError } from "./errors.js";
import { formatSseEvent, sseHeaders, type SseEvent } from "./sse.js";
import type { ProgressEvent } from "../research/progress.js";
import { SAVED_KINDS } from "../domain/thesis.js";
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

/**
 * Parse + validate the Saved-library window (?limit&offset&sort&kind&q). Same plain discipline
 * as the history window: bounded window, order, exact kind, case-insensitive substring.
 */
function readSavedListOptions(query: unknown): SavedListOptions {
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
  if (limit !== undefined && (limit < 1 || limit > MAX_SAVED_LIMIT)) {
    throw new InvalidRequestError(`"limit" must be between 1 and ${MAX_SAVED_LIMIT}`);
  }
  const offset = count(q.offset, "offset");
  if (offset !== undefined && offset < 0) throw new InvalidRequestError('"offset" must be >= 0');
  const sort = text(q.sort);
  if (sort !== undefined && sort !== "recent" && sort !== "oldest") {
    throw new InvalidRequestError('"sort" must be "recent" or "oldest"');
  }
  const kind = text(q.kind);
  if (kind !== undefined && !(SAVED_KINDS as readonly string[]).includes(kind.toUpperCase())) {
    throw new InvalidRequestError(`"kind" must be one of ${SAVED_KINDS.join(", ")}`);
  }
  // Phase D: filter by originating run. A MALFORMED ref is a transport error (400); a
  // well-formed but unknown ref is a valid empty result (the app layer never invents data).
  const researchRef = text(q.researchRef) ?? text(q.research);
  if (researchRef !== undefined && !/^rs_[A-Za-z0-9]+$/.test(researchRef)) {
    throw new InvalidRequestError('"researchRef" must be a research ref of the form rs_<id>');
  }
  const search = text(q.q) ?? text(q.search) ?? text(q.query);
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(researchRef !== undefined ? { researchRef } : {}),
    ...(search !== undefined ? { q: search } : {}),
  };
}

/** Explicit SAVE payload; kind/structure validation happens in the application layer. */
function readSavedCreate(body: unknown): { researchRef: string; kind: string; sourceRef?: string; tags?: string[]; rationale?: string } {
  if (typeof body !== "object" || body === null) throw new InvalidRequestError("JSON object body required");
  const record = body as Record<string, unknown>;
  const researchRef = typeof record.researchRef === "string" ? record.researchRef : undefined;
  if (researchRef === undefined) throw new InvalidRequestError('"researchRef" must be a string');
  const kind = typeof record.kind === "string" ? record.kind : undefined;
  if (kind === undefined) throw new InvalidRequestError('"kind" must be a string');
  const sourceRef = record.sourceRef === undefined ? undefined : record.sourceRef;
  if (sourceRef !== undefined && typeof sourceRef !== "string") throw new InvalidRequestError('"sourceRef" must be a string when present');
  const rationale = record.rationale === undefined ? undefined : record.rationale;
  if (rationale !== undefined && typeof rationale !== "string") throw new InvalidRequestError('"rationale" must be a string when present');
  const tags = record.tags === undefined ? undefined : record.tags;
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
    throw new InvalidRequestError('"tags" must be a string array when present');
  }
  return {
    researchRef,
    kind,
    ...(sourceRef !== undefined ? { sourceRef } : {}),
    ...(tags !== undefined ? { tags: tags as string[] } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
  };
}

/** Thesis list window (?status&q). */
function readThesisListOptions(query: unknown): ThesisListOptions {
  const q = (typeof query === "object" && query !== null ? query : {}) as Record<string, unknown>;
  const status = typeof q.status === "string" && q.status.trim() !== "" ? q.status.trim().toUpperCase() : undefined;
  const search = typeof q.q === "string" && q.q.trim() !== "" ? q.q.trim() : undefined;
  return {
    ...(status !== undefined ? { status } : {}),
    ...(search !== undefined ? { q: search } : {}),
  };
}

/** Optional string[] field; rejects non-string entries loudly. */
function readStringArray(record: Record<string, unknown>, field: string): string[] | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new InvalidRequestError(`"${field}" must be a string array when present`);
  }
  return value as string[];
}

/** Explicit thesis CREATE payload; derivation from research/saved happens in the app layer. */
function readThesisCreate(body: unknown): ThesisCreateRequest {
  if (typeof body !== "object" || body === null) throw new InvalidRequestError("JSON object body required");
  const record = body as Record<string, unknown>;
  const str = (field: string): string | undefined => {
    const v = record[field];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw new InvalidRequestError(`"${field}" must be a string when present`);
    return v;
  };
  const invalidationConditions = readStringArray(record, "invalidationConditions");
  const materialConditions = readStringArray(record, "materialConditions");
  return {
    ...(str("title") !== undefined ? { title: str("title")! } : {}),
    ...(str("statement") !== undefined ? { statement: str("statement")! } : {}),
    ...(str("objective") !== undefined ? { objective: str("objective")! } : {}),
    ...(str("asset") !== undefined ? { asset: str("asset")! } : {}),
    ...(str("researchRef") !== undefined ? { researchRef: str("researchRef")! } : {}),
    ...(str("savedId") !== undefined ? { savedId: str("savedId")! } : {}),
    ...(invalidationConditions !== undefined ? { invalidationConditions } : {}),
    ...(materialConditions !== undefined ? { materialConditions } : {}),
  };
}

/** Explicit thesis UPDATE payload (PATCH). */
function readThesisUpdate(body: unknown): ThesisUpdateRequest {
  if (typeof body !== "object" || body === null) throw new InvalidRequestError("JSON object body required");
  const record = body as Record<string, unknown>;
  const str = (field: string): string | undefined => {
    const v = record[field];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw new InvalidRequestError(`"${field}" must be a string when present`);
    return v;
  };
  const confidenceRaw = record.confidence;
  if (confidenceRaw !== undefined && confidenceRaw !== "HIGH" && confidenceRaw !== "MODERATE" && confidenceRaw !== "LOW") {
    throw new InvalidRequestError('"confidence" must be HIGH, MODERATE or LOW when present');
  }
  const invalidationConditions = readStringArray(record, "invalidationConditions");
  const materialConditions = readStringArray(record, "materialConditions");
  const alternatives = readStringArray(record, "alternatives");
  return {
    ...(str("title") !== undefined ? { title: str("title")! } : {}),
    ...(str("statement") !== undefined ? { statement: str("statement")! } : {}),
    ...(str("objective") !== undefined ? { objective: str("objective")! } : {}),
    ...(str("asset") !== undefined ? { asset: str("asset")! } : {}),
    ...(invalidationConditions !== undefined ? { invalidationConditions } : {}),
    ...(materialConditions !== undefined ? { materialConditions } : {}),
    ...(alternatives !== undefined ? { alternatives } : {}),
    ...(confidenceRaw !== undefined ? { confidence: confidenceRaw as "HIGH" | "MODERATE" | "LOW" } : {}),
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

  app.get("/api/thesis", {
    handler: withErrors(async (req) => researchApp.listTheses(readThesisListOptions(req.query))),
  });
  // Contract alias: the frontend client historically calls the plural path; both resolve
  // to the same handler so neither side's vocabulary can 404 the theses list.
  app.get("/api/theses", {
    handler: withErrors(async (req) => researchApp.listTheses(readThesisListOptions(req.query))),
  });

  // Phase D: explicit thesis actions (create/update/status/archive/link). The API caller is the
  // trader (local single-trader MVP); every write records TRADER_ORIGIN and persists. None of
  // these let an LLM sentence mutate the trader's belief; only explicit trader calls do.
  app.post("/api/thesis", async (req, reply) => {
    try {
      const out = await researchApp.createThesis(readThesisCreate(req.body));
      return reply.code(201).send(out);
    } catch (err) {
      handleError(reply, err);
    }
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
  app.get("/api/thesis/:ref", {
    handler: withErrors(async (req) => researchApp.getThesis((req.params as { ref: string }).ref)),
  });
  app.patch("/api/thesis/:ref", async (req, reply) => {
    try {
      const ref = (req.params as { ref: string }).ref;
      const out = await researchApp.updateThesis(ref, readThesisUpdate(req.body));
      return reply.code(200).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.delete("/api/thesis/:ref", async (req, reply) => {
    try {
      const ref = (req.params as { ref: string }).ref;
      const out = await researchApp.archiveThesis(ref);
      return reply.code(200).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.post("/api/thesis/:ref/status", async (req, reply) => {
    try {
      const ref = (req.params as { ref: string }).ref;
      const status = requireString(req.body, "status");
      const out = await researchApp.setThesisStatus(ref, status);
      return reply.code(200).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.post("/api/thesis/:ref/link-saved", async (req, reply) => {
    try {
      const ref = (req.params as { ref: string }).ref;
      const savedId = requireString(req.body, "savedId");
      const out = await researchApp.linkThesisSaved(ref, savedId);
      return reply.code(200).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.delete("/api/thesis/:ref/link-saved/:savedId", async (req, reply) => {
    try {
      const { ref, savedId } = req.params as { ref: string; savedId: string };
      const out = await researchApp.unlinkThesisSaved(ref, savedId);
      return reply.code(200).send(out);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.post("/api/thesis/:ref/link-research", async (req, reply) => {
    try {
      const ref = (req.params as { ref: string }).ref;
      const researchRef = requireString(req.body, "researchRef");
      const out = await researchApp.linkThesisResearch(ref, researchRef);
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
  // Saved workspace (Phase C): explicit SAVE/UNSAVE by the trader. POST/DELETE are the typed
  // SAVE/UNSAVE actions; the application layer resolves the target against the real graph and
  // only confirms after the write lands. Natural-language SAVE still runs through the LUI.
  // ------------------------------------------------------------------

  app.get("/api/saved", {
    handler: withErrors(async (req) => researchApp.listSaved(readSavedListOptions(req.query))),
  });
  app.get("/api/saved/:savedId", {
    handler: withErrors(async (req) => researchApp.getSaved((req.params as { savedId: string }).savedId)),
  });
  app.post("/api/saved", async (req, reply) => {
    try {
      const payload = readSavedCreate(req.body);
      const dto = await researchApp.createSaved(payload);
      return reply.code(201).send(dto);
    } catch (err) {
      handleError(reply, err);
    }
  });
  app.delete("/api/saved/:savedId", {
    handler: withErrors(async (req) => researchApp.deleteSaved((req.params as { savedId: string }).savedId)),
  });

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
