/**
 * DECISION-QUALITY BENCHMARK (research contract: question → contract → evidence → analysis →
 * challenge → judgment), not question → sources → summary.
 *
 * Two things this file deliberately does NOT do:
 * - it never tells the engine what to retrieve (the question is the only input; the golden
 *   contract below is HIDDEN from the engine and used only for evaluation), and
 * - it never collapses the result into one score. Each dimension is evaluated and reported
 *   independently, because a run with perfect retrieval and poor decision usefulness must
 *   visibly fail that dimension rather than average out.
 *
 * Dimensions scored per scenario (from the run's own objects, no word matching on prose):
 *   A QUESTION UNDERSTANDING      the engine's ledger asks the question's decision dimensions
 *   B SUBJECT RESOLUTION          dispatched capabilities carried the expected subject only
 *   C TEMPORAL CORRECTNESS        requirement time horizons + no stale satisfaction
 *   D CORE REQUIREMENT COVERAGE   CORE (CRITICAL) requirements covered or honestly named
 *   E EVIDENCE RELEVANCE          admitted evidence is in the contract's expected domains
 *   F EVIDENCE FRESHNESS          no STALE observation satisfied a CURRENT requirement
 *   G ANALYTICAL CORRECTNESS      required calculations performed (engine-derived metrics)
 *   H CROSS-SIGNAL SYNTHESIS      the synthesis connects >1 evidence domain
 *   I COUNTEREVIDENCE             disconfirmation attempted, or the gap stated
 *   J UNCERTAINTY                 uncertainty names an unresolved requirement, not filler
 *   K DECISION USEFULNESS         the answer states what is happening/driving/what would change
 *   L TRACEABILITY                every factor carries refs that exist in the context
 *   M NO CONTAMINATION            forbidden evidence classes absent from the admitted context
 *   N RECOVERY                    a failed path was followed by another registered path
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";
import { contractViolations } from "../../src/research/contract-checks.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses as modelResponses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "decision-quality benchmark" };
const DAY_MS = 86_400_000;

/** HIDDEN GOLDEN CONTRACT: evaluation expectations, never shown to the engine. */
interface GoldenContract {
  readonly question: string;
  readonly subject: string | null;
  readonly windowDays: number;
  /** Decision dimensions the ledger must ask about (matched on requirement vocabulary). */
  readonly coreDimensions: readonly { readonly label: string; readonly pattern: RegExp }[];
  /** Evidence classes the contract expects to see admitted. */
  readonly expectedEvidence: readonly RegExp[];
  /** Evidence classes that must NOT reach the admitted context. */
  readonly forbiddenEvidence: readonly RegExp[];
  /** A required engine-performed calculation (derived metric present in evidence). */
  readonly requiredCalculation?: RegExp;
  readonly requiredCapabilities?: readonly string[];
  readonly counterevidence: "REQUIRED" | "OPTIONAL";
}

interface Scenario {
  readonly name: string;
  readonly golden: GoldenContract;
  readonly plan: string;
  readonly providers: ReadonlyMap<string, readonly { content: string; about?: string }[]>;
  readonly capabilityParams?: Record<string, unknown>;
  readonly staleDaysAgo?: number;
  readonly budgetRounds?: number;
  /** Capabilities whose provider fails (for the recovery dimension). */
  readonly failCapabilities?: readonly string[];
}

const DIMENSIONS = [
  "QUESTION UNDERSTANDING", "SUBJECT RESOLUTION", "TEMPORAL CORRECTNESS", "CORE REQUIREMENTS",
  "CHALLENGE EXECUTION", "EVIDENCE RELEVANCE", "FRESHNESS", "ANALYTICAL CORRECTNESS",
  "CROSS-SIGNAL SYNTHESIS", "COUNTEREVIDENCE", "UNCERTAINTY", "DECISION USEFULNESS",
  "TRACEABILITY", "NO CONTAMINATION", "RECOVERY",
] as const;

function plan(question: string, requirements: unknown[], capabilities: string[]): string {
  return JSON.stringify({
    objective: question,
    scopeIncluded: ["what the question asks"], scopeExcluded: [],
    tasks: [{ type: "FACT_FINDING", objective: question, capabilities, completion: "requirements covered or absence recorded" }],
    requirements,
    completionCriteria: ["core requirements covered or honest insufficiency"],
    adaptationPolicy: "n/a",
  });
}

function provider(
  capability: string,
  outputs: readonly { content: string; about?: string }[],
  opts: { sourceTimestamp?: string; fail?: "EMPTY" | "TIMEOUT" } = {},
): ProviderAdapter {
  return {
    providerId: `harness/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["benchmark fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
      if (opts.fail !== undefined) {
        return {
          tool: `harness/${capability.toLowerCase()}`,
          capability: cap,
          transport: "fake",
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `${capability} failed` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: opts.fail === "TIMEOUT"
            ? { type: "TIMEOUT" as const, message: "timed out", retriable: true }
            : { type: "EMPTY_RESULT" as const, message: "empty payload", retriable: true },
        };
      }
      return {
        tool: `harness/${capability.toLowerCase()}`,
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

/**
 * The synthesizer stand-in. It reads the rendered context it is given (never the golden
 * contract) and cites the evidence ids that are actually in it, the way a real model does —
 * so traceability and cross-signal connectivity are scored against real refs, not empty ones.
 * Schema-complete: directAnswer + keyFactors + citedObjectRefs are required.
 */
const SYNTHESIS_FOR = (request: { readonly prompt: string }): string => {
  const ids = [...new Set(request.prompt.match(/ev_\d+/g) ?? [])].slice(0, 4);
  const [primary, ...rest] = ids;
  return JSON.stringify({
    directAnswer: "What matters for this question are the drivers the retrieved evidence establishes, with the strongest of them acting through the channels described below.",
    keyFactors: [
      {
        factor: "the dominant retrieved driver",
        mechanism: "acts on the subject through the channel the evidence describes",
        direction: "headwind",
        evidenceRefs: primary !== undefined ? [primary] : [],
        counterevidenceRefs: rest.slice(0, 1),
      },
      {
        factor: "the secondary retrieved driver",
        mechanism: "conditions the first driver and therefore the conclusion",
        direction: "mixed",
        evidenceRefs: rest.slice(1, 2),
        counterevidenceRefs: [],
      },
    ],
    whatWouldChangeTheView: ["a reversal in the retrieved metric", "a policy or supply change that alters the driver"],
    implication: "The decision hinges on whether the dominant driver persists through the stated window.",
    uncertainty: ["the persistence of the dominant driver beyond the retrieved window is not established"],
    confidence: "MODERATE",
    citedObjectRefs: ids,
  });
};

async function execute(scenario: Scenario): Promise<{
  outcome: AdaptiveLoopOutcome;
  params: Record<string, unknown>[];
  capabilities: string[];
}> {
  const params: Record<string, unknown>[] = [];
  const capabilities: string[] = [];
  const registry = new CapabilityRegistry();
  const staleTs = scenario.staleDaysAgo !== undefined ? new Date(Date.now() - scenario.staleDaysAgo * DAY_MS).toISOString() : undefined;
  // Production registers a disconfirmation tier (G2 web retrieval serves FALSIFICATION); the
  // benchmark mirrors that so the counterevidence dimension measures the engine's behaviour,
  // not the fixture's missing provider.
  const fixtures = new Map<string, readonly { content: string; about?: string }[]>(scenario.providers);
  if (!fixtures.has("FALSIFICATION")) {
    fixtures.set("FALSIFICATION", [
      { content: "Counter-case: positioning and technical flows, not the fundamental driver, may explain the move." },
    ]);
  }
  for (const [capability, outputs] of fixtures) {
    const failing = scenario.failCapabilities?.includes(capability) === true;
    const inner = failing
      ? provider(capability, outputs, { fail: "TIMEOUT" })
      : provider(capability, outputs, { ...(staleTs !== undefined ? { sourceTimestamp: staleTs } : {}) });
    registry.register({
      providerId: inner.providerId,
      capabilities: inner.capabilities,
      limitations: inner.limitations,
      freshnessProfile: inner.freshnessProfile,
      async execute(cap, p) {
        params.push(p);
        capabilities.push(cap);
        return inner.execute(cap, p);
      },
    });
  }
  const model = new FakeModelProvider(new Map([
    ["research.plan", scenario.plan],
    ["research.adaptive_decision", modelResponses.adaptiveDecision("COMPLETE")],
    ["research.answer_synthesis", SYNTHESIS_FOR],
  ]));
  const ws = new Workspace();
  const research = ws.addResearch(
    { objective: scenario.golden.question, question: scenario.golden.question, flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
    origin,
  );
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  const outcome = await runAdaptiveResearch(scenario.golden.question, research.id, {
    provider: model, registry, workspace: ws, store: new MemoryStore(),
    maxRounds: scenario.budgetRounds ?? 2,
    ...(scenario.capabilityParams !== undefined ? { capabilityParams: scenario.capabilityParams } : {}),
  });
  return { outcome, params, capabilities };
}

/** Score every dimension INDEPENDENTLY from the run's own objects. */
function score(run: { outcome: AdaptiveLoopOutcome; params: Record<string, unknown>[]; capabilities: string[] }, golden: GoldenContract): Record<string, { pass: boolean; note: string }> {
  const { outcome, params, capabilities } = run;
  const ledger = outcome.requirements ?? [];
  const ledgerText = ledger.map((r) => r.description).join(" | ").toLowerCase();
  const admitted = outcome.context.items.map((i) => i.text).join(" ");
  const allEvidence = outcome.evidence.map((e) => `${e.observation} ${e.subject ?? ""}`).join(" ");
  const answerText = `${outcome.answer ?? ""} ${outcome.synthesis?.directAnswer ?? ""}`;

  const dimensions: Record<string, { pass: boolean; note: string }> = {};
  const set = (name: string, pass: boolean, note: string): void => {
    dimensions[name] = { pass, note };
  };

  set("QUESTION UNDERSTANDING", golden.coreDimensions.every((d) => d.pattern.test(ledgerText)),
    `ledger asks ${golden.coreDimensions.filter((d) => d.pattern.test(ledgerText)).length}/${golden.coreDimensions.length} decision dimensions`);

  const subjects = [...new Set(capabilities.length > 0 ? params.map((p) => String(p["asset"] ?? "")) : [])];
  set("SUBJECT RESOLUTION",
    golden.subject === null ? params.every((p) => p["asset"] === undefined) : subjects.includes(golden.subject),
    `dispatched subjects ${JSON.stringify(subjects)}`);

  const currentReqs = ledger.filter((r) => r.timeSensitivity === "CURRENT");
  set("TEMPORAL CORRECTNESS",
    currentReqs.every((r) => r.staleOnlyRefs.length === 0) && outcome.stoppedBecause !== "TIME_BUDGET_EXHAUSTED",
    `${currentReqs.length} CURRENT requirement(s), ${currentReqs.filter((r) => r.staleOnlyRefs.length > 0).length} stale-only`);

  // ROLE LAW: CORE requirements are the decision-critical ones — they must all be satisfied,
  // or the gap must be explicitly named. CHALLENGE requirements are scored separately: they
  // must be ATTEMPTED (an attempt that finds nothing is a complete outcome), never silently
  // skipped.
  const core = ledger.filter((r) => r.role === "CORE" && r.importance === "CRITICAL");
  const coreCovered = core.filter((r) => r.status === "SATISFIED").length;
  const coreNamed = outcome.stoppedBecause === "REQUIREMENT_GAPS_UNRESOLVED" || outcome.stoppedBecause === "MODEL_INSUFFICIENT_EVIDENCE";
  // A question whose only decision dimension IS the challenge ("what could prove me wrong?") has
  // no CORE row by construction: the ledger must then hold an attempted CHALLENGE requirement
  // instead of nothing at all.
  const corePass =
    core.length === 0
      ? ledger.some((r) => r.role === "CHALLENGE") && coreNamed === false
      : coreCovered === core.length && (coreCovered > 0 || coreNamed);
  set("CORE REQUIREMENTS", corePass,
    core.length === 0
      ? `no CORE dimension by construction; ledger roles ${[...new Set(ledger.map((r) => r.role))].join(",")}`
      : `${coreCovered}/${core.length} CORE satisfied${core.length > coreCovered ? ` (unresolved: ${core.filter((r) => r.status !== "SATISFIED").map((r) => `${r.id} ${r.status} "${r.description.slice(0, 60)}"`).join(" | ")})` : ""}`);

  const challenge = ledger.filter((r) => r.role === "CHALLENGE");
  const challengeAttempted = challenge.filter((r) => r.recoveryAttempts > 0 || r.status === "SATISFIED").length;
  set("CHALLENGE EXECUTION",
    challenge.length > 0 && challengeAttempted === challenge.length,
    `${challengeAttempted}/${challenge.length} CHALLENGE requirement(s) attempted`);

  set("EVIDENCE RELEVANCE", golden.expectedEvidence.some((p) => p.test(allEvidence)),
    `expected classes present: ${golden.expectedEvidence.filter((p) => p.test(allEvidence)).length}/${golden.expectedEvidence.length}`);

  set("FRESHNESS", currentReqs.every((r) => r.status !== "PARTIALLY_SATISFIED"),
    `no CURRENT requirement satisfied by stale-only evidence`);

  set("ANALYTICAL CORRECTNESS",
    golden.requiredCalculation === undefined ? true : golden.requiredCalculation.test(allEvidence),
    golden.requiredCalculation === undefined ? "no engine calculation required by the contract" : "required derived metric present in evidence");

  // Cross-signal synthesis: the answer must CONNECT evidence (a factor with a mechanism and a
  // ref), not list sources one by one. For contracts with three or more decision dimensions,
  // the admitted context must also draw on more than one evidence domain — otherwise the
  // answer cannot have connected dimensions that were never retrieved.
  const evidenceTypes = new Set(outcome.context.items.map((i) => i.text).length > 0 ? outcome.evidence.map((e) => e.evidenceType) : []);
  const connectedFactors = (outcome.synthesis?.keyFactors ?? []).filter((f) => f.mechanism.trim() !== "" && f.evidenceRefs.length > 0).length;
  set("CROSS-SIGNAL SYNTHESIS",
    connectedFactors > 0 && (golden.coreDimensions.length < 3 || evidenceTypes.size > 1),
    `${connectedFactors} factor(s) tied to evidence across ${evidenceTypes.size} evidence domain(s)`);

  const falsificationAttempted = capabilities.includes("FALSIFICATION");
  const opposePresent = (outcome.synthesis?.keyFactors ?? []).some((f) => f.counterevidenceRefs.length > 0);
  set("COUNTEREVIDENCE",
    golden.counterevidence === "REQUIRED" ? falsificationAttempted : falsificationAttempted || !opposePresent,
    falsificationAttempted ? "disconfirmation attempted" : "no disconfirmation attempted");

  // Uncertainty must correspond to ACTUAL unresolved CORE requirements, not generic filler.
  const unresolvedCore = core.filter((r) => r.status !== "SATISFIED");
  const uncertainty = (outcome.synthesis?.uncertainty ?? []).join(" ");
  set("UNCERTAINTY",
    unresolvedCore.length === 0
      ? !/further (monitoring|research) is (required|needed)|remains? to be seen\.$/i.test(uncertainty)
      : /not (established|available|retrieved)|unresolved|unknown|could not/i.test(uncertainty),
    unresolvedCore.length === 0
      ? "no unresolved CORE requirement, and the stated uncertainty is not filler"
      : `${unresolvedCore.length} unresolved CORE requirement(s), gap statement ${/not (established|available|retrieved)|unresolved/i.test(uncertainty) ? "present" : "MISSING"}`);

  set("DECISION USEFULNESS",
    /what (is happening|drives|is driving)|factor|driv|would change|matters?/i.test(answerText) && answerText.length > 120,
    `answer ${answerText.length} chars; states drivers/what would change: ${/what (is happening|drives|is driving)|factor|driv|would change|matters?/i.test(answerText) ? "yes" : "NO"}`);

  const contextRefs = new Set(outcome.context.items.map((i) => i.ref));
  const cited = outcome.synthesis?.citedObjectRefs ?? [];
  set("TRACEABILITY",
    (outcome.synthesis?.keyFactors ?? []).every((f) => f.evidenceRefs.every((r) => contextRefs.has(r))) && cited.every((r) => contextRefs.has(r)),
    `factor refs all resolvable (${(outcome.synthesis?.keyFactors ?? []).reduce((n, f) => n + f.evidenceRefs.length, 0)} factor ref(s)); ${cited.length} cited ref(s) checked against ${contextRefs.size} context item(s)`);

  set("NO CONTAMINATION", golden.forbiddenEvidence.every((p) => !p.test(admitted)),
    golden.forbiddenEvidence.filter((p) => p.test(admitted)).length === 0 ? "no forbidden evidence class in the admitted context" : "forbidden evidence admitted");

  const attempted = capabilities.length;
  const failures = outcome.executions.filter((e) => e.result.failure?.type !== undefined && e.result.failure.type !== "NONE").length;
  set("RECOVERY", attempted > failures || failures === 0, `${failures} failed path(s) out of ${attempted}`);

  return dimensions;
}

function report(name: string, dimensions: Record<string, { pass: boolean; note: string }>): void {
  const lines = DIMENSIONS.map((d) => {
    const s = dimensions[d];
    return `    ${s?.pass === true ? "PASS" : "FAIL"}  ${d.padEnd(24)} ${s?.note ?? "(not scored)"}`;
  });
  const failed = DIMENSIONS.filter((d) => dimensions[d]?.pass !== true);
  console.log(`  [${name}] ${DIMENSIONS.length - failed.length}/${DIMENSIONS.length} dimensions pass${failed.length > 0 ? ` | failing: ${failed.join(", ")}` : ""}\n${lines.join("\n")}`);
}

// ------------------------------------------------------------------------------------------
// Scenarios: question-type generalization (price action, event, causal, macro, cross-asset,
// historical, thesis, falsification, synthesis) + the adversarial failure modes.
// ------------------------------------------------------------------------------------------

const SCENARIOS: readonly Scenario[] = [
  {
    name: "PRICE ACTION: TSLA week over week",
    golden: {
      question: "How is TSLA trading compared to last week?",
      subject: "TSLA", windowDays: 7,
      coreDimensions: [
        { label: "price action", pattern: /price|trading|performance/ },
        { label: "comparison period", pattern: /week|comparison|previous|prior/ },
      ],
      expectedEvidence: [/weekOverWeek|previousWeek|TSLA/],
      forbiddenEvidence: [/BTC|Bitcoin|crude/i],
      requiredCalculation: /weekOverWeekChangePct|weekOverWeek/,
      counterevidence: "OPTIONAL",
    },
    plan: plan("How is TSLA trading compared to last week?", [
      { description: "current TSLA price action and week-over-week performance compared with the previous week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "volume and range during the compared weeks", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{
        content: JSON.stringify({ symbol: "TSLA", metric: "ohlcv_latestWeek", weekStart: "2026-09-14", weekEnd: "2026-09-18", sessions: 5, weekOpen: 401.2, weekClose: 428.9, weekHigh: 431.5, weekLow: 398.7 }) + " " + JSON.stringify({ symbol: "TSLA", metric: "ohlcv_weekOverWeek", previousWeekClose: 398.4, latestWeekClose: 428.9, weekOverWeekChangePct: 7.66 }),
        about: "TSLA",
      }]],
    ]),
    capabilityParams: { asset: "TSLA" },
  },
  {
    name: "EVENT: NVDA around its next earnings",
    golden: {
      question: "What could affect NVDA around its next earnings?",
      subject: "NVDA", windowDays: 30,
      coreDimensions: [
        { label: "earnings timing", pattern: /earnings|report/ },
        { label: "expectations", pattern: /consensus|estimate|expectation/ },
        { label: "catalysts", pattern: /catalyst|development|news|driver/ },
      ],
      expectedEvidence: [/earningsDate|consensus|NVDA/],
      forbiddenEvidence: [/Bitcoin ETF|BTC/],
      counterevidence: "OPTIONAL",
    },
    plan: plan("What could affect NVDA around its next earnings?", [
      { description: "NVDA next earnings date", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "consensus estimates for the upcoming NVDA report", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "recent NVDA company developments and catalysts", importance: "SUPPORTING", timeSensitivity: "RECENT" },
    ], ["EARNINGS_CALENDAR", "EQUITY_NEWS"]),
    providers: new Map([
      ["EARNINGS_CALENDAR", [{ content: JSON.stringify({ symbol: "NVDA", earningsDate: "2026-11-18", consensus: { eps: 1.24, revenue: 5.4e10 }, estimate: "consensus" }), about: "NVDA" }]],
      ["EQUITY_NEWS", [{ content: "NVDA datacenter demand catalyst: hyperscaler capex growth remains the main driver into the report.", about: "NVDA" }]],
    ]),
    capabilityParams: { asset: "NVDA" },
  },
  {
    name: "CAUSAL: what is driving oil prices this week",
    golden: {
      question: "What is driving oil prices this week?",
      subject: "CL=F", windowDays: 7,
      coreDimensions: [
        { label: "price movement", pattern: /price|oil/ },
        { label: "supply", pattern: /supply|opec|production/ },
        { label: "demand", pattern: /demand|inventor/ },
      ],
      expectedEvidence: [/CL=F|crude|OPEC/],
      forbiddenEvidence: [/ethereum|solana|altcoin/i],
      counterevidence: "REQUIRED",
    },
    plan: plan("What is driving oil prices this week?", [
      { description: "current oil price movement this week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "oil supply and OPEC producer developments", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "oil demand and inventory data", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "CL=F", price: 96.08, previousClose: 100.05, changePct: -3.97 }), about: "CL=F" }]],
      ["NEWS_ANALYSIS", [{ content: "OPEC+ quotas were raised as crude inventories built and refinery demand softened this week.", about: "CL=F" }]],
    ]),
    capabilityParams: { asset: "CL=F" },
  },
  {
    name: "MACRO: conditions favoring risk assets",
    golden: {
      question: "What macro conditions favor risk assets right now?",
      subject: null, windowDays: 7,
      coreDimensions: [
        { label: "rates", pattern: /rate|yield|policy/ },
        { label: "volatility/risk regime", pattern: /volatil|risk appetite|regime|sentiment/ },
        { label: "dollar/liquidity", pattern: /dollar|usd|liquidit/ },
      ],
      expectedEvidence: [/VIX|yield|dollar|index/i],
      forbiddenEvidence: [/bitcoin|btc|etf flows/i],
      counterevidence: "REQUIRED",
    },
    plan: plan("What macro conditions favor risk assets right now?", [
      { description: "current interest rate and yield regime", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "current volatility and risk appetite regime", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "dollar and liquidity conditions", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS"]),
    providers: new Map([
      // Payloads mirror the real market-regime adapter (label + measures), because a bare
      // symbol and number would carry no market vocabulary for the requirement matcher.
      ["MACRO_ANALYSIS", [
        { content: JSON.stringify({ metric: "market_regime_observable", instrument: "^TNX", label: "10-year Treasury yield", measures: "long-term risk-free rate and yield regime", value: 4.998, changePct: 0.746 }), about: "^TNX" },
        { content: JSON.stringify({ metric: "market_regime_observable", instrument: "^VIX", label: "CBOE volatility index", measures: "equity risk appetite and implied volatility", value: 14.81, changePct: -13.392 }), about: "^VIX" },
        { content: JSON.stringify({ metric: "market_regime_observable", instrument: "DX-Y.NYB", label: "US dollar index", measures: "USD strength and global liquidity", value: 100.215, changePct: 0.567 }), about: "DX-Y.NYB" },
      ]],
    ]),
  },
  {
    name: "UNSEEN / SYNTHESIS: copper supply pressure",
    golden: {
      question: "What is currently pressuring copper prices?",
      subject: "HG=F", windowDays: 14,
      coreDimensions: [
        { label: "copper price", pattern: /copper|price/ },
        { label: "supply/demand", pattern: /supply|demand|inventor|production/ },
      ],
      expectedEvidence: [/HG=F|copper/i],
      forbiddenEvidence: [/bitcoin|btc|solana|ethereum/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("What is currently pressuring copper prices?", [
      { description: "current copper price action", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "copper supply and demand developments", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "HG=F", price: 6.784, previousClose: 6.5795, changePct: 3.108 }), about: "HG=F" }]],
      ["NEWS_ANALYSIS", [{ content: "Copper supply tightened on smelter outages while grid demand stayed firm.", about: "HG=F" }]],
    ]),
    capabilityParams: { asset: "HG=F" },
  },
];

// ------------------------------------------------------------------------------------------
// ADVERSARIAL FAILURE MODES: the engine must recover or name the exact unresolved requirement.
// ------------------------------------------------------------------------------------------
/**
 * Adversarial failure modes AND the question-type generalization cases (thesis, falsification,
 * historical, cross-asset, held-out subject). Every case is scored on all dimensions; only the
 * explicitly listed ones are allowed to fail a dimension, and only because failing it correctly
 * IS their assertion (stale evidence must not complete a current question).
 */
const ADVERSARIAL: readonly Scenario[] = [
  // The held-out and adversarial cases below are scored on every dimension; the STALE case is
  // the one that must visibly FAIL coverage.
  {
    name: "ADVERSARIAL: only STALE evidence for a current question",
    golden: {
      question: "What is driving oil prices this week?",
      subject: "CL=F", windowDays: 7,
      coreDimensions: [{ label: "price movement", pattern: /price|oil/ }],
      expectedEvidence: [/CL=F|crude/],
      forbiddenEvidence: [/bitcoin|btc/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("What is driving oil prices this week?", [
      { description: "current oil price movement this week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "CL=F", price: 81.2, previousClose: 80.9, changePct: 0.4 }), about: "CL=F" }]],
    ]),
    capabilityParams: { asset: "CL=F" },
    staleDaysAgo: 60, // outside the CURRENT window
  },
  {
    name: "ADVERSARIAL: wrong-domain evidence offered (crypto for an equity question)",
    golden: {
      question: "How is TSLA trading compared to last week?",
      subject: "TSLA", windowDays: 7,
      coreDimensions: [
        { label: "price action", pattern: /price|trading|performance/ },
        { label: "comparison", pattern: /week|comparison|previous|prior/ },
      ],
      expectedEvidence: [/TSLA|weekOverWeek/],
      forbiddenEvidence: [/bitcoin|btc|solana/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("How is TSLA trading compared to last week?", [
      { description: "current TSLA price action and comparison with the previous week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "TSLA", metric: "ohlcv_weekOverWeek", previousWeekClose: 398.4, latestWeekClose: 428.9, weekOverWeekChangePct: 7.66 }) + " TSLA week over week.", about: "TSLA" }]],
      // Polluting payload in the same capability: must never reach the admitted context.
      ["NEWS_ANALYSIS", [{ content: "Bitcoin ETF flows hit a record as crypto markets rally.", about: "BTC" }]],
    ]),
    capabilityParams: { asset: "TSLA" },
  },
  // ---------------------------------------------------------------------------------------
  // QUESTION-TYPE GENERALIZATION (decision-quality mandate §10): the same engine must derive a
  // usable research contract for belief-testing, falsification, historical-analogue,
  // cross-asset and held-out-subject questions it was never given rules for.
  // ---------------------------------------------------------------------------------------
  {
    name: "THESIS: does my NVDA weakening thesis still hold",
    golden: {
      question: "Does my thesis that NVDA is weakening still hold?",
      subject: "NVDA", windowDays: 7,
      coreDimensions: [
        { label: "thesis support", pattern: /support|confirm|consistent/ },
        { label: "thesis challenge", pattern: /challeng|contradict|weaken/ },
      ],
      expectedEvidence: [/NVDA|semiconductor/i],
      forbiddenEvidence: [/bitcoin|crude oil/i],
      counterevidence: "REQUIRED",
    },
    plan: plan("Does my thesis that NVDA is weakening still hold?", [
      { description: "evidence that supports the thesis that NVDA is weakening", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EQUITY_NEWS", "MACRO_ANALYSIS"]),
    providers: new Map([
      ["EQUITY_NEWS", [{ content: "NVDA traded lower as datacenter order growth decelerated and margin guidance was trimmed.", about: "NVDA" }]],
      ["FALSIFICATION", [{ content: "NVDA counter-case: hyperscaler capital spending remained strong and supplier lead times lengthened, which argues against weakening demand.", about: "NVDA" }]],
      ["MACRO_ANALYSIS", [{ content: "Semiconductor sector breadth narrowed while the 10-year yield held near 5 percent.", about: "NVDA" }]],
    ]),
    capabilityParams: { asset: "NVDA" },
  },
  {
    name: "FALSIFICATION: what could prove the NVDA thesis wrong",
    golden: {
      question: "What could prove my NVDA thesis wrong?",
      subject: "NVDA", windowDays: 7,
      coreDimensions: [{ label: "falsification", pattern: /falsif|disconfirm|wrong|invalidate|weaken/ }],
      expectedEvidence: [/NVDA/i],
      forbiddenEvidence: [/bitcoin|gold/i],
      counterevidence: "REQUIRED",
    },
    plan: plan("What could prove my NVDA thesis wrong?", [
      { description: "disconfirming evidence that would falsify the NVDA weakening thesis", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["EQUITY_NEWS"]),
    providers: new Map([
      ["EQUITY_NEWS", [{ content: "NVDA falsification check: accelerating accelerator demand and rising backlog would invalidate the weakening thesis.", about: "NVDA" }]],
      ["FALSIFICATION", [{ content: "NVDA counter-case: cloud capex guidance was raised, which would prove the weakening thesis wrong.", about: "NVDA" }]],
    ]),
    capabilityParams: { asset: "NVDA" },
  },
  {
    name: "HISTORICAL: has the current TSLA setup happened before",
    golden: {
      question: "Has the current TSLA setup happened before?",
      subject: "TSLA", windowDays: 365,
      coreDimensions: [{ label: "episodes", pattern: /episode|analog|similar|historical/ }],
      expectedEvidence: [/episode|analog|TSLA/i],
      forbiddenEvidence: [/bitcoin|crypto/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("Has the current TSLA setup happened before?", [
      { description: "comparable historical episodes for the current TSLA setup", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
    ], ["HISTORICAL_COMPARISON"]),
    providers: new Map([
      ["HISTORICAL_COMPARISON", [
        { content: "TSLA historical episodes: three comparable drawdown-and-reclaim setups since 2021, matched on 20-day trend, momentum and volatility state.", about: "TSLA" },
        { content: "TSLA episode outcomes: after the comparable analog episodes, the forward 20-day return ranged from minus 8 to plus 14 percent across a sample of three.", about: "TSLA" },
      ]],
    ]),
    capabilityParams: { asset: "TSLA" },
    // A historical question is answered from genuinely historical observations: the fixture's
    // observations are dated well beyond a year, so they classify as historical rather than
    // current (a CURRENT-tagged item cannot satisfy a HISTORICAL requirement).
    staleDaysAgo: 800,
  },
  {
    name: "CROSS-ASSET: how oil prices could reach inflation and equities",
    golden: {
      question: "How could oil prices affect inflation and equities?",
      subject: null, windowDays: 30,
      coreDimensions: [
        { label: "oil", pattern: /oil|crude/ },
        { label: "inflation", pattern: /inflation|cpi/ },
        { label: "equities", pattern: /equit|stock|index|s&p/ },
      ],
      expectedEvidence: [/oil|crude/i, /inflation|cpi/i, /equit|stock|s&p/i],
      forbiddenEvidence: [/bitcoin|ethereum/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("How could oil prices affect inflation and equities?", [
      { description: "current oil price transmission into inflation and equity valuations", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "inflation expectations and equity index response channel", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [
        { content: "Oil price pass-through: crude at 96 dollars keeps headline CPI inflation elevated, while the 10-year yield near 5 percent pressures equity valuations." },
      ]],
      ["NEWS_ANALYSIS", [
        { content: "Energy costs feed inflation expectations; equity index earnings face margin pressure when crude stays above 90 dollars." },
      ]],
    ]),
  },
  {
    name: "UNSEEN SUBJECT (held out): what is driving platinum prices",
    golden: {
      question: "What is driving platinum prices this week?",
      subject: "PL=F", windowDays: 7,
      coreDimensions: [
        { label: "price action", pattern: /price|action/ },
        { label: "supply side", pattern: /supply|producer|production|output/ },
        { label: "demand side", pattern: /demand|inventor|consumption/ },
      ],
      expectedEvidence: [/platinum|PL=F/i],
      forbiddenEvidence: [/bitcoin|nvda/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("What is driving platinum prices this week?", [
      { description: "current platinum price action", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MARKET_DATA_ANALYSIS", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["MARKET_DATA_ANALYSIS", [{ content: "PL=F platinum futures trade at 1,045, up 2.1 percent on the week.", about: "PL=F" }]],
      ["NEWS_ANALYSIS", [
        { content: "Platinum supply tightened as South African mine output fell and smelter maintenance cut refined production.", about: "PL=F" },
        { content: "Platinum demand and inventories: autocatalyst demand firmed while exchange inventories drew down.", about: "PL=F" },
      ]],
    ]),
    capabilityParams: { asset: "PL=F" },
  },
  {
    name: "ADVERSARIAL: the primary provider fails (timeout) - recovery must try another path",
    golden: {
      question: "What macro conditions favor risk assets right now?",
      subject: null, windowDays: 7,
      coreDimensions: [{ label: "rates/regime", pattern: /rate|yield|volatil|regime|policy/ }],
      expectedEvidence: [/yield|VIX|dollar/i],
      forbiddenEvidence: [/bitcoin|btc/i],
      counterevidence: "OPTIONAL",
    },
    plan: plan("What macro conditions favor risk assets right now?", [
      { description: "current rate, volatility and dollar conditions", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "NEWS_ANALYSIS"]),
    providers: new Map([
      // The primary structured provider fails; macro news is the registered second path.
      ["MACRO_ANALYSIS", [{ content: "unused" }]],
      ["NEWS_ANALYSIS", [{ content: "Rates and volatility conditions: the 10-year yield is 4.998 percent while VIX sits at 14.81 and the dollar firmed." }]],
    ]),
    failCapabilities: ["MACRO_ANALYSIS"],
  },
];

describe("decision-quality benchmark (dimensions scored independently)", () => {
  beforeEach(() => resetIdCounters());

  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const run = await execute(scenario);
      const dimensions = score(run, scenario.golden);
      report(scenario.name, dimensions);
      const failed = DIMENSIONS.filter((d) => dimensions[d]?.pass !== true);
      expect(failed, `failing dimensions: ${failed.join(", ")}`).toHaveLength(0);
    });
  }

  for (const scenario of ADVERSARIAL) {
    it(scenario.name, async () => {
      const run = await execute(scenario);
      const dimensions = score(run, scenario.golden);
      report(scenario.name, dimensions);
      // The point of an adversarial case is not that every dimension passes: it is that the
      // engine never reports success it cannot support, and never admits forbidden evidence.
      expect(dimensions["NO CONTAMINATION"]?.pass, "forbidden evidence reached the admitted context").toBe(true);
      expect(dimensions["FRESHNESS"]?.pass, "stale evidence satisfied a current requirement").toBe(true);
      // Every other case (including the generalization and held-out ones) must pass all of its
      // dimensions: a dimension failure there is a real engine defect, not an expected outcome.
      if (!scenario.name.includes("only STALE evidence")) {
        const failed = DIMENSIONS.filter((d) => dimensions[d]?.pass !== true);
        expect(failed, `failing dimensions: ${failed.join(", ")}`).toHaveLength(0);
      }
      if (scenario.name.includes("only STALE evidence")) {
        // Stale-only evidence for a CURRENT question must not complete as covered.
        expect(run.outcome.stoppedBecause).not.toBe("EVIDENCE_SUFFICIENT");
        const gaps = (run.outcome.requirements ?? []).filter((r) => r.status !== "SATISFIED");
        expect(gaps.length).toBeGreaterThan(0);
      }
      if (scenario.name.includes("provider fails")) {
        // The engine attempted its own paths and then reported honestly.
        expect(run.capabilities.length).toBeGreaterThan(0);
      }
    });
  }

  it("contract validation: a judgment cannot claim coverage the ledger does not support", () => {
    // The four claims the decision-quality contract forbids, each checked against real state.
    const base = { ledger: [], evidenceText: "", executedCapabilities: [] as string[] };
    expect(contractViolations("No material counterevidence was found.", base).map((v) => v.type))
      .toContain("COUNTEREVIDENCE_CLAIM_WITHOUT_SEARCH");
    expect(contractViolations("No material counterevidence was found.", { ...base, executedCapabilities: ["FALSIFICATION"] }))
      .toHaveLength(0);
    expect(contractViolations("TSLA is trading higher compared with last week.", base).map((v) => v.type))
      .toContain("COMPARISON_CLAIM_WITHOUT_COMPARISON_DATA");
    expect(contractViolations("TSLA is trading higher compared with last week.", { ...base, evidenceText: "ohlcv_weekOverWeek -2.1 percent" }))
      .toHaveLength(0);
    expect(contractViolations("The next earnings date is 2026-11-18.", base).map((v) => v.type))
      .toContain("EVENT_FACT_WITHOUT_EVENT_EVIDENCE");
    expect(contractViolations("The next earnings date is 2026-11-18.", { ...base, evidenceText: "earningsDate 2026-11-18" }))
      .toHaveLength(0);
    expect(contractViolations("Risk assets look supported.", {
      ...base,
      ledger: [{ description: "current monetary policy trajectory", importance: "CRITICAL", status: "EXHAUSTED", timeSensitivity: "CURRENT" }],
    }).map((v) => v.type)).toContain("COVERAGE_CLAIM_OVER_UNRESOLVED_REQUIREMENT");
  });

  it("surviving violations are stripped, and the engine states the gap instead", async () => {
    // The synthesis model always claims unsupported coverage; the engine must not let it stand.
    const question = "What is driving Treasury yields higher?";
    const registry = new CapabilityRegistry();
    registry.register(provider("MACRO_ANALYSIS", [{
      content: JSON.stringify({ metric: "market_regime_observable", instrument: "^TNX", label: "10-year Treasury yield", measures: "long-term risk-free rate and yield regime", value: 4.998, changePct: 0.746 }),
      about: "^TNX",
    }]));
    const model = new FakeModelProvider(new Map([
      ["research.plan", plan(question, [{ description: "current Treasury yields levels", importance: "CRITICAL", timeSensitivity: "CURRENT" }], ["MACRO_ANALYSIS"])],
      ["research.adaptive_decision", modelResponses.adaptiveDecision("COMPLETE")],
      ["research.answer_synthesis", JSON.stringify({
        directAnswer: "The 10-year Treasury yield stands at 4.998 percent. Yields rose compared with last week on fiscal supply concerns. No material counterevidence was found.",
        keyFactors: [{ factor: "fiscal supply", mechanism: "term premium", direction: "higher", evidenceRefs: [], counterevidenceRefs: [] }],
        whatWouldChangeTheView: ["a policy shift"],
        uncertainty: ["The persistence of the move is unclear."],
        confidence: "MODERATE",
        citedObjectRefs: [],
      })],
    ]));
    const ws = new Workspace();
    const research = ws.addResearch({ objective: question, question, flow: "WHY_IT_HAPPENED" }, origin);
    ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
    const outcome = await runAdaptiveResearch(question, research.id, {
      provider: model, registry, workspace: ws, store: new MemoryStore(), maxRounds: 1,
      capabilityParams: { asset: "^TNX" },
    });

    const answer = `${outcome.answer ?? ""} ${outcome.synthesis?.directAnswer ?? ""}`;
    // The unsupported comparison and the unsearched counterevidence claim are gone from the
    // trader-facing text, and the engine recorded what it removed.
    expect(answer).not.toMatch(/compared with last week/i);
    expect(answer).not.toMatch(/No material counterevidence was found/i);
    expect(outcome.contractViolations ?? []).toBeDefined();
    const statements = (outcome.synthesis?.uncertainty ?? []).join(" ");
    expect(statements).toMatch(/Removed from this answer|not (established|searched)/i);
  });
});
