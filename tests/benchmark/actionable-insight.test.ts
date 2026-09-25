/**
 * ACTIONABLE-INSIGHT BENCHMARK (research contract: QUESTION RESOLUTION ≠ EVIDENCE COLLECTION).
 *
 * Scores whether the engine resolves the trader's information need — not merely whether it
 * collected evidence. Dimensions are independent (PASS/FAIL/NOT_APPLICABLE); never collapsed
 * into one number. The golden intent/dimensions are HIDDEN from the engine (question is the
 * only input).
 *
 * Dimensions scored per scenario (from the run's own objects):
 *   QUESTION_FIT             engine's questionResolution matches the golden intent/status
 *   EVIDENCE_RELEVANCE       admitted evidence is in the contract's expected domains
 *   RECENCY                  no stale observation satisfied a CURRENT window requirement
 *   ANSWER_COVERAGE          required answer dimensions satisfied (or honestly unresolved)
 *   CLAIM_SUPPORT            answer claims link to ledger evidence (or are hedged)
 *   EXPLANATORY_SUFFICIENCY  prose names drivers/mechanism, not a source list
 *   SYNTHESIS_INTEGRITY      no wrong-domain contamination in admitted context
 *   ACTIONABILITY            actionableInsight present with shows/means/change/watch; no trade directives
 *   UNCERTAINTY_CALIBRATION  confidence ceiling held; uncertainty names a real gap when partial
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome } from "../../src/research/adaptive.js";
import { CapabilityRegistry, type ProviderAdapter } from "../../src/adapters/capability-registry.js";
import { FakeModelProvider, responses as modelResponses } from "../model/fakes.js";
import { MemoryStore } from "../../src/persistence/index.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { containsTradeDirective, questionIntentOf, temporalScopeOf } from "../../src/research/question-resolution.js";

const origin = { kind: "agent" as const, detail: "actionable-insight benchmark" };
const DAY_MS = 86_400_000;

const CONFIDENCE_ORDER: Readonly<Record<string, number>> = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3 };

const DIMENSIONS = [
  "QUESTION_FIT",
  "EVIDENCE_RELEVANCE",
  "RECENCY",
  "ANSWER_COVERAGE",
  "CLAIM_SUPPORT",
  "EXPLANATORY_SUFFICIENCY",
  "SYNTHESIS_INTEGRITY",
  "ACTIONABILITY",
  "UNCERTAINTY_CALIBRATION",
] as const;

interface Golden {
  readonly question: string;
  readonly intent: string;
  readonly temporalScope: string;
  /** Minimum resolution status the engine must report (ANSWERED | PARTIALLY_ANSWERED | NOT_ANSWERED). */
  readonly minStatus: string;
  readonly expectedEvidence: readonly RegExp[];
  readonly forbiddenEvidence: readonly RegExp[];
  readonly maxConfidence?: string;
  readonly expectActionable?: boolean;
}

interface Scenario {
  readonly name: string;
  readonly golden: Golden;
  readonly plan: string;
  readonly providers: ReadonlyMap<string, readonly { content: string; about?: string }[]>;
  readonly capabilityParams?: Record<string, unknown>;
  readonly staleDaysAgo?: number;
  readonly budgetRounds?: number;
}

function plan(question: string, requirements: unknown[], capabilities: string[]): string {
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

function provider(
  capability: string,
  outputs: readonly { content: string; about?: string }[],
  opts: { sourceTimestamp?: string } = {},
): ProviderAdapter {
  return {
    providerId: `harness/${capability.toLowerCase()}`,
    capabilities: [capability],
    limitations: ["benchmark fixture"],
    freshnessProfile: "test:live",
    async execute(cap) {
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

const SYNTHESIS_FOR = (request: { readonly prompt: string }): string => {
  const ids = [...new Set(request.prompt.match(/ev_\d+/g) ?? [])].slice(0, 4);
  const [primary, ...rest] = ids;
  return JSON.stringify({
    directAnswer:
      "What the evidence establishes for this question is the set of drivers the retrieved observations describe, and what it does not establish is any claim outside those observations. That means the conclusion holds only while those drivers persist. What would change this view: a reversal in the retrieved metric or a policy shift. What to watch: the next scheduled release and the primary series this week.",
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
    whatWouldChangeTheView: ["a reversal in the retrieved metric", "a supply or policy change that alters the driver"],
    implication: "The decision hinges on whether the dominant driver persists through the stated window.",
    uncertainty: ["the persistence of the dominant driver beyond the retrieved window is not established"],
    confidence: "MODERATE",
    citedObjectRefs: ids,
  });
};

async function execute(scenario: Scenario): Promise<{
  outcome: AdaptiveLoopOutcome;
  capabilities: string[];
}> {
  const capabilities: string[] = [];
  const registry = new CapabilityRegistry();
  const staleTs =
    scenario.staleDaysAgo !== undefined
      ? new Date(Date.now() - scenario.staleDaysAgo * DAY_MS).toISOString()
      : undefined;
  const fixtures = new Map<string, readonly { content: string; about?: string }[]>(scenario.providers);
  if (!fixtures.has("FALSIFICATION")) {
    fixtures.set("FALSIFICATION", [
      { content: "Counter-case: positioning and technical flows, not the fundamental driver, may explain the move." },
    ]);
  }
  for (const [capability, outputs] of fixtures) {
    const inner = provider(capability, outputs, { ...(staleTs !== undefined ? { sourceTimestamp: staleTs } : {}) });
    registry.register({
      providerId: inner.providerId,
      capabilities: inner.capabilities,
      limitations: inner.limitations,
      freshnessProfile: inner.freshnessProfile,
      async execute(cap, p) {
        capabilities.push(cap);
        return inner.execute(cap, p);
      },
    });
  }
  const model = new FakeModelProvider(
    new Map([
      ["research.plan", scenario.plan],
      ["research.adaptive_decision", modelResponses.adaptiveDecision("COMPLETE")],
      ["research.answer_synthesis", SYNTHESIS_FOR],
    ]),
  );
  const ws = new Workspace();
  const research = ws.addResearch(
    { objective: scenario.golden.question, question: scenario.golden.question, flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
    origin,
  );
  ws.transitionResearch(research.id, "ACTIVE", origin, "activated");
  const outcome = await runAdaptiveResearch(scenario.golden.question, research.id, {
    provider: model,
    registry,
    workspace: ws,
    store: new MemoryStore(),
    maxRounds: scenario.budgetRounds ?? 2,
    ...(scenario.capabilityParams !== undefined ? { capabilityParams: scenario.capabilityParams } : {}),
  });
  return { outcome, capabilities };
}

function report(name: string, dimensions: Record<string, { pass: boolean; note: string }>): void {
  const lines = DIMENSIONS.map((d) => {
    const s = dimensions[d];
    return `    ${s?.pass === true ? "PASS" : "FAIL"}  ${d.padEnd(26)} ${s?.note ?? "(not scored)"}`;
  });
  const failed = DIMENSIONS.filter((d) => dimensions[d]?.pass !== true);
  console.log(
    `  [${name}] ${DIMENSIONS.length - failed.length}/${DIMENSIONS.length} dimensions pass${failed.length > 0 ? ` | failing: ${failed.join(", ")}` : ""}\n${lines.join("\n")}`,
  );
}

function score(run: { outcome: AdaptiveLoopOutcome; capabilities: string[] }, golden: Golden): Record<string, { pass: boolean; note: string }> {
  const { outcome } = run;
  const resolution = outcome.questionResolution;
  const ledger = outcome.requirements ?? [];
  const admitted = outcome.context.items.map((i) => i.text).join(" ");
  const allEvidence = outcome.evidence.map((e) => `${e.observation} ${e.subject ?? ""}`).join(" ");
  const answerText = `${outcome.answer ?? ""} ${outcome.synthesis?.directAnswer ?? ""}`;
  const statusOrder = { NOT_ANSWERED: 0, PARTIALLY_ANSWERED: 1, ANSWERED: 2 } as const;
  const dims: Record<string, { pass: boolean; note: string }> = {};
  const set = (name: string, pass: boolean, note: string): void => {
    dims[name] = { pass, note };
  };

  // QUESTION_FIT: engine must surface a resolution whose intent matches the golden intent and
  // whose status is at least the golden minimum (model never self-declares).
  const fitPass =
    resolution !== undefined &&
    resolution.intent === golden.intent &&
    statusOrder[resolution.status as keyof typeof statusOrder] >= statusOrder[golden.minStatus as keyof typeof statusOrder];
  set(
    "QUESTION_FIT",
    fitPass,
    resolution !== undefined
      ? `intent ${resolution.intent} (want ${golden.intent}), status ${resolution.status} (min ${golden.minStatus}), scope ${resolution.temporalScope}`
      : "no questionResolution on outcome",
  );

  set(
    "EVIDENCE_RELEVANCE",
    golden.expectedEvidence.some((p) => p.test(allEvidence)),
    `expected classes present: ${golden.expectedEvidence.filter((p) => p.test(allEvidence)).length}/${golden.expectedEvidence.length}`,
  );

  const currentReqs = ledger.filter((r) => r.timeSensitivity === "CURRENT");
  set(
    "RECENCY",
    currentReqs.every((r) => r.staleOnlyRefs.length === 0),
    `${currentReqs.length} CURRENT requirement(s), ${currentReqs.filter((r) => r.staleOnlyRefs.length > 0).length} stale-only`,
  );

  const unresolved = resolution?.unresolvedDimensions ?? [];
  set(
    "ANSWER_COVERAGE",
    resolution !== undefined && (resolution.status === "ANSWERED" || (unresolved.length > 0 && resolution.status !== "NOT_ANSWERED")),
    resolution !== undefined
      ? `unresolved dimensions: ${unresolved.join(", ") || "none"}; status ${resolution.status}`
      : "no resolution",
  );

  const claims = resolution?.answerClaims ?? [];
  const linked = claims.filter((c) => c.evidenceRefs.length > 0).length;
  set(
    "CLAIM_SUPPORT",
    claims.length === 0 || linked > 0 || resolution?.status !== "ANSWERED",
    `${linked}/${claims.length} claims carry evidence refs`,
  );

  const hasMechanism = /driver|mechanism|because|driven by|acts on|channel/i.test(answerText) && answerText.length > 80;
  set("EXPLANATORY_SUFFICIENCY", hasMechanism, hasMechanism ? "prose names a driver/mechanism" : "list-only or empty prose");

  const forbidden = golden.forbiddenEvidence.filter((p) => p.test(admitted));
  set("SYNTHESIS_INTEGRITY", forbidden.length === 0, `forbidden classes in admitted context: ${forbidden.length}`);

  const insight = resolution?.actionableInsight;
  const actionablePass =
    golden.expectActionable === false ||
    (insight !== undefined &&
      insight.whatEvidenceShows.length + insight.whatEvidenceDoesNotShow.length > 0 &&
      (insight.whatItMeans !== "" || insight.whatWouldChangeConclusion.length > 0 || insight.watchItems.length > 0) &&
      !containsTradeDirective(answerText) &&
      !containsTradeDirective(insight.whatItMeans));
  set(
    "ACTIONABILITY",
    actionablePass,
    insight !== undefined
      ? `shows ${insight.whatEvidenceShows.length}, means "${insight.whatItMeans.slice(0, 40)}", change ${insight.whatWouldChangeConclusion.length}, watch ${insight.watchItems.length}`
      : "no actionableInsight",
  );

  const level = outcome.confidence?.level ?? "UNKNOWN";
  const maxOk = golden.maxConfidence === undefined || CONFIDENCE_ORDER[level] <= CONFIDENCE_ORDER[golden.maxConfidence];
  const gapOk =
    resolution?.status !== "ANSWERED" ||
    (outcome.synthesis?.uncertainty ?? []).length > 0 ||
    unresolved.length === 0;
  set("UNCERTAINTY_CALIBRATION", maxOk && gapOk, `confidence ${level}${golden.maxConfidence !== undefined ? ` (ceiling ${golden.maxConfidence})` : ""}; unresolved ${unresolved.length}`);

  return dims;
}

// ---------------------------------------------------------------------------
// 12 positive scenarios: diverse question shapes must resolve.
// ---------------------------------------------------------------------------
const SCENARIOS: readonly Scenario[] = [
  {
    name: "CURRENT_STATE: oil right now",
    golden: {
      question: "What is the current state of crude oil right now?",
      intent: "CURRENT_STATE",
      temporalScope: "CURRENT",
      minStatus: "ANSWERED",
      expectedEvidence: [/oil|WTI|Brent|crude/i],
      forbiddenEvidence: [/Bitcoin|BTC|ETH/i],
      maxConfidence: "HIGH",
    },
    plan: plan("What is the current state of crude oil right now?", [
      { description: "current crude oil price level and condition", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "intraday range and volume context", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["COMMODITY_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "WTI", metric: "spot_latest", price: 71.4, changePct: 1.2, asOf: "2026-09-24T10:00:00Z" }), about: "WTI" }]],
      ["NEWS_ANALYSIS", [{ content: "Crude oil trades near session highs as supply concerns persist this week.", about: "oil" }]],
    ]),
    capabilityParams: { asset: "WTI" },
  },
  {
    name: "WHAT_HAPPENED: TSLA today",
    golden: {
      question: "What happened to TSLA today?",
      intent: "WHAT_HAPPENED",
      temporalScope: "CURRENT",
      minStatus: "ANSWERED",
      expectedEvidence: [/TSLA/i],
      forbiddenEvidence: [/crude|oil|BTC/i],
    },
    plan: plan("What happened to TSLA today?", [
      { description: "TSLA price move today", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "catalysts behind today's move", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "TSLA", metric: "session_return", returnPct: -2.4, asOf: "2026-09-24T16:00:00Z" }), about: "TSLA" }]],
      ["NEWS_ANALYSIS", [{ content: "TSLA fell after delivery estimates were trimmed by analysts.", about: "TSLA" }]],
    ]),
    capabilityParams: { asset: "TSLA" },
  },
  {
    name: "CURRENT_DRIVERS: what is moving gold this week",
    golden: {
      question: "What is moving gold prices this week?",
      intent: "CURRENT_DRIVERS",
      temporalScope: "WEEKLY",
      minStatus: "ANSWERED",
      expectedEvidence: [/gold|XAU/i],
      forbiddenEvidence: [/BTC|Bitcoin/i],
      maxConfidence: "HIGH",
    },
    plan: plan("What is moving gold prices this week?", [
      { description: "primary drivers of gold this week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "relationship between drivers and price action", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "counter-case: technical or positioning flows", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["COMMODITY_MARKET_DATA", "NEWS_ANALYSIS", "MACRO_ANALYSIS"]),
    providers: new Map([
      ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "XAUUSD", metric: "week_performance", changePct: 2.1, driver: "real-yields decline" }), about: "gold" }]],
      ["NEWS_ANALYSIS", [{ content: "Gold rallied this week as real yields fell and central-bank buying continued.", about: "gold" }]],
      ["MACRO_ANALYSIS", [{ content: "Real Treasury yields declined 18bp this week, lifting non-yielding gold demand.", about: "rates" }]],
    ]),
    capabilityParams: { asset: "XAUUSD" },
  },
  {
    name: "WHY_DID_IT_HAPPEN: why did BTC drop yesterday",
    golden: {
      question: "Why did Bitcoin drop yesterday?",
      intent: "WHY_DID_IT_HAPPEN",
      temporalScope: "HISTORICAL",
      minStatus: "ANSWERED",
      expectedEvidence: [/BTC|Bitcoin/i],
      forbiddenEvidence: [/gold|TSLA|oil/i],
    },
    plan: plan("Why did Bitcoin drop yesterday?", [
      { description: "what happened to BTC price yesterday", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
      { description: "drivers of the drop", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
      { description: "relationship between drivers and the move", importance: "SUPPORTING", timeSensitivity: "HISTORICAL" },
    ], ["CRYPTO_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ symbol: "BTC", metric: "daily_return", returnPct: -4.8, day: "2026-09-23" }), about: "BTC" }]],
      ["NEWS_ANALYSIS", [{ content: "Bitcoin dropped after a large leveraged liquidation cascade hit exchanges.", about: "BTC" }]],
    ]),
    capabilityParams: { asset: "BTC" },
  },
  {
    name: "WHAT_COULD_AFFECT_IT: NVDA around earnings",
    golden: {
      question: "What factors could affect NVDA around its next earnings?",
      intent: "WHAT_COULD_AFFECT_IT",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/NVDA|earnings/i],
      forbiddenEvidence: [/crude oil|WTI/i],
    },
    plan: plan("What factors could affect NVDA around its next earnings?", [
      { description: "upcoming earnings timing and consensus", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "catalysts and risks around the event", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["EQUITY_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "NVDA", metric: "earnings_calendar", nextDate: "2026-11-19", consensusEps: 1.12 }), about: "NVDA" }]],
      ["NEWS_ANALYSIS", [{ content: "NVDA earnings risks include data-center capex guidance and export policy.", about: "NVDA" }]],
    ]),
    capabilityParams: { asset: "NVDA" },
  },
  {
    name: "HISTORICAL_COMPARISON: gold vs last year",
    golden: {
      question: "How is gold performing compared to last year?",
      intent: "HISTORICAL_COMPARISON",
      temporalScope: "HISTORICAL",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/gold|XAU/i],
      forbiddenEvidence: [/BTC/i],
    },
    plan: plan("How is gold performing compared to last year?", [
      { description: "gold performance versus the previous year", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
      { description: "comparable baseline period levels", importance: "SUPPORTING", timeSensitivity: "HISTORICAL" },
    ], ["COMMODITY_MARKET_DATA"]),
    providers: new Map([
      ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "XAUUSD", metric: "year_over_year", priorYearClose: 2380, latest: 2640, changePct: 10.9 }), about: "gold" }]],
    ]),
    capabilityParams: { asset: "XAUUSD" },
  },
  {
    name: "THESIS_EVALUATION: does my oil thesis hold",
    golden: {
      question: "Does my thesis that oil stays above 70 still hold?",
      intent: "THESIS_EVALUATION",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/oil|WTI|Brent|crude/i],
      forbiddenEvidence: [/Bitcoin/i],
    },
    plan: plan("Does my thesis that oil stays above 70 still hold?", [
      { description: "evidence supporting the thesis that oil holds above 70", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "evidence challenging the thesis", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["COMMODITY_MARKET_DATA", "NEWS_ANALYSIS", "FALSIFICATION"]),
    providers: new Map([
      ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "WTI", metric: "spot_latest", price: 72.1, aboveThesis: true }), about: "WTI" }]],
      ["NEWS_ANALYSIS", [{ content: "OPEC+ supply increases could pressure oil back below 70.", about: "oil" }]],
      ["FALSIFICATION", [{ content: "Counter-case: inventory builds this week undercut the hold-above-70 thesis.", about: "oil" }]],
    ]),
    capabilityParams: { asset: "WTI" },
  },
  {
    name: "FALSIFICATION: what would prove me wrong on rates",
    golden: {
      question: "What would prove me wrong on the rates-peaking thesis?",
      intent: "FALSIFICATION",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/rates|yield|Treasury|policy/i],
      forbiddenEvidence: [/TSLA/i],
    },
    plan: plan("What would prove me wrong on the rates-peaking thesis?", [
      { description: "disconfirming conditions for the rates-peaking thesis", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "current evidence that challenges the thesis", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "NEWS_ANALYSIS", "FALSIFICATION"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [{ content: JSON.stringify({ metric: "policy_regime", instrument: "UST10Y", value: 4.42, note: "yields re-accelerating" }), about: "rates" }]],
      ["NEWS_ANALYSIS", [{ content: "A hotter CPI print would invalidate the rates-peaking call.", about: "macro" }]],
      ["FALSIFICATION", [{ content: "Counter-case: sticky inflation would break the peaking assumption.", about: "rates" }]],
    ]),
    capabilityParams: { asset: "UST10Y" },
  },
  {
    name: "FRAMEWORK_EVALUATION: evaluate breakout with my framework",
    golden: {
      question: "Evaluate this breakout setup against my framework criteria",
      intent: "FRAMEWORK_EVALUATION",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/breakout|setup|volume|level/i],
      forbiddenEvidence: [/crude/i],
    },
    plan: plan("Evaluate this breakout setup against my framework criteria", [
      { description: "framework criteria for breakout quality", importance: "CRITICAL", timeSensitivity: "ANY" },
      { description: "evidence measured against each criterion", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["LOCAL_KNOWLEDGE_RETRIEVAL", "EQUITY_MARKET_DATA"]),
    providers: new Map([
      ["LOCAL_KNOWLEDGE_RETRIEVAL", [{ content: "Framework: breakout requires volume expansion above prior resistance and a held retest.", about: "framework" }]],
      ["EQUITY_MARKET_DATA", [{ content: JSON.stringify({ symbol: "SPY", metric: "breakout_check", volumeRatio: 1.6, heldRetest: true }), about: "SPY" }]],
    ]),
    capabilityParams: { asset: "SPY" },
  },
  {
    name: "CROSS_DOMAIN_SYNTHESIS: everything on inflation drivers",
    golden: {
      question: "Synthesize all the information on current inflation drivers across domains",
      intent: "CROSS_DOMAIN_SYNTHESIS",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/inflation|CPI|price/i],
      forbiddenEvidence: [/NVDA earnings/i],
    },
    plan: plan("Synthesize all the information on current inflation drivers across domains", [
      { description: "cross-domain coverage of inflation drivers", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "goods, energy and services contribution context", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "NEWS_ANALYSIS", "COMMODITY_MARKET_DATA"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [{ content: JSON.stringify({ metric: "cpi_breadth", goods: "soft", services: "sticky", energy: "rising" }), about: "inflation" }]],
      ["NEWS_ANALYSIS", [{ content: "Services inflation remains sticky while goods disinflation stalls.", about: "macro" }]],
      ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "WTI", metric: "energy_contribution", changePct: 3.1 }), about: "oil" }]],
    ]),
    capabilityParams: { asset: "CPI" },
  },
  {
    name: "CURRENT_STATE: EURUSD status",
    golden: {
      question: "What is the status of EUR/USD?",
      intent: "CURRENT_STATE",
      temporalScope: "ANY",
      minStatus: "ANSWERED",
      expectedEvidence: [/EUR|USD|EURUSD/i],
      forbiddenEvidence: [/gold/i],
    },
    plan: plan("What is the status of EUR/USD?", [
      { description: "current EUR/USD level and condition", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["FX_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["FX_MARKET_DATA", [{ content: JSON.stringify({ pair: "EURUSD", metric: "spot_latest", price: 1.087, changePct: 0.3 }), about: "EURUSD" }]],
      ["NEWS_ANALYSIS", [{ content: "EUR/USD holds near 1.09 as ECB speakers temper cut expectations.", about: "EURUSD" }]],
    ]),
    capabilityParams: { asset: "EURUSD" },
  },
  {
    name: "WHY_DID_IT_HAPPEN: why did yields rise this week",
    golden: {
      question: "Why did Treasury yields rise this week?",
      intent: "WHY_DID_IT_HAPPEN",
      temporalScope: "WEEKLY",
      minStatus: "ANSWERED",
      expectedEvidence: [/yield|Treasury|UST|rate/i],
      forbiddenEvidence: [/BTC|TSLA/i],
      maxConfidence: "HIGH",
    },
    plan: plan("Why did Treasury yields rise this week?", [
      { description: "what happened to yields this week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "drivers of the rise", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      { description: "relationship between drivers and yields", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [{ content: JSON.stringify({ metric: "yield_move", instrument: "UST10Y", changeBp: 14, driver: "supply + hotter CPI" }), about: "rates" }]],
      ["NEWS_ANALYSIS", [{ content: "Treasury yields rose this week on heavier issuance and a hotter inflation print.", about: "rates" }]],
    ]),
    capabilityParams: { asset: "UST10Y" },
  },
];

// ---------------------------------------------------------------------------
// 12 adversarial scenarios (A–L): wrong dimensions / stale / contamination / no prose.
// ---------------------------------------------------------------------------
const ADVERSARIAL: readonly Scenario[] = [
  {
    name: "A: BTC drivers question fed only price/RSI/MACD (no drivers)",
    golden: {
      question: "What are the current drivers of Bitcoin price and regulation impact right now?",
      intent: "CURRENT_DRIVERS",
      temporalScope: "CURRENT",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [/price|RSI|MACD/i],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("What are the current drivers of Bitcoin price and regulation impact right now?", [
      { description: "current price and technical levels", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["CRYPTO_MARKET_DATA"]),
    providers: new Map([
      ["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ symbol: "BTC", metric: "rsi", value: 58, macd: "bullish" }), about: "BTC" }]],
    ]),
    capabilityParams: { asset: "BTC" },
    budgetRounds: 1,
  },
  {
    name: "B: stale regulation news satisfies a CURRENT question",
    golden: {
      question: "What is the current regulatory status for crypto exchanges right now?",
      intent: "CURRENT_STATE",
      temporalScope: "CURRENT",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [/regulat|SEC|exchange/i],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("What is the current regulatory status for crypto exchanges right now?", [
      { description: "current regulatory status", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["NEWS_ANALYSIS"]),
    providers: new Map([["NEWS_ANALYSIS", [{ content: "Last year regulators proposed exchange registration rules.", about: "regulation" }]]]),
    staleDaysAgo: 400,
    capabilityParams: { asset: "COIN" },
    budgetRounds: 1,
  },
  {
    name: "C: oil drivers question answered with crypto evidence only",
    golden: {
      question: "What is driving crude oil prices this week?",
      intent: "CURRENT_DRIVERS",
      temporalScope: "WEEKLY",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [/oil|WTI|crude/i],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("What is driving crude oil prices this week?", [
      { description: "current oil drivers", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["CRYPTO_MARKET_DATA"]),
    providers: new Map([["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ symbol: "BTC", metric: "ohlcv", note: "crypto only" }), about: "BTC" }]]]),
    capabilityParams: { asset: "WTI" },
    budgetRounds: 1,
  },
  {
    name: "D: empty providers (no evidence at all)",
    golden: {
      question: "What happened to gold today?",
      intent: "WHAT_HAPPENED",
      temporalScope: "CURRENT",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("What happened to gold today?", [
      { description: "gold move today", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["COMMODITY_MARKET_DATA"]),
    providers: new Map([["COMMODITY_MARKET_DATA", [{ content: "" }]]]),
    capabilityParams: { asset: "XAUUSD" },
    budgetRounds: 1,
  },
  {
    name: "E: historical ETF outflows used for a CURRENT drivers question",
    golden: {
      question: "What are the current drivers of Bitcoin ETF flows right now?",
      intent: "CURRENT_DRIVERS",
      temporalScope: "CURRENT",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [/ETF|flow/i],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("What are the current drivers of Bitcoin ETF flows right now?", [
      { description: "current ETF flow drivers", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["CRYPTO_MARKET_DATA", "NEWS_ANALYSIS"]),
    providers: new Map([
      ["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ metric: "etf_flows", window: "2024-historical", netMn: -420 }), about: "ETF" }]],
      ["NEWS_ANALYSIS", [{ content: "In 2024 spot Bitcoin ETFs saw multi-day outflows.", about: "ETF" }]],
    ]),
    staleDaysAgo: 500,
    capabilityParams: { asset: "BTC" },
    budgetRounds: 1,
  },
  {
    name: "F: thesis question with only supporting evidence, no challenge",
    golden: {
      question: "Does my thesis that ETH outperforms BTC still hold?",
      intent: "THESIS_EVALUATION",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/ETH|BTC/i],
      forbiddenEvidence: [/oil/i],
      maxConfidence: "MODERATE",
    },
    plan: plan("Does my thesis that ETH outperforms BTC still hold?", [
      { description: "support for ETH outperformance", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["CRYPTO_MARKET_DATA"]),
    providers: new Map([
      ["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ pair: "ETHBTC", metric: "ratio_change", changePct: 3.2 }), about: "ETH" }]],
    ]),
    capabilityParams: { asset: "ETH" },
    budgetRounds: 1,
  },
  {
    name: "G: falsification question with no disconfirmation attempt recorded in prose",
    golden: {
      question: "What would prove me wrong on the soft-landing call?",
      intent: "FALSIFICATION",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/landing|recession|labor/i],
      forbiddenEvidence: [],
      maxConfidence: "MODERATE",
    },
    plan: plan("What would prove me wrong on the soft-landing call?", [
      { description: "disconfirming conditions for soft landing", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS", "FALSIFICATION"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [{ content: JSON.stringify({ metric: "labor_breadth", claims: "cooling", note: "soft landing base case" }), about: "macro" }]],
      ["FALSIFICATION", [{ content: "Counter-case: a spike in jobless claims would break the soft-landing assumption.", about: "macro" }]],
    ]),
    capabilityParams: { asset: "UNRATE" },
  },
  {
    name: "H: cross-domain question fed single-domain evidence only",
    golden: {
      question: "Synthesize everything on stagflation risks across rates, equities and commodities",
      intent: "CROSS_DOMAIN_SYNTHESIS",
      temporalScope: "ANY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/stagflation|CPI|growth/i],
      forbiddenEvidence: [],
      maxConfidence: "MODERATE",
    },
    plan: plan("Synthesize everything on stagflation risks across rates, equities and commodities", [
      { description: "cross-domain stagflation coverage", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["MACRO_ANALYSIS"]),
    providers: new Map([
      ["MACRO_ANALYSIS", [{ content: JSON.stringify({ metric: "stagflation_watch", growth: "slowing", inflation: "elevated" }), about: "macro" }]],
    ]),
    capabilityParams: { asset: "CPI" },
    budgetRounds: 1,
  },
  {
    name: "I: historical comparison with no baseline period",
    golden: {
      question: "How did the 2022 crypto winter compare with the current drawdown?",
      intent: "HISTORICAL_COMPARISON",
      temporalScope: "HISTORICAL",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/2022|drawdown|winter/i],
      forbiddenEvidence: [],
    },
    plan: plan("How did the 2022 crypto winter compare with the current drawdown?", [
      { description: "2022 episode characteristics", importance: "CRITICAL", timeSensitivity: "HISTORICAL" },
      { description: "current drawdown baseline for comparison", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["CRYPTO_MARKET_DATA", "HISTORICAL_COMPARISON"]),
    providers: new Map([
      ["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ metric: "drawdown_history", y2022: -65, current: -18 }), about: "BTC" }]],
      ["HISTORICAL_COMPARISON", [{ content: "2022 winter featured contagion from Luna and FTX; current drawdown lacks that cascade.", about: "BTC" }]],
    ]),
    capabilityParams: { asset: "BTC" },
  },
  {
    name: "J: framework evaluation with no framework artifact",
    golden: {
      question: "Evaluate this breakout against my saved framework",
      intent: "FRAMEWORK_EVALUATION",
      temporalScope: "ANY",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("Evaluate this breakout against my saved framework", [
      { description: "framework criteria", importance: "CRITICAL", timeSensitivity: "ANY" },
    ], ["LOCAL_KNOWLEDGE_RETRIEVAL"]),
    providers: new Map([["LOCAL_KNOWLEDGE_RETRIEVAL", [{ content: "No saved framework found for this request.", about: "none" }]]]),
    capabilityParams: { asset: "SPY" },
    budgetRounds: 1,
  },
  {
    name: "K: forward factors question with only backward price history",
    golden: {
      question: "What upcoming catalysts could move the VIX this month?",
      intent: "WHAT_COULD_AFFECT_IT",
      temporalScope: "MONTHLY",
      minStatus: "PARTIALLY_ANSWERED",
      expectedEvidence: [/VIX|catalyst|event/i],
      forbiddenEvidence: [],
    },
    plan: plan("What upcoming catalysts could move the VIX this month?", [
      { description: "upcoming catalysts for VIX", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["NEWS_ANALYSIS", "MACRO_ANALYSIS"]),
    providers: new Map([
      ["NEWS_ANALYSIS", [{ content: "Calendar: CPI, FOMC minutes and monthly expiration land this month.", about: "VIX" }]],
      ["MACRO_ANALYSIS", [{ content: JSON.stringify({ metric: "vol_regime", vix: 16.2, note: "contained" }), about: "vol" }]],
    ]),
    capabilityParams: { asset: "VIX" },
  },
  {
    name: "L: question requiring drivers answered with pure price snapshot",
    golden: {
      question: "What is driving the US dollar right now?",
      intent: "CURRENT_DRIVERS",
      temporalScope: "CURRENT",
      minStatus: "NOT_ANSWERED",
      expectedEvidence: [/dollar|DXY|USD/i],
      forbiddenEvidence: [],
      maxConfidence: "LOW",
    },
    plan: plan("What is driving the US dollar right now?", [
      { description: "price level of the dollar", importance: "CRITICAL", timeSensitivity: "CURRENT" },
    ], ["FX_MARKET_DATA"]),
    providers: new Map([
      ["FX_MARKET_DATA", [{ content: JSON.stringify({ pair: "DXY", metric: "spot_latest", price: 104.8 }), about: "DXY" }]],
    ]),
    capabilityParams: { asset: "DXY" },
    budgetRounds: 1,
  },
];

describe("actionable-insight benchmark (question resolution, not evidence collection)", () => {
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
      // Adversarial: the engine must not over-claim resolution or confidence.
      expect(dimensions["QUESTION_FIT"]?.pass, "QUESTION_FIT failed on adversarial").toBe(true);
      expect(dimensions["UNCERTAINTY_CALIBRATION"]?.pass, "confidence ceiling violated").toBe(true);
      expect(dimensions["SYNTHESIS_INTEGRITY"]?.pass, "contamination").toBe(true);
      expect(dimensions["ACTIONABILITY"]?.pass, "actionability").toBe(true);
    });
  }

  // CRITICAL NEGATIVE TEST: exact BTC drivers/regulation question fed price/RSI/MACD/old
  // regulation/historical ETF outflows — must NOT be COMPLETED with HIGH confidence.
  it("CRITICAL NEGATIVE: BTC drivers + regulation with wrong-dimension evidence is never COMPLETED/HIGH", async () => {
    const question = "What are the current drivers of Bitcoin price and regulation impact right now?";
    const scenario: Scenario = {
      name: "CRITICAL NEGATIVE",
      golden: {
        question,
        intent: "CURRENT_DRIVERS",
        temporalScope: "CURRENT",
        minStatus: "NOT_ANSWERED",
        expectedEvidence: [/price|RSI|MACD|regulat|ETF/i],
        forbiddenEvidence: [],
        maxConfidence: "LOW",
      },
      plan: plan(question, [
        { description: "price and technical levels", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      ], ["CRYPTO_MARKET_DATA", "NEWS_ANALYSIS"]),
      providers: new Map([
        ["CRYPTO_MARKET_DATA", [{ content: JSON.stringify({ symbol: "BTC", metric: "rsi_macd", rsi: 61, macd: "cross-up", price: 68200 }), about: "BTC" }]],
        ["NEWS_ANALYSIS", [{ content: "Last year regulators proposed exchange registration; in 2024 spot Bitcoin ETFs saw outflows.", about: "regulation" }]],
      ]),
      staleDaysAgo: 400,
      capabilityParams: { asset: "BTC" },
      budgetRounds: 1,
    };
    const run = await execute(scenario);
    const { outcome } = run;
    expect(outcome.stoppedBecause).not.toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.confidence?.level).not.toBe("HIGH");
    expect(outcome.questionResolution?.status).not.toBe("ANSWERED");
    expect(questionIntentOf(question)).toBe("CURRENT_DRIVERS");
    expect(temporalScopeOf(question)).toBe("CURRENT");
    const dimensions = score(run, scenario.golden);
    report(scenario.name, dimensions);
    expect(dimensions["QUESTION_FIT"]?.pass).toBe(true);
    expect(dimensions["UNCERTAINTY_CALIBRATION"]?.pass).toBe(true);
  });

  // CRITICAL POSITIVE TEST: fresh driver evidence must resolve to ANSWERED.
  it("CRITICAL POSITIVE: fresh driver evidence resolves the drivers question to ANSWERED", async () => {
    const question = "What is moving gold prices this week?";
    const scenario: Scenario = {
      name: "CRITICAL POSITIVE",
      golden: {
        question,
        intent: "CURRENT_DRIVERS",
        temporalScope: "WEEKLY",
        minStatus: "ANSWERED",
        expectedEvidence: [/gold|XAU|real yield/i],
        forbiddenEvidence: [/BTC/i],
        maxConfidence: "HIGH",
      },
      plan: plan(question, [
        { description: "primary drivers of gold this week", importance: "CRITICAL", timeSensitivity: "CURRENT" },
        { description: "relationship between drivers and price", importance: "CRITICAL", timeSensitivity: "CURRENT" },
        { description: "counter-case flows", importance: "SUPPORTING", timeSensitivity: "CURRENT" },
      ], ["COMMODITY_MARKET_DATA", "NEWS_ANALYSIS", "MACRO_ANALYSIS"]),
      providers: new Map([
        ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "XAUUSD", metric: "week_performance", changePct: 2.4, driver: "real-yields decline" }), about: "gold" }]],
        ["NEWS_ANALYSIS", [{ content: "Gold rose this week as real yields fell and central-bank demand persisted.", about: "gold" }]],
        ["MACRO_ANALYSIS", [{ content: "Real 10-year yields dropped 16bp this week, driving non-yielding gold higher.", about: "rates" }]],
      ]),
      capabilityParams: { asset: "XAUUSD" },
    };
    const run = await execute(scenario);
    expect(run.outcome.questionResolution?.status).toBe("ANSWERED");
    expect(run.outcome.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
    const dimensions = score(run, scenario.golden);
    report(scenario.name, dimensions);
    const failed = DIMENSIONS.filter((d) => dimensions[d]?.pass !== true);
    expect(failed, `failing dimensions: ${failed.join(", ")}`).toHaveLength(0);
  });

  // EVIDENCE QUALITY ≠ QUESTION RESOLUTION: valid, relevant, fresh evidence can still fail
  // QUESTION_FIT when the required dimensions of the question shape are missing.
  it("EVIDENCE QUALITY ≠ QUESTION RESOLUTION: relevant fresh evidence without driver dimensions fails resolution", async () => {
    const question = "What is driving crude oil prices this week?";
    const scenario: Scenario = {
      name: "EVIDENCE QUALITY ≠ RESOLUTION",
      golden: {
        question,
        intent: "CURRENT_DRIVERS",
        temporalScope: "WEEKLY",
        minStatus: "NOT_ANSWERED",
        expectedEvidence: [/oil|WTI|crude/i],
        forbiddenEvidence: [],
        maxConfidence: "LOW",
      },
      plan: plan(question, [
        { description: "current oil price level", importance: "CRITICAL", timeSensitivity: "CURRENT" },
      ], ["COMMODITY_MARKET_DATA"]),
      providers: new Map([
        ["COMMODITY_MARKET_DATA", [{ content: JSON.stringify({ instrument: "WTI", metric: "spot_latest", price: 70.9, changePct: 0.4 }), about: "WTI" }]],
      ]),
      capabilityParams: { asset: "WTI" },
      budgetRounds: 1,
    };
    const run = await execute(scenario);
    const { outcome } = run;
    // Evidence is relevant (oil) and fresh (no staleDaysAgo), yet the drivers question is
    // not resolved: a price snapshot is not a driver analysis.
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(outcome.evidence.every((e) => /oil|WTI|crude|price/i.test(e.observation + (e.subject ?? "")))).toBe(true);
    expect(outcome.questionResolution?.status).not.toBe("ANSWERED");
    expect(outcome.stoppedBecause).not.toBe("EVIDENCE_SUFFICIENT");
    expect(outcome.confidence?.level).not.toBe("HIGH");
    const dimensions = score(run, scenario.golden);
    report(scenario.name, dimensions);
    expect(dimensions["QUESTION_FIT"]?.pass).toBe(true);
    expect(dimensions["EVIDENCE_RELEVANCE"]?.pass).toBe(true);
    expect(dimensions["RECENCY"]?.pass).toBe(true);
    expect(dimensions["ANSWER_COVERAGE"]?.pass).toBe(true);
  });
});
