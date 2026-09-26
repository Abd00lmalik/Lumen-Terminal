# Saved workspace runbook

Operational guide for the Saved workspace as implemented (`src/domain/thesis.ts` SavedArtifact,
`src/domain/workspace.ts`, `src/api/research-app.ts`, `src/persistence/vercel-edge.ts`,
`frontend/src/pages/SavedPage.tsx`). It describes what the code actually does, not an
aspiration.

## 1. Purpose

**History** is everything Lumen researched. **Saved** is exactly what the trader explicitly
chose to keep. Nothing is auto-saved: a completed run appears in History and nowhere else until
the trader SAVEs an artifact from it. Saved answers "what do I want to keep?".

## 2. Data model

`SavedArtifact` (`src/domain/thesis.ts`):

| Field | Notes |
|---|---|
| `id` | `sa_…` |
| `kind` | closed vocabulary: `RESEARCH \| JUDGMENT \| EVIDENCE \| INSIGHT \| WATCH_NEXT` |
| `type` | legacy/free-form type, retained for continuity views; defaults to `kind.toLowerCase()` |
| `title`, `summary` | human labels derived from the content; NOT identity |
| `content` | the persisted text; non-empty by contract |
| `derivedFromRefs` | workspace objects it derives from (provenance, validated against the graph) |
| `rationale` | why it was saved |
| `researchRef` | originating run (never absent for research-derived artifacts) |
| `sourceRef` | exact originating object (`jd_…`/`ev_…`, `insight`, `watch_<i>`) |
| `thesisRef` | legacy association only |
| `tags` | trader/derived tags |
| `snapshot` | structured, already-persisted content for the kind (rendered verbatim) |
| `provenance` | append-only trail |
| `createdAt`, `updatedAt` | ISO timestamps |

Supported kinds: `RESEARCH`, `JUDGMENT`, `EVIDENCE`, `INSIGHT`, `WATCH_NEXT` (see `SAVED_KINDS`).

## 3. Identity

`researchRef :: kind :: sourceRef` (see `savedArtifactIdentity`). When `sourceRef` is absent it
falls back to `researchRef`, so a run-level RESEARCH artifact is `rs_X::RESEARCH::rs_X`.

Title/question text is **never** identity. Re-saving the same artifact under a new title must
update the existing record, not fork a second one.

## 4. Idempotency

`Workspace.upsertSavedArtifact` finds an existing artifact by identity and, when found, updates
it in place (re-affirming provenance so the merge sees the change) instead of minting a
duplicate. This holds **across instances** too: `createSaved` refreshes Saved state from the
durable store before the identity lookup, so an artifact SAVEd on instance A and then SAVEd on
instance B converges on one `savedId`.

## 5. Unsave

`Workspace.removeSavedArtifact` deletes the artifact AND records a tombstone
(`savedTombstones`: `id → unsavedAt`). The multi-instance merge is a UNION, so without the
tombstone a stale instance's later write would resurrect an artifact the trader removed.
Tombstones win the merge; a tombstoned id is dropped from any snapshot on load.

## 6. Persistence

Saved artifacts live inside the existing workspace snapshot — no new database, no browser-local
source of truth. `VercelBlobStore` reads from origin storage (`useCache: false`, and a self-added
`?cachebust=` for public stores because the SDK's `useCache:false` is a no-op for public).
Conditional writes use a **strong** ETag obtained from the metadata endpoint (`head()`); a Blob
GET returns a WEAK etag (`W/"…"`) that `If-Match` rejects, which is the bug that made every
`POST /api/saved` 500 in production before it was fixed. Every blob operation is bounded by
`BLOB_IO_TIMEOUT_MS`; writes set `cacheControlMaxAge: 60`; there is no eviction.

## 7. Concurrency

A warm serverless instance loads the workspace ONCE. Another instance's SAVE/UNSAVE then lives
only in the durable store, so the warm instance would serve a stale library. The Saved read paths
(`listSaved`, `getSaved`) and the write lookups (`createSaved`, `deleteSaved`) call
`Workspace.absorbSavedState(fresh.toSnapshot())` first, using `WorkspaceStore.loadFresh()` when
the store caches reads (bypassing `LOAD_TTL_MS`). `absorbSavedState` is SCOPED to Saved: it
merges only Saved tombstones/artifacts (tombstones win; newer `updatedAt` replaces; local-only
artifacts are never dropped), so an in-flight research run is never clobbered.

## 8. Failure semantics

- **create fails** → `500 PERSISTENCE_FAILURE`; the in-memory mutation is rolled back
  (`revertSavedArtifactChange`) so the library never shows a phantom save; the response never
  says "saved".
- **delete fails** → the rollback restores the artifact and removes the tombstone; the
  response never says "unsaved".
- **persistence times out** → a typed `BlobIoTimeoutError` surfaces as `PERSISTENCE_FAILURE`.
- **workspace is stale** → the read refresh (§7) applies; if the store read itself fails, the
  read degrades to local state rather than failing the library.
- **original research is degraded** → the artifact stays readable; `origin.available` and
  `recordTier`/`degraded` report the honest status. Nothing is fabricated to fill a missing run.

## 9. Provenance

ORIGINAL RESEARCH → SAVED ARTIFACT; SOURCE → RETRIEVAL → EVIDENCE → SAVED EVIDENCE;
EVIDENCE → ANALYSIS → JUDGMENT → SAVED JUDGMENT. Saving never upgrades an interpretation into an
observation: `snapshot` carries the content AS the originating artifact already classified it.
Opening an artifact shows the artifact first, then "Saved from research: <question>", the date,
the ref, and a link to the original run.

## 10. API

| Method | Path | Purpose | Errors |
|---|---|---|---|
| GET | `/api/saved` | Library rows (summaries): `?limit&offset&sort=recent\|oldest&kind&researchRef&q` | 400 bad window/kind/researchRef |
| GET | `/api/saved/:savedId` | Full artifact + provenance + origin | 404 |
| POST | `/api/saved` | Explicit SAVE `{researchRef, kind, sourceRef?, tags?, rationale?}` | 400 / 404 / 500 |
| DELETE | `/api/saved/:savedId` | Unsave (tombstoned) | 404 / 500 |

**`researchRef` filtering** (Phase D): exact match, applied server-side, composes with `kind`,
`q`, `sort` and pagination. A malformed ref (not `rs_<id>`) is a typed 400; a well-formed but
unknown ref is a valid empty list, never fabricated data, and never cross-run leakage.

## 11. LUI SAVE

USER → LUI interprets SAVE → target/kind/sourceRef validated against the context → an
unconfirmed SAVE HALTS at `AWAITING_CONFIRMATION` and persists NOTHING → with explicit trader
confirmation the artifact is upserted idempotently and promoted to research memory. **LLM output
is not proof of persistence**: confirmation is issued only after the durable write succeeds.

## 12. Frontend

`/saved` (SavedPage): kind tabs, search, open, unsave, empty/loading/failure states; opening
shows the artifact then its provenance. Contextual SAVE/SAVED/UNSAVE controls sit on the
research result, judgment, evidence, insight and watch items. The research view shows
"Saved from this research" (server-side `?researchRef=`), and the library accepts
`/saved?researchRef=rs_…` (filtered view) and `/saved?open=sa_…` (deep link).

## 13. Testing

- `tests/domain/saved.test.ts` — model/identity/normalization.
- `tests/persistence/saved-persistence.test.ts` — reload, cold start, union merge, tombstones,
  `loadFresh` TTL bypass, CDN-bypass source guard, honest write failure.
- `tests/api/saved.test.ts` — endpoints, idempotency, cross-instance visibility.
- `tests/api/saved-runs.test.ts` — SAVED-RUN-001…007 (researchRef filtering).
- `tests/lui/saved.test.ts` — NL SAVE, confirmation, idempotency.
- `tests/benchmark/saved-deterministic.test.ts` — SAVED-001…010.
- `frontend/tests/saved-library.test.ts`, `saved-page.test.tsx`, `thesis-workspace.test.tsx`.
- `scripts/cdp-saved-verify.mjs` — 18-step production browser journey.

## 14. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `POST /api/saved` 500 `ETag mismatch` | weak GET etag used as an `If-Match` validator | use the strong etag from `head()` (done) |
| Saved list omits a just-saved artifact on refresh | warm instance served a stale graph | read refresh via `loadFresh` + `absorbSavedState` (done) |
| `POST` returns 201 but EVERY later GET serves `[]` (global and filtered), create re-mints an old `sa_…` id | tombstoned ids re-minted: counters seeded from artifact ids only rewound after unsaves; the new artifact inherits a dead id and every tombstone-wins pass drops it | tombstone counter continuity: `bumpIdCounterPastId()` on tombstoned ids in `fromSnapshot` + `absorbSavedState` (done; production incident 2026-09-26, blob byte-verified) |
| An unsaved artifact reappears | missing/lost tombstone | ensure `savedTombstones` round-trips (merge + `toSnapshot`) |
| Duplicate artifacts | identity keyed on title instead of `researchRef::kind::sourceRef` | use `savedArtifactIdentity` |
| Wrong `researchRef` | saving against a foreign/unknown run | `createSaved` validates the run exists |
| False "Saved" confirmation | UI treated the click as proof | confirm only after the backend write succeeds |
| Degraded source research | originating run retained at JUDGMENT/SUMMARY | render `degraded`/`recordTier` honestly; never fabricate |

## 15. Debugging procedure

1. `GET /api/saved` — is the artifact present at all? If not, check the write response code.
2. `GET /api/saved?researchRef=rs_X` — does the run filter return it? If the library lists it but
   the filter does not, the `researchRef` was lost (inspect the saved DTO's `researchRef`).
3. `GET /api/saved/:id` — open it; check `origin.available` and `provenance` for the write trail.
4. If it vanishes after a refresh: the tombstone or a stale read is involved — check
   `savedTombstones` in the snapshot and that `loadFresh` is wired.
4b. If EVERY artifact is invisible while creates return 201: check whether the created id
   collides with a tombstone (the runbook §14 row above). Diagnostic shortcut: the blob's
   uploadedAt/size via the Blob `list()` metadata — an upload with a byte-identical size
   means the merge dropped the artifact before the write.
5. If a write 500s: read the error `code` (`PERSISTENCE_FAILURE`) and check the Blob
   token/store/access mode; the ETag path (§6) is the usual suspect.
6. Never "fix" a missing artifact by inventing one; the artifact must come from a real SAVE.
