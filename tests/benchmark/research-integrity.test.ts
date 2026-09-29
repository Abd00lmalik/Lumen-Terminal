/**
 * RESEARCH-INTEGRITY BENCHMARK (Workstream I; adversarial scenarios from the brief §5 Step 3).
 *
 * Deterministic (MOCKED-INTEGRATION): real domain/evidence layer, real requirement coverage +
 * confidence engine, real adaptive loop; scripted providers and model. No network, no live model.
 *
 * Scenarios (brief §5 Step 3 mapping):
 *   S7  duplicate underlying reports mistaken for independent corroboration
 *   S22 a model response that sounds confident but lacks admissible evidence (via confidence cap)
 *   S12 material warnings vs noise (provenance-derived evidence quality feeds it)
 *   S3  conflicting evidence stays conflict (coverage + quality do not force agreement)
 *   S8  missing or inaccessible sources → honest UNRESOLVED quality, no invention
 *   plus: evidence-class laws at the boundary, provider/transport provenance derivation,
 *   upstream-lineage dedup (same upstream via two paths = one origin), and the end-to-end
 *   multi-source path through the REAL adaptive loop (distinct origins → DIRECT_EVIDENCE).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { normalizedResult, type ToolResult } from "../../src/domain/tool-result.js";
import {
  evidenceFromToolResult,
  sourceProviderForOutput,
  sourceTypeForOutput,
  assessEvidenceQuality,
} from "../../src/domain/evidence.js";
import {
  assessCoverage,
  buildRequirements,
  completeRequirements,
  subjectMarketClassOf,
  type CoverageEvidence,
  type RequirementSeed,
} from "../../src/research/requirements.js";
import { computeConfidence } from "../../src/research/confidence.js";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch } from "../../src/research/adaptive.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses as modelResponses, newStore } from "../model/fakes.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { detectFrameworkIssues } from "../../src/research/flow8.js";

const origin = { kind: "agent" as const, detail: "research-integrity benchmark" };

function okResult(overrides: Partial<ToolResult> = {}): ToolResult {
  const base = normalizedResult(
    {
      tool: "bitget-signal/news-briefing",
      capability: "NEWS_ANALYSIS",
      transport: "mcp:public-market-data",
      params: { topic: "BTC" },
      rawReference: "raw://resp-1",
      outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: "ETF announcement reported by 3 outlets" }],
      validation: "VALID",
    },
    origin,
  );
  return { ...base, ...overrides };
}

function cov(overrides: Partial<CoverageEvidence> & { ref: string; text: string }): CoverageEvidence {
  return { ...overrides };
}

/** A real ledger row through the real pipeline (never a hand-minted requirement object). */
function coreRequirement(question = "What is driving BTC this week?"): ReturnType<typeof buildRequirements>[number] {
  const seed: RequirementSeed = {
    description: "current market observation for the subject",
    importance: "CRITICAL",
    role: "CORE",
    timeSensitivity: "CURRENT",
  };
  const seeded = buildRequirements([seed]);
  const complete = completeRequirements(question, seeded, { subject: "BTC", marketClass: subjectMarketClassOf(question) });
  // Find OUR seeded row by id (completeRequirements adds engine rows around it).
  return complete.find((r) => r.id === seeded[0]!.id)!;
}

// ---------------------------------------------------------------------------
// Evidence-class laws at the boundary (scenario families 1/5/13)
// ---------------------------------------------------------------------------

describe("boundary: evidence classification under provenance additions", () => {
  beforeEach(() => resetIdCounters());

  it("strong corroborated evidence: two distinct transports yield distinct origins", () => {
    const a = evidenceFromToolResult(okResult(), okResult().normalizedOutput[0]!, origin);
    const b = evidenceFromToolResult(
      okResult({ transport: "rest:api.bitget.com" }),
      okResult({ transport: "rest:api.bitget.com" }).normalizedOutput[0]!,
      origin,
    );
    expect(a.sourceProvider).toBe("mcp:public-market-data");
    expect(b.sourceProvider).toBe("rest:api.bitget.com");
    expect(a.sourceProvider).not.toBe(b.sourceProvider);
  });

  it("an in-payload publisher is the origin; upstream lineage is honored (S7/Heurist law)", () => {
    const r = okResult({
      normalizedOutput: [
        {
          outputClass: "QUANTITATIVE_OBSERVATION",
          content: { price: 43000, publisher: "CoinDesk" },
        },
      ],
    });
    expect(sourceProviderForOutput(r, r.normalizedOutput[0]!)).toBe("CoinDesk");
  });

  it("the same upstream reached via two paths is ONE origin (no double-counted corroboration)", () => {
    const direct = { outputClass: "QUANTITATIVE_OBSERVATION" as const, content: { price: 1, upstreamSource: "yahoo-finance" } };
    const viaHeurist = { outputClass: "QUANTITATIVE_OBSERVATION" as const, content: { price: 1, upstreamSource: "yahoo-finance" } };
    expect(sourceProviderForOutput(okResult(), direct)).toBe("yahoo-finance");
    expect(sourceProviderForOutput(okResult(), viaHeurist)).toBe("yahoo-finance");
  });

  it("interpretation-class output is ANALYSIS source type, never a market observation", () => {
    const r = okResult({
      normalizedOutput: [{ outputClass: "ANALYST_INTERPRETATION", content: "momentum looks bullish", interpretationBasis: "skill-authored" }],
    });
    expect(sourceTypeForOutput(r.normalizedOutput[0]!)).toBe("ANALYSIS");
  });

  it("G2 payload sourceClass maps to the typed source kind (secondary reporting stays secondary)", () => {
    const r = okResult({
      normalizedOutput: [
        { outputClass: "FACTUAL_OBSERVATION", content: { url: "https://example.coindesk.com/x", publisher: "CoinDesk", sourceClass: "secondary/news-report" } },
      ],
    });
    expect(sourceTypeForOutput(r.normalizedOutput[0]!)).toBe("SECONDARY");
    expect(sourceProviderForOutput(r, r.normalizedOutput[0]!)).toBe("CoinDesk");
  });

  it("failed tool results never become evidence (unchanged law)", () => {
    const failed = okResult({ failure: { type: "TIMEOUT", message: "upstream timeout", retriable: true }, normalizedOutput: [] });
    expect(() => evidenceFromToolResult(failed, { outputClass: "FACTUAL_OBSERVATION", content: "x" }, origin)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Requirement-level quality assessment (scenarios 1/7/12/22)
// ---------------------------------------------------------------------------

describe("coverage quality: distinct origins vs repeated reporting", () => {
  beforeEach(() => resetIdCounters());

  it("S1: three distinct primary sources raise DIRECT_EVIDENCE (the >=3-distinct-origins law)", () => {
    const r = coreRequirement();
    const updated = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: rate cut announced", sourceProvider: "fred", sourceType: "PRIMARY" }),
      cov({ ref: "ev_2", text: "BTC market observation: depth firmed", sourceProvider: "market-regime", sourceType: "PRIMARY" }),
      cov({ ref: "ev_3", text: "BTC market observation: volumes elevated", sourceProvider: "exchange-feed", sourceType: "PRIMARY" }),
    ]);
    const row = updated.find((x) => x.id === r.id)!;
    expect(row.status).toBe("SATISFIED");
    expect(row.evidenceQuality).toBe("DIRECT_EVIDENCE");
    expect(row.sourceDiversity).toBe(3);
  });

  it("S1b: two distinct primary sources stay SUPPORTED_INFERENCE (below the 3-origin bar)", () => {
    const r = coreRequirement();
    const updated = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: rate cut announced", sourceProvider: "fred", sourceType: "PRIMARY" }),
      cov({ ref: "ev_2", text: "BTC market observation: depth firmed", sourceProvider: "market-regime", sourceType: "PRIMARY" }),
    ]);
    const row = updated.find((x) => x.id === r.id)!;
    expect(row.status).toBe("SATISFIED");
    expect(row.evidenceQuality).toBe("SUPPORTED_INFERENCE");
    expect(row.sourceDiversity).toBe(2);
  });

  it("S7: one report syndicated 3x stays ONE origin (CORRELATIONAL, diversity 1)", () => {
    const r = coreRequirement();
    const updated = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: ETF story", sourceProvider: "coinwire", sourceType: "SECONDARY" }),
      cov({ ref: "ev_2", text: "BTC market observation: ETF story", sourceProvider: "coinwire", sourceType: "SECONDARY" }),
      cov({ ref: "ev_3", text: "BTC market observation: ETF story", sourceProvider: "coinwire", sourceType: "SECONDARY" }),
    ]);
    const row = updated.find((x) => x.id === r.id)!;
    expect(row.status).toBe("SATISFIED");
    expect(row.sourceDiversity).toBe(1);
    expect(row.evidenceQuality).toBe("CORRELATIONAL");
  });

  it("S7b: an adapter-flagged duplicate never adds diversity or directness", () => {
    const r = coreRequirement();
    const updated = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: official release", sourceProvider: "gov-x", sourceType: "PRIMARY" }),
      cov({ ref: "ev_2", text: "BTC market observation: same release re-reported", sourceProvider: "news-y", sourceType: "PRIMARY", duplicateContent: true }),
    ]);
    const row = updated.find((x) => x.id === r.id)!;
    expect(row.status).toBe("SATISFIED");
    expect(row.sourceDiversity).toBe(1);
    expect(row.evidenceQuality).toBe("SUPPORTED_INFERENCE");
  });

  it("S22: a confident-looking single secondary report cannot reach HIGH confidence", () => {
    const r = coreRequirement();
    const updated = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: single blog claim", sourceProvider: "one-blog", sourceType: "SECONDARY" }),
    ]);
    const components = computeConfidence({
      requirements: [updated.find((x) => x.id === r.id)!],
      stoppedBecause: "MODEL_COMPLETE",
      failedPaths: 0,
    });
    expect(components.level).not.toBe("HIGH");
    expect(components.weakQuality.length).toBeGreaterThan(0);
  });

  it("S12: provenance-derived quality now feeds the confidence ladder in both directions", () => {
    const r = coreRequirement();
    // A CHALLENGE row that was attempted (recoveryAttempts>0) must be present in both runs:
    // the challenge-attempted law independently caps HIGH, so without it the quality effect
    // under test would be masked by the challenge cap for both runs.
    const challengeRow = {
      id: "R_CH", description: "evidence that weakens or contradicts the leading conclusion (counterevidence)",
      importance: "CRITICAL" as const, role: "CHALLENGE" as const, status: "UNAVAILABLE" as const,
      timeSensitivity: "CURRENT" as const, domains: ["GENERAL"] as const, evidenceRefs: [], staleOnlyRefs: [], recoveryAttempts: 1,
    };
    const strongRow = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: official series a", sourceProvider: "src-a", sourceType: "PRIMARY" }),
      cov({ ref: "ev_2", text: "BTC market observation: official series b", sourceProvider: "src-b", sourceType: "PRIMARY" }),
      cov({ ref: "ev_3", text: "BTC market observation: official series c", sourceProvider: "src-c", sourceType: "PRIMARY" }),
    ]).find((x) => x.id === r.id)!;
    const weakRow = assessCoverage([r], [
      cov({ ref: "ev_1", text: "BTC market observation: single blog claim", sourceProvider: "one-blog", sourceType: "SECONDARY" }),
    ]).find((x) => x.id === r.id)!;
    const ORDER = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3 };
    const strong = computeConfidence({ requirements: [strongRow, challengeRow], stoppedBecause: "MODEL_COMPLETE", failedPaths: 0 });
    const weak = computeConfidence({ requirements: [weakRow, challengeRow], stoppedBecause: "MODEL_COMPLETE", failedPaths: 0 });
    expect(ORDER[strong.level]).toBeGreaterThan(ORDER[weak.level]);
    expect(weak.level).not.toBe("HIGH");
  });

  it("assessEvidenceQuality (domain view) keeps its neutral defaults; engine owns claim-specific quality", () => {
    const e = evidenceFromToolResult(okResult(), okResult().normalizedOutput[0]!, origin);
    const q = assessEvidenceQuality(e);
    expect(q.reliability).toBe(0.5);
    expect(q.corroboration).toBe(0.4); // single sourceRef
  });
});

// ---------------------------------------------------------------------------
// End-to-end through the REAL adaptive loop (fixture-complete provenance path)
// ---------------------------------------------------------------------------

describe("adaptive-loop integration: provenance flows from provider to requirement quality", () => {
  beforeEach(() => resetIdCounters());

  function scriptedModel(question: string) {
    const planJson = JSON.stringify({
      objective: question,
      scopeIncluded: ["what the question asks"],
      scopeExcluded: [],
      tasks: [{ type: "FACT_FINDING", objective: question, capabilities: ["MARKET_DATA_ANALYSIS", "NEWS_ANALYSIS"], completion: "requirements covered or absence recorded" }],
      requirements: [
        { description: "current BTC market observation", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      ],
      completionCriteria: ["core requirements covered or honest insufficiency"],
      adaptationPolicy: "n/a",
    });
    const provider = new FakeModelProvider(new Map([
      ["research.plan", planJson],
      ["research.adaptive_decision", modelResponses.adaptiveDecision("COMPLETE")],
    ]));
    return provider;
  }

  function providers(): ProviderAdapter[] {
    const market: ProviderAdapter = {
      providerId: "fixture/market",
      capabilities: ["MARKET_DATA_ANALYSIS"],
      limitations: ["fixture"],
      freshnessProfile: "test:live",
      async execute(cap) {
        return {
          tool: "fixture/market",
          capability: cap,
          transport: "rest:fixture-market",
          outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION", content: { price: 43000, note: "BTC market observation" }, about: "BTC" }],
        };
      },
    };
    const news: ProviderAdapter = {
      providerId: "fixture/news",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["fixture"],
      freshnessProfile: "test:live",
      async execute(cap) {
        return {
          tool: "fixture/news",
          capability: cap,
          transport: "mcp:fixture-news",
          outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: "BTC market observation: ETF inflows accelerating", about: "BTC" }],
        };
      },
    };
    return [market, news];
  }

  it("two distinct transports in one run: requirement quality is DIRECT_EVIDENCE (was CORRELATIONAL before the fix)", async () => {
    const workspace = new Workspace();
    const registry = new CapabilityRegistry();
    for (const p of providers()) registry.register(p);
    const research = workspace.addResearch({ objective: "What is happening with BTC?", question: "What is happening with BTC?", flow: "WHAT_HAPPENED" }, { kind: "trader", detail: "benchmark" });
    workspace.transitionResearch(research.id, "ACTIVE", { kind: "trader", detail: "benchmark" }, "activated");
    const outcome = await runAdaptiveResearch("What is happening with BTC?", research.id, {
      provider: scriptedModel("What is happening with BTC?"),
      registry,
      workspace,
      store: newStore(),
    });
    // The scripted plan's own row (not an engine-added row): find by the plan's wording.
    const req1 = outcome.requirements.find((r) => r.description.includes("current BTC market observation"));
    expect(req1?.status).toBe("SATISFIED");
    expect(req1?.sourceDiversity).toBe(2);
    expect(req1?.evidenceQuality).toBe("SUPPORTED_INFERENCE");
  });

  it("a repeated identical payload from one origin stays diversity 1 (re-served copy is not corroboration)", async () => {
    const workspace = new Workspace();
    const registry = new CapabilityRegistry();
    const provider: ProviderAdapter = {
      providerId: "fixture/mono",
      capabilities: ["NEWS_ANALYSIS"],
      limitations: ["fixture"],
      freshnessProfile: "test:live",
      async execute(cap) {
        return {
          tool: "fixture/mono",
          capability: cap,
          transport: "mcp:fixture-news",
          outputs: [
            { outputClass: "FACTUAL_OBSERVATION", content: { publisher: "CoinDesk", url: "https://coindesk.com/same", excerpt: "BTC market observation: same story" } },
            { outputClass: "FACTUAL_OBSERVATION", content: { publisher: "CoinDesk", url: "https://mirror.example.com/same", excerpt: "BTC market observation: same story", duplicateContent: true } },
          ],
        };
      },
    };
    registry.register(provider);
    const research = workspace.addResearch({ objective: "What is the news on BTC?", question: "What is the news on BTC?", flow: "WHAT_HAPPENED" }, { kind: "trader", detail: "benchmark" });
    workspace.transitionResearch(research.id, "ACTIVE", { kind: "trader", detail: "benchmark" }, "activated");
    const outcome = await runAdaptiveResearch("What is the news on BTC?", research.id, {
      provider: scriptedModel("What is the news on BTC?"),
      registry,
      workspace,
      store: newStore(),
    });
    const req1 = outcome.requirements.find((r) => r.description.includes("current BTC market observation"));
    expect(req1?.status).toBe("SATISFIED");
    // One distinct origin (CoinDesk); the duplicate-flagged mirror adds nothing. Both items
    // are secondary reporting, so the row stays CORRELATIONAL (single-origin reporting).
    expect(req1?.sourceDiversity).toBe(1);
    expect(req1?.evidenceQuality).toBe("CORRELATIONAL");
  });
});

// ---------------------------------------------------------------------------
// Framework inconsistency detection (scenario 14; Flow 8)
// ---------------------------------------------------------------------------

describe("Flow 8: deterministic framework-inconsistency detection", () => {
  it("S14a: unsatisfiable threshold pair on the same measure is detected", () => {
    const text = [
      "All criteria must hold before any position research is considered supported.",
      "- Criterion 1: RSI must be above 70 to confirm momentum.",
      "- Criterion 2: RSI must be below 30 to confirm exhaustion.",
      "- Criterion 3: volume must exceed the 20-day average.",
    ].join("\n");
    const issues = detectFrameworkIssues(text);
    expect(issues.some((i) => i.includes("above 70") && i.includes("below 30") && i.includes("both cannot hold"))).toBe(true);
  });

  it("distinct measures never conflict (RSI vs MACD thresholds are fine)", () => {
    const text = [
      "All criteria must hold.",
      "- RSI must be above 70.",
      "- MACD must be below -5.",
    ].join("\n");
    const issues = detectFrameworkIssues(text);
    expect(issues).toHaveLength(0);
  });

  it("S14b: a quantifier conflict (all must hold vs any single suffices) is detected", () => {
    const text = "All criteria must hold. Alternatively, meeting any of the criteria must be enough to act.";
    const issues = detectFrameworkIssues(text);
    expect(issues.some((i) => i.includes("all criteria must hold") && i.includes("only some"))).toBe(true);
  });

  it("a declared scoring system with no numeric scale is detected", () => {
    const text = "Weighted scoring applies across conviction, momentum and structure criteria.";
    const issues = detectFrameworkIssues(text);
    expect(issues.some((i) => i.includes("no numeric scale"))).toBe(true);
  });

  it("a consistent framework produces no findings (no false positives)", () => {
    const text = [
      "All criteria must hold.",
      "- RSI must be above 50 and rising.",
      "- Funding must be below 0.05%.",
      "- Open interest must be rising week over week.",
    ].join("\n");
    expect(detectFrameworkIssues(text)).toHaveLength(0);
  });
});
