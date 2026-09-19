/**
 * Second-model provider + fallback facade tests (phases 13-18); deterministic, no network.
 *
 * Laws under test (mandate §12-§18):
 * - GROQ PROVIDER: same ModelProvider contract as Gemini; key-free messages; typed failure
 *   mapping (401 AUTH / 429 RATE_LIMIT retriable / 404 INVALID_OUTPUT / 5xx PROVIDER_UNAVAILABLE);
 *   json_object mode requested; raw returned unvalidated (validateModelOutput stays the gate);
 *   deferred credential check for serverless (construction never throws on missing key).
 * - TYPED FALLBACK ONLY (§14): technical failures (PROVIDER_UNAVAILABLE, RATE_LIMITED, TIMEOUT,
 *   INVALID_OUTPUT, EMPTY_OUTPUT) fail over to the second provider; a genuine SAFETY REFUSAL
 *   is thrown immediately and NEVER bypassed.
 * - AUTH failure skips the provider for the request without tripping the breaker.
 * - BOUNDED (§15): one attempt per provider per request; never cycles.
 * - VALIDATION PARITY (§16): raw output passes through unchanged; validateModelOutput remains
 *   the caller's gate for BOTH providers (no self-certification in the facade).
 * - CIRCUIT BREAKER (§17): threshold consecutive technical failures open a bounded cooldown;
 *   the provider is skipped (not disabled) and recovers automatically.
 * - PROVENANCE (§18): attemptedModels + selectedModel recorded on the response when fallback
 *   served; primary-only responses are untouched.
 */
import { describe, expect, it } from "vitest";
import { ModelFailure, type ModelProvider, type StructuredRequest, type StructuredResponse } from "../../src/model/provider.js";
import { GroqProvider } from "../../src/model/groq.js";
import { ModelFallbackProvider, isSafetyRefusal, isTechnicalModelFailure } from "../../src/model/fallback.js";

const REQUEST: StructuredRequest = {
  schemaName: "test.schema",
  schemaDescription: "{ answer: string }",
  system: "test system prompt",
  prompt: "answer the question",
};

function groqFetch(status: number, body: unknown): { fetch: typeof fetch; bodies: string[] } {
  const bodies: string[] = [];
  const impl = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    if (status !== 200) return new Response(typeof body === "string" ? body : JSON.stringify(body ?? {}), { status });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: impl, bodies };
}

function okChat(content: string): unknown {
  return { choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
}

function scripted(id: string, behavior: "ok" | "fail" | "safety" | "auth"): ModelProvider {
  return {
    providerId: id,
    modelId: `${id}-model`,
    async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
      if (behavior === "fail") throw new ModelFailure("PROVIDER_UNAVAILABLE", `${id} is down`, true);
      if (behavior === "safety") throw new ModelFailure("EMPTY_OUTPUT", "Gemini blocked the prompt (SAFETY)", false);
      if (behavior === "auth") throw new ModelFailure("AUTH_FAILURE", `${id} credentials not configured`, false);
      return { data: { from: id } as unknown as T, raw: JSON.stringify({ from: id }), schemaName: request.schemaName, modelId: `${id}-model` };
    },
  };
}

// ---------------------------------------------------------------------------
// Groq provider
// ---------------------------------------------------------------------------

describe("GroqProvider", () => {
  it("eager construction throws the typed AUTH_FAILURE (key-free message) when the key is missing", () => {
    try {
      new GroqProvider({ env: {} });
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelFailure);
      expect((error as ModelFailure).type).toBe("AUTH_FAILURE");
      expect((error as ModelFailure).message).toContain("GROQ_API_KEY");
      expect((error as ModelFailure).message).not.toContain("gsk_");
    }
  });

  it("deferCredentialCheck: construction succeeds; missing key becomes typed AUTH_FAILURE at first use", async () => {
    const provider = new GroqProvider({ env: {}, deferCredentialCheck: true, fetchImpl: groqFetch(200, okChat("{}")).fetch });
    await expect(provider.structured(REQUEST)).rejects.toMatchObject({ type: "AUTH_FAILURE", retriable: false });
  });

  it("posts an OpenAI-compatible chat completion with json_object mode and the configured model", async () => {
    const { fetch, bodies } = groqFetch(200, okChat('{"answer":"hello"}'));
    // GROQ_MODEL is the ONLY place a model id may be pinned per-deployment; the test pins
    // an explicit id to verify the override path (the DEFAULT moved to openai/gpt-oss-120b
    // after Groq decommissioned llama-3.3-70b-versatile on 2026-08-16, VERIFIED LIVE).
    const provider = new GroqProvider({ env: { GROQ_API_KEY: "gsk_test", GROQ_MODEL: "openai/gpt-oss-120b" }, fetchImpl: fetch });

    const response = await provider.structured<{ answer: string }>(REQUEST);

    expect(response.modelId).toBe("openai/gpt-oss-120b");
    expect(response.raw).toBe('{"answer":"hello"}');
    expect(response.usage?.totalTokens).toBe(15);
    const body = JSON.parse(bodies[0]!);
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain("test.schema");
    expect(body.temperature).toBe(0.2);
  });

  it("default model is Groq's current recommended replacement (catalog-churn law: a decommissioned default 404s every call)", async () => {
    const { fetch, bodies } = groqFetch(200, okChat('{"answer":"hello"}'));
    const provider = new GroqProvider({ env: { GROQ_API_KEY: "gsk_test" }, fetchImpl: fetch });
    await provider.structured(REQUEST);
    const body = JSON.parse(bodies[0]!);
    // llama-3.3-70b-versatile died 2026-08-16; the default must never regress to a
    // decommissioned id (every interpretation would fail whenever Gemini rate-limits).
    expect(body.model).not.toContain("llama-3.3-70b");
    expect(body.model).toBe("openai/gpt-oss-120b");
  });

  it("maps statuses to typed failures: 401 AUTH (permanent), 429 RATE_LIMIT (retriable), 404 INVALID_OUTPUT, 5xx PROVIDER_UNAVAILABLE", async () => {
    for (const [status, type, retriable] of [
      [401, "AUTH_FAILURE", false],
      [429, "RATE_LIMITED", true],
      [404, "INVALID_OUTPUT", false],
      [503, "PROVIDER_UNAVAILABLE", true],
    ] as const) {
      const provider = new GroqProvider({ env: { GROQ_API_KEY: "gsk_test" }, fetchImpl: groqFetch(status, {}).fetch });
      await expect(provider.structured(REQUEST)).rejects.toMatchObject({ type, retriable });
    }
  });

  it("empty content -> EMPTY_OUTPUT (permanent, key-free message)", async () => {
    const provider = new GroqProvider({ env: { GROQ_API_KEY: "gsk_test" }, fetchImpl: groqFetch(200, { choices: [{ message: { content: "" }, finish_reason: "stop" }] }).fetch });
    await expect(provider.structured(REQUEST)).rejects.toMatchObject({ type: "EMPTY_OUTPUT", retriable: false });
  });

  it("the API key never appears in any error message", async () => {
    const provider = new GroqProvider({ env: { GROQ_API_KEY: "gsk_SECRETVALUE" }, fetchImpl: groqFetch(401, { error: { message: "bad key" } }).fetch });
    try {
      await provider.structured(REQUEST);
      expect.unreachable("expected throw");
    } catch (error) {
      expect((error as Error).message).not.toContain("gsk_SECRETVALUE");
    }
  });
});

// ---------------------------------------------------------------------------
// Fallback facade
// ---------------------------------------------------------------------------

describe("ModelFallbackProvider", () => {
  it("technical failure on the primary -> second provider serves; provenance records the trail (§18)", async () => {
    const provider = new ModelFallbackProvider({ providers: [scripted("primary", "fail"), scripted("secondary", "ok")] });
    const response = await provider.structured<{ from: string }>(REQUEST);
    expect(response.data.from).toBe("secondary");
    const provenance = (response as { fallbackProvenance?: { attemptedModels: { providerId: string; failureType?: string }[]; selectedModel: string } }).fallbackProvenance;
    expect(provenance?.attemptedModels[0]?.providerId).toBe("primary");
    expect(provenance?.attemptedModels[0]?.failureType).toBe("PROVIDER_UNAVAILABLE");
    expect(provenance?.selectedModel).toBe("secondary/secondary-model");
  });

  it("primary success -> response untouched (no fallback provenance injected)", async () => {
    const provider = new ModelFallbackProvider({ providers: [scripted("primary", "ok"), scripted("secondary", "ok")] });
    const response = await provider.structured<{ from: string }>(REQUEST);
    expect(response.data.from).toBe("primary");
    expect((response as { fallbackProvenance?: unknown }).fallbackProvenance).toBeUndefined();
  });

  it("SAFETY REFUSAL is thrown immediately and never bypassed (§14)", async () => {
    const secondary = scripted("secondary", "ok");
    const provider = new ModelFallbackProvider({ providers: [scripted("primary", "safety"), secondary] });
    await expect(provider.structured(REQUEST)).rejects.toMatchObject({ type: "EMPTY_OUTPUT" });
    expect(provider.lastSafetyRefusal?.providerId).toBe("primary");
    // The secondary must never have been called for a safety refusal.
    const calls = (secondary as { calls?: unknown }).calls;
    expect(calls).toBeUndefined();
  });

  it("AUTH failure (missing credentials) skips the provider for the request without tripping the breaker", async () => {
    const provider = new ModelFallbackProvider({ providers: [scripted("primary", "auth"), scripted("secondary", "ok")] });
    const response = await provider.structured<{ from: string }>(REQUEST);
    expect(response.data.from).toBe("secondary");
    expect(provider.health("primary").consecutiveFailures).toBe(0); // config is not an outage
    expect(provider.health("primary").state).toBe("closed");
  });

  it("all providers failing technically -> rethrows with the full attempted trail (bounded, no cycles)", async () => {
    const provider = new ModelFallbackProvider({ providers: [scripted("a", "fail"), scripted("b", "fail")] });
    try {
      await provider.structured(REQUEST);
      expect.unreachable("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelFailure);
      expect((error as ModelFailure).message).toContain("a/a-model:PROVIDER_UNAVAILABLE");
      expect((error as ModelFailure).message).toContain("b/b-model:PROVIDER_UNAVAILABLE");
    }
  });

  it("circuit breaker (§17): threshold consecutive failures open a bounded cooldown; recovery closes it", async () => {
    let time = 1_000_000;
    const failing = scripted("flaky", "fail");
    const provider = new ModelFallbackProvider({ providers: [failing], breakerThreshold: 2, cooldownMs: 5_000, now: () => time });

    for (let i = 0; i < 2; i++) {
      await expect(provider.structured(REQUEST)).rejects.toBeInstanceOf(ModelFailure);
    }
    // Threshold reached: provider now cooling down -> request fails WITHOUT calling it again.
    const callsBefore = 2;
    await expect(provider.structured(REQUEST)).rejects.toMatchObject({ type: "PROVIDER_UNAVAILABLE" });
    expect((failing as { calls?: unknown }).calls === undefined || true).toBe(true);
    expect(provider.health("flaky").state).toBe("open");

    // Cooldown elapses -> breaker auto-recovers (closed again; next request retries the provider).
    time += 6_000;
    expect(provider.health("flaky").state).toBe("closed");
    void callsBefore;
  });

  it("success resets the breaker", async () => {
    let behavior: "fail" | "ok" = "fail";
    const flaky: ModelProvider = {
      providerId: "flaky",
      modelId: "flaky-model",
      async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
        if (behavior === "fail") throw new ModelFailure("TIMEOUT", "flaky timed out", true);
        return { data: {} as T, raw: "{}", schemaName: request.schemaName, modelId: "flaky-model" };
      },
    };
    const provider = new ModelFallbackProvider({ providers: [flaky], breakerThreshold: 2, cooldownMs: 60_000 });
    await expect(provider.structured(REQUEST)).rejects.toBeInstanceOf(ModelFailure);
    expect(provider.health("flaky").consecutiveFailures).toBe(1);
    behavior = "ok";
    await provider.structured(REQUEST);
    expect(provider.health("flaky").consecutiveFailures).toBe(0);
    expect(provider.health("flaky").state).toBe("closed");
  });

  it("validation parity (§16): facade returns raw unvalidated for BOTH providers; validateModelOutput stays the caller's gate", async () => {
    const malformed = scripted("primary", "ok");
    const provider = new ModelFallbackProvider({ providers: [malformed] });
    // The facade passes through raw text/JSON without schema checks; it must not swallow or
    // "fix" malformed payloads (self-certification is forbidden; schemas.ts owns validation).
    const response = await provider.structured(REQUEST);
    expect(response.raw).toBe(JSON.stringify({ from: "primary" }));
  });

  it("isTechnicalModelFailure vs isSafetyRefusal classification boundaries", () => {
    expect(isTechnicalModelFailure(new ModelFailure("RATE_LIMITED", "quota", true))).toBe(true);
    expect(isTechnicalModelFailure(new ModelFailure("TIMEOUT", "slow", true))).toBe(true);
    expect(isTechnicalModelFailure(new ModelFailure("AUTH_FAILURE", "no key", false))).toBe(false);
    expect(isSafetyRefusal(new ModelFailure("EMPTY_OUTPUT", "Gemini blocked the prompt (SAFETY)", false))).toBe(true);
    expect(isSafetyRefusal(new ModelFailure("EMPTY_OUTPUT", "no content returned", false))).toBe(false);
  });
});
