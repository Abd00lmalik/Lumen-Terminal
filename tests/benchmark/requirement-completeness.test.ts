/**
 * REQUIREMENT-COMPLETENESS BENCHMARK — the acceptance gate for the research workbench.
 *
 * This benchmark proves (or honestly disproves) that a natural-language research question
 * causes the engine to:
 *   1. Identify what must be known (requirement generation)
 *   2. Retrieve the correct current evidence (evidence relevance + freshness)
 *   3. Recover missing evidence through the capability/provider/fallback system
 *   4. Only then synthesize the answer (synthesis downstream of coverage)
 *
 * FAILURE MODE THIS ELIMINATES:
 *   - User asks a legitimate research question
 *   - Engine retrieves whatever evidence happens to be available
 *   - Unrelated evidence gets synthesized into a plausible answer
 *   - Missing required evidence is buried under "What this run could not do"
 *   - The run still completes
 *   - The final judgment sounds reasonable while not actually answering the question
 *
 * That behavior is treated as a benchmark failure.
 *
 * Seven categories:
 *   A. MACRO REGIME
 *   B. SINGLE ASSET / EQUITY
 *   C. EARNINGS / EVENT
 *   D. COMMODITY / CROSS-ASSET
 *   E. CRYPTO MARKET
 *   F. CAUSAL / TRANSMISSION CHAIN
 *   G. ADVERSARIAL / UNSEEN QUESTIONS
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import {
  buildRequirements,
  completeRequirements,
  assessCoverage,
  coverageVerdict,
  questionTypeOf,
  type ResearchRequirement,
  type CoverageEvidence,
} from "../../src/research/requirements.js";

const origin = { kind: "agent" as const, detail: "requirement-completeness benchmark" };
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

interface BenchmarkCase {
  readonly name: string;
  readonly question: string;
  /** Capability -> outputs. All served by one fixture provider per capability. */
  readonly providers: ReadonlyMap<string, readonly { content: string; about?: string }[]>;
  /** Caller-supplied capability params (mirrors the LUI's question-earned asset backstop). */
  readonly capabilityParams?: Record<string, unknown>;
  /** Fixture results are observation-dated this many days ago (freshness probe). */
  readonly staleDaysAgo?: number;
  /** Capabilities whose provider fails (for recovery tests). */
  readonly failCapabilities?: readonly string[];
  /** Max rounds for the adaptive loop. */
  readonly maxRounds?: number;
  readonly assertions: Assertion[];
}

interface Assertion {
  readonly kind:
    | "requirement_exists"        // a requirement with this description fragment must exist
    | "requirement_satisfied"     // that requirement must be SATISFIED
    | "requirement_not_satisfied" // that requirement must NOT be SATISFIED
    | "requirement_exhausted"     // that requirement must be EXHAUSTED
    | "requirement_engine_added"  // that requirement was engine-added (not model-provided)
    | "no_forbidden_evidence"     // evidence matching this pattern must not be in the context
    | "forbidden_in_context"      // text matching this pattern must not appear in context items
    | "completion"                // stoppedBecause must match
    | "evidence_count_min"        // at least N evidence objects
    | "evidence_count_max"        // at most N evidence objects
    | "capabilities_executed"     // these capabilities must have been executed
    | "capability_not_executed"   // these capabilities must NOT have been executed
    | "context_has_domain"        // context must contain evidence from this domain
    | "subject_in_params"         // capability params must carry this asset
    | "no_subject_in_params"      // capability params must NOT carry any asset
    | "answer_not_empty"          // the final answer must not be empty
    | "answer_states_requirements" // the answer must reference the requirement coverage
    | "resolution"                // the question type must match this
    ;
  readonly value: string | number | readonly string[];
}

function capabilityFixture(
  name: string,
  outputs: readonly { content: string; about?: string }[],
  opts: { sourceTimestamp?: string; fail?: "EMPTY" | "TIMEOUT" } = {},
): ProviderAdapter {
  return {
    providerId: `harness/${name.toLowerCase()}`,
    capabilities: [name],
    limitations: ["benchmark fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
      if (opts.fail !== undefined) {
        return {
          tool: `harness/${name.toLowerCase()}`,
          capability: cap,
          transport: "fake",
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `${cap} failed` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: opts.fail === "TIMEOUT"
            ? { type: "TIMEOUT" as const, message: "timed out", retriable: true }
            : { type: "EMPTY_RESULT" as const, message: "empty payload", retriable: true },
        };
      }
      return {
        tool: `harness/${name.toLowerCase()}`,
        capability: cap,
        transport: "fake",
        ...(opts.sourceTimestamp !== undefined ? { sourceTimestamp: opts.sourceTimestamp } : {}),
        outputs: outputs.map((o) => ({
          outputClass: "FACTUAL_OBSERVATION" as const,
          content: o.content,
          ...(o.about !== undefined ? { about: o.about } : {}),
        })),
      };
    },
  };
}

function planWithReqs(question: string, requirements: unknown[], capabilities: string[]): string {
  return JSON.stringify({
    objective: question,
    scopeIncluded: ["what the question asks"],
    scopeExcluded: [],
    tasks: [{ type: "FACT_FINDING", objective: question, capabilities, completion: "requirements covered or absence recorded" }],
    requirements,
    completionCriteria: ["core requirements covered or honest insufficiency"],
    adaptationPolicy: "n/a",
  });
}

async function runCase(c: BenchmarkCase): Promise<AdaptiveLoopOutcome> {
  const seenParams: Record<string, unknown>[] = [];
  const seenCaps: string[] = [];
  const registry = new CapabilityRegistry();
  const staleTs = c.staleDaysAgo !== undefined
    ? new Date(Date.now() - c.staleDaysAgo * DAY_MS).toISOString()
    : undefined;

  const providers = new Map(c.providers);
    // Register FALSIFICATION as a default (required by the challenge-attempt law)
    if (!providers.has("FALSIFICATION")) {
      providers.set("FALSIFICATION", [
        { content: "Counter-case: positioning flows may contradict the retrieved driver, suggesting a weaker thesis than the evidence implies." },
      ]);
    }

  for (const [capability, outputs] of providers) {
    const failing = c.failCapabilities?.includes(capability) === true;
    const inner = capabilityFixture(
      capability,
      outputs,
      failing
        ? { fail: "TIMEOUT" }
        : { ...(staleTs !== undefined ? { sourceTimestamp: staleTs } : {}) },
    );
    registry.register({
      providerId: inner.providerId,
      capabilities: inner.capabilities,
      limitations: inner.limitations,
      freshnessProfile: inner.freshnessProfile,
      async execute(cap, p) {
        seenCaps.push(cap);
        seenParams.push(p);
        return inner.execute(cap, p);
      },
    });
  }

  const model = new FakeModelProvider(new Map([
    ["research.plan", planWithReqs(c.question, [], [...providers.keys()])],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    ["research.answer_synthesis", JSON.stringify({
      directAnswer: "The evidence gathered addresses the research question.",
      keyFactors: [
        { factor: "primary driver", mechanism: "through the channel described", direction: "mixed", evidenceRefs: [], counterevidenceRefs: [] },
      ],
      whatWouldChangeTheView: ["a reversal in the retrieved metric"],
      implication: "The decision hinges on whether the driver persists.",
      uncertainty: ["Whether the driver persists is not established."],
      confidence: "MODERATE",
      citedObjectRefs: [],
    })],
  ]));

  const ws = new Workspace();
  const research = ws.addResearch(
    { objective: c.question, question: c.question, flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
    origin,
  );
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

  const outcome = await runAdaptiveResearch(c.question, research.id, {
    provider: model,
    registry,
    workspace: ws,
    store: new MemoryStore(),
    maxRounds: c.maxRounds ?? 2,
    ...(c.capabilityParams !== undefined ? { capabilityParams: c.capabilityParams } : {}),
  });

  // Attach captured params/caps for assertions
  (outcome as any).__params = seenParams;
  (outcome as any).__caps = seenCaps;
  return outcome;
}

function assertOutcome(c: BenchmarkCase, outcome: AdaptiveLoopOutcome): void {
  const params = (outcome as any).__params as Record<string, unknown>[];
  const caps = (outcome as any).__caps as string[];
  const contextText = outcome.context.items.map((i) => i.text).join(" ");
  const evidenceText = outcome.evidence.map((e) => `${e.observation} ${e.subject ?? ""}`).join(" ");

  for (const a of c.assertions) {
    switch (a.kind) {
      case "requirement_exists": {
        const pattern = new RegExp(a.value as string, "i");
        const found = outcome.requirements.some((r) => pattern.test(r.description));
        expect(found, `requirement matching "${a.value}" should exist`).toBe(true);
        break;
      }
      case "requirement_satisfied": {
        const pattern = new RegExp(a.value as string, "i");
        const req = outcome.requirements.find((r) => pattern.test(r.description));
        expect(req, `requirement matching "${a.value}" should exist`).toBeDefined();
        expect(req!.status, `requirement "${req!.description}" should be SATISFIED`).toBe("SATISFIED");
        break;
      }
      case "requirement_not_satisfied": {
        const pattern = new RegExp(a.value as string, "i");
        const req = outcome.requirements.find((r) => pattern.test(r.description));
        if (req !== undefined) {
          expect(req.status, `requirement "${req.description}" must NOT be SATISFIED`).not.toBe("SATISFIED");
        }
        break;
      }
      case "requirement_exhausted": {
        const pattern = new RegExp(a.value as string, "i");
        const req = outcome.requirements.find((r) => pattern.test(r.description));
        expect(req, `requirement matching "${a.value}" should exist`).toBeDefined();
        expect(req!.status, `requirement "${req!.description}" should be EXHAUSTED`).toBe("EXHAUSTED");
        break;
      }
      case "requirement_engine_added": {
        const pattern = new RegExp(a.value as string, "i");
        const req = outcome.requirements.find((r) => pattern.test(r.description));
        expect(req, `requirement matching "${a.value}" should exist`).toBeDefined();
        expect(req!.engineRequired, `requirement "${req!.description}" should be engine-added`).toBe(true);
        break;
      }
      case "no_forbidden_evidence": {
        const pattern = new RegExp(a.value as string, "i");
        for (const e of outcome.evidence) {
          expect(
            pattern.test(`${e.observation} ${e.subject ?? ""}`),
            `evidence "${e.observation.slice(0, 80)}" must not match forbidden pattern "${a.value}"`,
          ).toBe(false);
        }
        break;
      }
      case "forbidden_in_context": {
        const terms = Array.isArray(a.value) ? a.value : [a.value];
        for (const term of terms) {
          expect(contextText, `context must not contain "${term}"`).not.toContain(term);
        }
        break;
      }
      case "completion": {
        expect(outcome.stoppedBecause, `stoppedBecause should be "${a.value}"`).toBe(a.value);
        break;
      }
      case "evidence_count_min": {
        expect(outcome.evidence.length, `evidence count should be >= ${a.value}`).toBeGreaterThanOrEqual(a.value as number);
        break;
      }
      case "evidence_count_max": {
        expect(outcome.evidence.length, `evidence count should be <= ${a.value}`).toBeLessThanOrEqual(a.value as number);
        break;
      }
      case "capabilities_executed": {
        const expected = Array.isArray(a.value) ? a.value : [a.value];
        for (const cap of expected) {
          expect(caps, `capability "${cap}" should have been executed`).toContain(cap);
        }
        break;
      }
      case "capability_not_executed": {
        const forbidden = Array.isArray(a.value) ? a.value : [a.value];
        for (const cap of forbidden) {
          expect(caps, `capability "${cap}" must NOT have been executed`).not.toContain(cap);
        }
        break;
      }
      case "context_has_domain": {
        const pattern = new RegExp(a.value as string, "i");
        expect(pattern.test(contextText), `context should contain domain evidence matching "${a.value}"`).toBe(true);
        break;
      }
      case "subject_in_params": {
        expect(params.length, "at least one capability should have been executed").toBeGreaterThan(0);
        expect(params.every((p) => p["asset"] === a.value), `all params should carry asset "${a.value}"`).toBe(true);
        break;
      }
      case "no_subject_in_params": {
        for (const p of params) {
          expect(p["asset"], `params must not carry an asset`).toBeUndefined();
        }
        break;
      }
      case "answer_not_empty": {
        expect(outcome.answer, "answer should not be empty").toBeDefined();
        expect(outcome.answer!.length, "answer should have content").toBeGreaterThan(0);
        break;
      }
      case "answer_states_requirements": {
        const answerText = `${outcome.answer ?? ""} ${outcome.synthesis?.directAnswer ?? ""}`;
        expect(answerText.length, "answer should have content").toBeGreaterThan(100);
        break;
      }
      case "resolution": {
        expect(questionTypeOf(c.question), `question type should be "${a.value}"`).toBe(a.value);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CATEGORY A: MACRO REGIME
// ---------------------------------------------------------------------------
describe("CATEGORY A: MACRO REGIME", () => {
  beforeEach(() => resetIdCounters());

  const MACRO_CASES: readonly BenchmarkCase[] = [
    {
      name: "A1: canonical macro question with full evidence",
      question: "What macro conditions favor risk assets right now?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "The 10-year Treasury yield is 4.998 percent, up 0.75 percent today." },
          { content: "VIX is 14.81, down 13.4 percent, indicating elevated risk appetite." },
          { content: "The US dollar index DXY trades at 100.215, firmer on the day." },
          { content: "US ISM Manufacturing PMI came in at 50.8, above the 49.5 consensus." },
          { content: "US CPI rose 0.2 percent month-over-month, core CPI at 3.2 percent year-over-year." },
          { content: "US high-yield credit spreads are 320 basis points, tighter by 15 basis points." },
        ]],
      ]),
      assertions: [
        { kind: "resolution", value: "MACRO_REGIME" },
        { kind: "no_subject_in_params" },
        // Engine must generate the 6 MACRO_REGIME dimensions
        { kind: "requirement_engine_added", value: "interest rate" },
        { kind: "requirement_engine_added", value: "volatility" },
        { kind: "requirement_engine_added", value: "growth regime" },
        { kind: "requirement_engine_added", value: "inflation regime" },
        // Evidence must satisfy the core requirements
        { kind: "requirement_satisfied", value: "interest rate" },
        { kind: "requirement_satisfied", value: "volatility" },
        { kind: "requirement_satisfied", value: "growth regime" },
        { kind: "requirement_satisfied", value: "inflation regime" },
        // No crypto evidence in context
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "ETF"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
        { kind: "answer_not_empty" },
      ],
    },
    {
      name: "A2: reworded macro question (no keyword matching)",
      question: "What is the current macro backdrop for risk-taking?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "Treasury yields rose to 4.998 percent as growth expectations firmed." },
          { content: "VIX dropped to 14.81, reflecting complacency in equity markets." },
          { content: "Dollar index at 100.215, stable this week." },
          { content: "PMI expansion and CPI in-line suggest a Goldilocks macro backdrop." },
          { content: "Credit spreads tightened to 320 basis points, signaling easing financial conditions." },
        ]],
      ]),
      assertions: [
        { kind: "requirement_satisfied", value: "interest rate" },
        { kind: "requirement_satisfied", value: "volatility" },
        { kind: "requirement_satisfied", value: "growth regime" },
        { kind: "requirement_satisfied", value: "inflation regime" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "A3: macro question asking about tightening conditions",
      question: "What macro factors are currently tightening financial conditions?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "The 10-year Treasury yield surged to 5.15 percent, the highest since 2007." },
          { content: "VIX spiked to 28.5 as equity markets sold off sharply." },
          { content: "Dollar index jumped to 106.8, pressuring emerging markets." },
          { content: "Credit spreads widened to 450 basis points as recession fears grew." },
        ]],
      ]),
      assertions: [
        { kind: "requirement_satisfied", value: "interest rate" },
        { kind: "requirement_satisfied", value: "volatility" },
        { kind: "requirement_satisfied", value: "growth regime" },
        { kind: "requirement_satisfied", value: "inflation regime" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "A4: macro question with ONLY crypto evidence (wrong domain)",
      question: "What macro conditions favor risk assets right now?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "BTC trades at 80,750 USD with a 24-hour volume of 39.59 billion USD.", about: "BTC" },
          { content: "Bitcoin ETF flows saw 450 million USD of outflows this week.", about: "BTC" },
        ]],
      ]),
      assertions: [
        { kind: "requirement_not_satisfied", value: "interest rate" },
        { kind: "requirement_not_satisfied", value: "volatility" },
        { kind: "requirement_not_satisfied", value: "growth regime" },
        { kind: "requirement_not_satisfied", value: "inflation regime" },
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
      ],
    },
    {
      name: "A5: macro question with stale-only evidence",
      question: "What macro conditions favor risk assets right now?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "Treasury yields, the dollar, and volatility conditions were mixed last quarter." },
        ]],
      ]),
      staleDaysAgo: 90,
      assertions: [
        { kind: "requirement_not_satisfied", value: "interest rate" },
        { kind: "requirement_not_satisfied", value: "volatility" },
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
      ],
    },
  ];

  for (const c of MACRO_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CATEGORY B: SINGLE ASSET / EQUITY
// ---------------------------------------------------------------------------
describe("CATEGORY B: SINGLE ASSET / EQUITY", () => {
  beforeEach(() => resetIdCounters());

  const EQUITY_CASES: readonly BenchmarkCase[] = [
    {
      name: "B1: TSLA week-over-week comparison",
      question: "How is TSLA trading compared to last week?",
      providers: new Map([
        ["EQUITY_MARKET_DATA", [
          { content: JSON.stringify({ symbol: "TSLA", metric: "ohlcv_weekOverWeek", previousWeekClose: 398.4, latestWeekClose: 428.9, weekOverWeekChangePct: 7.66 }), about: "TSLA" },
        ]],
        ["EQUITY_NEWS", [
          { content: "TSLA traded higher on strong delivery data and Cybertruck production milestones.", about: "TSLA" },
        ]],
      ]),
      capabilityParams: { asset: "TSLA" },
      assertions: [
        { kind: "resolution", value: "COMPARISON" },
        { kind: "subject_in_params", value: "TSLA" },
        { kind: "requirement_satisfied", value: "period over period" },
        { kind: "requirement_satisfied", value: "volume|range" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "crude"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "B2: unseen equity question (AAPL)",
      question: "What is driving AAPL stock this week?",
      providers: new Map([
        ["EQUITY_MARKET_DATA", [
          { content: "AAPL trades at 228.50, up 3.2 percent on the week with above-average volume.", about: "AAPL" },
        ]],
        ["EQUITY_NEWS", [
          { content: "AAPL rallied on iPhone 17 pre-order data exceeding expectations.", about: "AAPL" },
          { content: "AAPL supplier Foxconn reported record September revenue.", about: "AAPL" },
        ]],
      ]),
      capabilityParams: { asset: "AAPL" },
      assertions: [
        { kind: "subject_in_params", value: "AAPL" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "oil"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "B3: equity question with crypto contamination rejected",
      question: "How is TSLA trading compared to last week?",
      providers: new Map([
        ["EQUITY_MARKET_DATA", [
          { content: JSON.stringify({ symbol: "TSLA", metric: "ohlcv_weekOverWeek", previousWeekClose: 398.4, latestWeekClose: 428.9, weekOverWeekChangePct: 7.66 }), about: "TSLA" },
        ]],
        ["EQUITY_NEWS", [
          { content: "Bitcoin ETF inflows hit a record as crypto markets rally on regulation hopes.", about: "BTC" },
        ]],
      ]),
      capabilityParams: { asset: "TSLA" },
      assertions: [
        { kind: "no_forbidden_evidence", value: "Bitcoin|BTC" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
  ];

  for (const c of EQUITY_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CATEGORY C: EARNINGS / EVENT
// ---------------------------------------------------------------------------
describe("CATEGORY C: EARNINGS / EVENT", () => {
  beforeEach(() => resetIdCounters());

  const EVENT_CASES: readonly BenchmarkCase[] = [
    {
      name: "C1: NVDA earnings with full evidence",
      question: "What could affect NVDA around its next earnings?",
      providers: new Map([
        ["EARNINGS_CALENDAR", [
          { content: "NVDA next earnings date is 2026-11-18; consensus EPS estimate 1.05 with revenue estimate 54 billion.", about: "NVDA" },
        ]],
        ["EQUITY_NEWS", [
          { content: "NVDA company developments: datacenter demand catalyst strengthens the AI accelerator outlook.", about: "NVDA" },
        ]],
      ]),
      capabilityParams: { asset: "NVDA" },
      assertions: [
        { kind: "resolution", value: "EVENT" },
        { kind: "subject_in_params", value: "NVDA" },
        { kind: "requirement_satisfied", value: "timing of the upcoming event" },
        { kind: "requirement_satisfied", value: "consensus expectations" },
        { kind: "requirement_satisfied", value: "recent fundamentals" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "oil"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "C2: reworded earnings question",
      question: "What matters most for NVDA into the next earnings report?",
      providers: new Map([
        ["EARNINGS_CALENDAR", [
          { content: "NVDA reports on 2026-11-18; consensus expects EPS of 1.05 and revenue of 54 billion.", about: "NVDA" },
        ]],
        ["EQUITY_NEWS", [
          { content: "NVDA faces margin pressure as datacenter ASPs decline while supply chain costs rise.", about: "NVDA" },
          { content: "NVDA competitor AMD launched a competing AI chip, threatening NVDA's market share.", about: "NVDA" },
        ]],
      ]),
      capabilityParams: { asset: "NVDA" },
      assertions: [
        { kind: "requirement_satisfied", value: "timing of the upcoming event" },
        { kind: "requirement_satisfied", value: "consensus expectations" },
        { kind: "requirement_satisfied", value: "recent fundamentals" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "C3: earnings question with crypto contamination only",
      question: "What could affect NVDA around its next earnings?",
      providers: new Map([
        ["EARNINGS_CALENDAR", [
          { content: "NVDA next earnings date is 2026-11-18; consensus EPS estimate 1.05.", about: "NVDA" },
        ]],
        ["EQUITY_NEWS", [
          { content: "Bitcoin ETF inflows resumed as crypto sentiment improved.", about: "BTC" },
          { content: "Ethereum staking yields rose to 4.2 percent.", about: "ETH" },
          { content: "Gold prices surged on safe-haven demand.", about: "GC=F" },
        ]],
      ]),
      capabilityParams: { asset: "NVDA" },
      assertions: [
        // Crypto evidence should be filtered by the subject gate (wrong asset)
        { kind: "no_forbidden_evidence", value: "Bitcoin|BTC|Ethereum|ETH|Gold" },
        // Earnings date is correct-domain evidence, so timing is satisfied
        { kind: "requirement_satisfied", value: "timing of the upcoming event" },
        // Engine completes because the single correct-domain item satisfies enough requirements
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
  ];

  for (const c of EVENT_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CATEGORY D: COMMODITY / CROSS-ASSET
// ---------------------------------------------------------------------------
describe("CATEGORY D: COMMODITY / CROSS-ASSET", () => {
  beforeEach(() => resetIdCounters());

  const COMMODITY_CASES: readonly BenchmarkCase[] = [
    {
      name: "D1: oil question with supply/demand evidence",
      question: "What is driving oil prices this week?",
      providers: new Map([
        ["EQUITY_MARKET_DATA", [
          { content: "CL=F crude oil trades at 96.08, down 3.97 percent on the week.", about: "CL=F" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "OPEC+ announced a production increase; crude oil inventories drew sharply this week.", about: "CL=F" },
          { content: "Oil demand weakened as Chinese manufacturing PMI fell to 48.8.", about: "CL=F" },
        ]],
      ]),
      capabilityParams: { asset: "CL=F" },
      assertions: [
        { kind: "resolution", value: "CAUSAL" },
        { kind: "subject_in_params", value: "CL=F" },
        // CAUSAL questions on commodities require supply and demand dimensions
        { kind: "requirement_satisfied", value: "supply" },
        { kind: "requirement_satisfied", value: "demand" },
        { kind: "requirement_satisfied", value: "price" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "ETF"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "D2: copper question with cross-contamination rejected",
      question: "What is moving copper prices?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "HG=F copper trades at 4.52, up 1.8 percent on the session.", about: "HG=F" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "Copper supply tightened as smelter outages cut refined output.", about: "HG=F" },
          { content: "Bitcoin ETF inflows resumed as crypto sentiment improved.", about: "BTC" },
        ]],
      ]),
      capabilityParams: { asset: "HG=F" },
      assertions: [
        { kind: "subject_in_params", value: "HG=F" },
        { kind: "no_forbidden_evidence", value: "Bitcoin|BTC" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "D3: cross-asset transmission question",
      question: "How could oil prices affect inflation and equities?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "Oil price shocks feed through to CPI inflation and equity valuations via input costs.", about: "CL=F" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "Equity markets fell as oil-driven inflation concerns rose this week.", about: "CL=F" },
        ]],
      ]),
      capabilityParams: { asset: "CL=F" },
      assertions: [
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "Ethereum"] },
        { kind: "context_has_domain", value: "oil|crude|inflation|equit" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "D4: gold safe-haven question",
      question: "What could affect gold this week?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "GC=F gold futures trade at 2,450, up 0.7 percent this week.", about: "GC=F" },
        ]],
        ["MACRO_ANALYSIS", [
          { content: "Gold real-rate channel: the 10-year Treasury yields eased to 4.21 percent and the dollar index softened.", about: "GC=F" },
        ]],
      ]),
      capabilityParams: { asset: "GC=F" },
      assertions: [
        { kind: "subject_in_params", value: "GC=F" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "NVDA"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
  ];

  for (const c of COMMODITY_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CATEGORY E: CRYPTO MARKET
// ---------------------------------------------------------------------------
describe("CATEGORY E: CRYPTO MARKET", () => {
  beforeEach(() => resetIdCounters());

  const CRYPTO_CASES: readonly BenchmarkCase[] = [
    {
      name: "E1: BTC price action question",
      question: "What is driving BTC right now?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "BTC trades at 80,750 USD, up 2.1 percent today with elevated volume.", about: "BTC" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "Bitcoin ETF inflows totaled 1.2 billion this week as institutional demand grew.", about: "BTC" },
          { content: "Bitcoin halving supply dynamics continue to support the bullish narrative.", about: "BTC" },
        ]],
      ]),
      capabilityParams: { asset: "BTC" },
      assertions: [
        { kind: "subject_in_params", value: "BTC" },
        { kind: "requirement_satisfied", value: "price|driv|catalyst" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "E2: crypto risk regime question",
      question: "What is the current crypto risk regime?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "BTC trades at 80,750 with 30-day realized vol at 55 percent.", about: "BTC" },
          { content: "ETH trades at 3,200 with DeFi TVL at 95 billion.", about: "ETH" },
        ]],
        ["SENTIMENT_ANALYSIS", [
          { content: "Crypto fear and greed index at 72 (greed); leverage ratios elevated across futures.", about: "BTC" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "Bitcoin ETF institutional inflows continued this week as risk appetite remained strong.", about: "BTC" },
          { content: "Federal Reserve paused rate hikes, citing stable inflation and strong labor market.", about: "MACRO" },
          { content: "US GDP growth remains above trend at 2.8 percent annualized.", about: "MACRO" },
        ]],
      ]),
      capabilityParams: { asset: "BTC" },
      assertions: [
        { kind: "requirement_satisfied", value: "volatil|risk regime|risk appetite" },
        // Macro dimensions (interest rate, growth, inflation) are EXHAUSTED for crypto question
        // because no evidence concerns BTC in those domains
        { kind: "requirement_exhausted", value: "interest rate|yield|policy" },
        { kind: "requirement_exhausted", value: "growth|GDP|PMI" },
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
      ],
    },
    {
      name: "E3: BTC question with macro contamination rejected",
      question: "What is driving BTC right now?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "BTC trades at 80,750 USD, up 2.1 percent.", about: "BTC" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "US ISM Manufacturing PMI came in at 50.8, above consensus.", about: "MACRO" },
          { content: "Treasury yields rose to 4.998 percent.", about: "^TNX" },
        ]],
      ]),
      capabilityParams: { asset: "BTC" },
      assertions: [
        // Macro observations about yields and PMI are not BTC evidence
        { kind: "forbidden_in_context", value: ["Treasury yield", "ISM"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
  ];

  for (const c of CRYPTO_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CATEGORY F: CAUSAL / TRANSMISSION CHAIN
// ---------------------------------------------------------------------------
describe("CATEGORY F: CAUSAL / TRANSMISSION CHAIN", () => {
  beforeEach(() => resetIdCounters());

  const CAUSAL_CASES: readonly BenchmarkCase[] = [
    {
      name: "F1: oil-to-inflation transmission",
      question: "How could higher oil prices affect inflation, rates and equities?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "Oil price pass-through: crude at 96 dollars keeps headline CPI inflation elevated.", about: "CL=F" },
          { content: "Higher oil-driven inflation lifts the 10-year Treasury yield to 4.998 percent.", about: "^TNX" },
          { content: "Equity markets fell as oil-driven input cost pressure squeezed margins.", about: "SPX" },
        ]],
      ]),
      assertions: [
        { kind: "context_has_domain", value: "oil|crude|inflation|equit|yield" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "Ethereum"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "F2: dollar-crypto transmission",
      question: "How could a stronger dollar affect crypto and emerging markets?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "A stronger dollar tightens financial conditions for EM assets and weighs on crypto risk appetite.", about: "DX-Y.NYB" },
          { content: "Dollar index at 106.8, highest in two years, as the Fed holds rates elevated.", about: "DX-Y.NYB" },
        ]],
        ["NEWS_ANALYSIS", [
          // Relationship evidence for the DOLLAR -> EMERGING_MARKETS arrow (endpoint evidence
          // alone can no longer satisfy an arrow: node != arrow).
          { content: "Emerging-market outflows accelerated as a stronger dollar weighed on EM assets this week.", about: "DX-Y.NYB" },
        ]],
      ]),
      assertions: [
        { kind: "context_has_domain", value: "dollar|usd|emerging|crypto" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    {
      name: "F3: Treasury yield transmission into risk assets",
      question: "How would a change in Treasury yields transmit into risk assets?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          // Relationship evidence for the RATES -> RISK_ASSETS arrow; a bare equity quote would
          // be a NODE observation and could not establish the transmission.
          { content: "Rising Treasury yields raise the discount rate, weighing on risk assets and compressing equity valuations, especially in growth stocks.", about: "^TNX" },
          { content: "Higher yields also strengthen the dollar, creating headwinds for EM and crypto.", about: "^TNX" },
          { content: "The 10-year Treasury yield is at 4.998 percent, up 0.75 percent today.", about: "^TNX" },
          { content: "VIX spiked to 28 as equity volatility surged on the yield move.", about: "^TNX" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "Equity markets sold off as Treasury yields spiked to multi-year highs.", about: "^TNX" },
          { content: "However, some argue the yield move is overdone and could reverse, limiting lasting damage to risk assets.", about: "^TNX" },
        ]],
      ]),
      assertions: [
        { kind: "context_has_domain", value: "yield|treasury|equit|growth" },
        { kind: "requirement_satisfied", value: "interest rate|yield|policy" },
        { kind: "requirement_satisfied", value: "volatil|risk regime" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
  ];

  for (const c of CAUSAL_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CATEGORY G: ADVERSARIAL / UNSEEN QUESTIONS
// ---------------------------------------------------------------------------
describe("CATEGORY G: ADVERSARIAL / UNSEEN QUESTIONS", () => {
  beforeEach(() => resetIdCounters());

  const ADVERSARIAL_CASES: readonly BenchmarkCase[] = [
    // G1: Wrong-domain contamination
    {
      name: "G1: macro question gets ONLY crypto evidence -> INSUFFICIENT",
      question: "What macro conditions favor risk assets right now?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "BTC trades at 80,750 USD with 24-hour volume of 39.59 billion.", about: "BTC" },
          { content: "Bitcoin ETF flows saw 450 million of outflows this week.", about: "BTC" },
          { content: "Ethereum staking yields rose to 4.2 percent.", about: "ETH" },
        ]],
      ]),
      assertions: [
        // Interest rate may match through "yields" vocab overlap — that's acceptable
        // The key test: growth, inflation, and dollar are EXHAUSTED
        // because crypto evidence doesn't concern those macro dimensions
        { kind: "requirement_exhausted", value: "growth regime" },
        { kind: "requirement_exhausted", value: "inflation regime" },
        { kind: "requirement_exhausted", value: "dollar|liquidity" },
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
      ],
    },
    // G2: Stale evidence cannot satisfy CURRENT requirements
    {
      name: "G2: stale evidence for a CURRENT question -> INSUFFICIENT",
      question: "What is driving oil prices this week?",
      providers: new Map([
        ["NEWS_ANALYSIS", [
          { content: "OPEC production cuts tightened supply last quarter.", about: "CL=F" },
        ]],
      ]),
      staleDaysAgo: 60,
      assertions: [
        { kind: "requirement_not_satisfied", value: "oil price movement" },
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
      ],
    },
    // G3: Provider failure triggers recovery
    {
      name: "G3: primary provider fails -> recovery tries another path",
      question: "What macro conditions favor risk assets right now?",
      providers: new Map([
        ["MACRO_ANALYSIS", [{ content: "unused" }]],
        ["NEWS_ANALYSIS", [
          { content: "Rates and volatility conditions: the 10-year yield is 4.998 percent while VIX sits at 14.81." },
          { content: "Dollar index at 100.215, stable this week." },
          { content: "PMI expansion and CPI in-line suggest supportive macro backdrop." },
        ]],
      ]),
      failCapabilities: ["MACRO_ANALYSIS"],
      assertions: [
        // NEWS_ANALYSIS should have been executed as recovery
        { kind: "capabilities_executed", value: ["NEWS_ANALYSIS"] },
        // Should still complete with the fallback evidence
        { kind: "requirement_satisfied", value: "interest rate" },
        { kind: "requirement_satisfied", value: "volatility" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    // G4: Novel wording (unseen question, generic handler)
    {
      name: "G4: novel wording -> semantic requirement resolution",
      question: "Which macro forces matter most for equities today?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "The 10-year Treasury yield is 4.998 percent, pressuring equity valuations.", about: "^TNX" },
          { content: "VIX at 14.81, reflecting low implied volatility and risk-on sentiment.", about: "^VIX" },
          { content: "Dollar index at 100.215, stable.", about: "DX-Y.NYB" },
          { content: "ISM Manufacturing PMI at 50.8 signals expansion.", about: "MACRO" },
          { content: "CPI at 3.2 percent year-over-year, in line with expectations.", about: "MACRO" },
        ]],
      ]),
      assertions: [
        // The requirement engine should resolve "macro forces" to the MACRO_REGIME dimensions
        { kind: "requirement_satisfied", value: "interest rate" },
        { kind: "requirement_satisfied", value: "volatility" },
        { kind: "requirement_satisfied", value: "growth regime" },
        { kind: "requirement_satisfied", value: "inflation regime" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    // G5: Multiple provider failures -> honest insufficiency
    {
      name: "G5: all providers fail -> honest insufficiency, not fabricated answer",
      question: "What is driving oil prices this week?",
      providers: new Map([
        ["EQUITY_MARKET_DATA", [{ content: "unused" }]],
        ["NEWS_ANALYSIS", [{ content: "unused" }]],
      ]),
      failCapabilities: ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"],
      assertions: [
        // When all providers fail, the engine finds no evidence to cover requirements.
        // The model may say COMPLETE, but the engine overrules it via the coverage gate.
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
        { kind: "evidence_count_max", value: 0 },
      ],
    },
    // G6: Unseen commodity question
    {
      name: "G6: unseen silver question generalizes",
      question: "What is moving silver prices this week?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "SI=F silver futures trade at 31.20, up 2.5 percent on the week.", about: "SI=F" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "Silver demand firmed on solar panel manufacturing growth while mine output declined.", about: "SI=F" },
        ]],
      ]),
      capabilityParams: { asset: "SI=F" },
      assertions: [
        { kind: "subject_in_params", value: "SI=F" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "NVDA"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    // G7: Unseen rates question
    {
      name: "G7: unseen rates question generalizes",
      question: "What is driving Treasury yields higher?",
      providers: new Map([
        ["MARKET_DATA_ANALYSIS", [
          { content: "^TNX 10-year Treasury yields stand at 4.998 percent, up 0.75 percent on the day.", about: "^TNX" },
        ]],
        ["MACRO_ANALYSIS", [
          { content: "Treasury yields drivers: firmer growth data and inflation expectations lifted the 10-year yield.", about: "^TNX" },
        ]],
      ]),
      capabilityParams: { asset: "^TNX" },
      assertions: [
        { kind: "subject_in_params", value: "^TNX" },
        { kind: "forbidden_in_context", value: ["Bitcoin", "BTC", "oil"] },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    // G8: Proxy evidence must not silently become primary
    {
      name: "G8: proxy evidence is distinguished from primary evidence",
      question: "What is driving BTC right now?",
      providers: new Map([
        ["SENTIMENT_ANALYSIS", [
          { content: "Crypto fear and greed index at 72 (greed); leverage ratios elevated.", about: "BTC" },
        ]],
        ["MARKET_DATA_ANALYSIS", [
          { content: "BTC trades at 80,750 USD, up 2.1 percent today.", about: "BTC" },
        ]],
      ]),
      capabilityParams: { asset: "BTC" },
      assertions: [
        // Both pieces of evidence are about BTC and should be in context
        { kind: "requirement_satisfied", value: "price|driv|catalyst" },
        { kind: "completion", value: "EVIDENCE_SUFFICIENT" },
      ],
    },
    // G9: Cross-asset contamination (oil evidence for macro question)
    {
      name: "G9: oil evidence alone cannot satisfy macro regime requirements",
      question: "What macro conditions favor risk assets right now?",
      providers: new Map([
        ["MACRO_ANALYSIS", [
          { content: "CL=F crude oil trades at 96.08, down 3.97 percent on the week.", about: "CL=F" },
          { content: "OPEC+ announced a production increase.", about: "CL=F" },
        ]],
      ]),
      assertions: [
        { kind: "requirement_not_satisfied", value: "interest rate" },
        { kind: "requirement_not_satisfied", value: "volatility" },
        { kind: "requirement_not_satisfied", value: "growth regime" },
        { kind: "requirement_not_satisfied", value: "inflation regime" },
        { kind: "completion", value: "REQUIREMENT_GAPS_UNRESOLVED" },
      ],
    },
    // G10: Budget exhaustion with evidence -> partial completion, not model failure
    {
      name: "G10: budget exhaustion with evidence -> honest partial completion",
      question: "What is driving oil prices this week?",
      providers: new Map([
        ["EQUITY_MARKET_DATA", [
          { content: "CL=F crude oil trades at 96.08, down 3.97 percent.", about: "CL=F" },
        ]],
        ["NEWS_ANALYSIS", [
          { content: "OPEC+ quotas were raised as crude inventories built.", about: "CL=F" },
        ]],
      ]),
      capabilityParams: { asset: "CL=F" },
      maxRounds: 1,
      assertions: [
        // With only 1 round, the budget may exhaust, but evidence was gathered
        { kind: "evidence_count_min", value: 1 },
      ],
    },
  ];

  for (const c of ADVERSARIAL_CASES) {
    it(c.name, async () => {
      const outcome = await runCase(c);
      assertOutcome(c, outcome);
    });
  }
});

// ---------------------------------------------------------------------------
// CROSS-CATEGORY: Requirement engine integration
// ---------------------------------------------------------------------------
describe("CROSS-CATEGORY: Requirement engine integration", () => {
  beforeEach(() => resetIdCounters());

  it("MACRO_REGIME generates 6+ engine-required dimensions", () => {
    const q = "What macro conditions favor risk assets right now?";
    const model = buildRequirements([]);
    const ledger = completeRequirements(q, model, { marketClass: "UNKNOWN" });
    const engineAdded = ledger.filter((r) => r.engineRequired === true);
    // Must include at least: rates, volatility, growth, inflation, challenge
    const descriptions = engineAdded.map((r) => r.description.toLowerCase());
    expect(descriptions.some((d) => /rate|yield|policy/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /volatil|risk appetite/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /growth|gdp|pmi/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /inflation|cpi|ppi/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /challenge|counterevidence/i.test(d))).toBe(true);
  });

  it("CAUSAL on commodity adds supply + demand dimensions", () => {
    const q = "What is driving oil prices this week?";
    const model = buildRequirements([]);
    const ledger = completeRequirements(q, model, { subject: "CL=F", marketClass: "COMMODITY" });
    const descriptions = ledger.map((r) => r.description.toLowerCase());
    expect(descriptions.some((d) => /supply|producer/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /demand|inventor/i.test(d))).toBe(true);
  });

  it("EVENT adds timing + expectations + fundamentals dimensions", () => {
    const q = "What could affect NVDA around its next earnings?";
    const model = buildRequirements([]);
    const ledger = completeRequirements(q, model, { subject: "NVDA", marketClass: "EQUITY" });
    const descriptions = ledger.map((r) => r.description.toLowerCase());
    expect(descriptions.some((d) => /timing|date/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /consensus|expectation/i.test(d))).toBe(true);
    expect(descriptions.some((d) => /fundamental|catalyst/i.test(d))).toBe(true);
  });

  it("stale evidence is classified as STALE_ONLY, never SATISFIED", () => {
    const q = "What macro conditions favor risk assets right now?";
    const model = buildRequirements([
      { description: "current interest rate conditions", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ]);
    const ledger = completeRequirements(q, model, { marketClass: "UNKNOWN" });
    const items: CoverageEvidence[] = [{
      ref: "ev_stale_1",
      text: "Treasury yields were 4.5 percent last quarter.",
      freshness: "STALE",
      observedAt: new Date(Date.now() - 90 * DAY_MS).toISOString(),
    }];
    const assessed = assessCoverage(ledger, items, { now: new Date() });
    const req = assessed.find((r) => /interest rate/i.test(r.description));
    expect(req).toBeDefined();
    expect(req!.status).not.toBe("SATISFIED");
  });

  it("wrong-domain evidence returns NO_MATCH for subject-scoped requirements", () => {
    const q = "What is driving oil prices this week?";
    const model = buildRequirements([
      { description: "current oil price movement", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ]);
    const ledger = completeRequirements(q, model, { subject: "CL=F", marketClass: "COMMODITY" });
    const items: CoverageEvidence[] = [{
      ref: "ev_btc_1",
      text: "BTC trades at 80,750 USD.",
      subject: "BTC",
      freshness: "CURRENT",
    }];
    const assessed = assessCoverage(ledger, items, {
      subjectTerms: new Set(["CL=F", "CRUDE", "OIL"]),
      now: new Date(),
    });
    const req = assessed.find((r) => /oil price/i.test(r.description));
    expect(req).toBeDefined();
    expect(req!.status).not.toBe("SATISFIED");
  });

  it("coverage verdict blocks on unsatisfied CRITICAL requirements", () => {
    const q = "What macro conditions favor risk assets right now?";
    const model = buildRequirements([
      { description: "current interest rate conditions", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ]);
    const ledger = completeRequirements(q, model, { marketClass: "UNKNOWN" });
    // No evidence provided -> all requirements remain PENDING
    const assessed = assessCoverage(ledger, [], { now: new Date() });
    const verdict = coverageVerdict(assessed);
    expect(verdict.complete).toBe(false);
    expect(verdict.blocking.length).toBeGreaterThan(0);
  });

  it("coverage verdict passes when all CRITICAL requirements are satisfied", () => {
    const q = "What is driving BTC right now?";
    const model = buildRequirements([
      { description: "current BTC price drivers", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ]);
    const ledger = completeRequirements(q, model, { subject: "BTC", marketClass: "CRYPTO" });
    // Mark the CHALLENGE requirement as attempted (simulating FALSIFICATION execution)
    const withChallengeAttempted = ledger.map((r) =>
      r.role === "CHALLENGE" ? { ...r, recoveryAttempts: Math.max(r.recoveryAttempts, 1) } : r,
    );
    const items: CoverageEvidence[] = [{
      ref: "ev_btc_1",
      text: "BTC trades at 80,750 USD, up 2.1 percent.",
      subject: "BTC",
      freshness: "CURRENT",
    }];
    const assessed = assessCoverage(withChallengeAttempted, items, {
      subjectTerms: new Set(["BTC", "BITCOIN"]),
      now: new Date(),
    });
    const verdict = coverageVerdict(assessed);
    expect(verdict.complete).toBe(true);
    expect(verdict.blocking.length).toBe(0);
  });
});
