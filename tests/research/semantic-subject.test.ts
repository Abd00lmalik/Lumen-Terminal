/**
 * SEMANTIC SUBJECT GATE (no-instrument ≠ no-subject) — deterministic tests.
 *
 * The live failure: "What macro conditions favor risk assets right now?" resolved no
 * instrument, so the subject gate was skipped entirely, 12/15 evidence items were crypto, a
 * Bitcoin derivatives/funding requirement appeared, and the crypto provider effectively
 * defined the research target. The verdict was honest; the RESEARCH was not.
 *
 * These tests pin the generic law: the question's own wording derives an abstract market
 * class, and evidence outside that class fails requirement matching NATURALLY (vocabulary
 * property of the evidence), without question-specific forbidden lists and without forbidding
 * crypto evidence when the question itself asks about crypto.
 */
import { describe, expect, it } from "vitest";
import {
  assessCoverage,
  buildRequirements,
  completeRequirements,
  coverageVerdict,
  matchRequirement,
  subjectMarketClassOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";

const MACRO_Q = "What macro conditions favor risk assets right now?";
const MACRO_BTC_Q = "What macro conditions favor Bitcoin right now?";
const MACRO_EM_Q = "What macro conditions favor emerging markets right now?";

function item(partial: Partial<CoverageEvidence> & { ref: string; text: string }): CoverageEvidence {
  return partial;
}

/** Abundant crypto output of the kind the crypto provider returned in the live failure. */
const ABUNDANT_CRYPTO: readonly CoverageEvidence[] = [
  item({ ref: "c1", text: "BTC trades at 84250 USD as Bitcoin ETF inflows accelerate", evidenceType: "CRYPTO_MARKET_DATA", freshness: "CURRENT" }),
  item({ ref: "c2", text: "Bitcoin funding rates turn positive as perp open interest builds", evidenceType: "DERIVATIVES_ANALYSIS", freshness: "CURRENT" }),
  item({ ref: "c3", text: "Crypto whales moved 12000 BTC to exchange wallets, onchain data shows", evidenceType: "ONCHAIN_ANALYSIS", freshness: "CURRENT" }),
  item({ ref: "c4", text: "Ethereum staking inflows hit a monthly record, DeFi TVL rises", evidenceType: "ONCHAIN_ANALYSIS", freshness: "CURRENT" }),
  item({ ref: "c5", text: "Solana DEX volume doubles as memecoin mania returns", evidenceType: "NEWS", freshness: "CURRENT" }),
];

/** Genuine macro observations matching the question's actual domain. */
const MACRO_EVIDENCE: readonly CoverageEvidence[] = [
  item({ ref: "m1", text: "The 10-year Treasury yield rose to 4.28 percent this week", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" }),
  item({ ref: "m2", text: "VIX fell to 13.9, the lowest implied volatility in months", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" }),
  item({ ref: "m3", text: "Core CPI printed 0.2 percent month over month, cooling inflation", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" }),
  item({ ref: "m4", text: "The dollar index eased as Fed rate-cut expectations firmed", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" }),
];

function ledgerOf(question: string): readonly ResearchRequirement[] {
  return completeRequirements(question, buildRequirements([]), {
    marketClass: subjectMarketClassOf(question),
  });
}

describe("abstract-target resolution (no-instrument ≠ no-subject)", () => {
  it("a broad macro question derives a MACRO semantic subject", () => {
    expect(subjectMarketClassOf(MACRO_Q)).toBe("MACRO");
  });

  it("no-instrument questions still receive a semantic subject from their wording", () => {
    // The class is derived from the question's own vocabulary, not a question list:
    // rates wording, dollar wording and commodity wording each resolve their own domain.
    expect(subjectMarketClassOf("What is pushing Treasury yields higher?")).toBe("RATES");
    expect(subjectMarketClassOf("What happened to the dollar this week?")).toBe("FX");
    expect(subjectMarketClassOf("What is moving copper prices?")).toBe("METAL");
    // A question that names no market at all stays UNKNOWN (no invented constraint).
    expect(subjectMarketClassOf("What are traders talking about?")).toBe("UNKNOWN");
  });

  it("a broad macro question does not derive BTC-specific requirements", () => {
    const ledger = ledgerOf(MACRO_Q);
    const descriptions = ledger.map((r) => `${r.description} ${r.evidenceClasses?.join(" ") ?? ""}`).join(" ");
    expect(descriptions.toLowerCase()).not.toContain("bitcoin");
    expect(descriptions.toLowerCase()).not.toContain("btc");
    expect(descriptions.toLowerCase()).not.toContain("funding");
    expect(descriptions.toLowerCase()).not.toContain("derivative");
  });

  it("a macro question that names Bitcoin DOES derive crypto-relevant requirements", () => {
    expect(subjectMarketClassOf(MACRO_BTC_Q)).toBe("CRYPTO");
    const ledger = ledgerOf(MACRO_BTC_Q);
    // The contract changed with the wording: crypto is now IN the question's domain.
    expect(ledger.some((r) => r.domains.includes("ONCHAIN") || r.domains.includes("DERIVATIVES") || r.evidenceClasses?.some((c) => ["DERIVATIVES", "ONCHAIN", "SENTIMENT"].includes(c)))).toBe(true);
  });

  it("a macro question naming emerging markets derives EM-relevant requirements", () => {
    const ledger = ledgerOf(MACRO_EM_Q);
    // EM exposure enters through the generic macro dimensions (dollar/liquidity, rates,
    // growth), not through a hardcoded EM branch.
    expect(ledger.some((r) => /dollar|liquidity|financial conditions/i.test(r.description))).toBe(true);
    expect(ledger.some((r) => /interest rate|yield|policy/i.test(r.description))).toBe(true);
  });
});

describe("foreign-domain evidence fails matching naturally", () => {
  it("abundant crypto evidence cannot satisfy a broad macro question's requirements", () => {
    const ledger = ledgerOf(MACRO_Q);
    const assessed = assessCoverage(ledger, ABUNDANT_CRYPTO, {
      questionMarketClass: subjectMarketClassOf(MACRO_Q),
      now: new Date("2026-09-23T12:00:00Z"),
    });
    for (const req of assessed) {
      expect(req.evidenceRefs, `${req.description} was satisfied by crypto evidence`).toEqual([]);
    }
    expect(coverageVerdict(assessed).complete).toBe(false);
  });

  it("genuine macro evidence still satisfies the same macro ledger", () => {
    const ledger = ledgerOf(MACRO_Q);
    const assessed = assessCoverage(ledger, MACRO_EVIDENCE, {
      questionMarketClass: subjectMarketClassOf(MACRO_Q),
      now: new Date("2026-09-23T12:00:00Z"),
    });
    const satisfied = assessed.filter((r) => r.evidenceRefs.length > 0);
    expect(satisfied.length).toBeGreaterThan(0);
    // Rates and volatility dimensions are covered by real macro data.
    expect(assessed.find((r) => /interest rate|yield|policy/i.test(r.description))?.status).toBe("SATISFIED");
    expect(assessed.find((r) => /volatility|risk appetite/i.test(r.description))?.status).toBe("SATISFIED");
  });

  it("the declared subject counts as vocabulary: a BTC payload tagged BTC is still foreign to macro", () => {
    const ledger = ledgerOf(MACRO_Q);
    const tagged = item({ ref: "t1", text: "Net inflows accelerated into US spot ETFs", evidenceType: "DERIVATIVES_ANALYSIS", subject: "BTC", freshness: "CURRENT" });
    const result = matchRequirement(ledger[0]!, tagged, { questionMarketClass: "MACRO" });
    expect(result).toBe("NO_MATCH");
  });

  it("matchRequirement enforces the gate directly (unit level)", () => {
    const ledger = ledgerOf(MACRO_Q);
    const ratesReq = ledger.find((r) => /interest rate|yield|policy/i.test(r.description))!;
    // Crypto evidence never satisfies the rates requirement under the MACRO class...
    expect(matchRequirement(ratesReq, ABUNDANT_CRYPTO[0]!, { questionMarketClass: "MACRO" })).toBe("NO_MATCH");
    // ...but a requirement that itself declares crypto classes is exempt...
    const cryptoReq: ResearchRequirement = { ...ratesReq, evidenceClasses: ["DERIVATIVES", "ONCHAIN"] };
    expect(matchRequirement(cryptoReq, ABUNDANT_CRYPTO[1]!, { questionMarketClass: "MACRO" })).toBe("SATISFIES");
    // ...and the gate only changes outcomes the vocabulary law would otherwise allow:
    // an inflation observation that merely mentions Bitcoin matches without the class...
    const mixedItem = item({ ref: "mx", text: "Bitcoin ETF inflows accelerated as inflation expectations eased", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" });
    const inflationReq = ledger.find((r) => /inflation/i.test(r.description))!;
    expect(matchRequirement(inflationReq, mixedItem, {})).not.toBe("NO_MATCH");
    // ...but is foreign to a MACRO-classed question (the item is ABOUT bitcoin, not macro).
    expect(matchRequirement(inflationReq, mixedItem, { questionMarketClass: "MACRO" })).toBe("NO_MATCH");
  });

  it("mixed evidence: crypto items are filtered, macro items still counted", () => {
    const ledger = ledgerOf(MACRO_Q);
    const assessed = assessCoverage(ledger, [...ABUNDANT_CRYPTO, ...MACRO_EVIDENCE], {
      questionMarketClass: "MACRO",
      now: new Date("2026-09-23T12:00:00Z"),
    });
    // No requirement is satisfied exclusively by crypto items.
    for (const req of assessed) {
      const fromCrypto = req.evidenceRefs.every((ref) => ABUNDANT_CRYPTO.some((c) => c.ref === ref));
      if (req.evidenceRefs.length > 0) expect(fromCrypto, req.id).toBe(false);
    }
  });

  it("the gate is a property of the evidence's vocabulary, not a provider list (genericity)", () => {
    // A DIFFERENT non-crypto domain (commodity question) also rejects the same crypto items
    // — proving there is no macro-specific rule anywhere.
    const ledger = completeRequirements("What is driving oil prices this week?", buildRequirements([]), {
      subject: "CL=F",
      marketClass: "COMMODITY",
    });
    const supplyReq = ledger.find((r) => /supply|producer/i.test(r.description));
    if (supplyReq === undefined) return; // class-scoped dimension absent
    expect(matchRequirement(supplyReq, ABUNDANT_CRYPTO[0]!, { questionMarketClass: "COMMODITY", subjectTerms: new Set(["OIL", "CRUDE", "CL"]) })).toBe("NO_MATCH");
  });
});
