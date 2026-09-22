/**
 * Research-contract validation (decision-quality contract): the judgment may not claim coverage
 * the evidence ledger does not support.
 *
 * The model writes the answer; the ENGINE owns the epistemic state. Before a synthesis is
 * accepted, its claims are checked against what the run actually did and retrieved:
 * - "no material counterevidence was found" is only admissible when disconfirmation was
 *   actually attempted (the FALSIFICATION capability ran) or disconfirming evidence is present;
 * - "compared with last week" is only admissible when the evidence holds a comparison series
 *   (a previous-period metric), not merely a current quote;
 * - earnings facts (date, consensus) are only admissible when earnings-domain evidence exists;
 * - an answer drawn over an unresolved CORE requirement must say so.
 *
 * Everything here is deterministic and reads only the ledger, the executed capabilities, and
 * the evidence text. No question-specific branches.
 */
import type { ResearchRequirement } from "./requirements.js";
import { deriveCausalLinkStatuses, type CausalLinkStatus } from "./causal.js";

export interface ContractState {
  /** The engine's requirement ledger for this run (link-bearing rows carry their targets). */
  readonly ledger: readonly Pick<
    ResearchRequirement,
    | "description" | "importance" | "status" | "timeSensitivity"
    | "relationshipType" | "targetTerms" | "transmissionTargets"
    // Link status is derived from the row's own coverage: quality and source diversity decide
    // whether an arrow reads SUPPORTED or merely PARTIALLY_SUPPORTED.
    | "evidenceQuality" | "sourceDiversity"
  >[];
  /** Text of the evidence the answer is allowed to draw on (observations + declared subjects). */
  readonly evidenceText: string;
  /** Capabilities the run actually executed. */
  readonly executedCapabilities: readonly string[];
}

export type ContractViolationType =
  | "COUNTEREVIDENCE_CLAIM_WITHOUT_SEARCH"
  | "COMPARISON_CLAIM_WITHOUT_COMPARISON_DATA"
  | "EVENT_FACT_WITHOUT_EVENT_EVIDENCE"
  | "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE"
  | "COVERAGE_CLAIM_OVER_UNRESOLVED_REQUIREMENT";

export interface ContractViolation {
  readonly type: ContractViolationType;
  /** The offending sentence, so a correction can remove exactly it. */
  readonly sentence: string;
  /** Plain statement of what the ledger does not support (also used as the model's retry note). */
  readonly detail: string;
}

/** Sentence split that keeps the sentence-ending punctuation attached. */
export function sentencesOf(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const NO_COUNTEREVIDENCE_CLAIM =
  /\b(no (material )?(counter[- ]?evidence|opposing (evidence|factors?|reasons?)|contradict(ory|ing) evidence)|nothing (contradicts|weakens|opposes)|no evidence (contradicts|weakens))\b/i;
const COMPARISON_CLAIM =
  /\b(compared (with|to)|versus|vs\.?|week[- ]over[- ]week|month[- ]over[- ]month|quarter[- ]over[- ]quarter|year[- ]over[- ]year|relative to (last|the previous))\b/i;
/**
 * Evidence that actually establishes a previous period (a current quote's prior close is a DAY).
 * No word-boundary anchors: engine-derived metrics are snake_case keys like
 * `ohlcv_weekOverWeek`, where `\bweekOverWeek` can never match (an underscore is a word
 * character, so no boundary exists) — which would have rejected every legitimate comparison.
 */
const COMPARISON_EVIDENCE = /weekOverWeek|previousWeek|priorWeek|lastWeek|previousMonth|priorMonth|monthOverMonth|priorYear|previousQuarter|weeksAgo/i;
const EVENT_FACT_CLAIM = /\b(earnings (date|report|call)|next earnings|consensus (eps|estimate)|reports? (on|its results))\b/i;
const EVENT_EVIDENCE = /\b(earningsDate|reportDate|consensus|EPS|estimate|EARNINGS)\b/i;
const GAP_ACKNOWLEDGEMENT = /\b(not (established|available|retrieved|determined|captured)|could not|unresolved|remains? (unknown|unclear|unestablished)|no (reliable )?evidence (was )?(found|available))\b/i;
/**
 * ASSERTIVE CAUSAL LANGUAGE (research contract §3): a sentence that claims one factor DID
 * move another. Hedged forms ("could", "may", "suggests") are interpretations and stay
 * admissible; unhedged assertions over an unestablished link are exactly the
 * correlation-into-causation conversion the epistemic laws forbid.
 */
const ASSERTIVE_CAUSAL = /\b(caused|drove|pushed|lifted|sent|sparked|triggered|dragged|pulled|led to|resulted in|drove higher|drove lower)\b/i;
/** Hedged/conditional causal language: an interpretation, not an assertion. */
const HEDGED_CAUSAL = /\b(could|may|might|suggests?|appears?|consistent with|likely|possibly|if |would |should |expected to|tends? to|associated with|correlat\w*)\b/i;
/** Statuses a link must NOT have for assertive causal language about it to stand. */
const ADMISSIBLE_LINK_STATUS: ReadonlySet<CausalLinkStatus> = new Set(["SUPPORTED", "PARTIALLY_SUPPORTED"]);

/**
 * Deterministic claim-vs-ledger check. Returns every claim the evidence does not support.
 */
export function contractViolations(answerText: string, state: ContractState): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  const executed = new Set(state.executedCapabilities);
  const evidence = state.evidenceText;
  const disconfirmationAttempted = executed.has("FALSIFICATION");

  for (const sentence of sentencesOf(answerText)) {
    if (NO_COUNTEREVIDENCE_CLAIM.test(sentence) && !disconfirmationAttempted) {
      violations.push({
        type: "COUNTEREVIDENCE_CLAIM_WITHOUT_SEARCH",
        sentence,
        detail:
          "the answer states that no counterevidence exists, but this run never attempted disconfirmation (no FALSIFICATION capability ran): say that counterevidence was not searched for, or remove the claim",
      });
    }
    if (COMPARISON_CLAIM.test(sentence) && !COMPARISON_EVIDENCE.test(evidence)) {
      violations.push({
        type: "COMPARISON_CLAIM_WITHOUT_COMPARISON_DATA",
        sentence,
        detail:
          "the answer compares periods, but the retrieved evidence contains no previous-period series (only the current period): remove the comparison or state that the comparison period was not established",
      });
    }
    if (EVENT_FACT_CLAIM.test(sentence) && !EVENT_EVIDENCE.test(evidence)) {
      violations.push({
        type: "EVENT_FACT_WITHOUT_EVENT_EVIDENCE",
        sentence,
        detail:
          "the answer states earnings facts (date, consensus), but no earnings-domain evidence was retrieved: remove the claim or state that the earnings context was not established",
      });
    }
  }

  // CAUSAL-LINK VALIDATION (research contract §3): when the contract derived transmission
  // links, assertive causal language about a link whose evidence is unresolved, stale-only or
  // never researched is a violation. Hedged language stays admissible; the ledger — not the
  // prose — decides whether the assertion is earned.
  const causalLinks = deriveCausalLinkStatuses(state.ledger as readonly ResearchRequirement[]);
  for (const link of causalLinks) {
    if (ADMISSIBLE_LINK_STATUS.has(link.status)) continue;
    for (const sentence of sentencesOf(answerText)) {
      if (!ASSERTIVE_CAUSAL.test(sentence) || HEDGED_CAUSAL.test(sentence)) continue;
      // The sentence must be ABOUT this link: it names the link's target market.
      if (!new RegExp(`\\b${link.targetLabel.split(/\s+/)[0]}\\b`, "i").test(sentence) &&
          !new RegExp(`\\b${link.target.replace(/_/g, "\\s?")}\\b`, "i").test(sentence)) continue;
      violations.push({
        type: "CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE",
        sentence,
        detail: `the answer asserts that the subject moved ${link.targetLabel}, but the evidence for that transmission link is ${link.status.toLowerCase()}: hedge the claim or state that the link was not established`,
      });
      break;
    }
  }

  // A conclusion drawn over an unresolved decision-critical requirement must acknowledge it.
  const unresolvedCore = state.ledger.filter(
    (r) => r.importance === "CRITICAL" && r.status !== "SATISFIED",
  );
  if (unresolvedCore.length > 0 && answerText.trim() !== "" && !GAP_ACKNOWLEDGEMENT.test(answerText)) {
    violations.push({
      type: "COVERAGE_CLAIM_OVER_UNRESOLVED_REQUIREMENT",
      sentence: sentencesOf(answerText)[0] ?? answerText.slice(0, 200),
      detail: `the answer states a conclusion without naming the unresolved requirement(s): ${unresolvedCore
        .map((r) => r.description)
        .join("; ")}`,
    });
  }
  return violations;
}

/** Strip the sentences that carry unsupported claims; used when a corrective retry also fails. */
export function stripUnsupportedClaims(answerText: string, violations: readonly ContractViolation[]): string {
  const offending = new Set(violations.filter((v) => v.type !== "COVERAGE_CLAIM_OVER_UNRESOLVED_REQUIREMENT").map((v) => v.sentence));
  if (offending.size === 0) return answerText;
  const kept = sentencesOf(answerText).filter((s) => !offending.has(s));
  return kept.join(" ");
}

/** The engine's own gap statement for a violation that survives correction. */
export function contractGapStatement(violations: readonly ContractViolation[]): string | undefined {
  if (violations.length === 0) return undefined;
  const details = [...new Set(violations.map((v) => v.detail))];
  return `Removed from this answer: ${details.join(" Also: ")}.`;
}
