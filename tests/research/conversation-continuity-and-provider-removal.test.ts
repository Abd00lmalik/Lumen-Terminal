/**
 * Conversational continuity + provider-removal regression suite (2026-10-05).
 *
 * Two production failures are encoded here, both reproduced before the fix:
 *
 * 1. CURRENT-INVESTIGATION POINTER LOST ON PERSIST. `mergeSnapshots` omitted
 *    `currentInvestigationId`, and EVERY production write goes through that merge. So after
 *    the first completed run the restored workspace had no current investigation, no
 *    investigation reported `isCurrent`, and the UI showed "Research" + "No active research"
 *    over a live investigation. Reproduced: local `inv_000001` -> merged `undefined`.
 *
 * 2. A LONG, WELL-FORMED FOLLOW-UP ROUTED AS A NEW INVESTIGATION. The router only recognized
 *    anaphoric turns of six words or fewer, so "What evidence would most strongly support or
 *    weaken the liquidity explanation?" (13 words, referencing the prior run's leading
 *    explanation) fell through to START and silently dropped a completed investigation.
 *    Reproduced: `START / NEW_INVESTIGATION`.
 *
 * Plus the provider-removal laws: no paid agent tier remains, every planner capability still
 * resolves, and the two capabilities with genuinely no provider are unreachable by the
 * planner rather than dead-ending at runtime.
 */
import { describe, expect, it } from "vitest";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { Workspace } from "../../src/domain/workspace.js";
import { routeConversation, referencesPriorFindings } from "../../src/lui/conversation-routing.js";
import { PLANNER_CAPABILITIES } from "../../src/research/adaptive.js";
import { CANONICAL_CAPABILITIES } from "../../src/model/capability-vocabulary.js";
import { CAPABILITY_SUPPORT } from "../../src/research/requirements.js";
import { createBitgetAdapterSet } from "../../src/adapters/bitget-skills.js";

const origin = { kind: "trader" as const, detail: "continuity regression" };

function emptyWorkspace(): Workspace {
  return Workspace.fromSnapshot({
    researches: [], sources: [], evidence: [], claims: [], hypotheses: [],
    analyses: [], judgments: [], branches: [], theses: [], savedArtifacts: [],
    memories: [], monitors: [],
  } as never);
}

// ---------------------------------------------------------------------------
// Group 1: the current-investigation pointer survives a persisted round trip
// ---------------------------------------------------------------------------

describe("current-investigation pointer survives persistence (production failure 1)", () => {
  it("a merge round trip keeps the pointer, so the investigation is still current after reload", () => {
    const ws = emptyWorkspace();
    const investigation = ws.addInvestigation({ title: "Why did Bitcoin move down today?", subject: "Bitcoin" }, origin);

    const snapshot = ws.toSnapshot();
    expect(snapshot.currentInvestigationId).toBe(investigation.id);

    // The production write path: read-merge-write against the stored blob.
    const merged = mergeSnapshots(snapshot, JSON.parse(JSON.stringify(snapshot)) as never);

    // THE REGRESSION: this was `undefined`, which silently un-currented every investigation.
    expect(merged.currentInvestigationId).toBe(investigation.id);

    const restored = Workspace.fromSnapshot(merged);
    expect(restored.currentInvestigationIdValue).toBe(investigation.id);
    expect(restored.currentInvestigation()?.id).toBe(investigation.id);
  });

  it("the local side's pointer wins when both sides name a live investigation", () => {
    const local = emptyWorkspace();
    const localInv = local.addInvestigation({ title: "local thread", subject: "Bitcoin" }, origin);
    const remote = emptyWorkspace();
    const remoteInv = remote.addInvestigation({ title: "remote thread", subject: "Ethereum" }, origin);

    const merged = mergeSnapshots(local.toSnapshot(), remote.toSnapshot());
    // The local instance is the one that just acted on the trader's behalf; its write is
    // the one being persisted, so its selection is the one that must survive.
    expect(merged.currentInvestigationId).toBe(localInv.id);
    expect(merged.currentInvestigationId).not.toBe(remoteInv.id);
  });

  it("a remote pointer is recovered when the local side has none", () => {
    const remote = emptyWorkspace();
    const remoteInv = remote.addInvestigation({ title: "remote thread", subject: "Bitcoin" }, origin);
    const local = emptyWorkspace();

    const merged = mergeSnapshots(local.toSnapshot(), remote.toSnapshot());
    expect(merged.currentInvestigationId).toBe(remoteInv.id);
  });

  it("a pointer naming an investigation neither side holds is dropped, not resurrected", () => {
    const ws = emptyWorkspace();
    const investigation = ws.addInvestigation({ title: "gone", subject: "Bitcoin" }, origin);
    const snapshot = { ...ws.toSnapshot(), currentInvestigationId: investigation.id };
    // The investigation is absent from BOTH sides (deleted), so the pointer is dangling.
    const withoutInvestigations = {
      ...snapshot,
      investigations: [],
    } as never;

    const merged = mergeSnapshots(withoutInvestigations, JSON.parse(JSON.stringify(withoutInvestigations)) as never);
    expect(merged.currentInvestigationId).toBeUndefined();
  });

  it("New Research still clears the pointer: no pointer on either side stays undefined", () => {
    // `clearCurrentInvestigation` only clears the POINTER (G: new research must stay clean),
    // so a merge between two cleared sides must not invent a selection.
    const cleared = emptyWorkspace().toSnapshot();
    expect(cleared.currentInvestigationId).toBeUndefined();
    const merged = mergeSnapshots(cleared, JSON.parse(JSON.stringify(cleared)) as never);
    expect(merged.currentInvestigationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group 2: the exact production follow-up routes as a continuation
// ---------------------------------------------------------------------------

describe("long-form back-referencing follow-ups continue the investigation (production failure 2)", () => {
  const investigation = {
    id: "inv_1",
    title: "Why did Bitcoin move down today?",
    subject: "Bitcoin",
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
    turns: [],
  } as never;

  const route = (message: string) =>
    routeConversation({ message, investigation, hasPriorResearch: true, hasInvestigationThesis: false });

  it("THE EXACT PRODUCTION FOLLOW-UP continues the investigation as a falsification question", () => {
    const result = route("What evidence would most strongly support or weaken the liquidity explanation?");
    // Before the fix this was START / NEW_INVESTIGATION.
    expect(result.action).toBe("CONTINUE");
    expect(result.intent).toBe("FALSIFICATION");
    expect(result.continuedInvestigation).toBe(true);
  });

  it("a bare back-reference continues the investigation", () => {
    expect(route("Is that explanation still valid?").action).toBe("CONTINUE");
    expect(route("What contradicts the thesis?").action).toBe("CONTINUE");
  });

  it("back-reference detection is independent of sentence length", () => {
    // The whole point: a 13-word sentence is as much a follow-up as a 2-word one.
    expect(referencesPriorFindings("What evidence would most strongly support or weaken the liquidity explanation?")).toBe(true);
    expect(referencesPriorFindings("why?")).toBe(false); // short-turn anaphora, handled elsewhere
  });

  it("a self-contained first question still opens a NEW investigation", () => {
    // The first question of a thread must not be captured as a back-reference.
    expect(route("Why did Bitcoin move down today?").action).toBe("START");
  });

  it("a genuinely unrelated question still routes as new research (requirement 8)", () => {
    expect(route("What is the weather in Tokyo?").action).toBe("START");
    expect(route("How do I bake sourdough bread?").action).toBe("START");
  });

  it("a NAMED subject still wins over any back-reference reading (topic-switch law intact)", () => {
    // The back-reference rule must never smuggle a real topic change into the thread.
    const result = route("What is happening with Ethereum today?");
    expect(result.action).toBe("START");
    expect(result.intent).toBe("TOPIC_SWITCH");
  });

  it("the established short follow-ups still work (no regression)", () => {
    expect(route("Why?").action).toBe("CONTINUE");
    expect(route("Focus on ETF flows").action).toBe("CONTINUE");
    expect(route("What about liquidations?").action).toBe("CONTINUE");
    expect(route("Has this happened before?").action).toBe("CONTINUE");
  });

  it("with no live thread the same words are simply a new question", () => {
    const bare = routeConversation({
      message: "What evidence would most strongly support or weaken the liquidity explanation?",
      investigation: undefined,
      hasPriorResearch: false,
      hasInvestigationThesis: false,
    });
    expect(bare.action).toBe("START");
  });
});

// ---------------------------------------------------------------------------
// Group 3: the paid agent tier is gone and no capability dead-ends
// ---------------------------------------------------------------------------

describe("no paid agent tier remains in the research path", () => {
  it("no registered provider is a Heurist agent", () => {
    const { registry } = createBitgetAdapterSet();
    const capabilities = new Set<string>([
      ...PLANNER_CAPABILITIES,
      "ONCHAIN_ANALYSIS", "DEFI_ANALYSIS", "PROJECT_RESEARCH", "WEB_SEARCH",
      "CROSS_DOMAIN_SYNTHESIS", "OPTIONS_CHAIN_ANALYSIS", "SOURCE_VALIDATION",
      "DERIVATIVES_ANALYSIS", "EARNINGS_CALENDAR", "EQUITY_FUNDAMENTALS",
    ]);
    const offenders: string[] = [];
    for (const capability of capabilities) {
      for (const registration of registry.resolve(capability)) {
        if (registration.adapter.providerId.startsWith("heurist/")) offenders.push(registration.adapter.providerId);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two capabilities with no provider are NOT in the planner vocabulary", () => {
    // These were reachable by the planner and could only ever come back empty — the exact
    // dead-end the conformance test forbids. They leave the vocabulary instead.
    expect(PLANNER_CAPABILITIES).not.toContain("CROSS_DOMAIN_SYNTHESIS");
    expect(PLANNER_CAPABILITIES).not.toContain("OPTIONS_CHAIN_ANALYSIS");
    expect(CANONICAL_CAPABILITIES).not.toContain("CROSS_DOMAIN_SYNTHESIS");
    expect(CANONICAL_CAPABILITIES).not.toContain("OPTIONS_CHAIN_ANALYSIS");
  });

  it("every planner capability still declares support and resolves to a provider", () => {
    const { registry } = createBitgetAdapterSet();
    const unresolved = PLANNER_CAPABILITIES.filter((c) => registry.resolve(c).length === 0);
    expect(unresolved, `planner names capabilities with NO provider: ${unresolved.join(", ")}`).toEqual([]);
    for (const capability of PLANNER_CAPABILITIES) expect(CAPABILITY_SUPPORT[capability]).toBeDefined();
  });

  it("the planner, canonical vocabulary and ledger stay in agreement", () => {
    expect(PLANNER_CAPABILITIES).toEqual([...CANONICAL_CAPABILITIES]);
    for (const capability of Object.keys(CAPABILITY_SUPPORT)) expect(PLANNER_CAPABILITIES).toContain(capability);
  });

  it("the retired deep-research backstop can no longer fire (no CROSS_DOMAIN_SYNTHESIS provider)", () => {
    // The credit sink was an automatic last-resort that BOUGHT a generated answer. With no
    // provider registered, both backstops self-gate and no credits can be spent.
    const { registry } = createBitgetAdapterSet();
    expect(registry.resolve("CROSS_DOMAIN_SYNTHESIS").length).toBe(0);
  });

  it("the Heurist key is no longer read anywhere in the adapter layer", () => {
    // A key that the code never reads cannot leak into a request, and its absence cannot
    // silently disable a capability.
    const source = [
      "src/adapters/bitget-skills.ts",
      "src/adapters/sec-edgar.ts",
      "src/adapters/public-derivatives.ts",
    ];
    for (const path of source) {
      const { readFileSync } = require("node:fs") as typeof import("node:fs");
      const text = readFileSync(path, "utf8");
      expect(text).not.toContain("HEURIST_API_KEY");
      expect(text).not.toContain('from "./heurist.js"');
    }
  });
});