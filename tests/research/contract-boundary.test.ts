/**
 * SHARED FINAL CONTRACT BOUNDARY (system-wide law).
 *
 * The research contract is not an adaptive-loop-only invariant. Every path that produces a
 * user-visible judgment — the adaptive loop AND Flows 2-8 — passes through ONE boundary:
 *
 *   research result -> judgment/prose -> validateContractOutcome -> completion/confidence laws
 *   -> persistence/user-visible result
 *
 * These tests pin the five laws the mandate requires, and in particular prove a flow-routed
 * result cannot bypass them:
 *   1. adaptive/engine validation rejects unsupported causal prose;
 *   2. a flow-routed causal result cannot bypass the same law (wiring, not just a helper);
 *   3. a non-causal flow never invents causal links;
 *   4. unresolved causal links cap confidence regardless of execution path;
 *   5. EVIDENCE_SUFFICIENT stays blocked while a material transmission requirement is unresolved.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { validateContractOutcome } from "../../src/research/contract-boundary.js";
import { validateFlowOutcome, type FlowOutcome } from "../../src/research/flow-runner.js";
import { runFlow2 } from "../../src/research/flow2.js";
import { runFlow6 } from "../../src/research/flow6.js";
import { deriveCausalLinkStatuses } from "../../src/research/causal.js";
import {
  assessCoverage,
  buildRequirements,
  completeRequirements,
  subjectMarketClassOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";
import { Workspace } from "../../src/domain/workspace.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import type { ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeModelProvider, responses } from "../model/fakes.js";

const OIL_TRANSMISSION =
  "What drove the move in crude oil this week, how did those transmissions flow into inflation and Treasury yields";

const OIL_SUBJECT_TERMS = new Set(["OIL", "CRUDE", "WTI", "BRENT", "PETROLEUM"]);

function ledgerOf(question: string, subject: string): readonly ResearchRequirement[] {
  return completeRequirements(question, buildRequirements([]), {
    subject,
    marketClass: subjectMarketClassOf(question),
  });
}

function coverageItem(partial: Partial<CoverageEvidence> & { ref: string; text: string }): CoverageEvidence {
  return partial;
}

/** Crude + yields evidence but NO inflation evidence: the node-vs-arrow failure. */
const NO_INFLATION_EVIDENCE: readonly CoverageEvidence[] = [
  coverageItem({
    ref: "ev_oil", text: "WTI crude oil settled 4% higher this week on supply disruption",
    sourceProvider: "commodity-market-data", sourceType: "PRIMARY",
  }),
  coverageItem({
    ref: "ev_oil2", text: "Crude oil supply disruption tightened the physical market this week",
    sourceProvider: "energy-news", sourceType: "SECONDARY",
  }),
  coverageItem({
    ref: "ev_yields", text: "Treasury yields rose 12 basis points this week as rate markets repriced policy",
    sourceProvider: "market-regime", sourceType: "PRIMARY",
  }),
  coverageItem({
    ref: "ev_yields2", text: "The 10-year Treasury yield ended the week higher, a rate-market repricing",
    sourceProvider: "rates-provider", sourceType: "SECONDARY",
  }),
];

beforeEach(() => resetIdCounters());

// ---------------------------------------------------------------------------
// 1 + 4. The engine's validation rejects unsupported causal prose and caps confidence.
// ---------------------------------------------------------------------------
describe("the shared boundary rejects unsupported causal prose (the adaptive path's law)", () => {
  const covered = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), NO_INFLATION_EVIDENCE, {
    subjectTerms: OIL_SUBJECT_TERMS,
    now: new Date(),
  });

  function run(prose: string) {
    return validateContractOutcome<{ answer: string }>(
      {
        prose,
        ledger: covered,
        evidenceText: NO_INFLATION_EVIDENCE.map((e) => e.text).join(" "),
        executedCapabilities: [],
        stoppedBecause: "EVIDENCE_SUFFICIENT",
        failedPaths: 0,
      },
      (patch) => ({ answer: patch.prose }),
    );
  }

  it("strips the asserted transmission over an unresearched link and reports it", () => {
    const enforced = run(
      "Crude oil supply tightened this week. Higher crude prices drove inflation higher. Yields rose with the rate repricing.",
    );
    expect(enforced.violationReport.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(true);
    expect(enforced.prose).not.toContain("drove inflation higher");
    expect(enforced.prose).toContain("Crude oil supply tightened this week");
  });

  it("caps confidence at the weakest link and blocks EVIDENCE_SUFFICIENT", () => {
    const enforced = run("Crude oil supply tightened this week.");
    expect(enforced.confidence.level).toBe("LOW");
    expect(enforced.confidence.weakestCausalLink?.target).toBe("INFLATION");
    expect(enforced.stoppedBecause).toBe("REQUIREMENT_GAPS_UNRESOLVED");
  });
});

// ---------------------------------------------------------------------------
// 2 + 3 + 5. A flow-routed result answers to the SAME law (real flow execution).
// ---------------------------------------------------------------------------
const causalSynthesis = (leadingExplanation: string): string =>
  JSON.stringify({
    eventDefinition: "Crude oil settled higher this week",
    leadingExplanation,
    supportingReasons: ["supply disruption tightened the physical market"],
    competingExplanations: ["positioning unwind"],
    contradictions: [],
    causalStatus: "PLAUSIBLE_MECHANISM",
    confidence: "HIGH",
    uncertainty: ["inflation leg not established"],
    whatWouldChange: ["inflation data arriving opposite to the supply story"],
    citedObjectRefs: [],
  });

function oilCapability(capability: string, texts: readonly string[]): ProviderAdapter {
  return {
    providerId: `fake/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: [],
    freshnessProfile: "test:live",
    async execute(cap) {
      return {
        tool: `fake/${capability.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        outputs: texts.map((content) => ({
          outputClass: "QUANTITATIVE_OBSERVATION",
          content,
          about: "OIL",
        })),
      };
    },
  };
}

const FLOW2_PLAN = JSON.stringify({
  objective: OIL_TRANSMISSION,
  scopeIncluded: ["oil market", "rates"],
  scopeExcluded: [],
  tasks: [
    { type: "CAUSAL_INVESTIGATION", objective: "oil drivers", capabilities: ["NEWS_ANALYSIS"], completion: "c" },
  ],
  completionCriteria: ["drivers covered"],
  adaptationPolicy: "target gaps",
});

/** Crude + yields, but no inflation: the transmission arrow into inflation has no evidence. */
const OIL_YIELDS_ONLY = [
  "WTI crude oil settled 4% higher this week on supply disruption",
  "Crude oil supply disruption tightened the physical market",
  "Treasury yields rose 12 basis points this week as rate markets repriced policy",
  "The 10-year Treasury yield ended the week higher",
];

describe("a flow-routed causal result cannot bypass the boundary", () => {
  async function runCausalFlow(leadingExplanation: string) {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", FLOW2_PLAN],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow2.causal_synthesis", causalSynthesis(leadingExplanation)],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(oilCapability("NEWS_ANALYSIS", OIL_YIELDS_ONLY));
    const workspace = new Workspace();
    const result = await runFlow2(OIL_TRANSMISSION, {
      provider,
      registry,
      workspace,
      store: new MemoryStore(),
      asset: "CL=F",
      maxRounds: 1,
    });
    return result;
  }

  it("carries the same violation set the adaptive path would produce", async () => {
    const result = await runCausalFlow("Higher crude prices drove inflation higher this week.");
    const types = (result.outcome.contractViolations ?? []).map((v) => v.type);
    expect(types).toContain("CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE");
    // The unsupported claim is actually removed from the trader-visible answer.
    expect(result.response).not.toContain("drove inflation higher");
  });

  it("caps flow confidence by the weakest transmission link", async () => {
    const result = await runCausalFlow("Higher crude prices drove inflation higher this week.");
    expect(result.outcome.confidence?.level).toBe("LOW");
    expect(result.outcome.confidence?.weakestCausalLink?.target).toBe("INFLATION");
  });

  it("keeps EVIDENCE_SUFFICIENT blocked while a material transmission requirement is unresolved", async () => {
    const result = await runCausalFlow("Crude oil supply tightened this week.");
    expect(result.outcome.stoppedBecause).not.toBe("EVIDENCE_SUFFICIENT");
    // And the transmission link is visible to diagnostics, not silently dropped.
    expect(deriveCausalLinkStatuses(result.outcome.requirements).some((l) => l.target === "INFLATION")).toBe(true);
  });

  it("does not invent causal links for a flow whose question never asked for one", async () => {
    const provider = new FakeModelProvider(new Map([
      ["research.plan", JSON.stringify({
        objective: "What does all information say about BTC?",
        scopeIncluded: ["market data"],
        scopeExcluded: [],
        tasks: [{ type: "FACT_FINDING", objective: "BTC state", capabilities: ["NEWS_ANALYSIS"], completion: "c" }],
        completionCriteria: ["covered"],
        adaptationPolicy: "none",
      })],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["flow6.cross_domain_synthesis", JSON.stringify({
        overallPicture: "Bitcoin is consolidating",
        supportingSignals: ["structure improving"],
        opposingSignals: [],
        crossDomainRelationships: [],
        disagreements: [],
        missingInformation: [],
        confidence: "MODERATE",
        uncertainty: [],
        citedObjectRefs: [],
      })],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(oilCapability("NEWS_ANALYSIS", ["Bitcoin traded in a range this week"]));
    const workspace = new Workspace();
    const result = await runFlow6("What does all information say about BTC?", {
      provider,
      registry,
      workspace,
      store: new MemoryStore(),
      maxRounds: 1,
    });
    expect(deriveCausalLinkStatuses(result.outcome.requirements)).toEqual([]);
    expect((result.outcome.contractViolations ?? []).some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(false);
  });

  it("applies the boundary through the exported flow helper (the single call site every flow uses)", () => {
    const covered = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), NO_INFLATION_EVIDENCE, {
      subjectTerms: OIL_SUBJECT_TERMS,
      now: new Date(),
    });
    const outcome = {
      requirements: covered,
      evidence: NO_INFLATION_EVIDENCE.map((e) => ({ observation: e.text, subject: e.subject })),
      executions: [{ capability: "NEWS_ANALYSIS" }],
      stoppedBecause: "EVIDENCE_SUFFICIENT" as const,
      context: { currentResearchQuestion: OIL_TRANSMISSION },
    } as unknown as FlowOutcome;
    const result = validateFlowOutcome(
      { outcome, response: "Higher crude prices drove inflation higher this week." },
      { failedPaths: 0 },
    );
    expect(result.response).not.toContain("drove inflation higher");
    expect((result.outcome.contractViolations ?? []).map((v) => v.type)).toContain(
      "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE",
    );
    expect(result.outcome.stoppedBecause).toBe("REQUIREMENT_GAPS_UNRESOLVED");
  });
});
