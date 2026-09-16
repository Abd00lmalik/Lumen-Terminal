/**
 * F0 E2E seam test; proves the HTTP API is a REAL boundary over the existing research engine,
 * not a disconnected mock layer (F0 mandate §23).
 *
 * Path exercised: HTTP POST /api/research → ResearchApp → Lui.handle → adaptive loop / flow
 * runner → capability registry (fake providers) → TOOL_RESULT → evidence → judgment →
 * persistence → DTO mapping → HTTP response. Deterministic: scripted model fakes, no network,
 * no API key.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../../src/api/server.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FileStore, MemoryStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import type { WorkspaceStore } from "../../src/persistence/index.js";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const trader = { kind: "trader" as const, detail: "test" };

/** Fake capability provider returning one numeric observation per call. */
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

/** Default LUI happy-path scripting (mirrors tests/lui/lui.test.ts fixtures). */
function scriptLuiDefaults(provider: FakeModelProvider, plan: unknown): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest());
  provider.responses.set("lui.resolved_target", responses.resolvedTarget());
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

const ADAPTIVE_PLAN = [{ action: "RESEARCH", description: "research what happened to BTC", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }];
const FLOW4_PLAN = [{ action: "RESEARCH", description: "does my thesis hold", capabilities: ["TECHNICAL_ANALYSIS"], params: { flow: "DOES_MY_THESIS_HOLD", asset: "BTC" } }];
const FLOW5_PLAN = [{ action: "RESEARCH", description: "historical comparison", capabilities: ["HISTORICAL_COMPARISON"], params: { flow: "HAS_THIS_HAPPENED_BEFORE", asset: "BTC" } }];

const FLOW5_EVAL_PLAN = JSON.stringify({
  objective: "historical analogy check",
  scopeIncluded: ["historical episodes"],
  scopeExcluded: ["current market state"],
  tasks: [{ type: "FACT_FINDING", objective: "retrieve analogous episodes", capabilities: ["HISTORICAL_COMPARISON"], completion: "episodes retrieved or unavailability recorded" }],
  completionCriteria: ["episodes retrieved or unavailability recorded"],
  adaptationPolicy: "STOP_ON_INSUFFICIENT",
});

const FLOW4_EVAL_PLAN = JSON.stringify({
  objective: "does the thesis hold",
  scopeIncluded: ["technicals"],
  scopeExcluded: ["history (G1 unavailable)"],
  tasks: [{ type: "TECH", objective: "evidence", capabilities: ["TECHNICAL_ANALYSIS"], completion: "c" }],
  completionCriteria: ["components assessed"],
  adaptationPolicy: "balanced search",
});

const FLOW4_EVALUATION = JSON.stringify({
  thesisStatement: "BTC trends up this quarter",
  components: [{
    component: "BTC makes higher highs", kind: "CLAIM",
    status: "SUPPORTED", evidenceQuality: "STRONG",
    supportingRefs: ["ev_000001"], contradictingRefs: [], rationale: "structure supports", uncertainty: [],
  }],
  overallAssessment: "SUPPORTED",
  evidenceBasisQuality: "STRONG",
  strongestSupport: ["structure"], strongestOpposition: [],
  invalidationConditionStatus: [{ condition: "macro tightening accelerates", currentlyTriggered: false, evidenceRefs: [] }],
  unresolved: [], whatWouldChange: ["CPI reacceleration"],
  confidence: "MODERATE", rationale: "claim supported", citedObjectRefs: ["ev_000001"],
});

/** Seed a store with a workspace holding the trader's thesis (prior state, loaded by the API). */
async function storeWithThesis(store: WorkspaceStore): Promise<string> {
  const ws = new Workspace();
  const thesis = ws.addThesis(
    {
      statement: "BTC trends up this quarter",
      objective: "swing",
      claims: [{ statement: "BTC makes higher highs", importance: "CORE", invalidationConditions: ["quarterly close below opening range"] }],
      assumptions: [{ statement: "macro conditions stay stable", importance: "SUPPORTING", invalidationConditions: ["macro tightening accelerates"] }],
      invalidationConditions: ["macro tightening accelerates"],
    },
    trader,
  );
  await store.save(ws.toSnapshot());
  return thesis.id;
}

beforeEach(() => resetIdCounters());

describe("F0 end-to-end API seam (HTTP → engine → DTO → HTTP)", () => {
  // Full-engine integration test: explicit time budget so parallel-suite load can never
  // make it flaky. Deterministic; fakes only.
  it("carries a natural-language research request through the REAL engine and returns a safe DTO", { timeout: 30_000 }, async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, ADAPTIVE_PLAN);
    provider.responses.set("research.plan", responses.researchPlan());
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    const { app } = await buildApi({ provider, registry: registryWith("NEWS_ANALYSIS") });

    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "What happened to BTC today?" } });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.outcome).toBe("COMPLETED");
    expect(body.action).toBe("RESEARCH");
    // The client sent NO flow; flow selection happened inside the LUI (internal routing).
    expect(body.researchRef).toMatch(/^rs_/);
    // Evidence came through the REAL engine path: epistemic class preserved as data.
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.evidence[0].evidenceClass).toBe("OBSERVATION");
    expect(body.evidence[0].freshness).toBe("CURRENT");
    expect(body.evidence[0].ref).toMatch(/^ev_/);
    // Answer card (L0) preserved with confidence + uncertainty + implication.
    expect(body.answer.answer).toBeTruthy();
    expect(body.answer.confidence).toBe("LOW"); // engine-derived, not fabricated
    expect(body.answer.keyUncertainty).toBeTruthy();
    // Limitations include the fake provider's declared limitation (honest partial semantics).
    expect(body.limitations.some((l: string) => l.includes("fake provider limitation"))).toBe(true);
    // No chain-of-thought, prompts, or raw model payloads anywhere in the response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("normalized_request");
    expect(serialized).not.toContain("Respond as JSON");
    expect(serialized).not.toContain("system");
    await app.close();
  });

  it("routes a Flow 4 thesis evaluation through the engine; judgment + auditable assessment exposed", async () => {
    const store = new MemoryStore();
    const thesisId = await storeWithThesis(store);
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, FLOW4_PLAN);
    provider.responses.set("research.plan", FLOW4_EVAL_PLAN);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow4.thesis_evaluation", FLOW4_EVALUATION);
    const { app } = await buildApi({ provider, registry: registryWith("TECHNICAL_ANALYSIS"), store });

    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "Does my thesis still hold?" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("COMPLETED");
    expect(body.judgments.length).toBeGreaterThan(0); // Flow 4 created a real workspace judgment
    expect(body.judgments[0].ref).toMatch(/^jd_/);

    // Thesis workspace: version untouched, assessment history recorded (D3 path via API).
    const thesisRes = await app.inject({ method: "GET", url: `/api/thesis/${thesisId}` });
    expect(thesisRes.statusCode).toBe(200);
    const thesis = thesisRes.json();
    expect(thesis.version).toBe(1); // assessment never mutates the thesis
    expect(thesis.assessments.length).toBe(1);
    expect(thesis.assessments[0].assessment).toBe("SUPPORTED");
    expect(thesis.assessments[0].researchQuality).toBe("STRONG"); // quality ≠ confidence, separate fields

    // Assessment listing endpoint with explicit status fields.
    const assessmentsRes = await app.inject({ method: "GET", url: "/api/assessments" });
    expect(assessmentsRes.json().length).toBe(1);
    await app.close();
  });

  it("routes a Flow 5 historical-comparison request through the engine; G1 evidence exposed in the DTO", { timeout: 30_000 }, async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, FLOW5_PLAN);
    provider.responses.set("research.plan", FLOW5_EVAL_PLAN);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    // Historical fake carries the real G1 freshness verdict (HISTORICAL; intentionally in the past).
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "fake/historical-comparison",
      capabilities: ["HISTORICAL_COMPARISON"],
      limitations: ["fake provider limitation"],
      freshnessProfile: "historical:stable",
      async execute(cap) {
        return {
          tool: "fake/historical-comparison",
          capability: cap,
          transport: "fake",
          outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: { month: "2020-01", candleCount: 2, candles: [] }, about: "BTCUSDT" }],
          completeness: "COMPLETE",
          freshness: "HISTORICAL",
        };
      },
    });
    const { app } = await buildApi({ provider, registry });

    const res = await app.inject({ method: "POST", url: "/api/research", payload: { message: "Have we seen this kind of BTC setup before?" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcome).toBe("COMPLETED");
    expect(body.researchRef).toMatch(/^rs_/);
    // REGRESSION (G1 phase): Flow 5 evidence was previously omitted from the research DTO
    // the API's flow-outcome loop covered flows 2/3/4/6/7/8 but not flow5.
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.evidence[0].evidenceClass).toBe("OBSERVATION");
    expect(body.evidence[0].freshness).toBe("HISTORICAL");
    expect(body.evidenceRefs.length).toBe(body.evidence.length);
    await app.close();
  });

  it("persists research through the WorkspaceStore; state survives across app instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "f0-e2e-"));
    const filePath = join(dir, "ws.json");
    const store = new FileStore(filePath);
    const thesisId = await storeWithThesis(store);

    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, FLOW4_PLAN);
    provider.responses.set("research.plan", FLOW4_EVAL_PLAN);
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    provider.responses.set("flow4.thesis_evaluation", FLOW4_EVALUATION);

    const first = await buildApi({ provider, registry: registryWith("TECHNICAL_ANALYSIS"), store });
    const res1 = await first.app.inject({ method: "POST", url: "/api/research", payload: { message: "Does my thesis hold?" } });
    expect(res1.statusCode).toBe(200);
    await first.app.close();

    // New app instance over the SAME store: state recovers from persistence (continuity),
    // not from any conversation memory.
    const provider2 = new FakeModelProvider(new Map()); // no scripts; reads must not need the model
    const second = await buildApi({ provider: provider2, registry: registryWith("TECHNICAL_ANALYSIS"), store: new FileStore(filePath) });
    const ws = (await second.app.inject({ method: "GET", url: "/api/workspace" })).json();
    expect(ws.currentJudgment).toBeDefined();
    expect(ws.recentEvidence.length).toBeGreaterThan(0);
    expect(ws.activeThesis.ref).toBe(thesisId);
    expect(ws.latestThesisAssessment.assessment).toBe("SUPPORTED");
    // Research history exposes explicit status (current vs historical); never merged.
    const history = (await second.app.inject({ method: "GET", url: "/api/research" })).json();
    expect(history.length).toBeGreaterThan(0);
    expect(typeof history[0].isCurrent).toBe("boolean");
    await second.app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("streams REAL lifecycle progress over SSE, then a final event with the answer", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptLuiDefaults(provider, ADAPTIVE_PLAN);
    provider.responses.set("research.plan", responses.researchPlan());
    provider.responses.set("research.adaptive_decision", responses.adaptiveDecision("COMPLETE"));
    const { app } = await buildApi({ provider, registry: registryWith("NEWS_ANALYSIS") });

    const res = await app.inject({
      method: "POST",
      url: "/api/research?stream=1",
      payload: { message: "What happened to BTC today?" },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"] ?? res.headers["Content-Type"] ?? "")).toContain("text/event-stream");

    const raw = res.body;
    // Named events only; no fabricated event vocabulary.
    expect(raw).toContain("event: progress");
    expect(raw).toContain("event: final");
    // Progress events correspond to ACTUAL lifecycle transitions (engine-threaded).
    expect(raw).toContain("request_accepted");
    expect(raw).toContain("intent_understood");
    expect(raw).toContain("research_plan_created");
    expect(raw).toContain("capability_started");
    expect(raw).toContain("capability_completed");
    expect(raw).toContain("response_ready");
    // Final event carries the safe DTO.
    expect(raw).toContain("\"outcome\":\"COMPLETED\"");
    // No chain-of-thought or raw model payloads in the stream.
    expect(raw).not.toContain("normalized_request");
    expect(raw).not.toContain("Respond as JSON");
    await app.close();
  });

  it("marks runs interrupted by a process restart as STOPPED at startup (honest lifecycle sweep)", async () => {
    // Regression (G1-analysis phase): a run that died mid-flight stayed ACTIVE forever,
    // misleading the UI into rendering an in-progress state that no longer exists.
    const dir = mkdtempSync(join(tmpdir(), "sweep-"));
    const filePath = join(dir, "ws.json");
    const store = new FileStore(filePath);
    const seeded = new Workspace();
    const stuck = seeded.addResearch(
      { objective: "interrupted research", question: "interrupted", flow: "WHAT_HAPPENED" },
      trader,
    );
    seeded.transitionResearch(stuck.id, "ACTIVE", trader, "run started", new Date());
    const done = seeded.addResearch(
      { objective: "completed research", question: "completed", flow: "WHAT_HAPPENED" },
      trader,
    );
    seeded.transitionResearch(done.id, "ACTIVE", trader, "run started", new Date());
    seeded.transitionResearch(done.id, "COMPLETED", trader, "run completed", new Date());
    await store.save(seeded.toSnapshot());

    const provider = new FakeModelProvider(new Map());
    const { app } = await buildApi({ provider, registry: registryWith("NEWS_ANALYSIS"), store: new FileStore(filePath) });

    const history = (await app.inject({ method: "GET", url: "/api/research" })).json() as { ref: string; status: string }[];
    const interrupted = history.find((r) => r.ref === stuck.id);
    const completed = history.find((r) => r.ref === done.id);
    expect(interrupted?.status).toBe("STOPPED"); // honestly not running, never fabricated
    expect(completed?.status).toBe("COMPLETED"); // genuinely finished objects are untouched
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
