/**
 * Phase C LUI integration: natural-language SAVE resolves the current active research context
 * and produces a typed saved artifact. The LUI still never persists silently — an unconfirmed
 * SAVE halts — and a repeated SAVE of the same artifact is idempotent.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Lui } from "../../src/lui/lui.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, newStore, responses } from "../model/fakes.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test" };

function fakeCapability(capability: string): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: [],
    freshnessProfile: "test:live",
    async execute(cap) {
      return { tool: `fake/${capability.toLowerCase()}`, capability: cap, transport: "fake", outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: `${cap} reading`, about: "BTC" }] };
    },
  };
}

function registryWith(...caps: string[]): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const c of caps) registry.register(fakeCapability(c));
  return registry;
}

function scriptSavePlan(provider: FakeModelProvider): void {
  provider.responses.set("lui.normalized_request", responses.normalizedRequest({ primaryAction: "SAVE", objective: "save this research" }));
  provider.responses.set("lui.resolved_target", responses.resolvedTarget({ flow: "" }));
  provider.responses.set("lui.ambiguity", responses.ambiguity(false));
  provider.responses.set("lui.consequence", responses.consequence("CONSEQUENTIAL", true));
  provider.responses.set("safety.screen", responses.safety(false));
  provider.responses.set("lui.action_plan", responses.actionPlan([{ action: "SAVE", description: "save this research", capabilities: [], params: {} }]));
}

function buildLui(provider: FakeModelProvider, workspace: Workspace): Lui {
  return new Lui({ provider, workspace, store: newStore(), registry: registryWith("NEWS_ANALYSIS"), now: () => new Date("2026-03-12T10:00:00.000Z") });
}

function withResearch(workspace: Workspace): string {
  const r = workspace.addResearch({ objective: "What is affecting BTC right now?", question: "What is affecting BTC right now?", flow: "WHAT_HAPPENED" }, trader);
  return r.id;
}

beforeEach(() => resetIdCounters());

describe("Phase C: LUI SAVE", () => {
  it("a confirmed SAVE resolves the current active research and saves a typed artifact", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.save_proposal", JSON.stringify({ artifactType: "research-conclusion", kind: "RESEARCH", content: "BTC is bid on ETF inflows", derivedFromRefs: [], rationale: "keep the conclusion" })],
    ]));
    scriptSavePlan(provider);
    const workspace = new Workspace();
    const researchId = withResearch(workspace);
    const lui = buildLui(provider, workspace);

    const result = await lui.handle("Save this research", { kind: "trader", detail: "trader confirmed SAVE" });
    expect(result.saved).toBeDefined();
    expect(result.saved!.kind).toBe("RESEARCH");
    expect(result.saved!.researchRef).toBe(researchId); // origin retained, never origin-less
    expect(workspace.listSavedArtifacts()).toHaveLength(1);
  });

  it("honours the model's kind when it is one of the closed vocabulary", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.save_proposal", JSON.stringify({ artifactType: "finding", kind: "EVIDENCE", content: "ETF net inflows +120M", derivedFromRefs: [], rationale: "keep the observation" })],
    ]));
    scriptSavePlan(provider);
    const workspace = new Workspace();
    withResearch(workspace);
    const lui = buildLui(provider, workspace);
    const result = await lui.handle("Save this evidence", { kind: "trader", detail: "trader confirmed SAVE" });
    expect(result.saved?.kind).toBe("EVIDENCE");
  });

  it("an unconfirmed SAVE persists NOTHING", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.save_proposal", JSON.stringify({ artifactType: "research-conclusion", content: "c", derivedFromRefs: [], rationale: "r" })],
    ]));
    scriptSavePlan(provider);
    const workspace = new Workspace();
    withResearch(workspace);
    const lui = buildLui(provider, workspace);
    const result = await lui.handle("Save this research"); // no confirmation in origin
    expect(result.saved).toBeUndefined();
    expect(result.awaitingConfirmation?.status).toBe("REQUIRED");
    expect(workspace.listSavedArtifacts()).toHaveLength(0);
  });

  it("repeating the same confirmed SAVE does not duplicate the artifact", async () => {
    const provider = new FakeModelProvider(new Map([
      ["state.save_proposal", JSON.stringify({ artifactType: "research-conclusion", kind: "RESEARCH", content: "same conclusion", derivedFromRefs: [], rationale: "r" })],
    ]));
    scriptSavePlan(provider);
    const workspace = new Workspace();
    withResearch(workspace);
    const lui = buildLui(provider, workspace);
    await lui.handle("Save this research", { kind: "trader", detail: "trader confirmed SAVE" });
    await lui.handle("Save this research", { kind: "trader", detail: "trader confirmed SAVE" });
    expect(workspace.listSavedArtifacts()).toHaveLength(1);
  });
});
