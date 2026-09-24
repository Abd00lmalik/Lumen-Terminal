# Research Contract

> The question determines the requirements. The requirements determine the capabilities. The
> capabilities determine the research. The research determines the synthesis. Not the other way
> around.

## What it is

Every research request is first turned into an engine-owned **research contract**: a requirement
ledger derived from the question's decision type and subject market class. The model may propose
requirements; the engine validates, normalizes, and COMPLETES the ledger — the model cannot omit a
decision dimension by forgetting to mention it.

Location: `src/research/requirements.ts` (`questionTypeOf`, `subjectMarketClassOf`,
`completeRequirements`, `blockingRequirements`, `markChallengeAttempted`),
`src/research/adaptive.ts` (`engineMarketClass`, `retrievalBrief`).

## Question semantics (generic, no question list)

- **Question type** — `COMPARISON | CAUSAL | EVENT | MACRO_REGIME | THESIS | FALSIFICATION |
  HISTORICAL | SYNTHESIS` — is read from the question's own wording (decision shapes: compare two
  periods, explain a move, anticipate an event, assess a regime, test a belief). Unseen questions of
  a known shape get the same contract.
- **Subject market class** — `COMMODITY | METAL | FX | INDEX | VOLATILITY | RATES | EQUITY |
  CRYPTO | UNKNOWN` — is read from the question's market vocabulary and the canonical instrument
  resolution. Unseen assets of a known class are handled identically.

## Engine-required dimensions

`ENGINE_REQUIRED` maps each question type to decision dimensions with a **role**, an importance, a
time sensitivity, an optional required **calculation** (`PERIOD_OVER_PERIOD`,
`EPISODE_SIMILARITY`), declared **evidence classes**, and optional **market applicability**:

- COMPARISON → previous-period performance + explicit period-over-period calculation (CORE),
  volume/range context (SUPPORTING).
- CAUSAL → supply-side and demand/inventory factors (CORE, commodity/metal subjects only), a
  rate/policy differential (SUPPORTING for FX/rates/index), plus an interpretive drivers dimension
  (SUPPORTING — the substantive dimensions carry completion, not the wrapper).
- EVENT → event timing, consensus expectations, recent fundamentals (CORE).
- MACRO_REGIME → rates/yields, volatility regime (CORE), dollar/liquidity (SUPPORTING).
- THESIS → belief support (CORE) and belief challenge (CHALLENGE).
- FALSIFICATION → disconfirming evidence (CHALLENGE).
- HISTORICAL → comparable episodes + how they resolved, with `EPISODE_SIMILARITY` (CORE).

Every ledger gets a **CHALLENGE** requirement regardless of type: counterevidence is an engine
action, not a prompt convention. An omitted dimension is **added** (`engineRequired: true`), never
downgraded and never silently dropped.

## Roles and completion laws

| Role | Completion law |
|---|---|
| CORE | Must be satisfied, or explicitly exhausted/unavailable after bounded recovery, before completion. |
| SUPPORTING | Improves confidence; may remain unresolved (never blocks). |
| CHALLENGE | Blocks while un-attempted. A disconfirmation-capable capability (`DISCONFIRMATION_CAPABILITIES`) running satisfies the attempt law (`markChallengeAttempted`). If the deployment registers no such route, the requirement becomes `UNAVAILABLE` with the blocker recorded (`markUnattemptableChallenges`) — never "no counterevidence found". |
| CONTEXT | Background; never blocks and never masquerades as current evidence. |

Role also decides requirement **identity**: a CORE requirement worded "…supports the thesis that NVDA
is weakening" does not satisfy the CHALLENGE dimension just because it contains "weakening"
(`completeRequirements` matches on role AND vocabulary).

## Declared evidence classes

An analytically-worded engine requirement ("the drivers behind X") can never share vocabulary with
a headline. Engine-inferred requirements therefore declare acceptable evidence classes, and — for
subject-scoped evidence only — an item of a declared class can satisfy the requirement through the
class match in `matchRequirement`, after the subject, temporal and freshness gates. Model-authored
requirements keep the strict vocabulary rule.

## Transmission / causal links

When the question's own wording names a causal chain ("how did those drivers transmit through
inflation, Treasury yields and broader risk assets"), `transmissionTargetsOf` / `causalLinksOf`
fold the named markets onto the shared market vocabulary and every named target becomes a required
dimension:

- **every arrow is its own first-class requirement row**, always. There is no carrier/parent-node
  concept: a row owns either a NODE (evidence about a market) or an ARROW (evidence about the
  relationship between two markets), never both. Each arrow row carries its own requirement id,
  source fold (`relationshipSource`), destination fold (`targetTerms`), `relationshipType`
  (`TRANSMISSION`), role/importance, status, evidence refs, blocking state and diagnostics.
  The earlier design attached an arrow to whichever dimension row already owned the target, and the
  arrow then INHERITED that row's coverage: a live oil run reported OIL → INFLATION as
  `PARTIALLY_SUPPORTED` with 26 inflation-regime references and zero relationship evidence.

**Node evidence is not arrow evidence.** `deriveCausalLinkStatuses` reads the ledger and derives each
arrow's status (`SUPPORTED`, `PARTIALLY_SUPPORTED`, `STALE_ONLY`, `UNRESOLVED`, `NOT_RESEARCHED`), and
`weakestCausalLink` names the arrow that binds the judgment:

- `confidence.ts` caps confidence with the weakest link (`SUPPORTED → HIGH`, `PARTIALLY → MODERATE`,
  unresolved/stale/never-researched → `LOW`), so oil + yield + risk-asset evidence with no inflation
  evidence cannot read as high conviction;
- `contract-checks.ts` rejects **assertive** causal prose about an unresolved arrow
  (`CAUSAL_CLAIM_WITHOUT_LINK_EVIDENCE`); hedged or conditional language stays admissible;
- the synthesis context states the per-arrow status and the link law, so the model interprets the
  engine's epistemic state rather than guessing it;
- `researchDiagnostics.causalLinks` exposes the same state for external scoring.

The subject gate is widened **only** by the targets the question itself named (`admittedTargetsOf`,
applied per requirement inside `matchRequirement`): evidence about a named target is admitted, and
nothing else is. A question that names no transmission derives no links at all — inventing causality
is a failure too.

### The arrow admission law

An arrow row has its OWN admission law and never falls through to the dimension vocabulary or
class paths. It admits an observation only when ALL of these hold:

1. the item passes the subject, semantic-domain, temporal and freshness gates;
2. **the item concerns the link's target** (`concernsAdmittedTarget` over the arrow's
   `targetTerms`);
3. **the item carries relationship evidence** (`isRelationshipEvidence`): either it is produced by
   a capability that declares relationship data (provider lineage — cross-domain/pass-through
   analysis), or its own language states the relationship via the shared relationship vocabulary
   (`transmitted`, `passed through`, `fed into`, `weighed on`, `contributed to`, `because of`,
   `co-movement`, `mechanism`, …).

Nothing else matches. In particular, an observation about an ENDPOINT market — a price quote, a CPI
print, a dimension headline — returns `NO_MATCH` no matter how much vocabulary it shares, so
`oil prices rose` + `inflation was elevated` can never become `oil contributed to inflation`.
Successful relationship evidence yields `SATISFIES` (`STALE_ONLY` if it is outside the requirement's
time horizon), and the arrow row's declared evidence classes are RELATIONSHIP classes only, so the
engine's class path cannot admit an endpoint item either.

The arrow row is also researchable: its description declares the data type it needs
(`transmission evidence for how the move in X reached Y`), and the relationship-capable
capabilities (`WEB_SEARCH`, `CROSS_DOMAIN_SYNTHESIS`, `NEWS_ANALYSIS`, `MACRO_ANALYSIS`) declare
that data type — so capability ranking schedules a relationship route instead of an endpoint feed.
An arrow is therefore `PENDING` until researched, `EXHAUSTED` only after bounded research spent
those routes, and never resurrected later by endpoint coverage (`assessCoverage` treats
`EXHAUSTED`/`UNAVAILABLE` as terminal).

## Abstract targets: no instrument is not no subject

When the question names no concrete instrument ("What macro conditions favor risk assets right
now?"), the subject gate used to be skipped entirely — so abundant provider output defined the
research target, and 12 of 15 evidence items in a macro run were crypto.

The contract derives a **semantic domain** from the question's own wording instead
(`engineMarketClass`, `subjectMarketClassOf`), and `matchRequirement` carries a **semantic domain
gate**: when the question resolves to a non-crypto class, crypto-native observations (the shared
`CRYPTO_DOMAIN_TOKENS` vocabulary, or an `ONCHAIN`/`DEFI` evidence type) do not match. Evidence
volume never decides relevance, and there is no forbidden-provider list — the item's own vocabulary
decides, and the question's wording decides the domain.

The gate is exactly as wide as the question's wording. A requirement that itself names a crypto
party is exempt (`requirementDeclaresCryptoParty`: a declared link target, a crypto evidence class,
or a description folding to `CRYPTO`), so "How could a stronger dollar affect crypto and emerging
markets?" still admits the crypto evidence it asked about, and "What macro conditions favor
Bitcoin?" derives crypto-relevant requirements. A broad macro question derives none.

## The research budget

Research is bounded by an engine-owned budget, not by the platform's function timeout:

- the wall-clock deadline is checked **before every capability task** (in-round), not only between
  rounds — a multi-link question schedules one task per link, and without the in-round check the
  flagship oil question was killed at the serverless limit with everything it had gathered;
- recovery rounds additionally require headroom (`recoveryHasBudget`: minimum wall-clock and round
  headroom), so a doomed recovery is never started `RECOVERY_MIN_HEADROOM_MS` before the deadline;
- when the budget stops a run, the result is an **honest partial**: `TIME_BUDGET_EXHAUSTED` or
  `ROUND_BUDGET_EXHAUSTED`, never `EVIDENCE_SUFFICIENT`; evidence already collected, requirement
  coverage, link statuses, the weakest link, the confidence ceiling and provenance are all preserved;
- the partial rationale NAMES what the budget left behind ("…N material requirement(s) remain
  unresolved within that budget and are reported as such rather than filled in"), computed from the
  engine's own blocking set;
- a budget stop is distinguishable from a provider failure: no model failure is recorded and every
  provider call that ran may still have succeeded.

## The shared final contract boundary

The contract is a system-wide invariant, not an adaptive-loop-only one. Every research path that
produces a user-visible judgment passes through ONE boundary — `validateContractOutcome`
(`src/research/contract-boundary.ts`):

```
                      adaptive loop  ──┐
                                       ├──> validateContractOutcome ──> validated outcome
                      flow runner  ────┘       (one violation set, one confidence ceiling,
                                                one completion gate)
```

The adaptive loop calls it around its rendered answer; the flow runner calls it through
`validateFlowOutcome` on each flow's own user-visible response (Flows 2-8). There is one validator
(`contract-checks.ts`) and one completion law (`blockingRequirements`), so no path can be validated
by a second, weaker rule:

- unsupported causal prose is stripped from the response and reported (`contractViolations`);
- `EVIDENCE_SUFFICIENT` is demoted to `REQUIREMENT_GAPS_UNRESOLVED` whenever the engine's coverage
  verdict still reports a blocking requirement;
- confidence is pinned to the engine-computed ceiling (`computeConfidence` over the ledger, including
the weakest-link cap);
- violations that survive stripping become the engine's `contractGap` statement, which replaces a
  fully-rejected answer rather than letting the rejected prose stand.

Claim boundaries are sentences *and lines*, and stripping preserves the document's layout, so a
structured flow answer loses only the uncompensated claim — not every supported one around it.

## Requirement-scoped retrieval

Recovery rounds and deep-research workers receive a **retrieval brief** (`retrievalBrief`), not the
bare question: each unresolved requirement with its role, time window and evidence classes, and the
instruction not to answer the whole question or substitute unrelated material.

## Where the contract is visible

- Trader-facing answer: answer → confidence → key findings → support/opposition → what would change
  the view (no plumbing).
- `researchDiagnostics` (API): per-requirement status including role, engine-computed confidence and
  its basis, question type, requirement roles, capability floor, recovery rounds, completion gates,
  derived transmission links and the weakest link.
- Frontend ("What Lumen checked" panel): question type, coverage, engine-computed confidence, gate,
  requirements by role, the transmission links with the weakest arrow called out, and the collapsed
  research diagnostics (requirement ledger + confidence basis).
