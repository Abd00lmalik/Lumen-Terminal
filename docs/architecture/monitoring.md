# Monitoring Architecture (Phase H)

## Components

```
USER / CRON (0 3 * * *, api/cron.ts stage 3)
   │ authenticated (CRON_SECRET / Firebase session), workspace-scoped
   ▼
API routes (src/api/routes.ts)              LUI (src/lui/lui.ts)
  POST /api/monitors/from-challenge            proposal vs activation law
  POST /api/monitors/:ref/activate             (a question is never activation)
  POST /api/monitors/:ref/status
  POST /api/monitors/:ref/check  ──┐
  GET  /api/monitors/:ref/assessments
  GET  /api/notifications
  POST /api/notifications/:ref/read
                                   │
                                   ▼
        Orchestrator (src/ops/monitor-check.ts) — deterministic, no LLM authority
        1. lifecycle gates (PAUSED/PROPOSED execute nothing; §3)
        2. due gate by cadence (MANUAL never auto-fires; DAILY 24h; WEEKLY 7d; §8)
        3. checkId = sha256(monitorRef | windowStart | triggerVersion) (§10 idempotency)
        4. persisted-checkId dedup + in-flight registry (same-process concurrency)
        5. ENGINE research: Flow 7 falsification on the monitored thesis (§7 — the
           research engine owns execution; one run per check, hard wall-clock budget)
        6. MATERIALITY layer (deterministic; §6)
        7. MonitoringAssessment persisted; notification ONLY for MATERIAL_CHANGE (§13)
        8. monitor check-state patch (execution fields only; §12 thesis untouched)
                                   │
                                   ▼
        Domain (src/domain/monitoring.ts, monitor-derive.ts, memory.ts, workspace.ts)
        Monitor execution fields, MonitoringAssessment, MonitorNotification,
        deterministic check identity, cadence law, conditions derived from Challenge
```

## Materiality layer (§6 — deterministic, ordered)

For each watched condition, in order:

1. **Contradiction match** — the check's falsification assessment reports a contradiction for
   the condition text (matched by normalized text, not record ref: a finding contradiction
   legitimately mints a new challenge identity while the watched record goes STALE).
2. **Grade gate** — `MINOR` is never material. `MEANINGFUL_WARNING` → EARLY_WARNING /
   WEAKENS_THESIS. `MATERIAL_CONTRADICTION` or `INVALIDATING` → INVALIDATION /
   POTENTIALLY_INVALIDATES_ASSUMPTION (the strongest wording requires MATERIAL + CURRENT +
   INVALIDATION together).
3. **Evidence gate** — the contradiction must cite workspace evidence objects whose freshness
   is `CURRENT`. A model-asserted contradiction with no evidence objects is NOT material
   (Phase G law: a claim never becomes true merely because the model proposed it); stale-only
   citations are not a current change (§18).
4. **Prior state** — captured from the linked challenge baseline BEFORE research runs, so the
   assessment records a transition, not an absolute.

Non-material events (no notification, no thesis impact): ordinary fluctuation, duplicate
headlines, stale articles, weak single-source claims, provider errors, missing data, unrelated
market movement. `NO DATA` ≠ `NEGATIVE CHANGE`.

## Assessment model (§11)

`MonitoringAssessment` records: monitor, checkId (idempotency key), checkedAt, outcome
(`NO_MATERIAL_CHANGE | MATERIAL_CHANGE | INSUFFICIENT_EVIDENCE | PROVIDER_UNAVAILABLE |
MONITOR_PAUSED`), changedConditions (condition, previous/current state, evidenceRefs,
materiality + rationale, freshness, kind), thesisImpact, summary, confidence, uncertainty,
researchRef (the check's own History row). Assessments are never collapsed into a boolean
trigger, and provider failures never become negative evidence.

## Notifications (§13)

`MonitorNotification` exists only for `MATERIAL_CHANGE`, is deduped by checkId, carries
materiality, thesisImpact, a link to the assessment, and the researchRef it was generated from.
Workspace-scoped; provider failures, noise, missing data, and duplicate checks never notify.

## Idempotency & concurrency (§10)

- Deterministic check identity: `monitorRef + evaluationWindow + triggerVersion`.
- Same checkId twice (cron retry, manual re-run) → dedup no-op returning the original
  assessment; no duplicate assessment, no duplicate notification.
- Same-process concurrency: an in-flight registry makes the second invocation await the first
  and return its result as `executed:false`. Cross-instance races are closed by the persisted
  checkId gate at merge time (snapshots union assessments/notifications by id).

## Budgets (§23)

One research run per check; `MONITOR_CHECK_BUDGET_MS = 180s` hard wall-clock inside the 210s
research budget; `MAX_CHECKS_PER_CRON = 5` monitors per cron invocation (batched; the remainder
stay ACTIVE and due next window). If the budget is exhausted the check records an honest partial
state — never a fabricated conclusion.

## Cron integration (§9)

`api/cron.ts` stage 3 (after backup + watchdog): enumerate ACTIVE, due monitors across
workspaces; bounded batch; per-monitor failure isolation (one failed monitor never aborts the
rest); retries are safe by checkId; pause-during-execution is honored at the next gate read.
Scheduled checks and manual checks share the identical pipeline.

## History / Saved / Challenge relationships (§15–17)

- Every check's Flow 7 run is a normal research row in the SAME History store, linked from the
  assessment (`researchRef`). Nothing is hidden or duplicated.
- Saved remains explicit user intent; monitoring never auto-saves.
- Challenges stay the source of falsifiers: conditions derive from them at creation, and a
  challenge changing state later surfaces in assessments — the monitor does not silently
  rewrite its conditions or the thesis.

## Multi-user ownership (§19)

All routes resolve through the authenticated per-user workspace (the Phase F resolveUser seam).
Isolation is structural, not filter-based: another user's monitor by ref is a 404 (existence
hidden), and their assessments/notifications are unreachable. Verified deterministically
(tests/api/monitor.test.ts) and in production with two real browser users.
