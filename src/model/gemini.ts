/**
 * Gemini adapter; the first concrete ModelProvider (M3 §2).
 *
 * Architectural basis:
 * - M3 §2/§3: Gemini is an implementation detail behind `ModelProvider`. Nothing outside this
 *   file knows Google's API shape. A future provider implements the same interface.
 * - M3 §2: credentials ONLY from environment (`GEMINI_API_KEY`), model via `GEMINI_MODEL`.
 *   The key must never appear in logs, errors, snapshots, test output, or provenance; all
 *   failure messages here are key-free by construction (the key is never interpolated).
 * - M3 §6: the adapter returns raw text; SCHEMA validation happens in provider.ts/schemas.ts
 *   (shared across providers) so every provider is held to the same validation gate.
 * - M3 §19/§20: failures are typed ModelFailure; provider unavailability never becomes a
 *   fabricated response, and never becomes research evidence.
 *
 * Transport: official Generative Language REST API (`generativelanguage.googleapis.com`,
 * `:generateContent`) via native fetch; matching the repo's zero-runtime-dependency setup.
 * `responseMimeType: application/json` is requested so the model returns JSON when supported.
 */

import {
  ModelFailure,
  requireEnvConfig,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResponse,
  type ModelUsage,
} from "./provider.js";

/**
 * Safe default model ID; the ONLY place in the codebase where a model name appears.
 * Overridable via GEMINI_MODEL (configuration layer resolves it; nothing else hardcodes a model).
 */
/**
 * Config-layer default (Phase 2 audit, 2026-09-14): free-tier per-model daily buckets are
 * per model ID, and gemini-3.6-flash's free tier is only ~20 requests/day. gemini-3.5-flash-lite
 * was verified live on the configured key (200 + valid structured JSON) as the smallest model
 * that reliably performs the LUI's structured tasks (classification, clarification, planning).
 * Override with GEMINI_MODEL; never hard-code model IDs elsewhere.
 */
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiOptions {
  /** Defaults to process.env; injectable for tests. Values are never persisted or logged. */
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable fetch (tests). Defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Hard cap on raw response size kept in memory (audit trail), bytes. */
  readonly maxRawBytes?: number;
  /** Retry budget for TRANSIENT provider conditions (5xx / 429 / network / timeout).
   *  Injected `sleep` keeps tests deterministic. Defaults: 3 attempts, 1.5s base backoff. */
  readonly transientRetry?: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> };
  /**
   * Defer credential validation from construction to FIRST MODEL USE (serverless resilience).
   * Default false: `npm run api` fails fast locally with the typed AUTH_FAILURE.
   * When true (production/Vercel), constructing the provider NEVER throws — a missing
   * GEMINI_API_KEY surfaces as the same typed AUTH_FAILURE ModelFailure when research
   * actually needs the model, so health/history routes stay up and the UI can render an
   * honest MODEL_FAILURE instead of an opaque 500. The message still names the variable,
   * never its value.
   */
  readonly deferCredentialCheck?: boolean;
}

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  readonly finishReason?: string;
}

interface GeminiPayload {
  readonly candidates?: readonly GeminiCandidate[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly usageMetadata?: { readonly promptTokenCount?: number; readonly candidatesTokenCount?: number; readonly totalTokenCount?: number };
}

export class GeminiProvider implements ModelProvider {
  readonly providerId = "google/gemini";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly deferCredentialCheck: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRawBytes: number;
  /** Bounded retry for TRANSIENT provider conditions (5xx / 429 / network), mirroring the
   *  M1 resilience law: retriable failures get a few spaced attempts, permanent ones do not.
   *  Self-contained here; the model layer does not import transport code. */
  private readonly transientRetry: { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> };

  constructor(options: GeminiOptions = {}) {
    // Credentials come ONLY from environment (M3 §2). By default validation is eager and
    // throws typed AUTH_FAILURE when absent (message names the variable, never its value).
    // With deferCredentialCheck the same validation runs lazily at first model use, so a
    // serverless instance with missing env vars serves health/history and reports MODEL_FAILURE
    // for research instead of crashing every route at construction.
    const env = options.env ?? process.env;
    if (options.deferCredentialCheck === true) {
      this.apiKey = env.GEMINI_API_KEY ?? "";
      this.modelId = env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    } else {
      const config = requireEnvConfig(env, "GEMINI_API_KEY", "GEMINI_MODEL", DEFAULT_GEMINI_MODEL);
      this.apiKey = config.apiKey;
      this.modelId = config.model;
    }
    this.deferCredentialCheck = options.deferCredentialCheck === true;    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRawBytes = options.maxRawBytes ?? 256_000;
    this.transientRetry = options.transientRetry ?? { attempts: 3, baseDelayMs: 1500 };
  }

  async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    if (typeof request.schemaName !== "string" || request.schemaName === "") {
      throw new ModelFailure("INVALID_OUTPUT", "structured request requires a schemaName", false);
    }

    // Lazy credential gate (deferCredentialCheck): the SAME typed AUTH_FAILURE the eager
    // constructor throws, raised at first model use. Non-retriable, key-free message.
    if (this.deferCredentialCheck && this.apiKey === "") {
      throw new ModelFailure(
        "AUTH_FAILURE",
        "GEMINI_API_KEY is not set. Configure it via environment (see .env.example). The provider cannot run without credentials.",
        false,
      );
    }

    // Bounded retry for TRANSIENT conditions only (the M1 resilience law applied to the model
    // layer): network/timeout failures and 5xx/429 map to retriable ModelFailure types, while
    // AUTH/INVALID/EMPTY are permanent and propagate on the first attempt. The LAST error is
    // rethrown unchanged, so every caller sees the same typed failure contract as before.
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
      system_instruction: { parts: [{ text: this.systemWithSchema(request) }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        ...(request.preferJson !== false ? { responseMimeType: "application/json" } : {}),
        temperature: 0.2, // research interpretation favors determinism over creativity
      },
    };

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_ROOT}/${encodeURIComponent(this.modelId)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key travels only in this header, over TLS. It is never written anywhere else.
          "x-goog-api-key": this.apiKey,
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
          ? `Gemini request timed out after ${timeoutMs}ms`
          : `Gemini request failed: ${error instanceof Error ? error.message : "network error"}`,
        true,
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      // Status-to-typed-failure mapping. Body text is sanitized: 4xx bodies can echo request
      // metadata, so we include only the status + a fixed category string, never the body.
      const category = this.mapStatus(response.status);
      // Quota discrimination (Phase 4 law): a 429 whose body names a PER-DAY quota bucket must
      // fail FAST and honestly; retrying for hours/days is not resilience, it is a stall. Only
      // rate-shape conditions (per-minute buckets, 5xx overload, network) are retriable. The
      // body is parsed for the quota id ONLY; message content still never enters the error.
      if (response.status === 429) {
        const dailyQuota = await this.isDailyQuotaExhaustion(response);
        if (dailyQuota) {
          throw new ModelFailure(
            "RATE_LIMITED",
            `Gemini free-tier daily quota is exhausted for ${this.modelId}; the bucket resets within 24h. Fail fast: nothing was executed and no state changed.`,
            false, // permanent for this request cycle; the caller must not retry-stall
          );
        }
      }
      throw new ModelFailure(category, `Gemini request failed with HTTP ${response.status} (${category})`, category !== "AUTH_FAILURE");
    }

    let payload: GeminiPayload;
    try {
      payload = (await response.json()) as GeminiPayload;
    } catch {
      throw new ModelFailure("INVALID_OUTPUT", "Gemini returned a non-JSON body", false);
    }

    if (payload.promptFeedback?.blockReason !== undefined) {
      throw new ModelFailure("EMPTY_OUTPUT", `Gemini blocked the prompt (${payload.promptFeedback.blockReason})`, false);
    }

    const candidate = payload.candidates?.[0];
    const raw = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .slice(0, this.maxRawBytes);

    if (raw.trim() === "") {
      throw new ModelFailure(
        "EMPTY_OUTPUT",
        `Gemini returned no content (finishReason: ${candidate?.finishReason ?? "unknown"})`,
        false,
      );
    }

    const usage: ModelUsage = {
      ...(payload.usageMetadata?.promptTokenCount !== undefined ? { promptTokens: payload.usageMetadata.promptTokenCount } : {}),
      ...(payload.usageMetadata?.candidatesTokenCount !== undefined ? { completionTokens: payload.usageMetadata.candidatesTokenCount } : {}),
      ...(payload.usageMetadata?.totalTokenCount !== undefined ? { totalTokens: payload.usageMetadata.totalTokenCount } : {}),
    };

    // NOTE: `raw` is returned unvalidated here; validateModelOutput(schema, response.raw) is the
    // mandatory next step for every caller (see schemas.ts). Providers never self-certify.
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

  /**
   * True when a 429 response's quota details identify a PER-DAY (or longer) exhaustion bucket
   * (`GenerateRequestsPerDay…`). Per-minute buckets, model-overload 5xx, and network errors
   * remain retriable. Consumes the (already-buffered) body; never surfaces body text.
   */
  private async isDailyQuotaExhaustion(response: Response): Promise<boolean> {
    try {
      const body = (await response.json()) as {
        error?: { details?: readonly { readonly "@type"?: string; readonly violations?: readonly { readonly quotaId?: string }[] }[] };
      };
      const violations = (body.error?.details ?? []).flatMap((d) => d.violations ?? []);
      return violations.some((v) => typeof v.quotaId === "string" && /PerDay|PerCalendar/i.test(v.quotaId));
    } catch {
      return false; // unparseable body → treat as ordinary rate limiting (retriable)
    }
  }

  private mapStatus(status: number): ModelFailure["type"] {
    if (status === 401 || status === 403) return "AUTH_FAILURE";
    if (status === 429) return "RATE_LIMITED";
    if (status === 400 || status === 404 || status === 422) return "INVALID_OUTPUT";
    if (status >= 500) return "PROVIDER_UNAVAILABLE";
    return "UNKNOWN";
  }
}

/** Wall-clock helper exposed for tests that inject deterministic clocks. */
export function elapsedSince(started: number): number {
  return Date.now() - started;
}
