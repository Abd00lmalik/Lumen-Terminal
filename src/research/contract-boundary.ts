/**
 * SHARED FINAL CONTRACT VALIDATION BOUNDARY (research contract, system-wide law).
 *
 * The contract must be a system invariant, not an adaptive-loop-only invariant. Every research
 * path that produces a user-visible judgment passes through THIS boundary before its result is
 * rendered or persisted:
 *
 *   research result → judgment/prose → validateContractOutcome (HERE) → completion/confidence
 *   laws → persistence / user-visible result
 *
 *              adaptive loop ──┐
 *                              ├──> validateContractOutcome ──> validated outcome
 *              flow runner  ───┘        (same violation set, same confidence ceiling,
 *                                        same completion gate, one mechanism)
 *
 * What it enforces (from the ONE existing validator, contract-checks.ts — never a second one):
 *   - assertive causal claims over unsupported/never-researched transmission links;
 *   - claims whose required evidence is unresolved, stale-only, or unsearched;
 *   - counterevidence claims without an actual disconfirmation attempt;
 *   - comparison/event facts without the corresponding evidence class.
 * And from the engine's ledger (not the prose): EVIDENCE_SUFFICIENT is demoted whenever a
 * CRITICAL requirement remains uncovered, and confidence is capped at the computed ceiling.
 *
 * Epistemic separation is preserved: the validator checks CLAIMS against the ledger. It does
 * not reclassify anything; observations stay observations, interpretations stay interpretations,
 * hypotheses stay hypotheses, causal claims stay causal claims — an unsupported causal claim is
 * rejected or downgraded, never silently relabeled.
 *
 * Failures are recorded on the outcome (violationReport) instead of being swallowed, so an
 * external benchmark can see every rejection the boundary made.
 */
import type { ConfidenceComponents, ConfidenceLevel } from "./confidence.js";
import {
  contractGapStatement,
  contractViolations,
  stripUnsupportedClaims,
  type ContractState,
  type ContractViolation,
} from "./contract-checks.js";
import { computeConfidence } from "./confidence.js";
import { blockingRequirements, type ResearchRequirement } from "./requirements.js";
import {
  evaluateQuestionResolution,
  resolutionConfidenceCeiling,
  type QuestionResolution,
} from "./question-resolution.js";

/** The prose a research path produced for the trader (flow response or adaptive answer). */
export interface ContractOutcomeInput {
  /** The path's user-visible prose (its own rendering; the boundary enforces, never re-writes). */
  readonly prose: string;
  /** The requirement ledger at the end of the run (rows carry their link/quality fields). */
  readonly ledger: ContractState["ledger"];
  /** Text of the evidence the answer drew on (observations + declared subjects). */
  readonly evidenceText: string;
  /** Capabilities that actually executed (attempt semantics for counterevidence claims). */
  readonly executedCapabilities: readonly string[];
  /** The engine-assessed stop reason BEFORE the boundary applies the completion law. */
  readonly stoppedBecause: string;
  /** Capabilities that failed during the run (confidence input). */
  readonly failedPaths: number;
  /** Required calculations the engine could not perform (confidence input). */
  readonly calculationsMissing?: number;
  /** A confidence the path already computed (reused as-is; the boundary does not re-derive). */
  readonly computedConfidence?: ConfidenceComponents;
  /**
   * QUESTION RESOLUTION (research contract): the trader's verbatim question. When present the
   * boundary runs the QUESTION_FIT gate — evidence quality AND coverage AND question resolution
   * must all pass, or EVIDENCE_SUFFICIENT is demoted and confidence is capped by resolution
   * status. Absent only in legacy unit fixtures that predate the gate.
   */
  readonly question?: string;
  /** Total evidence objects collected this run (materiality ladder input). */
  readonly evidenceCount?: number;
  /** Evidence type tags of the admitted observations (attempt-compatibility probe input). */
  readonly evidenceTypes?: readonly string[];
}

/** The violation record the boundary hands back (one entry per rejected claim). */
export interface ContractViolationRecord {
  readonly type: string;
  readonly detail: string;
  /** What the boundary did: removed the sentence, or rejected the whole prose. */
  readonly action: "STRIPPED" | "REJECTED_PROSE";
}

/** The outcome after the shared boundary: same research, enforced contract. */
export interface ContractValidatedOutcome<L> {
  /** The path's own outcome object with contract fields replaced. */
  readonly outcome: L;
  /** Final prose after stripping unsupported claims ("" when the prose was rejected entirely). */
  readonly prose: string;
  /** The stop reason AFTER the completion law (EVIDENCE_SUFFICIENT can be demoted). */
  readonly stoppedBecause: string;
  /** Engine-owned confidence AFTER the ceiling is applied. */
  readonly confidence: ConfidenceComponents;
  /** Every violation the boundary found and handled (never swallowed). */
  readonly violationReport: readonly ContractViolationRecord[];
  /** The engine's gap statement appended to uncertainty when violations survived stripping. */
  readonly contractGap?: string;
  /**
   * QUESTION RESOLUTION (research contract): the engine's own verdict on whether the run
   * resolves the trader's information need — independent of the model's self-report.
   */
  readonly questionResolution?: QuestionResolution;
}

/**
 * Validate ONE research outcome against the contract. `updateOutcome` receives the stripped
 * prose plus the confidence/gap fields it must carry (the path's outcome shape is its own;
 * the boundary never re-shapes domain objects, it hands back the enforced values).
 */
export function validateContractOutcome<L>(
  input: ContractOutcomeInput,
  updateOutcome: (patch: {
    readonly prose: string;
    readonly confidence: ConfidenceComponents;
    readonly contractGap?: string;
    readonly contractViolations?: readonly ContractViolationRecord[];
  }) => L,
): ContractValidatedOutcome<L> {
  const state: ContractState = {
    ledger: input.ledger,
    evidenceText: input.evidenceText,
    executedCapabilities: input.executedCapabilities,
  };
  const report: ContractViolationRecord[] = [];

  // 1. CLAIM VALIDATION (the one validator): violations in the prose are stripped; if nothing
  // evidence-supported remains, the prose is rejected outright and the caller keeps its
  // deterministic evidence-grounded fallback (never a fabricated answer).
  let prose = input.prose.trim();
  const violations: readonly ContractViolation[] = contractViolations(prose, state);
  let surviving: readonly ContractViolation[] = violations;
  if (violations.length > 0) {
    const stripped = stripUnsupportedClaims(prose, violations).trim();
    if (stripped === "") {
      report.push(...violations.map((v) => ({ type: v.type, detail: v.detail, action: "REJECTED_PROSE" as const })));
      prose = "";
    } else {
      report.push(...violations.map((v) => ({ type: v.type, detail: v.detail, action: "STRIPPED" as const })));
      prose = stripped;
      surviving = [];
    }
  }
  const contractGap = surviving.length > 0 ? contractGapStatement(surviving) : undefined;

  // 2. QUESTION RESOLUTION (research contract: QUESTION RESOLUTION ≠ EVIDENCE COLLECTION).
  // The engine evaluates whether THIS run's evidence + prose resolve the trader's verbatim
  // question. The model cannot self-declare ANSWERED; the ledger and the prose decide.
  let questionResolution: QuestionResolution | undefined;
  if (input.question !== undefined && input.question.trim() !== "") {
    questionResolution = evaluateQuestionResolution({
      question: input.question,
      ledger: input.ledger as readonly ResearchRequirement[],
      evidenceText: input.evidenceText,
      prose,
      executedCapabilities: input.executedCapabilities,
      ...(input.evidenceTypes !== undefined ? { evidenceTypes: input.evidenceTypes } : {}),
      ...(input.evidenceCount !== undefined ? { evidenceCount: input.evidenceCount } : {}),
    });
  }

  // 3. COMPLETION LAW (engine-owned, ONE law): "sufficient" must mean the engine's coverage
  // verdict reports no BLOCKING requirement — a plausible paragraph never promotes an uncovered
  // ledger to EVIDENCE_SUFFICIENT. Exactly the adaptive loop's `coverageVerdict` predicate runs
  // here, so the boundary can never disagree with the loop that produced the run (identical for
  // flow-routed runs: same ledger, same law). QUESTION_FIT extends the same law: evidence
  // quality AND evidence coverage AND question resolution must all pass.
  const blocking = blockingRequirements(input.ledger as readonly ResearchRequirement[]);
  let stoppedBecause = input.stoppedBecause;
  if (stoppedBecause === "EVIDENCE_SUFFICIENT" && blocking.length > 0) {
    stoppedBecause = "REQUIREMENT_GAPS_UNRESOLVED";
  }
  if (stoppedBecause === "EVIDENCE_SUFFICIENT" && questionResolution !== undefined && questionResolution.status !== "ANSWERED") {
    // QUESTION_FIT FAILED: the run may hold valid evidence and still fail to resolve the
    // question (wrong dimensions, stale window, prose that does not answer). Never COMPLETED
    // and never HIGH confidence on a failed QUESTION_FIT.
    stoppedBecause =
      questionResolution.status === "NOT_ANSWERED"
        ? "MODEL_INSUFFICIENT_EVIDENCE"
        : "REQUIREMENT_GAPS_UNRESOLVED";
  }

  // 4. CONFIDENCE CEILING (same policy on every path): recomputed when the gate demoted the
  // stop reason so honestGap reflects the demoted state; otherwise the path's own computation
  // is reused as-is. Always capped by question-resolution status (NOT_ANSWERED → LOW,
  // PARTIALLY_ANSWERED → MODERATE) — resolution gates confidence, never the reverse.
  let confidence = stoppedBecause === input.stoppedBecause && input.computedConfidence !== undefined
    ? input.computedConfidence
    : computeConfidence({
        requirements: input.ledger as readonly ResearchRequirement[],
        stoppedBecause,
        failedPaths: input.failedPaths,
        ...(input.calculationsMissing !== undefined ? { calculationsMissing: input.calculationsMissing } : {}),
      });
  if (questionResolution !== undefined) {
    const ceiling = resolutionConfidenceCeiling(questionResolution.status);
    if (confidenceRank(confidence.level) > confidenceRank(ceiling)) {
      confidence = { ...confidence, level: ceiling };
    }
  }

  const outcome = updateOutcome({
    prose,
    confidence,
    ...(contractGap !== undefined ? { contractGap } : {}),
    ...(report.length > 0 ? { contractViolations: report } : {}),
  });
  return {
    outcome,
    prose,
    stoppedBecause,
    confidence,
    violationReport: report,
    ...(contractGap !== undefined ? { contractGap } : {}),
    ...(questionResolution !== undefined ? { questionResolution } : {}),
  };
}

const LEVEL_RANK: Readonly<Record<ConfidenceLevel, number>> = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3 };

function confidenceRank(level: ConfidenceLevel): number {
  return LEVEL_RANK[level];
}
