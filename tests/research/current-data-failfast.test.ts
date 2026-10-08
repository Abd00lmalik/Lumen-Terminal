/**
 * CURRENT-DATA FAIL-FAST — the retrieval-budget failure class from the live BTC test
 * (5adb447): a simple current-price/24h ask spent ~3.5 minutes, ingested one stale hourly
 * candle, and died on TIME_BUDGET_EXHAUSTED. The law pinned here:
 * - freshness validation rejects a stale observation for a current-window requirement (K/L);
 * - when every blocking row is a current-window metric row and every registered market-data
 *   capability has already run, the loop stops immediately with an explicit gap (M) —
 *   requirement validation is NOT weakened (the rows end unresolved, the run ends FAILED).
 */
import { describe, it, expect } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { freshnessSufficient, coverageItemOf, isCurrentWindowMetricRow, type ResearchRequirement } from "../../src/research/requirements.js";
import { runAdaptiveResearch } from "../../src/research/adaptive.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const QUESTION = "What is Bitcoin's current price over the last 24 hours?";
const trader: ProvenanceOrigin = { kind: "trader", detail: "current-data test" };

function metricRow(): ResearchRequirement {
  return {
    id: "rq_price", description: "the current price of Bitcoin over the last 24 hours",
    importance: "CRITICAL", role: "CORE", timeSensitivity: "CURRENT", domains: ["PRICE_MARKET"],
    status: "PENDING", evidenceRefs: [], staleOnlyRefs: [], recoveryAttempts: 0, engineRequired: true,
  };
}

const NOW = new Date("2026-10-08T12:00:00.000Z");

describe("current-data freshness validation (K/L)", () => {
  it("a fresh observation satisfies a current-window metric row; a 25-hour-old candle never does", () => {
    const req = metricRow();
    expect(isCurrentWindowMetricRow(req)).toBe(true);
    const fresh = coverageItemOf({ ref: "ev_fresh", text: "BTC spot 84,000", evidenceType: "price", freshness: "CURRENT", timestamp: "2026-10-08T11:00:00.000Z" });
    const stale = coverageItemOf({ ref: "ev_stale", text: "BTC candle 84,142", evidenceType: "price", freshness: "CURRENT", timestamp: "2026-10-07T07:30:00.000Z" });
    expect(freshnessSufficient(req, fresh, NOW)).toBe(true);
    // L: the live failure — a candle observed ~24h earlier is outside the named window.
    expect(freshnessSufficient(req, stale, NOW)).toBe(false);
  });
});

describe("current-data fail-fast (M)", () => {
  it("stops with REQUIREMENT_GAPS_UNRESOLVED within one round when the only market-data path already ran and current metrics remain unmet", { timeout: 30_000 }, async () => {
    const provider: ModelProvider = {
      providerId: "test/current", modelId: "test",
      async structured<T>(r: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
        const raw = r.schemaName === "research.plan"
          ? JSON.stringify({ objective: QUESTION, scopeIncluded: ["Bitcoin"], scopeExcluded: [], tasks: [{ type: "FACT_FINDING", objective: QUESTION, capabilities: ["CRYPTO_MARKET_DATA"], completion: "current price" }], requirements: [{ description: "the current price of Bitcoin over the last 24 hours", importance: "CRITICAL", timeSensitivity: "CURRENT" }], completionCriteria: ["price"], adaptationPolicy: "stop" })
          : r.schemaName === "research.adaptive_decision"
            ? JSON.stringify({ decision: "CONTINUE", rationale: "keep trying", nextTasks: [{ objective: QUESTION, capabilities: ["CRYPTO_MARKET_DATA"], completion: "price" }] })
            : "{}";
        return { data: JSON.parse(raw) as T, raw, schemaName: r.schemaName, modelId: "test" };
      },
    };
    let executions = 0;
    const adapter: ProviderAdapter = {
      providerId: "stub", capabilities: ["CRYPTO_MARKET_DATA"], limitations: [], freshnessProfile: "test:live",
      async execute(capability: string) {
        executions += 1;
        // The stale candle the live system actually received, with the source timestamp the
        // adapter observed it at (freshness is validated from the payload's own time, never
        // from the retrieval wall clock).
        return { tool: "stub", capability, transport: "https", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: JSON.stringify({ symbol: "BTC", candles: [{ openTime: "2026-10-07T07:00:00.000Z", open: 84229.01, high: 84310.42, low: 84090.79, close: 84142.92, baseVolume: 67.7 }], about: "BTC" }), about: "BTC", sourceTimestamp: "2026-10-07T07:30:00.000Z" }] };
      },
    };
    const ws = new Workspace();
    const research = ws.addResearch({ objective: QUESTION, question: QUESTION, flow: "WHAT_HAPPENED" }, trader);
    ws.transitionResearch(research.id, "ACTIVE", trader, "activated");
    const outcome = await runAdaptiveResearch(QUESTION, research.id, {
      provider, registry: (() => { const r = new CapabilityRegistry(); r.register(adapter); return r; })(),
      workspace: ws, store: new MemoryStore(),
    });

    // M: fail fast — no multi-minute round burn (round budget is 6+), explicit gap. The
    // capability floor may add disconfirmation/market-data siblings in the same single round.
    expect(outcome.rounds.length).toBeLessThanOrEqual(2);
    expect(outcome.stoppedBecause).toBe("REQUIREMENT_GAPS_UNRESOLVED");
    expect(finalStatus(ws, research.id)).toBe("FAILED");
    // Validation NOT weakened: the current-price row ends unresolved, not satisfied.
    const row = (outcome.requirements ?? []).find((r) => r.description.includes("current price of Bitcoin"));
    expect(row !== undefined && row.status !== "SATISFIED").toBe(true);
    expect(outcome.finalDecision.rationale).toContain("current market-data");
  });
});

function finalStatus(ws: Workspace, id: string): string {
  return ws.getResearch(id)?.status ?? "missing";
}
