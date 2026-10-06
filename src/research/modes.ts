/**
 * RESEARCH MODES — the eight canonical investigations as MODES, and the chaining that lets one
 * question require several of them.
 *
 * The eight canonical questions (WHAT_HAPPENED, WHY_IT_HAPPENED, WHAT_COULD_AFFECT_IT,
 * DOES_MY_THESIS_HOLD, HAS_THIS_HAPPENED_BEFORE, WHAT_DOES_ALL_INFORMATION_SAY,
 * WHAT_COULD_PROVE_ME_WRONG, EVALUATE_WITH_MY_FRAMEWORK) are not eight prompt templates. Each
 * MODE determines what evidence is relevant, what a requirement is, what capabilities may be
 * needed, how evidence is judged, and what the answer contains.
 *
 * The engine previously resolved ONE flow per turn and derived the whole requirement ledger from
 * that flow's question type. That is right for a single-mode question and wrong for a compound
 * one:
 *
 *   "Why did BTC fall, and does my bullish thesis still hold?"
 *
 * is not a thesis question OR a causal question; it is an OBSERVATION premise feeding a CAUSAL
 * investigation feeding a THESIS evaluation. The trader must not have to run three separate
 * investigations, so the modes are detected TOGETHER and their dimensions are unioned — while
 * the FIRST (highest-priority) mode still owns what the answer looks like.
 *
 * Deterministic and asset-agnostic: these patterns describe QUESTION SHAPES (explain a move,
 * test a belief, compare a period), never assets or topics. MODE_PATTERNS below is the SINGLE
 * shared vocabulary: the LUI flow guard reads the same table the ledger reads, so the router
 * and the ledger cannot disagree about what a question is.
 */
import type { CanonicalFlow } from "./flow-contract.js";

export interface ModePattern {
  readonly flow: CanonicalFlow;
  readonly re: RegExp;
}

/**
 * SHARED MODE VOCABULARY — the single pattern table the WHOLE pipeline reads.
 *
 * The flow guard (dispatch), `primaryFlowOf`/`chainedFlowsOf` (the ledger's mode detection) and
 * the answer-shape selection all consume THIS table, so the router and the ledger cannot drift
 * apart by having two hand-maintained regex sets. Each pattern here is the union of what both
 * consumers previously needed plus the shapes the trader's own natural phrasings proved:
 * "What would invalidate my thesis?" (falsification without the word "prove"),
 * "Does my thesis that BTC remains bullish still hold?" (thesis-hold with modifiers between
 * the determiner and "hold"), "Evaluate this according to my risk framework" (framework with
 * an intervening noun), "Has Bitcoin reacted like this to similar CPI surprises before?"
 * (historical without the word "happened"), "Is the current move mainly driven by ETF flows
 * or macro?" (causal without the word "why"), and "What happened, and why?" (a bare causal
 * leg joined by a conjunction).
 *
 * Deterministic and asset-agnostic: these patterns describe QUESTION SHAPES, never assets or
 * topics. A pattern matching here means the question ASKS for that methodology — the model's
 * classification still wins whenever it does not contradict the message (see flow-guard).
 *
 * Ordered most-specific-first: the first pattern that matches is the PRIMARY mode and owns the
 * answer shape.
 */
export const MODE_PATTERNS: readonly ModePattern[] = [
  {
    flow: "EVALUATE_WITH_MY_FRAMEWORK",
    re: /\baccording to (?:this|my|the following|the attached)(?: [\w-]+){0,2} framework\b|\bmy framework\b|\bframework (?:weights|criteria|rules)\b|\bevaluate .{0,40}\busing (?:this|my) framework\b|\bagainst (?:\w+ ){0,2}framework\b|\bmy (?:rules|criteria|checklist)\b/i,
  },
  {
    flow: "WHAT_COULD_PROVE_ME_WRONG",
    re: /\b(?:what could|what would|what might)\b.{0,30}\b(?:prove|disprove|falsify)\b.{0,20}\b(?:wrong|thesis|belief|view|case)?\b|\bchallenge (?:my|this) (?:thesis|view|belief|conclusion)\b|\bfalsify\b|\bwhat could prove\b|\bwhat would invalidate\b|\bprove me wrong\b|\btry to (?:prove|disprove) (?:me|this|it) wrong\b|\bshould i disbelieve\b/i,
  },
  {
    flow: "DOES_MY_THESIS_HOLD",
    re: /\bdoes (?:my|this|the) (?:thesis|view|case) (?:still )?hold\b|\bis my (?:thesis|view) (?:still )?(?:valid|intact|supported)\b|\bstill hold\b|\bmy (?:bullish|bearish|base|core) (?:thesis|view|case)\b|\bthesis (?:holds?|evaluation|assessment)\b/i,
  },
  {
    flow: "WHAT_DOES_ALL_INFORMATION_SAY",
    re: /\bwhat does (?:all|the) (?:the )?information (?:say|indicate|show)\b|\ball the information\b|\boverall picture\b|\bsynthesi[sz]e (?:all|the) (?:evidence|information|findings|sources)\b|\bweigh (?:all|the) (?:evidence|sources|signals)\b|\bwhat do all (?:the )?sources say\b/i,
  },
  {
    flow: "WHAT_COULD_AFFECT_IT",
    re: /\bwhat (?:could|can|might|may)\b.{0,24}\b(?:affect|impact|influence|move|drive|shape)\b|\bwhat (?:are the|is the) (?:main |key |material )?(?:factors|drivers|risks|catalysts)\b|\bfactors that could\b|\brisk factors\b/i,
  },
  {
    flow: "HAS_THIS_HAPPENED_BEFORE",
    re: /\bhas this happened before\b|\bhas .{0,40} happened before\b|\bhistorical (?:precedent|parallel|analog|comparison)\b|\bhistory rhyme\b|\blast time this happened\b|\bprecedent\b|\bhas (?:this|the) setup happened\b|\bprevious (?:three|two|four|\d+ )occurrences\b|\bha(?:s|ve)\b[^.?!]{0,80}\b(?:like this|same setup|similar to this)\b[^.?!]{0,60}\bbefore\b/i,
  },
  {
    flow: "WHY_IT_HAPPENED",
    re: /\bwhy (?:did|is|are|has|have|was|were|do|does)\b|\bwhy\s*\?|\b(?:is|are|was|were)\b[^?]{0,60}\bdriven\b|\bexplain why\b|\bwhat caused\b|\bcauses? of (?:the )?(?:move|rise|drop|rally|decline)\b|\bwhat drove\b|\bcausal (?:explanation|investigation)\b/i,
  },
  {
    flow: "WHAT_HAPPENED",
    re: /\bwhat happened\b|\bwhat has happened\b|\bfactual (?:sequence|timeline)\b|\btimeline of\b|\bchronolog|\bwhat took place\b|\bwhat occurred\b|\bsequence of events\b|\bwhat's been going on\b|\brecap\b|\bwhat was observed\b/i,
  },
];

/** A coordinating join between two clauses — required before a second mode is CHAINED. */
const CONJUNCTION = /\b(?:and|then|plus|also|as well as|along with)\b|;|, and/i;

/** The canonical flow that owns a question's ANSWER SHAPE (the primary mode), if any. */
export function primaryFlowOf(question: string): CanonicalFlow | undefined {
  return MODE_PATTERNS.find((p) => p.re.test(question))?.flow;
}

/**
 * Every mode the question invokes, ordered with the primary first.
 *
 * A question with one matching mode returns that mode. A question with several returns all of
 * them ONLY when a coordinating conjunction actually joins the clauses: an incidental second
 * pattern in a single-clause question is not a second investigation, and treating it as one
 * would silently widen scope.
 */
export function chainedFlowsOf(question: string): readonly CanonicalFlow[] {
  const matched = MODE_PATTERNS.filter((p) => p.re.test(question)).map((p) => p.flow);
  if (matched.length <= 1) return matched;
  if (!CONJUNCTION.test(question)) return [matched[0]!];
  return [...new Set(matched)];
}
