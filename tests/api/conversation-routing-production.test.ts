/**
 * CONVERSATION ROUTING — PRODUCTION REGRESSION.
 *
 * THE REPORTED FAILURE, VERBATIM: inside a completed investigation for "Why did Bitcoin move
 * down today?", the trader entered
 *
 *   "Given that Bitcoin is actually up over the current 24-hour window, what caused the most
 *    recent meaningful intraday move, and what evidence supports that explanation?"
 *
 * and Lumen started a NEW RESEARCH instead of continuing the investigation. The previous
 * commit's browser check reported 21/21 passing on the same journey, so this file exists to
 * record WHY that check passed while the product failed, and to pin the real path.
 *
 * ROOT CAUSE (two independent defects, both in what the router READS — not in how it reads
 * the trader's words):
 *
 *   DEFECT A — ROUTING RAN AGAINST A STALE IN-MEMORY GRAPH. A request resolves through
 *   `sessions.get(user.uid)`, which returns a CACHED warm ResearchApp per trader. Two turns
 *   can be served by two different in-memory graphs over one durable store, and a warm
 *   instance holds only what it has itself absorbed or persisted. `submitResearchRequest`
 *   decided the route from that graph without first absorbing the persisted one, so an
 *   instance that had never seen the trader's completed run read the investigation as
 *   absent, inferred "no live thread", and opened a new one. The turn's own
 *   `investigationId` was sent by the client and ignored, because the lookup returned
 *   undefined rather than "unknown to me".
 *
 *   DEFECT B — A THREAD'S APPENDED RUNS WERE LOST ON MERGE AND ABSORB. `withTurn` grows an
 *   investigation by APPENDING to `turnRefs`/`runRefs` and appends NO provenance entry, while
 *   both `mergeSnapshots` and `absorbExecutionState` ranked threads by provenance length. An
 *   extended thread and the stale copy it superseded therefore tied, the tie kept the stale
 *   side, and every run the investigation had accumulated disappeared from the merged graph.
 *   The restored thread then reported no research — feeding Defect A.
 *
 * WHY THE 21/21 BROWSER CHECK MISSED IT: `scripts/cdp-continuity-verify.mjs` is correct about
 * everything it asserts, but it (a) typed a DIFFERENT follow-up — "What evidence would most
 * strongly support or weaken the liquidity explanation?", which the router already handled
 * via a determiner rule — instead of the trader-reported sentence, and (b) drove a SINGLE
 * local backend process, where the in-memory graph IS the store, so neither Defect A nor
 * Defect B could occur. The check validated the router's word-matching on a path that cannot
 * fail; the failure lives in the persistence/multi-instance path, which it never entered.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { ResearchApp } from "../../src/api/research-app.js";
import { routeConversation, referencesPriorFindings } from "../../src/lui/conversation-routing.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { endRun } from "../../src/domain/run-context.js";
import type { StructuredRequest } from "../../src/model/provider.js";
import type { ProviderAdapter } from "../../src/adapters/provider.js";
import type { Investigation } from "../../src/domain/investigation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** THE EXACT failing message. Never paraphrased — a paraphrase would test a different bug. */
const FAILING_PROMPT =
  "Given that Bitcoin is actually up over the current 24-hour window, what caused the most recent meaningful intraday move, and what evidence supports that explanation?";

const Q1 = "Why did Bitcoin move down today?";

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
        objective: question, scopeIncluded: ["market"], scopeExcluded: [],
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

function provider() {
  return {
    providerId: "routing/scripted",
    modelId: "scripted-1",
    async structured<T>(request: StructuredRequest) {
      const raw = scripted(request.schemaName, request.userText ?? "");
      return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "scripted-1" };
    },
  };
}

function registry(): CapabilityRegistry {
  const r = new CapabilityRegistry();
  r.register(stubAdapter);
  return r;
}

/** An investigation object for the pure-router cases (no persistence involved). */
function liveInvestigation(): Investigation {
  return {
    id: "inv_1",
    title: Q1,
    subject: "Bitcoin",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    turnRefs: ["tn_1", "tn_2"],
    runRefs: ["rs_1"],
    provenance: [{ kind: "trader", detail: "created" }],
  } as unknown as Investigation;
}

const route = (message: string) =>
  routeConversation({ message, investigation: liveInvestigation(), hasPriorResearch: true, hasInvestigationThesis: false });

function minimalSnapshot(runRefs: readonly string[]) {
  return {
    researches: [], sources: [], evidence: [], claims: [], hypotheses: [], analyses: [],
    judgments: [], branches: [], theses: [], savedArtifacts: [], memories: [], monitors: [], thesisAssessments: [],
    investigations: [{
      id: "inv_1",
      title: Q1,
      subject: "Bitcoin",
      status: "ACTIVE" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      turnRefs: runRefs.map((_, i) => `tn_${i}`),
      runRefs: [...runRefs],
      // ONE provenance entry regardless of depth: this is the defect. `withTurn` never appends
      // one, so a thread with ten runs and a thread with none were ranked as equally new.
      provenance: [{ kind: "trader", detail: "created" }],
    }],
  };
}

async function appOver(store: MemoryStore): Promise<ResearchApp> {
  return ResearchApp.create({ provider: provider(), registry: registry(), store });
}

beforeEach(() => { resetIdCounters(); endRun(); });

// ---------------------------------------------------------------------------
// 1. The router: the exact failing sentence, and the required control set
// ---------------------------------------------------------------------------

describe("the exact trader-reported message continues the investigation", () => {
  it("routes as a continuation, not a new investigation", () => {
    const result = route(FAILING_PROMPT);
    expect(result.action).toBe("CONTINUE");
    expect(result.continuedInvestigation).toBe(true);
  });

  it("is recognised as a reference to the thread's own output", () => {
    expect(referencesPriorFindings(FAILING_PROMPT)).toBe(true);
  });

  it("names no subject that could be mistaken for a topic switch", () => {
    // It DOES name Bitcoin — the investigation's OWN subject, which the topic-switch law
    // explicitly treats as "not a switch". Pinned because this is the sentence that failed.
    expect(route(FAILING_PROMPT).intent).not.toBe("TOPIC_SWITCH");
  });
});

describe("required follow-up controls all continue the investigation", () => {
  const continuations = [
    "Focus specifically on ETF flows.",
    "What evidence supports the leading explanation?",
    "Dig deeper into the liquidity explanation.",
    "What could prove that explanation wrong?",
    "Compare the two strongest explanations.",
    "Use the evidence you already collected and investigate the missing piece.",
    "What about the macro explanation?",
  ];
  for (const message of continuations) {
    it(`continues: ${message}`, () => {
      expect(route(message).action).toBe("CONTINUE");
    });
  }

  it("a follow-up longer than the 6-word anaphora window still continues", () => {
    // Sentence length is not evidence of independence; this is the whole class of bug.
    const long = "Given that Bitcoin is actually up over the current 24-hour window, what caused the most recent meaningful intraday move, and what evidence supports that explanation?";
    expect(long.split(/\s+/).length).toBeGreaterThan(6);
    expect(route(long).action).toBe("CONTINUE");
  });
});

describe("an EXPLICIT new-investigation request still starts a new investigation", () => {
  it("names a different subject", () => {
    const result = route("Start a new investigation on Ethereum.");
    expect(result.action).toBe("START");
    expect(result.intent).toBe("TOPIC_SWITCH");
  });

  it("the router is not simply defaulting everything to a follow-up", () => {
    // Guards the failure mode the brief warns about: a fix that makes EVERY message a follow-up
    // passes every continuation case and destroys the product. These must still be new work.
    expect(route("Start a new investigation on Ethereum.").action).toBe("START");
    expect(route("What is happening with Solana today?").action).toBe("START");
    expect(route("What is the weather in Tokyo?").action).toBe("START");
    expect(route("How do I bake sourdough bread?").action).toBe("START");
  });
});

describe("the same words mean different things with and without a live thread", () => {
  it("with a completed run it continues; with none it opens a thread", () => {
    const withThread = route(FAILING_PROMPT);
    expect(withThread.action).toBe("CONTINUE");

    const withoutResearch = routeConversation({
      message: FAILING_PROMPT, investigation: liveInvestigation(), hasPriorResearch: false, hasInvestigationThesis: false,
    });
    expect(withoutResearch.action).toBe("START");

    const withoutInvestigation = routeConversation({
      message: FAILING_PROMPT, investigation: undefined, hasPriorResearch: false, hasInvestigationThesis: false,
    });
    expect(withoutInvestigation.action).toBe("START");
  });
});

/**
 * The subtle case the brief asked to be decided deliberately: a standalone, fully-formed
 * question that never names the subject and never says "this investigation".
 *
 * DOCUMENTED RULE: inside a live investigation, a turn that names NO new subject is read as a
 * refinement of that investigation. The trader typing a complete sentence is not evidence that
 * they meant a new one — they typed it INTO a thread that is on screen. Changing subject is
 * expressed by naming the new subject ("What about Ethereum?"), which is a topic switch.
 * This is what makes "Compare the two strongest explanations." a continuation.
 */
describe("a subject-less standalone question inside a live thread (documented rule)", () => {
  it("continues the investigation", () => {
    const result = route("Compare the two strongest explanations.");
    expect(result.action).toBe("CONTINUE");
  });

  it("and the SAME sentence opens a new investigation when there is no live thread", () => {
    const bare = routeConversation({
      message: "Compare the two strongest explanations.", investigation: undefined, hasPriorResearch: false, hasInvestigationThesis: false,
    });
    expect(bare.action).toBe("START");
  });

  it("naming a new subject still switches, so the rule cannot swallow a topic change", () => {
    expect(route("What are the two strongest explanations for Ethereum?").action).toBe("START");
  });
});

// ---------------------------------------------------------------------------
// 2. Defect B: the thread merge law
// ---------------------------------------------------------------------------

describe("DEFECT B: an extended thread is never lost to a stale copy", () => {
  it("mergeSnapshots keeps the runs a stale local copy is missing", () => {
    const merged = mergeSnapshots(minimalSnapshot([]) as never, minimalSnapshot(["rs_1"]) as never);
    expect(merged.investigations?.[0]?.runRefs).toEqual(["rs_1"]);
  });

  it("mergeSnapshots keeps turns too, not only runs", () => {
    const merged = mergeSnapshots(minimalSnapshot([]) as never, minimalSnapshot(["rs_1"]) as never);
    expect(merged.investigations?.[0]?.turnRefs?.length).toBeGreaterThan(0);
  });

  it("absorbExecutionState keeps the runs a stale warm copy is missing", () => {
    const ws = Workspace.fromSnapshot(minimalSnapshot([]) as never);
    ws.absorbExecutionState(minimalSnapshot(["rs_1"]) as never);
    expect(ws.getInvestigation("inv_1")?.runRefs).toEqual(["rs_1"]);
  });

  it("is idempotent — absorbing twice does not duplicate refs", () => {
    const ws = Workspace.fromSnapshot(minimalSnapshot([]) as never);
    ws.absorbExecutionState(minimalSnapshot(["rs_1"]) as never);
    ws.absorbExecutionState(minimalSnapshot(["rs_1"]) as never);
    expect(ws.getInvestigation("inv_1")?.runRefs).toEqual(["rs_1"]);
  });

  it("preserves order across a union (conversation order is the record)", () => {
    const local = minimalSnapshot(["rs_1", "rs_2"]);
    const remote = minimalSnapshot(["rs_1", "rs_2", "rs_3"]);
    const merged = mergeSnapshots(local as never, remote as never);
    expect(merged.investigations?.[0]?.runRefs).toEqual(["rs_1", "rs_2", "rs_3"]);
  });

  it("invents nothing: a ref neither side recorded never appears", () => {
    const merged = mergeSnapshots(minimalSnapshot([]) as never, minimalSnapshot([]) as never);
    expect(merged.investigations?.[0]?.runRefs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Defect A: the production multi-instance path, end to end
// ---------------------------------------------------------------------------

describe("DEFECT A: a follow-up continues the thread on a WARM instance that missed the run", () => {
  it("the exact failing message stays in the original investigation", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());

    // Two warm instances over ONE store — the deployed topology. Both start from the same
    // empty graph, so neither has seen the other's work.
    const a = await appOver(store);
    const b = await appOver(store);

    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)?.id;
    expect(investigationId).toBeDefined();

    // Before the fix: `b` believed it had no investigations at all and opened a new one.
    const second = await b.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);

    const owner = b.listInvestigations().find((i) => i.runs.some((r) => r.researchRef === second.researchRef));
    expect(owner?.id).toBe(investigationId);
  });

  it("the run count goes 1 -> 2 and the FIRST run stays intact", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    const b = await appOver(store);

    const first = await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;
    const second = await b.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);

    const thread = b.investigation(investigationId)!;
    expect(thread.runs).toHaveLength(2);
    expect(thread.runs.map((r) => r.researchRef)).toContain(first.researchRef);
    expect(thread.runs.map((r) => r.researchRef)).toContain(second.researchRef);
    // The first run is still the trader's original question, not rewritten by the follow-up.
    const firstRun = thread.runs.find((r) => r.researchRef === first.researchRef)!;
    expect(firstRun.userQuestion).toBe(Q1);
  });

  it("the turn is recorded as a CONTINUATION on the thread, not as a fresh opening", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    const b = await appOver(store);
    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;
    await b.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);

    const thread = b.investigation(investigationId)!;
    const traderTurns = thread.turns.filter((t) => t.role === "TRADER");
    expect(traderTurns).toHaveLength(2);
    expect(traderTurns[1].content).toBe(FAILING_PROMPT);
    expect(traderTurns[1].continuedInvestigation).toBe(true);
  });

  it("only ONE investigation exists — no duplicate thread was opened", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    const b = await appOver(store);
    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;
    await b.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);
    expect(b.listInvestigations()).toHaveLength(1);
  });
});

describe("the single-instance path still routes correctly (no regression)", () => {
  it("the same follow-up continues on one warm app", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;
    const second = await a.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);
    const owner = a.listInvestigations().find((i) => i.runs.some((r) => r.researchRef === second.researchRef));
    expect(owner?.id).toBe(investigationId);
  });
});

// ---------------------------------------------------------------------------
// 4. Hard reload: the thread survives a COLD start from the durable store
// ---------------------------------------------------------------------------

describe("after a hard reload the follow-up still continues the same investigation", () => {
  it("a cold instance rebuilt from the persisted snapshot keeps both runs", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;

    // HARD RELOAD: a brand-new app built only from what the store persisted.
    const reloaded = await appOver(store);
    const restored = reloaded.investigation(investigationId)!;
    expect(restored.runs).toHaveLength(1);

    const second = await reloaded.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);
    const after = reloaded.investigation(investigationId)!;
    expect(after.runs).toHaveLength(2);
    expect(after.runs.map((r) => r.researchRef)).toContain(second.researchRef);
    // Still one thread — the reload did not orphan the follow-up into a new investigation.
    expect(reloaded.listInvestigations()).toHaveLength(1);
  });

  it("and the continuation is still recorded after the reload", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;

    const reloaded = await appOver(store);
    await reloaded.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);

    const turns = reloaded.investigation(investigationId)!.turns.filter((t) => t.role === "TRADER");
    expect(turns).toHaveLength(2);
    expect(turns[1].continuedInvestigation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. New Research stays genuinely clean (the reset must not inherit the thread)
// ---------------------------------------------------------------------------

describe("New Research still produces a genuinely empty investigation", () => {
  it("clears the selection and the next question opens a fresh thread", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;

    await a.startNewInvestigation();
    expect(a.listInvestigations().filter((i) => i.isCurrent)).toHaveLength(0);

    // A fresh question after the reset must NOT land back in the old thread.
    await a.submitResearchRequest("What is happening with Solana today?");
    const current = a.listInvestigations().find((i) => i.isCurrent)!;
    expect(current.id).not.toBe(investigationId);
    // Nothing was deleted: History still holds the original thread and its run.
    expect(a.investigation(investigationId)?.runs).toHaveLength(1);
  });

  it("a NEW-INVESTIGATION request inside a live thread also opens a separate thread", async () => {
    const store = new MemoryStore();
    await store.save(new Workspace().toSnapshot());
    const a = await appOver(store);
    await a.submitResearchRequest(Q1);
    const btc = a.listInvestigations().find((i) => i.isCurrent)!;

    await a.submitResearchRequest("Start a new investigation on Ethereum.", undefined, false, btc.id);
    const eth = a.listInvestigations().find((i) => i.isCurrent)!;
    expect(eth.id).not.toBe(btc.id);
    expect(a.investigation(btc.id)?.runs).toHaveLength(1); // untouched
  });
});

// ---------------------------------------------------------------------------
// 6. Production-shaped persistence (a store that re-reads on every save)
// ---------------------------------------------------------------------------

describe("a store that merges on every write (production BlobStore shape)", () => {
  it("a follow-up still continues when the store re-reads and re-merges on each save", async () => {
    const backing = new MemoryStore();
    // A store whose load() ALWAYS re-reads durable state, like the blob store's loadFresh.
    // This is the shape that made the in-memory graph drift from the truth in production.
    const mergingStore = {
      save: async (snap: never) => backing.save(snap),
      load: async () => backing.load(),
      loadFresh: async () => backing.load(),
    };

    await backing.save(new Workspace().toSnapshot());
    const a = await ResearchApp.create({ provider: provider(), registry: registry(), store: mergingStore });
    const b = await ResearchApp.create({ provider: provider(), registry: registry(), store: mergingStore });

    await a.submitResearchRequest(Q1);
    const investigationId = a.listInvestigations().find((i) => i.isCurrent)!.id;
    const second = await b.submitResearchRequest(FAILING_PROMPT, undefined, false, investigationId);

    const owner = b.listInvestigations().find((i) => i.runs.some((r) => r.researchRef === second.researchRef));
    expect(owner?.id).toBe(investigationId);
  });
});
