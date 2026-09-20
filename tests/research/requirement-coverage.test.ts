/**
 * Requirement-coverage engine tests (research-engine core); deterministic, no network.
 *
 * Laws under test:
 * - FRESHNESS: a CURRENT requirement is never satisfied by STALE/HISTORICAL-tagged or
 *   age-expired observations (the live "annual World Bank CPI answered a right-now macro
 *   question" failure); a HISTORICAL requirement is never satisfied by today's live quote.
 * - TARGET RELEVANCE: evidence about another subject cannot satisfy a requirement (crypto
 *   observations never satisfy an oil price-movement requirement).
 * - COVERAGE: statuses derive from actual matches; CRITICAL gaps block completion.
 * - CAPABILITY MATCHING: gaps map to capability declarations (domains/dataTypes/freshness),
 *   ranked with registry availability, excluding already-tried capabilities. Nothing here
 *   knows about a specific question.
 * - CATALOG CONFORMANCE: every planner capability declares support and vice versa.
 * - GENERALIZATION: unseen questions derive requirements that match registered capabilities
 *   without any question-specific code.
 */
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_SUPPORT, assessCoverage, buildRequirements, capabilitiesForRequirement, coverageVerdict,
  exhaustUnresolved, matchRequirement, recoveryCapabilities, renderCoverage, requirementsFromTasks,
  type CoverageEvidence,
} from "../../src/research/requirements.js";
import { subjectTermsOf } from "../../src/domain/instruments.js";
import { PLANNER_CAPABILITIES } from "../../src/research/adaptive.js";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function item(partial: Partial<CoverageEvidence> & { ref: string; text: string }): CoverageEvidence {
  return { evidenceType: "NEWS_ANALYSIS", freshness: "CURRENT", ...partial };
}

describe("requirement construction", () => {
  it("derives domains and freshness from the requirement text", () => {
    const [oil, macro, hist, price] = buildRequirements([
      { description: "current oil price movement this week" },
      { description: "current policy and rates regime" },
      { description: "how similar setups resolved historically" },
      { description: "latest quote" },
    ]);
    expect(oil?.domains).toEqual(expect.arrayContaining(["PRICE_MARKET"]));
    expect(oil?.timeSensitivity).toBe("CURRENT");
    expect(macro?.domains).toContain("MACRO");
    expect(macro?.timeSensitivity).toBe("CURRENT");
    expect(hist?.domains).toContain("HISTORICAL");
    expect(hist?.timeSensitivity).toBe("HISTORICAL");
    expect(price?.domains).toContain("PRICE_MARKET");
  });

  it("falls back to task-derived requirements when the planner declares none", () => {
    const reqs = requirementsFromTasks([{ objective: "gather oil-specific supply and demand developments", capabilities: ["NEWS_ANALYSIS"] }]);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.domains).toEqual(expect.arrayContaining(["NEWS"]));
  });
});

describe("freshness law (stale never satisfies current)", () => {
  const requirement = buildRequirements([{ description: "current inflation and rates regime", timeSensitivity: "CURRENT" }])[0]!;

  it("a STALE/HISTORICAL-tagged observation cannot satisfy a CURRENT requirement", () => {
    expect(matchRequirement(requirement, item({ ref: "ev_1", text: "US CPI inflation 2.9 percent (annual series)", evidenceType: "MACRO_ANALYSIS", freshness: "STALE" }), { now: NOW })).toBe("STALE_ONLY");
    expect(matchRequirement(requirement, item({ ref: "ev_2", text: "US CPI inflation 2.9 percent", evidenceType: "MACRO_ANALYSIS", freshness: "HISTORICAL" }), { now: NOW })).toBe("STALE_ONLY");
  });

  it("an age-expired observation cannot satisfy a CURRENT requirement", () => {
    const old = item({ ref: "ev_3", text: "US CPI inflation 3.1 percent", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT", observedAt: "2026-01-05T00:00:00.000Z" });
    expect(matchRequirement(requirement, old, { now: NOW })).toBe("STALE_ONLY");
  });

  it("a current market observation satisfies it", () => {
    const live = item({ ref: "ev_4", text: "10-year Treasury yield 4.21 percent", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT", observedAt: "2026-09-19T20:00:00.000Z" });
    expect(matchRequirement(requirement, live, { now: NOW })).toBe("SATISFIES");
  });

  it("the mirror law: a live quote cannot satisfy a HISTORICAL requirement", () => {
    const hist = buildRequirements([{ description: "how similar setups resolved historically", timeSensitivity: "HISTORICAL" }])[0]!;
    const liveQuote = item({ ref: "ev_5", text: "BTC price 118000 USDT today", evidenceType: "MARKET_DATA_ANALYSIS", freshness: "CURRENT", observedAt: "2026-09-19T20:00:00.000Z" });
    expect(matchRequirement(hist, liveQuote, { now: NOW })).toBe("NO_MATCH"); // a live quote is not historical material
    const historical = item({ ref: "ev_6", text: "BTC episodes: 2024-03 breakout followed by 12 percent drawdown", evidenceType: "HISTORICAL_COMPARISON", freshness: "HISTORICAL" });
    expect(matchRequirement(hist, historical, { now: NOW })).toBe("SATISFIES");
  });
});

describe("target relevance law", () => {
  it("crypto evidence cannot satisfy an oil price-movement requirement", () => {
    const oil = buildRequirements([{ description: "current oil price movement this week" }])[0]!;
    const btc = item({ ref: "ev_7", text: "BTC ETF inflows hit a record as crypto markets rally", evidenceType: "NEWS_ANALYSIS" });
    const terms = subjectTermsOf("What is driving oil prices this week?")!;
    expect(matchRequirement(oil, btc, { subjectTerms: terms, now: NOW })).toBe("NO_MATCH");
  });

  it("evidence about the subject satisfies it", () => {
    const oil = buildRequirements([{ description: "current oil price movement this week" }])[0]!;
    const opec = item({ ref: "ev_8", text: "Oil slides as OPEC+ boosts output; crude inventories draw", evidenceType: "NEWS_ANALYSIS" });
    const terms = subjectTermsOf("What is driving oil prices this week?")!;
    expect(matchRequirement(oil, opec, { subjectTerms: terms, now: NOW })).toBe("SATISFIES");
  });
});

describe("coverage assessment + completion verdict", () => {
  it("marks satisfied/stale-only/pending and blocks on critical gaps", () => {
    const reqs = buildRequirements([
      { description: "current regime rates and yields" },
      { description: "current volatility and dollar conditions" },
      { description: "current inflation readings" },
    ]);
    const items: CoverageEvidence[] = [
      item({ ref: "ev_10", text: "10-year Treasury yield 4.21 percent; 13-week bill 3.9 percent", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" }),
      item({ ref: "ev_11", text: "VIX 18.4; US dollar index 101.2", evidenceType: "MACRO_ANALYSIS", freshness: "CURRENT" }),
      item({ ref: "ev_12", text: "US CPI annual series 2.9 percent", evidenceType: "MACRO_ANALYSIS", freshness: "STALE" }),
    ];
    const assessed = assessCoverage(reqs, items, { now: NOW });
    expect(assessed[0]?.status).toBe("SATISFIED");
    expect(assessed[1]?.status).toBe("SATISFIED");
    expect(assessed[2]?.status).toBe("PARTIALLY_SATISFIED"); // stale only
    const verdict = coverageVerdict(assessed);
    expect(verdict.complete).toBe(false);
    expect(verdict.blocking.map((b) => b.description)).toEqual(["current inflation readings"]);
  });

  it("renderCoverage states stale-only and blocking explicitly", () => {
    const reqs = assessCoverage(
      buildRequirements([{ description: "current inflation readings" }]),
      [item({ ref: "ev_13", text: "US CPI annual 2.9 percent", evidenceType: "MACRO_ANALYSIS", freshness: "STALE" })],
      { now: NOW },
    );
    const text = renderCoverage(reqs);
    expect(text).toContain("STALE ONLY");
    expect(text).toContain("UNCOVERED");
  });
});

describe("capability matching (declarations, not question routes)", () => {
  it("every planner capability declares support, and every declaration is a planner capability", () => {
    for (const cap of PLANNER_CAPABILITIES) expect(CAPABILITY_SUPPORT[cap]).toBeDefined();
    for (const cap of Object.keys(CAPABILITY_SUPPORT)) expect(PLANNER_CAPABILITIES).toContain(cap);
  });

  it("selects capabilities by declared domain + freshness, never by question identity", () => {
    const macroReq = buildRequirements([{ description: "current policy and rates regime" }])[0]!;
    const caps = capabilitiesForRequirement(macroReq, { isAvailable: () => true });
    expect(caps[0]).toBe("MACRO_ANALYSIS");
    expect(caps).toContain("EQUITY_MARKET_DATA"); // declared MACRO + yield/volatility/USD support

    const historicalReq = buildRequirements([{ description: "how similar setups resolved historically", timeSensitivity: "HISTORICAL" }])[0]!;
    const histCaps = capabilitiesForRequirement(historicalReq);
    expect(histCaps).toContain("HISTORICAL_COMPARISON");
    expect(histCaps).not.toContain("OPTIONS_CHAIN_ANALYSIS"); // current-only capability cannot serve HISTORICAL
  });

  it("excludes already-attempted capabilities and respects availability", () => {
    const reqs = buildRequirements([{ description: "current oil price movement" }]);
    const blocking = coverageVerdict(reqs).blocking;
    const first = recoveryCapabilities(blocking, { isAvailable: () => true });
    expect(first.length).toBeGreaterThan(0);
    const again = recoveryCapabilities(blocking, { isAvailable: () => true, exclude: first });
    for (const cap of first) expect(again).not.toContain(cap);
  });

  it("exhaustion records an honest per-requirement reason", () => {
    const stale = assessCoverage(
      buildRequirements([{ description: "current inflation readings" }]),
      [item({ ref: "ev_14", text: "US CPI annual 2.9 percent", evidenceType: "MACRO_ANALYSIS", freshness: "STALE" })],
      { now: NOW },
    );
    const exhausted = exhaustUnresolved(stale, ["MACRO_ANALYSIS"]);
    expect(exhausted[0]?.status).toBe("EXHAUSTED");
    expect(exhausted[0]?.missingReason).toContain("stale evidence");
    expect(exhausted[0]?.missingReason).toContain("MACRO_ANALYSIS");
  });
});

describe("generalization: unseen questions need no new code", () => {
  const unseen: readonly { readonly question: string; readonly taskText: string }[] = [
    { question: "What is driving copper prices this week?", taskText: "gather current copper price movement and supply demand developments" },
    { question: "Why has gold outperformed silver recently?", taskText: "compare current gold and silver price performance and macro drivers" },
    { question: "What could pressure semiconductor stocks this quarter?", taskText: "gather sector fundamentals, earnings expectations and macro rate conditions for semiconductor equities" },
    { question: "How is the current USD environment affecting emerging-market assets?", taskText: "gather dollar index levels, emerging market performance and policy expectations" },
    { question: "What changed in Ethereum's ecosystem this week?", taskText: "gather protocol and DeFi developments plus on-chain activity for Ethereum" },
    { question: "Does falling real yields support my gold thesis?", taskText: "evaluate whether current real yield and inflation conditions support the trader's gold thesis" },
  ];

  it("derives requirements that map to registered capabilities for every unseen question", () => {
    for (const { taskText } of unseen) {
      const reqs = requirementsFromTasks([{ objective: taskText, capabilities: [] }]);
      expect(reqs.length).toBeGreaterThan(0);
      for (const req of reqs) {
        const caps = capabilitiesForRequirement(req, { isAvailable: () => true, limit: 2 });
        expect(caps.length).toBeGreaterThan(0);
        for (const cap of caps) expect(PLANNER_CAPABILITIES).toContain(cap);
      }
    }
  });

  it("an unseen subject's terms still gate contamination (copper vs crypto)", () => {
    const terms = subjectTermsOf("What is driving copper prices this week?");
    expect(terms).toBeDefined();
    const btc = item({ ref: "ev_15", text: "BTC ETF inflows accelerate", evidenceType: "NEWS_ANALYSIS" });
    const copper = item({ ref: "ev_16", text: "Copper hits record as smelter outages tighten supply", evidenceType: "NEWS_ANALYSIS" });
    const req = buildRequirements([{ description: "current copper price movement this week" }])[0]!;
    expect(matchRequirement(req, btc, { subjectTerms: terms!, now: NOW })).toBe("NO_MATCH");
    expect(matchRequirement(req, copper, { subjectTerms: terms!, now: NOW })).not.toBe("NO_MATCH");
  });
});
