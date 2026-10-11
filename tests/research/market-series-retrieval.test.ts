/**
 * MARKET-SERIES RETRIEVAL + READABLE PARTIAL ANSWER (the rs_000382 production record).
 *
 * What rs_000382 showed, and what each block below pins:
 *  - The 7-day crude-oil question was served on the generic MARKET_DATA_ANALYSIS capability by
 *    `market/yahoo-regime-observables`, which hardcodes `range=5d` and reads only the response's
 *    `meta` block: ONE evidence item — a current instant — so period high/low, volume and the
 *    timestamped sequence could never exist and core coverage stuck at 50%, while the real OHLCV
 *    pipeline (COMMODITY/EQUITY_MARKET_DATA) was never consulted. `MARKET_DATA_ANALYSIS` declares
 *    those shapes (requirements.ts CAPABILITY_SUPPORT), so its chain must reach the series
 *    provider; and a current-quote provider must not close a windowed request.
 *  - Recovery rounds were 0 with pending CRITICAL rows and no statement of why. Budget-stopped
 *    runs must explain the bounded-recovery decision (a wave may only start when the remaining
 *    budget can finish it).
 *  - The interface had no readable summary. A run with real evidence and no surviving synthesis
 *    must still render an evidence-grounded partial answer WITHOUT upgrading its status.
 *
 * Deterministic fixtures, no network, clock pinned so the week never reads as stale.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { EquityMarketDataAdapter } from "../../src/adapters/equity.js";
import { MarketRegimeAdapter } from "../../src/adapters/market-regime.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";
import { readableObservation } from "../../src/research/observation-text.js";

const origin = { kind: "agent" as const, detail: "market-series retrieval regression" };
/** Deterministic clock: the studied week ends here, so nothing reads as stale. */
const NOW = new Date("2026-10-09T20:00:00.000Z");

/** The production question, verbatim in shape (7-day window + high/low/volume + news split). */
const OIL_QUESTION =
  "What happened to crude oil prices over the last 7 days? Summarize the observed price movement using timestamped market data, including the starting and latest observed prices, period high and low, and available trading volume. Separate observed market data from reported news. Cite the source and timestamp for each numerical claim. Identify missing data explicitly. Do not give trading advice.";

interface Session {
  readonly d: string;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number | null;
}

/** Six trading sessions spanning a full calendar week (Fri 02 Oct -> Fri 09 Oct = 168h). */
const OIL_SESSIONS: readonly Session[] = [
  { d: "2026-10-02", o: 86.1, h: 87.0, l: 85.4, c: 86.5, v: 221_000 },
  { d: "2026-10-03", o: 86.6, h: 88.2, l: 86.2, c: 87.9, v: 245_000 },
  { d: "2026-10-06", o: 88.0, h: 89.1, l: 87.5, c: 88.6, v: 198_000 },
  { d: "2026-10-07", o: 88.4, h: 88.9, l: 86.8, c: 87.2, v: 233_000 },
  { d: "2026-10-08", o: 87.3, h: 89.6, l: 87.1, c: 89.43, v: 260_000 },
  { d: "2026-10-09", o: 89.5, h: 92.4, l: 89.2, c: 91.85, v: 301_000 },
];

/** The same sessions with NO volume field at all (the provider may not carry one). */
const OIL_SESSIONS_NO_VOLUME: readonly Session[] = OIL_SESSIONS.map((s) => ({ ...s, v: null }));

/** A two-session slice: not a full week, so coverage must be reported as incomplete. */
const SHORT_SESSIONS: readonly Session[] = OIL_SESSIONS.slice(-2);

function yahooChartBody(symbol: string, sessions: readonly Session[], previousClose: number): string {
  const ts = sessions.map((s) => Date.parse(`${s.d}T00:00:00Z`) / 1000);
  const last = sessions[sessions.length - 1]!;
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: {
            symbol,
            regularMarketPrice: last.c,
            chartPreviousClose: previousClose,
            currency: "USD",
            fullExchangeName: "NYMEX",
            regularMarketTime: Date.parse("2026-10-09T20:00:00Z") / 1000,
            shortName: symbol,
          },
          timestamp: ts,
          indicators: {
            quote: [
              {
                open: sessions.map((s) => s.o),
                high: sessions.map((s) => s.h),
                low: sessions.map((s) => s.l),
                close: sessions.map((s) => s.c),
                volume: sessions.map((s) => s.v),
              },
            ],
          },
        },
      ],
      error: null,
    },
  });
}

/** Duck-typed RestTransport double for the equity adapter (serves the one symbol under test). */
function fakeYahoo(symbol: string, sessions: readonly Session[], previousClose: number) {
  const body = yahooChartBody(symbol, sessions, previousClose);
  return {
    async get(path: string) {
      const ok = decodeURIComponent(path).includes(symbol);
      return {
        body: ok ? (JSON.parse(body) as unknown) : ({ chart: { result: [], error: null } } as unknown),
        rawReference: `fake:${path}`,
        attempts: 1,
        durationMs: 1,
        status: 200,
      };
    },
  } as unknown as import("../../src/adapters/transports/rest.js").RestTransport;
}

/** Duck-typed RestTransport double for the current-quote regime adapter (`meta` only). */
function fakeRegimeChart(symbol: string, price: number, previousClose: number) {
  return {
    async get(path: string) {
      const ok = decodeURIComponent(path).includes(symbol);
      return {
        body: ok
          ? ({
              chart: {
                result: [
                  {
                    meta: { symbol, regularMarketPrice: price, chartPreviousClose: previousClose, regularMarketTime: Date.parse("2026-10-09T20:00:00Z") / 1000 },
                  },
                ],
                error: null,
              },
            } as unknown)
          : ({ chart: { result: [], error: null } } as unknown),
        rawReference: `fake-regime:${path}`,
        attempts: 1,
        durationMs: 1,
        status: 200,
      };
    },
  } as unknown as import("../../src/adapters/transports/rest.js").RestTransport;
}

/** An offline primary market-data provider (the production MCP call that did not serve). */
function offlinePrimary(): ProviderAdapter {
  return {
    providerId: "fixture/market-intel-offline",
    capabilities: ["MARKET_DATA_ANALYSIS"],
    limitations: ["fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: "fixture/market-intel-offline",
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: "fixture primary is offline" }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR" as const, message: "fixture primary is offline", retriable: true },
        limitations: ["fixture"],
      };
    },
  };
}

/** A dated, on-subject news headline so the "reported event" row can be served. */
function newsCapability(about: string): ProviderAdapter {
  return {
    providerId: "fixture/news",
    capabilities: ["NEWS_ANALYSIS"],
    limitations: ["fixture"],
    freshnessProfile: "rss",
    async execute(cap) {
      return {
        tool: "fixture/news",
        capability: cap,
        transport: "fake",
        outputs: [
          {
            outputClass: "FACTUAL_OBSERVATION" as const,
            content: `${about} settled higher on inventory draws (Reuters, 2026-10-08)`,
            about,
          },
        ],
      };
    },
  };
}

/** Schema-valid `research.answer_synthesis` (the field names the engine validates against). */
function synthesisFor(answer: string): string {
  return JSON.stringify({
    directAnswer: answer,
    keyFactors: [
      {
        factor: "observed price path",
        mechanism: "each daily candle records the session's OHLCV; together they form the requested path",
        direction: "up",
        evidenceRefs: [],
        counterevidenceRefs: [],
        evidenceQuality: "DIRECT_EVIDENCE",
        evidenceDirectness: "DIRECT",
      },
    ],
    whatWouldChangeTheView: [],
    implication: "a factual reconstruction of the observed OHLCV path, not a forecast",
    uncertainty: [],
    confidence: "LOW",
    citedObjectRefs: [],
  });
}

function planFor(question: string, capabilities: string[]): string {
  return JSON.stringify({
    objective: question,
    scopeIncluded: ["market"],
    scopeExcluded: [],
    tasks: [{ type: "FACT_FINDING", objective: question, capabilities, completion: "covered or absence recorded" }],
    requirements: [],
    completionCriteria: ["requirements covered or honest insufficiency"],
    adaptationPolicy: "n/a",
  });
}

const ANSWER =
  "WTI crude oil (CL=F) rose over the last seven days, with the daily close moving from 86.5 on 2026-10-02 to 91.85 on 2026-10-09. The period high was 92.4 and the low was 85.4, and trading volume ranged from 198,000 to 301,000 contracts per session.";

/** The rs_000382 wiring: Bitget primary offline -> equity OHLCV -> current-quote snapshot. */
function productionRegistry(options: { readonly chart?: (symbol: string) => unknown } = {}) {
  const registry = new CapabilityRegistry();
  registry.register(offlinePrimary());
  registry.register(new EquityMarketDataAdapter(fakeYahoo("CL=F", OIL_SESSIONS, 89.43)));
  registry.register(new MarketRegimeAdapter(fakeRegimeChart("CL=F", 91.85, 89.43)), 150);
  registry.register(newsCapability("crude oil"), 200);
  void options;
  return registry;
}

async function runOilViaMarketDataAnalysis(
  registry: CapabilityRegistry,
  workspace = new Workspace(),
  store = new MemoryStore(),
  provider: FakeModelProvider = new FakeModelProvider(
    new Map<string, unknown>([
      ["research.plan", planFor(OIL_QUESTION, ["MARKET_DATA_ANALYSIS", "NEWS_ANALYSIS"])],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["research.answer_synthesis", synthesisFor(ANSWER)],
    ]),
  ),
): Promise<{ outcome: AdaptiveLoopOutcome; workspace: Workspace }> {
  const research = workspace.addResearch({ objective: OIL_QUESTION, question: OIL_QUESTION, flow: "WHAT_HAPPENED" }, origin);
  workspace.transitionResearch(research.id, "ACTIVE", origin, "activated");
  const outcome = await runAdaptiveResearch(OIL_QUESTION, research.id, {
    provider,
    registry,
    workspace,
    store,
    capabilityParams: { asset: "CL=F", question: OIL_QUESTION },
    maxRounds: 2,
    now: () => NOW,
  });
  return { outcome, workspace };
}

beforeEach(() => resetIdCounters());

describe("the generic MARKET_DATA_ANALYSIS chain reaches the OHLCV series provider (rs_000382)", () => {
  it("a 7-day ask is served by the price-series provider, never a 5-day snapshot", async () => {
    const { outcome } = await runOilViaMarketDataAnalysis(productionRegistry());

    const marketRuns = outcome.executions.filter((e) => e.capability === "MARKET_DATA_ANALYSIS");
    expect(marketRuns).toHaveLength(1);
    // The series provider served it (the offline primary and the snapshot provider did not).
    expect(marketRuns[0]!.result.tool).toBe("equity/yahoo-chart");
    // And the request itself asked for a range that COVERS seven days.
    expect(marketRuns[0]!.result.invocation.params.range).not.toBe("5d");
    // No current-quote snapshot reached this run's evidence.
    const snapshotEvidence = outcome.evidence.filter((e) => e.observation.includes("market_regime_observable"));
    expect(snapshotEvidence).toEqual([]);

    // Historical OHLCV observations survive normalization: one series carrying every candle.
    const series = outcome.evidence
      .map((e) => e.observation)
      .map((text) => {
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((v): v is Record<string, unknown> => v !== undefined)
      .find((v) => Array.isArray(v["candles"]));
    expect(series, "a retrieved OHLCV series must exist in the evidence").toBeDefined();
    const candles = series!["candles"] as Record<string, unknown>[];
    expect(candles).toHaveLength(OIL_SESSIONS.length);
    for (const candle of candles) {
      expect(typeof candle["ts"]).toBe("string");
      for (const field of ["open", "high", "low", "close"]) expect(typeof candle[field]).toBe("number");
    }
    // Every retrieved observation survives with its own timestamp and OHLCV fields (the earliest
    // session included), so the price path is preserved even when the window summary is narrower.
    expect(candles[0]!["ts"]).toBe("2026-10-02");
    expect(candles[0]!["low"]).toBe(85.4);
    expect(candles[0]!["volume"]).toBe(221_000);

    // Period high/low are computed from the candles INSIDE the requested window, never invented
    // (the documented boundary rule: a 7-day window ending Fri 2026-10-09 spans back to
    // 2026-10-03; the 2026-10-02 session is outside it and its 85.4 low is therefore not the
    // window's low — `basis` names the sessions actually used).
    const windowSummary = outcome.evidence
      .map((e) => e.observation)
      .map((text) => {
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((v): v is Record<string, unknown> => v !== undefined)
      .find((v) => v["metric"] === "ohlcv_window");
    expect(windowSummary?.["high"]).toBe(92.4);
    expect(windowSummary?.["low"]).toBe(86.2);
    expect(windowSummary?.["sessions"]).toBe(5);
    expect(String(windowSummary?.["basis"])).toContain("2026-10-03 to 2026-10-09");

    // Every CRITICAL row of the 7-day question is satisfied, including the windowed ones.
    const critical = (outcome.requirements ?? []).filter((r) => r.importance === "CRITICAL");
    expect(critical.length).toBeGreaterThan(0);
    for (const row of critical) expect(row.status, `row "${row.description}"`).toBe("SATISFIED");
    const windowed = (outcome.requirements ?? []).filter((r) => (r.windowHours ?? 0) >= 168);
    expect(windowed.length).toBeGreaterThanOrEqual(4);
    for (const row of windowed) expect(row.status, `windowed row "${row.description}"`).toBe("SATISFIED");

    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.answer).toContain("91.85");
  });
});

describe("a current-quote provider may not stand in for a windowed series", () => {
  it("rejects a windowed series request on the fallback path, with a readable reason", async () => {
    const registry = new CapabilityRegistry();
    registry.register(offlinePrimary());
    registry.register(new MarketRegimeAdapter(fakeRegimeChart("CL=F", 91.85, 89.43)), 150);

    const result = await registry.execute(
      "MARKET_DATA_ANALYSIS",
      {
        asset: "CL=F",
        requiredFacets: ["SERIES", "HIGH", "LOW", "VOLUME", "TIMESTAMP"],
        requiredWindowHours: 168,
      },
      origin,
    );
    expect(result.failure.type).not.toBe("NONE");
    // Nothing was served: no snapshot masquerades as the window's price path.
    expect(result.normalizedOutput.every((o) => o.outputClass === "UNAVAILABLE")).toBe(true);
    const trail = JSON.stringify(result.attemptedProviders ?? []);
    expect(trail).toContain("cannot serve the requested shape");
  });

  it("still serves the current reading it really is (the gate is shape-scoped)", async () => {
    const registry = new CapabilityRegistry();
    registry.register(offlinePrimary());
    registry.register(new MarketRegimeAdapter(fakeRegimeChart("CL=F", 91.85, 89.43)), 150);

    const result = await registry.execute("MARKET_DATA_ANALYSIS", { asset: "CL=F" }, origin);
    expect(result.failure.type).toBe("NONE");
    expect(result.normalizedOutput.some((o) => JSON.stringify(o.content).includes("market_regime_observable"))).toBe(true);
  });
});

describe("OHLCV preservation, coverage and volume honesty (adapter level)", () => {
  async function execute(params: Record<string, unknown>, sessions: readonly Session[]) {
    const adapter = new EquityMarketDataAdapter(fakeYahoo("CL=F", sessions, 89.43));
    return adapter.execute("COMMODITY_MARKET_DATA", { asset: "CL=F", ...params });
  }

  it("keeps every timestamped candle and reports the requested window honestly", async () => {
    const result = await execute({ requiredWindowHours: 168 }, OIL_SESSIONS);
    const series = result.outputs.find((o) => typeof o.content === "object" && o.content !== null && "candles" in (o.content as Record<string, unknown>));
    expect(series).toBeDefined();
    const candles = (series!.content as Record<string, unknown>)["candles"] as Record<string, unknown>[];
    expect(candles).toHaveLength(6);
    expect((series!.content as Record<string, unknown>)["from"]).toBe("2026-10-02");
    expect((series!.content as Record<string, unknown>)["to"]).toBe("2026-10-09");

    const windowSummary = result.outputs.find((o) => "metric" in (o.content as Record<string, unknown>) && (o.content as Record<string, unknown>)["metric"] === "ohlcv_window");
    const body = windowSummary!.content as Record<string, unknown>;
    expect(body["high"]).toBe(92.4);
    expect(body["low"]).toBe(86.2);
    expect(body["sessions"]).toBe(5);
    expect(body["coverageComplete"]).toBe(true);
    expect(body["missingCoverage"]).toBeUndefined();
    // The full retrieved path (including the boundary session) is preserved on the series output.
    expect(candles[0]!["ts"]).toBe("2026-10-02");
  });

  it("reports an incomplete window instead of treating two sessions as a week", async () => {
    const result = await execute({ requiredWindowHours: 168 }, SHORT_SESSIONS);
    const windowSummary = result.outputs.find((o) => "metric" in (o.content as Record<string, unknown>) && (o.content as Record<string, unknown>)["metric"] === "ohlcv_window");
    const body = windowSummary!.content as Record<string, unknown>;
    expect(body["coverageComplete"]).toBe(false);
    expect(String(body["missingCoverage"])).toContain("of the requested 168h window");
    // The shortfall is also stated as a limitation on the result itself.
    expect(result.limitations.join(" ")).toContain("coverage is reported as partial");
  });

  it("never invents volume when the provider returns none", async () => {
    const result = await execute({ requiredWindowHours: 168 }, OIL_SESSIONS_NO_VOLUME);
    const series = result.outputs.find((o) => typeof o.content === "object" && o.content !== null && "candles" in (o.content as Record<string, unknown>));
    const candles = (series!.content as Record<string, unknown>)["candles"] as Record<string, unknown>[];
    for (const candle of candles) expect("volume" in candle).toBe(false);
    expect(JSON.stringify(result.outputs)).not.toContain("volume\":0");
  });
});

describe("evidence ownership and the readable partial answer", () => {
  it("keeps each run's evidence owned by that run (no cross-run leakage)", async () => {
    const workspace = new Workspace();
    const store = new MemoryStore();
    const first = await runOilViaMarketDataAnalysis(productionRegistry(), workspace, store);
    const second = await runOilViaMarketDataAnalysis(productionRegistry(), workspace, store);

    const firstIds = new Set(first.outcome.evidence.map((e) => e.id));
    const secondIds = new Set(second.outcome.evidence.map((e) => e.id));
    expect(firstIds.size).toBeGreaterThan(0);
    for (const id of secondIds) expect(firstIds.has(id)).toBe(false);

    // The run object owns exactly the evidence the outcome reports.
    const researchRefs = workspace.getResearch(first.outcome.research.id)?.evidenceRefs ?? [];
    expect(new Set(researchRefs)).toEqual(firstIds);
  });

  it("renders a readable, evidence-grounded partial answer when no synthesis survives", async () => {
    // No scripted `research.answer_synthesis`: the synthesis call fails, so the loop must fall back
    // to the deterministic, evidence-grounded partial instead of returning no answer at all. The
    // news capability is absent, so the question's "reported news" row stays unmet — the partial
    // answer must say so rather than claim completeness.
    const provider = new FakeModelProvider(
      new Map<string, unknown>([
        ["research.plan", planFor(OIL_QUESTION, ["MARKET_DATA_ANALYSIS"])],
        ["research.adaptive_decision", responses.adaptiveDecision("INSUFFICIENT_EVIDENCE")],
      ]),
    );
    const registry = new CapabilityRegistry();
    registry.register(offlinePrimary());
    registry.register(new EquityMarketDataAdapter(fakeYahoo("CL=F", OIL_SESSIONS, 89.43)));
    registry.register(new MarketRegimeAdapter(fakeRegimeChart("CL=F", 91.85, 89.43)), 150);
    const { outcome } = await runOilViaMarketDataAnalysis(registry, new Workspace(), new MemoryStore(), provider);

    expect(outcome.answer).toBeDefined();
    const answer = outcome.answer!;
    // Readable: the observed price path, not a raw JSON payload.
    expect(answer).toContain("**What happened**");
    expect(answer).toContain("CL=F");
    expect(answer).toContain("91.85");
    expect(answer).not.toContain('"candles"');
    // Market observations and reported news are separated, and open rows are named.
    expect(answer).toContain("**What is reported**");
    expect(answer).toContain("**Missing evidence**");
    expect(answer).not.toContain("Nothing outstanding");
    // The readable partial is presentation only: the ledger still records the unmet row, and the
    // stop reason is never upgraded to sufficiency by the presence of prose.
    expect(outcome.requirements?.some((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED")).toBe(true);
    expect(outcome.stoppedBecause).not.toBe("EVIDENCE_SUFFICIENT");

    // Serialization: the answer and the evidence refs survive a JSON round-trip unchanged.
    const serialized = JSON.parse(JSON.stringify({ answer, evidence: outcome.evidence.map((e) => e.id) })) as {
      answer: string;
      evidence: string[];
    };
    expect(serialized.answer).toBe(answer);
    expect(serialized.evidence).toEqual(outcome.evidence.map((e) => e.id));
  });
});

describe("bounded recovery and the budget-stopped partial answer", () => {
  /** A market-data capability whose call consumes wall clock, then reports a text reading. */
  function timedMarketData(clock: { now: number }): ProviderAdapter {
    return {
      providerId: "fixture/timed-market-data",
      capabilities: ["MARKET_DATA_ANALYSIS"],
      limitations: ["fixture"],
      freshnessProfile: "test:live",
      async execute(cap) {
        clock.now += 60_000;
        return {
          tool: "fixture/timed-market-data",
          capability: cap,
          transport: "fake",
          outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION" as const, content: "CL=F traded near 91 this week", about: "CL=F" }],
        };
      },
    };
  }

  it("explains why no recovery round ran, keeps the status insufficient, and still answers readably", async () => {
    const START = Date.parse("2026-10-09T20:00:00Z");
    const clock = { now: START };
    const registry = new CapabilityRegistry();
    registry.register(timedMarketData(clock));
    // No `research.answer_synthesis` scripted: the synthesis call fails, so the deterministic
    // partial renderer must carry the answer.
    const provider = new FakeModelProvider(
      new Map<string, unknown>([
        ["research.plan", planFor(OIL_QUESTION, ["MARKET_DATA_ANALYSIS"])],
        [
          "research.adaptive_decision",
          responses.adaptiveDecision("CONTINUE", [
            { type: "FACT_FINDING", objective: OIL_QUESTION, capabilities: ["MARKET_DATA_ANALYSIS"], completion: "c" },
          ]),
        ],
      ]),
    );
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: OIL_QUESTION, question: OIL_QUESTION, flow: "WHAT_HAPPENED" }, origin);
    workspace.transitionResearch(research.id, "ACTIVE", origin, "activated");
    const outcome = await runAdaptiveResearch(OIL_QUESTION, research.id, {
      provider,
      registry,
      workspace,
      store: new MemoryStore(),
      capabilityParams: { asset: "CL=F", question: OIL_QUESTION },
      deadlineMs: START + 60_000,
      taskWindowMs: 45_000,
      maxRounds: 2,
      now: () => new Date(clock.now),
    });

    expect(outcome.stoppedBecause).toBe("TIME_BUDGET_EXHAUSTED");
    // Bounded recovery: no round ran, and the decision SAYS why (the deadline headroom the gate
    // itself uses), instead of leaving a bare zero beside pending CRITICAL rows.
    expect(outcome.recoveryRounds).toBe(0);
    const criticalUnresolved = (outcome.requirements ?? []).filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED");
    expect(criticalUnresolved.length).toBeGreaterThan(0);
    expect(outcome.finalDecision.rationale).toContain("No recovery round was scheduled");
    expect(outcome.finalDecision.rationale).toMatch(/headroom|round budget/);
    // The same explanation travels STRUCTURALLY (diagnostics), not only as prose in a rationale.
    expect(outcome.recoverySkippedReason).toBeDefined();
    expect(outcome.recoverySkippedReason).toContain("No recovery round was scheduled");
    expect(JSON.parse(JSON.stringify({ recoveryNote: outcome.recoverySkippedReason })).recoveryNote).toBe(outcome.recoverySkippedReason);
    // The status stays insufficient (the run object the API maps to INSUFFICIENT).
    expect(outcome.research.status).toBe("FAILED");
    // …and the trader still gets a readable partial answer naming what is missing.
    expect(outcome.answer).toBeDefined();
    const answer = outcome.answer!;
    expect(answer).toContain("**What happened**");
    expect(answer).toContain("91");
    expect(answer).toContain("**Missing evidence**");
    expect(answer).not.toContain("Nothing outstanding");
    expect(JSON.parse(JSON.stringify({ answer, evidence: outcome.evidence.map((e) => e.id) })).answer).toBe(answer);
  });
});

describe("readable rendering of a market-data series (presentation law)", () => {
  it("renders a series payload as timestamped OHLCV rows, not raw JSON", () => {
    const payload = JSON.stringify({
      symbol: "CL=F",
      interval: "1d",
      from: "2026-10-02",
      to: "2026-10-09",
      sessions: 2,
      candles: [
        { ts: "2026-10-08", open: 87.3, high: 89.6, low: 87.1, close: 89.43, volume: 260_000 },
        { ts: "2026-10-09", open: 89.5, high: 92.4, low: 89.2, close: 91.85, volume: 301_000 },
      ],
    });
    const rendered = readableObservation(payload, 4000);
    expect(rendered).toContain("CL=F 1d candles");
    expect(rendered).toContain("2026-10-09 | open 89.5 | high 92.4 | low 89.2 | close 91.85 | volume 301.00K");
    expect(rendered).not.toContain('"candles"');
  });
});
