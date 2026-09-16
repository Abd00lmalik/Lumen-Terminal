/**
 * Research Memory & Monitoring Handoff; M5 domain additions (continuity layer).
 *
 * Architectural basis:
 * - memory.md MEMORY ENTRY MODEL (id, type, content, source_object, source_research, created_at,
 *   updated_at, context, provenance, status, freshness, confidence, relationships, version/history,
 *   usage_constraints) + MEMORY VS CURRENT STATE ("CURRENT STATE always takes precedence for the
 *   active investigation") + FRESHNESS (CURRENTLY RELEVANT / HISTORICALLY RELEVANT / STALE /
 *   INVALID / UNKNOWN) + MEMORY REVALIDATION (original preserved even when usefulness changes).
 * - M5 §3: CURRENT VALIDATED RESEARCH > PERSISTENT MEMORY > HISTORICAL MEMORY > INFERRED PREFERENCE.
 *   Memory is continuity, not authority. Stale memory is NEVER silently treated as current
 *   evidence (M5 §5): decay reduces current influence, not existence (no deletion).
 * - M5 §4: memory categories research/thesis/framework/preference/historical/monitor. Only an
 *   explicit confirmed SAVE promotes research into persistent memory; normal research updates
 *   the workspace WITHOUT becoming reusable memory.
 * - M5 §18 (memory conflicts): current research wins for current judgment; the historical record
 *   is preserved; never silently overwritten. The validation relationship is recorded.
 * - M5 §10/§11 (monitor handoff): MONITOR representation per thesis-monitor-reassessment.md §21
 *   (MONITOR: target, thesis_refs, conditions, severity, frequency, reassessment_policy, status,
 *   lineage, history, provenance) + §22 (MONITOR_CONDITION with trigger_type/materiality).
 *   Invalidation vs early-warning conditions are DISTINCT (§323: "An early warning is weaker
 *   than invalidation"); never merged (M5 §10). Activation is a trader-confirmed boundary:
 *   PROPOSED → (trader confirms) → ACTIVE → PAUSED / STALE / COMPLETED (lifecycle MONITOR
 *   LIFECYCLE; §20 "No Silent Monitor Activation"). No monitoring infrastructure in M5; this is
 *   the persistent handoff/state a future monitoring layer consumes.
 * - M5 §12 (source failure law): SOURCE_UNAVAILABLE is a monitoring LIMITATION/state; "could
 *   not retrieve source" is NEVER "thesis invalidated" (no false alerts).
 * - ids.ts: prefixes `mem_`, `mon_` (M5).
 */

import { newId } from "./ids.js";
import { createProvenance, appendProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";
import type { ISO } from "./objects.js";

// ---------------------------------------------------------------------------
// RESEARCH MEMORY; persistent, decayable, revalidatable (memory.md)
// ---------------------------------------------------------------------------

/** Memory categories (memory.md §2; M5 §4). */
export type MemoryCategory = "research" | "thesis" | "framework" | "preference" | "historical" | "monitor";

/** Memory decay status (memory.md FRESHNESS; M5 §5): decay reduces influence, not existence. */
export type MemoryStatus = "CURRENT" | "STALE" | "HISTORICAL";

export interface MemoryEntry {
  readonly id: string;
  readonly category: MemoryCategory;
  /** The reusable knowledge/artifact content (what was promoted via SAVE). */
  readonly content: string;
  /** Workspace object this memory derives from (evidence/claim/judgment/thesis/artifact id). */
  readonly sourceObjectRef?: string;
  /** The research this memory came from (provenance chain: memory → research → evidence…). */
  readonly sourceResearchRef?: string;
  /** SavedArtifact provenance when the memory was promoted through an explicit SAVE. */
  readonly artifactRef?: string;
  /** Thesis version this memory is bound to (thesis memories track the exact version). */
  readonly thesisRef?: string;
  readonly thesisVersion?: number;
  readonly provenance: Provenance;
  readonly createdAt: ISO;
  readonly updatedAt: ISO;
  /** Last time this memory was confirmed still valid/current (revalidation timestamps). */
  readonly lastValidatedAt?: ISO;
  readonly status: MemoryStatus;
  /** Why the status holds (e.g. what made it stale / what revalidated it); auditable decay. */
  readonly statusReason?: string;
  /** Free-text context tags (asset, question, topic) for materiality-scoped retrieval. */
  readonly contextTags: readonly string[];
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  /** What current research said about this memory during revalidation, when it happened. */
  readonly validationNote?: string;
}

export function createMemoryEntry(
  input: {
    category: MemoryCategory;
    content: string;
    contextTags?: readonly string[];
    sourceObjectRef?: string;
    sourceResearchRef?: string;
    artifactRef?: string;
    thesisRef?: string;
    thesisVersion?: number;
    confidence?: "HIGH" | "MODERATE" | "LOW";
  },
  origin: ProvenanceOrigin,
  at?: Date,
): MemoryEntry {
  const timestamp = (at ?? new Date()).toISOString();
  return Object.freeze({
    id: newId("memory"),
    category: input.category,
    content: input.content,
    ...(input.sourceObjectRef !== undefined ? { sourceObjectRef: input.sourceObjectRef } : {}),
    ...(input.sourceResearchRef !== undefined ? { sourceResearchRef: input.sourceResearchRef } : {}),
    ...(input.artifactRef !== undefined ? { artifactRef: input.artifactRef } : {}),
    ...(input.thesisRef !== undefined ? { thesisRef: input.thesisRef } : {}),
    ...(input.thesisVersion !== undefined ? { thesisVersion: input.thesisVersion } : {}),
    provenance: createProvenance(origin, `memory created (${input.category})`, at),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "CURRENT",
    contextTags: input.contextTags ?? [],
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
  });
}

/** Mark memory stale/historical; decay reduces current influence; the entry is NEVER deleted. */
export function decayMemory(
  entry: MemoryEntry,
  status: "STALE" | "HISTORICAL",
  reason: string,
  origin: ProvenanceOrigin,
  at?: Date,
): MemoryEntry {
  const atDate = at ?? new Date();
  return Object.freeze({
    ...entry,
    status,
    statusReason: reason,
    provenance: appendProvenance(entry.provenance, origin, `memory → ${status}: ${reason}`, atDate),
    updatedAt: atDate.toISOString(),
  });
}

/**
 * Revalidate memory against current research (memory.md MEMORY REVALIDATION): the ORIGINAL is
 * preserved; the validation relationship + outcome are recorded on the entry.
 */
export function revalidateMemory(
  entry: MemoryEntry,
  outcome: { confirmed: boolean; note: string; newStatus?: MemoryStatus },
  origin: ProvenanceOrigin,
  at?: Date,
): MemoryEntry {
  const atDate = at ?? new Date();
  return Object.freeze({
    ...entry,
    lastValidatedAt: atDate.toISOString(),
    validationNote: `${outcome.confirmed ? "revalidated: confirmed current" : "revalidated: NOT confirmed by current research"}; ${outcome.note}`,
    ...(outcome.newStatus !== undefined ? { status: outcome.newStatus } : {}),
    provenance: appendProvenance(entry.provenance, origin, `memory revalidated (${outcome.confirmed ? "confirmed" : "not confirmed"}): ${outcome.note}`, atDate),
    updatedAt: atDate.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// MONITORING HANDOFF; the persistent representation of what should be monitored
// (no infrastructure: proposal/activation/state only)
// ---------------------------------------------------------------------------

export type MonitorLifecycleStatus = "PROPOSED" | "ACTIVE" | "PAUSED" | "STALE" | "COMPLETED";

/**
 * Condition kind; invalidation vs early-warning are DISTINCT (thesis-monitor-reassessment.md
 * §323; M5 §10): an early warning signals increasing risk; an invalidation condition's occurrence
 * materially undermines the thesis.
 */
export type MonitorConditionKind = "INVALIDATION" | "EARLY_WARNING";

export interface MonitorCondition {
  readonly description: string;
  readonly kind: MonitorConditionKind;
  /** Trigger type vocabulary (thesis-monitor-reassessment.md §23); meaningful conditions only. */
  readonly triggerType: "THRESHOLD" | "STATE_CHANGE" | "EVENT" | "PATTERN" | "CONTRADICTION" | "NEW_EVIDENCE" | "TIME" | "DEPENDENCY_CHANGE" | "SOURCE_UPDATE";
  /** Where this condition came from: the thesis's own text vs proposed by research (M4 §19 law). */
  readonly conditionStatus: "DERIVED_FROM_THESIS" | "PROPOSED";
  readonly rationale: string;
  /** Evidence/source dependencies this condition depends on (MONITOR_CONDITION evidence_requirement). */
  readonly evidenceDependencies: readonly string[];
}

export interface Monitor {
  readonly id: string;
  /** What is monitored (asset/topic/research target). */
  readonly target: string;
  /** Thesis + exact version this monitor guards (monitor → thesis version provenance). */
  readonly thesisRef?: string;
  readonly thesisVersion?: number;
  readonly conditions: readonly MonitorCondition[];
  /** Freshness expectation for the monitored signals (how current the data must be). */
  readonly freshnessExpectation?: string;
  /** Suggested cadence/scope; representation only; no scheduler exists in M5. */
  readonly suggestedFrequency?: "REAL_TIME" | "HIGH" | "MEDIUM" | "LOW";
  /** Why these conditions deserve monitoring (trigger rationale). */
  readonly triggerRationale: string;
  readonly status: MonitorLifecycleStatus;
  /** Source unavailability is a STATE, never a false alert (M5 §12). */
  readonly sourceStates: readonly { readonly ref: string; readonly state: "SOURCE_UNAVAILABLE" | "OK"; readonly note: string; readonly at: ISO }[];
  readonly provenance: Provenance;
  readonly createdAt: ISO;
  readonly updatedAt: ISO;
}

/** Propose a monitor; status PROPOSED, inert until explicit trader confirmation (M5 §11). */
export function proposeMonitor(
  input: {
    target: string;
    conditions: readonly MonitorCondition[];
    triggerRationale: string;
    thesisRef?: string;
    thesisVersion?: number;
    freshnessExpectation?: string;
    suggestedFrequency?: "REAL_TIME" | "HIGH" | "MEDIUM" | "LOW";
  },
  origin: ProvenanceOrigin,
  at?: Date,
): Monitor {
  const timestamp = (at ?? new Date()).toISOString();
  return Object.freeze({
    id: newId("monitor"),
    target: input.target,
    ...(input.thesisRef !== undefined ? { thesisRef: input.thesisRef } : {}),
    ...(input.thesisVersion !== undefined ? { thesisVersion: input.thesisVersion } : {}),
    conditions: input.conditions,
    triggerRationale: input.triggerRationale,
    ...(input.freshnessExpectation !== undefined ? { freshnessExpectation: input.freshnessExpectation } : {}),
    ...(input.suggestedFrequency !== undefined ? { suggestedFrequency: input.suggestedFrequency } : {}),
    status: "PROPOSED",
    sourceStates: [],
    provenance: createProvenance(origin, "monitor proposed (inert; activation requires trader confirmation)", at),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

const MONITOR_TRANSITIONS: Record<MonitorLifecycleStatus, readonly MonitorLifecycleStatus[]> = {
  PROPOSED: ["ACTIVE", "COMPLETED"],
  ACTIVE: ["PAUSED", "STALE", "COMPLETED"],
  PAUSED: ["ACTIVE", "STALE", "COMPLETED"],
  STALE: ["ACTIVE", "PAUSED", "COMPLETED"],
  COMPLETED: [],
};

/** Lifecycle transition with the confirmation boundary enforced at the workspace level. */
export function transitionMonitor(monitor: Monitor, to: MonitorLifecycleStatus, origin: ProvenanceOrigin, note: string, at?: Date): Monitor {
  const allowed = MONITOR_TRANSITIONS[monitor.status];
  if (!allowed.includes(to)) {
    throw new Error(`illegal monitor transition ${monitor.status} → ${to} (allowed: ${allowed.join(", ")})`);
  }
  const atDate = at ?? new Date();
  return Object.freeze({
    ...monitor,
    status: to,
    provenance: appendProvenance(monitor.provenance, origin, `monitor → ${to}: ${note}`, atDate),
    updatedAt: atDate.toISOString(),
  });
}

/**
 * Record a source state; "could not retrieve source" is SOURCE_UNAVAILABLE, a monitoring
 * limitation. It must NEVER be interpreted as a thesis invalidation (M5 §12).
 */
export function recordMonitorSourceState(
  monitor: Monitor,
  sourceRef: string,
  state: "SOURCE_UNAVAILABLE" | "OK",
  note: string,
  origin: ProvenanceOrigin,
  at?: Date,
): Monitor {
  const atDate = at ?? new Date();
  return Object.freeze({
    ...monitor,
    sourceStates: [...monitor.sourceStates, { ref: sourceRef, state, note, at: atDate.toISOString() }],
    provenance: appendProvenance(monitor.provenance, origin, `monitor source state → ${state} (${sourceRef}): ${note}`, atDate),
    updatedAt: atDate.toISOString(),
  });
}

/** Revalidate monitor conditions after reassessment (M5 §15); review flag, never silent change. */
export function flagMonitorForReview(monitor: Monitor, reason: string, origin: ProvenanceOrigin, at?: Date): Monitor {
  const atDate = at ?? new Date();
  return Object.freeze({
    ...monitor,
    status: "STALE",
    provenance: appendProvenance(monitor.provenance, origin, `monitor flagged for review (conditions may no longer be material): ${reason}`, atDate),
    updatedAt: atDate.toISOString(),
  });
}
