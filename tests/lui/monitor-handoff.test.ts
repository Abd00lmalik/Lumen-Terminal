/**
 * MONITORING HANDOFF chain (Workstream II Capability I; brief §5 scenario families 15-18).
 *
 * Pins the END-TO-END handoff law through the real LUI + real domain workspace:
 *   Flow 7 falsification result → LUI MONITOR proposal → persisted PROPOSED monitor (inert) →
 *   explicit activation (trader origin required) → pause → resume — with the thesis untouched.
 * Complements (never replaces) the existing per-unit tests: this suite asserts the CHAIN.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses, newStore } from "../model/fakes.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const trader = { kind: "trader" as const, detail: "trader message" };

function emptyRegistry(): CapabilityRegistry {
  return new CapabilityRegistry();
}

function buildLui(provider: FakeModelProvider, workspace: Workspace = new Workspace()): { lui: Lui; workspace: Workspace } {
  return {
    lui: new Lui({ provider, workspace, store: newStore(), registry: emptyRegistry(), now: () => new Date() }),
    workspace,
  };
}

function scriptDefaults(provider: FakeModelProvider, plan: unknown): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest({}));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget({}));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence());
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan(plan));
}

beforeEach(() => resetIdCounters());

describe("monitoring handoff chain (proposal → persist → activate → pause → resume)", () => {
  it("Flow 7 falsification surfaces monitoring candidates; the LUI MONITOR step persists a PROPOSED monitor without activating it", async () => {
    const workspace = new Workspace();
    // A thesis so the handoff binds to it (ref + version provenance).
    workspace.addThesis(
      { title: "BTC mean reversion", statement: "BTC mean-reverts after 10% weekly drops", asset: "BTC" },
      trader,
    );
    const provider = new FakeModelProvider(new Map([
      ["monitor.proposal", JSON.stringify({
        conditions: ["weekly drop followed by stabilization above prior low"],
        invalidationConditions: ["consecutive weekly closes below the range low"],
        earlyWarningConditions: ["funding rates flip negative"],
        suggestedCadence: "daily",
        scopeNote: "BTC weekly structure",
      })],
    ]));
    scriptDefaults(provider, [{ action: "MONITOR", description: "watch the falsification conditions", capabilities: [], params: {} }]);
    const { lui } = buildLui(provider, workspace);

    const result = await lui.handle("Keep watching the conditions that would prove my thesis wrong");

    expect(result.monitorProposal?.requiresConfirmation).toBe(true);
    expect(result.monitor).toBeDefined();
    expect(result.monitor?.status).toBe("PROPOSED");
    // Invalidation vs early-warning remain DISTINCT kinds in the persisted handoff.
    const kinds = new Set(result.monitor?.conditions.map((c) => c.kind));
    expect(kinds.has("INVALIDATION")).toBe(true);
    expect(kinds.has("EARLY_WARNING")).toBe(true);
    // The proposal binds to the active thesis (id + version), the thesis itself untouched.
    expect(result.monitor?.thesisRef).toBeDefined();
    expect(workspace.listTheses()[0]?.statement).toBe("BTC mean-reverts after 10% weekly drops");
    // Nothing is active.
    expect(workspace.listMonitors().filter((m) => m.status === "ACTIVE")).toHaveLength(0);
  });

  it("activation requires a trader origin; then pause and resume follow the lifecycle table", async () => {
    const workspace = new Workspace();
    const provider = new FakeModelProvider(new Map([
      ["monitor.proposal", JSON.stringify({
        conditions: ["condition A"],
        invalidationConditions: ["condition I"],
        earlyWarningConditions: [],
        suggestedCadence: "manual",
        scopeNote: "scope",
      })],
    ]));
    scriptDefaults(provider, [{ action: "MONITOR", description: "watch", capabilities: [], params: {} }]);
    const { lui } = buildLui(provider, workspace);
    await lui.handle("Keep watching these conditions");

    const proposed = workspace.listMonitors().find((m) => m.status === "PROPOSED");
    expect(proposed).toBeDefined();

    // TRADER ORIGIN: activation succeeds (the API route supplies exactly this origin shape).
    const activated = workspace.activateMonitor(proposed!.id, { kind: "trader", detail: "trader-confirmed activation" }, "explicit trader confirmation");
    expect(activated.status).toBe("ACTIVE");

    // PAUSED, then back to ACTIVE via the domain transition table.
    const paused = workspace.transitionMonitor(activated.id, "PAUSED", { kind: "trader", detail: "trader pause" }, "pause");
    expect(paused.status).toBe("PAUSED");
    const resumed = workspace.transitionMonitor(paused.id, "ACTIVE", { kind: "trader", detail: "trader resume" }, "resume");
    expect(resumed.status).toBe("ACTIVE");

    // COMPLETED is terminal.
    const completed = workspace.transitionMonitor(resumed.id, "COMPLETED", { kind: "trader", detail: "trader completed" }, "done");
    expect(completed.status).toBe("COMPLETED");
    expect(() => workspace.transitionMonitor(completed.id, "ACTIVE", trader, "re-animate")).toThrow(/illegal monitor transition/);
  });

  it("an agent origin CANNOT activate a monitor (confirmation boundary is structural)", async () => {
    const workspace = new Workspace();
    workspace.addMonitorProposal(
      {
        target: "BTC",
        conditions: [{ description: "cond", kind: "EARLY_WARNING", triggerType: "STATE_CHANGE", conditionStatus: "PROPOSED", rationale: "r", evidenceDependencies: [] }],
        triggerRationale: "test",
      },
      { kind: "agent", detail: "proposal" },
    );
    const proposed = workspace.listMonitors()[0]!;
    expect(() =>
      workspace.activateMonitor(proposed.id, { kind: "agent", detail: "self-activation attempt" }, "not allowed"),
    ).toThrow();
    expect(workspace.listMonitors()[0]?.status).toBe("PROPOSED");
  });

  it("SOURCE_UNAVAILABLE recorded on a monitor is a state, never an invalidation (M5 §12)", () => {
    const workspace = new Workspace();
    workspace.addMonitorProposal(
      {
        target: "BTC",
        conditions: [{ description: "cond", kind: "EARLY_WARNING", triggerType: "STATE_CHANGE", conditionStatus: "PROPOSED", rationale: "r", evidenceDependencies: [] }],
        triggerRationale: "test",
      },
      { kind: "agent", detail: "proposal" },
    );
    const monitor = workspace.listMonitors()[0]!;
    const withState = workspace.recordMonitorSourceState(
      monitor.id, "provider-x", "SOURCE_UNAVAILABLE", "feed unreachable", { kind: "agent", detail: "check" },
    );
    expect(withState.sourceStates[0]?.state).toBe("SOURCE_UNAVAILABLE");
    // The source state never flips lifecycle status and never creates an invalidation record.
    expect(withState.status).toBe("PROPOSED");
  });
});
