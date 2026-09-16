import { beforeEach, describe, expect, it } from "vitest";
import { runFlow6 } from "../../src/research/flow6.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const system = { kind: "agent" as const, detail: "test" };

/** Slower fake capability that records start/end to verify parallel execution. */
function timedCapability(capability: string, ms: number): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: [],
    freshnessProfile: "test:live",
    async execute(cap) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: `${cap} reading`, about: "BTC" }],
      };
    },
  };
}

function synthesis(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    overallPicture: "BTC in consolidation: technicals constructive, positioning cautious, macro neutral",
    supportingSignals: ["technical structure improving"],
    opposingSignals: ["positioning risk-off"],
    crossDomainRelationships: ["funding reset + price base building"],
    disagreements: [
      {
        sideA: "technical trend constructive (TECHNICAL_ANALYSIS)",
        sideB: "positioning deteriorating (SENTIMENT_ANALYSIS)",
        type: "DIFFERENT_TIME_HORIZON",
        assessment: "technical refers to days, positioning to hours; not directly contradictory",
        objectRefsA: ["ev_000001"],
        objectRefsB: ["ev_000002"],
      },
    ],
    missingInformation: ["derivatives open-interest history"],
    confidence: "MODERATE",
    uncertainty: ["freshness of positioning data"],
    citedObjectRefs: ["ev_000001", "ev_000002"],
    ...overrides,
  });
}

const PLAN = JSON.stringify({
  objective: "What does all information say about BTC right now?",
  scopeIncluded: ["technicals", "sentiment", "macro", "news"],
  scopeExcluded: ["on-chain (no provider)"],
  tasks: [
    { type: "TECH", objective: "technical state", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" },
    { type: "SENT", objective: "positioning", capabilities: ["SENTIMENT_ANALYSIS"], completion: "c" },
    { type: "MACRO", objective: "macro context", capabilities: ["MACRO_ANALYSIS"], completion: "c" },
    { type: "NEWS", objective: "narratives", capabilities: ["NEWS_ANALYSIS"], completion: "c" },
  ],
  completionCriteria: ["domains covered"],
  adaptationPolicy: "target gaps",
});

beforeEach(() => resetIdCounters());

describe("Flow 6; WHAT DOES ALL THE INFORMATION SAY? (cross-domain synthesis)", () => {
  it("runs end-to-end with one primary judgment and typed disagreements preserved", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", synthesis()],
    ]));
    const registry = new CapabilityRegistry();
    for (const c of ["TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS", "MACRO_ANALYSIS", "NEWS_ANALYSIS"]) {
      registry.register(timedCapability(c, 5));
    }
    const workspace = new Workspace();
    const result = await runFlow6("What does all information say about BTC right now?", { provider, registry, workspace, store: new MemoryStore() });

    expect(result.outcome.mode).toBe("SYNTHESIS");
    expect(result.outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(result.synthesis?.disagreements).toHaveLength(1);
    expect(result.synthesis?.disagreements[0]?.type).toBe("DIFFERENT_TIME_HORIZON");
    // judgment preserves the disagreement in uncertainty (never forced into agreement):
    const judgment = workspace.currentJudgment(result.outcome.researchId);
    expect(judgment === undefined || !judgment.statement.includes("FORCED AGREEMENT")).toBe(true);
    expect(judgment?.statement).toContain("OVERALL PICTURE");
    expect(result.response).toContain("**Disagreements (preserved, not forced):**");
  });

  it("independent dimension research runs in parallel (bounded concurrency)", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", synthesis()],
    ]));
    const registry = new CapabilityRegistry();
    for (const c of ["TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS", "MACRO_ANALYSIS", "NEWS_ANALYSIS"]) {
      registry.register(timedCapability(c, 120)); // 4 × 120ms serial ≈ 480ms; parallel ≈ ~120–240ms
    }
    const workspace = new Workspace();
    const start = Date.now();
    await runFlow6("What does all information say about BTC?", { provider, registry, workspace, store: new MemoryStore() });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(420); // serial would exceed this comfortably
  }, 20_000);

  it("interpretation-vs-observation disagreement is typed, interpretation does not win by confidence", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", synthesis({
        disagreements: [{
          sideA: "analyst says strongly bullish",
          sideB: "quantitative observations show declining volume",
          type: "INTERPRETATION_VS_OBSERVATION",
          assessment: "interpretation conflicts with measurement; measurement is not overridden",
          objectRefsA: [],
          objectRefsB: ["ev_000001"],
        }],
      })],
    ]));
    const registry = new CapabilityRegistry();
    for (const c of ["TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"]) registry.register(timedCapability(c, 5));
    const workspace = new Workspace();
    const result = await runFlow6("Full picture on BTC", { provider, registry, workspace, store: new MemoryStore() });
    expect(result.synthesis?.disagreements[0]?.type).toBe("INTERPRETATION_VS_OBSERVATION");
    expect(result.response).toContain("INTERPRETATION_VS_OBSERVATION");
  });

  it("malformed disagreement entries are dropped, not coerced", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", synthesis({
        disagreements: [
          { sideA: "a", sideB: "b", type: "TOTALLY_DIFFERENT", assessment: "x" }, // invalid type
          "not even an object", // invalid shape
          { sideA: "a", sideB: "b", type: "GENUINE_CONTRADICTION", assessment: "irreconcilable" }, // valid
        ],
      })],
    ]));
    const registry = new CapabilityRegistry();
    for (const c of ["TECHNICAL_ANALYSIS", "NEWS_ANALYSIS"]) registry.register(timedCapability(c, 5));
    const workspace = new Workspace();
    const result = await runFlow6("Full picture", { provider, registry, workspace, store: new MemoryStore() });
    expect(result.synthesis?.disagreements).toHaveLength(1);
    expect(result.synthesis?.disagreements[0]?.type).toBe("GENUINE_CONTRADICTION");
  });

  it("invented citation refs dropped; valid ones kept (no fabricated evidence)", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", synthesis({ citedObjectRefs: ["ev_000001", "ev_999999"] })],
    ]));
    const registry = new CapabilityRegistry();
    for (const c of ["TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"]) registry.register(timedCapability(c, 5));
    const workspace = new Workspace();
    const result = await runFlow6("Full picture", { provider, registry, workspace, store: new MemoryStore() });
    expect(result.synthesis?.citedObjectRefs).toEqual(["ev_000001"]);
    expect(workspace.getEvidence("ev_000001")).toBeDefined();
  });

  it("thesis implication appears when a thesis exists; without mutating it", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", synthesis({ thesisImplication: "consolidation picture is neutral for the swing thesis" })],
    ]));
    const registry = new CapabilityRegistry();
    for (const c of ["TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS"]) registry.register(timedCapability(c, 5));
    const workspace = new Workspace();
    const thesis = workspace.addThesis({ statement: "BTC trends up this quarter", objective: "swing" }, { kind: "trader", detail: "t" });
    const result = await runFlow6("What does everything say?", { provider, registry, workspace, store: new MemoryStore() });
    expect(result.synthesis?.thesisImplication ?? "").toContain("neutral");
    expect(workspace.getThesis(thesis.id)?.version).toBe(1); // untouched
  });

  it("no evidence and no limitations → honest synthesis failure", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("INSUFFICIENT_EVIDENCE")],
      ["flow6.cross_domain_synthesis", "not json"],
    ]));
    const workspace = new Workspace();
    const result = await runFlow6("Full picture", { provider, registry: new CapabilityRegistry(), workspace, store: new MemoryStore() });
    expect(result.synthesis).toBeUndefined();
    expect(result.modelFailure).toBeDefined();
    expect(result.response).toContain("could not be completed");
  });
});
