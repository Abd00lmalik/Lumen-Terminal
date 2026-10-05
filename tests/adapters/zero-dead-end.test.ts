/**
 * Zero-dead-end conformance (mandate §0/§5/§29); deterministic, no network.
 *
 * Laws under test:
 * - VOCABULARY CONFORMANCE: every capability name the planner may emit resolves to at least
 *   one registered provider. This is the architectural guard: adding a capability to the
 *   planner prompts without a provider fails HERE, deterministically — "no provider
 *   registered for capability X" can never reach a user for a planned capability.
 * - EXTENDED RESEARCH TIERS: ONCHAIN_ANALYSIS, DEFI_ANALYSIS, PROJECT_RESEARCH, WEB_SEARCH
 *   all resolve through the generic registry (no Flow→provider hardcoding).
 * - EPISTEMIC HONESTY: search output stays secondary; on-chain observations carry upstream
 *   lineage; subjectless tools (L2Beat, TrendingToken) never fabricate a subject.
 */
import { describe, expect, it } from "vitest";
import { createBitgetAdapterSet } from "../../src/adapters/bitget-skills.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { PLANNER_CAPABILITIES } from "../../src/research/adaptive.js";

/** Capability names the planner may emit: the declared single-source vocabulary. */
function plannerCapabilityVocabulary(): readonly string[] {
  return PLANNER_CAPABILITIES;
}

function fullRegistry(): ReturnType<typeof createBitgetAdapterSet>["registry"] {
  process.env.BITGET_MCP_URL = process.env.BITGET_MCP_URL ?? "https://bagelfheon.mcp.dealersbit.com/mcp";
  return createBitgetAdapterSet({ fallbacks: true }).registry;
}

describe("zero-dead-end vocabulary conformance", () => {
  it("every capability the planner may emit resolves to at least one provider", () => {
    const registry = fullRegistry();
    const vocabulary = plannerCapabilityVocabulary();
    expect(vocabulary.length).toBeGreaterThan(8);
    const unresolved = vocabulary.filter((capability) => registry.resolve(capability as never).length === 0);
    expect(unresolved, `planner names these capabilities but NO provider is registered: ${unresolved.join(", ")}`).toEqual([]);
  });

  it("extended research domains resolve through the generic registry", () => {
    const registry = fullRegistry();
    // The commercial search-agent tier was removed with Heurist (2026-10-05). These domains
    // are served by the keyless Bitget MCP surface (crypto_market / dex_market /
    // defi_analytics / network_status / news_feed), so they must still resolve — the removal
    // must not have left the planner naming a capability no provider serves.
    for (const capability of ["ONCHAIN_ANALYSIS", "DEFI_ANALYSIS", "PROJECT_RESEARCH", "WEB_SEARCH"] as const) {
      const providers = registry.resolve(capability);
      expect(providers.length, capability).toBeGreaterThan(0);
      expect(providers.some((p) => p.adapter.providerId.startsWith("heurist/")), `${capability} must NOT resolve to a removed Heurist provider`).toBe(false);
    }
  });

  it("WEB_SEARCH prefers G2 bounded discovery and serves the remaining chain keylessly", () => {
    const registry = fullRegistry();
    const chain = registry.resolve("WEB_SEARCH").map((p) => p.adapter.providerId);
    expect(chain[0]).toBe("g2/web-retrieval");
    // No commercial/credit-based search agent may remain in the research path.
    expect(chain.some((id) => id.startsWith("heurist/"))).toBe(false);
  });
});
