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

## Requirement-scoped retrieval

Recovery rounds and deep-research workers receive a **retrieval brief** (`retrievalBrief`), not the
bare question: each unresolved requirement with its role, time window and evidence classes, and the
instruction not to answer the whole question or substitute unrelated material.

## Where the contract is visible

- Trader-facing answer: answer → confidence → key findings → support/opposition → what would change
  the view (no plumbing).
- `researchDiagnostics` (API): per-requirement status including role, engine-computed confidence and
  its basis, question type, requirement roles, capability floor, recovery rounds, completion gates.
