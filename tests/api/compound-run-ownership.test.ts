/**
 * COMPOUND PLAN RUN-OWNERSHIP REGRESSION (browser acceptance Test 2).
 *
 * Production failure: a real model expands "Why did Bitcoin move down today?" into a COMPOUND
 * action plan whose steps run DIFFERENT research objects (a generic adaptive step plus a
 * canonical flow step). The response assembler then bound the DTO's identity to the FIRST run
 * while the answer, citations and judgments came from the flow's run. The client's run-coherence
 * guard correctly refuses such a self-contradictory payload — and dropped the completed result
 * silently, so the finished report never reached the screen (the trader found it only in
 * History).
 *
 * The law asserted here (provenance contract, run-ownership remediation): a response presents
 * the answer-bearing run, and EVERY artifact it carries (evidence objects, judgments,
 * citations) belongs to that one run. The client's guard must accept the payload exactly as
 * the wire delivers it — no client-side repair, no rendering-time filtering.
 *
 * The pipeline is real (routing → LUI → flow runner / adaptive loop → capability registry →
 * evidence → judgment backstop → response assembly); only the model provider (scripted) and
 * the capability transport (a stub) are substituted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { endRun } from "../../src/domain/run-context.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import type { ResearchResponseDto } from "../../src/api/dto.js";

const Q = "Why did Bitcoin move down today?";

/**
 * THE BUGGY SHAPE, pinned so the guard's contract stays visible: identity bound to run A while
 * a judgment and evidence from run B ride along. The client MUST refuse this (run-ownership
 * is true by construction; a payload that violates it is an assembly fault, not a nuance).
 */
function incoherentMixedRunResponse(): ResearchResponseDto {
  return {
    requestId: "req", action: "RESEARCH", outcome: "COMPLETED",
    answer: { answer: "flow conclusion", supportingReasons: [], opposingReasons: [], counterevidenceStatus: "NOT_ASSESSED", confidence: "MODERATE", keyUncertainty: "", implication: "", citedObjectRefs: ["ev_B"] },
    limitations: [], researchGaps: [],
    researchRef: "rs_A", researchRunId: "rs_A",
    evidenceRefs: ["ev_A", "ev_B"],
    evidence: [
      { ref: "ev_A", researchRunId: "rs_A", observation: "run A observation", evidenceType: "market_data", evidenceClass: "RAW_DATA", freshness: "CURRENT", observedAt: "2026-10-04T09:00:00.000Z", sourceRefs: [], supports: [], contradicts: [] },
      { ref: "ev_B", researchRunId: "rs_B", observation: "run B observation", evidenceType: "market_data", evidenceClass: "RAW_DATA", freshness: "CURRENT", observedAt: "2026-10-04T09:01:00.000Z", sourceRefs: [], supports: [], contradicts: [] },
    ],
    judgments: [
      { ref: "jd_B", researchRunId: "rs_B", statement: "flow's judgment", uncertainty: [], implications: [], unresolvedQuestions: [], supportingEvidence: ["ev_B"], opposingEvidence: [], keyClaims: [], hypotheses: [], status: "ACTIVE" },
      { ref: "jd_A", researchRunId: "rs_A", statement: "backstop echo of the flow's conclusion", uncertainty: [], implications: [], unresolvedQuestions: [], supportingEvidence: ["ev_A"], opposingEvidence: [], keyClaims: [], hypotheses: [], status: "ACTIVE" },
    ],
  };
}

function scripted(request: StructuredRequest): string {
  switch (request.schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: Q, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      // The production shape: step 0 = generic adaptive research, step 1 = the causal flow.
      // Step 1's flow param makes the routing deterministic; step 0's WHAT_HAPPENED would also
      // route to a flow, so it deliberately carries NO flow param (generic adaptive loop) —
      // exactly the mixed plan a real model emits for this question.
      return JSON.stringify({
        steps: [
          { action: "RESEARCH", description: "Establish what happened to Bitcoin today before explaining it", capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: "What happened to Bitcoin today", question: "What happened to Bitcoin today" } },
          { action: "RESEARCH", description: Q, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: Q, question: Q, flow: "WHY_IT_HAPPENED" } },
        ],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: Q, scopeIncluded: ["Bitcoin"], scopeExcluded: [],
        tasks: [{ type: "FACT_FINDING", objective: Q, capabilities: ["CRYPTO_MARKET_DATA"], completion: "observations" }],
        requirements: [], completionCriteria: ["observations"], adaptationPolicy: "stop when covered",
      });
    case "research.adaptive_decision":
      return JSON.stringify({ decision: "COMPLETE", rationale: "observations collected", nextTasks: [] });
    case "research.answer_synthesis":
      // The generic loop's own answer over its own evidence (what a real model produces).
      return JSON.stringify({
        directAnswer: "Bitcoin traded lower through the observation window.",
        keyFactors: [{ factor: "spot selling", mechanism: "observed", direction: "down", evidenceRefs: [], counterevidenceRefs: [], evidenceQuality: "DIRECT_EVIDENCE", evidenceDirectness: "DIRECT" }],
        whatWouldChangeTheView: [], implication: "", uncertainty: [], confidence: "MODERATE",
        citedObjectRefs: [...new Set(request.prompt.match(/ev_\d+/g) ?? [])].slice(0, 3),
      });
    case "flow2.causal_synthesis":
      // A real model cites the evidence ids that actually appear in the provided context.
      return JSON.stringify({
        eventDefinition: `Bitcoin declined during the observed window; magnitude per evidence.`,
        leadingExplanation: "Sustained outflows from spot ETFs outweighed spot demand.",
        supportingReasons: ["Net ETF flow observations were negative across the window."],
        competingExplanations: ["Broad risk-off macro repricing."],
        contradictions: ["Perpetual funding rates stayed near neutral, which weakens the leverage-unwind story."],
        causalStatus: "PLAUSIBLE_MECHANISM",
        confidence: "MODERATE",
        uncertainty: ["The window is too short to separate ETF flows from macro flows."],
        whatWouldChange: ["A same-window macro shock with matching timestamps."],
        citedObjectRefs: [...new Set(request.prompt.match(/ev_\d+/g) ?? [])].slice(0, 3),
      });
    default:
      return JSON.stringify({});
  }
}

const provider: ModelProvider = {
  providerId: "test/compound-run-ownership", modelId: "scripted",
  async structured<T>(request: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
    const raw = scripted(request);
    return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted" };
  },
};

const stubAdapter: ProviderAdapter = {
  providerId: "stub-market", capabilities: ["CRYPTO_MARKET_DATA"],
  limitations: ["test stub"], freshnessProfile: "test:live",
  async execute(capability: string) {
    return {
      tool: "stub-market", capability, transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({ symbol: "BTC", price: 84821, observed_at: "2026-10-04T09:00:00.000Z" }),
        about: "BTC",
      }],
    };
  },
};

/** The client-side run-coherence guard, verbatim in behavior (rendering trusts only coherent payloads). */
function clientGuardAccepts(response: ResearchResponseDto): boolean {
  const runId = response.researchRunId ?? response.researchRef;
  if (runId === undefined) return true;
  const allBelong = (refs: readonly string[]): boolean =>
    refs.every((ref) => response.evidence.some((e) => e.ref === ref));
  if (!allBelong(response.answer.citedObjectRefs)) return false;
  for (const judgment of response.judgments) {
    if (judgment.researchRunId !== runId) return false;
    if (!allBelong(judgment.supportingEvidence) || !allBelong(judgment.opposingEvidence)) return false;
  }
  for (const e of response.evidence) {
    if (e.researchRunId !== undefined && e.researchRunId !== runId) return false;
  }
  return true;
}

beforeEach(() => { resetIdCounters(); endRun(); });

async function app(): Promise<ResearchApp> {
  const store = new MemoryStore();
  const ws = new Workspace();
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  return ResearchApp.create({ provider, registry, store, workspace: ws });
}

describe("compound plan run ownership (Test 2 regression)", () => {
  it("the buggy mixed-run shape is refused by the client guard", () => {
    expect(clientGuardAccepts(incoherentMixedRunResponse())).toBe(false);
  });

  it("a compound plan (adaptive step + flow step) binds the whole response to the answer-bearing run", async () => {
    const research = await app();
    const response = await research.submitResearchRequest(Q);

    expect(response.outcome).toBe("COMPLETED");
    const runId = response.researchRunId ?? response.researchRef;
    expect(runId).toBeDefined();
    // The answer is the flow's; the response identity must be the flow's run, not the first
    // step's (first-writer-wins was the bug).
    expect(response.answer.answer).toContain("What the evidence suggests:");
    expect(response.judgmentRef).toBeDefined();

    // RUN OWNERSHIP, artifact by artifact — exactly what the client guard checks.
    expect(clientGuardAccepts(response)).toBe(true);
    for (const j of response.judgments) expect(j.researchRunId).toBe(runId);
    for (const e of response.evidence) {
      if (e.researchRunId !== undefined) expect(e.researchRunId).toBe(runId);
    }
    for (const ref of response.answer.citedObjectRefs) {
      expect(response.evidence.some((e) => e.ref === ref)).toBe(true);
    }
    // The minted judgment is the run's own validated answer, never a sibling run's conclusion
    // echoed onto another run (the old cross-run echo produced jd(run A) with the flow's text).
    for (const j of response.judgments) {
      expect(j.statement === response.answer.answer || j.statement.startsWith("LEADING EXPLANATION: ") || j.statement.startsWith("Leading explanation:") || j.statement.startsWith("**What the evidence suggests:**") || j.statement.startsWith("What the evidence suggests:")).toBe(true);
    }
  });

  it("the reopened aggregate is the same self-consistent payload the live event carried", async () => {
    const research = await app();
    const response = await research.submitResearchRequest(Q);
    const runId = response.researchRunId ?? response.researchRef;
    expect(runId).toBeDefined();

    const reopened = await research.getResearchFresh(runId!);
    expect(reopened.outcome).toBe("COMPLETED");
    expect(clientGuardAccepts(reopened)).toBe(true);
    expect(reopened.researchRunId).toBe(runId);
    for (const j of reopened.judgments) expect(j.researchRunId).toBe(runId);
    for (const e of reopened.evidence) {
      if (e.researchRunId !== undefined) expect(e.researchRunId).toBe(runId);
    }
  });
});
