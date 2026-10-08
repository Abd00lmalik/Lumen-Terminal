# Research State Contract: lifecycle, selection, lineage, and honest completion

> A research investigation is a durable object: its own id, question, conversation/context,
> evidence, requirements, findings, thesis/challenge relationships, status, timestamps and
> follow-up chain. The frontend derives its display from these canonical backend states and
> never re-derives a lifecycle from list position or recency.
>
> `RESEARCH CAN INFORM A DECISION. RESEARCH DOES NOT BECOME THE DECISION.`

This document records the seam where state is decided, the invariants added, and the
regression coverage that pins them. Nothing here names an asset, a phrase or a provider.

## 1. The five state vocabularies (never derived from one another)

| Category | Vocabulary | Owner | Written by |
|---|---|---|---|
| Research lifecycle | `ACTIVE` `COMPLETED` `FAILED` `PAUSED` `STOPPED` … (`ObjectStatus`) | `domain/lifecycle.ts` (research state machine) | the runner that owns the run |
| UI selection | `isCurrent` (selection pointer), displayed separately from status | `domain/workspace.ts` (`getContinuitySnapshot`) | explicit trader navigation |
| Research relationship | `parentResearchId` `followUpDepth` (ROOT `undefined`) | `domain/objects.ts` (Research) | the submission layer |
| Evidence state | `AVAILABLE` `INSUFFICIENT` `STALE` `CONFLICTING` (per requirement: status, staleOnlyRefs, duplicate refs) | `research/requirements.ts` (coverage laws) | coverage assessment |
| Requirement state | `PENDING` `PARTIALLY_SATISFIED` `SATISFIED` `EXHAUSTED` `UNAVAILABLE` | `research/requirements.ts` | coverage assessment |

**Law (STATE-DERIVATION):** no category is computed from another. A research object's
`status` is set only by the lifecycle transitions its own execution performed
(`ACTIVE` on dispatch, `COMPLETED` when the loop concluded, `FAILED` when the run could
not produce a valid result). History ordering, list position, recency, `isCurrent`
selection and degradation tier NEVER mutate or substitute for lifecycle status.
Opening an older record is a read-path selection and writes nothing.

## 2. Honest completion (coverage-derived final status)

**Law (FINAL-STATUS-FROM-COVERAGE):** the run's terminal `stoppedBecause` is derived by the
contract boundary from the ledger (`blockingRequirements`) and the question-resolution
verdict — a run that stopped on the time budget with unresolved CRITICAL requirements is
`REQUIREMENT_GAPS_UNRESOLVED`, never `EVIDENCE_SUFFICIENT`. The API maps that state to the
response `outcome`:

- `COMPLETED` only when the run's own engine state says the material requirements were
  established (`EVIDENCE_SUFFICIENT` or an honest `COMPLETE` with no blocking rows);
- `INSUFFICIENT` when mandatory requirements remain unresolved (including
  `TIME_BUDGET_EXHAUSTED` and `REQUIREMENT_GAPS_UNRESOLVED` states) — the research still
  persisted, the answer prose is still real collected evidence, and the UI presents
  "question remains unresolved" rather than a verdict;
- `MODEL_FAILURE` / `REJECTED` unchanged.

The judgment backstop is disabled for `INSUFFICIENT` outcomes (a budget stop must not mint
a confidence-bearing judgment that reads as a conclusion), and the run record persists for
every terminal outcome so reopening shows the same state.

## 3. Follow-up lineage (parent/child)

- `Research.parentResearchId` — the run this turn continues (`ROOT` when absent).
- `Research.followUpDepth` — 0 for roots; parent.depth + 1 for follow-ups.
- Stamped through the run context (`beginRun`), so every internal Research object of one
  submission carries the same lineage.
- The follow-up inherits: the parent's verbatim question, prior findings, requirement
  ledger state, evidence refs (as labelled CONTEXT, never owned) and provenance — via the
  investigation context plus the run-context stamp.
- History exposes `parentResearchId` so the UI can nest follow-ups under their parent
  instead of listing them as unrelated top-level investigations.

## 4. Requirement extraction (preserve the trader's constraints)

`completeRequirements` and `decomposeFieldRequirements` keep the requirement's semantic
content. The atomic-row writer rewrites the enumeration IT removed into the row's own label
("the observed high") instead of splicing empty slots into the original sentence, and every
row carries `originalWording` (the verbatim text the requirement was extracted from) so
diagnostics can always show what the trader actually asked. Structured fields: id,
original wording, normalized description, role/type, required evidence classes/facets,
status, evidence refs.

## 5. Temporal integrity

Existing laws are kept and tightened: a CURRENT/RECENT requirement whose description names
an explicit recency window ("today", "this week") is not satisfied by EVENT-dated evidence
older than that window regardless of evidence class — the window limit that previously
applied only to NEWS now applies to any event-dated observation, while state-bearing
market data keeps its own data-freshness window. Stale evidence yields STALE_ONLY
(`PARTIALLY_SATISFIED`), never satisfaction. A HISTORICAL requirement is never satisfied
by a fresh observation (mirror law retained).

## 6. Provenance

Every response continues to bind evidence and judgments to the owning run
(`researchRef` on Evidence, run-ownership assembly fault checks) and citations are
re-derived and clipped to the run's own evidence. Follow-ups cite only their own
retrieved evidence; the parent's material arrives as labelled context with its own refs.

## 7. Regression coverage

`tests/api/state-contract.test.ts` pins: lifecycle vs selection separation, ordering
neither changing nor being derived from status, follow-up lineage + inherited context +
nested history, compound requirement preservation, coverage-derived outcome honesty,
temporal gates, and provenance continuity across reopen. Frontend pure-function tests pin
status-verbatim rendering, follow-up nesting, and degraded/insufficient presentation.
