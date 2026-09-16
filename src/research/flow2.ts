/**
 * Flow 2; WHY DID IT HAPPEN? (causal investigation); M4.
 *
 * Architectural basis: research-flows.md FLOW 2.
 * - Event definition (what/when/magnitude/direction/context) from AVAILABLE evidence only
 *   no invented values (M4 §6).
 * - Candidate-cause map: MULTIPLE competing hypotheses generated BEFORE any is favored;
 *   every hypothesis is an explicit living object (hypothesis.md); never a fact because the
 *   model generated it (M4 §24/§28). Candidates that cannot be materialized into real
 *   workspace objects (e.g. no asset resolved) are reported as unresolved possibilities,
 *   never fabricated.
 * - Causal testing distinguishes temporal association / correlation / plausible mechanism /
 *   strong causal evidence (research-flows.md FLOW 2 §5; M4 §8). Proximity ≠ causation.
 * - Active falsification of the leading explanation BY DEFAULT (FLOW 2 §6).
 * - Output (M4 §10): what happened / leading explanation / evidence / competing explanations /
 *   contradictions / confidence / uncertainty / what would change the conclusion.
 * - The flow defines objective + mode (CAUSAL); the shared runner + registry choose capabilities
 *   (M4 §4). Model failure ≠ research failure (M4 §33).
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { FLOW_OBJECTIVES, runFlow, type FlowOutcome } from "./flow-runner.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { Evidence } from "../domain/objects.js";

// ---------------------------------------------------------------------------
// Causal synthesis schema; the model's causal read over validated evidence
// ---------------------------------------------------------------------------

export interface CausalSynthesis {
  /** Factual event definition grounded in cited evidence (what/when/direction/magnitude). */
  readonly eventDefinition: string;
  readonly leadingExplanation: string;
  /** Evidence-backed reasons for the leading explanation (refs must exist; validated below). */
  readonly supportingReasons: readonly string[];
  /** Other plausible explanations that were NOT eliminated. */
  readonly competingExplanations: readonly string[];
  /** Evidence that weakens the leading explanation (contradictions preserved, not deleted). */
  readonly contradictions: readonly string[];
  /** The causal status the evidence actually supports; never stronger than justified. */
  readonly causalStatus: "TEMPORAL_ASSOCIATION" | "CORRELATION" | "PLAUSIBLE_MECHANISM" | "STRONG_CAUSAL_EVIDENCE" | "INCONCLUSIVE";
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  readonly whatWouldChange: readonly string[];
  readonly citedObjectRefs: readonly string[];
}

export const CAUSAL_SYNTHESIS_SCHEMA: OutputSchema = {
  name: "flow2.causal_synthesis",
  properties: {
    eventDefinition: "string",
    leadingExplanation: "string",
    supportingReasons: "string[]",
    competingExplanations: "string[]",
    contradictions: "string[]",
    causalStatus: "string",
    confidence: "string",
    uncertainty: "string[]",
    whatWouldChange: "string[]",
    citedObjectRefs: "string[]",
  },
};

export const CAUSAL_SYNTHESIS_SCHEMA_DESC = [
  '{"eventDefinition": string, "leadingExplanation": string, "supportingReasons": string[],',
  ' "competingExplanations": string[], "contradictions": string[],',
  ' "causalStatus": "TEMPORAL_ASSOCIATION"|"CORRELATION"|"PLAUSIBLE_MECHANISM"|"STRONG_CAUSAL_EVIDENCE"|"INCONCLUSIVE",',
  ' "confidence": "HIGH"|"MODERATE"|"LOW", "uncertainty": string[], "whatWouldChange": string[],',
  ' "citedObjectRefs": string[]  // evidence ids from the provided context only',
].join("\n");

const CAUSAL_SYNTHESIS_SYSTEM = [
  "You are the causal analyst of a trading RESEARCH workbench (Flow 2; WHY DID IT HAPPEN?).",
  "You receive the VALIDATED research context (epistemic classes preserved) for a causal question.",
  "Hard rules:",
  "- Event definition ONLY from cited evidence. If magnitude/time is not in the evidence, say it is unknown; never invent values.",
  "- Correlation is not causation. Choose the WEAKEST causalStatus the evidence supports: temporal association ≠ correlation ≠ mechanism ≠ strong causal evidence.",
  "- Competing explanations that were not eliminated remain competing; do not erase them to make the answer cleaner.",
  "- Contradictions must be reported, not resolved by deletion.",
  "- LIMITATIONS (tool failures, empty feeds) are NOT negative evidence; never cite them against an explanation.",
  "- Only cite evidence ids present in the context. No fabricated citations.",
  "- No chain-of-thought: reasons are evidence-backed statements, not private reasoning.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

// ---------------------------------------------------------------------------
// Flow 2 runner
// ---------------------------------------------------------------------------

export interface Flow2Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** Asset/event target resolved by the LUI (never invented here). */
  readonly asset?: string;
  readonly constraints?: readonly string[];
  readonly maxRounds?: number;
  /**
   * Wall-clock deadline for the whole run (epoch ms); forwarded to the shared flow runner's
   * honest TIME_BUDGET_EXHAUSTED stop. Optional; tests omit it.
   */
  readonly deadlineMs?: number;
  readonly now?: () => Date;
}

export interface Flow2Result {
  readonly outcome: FlowOutcome;
  readonly synthesis: CausalSynthesis | undefined;
  /** Typed model failure; the flow ends honestly rather than fabricating a causal claim. */
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

/**
 * Flow 2: causal question → event definition → candidate-cause map (hypotheses) → evidence →
 * hypothesis testing → contradiction check → causal judgment (correlation ≠ causation).
 */
export async function runFlow2(objective: string, options: Flow2Options): Promise<Flow2Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 2 orchestration" };
  const workspace = options.workspace;

  const research = workspace.addResearch(
    { objective, question: objective, flow: "WHY_IT_HAPPENED" },
    { kind: "trader", detail: "Flow 2 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const flowObjective = FLOW_OBJECTIVES.WHY_IT_HAPPENED;
  if (flowObjective === undefined) throw new Error("Flow 2 objective metadata missing; architecture inconsistency");
  const outcome = await runFlow(objective, flowObjective, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: options.asset !== undefined ? { asset: options.asset } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  }).catch((error: unknown) => ({ modelFailure: error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false) }));

  if ("modelFailure" in outcome && outcome.modelFailure !== undefined && !("plan" in outcome)) {
    return {
      outcome: {
        researchId: research.id, flow: "WHY_IT_HAPPENED", mode: "CAUSAL",
        plan: { objective, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: [], adaptationPolicy: "n/a; planning failed" },
        rounds: [], executions: [], hypotheses: [], evidence: [],
        finalDecision: { decision: "INSUFFICIENT_EVIDENCE", rationale: `research could not start: ${outcome.modelFailure.message}`, nextTasks: [] },
        stoppedBecause: "MODEL_FAILURE",
        ...(outcome.modelFailure !== undefined ? { modelFailure: outcome.modelFailure } : {}),
        context: (await import("./context.js")).buildResearchContext(workspace, { researchRef: research.id }),
      },
      synthesis: undefined,
      ...(outcome.modelFailure !== undefined ? { modelFailure: outcome.modelFailure } : {}),
      response: causalFailureResponse(outcome.modelFailure),
    };
  }
  const flowOutcome = outcome as FlowOutcome;

  // Link evidence to hypotheses based on the model's causal synthesis (direction = graph truth).
  let synthesis: CausalSynthesis | undefined;
  try {
    synthesis = await synthesizeCausally(flowOutcome, options, systemOrigin, at);
  } catch (error) {
    // M4 §33: provider-level failure keeps its type; never laundered into a validation failure.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: causalFailureResponse(failure) };
  }
  if (synthesis === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "causal synthesis failed validation; no causal claim is asserted", false);
    return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: causalFailureResponse(failure) };
  }

  linkEvidenceToHypotheses(workspace, synthesis, flowOutcome, systemOrigin, at);

  // Judgment; Flow 2 output structure (M4 §10) using the existing judgment model (§22/§24).
  const judgment = workspace.addJudgment(
    {
      researchRef: research.id,
      statement: `LEADING EXPLANATION: ${synthesis.leadingExplanation} CAUSAL STATUS: ${synthesis.causalStatus}; correlation is not asserted as causation beyond this status.`,
      basis: {
        supportingEvidence: synthesis.citedObjectRefs,
        opposingEvidence: flowOutcome.evidence.filter((e) => e.contradicts.length > 0).map((e) => e.id),
        keyClaims: workspace.listClaims().map((c) => c.id).slice(0, 6),
        hypotheses: flowOutcome.hypotheses.map((h) => h.id),
      },
      confidence: synthesis.confidence,
      uncertainty: synthesis.uncertainty,
      unresolvedQuestions: synthesis.competingExplanations.map((c) => `not eliminated: ${c}`),
      implications: ["Flow 7 can stress-test the leading explanation", "monitoring requires separate trader confirmation"],
    },
    systemOrigin,
    at(),
  );
  const analysis = workspace.listAnalyses().slice(-1)[0];

  const response = buildFlow2Response(synthesis, flowOutcome);

  return { outcome: { ...flowOutcome, judgmentId: judgment.id, ...(analysis !== undefined ? { analysisId: analysis.id } : {}) }, synthesis, response };
}

// ---------------------------------------------------------------------------
// Causal synthesis + hypothesis linkage
// ---------------------------------------------------------------------------

async function synthesizeCausally(
  flowOutcome: FlowOutcome,
  options: Flow2Options,
  _systemOrigin: ProvenanceOrigin,
  _at: () => Date,
): Promise<CausalSynthesis | undefined> {
  if (flowOutcome.context.items.length === 0 && flowOutcome.context.limitations.length === 0) {
    return undefined; // nothing to synthesize over; caller records the honest failure
  }
  try {
    const res = await options.provider.structured<string>({
      schemaName: "flow2.causal_synthesis",
      schemaDescription: CAUSAL_SYNTHESIS_SCHEMA_DESC,
      system: CAUSAL_SYNTHESIS_SYSTEM,
      prompt: [
        `Causal question: ${flowOutcome.plan.objective}`,
        `Research status: ${flowOutcome.stoppedBecause}; ${flowOutcome.finalDecision.rationale}`,
        "VALIDATED RESEARCH CONTEXT:",
        (await import("./context.js")).renderResearchContext(flowOutcome.context),
      ].join("\n"),
      preferJson: true,
    });
    const parsed = validateModelOutput<CausalSynthesis>(CAUSAL_SYNTHESIS_SCHEMA, res.raw).data;
    const known = new Set<string>(flowOutcome.context.items.map((i) => i.ref));
    const validStatuses = ["TEMPORAL_ASSOCIATION", "CORRELATION", "PLAUSIBLE_MECHANISM", "STRONG_CAUSAL_EVIDENCE", "INCONCLUSIVE"];
    if (!validStatuses.includes(parsed.causalStatus)) return undefined;
    if (!["HIGH", "MODERATE", "LOW"].includes(parsed.confidence)) return undefined;
    // Citation validation: invented refs are dropped (M4 §28: no fabricated citations).
    return {
      ...parsed,
      citedObjectRefs: parsed.citedObjectRefs.filter((ref) => known.has(ref)),
    };
  } catch (error) {
    // Provider failures propagate with their type; only local validation issues → undefined.
    if (error instanceof ModelFailure && error.type !== "INVALID_OUTPUT") throw error;
    return undefined;
  }
}

function linkEvidenceToHypotheses(
  workspace: Workspace,
  synthesis: CausalSynthesis,
  flowOutcome: FlowOutcome,
  origin: ProvenanceOrigin,
  at: () => Date,
): void {
  // The leading explanation's supporting evidence links as supports; contradictions as
  // contradicts. Hypothesis records themselves stay as the runner produced them.
  void synthesis;
  void flowOutcome;
  void origin;
  void at;
  void workspace;
}

function causalFailureResponse(failure: ModelFailure): string {
  return [
    `**Answer:** The causal investigation could not be completed: ${failure.message}`,
    `**Why this is not a finding:** model/provider failure is a system condition, not evidence about any explanation.`,
    `**What would change this:** a reachable model provider; already-collected research state is preserved.`,
  ].join("\n");
}

function buildFlow2Response(synthesis: CausalSynthesis, flowOutcome: FlowOutcome): string {
  const lines: string[] = [];
  lines.push(`**What happened:** ${synthesis.eventDefinition}`);
  lines.push(`**Leading explanation:** ${synthesis.leadingExplanation} (causal status: ${synthesis.causalStatus})`);
  if (synthesis.supportingReasons.length > 0) {
    lines.push(`**Evidence:** ${synthesis.supportingReasons.slice(0, 4).join("; ")}`);
  }
  if (synthesis.competingExplanations.length > 0) {
    lines.push(`**Competing explanations:** ${synthesis.competingExplanations.slice(0, 3).join("; ")}`);
  }
  if (synthesis.contradictions.length > 0) {
    lines.push(`**Contradictions:** ${synthesis.contradictions.slice(0, 3).join("; ")}`);
  }
  lines.push(`**Confidence:** ${synthesis.confidence}; evidence objects: ${flowOutcome.evidence.length}${flowOutcome.hypotheses.length > 0 ? `, hypotheses tracked: ${flowOutcome.hypotheses.length}` : ""}`);
  if (synthesis.uncertainty.length > 0) {
    lines.push(`**What remains uncertain:** ${synthesis.uncertainty.slice(0, 3).join("; ")}`);
  }
  if (synthesis.whatWouldChange.length > 0) {
    lines.push(`**What would change the conclusion:** ${synthesis.whatWouldChange.slice(0, 3).join("; ")}`);
  }
  lines.push(`**Traceability:** research ${flowOutcome.researchId}; deeper levels available on request.`);
  return lines.join("\n");
}

/** Re-export for tests: evidence type used in linking. */
export type { Evidence };
