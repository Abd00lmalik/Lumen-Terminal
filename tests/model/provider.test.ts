import { describe, expect, it } from "vitest";
import {
  validateModelOutput, extractJson, requireEnvConfig, ModelFailure, ModelValidationError, redactCredential,
  type OutputSchema,
} from "../../src/model/provider.js";
import { GeminiProvider } from "../../src/model/gemini.js";

const schema: OutputSchema = {
  name: "test.schema",
  properties: { name: "string", count: "number", tags: "string[]" },
};

describe("validateModelOutput (M3 §6 — never blindly trust model JSON)", () => {
  it("accepts schema-conformant JSON", () => {
    const { data } = validateModelOutput<{ name: string; count: number; tags: string[] }>(schema, '{"name":"a","count":1,"tags":["x"]}');
    expect(data.name).toBe("a");
    expect(data.tags).toEqual(["x"]);
  });

  it("extracts JSON from fenced and prose-wrapped responses", () => {
    expect(() => validateModelOutput(schema, '```json\n{"name":"a","count":1,"tags":[]}\n```')).not.toThrow();
    expect(() => validateModelOutput(schema, 'Here is the result: {"name":"a","count":1,"tags":[]} — done.')).not.toThrow();
  });

  it("rejects missing properties", () => {
    expect(() => validateModelOutput(schema, '{"name":"a"}')).toThrow(ModelValidationError);
  });

  it("rejects wrong types", () => {
    expect(() => validateModelOutput(schema, '{"name":"a","count":"1","tags":[]}')).toThrow(ModelValidationError);
    expect(() => validateModelOutput(schema, '{"name":"a","count":1,"tags":["x",2]}')).toThrow(ModelValidationError);
  });

  it("rejects unexpected properties (strict) and non-objects", () => {
    expect(() => validateModelOutput(schema, '{"name":"a","count":1,"tags":[],"extra":true}')).toThrow(/unexpected property/);
    expect(() => validateModelOutput(schema, '"just a string"')).toThrow(ModelFailure);
    expect(() => validateModelOutput(schema, "no json at all")).toThrow(ModelFailure);
  });

  // Flash-Lite law (M6+ reliability phase): small models omit or null a REQUIRED list field
  // when it is empty ("no clarifying questions" → no `questions` key). For list guards the only
  // honest reading is "none" → normalize to []. Scalars stay strictly required.
  it("normalizes absent/null required list fields to empty arrays; scalars stay required", () => {
    const listSchema = { name: "t.list", properties: { name: "string", tags: "string[]", count: "number" } } as const;
    const normalized = validateModelOutput<{ name: string; tags: string[]; count: number }>(listSchema, '{"name":"a","count":1}');
    expect(normalized.data.tags).toEqual([]);
    expect(validateModelOutput<{ tags: string[] }>({ name: "t.n", properties: { tags: "string[]" } }, '{"tags":null}').data.tags).toEqual([]);
    expect(() => validateModelOutput(listSchema, '{"name":"a","tags":[]}')).toThrow(/count: expected number/);
  });
});

describe("extractJson", () => {
  it("handles fenced blocks with language tags and bare objects in prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prefix {"a":1} suffix')).toEqual({ a: 1 });
  });
});

describe("requireEnvConfig (M3 §2 — env-only credentials)", () => {
  it("throws typed AUTH_FAILURE with a key-free message when GEMINI_API_KEY is absent", () => {
    try {
      expect(() => requireEnvConfig({}, "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-x")).toThrow(ModelFailure);
    } finally {
      // nothing to clean
    }
    try {
      requireEnvConfig({}, "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-x");
    } catch (error) {
      expect((error as ModelFailure).type).toBe("AUTH_FAILURE");
      expect((error as ModelFailure).message).toContain("GEMINI_API_KEY");
      expect((error as ModelFailure).retriable).toBe(false);
    }
  });

  it("uses GEMINI_MODEL override when set, default otherwise", () => {
    expect(requireEnvConfig({ GEMINI_API_KEY: "k" }, "GEMINI_API_KEY", "GEMINI_MODEL", "default-m").model).toBe("default-m");
    expect(requireEnvConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "custom-m" }, "GEMINI_API_KEY", "GEMINI_MODEL", "default-m").model).toBe("custom-m");
  });

  it("redactCredential never returns the value", () => {
    expect(redactCredential("secret-value")).toBe("[redacted]");
  });
});

describe("GeminiProvider construction (M3 §2 — no key required to run the suite)", () => {
  it("throws typed AUTH_FAILURE at construction when env lacks the key", () => {
    try {
      expect(() => new GeminiProvider({ env: {} })).toThrow(ModelFailure);
    } finally {
      // asserted below
    }
    try {
      new GeminiProvider({ env: {} });
    } catch (error) {
      expect((error as ModelFailure).type).toBe("AUTH_FAILURE");
      expect((error as ModelFailure).message).not.toContain("secret");
    }
  });

  it("constructs with a key and exposes provider identity + configurable model", () => {
    const provider = new GeminiProvider({ env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "custom-model" } });
    expect(provider.providerId).toBe("google/gemini");
    expect(provider.modelId).toBe("custom-model");
    const defaults = new GeminiProvider({ env: { GEMINI_API_KEY: "k" } });
    expect(defaults.modelId).toBe("gemini-3.5-flash-lite"); // config-layer default (§1 + free-tier audit)
  });

  it("maps HTTP status categories to typed failures without echoing response bodies", async () => {
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () =>
        new Response('{"error":"...contains request metadata..."}', { status: 429 })) as unknown as typeof fetch,
      // Status MAPPING is under test, not retry timing — collapse the retry budget.
      transientRetry: { attempts: 1, baseDelayMs: 0 },
    });
    const promise = provider.structured({
      schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p",
    });
    await expect(promise).rejects.toMatchObject({ type: "RATE_LIMITED" });
    try {
      await provider.structured({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" });
    } catch (error) {
      expect((error as ModelFailure).message).toContain("429");
      expect((error as ModelFailure).message).not.toContain("contains request metadata");
    }
  });

  it("network errors become PROVIDER_UNAVAILABLE (retriable), never fabricated output", async () => {
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch,
      transientRetry: { attempts: 1, baseDelayMs: 0 },
    });
    await expect(provider.structured({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" })).rejects.toMatchObject({
      type: "PROVIDER_UNAVAILABLE",
      retriable: true,
    });
  });

  it("empty candidates become EMPTY_OUTPUT", async () => {
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () =>
        new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(provider.structured({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" })).rejects.toMatchObject({
      type: "EMPTY_OUTPUT",
    });
  });

  it("sends the key only via header and never includes it in the request body", async () => {
    let captured: { headers: Headers; body: string } | undefined;
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: "TOPSECRET-KEY" },
      fetchImpl: (async (_url: string, init: RequestInit) => {
        captured = { headers: new Headers(init.headers), body: String(init.body) };
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const result = await provider.structured<string>({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" });
    expect(result.raw).toBe('{"ok":true}');
    expect(captured?.headers.get("x-goog-api-key")).toBe("TOPSECRET-KEY");
    expect(captured?.body).not.toContain("TOPSECRET-KEY");
  });

  it("retries TRANSIENT 5xx failures with backoff and succeeds — permanent failures do not retry", async () => {
    const delays: number[] = [];
    let calls = 0;
    const flaky = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () => {
        calls++;
        if (calls < 3) return new Response("overloaded", { status: 503 }) as unknown as Response;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 });
      }) as unknown as typeof fetch,
      transientRetry: {
        attempts: 3,
        baseDelayMs: 10,
        sleep: async (ms) => { delays.push(ms); }, // deterministic: no real waiting
      },
    });
    const ok = await flaky.structured<string>({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" });
    expect(ok.raw).toBe('{"ok":true}');
    expect(calls).toBe(3);
    expect(delays).toEqual([10, 20]); // exponential base

    // A permanent failure (4xx/AUTH) must NOT be retried.
    let permanentCalls = 0;
    const authFail = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () => {
        permanentCalls++;
        return new Response("denied", { status: 403 }) as unknown as Response;
      }) as unknown as typeof fetch,
      transientRetry: { attempts: 3, baseDelayMs: 10, sleep: async () => {} },
    });
    await expect(authFail.structured({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" }))
      .rejects.toMatchObject({ type: "AUTH_FAILURE" });
    expect(permanentCalls).toBe(1);
  });

  it("fails FAST on daily-quota exhaustion (429 + PerDay quotaId) — never retry-stalls", async () => {
    let calls = 0;
    const dailyBody = JSON.stringify({
      error: {
        code: 429, status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
      },
    });
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () => {
        calls++;
        return new Response(dailyBody, { status: 429 }) as unknown as Response;
      }) as unknown as typeof fetch,
      transientRetry: { attempts: 3, baseDelayMs: 10, sleep: async () => {} },
    });
    await expect(provider.structured({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" }))
      .rejects.toMatchObject({ type: "RATE_LIMITED", retriable: false });
    expect(calls).toBe(1); // one attempt only — daily quota cannot be retried away
  });

  it("keeps per-minute 429 retriable (rate shaping, not daily exhaustion)", async () => {
    let calls = 0;
    const minuteBody = JSON.stringify({
      error: {
        code: 429, status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }],
      },
    });
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: (async () => {
        calls++;
        return new Response(minuteBody, { status: 429 }) as unknown as Response;
      }) as unknown as typeof fetch,
      transientRetry: { attempts: 2, baseDelayMs: 5, sleep: async () => {} },
    });
    await expect(provider.structured({ schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p" }))
      .rejects.toMatchObject({ type: "RATE_LIMITED" });
    expect(calls).toBe(2); // retried through the budget before failing
  });
});
