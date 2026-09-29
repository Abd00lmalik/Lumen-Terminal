/**
 * Phase H: THESIS-AWARE MATERIAL CHANGE MONITORING — execution domain.
 *
 * Builds on the M5 monitoring HANDOFF (`Monitor` in memory.ts: proposal/activation/state
 * only, no infrastructure) and Phase G's Challenge records. This module adds what execution
 * requires:
 * - `MonitorExecution` fields for the existing Monitor (cadence, check state, linkage);
 * - deterministic CHECK identity (idempotency across cron/manual/retry/concurrency);
 * - `MonitoringAssessment` records (§11) with outcome vocabulary that keeps epistemic
 *   contracts intact: NO_DATA is not NEGATIVE; PROVIDER_UNAVAILABLE is not THESIS_WEAKENED;
 * - in-app Notifications (§13) for MATERIAL_CHANGE only, workspace-scoped.
 *
 * The LLM never owns scheduling, never mutates monitor state, and never declares a thesis
 * invalid: assessments are RESEARCH RESULTS about the thesis (the user decides what to do).
 */
import { newId, idPrefixes } from "./ids.js";
import { createProvenance, appendProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";
import type { ISO } from "./objects.js";
import type { MonitorCondition } from "./memory.js";

// ---------------------------------------------------------------------------
// Cadence (§8): a small deterministic set, no scheduling DSL.
// ---------------------------------------------------------------------------

export type MonitorCadence = "DAILY" | "WEEKLY" | "MANUAL";

export const MONITOR_CADENCES: readonly MonitorCadence[] = ["DAILY", "WEEKLY", "MANUAL"];

/** Deterministic cadence → minimum epoch-ms between checks (MANUAL: never auto-scheduled). */
export function cadenceIntervalMs(cadence: MonitorCadence): number | undefined {
  switch (cadence) {
    case "DAILY": return 24 * 60 * 60 * 1000;
    case "WEEKLY": return 7 * 24 * 60 * 60 * 1000;
    case "MANUAL": return undefined;
  }
}

/** Is a scheduled check DUE for this monitor at `now` (never true for MANUAL)? */
export function checkDue(monitor: { cadence: MonitorCadence; lastCheckedAt?: ISO }, now: Date): boolean {
  const interval = cadenceIntervalMs(monitor.cadence);
  if (interval === undefined) return false; // MANUAL: scheduled checks never fire
  if (monitor.lastCheckedAt === undefined) return true;
  return now.getTime() - Date.parse(monitor.lastCheckedAt) >= interval;
}

// ---------------------------------------------------------------------------
// Assessment outcomes (§11): NOT a boolean trigger. Failures keep their type (§18).
// ---------------------------------------------------------------------------

export type MonitoringOutcome =
  | "NO_MATERIAL_CHANGE"
  | "MATERIAL_CHANGE"
  | "INSUFFICIENT_EVIDENCE"
  | "PROVIDER_UNAVAILABLE"
  | "MONITOR_PAUSED";

export interface MonitorCheckIdentity {
  /** Deterministic check id: monitorRef + evaluation window + trigger version. */
  readonly checkId: string;
  readonly monitorRef: string;
  /** ISO instant this evaluation window STARTS (bucketed; retries share it). */
  readonly windowStart: ISO;
  /** Increments when conditions/trigger config change (re-check becomes legitimate). */
  readonly triggerVersion: number;
}

/**
 * Bucket `at` into the monitor's evaluation window (cron granularity). Retries and
 * concurrent invocations inside the same window produce the SAME checkId → the second
 * writer loses idempotently instead of duplicating assessments/notifications.
 */
export function checkIdentity(monitorRef: string, cadence: MonitorCadence, at: Date, triggerVersion: number): MonitorCheckIdentity {
  const bucketMs = cadenceIntervalMs(cadence) ?? 24 * 60 * 60 * 1000; // MANUAL checks bucket daily
  const windowStart = new Date(Math.floor(at.getTime() / bucketMs) * bucketMs).toISOString();
  const checkId = `${monitorRef}:${windowStart}:v${triggerVersion}`;
  return { checkId, monitorRef, windowStart, triggerVersion };
}

// ---------------------------------------------------------------------------
// Monitoring assessment (§11)
// ---------------------------------------------------------------------------

export interface ConditionChange {
  /** Which monitored condition changed. */
  readonly condition: string;
  /** CONDITION ≠ OBSERVATION ≠ CHANGE ≠ MATERIALITY ≠ THESIS_IMPLICATION (§5): kept apart. */
  readonly previousState: string;
  readonly currentState: string;
  /** Evidence supporting the CHANGE (validated graph refs; never fabricated). */
  readonly evidenceRefs: readonly string[];
  /** Is the difference meaningful per the materiality layer (§6)? */
  readonly materiality: "NOISE" | "MINOR" | "MEANINGFUL" | "MATERIAL";
  readonly materialityRationale: string;
  /** Freshness of the change (stale sources are STALE, never CURRENT_CHANGE; §18). */
  readonly freshness: "CURRENT" | "STALE" | "HISTORICAL";
}

export interface MonitoringAssessment {
  readonly id: string;
  readonly monitorRef: string;
  readonly thesisRef?: string;
  readonly thesisVersion?: number;
  /** Deterministic identity (above): the idempotency key across cron/manual/retry. */
  readonly checkId: string;
  readonly checkedAt: ISO;
  readonly outcome: MonitoringOutcome;
  /** What changed (empty unless outcome === MATERIAL_CHANGE). */
  readonly changedConditions: readonly ConditionChange[];
  /** Thesis impact vocabulary (§12): NEVER an automatic mutation, an implication only. */
  readonly thesisImpact: "SUPPORTS_THESIS" | "WEAKENS_THESIS" | "POTENTIALLY_INVALIDATES_ASSUMPTION" | "NO_IMPACT" | "UNDETERMINED";
  readonly summary: string;
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  /** The research run that backs this assessment (provenance; History-linked). */
  readonly researchRef?: string;
  /** A notification was generated for this assessment (dedup: at most one per checkId). */
  readonly notificationRef?: string;
  readonly provenance: Provenance;
  readonly createdAt: ISO;
}

export function createMonitoringAssessment(
  input: Omit<MonitoringAssessment, "id" | "provenance" | "createdAt">,
  origin: ProvenanceOrigin,
  at?: Date,
): MonitoringAssessment {
  const timestamp = (at ?? new Date()).toISOString();
  return Object.freeze({
    ...input,
    id: newId(idPrefixes.monitorCheck),
    provenance: createProvenance(origin, `${input.outcome} (check ${input.checkId})`, at),
    createdAt: timestamp,
  });
}

// ---------------------------------------------------------------------------
// In-app notification (§13): MATERIAL_CHANGE only; workspace-scoped by construction.
// ---------------------------------------------------------------------------

export interface MonitorNotification {
  readonly id: string;
  readonly monitorRef: string;
  readonly assessmentRef: string;
  readonly checkId: string;
  readonly title: string;
  readonly summary: string;
  readonly materiality: ConditionChange["materiality"];
  readonly thesisImpact: MonitoringAssessment["thesisImpact"];
  /** The research run that generated the alert (provenance chain: notification → assessment → research). */
  readonly researchRef?: string;
  readonly read: boolean;
  readonly provenance: Provenance;
  readonly createdAt: ISO;
}

export function createNotification(
  input: {
    monitorRef: string;
    assessmentRef: string;
    checkId: string;
    title: string;
    summary: string;
    materiality: ConditionChange["materiality"];
    thesisImpact: MonitoringAssessment["thesisImpact"];
    researchRef?: string;
  },
  origin: ProvenanceOrigin,
  at?: Date,
): MonitorNotification {
  const timestamp = (at ?? new Date()).toISOString();
  return Object.freeze({
    ...input,
    id: newId(idPrefixes.notification),
    read: false,
    provenance: createProvenance(origin, `material-change notification (assessment ${input.assessmentRef})`, at),
    createdAt: timestamp,
  });
}

/** Merge-safe update of an existing Monitor with execution state (never conditions). */
export interface MonitorExecutionPatch {
  readonly cadence?: MonitorCadence;
  readonly lastCheckedAt?: ISO;
  readonly lastTriggeredAt?: ISO;
  readonly lastAssessmentRef?: string;
  /** Challenges/falsifiers this monitor watches (challengeRef linkage; §17). */
  readonly linkedChallengeRefs?: readonly string[];
  readonly triggerVersion?: number;
}

export function applyExecutionPatch(monitor: import("./memory.js").Monitor, patch: MonitorExecutionPatch, origin: ProvenanceOrigin, note: string, at?: Date): import("./memory.js").Monitor {
  const atDate = at ?? new Date();
  return Object.freeze({
    ...monitor,
    ...(patch.cadence !== undefined ? { cadence: patch.cadence } : {}),
    ...(patch.lastCheckedAt !== undefined ? { lastCheckedAt: patch.lastCheckedAt } : {}),
    ...(patch.lastTriggeredAt !== undefined ? { lastTriggeredAt: patch.lastTriggeredAt } : {}),
    ...(patch.lastAssessmentRef !== undefined ? { lastAssessmentRef: patch.lastAssessmentRef } : {}),
    ...(patch.linkedChallengeRefs !== undefined ? { linkedChallengeRefs: Object.freeze([...patch.linkedChallengeRefs]) } : {}),
    ...(patch.triggerVersion !== undefined ? { triggerVersion: patch.triggerVersion } : {}),
    provenance: appendProvenance(monitor.provenance, origin, note, atDate),
    updatedAt: atDate.toISOString(),
  });
}

/** Re-export for workspace wiring convenience. */
export type { MonitorCondition };
