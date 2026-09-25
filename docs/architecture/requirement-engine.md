# Requirement Engine & Capability Floor

> A provider returning data is NOT coverage. Coverage is the engine's assessment that a
> requirement was satisfied by relevant, fresh, on-subject evidence.

## Requirement object

`ResearchRequirement` (`src/research/requirements.ts`) carries: `id`, `role`
(CORE/SUPPORTING/CHALLENGE/CONTEXT), `description`, `importance` (CRITICAL/SUPPORTING),
`timeSensitivity`, `domains`, `status`, `evidenceRefs`, `staleOnlyRefs`, `missingReason`,
`recoveryAttempts`, `engineRequired`, `calculation`, `retrievalObjective`, `evidenceClasses`.

Statuses: `PENDING → SATISFIED | PARTIALLY_SATISFIED (stale-only) | EXHAUSTED | UNAVAILABLE`.

## Capability floor

`mandatoryCapabilities` runs **before round 1**: for every CRITICAL, discriminating, non-CHALLENGE
requirement, the capabilities whose declared support matches (`CAPABILITY_SUPPORT` — domains, data
types, freshness horizons) are scheduled even if the model's plan omitted them. Availability is a
filter: a capability with no registered provider, or a symbol-scoped capability for a question that
earned no subject (`SUBJECT_REQUIRED_CAPABILITIES`), is never scheduled. The model can add
capabilities; it cannot remove engine-required ones.

The **counterevidence floor** separately schedules `FALSIFICATION` once per run when a CRITICAL
requirement exists and it was not planned.

## Deterministic matching

`matchRequirement` (used identically by coverage assessment and the synthesis admission gate) checks:

1. **Subject gate** — the item concerns the question's subject (declared `about` or text) when one
   resolved. Canonical instrument forms (`^TNX`, `CL=F`, `DX-Y.NYB`) match provider text. The
   requirement's declared link targets are admitted alongside it (the question named them).
2. **Semantic subject gate** — when the question derives an abstract non-crypto domain, a
   crypto-native observation is not about the question (item vocabulary decides, never a provider
   list); a requirement that itself declares crypto classes is exempt.
3. **Currency-unit guard** — a foreign-crypto observation loses its fiat denomination tokens, so
   "quoted in USD" can never satisfy a dollar/macro requirement (VALID ≠ RELEVANT).
4. **Subject as content, never as filler** — the subject word may count as vocabulary only where
   naming the subject IS the criterion:
   - *model-declared* requirements keep it ("current oil price movement this week" — the pinned
     target relevance law);
   - *engine rows* keep it against non-quote evidence (an earnings-date observation is the event
     evidence a row asks for; a headline about the subject is content);
   - *engine rows served by quote evidence* lose it in both directions: a price/series payload
     repeats the subject while carrying only numbers, so subject overlap alone would let a snapshot
     satisfy "the drivers behind X" or "the supply factors affecting X". Those rows must match on
     their own declared evidence class or analytic vocabulary.
5. **Vocabulary overlap, domain agreement, or declared evidence class** — the item's domain label
   joins its vocabulary (it is a fact about the observation: this IS historical material), while
   domain agreement as a match PATH applies only when the requirement carries no distinguishing
   vocabulary; engine-class matching is subject-scoped, task-class matching is for task-derived
   rows.
6. **Freshness gate** — `freshnessSufficient`: a CURRENT requirement cannot be satisfied by an
   observation outside its window; explicit recency wording ("this week") tightens event-dated news;
   a HISTORICAL requirement needs historical-tagged or year-old material — but a HISTORICAL
   requirement is only enforced when the requirement's own text speaks of historical material
   (`buildRequirements`), so a planner's tag can never make "what happened yesterday" unsatisfiable
   by fresh observations of that window.
7. **Inflection folding** — `canonicalToken` folds plural/`-ed`/`-ing` forms back to their stem
   (with de-undoubling) so "dropped" meets a `DROP` requirement and a `drivers` row meets `driver`.

Freshness failure with everything else matching is `STALE_ONLY` — valid background, never current
satisfaction.

## Engine-owned completion

`coverageVerdict` / `blockingRequirements` decide completion. The model may not declare success:
a COMPLETE decision is only honoured when the ledger agrees, and blocking requirements trigger
bounded recovery rounds (see `docs/architecture/recovery.md`) before honest insufficiency.
`exhaustUnresolved` records exactly which requirement remains unresolved and why.

## Recovery mapping

`recoveryCapabilities` maps blocking requirements to capabilities from the same declarations. A
blocking CHALLENGE requirement is recovered with disconfirmation capabilities only. When no path
remains, the fallback tier is `WEB_SEARCH` → `CROSS_DOMAIN_SYNTHESIS` (deep research), and only
then `EXHAUSTED`.
