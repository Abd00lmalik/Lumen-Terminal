# Manual Smoke Test — Lumen Terminal (Phase E)

Date: 2026-09-27 · Target: https://asklumen.vercel.app (production) · Method:
human-executable checklist; the CDP companion (`scripts/cdp-phase-e-smoke.mjs`)
performs the identical 39 checks against the real UI + real API and records
screenshots in `.data/phase-e-smoke/` (CDP never replaces the human pass).

> **PHASE F NOTE:** after Firebase env vars are set on the deployment, this suite runs in
> authenticated mode: the CDP script must sign in first (a separate Phase F two-account
> suite covers isolation; see `handoff.md` §Phase F). Until then production stays in
> pre-F form. The suite below documents the Phase E baseline it guarantees.

**Final result: 39/39 checks passed** (CDP-assisted pass, 2026-09-27, after the
incident fixes below). Pass history: 34/39 → 35/39 → 37/39 → 37/39 → 39/39.
Two failing checks were diagnosed and corrected (not waived): B asserted a raw
ref string the UI never renders (probe-proved, 5/5 attempts); G compared the
UI against the POST answer instead of the persisted GET aggregate.

Environment: production Vercel deployment (alias asklumen.vercel.app), serverless
functions + Vercel Blob store `workspace/snapshot.json` (public), provider chain
HEALTHY (G fresh run COMPLETED, FULL tier). Windows/bash driver; headless Chrome
+ CDP for the automated half.

Key refs used: verify run `rs_000242` (CPI question), v1-giant records
`rs_000090` / `rs_000176`, fresh runs `rs_000243..rs_000249` (one per full G
pass), theses `th_000001` (durable ACTIVE) + `th_000002..000009` (archived),
saved library empty live (14 tombstones, 15 after smoke D).

## Scenario A — Application boot

Steps: open `/home`, `/research`, `/history`, `/saved`, `/thesis`; confirm each
renders non-blank; watch console for uncaught errors.

Expected: every route paints content (shell-first is fine; data lands later);
zero uncaught frontend errors.

Observed: PASS (all five routes render; console clean across boot + navigation).

## Scenario B — Research run reopen (deep link)

Steps: from `/history`, open run `rs_000242` directly; verify question, answer,
uncertainty, provenance/evidence section, record tier FULL; refresh; navigate
away and return.

Expected: the deep link routes to THIS run (URL identity: `#/research/rs_000242`,
no redirect), question "What is the US CPI inflation rate right now?" rendered,
answer text visible, uncertainty + provenance visible, server recordTier FULL,
refresh and back-navigation keep the same run.

Observed: PASS. Note (documented product fact, probe-proved): the run view does
NOT render the raw ref string in its DOM — run identity is carried by the URL
plus the content. Earlier smoke iterations asserted the ref text and failed;
the check was corrected to assert URL identity + content match.

## Scenario C — History

Steps: open `/history`; check rows render; search "CPI" filters the list; verify
ordering is newest-first by updatedAt with ref tie-break (server contract); no
row claims "unavailable" while its summary exists.

Expected: 138 rows (rs_000001..rs_000248, newest first); search narrows; tier
honest.

Observed: PASS (rows=138 server / 104 rendered rows counted by CDP; newest
rs_000248, oldest rs_000001; search works; no dishonest unavailability).

## Scenario D — Save / unsave (Saved library)

Steps: open run rs_000242, save it via the UI (title tooltip `Save … to your
library`), confirm UI state; verify via BACKEND (`/api/saved?researchRef=…`)
that the artifact exists; open artifact detail; check provenance link to origin
research; unsave; refresh; confirm the unsave persisted and the original
research still exists.

Expected: UI save confirms; backend confirms (not just UI state); filter returns
only that run's artifacts; detail + provenance link; unsave persists as a
tombstone (library returns to empty-live state; tombstone count 14 → 15).

Observed: PASS (all D checks; the save/unsave cycle left a 15th tombstone —
expected by design; no live artifacts remain after the pass).

## Scenario E — Thesis lifecycle

Steps: create a thesis with an exact trader-provided statement ("Phase E smoke
thesis: CPI print decides near-term USD direction."), verify the statement is
stored EXACTLY (not rewritten), linkedResearchRefs includes rs_000242, status is
a valid lifecycle state (ACTIVE); archive it to leave production tidy; verify
persistence across refresh.

Expected: deterministic create; exact statement; correct link; explicit archive.

Observed: PASS (this pass created `th_000010`, linked to rs_000242, then
archived). Note: earlier passes created th_000004..000009 (archived during
earlier passes) and th_000011, which was LOST in the store-deletion incident
(see below).

## Scenario F — Persistence / cold start

Steps: brand-new browser instance (fresh CDP target, own JS context), open the
same run deep link; read `/api/saved` and `/api/theses` cold; compare with the
warm read.

Expected: server-side persistence contract — same run opens cold; saved library
and theses lists identical from a cold read (only server state carries over).

Observed: PASS (cold run view renders; saved=1 live artifact during the pass
window / tombstones otherwise; theses identical cold vs warm).

## Scenario G — Provider health (one legit fresh research)

Steps: POST a fresh natural-language research request ("What is the current
price of gold per ounce?"); wait for a terminal event; verify the run persisted
(COMPLETED, FULL tier), reopens via GET, appears as the NEWEST row in History,
and renders in the UI (compare against the PERSISTED GET answer).

Expected: provider chain healthy → COMPLETED, FULL tier, ~60–300s elapsed;
newest history row is the fresh ref; UI renders the persisted answer.

Observed: PASS (this pass: rs_000249, COMPLETED, FULL tier, 282s; provider
chain, no modelFailure). A typed provider failure would be RECORDED, never
faked (a MODEL_FAILURE outcome is an accepted terminal event for this check).

## Incidents encountered during Phase E (root causes + fixes, all committed)

1. **rs_000244 erasure** — a thrown origin read "degraded" to an unconditional
   write and erased the run. Fix: bounded retry then honest abort
   (`BlobReadUnavailableError`); commit `e33abf1`.
2. **rs_000249 erasure** — a TRUNCATED read parses like corruption; the old
   code replaced "corruption". Fix: unparseable body aborts the save honestly;
   commit `39e7a79`.
3. **th_000011 erasure** — a present blob answering BLANK counted as
   "absent", so save skipped the merge law and wrote local-only content under
   a valid ifMatch guard. Fix: blank = failed read; commit `f002006`.
4. **Blob store deleted platform-side** — production returned empty history;
   CLI+SDK said "This store does not exist". The honest-abort fixes held
   (fail-closed, no blind writes). User recreated the store; recovery point
   `.data/phase-e/pre-compact-snapshot.json` (18,981,588 bytes) was restored
   byte-identically; access auto-detection fixed for recreated stores (remote
   400 mismatch style); compaction re-applied; commit `1601888`. Full
   procedure: `docs/runbooks/blob-storage.md` §8.

## Final state after the last pass

- History: 138 rows, newest rs_000248 (the G run rs_000249 is created by the
  pass itself and is newest at pass end).
- Theses: th_000001 ACTIVE (durable), th_000002..000010 ARCHIVED.
- Saved: 0 live artifacts, 15 tombstones (D leaves one behind by design).
- Compaction: 102 records — 56 normalized to v2 + 46 v1-by-design (un-rehydratable
  members); 0 further normalizable; snapshot ~16.5MB.
- Provider: healthy; fresh-run chain COMPLETED in every G pass.
- Screenshots: `.data/phase-e-smoke/e-*.png`; machine results:
  `.data/phase-e-smoke/results.json`.
