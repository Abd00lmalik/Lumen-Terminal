/**
 * LUI; the natural-language research control loop (M3).
 *
 * Architectural basis:
 * - lui-universal-core.md + the human-approved 6-action lock: RESEARCH, ANALYZE, CHALLENGE,
 *   MANAGE_STATE, MONITOR, SAVE. SAVE is first-class. Natural language is the control surface
 *   no phrase-matching: the MODEL interprets, the LUI validates (M3 §4/§5).
 * - Pipeline (M3 §5): USER MESSAGE → INPUT NORMALIZATION → INTENT DETECTION → CONTEXT
 *   RESOLUTION → ENTITY/TARGET RESOLUTION → ACTION CLASSIFICATION → PARAMETER EXTRACTION →
 *   AMBIGUITY CHECK → CONSEQUENCE CHECK → ACTION PLAN → ARCHITECTURE DISPATCH → EXECUTION →
 *   STATE UPDATE → PROVENANCE/TIMELINE → USER RESPONSE.
 * - M3 §6: every model output is schema-validated before dispatch; invalid output is a model
 *   failure, never an execution command.
 * - M3 §13/§14/§17/§18: ambiguity → clarify (never invent); MANAGE_STATE vs SAVE distinction;
 *   SAVE/MONITOR/thesis-change are consequential → explicit trader confirmation; execution-like
 *   model outputs are rejected (trader decision boundary, final lock §13).
 * - M3 §24: the LLM is the interface/intelligence layer, not the authority. The LUI validates;
 *   the engine executes; the workspace owns state.
 */

import type { ModelProvider, StructuredRequest, StructuredResponse } from "../model/provider.js";
import { traderWords } from "../model/request-budget.js";
import { ModelFailure } from "../model/provider.js";
import {
  LUI_ACTIONS, RESOLVED_TARGET_SCHEMA, AMBIGUITY_SCHEMA, CONSEQUENCE_SCHEMA,
  SAFETY_SCHEMA, ANALYSIS_SCHEMA, CHALLENGE_SCHEMA, THESIS_ASSESSMENT_SCHEMA,
  MONITOR_SCHEMA, SAVE_SCHEMA, STATE_CHANGE_SCHEMA, FINAL_RESPONSE_SCHEMA,
  parseNormalizedRequest, parseActionPlan,
  type NormalizedRequest, type ResolvedTarget, type AmbiguityAssessment,
  type ConsequenceAssessment, type ActionPlan,
  type ModelAnalysis, type ChallengeResult, type ThesisAssessment, type MonitorProposal,
  type SaveProposal, type StateChangeProposal, type FinalResponse,
} from "../model/schemas.js";
import { validateModelOutput } from "../model/provider.js";
import type { Workspace } from "../domain/workspace.js";
import type { SavedArtifact, Thesis } from "../domain/thesis.js";
import { isSavedKind, legacyKindFromType, type SavedKind } from "../domain/thesis.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import { resolveInstrument, questionNamesAsset } from "../domain/instruments.js";
import type { WorkspaceStore } from "../persistence/index.js";
import { runAdaptiveResearch, memberDeadline, type AdaptiveLoopOutcome, MAX_RESEARCH_ROUNDS } from "../research/adaptive.js";
import { progressEvent, type ProgressListener } from "../research/progress.js";
import { buildResearchContext, renderResearchContext, type ResearchContext } from "../research/context.js";
import { guardFlow, type FlowGuardResult } from "./flow-guard.js";
import { statedThesisText } from "./conversation-routing.js";
import { capabilityConstraintOf } from "./capability-constraints.js";
import {
  executionConstraintsOf,
  isObservationMode,
  RAW_OBSERVATION_FLOW,
  UNCONSTRAINED_RESEARCH,
  type ExecutionConstraints,
} from "../research/execution-mode.js";
import { contractFor } from "../research/flow-contract.js";
import { renderObservationResponse, isDirectObservation } from "../research/observation-response.js";
import {
  buildInvestigationContext,
  renderInvestigationContext,
  type InvestigationContext,
} from "../research/investigation-context.js";
import { deriveInvestigationState } from "../research/investigation-state.js";
import type { ConversationIntent, InvestigationState } from "../domain/investigation.js";
import { currentRun } from "../domain/run-context.js";
import { inheritedEvidenceScopeOf, synthesizeEvidenceOnlyFollowUp, type InheritedEvidenceScope } from "../research/follow-up-policy.js";
import { computeConfidence } from "../research/confidence.js";
import { evaluateQuestionResolution } from "../research/question-resolution.js";
import type { ResearchRequirement } from "../research/requirements.js";

/**
 * Canonical flows whose methodology is thesis-facing: the trader's own thesis is legitimate
 * context for them and only for them.
 */
const THESIS_CONTEXT_FLOWS = new Set(["DOES_MY_THESIS_HOLD", "EVALUATE_WITH_MY_FRAMEWORK"]);
/** Message-level phrasing that names the trader's own material explicitly. */
const THESIS_CONTEXT_PHRASE =
  /\b(my|our)\s+(thesis|view|position|setup|case|framework)\b|\baccording to (my|this|the following) framework\b|\bchallenge my\b/i;
/**
 * The flow recorded for a research request that resolved to NONE of the eight canonical
 * methodologies. It is deliberately not one of them: an unidentified methodology must not be
 * stored under a canonical flow's identity.
 */
const INDEPENDENT_RESEARCH_FLOW = "INDEPENDENT_RESEARCH";

export { MAX_RESEARCH_ROUNDS };

/**
 * CUMULATIVE SYNTHESIS RESPONSE (Phase 10) — the "what have we established?" answer.
 *
 * Built entirely from the DERIVED investigation state: real evidence, real judgments, the real
 * competing explanations the engine recorded, the real unresolved requirements, and the trader's
 * OWN thesis. Nothing here is generated prose about the research; it is a readout of artifacts.
 *
 * It ends with what is worth watching, never with a recommendation. "This suggests you should
 * trim exposure" is not this system's output — the trader makes the decision.
 */
export function cumulativeSynthesisResponse(
  state: InvestigationState,
): FinalResponse {
  const section = (title: string, items: readonly string[]): string[] =>
    items.length === 0 ? [] : [`${title}:`, ...items.map((i) => `- ${i}`)];

  const lines: string[] = [
    `Across ${state.runCount} research run${state.runCount === 1 ? "" : "s"} on ${state.subject}, here is what this investigation established.`,
  ];
  lines.push(...section(
    "Established",
    state.establishedFacts.slice(0, 5).map((f) => f.statement),
  ));
  lines.push(...section(
    "What the runs concluded",
    state.findings.slice(0, 4).map((f) => `${f.statement} (confidence ${f.confidence.toLowerCase()})`),
  ));
  lines.push(...section(
    "Evidence pointing the other way",
    state.competingExplanations.slice(0, 3).map((c) => c.statement),
  ));
  lines.push(...section(
    "Historical context",
    state.historicalComparisons.slice(0, 2).map((h) => h.statement),
  ));
  if (state.thesis !== undefined) {
    lines.push(`Your stated thesis: ${state.thesis.statement}`);
  }
  lines.push(...section("Still unresolved", state.unresolvedQuestions.slice(0, 5)));

  // Watch items are the unresolved questions and open challenges — the things that would change
  // the picture. They are NOT a position recommendation, and are phrased as such.
  const watch = [...state.unresolvedQuestions, ...state.challenges.map((c) => `challenge under test: ${c.statement}`)];
  lines.push(...section(
    "What would be worth watching",
    watch.length === 0 ? [] : watch.slice(0, 5),
  ));
  lines.push(
    "This is research context, not a recommendation. The decision is yours.",
  );

  const cited = [
    ...state.establishedFacts.flatMap((f) => [...f.evidenceRefs]),
    ...state.findings.map((f) => f.judgmentRef),
  ];
  return {
    answer: lines.join("\n"),
    supportingReasons: state.establishedFacts.slice(0, 4).map((f) => f.statement),
    opposingReasons: state.competingExplanations.slice(0, 3).map((c) => c.statement),
    // Confidence about an ACCUMULATED investigation is bounded by its weakest recorded finding,
    // never asserted: a single LOW finding does not vanish because later runs were firmer.
    confidence: state.findings.some((f) => f.confidence === "LOW")
      ? "LOW"
      : state.findings.length > 0
        ? "MODERATE"
        : "UNKNOWN",
    keyUncertainty: state.unresolvedQuestions[0] ?? "",
    implication: "",
    citedObjectRefs: [...new Set(cited)],
  };
}

// ---------------------------------------------------------------------------
// Schema descriptions for the remaining prompt contracts
// ---------------------------------------------------------------------------

const NORMALIZED_REQUEST_SCHEMA_DESC = [
  '{"primaryAction": "RESEARCH"|"ANALYZE"|"CHALLENGE"|"MANAGE_STATE"|"MONITOR"|"SAVE",',
  ' "compoundActions": [{"action": same enum, "purpose": string}],',
  ' "objective": string,  // the user\'s research objective in their own words',
  ' "isExplanationOnly": boolean, "disclosureLevel": 0|1|2|3|4|5}',
].join("\n");

const ACTION_PLAN_SCHEMA_DESC_LOCAL = [
  '{"steps": [{"action": "RESEARCH"|"ANALYZE"|"CHALLENGE"|"MANAGE_STATE"|"MONITOR"|"SAVE",',
  '   "description": string, "capabilities": string[], "params": Record<string,string>}],',
  ' "requiresConfirmationFor": number[]  // step indexes needing trader confirmation',
].join("\n");

const RESOLVED_TARGET_SCHEMA_DESC = [
  '{"asset": string?, "flow": string?, "researchRef": string?, "objectRefs": string[],',
  ' "unresolved": string[]  // what could NOT be resolved from the context; never invent ids',
].join("\n");

const AMBIGUITY_SCHEMA_DESC = [
  '{"isAmbiguous": boolean, "questions": string[], "reason": string}',
].join("\n");

const CONSEQUENCE_SCHEMA_DESC = [
  '{"level": "INFORMATIONAL"|"STATE_MUTATION"|"CONSEQUENTIAL", "rationale": string,',
  ' "requiresConfirmation": boolean}',
].join("\n");

const SAFETY_SCHEMA_DESC = [
  '{"isExecutionCommand": boolean, "detectedViolations": string[], "rationale": string}',
].join("\n");

const ANALYSIS_SCHEMA_DESC = [
  '{"findings": string[], "conclusion": string, "supportingReasons": string[],',
  ' "opposingReasons": string[], "uncertainty": string[], "whatWouldChange": string[],',
  ' "citedObjectRefs": string[]  // ids from the provided context only',
].join("\n");

const CHALLENGE_SCHEMA_DESC = [
  '{"targetedStatement": string, "vulnerableAssumptions": string[], "searchedContradictions": string[],',
  ' "historicalCounterexamples": string[], "missingEvidence": string[],',
  ' "falsificationVerdict": "WEAKENED"|"STOOD"|"INCONCLUSIVE", "rationale": string,',
  ' "citedObjectRefs": string[]}',
].join("\n");

const THESIS_ASSESSMENT_SCHEMA_DESC = [
  '{"thesisStatusAssessment": "SUPPORTED"|"MIXED"|"CONTESTED"|"INSUFFICIENT_EVIDENCE",',
  ' "supportingEvidenceRefs": string[], "contradictingEvidenceRefs": string[],',
  ' "invalidationConditions": string[], "earlyWarningConditions": string[], "rationale": string,',
  ' "citedObjectRefs": string[]}',
].join("\n");

const MONITOR_SCHEMA_DESC = [
  '{"conditions": string[], "invalidationConditions": string[], "earlyWarningConditions": string[],',
  ' "suggestedCadence": string, "scopeNote": string}  // proposal only; activation requires confirmation',
].join("\n");

const SAVE_SCHEMA_DESC = [
  '{"artifactType": string, "content": string, "derivedFromRefs": string[], "rationale": string,',
  ' "kind": "RESEARCH"|"JUDGMENT"|"EVIDENCE"|"INSIGHT"|"WATCH_NEXT", "sourceRef": string}',
].join("\n");

const STATE_CHANGE_SCHEMA_DESC = [
  '{"changeType": string, "description": string, "params": Record<string,string>, "rationale": string,',
  ' "thesisAction": "CREATE"|absent, "params.statement": string}',
].join("\n");

const FINAL_RESPONSE_SCHEMA_DESC = [
  '{"answer": string, "supportingReasons": string[], "opposingReasons": string[],',
  ' "confidence": "HIGH"|"MODERATE"|"LOW"|"UNKNOWN", "keyUncertainty": string,',
  ' "implication": string, "citedObjectRefs": string[]}',
].join("\n");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LuiOptions {
  readonly provider: ModelProvider;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  /** Wired through to the adaptive loop's capability execution. */
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly now?: () => Date;
  /** Optional hook invoked (with the step) before a confirmation-gated step executes. */
  readonly onConfirmationRequired?: (stepIndex: number, stepDescription: string) => void;
  /** F0 SSE seam: optional listener for REAL pipeline-stage events (never model reasoning). */
  readonly onProgress?: ProgressListener;
}

export type ConfirmationState =
  | { readonly status: "NOT_REQUIRED" }
  | { readonly status: "REQUIRED"; readonly stepIndex: number; readonly reason: string };

export interface LuiResult {
  /** The validated interpretation of the user's message. */
  request: NormalizedRequest;
  target: ResolvedTarget;
  ambiguity: AmbiguityAssessment;
  consequence: ConsequenceAssessment;
  plan: ActionPlan;
  /** Present when the run was halted pending trader confirmation (SAVE/MONITOR/state-change). */
  awaitingConfirmation?: ConfirmationState;
  /** Whether a safety violation rejected the request before dispatch. */
  rejected?: { readonly reason: string; readonly violations: readonly string[] };
  /** Adaptive loop outcome when RESEARCH ran. */
  research?: AdaptiveLoopOutcome;
  /** Analysis/synthesis result when ANALYZE ran. */
  analysis?: ModelAnalysis;
  /** CHALLENGE result when CHALLENGE ran. */
  challenge?: ChallengeResult;
  /** Thesis assessment when thesis evaluation ran. */
  thesisAssessment?: ThesisAssessment;
  /** Monitor PROPOSAL (never an active monitor; activation is M5 + confirmation). */
  monitorProposal?: MonitorProposal;
  /** M5: the persistent monitor object created from the proposal (PROPOSED status, inert). */
  monitor?: import("../domain/memory.js").Monitor;
  /** M5: an ACTIVATED monitor (trader-confirmed only; PROPOSED→ACTIVE transition recorded). */
  activatedMonitor?: import("../domain/memory.js").Monitor;
  /** M5: memory entry created by a confirmed SAVE (persistent research memory). */
  memory?: import("../domain/memory.js").MemoryEntry;
  /** Present when a SAVE was actually persisted (post-confirmation). */
  saved?: SavedArtifact;
  /** Present when a MANAGE_STATE change was applied to working state. */
  stateChange?: StateChangeProposal;
  /** Present when a confirmed thesis action created a trader-owned thesis (Phase D). */
  thesis?: Thesis;
  /** M4: Flow 2 causal investigation result (when the research objective was causal). */
  flow2?: import("../research/flow2.js").Flow2Result;
  /** M4: Flow 6 cross-domain synthesis result. */
  flow6?: import("../research/flow6.js").Flow6Result;
  /** M4: Flow 7 falsification result (CHALLENGE action → methodology). */
  flow7?: import("../research/flow7.js").Flow7Result;
  /** M4b: Flow 3 factor-landscape result. */
  flow3?: import("../research/flow3.js").Flow3Result;
  /** M4b: Flow 4 thesis-evaluation result. */
  flow4?: import("../research/flow4.js").Flow4Result;
  /** M4b: Flow 8 framework-evaluation result. */
  flow8?: import("../research/flow8.js").Flow8Result;
  /** Flow 5 historical-comparison result (HONEST unavailability until G1 connects). */
  flow5?: import("../research/flow5.js").Flow5Result;
  /** The final user-facing response (progressive disclosure; no chain-of-thought). */
  response: FinalResponse | undefined;
  /** Typed model failure; never fabricated into a FinalResponse. */
  modelFailure?: ModelFailure;
}

// ---------------------------------------------------------------------------
// The LUI
// ---------------------------------------------------------------------------

/**
 * What each challenge verdict MEANS, in the trader's words. The engine's vocabulary
 * (FALSIFICATION, the capability that runs it) is internal: an answer that says "falsification
 * verdict: INCONCLUSIVE" reads like a log line, not like a colleague's conclusion.
 */
const CHALLENGE_VERDICT_PLAIN: Record<string, string> = {
  WEAKENED: "what the research found weakens your view",
  STOOD: "nothing found so far contradicts your view",
  INCONCLUSIVE: "the evidence available does not settle it either way",
};

const INTERPRETER_SYSTEM = [
  "You are the natural-language interpreter of a trading RESEARCH workbench used by a professional trader.",
  "Classify the trader's request into exactly one of the six first-class actions:",
  "RESEARCH (new investigation), ANALYZE (interpret existing research), CHALLENGE (actively try to falsify the current thesis/hypothesis/explanation),",
  "MANAGE_STATE (change active working state: target/thesis/framework/working research state), MONITOR (establish watching of conditions; proposal only),",
  "SAVE (promote a validated finding/conclusion/framework/preference into persistent reusable memory).",
  "Rules:",
  "- Compound requests list their sub-actions IN ORDER in compoundActions (primary first).",
  "- RESEARCH is the default for any question about markets, assets, prices, events, news, macro, or risk ('why did BTC move', 'what is affecting X', 'what are the risks'). These ask about the WORLD, not about stored objects.",
  "- ANALYZE is ONLY when the trader explicitly references existing results in this workspace ('analyze what you found', 'what does our research say', 'interpret the last run'). A market question is never ANALYZE just because research history exists.",
  "- CHALLENGE utterances about the trader's OWN current view/thesis ('challenge my thesis', 'what could prove this thesis wrong', 'what evidence contradicts my current view', 'what assumptions am I relying on', 'has anything changed that weakens this thesis') are primaryAction CHALLENGE; do not reclassify them as RESEARCH or ANALYZE.",
  "- isExplanationOnly=true when the trader only asks why/how/what-did-you-find about existing research.",
  "- disclosureLevel: 0 answer, 1 why, 2 evidence, 3 research structure, 4 source trail, 5 full history.",
  "- Copy the trader's objective verbatim; never paraphrase it into something stronger or weaker.",
  "- FOLLOW-UP INSIDE AN ACTIVE INVESTIGATION (read the CONVERSATION CONTEXT below): a turn that narrows, focuses, adds or asks about one angle of what the investigation is already about ('Focus specifically on ETF flows', 'and liquidations?', 'go deeper on derivatives') is RESEARCH continuing that investigation. It is NOT MANAGE_STATE: the trader is asking to investigate an angle, not to change their working state.",
  "- MANAGE_STATE requires an explicit instruction about the trader's working state ('switch my active target to X', 'make X my active thesis', 'change the active framework'). The word 'focus' alone is never a state change.",
  "- A follow-up inherits the conversation's subject and period; never treat the missing asset or timeframe as something to ask about again.",
  "- For a follow-up, the objective restates the conversation's subject together with the angle the trader named, in the trader's own words ('Why did Bitcoin move down today, with focus on ETF flows'). Never drop the subject.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const TARGET_SYSTEM = [
  "Resolve the trader's request target from the conversation/workspace context provided.",
  "Rules:",
  "- Resolve 'it', 'that', 'my thesis' etc. from the CURRENT WORKSPACE STATE only.",
  "- NEVER invent research/object ids. Anything not resolvable goes into `unresolved`.",
  "- `flow` must be one of: WHAT_HAPPENED, WHY_IT_HAPPENED, WHAT_COULD_AFFECT_IT, DOES_MY_THESIS_HOLD, HAS_THIS_HAPPENED_BEFORE, WHAT_DOES_ALL_INFORMATION_SAY, WHAT_COULD_PROVE_ME_WRONG, EVALUATE_WITH_MY_FRAMEWORK.",
  "- Flow distinctions (get the METHODOLOGY right):",
  "  WHAT_HAPPENED = factual event reconstruction: what was observed, a timeline, chronology, verified events. No verdict, no causes.",
  "  WHY_IT_HAPPENED = causal explanation of a move/event the message names ('why did X rise/drop').",
  "  WHAT_COULD_AFFECT_IT = material-factor discovery: what could affect/impact/move an asset going forward. NOT a thesis evaluation.",
  "  DOES_MY_THESIS_HOLD = evaluating the trader's OWN stored thesis.",
  "  HAS_THIS_HAPPENED_BEFORE = historical precedent/parallel analysis.",
  "  WHAT_DOES_ALL_INFORMATION_SAY = aggregate ALL available information into one picture.",
  "  WHAT_COULD_PROVE_ME_WRONG = active falsification of the trader's thesis/belief.",
  "  EVALUATE_WITH_MY_FRAMEWORK = evaluation against a framework the trader supplied (criteria, weights, 'according to this framework').",
  "- Explicit negative constraints are binding: 'do not explain why' means the request is NOT causal even if a move is mentioned; 'do not perform a thesis or falsification assessment' forbids DOES_MY_THESIS_HOLD and WHAT_COULD_PROVE_ME_WRONG.",
  "- FOLLOW-UP INSIDE AN ACTIVE INVESTIGATION: the subject is the investigation's own subject unless the trader's words name another. 'Focus specifically on ETF flows' targets <investigation subject> ETF flows; keep the investigation's question shape (a causal question stays causal) unless the follow-up asks for a different one.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const AMBIGUITY_SYSTEM = [
  "Detect GENUINE ambiguity that blocks correct execution.",
  "Ambiguous: unclear asset, unclear timeframe for consequential actions, unclear which thesis/framework/state object when several exist, unclear requested persistence.",
  "NOT ambiguous: ordinary research where context resolves the target; do not ask unnecessary questions.",
  "NOT ambiguous when the CONVERSATION CONTEXT below already establishes the asset and the period: a follow-up that narrows scope ('Focus specifically on ETF flows') inherits both, so the answer is to investigate that angle, not to ask which asset or which period was meant.",
  "Only flag ambiguity when the trader's OWN words cannot be resolved against that context, and then only when the choice would change what gets investigated.",
  "Never invent missing context; if genuinely ambiguous, list the clarifying questions.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const CONSEQUENCE_SYSTEM = [
  "Classify the consequence level of the request:",
  "- INFORMATIONAL: research/analysis/explanation only; no state change.",
  "- STATE_MUTATION: changes active working state (target switch, working-state edits).",
  "- CONSEQUENTIAL: persistent or decision-impacting: SAVE (persistent memory), MONITOR activation, thesis revision, framework change; these REQUIRE explicit trader confirmation.",
  "MANAGE_STATE (working state) and SAVE (persistent memory) are different operations with different confirmation requirements.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const SAFETY_SYSTEM = [
  "Screen the interpreted request for trading-EXECUTION intent. The workbench is decision-support ONLY:",
  "- Execution commands (place/close/stop orders, buy/sell/short/long positions, move/withdraw/transfer funds, change leverage, set stop-loss orders) are FORBIDDEN; mark isExecutionCommand=true and list the violations.",
  "- Research/analysis about prices, positions, or risk is legitimate and must NOT be flagged.",
  "- 'buy the dip research' style ambiguity: if the sentence is a research question, do not flag it; flag only actionable execution commands.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const ANALYSIS_SYSTEM = [
  "You are the analyst of a trading RESEARCH workbench. Analyze the VALIDATED research context provided.",
  "Hard rules:",
  "- Preserve epistemic classes: interpretations/inferences/speculation are NOT observations; never upgrade them.",
  "- LIMITATIONS (tool failures, empty feeds, insufficient evidence) are NOT negative evidence; never cite them as reasons against a claim.",
  "- Only cite object refs that appear in the provided context. Never invent citations.",
  "- Include the strongest opposing evidence when present; opposition is not optional.",
  "- Distinguish what is directly observed from what is inferred; state what would change the conclusion.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const CHALLENGE_SYSTEM = [
  "You are the falsifier of a trading RESEARCH workbench. CHALLENGE means: actively search for what could prove the target statement WRONG.",
  "This is not generic criticism. Prioritize: contradictory evidence in the context, alternative explanations, the assumptions most vulnerable to failure, evidence that would invalidate the statement, missing evidence, historical counterexamples.",
  "- Only cite object refs present in the context. Missing evidence you identify must be phrased as what to LOOK FOR, not as if it was found.",
  "- Verdict: WEAKENED (context contains material contradiction), STOOD (contradiction searched, none found in context), INCONCLUSIVE (insufficient evidence either way).",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const THESIS_SYSTEM = [
  "You assess evidence AGAINST the trader's thesis. The thesis is the TRADER'S OWN position; you evaluate, you never rewrite it.",
  "- Classify thesis status as evidence sees it: SUPPORTED / MIXED / CONTESTED / INSUFFICIENT_EVIDENCE.",
  "- List invalidation conditions and early-warning conditions derived from the thesis's own claims/assumptions and the evidence.",
  "- Only cite object refs present in the context. A thesis assessment NEVER mutates the thesis.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const MONITOR_SYSTEM = [
  "Propose monitoring conditions for the trader's consideration. You are PROPOSING ONLY.",
  "- Derive conditions from the thesis's invalidation conditions and the current research (never invent thresholds absent from the research).",
  "- 'What should I monitor...' and 'what changed in my monitored thesis' are QUESTIONS/proposals, never activation; 'Monitor this thesis' produces an ACTIVATION PROPOSAL requiring explicit confirmation; 'Pause this monitor' / 'Resume monitoring' are explicit lifecycle actions; 'Check my monitor now' is a manual check.",
  "- Never claim a monitor was activated: activation always requires the trader's explicit confirmation.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const SAVE_SYSTEM = [
  "Prepare a SAVE proposal: promote the trader-validated content into persistent reusable memory.",
  "- artifactType: one of finding | research-conclusion | framework | preference | other.",
  "- kind: the saved-artifact class: RESEARCH (the run's result), JUDGMENT (the conclusion), EVIDENCE (a specific observation), INSIGHT (the actionable insight), WATCH_NEXT (a watch item).",
  "- sourceRef: the exact object ref being saved (a jd_/ev_ ref); empty when saving the run itself.",
  "- content: the exact content to persist (the trader's finding/conclusion, not your opinion).",
  "- derivedFromRefs: object refs from the provided context the artifact derives from; provenance, never invented.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const STATE_CHANGE_SYSTEM = [
  "Prepare a MANAGE_STATE change proposal for ACTIVE WORKING STATE (change active target, update working research state, select framework for the session).",
  "- This is distinct from SAVE: working-state changes are not persistent memory.",
  "- Describe precisely what changes; params carry the concrete values.",
  "- THESIS: when the trader asks to create/build/turn something into a THESIS (their own stated belief or position), set thesisAction=\"CREATE\" and put the trader's thesis STATEMENT verbatim in params.statement. Copy the trader's own words; never invent or strengthen the belief.",
  "- THESIS CHANGE IS THE TRADER'S DECISION: creating a thesis requires the trader's explicit confirmation. You PROPOSE it; you never adopt, confirm, weaken, invalidate or archive a thesis.",
  "- Selecting an existing thesis as active stays changeType=\"set-active-thesis\" with params.thesisRef; do not use thesisAction for that.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const RESPONSE_SYSTEM = [
  "Compose the final trader-facing response from the validated research outcome.",
  "Structure (progressive disclosure, default levels 0–1): answer first, 2–4 strongest reasons, strongest opposition where present, confidence, key uncertainty, decision-relevant implication.",
  "- The answer must state the SUBSTANCE of what the evidence shows about the question, including the key concrete observations (numbers, dates, names, levels) drawn from the research outcome. Never write process commentary such as 'sufficient observations have been gathered' or 'the objective can be fulfilled'; describe the findings themselves.",
  "- If the evidence genuinely does not answer the question, say exactly what is missing in one research-relevant sentence; do not describe the research process.",
  "- NEVER expose chain-of-thought. Reasons are observable evidence/object-based statements.",
  "- Only cite object refs that appear in the provided context/research outcome. No fabricated citations.",
  "- Confidence: HIGH only with direct multi-source observation; LOW when evidence is thin, partial, or single-source; UNKNOWN when no usable evidence.",
  "- Do not convert tool failures or empty results into negative findings.",
  "- The system researches; it does not tell the trader to trade. Implications are decision-support, not orders.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

// ---------------------------------------------------------------------------
// Phase G: thesis-facing challenge routing (deterministic target resolution)
// ---------------------------------------------------------------------------

/**
 * Does the utterance reference the trader's OWN thesis/current view (vs a quoted statement
 * or a hypothesis object)? Deterministic keyword law: the model still classifies the ACTION;
 * this only decides whether the CHALLENGE target is the workspace's thesis. Kept narrow so
 * quoted statements and hypothesis objects still take the generic falsifier path.
 */
export function referencesTradersThesis(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("my thesis") ||
    m.includes("this thesis") ||
    m.includes("the thesis") ||
    m.includes("my current view") ||
    m.includes("my current investment view") ||
    m.includes("current view") ||
    m.includes("what assumptions am i relying on") ||
    m.includes("what assumptions am i making") ||
    (m.includes("prove this wrong") && !m.includes("statement")) ||
    (m.includes("prove it wrong") && !m.includes("statement"))
  );
}

export type ChallengeThesisResolution =
  | { readonly type: "resolved"; readonly thesisId: string }
  | { readonly type: "clarify"; readonly reason: string };

/**
 * Resolve WHICH thesis to challenge from authenticated workspace state, deterministically:
 * the trader's explicit selection first, else the single active thesis, else clarify. Never
 * invents a target; >1 unselected candidates is genuinely ambiguous (M3 §13).
 */
export function resolveChallengeThesis(workspace: Workspace): ChallengeThesisResolution {
  const explicitId = workspace.explicitActiveThesisId();
  if (explicitId !== undefined) return { type: "resolved", thesisId: explicitId };
  const active = workspace.activeTheses();
  if (active.length === 1) return { type: "resolved", thesisId: active[0]!.id };
  if (active.length === 0) {
    return { type: "clarify", reason: "this workspace has no active thesis to challenge. Create or select one in the thesis workspace, or name the statement to falsify." };
  }
  return { type: "clarify", reason: `this workspace has ${active.length} active theses and none is selected as current. Which one should I challenge?` };
}

export class Lui {
  private currentMessage: string | undefined;
  /**
   * THE ONLY MODEL SEAM THE LUI USES. Every interpretation, plan, analysis and response call
   * goes through here so one law holds for all of them: the trader's own words are PROTECTED
   * from request-budget compaction. A request that lost the question is not a smaller request,
   * it is a different question — so the budget layer may only ever remove CONTEXT, and this is
   * what makes that structural rather than a convention each call site has to remember.
   */
  private ask<T>(request: StructuredRequest): Promise<StructuredResponse<T>> {
    const question = this.currentMessage ?? "";
    return this.options.provider.structured<T>({
      ...request,
      protectedFragments: [
        ...(request.protectedFragments ?? []),
        ...(question === "" ? [] : traderWords(question)),
      ],
    });
  }
  /** The deterministic flow guard's verdict for the CURRENT message (reset every handle()). */
  private flowGuard: FlowGuardResult | undefined;
  /**
   * THESIS-CONTEXT GATE (contamination defense): true only when the trader's thesis belongs
   * in this request's research context — the thesis/framework canonical flows, or a message
   * that explicitly names the thesis. Reset every handle(); an active thesis is never global
   * context for an unrelated question.
   */
  private thesisContextRequired = false;
  /** The explicit capability constraint for this message ("use CRYPTO_MARKET_DATA only"). */
  private capabilityConstraint: { readonly allowed?: readonly string[]; readonly forbidden: readonly string[] } = { forbidden: [] };
  /**
   * EXECUTION CONTRACT for this message (execution-mode.ts): the trader's prohibitions on the
   * analytical PIPELINE ("do not create a judgment", "do not perform synthesis, falsification
   * or counterevidence analysis", "return only the raw observation").
   *
   * Decided from the trader's own words BEFORE any model call, so it is an input to the pipeline
   * rather than a consequence of it — exactly like the capability constraint beside it, and for
   * exactly the same reason: a prohibition the engine reads at the layer that would violate it is
   * a control, and a prohibition that only reaches the model as prompt text is a suggestion.
   */
  private executionConstraints: ExecutionConstraints = UNCONSTRAINED_RESEARCH;
  /**
   * INVESTIGATION CONTEXT for this message (Phase 3): the relevant prior turns, findings, open
   * questions and labelled historical references of the investigation this turn belongs to.
   *
   * This is CONTEXT, never evidence: the run below it still retrieves its own evidence and owns
   * it. The rendered boundary notice travels with it into the prompt, so the model reads the same
   * distinction the engine enforces.
   */
  private investigationContext: InvestigationContext | undefined;
  /** The conversation-level intent decided for THIS message (routing law). */
  private conversationIntent: ConversationIntent | undefined;
  /**
   * The investigation this turn belongs to, captured while the run was active.
   *
   * Captured rather than re-read from run-context at response time: the application ends the run
   * before the response is assembled, so a lookup there would find nothing and the cumulative
   * synthesis would silently degrade to an ordinary answer.
   */
  private investigationIdForTurn: string | undefined;
  /** The accumulated investigation state, derived from real artifacts when a thread exists. */
  private investigationState(): InvestigationState | undefined {
    if (this.investigationIdForTurn === undefined) return undefined;
    const investigation = this.options.workspace.getInvestigation(this.investigationIdForTurn);
    if (investigation === undefined) return undefined;
    return deriveInvestigationState(this.options.workspace, investigation);
  }

  constructor(private readonly options: LuiOptions) {}

  /**
   * CONVERSATION FRAME (conversational law): a trader inside an investigation says "Focus
   * specifically on ETF flows." — a follow-up that names no asset. Every model call that
   * interprets, resolves, disambiguates or plans the turn reads the SAME frame: what this
   * conversation is about, what the conversation layer already decided this turn is (it is
   * recorded state, never re-decided here), and the trader's own earlier turns.
   *
   * Without it the interpreter reads the sentence in a vacuum and classifies "focus on X" as a
   * working-state change ("set my active target to X"); the ambiguity check then asks which asset
   * and which period were meant; the turn ends AWAITING_CONFIRMATION with no research run at all.
   * That is how the most common follow-up in the product answered nothing while the previous
   * answer stayed on screen looking like the answer to it.
   */
  private conversationFrame(): string | undefined {
    const investigationId = this.investigationContext?.investigationId;
    if (investigationId === undefined) return undefined;
    const investigation = this.options.workspace.getInvestigation(investigationId);
    if (investigation === undefined) return undefined;
    // Only a FOLLOW-UP gets a frame. The investigation's first question has no conversation to
    // read yet (the only turn on record is the one being answered), and handing a model a frame
    // built from the question itself teaches it to treat every request as context-dependent.
    if (this.options.workspace.listTurns(investigationId).length <= 1) return undefined;
    const turns = this.investigationContext?.turns.slice(-6)
      .map((t) => `- ${t.role}: ${t.content.replace(/\s+/g, " ").trim()}`) ?? [];
    return [
      "CONVERSATION CONTEXT (an investigation is already in progress):",
      `Active investigation: ${investigation.title} (subject: ${investigation.subject})`,
      `Conversation decision for THIS turn, already recorded and binding: ${this.conversationIntent ?? "FOLLOW_UP"}`,
      ...(turns.length > 0 ? ["Earlier turns in this conversation:", ...turns] : []),
    ].join("\n");
  }

  /** Main entry: one user message → validated pipeline → LuiResult.
   *  `onProgress` (F0 SSE seam) receives REAL pipeline-stage events when supplied. */
  async handle(
    userMessage: string,
    origin: ProvenanceOrigin = { kind: "trader", detail: "LUI message" },
    onProgress?: ProgressListener,
    /** Wall-clock deadline (epoch ms) threaded into every research loop (honest time budget). */
    deadlineMs?: number,
  ): Promise<LuiResult> {
    const progress = onProgress ?? this.options.onProgress;
    // The verbatim message, kept for the target law (a model-resolved asset is only the
    // question's target when the QUESTION ITSELF names it).
    this.currentMessage = userMessage;
    // FOLLOW-UP + EVIDENCE_ONLY = NO_NEW_RETRIEVAL (hard orchestration guard): a follow-up the
    // trader scoped to the already-collected evidence NEVER reaches the planner, the flow
    // classifier, or any capability. It is dispatched straight to the evidence-only synthesis
    // path — one safety screen plus one bounded summary call over the parent's evidence —
    // regardless of what any model might classify the message as.
    if (currentRun()?.executionMode === "FOLLOW_UP_EVIDENCE_ONLY") {
      return this.dispatchEvidenceOnlyFollowUp(origin, progress, deadlineMs);
    }
    this.flowGuard = undefined;
    // THESIS + CAPABILITY GATES are decided from the trader's OWN words before any model
    // call, so they are inputs to the pipeline rather than a consequence of it.
    this.thesisContextRequired = THESIS_CONTEXT_PHRASE.test(userMessage);
    this.capabilityConstraint = capabilityConstraintOf(userMessage);
    this.executionConstraints = executionConstraintsOf(userMessage, this.capabilityConstraint);
    // EXECUTION CONTRACT: a request that forbids thesis context never receives it, whatever the
    // model later classifies the target as. A raw observation about Bitcoin must not inherit an
    // active Ethereum thesis from the workspace.
    if (!this.executionConstraints.allowThesisContext) this.thesisContextRequired = false;
    // INVESTIGATION CONTEXT: build the prior-conversation context for the investigation this
    // submission belongs to (undefined for the first turn of a thread). It is built ONCE per
    // message, before any model call, so a follow-up is never planned as if it were the first
    // question of the conversation.
    const investigationId = currentRun()?.investigationId;
    this.investigationContext = investigationId !== undefined
      ? buildInvestigationContext({
          workspace: this.options.workspace,
          investigation: this.options.workspace.getInvestigation(investigationId),
          question: userMessage,
        })
      : undefined;
    this.investigationIdForTurn = investigationId;
    // The routing decision was already made and RECORDED as a conversation turn by the
    // application layer (a state transition, not a prompt instruction). The LUI reads the
    // recorded intent rather than re-deciding it, so the two can never disagree.
    this.conversationIntent = investigationId === undefined
      ? undefined
      : [...this.options.workspace.listTurns(investigationId)]
          .reverse()
          .find((t) => t.role === "TRADER" && t.content === userMessage)?.intent;

    // 1–2. INPUT NORMALIZATION + INTENT DETECTION (validated; model failure aborts honestly).
    progress?.(progressEvent("request_accepted", new Date(), "request accepted", { messageLength: userMessage.length }));
    let request: NormalizedRequest;
    try {
      const res = await this.ask<string>({
        schemaName: "lui.normalized_request",
        schemaDescription: NORMALIZED_REQUEST_SCHEMA_DESC,
        system: INTERPRETER_SYSTEM,
        prompt: [
          `Trader message: "${userMessage}"`,
          this.conversationFrame(),
          `Respond as JSON conforming to schema "lui.normalized_request".`,
          NORMALIZED_REQUEST_SCHEMA_DESC,
        ].filter((line) => line !== undefined).join("\n"),
        preferJson: true,
      });
      request = parseNormalizedRequest(res.raw);
      progress?.(progressEvent("intent_understood", new Date(), `intent understood: ${request.primaryAction}`, { primaryAction: request.primaryAction }));
    } catch (error) {
      return this.failureResult(userMessage, error);
    }

    // 3–4. CONTEXT + TARGET RESOLUTION (workspace-grounded; no invented ids).
    let target: ResolvedTarget;
    try {
      const res = await this.ask<string>({
        schemaName: "lui.resolved_target",
        schemaDescription: RESOLVED_TARGET_SCHEMA_DESC,
        system: TARGET_SYSTEM,
        prompt: [
          `Trader message: "${userMessage}"`,
          `Interpreted objective: ${request.objective}`,
          `Primary action: ${request.primaryAction}`,
          this.conversationFrame(),
          "CURRENT WORKSPACE STATE:",
          renderResearchContext(this.researchContext()),
        ].join("\n"),
        preferJson: true,
      });
      target = this.validateTarget(validateModelOutput<ResolvedTarget>(RESOLVED_TARGET_SCHEMA, res.raw).data);
      // DETERMINISTIC FLOW GUARD (routing remediation): the model classifies the flow, but the
      // user's own explicit task language and constraints are authoritative. A "what happened"
      // timeline classified FALSIFICATION (live production failure) is corrected here BEFORE
      // any plan is built, so the wrong methodology never executes.
      const guarded = guardFlow({ message: userMessage, ...(target.flow !== undefined ? { classified: target.flow } : {}) });
      this.flowGuard = guarded;
      // THESIS-CONTEXT GATE: a thesis-facing canonical flow earns thesis context even when
      // the message does not use the word "thesis" (e.g. "does my position still work?").
      if (THESIS_CONTEXT_FLOWS.has(guarded.flow ?? "")) this.thesisContextRequired = true;
      if (guarded.flow !== target.flow) {
        target = {
          ...target,
          ...(guarded.flow !== undefined ? { flow: guarded.flow } : {}),
        };
        if (guarded.flow === undefined) {
          const { flow: _dropped, ...rest } = target;
          target = rest as ResolvedTarget;
        }
        progress?.(progressEvent("target_resolved", new Date(),
          guarded.source === "corrected"
            ? `flow corrected by task language: ${guarded.correction?.from} -> ${guarded.flow}`
            : "flow determined from task language",
          guarded.source === "corrected" && guarded.correction !== undefined
            ? { correctedFrom: guarded.correction.from, correctedTo: guarded.flow ?? "" }
            : {}));
      }
      progress?.(progressEvent("target_resolved", new Date(), "target resolved from workspace context", {}));
    } catch (error) {
      return this.failureResult(userMessage, error, request);
    }

    // 5. AMBIGUITY CHECK; genuinely ambiguous consequential actions block execution.
    let ambiguity: AmbiguityAssessment;
    try {
      const res = await this.ask<string>({
        schemaName: "lui.ambiguity",
        schemaDescription: AMBIGUITY_SCHEMA_DESC,
        system: AMBIGUITY_SYSTEM,
        prompt: [
          `Trader message: "${userMessage}"`,
          `Primary action: ${request.primaryAction}`,
          `Resolved target: ${JSON.stringify(target)}`,
          this.conversationFrame(),
          `Workspace context summary: ${renderResearchContext(this.researchContext()).slice(0, 2000)}`,
        ].join("\n"),
        preferJson: true,
      });
      ambiguity = validateModelOutput<AmbiguityAssessment>(AMBIGUITY_SCHEMA, res.raw).data;
      progress?.(progressEvent("ambiguity_checked", new Date(), `ambiguity check: ${ambiguity.isAmbiguous ? "ambiguous" : "unambiguous"}`, { isAmbiguous: ambiguity.isAmbiguous }));
    } catch (error) {
      return this.failureResult(userMessage, error, request, target);
    }

    // 6. CONSEQUENCE CHECK; gates confirmations for state mutation/persistence.
    let consequence: ConsequenceAssessment;
    try {
      const res = await this.ask<string>({
        schemaName: "lui.consequence",
        schemaDescription: CONSEQUENCE_SCHEMA_DESC,
        system: CONSEQUENCE_SYSTEM,
        prompt: `Trader message: "${userMessage}"\nPrimary action: ${request.primaryAction}\nRespond as JSON.`,
        preferJson: true,
      });
      consequence = validateModelOutput<ConsequenceAssessment>(CONSEQUENCE_SCHEMA, res.raw).data;
      progress?.(progressEvent("consequence_checked", new Date(), `consequence: ${consequence.level}`, { level: consequence.level }));
    } catch (error) {
      return this.failureResult(userMessage, error, request, target);
    }

    // 7. SAFETY SCREEN; execution-like intent is rejected before any dispatch (M3 §14).
    let safety: { isExecutionCommand: boolean; detectedViolations: readonly string[]; rationale: string };
    try {
      const res = await this.ask<string>({
        schemaName: "safety.screen",
        schemaDescription: SAFETY_SCHEMA_DESC,
        system: SAFETY_SYSTEM,
        prompt: `Trader message: "${userMessage}"\nInterpreted objective: ${request.objective}\nPlan steps: ${request.primaryAction}${request.compoundActions.map((c) => ` + ${c.action}`).join("")}\nRespond as JSON.`,
        preferJson: true,
      });
      safety = validateModelOutput<{ isExecutionCommand: boolean; detectedViolations: string[]; rationale: string }>(SAFETY_SCHEMA, res.raw).data;
      progress?.(progressEvent("safety_checked", new Date(), `safety screen: ${safety.isExecutionCommand ? "execution intent rejected" : "clear"}`, { isExecutionCommand: safety.isExecutionCommand }));
    } catch (error) {
      return this.failureResult(userMessage, error, request, target);
    }

    if (safety.isExecutionCommand) {
      return {
        request, target, ambiguity, consequence,
        plan: { steps: [], requiresConfirmationFor: [] },
        rejected: { reason: safety.rationale, violations: safety.detectedViolations },
        response: {
          answer: "Request rejected: this workbench is research-only and cannot execute trades or move funds.",
          supportingReasons: [],
          opposingReasons: [],
          confidence: "UNKNOWN",
          keyUncertainty: "",
          implication: "Rephrase as a research question if you want analysis on this topic.",
          citedObjectRefs: [],
        },
      };
    }

    // 8. ACTION PLAN; the model proposes the step plan; the LUI validates it (M3 §5).
    let plan: ActionPlan;
    try {
      const res = await this.ask<string>({
        schemaName: "lui.action_plan",
        schemaDescription: ACTION_PLAN_SCHEMA_DESC_LOCAL,
        system: [
          "Convert the interpreted request into a validated action plan using ONLY the six actions:",
          LUI_ACTIONS.join(", "),
          "- RESEARCH steps name CAPABILITIES (never providers/tools).",
          "- Compound requests become ordered steps preserving the primary objective.",
          "- Steps that persist (SAVE) or propose monitors (MONITOR) must be listed in requiresConfirmationFor.",
        ].join("\n"),
        prompt: [
          `Trader message: "${userMessage}"`,
          `Interpreted request: ${JSON.stringify(request)}`,
          `Resolved target: ${JSON.stringify(target)}`,
          this.conversationFrame(),
          `Consequence: ${JSON.stringify(consequence)}`,
        ].join("\n"),
        preferJson: true,
      });
      plan = parseActionPlan(res.raw);
      progress?.(progressEvent("plan_created", new Date(), `action plan created with ${plan.steps.length} step(s)`, { steps: plan.steps.length }));
    } catch (error) {
      return this.failureResult(userMessage, error, request, target);
    }

    // 9. ARCHITECTURE DISPATCH; step-by-step execution with confirmation gates.
    const result: LuiResult = {
      request, target, ambiguity, consequence, plan,
      response: undefined,
    };

    // THESIS CAPTURE (trader's own words). A trader who says "My thesis is that X. Test it."
    // asked for two things, and the first one is a precondition of the second: a thesis that
    // was never recorded cannot be tested, and the run answered "no active thesis to evaluate".
    // The statement is copied VERBATIM from their sentence (conversation-routing), and the
    // record goes through the SAME authorization boundary as every other consequential
    // action — an unconfirmed turn records NOTHING and halts with the confirmation prompt.
    if (this.conversationIntent === "THESIS_STATEMENT" && this.options.workspace.getActiveThesis() === undefined) {
      const statement = statedThesisText(userMessage);
      if (statement !== undefined) {
        const confirmed = origin.kind === "trader" && /confirm/i.test(origin.detail ?? "");
        if (!confirmed) {
          result.awaitingConfirmation = {
            status: "REQUIRED",
            stepIndex: 0,
            reason: "recording your own thesis as a trader-owned object requires your explicit confirmation",
          };
          result.response = {
            answer: `Before I test it, I need your confirmation to record your thesis as your own: "${statement}". Nothing is stored until you confirm, and the research below will test it against the evidence either way.`,
            supportingReasons: [],
            opposingReasons: [],
            confidence: "UNKNOWN",
            keyUncertainty: "",
            implication: "Confirm to record the thesis and run the test against it.",
            citedObjectRefs: [],
          };
          return result;
        }
        result.thesis = this.options.workspace.addThesis(
          { statement, objective: userMessage },
          origin,
          this.options.now?.(),
        );
      }
    }

    if (ambiguity.isAmbiguous && consequence.level !== "INFORMATIONAL") {
      // Genuinely ambiguous + state-affecting → clarify before touching state (M3 §13).
      result.awaitingConfirmation = { status: "REQUIRED", stepIndex: 0, reason: `ambiguous consequential request: ${ambiguity.questions.join(" / ")}` };
      result.response = {
        answer: `Before I proceed, I need clarification: ${ambiguity.questions.join(" ")}`,
        supportingReasons: [],
        opposingReasons: [],
        confidence: "UNKNOWN",
        keyUncertainty: ambiguity.reason,
        implication: "Answer the clarification and I will continue with the same objective.",
        citedObjectRefs: [],
      };
      return result;
    }

    // SHARED-DEADLINE FAIR SHARE (scheduler contract): a compound plan runs its research
    // methodologies SEQUENTIALLY against ONE wall-clock deadline. Without a share the first
    // methodology can spend the whole budget and every methodology behind it stops at
    // TIME_BUDGET_EXHAUSTED with no evidence, even though the trader asked for all of them. The
    // engine therefore slices the REMAINING budget across the research-bearing steps still
    // ahead, so each gets a fair share; a single research step keeps the whole deadline.
    const RESEARCH_BEARING_ACTIONS = new Set<ActionPlan["steps"][number]["action"]>(["RESEARCH", "ANALYZE", "CHALLENGE"]);
    const researchBearingSteps = plan.steps.filter((s) => RESEARCH_BEARING_ACTIONS.has(s.action)).length;
    let researchStepsStarted = 0;
    const stepDeadlineFor = (step: ActionPlan["steps"][number]): number | undefined => {
      if (deadlineMs === undefined || !RESEARCH_BEARING_ACTIONS.has(step.action)) return deadlineMs;
      researchStepsStarted += 1;
      const remainingMembers = researchBearingSteps - researchStepsStarted + 1;
      const nowMs = (this.options.now?.() ?? new Date()).getTime();
      return memberDeadline(deadlineMs, nowMs, remainingMembers);
    };

    for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex += 1) {
      const step = plan.steps[stepIndex];
      if (step === undefined) break; // noUncheckedIndexedAccess guard (array cannot shrink here)
      // The share this step may use (the whole deadline for a lone/non-research step).
      const stepDeadline = stepDeadlineFor(step);
      progress?.(progressEvent("step_started", new Date(), `step ${stepIndex} started: ${step.action}`, { stepIndex, action: step.action }));
      const needsConfirmation = plan.requiresConfirmationFor.includes(stepIndex) || consequence.requiresConfirmation;

      if (needsConfirmation && (step.action === "SAVE" || step.action === "MONITOR")) {
        // SAVE/MONITOR NEVER execute without explicit trader confirmation (M3 §17/§18).
        // M5 §7: a trader request whose ORIGIN records the explicit confirmation (the trader
        // themselves asked for this exact save/monitor) is sufficient authorization; the
        // dispatchers still verify origin.kind==="trader" before persisting/activating.
        const explicitTraderAuthorization = origin.kind === "trader" && /confirm/i.test(origin.detail ?? "");
        if (!explicitTraderAuthorization) {
          this.options.onConfirmationRequired?.(stepIndex, step.description);
          result.awaitingConfirmation = { status: "REQUIRED", stepIndex, reason: `${step.action} requires explicit trader confirmation before it can execute` };
          break;
        }
      }

      switch (step.action) {
        case "RESEARCH": {
          // M4/M4b: flow-classified research objectives dispatch to their methodology; the flow
          // defines objective + analytical mode, the engine picks capabilities (no Flow→Tool
          // hardcoding). Unmapped flows keep the M3 adaptive loop. Flow classification is
          // INTERNAL research routing; the user-facing action set remains the locked six.
          // Flow precedence (routing remediation): the GUARD's verdict — corrected/determined
          // from the user's own words, or an explicit-constraint veto — is verified against the
          // message, so for a SINGLE-step plan (the whole utterance IS this step) it outranks a
          // plan-step echo and a constraint veto blocks every echo. A COMPOUND plan carries
          // per-step methodologies ("full picture AND challenge my thesis"), so each step's own
          // flow leads there, with the guarded target flow as the fallback when the step omits one.
          const guardHadSay =
            this.flowGuard !== undefined &&
            (this.flowGuard.source === "corrected" ||
              this.flowGuard.source === "determined" ||
              this.flowGuard.correction !== undefined);
          const flow = plan.steps.length === 1
            ? (guardHadSay ? this.flowGuard?.flow : (step.params["flow"] ?? target.flow))
            : (step.params["flow"] ?? target.flow);
          // CANONICAL FLOW ISOLATION: the canonical flow is decided here, from the structured
          // request/router, and is carried into the research record (see dispatchResearch).
          // A generic fallback must never OVERWRITE it with another flow's identity.
          //
          // EXECUTION-MODE ISOLATION: an observation-mode request has NO canonical analytical
          // methodology. "What is Bitcoin's current spot price? Return only the raw observation"
          // was persisted as `flow = what happened`, which is a different question with a
          // different methodology. A raw retrieval operation is recorded under its own
          // non-canonical marker (RAW_OBSERVATION), the same way an unidentified methodology is
          // recorded as INDEPENDENT_RESEARCH — never by borrowing a canonical flow's identity,
          // and never by inventing a ninth canonical flow.
          if (isObservationMode(this.executionConstraints)) {
            const research = await this.dispatchResearch(step, origin, progress, stepDeadline, target.asset, undefined);
            result.research = research.outcome;
            if (research.modelFailure !== undefined) result.modelFailure = research.modelFailure;
            break;
          }
          if (flow === "WHY_IT_HAPPENED" || flow === "WHAT_DOES_ALL_INFORMATION_SAY" || flow === "WHAT_COULD_AFFECT_IT" || flow === "DOES_MY_THESIS_HOLD" || flow === "EVALUATE_WITH_MY_FRAMEWORK" || flow === "HAS_THIS_HAPPENED_BEFORE") {
            await this.dispatchM4Flow(flow, step, result, origin, progress, stepDeadline);
            break;
          }
          const research = await this.dispatchResearch(step, origin, progress, stepDeadline, target.asset, flow);
          result.research = research.outcome;
          if (research.modelFailure !== undefined) result.modelFailure = research.modelFailure;
          break;
        }
        case "ANALYZE":
          if (step.params["mode"] === "thesis" || step.params["thesis"] !== undefined) {
            await this.dispatchThesisAssessment(step, result);
          } else {
            await this.dispatchAnalyze(step, result, origin, progress, stepDeadline);
          }
          break;
        case "CHALLENGE":
          // M4 §23: CHALLENGE (LUI action) with a falsification objective invokes Flow 7
          // the research METHODOLOGY. The action and the flow remain distinct.
          // Guard precedence: when the flow guard DETERMINED a non-falsification flow from
          // the user's explicit task language (e.g. a factual timeline that mentions "prove"
          // only inside a constraint sentence), the falsification branch must not swallow it.
          // COMPOUND SCOPING (Phase G law): the guard classifies the WHOLE message, but in a
          // compound plan only the step's own params/mode scope which methodology THIS step
          // runs ("…and challenge my thesis" never turns an independently-described challenge
          // step into Flow 7); the guard-determined falsification flow applies when the plan
          // is single-step, where the whole utterance IS this step.
          const guardHadSay =
            this.flowGuard !== undefined &&
            (this.flowGuard.source === "corrected" ||
              this.flowGuard.source === "determined" ||
              this.flowGuard.correction !== undefined);
          const stepScopedFalsification =
            step.params["flow"] === "WHAT_COULD_PROVE_ME_WRONG" || step.params["mode"] === "falsification";
          const targetScopedFalsification =
            target.flow === "WHAT_COULD_PROVE_ME_WRONG" && plan.steps.length === 1;
          // The guard's verified NON-falsification verdict (task language resolved another
          // methodology, or an explicit constraint vetoed falsification) outranks any echo.
          const guardOverridesFalsification =
            guardHadSay && target.flow !== "WHAT_COULD_PROVE_ME_WRONG";
          if ((stepScopedFalsification || targetScopedFalsification) && !guardOverridesFalsification) {
            await this.dispatchFlow7(step, result, origin, progress, stepDeadline);
            break;
          }
          // Phase G: thesis-facing challenge utterances ("challenge my thesis", "what could
          // prove this thesis wrong", "what contradicts my view") run the falsification
          // METHODOLOGY against the workspace's thesis with DETERMINISTIC resolution: no
          // unambiguous thesis → clarify (never research a random asset); exactly one (or the
          // trader-selected active thesis) → Flow 7 with that thesisRef. The generic falsifier
          // stays for non-thesis targets (a statement/hypothesis the trader quoted).
          // In a single-step plan the whole utterance describes this step; in a compound plan
          // only the step's own description scopes what THIS challenge targets.
          if (referencesTradersThesis(step.description) || (plan.steps.length === 1 && referencesTradersThesis(userMessage))) {
            const resolution = resolveChallengeThesis(this.options.workspace);
            if (resolution.type === "clarify") {
              // Terminal clarification: returned directly (the ambiguity-path precedent) so
              // the final-response builder cannot overwrite it with a generic no-outcome text.
              result.response = {
                answer: `Before I can challenge anything: ${resolution.reason}`,
                supportingReasons: [],
                opposingReasons: [],
                confidence: "UNKNOWN",
                keyUncertainty: "which thesis the request targets",
                implication: "Create or select a thesis, or name which one to challenge, and I will run falsification research on it.",
                citedObjectRefs: [],
              };
              return result;
            }
            await this.dispatchFlow7(
              { ...step, params: { ...step.params, thesisRef: resolution.thesisId, mode: "falsification" } },
              result, origin, progress, stepDeadline,
            );
            break;
          }
          await this.dispatchChallenge(step, result);
          break;
        case "MANAGE_STATE":
          await this.dispatchManageState(step, result, origin);
          break;
        case "MONITOR":
          await this.dispatchMonitor(step, result);
          break;
        case "SAVE": {
          // Reaching here means no confirmation was required; e.g. the caller pre-approved.
          await this.dispatchSave(step, result, origin);
          break;
        }
      }
      if (result.awaitingConfirmation !== undefined) break;
    }

    // 10. FINAL RESPONSE; from the actual outcome; model failure stays a failure (M3 §19).
    result.response = await this.buildResponse(result, userMessage);
    progress?.(progressEvent("response_ready", new Date(), "response ready", {}));
    return result;
  }

  // ----- dispatchers ---------------------------------------------------------

  /**
   * M4 dispatch: Flow 2 / Flow 6 run through the shared flow runner (objective + mode;
   * capability selection stays with the engine). The LUI result keeps the M3 shape
   * (research outcome + response) so downstream behavior is unchanged.
   */
  private async dispatchM4Flow(flow: string, step: ActionPlan["steps"][number], result: LuiResult, origin: ProvenanceOrigin, onProgress?: ProgressListener, deadlineMs?: number): Promise<void> {
    const objective = step.params["objective"] ?? step.description;
    // Target resolution is deterministic where the model's step params omit it: the plan
    // step may not carry the asset even though target resolution succeeded. Fallback order:
    // step params -> the resolved target's asset -> an exact ticker-shaped token in the
    // objective (NVDA, AAPL, BTC; 2-6 alphanumerics, NOT sentence words) -> active thesis.
    // A ticker in the question is a fact about the question; requiring the plan to echo it
    // back is how capability params ended up empty and every equity capability failed
    // SCHEMA_ERROR for "no ticker symbol resolved".
    const objectiveTicker = /\b[A-Z][A-Z0-9]{1,5}\b/.exec(objective)?.[0];
    // Canonical instrument resolution (target-resolution law): commodities/metals/FX/indices
    // resolve to their Yahoo-tradable symbols (oil -> CL=F) deterministically, BEFORE any
    // workspace fallback. The active thesis is a target source ONLY when the objective
    // actually references the trader's own material — an independent question must never
    // inherit the thesis's asset as its research target (live contamination path).
    const referencesTraderMaterial = /\b(thesis|framework|my (view|position|setup|thesis|framework))\b/i.test(objective);
    // TARGET LAW enforced at dispatch: a workspace/model-inherited asset survives only when
    // the question names it. Anything else (the step's own explicit asset or canonical
    // instrument resolution of the objective text) is question-earned.
    const inherited = result.target.asset;
    const inheritedEarned = inherited !== undefined && (referencesTraderMaterial || assetIsNamedByQuestion(this.currentMessage ?? objective, objective, inherited));
    const asset = earnedCapabilityAsset(
      this.currentMessage,
      objective,
      step.params["asset"] ?? (inheritedEarned ? inherited : undefined) ?? objectiveTicker,
    ) ?? (referencesTraderMaterial ? this.options.workspace.activeTheses()[0]?.scope.entities[0] : undefined);
    const constraints = step.params["constraints"] !== undefined ? step.params["constraints"].split(";").map((s) => s.trim()).filter((s) => s !== "") : undefined;
    const now = this.options.now;
    if (flow === "WHY_IT_HAPPENED") {
      const { runFlow2 } = await import("../research/flow2.js");
      const flow2 = await runFlow2(objective, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace: this.options.workspace,
        store: this.options.store,
        ...(asset !== undefined ? { asset } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        ...(now !== undefined ? { now } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      result.flow2 = flow2;
      if (flow2.modelFailure !== undefined) result.modelFailure = flow2.modelFailure;
    } else if (flow === "WHAT_COULD_AFFECT_IT") {
      const { runFlow3 } = await import("../research/flow3.js");
      const flow3 = await runFlow3(objective, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace: this.options.workspace,
        store: this.options.store,
        ...(asset !== undefined ? { asset } : {}),
        ...(step.params["horizon"] !== undefined ? { horizon: step.params["horizon"] } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        ...(now !== undefined ? { now } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      result.flow3 = flow3;
      if (flow3.modelFailure !== undefined) result.modelFailure = flow3.modelFailure;
    } else if (flow === "DOES_MY_THESIS_HOLD") {
      const { runFlow4 } = await import("../research/flow4.js");
      const flow4 = await runFlow4(objective, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace: this.options.workspace,
        store: this.options.store,
        ...(step.params["thesisRef"] !== undefined ? { thesisRef: step.params["thesisRef"] } : {}),
        ...(asset !== undefined ? { asset } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        ...(now !== undefined ? { now } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      result.flow4 = flow4;
      if (flow4.modelFailure !== undefined) result.modelFailure = flow4.modelFailure;
    } else if (flow === "HAS_THIS_HAPPENED_BEFORE") {
      const { runFlow5 } = await import("../research/flow5.js");
      const flow5 = await runFlow5(objective, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace: this.options.workspace,
        store: this.options.store,
        ...(asset !== undefined ? { asset } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        ...(now !== undefined ? { now } : {}),
        ...(deadlineMs !== undefined ? { deadlineMs } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      result.flow5 = flow5;
      if (flow5.modelFailure !== undefined) result.modelFailure = flow5.modelFailure;
    } else if (flow === "EVALUATE_WITH_MY_FRAMEWORK") {
      const { runFlow8 } = await import("../research/flow8.js");
      const flow8 = await runFlow8(objective, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace: this.options.workspace,
        store: this.options.store,
        ...(step.params["frameworkRef"] !== undefined ? { frameworkRef: step.params["frameworkRef"] } : {}),
        ...(asset !== undefined ? { target: asset } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        ...(now !== undefined ? { now } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      result.flow8 = flow8;
      if (flow8.modelFailure !== undefined) result.modelFailure = flow8.modelFailure;
    } else {
      const { runFlow6 } = await import("../research/flow6.js");
      const flow6 = await runFlow6(objective, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace: this.options.workspace,
        store: this.options.store,
        ...(asset !== undefined ? { asset } : {}),
        ...(constraints !== undefined ? { constraints } : {}),
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        ...(now !== undefined ? { now } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      result.flow6 = flow6;
      if (flow6.modelFailure !== undefined) result.modelFailure = flow6.modelFailure;
    }
    void origin;
  }

  /** M4 §23: CHALLENGE action → Flow 7 falsification methodology (thesis stays trader-owned). */
  private async dispatchFlow7(step: ActionPlan["steps"][number], result: LuiResult, origin: ProvenanceOrigin, onProgress?: ProgressListener, deadlineMs?: number): Promise<void> {
    const { runFlow7 } = await import("../research/flow7.js");
    const objective = step.params["objective"] ?? step.description;
    const asset = earnedCapabilityAsset(this.currentMessage, objective, step.params["asset"]);
    const now = this.options.now;
    const flow7 = await runFlow7(objective, {
      provider: this.options.provider,
      registry: this.options.registry,
      workspace: this.options.workspace,
      store: this.options.store,
      // Thesis ref resolved from the validated target when present; otherwise the workspace's
      // active thesis (trader-owned) is used; never a fabricated belief.
      ...(step.params["thesisRef"] !== undefined ? { thesisRef: step.params["thesisRef"] } : {}),
      ...(step.params["belief"] !== undefined ? { beliefStatement: step.params["belief"] } : {}),
      ...(asset !== undefined ? { asset } : {}),
      ...(now !== undefined ? { now } : {}),
      ...(deadlineMs !== undefined ? { deadlineMs } : {}),
      ...(onProgress !== undefined ? { onProgress } : {}),
    });
    result.flow7 = flow7;
    if (flow7.modelFailure !== undefined) result.modelFailure = flow7.modelFailure;
    void origin;
  }

  /**
   * EVIDENCE-ONLY FOLLOW-UP (FOLLOW_UP + EVIDENCE_ONLY = NO_NEW_RETRIEVAL): the entire
   * execution is ONE safety screen plus ONE bounded summary call over the parent's inherited
   * evidence. No planner, no flow classification, no requirement expansion beyond the single
   * follow-up row, no capability execution — the registry is never touched, so no web/search/
   * RSS retrieval can occur by construction. The follow-up references the parent's evidence
   * ids directly (never cloned) and may not assert anything outside that scope.
   */
  private async dispatchEvidenceOnlyFollowUp(
    origin: ProvenanceOrigin,
    progress?: ProgressListener,
    _deadlineMs?: number,
  ): Promise<LuiResult> {
    const userMessage = this.currentMessage ?? "";
    const workspace = this.options.workspace;
    const now = () => this.options.now?.() ?? new Date();
    progress?.(progressEvent("request_accepted", now(), "evidence-only follow-up: no new retrieval", { messageLength: userMessage.length }));

    // SAFETY SCREEN (M3 §14): the one gate that must never be skipped, even on the fast path.
    try {
      const res = await this.ask<string>({
        schemaName: "safety.screen",
        schemaDescription: SAFETY_SCHEMA_DESC,
        system: SAFETY_SYSTEM,
        prompt: `Trader message: "${userMessage}"\nInterpreted objective: summarize the strongest finding from already-collected evidence\nPlan steps: RESEARCH\nRespond as JSON.`,
        preferJson: true,
      });
      const safety = validateModelOutput<{ isExecutionCommand: boolean; detectedViolations: string[]; rationale: string }>(SAFETY_SCHEMA, res.raw).data;
      if (safety.isExecutionCommand) {
        return {
          request: { primaryAction: "RESEARCH", compoundActions: [], objective: userMessage, isExplanationOnly: false, disclosureLevel: 0 },
          target: { objectRefs: [], unresolved: [] },
          ambiguity: { isAmbiguous: false, questions: [], reason: "evidence-only follow-up" },
          consequence: { level: "INFORMATIONAL", rationale: "read-only synthesis of collected evidence", requiresConfirmation: false },
          plan: { steps: [], requiresConfirmationFor: [] },
          rejected: { reason: safety.rationale, violations: safety.detectedViolations },
          response: {
            answer: "Request rejected: this workbench is research-only and cannot execute trades or move funds.",
            supportingReasons: [], opposingReasons: [], confidence: "UNKNOWN", keyUncertainty: "",
            implication: "Rephrase as a research question if you want analysis on this topic.", citedObjectRefs: [],
          },
        };
      }
    } catch (error) {
      return this.failureResult(userMessage, error);
    }

    const run = currentRun();
    const scope: InheritedEvidenceScope | undefined = run !== undefined ? inheritedEvidenceScopeOf(workspace, run) : undefined;
    // The follow-up's OWN research object: never a borrowed canonical flow identity (flow
    // isolation law) — it is a continuation, recorded under its own non-canonical marker.
    const research = workspace.addResearch({ objective: userMessage, question: userMessage, flow: "FOLLOW_UP" }, origin, now());
    workspace.transitionResearch(research.id, "ACTIVE", { kind: "agent", detail: "evidence-only follow-up dispatch" }, "evidence-only follow-up activated (no retrieval permitted)", now());

    const singleRequirement = (status: ResearchRequirement["status"], evidenceRefs: readonly string[], missingReason?: string): ResearchRequirement => ({
      id: "rq_followup_1",
      description: "the strongest finding supported by the parent run's collected evidence, in one sentence",
      importance: "CRITICAL",
      role: "CORE",
      timeSensitivity: "ANY",
      domains: ["GENERAL"],
      status,
      evidenceRefs,
      staleOnlyRefs: [],
      recoveryAttempts: 0,
      engineRequired: true,
      ...(missingReason !== undefined ? { missingReason } : {}),
    });

    const synthesis = await synthesizeEvidenceOnlyFollowUp({
      provider: this.options.provider,
      scope: scope ?? { parentResearchId: run?.parentResearchId ?? "", parentQuestion: "", items: [], parentFindings: "", parentRequirementState: [], allowedEvidenceIds: [] },
      question: userMessage,
    });
    const answered = synthesis.ok && scope !== undefined;
    workspace.transitionResearch(
      research.id,
      answered ? "COMPLETED" : "FAILED",
      { kind: "agent", detail: "evidence-only follow-up" },
      answered ? "follow-up answered from the parent's evidence (no new retrieval)" : `follow-up unresolved: ${synthesis.reason ?? "parent evidence insufficient"}`,
      now(),
    );
    const finalResearch = workspace.getResearch(research.id) ?? research;

    // Judgment: minted ONLY for an answered follow-up, over the PARENT's evidence refs —
    // never a copy of the parent's evidence objects (reference, don't duplicate).
    if (answered && scope !== undefined) {
      workspace.addJudgment(
        {
          researchRef: research.id,
          statement: synthesis.finding,
          basis: { supportingEvidence: [...synthesis.evidenceRefs], opposingEvidence: [], keyClaims: [], hypotheses: [] },
          confidence: synthesis.confidence,
          uncertainty: synthesis.reason !== undefined ? [synthesis.reason] : [],
          unresolvedQuestions: [],
          implications: ["follow-up answered from the parent run's evidence; no new retrieval was performed"],
        },
        { kind: "agent", detail: "evidence-only follow-up synthesis" },
        now(),
      );
    }

    const requirements: readonly ResearchRequirement[] = [
      answered
        ? singleRequirement("SATISFIED", synthesis.evidenceRefs)
        : singleRequirement("UNAVAILABLE", [], synthesis.reason ?? "parent evidence insufficient"),
    ];
    const confidence = computeConfidence({
      requirements,
      stoppedBecause: answered ? "EVIDENCE_SUFFICIENT" : "MODEL_INSUFFICIENT_EVIDENCE",
      failedPaths: 0,
      calculationsMissing: 0,
    });
    const questionResolution = evaluateQuestionResolution({
      question: userMessage,
      ledger: requirements,
      evidenceText: (scope?.items ?? []).map((i) => i.text).join(" ").slice(0, 20000),
      prose: synthesis.finding,
      executedCapabilities: [],
      evidenceCount: scope?.items.length ?? 0,
    });

    const outcome: AdaptiveLoopOutcome = {
      research: finalResearch,
      plan: { objective: userMessage, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: ["one-sentence finding cited to the parent's collected evidence"], adaptationPolicy: "stop" },
      rounds: [],
      executions: [],
      finalDecision: {
        decision: answered ? "COMPLETE" : "INSUFFICIENT_EVIDENCE",
        rationale: answered
          ? "answered from the parent run's collected evidence; no new retrieval was performed"
          : `not answered from the parent's evidence alone: ${synthesis.reason ?? "insufficient inherited evidence"}`,
        nextTasks: [],
      },
      evidence: [],
      stoppedBecause: answered ? "EVIDENCE_SUFFICIENT" : "MODEL_INSUFFICIENT_EVIDENCE",
      // Inherited evidence travels as CONTEXT (referenced, never re-owned): the response's
      // evidence list stays empty (no cloned objects), while citations keep the parent ids.
      context: {
        researchRef: research.id,
        objective: userMessage,
        currentResearchRef: research.id,
        currentResearchQuestion: userMessage,
        items: (scope?.items ?? []).map((i) => ({
          ref: i.ref,
          kind: i.kind,
          text: i.text,
          sourceRefs: i.sourceRefs,
          ...(i.observedAt !== undefined ? { timestamp: i.observedAt } : {}),
        })),
        runEvidenceRefs: [],
        claims: [],
        hypotheses: [],
        contradictions: [],
        limitations: [],
      },
      requirements,
      confidence,
      questionResolution,
      answer: synthesis.finding,
    };

    return {
      request: { primaryAction: "RESEARCH", compoundActions: [], objective: userMessage, isExplanationOnly: false, disclosureLevel: 0 },
      target: { objectRefs: [], unresolved: [] },
      ambiguity: { isAmbiguous: false, questions: [], reason: "evidence-only follow-up" },
      consequence: { level: "INFORMATIONAL", rationale: "read-only synthesis of collected evidence", requiresConfirmation: false },
      plan: { steps: [{ action: "RESEARCH", description: userMessage, capabilities: [], params: { objective: userMessage } }], requiresConfirmationFor: [] },
      research: outcome,
      response: {
        answer: synthesis.finding,
        supportingReasons: [],
        opposingReasons: [],
        confidence: synthesis.confidence,
        keyUncertainty: answered ? "" : (synthesis.reason ?? "parent evidence insufficient"),
        implication: answered ? "This summary used only the parent run's collected evidence; no new research was performed." : "The parent's evidence was insufficient; re-run the research or ask a new question.",
        citedObjectRefs: [...synthesis.evidenceRefs],
      },
    };
  }

  private async dispatchResearch(
    step: ActionPlan["steps"][number],
    origin: ProvenanceOrigin,
    onProgress?: ProgressListener,
    deadlineMs?: number,
    resolvedAsset?: string,
    resolvedFlow?: string,
  ): Promise<{ outcome: AdaptiveLoopOutcome; modelFailure?: ModelFailure }> {
    const workspace = this.options.workspace;
    const objective = step.params["objective"] ?? step.description;
    // TARGET LAW (same predicate as dispatchM4Flow): an inherited resolvedAsset that the
    // question text does not name is dropped before it can reach capability params or the
    // subject gate; crypto capabilities are then never routed for a question the user never
    // aimed at crypto.
    const referencesTraderMaterialResearch = /\b(thesis|framework|my (view|position|setup|thesis|framework))\b/i.test(objective);
    const earnedResolvedAsset =
      resolvedAsset !== undefined &&
      (referencesTraderMaterialResearch || assetIsNamedByQuestion(this.currentMessage ?? objective, objective, resolvedAsset))
        ? resolvedAsset
        : undefined;
    const capabilityAsset = earnedCapabilityAsset(this.currentMessage, objective, step.params["asset"] ?? earnedResolvedAsset);
    // CANONICAL FLOW ISOLATION: the research record carries the flow the request actually
    // resolved to — never a default. The previous fallback stamped every generic research
    // step "WHAT_DOES_ALL_INFORMATION_SAY", so Flow 1 ("what happened"), Flow 3 ("what could
    // affect it") and Flow 7 requests were all PERSISTED as Flow 6 ("what does all the
    // information say"). A request that resolves no canonical flow is recorded honestly as
    // INDEPENDENT_RESEARCH rather than borrowing another flow's identity.
    const canonicalFlow = isObservationMode(this.executionConstraints)
      ? RAW_OBSERVATION_FLOW
      : resolvedFlow ?? step.params["flow"] ?? this.flowGuard?.flow ?? INDEPENDENT_RESEARCH_FLOW;
    const research = workspace.addResearch(
      { objective, question: objective, flow: canonicalFlow },
      origin,
      this.options.now?.(),
    );
    workspace.transitionResearch(research.id, "ACTIVE", { kind: "agent", detail: "LUI dispatch" }, "research activated", this.options.now?.());

    try {
      const outcome = await runAdaptiveResearch(objective, research.id, {
        provider: this.options.provider,
        registry: this.options.registry,
        workspace,
        store: this.options.store,
        ...(this.capabilityConstraint.allowed !== undefined || this.capabilityConstraint.forbidden.length > 0
          ? { capabilityConstraint: this.capabilityConstraint }
          : {}),
        // EXECUTION CONTRACT: the prohibitions on the pipeline, enforced by the engine at every
        // layer that would otherwise violate them (requirement ledger, capability floor,
        // counterevidence floor, gap recovery, answer synthesis, response assembly).
        ...(this.executionConstraints !== UNCONSTRAINED_RESEARCH
          ? { executionConstraints: this.executionConstraints }
          : {}),
        // CONVERSATION CONTEXT: the investigation's prior state reaches the research run as
        // labelled context. The run still retrieves and owns its own evidence; the boundary
        // notice below says so to the model exactly as the engine enforces it.
        ...(this.investigationContext?.investigationId !== undefined
          ? { investigationContext: renderInvestigationContext(this.investigationContext) }
          : {}),
        constraints: step.params["constraints"] !== undefined ? step.params["constraints"].split(";").map((s) => s.trim()).filter((s) => s !== "") : [],
        capabilityParams: {
          // Same deterministic backstop as dispatchM4Flow: the resolved target, a canonical
          // instrument (oil -> CL=F), or an exact ticker in the objective must reach
          // capability params even when the plan step omitted the asset; symbol-scoped
          // adapters SCHEMA_ERROR otherwise, and the chain would fall through to
          // domain-wrong fallbacks. TARGET LAW: the asset must be EARNED by the question text
          // — both a workspace-inherited target AND a plan-supplied symbol (live: asset "USD"
          // for a dollar question resolved to a leveraged semiconductor ETF) are dropped or
          // replaced by the canonical instrument the question actually names.
          ...(capabilityAsset !== undefined ? { asset: capabilityAsset } : {}),
          // G2 DISCOVER falls back to the question text when a task carries no query:
          // the objective still bounds the investigation; never a hard schema failure.
          question: step.params["question"] ?? objective,
        },
        ...(this.options.now !== undefined ? { now: this.options.now } : {}),
        ...(deadlineMs !== undefined ? { deadlineMs } : {}),
        ...(onProgress !== undefined ? { onProgress } : {}),
      });
      return { outcome };
    } catch (error) {
      // Model failure during planning: return an honest outcome shell, not a fabricated one.
      const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
      const outcome: AdaptiveLoopOutcome = {
        research: workspace.getResearch(research.id)!,
        plan: { objective, scopeIncluded: [], scopeExcluded: [], tasks: [], completionCriteria: [], adaptationPolicy: "n/a; planning failed" },
        rounds: [],
        executions: [],
        finalDecision: { decision: "INSUFFICIENT_EVIDENCE", rationale: `research could not start: ${failure.message}`, nextTasks: [] },
        evidence: [],
        stoppedBecause: "MODEL_FAILURE",
        context: buildResearchContext(workspace, { researchRef: research.id }),
      };
      return { outcome, modelFailure: failure };
    }
  }

  private async dispatchAnalyze(step: ActionPlan["steps"][number], result: LuiResult, origin?: ProvenanceOrigin, onProgress?: ProgressListener, deadlineMs?: number): Promise<void> {
    const explicitRef = step.params["researchRef"];
    // Deterministic re-route law: ANALYZE interprets EXISTING research. When the plan gave
    // no research ref, the context is the workspace-wide ARCHIVE (possibly all from one
    // unrelated question); analyzing it cannot answer a market question like "Why did BTC
    // move recently?" (observed live: the model classified such questions ANALYZE and the
    // archived NVDA evidence was presented as the answer). When the question is NOT about
    // the archived material, re-route to a fresh RESEARCH with the same objective.
    if (explicitRef === undefined) {
      const objective = step.params["objective"] ?? step.description;
      const archive = this.researchContext();
      // References to the stored material: explicit pronouns/possessives/demonstratives,
      // "research/findings/results/evidence" as the object, or a subject overlap with the
      // most recent run's question. A market question about the WORLD matches none of these.
      const referencesStoredMaterial =
        /\b(it|that|this|those|these|our|what we found|the findings|the results|the evidence|the research|current research|existing research|our research|our findings)\b/i.test(objective) ||
        (archive.currentResearchQuestion !== undefined &&
          (objective.toLowerCase().includes(archive.currentResearchQuestion.toLowerCase().slice(0, 24)) ||
            archive.currentResearchQuestion.toLowerCase().includes(objective.toLowerCase().slice(0, 24))));
      const aboutArchive = archive.currentResearchQuestion !== undefined && referencesStoredMaterial;
      if (!aboutArchive) {
        onProgress?.(progressEvent("step_started", new Date(), "no existing research answers this question; running a fresh investigation", { action: "RESEARCH" }));
        const research = await this.dispatchResearch(
          { ...step, action: "RESEARCH", params: { ...step.params, objective } },
          origin ?? { kind: "agent", detail: "ANALYZE re-route: archived context does not answer this question" },
          onProgress,
          deadlineMs,
          // TARGET LAW at the third consumption site: the re-routed investigation inherits
          // the resolved asset only when the question text names it.
          result.target.asset !== undefined && assetIsNamedByQuestion(this.currentMessage ?? objective, objective, result.target.asset)
            ? result.target.asset
            : undefined,
        );
        result.research = research.outcome;
        if (research.modelFailure !== undefined) result.modelFailure = research.modelFailure;
        return;
      }
    }
    const ctx = this.researchContext(explicitRef !== undefined ? { researchRef: explicitRef } : {});
    try {
      const res = await this.ask<string>({
        schemaName: "analysis.model_analysis",
        schemaDescription: ANALYSIS_SCHEMA_DESC,
        system: ANALYSIS_SYSTEM,
        prompt: [
          `Analysis objective: ${step.params["objective"] ?? step.description}`,
          "VALIDATED RESEARCH CONTEXT:",
          renderResearchContext(ctx),
        ].join("\n"),
        preferJson: true,
      });
      result.analysis = this.validateCitations<AnalysisShape>(validateModelOutput<AnalysisShape>(ANALYSIS_SCHEMA, res.raw).data, ctx);
    } catch (error) {
      result.modelFailure = toModelFailure(error);
    }
  }

  /**
   * Thesis assessment (M3 §15): evidence evaluated AGAINST the trader's thesis. The assessment
   * NEVER mutates the thesis; supporting/contradicting evidence is cited, invalidation and
   * early-warning conditions are derived, and the result is returned to the trader.
   */
  private async dispatchThesisAssessment(step: ActionPlan["steps"][number], result: LuiResult): Promise<void> {
    const ctx = this.researchContext();
    if (ctx.thesis === undefined) {
      result.modelFailure = new ModelFailure("INVALID_OUTPUT", "no active thesis in the workspace; thesis evaluation requires a trader-owned thesis (never fabricate one)", false);
      return;
    }
    try {
      const res = await this.ask<string>({
        schemaName: "thesis.assessment",
        schemaDescription: THESIS_ASSESSMENT_SCHEMA_DESC,
        system: THESIS_SYSTEM,
        prompt: [
          `Evaluate the trader's thesis: "${ctx.thesis.statement}"`,
          step.params["objective"] !== undefined ? `Evaluation focus: ${step.params["objective"]}` : "",
          "VALIDATED RESEARCH CONTEXT:",
          renderResearchContext(ctx),
        ].filter((l) => l !== "").join("\n"),
        preferJson: true,
      });
      result.thesisAssessment = this.validateCitations<ThesisAssessment>(validateModelOutput<ThesisAssessment>(THESIS_ASSESSMENT_SCHEMA, res.raw).data, ctx);
    } catch (error) {
      result.modelFailure = toModelFailure(error);
    }
  }

  private async dispatchChallenge(step: ActionPlan["steps"][number], result: LuiResult): Promise<void> {
    const ctx = this.researchContext(step.params["researchRef"] !== undefined ? { researchRef: step.params["researchRef"] } : {});
    const targetStatement = step.params["statement"] ?? ctx.thesis?.statement ?? ctx.judgment?.statement ?? step.description;
    try {
      const res = await this.ask<string>({
        schemaName: "analysis.challenge",
        schemaDescription: CHALLENGE_SCHEMA_DESC,
        system: CHALLENGE_SYSTEM,
        prompt: [
          `Falsify this statement: "${targetStatement}"`,
          "VALIDATED RESEARCH CONTEXT:",
          renderResearchContext(ctx),
        ].join("\n"),
        preferJson: true,
      });
      result.challenge = this.validateCitations<ChallengeShape>(validateModelOutput<ChallengeShape>(CHALLENGE_SCHEMA, res.raw).data, ctx);
    } catch (error) {
      result.modelFailure = toModelFailure(error);
    }
  }

  private async dispatchManageState(step: ActionPlan["steps"][number], result: LuiResult, origin: ProvenanceOrigin): Promise<void> {
    // MANAGE_STATE is a state-SELECTION surface, not a research one: it must see which theses
    // exist in order to resolve WHICH one the trader means ("make the halving thesis active").
    // The thesis gate applies to research context; it must not hide the workspace's own object
    // inventory from the action that exists to select from it.
    const ctx = this.researchContext({ includeThesis: true });
    try {
      const res = await this.ask<string>({
        schemaName: "state.change_proposal",
        schemaDescription: STATE_CHANGE_SCHEMA_DESC,
        system: STATE_CHANGE_SYSTEM,
        prompt: [
          `Requested change: ${step.params["objective"] ?? step.description}`,
          "CURRENT WORKSPACE STATE:",
          renderResearchContext(ctx),
        ].join("\n"),
        preferJson: true,
      });
      const proposal = validateModelOutput<StateChangeProposal>(STATE_CHANGE_SCHEMA, res.raw).data;
      // THESIS CREATE (Phase D): a consequential trader action. The LUI only ever PROPOSES it;
      // nothing is persisted until the trader confirms (the same origin-confirmation gate SAVE
      // and MONITOR use). An unconfirmed request halts with awaitingConfirmation and writes
      // NOTHING, so a model sentence can never mint a thesis on its own.
      if (typeof proposal.thesisAction === "string" && proposal.thesisAction.toUpperCase() === "CREATE") {
        const statement = (proposal.params["statement"] ?? step.params["objective"] ?? proposal.description ?? "").trim();
        if (statement === "") {
          result.modelFailure = new ModelFailure("INVALID_OUTPUT", "a thesis needs a statement; the proposal supplied none", false);
          return;
        }
        const confirmed = origin.kind === "trader" && /confirm/i.test(origin.detail ?? "");
        if (!confirmed) {
          result.awaitingConfirmation = { status: "REQUIRED", stepIndex: 0, reason: "creating a thesis is a consequential trader action and requires your explicit confirmation" };
          return;
        }
        const anchorRef = ctx.researchRef ?? ctx.currentResearchRef;
        result.thesis = this.options.workspace.addThesis(
          {
            statement,
            objective: step.params["objective"] ?? statement,
            ...(anchorRef !== undefined ? { linkedResearchRefs: [anchorRef] } : {}),
          },
          origin,
          this.options.now?.(),
        );
        result.stateChange = proposal;
        return;
      }
      // Apply the working-state change (M3 §17: working state ≠ persistent memory).
      if (proposal.changeType === "set-active-thesis" && proposal.params["thesisRef"] !== undefined) {
        // M6 (audit D1): the selection must be APPLIED to working state, not just validated
        // a validated-but-unapplied MANAGE_STATE is a silent no-op (audit finding).
        this.options.workspace.setActiveThesis(proposal.params["thesisRef"]);
      }
      result.stateChange = proposal;
    } catch (error) {
      result.modelFailure = toModelFailure(error);
    }
    void origin;
  }

  private async dispatchMonitor(step: ActionPlan["steps"][number], result: LuiResult): Promise<void> {
    const ctx = this.researchContext();
    try {
      const res = await this.ask<string>({
        schemaName: "monitor.proposal",
        schemaDescription: MONITOR_SCHEMA_DESC,
        system: MONITOR_SYSTEM,
        prompt: [
          `Monitoring request: ${step.params["objective"] ?? step.description}`,
          "VALIDATED RESEARCH CONTEXT:",
          renderResearchContext(ctx),
        ].join("\n"),
        preferJson: true,
      });
      const proposal = validateModelOutput<MonitorProposal>(MONITOR_SCHEMA, res.raw).data;
      result.monitorProposal = { ...proposal, requiresConfirmation: true };
      // M5 §10/§11: the monitoring HANDOFF is persisted as a PROPOSED monitor; representation
      // only, strictly inert. No background process, no alerts, no activation. Activation is a
      // separate trader-confirmed operation (activateMonitor rejects non-trader origins).
      // Invalidation and early-warning conditions are recorded as DISTINCT kinds (M5 §10).
      const thesis = ctx.thesis !== undefined ? this.options.workspace.getThesis(ctx.thesis.ref) : undefined;
      const conditions = [
        ...proposal.invalidationConditions.map((description) => ({
          description, kind: "INVALIDATION" as const, triggerType: "STATE_CHANGE" as const,
          conditionStatus: "PROPOSED" as const, rationale: "invalidation condition; model-proposed; confirm before activation", evidenceDependencies: [] as string[],
        })),
        ...proposal.earlyWarningConditions.map((description) => ({
          description, kind: "EARLY_WARNING" as const, triggerType: "STATE_CHANGE" as const,
          conditionStatus: "PROPOSED" as const, rationale: "early-warning condition; signals rising risk, does NOT invalidate; confirm before activation", evidenceDependencies: [] as string[],
        })),
        ...proposal.conditions.map((description) => ({
          description, kind: "EARLY_WARNING" as const, triggerType: "STATE_CHANGE" as const,
          conditionStatus: "PROPOSED" as const, rationale: "general condition; model-proposed; confirm before activation", evidenceDependencies: [] as string[],
        })),
      ];
      result.monitor = this.options.workspace.addMonitorProposal(
        {
          target: ctx.objective ?? "unspecified target",
          conditions,
          triggerRationale: proposal.scopeNote || "monitor request",
          ...(thesis !== undefined ? { thesisRef: thesis.id, thesisVersion: thesis.version } : {}),
        },
        { kind: "agent", detail: "LUI MONITOR proposal (inert until trader confirmation)" },
        this.options.now?.(),
      );
    } catch (error) {
      result.modelFailure = toModelFailure(error);
    }
  }

  private async dispatchSave(step: ActionPlan["steps"][number], result: LuiResult, origin: ProvenanceOrigin): Promise<void> {
    const ctx = this.researchContext();
    try {
      const res = await this.ask<string>({
        schemaName: "state.save_proposal",
        schemaDescription: SAVE_SCHEMA_DESC,
        system: SAVE_SYSTEM,
        prompt: [
          `Save request: ${step.params["objective"] ?? step.description}`,
          "VALIDATED RESEARCH CONTEXT (source of derivedFromRefs):",
          renderResearchContext(ctx),
        ].join("\n"),
        preferJson: true,
      });
      const proposal = validateModelOutput<SaveProposal>(SAVE_SCHEMA, res.raw).data;
      const known = new Set<string>([
        ...ctx.items.map((i) => i.ref),
        ...ctx.claims.map((c) => c.ref),
        ...ctx.hypotheses.map((h) => h.ref),
        ...(ctx.judgment !== undefined ? [ctx.judgment.ref] : []),
        ...(ctx.thesis !== undefined ? [ctx.thesis.ref] : []),
      ]);
      const derivedFromRefs = proposal.derivedFromRefs.filter((ref) => known.has(ref)); // drop invented refs
      // Only persist when a SAVE was actually confirmed. The LUI-level pre-approval case is
      // `origin` being explicitly trader-kind AND the caller having passed a confirmation hook
      // approval; modeled here by requiring the origin detail to record confirmation.
      const confirmed = origin.kind === "trader" && /confirm/i.test(origin.detail ?? "");
      if (!confirmed) {
        result.awaitingConfirmation = { status: "REQUIRED", stepIndex: 0, reason: "SAVE requires explicit trader confirmation before persistence" };
        return;
      }
      // Phase C: classify the SAVE into a saved-artifact kind. The model's `kind` wins when it
      // is one of the closed vocabulary; otherwise the legacy artifactType maps onto a kind, so
      // a pre-Phase-C model output still persists with a real classification.
      const kind: SavedKind = isSavedKind(proposal.kind)
        ? proposal.kind
        : proposal.artifactType === "research-conclusion"
          ? "JUDGMENT"
          : legacyKindFromType(proposal.artifactType);
      // sourceRef must be a REAL context object: never save against a ref the model invented.
      const knownSource = proposal.sourceRef !== undefined && known.has(proposal.sourceRef) ? proposal.sourceRef : undefined;
      const sourceRef = knownSource
        ?? (kind === "JUDGMENT" ? ctx.judgment?.ref : kind === "EVIDENCE" ? derivedFromRefs[0] : undefined);
      const content = proposal.content ?? step.description;
      // ORIGIN LAW (Phase C): "save this" resolves the current active research context, so a
      // research-anchored SAVE always carries a researchRef (the run the context is anchored
      // to). Only a workspace with no research at all (a pure framework/preference SAVE) is
      // origin-less, and that keeps the legacy create-new behavior.
      const anchorRef = ctx.researchRef ?? ctx.currentResearchRef;
      const input = {
        kind,
        type: proposal.artifactType,
        title: content,
        summary: content,
        content,
        derivedFromRefs,
        rationale: proposal.rationale,
        ...(anchorRef !== undefined ? { researchRef: anchorRef } : {}),
        ...(sourceRef !== undefined ? { sourceRef } : {}),
        ...(ctx.thesis !== undefined ? { thesisRef: ctx.thesis.ref } : {}),
      };
      // Idempotent when research-anchored (same origin + kind + source); a legacy origin-less
      // SAVE keeps create-new semantics.
      const artifact = anchorRef !== undefined
        ? this.options.workspace.upsertSavedArtifact(input, origin, this.options.now?.()).artifact
        : this.options.workspace.saveArtifact(input, origin, this.options.now?.());
      result.saved = artifact;
      // M5 §4: SAVE promotes the artifact into PERSISTENT RESEARCH MEMORY (the existing
      // saveArtifact is the record; the memory entry is the continuity layer with decay and
      // revalidation). Ordinary research never reaches here; only confirmed SAVEs do.
      const memoryCategory = proposal.artifactType === "framework" ? "framework"
        : proposal.artifactType === "thesis" ? "thesis"
        : proposal.artifactType === "preference" ? "preference"
        : "research";
      result.memory = this.options.workspace.addMemory(
        {
          category: memoryCategory,
          content: artifact.content,
          artifactRef: artifact.id,
          ...(anchorRef !== undefined ? { sourceResearchRef: anchorRef } : {}),
          ...(ctx.thesis !== undefined ? { thesisRef: ctx.thesis.ref } : {}),
          contextTags: [],
        },
        origin,
        this.options.now?.(),
      );
    } catch (error) {
      result.modelFailure = toModelFailure(error);
    }
  }

  // ----- response -------------------------------------------------------------

  private async buildResponse(result: LuiResult, userMessage: string): Promise<FinalResponse | undefined> {
    /**
     * SYNTHESIS TURN (Phase 10): "what have we established, and what should I still be watching?"
     *
     * This is the turn that proves a conversation accumulated understanding rather than seven
     * disconnected answers, so its answer is built from the DERIVED investigation state — real
     * evidence, real judgments, real gaps, the trader's own thesis — and not from this run's
     * retrieval alone.
     *
     * It is still not advice. The wording reports what was established, what is contested, what
     * is unresolved and what is worth watching; it never tells the trader what to do, because the
     * decision is theirs.
     */
    if (this.conversationIntent === "SYNTHESIS") {
      const state = this.investigationState();
      if (state !== undefined) return cumulativeSynthesisResponse(state);
    }
    /**
     * OBSERVATION-FLOW RESPONSE CONTRACT (flow isolation; the reproduction this fixes).
     *
     * A flow that is neither causal nor judgmental — WHAT_HAPPENED — answers with its OWN shape: a
     * timestamped timeline of what was directly observed, what was only reported, and what could
     * not be established. It does NOT answer with causal machinery, and the suppression happens
     * HERE, at the layer that selects sections for this flow, not by stripping a causal synthesis
     * at the end: the trader must never receive "strongest support / meaningful opposition /
     * mechanism / transmission / materiality / what would change this conclusion" for a question
     * that forbade all of it in writing. The causal, thesis, counterevidence, materiality and
     * implication fields stay EMPTY, and the confidence states coverage, not conviction.
     */
    if (result.research !== undefined) {
      const runFlow = this.options.workspace.getResearch(result.research.research.id)?.flow;
      const contract = contractFor(runFlow);
      if (contract !== undefined && !contract.causal && !contract.judgmental) {
        const rendered = renderObservationResponse({
          evidence: result.research.evidence,
          requirements: result.research.requirements ?? [],
        });
        // Findings for this flow are its DIRECT OBSERVATIONS — not factors, not drivers, not
        // opposition. The field stays populated so the response law (an answer carries findings
        // and a named uncertainty) holds for every research response, but its content can only
        // ever be something this run observed.
        const findings = result.research.evidence.filter(isDirectObservation).slice(0, 4)
          .map((e) => e.observation.replace(/\s+/g, " ").trim().slice(0, 140));
        return {
          answer: rendered.answer,
          supportingReasons: findings,
          opposingReasons: [],
          confidence: result.research.evidence.length >= 3 ? "MODERATE" : result.research.evidence.length >= 1 ? "LOW" : "UNKNOWN",
          // Uncertainty for a reconstruction is what could NOT be reconstructed. It is never
          // "no material counterevidence found" and never a monitoring instruction: this flow
          // searched for no counterevidence because its contract owes none.
          keyUncertainty: rendered.gaps[0]
            ?? (result.research.evidence.length > 0
              ? "the observations above are the complete record this run retrieved; nothing in the requested window was left unestablished"
              : "no observation was retrieved for the requested window"),
          implication: "",
          citedObjectRefs: [...rendered.citedObjectRefs],
        };
      }
    }
    /**
     * RAW-OBSERVATION RESPONSE (execution contract): the requested fields and nothing else.
     *
     * Placed ahead of every other branch because a raw observation request must not acquire a
     * finding, an opposing reason, an implication or a model-polished narrative on the way out.
     * The answer text is already rendered from the run's own evidence by the adaptive loop; here
     * it is passed through with the supporting/opposing/implication fields EMPTY and the run's
     * evidence as citations, so the response carries the measurement and its provenance and no
     * interpretation of it.
     */
    if (isObservationMode(this.executionConstraints) && result.research !== undefined) {
      const evidenceRefs = result.research.evidence.slice(0, 6).map((e) => e.id);
      return {
        answer: result.research.answer ?? result.research.evidence.slice(0, 1).map((e) => e.observation).join(""),
        supportingReasons: [],
        opposingReasons: [],
        // Confidence about a MEASUREMENT is not a claim about its meaning; a retrieved
        // observation is reported as observed, without a conviction level attached to it.
        confidence: result.research.evidence.length > 0 ? "MODERATE" : "UNKNOWN",
        keyUncertainty: "",
        implication: "",
        citedObjectRefs: evidenceRefs,
      };
    }
    // M4: flow-specific responses are already progressive-disclosure structured; convert to
    // the FinalResponse shape without re-synthesizing (the flow output IS the answer).
    const flowResult = result.flow2 ?? result.flow6 ?? result.flow7 ?? result.flow3 ?? result.flow4 ?? result.flow8 ?? result.flow5;
    if (flowResult !== undefined) {
      const answerText = flowResult.response;
      // Confidence for a degraded flow (no synthesis) comes from the ENGINE's computed
      // components, never from a model level that was never produced: coreCoverage=0 with a
      // synthesis-less run must read LOW/UNKNOWN, not MODERATE (state-consistency law).
      const degradedConfidence = flowResult.modelFailure !== undefined
        ? ((flowResult.outcome.evidence.length >= 3 ? "LOW" : "UNKNOWN") as FinalResponse["confidence"])
        : undefined;
      const cited = result.flow2?.synthesis?.citedObjectRefs ?? result.flow6?.synthesis?.citedObjectRefs ?? result.flow7?.assessment?.citedObjectRefs
        ?? result.flow3?.landscape?.citedObjectRefs ?? result.flow4?.evaluation?.citedObjectRefs ?? result.flow8?.evaluation?.citedObjectRefs
        ?? result.flow5?.outcome.evidence.slice(0, 6).map((e) => e.id) ?? [];
      const confidence = result.flow2?.synthesis?.confidence ?? result.flow6?.synthesis?.confidence ?? result.flow7?.assessment?.confidence
        ?? result.flow3?.landscape?.confidence ?? result.flow4?.evaluation?.confidence ?? result.flow8?.evaluation?.confidence
        ?? (result.flow5 !== undefined ? (result.flow5.outcome.evidence.length >= 3 ? "MODERATE" : result.flow5.outcome.evidence.length >= 1 ? "LOW" : "UNKNOWN") : undefined) ?? "UNKNOWN";
      const keyUncertainty = [
        ...(result.flow2?.synthesis?.uncertainty ?? []),
        ...(result.flow6?.synthesis?.uncertainty ?? []),
        ...(result.flow7?.assessment?.earlyWarnings ?? []),
        ...(result.flow3?.landscape?.uncertainty ?? []),
        ...(result.flow4?.evaluation?.unresolved ?? []),
        ...(result.flow8?.evaluation?.unresolved ?? []),
        ...(result.flow5 !== undefined && result.flow5.outcome.evidence.length === 0
          ? ["historical precedent data for this asset is unavailable until a historical market-data provider is connected" as const]
          : []),
      ][0] ?? "see research state";
      const opposing = [
        ...(result.flow2?.synthesis?.contradictions ?? []),
        ...(result.flow6?.synthesis?.disagreements.map((d) => `${d.sideA} ↔ ${d.sideB}`) ?? []),
        ...(result.flow7?.assessment?.contradictionsFound.map((c) => c.description) ?? []),
        ...(result.flow3?.landscape?.factors.filter((f) => f.contradictingRefs.length > 0).map((f) => `${f.name} weakened by counterevidence`) ?? []),
        ...(result.flow4?.evaluation?.strongestOpposition ?? []),
        ...(result.flow8?.evaluation?.contradictions ?? []),
      ].slice(0, 4);
      return {
        answer: answerText,
        supportingReasons: [], // already embedded in the flow's structured answer
        opposingReasons: opposing,
        confidence: degradedConfidence ?? (confidence as FinalResponse["confidence"]),
        keyUncertainty,
        implication: "Deeper disclosure levels available; the trader decides.",
        citedObjectRefs: cited,
      };
    }
    // Honest failure response; never fabricate (M3 §19/§20).
    if (result.modelFailure !== undefined && result.research === undefined && result.analysis === undefined && result.challenge === undefined) {
      return {
        answer: `The interpretation model is currently unavailable, so this request could not be processed: ${result.modelFailure.message}`,
        supportingReasons: [],
        opposingReasons: [],
        confidence: "UNKNOWN",
        keyUncertainty: "model provider failure; research state is preserved and the request can be retried",
        implication: "No research was executed and nothing was changed.",
        citedObjectRefs: [],
      };
    }

    const disclosureLevel = result.request.disclosureLevel;
    const research = result.research;
    const analysis = result.analysis;
    const challenge = result.challenge;

    // Deterministic Level-0/1 response from real outcome objects (answer-first, no CoT dump).
    if (research !== undefined && research.evidence.length > 0) {
      const cited = research.evidence.slice(0, 6).map((e) => e.id);
      // The rationale IS the trader-facing answer. If the decision model wrote process
      // commentary instead of findings ("sufficient observations have been gathered"),
      // compose the answer deterministically from the strongest evidence instead: the
      // substance the user needs is in the observations, not in a description of the run.
      const isProcessCommentary =
        /sufficient .*(observation|evidence|data).*(gather|collect|satisf)/i.test(research.finalDecision.rationale) ||
        /^(the )?research (was |has )?(completed|conducted)/i.test(research.finalDecision.rationale) ||
        // Final-judgment contract: a stats-led or bookkeeping opener is scene-setting, not
        // an answer ("Current macroeconomic conditions show...", "Comprehensive evidence...").
        /^(current (market|macroeconomic)? ?conditions|comprehensive evidence|evidence (indicates|suggests|shows|has been)|market data shows?|based on (the )?(evidence|research))/i.test(research.finalDecision.rationale);
      // The run's synthesized ANSWER (analysis of the validated evidence against the trader's
      // question) outranks the stop-decision rationale, which only says whether research could
      // end. Falling back keeps the deterministic evidence-grounded response when synthesis
      // was impossible; nothing is fabricated either way.
      const answer = research.answer !== undefined
        ? research.answer
        : isProcessCommentary
          ? `What the evidence shows: ${research.evidence.slice(0, 3).map((e) => summarize(e.observation, 140)).join("; ")}.`
          : research.finalDecision.rationale;
      // Findings follow the synthesis (question-shaped), not evidence order: each factor's
      // strongest support, then its counterevidence. Evidence-order bullets reproduced the
      // retrieval sequence (price, then klines, then headlines) instead of the analysis.
      const supportingReasons = research.synthesis !== undefined
        ? research.synthesis.keyFactors.flatMap((f) =>
            f.evidenceRefs.slice(0, 1).map((ref) => {
              const ev = research.evidence.find((e) => e.id === ref);
              return ev !== undefined ? `${f.factor}: ${summarize(ev.observation, 140)}` : `${f.factor}`;
            }),
          ).slice(0, 6)
        : research.evidence.slice(0, 4).map((e) => `${e.evidenceClass.toLowerCase()}: ${summarize(e.observation)}`);
      const opposingReasons = research.synthesis !== undefined
        ? research.synthesis.keyFactors.flatMap((f) =>
            f.counterevidenceRefs.slice(0, 1).map((ref) => {
              const ev = research.evidence.find((e) => e.id === ref);
              return ev !== undefined ? `${f.factor} weakened: ${summarize(ev.observation, 140)}` : "";
            }).filter((s) => s !== ""),
          ).slice(0, 4)
        : [];
      const response: FinalResponse = {
        answer,
        supportingReasons,
        opposingReasons,
        confidence: (research.synthesis?.confidence as FinalResponse["confidence"] | undefined)
          ?? (research.evidence.length >= 3 ? "MODERATE" : research.evidence.length >= 1 ? "LOW" : "UNKNOWN"),
        // Uncertainty rule: the fallback must name what is unresolved (the engine's own
        // research gaps when present), never the "monitoring required" filler. When nothing
        // is unresolved, say what the conclusion rests on instead of manufacturing a doubt.
        keyUncertainty: research.synthesis?.uncertainty[0]
          ?? firstUnresolvedRequirement(research.requirements ?? [])
          ?? (research.finalDecision.decision === "COMPLETE"
            ? "The collected evidence covered the research requirements; the conclusion rests on the cited observations."
            : research.finalDecision.rationale),
        implication: research.synthesis?.implication
          ?? `This run ended with decision ${research.finalDecision.decision}; the cited evidence is the basis for your own call.`,
        citedObjectRefs: (research.synthesis?.citedObjectRefs.length ?? 0) > 0 ? [...research.synthesis!.citedObjectRefs] : cited,
      };
      // Model-polished response only when the disclosure level requests more than the default
      // and even then from the validated context only.
      if (disclosureLevel >= 2) {
        try {
          const ctx = research.context;
          const res = await this.ask<string>({
            schemaName: "response.final",
            schemaDescription: FINAL_RESPONSE_SCHEMA_DESC,
            system: RESPONSE_SYSTEM,
            prompt: [
              `Trader message: "${userMessage}"`,
              `Disclosure level requested: ${disclosureLevel}`,
              "RESEARCH OUTCOME (validated):",
              renderResearchContext(ctx),
            ].join("\n"),
            preferJson: true,
          });
          const polished = validateModelOutput<FinalResponse>(FINAL_RESPONSE_SCHEMA, res.raw).data;
          return this.validateCitations<FinalResponse>(polished, ctx);
        } catch (error) {
          // Model polish failed; return the deterministic response (never fabricate).
          void toModelFailure(error);
          return response;
        }
      }
      return response;
    }

    if (analysis !== undefined || challenge !== undefined) {
      const ctx = this.researchContext();
      const cited = [...(analysis?.citedObjectRefs ?? []), ...(challenge?.citedObjectRefs ?? [])].filter((ref) => objectExists(ctx, ref));
      const verdict = challenge !== undefined
        // TRADER LANGUAGE, not engine vocabulary: the internal capability name never appears in
        // an answer, and the verdict leads with what it MEANS for the trader's own view.
        ? `**Verdict:** ${CHALLENGE_VERDICT_PLAIN[challenge.falsificationVerdict] ?? challenge.falsificationVerdict}. ${challenge.rationale}`
        : (analysis?.conclusion ?? "");
      return {
        answer: verdict,
        supportingReasons: (analysis?.supportingReasons ?? []).slice(0, 4),
        opposingReasons: [...(analysis?.opposingReasons ?? []), ...(challenge?.searchedContradictions ?? [])].slice(0, 4),
        confidence: challenge !== undefined && challenge.falsificationVerdict === "WEAKENED" ? "LOW" : "MODERATE",
        keyUncertainty: (analysis?.uncertainty ?? challenge?.missingEvidence ?? []).join("; ") || "see research state for open questions",
        implication: challenge?.falsificationVerdict === "WEAKENED"
          ? "The challenged statement has material contradictions in the current evidence; consider reassessing."
          : "Deeper levels (evidence/structure/trail) are available on request.",
        citedObjectRefs: [...new Set(cited)],
      };
    }

    if (result.stateChange !== undefined) {
      // M6 (audit D2): a successful MANAGE_STATE must not fall through to "produced no research
      // outcome"; it changed working state, and the response must say what changed.
      const change = result.stateChange;
      return {
        answer: `Working state updated (${change.changeType}): ${change.description}`,
        supportingReasons: [change.rationale],
        opposingReasons: [],
        confidence: "HIGH",
        keyUncertainty: "",
        implication: "Working state only; persistent memory was not changed (SAVE is a separate action).",
        citedObjectRefs: [],
      };
    }

    if (result.thesis !== undefined) {
      return {
        answer: `Thesis created (${result.thesis.id}, ${result.thesis.status}): ${summarize(result.thesis.statement)}`,
        supportingReasons: [`trader-owned; status ${result.thesis.status}; ${result.thesis.provenance.length} provenance entries`],
        opposingReasons: [],
        confidence: "HIGH",
        keyUncertainty: "",
        implication: "The thesis is yours; assessments evaluate it but never rewrite it.",
        citedObjectRefs: [result.thesis.id],
      };
    }

    if (result.saved !== undefined) {
      return {
        answer: `Saved (${result.saved.type}): ${summarize(result.saved.content)}`,
        supportingReasons: [`derived from ${result.saved.derivedFromRefs.length} workspace object(s)`],
        opposingReasons: [],
        confidence: "HIGH",
        keyUncertainty: "",
        implication: "The artifact is in persistent workspace memory and traceable via provenance.",
        citedObjectRefs: [result.saved.id],
      };
    }

    if (result.monitorProposal !== undefined) {
      return {
        answer: `Monitoring proposal prepared (${result.monitorProposal.conditions.length} condition(s)); awaiting your confirmation to activate.`,
        supportingReasons: result.monitorProposal.conditions.slice(0, 3),
        opposingReasons: [],
        confidence: "UNKNOWN",
        keyUncertainty: "monitor activation is a consequential action and requires your explicit confirmation",
        implication: "No monitor is active yet.",
        citedObjectRefs: [],
      };
    }

    if (result.awaitingConfirmation?.status === "REQUIRED") {
      return {
        answer: result.awaitingConfirmation.reason,
        supportingReasons: [],
        opposingReasons: [],
        confidence: "UNKNOWN",
        keyUncertainty: "waiting for your confirmation",
        implication: "Nothing was changed or persisted yet.",
        citedObjectRefs: [],
      };
    }

    return {
      answer: `Request understood (${result.request.primaryAction}) but produced no research outcome; ${result.research !== undefined ? "see research state" : "no state was changed"}.`,
      supportingReasons: [],
      opposingReasons: [],
      confidence: "UNKNOWN",
      keyUncertainty: "the interpreted request did not map to an executable research outcome",
      implication: "Rephrase or add detail (asset, timeframe, objective).",
      citedObjectRefs: [],
    };
  }

  // ----- helpers ----------------------------------------------------------------

  private researchContext(opts: { researchRef?: string; includeThesis?: boolean; historical?: "none" | "reference" } = {}): ResearchContext {
    return buildResearchContext(this.options.workspace, {
      ...(opts.researchRef !== undefined ? { researchRef: opts.researchRef } : {}),
      // THESIS GATE: the trader's thesis is research context only for thesis-facing work —
      // the thesis/framework flows, or a request that explicitly names the thesis. An
      // independent question must never inherit an unrelated active thesis.
      ...(opts.includeThesis ?? this.thesisContextRequired ? { includeThesis: true } : {}),
      ...(opts.historical !== undefined ? { historical: opts.historical } : {}),
    });
  }

  private validateTarget(data: ResolvedTarget): ResolvedTarget {
    // Canonical-instrument law: a model-resolved asset for a named non-equity instrument
    // must be the tradable instrument, not a same-ticker listing in a different domain.
    // Live failure: "could a shutdown affect gold..." resolved asset "GOLD"; the equity
    // chain served Gold.com (NYSE: GOLD) at $44.8 and the analysis described a mining
    // company. resolveInstrument is a fact about the language (gold -> GC=F) and wins
    // whenever the resolved asset text names (or equals) a canonical instrument.
    const rawAsset = data.asset?.trim() ?? "";
    const instrument = rawAsset !== "" ? resolveInstrument(rawAsset) : undefined;
    const canonical =
      instrument !== undefined && (rawAsset.toUpperCase() === instrument.name.toUpperCase() || instrument.subjectTerms.some((t) => rawAsset.toUpperCase().includes(t) || t.includes(rawAsset.toUpperCase())))
        ? instrument.symbol
        : rawAsset !== "" && /^[a-z]/i.test(rawAsset) && resolveInstrument(rawAsset) !== undefined
          ? resolveInstrument(rawAsset)!.symbol
          : rawAsset !== ""
            ? rawAsset
            : undefined;
    return {
      objectRefs: data.objectRefs ?? [],
      unresolved: data.unresolved ?? [],
      ...(canonical !== undefined ? { asset: canonical } : {}),
      ...(data.flow !== undefined ? { flow: data.flow } : {}),
      ...(data.researchRef !== undefined && data.researchRef !== "" ? { researchRef: data.researchRef } : {}),
    };
  }

  /** Drop invented citations; only refs present in the context survive (M3 §21). */
  private validateCitations<T extends { citedObjectRefs?: readonly string[] }>(data: T, ctx: ResearchContext): T {
    if (data.citedObjectRefs === undefined) return data;
    const known = new Set<string>([
      ...ctx.items.map((i) => i.ref),
      ...ctx.claims.map((c) => c.ref),
      ...ctx.hypotheses.map((h) => h.ref),
      ...(ctx.judgment !== undefined ? [ctx.judgment.ref] : []),
      ...(ctx.thesis !== undefined ? [ctx.thesis.ref] : []),
    ]);
    return { ...data, citedObjectRefs: data.citedObjectRefs.filter((ref) => known.has(ref)) };
  }

  private failureResult(
    _userMessage: string,
    error: unknown,
    request?: NormalizedRequest,
    target?: ResolvedTarget,
  ): LuiResult {
    const failure = toModelFailure(error);
    return {
      request: request ?? {
        primaryAction: "RESEARCH",
        compoundActions: [],
        objective: _userMessage,
        isExplanationOnly: false,
        disclosureLevel: 0,
      },
      ...(target !== undefined
        ? { target }
        : {
            target: {
              objectRefs: [],
              unresolved: ["target not resolved; interpretation failed"],
            } as ResolvedTarget,
          }),
      ambiguity: { isAmbiguous: false, questions: [], reason: "" },
      consequence: { level: "INFORMATIONAL", rationale: "not assessed; model failure", requiresConfirmation: false },
      plan: { steps: [], requiresConfirmationFor: [] },
      modelFailure: failure,
      response: {
        answer: `The request could not be interpreted: ${failure.message}`,
        supportingReasons: [],
        opposingReasons: [],
        confidence: "UNKNOWN",
        keyUncertainty: "model provider failure; nothing was executed and no state was changed",
        implication: "Retry when the model provider is available.",
        citedObjectRefs: [],
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

interface AnalysisShape extends ModelAnalysis {}
interface ChallengeShape extends ChallengeResult {}

function toModelFailure(error: unknown): ModelFailure {
  return error instanceof ModelFailure
    ? error
    : new ModelFailure("INVALID_OUTPUT", error instanceof Error ? error.message : String(error), false);
}

/** First CRITICAL requirement not satisfied: the honest fallback uncertainty source. */
function firstUnresolvedRequirement(requirements: readonly { readonly importance: string; readonly status: string; readonly description: string }[]): string | undefined {
  const gap = requirements.find((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED");
  return gap?.description;
}

/**
 * TARGET LAW (question-centric research): a model-resolved target asset may carry into
 * research dispatch ONLY when the question text itself names it (ticker word, known alias,
 * or canonical instrument). The target-resolution model sees workspace context and inherits
 * the most recent research subject (live failure: after a BTC run, the macro regime question
 * arrived with asset BTC, which routed crypto capabilities AND admitted crypto evidence as
 * subject-consistent). A question the message never names is not the message's target.
 * Trader material (thesis/framework) explicitly waives this: continuing the thesis's asset
 * IS the request's semantics.
 */
function assetIsNamedByQuestion(message: string, objective: string, asset: string): boolean {
  if (questionNamesAsset(message, asset) || questionNamesAsset(objective, asset)) return true;
  const instrument = resolveInstrument(message);
  if (instrument !== undefined && (instrument.symbol === asset.toUpperCase() || instrument.subjectTerms.includes(asset.toUpperCase()))) return true;
  return false;
}

/**
 * TARGET LAW at the capability boundary: the asset a capability is dispatched with must be
 * earned by the question text. A plan/model-supplied asset the question never names cannot
 * route capabilities — live failure: "what happened to the dollar this week" dispatched the
 * plan's asset "USD", which Yahoo Finance serves as ProShares Ultra Semiconductors, so a
 * dollar run gathered leveraged-semiconductor ETF candles as dollar evidence. When the
 * question names a canonical instrument (dollar -> DX-Y.NYB) that instrument is dispatched
 * instead; when it names no instrument, no asset is sent at all.
 */
function earnedCapabilityAsset(
  message: string | undefined,
  objective: string,
  candidate: string | undefined,
): string | undefined {
  const named = candidate?.trim();
  if (named !== undefined && named !== "" && assetIsNamedByQuestion(message ?? objective, objective, named)) {
    return resolveInstrument(named)?.symbol ?? named;
  }
  const canonical = resolveInstrument(objective) ?? (message !== undefined ? resolveInstrument(message) : undefined);
  if (canonical !== undefined) return canonical.symbol;
  // Last resort (unchanged behavior): an exact ticker-shaped token in the objective is named by
  // the question's own step text.
  return /\b[A-Z][A-Z0-9]{1,5}\b/.exec(objective)?.[0];
}

function summarize(text: string, max = 160): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.title === "string") return parsed.title.slice(0, max);
  } catch {
    // not JSON
  }
  return text.slice(0, max);
}

function objectExists(ctx: ResearchContext, ref: string): boolean {
  return (
    ctx.items.some((i) => i.ref === ref) ||
    ctx.claims.some((c) => c.ref === ref) ||
    ctx.hypotheses.some((h) => h.ref === ref) ||
    ctx.judgment?.ref === ref ||
    ctx.thesis?.ref === ref
  );
}

/** Exposed for tests: the exact thesis type the workspace persists. */
export type { Thesis, SavedArtifact };
