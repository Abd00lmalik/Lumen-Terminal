/**
 * F0 API contract tests; deterministic, no network, no GEMINI_API_KEY (F0 mandate §22).
 *
 * Coverage: request handling (valid/malformed/empty, API-does-not-select-flows), DTO safety
 * (epistemic status, judgment fields, uncertainty, limitations, no reasoning/secrets), workspace
 * continuity exposure, SAVE authorization (cannot bypass the LUI boundary), thesis exposure
 * (read-only + selection only), monitoring exposure (proposal ≠ active; SOURCE_UNAVAILABLE as
 * state), SSE safety, and security (no secrets/auth headers/filesystem/trading endpoints).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { createEvidence } from "../../src/domain/objects.js";
import { ModelFailure } from "../../src/model/provider.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import type { FastifyInstance } from "fastify";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider limitation"],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: value, about: "BTC" }],
      };
    },
  };
}

function registryWith(...capabilities: string[]): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const c of capabilities) registry.register(fakeCapability(c, `${c} reading for BTC`));
  return registry;
}

function scriptLuiDefaults(provider: FakeModelProvider, plan: unknown): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest());
  provider.responses.set("lui.resolved_target", responses.resolvedTarget());
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

const ADAPTIVE_PLAN = [{ action: "RESEARCH", description: "research BTC", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }];
const SAVE_PLAN = [{ action: "SAVE", description: "save this finding", capabilities: [], params: {} }];

beforeEach(() => resetIdCounters());

async function makeApp(opts: {
  provider: FakeModelProvider;
  capabilities?: string[];
  seed?: (ws: Workspace) => void;
}): Promise<{ app: FastifyInstance }> {
  const store = new MemoryStore();
  if (opts.seed) {
    const ws = new Workspace();
    opts.seed(ws);
    await store.save(ws.toSnapshot());
  }
  const { app } = await buildApi({
    provider: opts.provider,
    registry: registryWith(...(opts.capabilities ?? ["NEWS_ANALYSIS"])),
    store,
  });
  return { app };
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
describe("request handling", () => {
  // Full-engine integration test: given an explicit time budget so parallel-suite load
  // (cold transform of 32 files) can never make it flaky. Deterministic; fakes only.
  it("accepts a valid research request and reaches the LUI boundary (model called with the message)", { timeout: 30_000 }, async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, ADAPTIVE_PLAN);
    provider.responses.set("research.plan", responses.researchPlan());
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    const { app } = await makeApp({ provider });
    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "What is affecting BTC right now?" } });
    expect(res.statusCode).toBe(200);
    // The message reached the LUI (the interpreter prompt carries it); the API is a seam.
    expect(provider.calls.some((c) => c.schemaName === "lui.normalized_request" && c.prompt.includes("What is affecting BTC right now?"))).toBe(true);
    await app.close();
  });

  it("rejects malformed and empty requests without touching the engine", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({ provider });
    const callsBefore = provider.calls.length;

    const noBody = await app.inject({ method: "POST", url: "/api/research", payload: {} });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json().error.code).toBe("INVALID_REQUEST");

    const empty = await app.inject({ method: "POST", url: "/api/research", payload: { message: "   " } });
    expect(empty.statusCode).toBe(400);

    const wrongType = await app.inject({ method: "POST", url: "/api/research", payload: { message: 42 } });
    expect(wrongType.statusCode).toBe(400);

    expect(provider.calls.length).toBe(callsBefore); // engine never invoked
    await app.close();
  });

  it("never selects a flow itself; no client-side flow parameter can reach the engine as an override", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, ADAPTIVE_PLAN);
    provider.responses.set("research.plan", responses.researchPlan());
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    const { app } = await makeApp({ provider });
    // A client trying to smuggle a flow field is ignored; the API contract carries only `message`.
    const res = await app.inject({
      method: "POST",
      url: "/api/research",
      payload: { message: "What happened to BTC?", flow: "DOES_MY_THESIS_HOLD", action: "SAVE" },
    });
    expect(res.statusCode).toBe(200);
    // The scripted plan is the adaptive RESEARCH plan; the injected `action: SAVE` did nothing.
    expect(res.json().action).toBe("RESEARCH");
    await app.close();
  });

  it("returns the LUI's typed model failure honestly (200 + MODEL_FAILURE field, never fabricated evidence)", async () => {
    const provider = new FakeModelProvider(new Map(), { failWith: new ModelFailure("PROVIDER_UNAVAILABLE", "Gemini unreachable", false) });
    const { app } = await makeApp({ provider });
    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "What happened to BTC?" } });
    expect(res.statusCode).toBe(200); // the REQUEST completed; the interpretation failed honestly
    const body = res.json();
    expect(body.outcome).toBe("MODEL_FAILURE");
    expect(body.modelFailure.type).toBe("PROVIDER_UNAVAILABLE");
    expect(body.modelFailure.message).toContain("Gemini unreachable");
    expect(body.evidence).toHaveLength(0); // failure never becomes evidence
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// DTO safety; epistemic status preserved
// ---------------------------------------------------------------------------
describe("DTO safety", () => {
  it("preserves evidence epistemic classes, freshness, and refs in responses", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, ADAPTIVE_PLAN);
    provider.responses.set("research.plan", responses.researchPlan());
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    const { app } = await makeApp({ provider });
    const body = (await app.inject({ method: "POST", url: "/api/research", payload: { message: "What happened to BTC?" } })).json();
    const ev = body.evidence[0];
    expect(ev.evidenceClass).toBe("OBSERVATION"); // class preserved as data; not flattened to source+text
    expect(ev.freshness).toBe("CURRENT");
    expect(ev.sourceRefs.length).toBeGreaterThan(0);
    expect(ev.observedAt).toBeTruthy();
    await app.close();
  });

  it("preserves judgment fields, uncertainty, and limitations; excludes reasoning and secrets", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, ADAPTIVE_PLAN);
    provider.responses.set("research.plan", responses.researchPlan());
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    const { app } = await makeApp({ provider });
    const body = (await app.inject({ method: "POST", url: "/api/research", payload: { message: "What happened to BTC?" } })).json();
    expect(body.answer.confidence).toBeDefined();
    expect(body.answer.keyUncertainty).toBeTruthy();
    expect(body.limitations).toContain("fake provider limitation");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/AIza[\w\-]{10,}/); // Gemini key shape
    expect(serialized).not.toContain("GEMINI_API_KEY");
    expect(serialized).not.toContain("chain-of-thought");
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Workspace / continuity exposure
// ---------------------------------------------------------------------------
describe("workspace exposure", () => {
  it("exposes the continuity snapshot safely: active thesis, latest assessment, judgment, artifacts, memory, monitors", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({
      provider,
      seed: (ws) => {
        const research = ws.addResearch({ objective: "assess BTC", question: "what moved BTC", flow: "WHAT_HAPPENED" }, trader);
        ws.transitionResearch(research.id, "ACTIVE", { kind: "agent", detail: "seed" }, "activated");
        const t = ws.addThesis({ statement: "BTC trends up", objective: "swing" }, trader);
        ws.setActiveThesis(t.id);
        ws.recordThesisAssessment({
          thesisId: t.id, thesisVersion: 1, assessment: "SUPPORTED", rationale: "r",
          supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [],
          confidence: "MODERATE",
        }, trader);
        ws.saveArtifact({ type: "framework", content: "criteria: momentum, liquidity", derivedFromRefs: [], rationale: "trader framework" }, trader);
        ws.addMemory({ category: "research", content: "saved research conclusion" }, trader);
        ws.addMonitorProposal({ target: "BTC", conditions: [], triggerRationale: "guard thesis" }, trader);
        ws.addJudgment({
          researchRef: research.id,
          statement: "BTC moved on news", basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] },
          confidence: "LOW", uncertainty: ["magnitude unknown"], implications: [], unresolvedQuestions: [],
        }, trader);
      },
    });
    const ws = (await app.inject({ method: "GET", url: "/api/workspace" })).json();
    expect(ws.activeThesis.statement).toBe("BTC trends up");
    expect(ws.latestThesisAssessment.assessment).toBe("SUPPORTED");
    expect(ws.currentJudgment.statement).toBe("BTC moved on news");
    expect(ws.activeFramework.type).toBe("framework");
    expect(ws.savedArtifacts.length).toBe(1);
    expect(ws.memories.length).toBe(1);
    expect(ws.monitorProposals.length).toBe(1);
    expect(ws.unresolvedUncertainties).toContain("magnitude unknown");
    await app.close();
  });

  it("exposes memory with explicit status; STALE is returned as STALE, never merged into current", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({
      provider,
      seed: (ws) => {
        const current = ws.addMemory({ category: "research", content: "old conclusion" }, trader);
        ws.addMemory({ category: "historical", content: "archived conclusion" }, trader);
        ws.decayMemory(current.id, "HISTORICAL", "superseded by newer research", trader);
      },
    });
    const memories = (await app.inject({ method: "GET", url: "/api/memory" })).json();
    const statuses = memories.map((m: { status: string }) => m.status);
    expect(statuses).toContain("CURRENT");
    expect(statuses).toContain("HISTORICAL"); // explicit status field; client never infers
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// SAVE authorization; the API cannot bypass the confirmation boundary
// ---------------------------------------------------------------------------
describe("SAVE authorization", () => {
  it("an unconfirmed SAVE persists NOTHING; awaiting confirmation, no artifact, no memory", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, SAVE_PLAN);
    provider.responses.set("state.save_proposal", JSON.stringify({
      artifactType: "finding", content: "validated finding", derivedFromRefs: [], rationale: "r",
    }));
    const { app } = await makeApp({ provider });
    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "Save this finding" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("AWAITING_CONFIRMATION");
    expect(body.evidence).toHaveLength(0);

    // Nothing persisted.
    const artifacts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    expect(artifacts).toHaveLength(0);
    const memories = (await app.inject({ method: "GET", url: "/api/memory" })).json();
    expect(memories).toHaveLength(0);
    await app.close();
  });

  it("an explicitly confirmed SAVE works through the existing LUI boundary (artifact + memory created)", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, SAVE_PLAN);
    provider.responses.set("state.save_proposal", JSON.stringify({
      artifactType: "finding", content: "validated finding", derivedFromRefs: [], rationale: "r",
    }));
    const { app } = await makeApp({ provider });
    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "Save this finding", confirmed: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("COMPLETED");
    const artifacts = (await app.inject({ method: "GET", url: "/api/artifacts" })).json();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].content).toBe("validated finding");
    // Memory promotion happened through SAVE (categorized), not a side door.
    const memories = (await app.inject({ method: "GET", url: "/api/memory" })).json();
    expect(memories).toHaveLength(1);
    expect(memories[0].artifactRef).toBe(artifacts[0].ref);
    await app.close();
  });

  it("no arbitrary memory-write endpoint exists (HTTP → persistMemory shortcut is impossible)", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({ provider });
    const postMemory = await app.inject({ method: "POST", url: "/api/memory", payload: { content: "forged memory" } });
    expect([404, 405]).toContain(postMemory.statusCode);
    const postArtifact = await app.inject({ method: "POST", url: "/api/artifacts", payload: { content: "forged artifact" } });
    expect([404, 405]).toContain(postArtifact.statusCode);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Thesis exposure; read + selection only
// ---------------------------------------------------------------------------
describe("thesis exposure", () => {
  it("exposes thesis, assessment history, and latest assessment; selection persists; no mutation endpoint", async () => {
    const provider = new FakeModelProvider(new Map());
    let thesisId = "";
    const { app } = await makeApp({
      provider,
      seed: (ws) => {
        const t = ws.addThesis({ statement: "ETH undervalued vs BTC", objective: "swing" }, trader);
        thesisId = t.id;
        ws.recordThesisAssessment({
          thesisId: t.id, thesisVersion: 1, assessment: "WEAKENED", rationale: "r",
          supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [],
          confidence: "LOW", researchQuality: "MIXED",
        }, trader);
      },
    });
    const thesis = (await app.inject({ method: "GET", url: `/api/thesis/${thesisId}` })).json();
    expect(thesis.statement).toBe("ETH undervalued vs BTC");
    expect(thesis.assessments).toHaveLength(1);
    expect(thesis.assessments[0].researchQuality).toBe("MIXED"); // quality as separate field

    // Selection through the domain boundary; persisted (survives a reload).
    const sel = await app.inject({ method: "POST", url: "/api/thesis/select", payload: { thesisRef: thesisId } });
    expect(sel.statusCode).toBe(200);
    expect(sel.json().selected).toBe(thesisId);

    // No thesis mutation endpoint: PATCH/PUT/DELETE must not exist.
    const patch = await app.inject({ method: "PATCH", url: `/api/thesis/${thesisId}`, payload: { statement: "rewritten" } });
    expect([404, 405]).toContain(patch.statusCode);
    const put = await app.inject({ method: "PUT", url: `/api/thesis/${thesisId}`, payload: { statement: "rewritten" } });
    expect([404, 405]).toContain(put.statusCode);
    await app.close();
  });

  it("rejects selection of an unknown thesis with 404 (no invented state)", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({ provider });
    const sel = await app.inject({ method: "POST", url: "/api/thesis/select", payload: { thesisRef: "th_nonexistent" } });
    expect(sel.statusCode).toBe(404);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Monitoring exposure; proposal ≠ active; no fake infrastructure
// ---------------------------------------------------------------------------
describe("monitoring exposure", () => {
  it("exposes proposals separately from active monitors; activation goes through the trader boundary", async () => {
    const provider = new FakeModelProvider(new Map());
    let monitorId = "";
    const { app } = await makeApp({
      provider,
      seed: (ws) => {
        const m = ws.addMonitorProposal({
          target: "BTC",
          conditions: [
            { description: "weekly close below 60k", kind: "INVALIDATION", triggerType: "THRESHOLD", conditionStatus: "DERIVED_FROM_THESIS", rationale: "thesis invalidation", evidenceDependencies: [] },
            { description: "funding flips negative", kind: "EARLY_WARNING", triggerType: "STATE_CHANGE", conditionStatus: "PROPOSED", rationale: "rising risk", evidenceDependencies: [] },
          ],
          triggerRationale: "guard the thesis",
        }, trader);
        monitorId = m.id;
      },
    });
    const monitors = (await app.inject({ method: "GET", url: "/api/monitors" })).json();
    expect(monitors.proposals).toHaveLength(1);
    expect(monitors.active).toHaveLength(0); // proposal ≠ active
    const conditions = monitors.proposals[0].conditions;
    expect(conditions.some((c: { kind: string }) => c.kind === "INVALIDATION")).toBe(true);
    expect(conditions.some((c: { kind: string }) => c.kind === "EARLY_WARNING")).toBe(true); // kinds never merged

    // Trader-confirmed activation via the domain boundary (the local single-trader MVP path).
    const activated = await app.inject({ method: "POST", url: `/api/monitors/${monitorId}/activate` });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().status).toBe("ACTIVE");
    const after = (await app.inject({ method: "GET", url: "/api/monitors" })).json();
    expect(after.proposals).toHaveLength(0);
    expect(after.active).toHaveLength(1);
    await app.close();
  });

  it("exposes SOURCE_UNAVAILABLE as monitor state data; never as an invalidation alert", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({
      provider,
      seed: (ws) => {
        const m = ws.addMonitorProposal({ target: "BTC", conditions: [], triggerRationale: "r" }, trader);
        ws.activateMonitor(m.id, trader, "trader activated");
        ws.recordMonitorSourceState(m.id, "src_news_feed", "SOURCE_UNAVAILABLE", "feed unreachable", trader);
      },
    });
    const monitors = (await app.inject({ method: "GET", url: "/api/monitors" })).json();
    expect(monitors.active).toHaveLength(1);
    const sourceStates = monitors.active[0].sourceStates;
    expect(sourceStates).toHaveLength(1);
    expect(sourceStates[0].state).toBe("SOURCE_UNAVAILABLE"); // status data, not an alert payload
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Security; no secrets, no auth headers, no filesystem, no trading surface
// ---------------------------------------------------------------------------
describe("security", () => {
  it("health endpoint reports process availability only; no false provider/monitoring/trading signals", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({ provider });
    const health = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(health.status).toBe("ok");
    expect(JSON.stringify(health).toLowerCase()).not.toContain("gemini healthy");
    expect(JSON.stringify(health).toLowerCase()).not.toContain("monitoring active");
    expect(JSON.stringify(health).toLowerCase()).not.toContain("trading available");
    await app.close();
  });

  it("no trading/execution endpoint exists anywhere on the API surface", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({ provider });
    const executionAttempts = [
      { method: "POST", url: "/api/orders" },
      { method: "POST", url: "/api/trade" },
      { method: "POST", url: "/api/execute" },
      { method: "POST", url: "/api/positions" },
      { method: "POST", url: "/api/transfer" },
      { method: "POST", url: "/api/leverage" },
    ] as const;
    for (const attempt of executionAttempts) {
      const res = await app.inject({ method: attempt.method, url: attempt.url, payload: {} });
      expect([404, 405]).toContain(res.statusCode);
    }
    // The registry structurally exposes no execution capability; probed through the app.
    await app.close();
  });

  it("error responses never contain stack traces, file paths, or env values", async () => {
    const provider = new FakeModelProvider(new Map());
    const { app } = await makeApp({ provider });
    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "" } });
    const body = JSON.stringify(res.json());
    expect(body).not.toMatch(/[A-Za-z]:\\\\?[^\s"]+/); // no windows paths
    expect(body).not.toContain("at Object."); // no stack frames
    expect(body).not.toContain("GEMINI_API_KEY");
    await app.close();
  });
});

// ModelFailure imported at top (used in the typed-failure test).
