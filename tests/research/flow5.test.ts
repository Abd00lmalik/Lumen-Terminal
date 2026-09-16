/**
 * Benchmark: Flow 5; HAS THIS HAPPENED BEFORE? (historical comparison).
 *
 * Covers the defect fixed in this benchmark phase: Flow 5 previously fell through the LUI
 * dispatch to the generic adaptive loop, where CURRENT-data capabilities could silently
 * answer a HISTORICAL question (current readings laundered as precedent).
 *
 * Laws under test (research-flows.md FLOW 5 + M6 audit law):
 * - A historical question is answerable ONLY by HISTORICAL_COMPARISON evidence.
 * - Until a G1 vendor connects, the honest outcome is UNAVAILABLE; never fabricated
 *   history, never current data presented as precedent, never model background knowledge.
 * - Model/provider failure ends the flow honestly (MODEL_FAILURE), with no fabricated claims.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runFlow5 } from "../../src/research/flow5.js";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, HistoricalDataStub } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };

beforeEach(() => resetIdCounters());

function workingCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }],
      };
    },
  };
}

const HISTORICAL_UNAVAILABLE_PLAN = JSON.stringify({
  objective: "Have we seen this BTC setup before?",
  scopeIncluded: ["historical episodes"],
  scopeExcluded: ["current market state"],
  tasks: [
    { type: "FACT_FINDING", objective: "retrieve analogous historical episodes", capabilities: ["HISTORICAL_COMPARISON"], completion: "episodes retrieved or unavailability recorded" },
  ],
  completionCriteria: ["historical evidence retrieved or honest unavailability recorded"],
  adaptationPolicy: "no substitution of current data for history",
});

const CURRENT_DATA_PLAN = JSON.stringify({
  objective: "Have we seen this BTC setup before?",
  scopeIncluded: [],
  scopeExcluded: [],
  tasks: [
    { type: "FACT_FINDING", objective: "check current indicators", capabilities: ["TECHNICAL_ANALYSIS"], completion: "readings collected" },
    { type: "FACT_FINDING", objective: "check current news", capabilities: ["NEWS_ANALYSIS"], completion: "news collected" },
  ],
  completionCriteria: ["evidence collected"],
  adaptationPolicy: "n/a",
});

// ---------------------------------------------------------------------------
// Flow 5 direct; G1 stub (the current real-world state)
// ---------------------------------------------------------------------------

describe("Flow 5; historical comparison (G1 unavailable)", () => {
  it("ends in honest UNAVAILABLE: the G1 stub failure is reported, nothing is fabricated", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", HISTORICAL_UNAVAILABLE_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("INSUFFICIENT_EVIDENCE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(new HistoricalDataStub()); // throws NotConnectedError by design

    const workspace = new Workspace();
    const result = await runFlow5("Have we seen this BTC setup before?", {
      provider, registry, workspace, store: new MemoryStore(),
    });

    // The historical capability WAS attempted and its failure was recorded honestly.
    expect(result.outcome.executions).toHaveLength(1);
    expect(result.outcome.executions[0]?.capability).toBe("HISTORICAL_COMPARISON");
    expect(result.outcome.executions[0]?.result.failure.type).toBe("PROVIDER_ERROR");
    expect(result.outcome.executions[0]?.result.completeness).toBe("EMPTY");
    expect(result.outcome.executions[0]?.result.failure.message).toContain("Do not fabricate");

    // No evidence exists → no historical claim may be asserted.
    expect(result.outcome.evidence).toHaveLength(0);
    expect(result.outcome.stoppedBecause).toBe("MODEL_INSUFFICIENT_EVIDENCE");

    // The response states unavailability; it does not pretend precedent was found.
    expect(result.response).toContain("UNAVAILABLE");
    expect(result.response).toContain("G1 historical-data vendor has not been connected");
    expect(result.response).not.toMatch(/precedent (was )?found/i);
    expect(result.response).not.toContain("Historical comparison:");
  });

  it("scope guard: a mis-planned current-data task is never executed as historical evidence", async () => {
    // Adversarial script: the model disobeys guidance and plans CURRENT-data capabilities.
    const provider = new FakeModelProvider(new Map([
      ["research.plan", CURRENT_DATA_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(workingCapability("TECHNICAL_ANALYSIS", "RSI 34, price 61,400 (CURRENT reading)"));
    registry.register(workingCapability("NEWS_ANALYSIS", "BTC ETF flows positive today (CURRENT news)"));

    const workspace = new Workspace();
    const result = await runFlow5("Have we seen this BTC setup before?", {
      provider, registry, workspace, store: new MemoryStore(),
    });

    // Out-of-scope executions are excluded from the flow outcome; current data can never
    // be laundered into a historical answer.
    expect(result.outcome.executions).toHaveLength(0);
    expect(result.outcome.evidence).toHaveLength(0);
    expect(result.response).toContain("UNAVAILABLE");
    expect(result.response).toContain("Scope guard");
    expect(result.response).toContain("TECHNICAL_ANALYSIS");
    // The response must not present current readings as historical precedent.
    expect(result.response).not.toContain("RSI 34");
  });

  it("model/provider failure ends honestly with MODEL_FAILURE and no claims", async () => {
    const provider = new FakeModelProvider(new Map(), { failWith: new ModelFailure("PROVIDER_UNAVAILABLE", "quota exhausted", false) });
    const registry = new CapabilityRegistry();
    registry.register(new HistoricalDataStub());

    const result = await runFlow5("Have we seen this before?", {
      provider, registry, workspace: new Workspace(), store: new MemoryStore(),
    });

    expect(result.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
    expect(result.outcome.stoppedBecause).toBe("MODEL_FAILURE");
    expect(result.outcome.executions).toHaveLength(0);
    expect(result.outcome.evidence).toHaveLength(0);
    expect(result.response).toContain("could not be processed");
    expect(result.response).toContain("not evidence about historical precedent");
  });

  it("future path: when a G1 provider connects, real historical evidence flows through the same machinery", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", HISTORICAL_UNAVAILABLE_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/g1-connected",
      capabilities: ["HISTORICAL_COMPARISON"],
      limitations: ["test vendor"],
      freshnessProfile: "test:live",
      async execute(cap) {
        return {
          tool: "fake/g1-connected",
          capability: cap,
          transport: "fake",
          outputs: [
            { outputClass: "QUANTITATIVE_OBSERVATION", content: "2024-09 analogous setup: RSI 34, -8% drawdown over 10 days", about: "BTC" },
            { outputClass: "QUANTITATIVE_OBSERVATION", content: "2025-04 analogous setup: funding reset, +12% over 14 days", about: "BTC" },
            { outputClass: "QUANTITATIVE_OBSERVATION", content: "2026-02 analogous setup: MACD cross below zero, -5% over 7 days", about: "BTC" },
          ],
        };
      },
    });

    const result = await runFlow5("Have we seen this BTC setup before?", {
      provider, registry, workspace: new Workspace(), store: new MemoryStore(),
    });

    expect(result.outcome.evidence).toHaveLength(3);
    expect(result.response).toContain("Historical record:");
    expect(result.response).toContain("3 monthly historical block(s)");
    // Analysis layer: the fake evidence payloads are single-line strings (not monthly candle
    // chunks), so the analysis reports honest insufficiency rather than fabricating episodes.
    expect(result.response).toContain("Insufficient historical coverage");
    expect(result.response).not.toContain("UNAVAILABLE.");
  });

  it("records a deterministic Judgment over the historical analysis (flow contract: every flow ends in a judgment)", async () => {
    // Regression (G1-analysis phase): Flow 5 was the only flow that produced a response without
    // persisting a Judgment object, so the API showed judg:0 and confidence was unrenderable.
    const provider = new FakeModelProvider(new Map([
      ["research.plan", HISTORICAL_UNAVAILABLE_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/g1-judgment",
      capabilities: ["HISTORICAL_COMPARISON"],
      limitations: ["test vendor"],
      freshnessProfile: "test:live",
      async execute(cap) {
        return {
          tool: "fake/g1-judgment",
          capability: cap,
          transport: "fake",
          outputs: [
            { outputClass: "QUANTITATIVE_OBSERVATION", content: "2024-09 analogous setup: RSI 34, -8% drawdown over 10 days", about: "BTC" },
            { outputClass: "QUANTITATIVE_OBSERVATION", content: "2025-04 analogous setup: funding reset, +12% over 14 days", about: "BTC" },
          ],
        };
      },
    });
    const workspace = new Workspace();
    const result = await runFlow5("Have we seen this BTC setup before?", {
      provider, registry, workspace, store: new MemoryStore(),
    });

    const judgments = workspace.listJudgments();
    const flowJudgment = judgments.find((j) => j.basis.supportingEvidence.length > 0);
    expect(flowJudgment).toBeDefined();
    expect(flowJudgment!.statement).toContain("HISTORICAL ANALOGY");
    // Epistemic honesty: the judgment text may not read as prediction or recommendation.
    expect(flowJudgment!.statement).toMatch(/does not (establish recurrence and )?predict|does not recommend/);
    expect(flowJudgment!.basis.supportingEvidence.length).toBeGreaterThan(0);
    expect(flowJudgment!.provenance.some((o) => o.origin.kind === "agent")).toBe(true);
  });

  it("does not re-ingest identical evidence when the plan repeats the same capability (cross-round dedupe)", async () => {
    // Regression (G1-analysis phase): a live run proposed HISTORICAL_COMPARISON in 3 consecutive
    // rounds; each round re-ingested the identical monthly record (111 blocks for 37 real ones).
    const planThreeRounds = JSON.stringify({
      objective: "Have we seen this BTC setup before?",
      scopeIncluded: ["historical episodes"],
      scopeExcluded: [],
      tasks: [
        { type: "FACT_FINDING", objective: "retrieve analogous historical episodes", capabilities: ["HISTORICAL_COMPARISON"], completion: "episodes retrieved" },
      ],
      completionCriteria: [],
      adaptationPolicy: "CONTINUE_ON_INSUFFICIENT",
    });
    const CONTINUE = responses.adaptiveDecision("CONTINUE", [
      { type: "FACT_FINDING", objective: "retrieve more historical episodes", capabilities: ["HISTORICAL_COMPARISON"], completion: "more episodes" },
    ]);
    const provider = new FakeModelProvider(new Map([
      ["research.plan", planThreeRounds],
      // Round 1: CONTINUE (same capability again) → round 2: CONTINUE again → round 3: COMPLETE.
      ["research.adaptive_decision", responses.adaptiveDecision("CONTINUE", [
        { type: "FACT_FINDING", objective: "retrieve more", capabilities: ["HISTORICAL_COMPARISON"], completion: "more" },
      ])],
    ]));
    let calls = 0;
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/g1-dedupe",
      capabilities: ["HISTORICAL_COMPARISON"],
      limitations: ["test vendor"],
      freshnessProfile: "test:live",
      async execute(cap) {
        calls += 1;
        return {
          tool: "fake/g1-dedupe",
          capability: cap,
          transport: "fake",
          // IDENTICAL payload every call; the dedupe law targets repeated identical outputs.
          outputs: [
            { outputClass: "QUANTITATIVE_OBSERVATION", content: "2024-09 analogous setup: RSI 34, -8% drawdown over 10 days", about: "BTC" },
          ],
        };
      },
    });
    const workspace = new Workspace();
    const result = await runFlow5("Have we seen this BTC setup before?", {
      provider, registry, workspace, store: new MemoryStore(), maxRounds: 3,
    });

    // 3 real executions across 3 rounds, but the IDENTICAL payload must be ingested once.
    expect(result.outcome.evidence).toHaveLength(1);
    expect(calls).toBeGreaterThanOrEqual(2); // the capability genuinely ran more than once
  });

  it("sends a valid HistoricalQuery envelope (engine owns invocation params, never the model)", async () => {
    const plan = JSON.stringify({
      objective: "Have we seen this BTC setup before?",
      scopeIncluded: ["historical episodes"],
      scopeExcluded: [],
      tasks: [
        { type: "FACT_FINDING", objective: "retrieve analogous historical episodes", capabilities: ["HISTORICAL_COMPARISON"], completion: "episodes retrieved" },
      ],
      completionCriteria: [],
      adaptationPolicy: "STOP_ON_INSUFFICIENT",
    });
    const provider = new FakeModelProvider(new Map([
      ["research.plan", plan],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const seenParams: Record<string, unknown>[] = [];
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/g1-params",
      capabilities: ["HISTORICAL_COMPARISON"],
      limitations: [],
      freshnessProfile: "test:live",
      async execute(_cap, params) {
        seenParams.push({ ...params });
        return {
          tool: "fake/g1-params",
          capability: _cap,
          transport: "fake",
          outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: "2024-09 analogous setup", about: "BTC" }],
        };
      },
    });

    const now = new Date("2026-09-15T12:00:00.000Z");
    await runFlow5("Have we seen this BTC setup before?", {
      provider, registry, workspace: new Workspace(), store: new MemoryStore(), asset: "ETH",
      now: () => now,
    });

    expect(seenParams).toHaveLength(1);
    const q = seenParams[0] as { symbol: string; metric: string; from: string; to: string; interval: string };
    expect(q.symbol).toBe("ETH/USDT"); // resolved asset, normalized to venue pair format
    expect(q.metric).toBe("ohlcv");
    expect(q.interval).toBe("1d");
    expect(Date.parse(q.to)).toBe(now.getTime());
    // 3-year deterministic lookback
    expect(Date.parse(q.to) - Date.parse(q.from)).toBeCloseTo(3 * 365 * 86_400_000, -6);
  });
});

// ---------------------------------------------------------------------------
// Flow 5 through the LUI; routing + honest response
// ---------------------------------------------------------------------------

describe("Flow 5; LUI routing", () => {
  function scriptLui(provider: FakeModelProvider): void {
    provider.responses.set("lui.normalized_request", responses.normalizedRequest());
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "HAS_THIS_HAPPENED_BEFORE" }));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([
      { action: "RESEARCH", description: "historical comparison", capabilities: [], params: { flow: "HAS_THIS_HAPPENED_BEFORE", objective: "Have we seen this BTC setup before?", asset: "BTC" } },
    ]));
    provider.responses.set("research.plan", HISTORICAL_UNAVAILABLE_PLAN);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("INSUFFICIENT_EVIDENCE"));
  }

  it("routes HAS_THIS_HAPPENED_BEFORE to Flow 5 (not the generic loop) and reports honest unavailability", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLui(provider);
    const registry = new CapabilityRegistry();
    registry.register(new HistoricalDataStub());
    const workspace = new Workspace();
    workspace.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
    const lui = new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });

    const result = await lui.handle("Have we seen this kind of setup before on BTC?");

    expect(result.flow5).toBeDefined();
    expect(result.flow5?.outcome.flow).toBe("HAS_THIS_HAPPENED_BEFORE");
    expect(result.flow5?.outcome.mode).toBe("HISTORICAL");
    // No generic-loop substitution: zero evidence, honest answer.
    expect(result.flow5?.outcome.evidence).toHaveLength(0);
    expect(result.response?.answer).toContain("UNAVAILABLE");
    expect(result.response?.keyUncertainty).toContain("G1 historical-data provider");
    // Nothing was silently saved or turned into a thesis change.
    expect(result.saved).toBeUndefined();
  });
});
