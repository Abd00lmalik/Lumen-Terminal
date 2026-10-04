/**
 * THESIS CAPTURE (the trader's own words, before the test of it).
 *
 * The failure this pins, from the browser journey: the trader said "My thesis is that liquidity
 * conditions are the primary driver. Test it." and Lumen answered "no active thesis to
 * evaluate; activate or state a thesis first" — because the thesis was never RECORDED, so the
 * evaluation had nothing to evaluate. The statement was in the trader's own sentence the whole
 * time.
 *
 * Law: the statement is copied verbatim (never paraphrased, never strengthened, never extended
 * with the trailing instruction); nothing is persisted without the trader's explicit
 * confirmation; and the record happens BEFORE the research the trader asked for.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { statedThesisText } from "../../src/lui/conversation-routing.js";
import type { StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";

const MESSAGE = "My thesis is that liquidity conditions are the primary driver. Test it.";

const stubAdapter: ProviderAdapter = {
  providerId: "stub-market",
  capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION"],
  limitations: ["test stub"],
  freshnessProfile: "test:live",
  async execute(capability: string) {
    return {
      tool: "stub-market",
      capability,
      transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({ symbol: "BTC", price: 84821, observed_at: "2026-10-03T12:49:40.000Z" }),
        about: "BTC",
      }],
    };
  },
};

function scripted(schemaName: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: MESSAGE, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", flow: "DOES_MY_THESIS_HOLD", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{ action: "RESEARCH", description: MESSAGE, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: MESSAGE, question: MESSAGE } }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: MESSAGE, scopeIncluded: ["liquidity"], scopeExcluded: [],
        tasks: [{ type: "FACT_FINDING", objective: MESSAGE, capabilities: ["CRYPTO_MARKET_DATA"], completion: "observations" }],
        requirements: [], completionCriteria: ["observations"], adaptationPolicy: "stop when covered",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "observations collected", nextTasks: [] });
    case "research.answer_synthesis":
      return JSON.stringify({
        directAnswer: "Liquidity conditions were observed.",
        keyFactors: [{ factor: "liquidity", mechanism: "observed", direction: "current", evidenceRefs: [], counterevidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" }],
        whatWouldChangeTheView: [], implication: "", uncertainty: [], confidence: "MODERATE", citedObjectRefs: [],
      });
    default:
      return JSON.stringify({});
  }
}

async function app(): Promise<ResearchApp> {
  const store = new MemoryStore();
  const workspace = new Workspace();
  await store.save(workspace.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  const provider = {
    providerId: "thesis/scripted",
    modelId: "scripted-1",
    async structured<T>(request: StructuredRequest) {
      const raw = scripted(request.schemaName);
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
  return ResearchApp.create({ provider, registry, store, workspace });
}

beforeEach(() => resetIdCounters());

describe("stated thesis text", () => {
  it("copies the statement verbatim and stops at the sentence boundary", () => {
    expect(statedThesisText(MESSAGE)).toBe("liquidity conditions are the primary driver");
  });

  it("reads a stated view and a stated position the same way", () => {
    expect(statedThesisText("My view is that momentum persists into next week")).toBe("momentum persists into next week");
    expect(statedThesisText("Our position is that spreads compress further")).toBe("spreads compress further");
  });

  it("returns undefined when the trader stated no thesis", () => {
    expect(statedThesisText("Focus specifically on ETF flows.")).toBeUndefined();
    expect(statedThesisText("My thesis")).toBeUndefined();
  });
});

describe("thesis capture inside a conversation", () => {
  it("an UNCONFIRMED stated thesis records NOTHING and asks the trader to confirm", async () => {
    const a = await app();
    const response = await a.submitResearchRequest("Why did Bitcoin move down today?");
    expect(response.researchRef).toBeDefined();
    const follow = await a.submitResearchRequest(MESSAGE);

    expect(a.getWorkspace().listTheses()).toHaveLength(0);
    expect(follow.outcome).toBe("AWAITING_CONFIRMATION");
    expect(follow.answer.answer).toContain("liquidity conditions are the primary driver");
    expect(follow.answer.answer).toMatch(/confirm/i);
  });

  it("a CONFIRMED stated thesis is recorded verbatim before the test runs", async () => {
    const a = await app();
    await a.submitResearchRequest("Why did Bitcoin move down today?");
    const follow = await a.submitResearchRequest(MESSAGE, undefined, true);

    const theses = a.getWorkspace().listTheses();
    expect(theses).toHaveLength(1);
    expect(theses[0]?.statement).toBe("liquidity conditions are the primary driver");
    // The evaluation that follows sees a real thesis object, not "no active thesis".
    expect(follow.answer.answer).not.toMatch(/no active thesis to evaluate/i);
  });
});