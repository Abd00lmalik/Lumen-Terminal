/**
 * Phase H: MONITORING EXECUTION ORCHESTRATOR (§7).
 *
 * Owns: when a check occurs, check identity/idempotency (§10), bounded research through the
 * ENGINE (never its own model calls), the deterministic MATERIALITY layer (§6), assessment
 * persistence (§11), and notification creation (§13). The LLM owns nothing here.
 *
 * Budget bounds (§23): one research run per check, a hard wall-clock budget, and a
 * MONITOR_CHECK_BUDGET_EXHAUSTED outcome when the check cannot honestly complete.
 */
import type { ResearchApp } from "../api/research-app.js";
import type { Workspace } from "../domain/workspace.js";
import { checkIdentity, checkDue, createMonitoringAssessment, createNotification,
  type MonitoringAssessment, type MonitorNotification, type ConditionChange, type MonitoringOutcome, type MonitorCadence } from "../domain/monitoring.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

/** Budget bounds (§23). */
export const MONITOR_CHECK_BUDGET_MS = 180_000; // inside the 210s research budget
export const MAX_CHECKS_PER_CRON = 5; // bounded batch per invocation

/**
 * §10 concurrency: the checkId dedup gate only sees PERSISTED assessments, so two interleaved
 * invocations of the same logical check (cron retry + manual, or a same-process race) would
 * both run research and both persist. An in-flight registry makes the second invocation await
 * the first's result and return it as a dedup no-op. Cross-instance races are still closed by
 * the persisted-checkId gate at merge time (deterministic identity, union by id).
 */
const inFlightChecks = new Map<string, Promise<MonitorCheckResult>>();

export interface MonitorCheckResult {
  readonly monitorRef: string;
  readonly assessment: MonitoringAssessment;
  readonly notification: MonitorNotification | undefined;
  /** True when this call was the one that persisted (false = idempotent dedup/no-op). */
  readonly executed: boolean;
}

/**
 * Run ONE monitoring check for ONE monitor. Idempotent by checkId: a repeated/concurrent/
 * retried invocation inside the same evaluation window persists nothing new.
 *
 * Pipeline: due/paused gate → checkId dedup → ENGINE research (Flow 7 falsification on the
 * monitored thesis) → deterministic materiality over the new evidence → assessment →
 * notification only for MATERIAL_CHANGE → monitor check-state patch.
 */
async function runMonitorCheckInner(
  app: ResearchApp,
  monitorRef: string,
  origin: ProvenanceOrigin,
  options: { readonly now?: Date; readonly force?: boolean } = {},
): Promise<MonitorCheckResult> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const workspace = app.getWorkspace();
  const monitor = workspace.getMonitor(monitorRef);
  if (monitor === undefined) throw new Error(`Unknown monitor: ${monitorRef}`);

  // §3/§21: a PAUSED monitor never executes; PROPOSED monitors are inert until activation.
  if (monitor.status === "PAUSED") {
    return pausedResult(monitorRef, origin, now, "monitor is paused; no check executed");
  }
  if (monitor.status !== "ACTIVE" && options.force !== true) {
    return pausedResult(monitorRef, origin, now, `monitor is ${monitor.status}; only ACTIVE monitors execute checks`);
  }

  const cadence = (monitor.cadence ?? "MANUAL") as MonitorCadence;
  // §8: scheduled path honors cadence (manual force bypasses the due gate; same pipeline).
  const lastChecked = monitor.lastCheckedAt;
  if (options.force !== true && !checkDue({ cadence, ...(lastChecked !== undefined ? { lastCheckedAt: lastChecked } : {}) }, now)) {
    return pausedResult(monitorRef, origin, now, `cadence ${cadence}: check not due yet`);
  }

  // §10 idempotency: deterministic identity for this evaluation window.
  const identity = checkIdentity(monitorRef, cadence, now, monitor.triggerVersion ?? 1);
  const existing = workspace.findMonitoringAssessmentByCheckId(identity.checkId);
  if (existing !== undefined) {
    const notification = workspace.findNotificationByCheckId(identity.checkId);
    return { monitorRef, assessment: existing, notification, executed: false };
  }
  // §10 concurrency: same logical check already executing → await it, return its result.
  const running = inFlightChecks.get(identity.checkId);
  if (running !== undefined) {
    const result = await running;
    return { monitorRef, assessment: result.assessment, notification: result.notification, executed: false };
  }

  // Thesis resolution: a monitor without a thesis cannot produce thesis-aware materiality.
  const thesisRef = monitor.thesisRef;
  const thesis = thesisRef !== undefined ? workspace.getThesis(thesisRef) : undefined;
  if (thesis === undefined) {
    return failResult(workspace, monitorRef, origin, now, identity.checkId, "INSUFFICIENT_EVIDENCE", "the monitored thesis no longer exists in this workspace; nothing was asserted");
  }

  // §6: capture the PREVIOUS state of watched conditions BEFORE the research runs — the
  // materiality layer compares this baseline against the post-research state. Conditions are
  // matched by TEXT (the challenge record identity may legitimately change when the check's
  // research finds a contradiction; the watched CONDITION is what the monitor guards).
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const priorStatuses = new Map<string, string | undefined>();
  for (const cond of monitor.conditions) {
    const key = norm(cond.description);
    const linked = (monitor.linkedChallengeRefs ?? [])
      .map((ref) => workspace.getChallenge(ref))
      .find((c) => c !== undefined && norm(c.falsifier.condition) === key);
    priorStatuses.set(key, linked?.status);
  }

  // §7: the RESEARCH ENGINE owns research execution (Flow 7 falsification, same pipeline as
  // Challenge). One run per check; the engine's own budget laws apply inside ours.
  // D9 distinction: the ATTEMPT is stamped BEFORE research runs, so a check that dies
  // mid-flight still visibly attempted (lastCheckedAt remains the last COMPLETION).
  workspace.recordMonitorCheck(monitorRef, { lastAttemptedCheckAt: now.toISOString() }, origin, `check ${identity.checkId}: attempt`, now);
  const objective = `Monitoring check for thesis (${monitor.target}): what could prove this wrong, and has anything material changed?`;
  const deadline = startedAt + MONITOR_CHECK_BUDGET_MS;
  let flow7: Awaited<ReturnType<ResearchApp["runEngineFlow7"]>>;
  try {
    flow7 = await app.runEngineFlow7(objective, thesisRef as string, deadline);
  } catch (error) {
    // §18: an engine-level failure keeps its type — PROVIDER_UNAVAILABLE, never negative
    // evidence (the ModelFailure propagating from the flow runner carries the typed cause).
    const message = error instanceof Error ? error.message : String(error);
    return failResult(workspace, monitorRef, origin, now, identity.checkId, "PROVIDER_UNAVAILABLE", message);
  }

  if (flow7.modelFailure !== undefined || flow7.assessment === undefined) {
    // §18: provider failure keeps its type — PROVIDER_UNAVAILABLE, never negative evidence.
    return failResult(workspace, monitorRef, origin, now, identity.checkId, "PROVIDER_UNAVAILABLE", flow7.modelFailure?.message ?? "falsification research did not produce an assessment");
  }

  // §6 MATERIALITY: deterministic evaluation of what the research actually changed, judged
  // against the conditions the monitor watches. Not every difference is material; NO DATA
  // is never NEGATIVE.
  const materialChanges = materialityLayer(workspace, flow7, monitor.conditions, priorStatuses, norm);

  const outcome: MonitoringOutcome = materialChanges.length > 0 ? "MATERIAL_CHANGE" : "NO_MATERIAL_CHANGE";
  // §12: an implication for the user to decide on — never an automatic thesis mutation. Only
  // a MATERIAL, CURRENT, INVALIDATION-kind change may suggest the strongest wording.
  const thesisImpact = materialChanges.some((c) => c.materiality === "MATERIAL" && c.freshness === "CURRENT" && c.kind === "INVALIDATION")
    ? "POTENTIALLY_INVALIDATES_ASSUMPTION"
    : materialChanges.length > 0 ? "WEAKENS_THESIS" : "NO_IMPACT";

  const assessment = createMonitoringAssessment({
    monitorRef,
    ...(thesisRef !== undefined ? { thesisRef, thesisVersion: thesis.version } : {}),
    checkId: identity.checkId,
    checkedAt: now.toISOString(),
    outcome,
    changedConditions: materialChanges,
    thesisImpact,
    summary: buildSummary(outcome, thesisImpact, materialChanges, flow7.assessment.currentAssessment),
    confidence: flow7.assessment.confidence,
    uncertainty: [...flow7.assessment.earlyWarnings],
    ...(flow7.outcome.researchId !== "n/a" ? { researchRef: flow7.outcome.researchId } : {}),
  }, origin, now);
  workspace.recordMonitoringAssessment(assessment);

  // §13: notification ONLY for material change (never provider failures/noise/missing data).
  let notification: MonitorNotification | undefined;
  if (outcome === "MATERIAL_CHANGE") {
    const dupe = workspace.findNotificationByCheckId(identity.checkId);
    notification = dupe ?? workspace.recordNotification(createNotification({
      monitorRef,
      assessmentRef: assessment.id,
      checkId: identity.checkId,
      title: `Material change: ${monitor.target}`,
      summary: assessment.summary,
      materiality: materialChanges.reduce((m, c) => (c.materiality === "MATERIAL" ? "MATERIAL" : m), "MEANINGFUL" as ConditionChange["materiality"]),
      thesisImpact,
      ...(assessment.researchRef !== undefined ? { researchRef: assessment.researchRef } : {}),
    }, origin, now));
  }

  // Monitor check state (execution fields only; conditions/thesis untouched).
  app.getWorkspace().recordMonitorCheck(monitorRef, {
    lastCheckedAt: now.toISOString(),
    ...(outcome === "MATERIAL_CHANGE" ? { lastTriggeredAt: now.toISOString() } : {}),
    lastAssessmentRef: assessment.id,
  }, origin, `check ${identity.checkId}: ${outcome}`, now);

  await app.persistAfterMonitorCheck();
  return { monitorRef, assessment, notification, executed: true };
}

/**
 * Public entry with the §10 in-flight guard: callers invoking the same logical check while it
 * is still executing receive the winning invocation's result as a dedup no-op.
 */
export async function runMonitorCheck(
  app: ResearchApp,
  monitorRef: string,
  origin: ProvenanceOrigin,
  options: { readonly now?: Date; readonly force?: boolean } = {},
): Promise<MonitorCheckResult> {
  const now = options.now ?? new Date();
  const workspace = app.getWorkspace();
  const monitor = workspace.getMonitor(monitorRef);
  if (monitor === undefined) throw new Error("Unknown monitor: " + monitorRef);

  // §3/§21: a PAUSED monitor never executes; PROPOSED monitors are inert until activation.
  if (monitor.status === "PAUSED") {
    return pausedResult(monitorRef, origin, now, "monitor is paused; no check executed");
  }
  if (monitor.status !== "ACTIVE" && options.force !== true) {
    return pausedResult(monitorRef, origin, now, "monitor is " + monitor.status + "; only ACTIVE monitors execute checks");
  }

  const cadence = (monitor.cadence ?? "MANUAL") as MonitorCadence;
  const lastChecked = monitor.lastCheckedAt;
  if (options.force !== true && !checkDue({ cadence, ...(lastChecked !== undefined ? { lastCheckedAt: lastChecked } : {}) }, now)) {
    return pausedResult(monitorRef, origin, now, "cadence " + cadence + ": check not due yet");
  }

  const identity = checkIdentity(monitorRef, cadence, now, monitor.triggerVersion ?? 1);
  const existing = workspace.findMonitoringAssessmentByCheckId(identity.checkId);
  if (existing !== undefined) {
    const notification = workspace.findNotificationByCheckId(identity.checkId);
    return { monitorRef, assessment: existing, notification, executed: false };
  }
  const running = inFlightChecks.get(identity.checkId);
  if (running !== undefined) {
    const result = await running;
    return { monitorRef, assessment: result.assessment, notification: result.notification, executed: false };
  }
  const exec = runMonitorCheckInner(app, monitorRef, origin, options);
  inFlightChecks.set(identity.checkId, exec);
  try {
    return await exec;
  } finally {
    inFlightChecks.delete(identity.checkId);
  }
}

/** §6 materiality layer: only meaningful, fresh, evidence-backed changes become records. */
function materialityLayer(
  workspace: Workspace,
  flow7: Awaited<ReturnType<ResearchApp["runEngineFlow7"]>>,
  watchedConditions: readonly { readonly description: string }[],
  priorStatuses: Map<string, string | undefined>,
  norm: (s: string) => string,
): (ConditionChange & { readonly kind: "INVALIDATION" | "EARLY_WARNING" })[] {
  const changes: (ConditionChange & { readonly kind: "INVALIDATION" | "EARLY_WARNING" })[] = [];
  const assessment = flow7.assessment;
  if (assessment === undefined) return changes;

  // The check's falsification research graded its own contradictions (M4 §21 ladder, validated
  // output). A watched CONDITION the assessment NOW reports as a meaningful+ contradiction is
  // the material signal (§5→§6): prior state comes from the challenge baseline captured before
  // the research ran. Evidence gate (§6 #5/#6): the contradiction must cite graph evidence —
  // a model-asserted contradiction with NO evidence objects is NOT material (Phase G law: a
  // challenge never becomes true merely because the model proposed it); it surfaces in the
  // assessment's uncertainty instead. Stale-only evidence is not a current change (§18).
  for (const cond of watchedConditions) {
    const key = norm(cond.description);
    const priorStatus = priorStatuses.get(key);
    const contradiction = assessment.contradictionsFound.find(
      (c) => norm(c.description) === key || norm(c.description).includes(key),
    );
    if (contradiction === undefined || contradiction.materiality === "MINOR") continue;
    const evidenceRefs = contradiction.objectRefs
      .map((id) => workspace.getEvidence(id))
      .filter((e) => e !== undefined && e.freshness === "CURRENT")
      .map((e) => e!.id);
    if (evidenceRefs.length === 0) continue; // unsupported assertion → not a material change
    const invalidating = contradiction.materiality === "INVALIDATING" || contradiction.materiality === "MATERIAL_CONTRADICTION";
    changes.push({
      condition: contradiction.description,
      previousState: priorStatus ?? "ACTIVE",
      currentState: "CONTRADICTION",
      evidenceRefs,
      materiality: invalidating ? "MATERIAL" : "MEANINGFUL",
      materialityRationale: contradiction.rationale,
      freshness: "CURRENT",
      kind: invalidating ? "INVALIDATION" : "EARLY_WARNING",
    });
  }
  return changes;
}

function buildSummary(outcome: MonitoringOutcome, impact: string, changes: readonly ConditionChange[], assessment: string): string {
  if (outcome !== "MATERIAL_CHANGE") return `No material change; falsification assessment: ${assessment}.`;
  const heads = changes.slice(0, 2).map((c) => c.condition).join("; ");
  return `Material change observed (${heads}). Thesis impact: ${impact}. Falsification assessment: ${assessment}. The thesis itself is unchanged; your decision.`;
}

/** A non-executing result (paused/not due): honest, persisted NOTHING. */
function pausedResult(monitorRef: string, origin: ProvenanceOrigin, now: Date, reason: string): MonitorCheckResult {
  const assessment = createMonitoringAssessment({
    monitorRef, checkId: `paused:${monitorRef}:${now.toISOString()}`, checkedAt: now.toISOString(),
    outcome: "MONITOR_PAUSED" as MonitoringOutcome, changedConditions: [], thesisImpact: "NO_IMPACT",
    summary: reason, confidence: "HIGH", uncertainty: [],
  }, origin, now);
  return { monitorRef, assessment, notification: undefined, executed: false };
}

function failResult(
  workspace: Workspace, monitorRef: string, origin: ProvenanceOrigin,
  now: Date, checkId: string, outcome: MonitoringOutcome, message: string,
): MonitorCheckResult {
  const assessment = createMonitoringAssessment({
    monitorRef, checkId, checkedAt: now.toISOString(),
    outcome, changedConditions: [], thesisImpact: "UNDETERMINED",
    summary: message, confidence: "LOW", uncertainty: [message],
  }, origin, now);
  workspace.recordMonitoringAssessment(assessment);
  workspace.recordMonitorCheck(monitorRef, { lastCheckedAt: now.toISOString(), lastAssessmentRef: assessment.id }, origin, `check ${checkId}: ${outcome}`, now);
  return { monitorRef, assessment, notification: undefined, executed: true };
}

/** Cron batch: bounded, per-monitor failure isolation (§9), idempotent (§10). */
export async function runDueMonitorChecks(app: ResearchApp, origin: ProvenanceOrigin, now = new Date()): Promise<{ checked: MonitorCheckResult[]; budgetExhausted: boolean }> {
  const workspace = app.getWorkspace();
  const due = workspace.listMonitors()
    .filter((m) => {
      if (m.status !== "ACTIVE") return false;
      const lastChecked = m.lastCheckedAt;
      return checkDue({ cadence: (m.cadence ?? "MANUAL") as MonitorCadence, ...(lastChecked !== undefined ? { lastCheckedAt: lastChecked } : {}) }, now);
    })
    .slice(0, MAX_CHECKS_PER_CRON);
  const checked: MonitorCheckResult[] = [];
  let budgetExhausted = false;
  for (const monitor of due) {
    if (Date.now() - now.getTime() > MONITOR_CHECK_BUDGET_MS) { budgetExhausted = true; break; }
    try {
      checked.push(await runMonitorCheck(app, monitor.id, origin, { now }));
    } catch {
      // One failed monitor never aborts the batch (§9); the failure is recorded as its own
      // honest assessment on the retry path (idempotent checkId).
      try {
        const identity = checkIdentity(monitor.id, (monitor.cadence ?? "MANUAL") as MonitorCadence, now, monitor.triggerVersion ?? 1);
        workspace.recordMonitoringAssessment(createMonitoringAssessment({
          monitorRef: monitor.id, checkId: identity.checkId, checkedAt: now.toISOString(),
          outcome: "PROVIDER_UNAVAILABLE" as MonitoringOutcome, changedConditions: [], thesisImpact: "UNDETERMINED",
          summary: "monitor check failed; nothing asserted", confidence: "LOW",
          uncertainty: ["check execution failed; will retry next window"],
        }, origin, now));
      } catch { void 0; }
    }
  }
  return { checked, budgetExhausted };
}
