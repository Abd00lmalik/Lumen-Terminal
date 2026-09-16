import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };
const system = { kind: "agent" as const, detail: "test" };

function fakeCapability(capability: string, value: string): ProviderAdapter {
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
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }],
      };
    },
  };
}

beforeEach(() => resetIdCounters());

describe("progressive disclosure responses (M3 §11)", () => {
  it("default response is concise: answer, ≤4 reasons, confidence, uncertainty — no graph dump", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "o", scopeIncluded: [], scopeExcluded: [],
        tasks: [{ type: "T", objective: "o", capabilities: ["NEWS_ANALYSIS", "TECHNICAL_ANALYSIS", "MACRO_ANALYSIS"], completion: "c" }],
        completionCriteria: [], adaptationPolicy: "a",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({}));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([
      { action: "RESEARCH", description: "research", capabilities: [], params: { asset: "BTC" } },
    ]));

    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("NEWS_ANALYSIS", "news item one"));
    registry.register(fakeCapability("TECHNICAL_ANALYSIS", "price observation"));
    registry.register(fakeCapability("MACRO_ANALYSIS", "cpi reading"));
    registry.register(fakeCapability("SENTIMENT_ANALYSIS", "sentiment reading"));

    const workspace = new Workspace();
    const lui = new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });
    const result = await lui.handle("What happened to BTC today?");

    expect(result.response).toBeDefined();
    expect(result.response?.supportingReasons.length).toBeLessThanOrEqual(4);
    expect(result.response?.citedObjectRefs.length).toBeLessThanOrEqual(6);
    for (const ref of result.response?.citedObjectRefs ?? []) {
      expect(workspace.getEvidence(ref)).toBeDefined(); // citations are real objects
    }
    // L0/L1 default never includes the full evidence dump.
    expect(result.response?.answer.length).toBeLessThan(600);
  });

  it("disclosureLevel ≥ 2 requests a model-polished response, still citation-validated", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "o", scopeIncluded: [], scopeExcluded: [],
        tasks: [{ type: "T", objective: "o", capabilities: ["NEWS_ANALYSIS"], completion: "c" }],
        completionCriteria: [], adaptationPolicy: "a",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["response.final", JSON.stringify({
        answer: "polished answer",
        supportingReasons: ["r1", "r2"],
        opposingReasons: [],
        confidence: "LOW",
        keyUncertainty: "thin evidence",
        implication: "monitor for corroboration",
        citedObjectRefs: ["ev_000001", "ev_424242"], // second invented → dropped
      })],
    ]));
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ disclosureLevel: 2 }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([
      { action: "RESEARCH", description: "research", capabilities: [], params: {} },
    ]));

    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("NEWS_ANALYSIS", "news item one"));
    const workspace = new Workspace();
    const lui = new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });
    const result = await lui.handle("Show me the evidence for what happened to BTC");

    expect(result.response?.answer).toBe("polished answer");
    expect(result.response?.citedObjectRefs).toEqual(["ev_000001"]); // invented ref dropped
    expect(workspace.getEvidence("ev_000001")).toBeDefined();
  });

  it("model polish failure falls back to the deterministic response — never fabricates", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "o", scopeIncluded: [], scopeExcluded: [],
        tasks: [{ type: "T", objective: "o", capabilities: ["NEWS_ANALYSIS"], completion: "c" }],
        completionCriteria: [], adaptationPolicy: "a",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["response.final", "not json at all"], // polish fails validation
    ]));
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ disclosureLevel: 3 }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([
      { action: "RESEARCH", description: "research", capabilities: [], params: {} },
    ]));

    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("NEWS_ANALYSIS", "news item one"));
    const workspace = new Workspace();
    const lui = new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });
    const result = await lui.handle("Give me the full trail");

    expect(result.response).toBeDefined();
    expect(result.response?.answer).not.toBe("not json at all");
    // Deterministic fallback still cites real evidence.
    expect((result.response?.citedObjectRefs ?? []).every((ref) => workspace.getEvidence(ref) !== undefined)).toBe(true);
  });
});

describe("failure semantics (M3 §19/§20)", () => {
  it("model failure during RESEARCH preserves research state and reports honestly", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", "broken"], // planning fails mid-pipeline
    ]));
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({}));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([
      { action: "RESEARCH", description: "research", capabilities: [], params: {} },
    ]));

    const workspace = new Workspace();
    const lui = new Lui({ provider, workspace, store: newStore(), registry: new CapabilityRegistry(), now: () => new Date() });
    const result = await lui.handle("What happened to BTC?");

    expect(result.modelFailure).toBeInstanceOf(Error);
    expect(result.research).toBeDefined();                       // outcome shell exists (honest)
    expect(result.research?.executions).toHaveLength(0);         // nothing executed
    expect(workspace.listEvidence()).toHaveLength(0);            // no fabricated evidence
    expect(result.response?.confidence).toBe("UNKNOWN");
  });

  it("persistence failure is a persistence failure — never reported as research success", async () => {
    const { runAdaptiveResearch } = await import("../../src/research/adaptive.js");
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "o", scopeIncluded: [], scopeExcluded: [],
        tasks: [{ type: "T", objective: "o", capabilities: ["NEWS_ANALYSIS"], completion: "c" }],
        completionCriteria: [], adaptationPolicy: "a",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability("NEWS_ANALYSIS", "reading"));
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");
    const failingStore = {
      async save(): Promise<void> { throw new Error("disk full"); },
      async load(): Promise<undefined> { return undefined; },
    };

    await expect(runAdaptiveResearch("o", research.id, { provider, registry, workspace, store: failingStore }))
      .rejects.toThrow("disk full");
  });
});
