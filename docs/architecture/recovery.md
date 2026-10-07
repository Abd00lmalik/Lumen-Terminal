# Recovery Architecture

> Provider failure is never evidence. A failed macro provider never means macro conditions are
> absent. "Insufficient" must mean the relevant registered evidence paths were exhausted — never
> that the first plan came up short.

## The recovery ladder

For every blocking (unresolved CRITICAL, or un-attempted CHALLENGE) requirement:

1. **Primary** — the capabilities the plan scheduled for it.
2. **Capability floor** — engine-required capabilities the plan omitted (round 1).
3. **Requirement-aware recovery rounds** — `recoveryCapabilities` maps each blocking requirement to
   capabilities from its declared domains/data types/freshness, excluding anything already tried,
   and the round objective carries the **retrieval brief** (unresolved requirements, windows, roles,
   evidence classes). A blocking CHALLENGE maps to disconfirmation capabilities only; when no
   domain-mapped path remains, the map falls back to `WEB_SEARCH` — the retrieval-shaped last resort
   since the paid agent tier was removed (2026-10-05). Bounded by `maxRecoveryRounds`
   (default 2) and the round budget.
4. **Requirement-scoped deep research (self-gated)** — the adaptive loop and the flow runner keep an
   engine-owned tier that fires ONCE with the exact question plus the retrieval brief. It is gated on
   a registered `CROSS_DOMAIN_SYNTHESIS` provider; since `CROSS_DOMAIN_SYNTHESIS` has no provider
   (its only sources purchased generated answers and were removed 2026-10-05), the tier is skipped
   by design — a run never buys an answer instead of gathering evidence. Step 3 carries the
   requirement-scoped retrieval that used to live here. Found evidence upgrades the conclusion;
   an empty result falls through.
5. **Honest terminal state** — `EXHAUSTED` with `missingReason` naming the requirement and the
   attempted paths. Never fabricated values; a retrieval failure is a technical condition, never
   negative evidence.

## Laws enforced along the way

- **Model insufficiency is not terminal**: a model `INSUFFICIENT_EVIDENCE` decision triggers the
  same engine recovery first; only a genuinely exhausted ledger ends the run as insufficient.
- **Hollow completion is a dead end**: a COMPLETE with zero run evidence admitted to synthesis (all
  rejected by the subject/requirement gates) forces recovery instead of an answer.
- **Challenge attempt semantics**: `markChallengeAttempted` records that a disconfirmation-capable
  capability ran; `markUnattemptableChallenges` records an `UNAVAILABLE` challenge with the blocker
  when the deployment has no such route. "No counterevidence found" may only be said after an
  attempt (enforced again at synthesis by `contract-checks.ts`).
- **Provenance survives every hop**: fallback and deep-research evidence enters the same
  normalization/evidence laws, labeled by class (agent analysis is never direct observation), with
  upstream sources preserved and syndicated duplicates de-duplicated by the evidence layer.

## Confidence under recovery

Recovery outcomes feed the deterministic confidence policy (`src/research/confidence.ts`): failed
provider paths cap at MODERATE, an engine-stated gap caps at LOW, and the computed level is the
ceiling for any model-stated confidence.
