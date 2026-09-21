/**
 * Adaptive research loop; model-assisted planning over the capability-first engine (M3 §7/§8).
 *
 * Architectural basis:
 * - M3 §7: the model may plan (what's needed, which capabilities, gaps, sufficiency) but NEVER
 *   executes tools. The engine converts validated plans into capability requests. No
 *   hardcoded Flow→Skill mappings; capabilities only (final lock §6/§11).
 * - M3 §8: the living loop QUESTION → PLAN → RESEARCH → EVIDENCE → CLAIMS → … → DECIDE
 *   plans CHANGE when validated evidence contradicts the working view; the loop STOPS when
 *   evidence is sufficient. Information value, uncertainty, contradiction, and expected
 *   judgment impact drive continuation; never "run every capability".
 * - Failure semantics (§19): tool failure ≠ research failure ≠ model failure. A failed round
 *   is recorded, not retried forever, and never becomes negative evidence.
 * - Bounded rounds: the engine owns the loop budget (MAX_ROUNDS); the model can propose but
 *   the engine decides when the loop must stop; with the reason recorded.
 */

import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import {
  RESEARCH_PLAN_SCHEMA_DESC, ADAPTIVE_DECISION_SCHEMA_DESC, parseResearchPlan, parseAdaptiveDecision,
  type ProposedResearchPlan, type AdaptiveDecision, type PlannedStep,
} from "../model/schemas.js";
import { evidenceFromToolResult } from "../domain/evidence.js";
import { normalizedResult } from "../domain/tool-result.js";
import { subjectTermsOf } from "../domain/instruments.js";
import { currentRun } from "../domain/run-context.js";
import { synthesizeAnswer, renderAnswerSynthesis, type AnswerSynthesis } from "./synthesis.js";
import {
  assessCoverage,
  buildRequirements,
  coverageVerdict,
  mandatoryCapabilities,
  SUBJECT_REQUIRED_CAPABILITIES,
  exhaustUnresolved,
  concernsSubject,
  recoveryCapabilities,
  requirementsFromTasks,
  type CoverageEvidence,
  type ResearchRequirement,
} from "./requirements.js";
import type { Evidence, Research } from "../domain/objects.js";
import { createEvidence } from "../domain/objects.js";
import { eventWindowEvidence, type EventWindowSpec } from "./event-window.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { Workspace } from "../domain/workspace.js";
import { progressEvent, type ProgressListener } from "./progress.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ToolResult } from "../domain/tool-result.js";
import { buildResearchContext, renderResearchContext, type ResearchContext } from "./context.js";

export const MAX_RESEARCH_ROUNDS = 3;

export interface RoundExecution {
  readonly round: number;
  readonly capability: string;
  readonly result: ToolResult;
  readonly evidenceIds: readonly string[];
}

export interface AdaptiveLoopOutcome {
  readonly research: Research;
  readonly plan: ProposedResearchPlan;
  readonly rounds: readonly {
    readonly round: number;
    readonly executions: readonly RoundExecution[];
    readonly decision: AdaptiveDecision;
  }[];
  readonly executions: readonly RoundExecution[];
  readonly finalDecision: AdaptiveDecision;
  readonly evidence: readonly Evidence[];
  readonly stoppedBecause: "EVIDENCE_SUFFICIENT" | "MODEL_INSUFFICIENT_EVIDENCE" | "HOLLOW_COMPLETE_RECOVERY" | "REQUIREMENT_GAPS_UNRESOLVED" | "ROUND_BUDGET_EXHAUSTED" | "TIME_BUDGET_EXHAUSTED" | "MODEL_FAILURE";
  /** Typed model failure when the loop ended that way; never fabricated around. */
  readonly modelFailure?: ModelFailure;
  /**
   * The synthesized ANSWER to the trader's question (analysis of the validated evidence),
   * distinct from `finalDecision.rationale` which only justifies stopping. Absent when no
   * evidence was gathered or the synthesis model failed.
   */
  readonly answer?: string;
  readonly synthesis?: AnswerSynthesis;
  readonly context: ResearchContext;
  /**
   * The engine's final requirement ledger: the coverage state the completion verdict was
   * computed from. The API layer turns UNRESOLVED CRITICAL entries into the response's
   * researchGaps (material research gaps), which is what may appear in the answer's
   * coverage panel; capability/provider notes never do.
   */
  readonly requirements?: readonly ResearchRequirement[];
  /**
   * Capabilities the ENGINE's capability floor required beyond the model's plan (the model
   * may propose capabilities; it may not omit one a CRITICAL requirement depends on).
   */
  readonly floorCapabilities?: readonly string[];
  /** Engine-scheduled gap-recovery rounds actually spent (bounded). */
  readonly recoveryRounds?: number;
}

/** Schemas as prompt fragments; the model must answer in one of these shapes. */
export { RESEARCH_PLAN_SCHEMA_DESC, ADAPTIVE_DECISION_SCHEMA_DESC };

/**
 * The planner's capability vocabulary, declared ONCE and consumed by BOTH the prompt below
 * AND the zero-dead-end conformance test: any capability added here without a registered
 * provider fails the test at build time, so "no provider registered" can never reach a user.
 */
export const PLANNER_CAPABILITIES: readonly string[] = [
  "MARKET_DATA_ANALYSIS", "TECHNICAL_ANALYSIS", "SENTIMENT_ANALYSIS", "NEWS_ANALYSIS", "MACRO_ANALYSIS",
  "DERIVATIVES_ANALYSIS", "HISTORICAL_COMPARISON", "FALSIFICATION", "SOURCE_VALIDATION", "WEB_SEARCH",
  "CROSS_DOMAIN_SYNTHESIS", "ONCHAIN_ANALYSIS", "DEFI_ANALYSIS", "PROJECT_RESEARCH",
  "EQUITY_MARKET_DATA", "EQUITY_FUNDAMENTALS", "EARNINGS_CALENDAR", "OPTIONS_CHAIN_ANALYSIS", "EQUITY_NEWS",
  "LOCAL_KNOWLEDGE_RETRIEVAL",
];
/**
 * The planner's capability vocabulary lives here and ONLY here; the zero-dead-end
 * conformance test imports it to prove every name below resolves to a registered provider.
 */
export const PLAN_SYSTEM = [
  "You are the research planner inside a trading RESEARCH workbench. You plan; you never execute.",
  `The system executes capabilities on your behalf and returns validated evidence. Available capabilities: ${PLANNER_CAPABILITIES.join(", ")}.
  Plan rules:`,
  "- Request CAPABILITIES. Never name providers or vendor tools.",
  "- Crypto assets: MARKET_DATA_ANALYSIS, TECHNICAL_ANALYSIS, SENTIMENT_ANALYSIS, NEWS_ANALYSIS, MACRO_ANALYSIS, DERIVATIVES_ANALYSIS (funding/open interest), HISTORICAL_COMPARISON, FALSIFICATION, SOURCE_VALIDATION or WEB_SEARCH (same discovery capability), CROSS_DOMAIN_SYNTHESIS.",
  "- Equities and listed instruments (stocks, ETFs): EQUITY_MARKET_DATA (price, OHLCV, volume), EQUITY_FUNDAMENTALS (revenue, margins, valuation, shares), EARNINGS_CALENDAR (next/last earnings dates and consensus estimates), OPTIONS_CHAIN_ANALYSIS (options chains, only when options are explicitly relevant), EQUITY_NEWS (company headlines), plus the shared NEWS_ANALYSIS / MACRO_ANALYSIS / HISTORICAL_COMPARISON / FALSIFICATION / SOURCE_VALIDATION capabilities.",
  "- Commodities (gold, silver, oil), FX pairs, indexes (SPX, VIX, DXY) and broad cross-asset questions: NEWS_ANALYSIS and MACRO_ANALYSIS carry the investigation; EQUITY_MARKET_DATA may be added ONLY when a concrete tradable target is named (gold, EUR/USD, VIX all resolve). Do NOT request equity or crypto market-data capabilities when no target is resolvable; a capability without a target only produces provider-failure noise.",
  "- On-chain and DeFi questions (wallet/token activity, protocol TVL, L2 metrics, DEX structure): ONCHAIN_ANALYSIS (address/holder/trade observations where an address is resolvable) and DEFI_ANALYSIS (protocol/chain/L2 metrics); PROJECT_RESEARCH covers project descriptions, DEX pair discovery, and narrative/trending context.",
  "- Broad synthesis questions that may span domains: CROSS_DOMAIN_SYNTHESIS is available as a deep-research capability of last resort; prefer specific capabilities first. WEB_SEARCH (bounded source discovery) is available when narrative or primary-source hunting matters.",
  "- For a company question, plan the smallest set that can answer it: market data for what happened, earnings/estimates for event context, company news for narrative, macro or index context only when the question crosses into the broader market.",
  "- REQUIREMENTS: also state the INFORMATION REQUIREMENTS that would answer the question, as a `requirements` array. Each entry is what must be KNOWN, in plain words (for example \"current policy or rates regime\", \"oil-specific supply developments\", \"the company's next earnings date and consensus estimates\", \"how similar setups resolved previously\"), with importance CRITICAL or SUPPORTING and a timeSensitivity of CURRENT, RECENT, HISTORICAL, or ANY. Requirements are the engine's coverage checklist: it re-checks each one against actual evidence and recovers the uncovered ones. State 3 to 8 requirements, each independently checkable, never a provider or tool name. When the question names an explicit recency window (\"today\", \"this week\", \"right now\", \"this month\"), carry that wording into the requirements it applies to: the engine uses it to reject event-dated coverage that falls outside the window.",
  "- EVENT EPISODES: when the question asks how an asset reacted to a PAST EVENT (\"how did gold and bitcoin behave around government shutdowns\", \"what happened the last time X\"), also state an `eventEpisodes` array: one entry per historical episode that would decide the question, each with the event's name, its approximate `from`/`to` ISO dates, and the `assets` (canonical names or tickers) whose market windows must be analyzed. The engine retrieves the candle history for those windows and computes the reaction metrics deterministically; name episodes only when their dates are historically well established (a recent, well-known shutdown; a named market crash; a specific policy decision).",
  "- LOCAL_KNOWLEDGE_RETRIEVAL serves the trader's own saved context (frameworks, saved research conclusions, memories, theses). When the question references our research, my framework, previous findings, or an evaluation against stored criteria, request it FIRST; live providers then supply the current-state evidence that outranks stale local claims.",
  "- Select the smallest capability set with material information value. Do not request every capability.",
  "- Respect trader constraints (e.g. exclusions) in scope.",
  "- Never assume evidence that does not exist yet; plan tasks around what would decide the question.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const ADAPTIVE_SYSTEM = [
  "You are the adaptive decision-maker inside a trading RESEARCH workbench. You decide whether research continues; you never execute anything.",
  "You receive the validated research context with epistemic classes preserved. Rules:",
  "- Interpretations/inferences/speculation are NOT observations. Do not upgrade them.",
  "- LIMITATIONS are data-availability conditions. They are NOT evidence against any claim. Never convert a tool failure into a negative finding.",
  "- Insufficient evidence is a valid outcome; prefer honesty over forced conclusions.",
  "- Continue only when additional capabilities have MATERIAL information value (could change the judgment). Otherwise COMPLETE.",
  "- Contradictory evidence may warrant one more targeted investigation; with capabilities, never providers.",
  "- The rationale is shown to the trader as the research ANSWER: it must state the SUBSTANCE of the findings, with the key concrete observations (numbers, dates, names, levels) from the context. Never write process commentary such as 'sufficient observations have been gathered'; describe what the evidence shows.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

function planPrompt(objective: string, constraints: readonly string[]): string {
  return [
    `Research objective: ${objective}`,
    constraints.length > 0 ? `Trader constraints: ${constraints.join("; ")}` : "",
    "Produce a research plan as JSON conforming to schema \"research.plan\".",
    RESEARCH_PLAN_SCHEMA_DESC,
  ].filter((l) => l !== "").join("\n");
}

function adaptivePrompt(ctx: ResearchContext, round: number): string {
  return [
    `Round ${round} of the adaptive loop for the research objective above.`,
    "Validated research context follows.",
    "---",
    renderResearchContext(ctx),
    "---",
    "Decide: CONTINUE (with nextTasks naming capabilities), COMPLETE (evidence sufficient), or INSUFFICIENT_EVIDENCE (valid completion when evidence cannot answer the objective).",
    "Respond as JSON conforming to schema \"research.adaptive_decision\".",
    ADAPTIVE_DECISION_SCHEMA_DESC,
  ].join("\n");
}

export interface AdaptiveLoopOptions {
  readonly provider: ModelProvider;
  readonly registry: CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** Trader constraints from the LUI (e.g. ["ignore social sentiment"]). */
  readonly constraints?: readonly string[];
  /** Fixed news-style capability params (asset etc.) merged into every capability call. */
  readonly capabilityParams?: Readonly<Record<string, unknown>>;
  readonly maxRounds?: number;
  /** Bounded gap-recovery rounds the engine may schedule beyond the planner's rounds. */
  readonly maxRecoveryRounds?: number;
  /**
   * Wall-clock deadline for the whole loop (epoch ms). When crossed, the loop stops with the
   * honest TIME_BUDGET_EXHAUSTED reason and the evidence gathered so far is preserved; it is
   * never treated as a model failure and nothing is fabricated to fill the gap.
   */
  readonly deadlineMs?: number;
  readonly now?: () => Date;
  /** F0 SSE seam: optional listener for REAL lifecycle events (never model reasoning/payloads). */
  readonly onProgress?: ProgressListener;
}

/**
 * Run the adaptive loop: model-proposed plan → engine executes capabilities round-by-round →
 * evidence into the graph → model decides continue/complete with the updated context.
 * The model NEVER calls capabilities directly; every execution goes through the registry.
 */
export async function runAdaptiveResearch(
  objective: string,
  researchRef: string,
  options: AdaptiveLoopOptions,
): Promise<AdaptiveLoopOutcome> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "adaptive research loop" };
  const workspace = options.workspace;
  const maxRounds = options.maxRounds ?? MAX_RESEARCH_ROUNDS;
  // Subject scope (target-relevance law): derive the question's subject terms (instrument,
  // tickers, crypto aliases) once. When they resolve, BOTH context builds gate ALL evidence
  // — including this run's own — against the subject, so wrong-domain provider output can
  // never become the question's findings. Continuation-style objectives (no resolvable
  // subject) keep run-scoped semantics.
  const resolvedAsset = typeof options.capabilityParams?.asset === "string" ? options.capabilityParams.asset : undefined;
  const subjectTerms = subjectTermsOf(objective, resolvedAsset);

  // ID RESERVATION (multi-instance law): claim this run's monotonic id in the shared blob
  // BEFORE the (long) research work. Serverless instances seed their counters from the blob;
  // a run that only persists at conclusion is invisible to a concurrent instance, which then
  // mints the SAME id and silently overwrites one run with the other (observed live:
  // rs_000070 held both an oil and a gold run). Best-effort: the conclusion save (which
  // propagates failures) stays authoritative, so a reservation hiccup cannot fail the run.
  try {
    await options.store.save(workspace.toSnapshot());
  } catch {
    // Ignored by design; see above.
  }

  // 1. Model proposes the plan (validated; invalid output = model failure, not execution).
  let plan: ProposedResearchPlan;
  try {
    const planResponse = await options.provider.structured<string>({
      schemaName: "research.plan",
      schemaDescription: RESEARCH_PLAN_SCHEMA_DESC,
      system: PLAN_SYSTEM,
      prompt: planPrompt(objective, options.constraints ?? []),
      preferJson: true,
    });
    plan = parseResearchPlan(planResponse.raw);
    options.onProgress?.(progressEvent("research_plan_created", at(), `research plan created with ${plan.tasks.length} task(s)`, { tasks: plan.tasks.length }));
  } catch (error) {
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", `plan validation failed: ${error instanceof Error ? error.message : String(error)}`, false);
    throw failure;
  }

  // 2. Rounds: execute → ingest evidence → decide with the updated context.
  const allExecutions: RoundExecution[] = [];
  const rounds: { round: number; executions: readonly RoundExecution[]; decision: AdaptiveDecision }[] = [];
  // Both are assigned on every loop path (each iteration ends in break or the final round
  // sets the budget-exhausted outcome); definite-assignment avoids a fabricated default.
  let finalDecision!: AdaptiveDecision;
  let stoppedBecause!: AdaptiveLoopOutcome["stoppedBecause"];
  let modelFailure: ModelFailure | undefined;
  // REQUIREMENT COVERAGE (engine-owned completion law): the planner declares what must be
  // KNOWN; when it does not, requirements derive from its tasks. Coverage is re-assessed
  // after every round from this run's actual evidence, and the ENGINE (never the model)
  // decides completion. Gaps drive bounded recovery rounds, then honest insufficiency.
  let requirements: readonly ResearchRequirement[] =
    plan.requirements !== undefined && plan.requirements.length > 0
      ? buildRequirements(plan.requirements)
      : requirementsFromTasks(plan.tasks);
  /** Wrong-target observations discarded at ingestion (diagnostic; never user-facing noise). */
  let rejectedAtIngestion = 0;
  /** Capabilities for the NEXT round when it is a gap-recovery round (engine-scheduled). */
  let recoveryRoundCapabilities: readonly string[] | undefined;
  /** Capabilities the engine's floor added to round 1 beyond the model's plan (diagnostic). */
  let floorCapabilities: readonly string[] = [];
  /**
   * Can this capability actually run for THIS question? Registered providers AND, for
   * symbol-scoped capabilities, a subject the question earned — otherwise the engine would
   * schedule a guaranteed SCHEMA_ERROR (observed live on the macro-regime question).
   */
  const capabilityUsable = (cap: string): boolean =>
    options.registry.resolve(cap as Parameters<typeof options.registry.resolve>[0]).length > 0 &&
    (resolvedAsset !== undefined || !SUBJECT_REQUIRED_CAPABILITIES.includes(cap));
  let recoveryRoundsUsed = 0;
  const MAX_RECOVERY_ROUNDS = options.maxRecoveryRounds ?? 2;

  for (let round = 1; round <= maxRounds; round += 1) {
    // Determine this round's tasks: round 1 = the plan; a gap-recovery round = the engine's
    // recovery capabilities; later rounds = the decision's nextTasks.
    const roundTasks: { objective: string; capabilities: readonly string[]; completion: string }[] =
      recoveryRoundCapabilities !== undefined
        ? [{ objective, capabilities: [...recoveryRoundCapabilities], completion: "recover the uncovered research requirements" }]
        : round === 1
          ? plan.tasks.map((t) => ({ objective: t.objective, capabilities: t.capabilities, completion: t.completion }))
          : [...(rounds[rounds.length - 1]?.decision.nextTasks ?? [])];
    // CAPABILITY FLOOR (engine-owned, round 1): the model proposes capabilities, but it may
    // not omit one that an engine-derived CRITICAL requirement depends on. Live failure this
    // prevents: a yields question whose plan named no direct market capability, so no yield
    // observation was ever retrieved and the run reported "insufficient" without trying.
    if (round === 1) {
      const planned = new Set(roundTasks.flatMap((t) => [...t.capabilities]));
      const floor: string[] = [
        ...mandatoryCapabilities(requirements, { isAvailable: capabilityUsable, exclude: [...planned] }),
      ];
      // COUNTEREVIDENCE FLOOR (coverage contract): an analytic question must ATTEMPT
      // disconfirmation, not only confirmation. One bounded call, made whenever the engine has
      // a CRITICAL requirement to test and has not already planned it — the model asking for
      // opposing evidence is a prompt convention; this makes it an engine action.
      const falsification = "FALSIFICATION";
      if (
        !planned.has(falsification) &&
        floor.length < 4 &&
        requirements.some((r) => r.importance === "CRITICAL") &&
        capabilityUsable(falsification)
      ) {
        floor.push(falsification);
      }
      floorCapabilities = [...floor];
      if (floor.length > 0) {
        roundTasks.push({
          objective,
          capabilities: floor,
          completion: "engine-required capabilities for this question's CRITICAL requirements",
        });
        options.onProgress?.(
          progressEvent("capability_started", at(), `capability floor: ${floor.join(", ")} required by this question's CRITICAL requirements`, { capability: floor[0] ?? "floor" }),
        );
      }
    }
    if (recoveryRoundCapabilities !== undefined) {
      recoveryRoundsUsed += 1;
      recoveryRoundCapabilities = undefined;
    }

    const executions: RoundExecution[] = [];
    for (const task of roundTasks) {
      // Independent capability calls run in PARALLEL (performance mandate §32): the registry
      // executes each through its own provider chain with bounded transport timeouts, and one
      // failure never cancels siblings. Evidence ingestion stays in plan order after all
      // settle, so determinism of the research graph is preserved.
      const pending = task.capabilities.map(async (capability) => {
        options.onProgress?.(progressEvent("capability_started", at(), `capability ${capability} started`, { capability }));
        const result = await options.registry.execute(
          capability,
          { ...(options.capabilityParams ?? {}) },
          systemOrigin,
          at(),
        );
        options.onProgress?.(progressEvent("capability_completed", at(), `capability ${capability} completed: ${result.failure.type === "NONE" ? result.completeness : `failed (${result.failure.type})`}`, { capability, ...(result.failure.type === "NONE" ? { completeness: result.completeness } : { failureType: result.failure.type }) }));
        return { capability, result };
      });
      const settled = await Promise.all(pending);
      for (const { capability, result } of settled) {
        const evidenceIds: string[] = [];
        if (result.failure.type === "NONE" && result.validation !== "INVALID") {
          for (const output of result.normalizedOutput) {
            try {
              const evidence = evidenceFromToolResult(
                result,
                output,
                { kind: "tool", toolRef: result.tool, invocation: result.invocation.params },
                {},
                at(),
              );
              // INGESTION GATE (target-relevance law, first line of defense): when the
              // question's subject resolved, provider output that does not concern it never
              // becomes this run's evidence. The live failure this prevents: crypto RSS
              // headlines attaching to an oil run, then being described as "the available
              // research context" instead of the oil data that WAS retrieved.
              // The declared subject (`about`) is honored as well as the observation text:
              // a quantitative payload often never names its own ticker.
              const concernsQuestion =
                subjectTerms !== undefined &&
                evidence.subject !== undefined &&
                concernsSubject(evidence.subject, subjectTerms);
              if (
                subjectTerms !== undefined &&
                subjectTerms.size > 0 &&
                !concernsSubject(evidence.observation, subjectTerms) &&
                !concernsQuestion
              ) {
                rejectedAtIngestion += 1;
                options.onProgress?.(progressEvent("capability_completed", at(), `${capability}: ${rejectedAtIngestion} wrong-target observation(s) discarded (do not concern the question's subject)`, { capability }));
                continue;
              }
              workspace.ingestEvidence(evidence, researchRef);
              evidenceIds.push(evidence.id);
            } catch {
              // UNAVAILABLE/ERROR outputs never become evidence (evidence.ts invariant).
            }
          }
        }
        const execution: RoundExecution = { round, capability, result, evidenceIds };
        executions.push(execution);
        allExecutions.push(execution);
      }
    }

    // 2b. Requirement coverage from THIS run's evidence (engine-assessed; never the model).
    requirements = assessCoverage(requirements, coverageEvidenceOf(workspace, researchRef), {
      ...(subjectTerms !== undefined ? { subjectTerms } : {}),
      now: at(),
    });

    // 3. Adaptive decision with the updated, validated context (coverage included).
    const context = buildResearchContext(workspace, {
      researchRef,
      relevantTo: objective,
      ...(subjectTerms !== undefined ? { subjectTerms: [...subjectTerms] } : {}),
      requirements,
      executions: allExecutions.map((e) => ({ capability: e.capability, result: e.result })),
    });
    let decision: AdaptiveDecision;
    try {
      const decisionResponse = await options.provider.structured<string>({
        schemaName: "research.adaptive_decision",
        schemaDescription: ADAPTIVE_DECISION_SCHEMA_DESC,
        system: ADAPTIVE_SYSTEM,
        prompt: adaptivePrompt(context, round),
        preferJson: true,
      });
      decision = parseAdaptiveDecision(decisionResponse.raw);
    } catch (error) {
      modelFailure = error instanceof ModelFailure
        ? error
        : new ModelFailure("INVALID_OUTPUT", `adaptive decision validation failed: ${error instanceof Error ? error.message : String(error)}`, false);
      stoppedBecause = "MODEL_FAILURE";
      finalDecision = {
        decision: "INSUFFICIENT_EVIDENCE",
        rationale: "The interpretation model became unavailable before evidence could be gathered; nothing was fabricated. The request can be retried.",
        nextTasks: [],
      };
      rounds.push({ round, executions, decision: finalDecision });
      // Persist before the early return (lock §14): a model failure must not erase the rounds
      // already executed. Persistence failure propagates as a persistence failure.
      await options.store.save(workspace.toSnapshot());
      return {
        research: mustResearch(workspace, researchRef),
        plan,
        rounds,
        executions: allExecutions,
        finalDecision,
        evidence: allExecutions.flatMap((e) => e.evidenceIds).map((id) => workspace.getEvidence(id)).filter((e): e is Evidence => e !== undefined),
        stoppedBecause,
        ...(modelFailure !== undefined ? { modelFailure } : {}),
        context,
        requirements,
      };
    }

    options.onProgress?.(progressEvent("research_round_completed", at(), `research round ${round} completed: ${decision.decision}`, { round, decision: decision.decision }));
    rounds.push({ round, executions, decision });

    if (decision.decision === "COMPLETE") {
      // HOLLOW-COMPLETE GUARD (target-relevance law): a COMPLETE with zero subject-relevant
      // run evidence is not a completion — it is the live "crypto evidence answered an oil
      // question" failure wearing a green checkmark. The engine (not the model) owns
      // completion; when the subject gate rejected EVERY item this run collected, the
      // correct next state is RECOVERY.
      const runEvidenceIds = new Set(allExecutions.flatMap((e) => e.evidenceIds));
      const relevantRunEvidence = [...runEvidenceIds].filter((id) => context.items.some((i) => i.ref === id)).length;
      if (subjectTerms !== undefined && runEvidenceIds.size > 0 && relevantRunEvidence === 0) {
        stoppedBecause = "HOLLOW_COMPLETE_RECOVERY";
        finalDecision = {
          decision: "INSUFFICIENT_EVIDENCE",
          rationale: "The capabilities executed for this question returned evidence that does not concern the question's subject; specialized research recovery runs before any answer.",
          nextTasks: [],
        };
        break;
      }
      // REQUIREMENT-COVERAGE GATE: the model may only conclude COMPLETE when the engine's
      // coverage assessment agrees. Blocking CRITICAL requirements (missing, or satisfied
      // only by STALE observations for a CURRENT question) trigger bounded recovery rounds
      // driven by the gap's CAPABILITIES; only after recovery is spent does the run end
      // honestly insufficient, naming the requirement it could not satisfy.
      const verdict = coverageVerdict(requirements);
      if (verdict.complete) {
        stoppedBecause = "EVIDENCE_SUFFICIENT";
        finalDecision = decision;
        break;
      }
      const recoveryCaps = recoveryCapabilities(verdict.blocking, {
        // Availability is the same predicate as the floor: a registered provider AND, for
        // symbol-scoped capabilities, a subject the question earned.
        isAvailable: capabilityUsable,
        // Recovery must try NEW paths: a capability that already ran this round cannot
        // satisfy a gap it just failed (re-running it only duplicates evidence).
        exclude: allExecutions.map((e) => e.capability),
      });
      if (recoveryRoundsUsed < MAX_RECOVERY_ROUNDS && recoveryCaps.length > 0 && round < maxRounds) {
        requirements = requirements.map((r) =>
          verdict.blocking.some((b) => b.id === r.id) ? { ...r, recoveryAttempts: r.recoveryAttempts + 1 } : r,
        );
        recoveryRoundCapabilities = recoveryCaps;
        options.onProgress?.(
          progressEvent("capability_started", at(), `recovering uncovered requirements via ${recoveryCaps.join(", ")}`, { capability: recoveryCaps[0] ?? "recovery" }),
        );
        continue; // engine-scheduled recovery round
      }
      requirements = exhaustUnresolved(requirements, recoveryCaps.length > 0 ? recoveryCaps : ["direct capabilities"]);
      stoppedBecause = "REQUIREMENT_GAPS_UNRESOLVED";
      finalDecision = {
        decision: "INSUFFICIENT_EVIDENCE",
        rationale: coverageGapRationale(requirements),
        nextTasks: [],
      };
      break;
    }
    if (decision.decision === "INSUFFICIENT_EVIDENCE") {
      // ENGINE-OWNED RECOVERY: the model may not end a run on "insufficient" while the
      // engine's coverage assessment still reports blocking CRITICAL requirements and untried
      // recovery paths exist. "Insufficient" must mean the relevant registered evidence paths
      // were EXHAUSTED, never that the first plan came up short.
      const verdict = coverageVerdict(requirements);
      const recoveryCaps =
        verdict.blocking.length > 0
          ? recoveryCapabilities(verdict.blocking, {
              isAvailable: capabilityUsable,
              exclude: allExecutions.map((e) => e.capability),
            })
          : [];
      if (verdict.blocking.length > 0 && recoveryRoundsUsed < MAX_RECOVERY_ROUNDS && recoveryCaps.length > 0 && round < maxRounds) {
        requirements = requirements.map((r) =>
          verdict.blocking.some((b) => b.id === r.id) ? { ...r, recoveryAttempts: r.recoveryAttempts + 1 } : r,
        );
        recoveryRoundCapabilities = recoveryCaps;
        options.onProgress?.(
          progressEvent("capability_started", at(), `model reported insufficient evidence; recovering uncovered requirements via ${recoveryCaps.join(", ")}`, { capability: recoveryCaps[0] ?? "recovery" }),
        );
        continue; // engine-scheduled recovery round before accepting the insufficiency
      }
      if (verdict.blocking.length > 0) {
        requirements = exhaustUnresolved(requirements, recoveryCaps.length > 0 ? recoveryCaps : ["direct capabilities"]);
      }
      stoppedBecause = "MODEL_INSUFFICIENT_EVIDENCE";
      finalDecision = decision;
      break;
    }
    // Honest wall-clock budget: stop before the caller's execution window expires rather than
    // dying mid-flight (an in-flight run can never deliver its partial truth to the trader).
    if (options.deadlineMs !== undefined && at().getTime() >= options.deadlineMs) {
      stoppedBecause = "TIME_BUDGET_EXHAUSTED";
      finalDecision = partialDecision("TIME_BUDGET_EXHAUSTED", rounds.length, allExecutions.flatMap((e) => e.evidenceIds).length);
      options.onProgress?.(progressEvent("research_stopped", at(), `research stopped: ${stoppedBecause}`, { reason: stoppedBecause }));
      break;
    }
    if (round === maxRounds) {
      stoppedBecause = "ROUND_BUDGET_EXHAUSTED";
      finalDecision = partialDecision("ROUND_BUDGET_EXHAUSTED", rounds.length, allExecutions.flatMap((e) => e.evidenceIds).length);
      options.onProgress?.(progressEvent("research_stopped", at(), `research stopped: ${stoppedBecause}`, { reason: stoppedBecause }));
      break;
    }
  }

  // EVENT-WINDOW ANALYSIS (research contract §4/§5: raw historical data must become
  // analytical evidence). When the planner proposed historical event episodes, the engine
  // computes each episode's market windows DETERMINISTICALLY from this run's retrieved
  // candles and mints one derived evidence object per asset window. Raw candles satisfy a
  // historical-price requirement; ONLY this transformation satisfies a reaction requirement
  // ("how did BTC behave around shutdowns"). Missing candle coverage is reported honestly
  // (no window is computed, no data invented), and the window analysis runs BEFORE the
  // deep-research fallback so the fallback sees the derived evidence in its context too.
  const eventEpisodes = plan.eventEpisodes ?? [];
  if (eventEpisodes.length > 0) {
    // OHLCV evidence holds monthly JSON chunks; only those observations can feed a window.
    const candleObservations = allExecutions
      .flatMap((e) => e.evidenceIds)
      .map((id) => workspace.getEvidence(id))
      .filter((e): e is Evidence => e !== undefined)
      .map((e) => e.observation)
      .filter((obs) => obs.trim().startsWith("{"));
    for (const episode of eventEpisodes) {
      for (const asset of episode.assets) {
        const spec: EventWindowSpec = { event: episode.event, from: episode.from, to: episode.to, asset };
        const derived = eventWindowEvidence(spec, candleObservations);
        if (derived === undefined) {
          // The record does not cover this window: a genuine research gap, recorded on the
          // requirement ledger's terms rather than papered over. The coverage assessment
          // below still sees only the real evidence, so the requirement stays unsatisfied.
          options.onProgress?.(progressEvent("capability_started", at(), `event window for ${asset} around "${episode.event}" is not covered by the retrieved history; scheduling historical retrieval`, { capability: "HISTORICAL_COMPARISON" }));
          continue;
        }
        const evidence = createEvidence(
          {
            observation: derived.observation,
            evidenceType: "HISTORICAL_EVENT_WINDOW",
            evidenceClass: "DERIVED_OBSERVATION",
            freshness: "HISTORICAL",
            subject: asset.toUpperCase(),
          },
          { kind: "agent", detail: `event-window analysis: ${episode.event}` },
          at(),
        );
        workspace.ingestEvidence(evidence, researchRef);
        const windowResult = normalizedResult(
          {
            tool: "engine/event-window-analysis",
            capability: "HISTORICAL_COMPARISON",
            transport: "engine:derived",
            params: { ...spec },
            outputs: [],
            completeness: "COMPLETE",
            validation: "VALID",
            freshness: "HISTORICAL",
            failure: { type: "NONE", retriable: false },
            limitations: [],
          },
          { kind: "agent", detail: `event-window analysis: ${episode.event}` },
          at(),
        );
        allExecutions.push({ round: rounds.length + 1, capability: "HISTORICAL_COMPARISON", result: windowResult, evidenceIds: [evidence.id] });
        options.onProgress?.(progressEvent("capability_completed", at(), `event window analyzed: ${asset} during "${episode.event}": ${derived.result.metrics.returnPct ?? "n/a"}% over ${derived.result.metrics.candles} candles`, { capability: "HISTORICAL_COMPARISON" }));
      }
    }
  }

  // Deep-research fallback (engine-owned, never planner-dependent): when the loop concluded
  // with INSUFFICIENT_EVIDENCE, the direct capability chain failed the question — whether or
  // not unrelated archived evidence happened to be gathered along the way. Before concluding,
  // fire the last-resort deep-research tier (Caesar/AskHeurist, then Exa search) ONCE with
  // the EXACT question and await their response. The model never decides this (it does not
  // know provider coverage); the engine knows when the direct chain could not answer. Outputs
  // remain classified by the evidence layer (agent analysis, never direct observation).
  // Mechanical budget stops are also dead ends the backstop must try to recover: the loop
  // never reached a substantive conclusion, so deep research with the exact objective is the
  // last legitimate path before declaring genuine insufficiency (§19).
  const budgetStopped = stoppedBecause === "TIME_BUDGET_EXHAUSTED" || stoppedBecause === "ROUND_BUDGET_EXHAUSTED";
  const deepResearchFired =
    (stoppedBecause === "MODEL_INSUFFICIENT_EVIDENCE" || budgetStopped || stoppedBecause === "HOLLOW_COMPLETE_RECOVERY" || stoppedBecause === "REQUIREMENT_GAPS_UNRESOLVED") &&
    !allExecutions.some((e) => e.capability === "CROSS_DOMAIN_SYNTHESIS") &&
    options.registry.resolve("CROSS_DOMAIN_SYNTHESIS").length > 0 &&
    (options.deadlineMs === undefined || at().getTime() < options.deadlineMs);
  if (deepResearchFired) {
    // Tier 1: research agents (Caesar -> AskHeurist via the registry's provider chain).
    // Tier 2: bounded Exa search when the research agents returned nothing usable. The
    // engine awaits the agent response; its findings are ingested as classified evidence
    // (agent analysis / secondary reporting, never upgraded to direct observation).
    const deepRound: RoundExecution[] = [];
    const deepCapabilities: { capability: "CROSS_DOMAIN_SYNTHESIS" | "WEB_SEARCH"; label: string }[] = [
      { capability: "CROSS_DOMAIN_SYNTHESIS", label: "deep-research agents" },
    ];
    if (options.registry.resolve("WEB_SEARCH").length > 0) {
      deepCapabilities.push({ capability: "WEB_SEARCH", label: "web search agents" });
    }
    for (const { capability, label } of deepCapabilities) {
      let gathered = 0;
      try {
        options.onProgress?.(progressEvent("capability_started", at(), `direct capabilities could not answer the question; invoking ${label} with the exact question`, { capability }));
        const result = await options.registry.execute(
          capability,
          { ...(options.capabilityParams ?? {}), question: objective },
          systemOrigin,
          at(),
        );
        options.onProgress?.(progressEvent("capability_completed", at(), `${label} completed: ${result.failure.type === "NONE" ? result.completeness : `failed (${result.failure.type})`}`, { capability }));
        const evidenceIds: string[] = [];
        if (result.failure.type === "NONE" && result.validation !== "INVALID") {
          for (const output of result.normalizedOutput) {
            try {
              const evidence = evidenceFromToolResult(
                result,
                output,
                { kind: "tool", toolRef: result.tool, invocation: result.invocation.params },
                {},
                at(),
              );
              workspace.ingestEvidence(evidence, researchRef);
              evidenceIds.push(evidence.id);
            } catch {
              // UNAVAILABLE/ERROR outputs never become evidence (evidence.ts invariant).
            }
          }
        }
        gathered = evidenceIds.length;
        const execution: RoundExecution = { round: rounds.length + 1, capability, result, evidenceIds };
        deepRound.push(execution);
        allExecutions.push(execution);
      } catch {
        // A deep-research throw is recorded as a failed round, never a crash.
        continue;
      }
      // A tier that found material evidence satisfies the question; only a still-empty
      // tier falls through to the next one.
      if (gathered > 0) break;
    }
    rounds.push({ round: rounds.length + 1, executions: deepRound, decision: finalDecision });
    // Deep research that DID find material evidence upgrades the conclusion (§13: after
    // research recovery, found evidence is a substantive answer — not insufficiency).
    const totalEvidence = allExecutions.flatMap((e) => e.evidenceIds).length;
    if (deepRound.some((e) => e.evidenceIds.length > 0) && finalDecision.decision === "INSUFFICIENT_EVIDENCE") {
      finalDecision = {
        decision: "COMPLETE",
        rationale: `Direct sources could not cover this question; deep-research agents gathered ${totalEvidence} evidence object(s) against the exact objective. Their outputs are labeled as agent analysis in the evidence below.`,
        nextTasks: [],
      };
    }
  }

  // Lifecycle honesty: the loop CONCLUDED (by sufficiency, insufficiency, budget, or model
  // failure); the research object must reflect that instead of staying ACTIVE forever.
  workspace.transitionResearch(researchRef, "COMPLETED", { kind: "agent", detail: "adaptive research loop" }, `research concluded: ${stoppedBecause}`, at());
  // Persist the completed loop (lock §14). A store failure propagates; never reported as success.
  await options.store.save(workspace.toSnapshot());
  const collected = allExecutions.flatMap((e) => e.evidenceIds).map((id) => workspace.getEvidence(id)).filter((e): e is Evidence => e !== undefined);
  const finalContext = buildResearchContext(workspace, {
    researchRef,
    relevantTo: objective,
    ...(subjectTerms !== undefined ? { subjectTerms: [...subjectTerms] } : {}),
    requirements,
    executions: allExecutions.map((e) => ({ capability: e.capability, result: e.result })),
  });
  // ANSWER SYNTHESIS (research contract: retrieval is not synthesis). The decision rationale
  // answers "may research stop?", not the trader's question; asking the engine to also ANSWER
  // is what turns validated evidence into a factor analysis. Best-effort: when the model
  // cannot produce a schema-valid synthesis, the deterministic evidence-grounded response is
  // used instead and nothing is fabricated.
  let answer: string | undefined;
  let synthesis: AnswerSynthesis | undefined;
  if (collected.length > 0 && stoppedBecause !== "MODEL_FAILURE") {
    synthesis = await synthesizeAnswer({ provider: options.provider, question: currentRun()?.userQuestion ?? objective, context: finalContext });
    if (synthesis !== undefined) answer = renderAnswerSynthesis(synthesis);
  }
  return {
    research: mustResearch(workspace, researchRef),
    plan,
    rounds,
    executions: allExecutions,
    finalDecision,
    evidence: collected,
    stoppedBecause,
    ...(modelFailure !== undefined ? { modelFailure } : {}),
    ...(answer !== undefined ? { answer } : {}),
    ...(synthesis !== undefined ? { synthesis } : {}),
    context: finalContext,
    requirements,
    ...(floorCapabilities.length > 0 ? { floorCapabilities } : {}),
    recoveryRounds: recoveryRoundsUsed,
  };
}

/**
 * Mechanical budget stops (round/wall-clock) are NOT model conclusions about the evidence.
 * When evidence was actually gathered, the run is an honest partial completion: the rationale
 * must be user-facing (never the internal "round budget exhausted" note — that string once
 * leaked into the final answer) and the decision stays recoverable rather than declaring the
 * question unanswerable (zero-dead-end mandate §13/§15).
 */
export function partialDecision(_reason: "ROUND_BUDGET_EXHAUSTED" | "TIME_BUDGET_EXHAUSTED", rounds: number, evidenceCount: number): AdaptiveDecision {
  if (evidenceCount === 0) {
    return {
      decision: "INSUFFICIENT_EVIDENCE",
      rationale: "No usable evidence was gathered before the research budget was reached; nothing was fabricated.",
      nextTasks: [],
    };
  }
  return {
    decision: "COMPLETE",
    rationale: `Research was completed across ${rounds} round(s) with ${evidenceCount} evidence object(s) gathered before the research budget was reached; the findings below reflect everything collected.`,
    nextTasks: [],
  };
}

/**
 * This run's evidence as coverage items (text + domain tag + freshness + event time).
 * Minimized view: coverage matching is deterministic and never needs full provenance.
 */
function coverageEvidenceOf(workspace: Workspace, researchRef: string): readonly CoverageEvidence[] {
  const research = workspace.getResearch(researchRef);
  if (research === undefined) return [];
  const items: CoverageEvidence[] = [];
  for (const ref of research.evidenceRefs) {
    const e = workspace.getEvidence(ref);
    if (e === undefined) continue;
    items.push({
      ref: e.id,
      text: e.observation,
      evidenceType: e.evidenceType,
      freshness: e.freshness,
      // The declared subject travels into coverage: a payload may never name its own ticker.
      ...(e.subject !== undefined ? { subject: e.subject } : {}),
      ...(e.timestamp !== undefined ? { observedAt: e.timestamp } : {}),
    });
  }
  return items;
}

/**
 * Honest insufficiency rationale: names the requirements the engine could not cover and why
 * (missing vs stale-only). The user gets the requirement, never a provider dump.
 */
function coverageGapRationale(requirements: readonly ResearchRequirement[]): string {
  const unresolved = requirements.filter((r) => r.status !== "SATISFIED");
  if (unresolved.length === 0) return "Research concluded without uncovered requirements.";
  const names = unresolved
    .slice(0, 4)
    .map((r) => `${r.description}${r.staleOnlyRefs.length > 0 ? " (only stale evidence found)" : ""}`)
    .join("; ");
  return `Relevant evidence could not be obtained for: ${names}. Nothing was fabricated; the remaining gap is recorded per requirement.`;
}

function mustResearch(workspace: Workspace, researchRef: string): Research {
  const research = workspace.getResearch(researchRef);
  if (research === undefined) throw new Error(`Unknown research: ${researchRef}`);
  return research;
}

/** Convenience for the LUI: convert a validated plan step into a capability request list. */
export function capabilitiesOfStep(step: PlannedStep): readonly string[] {
  return step.capabilities;
}
