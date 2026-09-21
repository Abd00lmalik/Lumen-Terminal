# Recovery Architecture

> Provider failure is never evidence. A failed macro provider never means macro conditions are
> absent. "Insufficient" must mean the relevant registered evidence paths were exhausted — never
> that the first plan came up short.

## The recovery ladder

For every blocking (unresolved CRITICAL, or un-attempted CHALLENGE) requirement:

1. **Primary** — the capabilities the plan scheduled for it.
2. **Capability floor** — engine-required capabilities the plan omitted (round 1).
3. **Requirement-aware recovery rounds** — `recoveryCapabilities` maps each blocking requirement to
   capabilities from its declared domains/data types/freshness, excluding anything already tried.
   A blocking CHALLENGE maps to disconfirmation capabilities only. Bounded by `maxRecoveryRounds`
   (default 2) and the round budget.
4. **Requirement-scoped deep research** — when the loop still ends insufficient, the last-resort
   tier (`CROSS_DOMAIN_SYNTHESIS` research agents, then `WEB_SEARCH`) fires ONCE with the exact
   question plus the **retrieval brief**: the unresolved requirements, their windows, roles and
   evidence classes. Found evidence upgrades the conclusion; a still-empty tier falls through.
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
