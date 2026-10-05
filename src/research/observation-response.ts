/**
 * OBSERVATION RESPONSE CONTRACT — the answer shape a non-causal, non-judgmental flow owes.
 *
 * THE REPRODUCTION this exists for: a WHAT_HAPPENED request that explicitly forbade causes,
 * drivers, mechanisms, theses, counterevidence, materiality and trading implications came back
 * with causal machinery (strongest support, meaningful opposition, mechanism, transmission,
 * materiality, "what would change this conclusion") and an answer built from Oct 1–3 headlines
 * instead of the requested 24-hour price timeline.
 *
 * The compact shape the flow DOES owe, and nothing beyond it:
 *
 *   What happened
 *   [timestamp] — BTC was at X.
 *   [timestamp] — BTC reached the session high of Y.
 *
 *   What is directly observed
 *   ...  (exchange prints, OHLCV, volume — DIRECT_OBSERVATION evidence)
 *
 *   What is reported
 *   ...  (headlines, statements, announcements — REPORTED_CLAIM evidence, labelled as claims)
 *
 *   Missing evidence
 *   ...  (what could not be established; never silently filled with unrelated news)
 *
 * This is a FLOW CONTRACT, not a formatter preference: the sections below exist because the
 * selected flow grants WHAT_HAPPENED and RECENCY and nothing else. The suppression of causal
 * sections happens at the layer that selects sections for this flow — the same place the flow is
 * resolved — never by stripping text a causal synthesis already produced.
 */
import type { Evidence } from "../domain/objects.js";
import type { ResearchRequirement } from "./requirements.js";
import type { SourcingClass } from "../domain/objects.js";

/** The sourcing class of one observation; unclassified items are never counted as observations. */
export function sourcingClassOf(evidence: Pick<Evidence, "sourcing" | "sourceType">): SourcingClass | undefined {
  return evidence.sourcing;
}

/** Direct observation: an exchange print, an OHLCV candle, a market-data series. */
export function isDirectObservation(evidence: Pick<Evidence, "sourcing" | "sourceType">): boolean {
  return sourcingClassOf(evidence) === "DIRECT_OBSERVATION";
}

/** A reported claim: a headline, an analyst statement, an announcement carried by a secondary source. */
export function isReportedClaim(evidence: Pick<Evidence, "sourcing" | "sourceType">): boolean {
  return sourcingClassOf(evidence) === "REPORTED_CLAIM";
}

export interface ObservationResponseInput {
  readonly evidence: readonly Evidence[];
  readonly requirements: readonly ResearchRequirement[];
  /** The run's own headline answer, when one exists; never extended with causal material. */
  readonly narrative?: string;
}

export interface ObservationResponse {
  readonly answer: string;
  readonly citedObjectRefs: readonly string[];
  /** Requirements the run could not establish — the honest "missing evidence" list. */
  readonly gaps: readonly string[];
}

/** "2026-10-04T13:05:00.000Z" → "2026-10-04 13:05 UTC"; unparseable input is passed through. */
function stamp(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "undated";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 10)} ${parsed.toISOString().slice(11, 16)} UTC`;
}

/** A compact one-line rendering of an observation; long payloads are truncated, never dropped. */
function line(e: Evidence): string {
  const text = e.observation.replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

/** Event time when the source declared one, else when the system observed it. */
const eventTime = (e: Evidence): string => e.timestamp ?? e.observedAt;

/**
 * Render the observation contract's answer.
 *
 * HONESTY LAWS preserved here (research contract, not weakened by this flow):
 *  - a timeline entry is printed ONLY from an observation this run actually retrieved;
 *  - a reported claim is never printed as an observation, and never dated as one;
 *  - when no direct observation covers the requested window the answer SAYS the timeline cannot be
 *    established, instead of filling the answer with unrelated headlines (the reproduction's
 *    evidence failure);
 *  - missing evidence is named on the requirement's own terms; retrieval failure is never
 *    presented as a negative finding.
 */
export function renderObservationResponse(input: ObservationResponseInput): ObservationResponse {
  const observed = input.evidence.filter(isDirectObservation);
  const reported = input.evidence.filter(isReportedClaim);
  // Unclassified items are neither: they are surfaced under missing evidence as unclassified
  // inputs rather than silently promoted to observations.
  const unclassified = input.evidence.filter((e) => sourcingClassOf(e) === undefined);

  const timeline = [...observed].sort((a, b) => eventTime(a).localeCompare(eventTime(b)));
  const parts: string[] = [];

  parts.push("**What happened**");
  if (timeline.length === 0) {
    parts.push(
      "The requested timeline could not be established from the evidence this run retrieved: no directly observed price, OHLCV or volume record for the requested window was available. Nothing has been substituted for it.",
    );
  } else {
    for (const e of timeline.slice(0, 4)) {
      // A plain hyphen, not an em dash: the transport layer rewrites em dashes to "; " (uiText), which
    // turned every timeline entry into "[time] ; BTC ..." on screen.
    parts.push(`[${stamp(eventTime(e))}] - ${line(e)} [${e.id}]`);
    }
  }
  if (input.narrative !== undefined && input.narrative.trim() !== "") {
    parts.push(input.narrative.trim());
  }

  parts.push("");
  parts.push("**What is directly observed**");
  // The timeline above IS the observation list; repeating it verbatim would double the answer
  // for no information. Only observations that did not fit the timeline are added here, so the
  // section states the sourcing basis and the remainder without restating the same lines.
  const remainder = observed.slice(timeline.length, timeline.length + 3);
  parts.push(
    observed.length === 0
      ? "None retrieved for the requested window."
      : `${observed.length} direct observation(s) from primary market-data feeds, listed above${
          remainder.length > 0 ? ":\n" + remainder.map((e) => `[${stamp(eventTime(e))}] ${line(e)} [${e.id}]`).join("\n") : ""
        }.`,
  );

  parts.push("");
  parts.push("**What is reported** (reported claims, not observations)");
  parts.push(
    reported.length === 0
      ? "None retrieved."
      : reported.slice(0, 3).map((e) => `${line(e)} [${e.id}]`).join("\n"),
  );

  const gaps = gapsOf(input.requirements);
  parts.push("");
  parts.push("**Missing evidence**");
  parts.push(
    [
      ...gaps,
      ...(unclassified.length > 0
        ? [`${unclassified.length} retrieved item(s) could not be classified as direct observation or reported claim`]
        : []),
    ].join("\n") === ""
      ? "Nothing outstanding: every requirement of this question was established."
      : [...gaps, ...(unclassified.length > 0 ? [`${unclassified.length} retrieved item(s) could not be classified as direct observation or reported claim`] : [])].join("\n"),
  );

  return {
    answer: parts.join("\n"),
    citedObjectRefs: input.evidence.slice(0, 10).map((e) => e.id),
    gaps,
  };
}

/**
 * Requirements this run could not establish, phrased on the requirement's own terms. A CRITICAL
 * gap is a real coverage gap; a CHALLENGE row is never owed by this flow; CONTEXT never blocks.
 */
export function gapsOf(requirements: readonly ResearchRequirement[]): readonly string[] {
  return requirements
    .filter((r) => r.role !== "CONTEXT" && r.role !== "CHALLENGE" && r.importance === "CRITICAL" && r.status !== "SATISFIED")
    .map((r) => `${r.description}: ${r.status === "EXHAUSTED" || r.status === "UNAVAILABLE"
      ? "could not be established from the available research paths"
      : "not established by the collected evidence"}`);
}