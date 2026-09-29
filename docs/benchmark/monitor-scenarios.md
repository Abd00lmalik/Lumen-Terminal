# Monitor Scenarios Benchmark (Phase H)

`tests/benchmark/monitor-scenarios.test.ts` — 15 deterministic tests pinning MONITOR-001…014
plus the cron batch (§9/§23). Deterministic means: real domain + real API + real persistence
layer with an in-memory blob, real LUI pipeline with a scripted model. No network, no
credentials. The suite passes with no model key present.

> The benchmark scores the MONITORING LAW, not model fluency: what counts as material, what
> never notifies, what never executes, what never mutates. A honest
> `PROVIDER_UNAVAILABLE`/`INSUFFICIENT_EVIDENCE` outcome PASSES its scenario; a fabricated
> materiality would FAIL.

## The 14 scenarios

| # | Scenario | Expected behavior (pinned) |
|---|---|---|
| MONITOR-001 | Create monitor from thesis challenges | Conditions derived from the user's own challenge records (≥1), `linkedChallengeRefs` 1:1 with conditions; status **PROPOSED** (inert until explicit activation); appears under `proposals`, NOT `active`; challenge refs echoed |
| MONITOR-002 | Manual check, no material change | Outcome `NO_MATERIAL_CHANGE`; NO notification; assessment persisted |
| MONITOR-003 | Manual check, material change | Outcome `MATERIAL_CHANGE`; notification created; `researchRef` links the check's own research run; `changedConditions[].evidenceRefs` non-empty (evidence gate) |
| MONITOR-004 | Insufficient evidence | Research completes but asserts nothing → honest `NO_MATERIAL_CHANGE` with LOW confidence, run's `researchRef` linked; nothing fabricated |
| MONITOR-005 | Provider failure | Outcome `PROVIDER_UNAVAILABLE`; no notification; `changedConditions` empty — infrastructure failure NEVER becomes negative evidence |
| MONITOR-006 | Duplicate execution, same window | Idempotent by checkId: second call `executed:false`, SAME assessment id, exactly 1 assessment persisted |
| MONITOR-007 | Concurrent execution | One winner; both callers receive the identical assessment id; exactly 1 assessment persisted (in-flight registry) |
| MONITOR-008 | Paused monitor executes nothing | `MONITOR_PAUSED`; `executed:false`; ZERO model calls (no research, no cost) |
| MONITOR-009 | Thesis unchanged after material alert | Byte-identical thesis before/after a `MATERIAL_CHANGE`; version stays 1 — monitoring never mutates the thesis |
| MONITOR-010 | Cross-user isolation over HTTP | User B sees zero monitors/notifications; B's status/check/assessments on A's monitor are 404 (existence hidden, not filtered) |
| MONITOR-011 | History linkage | The check's `researchRef` resolves in the SAME History store with flow `WHAT_COULD_PROVE_ME_WRONG` — no second store, no duplication |
| MONITOR-012 | Notification dedup | Duplicate execution creates NO duplicate notification: exactly 1 notification after first+dedup |
| MONITOR-013 | Stale/meaningful-only signal | `MEANINGFUL_WARNING` → surfaced as EARLY_WARNING / `WEAKENS_THESIS`, notification materiality MEANINGFUL; the strongest wording (`POTENTIALLY_INVALIDATES_ASSUMPTION`) reserved for MATERIAL+CURRENT+INVALIDATION |
| MONITOR-014 | Explicit lifecycle only | Pause/resume via `POST /api/monitors/:ref/status` are explicit user actions recorded in provenance; conditions never silently rewritten |
| §9/§23 | Cron batch | Due-gated (MANUAL never auto-fires), bounded (`MAX_CHECKS_PER_CRON`), per-monitor failure isolation; only DUE monitors run |

## Negative laws under test (§22 negatives; `tests/ops/monitor-negative.test.ts`)

- Stale-article signal (§22.1/§22.2): stale-only evidence is not a current material change.
- No data (§22.4): missing data → `INSUFFICIENT_EVIDENCE`, never `NEGATIVE CHANGE`.
- Challenge not directly mutated by monitoring (§22.12).
- Monitoring never auto-saves (§22.13) — Saved remains explicit user intent.
- No buy/sell/trade language anywhere in monitoring output (§22.14/§22.15): the check pipeline
  is regex-scanned for `\b(buy|sell|short|long|enter|exit|stop[- ]?loss|take[- ]?profit)\b`.

## Materiality layer contract (what the scenarios jointly pin)

1. **Text match** — contradictions match watched conditions by normalized condition TEXT
   (check research legitimately mints a new challenge identity; the watched condition is what
   the monitor guards).
2. **Grade gate** — MINOR never material; MEANINGFUL_WARNING → EARLY_WARNING/WEAKENS_THESIS;
   MATERIAL_CONTRADICTION/INVALIDATING → MATERIAL + INVALIDATION kind.
3. **Evidence gate** — contradiction must cite workspace evidence objects with freshness
   CURRENT; model-asserted contradictions without current evidence are not material.
4. **Prior state** — captured from the challenge baseline BEFORE research runs, so the
   assessment records a transition.

## Scripting notes (determinism)

- `FakeModelProvider` map entries: `lui.normalized_request`, `lui.resolved_target`
  (flow=WHAT_COULD_PROVE_ME_WRONG), `lui.ambiguity`/`lui.consequence`, `safety.screen`,
  `lui.action_plan`, `research.plan`, `research.adaptive_decision`, `flow7.falsification`.
- `scriptChallenge` for API tests, `scriptFlow7` for orchestrator tests; the SAME map entry
  feeds the challenge run AND the check — swap `flow7.falsification` AFTER the challenge POST
  when the check needs different research.
- The evidence gate is satisfied by the check run's OWN gathered evidence
  (`ev_000002`); pre-seeded evidence (`ev_000001`) enters context only via lexical relevance
  to the objective.

## Running

```bash
npx vitest run tests/benchmark/monitor-scenarios.test.ts   # this benchmark (15)
npx vitest run tests/ops/ tests/domain/monitoring.test.ts tests/api/monitor.test.ts  # laws
```

## Status

15/15 green as of 2026-09-29. Backend totals at Phase H close: 1016 passed / 29 skipped
(was 970+29 pre-Phase-H); frontend 78 passed; typechecks clean; production build clean.
