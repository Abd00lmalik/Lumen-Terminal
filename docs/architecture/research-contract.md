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

- if the ledger does not yet ask about that dimension, it gets its own **TRANSMISSION** row
  (`targetTerms`);
- if a genuine **dimension row** already asks for it ("the current inflation regime"), the arrow is
  **attached to that row** (`transmissionTargets`) — one row per dimension, one arrow per named link.
- the **question-derived base row** (whose description IS the question, or a fragment of it) never
  carries an arrow: its description trivially mentions every target the question names without being
  ABOUT any one of them. `requirementCarriesTarget` refuses that carrier, so the arrow gets its own
  dedicated row. Without this, a task-derived row (the planner's objective = the question) claimed the
  arrow and node evidence satisfied it — crude-oil data marked the INFLATION arrow
  `PARTIALLY_SUPPORTED` with no inflation evidence at all.

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

The gate also enforces the arrow law at the row level: a **link row** (`targetTerms`) is *about its
target*, so it admits only evidence that itself concerns the link's target. Evidence about the
question's subject establishes a node of the chain, never the arrow into another market, so a yield
quote mentioning a class word can no longer satisfy the inflation arrow. Rows that merely carry an
attached arrow alongside their own dimension (`transmissionTargets`) keep their dimension's gate.

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
