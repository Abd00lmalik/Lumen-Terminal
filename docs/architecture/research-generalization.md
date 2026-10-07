# Research Generalization: Resolution, Time, Modes, Assets

> The engine must answer a trader's natural-language research question across assets, horizons,
> evidence types and research modes **without bespoke code paths**. This document records the four
> generalization axes, where each lives, and the law each one enforces.

The Bitcoin / 24-hour question is **one regression case**, never the architecture. Nothing here
special-cases an asset, a phrase, a provider or a capability.

## 1. RESOLUTION (granularity) — `src/research/resolution.ts`

SPAN and RESOLUTION are different axes. `coverageHours` says how far back data reaches; resolution
says how finely that reach is sampled. The engine only had the first, so `SERIES` was
resolution-free: a DAILY candle set satisfied a request for an HOURLY sequence.

- `namedResolutionOf(text)` — the granularity a requirement NAMES ("hourly", "daily", "15-minute").
- `resolutionOfTimeframe(token)` / `resolutionOfStamps(stamps)` — the granularity a payload HAS,
  from the declared bar size or the median timestamp spacing. Measured at the ingestion boundary
  (`evidenceFromToolResult` → `Evidence.resolution`).
- **Law** (`resolutionCovers`): a requirement that names a resolution is satisfied only by evidence
  at least as fine (served rank ≤ required rank). A row that names none keeps only its window law,
  so drivers/thesis/news rows are untouched. An unproven resolution is never a proof.
- **Provider selection, not a gate**: `impliedResolutionForWindow(hours)` converts a horizon into the
  granularity to request (24h → hourly, multi-year → monthly). The engine passes `requiredResolution`
  to providers, and the Bitget/G1 adapters select the bar size from it instead of a hardcoded `1h`/`1d`.

Span laws (window + resolution) apply only to `demandsSpan` demands (`data-facets.ts SPAN_FACETS`) —
a `REPORTED_EVENT` row is governed by the freshness law, never by span/granularity.

## 2. TIME — `src/research/temporal.ts`

Temporal intent is one general parser, not a phrase list. `temporalIntentOf` returns a discriminated
intent: **ROLLING** ("last 24 hours", "the last hour"), **CALENDAR** ("today", "this week", "year to
date"), **RANGE** ("2020-2021"), **SINCE** ("since the breakout"), **OCCURRENCES** ("the previous
three occurrences"), **INSTANT**, or **OPEN**.

- `temporalWindowHours(intent)` resolves a fixed lookback for ROLLING/CALENDAR/RANGE. SINCE,
  OCCURRENCES and INSTANT are deliberately open-ended: they are not a duration, and inventing one is
  how a provider would silently substitute a different span.
- `requestedWindowHours` (data-facets) and the requirement window law now delegate here, so there is
  one temporal vocabulary for requirements and evidence.
- Conversation routing delegates too: `restatesTimeWindow` in `src/lui/conversation-routing.ts`
  reads a "now look at the last 7 days" restatement through `temporalIntentOf` instead of carrying
  its own window-phrase regex. The routing layer keeps its own policy on top of the parse — an
  INSTANT measurement ask and freshness-word calendar phrases ("today", "yesterday", "intraday")
  never continue a thread, so a fresh standalone question still starts one — but it never
  re-enumerates the phrases themselves.

## 3. MODES — `src/research/modes.ts`

The eight canonical flows are eight research MODES, not eight prompt templates. `chainedFlowsOf`
detects every mode a question invokes (the primary first), conjunction-gated so a single-clause
question never widens scope. `completeRequirements` then:

- unions the engine-required dimensions of every chained mode, and
- unions their granted dimensions for the flow-isolation filter (so a compound question keeps the
  dimensions it actually asked for).

Thus "Why did BTC fall, and does my bullish thesis still hold?" acquires OBSERVATION → CAUSAL →
THESIS internally, while the primary mode still owns the answer shape.

The mode vocabulary is ONE table: `MODE_PATTERNS` is exported from `modes.ts`, and
`src/lui/flow-guard.ts` classifies task wording through that same table (`TASK_PATTERNS =
MODE_PATTERNS`). Flow guards and mode chaining therefore cannot drift onto different regexes for
the same phrase — the failure where a question's guard pattern and its chain pattern disagreed
(three of seventeen probe questions classified inconsistently, each path falling back to a
different flow). `tests/lui/intent-coherence.test.ts` pins the parity.

## 4. ANSWER SHAPES — `src/research/synthesis.ts`

`answerShapeFor(flow)` names the SECTIONS each mode's answer owes (a timeline for WHAT_HAPPENED, a
condition → evidence → status structure for DOES_MY_THESIS_HOLD, falsification conditions for
WHAT_COULD_PROVE_ME_WRONG, and so on). `answerShapeGuidance` is appended to the synthesis prompt, and
`renderAnswerSynthesis` keeps raw provider payloads out of the answer (they belong in traceability).

The shape is enforced, not only prompted: `answerShapeViolations` checks the sections with a clean
field mapping against what the draft actually delivered (the structured causal chain counts as its
own factors/watch conditions; a section with no field of its own is never demanded). A draft that
owes a section and omits it gets one bounded corrective retry naming exactly what is missing — the
same law the question-first opener already had — and a retry that still misses it is rejected so the
deterministic fallback answers instead.

## 5. ASSETS — `src/domain/instruments.ts`, `requirements.ts subjectMarketClassOf`

Crypto is a CLASS, not the short list the classifier enumerated. `mentionsCryptoAsset` answers the
entity question from the shared asset registry (word-bounded), so a question about XRP, DOGE or an
asset nobody hardcoded still resolves to the CRYPTO market class and reaches the crypto provider
chain instead of the commodity one. The other classes (METAL/COMMODITY/FX/RATES/INDEX/EQUITY/MACRO)
remain taxonomies.

## Regression coverage

`tests/research/generalization.test.ts` pins all four axes: granularity gate (daily never satisfies
hourly; finer satisfies coarser), temporal parsing across kinds, multi-mode chaining vs single-mode
isolation, asset-class generalization, and per-mode answer shapes. `tests/research/field-coverage.test.ts`
and `tests/research/flow-isolation.test.ts` continue to pin the window/shape laws and flow isolation.
The single-vocabulary laws have their own suites: `tests/lui/intent-coherence.test.ts` (flow guard vs
mode chain classify every phrasing the same way), `tests/api/conversation-routing-production.test.ts`
(dimensions changes keep their thread; anchored comparisons, window restatements, falsification
rephrasings, and the controls that must still start fresh), and the answer-shape matrix in
`tests/research/final-judgment.test.ts`.
