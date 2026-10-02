/**
 * DETERMINISTIC FLOW GUARD (routing remediation).
 *
 * The model classifies the user's request into one of the eight locked research flows
 * (`lui.resolved_target`), but live production showed the classification is unreliable:
 * "What happened to X?" came back FALSIFICATION, "Why did X rise?" came back FALSIFICATION,
 * "What could affect X?" came back THESIS evaluation, and an explicit framework evaluation
 * with weights came back as an unknown label. A wrong flow is a wrong METHODOLOGY: a factual
 * timeline run through falsification produces a verdict nobody asked for.
 *
 * Law (routing remediation brief): the model proposes; a DETERMINISTIC guard validates the
 * classification against the message the user actually wrote, with explicit negative
 * constraints as first-class routing signals:
 *   - "do not explain why" suppresses CAUSAL;
 *   - "do not perform a thesis/falsification assessment" suppresses THESIS + FALSIFICATION;
 *   - "according to this framework" (with criteria/weights) strongly selects FRAMEWORK;
 *   - "why did X happen" selects CAUSAL unless contradictory constraints exist;
 *   - "what happened" (timeline/observed/chronology language) selects the factual flow;
 *   - "what could affect it" factor language selects the factor-landscape flow;
 *   - "what does all the information say" aggregation language selects SYNTHESIS.
 *
 * This is NOT a keyword router replacing the model: the model's classification WINS whenever
 * it does not contradict an explicit constraint in the message. The guard fires only when the
 * message's own task language and the classified flow are incompatible, so routing gets the
 * model's context sensitivity AND the user's explicit words stay authoritative over it.
 *
 * Downstream (after the guard), the selected flow's required research behavior is validated
 * against the requested task by the existing flow runners and the contract boundary; this
 * module only guarantees the METHODOLOGY CLASS is the one the user requested.
 */

import { RESEARCH_FLOWS, type ResearchFlow } from "../model/schemas.js";

/** A detected constraint: what the user explicitly forbade, with the phrase that said so. */
export interface FlowConstraint {
  readonly kind: "NO_CAUSAL" | "NO_THESIS" | "NO_FALSIFICATION" | "NO_TRADING_ADVICE";
  readonly phrase: string;
}

const CONSTRAINT_PATTERNS: readonly { kind: FlowConstraint["kind"]; re: RegExp }[] = [
  { kind: "NO_CAUSAL", re: /\bdo (?:not|n't)\s+(?:explain|investigate|research|analyze|analyse)\s+(?:\w+\s+){0,3}?why\b|\bwithout (?:explaining|causal analysis)|\bno causal\b|\bskip (?:the )?causal\b/i },
  { kind: "NO_THESIS", re: /\bdo (?:not|n't)\s+(?:perform|run|do|make)\b.{0,24}\bthesis\b|\bno thesis (?:assessment|evaluation|verdict)\b|\bthis is not (?:about )?(?:my|a) thesis\b/i },
  { kind: "NO_FALSIFICATION", re: /\bdo (?:not|n't)\s+(?:perform|run|do|make)\b.{0,24}\bfalsif|\bno falsification\b|\bwithout falsif|\bdo not (?:assess|evaluate|challenge)\s+(?:the\s+)?thesis\b|\bnot a falsification\b/i },
  { kind: "NO_TRADING_ADVICE", re: /\bdo (?:not|n't)\s+(?:make|give|provide)\b.{0,20}\b(trading )?(recommendation|advice|signal)s?\b|\bno (?:trading )?(?:recommendation|advice|signals)\b/i },
];

/** Task-language matchers, ordered most-specific first. Each names its flow. */
const TASK_PATTERNS: readonly { flow: ResearchFlow; re: RegExp }[] = [
  // Flow 8: an explicit framework with criteria (weights are its strongest tell).
  { flow: "EVALUATE_WITH_MY_FRAMEWORK", re: /\baccording to (?:this|my|the following|the attached) framework\b|\bthis framework:|\bframework (?:weights|criteria|rules)\b|\bevaluate .{0,40}\busing (?:this|my) framework\b/i },
  // Flow 7: falsification intent about the trader's own belief/thesis/view.
  { flow: "WHAT_COULD_PROVE_ME_WRONG", re: /\b(what could|what would|what might)\b.{0,30}\b(prove|disprove|falsify)\b.{0,20}\b(wrong|thesis|belief|view|case)?\b|\bchallenge (?:my|this) (?:thesis|view|belief)\b|\bfalsify\b|\btry to (?:prove|disprove) (?:me|this|it) wrong\b/i },
  // Flow 4: thesis-hold evaluation language.
  { flow: "DOES_MY_THESIS_HOLD", re: /\bdoes (?:my|this|the) (?:thesis|view|case) (?:still )?hold\b|\bis my (?:thesis|view) (?:still )?(?:valid|intact|supported)\b|\bthesis (?:holds?|evaluation|assessment)\b/i },
  // Flow 6: aggregate-everything language.
  { flow: "WHAT_DOES_ALL_INFORMATION_SAY", re: /\bwhat does (?:all|the) (?:the )?information (?:say|indicate|show)\b|\ball the information\b|\boverall picture\b|\bsynthesi[sz]e (?:all|the) (?:evidence|information|findings|sources)\b|\bweigh (?:all|the) (?:evidence|sources|signals)\b|\bwhat do all (?:the )?sources say\b/i },
  // Flow 3: material-factor discovery language.
  { flow: "WHAT_COULD_AFFECT_IT", re: /\bwhat (?:could|can|might|may)\b.{0,24}\b(affect|impact|influence|move|drive|shape)\b|\bwhat (?:are the|is the) (?:main |key |material )?(?:factors|drivers|risks|catalysts)\b|\bfactors that could\b|\brisk factors\b/i },
  // Flow 5: historical precedent language.
  { flow: "HAS_THIS_HAPPENED_BEFORE", re: /\bhas this happened before\b|\bhas .{0,40} happened before\b|\bhistorical (?:precedent|parallel|analog|comparison)\b|\bhistory rhyme\b|\blast time this happened\b|\bprecedent\b/i },
  // Flow 2: causal explanation language.
  { flow: "WHY_IT_HAPPENED", re: /\bwhy (?:did|is|are|has|have|was|were)\b.{0,60}\b(happen|rise|risen|fall|fallen|drop|dropped|surge|spike|move|decline|pump|dump|crash|rally|change|increase|decrease)?|\bexplain why\b|\bcausal explanation\b|\bwhat caused\b|\bcauses? of (?:the )?(?:move|rise|drop|rally|decline)\b/i },
  // Flow 1: factual event reconstruction / timeline language.
  { flow: "WHAT_HAPPENED", re: /\bwhat happened\b|\bfactual timeline\b|\btimeline of\b|\bchronolog|\bwhat took place\b|\bwhat occurred\b|\bwhat was observed\b|\bsequence of events\b|\bwhat has happened\b|\bwhat happened so far\b|\brecap\b|\bwhat's been going on\b/i },
];

export interface FlowGuardInput {
  /** The user's verbatim message (the routing authority). */
  readonly message: string;
  /** The model's classified flow (may be undefined when it resolved no flow). */
  readonly classified?: string | undefined;
}

export interface FlowGuardResult {
  /** The flow to execute (guaranteed member of the locked 8). */
  readonly flow: ResearchFlow | undefined;
  /** How the result was reached. */
  readonly source: "model" | "corrected" | "determined" | "none";
  /** When corrected: what the model said and why the message overrode it (diagnostics). */
  readonly correction?: { readonly from: string; readonly reason: string };
}

/**
 * Validate (and when necessary correct) the model's flow classification. Deterministic,
 * no model call, no state. Never invents a flow the message does not support: when neither
 * the model nor the task language selects one, `flow` is undefined (generic research loop).
 */
export function guardFlow(input: FlowGuardInput): FlowGuardResult {
  const message = input.message;
  const constraints = CONSTRAINT_PATTERNS
    .filter((c) => c.re.test(message))
    .map((c): FlowConstraint => ({ kind: c.kind, phrase: c.re.exec(message)?.[0] ?? "" }));

  // 1. The model's classification when it is a member of the locked set.
  const modelFlow = RESEARCH_FLOWS.find((f) => f === input.classified);

  // 2. What the message's own task language selects (first, most-specific match wins).
  const taskMatch = TASK_PATTERNS.map((p) => {
    const m = p.re.exec(message);
    return m === null ? undefined : { flow: p.flow, matched: m[0] };
  }).find((m): m is { flow: ResearchFlow; matched: string } => m !== undefined);

  // 3. Constraint filtering: a task-selected flow killed by an explicit user constraint is
  // not routable from that signal ("do not explain why" kills a causal routing signal).
  const suppressed = (flow: ResearchFlow): boolean =>
    (flow === "WHY_IT_HAPPENED" && constraints.some((c) => c.kind === "NO_CAUSAL")) ||
    (flow === "DOES_MY_THESIS_HOLD" && constraints.some((c) => c.kind === "NO_THESIS")) ||
    (flow === "WHAT_COULD_PROVE_ME_WRONG" && constraints.some((c) => c.kind === "NO_FALSIFICATION"));

  if (taskMatch !== undefined && !suppressed(taskMatch.flow)) {
    if (modelFlow === taskMatch.flow) return { flow: modelFlow, source: "model" };
    return {
      flow: taskMatch.flow,
      source: modelFlow === undefined ? "determined" : "corrected",
      ...(modelFlow !== undefined
        ? { correction: { from: modelFlow, reason: `message's explicit task language ("${taskMatch.matched.trim()}") names a different methodology${constraints.length > 0 ? "; user constraints: " + constraints.map((c) => c.phrase.trim()).join("; ") : ""}` } }
        : {}),
    };
  }

  // 4. The model's flow, when the task language did not select (or was suppressed).
  if (modelFlow !== undefined) {
    // Explicit constraints still veto the model when they directly forbid it: "do not
    // perform a thesis or falsification assessment" must not route to FALSIFICATION even
    // when falsification-shaped words ("prove me wrong") appear in the constraint sentence.
    if (suppressed(modelFlow)) {
      return { flow: undefined, source: "none", ...(modelFlow !== undefined ? { correction: { from: modelFlow, reason: "explicit user constraint forbids this methodology; executing the generic research loop with the constraints passed through" } } : {}) };
    }
    return { flow: modelFlow, source: "model" };
  }

  return { flow: undefined, source: "none" };
}

/**
 * Constraint extraction for the dispatch layer: the user's explicit prohibitions travel with
 * the request so flows honor them during execution (a factual timeline must not drift into a
 * causal investigation, and no flow may append a trading recommendation when forbidden).
 */
export function explicitConstraints(message: string): readonly FlowConstraint[] {
  return CONSTRAINT_PATTERNS
    .filter((c) => c.re.test(message))
    .map((c): FlowConstraint => ({ kind: c.kind, phrase: (c.re.exec(message)?.[0] ?? "").trim() }));
}
