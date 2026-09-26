/**
 * Groq adapter; the second concrete ModelProvider (model-fallback phase 13).
 *
 * Selection rationale (researched 2026-09-18, docs/integrations/heurist.md §7 + provider
 * comparison): Groq is OpenAI-compatible (chat/completions with `response_format:
 * json_object`), free-tier friendly with commercial use allowed, and — most importantly —
 * an INDEPENDENT failure domain from Google (a Gemini quota/outage cannot take Groq down).
 * Its job is the model-fallback role: LUI classification, target resolution, parameter
 * extraction, planning (mandate §13). It never independently answers research questions.
 *
 * Laws (identical to gemini.ts):
 * - M3 §2: credentials ONLY from environment (`GROQ_API_KEY`, model via `GROQ_MODEL`).
 *   The key never appears in logs, errors, snapshots, or provenance; messages are key-free.
 * - M3 §6: raw text returned unvalidated; `validateModelOutput` (shared) is the gate.
 * - M3 §19/§20: failures are typed ModelFailure; never fabricated output.
 * - Serverless resilience: deferred credential validation (construction never throws; a
 *   missing key becomes the typed AUTH_FAILURE at first model use).
 */
import {
  ModelFailure,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResponse,
  type ModelUsage,
} from "./provider.js";

/**
 * Default model: openai/gpt-oss-120b (Groq free tier, structured JSON capable,
 * commercial use allowed). Override with GROQ_MODEL; this is the ONLY place a Groq
 * model id appears. Catalog churn is a real risk (providers prune free catalogs
 * without notice) — the model-fallback facade treats model-404 as a typed failure
 * and GROQ_MODEL lets operators repoint without code changes.
 *
 * HISTORY (catalog churn is real, VERIFIED LIVE 2026-09-19): llama-3.3-70b-versatile
 * was Groq's recommended structured-JSON model when integrated; Groq decommissioned it
 * on 2026-08-16 (deprecations page) recommending openai/gpt-oss-120b — every request
 * 404'd and, when Gemini simultaneously rate-limits, interpretation died. The default
 * now tracks Groq's recommended production replacement.
 */
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GroqOptions {
  /** Defaults to process.env; injectable for tests. Values are never persisted or logged. */
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly maxRawBytes?: number;
  /** Retry budget for TRANSIENT conditions (429 rate-shape / 5xx / network / timeout). */
  readonly transientRetry?: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> };
  /** Defer credential validation to first model use (serverless-safe). Default false. */
  readonly deferCredentialCheck?: boolean;
}

interface ChatChoice {
  readonly message?: { readonly content?: string | null };
  readonly finish_reason?: string;
}

interface ChatPayload {
  readonly choices?: readonly ChatChoice[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly total_tokens?: number };
  readonly error?: { readonly message?: string };
}

export class GroqProvider implements ModelProvider {
  readonly providerId = "groq";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly deferCredentialCheck: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRawBytes: number;
  private readonly transientRetry: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> };

  constructor(options: GroqOptions = {}) {
    const env = options.env ?? process.env;
    if (options.deferCredentialCheck === true) {
      this.apiKey = env.GROQ_API_KEY ?? "";
      this.modelId = env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
    } else {
      if (typeof env.GROQ_API_KEY !== "string" || env.GROQ_API_KEY === "") {
        throw new ModelFailure(
          "AUTH_FAILURE",
          "GROQ_API_KEY is not set. Configure it via environment (see .env.example). The provider cannot run without credentials.",
          false,
        );
      }
      this.apiKey = env.GROQ_API_KEY;
      this.modelId = env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
    }
    this.deferCredentialCheck = options.deferCredentialCheck === true;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRawBytes = options.maxRawBytes ?? 256_000;
    this.transientRetry = options.transientRetry ?? { attempts: 2, baseDelayMs: 1200 };
  }

  async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    if (typeof request.schemaName !== "string" || request.schemaName === "") {
      throw new ModelFailure("INVALID_OUTPUT", "structured request requires a schemaName", false);
    }
    if (this.deferCredentialCheck && this.apiKey === "") {
      throw new ModelFailure(
        "AUTH_FAILURE",
        "GROQ_API_KEY is not set. Configure it via environment (see .env.example). The provider cannot run without credentials.",
        false,
      );
    }
    const { attempts, baseDelayMs, sleep } = this.transientRetry;
    let lastError: unknown;
    for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
      try {
        return await this.structuredOnce<T>(request);
      } catch (error) {
        lastError = error;
        const retriable = error instanceof ModelFailure && error.retriable === true;
        if (!retriable || attempt === attempts) break;
        const delay = baseDelayMs * 2 ** (attempt - 1);
        if (sleep !== undefined) await sleep(delay);
        else await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  private async structuredOnce<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    const body = {
      model: this.modelId,
      messages: [
        { role: "system" as const, content: this.systemWithSchema(request) },
        { role: "user" as const, content: request.prompt },
      ],
      ...(request.preferJson !== false ? { response_format: { type: "json_object" as const } } : {}),
      temperature: 0.2, // research interpretation favors determinism over creativity
    };

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key travels only in this header, over TLS. It is never written anywhere else.
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ModelFailure(
        aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
        aborted
          ? `Groq request timed out after ${timeoutMs}ms`
          : `Groq request failed: ${error instanceof Error ? error.message : "network error"}`,
        true,
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      // Body text is sanitized: only the status + fixed category, never response text
      // (4xx bodies can echo request metadata; error bodies are never surfaced raw).
      const category = this.mapStatus(response.status);
      const detail = category === "PAYLOAD_TOO_LARGE"
        ? `Groq request failed with HTTP 413 (PAYLOAD_TOO_LARGE): the request body exceeds the provider's accepted size. This is a request-size condition, not a provider outage; retrying the identical request will not help.`
        : `Groq request failed with HTTP ${response.status} (${category})`;
      throw new ModelFailure(category, detail, category === "RATE_LIMITED" || category === "PROVIDER_UNAVAILABLE");
    }

    let payload: ChatPayload;
    try {
      payload = (await response.json()) as ChatPayload;
    } catch {
      throw new ModelFailure("INVALID_OUTPUT", "Groq returned a non-JSON body", false);
    }

    const candidate = payload.choices?.[0];
    const raw = (candidate?.message?.content ?? "").slice(0, this.maxRawBytes);
    if (raw.trim() === "") {
      throw new ModelFailure(
        "EMPTY_OUTPUT",
        `Groq returned no content (finishReason: ${candidate?.finish_reason ?? "unknown"})`,
        false,
      );
    }

    const usage: ModelUsage = {
      ...(payload.usage?.prompt_tokens !== undefined ? { promptTokens: payload.usage.prompt_tokens } : {}),
      ...(payload.usage?.completion_tokens !== undefined ? { completionTokens: payload.usage.completion_tokens } : {}),
      ...(payload.usage?.total_tokens !== undefined ? { totalTokens: payload.usage.total_tokens } : {}),
    };

    // NOTE: `raw` is returned unvalidated; validateModelOutput(schema, response.raw) remains
    // the mandatory next step for every caller. Providers never self-certify.
    return {
      data: raw as unknown as T,
      raw,
      schemaName: request.schemaName,
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
      modelId: this.modelId,
    };
  }

  private systemWithSchema(request: StructuredRequest): string {
    return [
      request.system,
      "",
      `OUTPUT CONTRACT: respond with exactly one JSON object conforming to schema "${request.schemaName}".`,
      `OPTIONAL FIELDS: when a field is optional and you have no value for it, OMIT the key entirely; never send null, never send an empty string in its place.`,
      `REQUIRED LIST FIELDS: always include every required key; when a list has no items, send an empty array [] rather than omitting the key.`,
      `Schema: ${request.schemaDescription}`,
      "No prose outside the JSON object. No markdown fences.",
    ].join("\n");
  }

  private mapStatus(status: number): ModelFailure["type"] {
    if (status === 401 || status === 403) return "AUTH_FAILURE";
    if (status === 429) return "RATE_LIMITED";
    // HTTP 413 (Request Entity Too Large) is a REQUEST-SIZE condition, not an outage: the
    // request body (system + research context) exceeded the provider's accepted size. It is
    // typed distinctly so the failure is diagnosable and never retried as a transient error.
    if (status === 413) return "PAYLOAD_TOO_LARGE";
    if (status === 400 || status === 404 || status === 422) return "INVALID_OUTPUT";
    if (status >= 500) return "PROVIDER_UNAVAILABLE";
    return "UNKNOWN";
  }
}
