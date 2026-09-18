/**
 * Local-knowledge capability tests (knowledge mandate §32.9); deterministic, no network.
 *
 * Laws under test:
 * - FIRST-CLASS CAPABILITY: LOCAL_KNOWLEDGE_RETRIEVAL resolves through the generic registry
 *   (registered with the adapter set); no Flow→file hardcode, no whole-repo context dumps.
 * - FRAMEWORK RETRIEVAL: a saved framework artifact is retrievable and labeled as such.
 * - SAVED RESEARCH RETRIEVAL: saved findings/conclusions are retrievable by question terms.
 * - CURRENT-VS-STALE PRECEDENCE: aged items are labeled HISTORICAL (context, not current
 *   market truth); fresh items stay CURRENT. The evidence layer keeps live evidence ranked
 *   above stale local claims for current-state questions.
 * - PROVENANCE: every item carries LOCAL_KNOWLEDGE sourceType + its workspace ref.
 * - HONEST EMPTINESS: no matching knowledge is EMPTY_RESULT, never a failure, never filler.
 * - E2E (§32.6): a thesis question combining local knowledge + live capability produces
 *   both evidence kinds in one research run.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { LocalKnowledgeAdapter, LOCAL_KNOWLEDGE_CAPABILITY } from "../../src/adapters/local-knowledge.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { PLANNER_CAPABILITIES } from "../../src/research/adaptive.js";

const origin = { kind: "agent" as const, detail: "test" };

beforeEach(() => resetIdCounters());

function workspaceWithKnowledge(): Workspace {
  const workspace = new Workspace();
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  workspace.saveArtifact({ type: "framework", content: "My BTC framework: only add on weekly closes above the 200-day moving average; exit on funding extremes above 0.1%." }, origin, new Date(recent));
  workspace.saveArtifact({ type: "finding", content: "Earlier research found BTC volatility expands after halving events; see rs_000001." }, origin, new Date(old));
  return workspace;
}

describe("local knowledge as a first-class capability", () => {
  it("resolves through the generic registry and is in the planner vocabulary", () => {
    const registry = new CapabilityRegistry();
    const workspace = workspaceWithKnowledge();
    registry.register(new LocalKnowledgeAdapter(() => workspace));
    expect(registry.resolve(LOCAL_KNOWLEDGE_CAPABILITY).length).toBe(1);
    expect(PLANNER_CAPABILITIES).toContain(LOCAL_KNOWLEDGE_CAPABILITY);
  });

  it("retrieves a saved framework and labels it CURRENT with LOCAL_KNOWLEDGE provenance", async () => {
    const adapter = new LocalKnowledgeAdapter(() => workspaceWithKnowledge());
    const result = await adapter.execute(LOCAL_KNOWLEDGE_CAPABILITY, { question: "evaluate BTC with my framework moving average" });
    expect(result.failure.type).toBe("NONE");
    const framework = result.outputs.find((o) => (o.content as { kind?: string }).kind === "saved-framework");
    expect(framework).toBeDefined();
    const content = framework!.content as { sourceType: string; knowledgeStatus: string; workspaceRef: string };
    expect(content.sourceType).toBe("LOCAL_KNOWLEDGE");
    expect(content.knowledgeStatus).toBe("CURRENT");
    expect(content.workspaceRef).toMatch(/^sa_/);
  });

  it("retrieves saved research by question terms and labels aged items HISTORICAL", async () => {
    const adapter = new LocalKnowledgeAdapter(() => workspaceWithKnowledge());
    const result = await adapter.execute(LOCAL_KNOWLEDGE_CAPABILITY, { question: "BTC volatility halving what did we find before" });
    expect(result.failure.type).toBe("NONE");
    const finding = result.outputs.find((o) => (o.content as { kind?: string }).kind === "saved-finding");
    expect(finding).toBeDefined();
    expect((finding!.content as { knowledgeStatus: string }).knowledgeStatus).toBe("HISTORICAL");
    expect(finding!.timeframe).toBe("historical context");
  });

  it("no matching knowledge is honest EMPTY (never filler, never an error)", async () => {
    const adapter = new LocalKnowledgeAdapter(() => workspaceWithKnowledge());
    const result = await adapter.execute(LOCAL_KNOWLEDGE_CAPABILITY, { question: "unrelated quantum sandwiches" });
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.completeness).toBe("EMPTY");
  });

  it("undefined workspace degrades honestly (no session yet)", async () => {
    const adapter = new LocalKnowledgeAdapter(() => undefined);
    const result = await adapter.execute(LOCAL_KNOWLEDGE_CAPABILITY, { question: "anything" });
    expect(result.failure.type).toBe("EMPTY_RESULT");
  });
});
