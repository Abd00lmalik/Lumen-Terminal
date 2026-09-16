/**
 * Shared test doubles for M3: a scripted ModelProvider fake + in-memory store.
 * The fake returns per-schema scripted JSON — no network, no credentials.
 */
import { MemoryStore } from "../../src/persistence/index.js";
import type { ModelProvider, StructuredRequest, StructuredResponse } from "../../src/model/provider.js";
import { ModelFailure } from "../../src/model/provider.js";

export type ScriptedResponses = Map<string, string | ((request: StructuredRequest) => string)>;

export class FakeModelProvider implements ModelProvider {
  readonly providerId = "fake/scripted";
  readonly modelId = "fake-model-1";
  readonly calls: StructuredRequest[] = [];

  constructor(
    private readonly responses: ScriptedResponses = new Map(),
    private readonly options: { failWith?: ModelFailure } = {},
  ) {}

  async structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    this.calls.push(request);
    if (this.options.failWith !== undefined) throw this.options.failWith;
    const entry = this.responses.get(request.schemaName);
    if (entry === undefined) {
      throw new ModelFailure("EMPTY_OUTPUT", `no scripted response for schema ${request.schemaName}`, false);
    }
    const raw = typeof entry === "function" ? entry(request) : entry;
    return { data: raw as unknown as T, raw, schemaName: request.schemaName, modelId: this.modelId };
  }
}

export function newStore(): MemoryStore {
  return new MemoryStore();
}

// ---------------------------------------------------------------------------
// Reusable valid model responses (schema-conformant JSON strings)
// ---------------------------------------------------------------------------

export const responses = {
  normalizedRequest: (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      primaryAction: "RESEARCH",
      compoundActions: [],
      objective: "What happened to BTC today?",
      isExplanationOnly: false,
      disclosureLevel: 0,
      ...overrides,
    }),

  resolvedTarget: (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      asset: "BTC",
      flow: "WHAT_HAPPENED",
      researchRef: "", // empty string = not resolved (schema requires the key; LUI normalizes "")
      objectRefs: [],
      unresolved: [],
      ...overrides,
    }),

  ambiguity: (isAmbiguous = false, questions: string[] = []): string =>
    JSON.stringify({ isAmbiguous, questions, reason: isAmbiguous ? "multiple active theses" : "" }),

  consequence: (level = "INFORMATIONAL", requiresConfirmation = false): string =>
    JSON.stringify({ level, rationale: "test", requiresConfirmation }),

  safety: (isExecutionCommand = false): string =>
    JSON.stringify({ isExecutionCommand, detectedViolations: isExecutionCommand ? ["order placement intent"] : [], rationale: "research request" }),

  actionPlan: (steps: unknown[], requiresConfirmationFor: number[] = []): string =>
    JSON.stringify({ steps, requiresConfirmationFor }),

  researchPlan: (): string =>
    JSON.stringify({
      objective: "What happened to BTC today?",
      scopeIncluded: ["market data", "news"],
      scopeExcluded: ["causal investigation"],
      tasks: [
        { type: "FACT_FINDING", objective: "Identify developments for BTC", capabilities: ["NEWS_ANALYSIS"], completion: "news collected or unavailability recorded" },
      ],
      completionCriteria: ["evidence collected or unavailability recorded"],
      adaptationPolicy: "add capabilities only on material information value",
    }),

  adaptiveDecision: (decision = "COMPLETE", nextTasks: unknown[] = []): string =>
    JSON.stringify({ decision, rationale: "evidence assessed", nextTasks }),
};
