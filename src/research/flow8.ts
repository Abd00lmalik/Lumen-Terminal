/**
 * Flow 8; EVALUATE THIS ACCORDING TO MY FRAMEWORK (framework-constrained evaluation); M4b.
 *
 * Architectural basis: research-flows.md FLOW 8.
 * - The FRAMEWORK IS TRADER-OWNED. The system resolves it from saved artifacts (SAVE of type
 *   "framework" is the existing persistence path; memory.md), never invents one, never
 *   silently modifies it, and never substitutes generic model preferences for its criteria.
 * - No framework available → clear INSUFFICIENT-context failure (never a silent generic
 *   fallback) per M4b §4.
 * - The framework's own criteria are AUTHORITATIVE for the evaluation: satisfied / partially
 *   satisfied / unsatisfied / missing-evidence per criterion. If the framework defines numeric
 *   scoring, that scoring is used; if not, assessment stays QUALITATIVE; no invented numbers
 *   (M4b §4). The parsed framework text declares whether it has a scoring system.
 * - Every material factual claim must trace to validated research evidence; model background
 *   knowledge is not evidence; missing evidence is reported as missing, never manufactured
 *   (M4b §9).
 * - The flow defines objective + mode (EVALUATION); the shared runner + registry pick
 *   capabilities; no Flow→Tool hardcoding (M4b §5).
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { runFlow, type FlowObjective, type FlowOutcome } from "./flow-runner.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { SavedArtifact } from "../domain/thesis.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Flow objective; EVALUATION mode (framework-constrained; criteria are authoritative)
// ---------------------------------------------------------------------------

export const FLOW8_OBJECTIVE: FlowObjective = {
  flow: "EVALUATE_WITH_MY_FRAMEWORK",
  mode: "EVALUATION",
  schedulerGuidance: [
    "EVALUATION MODE (Flow 8; EVALUATE WITH MY FRAMEWORK): the trader's framework criteria are authoritative.",
    "- Determine what evidence each criterion NEEDS, then research missing material evidence; do not evaluate from memory or opinion.",
    "- Criteria that cannot be assessed for lack of evidence are reported as missing/insufficient; never guessed, never manufactured.",
    "- The framework is TRADER-OWNED: evaluate by it, never modify it, never substitute 'better' criteria.",
    "- Use the framework's OWN scoring if it defines one; otherwise stay qualitative; never invent numeric scores.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Framework evaluation schema; criterion-by-criterion, framework-authoritative
// ---------------------------------------------------------------------------

export type CriterionStatus = "SATISFIED" | "PARTIALLY_SATISFIED" | "NOT_SATISFIED" | "INSUFFICIENT_EVIDENCE" | "CONTRADICTED";

const CRITERION_STATUSES = new Set<string>(["SATISFIED", "PARTIALLY_SATISFIED", "NOT_SATISFIED", "INSUFFICIENT_EVIDENCE", "CONTRADICTED"]);

export interface CriterionEvaluation {
  /** The framework criterion, verbatim from the framework artifact. */
  readonly criterion: string;
  readonly status: CriterionStatus;
  /** Evidence-based rationale for this criterion's status. */
  readonly rationale: string;
  readonly supportingRefs: readonly string[];
  readonly contradictingRefs: readonly string[];
  /** What evidence would allow assessing an INSUFFICIENT_EVIDENCE criterion. */
  readonly evidenceNeeded?: string;
}

export interface FrameworkEvaluation {
  /** Which framework artifact was applied (provenance: artifact id + content hash context). */
  readonly frameworkRef: string;
  readonly frameworkSummary: string;
  /** Whether the framework text itself defines a numeric scoring system (used only then). */
  readonly scoringUsed: "FRAMEWORK_DEFINED" | "QUALITATIVE";
  readonly criteria: readonly CriterionEvaluation[];
  /** Overall evaluation; qualitative unless the framework itself defines scoring. */
  readonly overallAssessment: string;
  /** Framework-defined numeric score, present ONLY when the framework defines one. */
  readonly frameworkScore?: string;
  readonly contradictions: readonly string[];
  readonly unresolved: readonly string[];
  readonly whatWouldChange: readonly string[];
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly citedObjectRefs: readonly string[];
}

export const FRAMEWORK_EVALUATION_SCHEMA: OutputSchema = {
  name: "flow8.framework_evaluation",
  properties: {
    frameworkRef: "string",
    frameworkSummary: "string",
    scoringUsed: "string",
    criteria: "array", // entry-level validation below drops malformed entries
    overallAssessment: "string",
    contradictions: "string[]",
    unresolved: "string[]",
    whatWouldChange: "string[]",
    confidence: "string",
    citedObjectRefs: "string[]",
    frameworkScore: "string", // optional; only when the framework defines numeric scoring
  },
  optional: ["frameworkScore"],
};

export const FRAMEWORK_EVALUATION_SCHEMA_DESC = [
  '{"frameworkRef": string, "frameworkSummary": string,',
  ' "scoringUsed": "FRAMEWORK_DEFINED"|"QUALITATIVE",  // FRAMEWORK_DEFINED only if the framework text defines numeric scoring',
  ' "criteria": [{"criterion": string,',
  '   "status": "SATISFIED"|"PARTIALLY_SATISFIED"|"NOT_SATISFIED"|"INSUFFICIENT_EVIDENCE"|"CONTRADICTED",',
  '   "rationale": string, "supportingRefs": string[], "contradictingRefs": string[],',
  '   "evidenceNeeded": string  // for INSUFFICIENT_EVIDENCE criteria: what would allow assessment',
  ' }],',
  ' "overallAssessment": string,',
  ' "frameworkScore": string,  // ONLY when scoringUsed=FRAMEWORK_DEFINED; use the framework\'s own scoring',
  ' "contradictions": string[], "unresolved": string[], "whatWouldChange": string[],',
  ' "confidence": "HIGH"|"MODERATE"|"LOW",',
  ' "citedObjectRefs": string[]  // evidence ids from the context only',
].join("\n");

const FRAMEWORK_SYSTEM = [
  "You are the framework evaluator of a trading RESEARCH workbench (Flow 8; EVALUATE THIS ACCORDING TO MY FRAMEWORK?).",
  "You receive the TRADER'S OWN framework (authoritative; never modify it, never swap in 'better' criteria) and the VALIDATED research context.",
  "Hard rules:",
  "- Evaluate against the framework's OWN criteria, one by one. Do not import criteria the framework does not contain.",
  "- If the framework text defines a numeric scoring system, apply THAT scoring exactly (scoringUsed=FRAMEWORK_DEFINED, frameworkScore set). If it does not, stay QUALITATIVE; never invent numbers.",
  "- INSUFFICIENT_EVIDENCE means the context cannot support assessment; say what evidence is needed. NEVER manufacture evidence or treat absence as satisfaction or failure.",
  "- Model background knowledge is NOT evidence. Only cite evidence ids present in the context.",
  "- CONTRADICTED is for criteria with direct counterevidence in the context; distinguish it from NOT_SATISFIED (criteria simply not met).",
  "- The framework artifact is not modified by this evaluation; your output informs the trader, who decides.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

// ---------------------------------------------------------------------------
// Flow 8 runner
// ---------------------------------------------------------------------------

export interface Flow8Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** The saved framework artifact to apply; defaults to the most recent saved "framework". */
  readonly frameworkRef?: string;
  /** What the framework is applied to (asset or research target). */
  readonly target?: string;
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

export interface Flow8Result {
  readonly outcome: FlowOutcome;
  readonly evaluation: FrameworkEvaluation | undefined;
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

/**
 * Flow 8: resolve the trader's saved framework → adaptive evidence research for its criteria →
 * criterion-by-criterion evaluation → overall framework-based assessment.
 */
export async function runFlow8(objective: string, options: Flow8Options): Promise<Flow8Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 8 orchestration" };
  const workspace = options.workspace;

  // 1. Resolve the framework from SAVED artifacts; the existing SAVE persistence path.
  const framework: SavedArtifact | undefined = options.frameworkRef !== undefined
    ? workspace.getSavedArtifact(options.frameworkRef)
    : [...workspace.listSavedArtifacts()].reverse().find((a) => a.type === "framework");
  if (framework === undefined) {
    const failure = new ModelFailure(
      "INVALID_OUTPUT",
      "no saved framework available; save one first (SAVE) or specify a framework reference; a generic framework is never substituted",
      false,
    );
    return { outcome: emptyOutcome(objective, failure), evaluation: undefined, modelFailure: failure, response: failureResponse(failure) };
  }

  const research = workspace.addResearch(
    { objective, question: objective, flow: "EVALUATE_WITH_MY_FRAMEWORK" },
    { kind: "trader", detail: "Flow 8 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const flowOutcome = await runFlow(objective, FLOW8_OBJECTIVE, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: (options.asset ?? options.target) !== undefined ? { asset: options.asset ?? options.target } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  // 2. Criterion-by-criterion evaluation constrained to the framework's own text.
  let evaluation: FrameworkEvaluation | undefined;
  try {
    evaluation = await evaluateAgainstFramework(flowOutcome, framework, options);
  } catch (error) {
    // M4 §33: provider-level failure keeps its type.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return { outcome: flowOutcome, evaluation: undefined, modelFailure: failure, response: failureResponse(failure) };
  }
  if (evaluation === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "framework evaluation failed validation; no assessment asserted", false);
    return { outcome: flowOutcome, evaluation: undefined, modelFailure: failure, response: failureResponse(failure) };
  }

  // 3. Analysis + judgment. The FRAMEWORK ARTIFACT IS NOT TOUCHED.
  const analysis = workspace.addAnalysis(
    {
      objective: `Framework evaluation: ${framework.content.slice(0, 100)}`,
      mode: "INTERPRET",
      inputs: flowOutcome.evidence.map((e) => e.id),
      findings: [
        ...evaluation.criteria.map((c) => `[${c.status}] ${c.criterion}; ${c.rationale}`),
        ...evaluation.contradictions.map((x) => `contradiction: ${x}`),
      ],
      conclusion: evaluation.overallAssessment,
      uncertainty: evaluation.unresolved,
    },
    systemOrigin,
    at(),
  );

  const judgment = workspace.addJudgment(
    {
      researchRef: research.id,
      statement: `FRAMEWORK EVALUATION (saved framework ${framework.id}, unchanged): ${evaluation.overallAssessment}${evaluation.frameworkScore !== undefined ? ` [framework score: ${evaluation.frameworkScore}]` : ""}`,
      basis: {
        supportingEvidence: evaluation.citedObjectRefs,
        opposingEvidence: flowOutcome.evidence.filter((e) => e.contradicts.length > 0).map((e) => e.id),
        keyClaims: workspace.listClaims().map((c) => c.id).slice(0, 6),
        hypotheses: flowOutcome.hypotheses.map((h) => h.id),
      },
      confidence: evaluation.confidence,
      uncertainty: evaluation.unresolved,
      unresolvedQuestions: evaluation.whatWouldChange,
      implications: [
        "the trader's framework artifact is unchanged; evaluation only",
        "criterion gaps are evidence-availability conditions, not failures of the target",
      ],
    },
    systemOrigin,
    at(),
  );

  return {
    outcome: { ...flowOutcome, analysisId: analysis.id, judgmentId: judgment.id },
    evaluation,
    response: buildFlow8Response(evaluation, flowOutcome, framework),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function evaluateAgainstFramework(flowOutcome: FlowOutcome, framework: SavedArtifact, options: Flow8Options): Promise<FrameworkEvaluation | undefined> {
  if (flowOutcome.context.items.length === 0 && flowOutcome.context.limitations.length === 0) return undefined;
  const target = options.target ?? options.asset ?? "the research target";
  const res = await options.provider.structured<string>({
    schemaName: "flow8.framework_evaluation",
    schemaDescription: FRAMEWORK_EVALUATION_SCHEMA_DESC,
    system: FRAMEWORK_SYSTEM,
    prompt: [
      `TRADER'S FRAMEWORK (authoritative, artifact ${framework.id}; evaluate BY it, never rewrite it):`,
      "<<<FRAMEWORK TEXT>>>",
      framework.content,
      "<<<END FRAMEWORK TEXT>>>",
      `Evaluation target: ${target}`,
      `Research status: ${flowOutcome.stoppedBecause}; ${flowOutcome.finalDecision.rationale}`,
      "VALIDATED RESEARCH CONTEXT:",
      renderResearchContext(flowOutcome.context),
    ].join("\n"),
    preferJson: true,
  });
  const parsed = validateModelOutput<FrameworkEvaluation & Record<string, unknown>>(FRAMEWORK_EVALUATION_SCHEMA, res.raw).data;
  if (!["FRAMEWORK_DEFINED", "QUALITATIVE"].includes(parsed.scoringUsed)) return undefined;
  if (!["HIGH", "MODERATE", "LOW"].includes(parsed.confidence)) return undefined;
  // Guard the optional-score law: a numeric score may appear ONLY when the framework defines one.
  if (parsed.frameworkScore !== undefined && parsed.scoringUsed !== "FRAMEWORK_DEFINED") return undefined;
  const known = new Set<string>(flowOutcome.context.items.map((i) => i.ref));
  const refs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((r): r is string => typeof r === "string" && known.has(r)) : []);
  const criteria = (parsed.criteria as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const c = entry as Record<string, unknown>;
    if (typeof c.criterion !== "string" || typeof c.rationale !== "string") return [];
    if (typeof c.status !== "string" || !CRITERION_STATUSES.has(c.status)) return [];
    return [{
      criterion: c.criterion,
      status: c.status as CriterionStatus,
      rationale: c.rationale,
      supportingRefs: refs(c.supportingRefs),
      contradictingRefs: refs(c.contradictingRefs),
      ...(typeof c.evidenceNeeded === "string" ? { evidenceNeeded: c.evidenceNeeded } : {}),
    }];
  });
  return {
    ...parsed,
    criteria,
    citedObjectRefs: parsed.citedObjectRefs.filter((ref) => known.has(ref)),
  };
}

function emptyOutcome(objective: string, failure: ModelFailure): FlowOutcome {
  return {
    researchId: "n/a", flow: "EVALUATE_WITH_MY_FRAMEWORK", mode: "EVALUATION",
    plan: { objective, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: [], adaptationPolicy: "n/a; no framework available" },
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
    `**Why this is not a finding:** system conditions are not evidence about the target.`,
    `**What would change this:** a saved framework (SAVE a framework artifact); a reachable model provider.`,
  ].join("\n");
}

function buildFlow8Response(evaluation: FrameworkEvaluation, flowOutcome: FlowOutcome, framework: SavedArtifact): string {
  const lines: string[] = [];
  lines.push(`**Framework (trader-owned, artifact ${framework.id}, unchanged):** ${evaluation.frameworkSummary}`);
  lines.push(`**Overall:** ${evaluation.overallAssessment}${evaluation.frameworkScore !== undefined ? ` (framework score: ${evaluation.frameworkScore})` : " (qualitative; the framework defines no numeric scoring)"}`);
  lines.push(`**Criterion results:**`);
  for (const c of evaluation.criteria.slice(0, 6)) {
    lines.push(`  • [${c.status}] ${c.criterion}${c.status === "INSUFFICIENT_EVIDENCE" && c.evidenceNeeded !== undefined ? `; needs: ${c.evidenceNeeded}` : ""}`);
  }
  if (evaluation.contradictions.length > 0) lines.push(`**Contradictions:** ${evaluation.contradictions.slice(0, 2).join("; ")}`);
  lines.push(`**Confidence:** ${evaluation.confidence}`);
  if (evaluation.whatWouldChange.length > 0) lines.push(`**What would change this:** ${evaluation.whatWouldChange.slice(0, 2).join("; ")}`);
  lines.push(`**Traceability:** research ${flowOutcome.researchId}; criterion-level evidence lives in the research state.`);
  return lines.join("\n");
}
