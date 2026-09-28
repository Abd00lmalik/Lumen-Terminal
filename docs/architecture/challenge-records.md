# Challenge Records (Phase G)

Status: IMPLEMENTED + production-verified (2026-09-28). Thin product/domain layer over the
existing Flow 7 falsification methodology; no second research engine, no engine changes.

## 1. What a Challenge is

`CHALLENGE` answers: "Given what I currently believe and the evidence supporting it, what
could make this conclusion wrong?" A **Challenge record** is the persistent, finite result of
that question for one thesis: derived by Flow 7 (WHAT_COULD_PROVE_ME_WRONG), validated by
deterministic domain gates, stored in the user's workspace, never a thesis mutation.

Object chain (per the Phase G brief):

```
THESIS → CLAIM → SUPPORTING EVIDENCE → COUNTEREVIDENCE → FALSIFIER
       → MATERIAL CONDITION (conditionObserved) → INFORMATION GAP → CHALLENGE STATUS
```

- `src/domain/challenge.ts` — model, statuses, transitions, fingerprint, create/normalize.
- `src/research/challenge-derive.ts` — deterministic Flow 7 → records mapping.
- `src/research/flow7.ts` — derives + records challenges after a validated assessment.
- `src/api/routes.ts` — `GET /api/challenges[?thesisRef=]`, `POST /api/challenge {thesisRef?}`.
- `frontend/src/pages/ChallengePage.tsx` — persistent-record UI (sections below).

## 2. Statuses (deterministic, never model-asserted)

| Status | Meaning | Derived when |
|---|---|---|
| `ACTIVE` | live, materially relevant falsifier | thesis-derived condition, no counter-evidence yet |
| `CONTRADICTION` | engine-evaluated counter-evidence exists | cited graph objects contradict |
| `INFORMATION_GAP` | honest unknown (proposed threshold, declared warning) | gap context from the run |
| `STALE` | not re-derived by the latest falsification research | superseded generation |
| `RESOLVED` | re-derivation dropped the falsifier | latest research found nothing; new research may re-open (`RESOLVED → ACTIVE`) |

Transitions are a locked table (`CHALLENGE_TRANSITIONS`); freshness comes from the cited
evidence's own `freshness` flags (STALE/HISTORICAL), never wall-clock age — an old
conflicting article is not an active falsifier without a freshness check.

## 3. Gates (the "never" list, enforced in code)

- **No endless warnings**: fingerprint (FNV-1a over thesis+claim+condition+attacks+origin)
  makes re-derivation IDEMPOTENT — the same falsifier updates one record; superseded ones go
  STALE (kept visible, never deleted).
- **Materiality**: MINOR disagreements never become records (M4 §21 ladder verbatim:
  MINOR / MEANINGFUL_WARNING / MATERIAL_CONTRADICTION / INVALIDATING).
- **Not every uncertainty is a challenge**: a bare PROPOSED threshold with no honest gap
  context (declared early warnings / explicit no-contradiction note) produces NO record.
- **Not every missing data point is counterevidence**: only engine-evaluated contradictions
  in the graph set `conditionObserved` / CONTRADICTION.
- **Irrelevant evidence rejected**: every ref is validated against the workspace graph;
  unknown/fabricated refs are dropped, never stored.
- **Provenance**: every record carries its Flow 7 `researchRef`, thesis version, and an
  append-only provenance trail; epistemic distinctions stay in the Evidence objects (a
  challenge references them by id; OBSERVATION ≠ INTERPRETATION ≠ HYPOTHESIS ≠ JUDGMENT).
- **Thesis immutability**: challenges reference `thesisId` + `thesisVersion`; no code path
  from a challenge to a thesis write (tests assert byte-equality of the thesis after runs).

## 4. Target resolution (deterministic; the model classifies only the ACTION)

"Challenge my thesis" / "what could prove this thesis wrong" / "what contradicts my current
view" / "what assumptions am I relying on" / "has anything changed that weakens this thesis"
route to Flow 7 against the workspace's thesis:

1. the trader's EXPLICIT active-thesis selection (`explicitActiveThesisId()`), else
2. the single current thesis, else
3. typed clarification (`400` on the API; terminal clarify response in the LUI) — never a
   random asset, never a silent pick among several.

Both entry points (natural language through the LUI, `POST /api/challenge`) converge on
`runFlow7` — one derivation law. The generic falsifier path is retained for quoted
statements / hypothesis objects.

## 5. Isolation & persistence

Challenges live inside the per-user workspace snapshot (`challenges` collection) and inherit
Phase F isolation by construction: `GET/POST /api/challenge(s)` resolve through the request's
authenticated workspace; a second user sees `[]`, gets `404` for foreign thesis refs, and
cannot mutate what it cannot see. Read freshness follows the Phase F law (`refreshTheses`
absorbs theses/assessments/challenges from the durable store before list/run; found live:
a warm instance created before the thesis existed answered 400 until this was applied).
Multi-instance merges union challenges AND assessments by id (`mergeSnapshots` fixed: the
old assessments array-concat duplicated records across saves).

## 6. UI sections (ChallengePage)

Current thesis (header; the challenged object, never mutated) · Why it could be wrong
(active/contradiction/gap records with falsifier, evidence chips, gaps) · Active challenges ·
Supporting/counterevidence (ref chips per record) · Falsifiers (condition + attacks + origin
+ materiality) · Information gaps (notes) · Resolved/stale (separate panel, kept visible) ·
Last researched (max record updatedAt + refresh law text) · Provenance (per-record details:
run ref + entries). The run button ("Challenge my thesis" / "Re-run challenge research")
goes through the real API; a typed model failure renders honestly and asserts nothing.

## 7. Tests (deterministic; backend 970 pass / 29 skip)

- `tests/domain/challenge.test.ts` (13): creation, idempotency, fingerprint stability,
  counterevidence, stale evidence, information gaps, contradiction derivation, materiality,
  irrelevant-evidence rejection, persistence + counter continuity, thesis immutability,
  supersede→STALE, merge union (incl. the assessments merge fix), transition table.
- `tests/api/challenge.test.ts` (6): 401 unauthenticated, typed 400 clarifications (0 and >1
  theses), run+persist+immutability, cross-user isolation (B sees no records; foreign thesis
  404), model-failure fail-closed (typed failure, zero records).
- `tests/lui/lui.test.ts` (Phase G additions): no-thesis → terminal clarification (never a
  generic falsifier on an invented target); single thesis → Flow 7 on THAT thesis.

## 8. Production verification (2026-09-28, asklumen.vercel.app)

Admin (real email-link session, real Chrome): research run via UI → FULL record; thesis
created via UI ("Turn this research into a trader-owned thesis") → statement is trader
material (live fix: an evidence-less run's process notice used to become the thesis
statement; the derivation now falls back to the trader's question verbatim); "Challenge my
thesis" through the real UI → real falsification research → 3 records persisted
(CONTRADICTION, MEANINGFUL_WARNING, PROPOSED origin); refresh → records render; thesis
version/statement byte-unchanged; two concurrent challenge runs deduped by fingerprint
(0 duplicate records). Two-user isolation verified by the API suite; the full second-browser
pass re-runs with the next email-quota window.
