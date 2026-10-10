/**
 * FLOW-ROUTED WINDOW BRIEF regression tests (live run rs_000377 failure mode).
 *
 * The observed live contradiction: a flow-routed crude-oil ask showed diagnostics
 * coverage COMPLETE / gate EVIDENCE_SUFFICIENT / ledger rows SATISFIED, yet the final
 * status rendered INSUFFICIENT and no timestamped OHLCV summary reached the trader.
 *
 * Root causes proven here:
 *  1. the flow runner executed the model's plan WITHOUT the shape/resolution/window brief
 *     the adaptive loop sends, so a "last 7 days" ask hit Yahoo with its 1mo default and
 *     coverage measured whatever came back instead of the requested window; and
 *  2. once a real series DOES reach the graph, requirement satisfaction must rest on the
 *     payload's own timestamped OHLCV rows (not metadata/counts), the statuses must agree
 *     end-to-end (gate == persisted state == API outcome), and the trader-facing rendering
 *     of the series evidence must be a readable daily table with citations — never a raw
 *     JSON payload dump.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runFlow2 } from "../../src/research/flow2.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { EquityMarketDataAdapter } from "../../src/adapters/equity.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter, ToolResult } from "../../src/adapters/capability-registry.js";
import { readableObservation } from "../../src/research/observation-text.js";
import type { ToolOutput } from "../../src/domain/tool-result.js";
import type { RestTransport } from "../../src/adapters/transports/rest.js";

const trader = { kind: "trader" as const, detail: "test" };

// A spying adapter: records the params each capability call actually received (the brief
// under test) and serves one scripted output.
interface RecordedCall { readonly capability: string; readonly params: Record<string, unknown> }
const executions: RecordedCall[] = [];

function spyingCapability(capability: string, output: ToolOutput): ProviderAdapter {
  return {
    providerId: `spy/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["test spy"],
    freshnessProfile: "test:live",
    async execute(cap: string, params: Record<string, unknown>): Promise<ToolResult> {
      executions.push({ capability: cap, params });
      const result = {
        tool: `spy/${cap.toLowerCase()}`,
        capability: cap,
        transport: "test",
        params,
        outputs: [output],
        completeness: "COMPLETE" as const,
        freshness: "CURRENT" as const,
        validation: "VALID" as const,
        failure: { type: "NONE" as const, message: "", retriable: false },
        limitations: [],
      };
      return result as unknown as ToolResult;
    },
  };
}

/** A FAKE daily candle table shaped exactly like the equity adapter's series output. */
function seriesOutput(symbol: string, days: { ts: string; open: number; high: number; low: number; close: number; volume: number }[]): ToolOutput {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return {
    outputClass: "QUANTITATIVE_OBSERVATION",
    content: {
      symbol,
      interval: "1d",
      from: first.ts,
      to: last.ts,
      sessions: days.length,
      candles: days.map((c) => ({ ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    },
    about: symbol,
    timeframe: "1d",
  };
}

// Seven daily sessions ending "today" (2026-10-09); every one timestamped, real OHLCV.
const OIL_DAYS = [
  { ts: "2026-10-01", open: 61.4, high: 62.3, low: 60.9, close: 62.1, volume: 401000 },
  { ts: "2026-10-02", open: 62.2, high: 63.0, low: 61.7, close: 62.8, volume: 385000 },
  { ts: "2026-10-05", open: 62.9, high: 63.4, low: 62.0, close: 62.6, volume: 362000 },
  { ts: "2026-10-06", open: 62.7, high: 63.8, low: 62.4, close: 63.5, volume: 377000 },
  { ts: "2026-10-07", open: 63.6, high: 64.2, low: 63.1, close: 63.9, volume: 402000 },
  { ts: "2026-10-08", open: 63.8, high: 64.9, low: 63.5, close: 64.6, volume: 431000 },
  { ts: "2026-10-09", open: 64.5, high: 65.2, low: 64.1, close: 65.0, volume: 448000 },
];

const OIL_PLAN = JSON.stringify({
  objective: "Why are oil prices up this week?",
  scopeIncluded: ["market data", "news"],
  scopeExcluded: [],
  tasks: [
    { type: "FACTS", objective: "crude oil price data for the last 7 days", capabilities: ["COMMODITY_MARKET_DATA"], completion: "price series" },
    { type: "FACTS", objective: "oil supply developments", capabilities: ["NEWS_ANALYSIS"], completion: "narratives" },
  ],
  completionCriteria: ["evidence collected"],
  adaptationPolicy: "pursue distinguishing evidence",
});

const COMPLETE = responses.adaptiveDecision("COMPLETE");

function causalSynthesis(): string {
  return JSON.stringify({
    eventDefinition: "crude oil rose over the week",
    leadingExplanation: "tighter supply headlines",
    supportingReasons: ["prices rose through the week alongside supply-risk reporting"],
    competingExplanations: ["demand-side optimism"],
    contradictions: [],
    causalStatus: "PLAUSIBLE_MECHANISM",
    confidence: "MODERATE",
    uncertainty: ["supply data pending"],
    whatWouldChange: ["OPEC+ quota announcement adding supply"],
    citedObjectRefs: ["ev_000001"],
  });
}

beforeEach(() => {
  resetIdCounters();
  executions.length = 0;
});

describe("flow-routed market data (rs_000377 failure mode)", () => {
  it("forwards the required window/shapes brief to flow-executed capability calls", async () => {
    const registry = new CapabilityRegistry();
    registry.register(spyingCapability("COMMODITY_MARKET_DATA", seriesOutput("CL=F", OIL_DAYS)));
    registry.register(spyingCapability("NEWS_ANALYSIS", {
      outputClass: "FACTUAL_OBSERVATION",
      content: { title: "Crude supply tightened this week", publisher: "Reuters", publishedAt: "Thu, 08 Oct 2026 09:00:00 +0000" },
      about: "CL=F",
    }));
    registry.register(spyingCapability("FALSIFICATION", {
      outputClass: "ANALYST_INTERPRETATION",
      content: "No contradiction found; supply-risk reporting aligns with the price rise.",
      about: "CL=F",
    }));
    const provider = new FakeModelProvider(new Map([
      ["research.plan", OIL_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]));
    const workspace = new Workspace();
    const store = new MemoryStore();

    const result = await runFlow2("Why are oil prices up this week (last 7 days)?", {
      provider, registry, workspace, store, asset: "CL=F",
    });

    // The flow runner executed the plan and forwarded briefs.
    expect(result.outcome.evidence.length).toBeGreaterThan(0);
    const marketCalls = executions.filter((e) => e.capability === "COMMODITY_MARKET_DATA");
    expect(marketCalls.length).toBeGreaterThan(0);
    // THE BRIEF REACHED THE PROVIDER: a 7-day lookback travels as requiredWindowHours.
    for (const call of marketCalls) {
      expect(call.params["requiredWindowHours"]).toBe(24 * 7);
    }
  });

  it("a real series satisfies the price-sequence requirement; statuses agree end to end", async () => {
    const registry = new CapabilityRegistry();
    registry.register(spyingCapability("COMMODITY_MARKET_DATA", seriesOutput("CL=F", OIL_DAYS)));
    registry.register(spyingCapability("NEWS_ANALYSIS", {
      outputClass: "FACTUAL_OBSERVATION",
      content: { title: "Crude supply tightened this week", publisher: "Reuters", publishedAt: "Thu, 08 Oct 2026 09:00:00 +0000" },
      about: "CL=F",
    }));
    registry.register(spyingCapability("FALSIFICATION", {
      outputClass: "ANALYST_INTERPRETATION",
      content: "No contradiction found; supply-risk reporting aligns with the price rise.",
      about: "CL=F",
    }));
    const provider = new FakeModelProvider(new Map([
      ["research.plan", OIL_PLAN],
      ["research.adaptive_decision", COMPLETE],
      ["flow2.causal_synthesis", causalSynthesis()],
    ]));
    const workspace = new Workspace();
    const store = new MemoryStore();

    const result = await runFlow2("Why are oil prices up this week (last 7 days)?", {
      provider, registry, workspace, store, asset: "CL=F",
    });

    // The series evidence reached the graph as ONE observation with a real span.
    const series = workspace.listEvidence().find((e) => e.observation.includes("\"candles\""));
    expect(series).toBeDefined();
    expect(series!.coverageHours).toBeGreaterThanOrEqual(24 * 6); // 7 daily candles span >= 6 days
    expect(series!.dataFacets).toContain("SERIES");

    const marketReq = result.outcome.requirements.find((r) => r.status === "SATISFIED" && /series|price data/i.test(r.description));
    expect(marketReq).toBeDefined();
    // SATISFACTION IS CONTENT: the row's refs contain the series evidence itself.
    expect(marketReq!.evidenceRefs).toContain(series!.id);

    // STATUS CONSISTENCY: the flow's stop reason and the persisted research object agree.
    expect(result.outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(workspace.getResearch(result.outcome.researchId)!.status).toBe("COMPLETED");
  });

  it("the series evidence renders as a readable daily table, not a JSON dump", () => {
    const payload = JSON.stringify(seriesOutput("CL=F", OIL_DAYS).content);
    const readable = readableObservation(payload, 4000);
    expect(readable).toContain("CL=F");
    expect(readable).toContain("2026-10-09");
    expect(readable).toContain("close 65");
    expect(readable).toContain("retrieved sessions: 7");
    expect(readable).toContain("coverage 2026-10-01 to 2026-10-09");
    // The raw JSON braces must not BE the rendering.
    expect(readable.startsWith("{\"")).toBe(false);
  });

  it("the equity adapter emits the series + window-derived summary (adapter contract)", async () => {
    // NO LIVE NETWORK: Yahoo is served by a scripted transport double; Stooq must never be
    // reached when the primary serves the series.
    const yahoo = {
      rawCapture: { capture: (_k: string, label: string) => `raw:${label}` },
      async get(path: string, options: { params: Record<string, unknown> }) {
        return {
          body: {
            chart: {
              result: [{
                meta: { regularMarketPrice: 65.0, regularMarketTime: 1780000000, currency: "USD", fullExchangeName: "NYMEX", chartPreviousClose: 61.5 },
                timestamp: OIL_DAYS.map((d) => Math.floor(Date.parse(d.ts) / 1000)),
                // Yahoo quote arrays are PARALLEL arrays (one per field), not row objects.
                indicators: { quote: [{
                  open: OIL_DAYS.map((d) => d.open),
                  high: OIL_DAYS.map((d) => d.high),
                  low: OIL_DAYS.map((d) => d.low),
                  close: OIL_DAYS.map((d) => d.close),
                  volume: OIL_DAYS.map((d) => d.volume),
                }] },
              }],
            },
          },
        } as unknown as { body: unknown };
      },
    } as unknown as RestTransport;
    const stooq = {
      rawCapture: { capture: (_k: string, label: string) => `raw:${label}` },
      async get(): Promise<never> {
        throw new Error("stooq must not be reached when Yahoo serves the series");
      },
    } as unknown as RestTransport;
    const adapter = new EquityMarketDataAdapter(yahoo, stooq);
    const result = await adapter.execute("COMMODITY_MARKET_DATA", { asset: "OIL", requiredWindowHours: 168 });
    const outputs = (result as unknown as { outputs: { content: Record<string, unknown> }[] }).outputs;
    const series = outputs.find((o) => Array.isArray((o.content as Record<string, unknown>)["candles"]));
    expect(series).toBeDefined();
    expect((series!.content as Record<string, unknown>)["sessions"]).toBe(7);
    // WINDOW-DERIVED SUMMARY, from retrieved candles only: high = max candle high.
    const summary = outputs.find((o) => (o.content as Record<string, unknown>)["metric"] === "ohlcv_window");
    expect(summary).toBeDefined();
    expect((summary!.content as Record<string, unknown>)["high"]).toBe(65.2);
    // The in-window candle rows are 2026-10-05..09, so the window low is 62.0 — the series
    // low spanning the full retrieved data (60.9, from 2026-10-01) is NOT the window's low.
    expect((summary!.content as Record<string, unknown>)["low"]).toBe(62);
    // COVERAGE semantics are calendar-honest: a 7-day window ending Fri 2026-10-09 reaches
    // back to Fri 2026-10-02; the market was closed the weekend, so only the sessions in
    // that span count. The retrieved candles (2026-10-05..09) cover the window iff the
    // earliest needed trading session (2026-10-02) is present.
    expect((summary!.content as Record<string, unknown>)["coverageComplete"]).toBe(false);
    expect((summary!.content as Record<string, unknown>)["start"]).toBe("2026-10-05");
    expect((summary!.content as Record<string, unknown>)["missingCoverage"]).toContain("120h of the requested 168h window");
  });
});
