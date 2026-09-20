/**
 * Subject-isolation regression tests (research-engine rebuild mandate).
 *
 * Laws under test (live failures, 2026-09-20):
 * - INSTRUMENT RESOLUTION: commodity/metal/FX/index assets resolve to canonical Yahoo
 *   symbols (oil -> CL=F) so symbol-scoped capabilities can serve them; generic market
 *   vocabulary is never a subject term.
 * - SUBJECT GATE (target-relevance): evidence collected DURING a run must concern the
 *   question's subject to enter synthesis. Wrong-domain provider output (crypto headlines
 *   during an oil question) is demoted with a rejection count — never the run's findings.
 * - HOLLOW-COMPLETE GUARD: a COMPLETE decision with zero subject-relevant run evidence is
 *   not a completion; the engine fires the deep-research recovery tier instead.
 * - SEQUENTIAL ISOLATION: consecutive runs in the SAME workspace never see each other's
 *   evidence (workspace membership is not an evidence context).
 */
import { describe, expect, it } from "vitest";
import { resolveInstrument, subjectTermsOf } from "../../src/domain/instruments.js";
import { Workspace } from "../../src/domain/workspace.js";
import { buildResearchContext } from "../../src/research/context.js";
import { runAdaptiveResearch } from "../../src/research/adaptive.js";
import { normalizedResult, type ToolResult } from "../../src/domain/tool-result.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { beforeEach } from "vitest";

const origin = { kind: "agent" as const, detail: "test" };

function makeCapability(capability: string, content: string): ProviderAdapter {
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
        outputs: [{ outputClass: "FACTUAL_OBSERVATION", content, about: "test" }],
      };
    },
  };
}

function ingest(ws: Workspace, researchId: string, observation: string): string {
  const result: ToolResult = normalizedResult(
    {
      tool: "fake/news_analysis",
      capability: "NEWS_ANALYSIS",
      transport: "fake",
      params: {},
      outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: observation, about: "test" }],
      validation: "VALID",
    },
    { origin },
  );
  const ev = evidenceFromToolResult(result, result.normalizedOutput[0]!, { kind: "tool", toolRef: result.tool, invocation: result.invocation.params }, {}, new Date());
  ws.ingestEvidence(ev, researchId);
  return ev.id;
}

beforeEach(() => resetIdCounters());

describe("canonical instrument resolution", () => {
  it("resolves commodities, metals, FX, and indices to Yahoo-tradable symbols", () => {
    expect(resolveInstrument("What is driving oil prices this week?")?.symbol).toBe("CL=F");
    expect(resolveInstrument("How are gold and the dollar correlated this month?")?.symbol).toBe("GC=F");
    expect(resolveInstrument("Brent outlook")?.symbol).toBe("BZ=F");
    expect(resolveInstrument("EUR/USD weakness")?.symbol).toBe("EURUSD=X");
    expect(resolveInstrument("VIX spikes")?.symbol).toBe("^VIX");
    expect(resolveInstrument("What could affect AAPL earnings?")).toBeUndefined(); // equities resolve via their own path
  });

  it("subject terms carry the subject, never generic market vocabulary", () => {
    const oil = subjectTermsOf("What is driving oil prices this week?");
    expect(oil).toBeDefined();
    for (const t of ["OIL", "CRUDE", "WTI", "BRENT", "OPEC"]) expect(oil?.has(t)).toBe(true);
    for (const t of ["PRICES", "MARKET", "WEEK", "DRIVING"]) expect(oil?.has(t)).toBe(false);

    const btc = subjectTermsOf("What is happening with Bitcoin today?");
    expect(btc?.has("BITCOIN")).toBe(true);
    expect(btc?.has("BTC")).toBe(true); // alias so klines (BTCUSDT) and headlines both match
  });
});

describe("subject gate (target-relevance law)", () => {
  it("demotes run-collected evidence that does not concern the question's subject", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "oil drivers", question: "What is driving oil prices this week?", flow: "WHY_IT_HAPPENED" }, origin);
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
    const btcId = ingest(ws, research.id, "BTC ETF inflows hit a record as crypto markets rally");
    const oilId = ingest(ws, research.id, "Oil slides 3% as OPEC+ announces output increase; crude inventories draw");

    const ctx = buildResearchContext(ws, {
      researchRef: research.id,
      relevantTo: "What is driving oil prices this week?",
      subjectTerms: [...subjectTermsOf("What is driving oil prices this week?") ?? []],
    });
    expect(ctx.items.map((i) => i.ref)).toContain(oilId);
    expect(ctx.items.map((i) => i.ref)).not.toContain(btcId);
    expect(ctx.rejectedWrongTarget).toBe(1);
  });

  it("stays OFF for continuation objectives (no subject terms -> run-scoped semantics)", () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "thesis", question: "Does my thesis hold?", flow: "DOES_MY_THESIS_HOLD" }, origin);
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
    const btcId = ingest(ws, research.id, "BTC ETF inflows hit a record as crypto markets rally");

    const ctx = buildResearchContext(ws, { researchRef: research.id, relevantTo: "Does my thesis hold?" });
    expect(ctx.items.map((i) => i.ref)).toContain(btcId); // thesis evidence is the run's own context
    expect(ctx.rejectedWrongTarget).toBeUndefined();
  });

  it("a NVDA question rejects oil evidence and vice versa (cross-domain isolation)", () => {
    const ws = new Workspace();
    const nvdaRun = ws.addResearch({ objective: "nvda", question: "What could affect NVDA around earnings?", flow: "WHAT_COULD_AFFECT_IT" }, origin);
    ws.transitionResearch(nvdaRun.id, "ACTIVE", origin, "activated");
    const oilId = ingest(ws, nvdaRun.id, "Oil slides 3% as OPEC+ announces output increase");

    const ctx = buildResearchContext(ws, {
      researchRef: nvdaRun.id,
      relevantTo: "What could affect NVDA around earnings?",
      subjectTerms: [...subjectTermsOf("What could affect NVDA around earnings?", "NVDA") ?? []],
    });
    expect(ctx.items.map((i) => i.ref)).not.toContain(oilId);
    expect(ctx.rejectedWrongTarget).toBe(1);
  });
});

describe("hollow-complete guard (engine owns completion)", () => {
  it("a COMPLETE with only wrong-domain evidence fires deep-research recovery instead of finishing", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      // The decision model accepts the wrong-domain context (it cannot know provider
      // coverage); the ENGINE must reject the hollow completion.
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    // A provider returning crypto headlines for an oil question: the live contamination.
    const registry = new CapabilityRegistry();
    registry.register(makeCapability("NEWS_ANALYSIS", "BTC ETF inflows hit a record as crypto markets rally"));
    registry.register(makeCapability("CROSS_DOMAIN_SYNTHESIS", "OPEC+ announced a production cut; crude oil inventories drew sharply this week"));

    const ws = new Workspace();
    const research = ws.addResearch(
      { objective: "What is driving oil prices this week?", question: "What is driving oil prices this week?", flow: "WHY_IT_HAPPENED" },
      origin,
    );
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

    const outcome = await runAdaptiveResearch("What is driving oil prices this week?", research.id, {
      provider,
      registry,
      workspace: ws,
      store: new MemoryStore(),
      maxRounds: 1,
      capabilityParams: { asset: "CL=F" },
    });

    // With the ingestion gate, the wrong-domain item never becomes evidence, so the gap is
    // detected either as a hollow completion or as unresolved requirement coverage; both
    // roads lead to the same law: recovery fires before any answer can be produced.
    expect(["HOLLOW_COMPLETE_RECOVERY", "REQUIREMENT_GAPS_UNRESOLVED"]).toContain(outcome.stoppedBecause);
    const deepExec = outcome.executions.find((e) => e.capability === "CROSS_DOMAIN_SYNTHESIS");
    expect(deepExec).toBeDefined(); // recovery fired with the exact question
    expect(outcome.finalDecision.decision).toBe("COMPLETE"); // upgraded after real evidence
    // The final context carries the oil finding and NOT the crypto headline.
    const texts = outcome.context.items.map((i) => i.text);
    expect(texts.some((t) => t.includes("OPEC"))).toBe(true);
    // Wrong-target evidence never reaches synthesis — discarded at ingestion and/or gated
    // out of the context; either way it is absent from what the answer model reads.
    expect(texts.some((t) => t.includes("BTC"))).toBe(false);
  });
});

describe("ingestion gate (wrong-target evidence never attaches to the run)", () => {
  it("crypto provider output discarded at ingestion for an oil question; the answer's evidence is oil-only", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "oil price drivers this week",
        scopeIncluded: [],
        scopeExcluded: [],
        tasks: [{ type: "GATHER", objective: "current crude oil price and oil-specific news", capabilities: ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"], completion: "c" }],
        completionCriteria: [],
        adaptationPolicy: "a",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(makeCapability("NEWS_ANALYSIS", "BTC ETF inflows hit a record as crypto markets rally"));
    registry.register(makeCapability("EQUITY_MARKET_DATA", JSON.stringify({ symbol: "CL=F", price: 68.42, previousClose: 69.1, metric: "crude oil" })));

    const ws = new Workspace();
    const research = ws.addResearch(
      { objective: "What is driving oil prices this week?", question: "What is driving oil prices this week?", flow: "WHY_IT_HAPPENED" },
      origin,
    );
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

    const outcome = await runAdaptiveResearch("What is driving oil prices this week?", research.id, {
      provider,
      registry,
      workspace: ws,
      store: new MemoryStore(),
      maxRounds: 1,
      capabilityParams: { asset: "CL=F" },
    });

    // The run's evidence is oil-only: the crypto headline never became evidence, so no
    // answer can describe it as this question's research context.
    const texts = outcome.evidence.map((e) => e.observation);
    expect(texts.some((t) => t.includes("CL=F") || t.toLowerCase().includes("crude"))).toBe(true);
    expect(texts.some((t) => t.includes("BTC"))).toBe(false);
    expect(outcome.context.items.some((i) => i.text.includes("BTC"))).toBe(false);
  });
});

describe("sequential runs in one workspace stay isolated", () => {
  it("a later NVDA run never sees an earlier BTC run's evidence", () => {
    const ws = new Workspace();
    const btcRun = ws.addResearch({ objective: "btc today", question: "What is happening with Bitcoin today?", flow: "WHAT_HAPPENED" }, origin);
    ws.transitionResearch(btcRun.id, "ACTIVE", origin, "activated");
    ingest(ws, btcRun.id, "Bitcoin ETF inflows accelerate; BTC dominance climbs");
    ws.transitionResearch(btcRun.id, "COMPLETED", origin, "completed");

    const nvdaRun = ws.addResearch({ objective: "nvda", question: "What could affect NVDA around earnings?", flow: "WHAT_COULD_AFFECT_IT" }, origin);
    ws.transitionResearch(nvdaRun.id, "ACTIVE", origin, "activated");
    ingest(ws, nvdaRun.id, JSON.stringify({ title: "Nvidia raises data-center guidance ahead of earnings", symbol: "NVDA", publisher: "Yahoo Finance" }));

    const ctx = buildResearchContext(ws, {
      researchRef: nvdaRun.id,
      relevantTo: "What could affect NVDA around earnings?",
      subjectTerms: [...subjectTermsOf("What could affect NVDA around earnings?", "NVDA") ?? []],
    });
    const texts = ctx.items.map((i) => i.text);
    expect(texts.some((t) => t.includes("Bitcoin"))).toBe(false);
    expect(texts.some((t) => t.includes("Nvidia"))).toBe(true);
  });
});

describe("declared subject semantics (target-relevance law)", () => {
  it("honors a tool's explicit `about` subject when the observation text never names it", () => {
    // Real indicator payloads frequently omit their own ticker ("RSI(14) = 34.86"); the
    // adapter declared `about: "BTC"`. The declaration is provenance, not fabrication: an
    // undeclared subject must still be rejected.
    const ws = new Workspace();
    const run = ws.addResearch({ objective: "btc technicals", question: "What is the technical picture on BTC?", flow: "WHAT_HAPPENED" }, origin);
    ws.transitionResearch(run.id, "ACTIVE", origin, "activated");

    const declared: ToolResult = normalizedResult(
      {
        tool: "fake/ta", capability: "TECHNICAL_ANALYSIS", transport: "fake", params: {},
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: "RSI(14) = 34.86 (last closed candle)", about: "BTC" }],
        validation: "VALID",
      },
      { origin },
    );
    const declaredEv = evidenceFromToolResult(declared, declared.normalizedOutput[0]!, { kind: "tool", toolRef: declared.tool, invocation: declared.invocation.params }, {}, new Date());
    expect(declaredEv.subject).toBe("BTC");
    ws.ingestEvidence(declaredEv, run.id);

    // An observation with NEITHER the subject in text NOR a declaration is still rejected.
    const undeclared: ToolResult = normalizedResult(
      {
        tool: "fake/ta", capability: "TECHNICAL_ANALYSIS", transport: "fake", params: {},
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: "RSI(14) = 61.10 (last closed candle)" }],
        validation: "VALID",
      },
      { origin },
    );
    const undeclaredEv = evidenceFromToolResult(undeclared, undeclared.normalizedOutput[0]!, { kind: "tool", toolRef: undeclared.tool, invocation: undeclared.invocation.params }, {}, new Date());
    ws.ingestEvidence(undeclaredEv, run.id);

    const ctx = buildResearchContext(ws, {
      researchRef: run.id,
      relevantTo: "What is the technical picture on BTC?",
      subjectTerms: [...subjectTermsOf("What is the technical picture on BTC?") ?? []],
    });
    expect(ctx.items.some((i) => i.ref === declaredEv.id)).toBe(true);
    expect(ctx.items.some((i) => i.ref === undeclaredEv.id)).toBe(false);
    expect(ctx.rejectedWrongTarget).toBe(1);
  });
});
