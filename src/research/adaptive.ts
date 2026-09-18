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
import type { Evidence, Research } from "../domain/objects.js";
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
  readonly stoppedBecause: "EVIDENCE_SUFFICIENT" | "MODEL_INSUFFICIENT_EVIDENCE" | "ROUND_BUDGET_EXHAUSTED" | "TIME_BUDGET_EXHAUSTED" | "MODEL_FAILURE";
  /** Typed model failure when the loop ended that way; never fabricated around. */
  readonly modelFailure?: ModelFailure;
  readonly context: ResearchContext;
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
  "EQUITY_MARKET_DATA", "EQUITY_FUNDAMENTALS", "EQUITY_EARNINGS", "EARNINGS_CALENDAR", "OPTIONS_CHAIN_ANALYSIS", "EQUITY_NEWS",
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
  "- Equities and listed instruments (stocks, ETFs): EQUITY_MARKET_DATA (price, OHLCV, volume), EQUITY_FUNDAMENTALS (revenue, margins, valuation, shares), EQUITY_EARNINGS or EARNINGS_CALENDAR (next/last earnings dates and consensus estimates, same capability), OPTIONS_CHAIN_ANALYSIS (options chains, only when options are explicitly relevant), EQUITY_NEWS (company headlines), plus the shared NEWS_ANALYSIS / MACRO_ANALYSIS / HISTORICAL_COMPARISON / FALSIFICATION / SOURCE_VALIDATION capabilities.",
  "- Commodities (gold, silver, oil), FX pairs, indexes (SPX, VIX, DXY) and broad cross-asset questions: NEWS_ANALYSIS and MACRO_ANALYSIS carry the investigation; EQUITY_MARKET_DATA may be added ONLY when a concrete tradable target is named (gold, EUR/USD, VIX all resolve). Do NOT request equity or crypto market-data capabilities when no target is resolvable; a capability without a target only produces provider-failure noise.",
  "- On-chain and DeFi questions (wallet/token activity, protocol TVL, L2 metrics, DEX structure): ONCHAIN_ANALYSIS (address/holder/trade observations where an address is resolvable) and DEFI_ANALYSIS (protocol/chain/L2 metrics); PROJECT_RESEARCH covers project descriptions, DEX pair discovery, and narrative/trending context.",
  "- Broad synthesis questions that may span domains: CROSS_DOMAIN_SYNTHESIS is available as a deep-research capability of last resort; prefer specific capabilities first. WEB_SEARCH (bounded source discovery) is available when narrative or primary-source hunting matters.",
  "- For a company question, plan the smallest set that can answer it: market data for what happened, earnings/estimates for event context, company news for narrative, macro or index context only when the question crosses into the broader market.",
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

  for (let round = 1; round <= maxRounds; round += 1) {
    // Determine this round's tasks: round 1 = the plan; later rounds = the decision's nextTasks.
    const roundTasks = round === 1
      ? plan.tasks.map((t) => ({ objective: t.objective, capabilities: t.capabilities, completion: t.completion }))
      : (rounds[rounds.length - 1]?.decision.nextTasks ?? []);

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

    // 3. Adaptive decision with the updated, validated context.
    const context = buildResearchContext(workspace, {
      researchRef,
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
      };
    }

    options.onProgress?.(progressEvent("research_round_completed", at(), `research round ${round} completed: ${decision.decision}`, { round, decision: decision.decision }));
    rounds.push({ round, executions, decision });

    if (decision.decision === "COMPLETE") {
      stoppedBecause = "EVIDENCE_SUFFICIENT";
      finalDecision = decision;
      break;
    }
    if (decision.decision === "INSUFFICIENT_EVIDENCE") {
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

  // Deep-research fallback (engine-owned, never planner-dependent): when the loop concluded
  // with INSUFFICIENT_EVIDENCE and produced NO usable evidence, the direct capability chain
  // failed the question. Before concluding, fire the last-resort CROSS_DOMAIN_SYNTHESIS
  // deep-research tier ONCE with the exact objective. The model never decides this (it does
  // not know provider coverage); the engine knows when nothing was gathered. Outputs remain
  // classified by the evidence layer (agent analysis, never direct observation).
  // Mechanical budget stops with zero evidence are also dead ends the backstop must try to
  // recover: the loop never reached a substantive conclusion, so deep research with the exact
  // objective is the last legitimate path before declaring genuine insufficiency (§19).
  const budgetStopped = stoppedBecause === "TIME_BUDGET_EXHAUSTED" || stoppedBecause === "ROUND_BUDGET_EXHAUSTED";
  const deepResearchFired =
    (stoppedBecause === "MODEL_INSUFFICIENT_EVIDENCE" || budgetStopped) &&
    allExecutions.every((e) => e.evidenceIds.length === 0) &&
    !allExecutions.some((e) => e.capability === "CROSS_DOMAIN_SYNTHESIS") &&
    options.registry.resolve("CROSS_DOMAIN_SYNTHESIS").length > 0 &&
    (options.deadlineMs === undefined || at().getTime() < options.deadlineMs);
  if (deepResearchFired) {
    options.onProgress?.(progressEvent("capability_started", at(), "direct capabilities produced no coverage; invoking deep-research agents", { capability: "CROSS_DOMAIN_SYNTHESIS" }));
    const deepRound: RoundExecution[] = [];
    try {
      const result = await options.registry.execute(
        "CROSS_DOMAIN_SYNTHESIS",
        { ...(options.capabilityParams ?? {}), question: objective },
        systemOrigin,
        at(),
      );
      options.onProgress?.(progressEvent("capability_completed", at(), `deep research completed: ${result.failure.type === "NONE" ? result.completeness : `failed (${result.failure.type})`}`, { capability: "CROSS_DOMAIN_SYNTHESIS" }));
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
      const execution: RoundExecution = { round: rounds.length + 1, capability: "CROSS_DOMAIN_SYNTHESIS", result, evidenceIds };
      deepRound.push(execution);
      allExecutions.push(execution);
      rounds.push({ round: rounds.length + 1, executions: deepRound, decision: finalDecision });
      // Deep research that DID find material evidence upgrades the conclusion (§13: after
      // research recovery, found evidence is a substantive answer — not insufficiency).
      const totalEvidence = allExecutions.flatMap((e) => e.evidenceIds).length;
      if (evidenceIds.length > 0 && finalDecision.decision === "INSUFFICIENT_EVIDENCE") {
        finalDecision = {
          decision: "COMPLETE",
          rationale: `Direct sources could not cover this question; deep-research agents gathered ${totalEvidence} evidence object(s) against the exact objective. Their outputs are labeled as agent analysis in the evidence below.`,
          nextTasks: [],
        };
      }
    } catch {
      // A deep-research throw is recorded as a failed round, never a crash; the honest
      // insufficiency conclusion below stands.
    }
  }

  // Lifecycle honesty: the loop CONCLUDED (by sufficiency, insufficiency, budget, or model
  // failure); the research object must reflect that instead of staying ACTIVE forever.
  workspace.transitionResearch(researchRef, "COMPLETED", { kind: "agent", detail: "adaptive research loop" }, `research concluded: ${stoppedBecause}`, at());
  // Persist the completed loop (lock §14). A store failure propagates; never reported as success.
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
    context: buildResearchContext(workspace, {
      researchRef,
      executions: allExecutions.map((e) => ({ capability: e.capability, result: e.result })),
    }),
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

function mustResearch(workspace: Workspace, researchRef: string): Research {
  const research = workspace.getResearch(researchRef);
  if (research === undefined) throw new Error(`Unknown research: ${researchRef}`);
  return research;
}

/** Convenience for the LUI: convert a validated plan step into a capability request list. */
export function capabilitiesOfStep(step: PlannedStep): readonly string[] {
  return step.capabilities;
}
