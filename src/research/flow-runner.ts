/**
 * Flow runner + adaptive scheduler extension; the shared execution core for M4 flows
 * (Flow 2 / Flow 6 / Flow 7), built ON the M3 adaptive machinery rather than beside it.
 *
 * Architectural basis:
 * - M4 §4/§25: the flow defines the RESEARCH OBJECTIVE and analytical MODE, never a fixed list
 *   of tools. ONE adaptive scheduler with flow-specific objective metadata; no per-flow
 *   schedulers, no Flow→Tool hardcoding (final lock §6/§11, tool-skill-orchestration.md §2.1).
 * - research-flows.md FLOW 2 §3 (parallel investigation), FLOW 6 §3 (broad investigation),
 *   execution-scheduler.md: independent research tasks run CONCURRENTLY; dependent tasks
 *   remain sequential (M4 §32). Bounded concurrency, existing resilience behavior respected.
 * - M3 §8 + research-planning.md: the living loop; plan → execute → evidence → decide
 *   with model-proposed (validated) plans and engine-owned execution.
 * - hypothesis.md: hypotheses are LIVING objects with lifecycle states; model-generated
 *   hypotheses are CANDIDATEs until evidence supports them; never facts because Gemini said so.
 * - M4 §33 (failure laws): tool failure ≠ negative evidence; empty data ≠ negative evidence;
 *   insufficient evidence is a valid completion. Failure semantics are identical to M3.
 */

import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import { PLANNER_CAPABILITIES } from "./adaptive.js";
import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import {
  RESEARCH_PLAN_SCHEMA_DESC, ADAPTIVE_DECISION_SCHEMA_DESC, parseResearchPlan, parseAdaptiveDecision,
  type ProposedResearchPlan, type AdaptiveDecision,
} from "../model/schemas.js";
import { evidenceFromToolResult } from "../domain/evidence.js";
import type { Evidence, Hypothesis } from "../domain/objects.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { Workspace } from "../domain/workspace.js";
import { progressEvent, type ProgressListener } from "./progress.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ToolResult } from "../domain/tool-result.js";
import { buildResearchContext, renderResearchContext, type ResearchContext } from "./context.js";

export const MAX_RESEARCH_ROUNDS = 3;
/** Bounded concurrency for independent capability calls (M4 §32: no uncontrolled parallelism). */
const MAX_PARALLEL_TASKS = 4;

/** Flow-specific analytical modes; the flow shapes objective/mode/priority, not tool lists. */
export type FlowMode = "CAUSAL" | "SYNTHESIS" | "FALSIFICATION" | "EVALUATION" | "EXPLORATORY" | "HISTORICAL";

export interface FlowObjective {
  readonly flow: string; // locked RESEARCH_FLOWS vocabulary
  readonly mode: FlowMode;
  /** Flow-specific scheduler guidance injected into plan/decision prompts (M4 §25). */
  readonly schedulerGuidance: string;
}

export const FLOW_OBJECTIVES: Record<string, FlowObjective> = {
  WHY_IT_HAPPENED: {
    flow: "WHY_IT_HAPPENED",
    mode: "CAUSAL",
    schedulerGuidance: [
      "CAUSAL MODE (Flow 2): generate MULTIPLE candidate explanations (candidate-cause map) before favoring any.",
      "- Represent every candidate as a hypothesis; none is established until evidence supports it.",
      "- Distinguish temporal association / correlation / plausible mechanism / strong causal evidence; proximity to the event is NOT causation.",
      "- Actively test the leading explanation (timing alignment, magnitude consistency, alternatives).",
      "- If evidence weakens the leading hypothesis, investigate the alternative rather than forcing the first explanation.",
      "- PRIORITY: unresolved causal distinctions between competing hypotheses get research priority.",
      "- If competing explanations cannot be materially distinguished, STOP and report the uncertainty.",
    ].join("\n"),
  },
  WHAT_DOES_ALL_INFORMATION_SAY: {
    flow: "WHAT_DOES_ALL_INFORMATION_SAY",
    mode: "SYNTHESIS",
    schedulerGuidance: [
      "SYNTHESIS MODE (Flow 6): 'all the information' means all MATERIAL information relevant to the objective; never every capability blindly.",
      "- Select relevant dimensions from the question; hardcode nothing.",
      "- Investigate independent dimensions CONCURRENTLY (the engine parallelizes independent tasks).",
      "- Cross-domain disagreement must be represented explicitly (genuine contradiction vs different horizon vs different variable vs interpretation-vs-observation); never force agreement.",
      "- Weight evidence by directness, reliability, recency, specificity, corroboration and INDEPENDENCE; repeated secondary reports of one source are not independent confirmation.",
      "- Do not present your own background knowledge as newly researched evidence; research first, synthesize second.",
      "- PRIORITY: unresolved cross-domain contradictions and high-impact evidence gaps.",
    ].join("\n"),
  },
  WHAT_COULD_PROVE_ME_WRONG: {
    flow: "WHAT_COULD_PROVE_ME_WRONG",
    mode: "FALSIFICATION",
    schedulerGuidance: [
      "FALSIFICATION MODE (Flow 7): the objective is what would make the target belief WRONG; not generic critique.",
      "- Decompose the belief into claims and assumptions; identify what would falsify each.",
      "- Generate concrete falsification targets (conditions, reversals, invalidations, counterexamples). Use the belief's OWN thresholds if present; otherwise propose qualitative conditions clearly labeled as proposed.",
      "- PRIORITIZE searching for DISCONFIRMING evidence: contradictions, competing hypotheses, vulnerable assumptions, counterexamples, failed analogues.",
      "- Do not manufacture opposition for balance. If no credible contradiction exists, say so; 'nothing found' is NOT 'the belief is true'.",
      "- Evaluate materiality: minor disagreement ≠ meaningful warning ≠ material contradiction ≠ invalidating evidence. One weak source does not invalidate a thesis.",
      "- The trader's thesis is NEVER modified by this flow; assessment only.",
    ].join("\n"),
  },
  WHAT_COULD_AFFECT_IT: {
    flow: "WHAT_COULD_AFFECT_IT",
    mode: "EXPLORATORY",
    schedulerGuidance: "See FLOW3_OBJECTIVE in flow3.ts (EXPLORATORY mode guidance lives with the flow definition).",
  },
  DOES_MY_THESIS_HOLD: {
    flow: "DOES_MY_THESIS_HOLD",
    mode: "EVALUATION",
    schedulerGuidance: "See FLOW4_OBJECTIVE in flow4.ts (EVALUATION mode guidance lives with the flow definition).",
  },
  EVALUATE_WITH_MY_FRAMEWORK: {
    flow: "EVALUATE_WITH_MY_FRAMEWORK",
    mode: "EVALUATION",
    schedulerGuidance: "See FLOW8_OBJECTIVE in flow8.ts (EVALUATION mode guidance lives with the flow definition).",
  },
};

// ---------------------------------------------------------------------------
// Execution records
// ---------------------------------------------------------------------------

export interface FlowExecution {
  readonly round: number;
  readonly capability: string;
  readonly result: ToolResult;
  readonly evidenceIds: readonly string[];
  /** True when this call ran concurrently with siblings in the same round (provenance of ordering). */
  readonly parallel: boolean;
}

export interface HypothesisRecord {
  readonly id: string;
  readonly statement: string;
  readonly status: Hypothesis["status"];
  readonly supportingEvidence: readonly string[];
  readonly contradictingEvidence: readonly string[];
  /** Lifecycle-relevant conditions (expected observations / disconfirming conditions), when the model proposed any. */
  readonly disconfirmingConditions: readonly string[];
}

export interface FlowOutcome {
  readonly researchId: string;
  readonly flow: string;
  readonly mode: FlowMode;
  readonly plan: ProposedResearchPlan;
  readonly rounds: readonly {
    readonly round: number;
    readonly executions: readonly FlowExecution[];
    readonly decision: AdaptiveDecision;
  }[];
  readonly executions: readonly FlowExecution[];
  /** Hypotheses generated/tracked during the flow (living objects; status from lifecycle machine). */
  readonly hypotheses: readonly HypothesisRecord[];
  readonly evidence: readonly Evidence[];
  readonly analysisId?: string;
  readonly judgmentId?: string;
  readonly finalDecision: AdaptiveDecision;
  readonly stoppedBecause: "EVIDENCE_SUFFICIENT" | "MODEL_INSUFFICIENT_EVIDENCE" | "ROUND_BUDGET_EXHAUSTED" | "TIME_BUDGET_EXHAUSTED" | "MODEL_FAILURE";
  readonly modelFailure?: ModelFailure;
  readonly context: ResearchContext;
}

// ---------------------------------------------------------------------------
// Prompts; flow objective shapes the plan/decision systems (M4 §4/§28)
// ---------------------------------------------------------------------------

const BASE_PLAN_SYSTEM = [
  "You are the research planner inside a trading RESEARCH workbench. You plan; you never execute.",
  "The system executes capabilities and returns validated evidence. Plan rules:",
  // CAUSAL_INVESTIGATION and EVENT_RECONSTRUCTION are flow-internal capabilities (flow2/flow3
  // schedules); they are excluded from the adaptive planner's vocabulary but remain registered.
  `- Request CAPABILITIES only (${[...PLANNER_CAPABILITIES, "CAUSAL_INVESTIGATION", "EVENT_RECONSTRUCTION"].join(", ")}). Never providers or vendor tools.`,
  "- Select the smallest capability set with material information value for THIS objective.",
  "- Respect trader constraints in scope.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const BASE_DECISION_SYSTEM = [
  "You are the adaptive decision-maker of a trading RESEARCH workbench. You decide whether research continues; you never execute anything.",
  "You receive the validated research context with epistemic classes preserved. Rules:",
  "- Interpretations/inferences/speculation are NOT observations; never upgrade them.",
  "- LIMITATIONS are data-availability conditions, NOT evidence against any claim.",
  "- Insufficient evidence is a valid outcome; prefer honesty over forced conclusions.",
  "- Continue only when additional capabilities have MATERIAL information value (could change the judgment).",
  "- Contradictions may warrant one more targeted investigation; via capabilities, never providers.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

function planPrompt(objective: string, flow: FlowObjective, constraints: readonly string[]): string {
  return [
    `Research objective: ${objective}`,
    `Analytical mode: ${flow.mode} (${flow.flow})`,
    `Flow-specific planning rules:\n${flow.schedulerGuidance}`,
    constraints.length > 0 ? `Trader constraints: ${constraints.join("; ")}` : "",
    'Produce a research plan as JSON conforming to schema "research.plan".',
    RESEARCH_PLAN_SCHEMA_DESC,
  ].filter((l) => l !== "").join("\n");
}

function decisionPrompt(ctx: ResearchContext, flow: FlowObjective, round: number): string {
  return [
    `Round ${round} of the adaptive loop. Mode: ${flow.mode} (${flow.flow}).`,
    `Flow-specific decision rules:\n${flow.schedulerGuidance}`,
    "Validated research context follows.",
    "---",
    renderResearchContext(ctx),
    "---",
    'Decide: CONTINUE (with nextTasks naming capabilities), COMPLETE, or INSUFFICIENT_EVIDENCE.',
    ADAPTIVE_DECISION_SCHEMA_DESC,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The shared flow runner
// ---------------------------------------------------------------------------

export interface FlowRunnerOptions {
  readonly provider: ModelProvider;
  readonly registry: CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  readonly constraints?: readonly string[];
  readonly capabilityParams?: Readonly<Record<string, unknown>>;
  readonly maxRounds?: number;
  /**
   * Wall-clock deadline for the whole run (epoch ms). When crossed, the loop stops with the
   * honest TIME_BUDGET_EXHAUSTED reason and the evidence gathered so far is preserved; it is
   * never treated as a model failure and nothing is fabricated to fill the gap.
   */
  readonly deadlineMs?: number;
  readonly now?: () => Date;
  /** F0 SSE seam: optional listener for REAL lifecycle events (never model reasoning/payloads). */
  readonly onProgress?: ProgressListener;
}

/**
 * Shared flow execution: objective → model-proposed plan → engine executes capabilities
 * (independent tasks concurrently, per round) → evidence ingestion → optional hypothesis
 * lifecycle updates → adaptive decision with flow guidance → judgment persisted by the caller.
 * Every model output is schema-validated; the engine executes; nothing is fabricated.
 */
export async function runFlow(
  objective: string,
  flow: FlowObjective,
  researchRef: string,
  options: FlowRunnerOptions,
): Promise<FlowOutcome> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: `${flow.flow} flow orchestration` };
  const workspace = options.workspace;
  const maxRounds = options.maxRounds ?? MAX_RESEARCH_ROUNDS;

  // 1. Model proposes the plan (flow guidance included; validated or it is a model failure).
  let plan: ProposedResearchPlan;
  try {
    const planResponse = await options.provider.structured<string>({
      schemaName: "research.plan",
      schemaDescription: RESEARCH_PLAN_SCHEMA_DESC,
      system: [BASE_PLAN_SYSTEM, flow.schedulerGuidance].join("\n\n"),
      prompt: planPrompt(objective, flow, options.constraints ?? []),
      preferJson: true,
    });
    plan = parseResearchPlan(planResponse.raw);
    options.onProgress?.(progressEvent("research_plan_created", at(), `research plan created with ${plan.tasks.length} task(s)`, { tasks: plan.tasks.length }));
  } catch (error) {
    throw error instanceof ModelFailure
      ? error
      : new ModelFailure("INVALID_OUTPUT", `plan validation failed: ${error instanceof Error ? error.message : String(error)}`, false);
  }

  // 2. Rounds: execute (parallel where independent) → ingest → decide.
  const allExecutions: FlowExecution[] = [];
  // Cross-round dedupe: a repeated identical capability call must not re-ingest the same
  // outputs as "new" evidence (live Flow 5 run ingested the identical monthly record 3×).
  // Signature = tool + invocation params + output content; ingestion happens exactly once.
  const ingestedSignatures = new Set<string>();
  const rounds: { round: number; executions: readonly FlowExecution[]; decision: AdaptiveDecision }[] = [];
  let finalDecision!: AdaptiveDecision;
  let stoppedBecause!: FlowOutcome["stoppedBecause"];
  let modelFailure: ModelFailure | undefined;

  for (let round = 1; round <= maxRounds; round += 1) {
    const roundTasks = round === 1
      ? plan.tasks.map((t) => ({ objective: t.objective, capabilities: t.capabilities, completion: t.completion }))
      : (rounds[rounds.length - 1]?.decision.nextTasks ?? []);

    // M4 §32: independent capability calls within a round run concurrently (bounded); rounds
    // themselves remain sequential because each depends on the previous decision.
    const flatCalls: { capability: string }[] = [];
    for (const task of roundTasks) for (const capability of task.capabilities) flatCalls.push({ capability });

    const executions: FlowExecution[] = await executeBatch(flatCalls, round, researchRef, options, systemOrigin, at, ingestedSignatures);
    allExecutions.push(...executions);

    // 3. Adaptive decision with the updated context (flow guidance included).
    const context = buildResearchContext(workspace, {
      researchRef,
      executions: allExecutions.map((e) => ({ capability: e.capability, result: e.result })),
    });
    let decision: AdaptiveDecision;
    try {
      const decisionResponse = await options.provider.structured<string>({
        schemaName: "research.adaptive_decision",
        schemaDescription: ADAPTIVE_DECISION_SCHEMA_DESC,
        system: [BASE_DECISION_SYSTEM, flow.schedulerGuidance].join("\n\n"),
        prompt: decisionPrompt(context, flow, round),
        preferJson: true,
      });
      decision = parseAdaptiveDecision(decisionResponse.raw);
    } catch (error) {
      modelFailure = error instanceof ModelFailure
        ? error
        : new ModelFailure("INVALID_OUTPUT", `adaptive decision validation failed: ${error instanceof Error ? error.message : String(error)}`, false);
      stoppedBecause = "MODEL_FAILURE";
      finalDecision = { decision: "INSUFFICIENT_EVIDENCE", rationale: `loop ended on model failure: ${modelFailure.message}; no fabricated continuation`, nextTasks: [] };
      rounds.push({ round, executions, decision: finalDecision });
      await options.store.save(workspace.toSnapshot()); // preserve partial state (lock §14)
      return finish(workspace, researchRef, flow, plan, rounds, allExecutions, finalDecision, stoppedBecause, modelFailure, at);
    }

    options.onProgress?.(progressEvent("research_round_completed", at(), `research round ${round} completed: ${decision.decision}`, { round, decision: decision.decision }));
    rounds.push({ round, executions, decision });

    if (decision.decision === "COMPLETE") { stoppedBecause = "EVIDENCE_SUFFICIENT"; finalDecision = decision; break; }
    if (decision.decision === "INSUFFICIENT_EVIDENCE") { stoppedBecause = "MODEL_INSUFFICIENT_EVIDENCE"; finalDecision = decision; break; }
    // Honest wall-clock budget: stop before the caller's execution window expires rather than
    // dying mid-flight (an in-flight run can never deliver its partial truth to the trader).
    if (options.deadlineMs !== undefined && at().getTime() >= options.deadlineMs) {
      options.onProgress?.(progressEvent("research_stopped", at(), "research stopped: TIME_BUDGET_EXHAUSTED", { reason: "TIME_BUDGET_EXHAUSTED" }));
      stoppedBecause = "TIME_BUDGET_EXHAUSTED";
      finalDecision = { decision: "INSUFFICIENT_EVIDENCE", rationale: `time budget exhausted after ${rounds.length} round(s); evidence gathered so far is preserved`, nextTasks: [] };
      break;
    }
    if (round === maxRounds) {
      options.onProgress?.(progressEvent("research_stopped", at(), `research stopped: ${stoppedBecause ?? "ROUND_BUDGET_EXHAUSTED"}`, { reason: stoppedBecause ?? "ROUND_BUDGET_EXHAUSTED" }));
      stoppedBecause = "ROUND_BUDGET_EXHAUSTED";
      finalDecision = { decision: "INSUFFICIENT_EVIDENCE", rationale: `round budget (${maxRounds}) exhausted; research state is preserved for later continuation`, nextTasks: [] };
      break;
    }
  }

  await options.store.save(workspace.toSnapshot());
  return finish(workspace, researchRef, flow, plan, rounds, allExecutions, finalDecision, stoppedBecause, modelFailure, at);
}

/** Execute a batch of capability calls with bounded concurrency; record ordering honestly. */
async function executeBatch(
  calls: readonly { capability: string }[],
  round: number,
  researchRef: string,
  options: FlowRunnerOptions,
  systemOrigin: ProvenanceOrigin,
  at: () => Date,
  alreadyIngested: Set<string> = new Set<string>(),
): Promise<FlowExecution[]> {
  const results: FlowExecution[] = new Array(calls.length);
  let cursor = 0;
  const workerCount = Math.min(MAX_PARALLEL_TASKS, calls.length);

  async function worker(): Promise<void> {
    while (cursor < calls.length) {
      const index = cursor;
      cursor += 1;
      const call = calls[index];
      if (call === undefined) break;
      const { capability } = call;
      const parallel = workerCount > 1;
      options.onProgress?.(progressEvent("capability_started", at(), `capability ${capability} started`, { capability }));
      const result = await options.registry.execute(capability, { ...(options.capabilityParams ?? {}) }, systemOrigin, at());
      options.onProgress?.(progressEvent("capability_completed", at(), `capability ${capability} completed: ${result.failure.type === "NONE" ? result.completeness : `failed (${result.failure.type})`}`, { capability, ...(result.failure.type === "NONE" ? { completeness: result.completeness } : { failureType: result.failure.type }) }));
      const evidenceIds: string[] = [];
      let duplicatesSkipped = 0;
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
            // Cross-round dedupe (see ingestedSignatures): identical tool output under identical
            // invocation is the SAME observation, not corroborating evidence.
            const signature = `${result.tool}|${JSON.stringify(result.invocation.params)}|${JSON.stringify(output)}`;
            if (alreadyIngested.has(signature)) {
              duplicatesSkipped += 1;
              continue;
            }
            alreadyIngested.add(signature);
            options.workspace.ingestEvidence(evidence, researchRef); // graph registration + provenance
            evidenceIds.push(evidence.id);
          } catch {
            // UNAVAILABLE/ERROR outputs never become evidence (evidence.ts invariant).
          }
        }
      }
      results[index] = { round, capability, result, evidenceIds, parallel };
      if (duplicatesSkipped > 0) {
        options.onProgress?.(progressEvent("capability_completed", at(), `capability ${capability}: ${duplicatesSkipped} duplicate output(s) skipped (already ingested this research)`, { capability, duplicatesSkipped }));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(workerCount, 1) }, () => worker()));
  return results.filter((r) => r !== undefined);
}

/** Assemble the outcome, including living hypothesis records from the workspace. */
function finish(
  workspace: Workspace,
  researchRef: string,
  flow: FlowObjective,
  plan: ProposedResearchPlan,
  rounds: { round: number; executions: readonly FlowExecution[]; decision: AdaptiveDecision }[],
  executions: readonly FlowExecution[],
  finalDecision: AdaptiveDecision,
  stoppedBecause: FlowOutcome["stoppedBecause"],
  modelFailure: ModelFailure | undefined,
  at: () => Date,
): FlowOutcome {
  // Lifecycle honesty: the run CONCLUDED (by sufficiency, insufficiency, budget, or model
  // failure); the research object must reflect that instead of staying ACTIVE forever.
  // STOPPED stays reserved for actually-interrupted runs (startup sweep).
  workspace.transitionResearch(researchRef, "COMPLETED", { kind: "agent", detail: "flow runner" }, `research concluded: ${stoppedBecause}`, at());
  const research = workspace.getResearch(researchRef);
  const hypotheses = research !== undefined
    ? research.hypothesisRefs
        .map((id) => workspace.getHypothesis(id))
        .filter((h): h is Hypothesis => h !== undefined)
        .map((h) => ({
          id: h.id,
          statement: h.statement,
          status: h.status,
          supportingEvidence: h.evidenceRefs,
          contradictingEvidence: h.contradictingClaims,
          disconfirmingConditions: h.alternatives,
        }))
    : [];
  return {
    researchId: researchRef,
    flow: flow.flow,
    mode: flow.mode,
    plan,
    rounds,
    executions,
    hypotheses,
    evidence: executions.flatMap((e) => e.evidenceIds).map((id) => workspace.getEvidence(id)).filter((e): e is Evidence => e !== undefined),
    finalDecision,
    stoppedBecause,
    ...(modelFailure !== undefined ? { modelFailure } : {}),
    context: buildResearchContext(workspace, {
      researchRef,
      executions: executions.map((e) => ({ capability: e.capability, result: e.result })),
    }),
  };
}
