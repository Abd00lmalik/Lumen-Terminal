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

---

## E1 (fix) — each member now gets its own slice of the shared deadline

Implemented fix direction **1** above, generically (no asset-, provider- or question-specific
branch), plus a second defect (E2) found while tracing the same execution path.

`src/research/adaptive.ts`

- `memberDeadline(deadlineMs, now, remainingMembers)` — slices the REMAINING wall clock across
the research members still to run, so a slow early member can no longer spend the budget the
trailing answer-bearing member needs. A lone member keeps the whole deadline.

`src/lui/lui.ts`

- `stepDeadlineFor` computes each research-bearing step's fair share (RESEARCH / ANALYZE /
CHALLENGE) and passes it to that step's dispatch, so a compound submission's members share the
one 210s deadline instead of racing for it. A submission with a single research step is
unchanged.

**Direction 2-4 of the E1 entry remain open** (they belong to the answer/diagnostics keying
work): only synthesize the trailing member while budget remains; key diagnostics/evidence to
the answer-bearing member; surface which member the diagnostics came from. This change makes the
trailing member budgeted rather than starved, which removes the specific `TIME_BUDGET_EXHAUSTED`
+ 0-evidence shape in the trace above, but it does not move the diagnostics keying.

---

## E2 — a capability wave waited unbounded on a single slow/hung capability

**Symptom:** a wave of independent capabilities was awaited with no per-call bound
(`Promise.all` in the adaptive loop; each flow-runner worker awaited `registry.execute`
directly). One slow or hung capability held its whole wave open — its independent siblings
delivered nothing until it returned (never, if it hung) — and a slow provider chain could push
a wave past the deadline and get the serverless function killed mid-flight, destroying the
partial state the budget exists to protect.

**Root cause (code):** the deadline was enforced BETWEEN tasks/rounds, never per call; the
engine relied on each adapter's own transport timeout, which a present or future adapter may
not honour, and which stacks across the registry's provider-fallback chain and retries.

**Fix (`src/research/adaptive.ts`, `src/research/flow-runner.ts`):**

- `CAPABILITY_SLICE_MS` (60s) + `capabilitySlice()` — the longest ONE capability call may hold
its wave open; sized to cover one provider chain including its bounded retries.
- `executeCapabilityBounded()` — races each call against its slice; on overrun it resolves with
an honest `TIMEOUT` `TOOL_RESULT` (EMPTY, no outputs — a failure is never negative evidence and
never fabricates output) while the independent siblings continue. The provider call is
abandoned, not force-aborted (adapters own their transports); the engine stops waiting.
- Both the adaptive loop and the flow runner dispatch every capability through it, so any
capability registered through the existing architecture inherits the bound.

Nothing here weakens an evidence-quality gate: coverage validation, the outcome contract
(`EVIDENCE_SUFFICIENT` / `MODEL_INSUFFICIENT_EVIDENCE` / `REQUIREMENT_GAPS_UNRESOLVED` /
`TIME_BUDGET_EXHAUSTED` / `MODEL_FAILURE`) and the FAILED lifecycle are unchanged.

---

## Verification (this pass)

- Backend `vitest run`: **118 files, 1411 passed, 29 skipped, 0 failed** (exit 0).
- Backend `tsc --noEmit` and `tsc --noEmit -p tsconfig.api.json`: clean (exit 0).
- Frontend `tsc --noEmit` clean; `vitest run` 126 passed; production `vite build` success.
- New suite `tests/research/capability-timeout.test.ts` (6 tests): the `capabilitySlice` /
`memberDeadline` primitives; a hung capability abandoned as `TIMEOUT`/EMPTY with no evidence
while its fast sibling's evidence survives, asserted for **crypto, equity and commodity**
capability pairs; the same law through the shared flow runner (Flow 6).

**Limitation:** no live smoke test was possible (no provider/model credentials in the build
environment); the behaviour is proven deterministically with controlled mocks, not against live
providers.
