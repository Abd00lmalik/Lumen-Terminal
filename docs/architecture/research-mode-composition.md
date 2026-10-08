# Composable Research Modes: the general-purpose investigation engine

> Lumen accepts an arbitrary trader research question, infers the investigation it requires,
> decomposes it into explicit requirements, composes the capabilities that satisfy them,
> retrieves evidence with correct temporal scope and epistemic class, evaluates coverage and
> conflicts, synthesizes a mode-appropriate answer, and keeps enough conversation state for a
> follow-up to continue the SAME investigation. The eight canonical flows are composable MODES
> the planner composes, never the ontology of what can be asked.
>
> `RESEARCH CAN INFORM A DECISION. RESEARCH DOES NOT BECOME THE DECISION.`

This document records the seam where that pipeline is decided, the abstractions that already
exist, and the invariants added to make mode composition actually hold end to end. Nothing here
names an asset, a phrase or a provider.

## 1. Where the five concerns meet

| Concern | Owner (module) | What it decides |
|---|---|---|
| Question intent | `lui/flow-guard.ts`, `research/modes.ts`, `research/question-resolution.ts` | which MODES a question invokes; the primary mode owns the answer shape |
| Conversation state | `lui/conversation-routing.ts`, `research/investigation-context.ts`, `domain/investigation.ts` | CONTINUE vs START; the inherited subject; prior findings as labelled CONTEXT only |
| Requirements | `research/requirements.ts` | the ledger: one row per decision dimension and per named data shape |
| Capability planning | `research/requirements.ts` (`CAPABILITY_SUPPORT`, `capabilitiesForRequirement`, `mandatoryCapabilities`), `research/adaptive.ts` (the loop) | which capabilities serve which rows; the floor; recovery |
| Evidence coverage | `research/requirements.ts` (`matchRequirement`, `assessCoverage`, `coverageVerdict`), `domain/evidence.ts` (ingestion) | which observation actually satisfies a row; completion is engine-owned |
| Synthesis | `research/synthesis.ts` | the mode-shaped answer, from evidence, never a payload dump |

The generalization seam is `research/modes.ts` → `research/flow-contract.ts` (grants) →
`research/requirements.ts` (`completeRequirements`). A question composes its modes there, the
union of their granted dimensions bounds the ledger, and the primary mode bounds the answer
shape. Everything downstream (capability floor, coverage, recovery, synthesis) is mode-agnostic.

## 2. The abstractions that already support this (no duplication)

- `chainedFlowsOf` (`modes.ts`) — the ordered modes a question invokes (primary first).
- `FLOW_CONTRACTS` (`flow-contract.ts`) — each mode's `grants`, `pinnedQuestionType`,
  `requiresCounterevidence`, `evidencePreference`. This is the composition vocabulary.
- `completeRequirements` (`requirements.ts`) — unions the modes' engine dimensions and flows'
  evidence rows, then filters the ledger to the union of grants.
- `matchRequirement` / `assessCoverage` / `coverageVerdict` — the deterministic coverage laws
  (shape, span, granularity, subject, freshness, arrow admission, response identity).
- `capabilitiesForRequirement` / `mandatoryCapabilities` / `recoveryCapabilities` — capability
  planning as a look-up against declarations, never a question route.
- `answerShapeFor` (`synthesis.ts`) — the sections a mode's answer owes.
- `routeConversation` / `buildInvestigationContext` — conversation continuity as a deterministic
  state transition, with prior context labelled and never admitted as this run's evidence.

## 3. Invariants added (the coherent change)

Each invariant is a LAW enforced by the engine, with a named module and a test.

**MC-1 — MODE COMPOSITION IS THE SEAM.** The composed modes, question type, market class,
subject, temporal intent, window and resolution are produced by ONE deterministic function of
the question (`planModes` in `research/mode-plan.ts`). The same object briefs the planner and
builds the ledger, so "question → modes → requirements → capability plan" cannot drift apart.

**MC-2 — QUANTITATIVE ROWS DECLARE THEIR SHAPE.** Every engine dimension that asks for market
DATA declares the `DataFacet`s it demands. A row that demands a shape is satisfiable only by a
payload carrying it (`requiredFacetsOf` + `facetCoverage`). A quantitative row with no declared
shape is a contract violation caught at construction.

**MC-3 — REPORTED EVIDENCE IS NEVER A QUANTITATIVE PROOF.** A reported claim (a news headline)
carries only `REPORTED_EVENT`. Because quantitative rows now declare their shapes (MC-2), a
headline can never satisfy a price/volume/series/macro-level requirement through subject-name
overlap. The asset name is an ADMISSION fact, never a coverage proof.

**MC-4 — COUNTEREVIDENCE IS DISCONFIRMING EVIDENCE.** Challenge / counterevidence rows declare
disconfirmation evidence classes (`CONTRAEVIDENCE`/`DISCONFIRMING`/`RISK`), never ordinary
supporting `NEWS`. An ordinary headline that happens to mention the subject cannot stand in for
counterevidence; the row is satisfied only by evidence that itself votes against the reading.

**MC-5 — THE WINDOW IS PROPAGATED AND CANNOT BE SUBSTITUTED.** The composed window travels to
providers as `requiredWindowHours` (adapters derive their `from`/`to`), and the received payload
must actually span it. A provider may add evidence, never silently widen or narrow the requested
span.

**MC-6 — ONE RESPONSE IS ONE PAYLOAD GROUP.** Segments of one provider response (monthly OHLCV
chunks) share a `payloadGroup`. Byte-identical segments are ONE observation (`payloadIdentity`,
dedup). A windowed row may be satisfied by the UNION of a group's segments when no single segment
reaches the window, so a chunked series is not wrongly unresolvable.

**MC-7 — NESTED PAYLOADS ARE MEASURED WHOLE.** Span, granularity and shape are read from a
payload's NESTED observation arrays, not only top-level keys. A `{month, candleCount, candles:[]}`
chunk reports its real span and resolution.

**MC-8 — PROVIDER FAILURE IS AN EXPLICIT GAP.** A failed or unavailable provider output produces
no evidence; the requirement stays PENDING/blocking and completion is never asserted. Failure is
not negative evidence and never fabricated completeness.

**MC-9 — THE ANSWER COMES FROM EVIDENCE.** The trader-facing answer is synthesized from the
validated evidence (or, for an explicit raw-observation request, rendered from the evidence
objects). Raw provider JSON belongs in traceability, never in the primary answer.

**MC-10 — THE CAPABILITY PLAN FOLLOWS THE MODES.** Capability admission reads a requirement's
declared evidence classes and demanded shapes as well as its domains, so an analytic row (thesis
support, a driver) is served by the capability that can actually return its evidence, and an
unrelated capability is never scheduled merely because it exists (market-class scope, subject
requirement, domain/class gating).

## 4. How a question is answered

```
question
  -> planModes(question)             modes, type, class, subject, temporal intent, window, resolution
  -> completeRequirements(question)  one row per dimension AND per named data shape, bound by grants
  -> mandatoryCapabilities(ledger)   the floor: capabilities the CRITICAL rows depend on
  -> registry.execute(capability)    with the run's shapes, resolution and window
  -> evidenceFromToolResult          shape + span + resolution + identity measured at ingestion
  -> assessCoverage(matchRequirement) shape, span, granularity, subject, freshness, class
  -> coverageVerdict + recovery      engine-owned completion; honest gaps; never fabricated
  -> synthesizeAnswer(mode)          the mode's answer shape, from evidence, with provenance
```

Conversation continuity wraps this: a follow-up continues the investigation, inheriting its
subject, mode and open questions as labelled CONTEXT, and retrieving its own evidence.

## 5. Regression coverage

`tests/research/mode-generalization.test.ts` pins the invariants across assets (BTC, ETH, SOL),
horizons (instant, hourly, daily, weekly, monthly, historical), investigation types (observation,
causal, comparison, historical analogue, thesis support, thesis challenge), follow-up
continuity, and provider failure / incomplete evidence. The existing
`generalization.test.ts`, `field-coverage.test.ts`, `flow-isolation.test.ts` and
`requirement-coverage.test.ts` continue to pin the window/shape/flow laws.
