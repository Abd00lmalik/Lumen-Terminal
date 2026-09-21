/**
 * DETERMINISTIC CONFIDENCE POLICY (research contract).
 *
 * The model interprets evidence; it does not get to declare how much of the question was
 * actually researched. Confidence is COMPUTED from engine-owned state — requirement coverage by
 * role, evidence freshness, disconfirmation attempt, required calculations, and the outcome of
 * recovery — and any model-stated confidence is capped by it. A run missing a CORE requirement it
 * could not recover cannot be HIGH merely because the prose reads well.
 *
 * Deterministic and asset-agnostic: nothing here inspects the question text.
 */
import type { ResearchRequirement } from "./requirements.js";

export type ConfidenceLevel = "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface ConfidenceInput {
  readonly requirements: readonly ResearchRequirement[];
  /** How the run ended (engine vocabulary). */
  readonly stoppedBecause: string;
  /** Capabilities that were attempted and failed (transport/provider failures). */
  readonly failedPaths: number;
  /** Required calculations the engine could not perform. */
  readonly calculationsMissing?: number;
}

export interface ConfidenceComponents {
  /** Fraction of CORE requirements satisfied. */
  readonly coreCoverage: number;
  /** CORE requirements still unresolved after recovery (ids). */
  readonly unresolvedCore: readonly string[];
  /** Requirements satisfied only by stale evidence. */
  readonly staleOnly: readonly string[];
  /** Did a disconfirmation-capable capability actually run? */
  readonly challengeAttempted: boolean;
  /** Did the engine end by naming an unresolved requirement instead of answering? */
  readonly honestGap: boolean;
  /** Provider paths that failed during the run (recovery pressure, not evidence). */
  readonly failedPaths: number;
  /** Required calculations that could not be performed. */
  readonly calculationsMissing: number;
  /** The computed level before any model input. */
  readonly level: ConfidenceLevel;
}

const ORDER: Readonly<Record<ConfidenceLevel, number>> = { UNKNOWN: 0, LOW: 1, MODERATE: 2, HIGH: 3 };

function cap(level: ConfidenceLevel, ceiling: ConfidenceLevel): ConfidenceLevel {
  return ORDER[level] > ORDER[ceiling] ? ceiling : level;
}

/** Lower of two levels (the model may not raise a computed level, only lower it). */
export function boundConfidence(modelLevel: string | undefined, computed: ConfidenceLevel): ConfidenceLevel {
  const normalized: ConfidenceLevel =
    modelLevel === "HIGH" || modelLevel === "MODERATE" || modelLevel === "LOW" ? modelLevel : computed;
  return cap(normalized, computed);
}

export function computeConfidence(input: ConfidenceInput): ConfidenceComponents {
  const core = input.requirements.filter((r) => r.role === "CORE" && r.importance === "CRITICAL");
  const satisfiedCore = core.filter((r) => r.status === "SATISFIED");
  const unresolvedCore = core.filter((r) => r.status !== "SATISFIED").map((r) => r.id);
  const coreCoverage = core.length === 0 ? 0 : satisfiedCore.length / core.length;
  const staleOnly = input.requirements
    .filter((r) => r.status !== "SATISFIED" && r.staleOnlyRefs.length > 0)
    .map((r) => r.id);
  const challenge = input.requirements.filter((r) => r.role === "CHALLENGE");
  const challengeAttempted =
    challenge.length === 0
      ? false
      : challenge.every((r) => r.recoveryAttempts > 0 || r.status === "SATISFIED" || r.status === "UNAVAILABLE");
  const calculationsMissing = input.calculationsMissing ?? 0;
  const honestGap =
    input.stoppedBecause === "REQUIREMENT_GAPS_UNRESOLVED" ||
    input.stoppedBecause === "MODEL_INSUFFICIENT_EVIDENCE" ||
    input.stoppedBecause === "INSUFFICIENT_EVIDENCE";

  // The ladder, applied in order: each condition can only LOWER the level.
  let level: ConfidenceLevel = core.length === 0 ? "LOW" : "HIGH";
  if (coreCoverage < 1) level = cap(level, "LOW");
  else if (coreCoverage < 0.75) level = cap(level, "MODERATE");
  if (staleOnly.length > 0) level = cap(level, "MODERATE");
  if (!challengeAttempted) level = cap(level, "MODERATE");
  if (calculationsMissing > 0) level = cap(level, "MODERATE");
  else if (calculationsMissing > 1) level = cap(level, "LOW");
  if (input.failedPaths > 0) level = cap(level, "MODERATE");
  if (honestGap || coreCoverage === 0) level = cap(level, "LOW");
  if (input.requirements.length === 0) level = "UNKNOWN";

  return {
    coreCoverage,
    unresolvedCore,
    staleOnly,
    challengeAttempted,
    honestGap,
    failedPaths: input.failedPaths,
    calculationsMissing,
    level,
  };
}

/** One-line provenance for diagnostics (never prose for the trader). */
export function renderConfidence(c: ConfidenceComponents): string {
  return [
    `computed=${c.level}`,
    `coreCoverage=${(c.coreCoverage * 100).toFixed(0)}%`,
    `unresolvedCore=${c.unresolvedCore.length === 0 ? "none" : c.unresolvedCore.join(",")}`,
    `staleOnly=${c.staleOnly.length === 0 ? "none" : c.staleOnly.join(",")}`,
    `challenge=${c.challengeAttempted ? "attempted" : "not attempted"}`,
    `failedPaths=${c.failedPaths}`,
    `missingCalculations=${c.calculationsMissing}`,
    `honestGap=${c.honestGap ? "yes" : "no"}`,
  ].join(" ");
}
