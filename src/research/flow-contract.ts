/**
 * FLOW CONTRACT — the authority hierarchy between the trader's intent, the SELECTED FLOW, the
 * question-type classifier, the planner and the requirement ledger.
 *
 * THE PRODUCTION DEFECT THIS MODULE EXISTS TO FIX (reproduced verbatim):
 *
 *   "What happened to Bitcoin over the last 24 hours? Give me only the factual sequence of price
 *    movement and dated market events. Do not analyze causes, drivers, mechanisms, theses,
 *    counterevidence, materiality, or trading implications."
 *
 * came back as: question type CAUSAL, THESIS_EVALUATION answered, THESIS_CHALLENGE satisfied,
 * materiality satisfied, counterevidence, strongest support, meaningful opposition, mechanism,
 * transmission, "what would change this conclusion" — plus an answer that summarised Oct 1–3
 * headlines instead of the requested 24-hour price timeline.
 *
 * WHY IT HAPPENED, precisely:
 *
 *   1. `questionTypeOf` matched the literal phrase "what happened" INSIDE ITS CAUSAL BRANCH. So
 *      the trader asking what happened was classified CAUSAL — the exact inverse of the request.
 *   2. `REQUIRED_DIMENSIONS.WHAT_HAPPENED` itself listed MATERIALITY, so even the correctly
 *      classified intent demanded a materiality judgment the trader forbade in writing.
 *   3. `completeRequirements` derives its whole ledger from `questionTypeOf(question)` and never
 *      consults the flow the router already RESOLVED. So the selected flow had no authority over
 *      its own requirement contract: `selectedFlow -> generic classifier -> global ledger`, with
 *      the flow's own contract discarded. Every CAUSAL dimension (drivers, supply/demand,
 *      mechanism, transmission, counterevidence) was injected into a descriptive question.
 *   4. Flow 1 has NO entry in `FLOW_OBJECTIVES` at all, so "what happened" fell through to the
 *      generic adaptive loop rather than an observation-shaped methodology.
 *   5. The answer formatter is not the culprit and was never asked to hide anything: it emitted
 *      what the ledger demanded.
 *
 * THE HIERARCHY, made explicit and enforced (highest authority first):
 *
 *   1. THE TRADER'S OWN STATED PROHIBITIONS  — an explicit "do not analyze causes" is absolute.
 *   2. THE SELECTED FLOW                     — resolved by the router/guard from the request.
 *                                             The flow OWNS its requirement contract.
 *   3. THE QUESTION-TYPE CLASSIFIER          — a heuristic used ONLY when no flow is resolved.
 *   4. THE PLANNER                           — may propose requirements WITHIN the flow's
 *                                             contract; it may never widen it.
 *
 * The rule this encodes: a classifier may never OVERRIDE a resolved flow, and a flow may never
 * acquire a dimension its contract does not grant. That is the difference between
 * `selectedFlow -> flow requirements -> plan -> evidence -> flow synthesis -> flow validation`
 * and the old `selectedFlow -> generic requirements -> everything -> formatter`.
 */
import type { QuestionType } from "./requirements.js";
import type { RequirementRole } from "./requirements.js";

/** The canonical research flows the router resolves. Vocabulary matches RESEARCH_FLOWS. */
export type CanonicalFlow =
  | "WHAT_HAPPENED"
  | "WHY_IT_HAPPENED"
  | "WHAT_COULD_AFFECT_IT"
  | "DOES_MY_THESIS_HOLD"
  | "HAS_THIS_HAPPENED_BEFORE"
  | "WHAT_DOES_ALL_INFORMATION_SAY"
  | "WHAT_COULD_PROVE_ME_WRONG"
  | "EVALUATE_WITH_MY_FRAMEWORK";

/**
 * What a flow is ALLOWED to require.
 *
 * `grants` are the dimensions this flow may legitimately demand. A requirement outside its
 * flow's grants is scope contamination and is removed or refused at runtime — never formatted
 * away at the end.
 */
export interface FlowContract {
  readonly flow: CanonicalFlow;
  /**
   * The question type this flow PINS, when the flow's identity fixes it regardless of wording.
   *
   * Most flows do NOT pin it: "what does all the information say" spans macro, comparison and
   * earnings questions, and pinning SYNTHESIS for all of them discarded the classifier's
   * specificity (a macro-regime question lost its rate/conditions rows). The flow's `grants`
   * already bound what may survive, so the classifier's type detection stays in charge of WHICH
   * engine dimensions to generate.
   *
   * WHAT_HAPPENED pins OBSERVATION, because that is the defect being fixed: the classifier read
   * "what happened" as CAUSAL and the flow must be able to say otherwise.
   */
  readonly pinnedQuestionType?: QuestionType;
  /** Fallback type when a flow pins none and no classifier type is available. */
  readonly questionType: QuestionType;
  /** Dimensions this flow may require. Anything else is a contract violation. */
  readonly grants: readonly string[];
  /** Does this flow answer with a causal explanation? Gates mechanism/transmission/causal work. */
  readonly causal: boolean;
  /** Does this flow form a conclusion a trader could hold? Gates thesis machinery. */
  readonly judgmental: boolean;
  /** Does this flow owe the trader an explicit uncertainty/what-would-change section? */
  readonly forwardLooking: boolean;
  /** Does this flow need disconfirming evidence searched for? */
  readonly requiresCounterevidence: boolean;
  /** Does this flow judge how much a factor matters to a decision? */
  readonly requiresMateriality: boolean;
  /** Evidence classes this flow should prioritise (observations for a timeline). */
  readonly evidencePreference: readonly string[];
}

/**
 * THE CONTRACT TABLE.
 *
 * Derived from the product's own flow definitions (docs/design/research-flows.md), not from a
 * list of test questions. `WHAT_HAPPENED` is deliberately observational: it reconstructs and
 * dates events. It grants no causal, thesis, falsification, counterevidence, materiality or
 * mechanism dimension, which is precisely what the trader asked for in writing.
 */
export const FLOW_CONTRACTS: Readonly<Record<CanonicalFlow, FlowContract>> = {
  WHAT_HAPPENED: {
    flow: "WHAT_HAPPENED",
    // PINNED: this flow is observational by definition. The classifier matched "what happened"
    // inside its CAUSAL branch and produced a causal ledger for a descriptive question.
    pinnedQuestionType: "OBSERVATION",
    questionType: "OBSERVATION",
    // Descriptive reconstruction only: the events themselves, their currency, and the
    // observation classes that make "what happened" answerable. No drivers, no mechanism,
    // no thesis, no materiality, no counterevidence.
    grants: ["WHAT_HAPPENED", "RECENCY"],
    causal: false,
    judgmental: false,
    forwardLooking: false,
    requiresCounterevidence: false,
    requiresMateriality: false,
    // Price prints, OHLCV/klines, volume and dated events are the observations a timeline is
    // built from. A news headline is a REPORTED CLAIM, not an observation.
    evidencePreference: ["QUANTITATIVE_OBSERVATION", "PRICE_OBSERVATION", "OHLCV", "VOLUME", "KLINE"],
  },
  WHY_IT_HAPPENED: {
    flow: "WHY_IT_HAPPENED",
    questionType: "CAUSAL",
    grants: [
      "WHAT_HAPPENED", "CURRENT_DRIVERS", "DRIVER_RELATIONSHIP",
      "RECENCY", "COUNTEREVIDENCE", "MATERIALITY",
    ],
    causal: true,
    judgmental: true,
    forwardLooking: false,
    requiresCounterevidence: true,
    requiresMateriality: true,
    evidencePreference: ["QUANTITATIVE_OBSERVATION", "PRICE_OBSERVATION", "NEWS"],
  },
  WHAT_COULD_AFFECT_IT: {
    flow: "WHAT_COULD_AFFECT_IT",
    // NOT PINNED: "what could affect X around its next earnings" is an EVENT question, and a pin
    // here would overwrite that with the forward-looking type and drop the event's timing and
    // consensus dimensions. The classifier recognises the conditional shape on its own.
    questionType: "FORWARD_LOOKING",
    grants: ["FORWARD_FACTORS", "RECENCY", "COUNTEREVIDENCE", "MATERIALITY"],
    causal: false,
    judgmental: false,
    forwardLooking: true,
    requiresCounterevidence: true,
    requiresMateriality: true,
    evidencePreference: ["QUANTITATIVE_OBSERVATION", "NEWS", "SCHEDULED_EVENT"],
  },
  DOES_MY_THESIS_HOLD: {
    flow: "DOES_MY_THESIS_HOLD",
    questionType: "THESIS",
    // COUNTEREVIDENCE is granted because `requiresCounterevidence` is true: the engine's generic
    // challenge row is attributed to the COUNTEREVIDENCE dimension by ROLE, so a thesis flow that
    // owed disconfirmation but did not grant it would have its own challenge row silently deleted
    // by the isolation filter. THESIS_CHALLENGE is the flow's own vocabulary for the same work.
    grants: ["THESIS_SUPPORT", "THESIS_CHALLENGE", "FALSIFICATION_CONDITIONS", "RECENCY", "MATERIALITY", "COUNTEREVIDENCE"],
    causal: false,
    judgmental: true,
    forwardLooking: false,
    requiresCounterevidence: true,
    requiresMateriality: true,
    evidencePreference: ["QUANTITATIVE_OBSERVATION", "NEWS"],
  },
  HAS_THIS_HAPPENED_BEFORE: {
    flow: "HAS_THIS_HAPPENED_BEFORE",
    questionType: "HISTORICAL",
    // Comparability, not causation: an analogue is retrieved and compared, never transferred
    // as a cause. No DRIVER_RELATIONSHIP — that is the transmission channel a causal claim needs.
    grants: ["HISTORICAL_EPISODE", "COMPARISON_BASELINE", "RECENCY", "MATERIALITY"],
    causal: false,
    judgmental: false,
    forwardLooking: false,
    requiresCounterevidence: false,
    requiresMateriality: true,
    evidencePreference: ["HISTORICAL_OBSERVATION", "QUANTITATIVE_OBSERVATION"],
  },
  WHAT_DOES_ALL_INFORMATION_SAY: {
    flow: "WHAT_DOES_ALL_INFORMATION_SAY",
    // NOT PINNED, deliberately. This flow is broad BY DESIGN — a macro-regime, comparison or
    // earnings question can legitimately arrive under it — so pinning one question type here
    // discarded the classifier's specificity and every macro question lost its rate/growth/
    // inflation dimensions. Its CROSS_DOMAIN_COVERAGE grant is satisfiable without a pin because
    // the classifier now recognises "what does all the information say" as BROAD_SYNTHESIS; the
    // wide `grants` below are what bind the flow, not the type.
    questionType: "SYNTHESIS",
    // A BROAD synthesis flow is, by definition, the union of the substantive dimensions. It
    // must be able to acquire CURRENT_STATE, macro regime, comparison and driver dimensions —
    // "what does all the information say" is the question that spans them. Restricting it to
    // its own cross-domain row stripped dimensions it legitimately owns. The dimensions it does
    // NOT grant are the ones that belong to a DEDICATED flow: thesis (DOES_MY_THESIS_HOLD),
    // falsification (WHAT_COULD_PROVE_ME_WRONG) and framework (EVALUATE_WITH_MY_FRAMEWORK).
    grants: [
      "CROSS_DOMAIN_COVERAGE", "CURRENT_STATE", "WHAT_HAPPENED", "CURRENT_DRIVERS",
      "DRIVER_RELATIONSHIP", "FORWARD_FACTORS", "HISTORICAL_EPISODE", "COMPARISON_BASELINE",
      "RECENCY", "COUNTEREVIDENCE", "MATERIALITY",
    ],
    causal: false,
    judgmental: true,
    forwardLooking: false,
    requiresCounterevidence: true,
    requiresMateriality: true,
    evidencePreference: ["QUANTITATIVE_OBSERVATION", "NEWS", "MACRO_OBSERVATION"],
  },
  WHAT_COULD_PROVE_ME_WRONG: {
    flow: "WHAT_COULD_PROVE_ME_WRONG",
    questionType: "FALSIFICATION",
    grants: ["FALSIFICATION_CONDITIONS", "COUNTEREVIDENCE", "RECENCY", "MATERIALITY"],
    causal: false,
    judgmental: true,
    forwardLooking: false,
    requiresCounterevidence: true,
    requiresMateriality: true,
    evidencePreference: ["COUNTEREVIDENCE", "DISCONFIRMING", "RISK", "QUANTITATIVE_OBSERVATION"],
  },
  EVALUATE_WITH_MY_FRAMEWORK: {
    flow: "EVALUATE_WITH_MY_FRAMEWORK",
    // NOT PINNED: "does this thesis hold according to my framework" is a THESIS question asked
    // through a framework, and a pin would strip its thesis dimensions. The FRAMEWORK classifier
    // branch covers the pure framework-evaluation shape on its own.
    questionType: "THESIS",
    grants: ["FRAMEWORK_CRITERIA", "RECENCY", "MATERIALITY", "COUNTEREVIDENCE"],
    causal: false,
    judgmental: true,
    forwardLooking: false,
    requiresCounterevidence: true,
    requiresMateriality: true,
    evidencePreference: ["QUANTITATIVE_OBSERVATION", "NEWS"],
  },
};

/** Vocabulary → canonical flow, used to interpret a flow already recorded on a research object. */
const FLOW_ALIASES: Readonly<Record<string, CanonicalFlow>> = {
  WHAT_HAPPENED: "WHAT_HAPPENED",
  WHY_IT_HAPPENED: "WHY_IT_HAPPENED",
  WHY_DID_IT_HAPPEN: "WHY_IT_HAPPENED",
  WHAT_COULD_AFFECT_IT: "WHAT_COULD_AFFECT_IT",
  DOES_MY_THESIS_HOLD: "DOES_MY_THESIS_HOLD",
  HAS_THIS_HAPPENED_BEFORE: "HAS_THIS_HAPPENED_BEFORE",
  WHAT_DOES_ALL_INFORMATION_SAY: "WHAT_DOES_ALL_INFORMATION_SAY",
  WHAT_COULD_PROVE_ME_WRONG: "WHAT_COULD_PROVE_ME_WRONG",
  EVALUATE_WITH_MY_FRAMEWORK: "EVALUATE_WITH_MY_FRAMEWORK",
};

/**
 * Resolve a flow name to its contract, or undefined when the name is not a canonical flow
 * (RAW_OBSERVATION, INDEPENDENT_RESEARCH, or absent). A non-canonical marker carries no
 * requirement contract of its own and must never borrow one.
 */
export function contractFor(flow: string | undefined): FlowContract | undefined {
  if (flow === undefined) return undefined;
  const key = flow.toUpperCase().replaceAll(" ", "_");
  const canonical = FLOW_ALIASES[key];
  return canonical === undefined ? undefined : FLOW_CONTRACTS[canonical];
}

/** Is this a canonical flow whose contract must be enforced? */
export function isCanonicalFlow(flow: string | undefined): flow is CanonicalFlow {
  return contractFor(flow) !== undefined;
}

/**
 * Dimensions this flow must NOT require — the explicit denial list.
 *
 * Derived as "everything the engine can produce, minus what the flow grants", so a dimension
 * added to the engine later is denied here automatically rather than silently leaking in.
 */
export function forbiddenDimensionsFor(flow: string | undefined, allDimensions: readonly string[]): readonly string[] {
  const contract = contractFor(flow);
  if (contract === undefined) return []; // no resolved flow: nothing to enforce
  const granted = new Set(contract.grants);
  return allDimensions.filter((d) => !granted.has(d));
}

export interface FlowContractViolation {
  readonly flow: string;
  readonly requirementId: string;
  readonly description: string;
  readonly role: string;
  /** Which dimension this row smuggles in. */
  readonly dimension: string;
  readonly reason: string;
}

export interface FlowContractCheck {
  readonly flow: string;
  readonly ok: boolean;
  readonly violations: readonly FlowContractViolation[];
}

/**
 * RUNTIME FLOW-CONTRACT ASSERTION.
 *
 * After the ledger is built and BEFORE it can reach capability planning or synthesis, every row
 * is checked against the selected flow's contract. A contaminated plan fails deterministically
 * so the caller can rebuild it from the flow's own requirements — rather than allowing a
 * causal-only requirement to survive into a descriptive answer, and rather than silently
 * stripping it at the UI layer where the trader would see an answer that looks complete but was
 * produced under a contract the trader refused.
 */
export function assertFlowContract(input: {
  readonly flow: string | undefined;
  readonly requirements: readonly {
    readonly id: string;
    readonly description: string;
    readonly role: RequirementRole;
  }[];
  readonly dimensionOf: (description: string, role: RequirementRole) => string | undefined;
}): FlowContractCheck {
  const contract = contractFor(input.flow);
  if (contract === undefined) return { flow: input.flow ?? "UNRESOLVED", ok: true, violations: [] };

  const granted = new Set(contract.grants);
  const violations: FlowContractViolation[] = [];

  for (const req of input.requirements) {
    // CONTEXT rows carry no dimension and are never a contract violation.
    if (req.role === "CONTEXT") continue;
    const dimension = input.dimensionOf(req.description, req.role as RequirementRole);
    if (dimension === undefined) continue; // unclassifiable row: not attributable to a dimension
    if (granted.has(dimension)) continue;
    violations.push({
      flow: contract.flow,
      requirementId: req.id,
      description: req.description,
      role: req.role,
      dimension,
      reason: `${contract.flow} does not grant the ${dimension} dimension; a ${contract.flow} run must not acquire it`,
    });
  }

  return { flow: contract.flow, ok: violations.length === 0, violations };
}
