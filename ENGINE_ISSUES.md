# Engine issues

Observations about the research **engine** recorded during manual test 1 (2026-10-09).
These are logged here — not fixed in the UI/data-consistency pass — so the run-status,
outcome and evidence contracts stay untouched (record-first outcome; genuine failures are
never relabelled; no research-requirement changes).

Baseline: commit `54f538b` and the fixes on top of it.
Evidence source: production workspace blob (`workspaces/JUatJRoa4NhY0XdRaP1L5RCz3Bq1/snapshot.json`),
traced read-only.

---

## E1 — one submission shares ONE 210s deadline across its sequential members

**Symptom (as seen):** a run's diagnostics read `completionGate: TIME_BUDGET_EXHAUSTED`
with **0 evidence** and every requirement `PENDING`, while an earlier member of the same
submission had already reached `EVIDENCE_SUFFICIENT`. The opened record correctly says
`INSUFFICIENT` — the *state* is honest; the engine's accounting under it is hollow.

**Trace (production, one submission):**

| time (UTC) | event |
|---|---|
| 06:27:05 | submission begins; a single deadline of 210s is stamped for the whole request |
| +117s | flow member completes `EVIDENCE_SUFFICIENT` — consumes most of the shared budget |
| +94s | adaptive member completes — budget now effectively exhausted |
| 06:30:41 | a trailing answer-bearing member (`rs_000365`) is created |
| 06:30:41 | its budget check passes the deadline immediately: `capabilities: []`, all requirements `PENDING`, **0 evidence**, lifetime 2.1s |
| 06:30:43 | `failedRun` flips the run to FAILED for this member |
| after | diagnostics/evidence for the whole run are keyed to that empty member → `TIME_BUDGET_EXHAUSTED` hollow report |

Same pattern: `rs_000360` / `rs_000361` / `rs_000362` (investigation `inv_000029`), and
`rs_000357`.

**Root cause (code, as of `54f538b`):**

- `src/api/research-app.ts:373` — one deadline (`210_000` ms) is computed **once per
  submission**; sequential members draw from the same clock, so a slow early member can
  spend the budget before the answer-bearing member starts.
- `src/research/adaptive.ts:731` (and `:1118`) — the budget check for the trailing member
  fails instantly; the member is created with `capabilities: []` and never executes.
- `src/research/adaptive.ts:1296-1313` — `failedRun` marks FAILED on the empty member.
- `src/api/research-app.ts:464-469` — `rawAnswerRunId = result.research` keys the
  diagnostics and evidence readout to whichever member produced the final response — in
  this pattern, the **empty trailing member**, not the member that actually answered.
- Record-side (unchanged, and correct): `src/api/research-app.ts:751-757` forces the
  record to `INSUFFICIENT` when the run is FAILED with unresolved requirements. This pass
  deliberately did not touch it.

**Why it is logged, not fixed here:** the fix belongs to the engine's budget/answer
accounting, and the acceptance rules for this pass forbid touching statuses, evidence or
research requirements. Fix directions (for a dedicated engine change):

1. Give each member its own budget slice (or a per-member floor) instead of one shared
   deadline for the submission.
2. Only synthesize the trailing answer-bearing member while budget remains; otherwise
   let the earliest `EVIDENCE_SUFFICIENT` member's answer stand.
3. Key diagnostics/evidence to the **answer-bearing** member (`result.research` after the
   answer is produced), not to a member created after the deadline.
4. Surface, in the record, which member the diagnostics came from, so a hollow trailing
   member can never stand in for a completed one.

**Status/evidence semantics were not changed by this pass** — the row, the record and the
run view all report the engine's own words verbatim.
