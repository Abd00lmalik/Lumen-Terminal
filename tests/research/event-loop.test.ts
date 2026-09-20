/**
 * Loop-level event-research regression (research-contract mandate §4/§5).
 *
 * The live failure: "Could a US government shutdown affect gold and Bitcoin at the same
 * time?" retrieved real BTC candles, then reported "historical price responses during past
 * shutdowns remain uncovered" and answered with current statistics. The engine must:
 *   1. transform held candles into event-window derived evidence (deterministic), and
 *   2. when a proposed window is NOT covered, keep the requirement uncovered (schedule
 *      historical retrieval) instead of letting raw price data masquerade as episode analysis.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch } from "../../src/research/adaptive.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

function historyCapability(capability: string, content: unknown): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "FACTUAL_OBSERVATION", content, about: "BTCUSDT" }],
      };
    },
  };
}

function candleJson(days: { d: string; c: number }[]): string {
  return JSON.stringify({
    month: days[0]?.d.slice(0, 7) ?? "?",
    candleCount: days.length,
    candles: days.map(({ d, c }) => ({
      openTime: `${d}T00:00:00.000Z`,
      closeTime: `${d}T23:59:59.999Z`,
      open: c,
      high: c * 1.01,
      low: c * 0.99,
      close: c,
      baseVolume: 10,
    })),
  });
}

/** A plan with one shutdown episode covering BTC; coverage requirement asks for its reaction. */
function shutdownPlan(from: string, to: string): string {
  return JSON.stringify({
    objective: "Could a US government shutdown affect gold and Bitcoin at the same time?",
    scopeIncluded: ["historical episodes"], scopeExcluded: [],
    tasks: [
      { type: "HISTORY", objective: "retrieve candle history around the shutdown episode", capabilities: ["HISTORICAL_COMPARISON"], completion: "windows covered or absence recorded" },
    ],
    requirements: [
      { description: "historical BTC price response during the shutdown episode window", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
    ],
    eventEpisodes: [{ event: "US government shutdown", from, to, assets: ["gold", "BTC"] }],
    completionCriteria: ["episode windows analyzed"], adaptationPolicy: "n/a",
  });
}

describe("event-episode research loop", () => {
  beforeEach(() => resetIdCounters());

  it("transforms retrieved candles into event-window evidence (raw candles are not the analysis)", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", shutdownPlan("2023-10-01", "2023-10-12")],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const candles = candleJson([
      { d: "2023-09-28", c: 27000 }, { d: "2023-09-29", c: 26950 }, { d: "2023-09-30", c: 26980 },
      { d: "2023-10-01", c: 27010 }, { d: "2023-10-02", c: 27490 }, { d: "2023-10-03", c: 27430 },
      { d: "2023-10-04", c: 27780 }, { d: "2023-10-05", c: 27400 }, { d: "2023-10-06", c: 27930 },
      { d: "2023-10-07", c: 27950 }, { d: "2023-10-08", c: 27920 }, { d: "2023-10-09", c: 27590 },
      { d: "2023-10-10", c: 27390 }, { d: "2023-10-11", c: 26880 }, { d: "2023-10-12", c: 26760 },
    ]);
    const registry = new CapabilityRegistry();
    registry.register(historyCapability("HISTORICAL_COMPARISON", candles));

    const ws = new Workspace();
    const research = ws.addResearch(
      { objective: "shutdown cross-asset question", question: "Could a US government shutdown affect gold and Bitcoin at the same time?", flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
      origin,
    );
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

    const outcome = await runAdaptiveResearch(
      "Could a US government shutdown affect gold and Bitcoin at the same time?",
      research.id,
      { provider, registry, workspace: ws, store: new MemoryStore(), maxRounds: 1 },
    );

    // The BTC window was computed: a derived event-window evidence object exists with
    // metrics and the coincidence wording; the raw candle chunk is NOT the only record.
    const derived = outcome.evidence.find((e) => e.evidenceType === "HISTORICAL_EVENT_WINDOW");
    expect(derived).toBeDefined();
    expect(derived!.evidenceClass).toBe("DERIVED_OBSERVATION");
    expect(derived!.observation).toContain("2023-10-01");
    expect(derived!.observation).toContain("does not establish that the event caused it");
    expect(derived!.observation).toMatch(/net move -?\d+(\.\d+)?%/);
    // The derived evidence belongs to this run's evidence set (coverage can see it).
    expect(outcome.evidence.some((e) => e.evidenceType.startsWith("HISTORICAL"))).toBe(true);
  });

  it("does NOT mint window evidence when the record does not cover the episode", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", shutdownPlan("2019-01-05", "2019-01-25")],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    // The retrieved candles are from 2023: the 2019 shutdown window is simply not covered.
    const candles = candleJson([
      { d: "2023-09-28", c: 27000 }, { d: "2023-09-29", c: 26950 }, { d: "2023-09-30", c: 26980 },
      { d: "2023-10-01", c: 27010 }, { d: "2023-10-02", c: 27490 },
    ]);
    const registry = new CapabilityRegistry();
    registry.register(historyCapability("HISTORICAL_COMPARISON", candles));

    const ws = new Workspace();
    const research = ws.addResearch(
      { objective: "shutdown cross-asset question", question: "Could a US government shutdown affect gold and Bitcoin at the same time?", flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
      origin,
    );
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

    const outcome = await runAdaptiveResearch(
      "Could a US government shutdown affect gold and Bitcoin at the same time?",
      research.id,
      { provider, registry, workspace: ws, store: new MemoryStore(), maxRounds: 1 },
    );

    expect(outcome.evidence.find((e) => e.evidenceType === "HISTORICAL_EVENT_WINDOW")).toBeUndefined();
    // No fabricated metrics anywhere in the run's evidence.
    for (const e of outcome.evidence) {
      if (e.observation.includes("Event-window analysis")) {
        expect(e.observation).not.toMatch(/net move/);
      }
    }
  });
});
