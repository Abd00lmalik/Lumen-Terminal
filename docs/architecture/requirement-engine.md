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
   resolved. Canonical instrument forms (`^TNX`, `CL=F`, `DX-Y.NYB`) match provider text.
2. **Currency-unit guard** — a foreign-crypto observation loses its fiat denomination tokens, so
   "quoted in USD" can never satisfy a dollar/macro requirement (VALID ≠ RELEVANT).
3. **Vocabulary overlap OR declared evidence class** (engine requirements, subject-scoped only).
4. **Freshness gate** — `freshnessSufficient`: a CURRENT requirement cannot be satisfied by an
   observation outside its window; explicit recency wording ("this week") tightens event-dated news.
   Freshness failure with everything else matching is `STALE_ONLY`.

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
