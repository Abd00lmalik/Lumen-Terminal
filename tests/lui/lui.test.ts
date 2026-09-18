import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { runAdaptiveResearch } from "../../src/research/adaptive.js";
import { Workspace } from "../../src/domain/workspace.js";
import { createThesis } from "../../src/domain/thesis.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { ModelFailure } from "../../src/model/provider.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { normalizedResult } from "../../src/domain/tool-result.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader = { kind: "trader" as const, detail: "test" };
const system = { kind: "agent" as const, detail: "test" };

/** Fake capability provider returning one numeric observation per call. */
function fakeCapability(capability: string, value: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["fake provider"],
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

function buildLui(
  provider: FakeModelProvider,
  registry: CapabilityRegistry = registryWith("NEWS_ANALYSIS"),
): { lui: Lui; workspace: Workspace } {
  const workspace = new Workspace();
  const lui = new Lui({ provider, workspace, store: newStore(), registry, now: () => new Date() });
  return { lui, workspace };
}

/** Default scripted happy path: interpret → resolve → not-ambiguous → informational → safe → plan. */
function scriptDefaults(provider: FakeModelProvider, plan: unknown, overrides: Record<string, string> = {}): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest(overrides["request"] ?? {}));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget(overrides["target"] ?? {}));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

beforeEach(() => resetIdCounters());

describe("ModelProvider fake + validation gate", () => {
  it("treats invalid model JSON as model failure, never an execution command", async () => {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", "this is not json"],
    ]));
    const { lui } = buildLui(provider);
    const result = await lui.handle("What happened to BTC?");
    expect(result.modelFailure).toBeInstanceOf(ModelFailure);
    expect(result.research).toBeUndefined();
    expect(result.plan.steps).toHaveLength(0);
  });

  it("rejects model-proposed actions outside the locked 6-action set", async () => {
    const provider = new FakeModelProvider(new Map([
      ["lui.normalized_request", JSON.stringify({ primaryAction: "EXECUTE_TRADE", compoundActions: [], objective: "x", isExplanationOnly: false, disclosureLevel: 0 })],
    ]));
    const { lui } = buildLui(provider);
    const result = await lui.handle("buy BTC");
    expect(result.modelFailure).toBeInstanceOf(ModelFailure);
    expect(result.response?.answer).toContain("could not be interpreted");
  });

  it("provider unavailability produces a typed failure and an honest response", async () => {
    const provider = new FakeModelProvider(new Map(), { failWith: new ModelFailure("PROVIDER_UNAVAILABLE", "Gemini down", true) });
    const { lui } = buildLui(provider);
    const result = await lui.handle("What happened to BTC?");
    expect(result.modelFailure?.type).toBe("PROVIDER_UNAVAILABLE");
    expect(result.response?.confidence).toBe("UNKNOWN");
    expect(result.response?.implication).toContain("Retry when the model provider");
  });
});

describe("six LUI actions (locked set)", () => {
  it("RESEARCH runs the adaptive loop and returns an answer-first response with real citations", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    scriptDefaults(provider, [{ action: "RESEARCH", description: "research what happened to BTC", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } }]);
    const { lui, workspace } = buildLui(provider, registryWith("NEWS_ANALYSIS"));
    const result = await lui.handle("What happened to BTC today?");

    expect(result.request.primaryAction).toBe("RESEARCH");
    expect(result.research).toBeDefined();
    expect(result.research?.executions.length).toBe(1);
    expect(result.research?.executions[0]?.capability).toBe("NEWS_ANALYSIS");
    expect(result.response).toBeDefined();
    expect(result.response?.citedObjectRefs.length).toBeGreaterThan(0);
    // citations point at real evidence in the workspace
    for (const ref of result.response?.citedObjectRefs ?? []) {
      expect(workspace.getEvidence(ref)).toBeDefined();
    }
    // answer-first, no chain-of-thought dump
    expect(result.response?.supportingReasons.length).toBeGreaterThan(0);
    expect(result.response?.supportingReasons.length).toBeLessThanOrEqual(4);
  });

  it("ANALYZE interprets existing research with citations validated against the workspace", async () => {
    const provider = new FakeModelProvider(new Map([
      ["analysis.model_analysis", JSON.stringify({
        findings: ["one observation exists"],
        conclusion: "evidence is thin",
        supportingReasons: ["single numeric observation"],
        opposingReasons: [],
        uncertainty: ["no corroboration"],
        whatWouldChange: ["a second independent source"],
        citedObjectRefs: ["ev_000001", "ev_999999"], // second is invented → must be dropped
      })],
    ]));
    scriptDefaults(provider, [{ action: "ANALYZE", description: "analyze current research", capabilities: [], params: {} }]);

    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "What happened to BTC?", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const evidence = workspace.addEvidence(
      { observation: "BTC fell 5%", evidenceType: "price", evidenceClass: "OBSERVATION", researchRef: research.id },
      { kind: "tool", toolRef: "t", invocation: {} },
    );
    const lui = new Lui({ provider, workspace, store: newStore(), registry: registryWith(), now: () => new Date() });
    const result = await lui.handle("Analyze what we found");

    expect(result.analysis).toBeDefined();
    // invented citation dropped; real one preserved
    expect(result.analysis?.citedObjectRefs).toEqual([evidence.id]);
    expect(result.analysis?.citedObjectRefs).not.toContain("ev_999999");
  });

  it("CHALLENGE runs falsification-oriented analysis (not generic criticism)", async () => {
    const provider = new FakeModelProvider(new Map([
      ["analysis.challenge", JSON.stringify({
        targetedStatement: "BTC will recover",
        vulnerableAssumptions: ["liquidity remains stable"],
        searchedContradictions: [],
        historicalCounterexamples: [],
        missingEvidence: ["liquidation data for the window"],
        falsificationVerdict: "INCONCLUSIVE",
        rationale: "no contradicting evidence in context; insufficient to confirm or weaken",
        citedObjectRefs: [],
      })],
    ]));
    scriptDefaults(provider, [{ action: "CHALLENGE", description: "try to disprove the thesis", capabilities: [], params: {} }]);
    const { lui } = buildLui(provider);
    const result = await lui.handle("Try to disprove my thesis");

    expect(result.challenge).toBeDefined();
    expect(result.challenge?.falsificationVerdict).toBe("INCONCLUSIVE");
    expect(result.response?.answer).toContain("falsification verdict");
  });

  it("MANAGE_STATE validates working-state changes without persisting memory", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.change_proposal", JSON.stringify({
        changeType: "set-active-asset",
        description: "switch research target to ETH",
        params: { asset: "ETH" },
        rationale: "trader requested target change",
      })],
    ]));
    scriptDefaults(provider, [{ action: "MANAGE_STATE", description: "switch target", capabilities: [], params: {} }]);
    const { lui, workspace } = buildLui(provider);
    const result = await lui.handle("Focus on ETH instead");

    expect(result.stateChange).toBeDefined();
    expect(result.stateChange?.changeType).toBe("set-active-asset");
    // MANAGE_STATE must NOT create saved artifacts (SAVE distinction)
    expect(workspace.listSavedArtifacts()).toHaveLength(0);
  });

  it("MONITOR produces a proposal only; never activates anything", async () => {
    const provider = new FakeModelProvider(new Map([
      ["monitor.proposal", JSON.stringify({
        conditions: ["BTC below 20k"],
        invalidationConditions: [],
        earlyWarningConditions: ["funding flips negative"],
        suggestedCadence: "hourly",
        scopeNote: "BTC only",
      })],
    ]));
    scriptDefaults(provider, [{ action: "MONITOR", description: "watch conditions", capabilities: [], params: {} }]);
    const { lui } = buildLui(provider);
    const result = await lui.handle("Keep an eye on the conditions that would invalidate this thesis");

    expect(result.monitorProposal).toBeDefined();
    expect(result.monitorProposal?.requiresConfirmation).toBe(true);
    expect(result.response?.answer).toContain("awaiting your confirmation");
    expect(result.response?.implication).toContain("No monitor is active yet");
  });

  it("SAVE requires explicit trader confirmation before anything is persisted", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.save_proposal", JSON.stringify({
        artifactType: "finding",
        content: "BTC broke below the 100-day mean on heavy volume",
        derivedFromRefs: [],
        rationale: "validated finding worth reusing",
      })],
    ]));
    scriptDefaults(provider, [{ action: "SAVE", description: "save this finding", capabilities: [], params: {} }]);
    const { lui, workspace } = buildLui(provider, registryWith());

    // No confirmation in origin → SAVE must halt and persist NOTHING.
    const result = await lui.handle("Save this finding");
    expect(result.saved).toBeUndefined();
    expect(result.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(workspace.listSavedArtifacts()).toHaveLength(0);

    // Confirmed origin → artifact persisted with provenance.
    const confirmed = await lui.handle("Save this finding", { kind: "trader", detail: "LUI message; trader confirmed SAVE" });
    expect(confirmed.saved).toBeDefined();
    expect(workspace.listSavedArtifacts()).toHaveLength(1);
    expect(workspace.listSavedArtifacts()[0]?.content).toContain("100-day mean");
  });

  it("SAVE and MANAGE_STATE remain distinct operations (lock §17)", async () => {
    const provider = new FakeModelProvider();
    scriptDefaults(provider, [
      { action: "MANAGE_STATE", description: "update working state", capabilities: [], params: {} },
      { action: "SAVE", description: "save the conclusion", capabilities: [], params: {} },
    ]);
    provider.responses.set("state.change_proposal", JSON.stringify({ changeType: "set-active-asset", description: "d", params: {}, rationale: "r" }));
    provider.responses.set("state.save_proposal", JSON.stringify({ artifactType: "finding", content: "c", derivedFromRefs: [], rationale: "r" }));
    const { lui, workspace } = buildLui(provider);
    const result = await lui.handle("Update the working target and save the conclusion");

    expect(result.stateChange).toBeDefined();          // working state changed
    expect(result.awaitingConfirmation?.status).toBe("REQUIRED"); // SAVE halted for confirmation
    expect(workspace.listSavedArtifacts()).toHaveLength(0);       // nothing persisted silently
  });
});

describe("compound requests (M3 §12)", () => {
  it("decompose into ordered steps preserving the primary objective", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["analysis.challenge", JSON.stringify({
        targetedStatement: "the drop was mechanical",
        vulnerableAssumptions: [], searchedContradictions: [], historicalCounterexamples: [], missingEvidence: [],
        falsificationVerdict: "STOOD", rationale: "no contradiction found", citedObjectRefs: [],
      })],
    ]));
    scriptDefaults(provider, [
      { action: "RESEARCH", description: "research the drop", capabilities: ["NEWS_ANALYSIS"], params: { asset: "BTC" } },
      { action: "CHALLENGE", description: "challenge the resulting explanation", capabilities: [], params: {} },
    ]);
    // Compound override AFTER scriptDefaults (which would otherwise overwrite it):
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({
      primaryAction: "RESEARCH",
      compoundActions: [{ action: "CHALLENGE", purpose: "falsify the finding" }],
      objective: "Research the BTC drop, compare with previous events, and challenge my thesis",
    }));
    const { lui } = buildLui(provider, registryWith("NEWS_ANALYSIS"));
    const result = await lui.handle("Research the BTC drop, compare with previous events, and challenge my thesis");

    expect(result.request.primaryAction).toBe("RESEARCH");
    expect(result.request.compoundActions).toHaveLength(1);
    expect(result.plan.steps).toHaveLength(2);
    expect(result.research).toBeDefined();
    expect(result.challenge).toBeDefined();
  });
});

describe("ambiguity + consequence (M3 §13)", () => {
  it("ambiguous consequential request halts for clarification without touching state", async () => {
    const provider = new FakeModelProvider();
    scriptDefaults(provider, [{ action: "SAVE", description: "save", capabilities: [], params: {} }]);
    provider.responses.set("lui.ambiguity", responses.ambiguity(true, ["Which thesis do you mean?"]));
    provider.responses.set("lui.consequence", responses.consequence("CONSEQUENTIAL", true));
    const { lui, workspace } = buildLui(provider);
    const result = await lui.handle("Save my thesis view");

    expect(result.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(result.response?.answer).toContain("clarification");
    expect(workspace.listSavedArtifacts()).toHaveLength(0);
  });

  it("unambiguous informational research proceeds without unnecessary questions", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    scriptDefaults(provider, [{ action: "RESEARCH", description: "research", capabilities: ["NEWS_ANALYSIS"], params: {} }]);
    const { lui } = buildLui(provider);
    const result = await lui.handle("What happened to BTC?");
    expect(result.awaitingConfirmation).toBeUndefined();
    expect(result.research).toBeDefined();
  });
});

describe("safety boundary (M3 §14; trader decision boundary)", () => {
  it("rejects execution-like requests before any dispatch", async () => {
    const provider = new FakeModelProvider();
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "RESEARCH", objective: "buy BTC now" }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(true));
    const { lui } = buildLui(provider);
    const result = await lui.handle("Buy 2 BTC at market");

    expect(result.rejected).toBeDefined();
    expect(result.response?.answer).toContain("research-only");
    expect(result.research).toBeUndefined();
  });

  it("capability registry has no trading/execution capability to route to", async () => {
    const registry = registryWith("NEWS_ANALYSIS", "TECHNICAL_ANALYSIS");
    // Attempting to execute a non-research capability yields an UNAVAILABLE tool result; no execution path exists.
    const result = await registry.execute("PLACE_ORDER", {}, system);
    expect(result.failure.type).toBe("UNAVAILABLE");
    expect(result.failure.message).toContain("no provider registered");
  });
});

describe("adaptive research loop (M3 §7/§8)", () => {
  it("model proposes plan; engine executes capabilities; no hardcoded flow→tool mapping", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = registryWith("NEWS_ANALYSIS", "TECHNICAL_ANALYSIS", "MACRO_ANALYSIS");
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "What happened to BTC?", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("What happened to BTC?", research.id, {
      provider, registry, workspace, store: newStore(),
    });

    // Only the PLANNED capability ran; the un-planned ones never executed.
    expect(outcome.executions.map((e) => e.capability)).toEqual(["NEWS_ANALYSIS"]);
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.evidence.length).toBeGreaterThan(0);
    // Evidence landed in the graph with provenance.
    expect(workspace.getEvidence(outcome.evidence[0]!.id)).toBeDefined();
  });

  it("contradiction-driven continuation: a CONTINUE decision triggers a second round with new capabilities", async () => {
    let call = 0;
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", () => {
        call += 1;
        return call === 1
          ? responses.adaptiveDecision("CONTINUE", [{ objective: "check positioning", capabilities: ["SENTIMENT_ANALYSIS"], completion: "positioning checked" }])
          : responses.adaptiveDecision("COMPLETE");
      }],
    ]));
    const registry = registryWith("NEWS_ANALYSIS", "SENTIMENT_ANALYSIS");
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "What happened to BTC?", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("What happened to BTC?", research.id, {
      provider, registry, workspace, store: newStore(),
    });

    expect(outcome.rounds).toHaveLength(2);
    expect(outcome.rounds[0]?.decision.decision).toBe("CONTINUE");
    expect(outcome.executions.map((e) => e.capability)).toEqual(["NEWS_ANALYSIS", "SENTIMENT_ANALYSIS"]);
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
  });

  it("round budget exhausts honestly with state preserved", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", () => responses.adaptiveDecision("CONTINUE", [{ objective: "more", capabilities: ["NEWS_ANALYSIS"], completion: "c" }])],
    ]));
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("o", research.id, {
      provider, registry: registryWith("NEWS_ANALYSIS"), workspace, store: newStore(), maxRounds: 2,
    });
    expect(outcome.stoppedBecause).toBe("ROUND_BUDGET_EXHAUSTED");
    expect(outcome.rounds).toHaveLength(2);
  });

  // Zero-dead-end mandate §13/§15: a mechanical budget stop WITH gathered evidence is a
  // completed partial research run — the rationale is user-facing (the internal "round
  // budget exhausted" note once leaked into the final answer) and the decision is COMPLETE.
  it("budget exhaustion with evidence concludes COMPLETE with a user-facing rationale", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", () => responses.adaptiveDecision("CONTINUE", [{ objective: "more", capabilities: ["NEWS_ANALYSIS"], completion: "c" }])],
    ]));
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("o", research.id, {
      provider, registry: registryWith("NEWS_ANALYSIS"), workspace, store: newStore(), maxRounds: 2,
    });
    expect(outcome.stoppedBecause).toBe("ROUND_BUDGET_EXHAUSTED");
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(outcome.finalDecision.decision).toBe("COMPLETE");
    expect(outcome.finalDecision.rationale).not.toContain("round budget");
    expect(outcome.finalDecision.rationale).not.toContain("exhaust");
    expect(outcome.finalDecision.rationale).toContain(String(outcome.evidence.length));
  });

  // The deep-research backstop also fires when a mechanical budget stopped the loop with ZERO
  // evidence (a dead end the loop never substantively concluded), and found material evidence
  // upgrades the conclusion from INSUFFICIENT_EVIDENCE to COMPLETE.
  it("deep-research backstop recovers a zero-evidence budget stop and upgrades the conclusion", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", () => responses.adaptiveDecision("CONTINUE", [{ objective: "more", capabilities: ["NEWS_ANALYSIS"], completion: "c" }])],
    ]));
    // A capability that legitimately returns no outputs (honest no-coverage, no failure).
    const emptyCapability: ProviderAdapter = {
      providerId: "fake/empty-news",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test:live",
      async execute(cap) {
        return { tool: "fake/empty-news", capability: cap, transport: "fake", outputs: [] };
      },
    };
    const registry = new CapabilityRegistry();
    registry.register(emptyCapability);
    registry.register(fakeCapability("CROSS_DOMAIN_SYNTHESIS", "deep-research finding for the exact objective"));
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("o", research.id, {
      provider, registry, workspace, store: newStore(), maxRounds: 1,
    });
    expect(outcome.stoppedBecause).toBe("ROUND_BUDGET_EXHAUSTED");
    const deepExec = outcome.executions.find((e) => e.capability === "CROSS_DOMAIN_SYNTHESIS");
    expect(deepExec).toBeDefined();
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(outcome.finalDecision.decision).toBe("COMPLETE");
    expect(outcome.finalDecision.rationale).toContain("deep-research");
  });

  // A model failure with zero gathered evidence keeps a retriable, non-infrastructure rationale.
  it("model failure rationale is user-facing and retriable", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", () => { throw new ModelFailure("PROVIDER_UNAVAILABLE", "upstream down", true); }],
    ]));
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("o", research.id, {
      provider, registry: registryWith("NEWS_ANALYSIS"), workspace, store: newStore(), maxRounds: 2,
    });
    expect(outcome.stoppedBecause).toBe("MODEL_FAILURE");
    expect(outcome.finalDecision.rationale).not.toContain("upstream down");
    expect(outcome.finalDecision.rationale.toLowerCase()).toContain("retried");
  });

  it("tool failure is a limitation, never negative evidence (M3 §9/§19)", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", responses.researchPlan()],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ]));
    const registry = new CapabilityRegistry();
    registry.register({
      providerId: "failing/news",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: [],
      freshnessProfile: "test",
      async execute() {
        throw new Error("upstream down");
      },
    }, 10);
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);
    workspace.transitionResearch(research.id, "ACTIVE", system, "activated");

    const outcome = await runAdaptiveResearch("o", research.id, { provider, registry, workspace, store: newStore() });

    expect(outcome.evidence).toHaveLength(0);                       // failure produced NO evidence
    expect(outcome.executions[0]?.result.failure.type).toBe("PROVIDER_ERROR");
    expect(outcome.context.limitations.some((l) => l.kind === "tool_failure")).toBe(true);
  });

  it("plan validation failure (model output invalid) stops the loop as MODEL_FAILURE without execution", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", '{"objective": 123}'], // garbage
    ]));
    const registry = registryWith("NEWS_ANALYSIS");
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, trader);

    await expect(runAdaptiveResearch("o", research.id, { provider, registry, workspace, store: newStore() })).rejects.toBeInstanceOf(ModelFailure);
    expect(workspace.listEvidence()).toHaveLength(0); // nothing executed
  });
});

describe("thesis handling (M3 §15); trader ownership", () => {
  it("thesis assessment evaluates evidence against the trader's thesis without mutating it", async () => {
    const provider = new FakeModelProvider();
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "ANALYZE", objective: "check my thesis" }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "DOES_MY_THESIS_HOLD" }));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "ANALYZE", description: "evaluate thesis", capabilities: [], params: { mode: "thesis" } }]));
    provider.responses.set("thesis.assessment", JSON.stringify({
      thesisStatusAssessment: "CONTESTED",
      supportingEvidenceRefs: [], contradictingEvidenceRefs: [],
      invalidationConditions: ["BTC closes below 18k for 3 days"],
      earlyWarningConditions: ["funding stays negative for a week"],
      rationale: "evidence split",
      citedObjectRefs: [],
    }));
    const workspace = new Workspace();
    const thesis = workspace.addThesis(
      { statement: "BTC halves risk after the halving cycle", objective: "position sizing" },
      trader,
    );
    const lui = new Lui({ provider, workspace, store: newStore(), registry: registryWith(), now: () => new Date() });
    const result = await lui.handle("Does my thesis still hold?");

    expect(result.thesisAssessment).toBeDefined();
    expect(result.thesisAssessment?.thesisStatusAssessment).toBe("CONTESTED");
    // Thesis NOT mutated by assessment; same statement, same version.
    expect(workspace.getThesis(thesis.id)?.statement).toBe("BTC halves risk after the halving cycle");
    expect(workspace.getThesis(thesis.id)?.version).toBe(1);
  });

  it("system origin CANNOT revise the thesis (no silent rewrite)", () => {
    const workspace = new Workspace();
    const thesis = workspace.addThesis({ statement: "original", objective: "o" }, trader);
    expect(() => workspace.reviseThesis(thesis.id, { statement: "hijacked" }, system, "system edit")).toThrow(/trader origin/);
    expect(workspace.getThesis(thesis.id)?.statement).toBe("original");
  });

  it("trader-origin revision creates a new preserved version", () => {
    const workspace = new Workspace();
    const thesis = workspace.addThesis({ statement: "v1 statement", objective: "o" }, trader);
    const revised = workspace.reviseThesis(thesis.id, { statement: "v2 statement" }, trader, "trader refined thesis");
    expect(revised.version).toBe(2);
    expect(revised.priorVersionRef).toBe(thesis.id);
    expect(revised.statement).toBe("v2 statement");
  });

  it("thesis evaluation without a thesis is an honest model failure; never a fabricated thesis", async () => {
    const provider = new FakeModelProvider();
    provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "ANALYZE", objective: "check my thesis" }));
    provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
    provider.responses.set("lui.ambiguity", responses.ambiguity(false));
    provider.responses.set("lui.consequence", responses.consequence());
    provider.responses.set("safety.screen", responses.safety(false));
    provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "ANALYZE", description: "evaluate thesis", capabilities: [], params: { mode: "thesis" } }]));
    const { lui } = buildLui(provider);
    const result = await lui.handle("Evaluate according to my framework");
    expect(result.modelFailure?.message).toContain("no active thesis");
  });
});

describe("research context (M3 §9); epistemic distinctions preserved", () => {
  it("interpretation evidence stays interpretation in model context (never upgraded)", async () => {
    const { buildResearchContext } = await import("../../src/research/context.js");
    const workspace = new Workspace();
    workspace.addEvidence(
      { observation: "analyst says bullish", evidenceType: "opinion", evidenceClass: "DERIVED_OBSERVATION" },
      system,
    );
    workspace.addEvidence(
      { observation: "price 60k", evidenceType: "price", evidenceClass: "OBSERVATION" },
      system,
    );
    workspace.addEvidence(
      { observation: "tvl proxy", evidenceType: "defi", evidenceClass: "PROXY_EVIDENCE", proxyBasis: "tvl as adoption proxy" },
      system,
    );
    const ctx = buildResearchContext(workspace);
    const kinds = ctx.items.map((i) => `${i.ref}:${i.kind}`);
    expect(kinds.some((k) => k.includes("analyst_interpretation"))).toBe(true);
    expect(kinds.some((k) => k.includes("proxy_observation"))).toBe(true);
    const observationItems = ctx.items.filter((i) => i.kind === "observation");
    expect(observationItems.every((i) => i.evidenceClass === "OBSERVATION")).toBe(true);
    // proxy keeps its basis
    const proxy = ctx.items.find((i) => i.kind === "proxy_observation");
    expect(proxy?.proxyBasis).toBe("tvl as adoption proxy");
  });

  it("empty results and tool failures appear only as limitations", async () => {
    const { buildResearchContext } = await import("../../src/research/context.js");
    const workspace = new Workspace();
    const failed = normalizedResult(
      { tool: "t", capability: "NEWS_ANALYSIS", transport: "mcp", failure: { type: "PROVIDER_ERROR", message: "down", retriable: true }, completeness: "EMPTY" },
      system,
    );
    const empty = normalizedResult(
      { tool: "t2", capability: "SENTIMENT_ANALYSIS", transport: "mcp", completeness: "EMPTY" },
      system,
    );
    const ctx = buildResearchContext(workspace, {
      executions: [
        { capability: "NEWS_ANALYSIS", result: failed },
        { capability: "SENTIMENT_ANALYSIS", result: empty },
      ],
    });
    expect(ctx.items).toHaveLength(0);
    expect(ctx.limitations.map((l) => l.kind)).toEqual(["tool_failure", "empty_result"]);
    // No negative evidence was fabricated from the failures:
    expect(ctx.contradictions).toHaveLength(0);
  });

  it("thesis reaches the model context labeled as the trader's own position", async () => {
    const { buildResearchContext } = await import("../../src/research/context.js");
    const workspace = new Workspace();
    workspace.addThesis({ statement: "my thesis", objective: "o", claims: [{ statement: "c", importance: "CORE", invalidationConditions: [] }] }, trader);
    const ctx = buildResearchContext(workspace);
    expect(ctx.thesis?.statement).toBe("my thesis");
    expect(ctx.thesis?.claims).toEqual(["c"]);
  });
});

describe("workspace persistence with M3 objects", () => {
  it("theses and saved artifacts survive snapshot round-trip", () => {
    const workspace = new Workspace();
    workspace.addThesis({ statement: "t", objective: "o" }, trader);
    workspace.saveArtifact({ type: "finding", content: "c", rationale: "r" }, { kind: "trader", detail: "confirmed save" });
    const restored = Workspace.fromSnapshot(workspace.toSnapshot());
    expect(restored.listTheses()).toHaveLength(1);
    expect(restored.listSavedArtifacts()).toHaveLength(1);
    expect(restored.listTheses()[0]?.statement).toBe("t");
  });
});
