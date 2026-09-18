/**
 * Local knowledge retrieval — a FIRST-CLASS capability (knowledge mandate §32.8).
 *
 * What it is: a provider adapter over the workspace's trader-owned knowledge layer (saved
 * artifacts via SAVE, memories, frameworks, theses). Flow 8 already resolves frameworks from
 * this layer; this adapter makes the SAME knowledge requestable by any planned capability
 * (LOCAL_KNOWLEDGE_RETRIEVAL), so "does my thesis hold", "evaluate with my framework",
 * "what did we find before" style questions retrieve local context through the registry —
 * never a Flow→file hardcode, never the whole repository injected into context.
 *
 * Epistemic laws (§32.2/§32.4/§32.7):
 * - Every item carries LOCAL_KNOWLEDGE provenance: kind=local, its workspace ref, its
 *   timestamps; knowledgeStatus is CURRENT (recently reinforced) or HISTORICAL (aged),
 *   never claimed fresh-market-evidence.
 * - Outputs are classified FACTUAL_OBSERVATION *of the knowledge layer* ("the workspace
 *   records X"), i.e. a verbatim fact about what the trader owns — distinct from live
 *   external observations. The evidence layer treats them as user-owned context; live
 *   evidence outranks stale local claims for current-state questions.
 * - No fabrication: only actual stored content, verbatim, with its provenance chain.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import type { Workspace } from "../domain/workspace.js";

export const LOCAL_KNOWLEDGE_CAPABILITY: CapabilityName = "LOCAL_KNOWLEDGE_RETRIEVAL";

/** An aged local item is context/historical, not current-market evidence. */
const HISTORICAL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export class LocalKnowledgeAdapter implements ProviderAdapter {
  readonly providerId = "local/knowledge";
  readonly capabilities: readonly CapabilityName[] = [LOCAL_KNOWLEDGE_CAPABILITY];
  readonly limitations: readonly string[] = [
    "local knowledge is trader-owned workspace context (saved artifacts, memories, theses); it is not live market data",
    "live external evidence outranks stale local claims for current-state questions",
    "a local claim reproducing an external source is that ONE source; never independent corroboration of a live retrieval of the same source",
  ];
  readonly freshnessProfile = "local:as-saved";

  constructor(private readonly workspaceProvider: () => Workspace | undefined) {}

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== LOCAL_KNOWLEDGE_CAPABILITY) {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const now = new Date();
    const workspace = this.workspaceProvider();
    const question = typeof params.question === "string" ? params.question.toLowerCase() : "";
    const terms = question.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);

    if (workspace === undefined) {
      return {
        tool: this.providerId,
        capability,
        transport: "local:workspace",
        params,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: "no workspace session; local knowledge is unavailable" }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: "no workspace", retriable: false },
        limitations: this.limitations,
      };
    }

    // Relevance: term overlap between the question and stored content (bounded, explainable;
    // no opaque semantic layer). Framework content participates in matching like everything
    // else: an unrelated question must NOT drag in unrelated context (no filler).
    const items: { kind: string; ref: string; content: string; updatedAt: string; status: "CURRENT" | "HISTORICAL"; score: number }[] = [];
    for (const artifact of workspace.listSavedArtifacts()) {
      const text = `${artifact.type} ${artifact.content}`.toLowerCase();
      const score = terms.filter((t) => text.includes(t)).length;
      const age = now.getTime() - new Date(artifact.createdAt).getTime();
      if (score > 0) {
        items.push({ kind: `saved-${artifact.type}`, ref: artifact.id, content: artifact.content, updatedAt: artifact.createdAt, status: age > HISTORICAL_AFTER_MS ? "HISTORICAL" : "CURRENT", score });
      }
    }
    for (const memory of workspace.listMemories()) {
      const text = `${memory.category} ${memory.content}`.toLowerCase();
      const score = terms.filter((t) => text.includes(t)).length;
      const age = now.getTime() - new Date(memory.updatedAt).getTime();
      if (score > 0) {
        items.push({ kind: `memory-${memory.category}`, ref: memory.id, content: memory.content, updatedAt: memory.updatedAt, status: age > HISTORICAL_AFTER_MS ? "HISTORICAL" : "CURRENT", score });
      }
    }
    items.sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : -1));

    if (items.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "local:workspace",
        params,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: "no relevant local knowledge stored for this question" }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: "no relevant local knowledge", retriable: false },
        limitations: this.limitations,
      };
    }

    const outputs: ToolOutput[] = items.slice(0, 8).map((item) => ({
      outputClass: "FACTUAL_OBSERVATION" as const,
      content: {
        sourceType: "LOCAL_KNOWLEDGE",
        knowledgeStatus: item.status,
        kind: item.kind,
        workspaceRef: item.ref,
        content: item.content,
        relevanceScore: item.score,
      },
      about: question.slice(0, 60),
      timeframe: item.status === "HISTORICAL" ? "historical context" : "as-saved",
    }));

    return {
      tool: this.providerId,
      capability,
      transport: "local:workspace",
      params,
      outputs,
      completeness: items.length >= 3 ? "COMPLETE" : "PARTIAL",
      freshness: "CURRENT",
      validation: "VALID",
      failure: { type: "NONE", message: "", retriable: false },
      limitations: this.limitations,
    };
  }
}
