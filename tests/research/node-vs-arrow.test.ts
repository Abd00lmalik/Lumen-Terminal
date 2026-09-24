/**
 * NODE vs ARROW — the causal invariant, tested as a law (research contract §3).
 *
 *     NODE  requirement: evidence about the market/domain may satisfy it.
 *     ARROW requirement: evidence must support the RELATIONSHIP itself.
 *
 *     ARROW coverage is NEVER inherited from either endpoint node.
 *
 * The defect this pins: an arrow requirement used to be attached to whichever ledger row already
 * owned the target dimension, so it inherited that row's coverage. A live oil run reported
 * OIL -> INFLATION as PARTIALLY_SUPPORTED with 26 inflation-regime references and ZERO evidence
 * about the oil-to-inflation relationship.
 *
 *   "oil prices rose" + "inflation was elevated"
 *     != "higher oil prices contributed to inflation"
 *
 * Every arrow is now its own first-class row (id, source, destination, relationship type, status,
 * evidence refs, blocking state) and admits only relationship evidence. Cases A–H below cover the
 * endpoints-only chains, genuinely relational evidence, the dedicated row, budget exhaustion, the
 * no-causal-question case, and an arbitrary unseen domain — with no domain-specific branches.
 */
import { describe, expect, it } from "vitest";
import {
  assessCoverage,
  capabilitiesForRequirement,
  completeRequirements,
  buildRequirements,
  coverageVerdict,
  exhaustUnresolved,
  isRelationshipEvidence,
  matchRequirement,
  subjectMarketClassOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";
import { deriveCausalLinkStatuses, weakestCausalLink } from "../../src/research/causal.js";
import { computeConfidence } from "../../src/research/confidence.js";
import { contractViolations } from "../../src/research/contract-checks.js";

const NOW = new Date("2026-09-24T12:00:00Z");

/** Build the engine's ledger for a question, exactly as the research loops do. */
function ledgerFor(question: string, subject: string): readonly ResearchRequirement[] {
  return completeRequirements(question, buildRequirements([]), {
    subject,
    marketClass: subjectMarketClassOf(question),
  });
}

function row(ledger: readonly ResearchRequirement[], target: string): ResearchRequirement {
  const found = ledger.find((r) => (r.targetTerms ?? []).includes(target));
  expect(found, `an ARROW row for ${target} must exist`).toBeDefined();
  return found!;
}

function item(ref: string, text: string, evidenceType = "NEWS"): CoverageEvidence {
  return { ref, text, evidenceType };
}

/** Endpoint (NODE) observations: valid, relevant to the market, and never about a relationship. */
function endpointPool(market: string, n: number, base: string): readonly CoverageEvidence[] {
  return Array.from({ length: n }, (_, i) => item(`ev_${market}_${i}`, `${base} ${i % 2 === 0 ? "rose" : "fell"} (${market})`));
}

const OIL_INFLATION = "What drove the move in crude oil and how did it transmit through inflation?";
const INFLATION_RATES = "How does inflation transmit into Treasury yields?";
const RATES_RISK = "How would a change in Treasury yields transmit into risk assets?";

describe("A. oil -> inflation: endpoint coverage is not transmission coverage", () => {
  const ledger = ledgerFor(OIL_INFLATION, "oil");
  const arrow = row(ledger, "INFLATION");

  it("is a first-class arrow row with source, destination and relationship type", () => {
    expect(arrow.relationshipSource).toBe("OIL");
    expect(arrow.targetTerms).toEqual(["INFLATION"]);
    expect(arrow.relationshipType).toBe("TRANSMISSION");
    expect(arrow.importance).toBe("CRITICAL");
    expect(arrow.role).toBe("CORE");
  });

  it("stays unresolved when BOTH endpoints are strongly covered", () => {
    const covered = assessCoverage(ledger, [
      ...endpointPool("oil", 8, "WTI crude oil settled higher on supply disruption"),
      ...endpointPool("cpi", 8, "Headline CPI inflation came in above expectations"),
    ], { subjectTerms: new Set(["OIL", "CRUDE", "WTI", "BRENT"]), now: NOW });
    const oilNode = covered.find((r) => /price movement|drivers behind/i.test(r.description)) ?? covered[0]!;
    expect(oilNode.status).toBe("SATISFIED"); // the node IS covered …
    const inflation = covered.find((r) => (r.targetTerms ?? []).includes("INFLATION"))!;
    expect(inflation.status).not.toBe("SATISFIED"); // … the arrow is NOT, and never inherits it
    expect(inflation.evidenceRefs).toEqual([]);
    expect(deriveCausalLinkStatuses(covered).find((l) => l.target === "INFLATION")!.status).toBe("NOT_RESEARCHED");
  });

  it("blocks completion while the arrow is unresolved", () => {
    const covered = assessCoverage(ledger, [
      ...endpointPool("oil", 8, "WTI crude oil settled higher on supply disruption"),
      ...endpointPool("cpi", 8, "Headline CPI inflation came in above expectations"),
    ], { subjectTerms: new Set(["OIL"]), now: NOW });
    expect(coverageVerdict(covered).complete).toBe(false);
    expect(coverageVerdict(covered).blocking.map((b) => b.id)).toContain(arrow.id);
  });
});

describe("B. inflation -> rates: the same law with no domain branch", () => {
  it("stays unresolved with inflation AND yield evidence but no relationship evidence", () => {
    const ledger = ledgerFor(INFLATION_RATES, "the subject");
    const arrow = row(ledger, "RATES");
    expect(arrow.relationshipSource).toBe("INFLATION");
    const covered = assessCoverage(ledger, [
      ...endpointPool("cpi", 6, "Inflation data showed price pressure"),
      ...endpointPool("tnx", 6, "The 10-year Treasury yield traded at 4.9 percent"),
    ], { now: NOW });
    const arrowAfter = covered.find((r) => (r.targetTerms ?? []).includes("RATES"))!;
    expect(arrowAfter.status).not.toBe("SATISFIED");
    expect(arrowAfter.evidenceRefs).toEqual([]);
  });
});

describe("C. rates -> risk assets: the same law again", () => {
  it("stays unresolved with yield AND equity evidence but no relationship evidence", () => {
    const ledger = ledgerFor(RATES_RISK, "Treasury yields");
    const arrow = row(ledger, "RISK_ASSETS");
    expect(arrow.relationshipSource).toBe("RATES");
    const covered = assessCoverage(ledger, [
      ...endpointPool("tnx", 6, "Treasury yields moved to 5.0 percent"),
      ...endpointPool("spx", 6, "The S&P 500 traded near 7,650 with risk assets mixed"),
    ], { now: NOW });
    const arrowAfter = covered.find((r) => (r.targetTerms ?? []).includes("RISK_ASSETS"))!;
    expect(arrowAfter.status).not.toBe("SATISFIED");
    expect(arrowAfter.evidenceRefs).toEqual([]);
  });
});

describe("D. direct transmission evidence establishes the arrow", () => {
  const ledger = ledgerFor(OIL_INFLATION, "oil");

  it("becomes PARTIALLY_SUPPORTED (or SUPPORTED) from relationship evidence", () => {
    const covered = assessCoverage(ledger, [
      endpointPool("oil", 3, "WTI crude oil settled higher")[0]!,
      item("ev_rel", "Crude oil supply costs passed through into headline inflation this week", "MACRO_ANALYSIS"),
    ], { subjectTerms: new Set(["OIL"]), now: NOW });
    const link = deriveCausalLinkStatuses(covered).find((l) => l.target === "INFLATION")!;
    expect(["SUPPORTED", "PARTIALLY_SUPPORTED"]).toContain(link.status);
    expect(link.evidenceRefs).toEqual(["ev_rel"]);
  });

  it("also accepts relationship evidence by declared class (provider lineage)", () => {
    // Names the link target (so the target gate passes) but states no relationship in its own
    // words: only the provider lineage (a cross-domain analysis capability) marks it relational.
    const covered = assessCoverage(ledger, [
      item("ev_cross", "Inflation: the energy component of the basket this week", "CROSS_DOMAIN_SYNTHESIS"),
    ], { subjectTerms: new Set(["OIL"]), now: NOW });
    const arrowAfter = covered.find((r) => (r.targetTerms ?? []).includes("INFLATION"))!;
    expect(arrowAfter.evidenceRefs).toEqual(["ev_cross"]);
  });

  it("rejects a node observation no matter how much vocabulary it shares", () => {
    const arrow = row(ledger, "INFLATION");
    expect(
      matchRequirement(arrow, item("ev_node", "Inflation rose this week", "MACRO_ANALYSIS"), { now: NOW }),
    ).toBe("NO_MATCH");
    expect(isRelationshipEvidence(item("ev_node", "Inflation rose this week"))).toBe(false);
    expect(isRelationshipEvidence(item("ev_rel", "Inflation rose as oil costs passed through"))).toBe(true);
  });
});

describe("D2. an arrow is researchable: it schedules a capability that can return relationship evidence", () => {
  it("maps the arrow to a relationship-capable capability (never a dead requirement)", () => {
    const ledger = ledgerFor(OIL_INFLATION, "oil");
    const arrow = row(ledger, "INFLATION");
    const available = new Set(["NEWS_ANALYSIS", "MACRO_ANALYSIS", "WEB_SEARCH", "CROSS_DOMAIN_SYNTHESIS", "FALSIFICATION"]);
    const caps = capabilitiesForRequirement(arrow, { isAvailable: (c) => available.has(c) });
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.some((c) => ["WEB_SEARCH", "CROSS_DOMAIN_SYNTHESIS", "NEWS_ANALYSIS", "MACRO_ANALYSIS"].includes(c))).toBe(true);
  });
});

describe("D3. the arrow's description states the LINK's own source, never the question's resolved instrument", () => {
  it("describes INFLATION -> RATES even when the instrument side resolved to Treasury yields", () => {
    // Live defect: the clause head names inflation, but the question's subject resolved to
    // "Treasury yields", and the arrow row described "the move in Treasury yields reached
    // Treasury yields" — sending retrieval after a transmission the question never asked for.
    const ledger = ledgerFor(INFLATION_RATES, "treasury yields");
    const arrow = row(ledger, "RATES");
    expect(arrow.relationshipSource).toBe("INFLATION");
    expect(arrow.description).toBe("transmission evidence for how the move in inflation reached Treasury yields and rate markets");
    expect(arrow.description).not.toContain("the move in Treasury yields reached");
    // The derived link and the row's wording must agree on both ends.
    const link = deriveCausalLinkStatuses(ledger).find((l) => l.target === "RATES")!;
    expect(link.source).toBe("INFLATION");
  });

  it("keeps subject-sourced arrows unchanged", () => {
    const ledger = ledgerFor(OIL_INFLATION, "oil");
    const arrow = row(ledger, "INFLATION");
    expect(arrow.relationshipSource).toBe("OIL");
    expect(arrow.description).toBe("transmission evidence for how the move in crude oil reached inflation");
  });
});

describe("E. evidence attaches to the arrow row, not to an endpoint node", () => {
  it("keeps the relationship observation on the arrow and endpoint observations on the nodes", () => {
    const ledger = ledgerFor(OIL_INFLATION, "oil");
    const covered = assessCoverage(ledger, [
      item("ev_oil", "WTI crude oil fell 4 percent this week", "MACRO_ANALYSIS"),
      item("ev_cpi", "Headline CPI inflation printed at 3.1 percent", "MACRO_ANALYSIS"),
      item("ev_rel", "Oil input costs passed through into consumer inflation this week", "MACRO_ANALYSIS"),
    ], { subjectTerms: new Set(["OIL"]), now: NOW });
    const arrow = covered.find((r) => (r.targetTerms ?? []).includes("INFLATION"))!;
    // The arrow's evidence is exactly the relationship observation — never an endpoint item.
    expect(arrow.evidenceRefs).toEqual(["ev_rel"]);
    expect(arrow.evidenceRefs).not.toContain("ev_oil");
    expect(arrow.evidenceRefs).not.toContain("ev_cpi");
    // And no dimension/node row can claim the arrow's target as its own link.
    for (const r of covered) {
      if (r.id === arrow.id) continue;
      expect(r.targetTerms ?? []).toEqual([]);
    }
  });
});

describe("F. budget exhaustion cannot upgrade an unresolved arrow", () => {
  const ledger = ledgerFor(OIL_INFLATION, "oil");

  it("stays EXHAUSTED and blocks even after every endpoint is covered", () => {
    // Bounded research spent, no relationship evidence found: the arrow is terminal.
    const exhausted = exhaustUnresolved(ledger, ["CROSS_DOMAIN_SYNTHESIS", "WEB_SEARCH"]);
    const arrow = exhausted.find((r) => (r.targetTerms ?? []).includes("INFLATION"))!;
    expect(arrow.status).toBe("EXHAUSTED");
    expect(arrow.missingReason).toContain("no relevant evidence");
    // A later assessment with abundant ENDPOINT evidence must not resurrect it.
    const reassessed = assessCoverage(exhausted, [
      ...endpointPool("oil", 5, "WTI crude oil settled higher"),
      ...endpointPool("cpi", 5, "Headline CPI inflation came in above expectations"),
    ], { subjectTerms: new Set(["OIL"]), now: NOW });
    const arrowAfter = reassessed.find((r) => (r.targetTerms ?? []).includes("INFLATION"))!;
    expect(arrowAfter.status).toBe("EXHAUSTED");
    expect(arrowAfter.evidenceRefs).toEqual([]);
    expect(deriveCausalLinkStatuses(reassessed).find((l) => l.target === "INFLATION")!.status).toBe("UNRESOLVED");
    // The unfinished arrow caps confidence and keeps the gate honest.
    expect(computeConfidence({ requirements: reassessed, stoppedBecause: "TIME_BUDGET_EXHAUSTED", failedPaths: 0 }).level).toBe("LOW");
    expect(weakestCausalLink(deriveCausalLinkStatuses(reassessed))!.target).toBe("INFLATION");
  });

  it("a failing consumer of the chain cannot assert the relationship", () => {
    const exhausted = exhaustUnresolved(ledger, ["CROSS_DOMAIN_SYNTHESIS"]);
    const state = {
      ledger: exhausted,
      evidenceText: "WTI crude oil settled higher weekly. Headline CPI inflation came in above expectations.",
      executedCapabilities: ["MACRO_ANALYSIS"] as readonly string[],
    };
    const asserted = contractViolations("Crude oil prices drove inflation higher this week.", state);
    expect(asserted.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(true);
    const hedged = contractViolations("Crude oil prices may have contributed to inflation this week.", state);
    expect(hedged.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(false);
  });
});

describe("G. a non-causal question derives no arrows", () => {
  for (const question of [
    "What happened to Bitcoin this week?",
    "What is the current price of gold?",
    "Evaluate NVDA according to my framework.",
  ]) {
    it(`derives no synthetic causal arrows: ${question}`, () => {
      const ledger = ledgerFor(question, "the subject");
      for (const r of ledger) expect(r.targetTerms ?? []).toEqual([]);
      expect(deriveCausalLinkStatuses(ledger)).toEqual([]);
      // No arrow => no causal ceiling: an ordinary coverage verdict decides completion.
      const covered = assessCoverage(ledger, [item("ev_any", "The subject traded and news flow continued")], { now: NOW });
      expect(deriveCausalLinkStatuses(covered)).toEqual([]);
      expect(computeConfidence({ requirements: covered, stoppedBecause: "EVIDENCE_SUFFICIENT", failedPaths: 0 }).weakestCausalLink).toBeUndefined();
    });
  }
});

describe("H. an arbitrary unseen domain obeys the same node/arrow semantics", () => {
  const GOLD_SILVER = "How does gold transmit into silver prices?";

  it("derives the arrow from the question's own wording", () => {
    const ledger = ledgerFor(GOLD_SILVER, "gold");
    const arrow = row(ledger, "SILVER");
    expect(arrow.relationshipSource).toBe("GOLD");
  });

  it("endpoint coverage does not establish it; relationship evidence does", () => {
    const ledger = ledgerFor(GOLD_SILVER, "gold");
    const endpoints = assessCoverage(ledger, [
      ...endpointPool("gold", 4, "Gold traded higher"),
      ...endpointPool("silver", 4, "Silver traded higher"),
    ], { now: NOW });
    expect(endpoints.find((r) => (r.targetTerms ?? []).includes("SILVER"))!.evidenceRefs).toEqual([]);
    const relational = assessCoverage(ledger, [
      item("ev_rel", "Gold's safe-haven bid spilled over into silver, lifting both metals", "CROSS_DOMAIN_SYNTHESIS"),
    ], { now: NOW });
    const arrow = relational.find((r) => (r.targetTerms ?? []).includes("SILVER"))!;
    expect(arrow.evidenceRefs).toEqual(["ev_rel"]);
    expect(deriveCausalLinkStatuses(relational).find((l) => l.target === "SILVER")!.source).toBe("GOLD");
  });
});
