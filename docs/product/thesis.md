# Thesis workspace (product)

## What it is

A structured workspace for **what the trader currently believes, why they believe it, what could
invalidate it, and what evidence would change their mind.** It is a research and
decision-support object, not a trading surface. There are no orders, no execution, no portfolio
automation; the trader remains the final decision-maker.

## Core principle: the trader owns the thesis

Lumen researches, evaluates, challenges, and organizes evidence around a thesis. Lumen does
**not** decide the belief and never silently rewrites it.

- Trader-owned: `statement`, `title`, `claims`, `assumptions`, `invalidationConditions`,
  `materialConditions`, `alternatives`.
- Lumen may propose/assess: supporting evidence, counterevidence, an assessment, material
  changes — always as an explicit result the trader can read and act on.
- Any material modification to trader-owned state requires an explicit trader action (the API
  caller) or an explicit confirmation in the natural-language path.

## What the page shows

THESIS (statement) · STATUS · CURRENT ASSESSMENT · SUPPORTING EVIDENCE · COUNTEREVIDENCE ·
ASSUMPTIONS · WHAT WOULD PROVE THIS WRONG? (falsifiers) · MATERIAL CONDITIONS · LINKED RESEARCH ·
LINKED SAVED ARTIFACTS · LAST UPDATED. The central question is always visible: *what do I
believe, what supports it, and what would change my mind?*

## Creating a thesis

From **research** (`researchRef`), from a **saved artifact** (`savedId`), or from **natural
language** (a statement). The statement that is persisted is exactly the one supplied, or the
one derived VERBATIM from the chosen source (the run's answer or the artifact's content). Lumen
never paraphrases or strengthens a belief.

Natural-language path: USER → LUI proposes a thesis → **explicit confirmation** → the artifact is
created. An unconfirmed request persists nothing.

## Lifecycle

Deterministic transitions only (see `THESIS_TRANSITIONS` in `src/domain/thesis.ts`):

```
DRAFT → ACTIVE → CONFIRMED / WEAKENED / INVALIDATED / PAUSED / SUPERSEDED → ARCHIVED
```

- `DRAFT → ACTIVE` and `→ CONFIRMED` require a TRADER origin.
- A status is never chosen from an LLM sentence.
- An assessment result never changes the thesis object or its status.
- When evidence is insufficient the thesis stays ACTIVE with an uncertainty note; it is not
  moved.

## Thesis + research

A thesis references multiple research runs BY REFERENCE (`linkedResearchRefs`) — research
objects are never copied into the thesis. Opening a linked run uses the existing History
aggregate endpoint and respects FULL/JUDGMENT/SUMMARY degradation. Unavailable runs are shown as
unavailable, never fabricated.

## Thesis + saved

An existing Saved artifact can be attached by reference (`linkedSavedIds`); it is never
duplicated. If the artifact is later unsaved, the thesis is **not** corrupted or deleted — the
link is reported as unavailable. Detaching is always explicit and never changes the thesis's
lifecycle.

## Assessment semantics

An assessment distinguishes supporting evidence, challenging evidence, unresolved information,
material changes, and uncertainty. It never collapses "no evidence found" into "evidence against
the thesis", and never treats a provider failure as evidence. More records do not by themselves
raise confidence.
