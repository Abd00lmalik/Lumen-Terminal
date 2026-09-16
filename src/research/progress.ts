/**
 * Progress-event vocabulary for the F0 API seam (FRONTEND_ARCHITECTURE.md §6/§7).
 *
 * These events correspond ONLY to observable application lifecycle transitions; the LUI
 * pipeline stages, research-plan creation, capability execution, and completion. They exist so
 * the HTTP/SSE layer can stream REAL progress instead of decorative animation. No event carries
 * hidden model reasoning, raw provider payloads, or secrets; `data` is limited to safe
 * identifiers and statuses by construction (emit sites pass only those).
 *
 * Additive to M0–M5: the engine emits events when (and only when) a listener is provided;
 * with no listener the behavior is byte-identical to before.
 */

export type ProgressStage =
  // LUI request-lifecycle stages (lui.ts pipeline order)
  | "request_accepted"
  | "intent_understood"
  | "target_resolved"
  | "ambiguity_checked"
  | "consequence_checked"
  | "safety_checked"
  | "plan_created"
  | "step_started"
  | "response_ready"
  // research-loop stages (adaptive.ts / flow-runner.ts)
  | "research_plan_created"
  | "capability_started"
  | "capability_completed"
  | "research_round_completed"
  | "research_stopped";

export interface ProgressEvent {
  readonly stage: ProgressStage;
  /** ISO timestamp of the transition. */
  readonly at: string;
  /** Safe, human-readable summary; observable transition only, never model reasoning. */
  readonly summary: string;
  /** Safe structured detail: identifiers, statuses, capability names. No payloads, no secrets. */
  readonly data?: Readonly<Record<string, string | number | boolean>>;
}

export type ProgressListener = (event: ProgressEvent) => void;

/** Helper for emit sites: builds the event with the timestamp supplied by the caller's clock. */
export function progressEvent(
  stage: ProgressStage,
  at: Date,
  summary: string,
  data?: Record<string, string | number | boolean>,
): ProgressEvent {
  return { stage, at: at.toISOString(), summary, ...(data !== undefined ? { data } : {}) };
}
