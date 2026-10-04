/**
 * ModelFallbackProvider; typed model failover across providers (model-fallback phases 14–18).
 *
 * Laws (mandate §14–§18):
 * - TYPED FALLBACK ONLY: the fallback triggers on TECHNICAL conditions (PROVIDER_UNAVAILABLE,
 *   RATE_LIMITED, TIMEOUT, INVALID_OUTPUT, EMPTY_OUTPUT, UNKNOWN). A VALID SAFETY REFUSAL
 *   (Gemini blockReason → EMPTY_OUTPUT with a block message) is NOT a technical outage and is
 *   never bypassed with another model (mandate §14).
 * - BOUNDED: one attempt per provider per request; never cycles; never retries indefinitely.
 * - VALIDATION PARITY: raw output goes through the SAME validateModelOutput gate (owned by
 *   callers/schemas.ts) — the facade never self-certifies either provider.
 * - PROVENANCE (§18): attemptedModels / selectedModel / failureReason recorded internally;
 *   diagnostics can expose it, the default UI does not.
 * - CIRCUIT BREAKER (§17): consecutive technical failures trip a temporary cooldown that
 *   SKIPS the failing provider (bounded, in-process, recovers automatically). One failure
 *   never permanently disables a provider. No distributed state.
 * - NON-AUTONOMY (§16): the facade executes NOTHING; it only routes structured requests.
 */
import {
  ModelFailure,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResponse,
} from "./provider.js";
import { FALLBACK_BUDGET_FRACTION, limitForProvider } from "./request-budget.js";

/**
 * Failure types that represent technical outages (never genuine safety refusals).
 *
 * PAYLOAD_TOO_LARGE is here under a specific, narrow law: the payload was rejected because the
 * provider accepts less than we serialized. The request CONTENT is not wrong, and the provider
 * is not down — but resending the IDENTICAL bytes to the next provider reproduces the same
 * rejection whenever the next provider's limit is also below the payload. So a 413 is
 * fallback-eligible AND arms a reduced budget for every subsequent attempt: the next provider
 * gets the same research question with strictly less context, compacted deterministically, never
 * the same oversized payload again.
 */
const TECHNICAL_FAILURES: ReadonlySet<string> = new Set([
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "TIMEOUT",
  "INVALID_OUTPUT",
  "EMPTY_OUTPUT",
  "PAYLOAD_TOO_LARGE",
  "UNKNOWN",
]);

/** True when a ModelFailure is a technical outage (fallback-eligible). */
export function isTechnicalModelFailure(error: unknown): boolean {
  return error instanceof ModelFailure && TECHNICAL_FAILURES.has(error.type);
}

/**
 * Distinguishes a genuine safety refusal (prompt blocked by the provider's safety system)
 * from an empty technical response. Safety refusals must NOT be bypassed (mandate §14).
 */
export function isSafetyRefusal(error: unknown): error is ModelFailure {
  return error instanceof ModelFailure && error.type === "EMPTY_OUTPUT" && /blocked|safety/i.test(error.message);
}

export interface ModelFallbackOptions {
  /** Ordered provider chain; first entry is primary. Minimum one. */
  readonly providers: readonly ModelProvider[];
  /** Consecutive technical failures before a provider enters cooldown (§17). Default 3. */
  readonly breakerThreshold?: number;
  /** Cooldown duration in ms before the provider is retried (§17). Default 60s. */
  readonly cooldownMs?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
  lastFailureType?: string;
  lastLatencyMs?: number;
}

export class ModelFallbackProvider implements ModelProvider {
  readonly providerId = "model-fallback";
  readonly modelId: string;

  private readonly providers: readonly ModelProvider[];
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly breaker = new Map<string, BreakerState>();

  constructor(options: ModelFallbackOptions) {
    if (options.providers.length === 0) throw new Error("ModelFallbackProvider requires at least one provider");
    this.providers = options.providers;
    this.threshold = options.breakerThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.modelId = options.providers[0]!.modelId;
  }

  /** Lightweight health state per provider (§17): success/failure counts and cooldown state. */
  health(providerId: string): { state: "closed" | "open"; consecutiveFailures: number; lastFailureType?: string; lastLatencyMs?: number } {
    const s = this.breaker.get(providerId);
    const open = s !== undefined && s.openUntil > this.now();
    return {
      state: open ? "open" : "closed",
      consecutiveFailures: s?.consecutiveFailures ?? 0,
      ...(s?.lastFailureType !== undefined ? { lastFailureType: s.lastFailureType } : {}),
      ...(s?.lastLatencyMs !== undefined ? { lastLatencyMs: s.lastLatencyMs } : {}),
    };
  }

  /** Safety-refusal observability (mandate §14): refusals are surfaced, never bypassed. */
  get lastSafetyRefusal(): { providerId: string; message: string } | undefined {
    return this.lastRefusal;
  }
  private lastRefusal: { providerId: string; message: string } | undefined;

  async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    const attemptedModels: { providerId: string; modelId: string; failureType?: string; failureReason?: string }[] = [];
    const candidates = this.providers.filter((p) => {
      const s = this.breaker.get(p.providerId);
      return !(s !== undefined && s.openUntil > this.now());
    });
    if (candidates.length === 0) {
      // All providers cooling down: fail with the last known failure type rather than stall.
      throw new ModelFailure("PROVIDER_UNAVAILABLE", "all model providers are temporarily in cooldown after repeated failures", true);
    }

    let lastError: unknown;
    // PAYLOAD_TOO_LARGE DEGRADATION: once a provider has rejected the request for size, every
    // later attempt for THIS request runs on a reduced, explicitly-bounded budget. The research
    // question, the system contract and the output schema are carried over unchanged; only
    // optional context is compacted away, deterministically and in-band. Two attempts therefore
    // never put the same bytes on the wire.
    //
    // The reduced ceiling is a fraction of the ATTEMPTING provider's own limit (not the failing
    // provider's): the budget a request is held to is the budget of the provider it is going to,
    // so the reduction is meaningful even when the chain goes from a large-limit provider to a
    // small-limit one. Each further 413 tightens it again, so degradation is bounded and monotone.
    let degraded = false;
    let reducedLimitBytes: number | undefined;
    let fallbackReason: string | undefined;
    for (const provider of candidates) {
      const attemptLimit = degraded
        ? Math.min(
            limitForProvider(provider.providerId) * FALLBACK_BUDGET_FRACTION,
            reducedLimitBytes ?? Number.POSITIVE_INFINITY,
          )
        : undefined;
      const attemptRequest: StructuredRequest = attemptLimit !== undefined
        ? { ...request, limitBytes: Math.floor(attemptLimit), ...(fallbackReason !== undefined ? { fallbackReason } : {}) }
        : request;
      const started = this.now();
      try {
        const response = await provider.structured<T>(attemptRequest);
        this.recordSuccess(provider.providerId, this.now() - started);
        // Provenance (§18) rides on the response for diagnostics when fallback actually happened.
        return (attemptedModels.length > 0
          ? { ...response, modelId: response.modelId, ...(response as { fallbackProvenance?: unknown }).fallbackProvenance !== undefined ? {} : { fallbackProvenance: { attemptedModels, selectedModel: `${provider.providerId}/${response.modelId}` } } }
          : response) as StructuredResponse<T>;
      } catch (error) {
        lastError = error;
        const latency = this.now() - started;
        if (error instanceof ModelFailure && error.type === "AUTH_FAILURE") {
          // Missing/invalid credentials: skip this provider for the rest of THIS request and
          // keep the message key-free, but do not trip the breaker (config is not an outage).
          attemptedModels.push({ providerId: provider.providerId, modelId: provider.modelId, failureType: "AUTH_FAILURE", failureReason: "credentials not configured" });
          continue;
        }
        if (isSafetyRefusal(error)) {
          this.lastRefusal = { providerId: provider.providerId, message: error.message };
          throw error; // §14: a genuine safety refusal is never bypassed with another model
        }
        if (error instanceof ModelFailure && error.type === "PAYLOAD_TOO_LARGE") {
          // Size rejection, not an outage: the next attempt keeps the question and loses context.
          const nextLimit = Math.floor(limitForProvider(provider.providerId) * FALLBACK_BUDGET_FRACTION);
          fallbackReason = `${provider.providerId} rejected the serialized request for size (HTTP 413); the next attempt is budgeted to at most ${nextLimit} bytes with compacted context instead of resending the same payload`;
          reducedLimitBytes = reducedLimitBytes === undefined ? nextLimit : Math.min(reducedLimitBytes, nextLimit);
          degraded = true;
        }
        attemptedModels.push({ providerId: provider.providerId, modelId: provider.modelId, ...(error instanceof ModelFailure ? { failureType: error.type, failureReason: error.message } : { failureReason: String(error) }) });
        this.recordFailure(provider.providerId, error, latency);
      }
    }
    // Every candidate failed technically: rethrow the PRIMARY's failure with the full trail.
    throw lastError instanceof ModelFailure
      ? new ModelFailure(lastError.type, `${lastError.message} (attempted models: ${attemptedModels.map((a) => `${a.providerId}/${a.modelId}${a.failureType !== undefined ? `:${a.failureType}` : ""}`).join(", ")})`, lastError.retriable)
      : (lastError ?? new ModelFailure("UNKNOWN", "model fallback exhausted", false));
  }

  private recordSuccess(providerId: string, latencyMs: number): void {
    this.breaker.set(providerId, { consecutiveFailures: 0, openUntil: 0, lastLatencyMs: latencyMs });
  }

  private recordFailure(providerId: string, error: unknown, latencyMs: number): void {
    const s = this.breaker.get(providerId) ?? { consecutiveFailures: 0, openUntil: 0 };
    const failureType = error instanceof ModelFailure ? error.type : "UNKNOWN";
    const consecutive = s.consecutiveFailures + 1;
    this.breaker.set(providerId, {
      consecutiveFailures: consecutive,
      openUntil: consecutive >= this.threshold ? this.now() + this.cooldownMs : 0,
      lastFailureType: failureType,
      lastLatencyMs: latencyMs,
    });
  }
}
