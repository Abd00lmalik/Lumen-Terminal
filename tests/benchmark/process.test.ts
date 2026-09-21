/**
 * Research-process benchmark harness (final benchmark mandate).
 *
 * Scores the PROCESS, not word matching: for each scenario the harness inspects the run's
 * actual objects (requirements, executions, evidence, decision) and measures
 *   - TARGET: the dispatched capability params carry the scenario's expected asset (or none
 *     for subjectless macro questions), never a forbidden one,
 *   - DOMAIN: accepted evidence matches the question's domain; forbidden evidence (crypto
 *     for macro) is either never dispatched, rejected at ingestion, or demoted from context,
 *   - COVERAGE: the engine's requirement ledger — crypto observations can never satisfy the
 *     macro regime requirement (VALID observation ≠ RELEVANT evidence),
 *   - COMPLETION: engine-owned; stale-only evidence cannot complete a CURRENT requirement —
 *     the run must end honestly insufficient instead,
 *   - FRESHNESS: a dated old observation offered to a CURRENT requirement is stale-only.
 *
 * The benchmark does NOT demand one exact answer: a cautious, well-supported answer with an
 * explicit unresolved requirement passes; a plausible answer built from irrelevant evidence
 * fails.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome, type RoundExecution } from "../../src/research/adaptive.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "benchmark" };
const DAY_MS = 86_400_000;

interface Scenario {
  readonly name: string;
  readonly question: string;
  readonly plan: string;
  /** Capability -> outputs, all served by one fixture provider per capability. */
  readonly providers: ReadonlyMap<string, readonly { content: string; about?: string }[]>;
  /** Caller-supplied capability params, mirroring the LUI's question-earned asset backstop. */
  readonly capabilityParams?: Record<string, unknown>;
  /** Fixture results carrying this field are observation-dated this many days ago (freshness probe). */
  readonly staleDaysAgo?: number;
  readonly expected: {
    readonly assetInParams?: string;
    readonly forbiddenAssetInParams?: string;
    readonly subjectless?: boolean;
    readonly forbiddenEvidenceDomains?: readonly string[];
    readonly forbiddenInContext?: readonly string[];
    readonly mustNotSatisfy?: string;
    readonly completion: "EVIDENCE_SUFFICIENT" | "REQUIREMENT_GAPS_UNRESOLVED";
  };
}

function capabilityFixture(
  name: string,
  outputs: readonly { content: string; about?: string }[],
  opts: { sourceTimestamp?: string } = {},
): ProviderAdapter {
  return {
    providerId: `harness/${name.toLowerCase()}`,
    capabilities: [name],
    limitations: ["benchmark fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
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

function planWithRequirements(question: string, requirements: unknown[], capabilities: string[]): string {
  return JSON.stringify({
    objective: question,
    scopeIncluded: ["everything the question asks"], scopeExcluded: [],
    tasks: [{ type: "FACT_FINDING", objective: question, capabilities, completion: "requirements covered or absence recorded" }],
    requirements,
    completionCriteria: ["requirements covered or honest insufficiency"],
    adaptationPolicy: "n/a",
  });
}

const MACRO_QUESTION = "What macro conditions favor risk assets right now?";
const MACRO_REQUIREMENTS = [
  { description: "current risk asset macro regime: rates, dollar, and volatility conditions", importance: "CRITICAL", timeSensitivity: "CURRENT" },
];
const BTC_QUESTION = "What is happening with BTC today?";
const BTC_REQUIREMENTS = [
  { description: "current developments for BTC", importance: "CRITICAL", timeSensitivity: "CURRENT" },
];

const SCENARIOS: readonly Scenario[] = [
  {
    name: "macro regime question with genuinely current macro evidence",
    question: MACRO_QUESTION,
    plan: planWithRequirements(MACRO_QUESTION, MACRO_REQUIREMENTS, ["MACRO_ANALYSIS"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [
        { content: "The 10-year Treasury yield is 4.998 percent, up 0.75 percent today." },
        { content: "The US dollar index DXY trades at 100.215, firmer on the day." },
        { content: "VIX is 14.81, down 13.4 percent, with the S&P 500 resilient at 7,650." },
      ]],
    ]),
    expected: {
      subjectless: true, // a subjectless macro question must NOT inherit any asset
      completion: "EVIDENCE_SUFFICIENT",
    },
  },
  // NOTE: fixtures use CANONICAL capability names only — the planner vocabulary is the
  // contract, and a model-invented name ("BTC_PRICE_ANALYSIS") is correctly dropped before
  // dispatch (verified live in an earlier harness draft: zero capability calls executed).
  {
    name: "macro question offered ONLY crypto evidence (adversarial: valid observations, wrong domain)",
    question: MACRO_QUESTION,
    plan: planWithRequirements(MACRO_QUESTION, MACRO_REQUIREMENTS, ["MARKET_DATA_ANALYSIS"]),
    providers: new Map([
      ["MARKET_DATA_ANALYSIS", [
        { content: "BTC trades at 80,750 USD with a 24-hour volume of 39.59 billion USD.", about: "BTC" },
        { content: "Bitcoin ETF flows saw 450 million USD of outflows this week.", about: "BTC" },
      ]],
    ]),
    expected: {
      subjectless: true,
      forbiddenInContext: ["BTC", "Bitcoin", "ETF"],
      mustNotSatisfy: "risk asset macro regime",
      completion: "REQUIREMENT_GAPS_UNRESOLVED",
    },
  },
  {
    name: "BTC question with crypto evidence (the gate must not over-reject)",
    question: BTC_QUESTION,
    plan: planWithRequirements(BTC_QUESTION, BTC_REQUIREMENTS, ["MARKET_DATA_ANALYSIS"]),
    providers: new Map([
      ["MARKET_DATA_ANALYSIS", [
        { content: "BTC trades at 80,750 USD, up 2.1 percent today, with elevated volatility.", about: "BTC" },
      ]],
    ]),
    // The question NAMES BTC, so the LUI's question-earned backstop passes the asset to
    // capability params (production dispatch path); the loop receives it as the caller.
    capabilityParams: { asset: "BTC" },
    expected: {
      assetInParams: "BTC",
      completion: "EVIDENCE_SUFFICIENT",
    },
  },
  {
    name: "oil question: drivers evidence satisfies the oil requirements, crypto never routed",
    question: "What is driving oil prices this week?",
    plan: planWithRequirements("What is driving oil prices this week?", [
      { description: "current oil price action", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "oil-specific supply and demand developments", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MARKET_DATA_ANALYSIS", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["MARKET_DATA_ANALYSIS", [
        { content: "CL=F crude oil price trades at 96.08, down 3.97 percent on the week.", about: "CL=F" },
      ]],
      ["NEWS_ANALYSIS", [
        { content: "OPEC+ announced a production increase; crude oil inventories drew sharply this week.", about: "CL=F" },
        // Wrong-domain item in the same payload: the engine must reject it (subject terms
        // resolved for this question) or never admit it to a requirement.
        { content: "BTC ETF flows hit a record as crypto markets rally on regulation hopes.", about: "BTC" },
      ]],
    ]),
    capabilityParams: { asset: "CL=F" },
    expected: {
      assetInParams: "CL=F",
      forbiddenInContext: ["Bitcoin", "ETF"],
      completion: "EVIDENCE_SUFFICIENT",
    },
  },
  {
    name: "NVDA earnings question: earnings + news evidence, no crypto",
    question: "What could affect NVDA around its next earnings?",
    plan: planWithRequirements("What could affect NVDA around its next earnings?", [
      { description: "upcoming NVDA earnings date and consensus estimates", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "recent NVDA company developments and catalysts", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EARNINGS_CALENDAR", "EQUITY_NEWS"]),
    providers: new Map([
      ["EARNINGS_CALENDAR", [
        { content: "NVDA next earnings date is 2026-10-28; consensus EPS estimate 1.05 with revenue estimate 54 billion.", about: "NVDA" },
      ]],
      ["EQUITY_NEWS", [
        { content: "NVDA company developments: datacenter demand catalyst strengthens the AI accelerator outlook.", about: "NVDA" },
        { content: "Bitcoin ETF inflows resumed as crypto sentiment improved.", about: "BTC" },
      ]],
    ]),
    capabilityParams: { asset: "NVDA" },
    expected: {
      assetInParams: "NVDA",
      forbiddenInContext: ["Bitcoin"],
      completion: "EVIDENCE_SUFFICIENT",
    },
  },
  {
    name: "legitimate cross-domain question (oil -> inflation + equities) keeps both domains",
    question: "How could oil prices affect inflation and equities?",
    plan: planWithRequirements("How could oil prices affect inflation and equities?", [
      { description: "how oil price movements transmit into inflation", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "how oil price movements affect equity markets", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [{ content: "Oil price shocks feed through to CPI inflation and equity valuations via input costs.", about: "CL=F" }]],
      ["NEWS_ANALYSIS", [{ content: "Equity markets fell as oil-driven inflation concerns rose this week.", about: "CL=F" }]],
    ]),
    capabilityParams: { asset: "CL=F" },
    expected: {
      assetInParams: "CL=F",
      forbiddenEvidenceDomains: ["ONCHAIN", "DEFI"],
      completion: "EVIDENCE_SUFFICIENT",
    },
  },
  {
    name: "unseen subjectless question generalizes without a question-specific handler",
    question: "What could pressure semiconductor stocks this quarter?",
    plan: planWithRequirements("What could pressure semiconductor stocks this quarter?", [
      { description: "current semiconductor demand and supply conditions", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "semiconductor sector company developments", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["NEWS_ANALYSIS"]),
    providers: new Map([
      ["NEWS_ANALYSIS", [
        { content: "Semiconductor demand weakened as chip inventories rose and foundry utilization fell this quarter." },
      ]],
    ]),
    expected: {
      subjectless: true,
      completion: "EVIDENCE_SUFFICIENT",
    },
  },
  {
    name: "stale-only macro evidence cannot complete a CURRENT regime question",
    question: MACRO_QUESTION,
    plan: planWithRequirements(MACRO_QUESTION, MACRO_REQUIREMENTS, ["MACRO_ANALYSIS"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [
        { content: "Treasury yields, the dollar, and volatility conditions were mixed last month." },
      ]],
    ]),
    staleDaysAgo: 45,
    expected: {
      subjectless: true,
      mustNotSatisfy: "risk asset macro regime",
      completion: "REQUIREMENT_GAPS_UNRESOLVED",
    },
  },
];

async function runScenario(scenario: Scenario): Promise<AdaptiveLoopOutcome> {
  const provider = new FakeModelProvider(new Map([
    ["research.plan", scenario.plan],
    ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
    // Recovery is scheduled only when a compatible capability is registered; without a
    // scripted decision for later rounds the loop ends at the gate either way.
    ["research.answer_synthesis", JSON.stringify({
      direct: "Direct answer for the question.",
      why: "Because the validated evidence establishes the factors above.",
      support: [{ statement: "Evidence-grounded support.", refs: [] }],
      oppose: [{ statement: "Meaningful opposition where it exists.", refs: [] }],
      factors: [{ factor: "rates and dollar conditions", mechanism: "valuation and liquidity channel", direction: "headwind", refs: [] }],
      uncertainty: "Whether the yield trend persists is not established by the available observations.",
    })],
  ]));
  const registry = new CapabilityRegistry();
  const staleTs = scenario.staleDaysAgo !== undefined ? new Date(Date.now() - scenario.staleDaysAgo * DAY_MS).toISOString() : undefined;
  for (const [capability, outputs] of scenario.providers) {
    registry.register(capabilityFixture(capability, outputs, { ...(staleTs !== undefined ? { sourceTimestamp: staleTs } : {}) }));
  }

  const ws = new Workspace();
  const research = ws.addResearch(
    { objective: scenario.question, question: scenario.question, flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
    origin,
  );
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

  return runAdaptiveResearch(scenario.question, research.id, {
    provider, registry, workspace: ws, store: new MemoryStore(), maxRounds: 2,
    ...(scenario.capabilityParams !== undefined ? { capabilityParams: scenario.capabilityParams } : {}),
  });
}

function annotate(label: string, outcome: AdaptiveLoopOutcome, params: Record<string, unknown>[]): void {
  const lines = [
    `  [${label}]`,
    `  completion: ${outcome.stoppedBecause} | decision: ${outcome.finalDecision.decision}`,
    `  assets dispatched: ${JSON.stringify([...new Set(params.map((p) => p["asset"]).filter(Boolean))])}`,
    `  evidence: ${outcome.evidence.length} item(s); context: ${outcome.context.items.length}`,
    `  requirements: ${outcome.requirements.map((r) => `${r.description.slice(0, 44)}…=${r.status}`).join(" | ") || "(none)"}`,
  ];
  console.log(lines.join("\n"));
}

describe("research process benchmark (scores process, not word matching)", () => {
  beforeEach(() => resetIdCounters());

  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const seenParams: Record<string, unknown>[] = [];
      const seenCaps: string[] = [];
      const provider = new FakeModelProvider(new Map([
        ["research.plan", scenario.plan],
        ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
        ["research.answer_synthesis", JSON.stringify({
          direct: "Direct answer for the question.",
          why: "Because the validated evidence establishes the factors above.",
          support: [{ statement: "Evidence-grounded support.", refs: [] }],
          oppose: [{ statement: "Meaningful opposition where it exists.", refs: [] }],
          factors: [{ factor: "rates and dollar conditions", mechanism: "valuation and liquidity channel", direction: "headwind", refs: [] }],
          uncertainty: "Whether the yield trend persists is not established by the available observations.",
        })],
      ]));
      const registry = new CapabilityRegistry();
      const staleTs = scenario.staleDaysAgo !== undefined ? new Date(Date.now() - scenario.staleDaysAgo * DAY_MS).toISOString() : undefined;
      for (const [capability, outputs] of scenario.providers) {
        const wrapped = capabilityFixture(capability, outputs, { ...(staleTs !== undefined ? { sourceTimestamp: staleTs } : {}) });
        registry.register({
          providerId: wrapped.providerId,
          capabilities: wrapped.capabilities,
          limitations: wrapped.limitations,
          freshnessProfile: wrapped.freshnessProfile,
          async execute(cap, params) {
            seenCaps.push(cap);
            seenParams.push(params);
            return wrapped.execute(cap, params);
          },
        });
      }

      const ws = new Workspace();
      const research = ws.addResearch(
        { objective: scenario.question, question: scenario.question, flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
        origin,
      );
      ws.transitionResearch(research.id, "ACTIVE", origin, "activated");

      const outcome = await runAdaptiveResearch(scenario.question, research.id, {
        provider, registry, workspace: ws, store: new MemoryStore(), maxRounds: 2,
        ...(scenario.capabilityParams !== undefined ? { capabilityParams: scenario.capabilityParams } : {}),
      });

      annotate(scenario.name, outcome, seenParams);

      // TARGET: the dispatched params carry the expected asset (or none for subjectless
      // questions), never a forbidden inherited one.
      if (scenario.expected.assetInParams !== undefined) {
        expect(seenParams.length).toBeGreaterThan(0);
        expect(seenParams.every((p) => p["asset"] === scenario.expected.assetInParams)).toBe(true);
      }
      if (scenario.expected.subjectless === true) {
        for (const p of seenParams) {
          expect(p["asset"]).toBeUndefined();
        }
      }
      if (scenario.expected.forbiddenAssetInParams !== undefined) {
        for (const p of seenParams) {
          expect(p["asset"]).not.toBe(scenario.expected.forbiddenAssetInParams);
        }
      }

      // DOMAIN: forbidden evidence never becomes this run's accepted evidence.
      if (scenario.expected.forbiddenEvidenceDomains !== undefined) {
        for (const e of outcome.evidence) {
          for (const forbidden of scenario.expected.forbiddenEvidenceDomains) {
            expect(e.evidenceType).not.toContain(forbidden);
          }
        }
      }

      // CONTEXT: forbidden subjects are demoted from synthesis context (or never entered).
      if (scenario.expected.forbiddenInContext !== undefined) {
        const contextText = outcome.context.items.map((i) => i.text).join(" ");
        for (const term of scenario.expected.forbiddenInContext) {
          expect(contextText).not.toContain(term);
        }
      }

      // COVERAGE: the named requirement must not be satisfied (e.g. crypto observations can
      // never satisfy the macro regime requirement; stale evidence cannot satisfy CURRENT).
      if (scenario.expected.mustNotSatisfy !== undefined) {
        const req = outcome.requirements.find((r) => r.description.includes(scenario.expected.mustNotSatisfy!));
        expect(req).toBeDefined();
        expect(req!.status === "SATISFIED").toBe(false);
      }

      // COMPLETION: engine-owned verdict.
      expect(outcome.stoppedBecause).toBe(scenario.expected.completion);
    });
  }

  it("a non-discriminating placeholder requirement never empties the synthesis context", async () => {
    // Regression (found by this harness): the engine's own placeholder requirement
    // ("relevant evidence for the research question", GENERAL domain, no market vocabulary)
    // states no criterion an observation could meet — if it participated in the admission
    // gate it would exclude EVERY item of every run that used it.
    const question = "What happened to BTC today?";
    const provider = new FakeModelProvider(new Map([
      ["research.plan", planWithRequirements(question, [], ["MARKET_DATA_ANALYSIS"])],
      ["research.adaptive_decision", responses.adaptiveDecision("COMPLETE")],
      ["research.answer_synthesis", JSON.stringify({
        direct: "Direct answer.", why: "Because evidence establishes it.",
        support: [{ statement: "s", refs: [] }], oppose: [],
        factors: [{ factor: "f", mechanism: "m", direction: "neutral", refs: [] }],
        uncertainty: "u",
      })],
    ]));
    const registry = new CapabilityRegistry();
    registry.register(capabilityFixture("MARKET_DATA_ANALYSIS", [
      { content: "BTC trades at 80,750 USD today with elevated volume.", about: "BTC" },
    ]));
    const ws = new Workspace();
    const research = ws.addResearch({ objective: question, question, flow: "WHAT_HAPPENED" }, origin);
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
    const outcome = await runAdaptiveResearch(question, research.id, {
      provider, registry, workspace: ws, store: new MemoryStore(), maxRounds: 1,
      capabilityParams: { asset: "BTC" },
    });
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(outcome.context.items.length).toBeGreaterThan(0);
    expect(outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
  });

  it("honest insufficiency names the unmet requirement (never fabricated coverage)", async () => {
    const scenario = SCENARIOS[1]!;
    const outcome = await runScenario(scenario);
    const macroReq = outcome.requirements.find((r) => r.description.includes("risk asset macro regime"));
    expect(macroReq).toBeDefined();
    // The engine could not satisfy the requirement: it is not SATISFIED, and the run's
    // insufficiency rationale names requirements (not provider diagnostics).
    expect(macroReq!.status === "SATISFIED").toBe(false);
    expect(outcome.finalDecision.rationale).toMatch(/regime|requirement|evidence/i);
  });
});
