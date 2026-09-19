/**
 * Capability vocabulary normalization tests (zero-dead-end mandate §3/§21); deterministic.
 *
 * Laws under test:
 * - ALIAS MAPPING: model-invented near-misses ("web_search", "FINANCIAL_DATA_API") canonicalize
 *   onto the registered capability they mean, so they can never become "no provider registered".
 * - UNKNOWN DROPPING: genuinely unknown names are dropped (never passed to the registry), and
 *   reported in `dropped` so diagnostics stay honest.
 * - DEDUPE + SHAPE: duplicates collapse; case/separator variants canonicalize; non-strings are
 *   skipped (shape errors remain the schema parsers' job).
 * - CONFORMANCE: every canonical name is exported through PLANNER_CAPABILITIES and proven
 *   provider-backed by the zero-dead-end registry test.
 */
import { describe, expect, it } from "vitest";
import {
  CANONICAL_CAPABILITIES,
  canonicalCapability,
  normalizePlanCapabilities,
} from "../../src/model/capability-vocabulary.js";
import { PLANNER_CAPABILITIES } from "../../src/research/adaptive.js";

describe("canonicalCapability", () => {
  it("canonicalizes casing and separators", () => {
    expect(canonicalCapability("web_search")).toBe("WEB_SEARCH");
    expect(canonicalCapability("  Equity Market Data ")).toBe("EQUITY_MARKET_DATA");
    expect(canonicalCapability("equity-market-data")).toBe("EQUITY_MARKET_DATA");
  });

  it("maps known aliases onto the canonical capability they mean", () => {
    expect(canonicalCapability("FINANCIAL_DATA_API")).toBe("MARKET_DATA_ANALYSIS");
    expect(canonicalCapability("financial_data_api")).toBe("MARKET_DATA_ANALYSIS");
    expect(canonicalCapability("SEARCH")).toBe("WEB_SEARCH");
    expect(canonicalCapability("FUNDING_RATE")).toBe("DERIVATIVES_ANALYSIS");
    expect(canonicalCapability("DEFI")).toBe("DEFI_ANALYSIS");
    expect(canonicalCapability("EARNINGS_ESTIMATES")).toBe("EARNINGS_CALENDAR");
    // the old alias collapses onto the canonical name (one earnings fetch, never two)
    expect(canonicalCapability("EQUITY_EARNINGS")).toBe("EARNINGS_CALENDAR");
    expect(canonicalCapability("ON_CHAIN")).toBe("ONCHAIN_ANALYSIS");
    expect(canonicalCapability("LOCAL_MEMORY")).toBe("LOCAL_KNOWLEDGE_RETRIEVAL");
  });

  it("returns null for unknown names and empty input", () => {
    expect(canonicalCapability("QUANTUM_ENTANGLEMENT")).toBeNull();
    expect(canonicalCapability("")).toBeNull();
    expect(canonicalCapability("   ")).toBeNull();
  });
});

describe("normalizePlanCapabilities", () => {
  it("normalizes, dedupes, and drops unknowns with an honest trail", () => {
    const { capabilities, dropped } = normalizePlanCapabilities([
      "web_search",
      "WEB_SEARCH",
      "FINANCIAL_DATA_API",
      "news",
      "QUANTUM_ENTANGLEMENT",
      42,
    ]);
    expect(capabilities).toEqual(["WEB_SEARCH", "MARKET_DATA_ANALYSIS", "NEWS_ANALYSIS"]);
    expect(dropped).toEqual(["QUANTUM_ENTANGLEMENT"]);
  });

  it("never lets a dropped name reach the registry", () => {
    const { capabilities } = normalizePlanCapabilities(["financial_data_api", "totally_made_up"]);
    for (const capability of capabilities) {
      expect(CANONICAL_CAPABILITIES).toContain(capability);
    }
  });
});

describe("vocabulary conformance", () => {
  it("PLANNER_CAPABILITIES is exactly the canonical set minus flow-internal-only names", () => {
    // CAUSAL_INVESTIGATION / EVENT_RECONSTRUCTION were removed entirely (never registered).
    expect(PLANNER_CAPABILITIES).toEqual([...CANONICAL_CAPABILITIES]);
    expect(PLANNER_CAPABILITIES).not.toContain("CAUSAL_INVESTIGATION");
    expect(PLANNER_CAPABILITIES).not.toContain("EVENT_RECONSTRUCTION");
  });
});
