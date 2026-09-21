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

import type { ModelProvider } from "../model/provider.js";
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
import type { ProvenanceOrigin } from "../domain/provenance.js";
import { resolveInstrument, questionNamesAsset } from "../domain/instruments.js";
import type { WorkspaceStore } from "../persistence/index.js";
import { runAdaptiveResearch, type AdaptiveLoopOutcome, MAX_RESEARCH_ROUNDS } from "../research/adaptive.js";
import { progressEvent, type ProgressListener } from "../research/progress.js";
import { buildResearchContext, renderResearchContext, type ResearchContext } from "../research/context.js";

export { MAX_RESEARCH_ROUNDS };

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
  '{"artifactType": string, "content": string, "derivedFromRefs": string[], "rationale": string}',
].join("\n");

const STATE_CHANGE_SCHEMA_DESC = [
  '{"changeType": string, "description": string, "params": Record<string,string>, "rationale": string}',
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
  "- isExplanationOnly=true when the trader only asks why/how/what-did-you-find about existing research.",
  "- disclosureLevel: 0 answer, 1 why, 2 evidence, 3 research structure, 4 source trail, 5 full history.",
  "- Copy the trader's objective verbatim; never paraphrase it into something stronger or weaker.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const TARGET_SYSTEM = [
  "Resolve the trader's request target from the conversation/workspace context provided.",
  "Rules:",
  "- Resolve 'it', 'that', 'my thesis' etc. from the CURRENT WORKSPACE STATE only.",
  "- NEVER invent research/object ids. Anything not resolvable goes into `unresolved`.",
  "- `flow` must be one of: WHAT_HAPPENED, WHY_IT_HAPPENED, WHAT_COULD_AFFECT_IT, DOES_MY_THESIS_HOLD, HAS_THIS_HAPPENED_BEFORE, WHAT_DOES_ALL_INFORMATION_SAY, WHAT_COULD_PROVE_ME_WRONG, EVALUATE_WITH_MY_FRAMEWORK.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const AMBIGUITY_SYSTEM = [
  "Detect GENUINE ambiguity that blocks correct execution.",
  "Ambiguous: unclear asset, unclear timeframe for consequential actions, unclear which thesis/framework/state object when several exist, unclear requested persistence.",
  "NOT ambiguous: ordinary research where context resolves the target; do not ask unnecessary questions.",
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
  "- Suggest cadence/scope. Activation itself requires explicit trader confirmation and is built in a later phase; never claim a monitor was activated.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const SAVE_SYSTEM = [
  "Prepare a SAVE proposal: promote the trader-validated content into persistent reusable memory.",
  "- artifactType: one of finding | research-conclusion | framework | preference | other.",
  "- content: the exact content to persist (the trader's finding/conclusion, not your opinion).",
  "- derivedFromRefs: object refs from the provided context the artifact derives from; provenance, never invented.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

const STATE_CHANGE_SYSTEM = [
  "Prepare a MANAGE_STATE change proposal for ACTIVE WORKING STATE (change active target, update working research state, select framework for the session).",
  "- This is distinct from SAVE: working-state changes are not persistent memory.",
  "- Describe precisely what changes; params carry the concrete values.",
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

export class Lui {
  private currentMessage: string | undefined;

  constructor(private readonly options: LuiOptions) {}

  /** Main entry: one user message → validated pipeline → LuiResult.
   *  `onProgress` (F0 SSE seam) receives REAL pipeline-stage events when supplied. */
  async handle(
    userMessage: string,
    origin: ProvenanceOrigin = { kind: "trader", detail: "LUI message" },
    onProgress?: ProgressListener,
    /** Wall-clock deadline (epoch ms) threaded into every research loop (honest time budget). */
    deadlineMs?: number,
  ): Promise<LuiResult> {
    const provider = this.options.provider;
    const progress = onProgress ?? this.options.onProgress;
    // The verbatim message, kept for the target law (a model-resolved asset is only the
    // question's target when the QUESTION ITSELF names it).
    this.currentMessage = userMessage;

    // 1–2. INPUT NORMALIZATION + INTENT DETECTION (validated; model failure aborts honestly).
    progress?.(progressEvent("request_accepted", new Date(), "request accepted", { messageLength: userMessage.length }));
    let request: NormalizedRequest;
    try {
      const res = await provider.structured<string>({
        schemaName: "lui.normalized_request",
        schemaDescription: NORMALIZED_REQUEST_SCHEMA_DESC,
        system: INTERPRETER_SYSTEM,
        prompt: `Trader message: "${userMessage}"\nRespond as JSON conforming to schema "lui.normalized_request".\n${NORMALIZED_REQUEST_SCHEMA_DESC}`,
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
      const res = await provider.structured<string>({
        schemaName: "lui.resolved_target",
        schemaDescription: RESOLVED_TARGET_SCHEMA_DESC,
        system: TARGET_SYSTEM,
        prompt: [
          `Trader message: "${userMessage}"`,
          `Interpreted objective: ${request.objective}`,
          `Primary action: ${request.primaryAction}`,
          "CURRENT WORKSPACE STATE:",
          renderResearchContext(this.researchContext()),
        ].join("\n"),
        preferJson: true,
      });
      target = this.validateTarget(validateModelOutput<ResolvedTarget>(RESOLVED_TARGET_SCHEMA, res.raw).data);
      progress?.(progressEvent("target_resolved", new Date(), "target resolved from workspace context", {}));
    } catch (error) {
      return this.failureResult(userMessage, error, request);
    }

    // 5. AMBIGUITY CHECK; genuinely ambiguous consequential actions block execution.
    let ambiguity: AmbiguityAssessment;
    try {
      const res = await provider.structured<string>({
        schemaName: "lui.ambiguity",
        schemaDescription: AMBIGUITY_SCHEMA_DESC,
        system: AMBIGUITY_SYSTEM,
        prompt: [
          `Trader message: "${userMessage}"`,
          `Primary action: ${request.primaryAction}`,
          `Resolved target: ${JSON.stringify(target)}`,
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
      const res = await provider.structured<string>({
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
      const res = await provider.structured<string>({
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
      const res = await provider.structured<string>({
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

    for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex += 1) {
      const step = plan.steps[stepIndex];
      if (step === undefined) break; // noUncheckedIndexedAccess guard (array cannot shrink here)
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
          const flow = step.params["flow"];
          if (flow === "WHY_IT_HAPPENED" || flow === "WHAT_DOES_ALL_INFORMATION_SAY" || flow === "WHAT_COULD_AFFECT_IT" || flow === "DOES_MY_THESIS_HOLD" || flow === "EVALUATE_WITH_MY_FRAMEWORK" || flow === "HAS_THIS_HAPPENED_BEFORE") {
            await this.dispatchM4Flow(flow, step, result, origin, progress, deadlineMs);
            break;
          }
          const research = await this.dispatchResearch(step, origin, progress, deadlineMs, target.asset);
          result.research = research.outcome;
          if (research.modelFailure !== undefined) result.modelFailure = research.modelFailure;
          break;
        }
        case "ANALYZE":
          if (step.params["mode"] === "thesis" || step.params["thesis"] !== undefined) {
            await this.dispatchThesisAssessment(step, result);
          } else {
            await this.dispatchAnalyze(step, result, origin, progress, deadlineMs);
          }
          break;
        case "CHALLENGE":
          // M4 §23: CHALLENGE (LUI action) with a falsification objective invokes Flow 7
          // the research METHODOLOGY. The action and the flow remain distinct.
          if (target.flow === "WHAT_COULD_PROVE_ME_WRONG" || step.params["flow"] === "WHAT_COULD_PROVE_ME_WRONG" || step.params["mode"] === "falsification") {
            await this.dispatchFlow7(step, result, origin, progress, deadlineMs);
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
    const asset = step.params["asset"]
      ?? (inheritedEarned ? inherited : undefined)
      ?? resolveInstrument(objective)?.symbol
      ?? objectiveTicker
      ?? (referencesTraderMaterial ? this.options.workspace.activeTheses()[0]?.scope.entities[0] : undefined);
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
    const asset = step.params["asset"];
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

  private async dispatchResearch(
    step: ActionPlan["steps"][number],
    origin: ProvenanceOrigin,
    onProgress?: ProgressListener,
    deadlineMs?: number,
    resolvedAsset?: string,
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
    const research = workspace.addResearch(
      { objective, question: objective, flow: step.params["flow"] ?? "WHAT_DOES_ALL_INFORMATION_SAY" },
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
        constraints: step.params["constraints"] !== undefined ? step.params["constraints"].split(";").map((s) => s.trim()).filter((s) => s !== "") : [],
        capabilityParams: {
          // Same deterministic backstop as dispatchM4Flow: the resolved target, a canonical
          // instrument (oil -> CL=F), or an exact ticker in the objective must reach
          // capability params even when the plan step omitted the asset; symbol-scoped
          // adapters SCHEMA_ERROR otherwise, and the chain would fall through to
          // domain-wrong fallbacks. TARGET LAW: a resolvedAsset that the question text does
          // not name is dropped here too (the workspace-inheritance path) so crypto
          // capabilities are never routed for a macro question. Priority: explicit step
          // asset > LUI-resolved target (only when question-earned) > canonical instrument >
          // ticker-shaped token.
          ...((step.params["asset"] ?? earnedResolvedAsset ?? resolveInstrument(step.params["objective"] ?? step.description)?.symbol ?? /\b[A-Z][A-Z0-9]{1,5}\b/.exec(step.params["objective"] ?? step.description)?.[0]) !== undefined
            ? { asset: (step.params["asset"] ?? earnedResolvedAsset ?? resolveInstrument(step.params["objective"] ?? step.description)?.symbol ?? /\b[A-Z][A-Z0-9]{1,5}\b/.exec(step.params["objective"] ?? step.description)?.[0]) as string }
            : {}),
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
      const res = await this.options.provider.structured<string>({
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
      const res = await this.options.provider.structured<string>({
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
      const res = await this.options.provider.structured<string>({
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
    const ctx = this.researchContext();
    try {
      const res = await this.options.provider.structured<string>({
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
      const res = await this.options.provider.structured<string>({
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
      const res = await this.options.provider.structured<string>({
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
      const artifact = this.options.workspace.saveArtifact(
        {
          type: proposal.artifactType,
          content: proposal.content ?? step.description,
          derivedFromRefs,
          rationale: proposal.rationale,
          ...(ctx.researchRef !== undefined ? { researchRef: ctx.researchRef } : {}),
          ...(ctx.thesis !== undefined ? { thesisRef: ctx.thesis.ref } : {}),
        },
        origin,
        this.options.now?.(),
      );
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
          ...(ctx.researchRef !== undefined ? { sourceResearchRef: ctx.researchRef } : {}),
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
    // M4: flow-specific responses are already progressive-disclosure structured; convert to
    // the FinalResponse shape without re-synthesizing (the flow output IS the answer).
    const flowResult = result.flow2 ?? result.flow6 ?? result.flow7 ?? result.flow3 ?? result.flow4 ?? result.flow8 ?? result.flow5;
    if (flowResult !== undefined) {
      const answerText = flowResult.response;
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
        ...(result.flow5 !== undefined
          ? ["historical comparison is available only through a connected G1 historical-data provider" as const]
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
        confidence: confidence as FinalResponse["confidence"],
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
          const res = await this.options.provider.structured<string>({
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
        ? `falsification verdict: ${challenge.falsificationVerdict}; ${challenge.rationale}`
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

  private researchContext(opts: { researchRef?: string } = {}): ResearchContext {
    return buildResearchContext(this.options.workspace, {
      ...(opts.researchRef !== undefined ? { researchRef: opts.researchRef } : {}),
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
