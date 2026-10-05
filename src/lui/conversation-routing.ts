/**
 * CONVERSATION ROUTING (conversational workbench).
 *
 * The trader is in an investigation and says "Focus on ETF flows." or "Why?" or "Has this
 * happened before?" — none of which restate the subject. Before the research pipeline runs at
 * all, the system must answer two questions:
 *
 *   1. WHAT did the trader MEAN in the context of this conversation?
 *   2. Does this turn CONTINUE the current investigation, START a new one, or SWITCH topic?
 *
 * These are CONVERSATION-LEVEL decisions. They are not the eight canonical research flows and
 * they do not create new ones — the conversation layer decides what the user means in context,
 * and the research layer still decides how to investigate it ("Has this happened before?" is a
 * conversation intent AND routes to Flow 5; the flow is unchanged, only its reach differs).
 *
 * DETERMINISTIC, NOT PROMPT TEXT (state-transition law). A topic switch is a state transition
 * with real consequences — it decides whether a fresh investigation inherits prior evidence
 * context at all — so it is computed here from the trader's own words and the investigation's
 * recorded subject. An ambiguous switch resolves to CLARIFY, never to a guess, because guessing
 * wrong silently carries Bitcoin evidence into an Ethereum investigation.
 */

import { questionNamesAsset, resolveNamedAsset } from "../domain/instruments.js";
import type { ConversationIntent, Investigation } from "../domain/investigation.js";
import { executionConstraintsOf, isObservationMode } from "../research/execution-mode.js";

/** What the conversation layer decided to do with a turn. */
export type RouteAction = "CONTINUE" | "START" | "CLARIFY";

export interface ConversationRoute {
  readonly action: RouteAction;
  readonly intent: ConversationIntent;
  /**
   * The subject this turn is about, when the trader's own words establish one. Undefined means
   * "inherit the investigation's subject" — which is the correct reading of a bare "Why?" and the
   * wrong reading of "What is happening with Ethereum?", which is why a switch is detected
   * before the subject is inherited.
   */
  readonly subject?: string;
  /**
   * True when the turn had to be understood against the conversation rather than read alone.
   * A bare anaphor ("why?", "and liquidations?") is only meaningful with this.
   */
  readonly continuedInvestigation: boolean;
  /** Why the router decided this (diagnostics; never a user prompt). */
  readonly reason: string;
  /** Asked when the topic switch is genuinely ambiguous. Never a guess. */
  readonly clarifyQuestion?: string;
}

// ---------------------------------------------------------------------------
// Intent laws (deterministic; the model may assist but never owns the transition)
// ---------------------------------------------------------------------------

/** "My thesis is that liquidity is the primary driver." — the trader states THEIR OWN belief. */
const THESIS_STATEMENT =
  /\b(?:my|our)\s+(?:thesis|view|position|case|setup|thesis is|belief is)\b|\bmy thesis is that\b|\bi (?:think|believe) that\b/i;

/** "Does my thesis hold?", "is my position still working?" */
const THESIS_EVALUATION =
  /\bdoes (?:my|the) (?:thesis|view|position|setup|case)\b|\b(?:is|are) (?:my|the) (?:thesis|view|position|setup)\b|\bstill (?:hold|valid|working|work)\b/i;

/** "What could prove me wrong?", "challenge my thesis", "what contradicts this?" */
const FALSIFICATION =
  /\bwhat could prove\b|\bprove me wrong\b|\bchallenge my\b|\bcontradict\w*\b|\bdisconfirm\w*\b|\bfalsif\w*\b/i;

/** "What have we established so far?", "summarize", "what should I be watching?" */
const SYNTHESIS =
  /\bwhat (?:have|do) (?:we|you) (?:established|found|know)\b|\bwhat have we\b|\bsummar\w+\b|\brecap\b|\bwhere (?:do|are) we\b|\bwhat should i (?:be )?(?:watch|monitor|keep an eye)\b|\bwhat have we established\b|\bbottom line\b/i;

/** "Has this happened before?", "compare with 2022", "historical analogue". */
const HISTORICAL =
  /\bhas (?:this|it|that) happened before\b|\bhistor\w*\b|\bsimilar setup\b|\banalog\w*\b|\bcomparable episodes?\b|\bcompare (?:it|this|them)? ?with\b|\blast time\b|\bprevious (?:episode|instance)\b/i;

/** "Focus on ETF flows", "go deeper on derivatives", "specifically liquidations". */
const DEEPER =
  /\b(?:focus|zoom|dig|look|narrow)\s+(?:in)?\s*(?:specifically)?\s*(?:on|into)\b|\bgo deeper\b|\bdeeper (?:on|into)\b|\bspecifically\b|\bnarrow (?:it )?down\b|\bdrill (?:in)?to\b|\bwhat about\b/i;

/**
 * A bare anaphor: too short to carry a subject of its own, so it can only be resolved against
 * the conversation. "Why?", "and liquidations?", "more?", "the other one?" — these are
 * follow-ups BY CONSTRUCTION, and treating them as standalone questions is what makes a
 * workbench feel like a search box.
 */
function isAnaphoricQuestion(message: string): boolean {
  const stripped = message.trim().replace(/[?!.]+$/g, "").trim();
  if (stripped.length === 0) return false;
  // A pronoun or a bare question word with no subject of its own.
  if (/^(?:why|how|what|when|where|who|which|and|then|also|more|less|ok(?:ay)?|now|next)\b/i.test(stripped) && stripped.split(/\s+/).length <= 3) {
    return true;
  }
  if (/^(?:it|that|this|they|those|these|the same)\b/i.test(stripped) && stripped.split(/\s+/).length <= 4) return true;
  // "Focus on ETF flows" style imperatives are short directives, not standalone questions.
  return stripped.split(/\s+/).length <= 6 && !/\?$/.test(message.trim()) && DEEPER.test(message);
}

/** Does the trader's own wording state a thesis? (Phase 7 gate: never inferred.) */
export function statesThesis(message: string): boolean {
  return THESIS_STATEMENT.test(message);
}

/**
 * The trader's thesis STATEMENT, in their own words, or undefined when they stated none.
 *
 * "My thesis is that liquidity conditions are the primary driver. Test it." records
 * "liquidity conditions are the primary driver" — never a paraphrase, never strengthened,
 * never extended with the trailing instruction. A thesis is the trader's own position; a
 * system that rewrites it owns it, and a system that cannot quote it cannot record it.
 */
export function statedThesisText(message: string): string | undefined {
  const match = /\b(?:my|our)\s+(?:thesis|view|position|case|setup|belief)\s+(?:is|are)\s+(?:that\s+)?([^?!.]+?)\s*(?:[.?!]|$)/i.exec(message);
  const statement = match?.[1]?.trim();
  return statement !== undefined && statement.length >= 8 ? statement : undefined;
}

/** The subject the trader's own words establish, or undefined when the message names none. */
function statedSubject(message: string): string | undefined {
  // resolveNamedAsset answers "did the trader name an ASSET", and nothing else. An earlier
  // version fell back to any uppercase 2-6 letter token, which read "Focus specifically on ETF
  // flows" as naming the subject "ETF" and therefore classified the single most common
  // follow-up as a topic switch — opening a fresh investigation and dropping every prior run.
  return resolveNamedAsset(message);
}

/**
 * A DEFINITE BACK-REFERENCE: the trader's words point at something this conversation already
 * established, without naming a new subject of their own.
 *
 * THE PRODUCTION FAILURE THIS ENCODES: after "Why did Bitcoin move down today?" answered with
 * the liquidity explanation, the follow-up "What evidence would most strongly support or
 * weaken the liquidity explanation?" was routed as a NEW investigation. It contains no anaphor
 * the short-turn test could see, because it is a thirteen-word, fully-formed question — and
 * `isAnaphoricQuestion` only fires at <=6 words. The phrase "the liquidity explanation" is a
 * reference to the PRIOR RUN's leading explanation; reading it as a self-contained question
 * silently dropped a completed investigation and every run in it.
 *
 * The test is therefore on the REFERENCE itself, not on the length of the sentence. It matches
 * a definite noun phrase built on a demonstrative or possessive determiner ("the/that/this/
 * those ... explanation|view|mechanism|reading|thesis|hypothesis|story|answer|cause") and on
 * explicit references to earlier turns ("the previous answer", "what you said", "your last
 * finding").
 *
 * Deliberately NOT matched: any phrase naming a real asset or instrument. That is the
 * topic-switch law's territory and it runs FIRST — a turn that says "the Ethereum thesis is
 * wrong" is a topic switch, not a back-reference, and must never be captured by this rule.
 */
const BACK_REFERENCE_DEFERRENT =
  /\b(?:the|that|this|those|these|your|our|my)\s+(?:liquidity\s+|previous\s+|prior\s+|earlier\s+|last\s+|original\s+|leading\s+|main\s+)?(?:explanation|view|mechanism|reading|thesis|hypothesis|story|answer|conclusion|narrative|reasoning|account|logic)\b/i;

/**
 * A reference to the THREAD'S OWN ACCUMULATED OUTPUT, with an intervening quantifier or
 * adjective between the determiner and the noun.
 *
 * The rule above requires the article to sit directly against the noun, which is true of "the
 * liquidity explanation" and false of two perfectly ordinary follow-ups the trader writes every
 * day: "Compare the two strongest explanations" ("the" … "two strongest" … "explanations") and
 * "Use the evidence you already collected" ("the evidence" — a noun the rule did not list at
 * all). Both read unambiguously as continuations to a human and both were routed as NEW
 * investigations, silently dropping a completed thread.
 *
 * The fix is structural rather than lexical: once a definite determiner has been seen, the
 * words between it and the head noun are ORDINARY MODIFIERS and must not break the reference.
 * That covers quantifiers ("the two explanations"), superlatives ("the strongest evidence")
 * and possessives alike, and it keeps the topic-switch law untouched — a turn that names a real
 * asset still leaves as a switch, because that test runs first.
 *
 * "evidence", "findings", "analysis", "answer" and "work" are included because they name the
 * investigation's own products; they are not generic nouns here.
 */
const BACK_REFERENCE_OUTPUT =
  /\b(?:the|that|this|those|these|your|our|my)\b(?:\s+\w+){0,3}?\s+(?:explanations?|views?|mechanisms?|readings?|thesis|hypotheses|story|answers?|conclusions?|narratives?|reasoning|accounts?|logic|evidence|findings|analysis|analyses|work|research|results?|data)\b/i;

/** An explicit pointer at earlier conversational turns rather than at a new subject. */
const BACK_REFERENCE_TURN =
  /\b(?:what\s+you\s+said|as\s+you\s+said|the\s+previous\s+(?:answer|run|research|response|question)|the\s+last\s+(?:answer|run|run's|response)|your\s+last\s+(?:answer|finding)|earlier\s+(?:turn|answer|run))\b/i;

/**
 * Does this turn refer back to what the conversation already established, at ANY length?
 *
 * Used IN ADDITION TO the short-turn anaphora test, never instead of it: a bare "why?" is
 * still the clearest follow-up there is, and a long question can still be a back-reference.
 * Callers must have already run the topic-switch test, because a named new subject outranks
 * any back-reference reading.
 */
export function referencesPriorFindings(message: string): boolean {
  return BACK_REFERENCE_DEFERRENT.test(message) || BACK_REFERENCE_OUTPUT.test(message) || BACK_REFERENCE_TURN.test(message);
}

/**
 * TOPIC-SWITCH LAW: a turn that names a subject the current investigation is NOT about does not
 * silently continue that investigation.
 *
 * Carrying Bitcoin evidence into an Ethereum question is the exact contamination the
 * run-ownership architecture exists to prevent, and a conversation makes it far easier to cause
 * by accident. A CLEAR switch (the trader names a different subject) starts a new investigation
 * on its own; an AMBIGUOUS one asks, because the cost of guessing wrong — a whole thread
 * researching the wrong asset — is far higher than one clarifying question.
 */
export interface TopicSwitchVerdict {
  readonly switch: boolean;
  readonly ambiguous: boolean;
  readonly subject?: string;
  readonly reason: string;
}

export function topicSwitchVerdict(
  message: string,
  investigation: Investigation | undefined,
): TopicSwitchVerdict {
  const subject = statedSubject(message);
  if (investigation === undefined) {
    return { switch: false, ambiguous: false, ...(subject !== undefined ? { subject } : {}), reason: "no current investigation" };
  }
  if (subject === undefined) {
    return { switch: false, ambiguous: false, reason: "the turn names no subject; it inherits the investigation's" };
  }
  // Same subject, or a term of it: not a switch ("Focus on Bitcoin ETF flows" inside a Bitcoin
  // investigation).
  if (questionNamesAsset(message, investigation.subject) || subject.toLowerCase() === investigation.subject.toLowerCase()) {
    return { switch: false, ambiguous: false, subject: investigation.subject, reason: "the turn names the investigation's own subject" };
  }
  // The investigation's subject may be a phrase ("Bitcoin selloff"), so a turn naming a related
  // instrument is not automatically a switch — "What about liquidations?" inside a Bitcoin
  // investigation names no new subject at all and is handled above.
  return {
    switch: true,
    ambiguous: false,
    subject,
    reason: `the turn names ${subject}, not the investigation's ${investigation.subject}`,
  };
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export interface RouteInput {
  readonly message: string;
  /** The investigation the trader is currently in, if any. */
  readonly investigation: Investigation | undefined;
  /** Whether the investigation already has at least one completed research run. */
  readonly hasPriorResearch: boolean;
  /** Whether the investigation carries the trader's OWN thesis. */
  readonly hasInvestigationThesis: boolean;
}

/**
 * Decide what a turn means in the context of the conversation.
 *
 * Order matters and is deliberate: the trader's own thesis statement is checked before anything
 * else (it must never be classified as an ordinary research question), explicit prohibitions and
 * explicit analytical questions are checked before the conversational defaults, and the
 * topic-switch test runs before any subject is INHERITED — because inheriting the subject is the
 * one decision that can silently contaminate a thread.
 */
export function routeConversation(input: RouteInput): ConversationRoute {
  const { message, investigation } = input;
  const hasThread = investigation !== undefined && input.hasPriorResearch;

  // 1. The trader states their own thesis. This is a THESIS_STATEMENT, never an ordinary
  //    research question, and never a topic switch — a thesis is said about the current subject.
  if (statesThesis(message) && !THESIS_EVALUATION.test(message)) {
    return {
      action: "CONTINUE",
      intent: "THESIS_STATEMENT",
      continuedInvestigation: hasThread,
      reason: "the trader stated their own thesis in this conversation",
    };
  }

  // 2. The execution contract (4d92351) applies BEFORE conversation routing: a raw-observation
  //    request is an OBSERVATION regardless of which thread it lands in, and it must never
  //    acquire a judgment, a synthesis or a falsification round on the way.
  if (isObservationMode(executionConstraintsOf(message))) {
    return {
      action: hasThread ? "CONTINUE" : "START",
      intent: "OBSERVATION",
      continuedInvestigation: hasThread,
      reason: "the request asks for a raw observation and forbids the analytical pipeline",
    };
  }

  // 3. Explicit conversation-level analytical intents, in the trader's own words.
  if (THESIS_EVALUATION.test(message)) {
    return {
      action: "CONTINUE",
      intent: "THESIS_EVALUATION",
      continuedInvestigation: true,
      reason: "the trader asked whether their own thesis holds",
    };
  }
  if (FALSIFICATION.test(message)) {
    return {
      action: "CONTINUE",
      intent: "FALSIFICATION",
      continuedInvestigation: true,
      reason: "the trader asked what could prove the current reading wrong",
    };
  }
  if (SYNTHESIS.test(message)) {
    return {
      action: "CONTINUE",
      intent: "SYNTHESIS",
      continuedInvestigation: true,
      reason: "the trader asked for the accumulated conversation state",
    };
  }

  // 4. TOPIC SWITCH, before any subject inheritance. A turn naming a different subject never
  //    continues this investigation.
  const switchVerdict = topicSwitchVerdict(message, investigation);
  if (switchVerdict.switch) {
    return {
      action: "START",
      intent: "TOPIC_SWITCH",
      ...(switchVerdict.subject !== undefined ? { subject: switchVerdict.subject } : {}),
      continuedInvestigation: false,
      reason: switchVerdict.reason,
    };
  }

  // 5. Historical precedent inside the current investigation.
  if (HISTORICAL.test(message)) {
    return {
      action: "CONTINUE",
      intent: "HISTORICAL",
      continuedInvestigation: true,
      reason: "the trader asked whether this has happened before, about the investigation's subject",
    };
  }

  // 6. DEFINITE BACK-REFERENCE inside a live thread, at ANY length. Deliberately AFTER the
  //    topic-switch test: "the Ethereum explanation is wrong" names a subject and is a switch,
  //    while "the liquidity explanation" names none and is a reference to what this thread
  //    already established. A fully-formed question can be a follow-up; sentence length is
  //    not evidence of independence. It classifies as FALSIFICATION when it asks what would
  //    support OR weaken the prior reading, because that is a counterevidence question about
  //    this conversation's own finding, not a fresh research question.
  if (hasThread && referencesPriorFindings(message)) {
    const challenges = FALSIFICATION.test(message) || /\b(?:support|weaken|undermine|confirm|validate)\w*\b/i.test(message);
    return {
      action: "CONTINUE",
      intent: challenges ? "FALSIFICATION" : "FOLLOW_UP",
      continuedInvestigation: true,
      reason: challenges
        ? "the turn refers back to what this investigation established and asks what would support or weaken it"
        : "the turn refers back to what this investigation established",
    };
  }

  // 7. Conversational defaults: with a live thread, a short or referential turn is understood
  //    against it; without one, the same words are simply a new question.
  if (hasThread && isAnaphoricQuestion(message)) {
    const deeper = DEEPER.test(message);
    return {
      action: "CONTINUE",
      intent: deeper ? "DEEPER" : "FOLLOW_UP",
      continuedInvestigation: true,
      reason: deeper
        ? "the turn narrows the current investigation onto one angle"
        : "the turn is a reference back to what the investigation established",
    };
  }
  if (hasThread && DEEPER.test(message)) {
    return {
      action: "CONTINUE",
      intent: "DEEPER",
      continuedInvestigation: true,
      reason: "the turn narrows the current investigation onto one angle",
    };
  }

  // 8. No thread, or a self-contained question: start a new investigation.
  return {
    action: "START",
    intent: "NEW_INVESTIGATION",
    ...(switchVerdict.subject !== undefined ? { subject: switchVerdict.subject } : {}),
    continuedInvestigation: false,
    reason: investigation === undefined
      ? "no current investigation; this opens one"
      : "a self-contained question that does not continue the current investigation",
  };
}

/**
 * A trader-readable title for a new investigation, taken from their own words.
 * Never a model paraphrase that strengthens the question, never a market-derived guess.
 */
export function investigationTitleFrom(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  return trimmed.length <= 90 ? trimmed : `${trimmed.slice(0, 87)}...`;
}

/**
 * The investigation's subject, derived from the trader's first question when they named no
 * instrument. Falls back to the first noun-ish phrase rather than a market guess — an
 * investigation about "the 10-year yield" keeps saying "the 10-year yield".
 */
export function investigationSubjectFrom(message: string): string {
  return resolveNamedAsset(message) ?? "the investigation subject";
}