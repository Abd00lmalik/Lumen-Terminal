/**
 * TRANSMISSION / CAUSAL-LINK LAWS (research contract §3, §8).
 *
 * The failing product behaviour: a question that asks "how did the move in oil transmit through
 * inflation, yields and risk assets" answered a fluent story about oil, yields and equities —
 * with no inflation evidence — and still called itself HIGH confidence. Evidence for the NODES
 * of a chain is not evidence for the ARROWS.
 *
 * These tests pin the generic laws that fix it, using ONLY the question's own wording:
 *   - the named targets become required dimensions and declared links (no question list);
 *   - every arrow is its OWN row and admits only RELATIONSHIP evidence about a target the
 *     question explicitly named: endpoint coverage is never transmission coverage;
 *   - the subject gate admits evidence about a target the question explicitly named, and only
 *     that (a link target is not a licence for unrelated evidence);
 *   - each link's status is derived from the ledger, and the weakest link binds the judgment;
 *   - assertive causal prose over an unresearched link is a contract violation;
 *   - confidence is capped by the weakest link;
 *   - a question with no transmission wording gains no links and no causal constraint.
 */
import { describe, expect, it } from "vitest";
import {
  asksForAlternatives,
  asksWhatToWatchNext,
  assessCoverage,
  buildRequirements,
  causalLinksOf,
  completeRequirements,
  coverageVerdict,
  matchRequirement,
  subjectMarketClassOf,
  transmissionTargetsOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";
import { deriveCausalLinkStatuses, weakestCausalLink } from "../../src/research/causal.js";
import { computeConfidence } from "../../src/research/confidence.js";
import { contractViolations } from "../../src/research/contract-checks.js";

/** The diagnostic question from the mandate — the product's actual failure case. */
const OIL_TRANSMISSION =
  "What drove the move in crude oil this week, how did those drivers transmit through inflation, Treasury yields and broader risk assets and what should a trader watch next if this macro regime persists";

const OIL_SUBJECT_TERMS = new Set(["OIL", "CRUDE", "WTI", "BRENT", "PETROLEUM"]);

function ledgerOf(question: string, subject: string): readonly ResearchRequirement[] {
  return completeRequirements(question, buildRequirements([]), {
    subject,
    marketClass: subjectMarketClassOf(question),
  });
}

function item(partial: Partial<CoverageEvidence> & { ref: string; text: string }): CoverageEvidence {
  return partial;
}

/**
 * ENDPOINT (NODE) evidence only: oil, yields and risk assets are all well observed, and
transmission is nowhere stated. "Oil prices rose", "Treasury yields rose" and "risk assets fell"
 * are nodes — none of them establishes an arrow. Under the node/arrow law this pool must leave
 * EVERY arrow unresolved, however strong the endpoint coverage looks.
 */
const NO_INFLATION_EVIDENCE: readonly CoverageEvidence[] = [
  item({
    ref: "ev_oil", text: "WTI crude oil settled 4% higher this week on supply disruption",
    sourceProvider: "commodity-market-data", sourceType: "PRIMARY",
  }),
  item({
    ref: "ev_oil_news", text: "Crude oil supply disruption tightened the physical market this week",
    sourceProvider: "energy-news", sourceType: "SECONDARY",
  }),
  item({
    ref: "ev_yields", text: "Treasury yields rose 12 basis points this week as rate markets repriced policy",
    sourceProvider: "market-regime", sourceType: "PRIMARY",
  }),
  item({
    ref: "ev_yields2", text: "The 10-year Treasury yield ended the week higher, a rate-market repricing",
    sourceProvider: "rates-provider", sourceType: "SECONDARY",
  }),
  item({
    ref: "ev_risk", text: "The S&P 500 fell 1.2% this week as broader risk assets weakened",
    sourceProvider: "equity-market-data", sourceType: "PRIMARY",
  }),
  item({
    ref: "ev_risk2", text: "The Nasdaq also declined, with risk assets broadly lower",
    sourceProvider: "index-provider", sourceType: "SECONDARY",
  }),
];

describe("transmission targets are read from the question's own causal wording", () => {
  it("derives every market the transmission clause points into", () => {
    expect(transmissionTargetsOf(OIL_TRANSMISSION)).toEqual(
      expect.arrayContaining(["INFLATION", "RATES", "RISK_ASSETS"]),
    );
    expect(transmissionTargetsOf("How could higher oil prices affect emerging markets?")).toContain(
      "EMERGING_MARKETS",
    );
  });

  it("derives no targets for a question with no transmission wording (no false causality)", () => {
    expect(transmissionTargetsOf("What is happening with BTC?")).toEqual([]);
    expect(transmissionTargetsOf("What could affect gold this week?")).toEqual([]);
  });

  it("parses the driver side of each link from the clause grammar", () => {
    const links = causalLinksOf("How could higher oil prices affect emerging markets?", "oil");
    expect(links).toEqual([{ source: "OIL", target: "EMERGING_MARKETS" }]);
  });
});

describe("every named link is a required dimension of the ledger", () => {
  const ledger = ledgerOf(OIL_TRANSMISSION, "oil");

  it("carries one link per target, whether as its own row or attached to the dimension row", () => {
    const linked = ledger.flatMap((r) => [
      ...(r.targetTerms ?? []),
      ...(r.transmissionTargets ?? []),
    ]);
    expect(new Set(linked)).toEqual(new Set(["INFLATION", "RATES", "RISK_ASSETS"]));
  });

  it("does not duplicate a dimension the ledger already required (one row per dimension)", () => {
    const inflationRows = ledger.filter((r) =>
      [...(r.targetTerms ?? []), ...(r.transmissionTargets ?? [])].includes("INFLATION"),
    );
    expect(inflationRows).toHaveLength(1);
    // The inflation dimension is CORE/CRITICAL whichever row carries the arrow.
    expect(inflationRows[0]!.importance).toBe("CRITICAL");
    expect(inflationRows[0]!.role).toBe("CORE");
  });

  it("represents material alternative explanations for a transmission question", () => {
    expect(ledger.some((r) => /alternativ\w* explanation/i.test(r.description))).toBe(true);
    // Not a decision dimension unless the question asks whether the explanation could differ.
    expect(ledger.some((r) => /alternativ\w* explanation/i.test(r.description) && r.importance === "CRITICAL")).toBe(false);
  });

  it("makes an asked-for alternatives question a CORE dimension", () => {
    expect(asksForAlternatives("What else could explain the move in yields?")).toBe(true);
    const asked = ledgerOf("What drove oil this week and how did it transmit into yields, or what else could explain the move?", "oil");
    expect(
      asked.some((r) => /alternativ\w*/i.test(r.description) && r.role === "CORE" && r.importance === "CRITICAL"),
    ).toBe(true);
  });
});

describe("the subject gate is exactly as wide as the question's own wording", () => {
  const ledger = ledgerOf(OIL_TRANSMISSION, "oil");
  const riskLink = ledger.find((r) => (r.targetTerms ?? []).includes("RISK_ASSETS"))!;
  const growthDimension = ledger.find((r) => /growth regime/i.test(r.description))!;

  it("admits RELATIONSHIP evidence about a target the question explicitly named", () => {
    const relational = item({
      ref: "ev_rel", text: "Treasury yields rose, weighing on the S&P 500 as risk assets weakened",
      evidenceType: "OBSERVATION",
    });
    expect(
      matchRequirement(riskLink, relational, { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() }),
    ).toBe("SATISFIES");
  });

  it("does NOT admit an endpoint observation about the same target (node != arrow)", () => {
    const endpoint = item({
      ref: "ev_risk", text: "The S&P 500 fell this week as risk assets weakened",
      evidenceType: "OBSERVATION",
    });
    expect(
      matchRequirement(riskLink, endpoint, { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() }),
    ).toBe("NO_MATCH");
  });

  it("does not let a link target exempt an unrelated dimension", () => {
    const riskItem = item({
      ref: "ev_risk", text: "The S&P 500 fell this week as risk assets weakened",
      evidenceType: "OBSERVATION",
    });
    expect(
      matchRequirement(growthDimension, riskItem, { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() }),
    ).toBe("NO_MATCH");
  });

  it("keeps gating evidence that names neither the subject nor a named target", () => {
    const btcItem = item({ ref: "ev_btc", text: "Bitcoin rose 5% as ETF inflows accelerated" });
    expect(
      matchRequirement(riskLink, btcItem, { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() }),
    ).toBe("NO_MATCH");
  });
});

describe("link status is derived from the ledger, not from the prose", () => {
  const covered = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), NO_INFLATION_EVIDENCE, {
    subjectTerms: OIL_SUBJECT_TERMS,
    now: new Date(),
  });
  const links = deriveCausalLinkStatuses(covered);

  it("reports the unresearched arrow as unresearched even though its nodes have evidence", () => {
    const inflation = links.find((l) => l.target === "INFLATION")!;
    expect(inflation.status).toBe("NOT_RESEARCHED");
    expect(inflation.evidenceRefs).toEqual([]);
  });

  it("leaves EVERY arrow unresolved when only endpoint evidence exists", () => {
    for (const link of links) {
      expect(["UNRESOLVED", "NOT_RESEARCHED", "STALE_ONLY"]).toContain(link.status);
      expect(link.evidenceRefs).toEqual([]);
    }
  });

  it("supports an arrow only once relationship evidence exists — and not its neighbours", () => {
    const withRatesRelation = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), [
      ...NO_INFLATION_EVIDENCE,
      item({
        ref: "ev_rates_rel", text: "Oil-driven input costs pushed Treasury yields higher this week",
        sourceProvider: "macro-news", sourceType: "SECONDARY",
      }),
    ], { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() });
    const derived = deriveCausalLinkStatuses(withRatesRelation);
    const rates = derived.find((l) => l.target === "RATES")!;
    expect(["SUPPORTED", "PARTIALLY_SUPPORTED"]).toContain(rates.status);
    expect(rates.evidenceRefs).toContain("ev_rates_rel");
    // The inflation arrow still has endpoint evidence galore and still no relationship evidence.
    const inflation = derived.find((l) => l.target === "INFLATION")!;
    expect(inflation.evidenceRefs).toEqual([]);
    expect(["UNRESOLVED", "NOT_RESEARCHED", "STALE_ONLY"]).toContain(inflation.status);
  });

  it("binds the judgment to the weakest material link", () => {
    expect(weakestCausalLink(links)!.target).toBe("INFLATION");
  });

  it("distinguishes link statuses when evidence arrives for the missing leg", () => {
    const withInflation = assessCoverage(
      covered,
      [
        ...NO_INFLATION_EVIDENCE,
        item({
          ref: "ev_cpi", text: "Inflation accelerated: CPI came in above expectations",
          sourceProvider: "macro-data", sourceType: "PRIMARY",
        }),
        item({
          ref: "ev_cpi2", text: "Inflation expectations rose, lifting the inflation impulse from energy costs",
          sourceProvider: "macro-news", sourceType: "SECONDARY",
        }),
      ],
      { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() },
    );
    const inflation = deriveCausalLinkStatuses(withInflation).find((l) => l.target === "INFLATION")!;
    expect(inflation.status).not.toBe("NOT_RESEARCHED");
    expect(inflation.evidenceRefs.length).toBeGreaterThan(0);
  });
});

describe("assertive causal language requires link evidence", () => {
  const covered = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), NO_INFLATION_EVIDENCE, {
    subjectTerms: OIL_SUBJECT_TERMS,
    now: new Date(),
  });
  const state = {
    ledger: covered.map((r) => ({
      description: r.description, importance: r.importance, status: r.status,
      timeSensitivity: r.timeSensitivity,
      ...(r.relationshipType !== undefined ? { relationshipType: r.relationshipType } : {}),
      ...(r.targetTerms !== undefined ? { targetTerms: r.targetTerms } : {}),
      ...(r.transmissionTargets !== undefined ? { transmissionTargets: r.transmissionTargets } : {}),
      ...(r.evidenceQuality !== undefined ? { evidenceQuality: r.evidenceQuality } : {}),
      ...(r.sourceDiversity !== undefined ? { sourceDiversity: r.sourceDiversity } : {}),
    })),
    evidenceText: NO_INFLATION_EVIDENCE.map((e) => e.text).join(" "),
    executedCapabilities: [] as readonly string[],
  };

  it("rejects an asserted transmission through an unresearched link", () => {
    const violations = contractViolations(
      "Higher crude prices drove inflation higher this week.",
      state,
    );
    expect(violations.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(true);
  });

  it("accepts hedged language, because interpretation is allowed", () => {
    const violations = contractViolations(
      "Higher crude prices may have contributed to inflation this week.",
      state,
    );
    expect(violations.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(false);
  });

  it("does not flag an assertion about a link whose RELATIONSHIP evidence exists", () => {
    const covered = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), [
      ...NO_INFLATION_EVIDENCE,
      item({
        ref: "ev_rates_rel", text: "Oil-driven input costs pushed Treasury yields higher this week",
        sourceProvider: "macro-news", sourceType: "SECONDARY",
      }),
    ], { subjectTerms: OIL_SUBJECT_TERMS, now: new Date() });
    const violations = contractViolations(
      "Higher crude prices pushed Treasury yields higher this week.",
      { ...state, ledger: covered.map((r) => ({
        description: r.description, importance: r.importance, status: r.status,
        timeSensitivity: r.timeSensitivity,
        ...(r.relationshipType !== undefined ? { relationshipType: r.relationshipType } : {}),
        ...(r.targetTerms !== undefined ? { targetTerms: r.targetTerms } : {}),
        ...(r.evidenceQuality !== undefined ? { evidenceQuality: r.evidenceQuality } : {}),
        ...(r.sourceDiversity !== undefined ? { sourceDiversity: r.sourceDiversity } : {}),
      })) },
    );
    expect(violations.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(false);
  });

  it("flags the same assertion when only the endpoints are observed", () => {
    const violations = contractViolations(
      "Higher crude prices pushed Treasury yields higher this week.",
      state,
    );
    expect(violations.some((v) => v.type === "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE")).toBe(true);
  });
});

describe("confidence is capped by the weakest link", () => {
  const covered = assessCoverage(ledgerOf(OIL_TRANSMISSION, "oil"), NO_INFLATION_EVIDENCE, {
    subjectTerms: OIL_SUBJECT_TERMS,
    now: new Date(),
  });

  it("cannot read high with an unresearched transmission leg", () => {
    const confidence = computeConfidence({ requirements: covered, stoppedBecause: "EVIDENCE_SUFFICIENT", failedPaths: 0 });
    expect(confidence.level).toBe("LOW");
    expect(confidence.weakestCausalLink?.target).toBe("INFLATION");
  });

  it("reports no causal constraint for a question that asked for none", () => {
    const goldLedger = ledgerOf("What could affect gold this week?", "gold");
    expect(deriveCausalLinkStatuses(goldLedger)).toEqual([]);
    const confidence = computeConfidence({ requirements: goldLedger, stoppedBecause: "MODEL_INSUFFICIENT_EVIDENCE", failedPaths: 0 });
    expect(confidence.weakestCausalLink).toBeUndefined();
  });
});

describe("watch-next is a research requirement, not presentation metadata", () => {
  it("detects the question that asks what to watch next", () => {
    expect(asksWhatToWatchNext(OIL_TRANSMISSION)).toBe(true);
    expect(asksWhatToWatchNext("What is driving oil prices this week?")).toBe(false);
  });

  it("creates a CORE forward-looking dimension carrying the question's own wording", () => {
    const ledger = ledgerOf(OIL_TRANSMISSION, "oil");
    const watch = ledger.find((r) => /watch next/i.test(r.description))!;
    expect(watch.role).toBe("CORE");
    expect(watch.importance).toBe("CRITICAL");
    expect(watch.relationshipType).toBe("IMPLICATION");
  });
});

describe("negative contamination: a large evidence pool is not coverage", () => {
  const macroQuestion = "What macro conditions favor risk assets right now?";
  const macroLedger = ledgerOf(macroQuestion, "the market");

  it("derives no subject and no transmission links for a broad macro question", () => {
    expect(transmissionTargetsOf(macroQuestion)).toEqual([]);
  });

  it("does not let abundant crypto evidence satisfy macro requirements", () => {
    const cryptoEvidence: readonly CoverageEvidence[] = Array.from({ length: 12 }, (_, i) =>
      item({
        ref: `ev_btc_${i}`,
        text: `Bitcoin ${i % 2 === 0 ? "rose" : "fell"} as ETF flows and on-chain activity shifted`,
        sourceProvider: "crypto-news",
        sourceType: "SECONDARY",
      }),
    );
    const covered = assessCoverage(macroLedger, cryptoEvidence, {
      subjectTerms: new Set(["MARKET", "MACRO"]),
      now: new Date(),
    });
    const satisfied = covered.filter((r) => r.status === "SATISFIED");
    expect(satisfied).toHaveLength(0);
    expect(coverageVerdict(covered).complete).toBe(false);
  });

  it("does not let current-only evidence satisfy a historical comparison", () => {
    const historical = completeRequirements(
      "Has this Bitcoin setup happened before?",
      buildRequirements([]),
      { subject: "BTC", marketClass: "CRYPTO" },
    );
    const currentOnly: readonly CoverageEvidence[] = [
      item({ ref: "ev_now", text: "Bitcoin is trading higher today on strong ETF inflows", sourceProvider: "crypto-news" }),
    ];
    const covered = assessCoverage(historical, currentOnly, {
      subjectTerms: new Set(["BTC", "BITCOIN"]),
      now: new Date(),
    });
    expect(coverageVerdict(covered).complete).toBe(false);
  });
});
