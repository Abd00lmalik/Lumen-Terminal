# Monitoring runbook (Phase H)

Operational guide for thesis-aware material change monitoring as implemented
(`src/ops/monitor-check.ts`, `src/domain/monitoring.ts`, `src/domain/monitor-derive.ts`,
`api/cron.ts`, `src/api/routes.ts`, `frontend/src/pages/MonitorPage.tsx`). It describes what
the code actually does, not an aspiration. Product behavior: `docs/product/monitor.md`;
architecture: `docs/architecture/monitoring.md`.

## 1. What monitoring is (and is not)

Monitor watches the conditions derived from a user's own Challenge records and runs REAL
falsification research (Flow 7) to detect material change. It is not a price-alert system, not
a scheduler of LLM calls, and never touches the thesis. The only output surfaces are:

- a `MonitoringAssessment` (always, every check),
- a `MonitorNotification` (only when the outcome is `MATERIAL_CHANGE`),
- a normal History research row (the check's own Flow 7 run).

## 2. Lifecycle and LUI

`PROPOSED → ACTIVE → PAUSED ⇄ ACTIVE → COMPLETED` (`transitionMonitor` enforces the table).
Lumen proposes; the user activates explicitly (`POST /api/monitors/:ref/activate`). Pausing is
explicit (`POST /api/monitors/:ref/status`). A PROPOSED or PAUSED monitor executes nothing.

LUI routing (§4 law): "monitor this thesis" / "what should I monitor" produce a PROPOSAL,
never activation. Pause/resume/check-now/reads route to the corresponding action.

## 3. API surface

| Route | Purpose |
|---|---|
| `POST /api/monitors/from-challenge` | Create a PROPOSED monitor derived from the thesis's challenge records (400 "no active challenges…" when none) |
| `POST /api/monitors/:ref/activate` | Explicit activation (the only path to ACTIVE) |
| `POST /api/monitors/:ref/status` | `PAUSED`/`ACTIVE`/`COMPLETED` transitions |
| `POST /api/monitors/:ref/check` | Manual check — same pipeline as the scheduled path |
| `GET /api/monitors/:ref/assessments` | Assessment history for one monitor |
| `GET /api/monitors` | Grouped list `{proposals, active, paused, stale, completed}` |
| `GET /api/notifications` | Workspace notifications (material change only) |
| `POST /api/notifications/:ref/read` | Mark a notification read |

All routes 401 unauthenticated and resolve through the per-user workspace (Phase F seam);
another user's monitor is a 404 (existence hidden), their notifications unreachable.

## 4. The check pipeline (what runs, in order)

`runMonitorCheck` (`src/ops/monitor-check.ts`), deterministic; the LLM owns nothing here:

1. **Lifecycle gate** — PAUSED/PROPOSED → honest `MONITOR_PAUSED` result, nothing persisted,
   no research, no model calls, no cost.
2. **Due gate** — cadence law (`checkDue`): `MANUAL` never auto-fires, `DAILY` = 24h,
   `WEEKLY` = 7d. Manual "Check now" bypasses the due gate with `force`, but the SAME pipeline
   runs; scheduled and manual are one pipeline.
3. **Check identity** — `checkId = sha256(monitorRef | windowStart | triggerVersion)` —
   deterministic per evaluation window (§10).
4. **Persisted dedup** — an assessment with the same checkId → dedup no-op
   (`executed:false`, same assessment id). No duplicate assessment/notification.
5. **In-flight registry** — same-process concurrency: the second invocation awaits the first
   and returns `executed:false` with the winner's assessment. Cross-instance races are closed
   by the persisted checkId gate plus union-by-id merges.
6. **Thesis resolution** — the monitored thesis must exist; otherwise honest
   `INSUFFICIENT_EVIDENCE`, nothing asserted.
7. **Prior state capture** — watched-condition statuses captured from the linked challenge
   baseline BEFORE research runs (a transition, not an absolute; this ordering was a live bug
   fix — captured after meant no transition was ever recordable).
8. **Engine research** — one Flow 7 falsification run on the monitored thesis through the
   engine (`app.runEngineFlow7`), bounded by `MONITOR_CHECK_BUDGET_MS = 180s` inside the 210s
   research budget. The check's run is a normal History row linked from the assessment
   (`researchRef`).
9. **Materiality layer** (deterministic, ordered per condition):
   - contradiction matched by **normalized condition TEXT** (a finding contradiction
     legitimately mints a new challenge identity; the watched record goes STALE — text is the
     stable identity);
   - grade gate: `MINOR` never material; `MEANINGFUL_WARNING` → EARLY_WARNING /
     WEAKENS_THESIS; `MATERIAL_CONTRADICTION`/`INVALIDATING` → INVALIDATION kind;
   - evidence gate: the contradiction must cite workspace evidence objects with freshness
     `CURRENT` — a model-asserted contradiction with no current evidence objects is NOT
     material (it surfaces in the assessment's uncertainty instead);
   - strongest wording (`POTENTIALLY_INVALIDATES_ASSUMPTION`) requires MATERIAL + CURRENT +
     INVALIDATION together.
10. **Assessment** persisted with outcome / changedConditions / thesisImpact / summary /
    confidence / uncertainty / researchRef.
11. **Notification** created ONLY for `MATERIAL_CHANGE` (deduped by checkId).
12. **Monitor patch** — execution fields only (`lastCheckedAt`, `lastTriggeredAt`,
    `lastAssessmentRef`); conditions and the thesis untouched.

## 5. Honest outcomes table

| Outcome | Meaning | Notification? | Provider failure becomes evidence? |
|---|---|---|---|
| `MATERIAL_CHANGE` | Meaningful+ contradiction backed by CURRENT evidence objects | Yes (deduped by checkId) | — |
| `NO_MATERIAL_CHANGE` | Research ran; nothing material (incl. "no credible contradiction found") | No | — |
| `INSUFFICIENT_EVIDENCE` | Missing data / thesis gone; research cannot honestly complete | No | — |
| `PROVIDER_UNAVAILABLE` | Model/engine failure — infrastructure, never thesis evidence | No | **No** |
| `MONITOR_PAUSED` | Gate result (paused/not due); nothing persisted | No | — |

`NO DATA` is never `NEGATIVE CHANGE`. A provider outage never reads as "thesis fine" or
"thesis broken" — it reads as UNDETERMINED with the typed cause.

## 6. Cron configuration

`vercel.json`: `/api/cron` at `0 3 * * *` (daily 03:00 UTC; the same invocation also runs
backup + watchdog stages first). Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}`
when the env var is set; anything else is 401. `api/cron.ts` stage 3 enumerates
`workspaces/*/snapshot.json`, builds a headless `ResearchApp` per workspace (production model
chain via `buildModelChain` — Groq fallback included, not a bare provider), and calls
`runDueMonitorChecks`.

Bounds (§23):

- `MAX_CHECKS_PER_CRON = 5` monitors per cron invocation; the remainder stay ACTIVE and due
  next window (batched, never queued beyond the budget).
- `MONITOR_CHECK_BUDGET_MS = 180_000` hard wall-clock per check; budget exhaustion records an
  honest partial state, never a fabricated conclusion.
- Per-monitor and per-workspace failure isolation: one failure never aborts the batch; the
  failed check gets an honest assessment on the retry path (idempotent checkId).

Operators: monitor volume is bounded by ACTIVE × DAILY/WEEKLY cadence. A user with 20 ACTIVE
DAILY monitors still costs ≤5 checks per cron day under the current bound — raise
`MAX_CHECKS_PER_CRON` deliberately (it multiplies provider spend linearly).

## 7. Reading the data

- **Assessments** (`GET /api/monitors/:ref/assessments`): every check, including non-material
  ones — outcome, changedConditions (condition/previous/current/evidenceRefs/materiality/
  freshness/kind), thesisImpact, summary, confidence, uncertainty, `researchRef` (the check's
  History row — open it like any research).
- **Notifications** (`GET /api/notifications`): material change only, deduped by checkId,
  carrying materiality, thesisImpact, assessment link, researchRef, read/unread state.
- **Monitor** (`GET /api/monitors`): grouped `{proposals, active, paused, stale, completed}`
  with execution fields (`lastCheckedAt`, `lastTriggeredAt`, `lastAssessmentRef`).

Note the summary law: assessments exist for EVERY check (including
`PROVIDER_UNAVAILABLE`/`INSUFFICIENT_EVIDENCE`) — absence of notifications is not absence of
activity; check assessments to see the honest record.

## 8. Debugging

**"Check now" returned 404 for an existing monitor.** Cross-user isolation: monitor refs are
workspace-scoped; a monitor from another workspace (or one created before auth was enforced on
your account) is a 404 by design — existence hidden, not a filter miss.

**Duplicate check executed anyway (`executed:true` twice).** Same-window duplicates must dedup
by checkId. If two DIFFERENT serverless instances raced and both persisted, the snapshot merge
unions assessments/notifications by id — report it; that would be a real defect (deterministic
identity should make cross-instance checkIds identical).

**A material change didn't notify.** Walk the materiality gates in order: (1) was a
contradiction found for the watched condition TEXT (normalized)? (2) grade above MINOR?
(3) did it cite evidence objects with freshness CURRENT? A model-asserted contradiction with no
current workspace evidence is deliberately NOT material — it lives in the assessment's
uncertainty. This is the Phase G law (a claim never becomes true merely because the model
proposed it).

**A stale article triggered materiality.** It shouldn't — the evidence gate requires CURRENT
freshness; stale-only citations are not a current change (§18). If it did, capture the
assessment's evidenceRefs and check the cited evidence's freshness on the graph.

**Cron didn't run / ran but checked nothing.** `GET /api/notifications` and
`GET /api/storage/backup-status` show the last cron effects (backups share the invocation).
Check: CRON_SECRET set (else the endpoint is open — set it), monitors ACTIVE (PROPOSED/PAUSED
never execute), cadence due (`MANUAL` monitors NEVER auto-fire — that is by design; manual
"Check now" is their only execution path), and the ≤5-per-invocation bound.

**Check persisted but History shows no run.** Only checks that actually ran research get a
`researchRef`. `PROVIDER_UNAVAILABLE`/`INSUFFICIENT_EVIDENCE`/paused results persist an
assessment WITHOUT a research row — that is honest (no research happened).

**In-flight vs persisted dedup confusion.** The in-flight registry is per-process (bounded
warm instances); the persisted checkId gate + union-by-id merge closes cross-instance races.
If you observe a true duplicate assessment id in one workspace's store, that is a defect —
the merge law forbids it.

**Known testing seams** (for reproducing locally): the fake provider scripts
`flow7.falsification`; the SAME map entry feeds the challenge run AND the check — swap the
script AFTER the challenge POST when the check needs different research. Pre-seeded evidence
only enters the check's research context via lexical relevance to the objective; the run's OWN
gathered evidence is what satisfies the evidence gate.

## 9. Verification status

- Backend: `tests/domain/monitoring.test.ts` (13), `tests/ops/monitor-check.test.ts` (7),
  `tests/ops/monitor-negative.test.ts` (5), `tests/api/monitor.test.ts` (6),
  `tests/benchmark/monitor-scenarios.test.ts` (15) — see
  `docs/benchmark/monitor-scenarios.md` for the scenario contract.
- Production (2026-09-29, real users, two accounts, CDP driver
  `scripts/cdp-phase-h-verify.mjs`): h1a 8/8 (create→activate→render), h1b 10/10 (manual check
  → NO_MATERIAL_CHANGE honestly, idempotent across cold invocations, thesis byte-identical,
  notifications 200), h2 6/6 (User B: zero monitors/notifications, 404 isolation on every
  route). Monitor `monitor_000004` on thesis `th_000012`.
- Cron: wiring code-verified + benchmark-tested; scheduled execution of monitors was not
  separately observed live (same pipeline as the production-verified manual path).
