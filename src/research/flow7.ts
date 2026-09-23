/**
 * Flow 7; WHAT COULD PROVE ME WRONG? (explicit falsification research); M4.
 *
 * Architectural basis: research-flows.md FLOW 7.
 * - Adaptive input: the target can be a thesis, belief, position, expected outcome, or
 *   interpretation (FLOW 7 §1). The trader's thesis is NEVER modified; assessment only
 *   (thesis.md; M4 §18/§22).
 * - Failure conditions + falsification targets: use the belief's OWN thresholds when present;
 *   otherwise propose qualitative conditions clearly LABELED as proposed; no invented
 *   thresholds presented as established (M4 §19).
 * - Disconfirming-evidence SEARCH: priority shifts to what could make the belief wrong.
 *   Do not manufacture opposition for balance; "nothing found" ≠ "the belief is true" (M4 §20).
 * - Materiality grading (M4 §21): minor disagreement / meaningful warning / material
 *   contradiction / invalidating evidence. One weak source does not invalidate a thesis.
 * - Relationship to CHALLENGE (M4 §23): CHALLENGE is the LUI action; Flow 7 is the research
 *   METHODOLOGY the action invokes when the objective is falsification. Not duplicated.
 * - Output (M4 §22) uses the EXISTING judgment model; no new status taxonomy. Assessment
 *   vocabulary: supported / weakened / materially challenged / unsupported / indeterminate.
 * - Monitoring: proposal only, never activation (FLOW 7 §8; final lock §13).
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { FLOW_OBJECTIVES, runFlow, validateFlowOutcome, type FlowOutcome } from "./flow-runner.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Falsification assessment schema
// ---------------------------------------------------------------------------

export interface FalsificationTarget {
  /** The concrete condition/development that would weaken or invalidate the belief. */
  readonly condition: string;
  /** Which assumption/claim of the belief it attacks. */
  readonly attacksAssumption: string;
  /** Proposed conditions are clearly labeled; never presented as established thresholds. */
  readonly conditionStatus: "DERIVED_FROM_BELIEF" | "PROPOSED";
  readonly objectRefs: readonly string[];
}

export interface ContradictionFinding {
  readonly description: string;
  /** Materiality ladder (M4 §21). */
  readonly materiality: "MINOR" | "MEANINGFUL_WARNING" | "MATERIAL_CONTRADICTION" | "INVALIDATING";
  readonly rationale: string;
  readonly objectRefs: readonly string[];
}

export interface FalsificationAssessment {
  /** The trader-owned belief this flow stress-tested (identified, never modified). */
  readonly targetBelief: string;
  readonly claims: readonly string[];
  readonly assumptions: readonly string[];
  readonly vulnerableAssumptions: readonly string[];
  readonly falsificationTargets: readonly FalsificationTarget[];
  readonly contradictionsFound: readonly ContradictionFinding[];
  /** Honest absence: when no credible contradiction was found, this says so explicitly. */
  readonly noCredibleContradictionFound: boolean;
  /** Existing judgment model vocabulary (M4 §22); no new taxonomy. */
  readonly currentAssessment: "SUPPORTED" | "WEAKENED" | "MATERIALLY_CHALLENGED" | "UNSUPPORTED" | "INDETERMINATE";
  readonly invalidationConditions: readonly string[];
  readonly earlyWarnings: readonly string[];
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly rationale: string;
  readonly citedObjectRefs: readonly string[];
}

export const FALSIFICATION_SCHEMA: OutputSchema = {
  name: "flow7.falsification",
  properties: {
    targetBelief: "string",
    claims: "string[]",
    assumptions: "string[]",
    vulnerableAssumptions: "string[]",
    falsificationTargets: "array", // entry-level validation below drops malformed entries (M4 §14: never coerce)
    contradictionsFound: "array", // same; materiality/shape validated per entry below
    noCredibleContradictionFound: "boolean",
    currentAssessment: "string",
    invalidationConditions: "string[]",
    earlyWarnings: "string[]",
    confidence: "string",
    rationale: "string",
    citedObjectRefs: "string[]",
  },
};

export const FALSIFICATION_SCHEMA_DESC = [
  '{"targetBelief": string, "claims": string[], "assumptions": string[], "vulnerableAssumptions": string[],',
  ' "falsificationTargets": [{"condition": string, "attacksAssumption": string,',
  '   "conditionStatus": "DERIVED_FROM_BELIEF"|"PROPOSED", "objectRefs": string[]}],',
  ' "contradictionsFound": [{"description": string, "materiality": "MINOR"|"MEANINGFUL_WARNING"|"MATERIAL_CONTRADICTION"|"INVALIDATING",',
  '   "rationale": string, "objectRefs": string[]}],',
  ' "noCredibleContradictionFound": boolean,  // true when the search found nothing credible; this is NOT proof the belief is true',
  ' "currentAssessment": "SUPPORTED"|"WEAKENED"|"MATERIALLY_CHALLENGED"|"UNSUPPORTED"|"INDETERMINATE",',
  ' "invalidationConditions": string[], "earlyWarnings": string[],',
  ' "confidence": "HIGH"|"MODERATE"|"LOW", "rationale": string,',
  ' "citedObjectRefs": string[]  // evidence ids from the context only',
].join("\n");

const FALSIFICATION_SYSTEM = [
  "You are the falsification researcher of a trading RESEARCH workbench (Flow 7; WHAT COULD PROVE ME WRONG?).",
  "You receive the trader's belief (THEIR OWN; you evaluate it, you never rewrite it) and the VALIDATED research context.",
  "Hard rules:",
  "- Search orientation: what would make this belief WRONG? Prioritize disconfirming evidence over supporting evidence.",
  "- Do not manufacture opposition for balance. If the context contains no credible contradiction, set noCredibleContradictionFound=true and say so; absence of contradiction is NOT confirmation.",
  "- Grade materiality honestly: one weak source disagreeing is MINOR, not INVALIDATING.",
  "- Falsification targets derived from the belief's own statements are DERIVED_FROM_BELIEF; anything you propose is PROPOSED and must be labeled as such. Never invent numeric thresholds and present them as established.",
  "- Distinguish invalidating evidence from early-warning signals from noise.",
  "- LIMITATIONS (tool failures, empty feeds) are not negative evidence. Only cite evidence ids present in the context.",
  "- The assessment NEVER mutates the trader's thesis; it informs the trader, who decides.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

// ---------------------------------------------------------------------------
// Flow 7 runner
// ---------------------------------------------------------------------------

export interface Flow7Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** The belief to stress-test: an active thesis ref, or a free-form belief statement. */
  readonly thesisRef?: string;
  readonly beliefStatement?: string;
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

export interface Flow7Result {
  readonly outcome: FlowOutcome;
  readonly assessment: FalsificationAssessment | undefined;
  readonly modelFailure?: ModelFailure;
  /** Monitoring PROPOSAL only; never an activated monitor (M4 §22). */
  readonly monitoringProposal?: readonly string[];
  readonly response: string;
}

/**
 * Flow 7: belief → decompose → failure conditions → falsification targets → disconfirming
 * research (biased scheduler via FALSIFICATION mode guidance) → materiality evaluation →
 * assessment (existing judgment model) → optional monitoring proposal.
 */
export async function runFlow7(objective: string, options: Flow7Options): Promise<Flow7Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 7 orchestration" };
  const workspace = options.workspace;

  // Resolve the belief: an existing trader thesis (trader-owned) or a free-form belief.
  const thesis = options.thesisRef !== undefined ? workspace.getThesis(options.thesisRef) : workspace.activeTheses()[0];
  const beliefStatement = options.beliefStatement ?? thesis?.statement;
  if (beliefStatement === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "no belief or thesis to falsify; provide a statement or activate a thesis (never fabricate a belief)", false);
    return { outcome: emptyOutcome(objective, failure), assessment: undefined, modelFailure: failure, response: failureResponse(failure) };
  }

  const research = workspace.addResearch(
    { objective, question: objective, flow: "WHAT_COULD_PROVE_ME_WRONG" },
    { kind: "trader", detail: "Flow 7 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const flowObjective = FLOW_OBJECTIVES.WHAT_COULD_PROVE_ME_WRONG;
  if (flowObjective === undefined) throw new Error("Flow 7 objective metadata missing; architecture inconsistency");

  const flowOutcome = await runFlow(objective, flowObjective, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: options.asset !== undefined ? { asset: options.asset } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  let assessment: FalsificationAssessment | undefined;
  try {
    assessment = await assess(flowOutcome, beliefStatement, options);
  } catch (error) {
    // M4 §33: provider-level failure keeps its type; never laundered into a validation failure.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return { outcome: flowOutcome, assessment: undefined, modelFailure: failure, response: failureResponse(failure) };
  }
  if (assessment === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "falsification assessment failed validation; no assessment is asserted", false);
    return { outcome: flowOutcome, assessment: undefined, modelFailure: failure, response: failureResponse(failure) };
  }

  // Analysis object over the disconfirming search (object model §8).
  const analysis = workspace.addAnalysis(
    {
      objective: `Falsification analysis: ${beliefStatement.slice(0, 120)}`,
      mode: "INTERPRET",
      inputs: flowOutcome.evidence.map((e) => e.id),
      findings: [
        ...assessment.contradictionsFound.map((c) => `[${c.materiality}] ${c.description}; ${c.rationale}`),
        ...(assessment.noCredibleContradictionFound ? ["no credible contradiction found in available evidence (NOT confirmation of the belief)"] : []),
      ],
      conclusion: `Current assessment: ${assessment.currentAssessment}; ${assessment.rationale}`,
      uncertainty: assessment.earlyWarnings,
    },
    systemOrigin,
    at(),
  );

  // Judgment via the EXISTING model (M4 §22); trader's thesis object untouched.
  const opposing = flowOutcome.evidence.filter((e) => e.contradicts.length > 0).map((e) => e.id);
  const judgment = workspace.addJudgment(
    {
      researchRef: research.id,
      statement: `FALSIFICATION ASSESSMENT of the trader's belief ("${beliefStatement.slice(0, 160)}"): ${assessment.currentAssessment}; ${assessment.rationale}${assessment.noCredibleContradictionFound ? " (no credible contradiction found; this is not confirmation)" : ""}`,
      basis: {
        supportingEvidence: assessment.citedObjectRefs,
        opposingEvidence: opposing,
        keyClaims: workspace.listClaims().map((c) => c.id).slice(0, 6),
        hypotheses: flowOutcome.hypotheses.map((h) => h.id),
      },
      confidence: assessment.confidence,
      uncertainty: assessment.earlyWarnings,
      unresolvedQuestions: assessment.falsificationTargets.filter((t) => t.conditionStatus === "PROPOSED").map((t) => `proposed (not established): ${t.condition}`),
      implications: ["the trader's thesis is unchanged; assessment only", "monitoring requires explicit trader confirmation (proposal below, if any)"],
    },
    systemOrigin,
    at(),
  );

  const response = buildFlow7Response(assessment, flowOutcome, beliefStatement);
  // SHARED CONTRACT BOUNDARY: same validation law as the adaptive loop (no per-flow validator).
  return validateFlowOutcome(
    {
      outcome: { ...flowOutcome, analysisId: analysis.id, judgmentId: judgment.id },
      assessment,
      // Monitoring is a PROPOSAL only (FLOW 7 §8): conditions listed for the trader; no monitor
      // object is created and nothing is activated (M5 + confirmation territory).
      ...(monitoringToWatch(assessment).length > 0 ? { monitoringProposal: monitoringToWatch(assessment) } : {}),
      response,
    },
    { failedPaths: flowOutcome.executions.filter((e) => e.result.failure.type !== "NONE").length },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Watch list for the monitoring PROPOSAL (nothing activates here; M5 + confirmation). */
function monitoringToWatch(assessment: FalsificationAssessment): readonly string[] {
  return [...assessment.invalidationConditions.slice(0, 3)];
}

async function assess(flowOutcome: FlowOutcome, beliefStatement: string, options: Flow7Options): Promise<FalsificationAssessment | undefined> {
  try {
    const res = await options.provider.structured<string>({
      schemaName: "flow7.falsification",
      schemaDescription: FALSIFICATION_SCHEMA_DESC,
      system: FALSIFICATION_SYSTEM,
      prompt: [
        `Trader belief to falsify (TRADER-OWNED; never rewrite): "${beliefStatement}"`,
        `Research objective: ${flowOutcome.plan.objective}`,
        `Research status: ${flowOutcome.stoppedBecause}; ${flowOutcome.finalDecision.rationale}`,
        "VALIDATED RESEARCH CONTEXT:",
        renderResearchContext(flowOutcome.context),
      ].join("\n"),
      preferJson: true,
    });
    const parsed = validateModelOutput<FalsificationAssessment & Record<string, unknown>>(FALSIFICATION_SCHEMA, res.raw).data;
    if (!["SUPPORTED", "WEAKENED", "MATERIALLY_CHALLENGED", "UNSUPPORTED", "INDETERMINATE"].includes(parsed.currentAssessment)) return undefined;
    if (!["HIGH", "MODERATE", "LOW"].includes(parsed.confidence)) return undefined;
    const known = new Set<string>(flowOutcome.context.items.map((i) => i.ref));
    const materialities = new Set(["MINOR", "MEANINGFUL_WARNING", "MATERIAL_CONTRADICTION", "INVALIDATING"]);
    const conditions = new Set(["DERIVED_FROM_BELIEF", "PROPOSED"]);
    const refs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((r): r is string => typeof r === "string" && known.has(r)) : []);
    const falsificationTargets = (parsed.falsificationTargets as unknown[]).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const t = entry as Record<string, unknown>;
      if (typeof t.condition !== "string" || typeof t.attacksAssumption !== "string") return [];
      if (typeof t.conditionStatus !== "string" || !conditions.has(t.conditionStatus)) return [];
      return [{ condition: t.condition, attacksAssumption: t.attacksAssumption, conditionStatus: t.conditionStatus as "DERIVED_FROM_BELIEF" | "PROPOSED", objectRefs: refs(t.objectRefs) }];
    });
    const contradictionsFound = (parsed.contradictionsFound as unknown[]).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const c = entry as Record<string, unknown>;
      if (typeof c.description !== "string" || typeof c.rationale !== "string") return [];
      if (typeof c.materiality !== "string" || !materialities.has(c.materiality)) return [];
      return [{ description: c.description, materiality: c.materiality as ContradictionFinding["materiality"], rationale: c.rationale, objectRefs: refs(c.objectRefs) }];
    });
    return { ...parsed, falsificationTargets, contradictionsFound, citedObjectRefs: parsed.citedObjectRefs.filter((ref) => known.has(ref)) };
  } catch (error) {
    // Provider failures propagate with their type; only local validation issues → undefined.
    if (error instanceof ModelFailure && error.type !== "INVALID_OUTPUT") throw error;
    return undefined;
  }
}

function emptyOutcome(objective: string, failure: ModelFailure): FlowOutcome {
  return {
    researchId: "n/a", flow: "WHAT_COULD_PROVE_ME_WRONG", mode: "FALSIFICATION",
    plan: { objective, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: [], adaptationPolicy: "n/a; no belief to falsify" },
    rounds: [], executions: [], hypotheses: [], evidence: [],
        requirements: [], floorCapabilities: [], recoveryRounds: 0,
    finalDecision: { decision: "INSUFFICIENT_EVIDENCE", rationale: failure.message, nextTasks: [] },
    stoppedBecause: "MODEL_FAILURE",
    ...(failure !== undefined ? { modelFailure: failure } : {}),
    context: { items: [], claims: [], hypotheses: [], limitations: [], contradictions: [] },
  };
}

function failureResponse(failure: ModelFailure): string {
  return [
    `**Answer:** ${failure.message}`,
    `**Why this is not a finding:** system conditions are not evidence about the belief.`,
    `**What would change this:** an active/available thesis or belief statement; a reachable model provider.`,
  ].join("\n");
}

function buildFlow7Response(assessment: FalsificationAssessment, flowOutcome: FlowOutcome, beliefStatement: string): string {
  const lines: string[] = [];
  lines.push(`**Thesis (trader-owned, unchanged):** "${beliefStatement}"`);
  lines.push(`**Strongest case against it:** ${assessment.rationale}`);
  if (assessment.vulnerableAssumptions.length > 0) lines.push(`**Vulnerable assumptions:** ${assessment.vulnerableAssumptions.slice(0, 3).join("; ")}`);
  if (assessment.contradictionsFound.length > 0) {
    lines.push(`**Current contradictory evidence:**`);
    for (const c of assessment.contradictionsFound.slice(0, 3)) lines.push(`  • [${c.materiality}] ${c.description}`);
  } else if (assessment.noCredibleContradictionFound) {
    lines.push(`**Current contradictory evidence:** none credible found; this is NOT confirmation of the belief.`);
  }
  if (assessment.invalidationConditions.length > 0) lines.push(`**Potential invalidation conditions:** ${assessment.invalidationConditions.slice(0, 3).join("; ")}`);
  lines.push(`**Current assessment:** ${assessment.currentAssessment} (confidence: ${assessment.confidence})`);
  const proposed = assessment.falsificationTargets.filter((t) => t.conditionStatus === "PROPOSED");
  if (proposed.length > 0) lines.push(`**Proposed (not established) conditions to watch:** ${proposed.slice(0, 2).map((t) => t.condition).join("; ")}`);
  lines.push(`**Traceability:** research ${flowOutcome.researchId}; your thesis object was not modified; deeper levels available on request.`);
  return lines.join("\n");
}
