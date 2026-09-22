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
- if the dimension is already required ("inflation" was already a required dimension), the arrow is
  **attached to that row** (`transmissionTargets`) — one row per dimension, one arrow per named link.

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
