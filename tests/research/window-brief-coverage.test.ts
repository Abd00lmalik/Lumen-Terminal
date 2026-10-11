/**
 * WINDOW-BRIEF COVERAGE regression (the rs_000380 "crude oil over the last 7 days" failure).
 *
 * Root cause this pins (two coupled defects, both fixed; neither is CL=F-specific):
 *  1. `candleOutputs` emitted each candle as its own `ToolOutput` with NO `sourceTimestamp`, so
 *     every candle measured `coverageHours=0` and carried no `observedAt`. The MC-6 group
 *     assembler (`assembledGroupItems`) measured a response's joint span from its members' own
 *     observation times, and with every member time missing it computed a 0-hour span. The span
 *     gate (`windowCovers`) then rejected every window-bearing row (period high, low, volume,
 *     the price sequence) and the run ended `REQUIREMENT_GAPS_UNRESOLVED` even though six daily
 *     candles spanning the full week had been retrieved.
 *  2. `SERIES` was inferred only from a SINGLE payload's arity (`tableFacets`: >1 priced
 *     observation in one payload). Because each candle is its own single-row output, no member
 *     and no facet union carried `SERIES`, so the "timestamped price sequence" row still failed
 *     (demanded ["SERIES","TIMESTAMP","SNAPSHOT"], missing exactly ["SERIES"]).
 *
 * The fixes (equity.ts stamps each candle's bar time as `sourceTimestamp`; requirements.ts
 * measures the group's span from its members' times and infers `SERIES` from >=2 priced members)
 * are generic. These tests exercise the REAL adaptive engine and the REAL equity adapter against
 * a deterministic scripted transport, for the exact oil question AND a non-CL=F equity question,
 * and assert that the windowed rows are SATISFIED and a readable, on-subject answer is produced.
 * Deterministic mocked fixtures; no network; clock pinned so the week is never read as stale.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { EquityMarketDataAdapter } from "../../src/adapters/equity.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";

const origin = { kind: "agent" as const, detail: "window-brief regression" };
/** Deterministic clock: the week under study ends here, so nothing reads as stale. */
const NOW = new Date("2026-10-09T20:00:00.000Z");

interface Session {
  readonly d: string;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}

/** Seven trading sessions spanning two calendar weeks (the shape rs_000380 received). */
const OIL_SESSIONS: readonly Session[] = [
  { d: "2026-10-02", o: 86.1, h: 87.0, l: 85.4, c: 86.5, v: 221_000 },
  { d: "2026-10-03", o: 86.6, h: 88.2, l: 86.2, c: 87.9, v: 245_000 },
  { d: "2026-10-06", o: 88.0, h: 89.1, l: 87.5, c: 88.6, v: 198_000 },
  { d: "2026-10-07", o: 88.4, h: 88.9, l: 86.8, c: 87.2, v: 233_000 },
  { d: "2026-10-08", o: 87.3, h: 89.6, l: 87.1, c: 89.43, v: 260_000 },
  { d: "2026-10-09", o: 89.5, h: 92.4, l: 89.2, c: 91.85, v: 301_000 },
];

/** An unrelated equity's week, to prove the window-brief fix is not CL=F-specific. */
const AAPL_SESSIONS: readonly Session[] = [
  { d: "2026-10-02", o: 330.1, h: 331.0, l: 325.4, c: 326.57, v: 41_000_000 },
  { d: "2026-10-03", o: 330.2, h: 338.0, l: 329.9, c: 337.0, v: 36_632_800 },
  { d: "2026-10-06", o: 337.5, h: 340.2, l: 334.1, c: 339.8, v: 38_100_000 },
  { d: "2026-10-07", o: 339.0, h: 344.5, l: 338.2, c: 343.1, v: 40_200_000 },
  { d: "2026-10-08", o: 343.9, h: 349.0, l: 342.0, c: 347.6, v: 44_800_000 },
  { d: "2026-10-09", o: 348.2, h: 352.4, l: 346.0, c: 351.2, v: 47_500_000 },
];

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
            fullExchangeName: symbol.endsWith("=F") ? "NYMEX" : "NasdaqGS",
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

/** Duck-typed RestTransport double: serves the chart body for the one symbol under test. */
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

/** A capability that resolves immediately with one on-subject observation. */
function fastCapability(capability: string, about: string): ProviderAdapter {
  return {
    providerId: `fast/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fast/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [
          { outputClass: "QUANTITATIVE_OBSERVATION" as const, content: `${about} reading this week`, about },
        ],
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
    implication: "the conclusion rests only on the observed OHLCV path; a factual reconstruction, not a forecast",
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

async function runOilWeek(): Promise<AdaptiveLoopOutcome> {
  const question =
    "What happened to crude oil prices over the last 7 days? Summarize the observed price movement using timestamped market data, including the starting and latest observed prices, period high and low, and available trading volume. Separate observed market data from reported news. Cite the source and timestamp for each numerical claim. Identify missing data explicitly. Do not give trading advice.";
  const registry = new CapabilityRegistry();
  registry.register(new EquityMarketDataAdapter(fakeYahoo("CL=F", OIL_SESSIONS, 89.43)), 100);
  registry.register(fastCapability("MARKET_DATA_ANALYSIS", "crude oil"), 150);
  registry.register(newsCapability("crude oil"), 200);
  const provider = new FakeModelProvider(
    new Map<string, unknown>([
      ["research.plan", planFor(question, ["COMMODITY_MARKET_DATA", "MARKET_DATA_ANALYSIS", "NEWS_ANALYSIS"])],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      [
        "research.answer_synthesis",
        synthesisFor(
          "WTI crude oil (CL=F) rose over the last seven days, with the daily close moving from 86.5 on 2026-10-02 to 91.85 on 2026-10-09, a gain of about 6.2%. The period high was 92.4 and the low was 85.4, and trading volume increased across the window from 221,000 to 301,000 contracts per session.",
        ),
      ],
    ]),
  );
  const ws = new Workspace();
  const research = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, origin);
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  return runAdaptiveResearch(question, research.id, {
    provider,
    registry,
    workspace: ws,
    store: new MemoryStore(),
    capabilityParams: { asset: "CL=F", question },
    maxRounds: 2,
    now: () => NOW,
  });
}

async function runAaplWeek(): Promise<AdaptiveLoopOutcome> {
  const question =
    "What happened to AAPL stock over the last 7 days? Summarize the observed price movement using timestamped market data, including the starting and latest observed prices, period high and low, and available trading volume.";
  const registry = new CapabilityRegistry();
  registry.register(new EquityMarketDataAdapter(fakeYahoo("AAPL", AAPL_SESSIONS, 326.57)), 100);
  registry.register(fastCapability("MARKET_DATA_ANALYSIS", "AAPL"), 150);
  const provider = new FakeModelProvider(
    new Map<string, unknown>([
      ["research.plan", planFor(question, ["EQUITY_MARKET_DATA", "MARKET_DATA_ANALYSIS"])],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      [
        "research.answer_synthesis",
        synthesisFor(
          "AAPL rose over the last seven days, with the daily close moving from 326.57 on 2026-10-02 to 351.2 on 2026-10-09, a gain of about 7.5%. The period high was 352.4 and the low was 325.4.",
        ),
      ],
    ]),
  );
  const ws = new Workspace();
  const research = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, origin);
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  return runAdaptiveResearch(question, research.id, {
    provider,
    registry,
    workspace: ws,
    store: new MemoryStore(),
    capabilityParams: { asset: "AAPL", question },
    maxRounds: 2,
    now: () => NOW,
  });
}

beforeEach(() => resetIdCounters());

describe("crude oil 7-day window (rs_000380 reproduction)", () => {
  it("the assembled candle group covers the 168h window and every CORE row is SATISFIED", async () => {
    const outcome = await runOilWeek();

    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.requirements).toBeDefined();
    const critical = (outcome.requirements ?? []).filter((r) => r.importance === "CRITICAL");
    expect(critical.length).toBeGreaterThan(0);
    for (const r of critical) {
      expect(r.status, `requirement "${r.description}"`).toBe("SATISFIED");
    }
    // The window-bearing rows specifically: high, low, volume, and the price sequence.
    const windowed = (outcome.requirements ?? []).filter((r) => r.windowHours !== undefined && r.windowHours >= 168);
    expect(windowed.length).toBeGreaterThanOrEqual(4);
    for (const r of windowed) expect(r.status, `windowed row "${r.description}"`).toBe("SATISFIED");
  });

  it("produces a readable, on-subject answer (never the empty INSUFFICIENT blank)", async () => {
    const outcome = await runOilWeek();
    expect(outcome.answer).toBeDefined();
    const answer = outcome.answer!;
    expect(answer.length).toBeGreaterThan(0);
    // On-subject and evidence-backed: it names the instrument and quotes the observed path.
    expect(answer).toContain("CL=F");
    expect(answer).toContain("91.85");
    expect(answer).toContain("86.5");
    expect(outcome.evidence.length).toBeGreaterThan(0);
  });
});

describe("non-CL=F equity week (the fix is not oil-specific)", () => {
  it("an AAPL 7-day OHLCV week also covers the window and answers", async () => {
    const outcome = await runAaplWeek();

    const critical = (outcome.requirements ?? []).filter((r) => r.importance === "CRITICAL");
    expect(critical.length).toBeGreaterThan(0);
    const open = (outcome.requirements ?? [])
      .filter((r) => r.status !== "SATISFIED" && r.status !== "UNAVAILABLE" && r.status !== "EXHAUSTED")
      .map((r) => `${r.role}/${r.importance} ${r.status} :: ${r.description} :: missing=${r.missingReason ?? "n/a"}`);
    expect(open, `open rows:\n${open.join("\n")}`).toEqual([]);
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.answer).toBeDefined();
    expect(outcome.answer!.length).toBeGreaterThan(0);
    expect(outcome.answer).toContain("AAPL");
    expect(outcome.answer).toContain("351.2");
  });
});
