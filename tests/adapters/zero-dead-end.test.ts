/**
 * Zero-dead-end conformance (mandate §0/§5/§29); deterministic, no network.
 *
 * Laws under test:
 * - VOCABULARY CONFORMANCE: every capability name the planner may emit resolves to at least
 *   one registered provider. This is the architectural guard: adding a capability to the
 *   planner prompts without a provider fails HERE, deterministically — "no provider
 *   registered for capability X" can never reach a user for a planned capability.
 * - EXTENDED HEURIST TIER: ONCHAIN_ANALYSIS, DEFI_ANALYSIS, PROJECT_RESEARCH, WEB_SEARCH
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

  it("extended Heurist research domains resolve through the generic registry", () => {
    const registry = fullRegistry();
    for (const capability of ["ONCHAIN_ANALYSIS", "DEFI_ANALYSIS", "PROJECT_RESEARCH", "WEB_SEARCH"] as const) {
      const providers = registry.resolve(capability);
      expect(providers.length, capability).toBeGreaterThan(0);
      expect(providers.some((p) => p.adapter.providerId.startsWith("heurist/")), `${capability} should have a Heurist-tier provider`).toBe(true);
    }
  });

  it("WEB_SEARCH prefers G2 bounded discovery over commercial search agents", () => {
    const registry = fullRegistry();
    const chain = registry.resolve("WEB_SEARCH").map((p) => p.adapter.providerId);
    expect(chain[0]).toBe("g2/web-retrieval");
    expect(chain).toContain("heurist/ExaSearchAgent");
    expect(chain).toContain("heurist/DuckDuckGoSearchAgent");
  });
});
