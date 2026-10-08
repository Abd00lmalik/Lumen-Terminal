/**
 * FOLLOW-UP EVIDENCE POLICY — regression suite for the production failure after 5adb447:
 * a "based only on the evidence you just collected" follow-up performed FRESH web retrieval,
 * ingested an unrelated Polygon/TRON news item into a BTC investigation, and reported a
 * generic boilerplate "finding" as COMPLETED/ANSWERED with UNKNOWN confidence.
 *
 * The contract pinned here (FOLLOW_UP + EVIDENCE_ONLY = NO_NEW_RETRIEVAL):
 * zero capability execution, zero new evidence objects, output cited to the parent's
 * evidence ids only, no root-flow routing, parent record untouched, and honest
 * INSUFFICIENT (never a generic COMPLETED) when the parent's evidence cannot support a finding.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { endRun } from "../../src/domain/run-context.js";
import { nestFollowUpsUnderParents } from "../../frontend/src/data/history.js";
import type { ModelProvider, StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const PARENT_QUESTION = "What is Bitcoin's current price, today's high, today's low, and 24-hour volume? Give me the observed numbers, timestamp, and source for each.";
const FOLLOW_UP = "Based only on the evidence you just collected, summarize the strongest finding in one sentence.";
const GENERIC_FINDING = "Across 1 research run on BTC, here is what this investigation established. This is research context, not a recommendation.";
const STALE_CANDLE = JSON.stringify({
  symbol: "BTC", candles: [{ openTime: "2026-10-07T07:00:00.000Z", open: 84229.01, high: 84310.42, low: 84090.79, close: 84142.92, baseVolume: 67.7 }],
  observedAt: "2026-10-07T07:30:00.000Z", about: "BTC",
});

function parentScripts(question: string): Record<string, string> {
  return {
    "lui.normalized_request": JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 }),
    "lui.resolved_target": JSON.stringify({ asset: "BTC", objectRefs: [], unresolved: [] }),
    "lui.ambiguity": JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" }),
    "lui.consequence": JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false }),
    "safety.screen": JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" }),
    "lui.action_plan": JSON.stringify({ steps: [{ action: "RESEARCH", description: question, capabilities: ["CRYPTO_MARKET_DATA"], params: { objective: question, question } }], requiresConfirmationFor: [] }),
    "research.plan": JSON.stringify({ objective: question, scopeIncluded: ["Bitcoin"], scopeExcluded: [], tasks: [{ type: "FACT_FINDING", objective: question, capabilities: ["CRYPTO_MARKET_DATA"], completion: "obs" }], requirements: [], completionCriteria: ["obs"], adaptationPolicy: "stop" }),
    "research.adaptive_decision": JSON.stringify({ decision: "COMPLETE", rationale: "collected", nextTasks: [] }),
    "research.answer_synthesis": JSON.stringify({ directAnswer: `observation recorded for ${question}`, keyFactors: [], whatWouldChangeTheView: [], implication: "", uncertainty: [], confidence: "LOW", citedObjectRefs: [] }),
  };
}

type Behavior = "honest" | "generic";
function testProvider(scripts: Record<string, string>, behavior: Behavior): ModelProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    providerId: "test/scripted", modelId: "test",
    async structured<T>(r: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
      calls.push(r.schemaName);
      let raw = scripts[r.schemaName] ?? "{}";
      if (r.schemaName === "research.follow_up_summary") {
        // The honest variant cites an evidence id the prompt actually carried; the generic
        // variant reproduces the production boilerplate with no citation at all.
        raw = behavior === "honest"
          ? JSON.stringify({ finding: `The parent run observed BTC trading at 84142.92 with volume 67.7 on its single collected candle.`, evidenceRefs: [/\[?(ev_\d+)/.exec(r.prompt)?.[1] ?? "ev_000001"], confidence: "MODERATE" })
          : JSON.stringify({ finding: GENERIC_FINDING, evidenceRefs: [], confidence: "MODERATE" });
      }
      return { data: JSON.parse(raw) as T, raw, schemaName: r.schemaName, modelId: "test" };
    },
  };
}

const executed: string[] = [];
const adapter: ProviderAdapter = {
  providerId: "stub", capabilities: ["CRYPTO_MARKET_DATA"], limitations: ["test"], freshnessProfile: "test:live",
  async execute(capability: string) {
    executed.push(capability);
    return { tool: "stub", capability, transport: "https", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: STALE_CANDLE, about: "BTC" }] };
  },
};

beforeEach(() => { resetIdCounters(); endRun(); executed.length = 0; });

let lastProvider: ReturnType<typeof testProvider> | undefined;
async function app(behavior: Behavior): Promise<ResearchApp> {
  const store = new MemoryStore();
  const ws = new Workspace();
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(adapter);
  lastProvider = testProvider(parentScripts(PARENT_QUESTION), behavior);
  return ResearchApp.create({ provider: lastProvider, registry, store, workspace: ws });
}

describe("follow-up evidence policy (FOLLOW_UP + EVIDENCE_ONLY = NO_NEW_RETRIEVAL)", () => {
  it("A+B+C+D+E+F: an evidence-only follow-up retrieves nothing, inherits parent evidence, cites only parent ids, and is not routed as a root flow", async () => {
    const a = await app("honest");
    const parentResponse = await a.submitResearchRequest(PARENT_QUESTION);
    const parentRef = parentResponse.researchRef!;
    const ws = a.getWorkspace();
    const parent = ws.getResearch(parentRef)!;
    const parentEvidenceIds = [...parent.evidenceRefs];
    expect(parentEvidenceIds.length).toBeGreaterThan(0);
    const evidenceBefore = new Set(ws.listResearch().flatMap((r) => r.evidenceRefs));

    const callsBeforeFollowUp = testCalls(a).length;
    const executionsBeforeFollowUp = executed.length; // the PARENT run executed market data; the follow-up must add zero
    const response = await a.submitResearchRequest(FOLLOW_UP, undefined, false, ws.currentInvestigationIdValue);
    const followUpRef = response.researchRef!;
    const followUp = ws.getResearch(followUpRef)!;

    // A: zero retrieval — the capability registry was never touched and no engine schemas ran.
    expect(executed.length).toBe(executionsBeforeFollowUp);
    const newSchemas = testCalls(a).slice(callsBeforeFollowUp);
    expect(newSchemas).toEqual(expect.arrayContaining(["safety.screen", "research.follow_up_summary"]));
    for (const schema of newSchemas) {
      expect(["research.plan", "research.adaptive_decision", "research.answer_synthesis", "lui.action_plan", "lui.normalized_request", "lui.resolved_target", "lui.ambiguity", "lui.consequence"]).not.toContain(schema);
    }

    // B+C: inheritance without duplication — no new evidence object anywhere in the graph.
    expect(ws.listResearch().flatMap((r) => r.evidenceRefs).filter((id) => !evidenceBefore.has(id))).toHaveLength(0);
    expect(ws.evidenceForResearch(followUpRef)).toHaveLength(0);

    // D: the output cites the parent's evidence ids, and nothing outside them.
    expect(response.answer.citedObjectRefs.length).toBeGreaterThan(0);
    for (const ref of response.answer.citedObjectRefs) expect(parentEvidenceIds).toContain(ref);
    const diagnostics = response.researchDiagnostics as { requirements?: { status: string; evidenceRefs: readonly string[] }[] } | undefined;
    const row = diagnostics?.requirements?.[0];
    expect(row?.status).toBe("SATISFIED");
    for (const ref of row?.evidenceRefs ?? []) expect(parentEvidenceIds).toContain(ref);

    // E: routing — a continuation under the parent, never a fresh root flow.
    expect(followUp.flow).toBe("FOLLOW_UP");
    expect(followUp.parentResearchId).toBe(parentRef);
    expect(response.outcome).toBe("COMPLETED");

    // F: the answer answers the actual question — one sentence, no generic boilerplate.
    expect(response.answer.answer).not.toContain("Across 1 research run");
    expect(response.answer.answer.split(/(?<=[.?!])\s+/).filter((s) => s.trim()).length).toBeLessThanOrEqual(2);
  });

  it("G+H: a generic uncited result cannot be COMPLETED — the follow-up stays unresolved with a supported confidence", async () => {
    const a = await app("generic");
    const parentResponse = await a.submitResearchRequest(PARENT_QUESTION);
    const parentRef = parentResponse.researchRef!;
    const ws = a.getWorkspace();
    const response = await a.submitResearchRequest(FOLLOW_UP, undefined, false, ws.currentInvestigationIdValue);
    const followUp = ws.getResearch(response.researchRef!)!;

    expect(response.outcome).toBe("INSUFFICIENT");
    expect(followUp.status).toBe("FAILED");
    expect(ws.judgmentsForResearch(response.researchRef!)).toHaveLength(0);
    expect(response.answer.answer).not.toBe(GENERIC_FINDING);
    expect(response.answer.answer.length).toBeGreaterThan(0);
    // H: confidence is never UNKNOWN on a demoted-but-presented answer, and never HIGH without support.
    expect(["LOW", "MODERATE"]).toContain(response.answer.confidence);
    expect(parentRef).toBeDefined();
  });

  it("J: the parent record and evidence are untouched after the follow-up runs", async () => {
    const a = await app("honest");
    const parentResponse = await a.submitResearchRequest(PARENT_QUESTION);
    const parentRef = parentResponse.researchRef!;
    const ws = a.getWorkspace();
    const parentBefore = {
      status: ws.getResearch(parentRef)!.status,
      evidenceRefs: [...ws.getResearch(parentRef)!.evidenceRefs],
      record: JSON.stringify(ws.getResearchResponse(parentRef) ?? null),
      judgments: ws.judgmentsForResearch(parentRef).map((j) => j.ref),
    };
    await a.submitResearchRequest(FOLLOW_UP, undefined, false, ws.currentInvestigationIdValue);
    const parentAfter = ws.getResearch(parentRef)!;
    expect(parentAfter.status).toBe(parentBefore.status);
    expect([...parentAfter.evidenceRefs]).toEqual(parentBefore.evidenceRefs);
    expect(JSON.stringify(ws.getResearchResponse(parentRef) ?? null)).toBe(parentBefore.record);
    expect(ws.judgmentsForResearch(parentRef).map((j) => j.ref)).toEqual(parentBefore.judgments);
  });

  it("I: History nests the follow-up under its parent (persisted lineage, position-independent)", async () => {
    const a = await app("honest");
    const parentResponse = await a.submitResearchRequest(PARENT_QUESTION);
    const parentRef = parentResponse.researchRef!;
    const ws = a.getWorkspace();
    await a.submitResearchRequest(FOLLOW_UP, undefined, false, ws.currentInvestigationIdValue);
    // The backend list carries the lineage as data.
    const rows = await a.listResearch({ limit: 10 });
    const followUpRow = rows.find((r) => r.parentResearchId === parentRef);
    expect(followUpRow).toBeDefined();
    // The frontend nesting derives from that field only (a root listed after its child still nests).
    const nested = nestFollowUpsUnderParents([
      { ref: followUpRow!.ref, parentResearchId: parentRef, question: "follow-up question" },
      { ref: parentRef, question: PARENT_QUESTION },
    ]);
    expect(nested[0]!.entry.ref).toBe(parentRef);
    expect(nested[0]!.depth).toBe(0);
    expect(nested[1]!.depth).toBe(1);
    expect(nested[1]!.parentQuestion).toBe(PARENT_QUESTION);
  });
});

function testCalls(_a: ResearchApp): string[] {
  return lastProvider?.calls ?? [];
}
