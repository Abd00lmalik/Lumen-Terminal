/**
 * CONVERSATION FRAME (follow-up turns read the conversation they belong to).
 *
 * The failure this pins, found by driving the real pipeline over real HTTP/SSE: after a trader
 * asked "Why did Bitcoin move down today?" and then followed up with "Focus specifically on ETF
 * flows.", the interpreter read the follow-up in a vacuum, classified it as MANAGE_STATE ("set
 * my active target to ETF flows"), the ambiguity check then asked which asset and which period
 * were meant, and the turn ended AWAITING_CONFIRMATION with NO research run behind it. The
 * trader read their previous answer back as the answer to the follow-up.
 *
 * The conversation layer had already routed the turn correctly (CONTINUE / DEEPER); the
 * information never reached the model calls that interpret, resolve, disambiguate and plan it.
 * These tests run the REAL application path and pin that every one of those calls reads the
 * same frame: the investigation, the recorded conversation decision, and the trader's turns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { endRun } from "../../src/domain/run-context.js";
import type { StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";

const Q1 = "Why did Bitcoin move down today?";
const Q2 = "Focus specifically on ETF flows.";

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

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", flow: "WHY_IT_HAPPENED", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{ action: "RESEARCH", description: question, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: question, question } }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: question, scopeIncluded: ["Bitcoin"], scopeExcluded: [],
        tasks: [{ type: "FACT_FINDING", objective: question, capabilities: ["CRYPTO_MARKET_DATA"], completion: "observations" }],
        requirements: [], completionCriteria: ["observations"], adaptationPolicy: "stop when covered",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "observations collected", nextTasks: [] });
    case "research.answer_synthesis":
      return JSON.stringify({
        directAnswer: `Findings for: ${question}`,
        keyFactors: [{ factor: "flow", mechanism: "observed", direction: "current", evidenceRefs: [], counterevidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" }],
        whatWouldChangeTheView: [], implication: "", uncertainty: [], confidence: "MODERATE", citedObjectRefs: [],
      });
    default:
      return JSON.stringify({});
  }
}

/** The scripted provider, RECORDING every request so the prompts themselves are observable. */
function recordingProvider(): { provider: { providerId: string; modelId: string; structured<T>(r: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> }; calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    calls,
    provider: {
      providerId: "conversation/scripted",
      modelId: "scripted-1",
      async structured<T>(request: StructuredRequest) {
        calls.push(request);
        const raw = scripted(request.schemaName, Q2);
        return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
      },
    },
  };
}

async function app(): Promise<{ app: ResearchApp; calls: StructuredRequest[] }> {
  const store = new MemoryStore();
  const workspace = new Workspace();
  await store.save(workspace.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  const { provider, calls } = recordingProvider();
  return { app: await ResearchApp.create({ provider, registry, store, workspace }), calls };
}

beforeEach(() => { resetIdCounters(); endRun(); });

describe("CONVERSATION FRAME — a follow-up is read inside its conversation", () => {
  it("the follow-up's interpreter prompt carries the investigation, its subject and the recorded decision", async () => {
    const { app: a, calls } = await app();
    await a.submitResearchRequest(Q1);
    calls.length = 0;
    await a.submitResearchRequest(Q2);

    const interpreter = calls.find((c) => c.schemaName === "lui.normalized_request");
    expect(interpreter).toBeDefined();
    expect(interpreter!.prompt).toContain("Active investigation:");
    expect(interpreter!.prompt).toContain(Q1);
    expect(interpreter!.prompt).toContain("DEEPER");
    expect(interpreter!.prompt).toContain(Q2);
  });

  it("target resolution, the ambiguity check and the plan all read the same frame", async () => {
    const { app: a, calls } = await app();
    await a.submitResearchRequest(Q1);
    calls.length = 0;
    await a.submitResearchRequest(Q2);

    for (const schemaName of ["lui.resolved_target", "lui.ambiguity", "lui.action_plan"]) {
      const call = calls.find((c) => c.schemaName === schemaName);
      expect(call, `${schemaName} was never called`).toBeDefined();
      expect(call!.prompt, schemaName).toContain("Active investigation:");
      expect(call!.prompt, schemaName).toContain(Q2);
    }
  });

  it("the interpretation rules say a narrowing follow-up is RESEARCH, not a working-state change", async () => {
    const { app: a, calls } = await app();
    await a.submitResearchRequest(Q2);
    const interpreter = calls.find((c) => c.schemaName === "lui.normalized_request");
    expect(interpreter!.system).toMatch(/FOLLOW-UP INSIDE AN ACTIVE INVESTIGATION/);
    expect(interpreter!.system).toMatch(/NOT MANAGE_STATE/);
    const target = calls.find((c) => c.schemaName === "lui.resolved_target");
    expect(target!.system).toMatch(/FOLLOW-UP INSIDE AN ACTIVE INVESTIGATION/);
    const ambiguity = calls.find((c) => c.schemaName === "lui.ambiguity");
    expect(ambiguity!.system).toMatch(/NOT ambiguous when the CONVERSATION CONTEXT/);
  });

  it("a first question in an empty workspace gets no frame", async () => {
    const { app: a, calls } = await app();
    await a.submitResearchRequest(Q1);
    const interpreter = calls.find((c) => c.schemaName === "lui.normalized_request");
    expect(interpreter!.prompt).not.toContain("Active investigation:");
  });
});