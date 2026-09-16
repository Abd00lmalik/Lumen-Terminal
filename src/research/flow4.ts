/**
 * Flow 4 — DOES MY THESIS HOLD? (thesis evaluation) — M4b.
 *
 * Architectural basis: research-flows.md FLOW 4.
 * - Evaluates the TRADER-OWNED active thesis. The system NEVER silently rewrites, weakens,
 *   strengthens, replaces, or mutates the thesis (thesis.md; M4b §3). Revision is a separate
 *   consequential action behind the existing LUI/confirmation boundary (MANAGE_STATE + origin).
 * - Decomposes the thesis into claims/assumptions (the Thesis object already carries
 *   ThesisClaim/ThesisAssumption with importance + invalidationConditions — reused, not
 *   reinvented); researches BOTH supporting and disconfirming evidence per component.
 * - Reuses the EXISTING judgment vocabulary (SUPPORTED / WEAKENED / MATERIALLY_CHALLENGED /
 *   UNSUPPORTED / INDETERMINATE) — no new scoring system (M4b §3).
 * - Epistemic separations (M4b §3): evidence quality ≠ research quality ≠ confidence ≠ thesis
 *   assessment. Unavailable evidence is NOT contradiction (retrieval failure ≠ negative
 *   evidence); a single weak source does not invalidate; model confidence never overrides
 *   evidence quality.
 * - Flow 4 vs Flow 7 (M4b §7): Flow 4 evaluates; Flow 7 is dedicated falsification. Flow 4 may
 *   request disconfirming evidence internally (via capability selection) but remains a distinct
 *   flow — they share the runner, not the objective.
 * - The flow defines objective + mode (EVALUATION); the shared runner + registry pick
 *   capabilities — no Flow→Tool hardcoding (M4b §5).
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { runFlow, type FlowObjective, type FlowOutcome } from "./flow-runner.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { Thesis } from "../domain/thesis.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Flow objective — EVALUATION mode (thesis assessment; evidence over confidence)
// ---------------------------------------------------------------------------

export const FLOW4_OBJECTIVE: FlowObjective = {
  flow: "DOES_MY_THESIS_HOLD",
  mode: "EVALUATION",
  schedulerGuidance: [
    "EVALUATION MODE (Flow 4 — DOES MY THESIS HOLD?): assess the trader's thesis against evidence — both supporting AND disconfirming.",
    "- Decompose the thesis into its own claims/assumptions (they exist on the Thesis object); evaluate COMPONENT-BY-COMPONENT, not just holistically.",
    "- Research balanced evidence: what supports each claim, what contradicts it, what would count as invalidation (the thesis's OWN invalidationConditions are authoritative).",
    "- Epistemic rules: unavailable evidence is NOT contradiction; one weak source does not invalidate; model confidence never overrides evidence quality; freshness matters (stale evidence stays stale).",
    "- Distinguish evidence quality, research quality, confidence, and the thesis assessment — they are NOT interchangeable.",
    "- The thesis is TRADER-OWNED: assess it, never modify it.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Thesis-evaluation schema — claim-level + overall (existing judgment vocabulary)
// ---------------------------------------------------------------------------

/**
 * Assessment vocabulary for thesis evaluations — the architecture's judgment vocabulary (M4b §3).
 * Lives in the domain (thesis.ts); re-exported here for flow-local use.
 */
export type { ThesisAssessmentStatus } from "../domain/thesis.js";
import type { ThesisAssessmentStatus } from "../domain/thesis.js";

const ASSESSMENT_STATUSES = new Set<string>(["SUPPORTED", "WEAKENED", "MATERIALLY_CHALLENGED", "UNSUPPORTED", "INDETERMINATE"]);

export interface ThesisComponentAssessment {
  /** Which thesis claim/assumption this assesses (verbatim component statement). */
  readonly component: string;
  readonly kind: "CLAIM" | "ASSUMPTION";
  /** Per-component status from the SAME vocabulary as the overall assessment. */
  readonly status: ThesisAssessmentStatus;
  /** Evidence quality for this component — distinct from status (M4b §3). */
  readonly evidenceQuality: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly supportingRefs: readonly string[];
  readonly contradictingRefs: readonly string[];
  /** Why this status, grounded in evidence — not model sentiment. */
  readonly rationale: string;
  readonly uncertainty: readonly string[];
}

export interface ThesisEvaluation {
  /** The evaluated thesis, identified verbatim — trader-owned, unchanged. */
  readonly thesisStatement: string;
  readonly components: readonly ThesisComponentAssessment[];
  /** Overall assessment — existing judgment vocabulary (no new taxonomy). */
  readonly overallAssessment: ThesisAssessmentStatus;
  /** Evidence-quality/readiness of the research behind the overall assessment. */
  readonly evidenceBasisQuality: "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE";
  readonly strongestSupport: readonly string[];
  readonly strongestOpposition: readonly string[];
  /** The thesis's OWN invalidation conditions, with current evidence against each (if any). */
  readonly invalidationConditionStatus: readonly { readonly condition: string; readonly currentlyTriggered: boolean; readonly evidenceRefs: readonly string[] }[];
  readonly unresolved: readonly string[];
  /** What would change the assessment — evidence/conditions, never sentiment. */
  readonly whatWouldChange: readonly string[];
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly rationale: string;
  readonly citedObjectRefs: readonly string[];
}

export const THESIS_EVALUATION_SCHEMA: OutputSchema = {
  name: "flow4.thesis_evaluation",
  properties: {
    thesisStatement: "string",
    components: "array", // entry-level validation below drops malformed entries
    overallAssessment: "string",
    evidenceBasisQuality: "string",
    strongestSupport: "string[]",
    strongestOpposition: "string[]",
    invalidationConditionStatus: "array", // entry-level validation below
    unresolved: "string[]",
    whatWouldChange: "string[]",
    confidence: "string",
    rationale: "string",
    citedObjectRefs: "string[]",
  },
};

export const THESIS_EVALUATION_SCHEMA_DESC = [
  '{"thesisStatement": string,',
  ' "components": [{"component": string, "kind": "CLAIM"|"ASSUMPTION",',
  '   "status": "SUPPORTED"|"WEAKENED"|"MATERIALLY_CHALLENGED"|"UNSUPPORTED"|"INDETERMINATE",',
  '   "evidenceQuality": "STRONG"|"MIXED"|"WEAK"|"UNAVAILABLE", "supportingRefs": string[],',
  '   "contradictingRefs": string[], "rationale": string, "uncertainty": string[]}],',
  ' "overallAssessment": "SUPPORTED"|"WEAKENED"|"MATERIALLY_CHALLENGED"|"UNSUPPORTED"|"INDETERMINATE",',
  ' "evidenceBasisQuality": "STRONG"|"MIXED"|"WEAK"|"UNAVAILABLE",',
  ' "strongestSupport": string[], "strongestOpposition": string[],',
  ' "invalidationConditionStatus": [{"condition": string, "currentlyTriggered": boolean, "evidenceRefs": string[]}],',
  ' "unresolved": string[], "whatWouldChange": string[],',
  ' "confidence": "HIGH"|"MODERATE"|"LOW", "rationale": string,',
  ' "citedObjectRefs": string[]  // evidence ids from the context only',
].join("\n");

const EVALUATION_SYSTEM = [
  "You are the thesis evaluator of a trading RESEARCH workbench (Flow 4 — DOES MY THESIS HOLD?).",
  "You receive the TRADER'S OWN thesis (never rewrite it) and the VALIDATED research context.",
  "Hard rules:",
  "- Evaluate the thesis's claims/assumptions component-by-component; the overall assessment must be consistent with the components (a CORE claim invalidated is not a mild weakening).",
  "- UNAVAILABLE evidence is NOT contradiction: if the context has nothing relevant for a component, evidenceQuality=UNAVAILABLE and the status leans INDETERMINATE — never UNSUPPORTED-by-absence.",
  "- Retrieval failure and tool limitations in the context are data-availability conditions, NOT negative evidence.",
  "- One weak source does not invalidate; repeated secondary reports of one primary are not independent corroboration; stale evidence stays stale.",
  "- Your confidence NEVER upgrades an assessment beyond what the evidence supports. evidenceQuality and status are separate fields for a reason.",
  "- Use the thesis's OWN invalidationConditions when checking what would falsify it.",
  "- Only cite evidence ids present in the context — never fabricate refs.",
  "- The thesis object is not modified by this evaluation; your output informs the trader, who decides.",
].join("\n");

// ---------------------------------------------------------------------------
// Flow 4 runner
// ---------------------------------------------------------------------------

export interface Flow4Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** The thesis to evaluate; defaults to the workspace's active thesis. */
  readonly thesisRef?: string;
  readonly asset?: string;
  readonly constraints?: readonly string[];
  readonly maxRounds?: number;
  readonly now?: () => Date;
}

export interface Flow4Result {
  readonly outcome: FlowOutcome;
  readonly evaluation: ThesisEvaluation | undefined;
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

/** Flow 4: active thesis → adaptive balanced research → claim-level + overall evaluation. */
export async function runFlow4(objective: string, options: Flow4Options): Promise<Flow4Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 4 orchestration" };
  const workspace = options.workspace;

  // 1. Retrieve the trader-owned thesis (or fail honestly — never fabricate one).
  const thesis: Thesis | undefined = options.thesisRef !== undefined ? workspace.getThesis(options.thesisRef) : workspace.activeTheses()[0];
  if (thesis === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "no active thesis to evaluate — activate or state a thesis first (never fabricate one)", false);
    return { outcome: emptyOutcome(objective, failure), evaluation: undefined, modelFailure: failure, response: failureResponse(failure) };
  }
  const thesisVersionAtEvaluation = thesis.version;

  const research = workspace.addResearch(
    { objective, question: objective, flow: "DOES_MY_THESIS_HOLD" },
    { kind: "trader", detail: "Flow 4 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const flowOutcome = await runFlow(objective, FLOW4_OBJECTIVE, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: options.asset !== undefined ? { asset: options.asset } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  // 2. Evaluate against the thesis's OWN structure (claims/assumptions/invalidation conditions).
  let evaluation: ThesisEvaluation | undefined;
  try {
    evaluation = await evaluate(flowOutcome, thesis, options);
  } catch (error) {
    // M4 §33: provider-level failure keeps its type.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return { outcome: flowOutcome, evaluation: undefined, modelFailure: failure, response: failureResponse(failure) };
  }
  if (evaluation === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "thesis evaluation failed validation — no assessment asserted", false);
    return { outcome: flowOutcome, evaluation: undefined, modelFailure: failure, response: failureResponse(failure) };
  }

  // 3. Analysis + judgment. The THESIS OBJECT IS NOT TOUCHED — the evaluation lives in the
  //    analysis/judgment layer (thesis.md; M4b §3).
  const analysis = workspace.addAnalysis(
    {
      objective: `Thesis evaluation: ${thesis.statement.slice(0, 120)}`,
      mode: "INTERPRET",
      inputs: flowOutcome.evidence.map((e) => e.id),
      findings: [
        ...evaluation.components.map((c) => `[${c.kind}/${c.status}] ${c.component} — ${c.rationale}`),
        ...(evaluation.invalidationConditionStatus.filter((i) => i.currentlyTriggered).map((i) => `invalidation condition TRIGGERED (per evidence): ${i.condition}`)),
      ],
      conclusion: `Overall: ${evaluation.overallAssessment} — ${evaluation.rationale}`,
      uncertainty: evaluation.unresolved,
    },
    systemOrigin,
    at(),
  );

  const judgment = workspace.addJudgment(
    {
      researchRef: research.id,
      statement: `THESIS EVALUATION of the trader's thesis (version ${thesisVersionAtEvaluation}, unchanged): ${evaluation.overallAssessment} — ${evaluation.rationale}`,
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
        "the trader's thesis object is unchanged — evaluation only; revision is a separate confirmed action",
        "Flow 7 can stress-test this evaluation with dedicated falsification methodology",
      ],
    },
    systemOrigin,
    at(),
  );

  // M6 (audit D3): record the evaluation in the auditable thesis-assessment history (M5 §9).
  // Assessment is a RESEARCH RESULT — the thesis object itself remains untouched (version
  // unchanged); recording history is not mutation.
  workspace.recordThesisAssessment(
    {
      thesisId: thesis.id,
      thesisVersion: thesisVersionAtEvaluation,
      assessment: evaluation.overallAssessment,
      rationale: evaluation.rationale,
      supportingEvidence: evaluation.citedObjectRefs, // validated refs only (fabrications already dropped)
      contradictingEvidence: evaluation.components.flatMap((c) => c.contradictingRefs),
      unresolved: evaluation.unresolved,
      whatWouldChange: evaluation.whatWouldChange,
      confidence: evaluation.confidence,
      researchRef: research.id,
      researchQuality: evaluation.evidenceBasisQuality,
    },
    systemOrigin,
    at(),
  );

  return {
    outcome: { ...flowOutcome, analysisId: analysis.id, judgmentId: judgment.id },
    evaluation,
    response: buildFlow4Response(evaluation, flowOutcome, thesis),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function evaluate(flowOutcome: FlowOutcome, thesis: Thesis, options: Flow4Options): Promise<ThesisEvaluation | undefined> {
  if (flowOutcome.context.items.length === 0 && flowOutcome.context.limitations.length === 0) return undefined;
  const thesisStructure = {
    claims: thesis.claims.map((c) => ({ statement: c.statement, importance: c.importance, invalidationConditions: c.invalidationConditions })),
    assumptions: thesis.assumptions.map((a) => ({ statement: a.statement, importance: a.importance, invalidationConditions: a.invalidationConditions })),
    invalidationConditions: thesis.invalidationConditions,
    alternatives: thesis.alternatives,
  };
  const res = await options.provider.structured<string>({
    schemaName: "flow4.thesis_evaluation",
    schemaDescription: THESIS_EVALUATION_SCHEMA_DESC,
    system: EVALUATION_SYSTEM,
    prompt: [
      `TRADER'S THESIS (their property — evaluate, never rewrite): "${thesis.statement}"`,
      `Thesis structure (authoritative components): ${JSON.stringify(thesisStructure)}`,
      `Research objective: ${objectiveLine(thesis.statement)}`,
      `Research status: ${flowOutcome.stoppedBecause} — ${flowOutcome.finalDecision.rationale}`,
      "VALIDATED RESEARCH CONTEXT:",
      renderResearchContext(flowOutcome.context),
    ].join("\n"),
    preferJson: true,
  });
  const parsed = validateModelOutput<ThesisEvaluation & Record<string, unknown>>(THESIS_EVALUATION_SCHEMA, res.raw).data;
  if (!ASSESSMENT_STATUSES.has(parsed.overallAssessment)) return undefined;
  if (!["HIGH", "MODERATE", "LOW"].includes(parsed.confidence)) return undefined;
  if (!["STRONG", "MIXED", "WEAK", "UNAVAILABLE"].includes(parsed.evidenceBasisQuality)) return undefined;
  const known = new Set<string>(flowOutcome.context.items.map((i) => i.ref));
  const refs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((r): r is string => typeof r === "string" && known.has(r)) : []);
  const strs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((s): s is string => typeof s === "string") : []);
  const qualities = new Set(["STRONG", "MIXED", "WEAK", "UNAVAILABLE"]);
  const components = (parsed.components as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const c = entry as Record<string, unknown>;
    if (typeof c.component !== "string" || typeof c.rationale !== "string") return [];
    if (typeof c.status !== "string" || !ASSESSMENT_STATUSES.has(c.status)) return [];
    if (typeof c.evidenceQuality !== "string" || !qualities.has(c.evidenceQuality)) return [];
    if (c.kind !== "CLAIM" && c.kind !== "ASSUMPTION") return [];
    return [{
      component: c.component, kind: c.kind as "CLAIM" | "ASSUMPTION",
      status: c.status as ThesisAssessmentStatus, evidenceQuality: c.evidenceQuality as "STRONG" | "MIXED" | "WEAK" | "UNAVAILABLE",
      supportingRefs: refs(c.supportingRefs), contradictingRefs: refs(c.contradictingRefs),
      rationale: c.rationale, uncertainty: strs(c.uncertainty),
    }];
  });
  const invalidationConditionStatus = (parsed.invalidationConditionStatus as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const i = entry as Record<string, unknown>;
    if (typeof i.condition !== "string" || typeof i.currentlyTriggered !== "boolean") return [];
    return [{ condition: i.condition, currentlyTriggered: i.currentlyTriggered, evidenceRefs: refs(i.evidenceRefs) }];
  });
  return {
    ...parsed,
    components,
    invalidationConditionStatus,
    citedObjectRefs: parsed.citedObjectRefs.filter((ref) => known.has(ref)),
  };
}

function objectiveLine(thesisStatement: string): string {
  return `Does the thesis hold: "${thesisStatement.slice(0, 160)}"?`;
}

function emptyOutcome(objective: string, failure: ModelFailure): FlowOutcome {
  return {
    researchId: "n/a", flow: "DOES_MY_THESIS_HOLD", mode: "EVALUATION",
    plan: { objective, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: [], adaptationPolicy: "n/a — no thesis to evaluate" },
    rounds: [], executions: [], hypotheses: [], evidence: [],
    finalDecision: { decision: "INSUFFICIENT_EVIDENCE", rationale: failure.message, nextTasks: [] },
    stoppedBecause: "MODEL_FAILURE",
    ...(failure !== undefined ? { modelFailure: failure } : {}),
    context: { items: [], claims: [], hypotheses: [], limitations: [], contradictions: [] },
  };
}

function failureResponse(failure: ModelFailure): string {
  return [
    `**Answer:** ${failure.message}`,
    `**Why this is not a finding:** system conditions are not evidence about the thesis.`,
    `**What would change this:** an active thesis; a reachable model provider.`,
  ].join("\n");
}

function buildFlow4Response(evaluation: ThesisEvaluation, flowOutcome: FlowOutcome, thesis: Thesis): string {
  const lines: string[] = [];
  lines.push(`**Thesis (trader-owned, version ${thesis.version}, unchanged):** "${thesis.statement}"`);
  lines.push(`**Assessment:** ${evaluation.overallAssessment} — ${evaluation.rationale}`);
  if (evaluation.components.length > 0) {
    lines.push(`**Component assessments:**`);
    for (const c of evaluation.components.slice(0, 5)) lines.push(`  • [${c.kind} · ${c.status} · evidence: ${c.evidenceQuality}] ${c.component}`);
  }
  const triggered = evaluation.invalidationConditionStatus.filter((i) => i.currentlyTriggered);
  if (triggered.length > 0) lines.push(`**Invalidation conditions currently challenged by evidence:** ${triggered.map((i) => i.condition).join("; ")}`);
  if (evaluation.strongestOpposition.length > 0) lines.push(`**Strongest opposition:** ${evaluation.strongestOpposition.slice(0, 2).join("; ")}`);
  lines.push(`**Evidence basis:** ${evaluation.evidenceBasisQuality} (distinct from confidence: ${evaluation.confidence})`);
  if (evaluation.unresolved.length > 0) lines.push(`**Unresolved:** ${evaluation.unresolved.slice(0, 3).join("; ")}`);
  if (evaluation.whatWouldChange.length > 0) lines.push(`**What would change this:** ${evaluation.whatWouldChange.slice(0, 2).join("; ")}`);
  lines.push(`**Traceability:** research ${flowOutcome.researchId}; your thesis was not modified; Flow 7 can stress-test this further.`);
  return lines.join("\n");
}
