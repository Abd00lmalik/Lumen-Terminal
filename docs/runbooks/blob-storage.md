# Blob Storage Runbook (Lumen Terminal)

Status: 2026-09-27 (Phase E). Owner: research-app team.

The production workspace snapshot lives in **one Vercel Blob object**:
`workspace/snapshot.json` (public store, `application/json`). Everything below is
written against the current implementation in `src/persistence/vercel-edge.ts`.

## 1. Snapshot location & shape

- Path: `workspace/snapshot.json`. The store never writes any other path (the
  compaction/diagnostic tooling writes nothing).
- One object, whole-workspace: researches, evidence, judgments, theses,
  savedArtifacts + tombstones, run records (`researchResponses`), counters.
- The snapshot is SMALL only by discipline: ~16–19MB serialized today
  (evidence dominates; see the byte audit below). There is **no eviction**:
  every run's full record is retained forever (no-deletion mandate).

## 2. Read path — origin reads only

- Every store read passes `useCache: false` (`snapshotReadOptions`). A CDN copy
  can be a month stale and is a lost-update waiting to happen (Phase B finding).
- The SDK's `useCache: false` only cache-busts PRIVATE stores, so for PUBLIC
  access the store fetches metadata via `head()` and appends a `cachebust`
  query parameter to the body URL (`vercelBlobClient().read`). Never remove
  this: a cached body also carries a cached (weak) ETag and breaks conditional
  writes.
- Blob GET returns a WEAK etag (`W/"…"`); conditional writes need a STRONG
  validator, so the write guard takes the etag from `head()` (metadata), with
  the GET etag as fallback.
- Reads are bounded: `BLOB_IO_TIMEOUT_MS = 20000` per transport op; a hung
  transport aborts and surfaces as a genuine persistence failure.

## 3. Write path — merge-before-conditional-write

`VercelBlobStore.save()` law, in order:

1. **Read current origin state** (3 attempts, 500ms backoff).
2. **Merge** with `mergeSnapshots` (union by id, more-provenance side wins,
   researchResponses union by researchId, tombstone-wins filter).
3. **Write conditionally** with `ifMatch: <strong etag>` (or `createOnly` on
   first write). On precondition failure, re-read/merge/retry (max 3).
4. `cacheControlMaxAge: 60` on every write — mutable state never sits in a
   month-long CDN cache.

Writes are serialized in-process (the store's save queue) and a failed save
must never claim success (the API maps it to `PERSISTENCE_FAILURE`).

## 4. Access auto-detection

The store probes `private` first and flips once on a mismatch. Two mismatch
error styles exist (both handled, tests in
`tests/persistence/read-failure-no-overwrite.test.ts`):

- SDK local message: `Cannot use private access on a public store`.
- **Remote 400**: a recreated store answers a wrong-access GET with
  `Vercel Blob: Failed to fetch blob: 400 Bad Request` (Phase E finding).

The flip is a FIRST-DETECTION repair only. Once access is known, a 400 is an
honest error and must surface — never retry against the other access mode.

## 5. Read-failure semantics: never write blind

Three production incidents (all Phase E, all fixed with regression tests):

| Incident | Failure mode | Old behavior | Fix |
|---|---|---|---|
| rs_000244 | read THROWS | "degraded" to unconditional write → erased run | bounded retry, then `BlobReadUnavailableError` |
| rs_000249 | read returns TRUNCATED body (parses like corruption) | unparseable = "corruption we may replace" → erased run | unparseable body aborts the save honestly |
| th_000011 | PRESENT blob answers BLANK | counted as "absent" → local-only conditional write, merge skipped → erased thesis | blank body from a present blob throws inside `readRawWithEtag` |

The unified law: **a save may only replace content it actually read.** If the
read throws, truncates, or returns blank for a present blob, the save throws
`BlobReadUnavailableError` and the caller reports `PERSISTENCE_FAILURE`
(HTTP 500). The load path falls back to the last cached snapshot instead of
inventing an empty graph. Recovery is manual (§8), never automatic.

## 6. Merge semantics & tombstones

- Union by id; the side with MORE provenance/history entries is newer; equal
  keeps local (the saving instance holds in-flight state).
- `researchResponses` (run records): union by researchId; records are
  immutable once written.
- Saved artifacts: tombstones (`savedTombstones`) are unioned and win — a
  stale instance's union must not resurrect an unsaved artifact.
- `activeThesisId`: only kept if it exists in the union.
- Counters are preserved by union (ids mint monotonically); **never rewind
  counters** or ids collide.

## 7. Compaction

Endpoint: `GET /api/storage/audit` (byte-level breakdown, read-only) and
`POST /api/storage/compact { dryRun?: boolean }`.

- Compaction = legacy v1 run-record normalization to the v2 slim shape
  (record strips inline evidence/judgments arrays to refs; rehydration
  reproduces them from the graph). Reference-based; **no deletion, no
  eviction, no semantic change**.
- Guarded migration: rehydration must byte-match the stored arrays, else the
  record is left v1 verbatim (never guessed). Some records legitimately stay
  v1 (graph-absent members) — 46 of 102 today; this is expected, not a bug.
- Idempotent: v2 records are skipped; a second dry-run reports
  `normalizedRecords: 0`.
- A compaction write goes through the normal save path (merge + ifMatch), so
  it can never erase a concurrent instance's runs. NOTE: on the ~19MB
  snapshot a compaction save can take ~60–90s; a dry-run executed
  immediately afterwards may report against the PRE-compact blob — verify
  via `head()`/`uploadedAt` or repeat the dry-run.

## 8. Recovery procedure (verified 2026-09-27)

When the blob or the whole store is lost/deleted platform-side:

1. **Stop writing.** With honest-abort in place the app fail-closes on its
   own (`PERSISTENCE_FAILURE` on every save), but avoid triggering writes.
2. **Diagnose**: `GET /api/storage/diagnose` (credentials presence by name
   only, bare origin HEAD/GET result with the SDK's error text — no secret
   values, no content) and `npx vercel blob list` / dashboard Storage tab.
3. **Reconnect the store** (dashboard): recreate/attach the Blob store, then
   verify `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN` exist in **all**
   environments (`npx vercel env ls`) — note env changes require a fresh
   deployment to reach the functions.
4. **Redeploy** (`npx vercel --prod --yes`) and confirm
   `/api/storage/diagnose` reports `head: ok (blob present)` or
   `absent (no error)`.
5. **Restore from the recovery point** (`.data/phase-e/pre-compact-snapshot.json`,
   18,981,588 bytes, JSON-parse-verified):
   - upload with `put('workspace/snapshot.json', raw, { access: 'public',
     addRandomSuffix: false, allowOverwrite: true, contentType:
     'application/json', cacheControlMaxAge: 60 })`;
   - read back and require **byte-identity** with the source before
     declaring recovery;
   - re-apply lifecycle moves that happened after the recovery point was
     taken (2026-09-27: re-archived smoke theses th_000004..000009);
   - re-run compaction (48 records normalized, 2.47MB saved; idempotent).
6. **Verify**: `/api/storage/audit` counts (researches=248, records=102,
   theses=9, tombstones=14), history newest ref, run views rehydrate FULL
   (e.g. rs_000090: 50 evidence, answer text present).

## 9. Explicit warnings (each one bit us in production)

1. **Never enable cached reads before a merge** (`useCache: false` is law).
2. **Never trust a GET etag for If-Match** — weak validators fail every
   conditional write; use `head()`.
3. **Never write unconditionally** — a merge skipped is an erasure.
4. **Never let a stale instance overwrite** — conditional writes + re-merge
   on conflict.
5. **Never delete snapshots/artifacts directly** (no-eviction mandate;
   tombstones only for explicit unsaves).
6. **Never resurrect tombstoned artifacts** via merge.
7. **Never rewind id counters** (id collisions across instances).
8. **Never write blind after a failed/truncated/blank read** — abort
   honestly (`BlobReadUnavailableError`); recovery is manual from a
   verified recovery point.
9. **Never serve an empty graph when the read is blank** — fall back to the
   last known-good cache on load.
10. **Env/binding changes need a fresh deployment** — a recreated store is
    invisible to warm functions until redeploy; verify with
    `/api/storage/diagnose` before assuming app-level bugs.

## 10. Concurrent-instance verification steps

1. Open two terminals; `curl /api/research?limit=1` from both; note the
   newest ref.
2. From terminal A, POST a thesis (any lifecycle move that saves).
3. Immediately from terminal B, POST a saved artifact for a DIFFERENT
   research.
4. Re-read from both: both mutations must be present (merge law). If one is
   missing, capture `/api/storage/audit` and the deployment's
   `/api/storage/diagnose` output before touching anything.
