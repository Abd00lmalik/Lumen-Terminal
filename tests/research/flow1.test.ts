/**
 * Flow 1; WHAT HAPPENED?; end-to-end behavioral tests with REALISTIC Bitget response fixtures.
 *
 * The fixtures replicate the shapes DISCOVERED live on 2026-09-13 (see FINDINGS.md §7):
 * - MCP: session handshake (handled by the transport), `news_feed` returning a JSON array of
 *   { feed, error, items[{title, link, published, summary}] }, `technical_analysis` returning
 *   the full_analysis object with mixed observations + verdict fields.
 * - These are mocked-transport tests; live endpoint validation lives in
 *   tests/research/flow1.live.test.ts and is skipped unless FREEBUFF_LIVE=1.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runFlow1, resolveFlow1Target, buildFlow1Plan } from "../../src/research/flow1.js";
import { CapabilityRegistry, HistoricalDataStub, WebRetrievalStub } from "../../src/adapters/capability-registry.js";
import {
  createBitgetAdapterSet,
  createNewsBriefingAdapter,
  createMacroAnalystAdapter,
  createMarketIntelAdapter,
  createSentimentAnalystAdapter,
} from "../../src/adapters/bitget-skills.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeMcpTransport, FakeRestTransport } from "../adapters/fakes.js";

const origin = { kind: "agent" as const, detail: "test" };

// ---------------------------------------------------------------------------
// Realistic fixtures (live-discovered shapes, 2026-09-13)
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-13T12:00:00.000Z");

/** news_feed response: JSON array of per-feed records with items (live-discovered envelope). */
function newsFeedFixture(feeds: Array<{ feed: string; error?: string; titles?: string[] }>): string {
  return JSON.stringify(
    feeds.map((f, fi) => ({
      feed: f.feed,
      error: f.error ?? "",
      items: (f.titles ?? []).map((title, i) => ({
        title,
        link: `https://example.com/${f.feed}/${i}`,
        published: new Date(NOW - (fi * 2 + i + 1) * 1_800_000).toISOString(), // staggered, recent
        summary: `${title}; full text`,
      })),
    })),
  );
}

/** technical_analysis full_analysis response (live-discovered shape, real values observed). */
const TECHNICAL_FIXTURE = JSON.stringify({
  symbol: "BTC/USDT",
  timeframe: "1h",
  rsi: { rsi: 31.89, period: 14, signal: "neutral" },
  macd: { macd: -97.699286, signal: -44.241251, histogram: -53.458034, cross: "death_cross" },
  bollinger: { upper: 76862.1741, middle: 77201.738, lower: 77541.3019, bandwidth: -0.0088, pct_b: 1.151, position: "below_lower" },
  ma: { price: 76759.63, ma7: 77078.2443, ma25: 77231.188, ma99: 77643.8751, trend: "bear" },
  atr: { atr: 187.0544, atr_pct: 0.24, suggested_stop: 76479.0484, period: 14 },
  support_resistance: { supports: [77054.0, 77114.99, 77218.0], resistances: [77461.24, 79242.56], current_price: 76759.63 },
  verdict: "STRONG BEARISH",
  bull_signals: 1,
  bear_signals: 4,
});

function makeRegistry(mcp: FakeMcpTransport, rest: FakeRestTransport): CapabilityRegistry {
  // fallbacks disabled: these fixtures assert PRIMARY-provider laws deterministically
  // enabling the live fallback adapters here would fetch real RSS feeds in unit tests.
  // Fallback-specific laws are covered in tests/adapters/fallback-providers.test.ts.
  return createBitgetAdapterSet({ mcp: mcp as never, rest: rest as never, fallbacks: false }).registry;
}

function makeFixtureEnv() {
  const mcp = new FakeMcpTransport();
  const rest = new FakeRestTransport();
  const registry = makeRegistry(mcp, rest);
  const workspace = new Workspace();
  const store = new MemoryStore();
  let clock = NOW;
  const now = () => new Date(clock);
  return { mcp, rest, registry, workspace, store, now, tick: () => { clock += 1; } };
}

const baseRequest = {
  question: "BTC just moved sharply in the last few hours. What happened?",
  asset: "BTC",
  window: ["2026-09-13T06:00:00.000Z", "2026-09-13T12:00:00.000Z"] as const,
};

describe("Flow 1; intent/target stub (M2 scope: narrow, structured; full LUI is M3)", () => {
  beforeEach(() => resetIdCounters());

  it("resolves the target; window stays unresolved when not provided (no fabricated precision)", () => {
    const target = resolveFlow1Target({ question: "q", asset: "ETH" });
    expect(target).toEqual({ asset: "ETH", window: undefined, windowResolved: false });
    const withWindow = resolveFlow1Target(baseRequest);
    expect(withWindow.windowResolved).toBe(true);
  });

  it("plan declares CAPABILITIES (never skills/tools) and adds positioning only for resolved windows", () => {
    const plan = buildFlow1Plan(baseRequest, "res_1");
    const allCapabilities = plan.tasks.flatMap((t) => t.capabilities);
    expect(allCapabilities).toContain("TECHNICAL_ANALYSIS");
    expect(allCapabilities).toContain("NEWS_ANALYSIS");
    // capability-first: no skill or tool names leak into the plan (final lock §6/§11).
    // (Tool names checked exactly; "TECHNICAL_ANALYSIS" is both a capability and the MCP tool
    // name, so a case-insensitive substring test would false-positive on the capability itself.)
    const toolNames = ["news_feed", "macro_indicators", "derivatives_sentiment", "crypto_market"];
    for (const capability of allCapabilities) {
      expect(toolNames).not.toContain(capability);
      expect(capability).not.toContain("bitget");
      expect(capability).not.toContain("/");
    }
    const planNoWindow = buildFlow1Plan({ question: "q", asset: "BTC" }, "res_1");
    const capsNoWindow = planNoWindow.tasks.flatMap((t) => t.capabilities);
    expect(capsNoWindow).not.toContain("SENTIMENT_ANALYSIS"); // material only when window resolved
    expect(planNoWindow.scope.excluded.join(" ")).toContain("historical precedent");
  });
});

describe("Flow 1; end-to-end with realistic Bitget fixtures (mocked transport)", () => {
  beforeEach(() => resetIdCounters());

  it("executes the full path: request → target → plan → capabilities → evidence → claims → analysis → judgment → persistence → response", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { content: [{ type: "text", text: TECHNICAL_FIXTURE }] },
      { content: [{ type: "text", text: newsFeedFixture([{ feed: "cointelegraph", titles: ["Bitcoin ETF sees record inflows as market rebounds"] }, { feed: "coindesk", error: "upstream timeout" }]) }] },
    );

    const outcome = await runFlow1(baseRequest, env);

    // full pipeline objects exist in the workspace
    const researches = env.workspace.listResearch();
    expect(researches).toHaveLength(1);
    expect(researches[0]!.flow).toBe("WHAT_HAPPENED");
    expect(researches[0]!.status).toBe("COMPLETED");
    expect(env.workspace.listEvidence().length).toBeGreaterThan(0);
    expect(env.workspace.listClaims()).toHaveLength(2);
    expect(env.workspace.listAnalyses()).toHaveLength(1);
    expect(outcome.judgment).toBeDefined();
    expect(env.workspace.listJudgments()).toHaveLength(1);

    // technical outputs are split: numeric observations AND labeled interpretation
    const taEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "TECHNICAL_ANALYSIS");
    const classes = new Set(taEvidence.map((e) => e.evidenceClass));
    expect(classes.has("OBSERVATION")).toBe(true);
    expect(classes.has("DERIVED_OBSERVATION")).toBe(true);
    // verdict fields must be in the interpretation evidence, never in an observation
    const interpretationEvidence = taEvidence.find((e) => e.evidenceClass === "DERIVED_OBSERVATION")!;
    expect(interpretationEvidence.observation).toContain("STRONG BEARISH");
    const observationEvidence = taEvidence.find((e) => e.evidenceClass === "OBSERVATION")!;
    expect(observationEvidence.observation).not.toContain("STRONG BEARISH");
    expect(observationEvidence.observation).toContain("rsi");

    // news evidence is item-level with per-feed failures preserved (feed-level error → no evidence for that feed)
    const newsEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "NEWS_ANALYSIS");
    expect(newsEvidence.length).toBeGreaterThanOrEqual(1);
    expect(newsEvidence.some((e) => e.observation.includes("Bitcoin ETF sees record inflows"))).toBe(true);

    // provenance: evidence → tool result chain
    for (const evidence of env.workspace.listEvidence()) {
      expect(evidence.toolResultRef).toMatch(/^tr_/);
      expect(evidence.sourceRefs.length).toBeGreaterThan(0);
      expect(evidence.provenance.length).toBeGreaterThan(0);
    }

    // judgment preserves the trader question and separates uncertainty
    expect(outcome.judgment!.statement).toContain("reconstruction, not causal explanation");
    expect(outcome.judgment!.uncertainty.length).toBeGreaterThan(0);
    expect(outcome.judgment!.provenance[0]!.origin.kind).toBe("agent");

    // persistence: workspace saved and reloadable with the full graph (MemoryStore.load
    // already returns a reconstructed Workspace; no manual re-hydration needed)
    const restored = await env.store.load();
    expect(restored).toBeDefined();
    expect(restored!.listEvidence().length).toBe(env.workspace.listEvidence().length);
    expect(restored!.listJudgments()).toHaveLength(1);

    // concise progressive-disclosure response (no chain-of-thought dump)
    expect(outcome.response).toContain("**Answer:**");
    expect(outcome.response).toContain("**Confidence:**");
    expect(outcome.response.length).toBeLessThan(2000);
    expect(outcome.completion).toBe("COMPLETE");
  });

  it("news per-feed errors stay UNAVAILABLE → PARTIAL completeness, never fabricated over", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { content: [{ type: "text", text: TECHNICAL_FIXTURE }] },
      { content: [{ type: "text", text: newsFeedFixture([{ feed: "a", titles: ["Bitcoin hack at exchange drags market"] }, { feed: "b", error: "feed unreachable" }]) }] },
    );
    const outcome = await runFlow1(baseRequest, env);
    const newsResult = outcome.executions.find((e) => e.capability === "NEWS_ANALYSIS")!.result;
    expect(newsResult.completeness).toBe("PARTIAL");
    expect(newsResult.limitations.join(" ")).toMatch(/unavailable|error/i);
    // the failed feed produced no evidence, the healthy one did
    const newsEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "NEWS_ANALYSIS");
    expect(newsEvidence.every((e) => !e.observation.includes("feed unreachable"))).toBe(true);
  });

  it("preserves contradictions when feed coverage disagrees (never resolved by deletion)", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { content: [{ type: "text", text: TECHNICAL_FIXTURE }] },
      {
        content: [{
          type: "text",
          text: newsFeedFixture([
            { feed: "bullish", titles: ["Bitcoin ETF inflows surge to record highs"] },
            { feed: "bearish", titles: ["Exchange hack triggers massive bitcoin outflows"] },
          ]),
        }],
      },
    );
    const outcome = await runFlow1(baseRequest, env);
    const analysis = env.workspace.listAnalyses()[0]!;
    expect(analysis.findings.join(" ")).toContain("contradictions observed");
    // both directions survive in the graph
    const newsEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "NEWS_ANALYSIS");
    expect(newsEvidence.some((e) => e.observation.includes("inflows"))).toBe(true);
    expect(newsEvidence.some((e) => e.observation.includes("outflows"))).toBe(true);
    expect(outcome.response).toContain("**Contradictions:**");
  });

  it("tool failure is NOT negative evidence: failed capability leaves the graph empty but records the failure", async () => {
    const env = makeFixtureEnv();
    // news succeeds, technical fails permanently
    env.mcp.script(
      { error: new (await import("../../src/adapters/transports/resilience.js")).TransportError("PROVIDER_ERROR", "mcp tool exploded", { retriable: false }) },
      { content: [{ type: "text", text: newsFeedFixture([{ feed: "cointelegraph", titles: ["Bitcoin ETF approved"] }]) }] },
    );
    const outcome = await runFlow1(baseRequest, env);

    const taExecution = outcome.executions.find((e) => e.capability === "TECHNICAL_ANALYSIS")!;
    expect(taExecution.result.failure.type).toBe("PROVIDER_ERROR");
    expect(taExecution.evidenceIds).toHaveLength(0);

    const taEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "TECHNICAL_ANALYSIS");
    expect(taEvidence).toHaveLength(0); // failure created NO evidence; neither positive nor negative

    // graceful insufficient-evidence completion with honest framing
    expect(outcome.completion).toBe("INSUFFICIENT_EVIDENCE");
    expect(outcome.judgment!.confidence).toBe("LOW");
    expect(outcome.judgment!.statement).toContain("data-availability outcome, not a negative finding");
    expect(outcome.response).toContain("Insufficient evidence");
  });

  it("all providers failing → graceful completion, no evidence, no fabricated judgment content", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { error: new (await import("../../src/adapters/transports/resilience.js")).TransportError("TIMEOUT", "down", { retriable: false }) },
      { error: new (await import("../../src/adapters/transports/resilience.js")).TransportError("TIMEOUT", "down", { retriable: false }) },
    );
    const outcome = await runFlow1(baseRequest, env);
    expect(outcome.completion).toBe("INSUFFICIENT_EVIDENCE");
    expect(env.workspace.listEvidence()).toHaveLength(0);
    expect(outcome.executions.every((e) => e.result.failure.type !== "NONE")).toBe(true);
    expect(outcome.judgment!.statement).toContain("price evidence unavailable");
    expect(outcome.judgment!.statement).toContain("news evidence unavailable");
  });

  it("UNAVAILABLE tool outputs never become evidence (UNAVAILABLE skill text path)", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { content: [{ type: "text", text: TECHNICAL_FIXTURE }] },
      { content: [{ type: "text", text: "Data temporarily unavailable for this source" }] },
    );
    const outcome = await runFlow1(baseRequest, env);
    const newsEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "NEWS_ANALYSIS");
    expect(newsEvidence).toHaveLength(0);
    const newsResult = outcome.executions.find((e) => e.capability === "NEWS_ANALYSIS")!.result;
    expect(newsResult.completeness).toBe("EMPTY");
    expect(outcome.completion).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("stale news evidence keeps its STALE freshness (stale ≠ deleted, stale ≠ invalid)", async () => {
    const env = makeFixtureEnv();
    const oldNews = JSON.stringify([
      { feed: "old_feed", error: "", items: [{ title: "Bitcoin rally continues", link: "https://x/1", published: new Date(NOW - 6 * 60 * 60 * 1000).toISOString() }] },
    ]);
    env.mcp.script(
      { content: [{ type: "text", text: TECHNICAL_FIXTURE }] },
      { content: [{ type: "text", text: oldNews }] },
    );
    const outcome = await runFlow1(baseRequest, env);
    const newsResult = outcome.executions.find((e) => e.capability === "NEWS_ANALYSIS")!.result;
    expect(newsResult.freshness).toBe("STALE"); // 6h old vs 60-min RSS profile
    const newsEvidence = env.workspace.listEvidence().filter((e) => e.evidenceType === "NEWS_ANALYSIS");
    expect(newsEvidence.length).toBeGreaterThan(0);
    expect(newsEvidence.every((e) => e.freshness === "STALE")).toBe(true);
  });

  it("REST klines fallback serves TECHNICAL_ANALYSIS when the MCP tool fails (registry-level fallback inside the adapter)", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { error: new (await import("../../src/adapters/transports/resilience.js")).TransportError("PROVIDER_ERROR", "mcp technical_analysis down", { retriable: false }) },
      { content: [{ type: "text", text: newsFeedFixture([{ feed: "cointelegraph", titles: ["Bitcoin ETF sees record inflows"] }]) }] },
    );
    const now = Date.now();
    env.rest.script({ body: JSON.stringify({ code: "00000", data: [
      { ts: String(now - 3600_000), open: "42000", high: "42300", low: "41900", close: "42100", baseVolume: "10", quoteVolume: "10" },
      { ts: String(now), open: "42100", high: "42400", low: "42000", close: "42300", baseVolume: "10", quoteVolume: "10" },
    ] }) });

    const outcome = await runFlow1(baseRequest, env);
    const taResult = outcome.executions.find((e) => e.capability === "TECHNICAL_ANALYSIS")!.result;
    expect(taResult.transport).toBe("rest:spot-candles");
    expect(taResult.limitations.join(" ")).toContain("REST klines fallback");
    expect(outcome.completion).toBe("COMPLETE");
  });

  it("capability-first routing: swapping the news provider needs no flow changes (registry substitution)", async () => {
    const mcp = new FakeMcpTransport();
    const rest = new FakeRestTransport();
    const registry = makeRegistry(mcp, rest); // full Bitget set + stubs
    // a hypothetical non-Bitget provider for the same capability, higher priority → selected first
    registry.register({
      providerId: "other/news-provider",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["test provider"],
      freshnessProfile: "rss",
      async execute(capability) {
        return {
          tool: "other/news-provider",
          capability,
          transport: "test",
          params: {},
          rawReference: "test://raw-1",
          outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: { title: "Bitcoin ETF approved", published: new Date(NOW - 600_000).toISOString() } }],
          completeness: "COMPLETE",
          validation: "VALID",
          freshness: "CURRENT",
        };
      },
    }, 10);

    // only the TA tool should be reached on MCP; news is served by the substitute
    mcp.script({ content: [{ type: "text", text: TECHNICAL_FIXTURE }] });

    const workspace = new Workspace();
    const store = new MemoryStore();
    const outcome = await runFlow1(baseRequest, { registry, workspace, store, now: () => new Date(NOW) });
    const newsExecution = outcome.executions.find((e) => e.capability === "NEWS_ANALYSIS")!;
    expect(newsExecution.result.tool).toBe("other/news-provider"); // substituted provider served the capability
    expect(outcome.completion).toBe("COMPLETE");
  });

  it("no trading/execution path: Flow 1 invokes only read capabilities and never persists execution-like objects", async () => {
    const env = makeFixtureEnv();
    env.mcp.script(
      { content: [{ type: "text", text: TECHNICAL_FIXTURE }] },
      { content: [{ type: "text", text: newsFeedFixture([{ feed: "cointelegraph", titles: ["Bitcoin ETF approved"] }]) }] },
    );
    const outcome = await runFlow1(baseRequest, env);
    // read-only capability set
    for (const execution of outcome.executions) {
      expect(["TECHNICAL_ANALYSIS", "NEWS_ANALYSIS", "SENTIMENT_ANALYSIS", "MARKET_DATA_ANALYSIS"]).toContain(execution.capability);
    }
    // the suggested_stop / verdict fields from the TA fixture never trigger any order-like object.
    // (Key names checked exactly; "trader" is a legitimate provenance origin kind.)
    const snapshot = env.workspace.toSnapshot();
    const serialized = JSON.stringify(snapshot).toLowerCase();
    const forbiddenObjectKeys = ["\"order\"", "\"placeorder\"", "\"trade\"", "\"execution\"", "\"position\""];
    for (const key of forbiddenObjectKeys) {
      expect(serialized).not.toContain(key);
    }
    // the suggestion stays only as labeled interpretation evidence
    const interpretation = env.workspace.listEvidence().find((e) => e.observation.includes("suggested_stop"));
    expect(interpretation!.evidenceClass).toBe("DERIVED_OBSERVATION");
    expect(interpretation!.observation).toContain("STRONG BEARISH");
  });
});
