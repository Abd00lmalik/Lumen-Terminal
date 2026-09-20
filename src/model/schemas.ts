/**
 * Schemas; the validated structured-output contracts between the model and the system (M3 §6).
 *
 * Architectural basis:
 * - M3 §6: "Do not rely on free-form model text for machine-critical routing." Every schema here
 *   is validated by `validateModelOutput` before the LUI or engine acts on it. Invalid output is
 *   a model/interpretation failure; never an execution command.
 * - M3 §4/§5: the six LUI actions (RESEARCH/ANALYZE/CHALLENGE/MANAGE_STATE/MONITOR/SAVE) come
 *   from the locked architecture (lui-universal-core.md + lui-flow-extensions.md amendment).
 *   Model outputs PROPOSE; the LUI validates, checks ambiguity/consequence, and the engine
 *   executes. The model never dispatches directly.
 * - M3 §9: context objects keep their epistemic classes; schemas here never let the model
 *   upgrade interpretation → fact; the model can only REFERENCE evidence/objects.
 */

import { validateModelOutput, type OutputSchema } from "./provider.js";
import { normalizePlanCapabilities } from "./capability-vocabulary.js";

// ---------------------------------------------------------------------------
// Prompt-facing schema descriptions (rendered into model prompts; mirrors the schemas)
// ---------------------------------------------------------------------------

export const RESEARCH_PLAN_SCHEMA_DESC = [
  '{"objective": string, "scopeIncluded": string[], "scopeExcluded": string[],',
  ' "tasks": [{"type": string, "objective": string, "capabilities": string[], "completion": string}],',
  ' "completionCriteria": string[], "adaptationPolicy": string}',
].join("\n");

export const ADAPTIVE_DECISION_SCHEMA_DESC = [
  '{"decision": "CONTINUE" | "COMPLETE" | "INSUFFICIENT_EVIDENCE", "rationale": string,',
  ' "nextTasks": [{"objective": string, "capabilities": string[], "completion": string}]  // required when decision=CONTINUE',
].join("\n");

// ---------------------------------------------------------------------------
// Locked vocabulary
// ---------------------------------------------------------------------------

/** The locked 6-action LUI set (human-approved architecture lock; SAVE is first-class). */
export const LUI_ACTIONS = ["RESEARCH", "ANALYZE", "CHALLENGE", "MANAGE_STATE", "MONITOR", "SAVE"] as const;
export type LuiAction = (typeof LUI_ACTIONS)[number];

/** The 8 locked research flows (research-flows.md). */
export const RESEARCH_FLOWS = [
  "WHAT_HAPPENED",
  "WHY_IT_HAPPENED",
  "WHAT_COULD_AFFECT_IT",
  "DOES_MY_THESIS_HOLD",
  "HAS_THIS_HAPPENED_BEFORE",
  "WHAT_DOES_ALL_INFORMATION_SAY",
  "WHAT_COULD_PROVE_ME_WRONG",
  "EVALUATE_WITH_MY_FRAMEWORK",
] as const;
export type ResearchFlow = (typeof RESEARCH_FLOWS)[number];

/** Consequence levels gate confirmation requirements (safety-boundaries.md). */
export type ConsequenceLevel = "INFORMATIONAL" | "STATE_MUTATION" | "CONSEQUENTIAL";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** 1. Request understanding; the first model call for every user message (M3 §5). */
export interface NormalizedRequest {
  readonly primaryAction: LuiAction;
  /** Secondary/dependent actions for compound requests, in execution order (M3 §12). */
  readonly compoundActions: readonly { action: LuiAction; purpose: string }[];
  /** The user's research objective in their own terms (used verbatim for provenance). */
  readonly objective: string;
  /** True when the message only asks for explanation of existing research (not new research). */
  readonly isExplanationOnly: boolean;
  /** Requested disclosure depth: 0 = answer … 5 = full history (progressive-disclosure.md §6). */
  readonly disclosureLevel: number;
}

export const NORMALIZED_REQUEST_SCHEMA: OutputSchema = {
  name: "lui.normalized_request",
  properties: {
    primaryAction: "string",
    compoundActions: "record[]", // array of {action, purpose}; shape-checked by parseNormalizedRequest
    objective: "string",
    isExplanationOnly: "boolean",
    disclosureLevel: "number",
  },
  // A simple (non-compound) request legitimately has no compound steps; models express that by
  // omitting the key. parseNormalizedRequest defaults it to []; absence is an empty list.
  optional: ["compoundActions"],
};

/** 2. Context/target resolution; what the request is about (M3 §5/§13). */
export interface ResolvedTarget {
  readonly asset?: string;
  readonly flow?: ResearchFlow;
  readonly researchRef?: string;
  /** Other object references the request targets (claims, judgments, hypotheses…). */
  readonly objectRefs: readonly string[];
  /** What could not be resolved from context; feeds the ambiguity check (never invented). */
  readonly unresolved: readonly string[];
}

export const RESOLVED_TARGET_SCHEMA: OutputSchema = {
  name: "lui.resolved_target",
  properties: {
    asset: "string",
    flow: "string",
    researchRef: "string",
    objectRefs: "string[]",
    unresolved: "string[]",
  },
  // asset/flow/researchRef are genuinely optional in the domain type: a fresh workspace has
  // no research to reference and not every request names an asset or maps to a flow. The
  // LUI normalizes absent values (validateTarget drops empty/undefined); the live model
  // correctly omitted `researchRef` for a brand-new workspace, which the old all-required
  // schema wrongly rejected (masked by deterministic fakes that always sent every key).
  optional: ["asset", "flow", "researchRef"],
  allowExtra: false,
};

/** 3. Ambiguity detection (M3 §13): genuine ambiguity → clarify; never invent missing context. */
export interface AmbiguityAssessment {
  readonly isAmbiguous: boolean;
  readonly questions: readonly string[];
  /** Why ordinary context resolution was insufficient (empty when unambiguous). */
  readonly reason: string;
}

export const AMBIGUITY_SCHEMA: OutputSchema = {
  name: "lui.ambiguity",
  properties: {
    isAmbiguous: "boolean",
    questions: "string[]",
    reason: "string",
  },
};

/** 4. Consequence classification (M3 §14/§17): gates confirmation for state mutation. */
export interface ConsequenceAssessment {
  readonly level: ConsequenceLevel;
  readonly rationale: string;
  /** True for SAVE/MONITOR/thesis-change; persistent or consequential per architecture. */
  readonly requiresConfirmation: boolean;
}

export const CONSEQUENCE_SCHEMA: OutputSchema = {
  name: "lui.consequence",
  properties: {
    level: "string",
    rationale: "string",
    requiresConfirmation: "boolean",
  },
};

/** 5. Action plan; the LUI's validated execution plan (M3 §5 ARCHITECTURE DISPATCH input). */
export interface PlannedStep {
  readonly action: LuiAction;
  /** Human-readable statement of what this step does (exposed, auditable; no hidden CoT). */
  readonly description: string;
  /** Capability requirements this step needs (capability-first; registry resolves providers). */
  readonly capabilities: readonly string[];
  /** Free-form validated parameters for the step (target, constraints, artifact content…). */
  readonly params: Readonly<Record<string, string>>;
}

export interface ActionPlan {
  readonly steps: readonly PlannedStep[];
  /** Confirmation steps that must complete before the matching index executes. */
  readonly requiresConfirmationFor: readonly number[];
}

export const ACTION_PLAN_SCHEMA: OutputSchema = {
  name: "lui.action_plan",
  properties: {
    steps: "record[]",
    requiresConfirmationFor: "number[]",
  },
};

/** 6. Research plan; model-PROPOSED, engine-executed (M3 §7). Capabilities, never providers. */
export interface ProposedResearchPlan {
  readonly objective: string;
  readonly scopeIncluded: readonly string[];
  readonly scopeExcluded: readonly string[];
  readonly tasks: readonly {
    readonly type: string;
    readonly objective: string;
    /** CAPABILITY names only; hardcoding provider/tool here is forbidden (final lock §6/§11). */
    readonly capabilities: readonly string[];
    readonly completion: string;
  }[];
  /**
   * INFORMATION REQUIREMENTS this question needs answered (requirement-coverage engine).
   * The planner states what must be KNOWN ("current policy/rates regime", "10-year yield
   * level", "oil-specific supply developments"), not which provider to call. Optional: when
   * absent the engine derives requirements from the tasks, so coverage is always assessed.
   */
  readonly requirements?: readonly {
    readonly description: string;
    readonly importance?: "CRITICAL" | "SUPPORTING";
    readonly timeSensitivity?: "CURRENT" | "RECENT" | "HISTORICAL" | "ANY";
  }[];
  readonly completionCriteria: readonly string[];
  readonly adaptationPolicy: string;
}

export const RESEARCH_PLAN_SCHEMA: OutputSchema = {
  name: "research.plan",
  properties: {
    objective: "string",
    scopeIncluded: "string[]",
    scopeExcluded: "string[]",
    tasks: "record[]",
    requirements: "record[]",
    completionCriteria: "string[]",
    adaptationPolicy: "string",
  },
};

/** 7. Adaptive decision; continue or complete the living loop (M3 §8). */
export interface AdaptiveDecision {
  readonly decision: "CONTINUE" | "COMPLETE" | "INSUFFICIENT_EVIDENCE";
  /** Information-value rationale (progressive-disclosure.md §56/§57 vocabulary). */
  readonly rationale: string;
  /** Next tasks ONLY when decision=CONTINUE; each names capabilities, never tools. */
  readonly nextTasks: readonly {
    readonly objective: string;
    readonly capabilities: readonly string[];
    readonly completion: string;
  }[];
}

export const ADAPTIVE_DECISION_SCHEMA: OutputSchema = {
  name: "research.adaptive_decision",
  properties: {
    decision: "string",
    rationale: "string",
    nextTasks: "record[]",
  },
};

/** 8. Analysis/synthesis over validated research context (M3 §10). */
export interface ModelAnalysis {
  readonly findings: readonly string[];
  readonly conclusion: string;
  /** What the evidence shows to support the conclusion (observable reasons only). */
  readonly supportingReasons: readonly string[];
  /** Strongest opposition/contradiction; required to be present when context has any. */
  readonly opposingReasons: readonly string[];
  readonly uncertainty: readonly string[];
  /** What would change the conclusion; derived from research, not invented (§35). */
  readonly whatWouldChange: readonly string[];
  /** Evidence/object ids the reasons rest on; validated against the workspace (no fake citations). */
  readonly citedObjectRefs: readonly string[];
}

export const ANALYSIS_SCHEMA: OutputSchema = {
  name: "analysis.model_analysis",
  properties: {
    findings: "string[]",
    conclusion: "string",
    supportingReasons: "string[]",
    opposingReasons: "string[]",
    uncertainty: "string[]",
    whatWouldChange: "string[]",
    citedObjectRefs: "string[]",
  },
};

/** 9. CHALLENGE result; falsification-oriented, not generic criticism (M3 §16). */
export interface ChallengeResult {
  readonly targetedStatement: string;
  readonly vulnerableAssumptions: readonly string[];
  readonly searchedContradictions: readonly string[];
  readonly historicalCounterexamples: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly falsificationVerdict: "WEAKENED" | "STOOD" | "INCONCLUSIVE";
  readonly rationale: string;
  readonly citedObjectRefs: readonly string[];
}

export const CHALLENGE_SCHEMA: OutputSchema = {
  name: "analysis.challenge",
  properties: {
    targetedStatement: "string",
    vulnerableAssumptions: "string[]",
    searchedContradictions: "string[]",
    historicalCounterexamples: "string[]",
    missingEvidence: "string[]",
    falsificationVerdict: "string",
    rationale: "string",
    citedObjectRefs: "string[]",
  },
};

/** 10. Thesis assessment; evidence vs the trader's thesis; never a rewrite (M3 §15). */
export interface ThesisAssessment {
  readonly thesisStatusAssessment: "SUPPORTED" | "MIXED" | "CONTESTED" | "INSUFFICIENT_EVIDENCE";
  readonly supportingEvidenceRefs: readonly string[];
  readonly contradictingEvidenceRefs: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly earlyWarningConditions: readonly string[];
  readonly rationale: string;
  readonly citedObjectRefs: readonly string[];
}

export const THESIS_ASSESSMENT_SCHEMA: OutputSchema = {
  name: "thesis.assessment",
  properties: {
    thesisStatusAssessment: "string",
    supportingEvidenceRefs: "string[]",
    contradictingEvidenceRefs: "string[]",
    invalidationConditions: "string[]",
    earlyWarningConditions: "string[]",
    rationale: "string",
    citedObjectRefs: "string[]",
  },
};

/** 11. Monitoring contract; conditions identified only; activation is confirmed (M3 §18). */
export interface MonitorProposal {
  readonly conditions: readonly string[];
  readonly invalidationConditions: readonly string[];
  readonly earlyWarningConditions: readonly string[];
  readonly suggestedCadence: string;
  readonly scopeNote: string;
  /** Always requires trader confirmation before any activation (final lock §13). */
  readonly requiresConfirmation: true;
}

export const MONITOR_SCHEMA: OutputSchema = {
  name: "monitor.proposal",
  properties: {
    conditions: "string[]",
    invalidationConditions: "string[]",
    earlyWarningConditions: "string[]",
    suggestedCadence: "string",
    scopeNote: "string",
  },
};

/** 12. SAVE content; what the trader asked to persist (M3 §17). Confirmation required. */
export interface SaveProposal {
  readonly artifactType: string;
  readonly content: string;
  /** Workspace object refs the artifact derives from (provenance; lui-save-action.md). */
  readonly derivedFromRefs: readonly string[];
  readonly rationale: string;
}

export const SAVE_SCHEMA: OutputSchema = {
  name: "state.save_proposal",
  properties: {
    artifactType: "string",
    content: "string",
    derivedFromRefs: "string[]",
    rationale: "string",
  },
};

/** 13. MANAGE_STATE change; working-state mutation proposal (M3 §17). */
export interface StateChangeProposal {
  readonly changeType: string;
  readonly description: string;
  readonly params: Readonly<Record<string, string>>;
  readonly rationale: string;
}

export const STATE_CHANGE_SCHEMA: OutputSchema = {
  name: "state.change_proposal",
  properties: {
    changeType: "string",
    description: "string",
    params: "record",
    rationale: "string",
  },
};

/** 14. Safety screen; runs on every plan before dispatch (M3 §14). */
export interface SafetyScreen {
  readonly isExecutionCommand: boolean;
  readonly detectedViolations: readonly string[];
  readonly rationale: string;
}

export const SAFETY_SCHEMA: OutputSchema = {
  name: "safety.screen",
  properties: {
    isExecutionCommand: "boolean",
    detectedViolations: "string[]",
    rationale: "string",
  },
};

/** 15. Final response; concise default per progressive-disclosure.md §5 (M3 §11). */
export interface FinalResponse {
  readonly answer: string;
  readonly supportingReasons: readonly string[]; // 2–4 strongest
  readonly opposingReasons: readonly string[]; // meaningful opposition where present
  readonly confidence: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  readonly keyUncertainty: string;
  readonly implication: string;
  /** Object refs backing statements; validated against the workspace before display. */
  readonly citedObjectRefs: readonly string[];
}

export const FINAL_RESPONSE_SCHEMA: OutputSchema = {
  name: "response.final",
  properties: {
    answer: "string",
    supportingReasons: "string[]",
    opposingReasons: "string[]",
    confidence: "string",
    keyUncertainty: "string",
    implication: "string",
    citedObjectRefs: "string[]",
  },
};

// ---------------------------------------------------------------------------
// Enum-level validators on top of the structural ones
// ---------------------------------------------------------------------------

export class ActionClassificationError extends Error {
  constructor(value: string) {
    super(`model proposed unknown LUI action "${value}"; must be one of ${LUI_ACTIONS.join(", ")}`);
    this.name = "ActionClassificationError";
  }
}

export function parseLuiAction(value: string): LuiAction {
  const action = LUI_ACTIONS.find((a) => a === value);
  if (action === undefined) throw new ActionClassificationError(value);
  return action;
}

export function parseResearchFlow(value: string): ResearchFlow {
  const flow = RESEARCH_FLOWS.find((f) => f === value);
  if (flow === undefined) {
    throw new Error(`model proposed unknown research flow "${value}"; must be one of ${RESEARCH_FLOWS.join(", ")}`);
  }
  return flow;
}

// ---------------------------------------------------------------------------
// Typed parse helpers; validate + shape-check compound structures
// ---------------------------------------------------------------------------

/** Validate and shape-check `NormalizedRequest` (including the compoundActions array). */
export function parseNormalizedRequest(text: string): NormalizedRequest {
  const { data } = validateModelOutput<NormalizedRequest & Record<string, unknown>>(NORMALIZED_REQUEST_SCHEMA, text);
  const primaryAction = parseLuiAction(String(data.primaryAction));
  const raw = data.compoundActions ?? []; // omitted/null for simple requests → empty compound list
  if (typeof raw !== "object" || raw === null || !Array.isArray(raw)) {
    throw new Error("normalized request: compoundActions must be an array");
  }
  const compoundActions = raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("compoundActions entry must be an object");
    const e = entry as Record<string, unknown>;
    if (typeof e.action !== "string" || typeof e.purpose !== "string") {
      throw new Error("compoundActions entry requires action:string, purpose:string");
    }
    return { action: parseLuiAction(e.action), purpose: e.purpose };
  });
  const disclosureLevel = Number(data.disclosureLevel);
  if (!Number.isInteger(disclosureLevel) || disclosureLevel < 0 || disclosureLevel > 5) {
    throw new Error("normalized request: disclosureLevel must be an integer 0–5");
  }
  return {
    primaryAction,
    compoundActions,
    objective: String(data.objective),
    isExplanationOnly: Boolean(data.isExplanationOnly),
    disclosureLevel,
  };
}

/** Validate + shape-check the ActionPlan (steps array with per-step records). */
export function parseActionPlan(text: string): ActionPlan {
  const { data } = validateModelOutput<ActionPlan & Record<string, unknown>>(ACTION_PLAN_SCHEMA, text);
  const rawSteps = data.steps;
  if (typeof rawSteps !== "object" || rawSteps === null || !Array.isArray(rawSteps)) {
    throw new Error("action plan: steps must be an array");
  }
  if (rawSteps.length === 0) throw new Error("action plan: at least one step is required");
  const steps = rawSteps.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("plan step must be an object");
    const s = entry as Record<string, unknown>;
    if (typeof s.action !== "string" || typeof s.description !== "string") {
      throw new Error("plan step requires action:string, description:string");
    }
    const params: Record<string, string> = {};
    if (s.params !== undefined) {
      if (typeof s.params !== "object" || s.params === null || Array.isArray(s.params)) {
        throw new Error("plan step params must be a record of strings");
      }
      for (const [k, v] of Object.entries(s.params as Record<string, unknown>)) {
        if (typeof v !== "string") throw new Error(`plan step param "${k}" must be a string`);
        params[k] = v;
      }
    }
    const capabilities = Array.isArray(s.capabilities)
      ? normalizePlanCapabilities(s.capabilities).capabilities
      : [];
    return { action: parseLuiAction(s.action), description: s.description, capabilities, params };
  });
  const confirm = Array.isArray(data.requiresConfirmationFor) ? data.requiresConfirmationFor : [];
  for (const idx of confirm) {
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= steps.length) {
      throw new Error(`requiresConfirmationFor index ${String(idx)} out of range`);
    }
  }
  return { steps, requiresConfirmationFor: confirm };
}

/** Validate + shape-check the ProposedResearchPlan (tasks array). */
export function parseResearchPlan(text: string): ProposedResearchPlan {
  const { data } = validateModelOutput<ProposedResearchPlan & Record<string, unknown>>(RESEARCH_PLAN_SCHEMA, text);
  const rawTasks = data.tasks;
  if (typeof rawTasks !== "object" || rawTasks === null || !Array.isArray(rawTasks)) {
    throw new Error("research plan: tasks must be an array");
  }
  const tasks = rawTasks.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("plan task must be an object");
    const t = entry as Record<string, unknown>;
    for (const key of ["type", "objective", "completion"] as const) {
      if (typeof t[key] !== "string") throw new Error(`plan task requires ${key}:string`);
    }
    if (!Array.isArray(t.capabilities) || t.capabilities.some((c) => typeof c !== "string")) {
      throw new Error("plan task capabilities must be string[]");
    }
    return {
      type: String(t.type),
      objective: String(t.objective),
      capabilities: normalizePlanCapabilities(t.capabilities).capabilities,
      completion: String(t.completion),
    };
  });
  // Requirement seeds are OPTIONAL and validated leniently: a malformed entry is dropped
  // (the engine falls back to task-derived requirements) rather than failing the whole plan.
  const rawRequirements = Array.isArray(data.requirements) ? data.requirements : [];
  const requirements = rawRequirements
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) return undefined;
      const r = entry as Record<string, unknown>;
      if (typeof r.description !== "string" || r.description.trim() === "") return undefined;
      const importance = r.importance === "SUPPORTING" ? ("SUPPORTING" as const) : ("CRITICAL" as const);
      const ts = r.timeSensitivity;
      const timeSensitivity: "CURRENT" | "RECENT" | "HISTORICAL" | "ANY" | undefined =
        ts === "CURRENT" || ts === "RECENT" || ts === "HISTORICAL" || ts === "ANY" ? ts : undefined;
      return {
        description: r.description.trim(),
        importance,
        ...(timeSensitivity !== undefined ? { timeSensitivity } : {}),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  return {
    objective: String(data.objective),
    scopeIncluded: (data.scopeIncluded as unknown[]).map(String),
    scopeExcluded: (data.scopeExcluded as unknown[]).map(String),
    tasks,
    ...(requirements.length > 0 ? { requirements } : {}),
    completionCriteria: (data.completionCriteria as unknown[]).map(String),
    adaptationPolicy: String(data.adaptationPolicy),
  };
}

/** Validate + shape-check the AdaptiveDecision (nextTasks array, enum decision). */
export function parseAdaptiveDecision(text: string): AdaptiveDecision {
  const { data } = validateModelOutput<AdaptiveDecision & Record<string, unknown>>(ADAPTIVE_DECISION_SCHEMA, text);
  const decision = data.decision;
  if (decision !== "CONTINUE" && decision !== "COMPLETE" && decision !== "INSUFFICIENT_EVIDENCE") {
    throw new Error(`adaptive decision "${String(decision)}" must be CONTINUE | COMPLETE | INSUFFICIENT_EVIDENCE`);
  }
  const rawTasks = data.nextTasks;
  if (typeof rawTasks !== "object" || rawTasks === null || !Array.isArray(rawTasks)) {
    throw new Error("adaptive decision: nextTasks must be an array");
  }
  const nextTasks = rawTasks.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("nextTask must be an object");
    const t = entry as Record<string, unknown>;
    if (typeof t.objective !== "string" || typeof t.completion !== "string" || !Array.isArray(t.capabilities)) {
      throw new Error("nextTask requires objective:string, capabilities:string[], completion:string");
    }
    return {
      objective: t.objective,
      capabilities: normalizePlanCapabilities(t.capabilities).capabilities,
      completion: t.completion,
    };
  });
  if (decision === "CONTINUE" && nextTasks.length === 0) {
    throw new Error("adaptive decision CONTINUE requires at least one nextTask");
  }
  return { decision, rationale: String(data.rationale), nextTasks };
}
