/**
 * NO-RESEARCH ANSWERS CARRY NO RUN IDENTITY.
 *
 * Found in the browser journey: the trader asked "What could prove me wrong?" with no thesis
 * recorded, and Lumen's honest answer ("no belief or thesis to falsify") NEVER APPEARED — the
 * thread only grew a collapsed row. The flow that had nothing to research reports the sentinel
 * `"n/a"` as its research id; that sentinel reached the client as `researchRef`, so the answer
 * was bound to a run that does not exist and the coherence/identity rules collapsed the turn.
 *
 * Law: `researchRef` is a minted research id (`rs_…`) or absent. Never a sentinel, never a
 * placeholder — a terminal answer with no research behind it must be renderable as exactly that.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import type { StructuredRequest } from "../../src/model/provider.js";

function scripted(schemaName: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({ primaryAction: "CHALLENGE", compoundActions: [], objective: "What could prove me wrong?", isExplanationOnly: false, disclosureLevel: 0 });
    case "lui.resolved_target":
      return JSON.stringify({ asset: "BTC", flow: "WHAT_COULD_PROVE_ME_WRONG", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{ action: "CHALLENGE", description: "challenge the current view", capabilities: [], params: { objective: "What could prove me wrong?" } }],
        requiresConfirmationFor: [],
      });
    case "challenge.verdict":
      return JSON.stringify({ falsificationVerdict: "INCONCLUSIVE", rationale: "no belief to test", searchedContradictions: [], missingEvidence: ["a stated thesis"], citedObjectRefs: [] });
    default:
      return JSON.stringify({});
  }
}

async function app(): Promise<ResearchApp> {
  const store = new MemoryStore();
  const workspace = new Workspace();
  await store.save(workspace.toSnapshot());
  const provider = {
    providerId: "sentinel/scripted",
    modelId: "scripted-1",
    async structured<T>(request: StructuredRequest) {
      const raw = scripted(request.schemaName);
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
  return ResearchApp.create({ provider, registry: new CapabilityRegistry(), store, workspace });
}

beforeEach(() => resetIdCounters());

describe("a flow that researched nothing", () => {
  it("answers without inventing a run identity", async () => {
    const a = await app();
    const dto = await a.submitResearchRequest("What could prove me wrong?");
    expect(dto.answer.answer.length).toBeGreaterThan(0);
    expect(dto.researchRef).toBeUndefined();
    expect(dto.researchRunId).toBeUndefined();
    expect(dto.evidence).toHaveLength(0);
    expect(dto.judgments).toHaveLength(0);
  });
});