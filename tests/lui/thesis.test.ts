/**
 * Phase D LUI integration: natural-language thesis actions.
 *
 * Law under test: the LUI may only PROPOSE a thesis. Nothing is persisted until the trader
 * explicitly confirms; an unconfirmed request halts and writes nothing. The statement is the
 * trader's own text (verbatim from the proposal), never an LLM paraphrase or rewrite, and no
 * assessment/agent path can mutate an existing thesis.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

function scriptThesisPlan(provider: FakeModelProvider, statement: string): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "MANAGE_STATE", objective: "turn this into a thesis" }));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "" }));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence("CONSEQUENTIAL", true));
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "MANAGE_STATE", description: "create a thesis", capabilities: [], params: { objective: "turn this into a thesis" } }]));
  provider.responses.set(
    "state.change_proposal",
    JSON.stringify({ changeType: "create-thesis", description: "create a thesis", params: { statement }, rationale: "trader asked for a thesis", thesisAction: "CREATE" }),
  );
}

function buildLui(provider: FakeModelProvider, workspace: Workspace): Lui {
  return new Lui({ provider, workspace, store: newStore(), registry: new CapabilityRegistry(), now: () => new Date("2026-03-12T10:00:00.000Z") });
}

beforeEach(() => resetIdCounters());

describe("Phase D: LUI thesis actions", () => {
  it("an UNCONFIRMED thesis creation persists NOTHING and asks for confirmation", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptThesisPlan(provider, "BTC holds above support this quarter");
    const workspace = new Workspace();
    const lui = buildLui(provider, workspace);

    const result = await lui.handle("Turn this into a thesis"); // no confirmation in origin
    expect(result.thesis).toBeUndefined();
    expect(result.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(workspace.listTheses()).toHaveLength(0); // no false persistence
    expect(result.response?.answer).toMatch(/requires your explicit confirmation/);
  });

  it("a CONFIRMED creation mints a trader-owned ACTIVE thesis with the statement VERBATIM", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptThesisPlan(provider, "BTC holds above support this quarter");
    const workspace = new Workspace();
    const research = workspace.addResearch({ objective: "BTC support", question: "BTC support", flow: "WHAT_HAPPENED" }, trader);
    const lui = buildLui(provider, workspace);

    const result = await lui.handle("Turn this into a thesis", { kind: "trader", detail: "trader confirmed thesis creation" });
    expect(result.thesis).toBeDefined();
    expect(result.thesis!.statement).toBe("BTC holds above support this quarter"); // verbatim, no paraphrase
    expect(result.thesis!.status).toBe("ACTIVE");
    expect(result.thesis!.userConfirmed).toBe(true);
    expect(workspace.listTheses()).toHaveLength(1);
    // The anchored run is linked by reference (never copied).
    expect(result.thesis!.linkedResearchRefs).toContain(research.id);
  });

  it("a thesis PROPOSAL with no statement is an honest typed failure, not an empty thesis", async () => {
    const provider = new FakeModelProvider(new Map());
    scriptThesisPlan(provider, "");
    const workspace = new Workspace();
    const lui = buildLui(provider, workspace);
    const result = await lui.handle("make a thesis", { kind: "trader", detail: "trader confirmed thesis creation" });
    expect(result.thesis).toBeUndefined();
    expect(result.modelFailure?.type).toBe("INVALID_OUTPUT");
    expect(workspace.listTheses()).toHaveLength(0);
  });

  it("an assessment result never mutates the thesis (explicit trader edit only)", () => {
    const workspace = new Workspace();
    const t = workspace.addThesis({ statement: "original belief", objective: "o" }, trader);
    workspace.recordThesisAssessment(
      { thesisId: t.id, thesisVersion: t.version, assessment: "MATERIALLY_CHALLENGED", rationale: "r", supportingEvidence: [], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "LOW" },
      { kind: "agent", detail: "assessment" },
    );
    expect(workspace.getThesis(t.id)!.statement).toBe("original belief"); // unchanged by the assessment
    expect(() => workspace.reviseThesis(t.id, { statement: "silently rewritten" }, { kind: "agent", detail: "system" }, "system edit")).toThrow(/trader origin/);
  });
});
