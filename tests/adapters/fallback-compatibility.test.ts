import { describe, expect, it } from "vitest";
import {
  validateCryptoMarketFallback,
  validateEquityMarketFallback,
} from "../../src/adapters/fallback-compatibility.js";
import type { ToolResult, ToolResultInput } from "../../src/domain/tool-result.js";
import { normalizedResult } from "../../src/domain/tool-result.js";

const origin = { kind: "agent" as const, detail: "test" };

function resultWith(
  input: Partial<ToolResultInput> & { about?: string; content?: unknown },
): ToolResult {
  const { about, content, ...rest } = input;
  return normalizedResult(
    {
      tool: "fallback/test",
      capability: "MARKET_DATA_ANALYSIS",
      transport: "test",
      params: {},
      outputs: [
        {
          outputClass: "QUANTITATIVE_OBSERVATION",
          content: content ?? { price: 1 },
          ...(about !== undefined ? { about } : {}),
        },
      ],
      validation: "VALID",
      ...rest,
    } as ToolResultInput,
    origin,
    new Date(),
  );
}

describe("fallback-compatibility (pure; regression 2026-10-09)", () => {
  describe("validateCryptoMarketFallback", () => {
    it("accepts a matching instrument with CURRENT freshness", () => {
      const gate = validateCryptoMarketFallback(
        { asset: "BTC" },
        resultWith({ about: "bitcoin", freshness: "CURRENT" }),
      );
      expect(gate.compatible).toBe(true);
    });

    it("accepts a known alias (BTC ↔ XBT ↔ BITCOIN)", () => {
      expect(validateCryptoMarketFallback({ asset: "BTC" }, resultWith({ about: "XBT", freshness: "CURRENT" })).compatible).toBe(true);
      expect(validateCryptoMarketFallback({ asset: "BTC" }, resultWith({ about: "BITCOIN", freshness: "CURRENT" })).compatible).toBe(true);
      expect(validateCryptoMarketFallback({ asset: "BITCOIN" }, resultWith({ about: "btc", freshness: "CURRENT" })).compatible).toBe(true);
    });

    it("rejects a wrong instrument (the ETH-for-BTC fallback answer)", () => {
      const gate = validateCryptoMarketFallback(
        { asset: "BTC" },
        resultWith({ about: "ethereum", freshness: "CURRENT" }),
      );
      expect(gate.compatible).toBe(false);
      if (!gate.compatible) {
        expect(gate.reasons.join(" ")).toContain("BTC");
        expect(gate.reasons.join(" ")).toContain("ETHEREUM"); // normalized to uppercase
      }
    });

    it("rejects a STALE result for a live request", () => {
      const gate = validateCryptoMarketFallback(
        { asset: "BTC" },
        resultWith({ about: "bitcoin", freshness: "STALE" }),
      );
      expect(gate.compatible).toBe(false);
      if (!gate.compatible) expect(gate.reasons.join(" ")).toContain("STALE");
    });

    it("accepts HISTORICAL only when the request asked for a historical window", () => {
      expect(
        validateCryptoMarketFallback({ asset: "BTC" }, resultWith({ about: "bitcoin", freshness: "HISTORICAL" })).compatible,
      ).toBe(false);
      expect(
        validateCryptoMarketFallback(
          { asset: "BTC", from: "2020-01-01" },
          resultWith({ about: "bitcoin", freshness: "HISTORICAL" }),
        ).compatible,
      ).toBe(true);
      // requiredWindowHours (the engine's MC-5 lookback brief) counts as a window request:
      expect(
        validateCryptoMarketFallback(
          { asset: "BTC", requiredWindowHours: 24 },
          resultWith({ about: "bitcoin", freshness: "HISTORICAL" }),
        ).compatible,
      ).toBe(true);
    });

    it("does not invent identity: no requested instrument → no mismatch rejection", () => {
      const gate = validateCryptoMarketFallback(
        { question: "what happened in crypto" },
        resultWith({ about: "bitcoin", freshness: "CURRENT" }),
      );
      expect(gate.compatible).toBe(true);
    });

    it("reads the instrument from content fields when `about` is absent", () => {
      const gate = validateCryptoMarketFallback(
        { symbol: "ETH" },
        resultWith({ content: { symbol: "BTC", price: 100 }, freshness: "CURRENT" }),
      );
      expect(gate.compatible).toBe(false);
    });
  });

  describe("validateEquityMarketFallback", () => {
    it("accepts a matching ticker", () => {
      expect(
        validateEquityMarketFallback({ symbol: "AAPL" }, resultWith({ about: "AAPL", freshness: "CURRENT" })).compatible,
      ).toBe(true);
    });

    it("rejects a wrong ticker (MSFT quote standing in for the AAPL request)", () => {
      const gate = validateEquityMarketFallback(
        { symbol: "AAPL" },
        resultWith({ about: "MSFT", freshness: "CURRENT" }),
      );
      expect(gate.compatible).toBe(false);
      if (!gate.compatible) expect(gate.reasons.join(" ")).toContain("MSFT");
    });

    it("rejects STALE for live requests; accepts when a range/window was requested", () => {
      expect(
        validateEquityMarketFallback({ symbol: "AAPL" }, resultWith({ about: "AAPL", freshness: "STALE" })).compatible,
      ).toBe(false);
      expect(
        validateEquityMarketFallback(
          { symbol: "AAPL", range: "5d" },
          resultWith({ about: "AAPL", freshness: "STALE" }),
        ).compatible,
      ).toBe(true);
    });
  });
});
