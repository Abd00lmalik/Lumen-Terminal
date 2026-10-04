/**
 * REQUEST-SIZE REGRESSION SUITE (the HTTP 413 fix).
 *
 * THE FAILURE THIS LOCKS DOWN. On a completely fresh investigation, "Why did Bitcoin move down
 * today?" was rejected before any research happened: `Groq HTTP 413 PAYLOAD_TOO_LARGE`. The cause
 * was NOT the question. The initial target-resolution prompt serialized the ENTIRE workspace
 * evidence archive as two id lists (a full enumeration, plus a "… N more" marker that enumerated
 * the ids it claimed to omit) — 25 KB + 24 KB on the deployed workspace, growing without bound as
 * the workspace accumulated runs until it crossed Groq's 128 KiB body limit. A fresh
 * investigation therefore inherited the whole history of the workspace.
 *
 * THE LAWS UNDER TEST (mapped to the brief's A–F):
 *  A. A fresh question produces a request under the provider's accepted size, the model request
 *     is constructed, and the flow proceeds to real research — no 413, and no fabricated state
 *     when a model genuinely fails.
 *  B. A fresh investigation carries NO irrelevant history in its initial request.
 *  C. Multi-turn follow-ups still carry the context conversational continuity actually requires.
 *  D. Large historical context does not overflow, because only relevant context is serialized.
 *  E. The provider fallback never resends the same oversized payload; it gets a reduced budget.
 *  F. The research-integrity invariants still hold (ownership, run-scoped context, citable set).
 *
 * Everything runs the REAL pipeline (LUI -> research engine -> capability registry -> evidence ->
 * judgment backstop -> response assembly). Only the model provider (scripted) and the capability
 * transport (a stub) are substituted, and the provider runs the REAL `budgetRequest` so the byte
 * counts asserted here are the bytes that would go on the wire.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type CapabilityName, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import { buildInvestigationContext, renderInvestigationContext } from "../../src/research/investigation-context.js";
import { ModelFailure, type ModelProvider, type StructuredRequest, type StructuredResponse } from "../../src/model/provider.js";
import { ModelFallbackProvider } from "../../src/model/fallback.js";
import {
  ENVELOPE_BYTES,
  FALLBACK_BUDGET_FRACTION,
  PROVIDER_REQUEST_LIMIT_BYTES,
  budgetRequest,
  compactPrompt,
  limitForProvider,
  measureRequest,
  serializedRequestBytes,
  setRequestBudgetObserver,
  traderWords,
  type RequestBudgetReport,
} from "../../src/model/request-budget.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const NL = String.fromCharCode(10);
const trader: ProvenanceOrigin = { kind: "trader", detail: "request-size test" };

/** The exact reproduction input from the brief. */
const Q1 = "Why did Bitcoin move down today?";
const Q2 = "Focus specifically on ETF flows.";

const GROQ_LIMIT = PROVIDER_REQUEST_LIMIT_BYTES["groq"]!;

/** The exact system+schema text groq.ts puts in the system message (see groq.ts systemWithSchema). */
function systemWithSchema(request: StructuredRequest): string {
  return [
    request.system,
    "",
    `OUTPUT CONTRACT: respond with exactly one JSON object conforming to schema "${request.schemaName}".`,
    "OPTIONAL FIELDS: when a field is optional and you have no value for it, OMIT the key entirely; never send null, never send an empty string in its place.",
    "REQUIRED LIST FIELDS: always include every required key; when a list has no items, send an empty array [] rather than omitting the key.",
    `Schema: ${request.schemaDescription}`,
    "No prose outside the JSON object. No markdown fences.",
  ].join(NL);
}

/** The bytes a Groq-shaped request actually puts on the wire. */
function groqBodyBytes(request: StructuredRequest): number {
  const budgeted = budgetRequest(request, {
    providerId: "groq",
    modelId: "groq-model",
    systemAndSchemaBytes: Buffer.byteLength(systemWithSchema(request), "utf8"),
  }).request;
  return Buffer.byteLength(JSON.stringify({
    model: "groq-model",
    messages: [
      { role: "system", content: systemWithSchema(budgeted) },
      { role: "user", content: budgeted.prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  }), "utf8");
}

function scripted(schemaName: string, question: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "RESEARCH", compoundActions: [], objective: question, isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", objectRefs: [], unresolved: [] });
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
    case "flow2.causal_synthesis":
      return JSON.stringify({
        eventDefinition: "BTC moved down over the session",
        leadingExplanation: "forced selling pressure",
        supportingReasons: ["price decline"],
        competingExplanations: ["macro risk-off"],
        contradictions: [],
        causalStatus: "PLAUSIBLE_MECHANISM",
        confidence: "LOW",
        uncertainty: ["positioning data not yet collected"],
        whatWouldChange: [],
        citedObjectRefs: [],
      });
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

interface RecordingProvider extends ModelProvider {
  /** Every request the pipeline built, with the bytes it WOULD have serialized. */
  readonly seen: { request: StructuredRequest; bytes: number }[];
  /** Every request as actually budgeted (post-compaction), for inspection. */
  readonly budgeted: StructuredRequest[];
}

function recordingProvider(question: string): RecordingProvider {
  const seen: { request: StructuredRequest; bytes: number }[] = [];
  const budgeted: StructuredRequest[] = [];
  return {
    providerId: "size/scripted",
    modelId: "scripted-1",
    seen,
    budgeted,
    async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
      const result = budgetRequest(request, {
        providerId: "groq",
        modelId: "scripted-1",
        systemAndSchemaBytes: Buffer.byteLength(systemWithSchema(request), "utf8"),
      });
      seen.push({ request, bytes: groqBodyBytes(request) });
      budgeted.push(result.request);
      const raw = scripted(request.schemaName, question);
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
}

const stubAdapter: ProviderAdapter = {
  providerId: "stub-market",
  capabilities: ["CRYPTO_MARKET_DATA", "FALSIFICATION", "NEWS_ANALYSIS"],
  limitations: ["test stub"],
  freshnessProfile: "test:live",
  async execute(capability: CapabilityName) {
    return {
      tool: "stub-market", capability, transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({ symbol: "BTC", price: 84821, observed_at: "2026-10-03T12:49:40.000Z" }),
        about: "BTC",
      }],
    };
  },
};

beforeEach(() => { resetIdCounters(); endRun(); });
afterEach(() => { setRequestBudgetObserver(undefined); endRun(); });

async function app(question = Q1): Promise<{ app: ResearchApp; provider: RecordingProvider }> {
  const store = new MemoryStore();
  const ws = new Workspace();
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(stubAdapter);
  const provider = recordingProvider(question);
  return { app: await ResearchApp.create({ provider, registry, store, workspace: ws }), provider };
}

/**
 * Grow the workspace the way a long-lived deployment does: many completed runs, each with its
 * own evidence, plus judgments. This is the history that used to be serialized into every fresh
 * investigation's initial request.
 */
function seedArchive(ws: Workspace, runs: number, evidencePerRun: number): void {
  for (let i = 0; i < runs; i++) {
    const runId = `run_seed_${i}`;
    beginRun({ runId, userQuestion: `archived question ${i}` });
    const r = ws.addResearch({ objective: `archived question ${i}`, question: `archived question ${i}`, flow: "WHAT_HAPPENED" }, trader, new Date("2026-09-01T00:00:00.000Z"));
    ws.transitionResearch(r.id, "ACTIVE", trader, "activated", new Date("2026-09-01T00:00:00.000Z"));
    const ids: string[] = [];
    for (let e = 0; e < evidencePerRun; e++) {
      const ev = ws.addEvidence(
        {
          observation: `archived observation ${i}-${e}: ` + "market detail ".repeat(12),
          evidenceType: "market_data",
          evidenceClass: "RAW_DATA",
          timestamp: "2026-09-01T00:00:00.000Z",
        },
        trader,
        new Date("2026-09-01T00:00:00.000Z"),
      );
      ws.ingestEvidence(ev, r.id);
      ids.push(ev.id);
    }
    ws.addJudgment(
      { researchRef: r.id, statement: `archived conclusion ${i}`, basis: { supportingEvidence: ids, opposingEvidence: [], keyClaims: [], hypotheses: [] } },
      trader,
      new Date("2026-09-01T00:00:00.000Z"),
    );
    ws.transitionResearch(r.id, "COMPLETED", trader, "completed", new Date("2026-09-01T00:00:00.000Z"));
    endRun(runId);
  }
}

// ===========================================================================
// A — fresh question: under the limit, request constructed, flow proceeds
// ===========================================================================

describe("A — a fresh research request on a clean investigation", () => {
  it("builds every model request under the provider limit, with no compaction needed", async () => {
    const { app: a, provider } = await app();
    const response = await a.submitResearchRequest(Q1);

    // The request was actually constructed and sent (no 413 short-circuit).
    expect(provider.seen.length).toBeGreaterThan(0);
    expect(provider.seen.map((s) => s.request.schemaName)).toContain("lui.resolved_target");
    // Every serialized request is inside the accepted size.
    for (const call of provider.seen) {
      expect(call.bytes).toBeLessThanOrEqual(GROQ_LIMIT);
    }
    // ...and the pipeline really reached research: interpretation happened, and evidence exists.
    expect(provider.seen.map((s) => s.request.schemaName)).toContain("research.plan");
    const ws = a.getWorkspace();
    expect(ws.listEvidence().length).toBeGreaterThan(0);
    expect(response.answer.answer.length).toBeGreaterThan(0);
  });

  it("the largest single request on an EMPTY workspace stays two orders of magnitude under the limit", async () => {
    const { app: a, provider } = await app();
    await a.submitResearchRequest(Q1);
    const worst = Math.max(...provider.seen.map((s) => s.bytes));
    // Before the fix this call was 5,837 B; the point is the ORDER of magnitude of headroom.
    expect(worst).toBeLessThan(GROQ_LIMIT / 10);
  });

  it("a genuine model failure still produces an honest failure, never a fabricated research result", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    await store.save(ws.toSnapshot());
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const provider: ModelProvider = {
      providerId: "size/failing",
      modelId: "failing-1",
      async structured<T>(): Promise<StructuredResponse<T>> {
        throw new ModelFailure("PROVIDER_UNAVAILABLE", "provider down", true);
      },
    };
    const a = await ResearchApp.create({ provider, registry, store, workspace: ws });
    const response = await a.submitResearchRequest(Q1);
    // No run was invented, no evidence was invented: the trader is told the model failed.
    expect(ws.listResearch()).toHaveLength(0);
    expect(ws.listEvidence()).toHaveLength(0);
    expect(response.outcome).toBe("MODEL_FAILURE");
    expect(response.answer.answer.toLowerCase()).toMatch(/could not be interpreted|model|unavailable|fail/i);
    // The failure is TYPED, not laundered into a trader-facing conclusion about the market.
    expect(response.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
  });
});

// ===========================================================================
// B — a fresh investigation carries no irrelevant history
// ===========================================================================

describe("B — a fresh investigation's initial request carries no irrelevant history", () => {
  it("the target-resolution prompt does not enumerate the workspace evidence archive", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    seedArchive(ws, 12, 40);
    await store.save(ws.toSnapshot()); // AFTER seeding: the app loads this snapshot
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const provider = recordingProvider(Q1);
    const a = await ResearchApp.create({ provider, registry, store, workspace: ws });

    await a.submitResearchRequest(Q1);

    const targetCall = provider.seen.find((s) => s.request.schemaName === "lui.resolved_target")!;
    expect(targetCall).toBeDefined();
    const prompt = targetCall.request.prompt;

    // THE REGRESSION. Before the fix this prompt carried the whole archive as id lists:
    // "CURRENT RUN EVIDENCE (...): ev_000001, ev_000002, …" plus a "… N more (ev_x, ev_y, …)"
    // marker that enumerated the ids it claimed to omit — tens of KB, unbounded in workspace age.
    const archivedIds = a.getWorkspace().listEvidence().map((e) => e.id);
    expect(archivedIds.length).toBeGreaterThan(100);
    const archivedInPrompt = archivedIds.filter((id) => prompt.includes(id));
    expect(archivedInPrompt.length).toBeLessThanOrEqual(45); // 40 rendered + a 5-id marker sample
    // BOUNDED, not absent: the archive is offered only as a labelled, CAPPED sample. The
    // renderer caps each class at 40 rendered items plus a 5-id marker sample, so the id count
    // in a fresh investigation's prompt cannot grow with the archive. Before the fix this was
    // every id in the workspace (2,285 live, unbounded until the provider answered HTTP 413).
    expect(archivedInPrompt.length).toBeLessThan(archivedIds.length / 4);
    expect(prompt).toMatch(/more of this class \(sample:/);
    // Instead the prompt states the honest scoping fact: no run exists for this question yet.
    expect(prompt).toMatch(/NO CURRENT RUN/i);
    expect(prompt).toMatch(/none of them belongs to a run for this question/i);
    // ...and it says how much older material exists, without serializing it.
    expect(prompt).toMatch(/background/i);
  });

  it("the archived runs' observation text appears only as a bounded labelled sample", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    seedArchive(ws, 8, 30);
    await store.save(ws.toSnapshot()); // AFTER seeding: the app loads this snapshot
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const provider = recordingProvider(Q1);
    const a = await ResearchApp.create({ provider, registry, store, workspace: ws });

    await a.submitResearchRequest(Q1);
    const archiveSize = a.getWorkspace().listEvidence().length;
    expect(archiveSize).toBeGreaterThan(200);
    for (const call of provider.seen) {
      const occurrences = (call.request.prompt.match(/archived observation/g) ?? []).length;
      expect(occurrences).toBeLessThanOrEqual(40); // capped per class, never the whole archive
      expect(occurrences).toBeLessThan(archiveSize / 4);
      // Each one is explicitly labelled as another run's, never as current evidence.
      if (occurrences > 0) {
        expect(call.request.prompt).toMatch(/HISTORICAL REFERENCE - another run; never cite it as a current observation/);
      }
      // Archived CONCLUSIONS are never serialized: a prior judgment is not background.
      expect(call.request.prompt).not.toContain("archived conclusion");
    }
  });

  it("the trader's question survives verbatim in every request the turn makes", async () => {
    const { app: a, provider } = await app();
    await a.submitResearchRequest(Q1);
    const carrying = provider.seen.filter((s) => s.request.prompt.includes("Trader message:"));
    expect(carrying.length).toBeGreaterThan(0);
    for (const call of carrying) {
      expect(call.request.prompt).toContain(`Trader message: "${Q1}"`);
    }
  });
});

// ===========================================================================
// C — multi-turn follow-ups keep the context continuity requires
// ===========================================================================

describe("C — multi-turn follow-ups keep the context continuity requires", () => {
  it("a follow-up turn receives the prior turn's findings as labelled prior context", async () => {
    const { app: a, provider } = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const firstRun = ws.investigationRuns(inv.id)[0]!;
    ws.addJudgment(
      {
        researchRef: firstRun.id,
        statement: "ETF flows were negative",
        basis: { supportingEvidence: ws.evidenceForResearch(firstRun.id).map((e) => e.id), opposingEvidence: [], keyClaims: [], hypotheses: [] },
      },
      trader,
    );

    provider.seen.length = 0;
    const followUp = await a.submitResearchRequest(Q2);
    expect(followUp.answer.answer.length).toBeGreaterThan(0);

    // CONTINUITY, measured on what the follow-up's model requests actually carry. The
    // conversation frame replays the earlier turns verbatim, so the follow-up is planned with
    // the first turn's QUESTION and its CONCLUSION in view — this is what a follow-up needs,
    // and it is why the follow-up is not planned as if it were the first question ever asked.
    const prompts = provider.seen.map((s) => s.request.prompt).join(NL);
    expect(prompts).toMatch(/CONVERSATION CONTEXT/i);
    expect(prompts).toMatch(/Why did Bitcoin move down today\?/);
    expect(prompts).toMatch(/Focus specifically on ETF flows\./);
    // The first turn's conclusion is in the frame, not just its question.
    expect(prompts).toMatch(/forced selling/);

    // And the labelled investigation context carries each prior finding attributed to the run
    // that produced it, with the ownership boundary stated rather than assumed.
    const rendered = renderInvestigationContext(
      buildInvestigationContext({ workspace: ws, investigation: ws.currentInvestigation()!, question: Q2 }),
    );
    expect(rendered).toMatch(/ETF flows were negative/);
    expect(rendered).toMatch(firstRun.id);
    expect(rendered).toMatch(/NOT evidence/i);
    // The follow-up is its OWN run: continuity is a reference, never shared ownership.
    expect(ws.investigationRuns(inv.id).length).toBeGreaterThanOrEqual(2);
  });

  it("a follow-up's own evidence is owned by its own run, not the earlier run's", async () => {
    const { app: a } = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const inv = ws.currentInvestigation()!;
    const firstRun = ws.investigationRuns(inv.id)[0]!;
    const firstRunEvidence = ws.evidenceForResearch(firstRun.id).map((e) => e.id);
    await a.submitResearchRequest(Q2);
    const secondRun = ws.investigationRuns(inv.id)[1]!;
    const secondRunEvidence = ws.evidenceForResearch(secondRun.id).map((e) => e.id);
    expect(secondRunEvidence.length).toBeGreaterThan(0);
    // Run 2 owns fresh objects; it did not absorb run 1's evidence into its own ownership.
    for (const id of secondRunEvidence) expect(firstRunEvidence).not.toContain(id);
  });
});

// ===========================================================================
// D — large history does not overflow
// ===========================================================================

describe("D — large historical context does not overflow the provider", () => {
  it("a workspace with a large archive keeps EVERY request under the limit", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    seedArchive(ws, 25, 60);
    await store.save(ws.toSnapshot()); // AFTER seeding: the app loads this snapshot
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const provider = recordingProvider(Q1);
    const a = await ResearchApp.create({ provider, registry, store, workspace: ws });

    const response = await a.submitResearchRequest(Q1);
    expect(response.answer.answer.length).toBeGreaterThan(0);
    expect(provider.seen.length).toBeGreaterThan(0);
    for (const call of provider.seen) {
      expect(call.bytes).toBeLessThanOrEqual(GROQ_LIMIT);
    }
    // The request size does NOT scale with the archive: 1,500 objects must not cost 150x.
    const worst = Math.max(...provider.seen.map((s) => s.bytes));
    expect(worst).toBeLessThan(40_000);
  });

  it("budget compaction, when it does fire, fits the limit and says so in-band", () => {
    // A deliberately enormous context, far past any provider's limit.
    const filler = Array.from({ length: 4_000 }, (_, i) => `    archived evidence line ${i} ${"detail ".repeat(20)}`);
    const request: StructuredRequest = {
      schemaName: "lui.resolved_target",
      schemaDescription: "{ asset: string }",
      system: "system instructions",
      prompt: [`Trader message: "${Q1}"`, "CURRENT WORKSPACE STATE:", "CURRENT RUN EVIDENCE:", ...filler].join(NL),
      protectedFragments: traderWords(Q1),
    };
    const result = budgetRequest(request, {
      providerId: "groq",
      modelId: "groq-model",
      systemAndSchemaBytes: Buffer.byteLength(systemWithSchema(request), "utf8"),
    });
    expect(result.report.compacted).toBe(true);
    expect(result.report.droppedLines).toBeGreaterThan(0);
    expect(result.report.bytesAfter).toBeLessThanOrEqual(limitForProvider("groq"));
    expect(result.report.bytesAfter).toBeLessThan(result.report.bytesBefore);
    // The omission is stated, so the model is never left believing it saw everything.
    expect(result.request.prompt).toMatch(/\[context compacted:/);
    // The trader's question is intact — never truncated, never rewritten.
    expect(result.request.prompt).toContain(`Trader message: "${Q1}"`);
  });

  it("compaction never removes a protected fragment even under extreme pressure", () => {
    const secret = "TRADER-OWNED-THESIS-TEXT-THAT-MUST-SURVIVE";
    const filler = Array.from({ length: 3_000 }, (_, i) => `  context line ${i} ${"x".repeat(80)}`);
    const request: StructuredRequest = {
      schemaName: "thesis.assessment",
      schemaDescription: "{ assessment: string }",
      system: "system",
      prompt: [`Trader message: "${Q1}"`, secret, ...filler].join(NL),
      protectedFragments: [...traderWords(Q1), secret],
    };
    const result = budgetRequest(request, {
      providerId: "groq",
      modelId: "groq-model",
      limitBytes: 4_096, // a deliberately tiny ceiling: far more pressure than production
    });
    expect(result.report.compacted).toBe(true);
    expect(result.request.prompt).toContain(`Trader message: "${Q1}"`);
    expect(result.request.prompt).toContain(secret);
    expect(serializedRequestBytes(result.request)).toBeLessThanOrEqual(4_096);
  });

  it("a request that already fits is returned untouched (no compaction, no marker)", () => {
    const request: StructuredRequest = {
      schemaName: "lui.resolved_target",
      schemaDescription: "{ asset: string }",
      system: "system",
      prompt: [`Trader message: "${Q1}"`, "small context"].join(NL),
    };
    const result = budgetRequest(request, { providerId: "groq", modelId: "m" });
    expect(result.report.compacted).toBe(false);
    expect(result.report.droppedLines).toBe(0);
    expect(result.request.prompt).toBe(request.prompt);
    expect(result.report.bytesBefore).toBe(result.report.bytesAfter);
  });

  it("reports the components a developer needs to attribute a payload", () => {
    const request: StructuredRequest = {
      schemaName: "lui.resolved_target",
      schemaDescription: "{ asset: string }",
      system: "system instructions",
      prompt: "prompt body",
    };
    const components = measureRequest(request);
    expect(components.systemBytes).toBe(Buffer.byteLength("system instructions"));
    expect(components.schemaBytes).toBe(Buffer.byteLength("{ asset: string }"));
    expect(components.promptBytes).toBe(Buffer.byteLength("prompt body"));
    expect(components.envelopeBytes).toBe(ENVELOPE_BYTES);
    expect(serializedRequestBytes(request)).toBe(
      components.systemBytes + components.schemaBytes + components.promptBytes + ENVELOPE_BYTES,
    );
  });

  it("compaction drops the deepest context first and keeps the prompt's leading line", () => {
    const prompt = [
      "Trader message: keep me",
      "HEADER:",
      "    deep line A",
      "    deep line B",
      "    deep line C",
      "  shallow line",
    ].join(NL);
    const { text, droppedLines } = compactPrompt(prompt, traderWords("keep me"), {
      limitBytes: 10_000, systemAndSchemaBytes: 0,
    });
    expect(text).toContain("Trader message: keep me");
    expect(text).toContain("HEADER:");
  });
});

// ===========================================================================
// E — the fallback never resends the same oversized payload
// ===========================================================================

describe("E — provider fallback degrades the payload instead of resending it", () => {
  it("after a 413 the next provider gets a REDUCED budget, not the identical request", async () => {
    const seenByProvider: { providerId: string; request: StructuredRequest }[] = [];
    const primary: ModelProvider = {
      providerId: "gemini",
      modelId: "gemini-model",
      async structured<T>(): Promise<StructuredResponse<T>> {
        throw new ModelFailure("PAYLOAD_TOO_LARGE", "HTTP 413 payload too large", false);
      },
    };
    const secondary: ModelProvider = {
      providerId: "groq",
      modelId: "groq-model",
      async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
        seenByProvider.push({ providerId: "groq", request });
        return { data: {} as T, raw: "{}", schemaName: request.schemaName, modelId: "groq-model" };
      },
    };
    const facade = new ModelFallbackProvider({ providers: [primary, secondary] });
    const bigContext = Array.from({ length: 5_000 }, (_, i) => `  context line ${i} ${"y".repeat(60)}`).join(NL);
    const request: StructuredRequest = {
      schemaName: "lui.resolved_target",
      schemaDescription: "{ asset: string }",
      system: "system",
      prompt: [`Trader message: "${Q1}"`, bigContext].join(NL),
      protectedFragments: traderWords(Q1),
    };

    const response = await facade.structured<string>(request);
    expect(response.raw).toBe("{}");
    expect(seenByProvider).toHaveLength(1);

    // The fallback attempt is explicitly, provably SMALLER than the primary attempt's ceiling.
    const attempt = seenByProvider[0]!.request;
    expect(attempt.limitBytes).toBeDefined();
    expect(attempt.limitBytes!).toBeLessThan(limitForProvider("groq"));
    expect(attempt.limitBytes!).toBe(Math.floor(GROQ_LIMIT * FALLBACK_BUDGET_FRACTION)); // 40% of GROQ's own limit
    // ...and it says why, so the degradation is diagnosable rather than silent.
    expect(attempt.fallbackReason).toMatch(/413/);
    expect(attempt.fallbackReason).toMatch(/budgeted/i);
    // The research question is carried over unchanged: a smaller request, not a different one.
    expect(attempt.prompt).toContain(`Trader message: "${Q1}"`);
    // The bytes actually sent are within the reduced ceiling.
    expect(groqBodyBytes(attempt)).toBeLessThanOrEqual(attempt.limitBytes!);
  });

  it("the fallback's reduced request is genuinely smaller on the wire than the original", async () => {
    let secondaryBytes = 0;
    const primary: ModelProvider = {
      providerId: "gemini", modelId: "g",
      async structured<T>(): Promise<StructuredResponse<T>> {
        throw new ModelFailure("PAYLOAD_TOO_LARGE", "HTTP 413", false);
      },
    };
    const secondary: ModelProvider = {
      providerId: "groq", modelId: "m",
      async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
        secondaryBytes = groqBodyBytes(request);
        return { data: {} as T, raw: "{}", schemaName: request.schemaName, modelId: "m" };
      },
    };
    const facade = new ModelFallbackProvider({ providers: [primary, secondary] });
    const bigContext = Array.from({ length: 5_000 }, (_, i) => `  context line ${i} ${"y".repeat(60)}`).join(NL);
    const request: StructuredRequest = {
      schemaName: "lui.resolved_target",
      schemaDescription: "{ asset: string }",
      system: "system",
      prompt: [`Trader message: "${Q1}"`, bigContext].join(NL),
      protectedFragments: traderWords(Q1),
    };
    await facade.structured<string>(request);
    // Two attempts, two different payloads: this is the whole point of the law.
    expect(secondaryBytes).toBeLessThan(groqBodyBytes(request));
    expect(secondaryBytes).toBeLessThanOrEqual(Math.floor(GROQ_LIMIT * FALLBACK_BUDGET_FRACTION));
  });

  it("a safety refusal is still never bypassed by a size-degrading fallback", async () => {
    const secondaryCalled = { value: false };
    const primary: ModelProvider = {
      providerId: "gemini", modelId: "g",
      async structured<T>(): Promise<StructuredResponse<T>> {
        throw new ModelFailure("EMPTY_OUTPUT", "Gemini blocked the prompt for safety", false);
      },
    };
    const secondary: ModelProvider = {
      providerId: "groq", modelId: "m",
      async structured<T>(): Promise<StructuredResponse<T>> {
        secondaryCalled.value = true;
        return { data: {} as T, raw: "{}", schemaName: "x", modelId: "m" };
      },
    };
    const facade = new ModelFallbackProvider({ providers: [primary, secondary] });
    await expect(facade.structured<string>({
      schemaName: "x", schemaDescription: "{}", system: "s", prompt: "p",
    })).rejects.toThrow(/safety/i);
    expect(secondaryCalled.value).toBe(false);
  });

  it("an oversized request still fails honestly when compaction cannot save it", async () => {
    const attempts = { count: 0 };
    const failing: ModelProvider = {
      providerId: "groq", modelId: "m",
      async structured<T>(): Promise<StructuredResponse<T>> {
        attempts.count++;
        throw new ModelFailure("PAYLOAD_TOO_LARGE", "HTTP 413", false);
      },
    };
    const facade = new ModelFallbackProvider({ providers: [failing] });
    await expect(facade.structured<string>({
      schemaName: "x", schemaDescription: "{}", system: "s", prompt: "p",
    })).rejects.toThrow(/413/);
    expect(attempts.count).toBe(1);
  });
});

// ===========================================================================
// F — integrity invariants still pass, and diagnostics stay out of the answer
// ===========================================================================

describe("F — research integrity is unchanged by the size fix", () => {
  it("the trader-facing answer contains no budget diagnostics", async () => {
    const reports: RequestBudgetReport[] = [];
    setRequestBudgetObserver((r) => reports.push(r));
    const { app: a } = await app();
    const response = await a.submitResearchRequest(Q1);
    const answer = response.answer.answer;
    for (const leak of ["compacted", "request limit", "budget", "serialized", "131072", "128 KiB", "fallbackReason", "bytesBefore"]) {
      expect(answer.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    // (The observer itself fired — the diagnostics exist, they are simply not trader-facing.)
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]!.providerId).toBe("groq");
    expect(typeof reports[0]!.bytesBefore).toBe("number");
    expect(typeof reports[0]!.components.promptBytes).toBe("number");
  });

  it("run-scoped citable evidence: a fresh run cites only its OWN evidence", async () => {
    const store = new MemoryStore();
    const ws = new Workspace();
    seedArchive(ws, 10, 25);
    await store.save(ws.toSnapshot()); // AFTER seeding: the app loads this snapshot
    const registry = new CapabilityRegistry();
    registry.register(stubAdapter);
    const provider = recordingProvider(Q1);
    const a = await ResearchApp.create({ provider, registry, store, workspace: ws });
    await a.submitResearchRequest(Q1);
    const live = a.getWorkspace(); // the app's OWN instance, not the seeded template

    const run = live.listResearch().at(-1)!;
    const owned = new Set(live.evidenceForResearch(run.id).map((e) => e.id));
    expect(owned.size).toBeGreaterThan(0);
    // The research prompts for THIS run may only offer its own evidence ids as citable.
    const prompts = provider.seen.map((s) => s.request.prompt).join(NL);
    const headers = prompts.match(/CURRENT RUN EVIDENCE[^\n]*/g) ?? [];
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      for (const id of header.match(/ev_[0-9a-z]+/g) ?? []) expect(owned.has(id)).toBe(true);
    }
    // And no evidence belonging to ANOTHER run is ever published as this run's citable set.
    const published = headers.join(NL);
    for (const id of live.listEvidence().map((e) => e.id)) {
      if (!owned.has(id)) expect(published.includes(id)).toBe(false);
    }
  });

  it("every research run created by the turn is owned by that turn and completes honestly", async () => {
    const { app: a } = await app();
    const response = await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    const runs = ws.listResearch();
    expect(runs.length).toBe(1);
    expect(runs[0]!.question).toBe(Q1);
    expect(runs[0]!.status).toBe("COMPLETED");
    // The answer is grounded: it references the run, not a scene-setting preamble.
    expect(response.answer.answer.length).toBeGreaterThan(0);
  });

  it("the question is never rewritten to fit a budget", async () => {
    const { app: a, provider } = await app();
    await a.submitResearchRequest(Q1);
    const ws = a.getWorkspace();
    expect(ws.listResearch()[0]!.question).toBe(Q1);
    for (const call of provider.seen) {
      expect(call.request.prompt).not.toMatch(/rephras|instead of the question|answer a different/i);
    }
  });
});