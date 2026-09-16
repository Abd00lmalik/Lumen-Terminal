/**
 * LIVE Gemini validation; M3 §21/§22. Run explicitly:
 *
 *   FREEBUFF_LIVE_GEMINI=1 (with GEMINI_API_KEY in the environment or .env) npx vitest run tests/model/gemini.live.test.ts
 *
 * Skipped by default so the deterministic suite never needs credentials and never touches
 * the network. These tests NEVER print the API key; assertions check structure only.
 */
import { describe, expect, it } from "vitest";
import { GeminiProvider } from "../../src/model/gemini.js";
import { ModelFailure, validateModelOutput } from "../../src/model/provider.js";
import { FINAL_RESPONSE_SCHEMA } from "../../src/model/schemas.js";

const LIVE = process.env.FREEBUFF_LIVE_GEMINI === "1" && !!process.env.GEMINI_API_KEY;

describe.skipIf(!LIVE)("live Gemini (env-gated; skipped without FREEBUFF_LIVE_GEMINI + GEMINI_API_KEY)", () => {
  it("performs one real structured round-trip conforming to a validated schema", async () => {
    const provider = new GeminiProvider(); // real env credentials
    // §2: the configured model must be gemini-3.5-flash-lite (free-tier audit default); via
    // GEMINI_MODEL or the config-layer default. An explicit env override is also valid configuration.
    expect(["gemini-3.5-flash-lite", process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite"]).toContain(provider.modelId);
    const response = await provider.structured<string>({
      schemaName: "response.final",
      schemaDescription: '{"answer": string, "supportingReasons": string[], "opposingReasons": string[], "confidence": "HIGH"|"MODERATE"|"LOW"|"UNKNOWN", "keyUncertainty": string, "implication": string, "citedObjectRefs": string[]}',
      system: "You summarize research outcomes for a trader. Respond with one JSON object.",
      prompt: 'Summarize this research outcome: {"observations":["BTC fell 4% in 2 hours"],"limitations":["news feeds empty today"]}',
      preferJson: true,
      timeoutMs: 30_000,
    });
    // Validate through the shared gate; the live path must pass the same validation as mocks.
    const { data } = validateModelOutput<{ answer: string; confidence: string }>(FINAL_RESPONSE_SCHEMA, response.raw);
    expect(typeof data.answer).toBe("string");
    expect(data.answer.length).toBeGreaterThan(0);
    expect(["HIGH", "MODERATE", "LOW", "UNKNOWN"]).toContain(data.confidence);
    // The key must never leak into any response artifact.
    expect(response.raw).not.toContain(process.env.GEMINI_API_KEY ?? "");
  }, 60_000);

  it("maps invalid model config to a typed failure (not a crash, not a fabrication)", async () => {
    const provider = new GeminiProvider({
      env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "", GEMINI_MODEL: "definitely-not-a-real-model-xyz" },
    });
    try {
      await provider.structured({
        schemaName: "s", schemaDescription: "{}", system: "sys", prompt: "p", timeoutMs: 20_000,
      });
      // If it somehow succeeds, fail honestly; the model id should not exist.
      expect.unreachable("invalid model id unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelFailure);
    }
  }, 40_000);
});
