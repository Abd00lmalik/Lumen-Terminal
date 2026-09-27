# Persistence Architecture (Phase F)

Status: implemented. This document describes the persisted-shape truth as of Phase F;
`docs/runbooks/blob-storage.md` remains the OPERATIONS runbook (recovery, warnings).

## Layout

```
Vercel Blob store (public access mode, private content semantics)
├─ workspace/snapshot.json            LEGACY quarantine (write-protected; approved policy)
├─ workspaces/{uid}/snapshot.json     ONE per verified user (uid = Firebase uid)
├─ ops/watchdog-samples.json          bounded sample ring (last 8)
├─ ops/backup-status.json             backup lastSuccess/lastAttempt/lastDrill
├─ ops/legacy-assignment.json         one-time assignment marker (audit trail)
├─ ops/recovery-points/…              pre-assignment recovery points
└─ ops/drill-restore/…                restore-drill verification copies
```

Rules: a workspace path is constructed ONLY by `workspaceBlobPath(uid)` from a VERIFIED
uid (never transport input). Everything under `ops/` is machine bookkeeping and carries
no user content beyond aggregate counts.

## Snapshot shape (versioned)

`WorkspaceSnapshot` now carries `schemaVersion: 2` (Phase F). `undefined` reads as
legacy v1 — readers are ACCEPTING (a version is observability + guarded-migration
support, never a reason to reject data), and the watchdog flags unexpected versions
(`SCHEMA_UNEXPECTED`). Any future persisted-shape change bumps the constant in
`src/domain/workspace.ts` and documents the migration here.

## The write law (Phase E, unchanged and load-bearing)

Per workspace object: read origin (`useCache:false`, cache-busted) → merge (union by id,
more-provenance wins; run records by researchId; tombstones win) → conditional write
(strong ETag via `head()`, re-merge on conflict, bounded retries) → `cacheControlMaxAge`
60. **A save may only replace content it actually read** — thrown/truncated/blank/
unparseable reads abort the save (`BlobReadUnavailableError` → API 500
`PERSISTENCE_FAILURE`). The legacy quarantine adds a hard `writeProtected` refusal in
front of every write path.

## Per-workspace session model

- `VercelBlobStore` is parameterized by pathname; ONE instance per workspace per warm VM.
- `WorkspaceSessions` (idle 10min, max 50) holds one loaded `ResearchApp` per active
  workspace; eviction just drops memory — the durable snapshot is re-read on next use.
- Cross-VM concurrency = the Phase E merge law. Same-VM concurrency = serialized by the
  invocation; adapter reads bind through `AsyncLocalStorage` per request.

## Size & growth expectations

- New user workspaces start EMPTY and grow ~200KB per research run (evidence dominates;
  v2 records are slim). The 16.5MB legacy snapshot is the outlier (46 v1 records with
  inline judgments — see the compaction report in handoff.md §Phase F).
- Watchdog thresholds: warn at 20MB, degrade at 40MB (per workspace object).
- The whole-snapshot read/write model per user remains bounded because a USER's history
  grows far slower than the shared pre-F workspace did; the documented next step if a
  single workspace ever approaches platform limits is the same one the audit named:
  object-level storage (database) — a deliberate future migration, not a Phase F one.

## What migration did (and deliberately did not do)

- DID: schema versioning; read-only inventory of the legacy workspace; a one-time,
  token-gated, WHOLE-copy assignment path with recovery point + verification + audit
  marker (`src/ops/workspace-migration.ts`).
- DID NOT: rewrite, filter, or delete any historical record; infer ownership by any
  heuristic; expose the legacy workspace to new users. The legacy snapshot is untouched
  and write-protected (approved "quarantine in place" policy).

## Testing map

| Concern | Tests |
|---|---|
| Cross-user isolation (API + store seams) | `tests/api/workspace-isolation.test.ts` (13) |
| Read-failure never-overwrite (Phase E law) | `tests/persistence/read-failure-no-overwrite.test.ts` (10) |
| Store semantics (merge, conditional writes, per-path stores) | `tests/persistence/vercel-blob.test.ts` (13) |
| Compaction equivalence | `tests/persistence/compaction.test.ts` (6) |
| Watchdog classification | `tests/ops/storage-watchdog.test.ts` (11) |
| Backup integrity + drill invariants | `tests/ops/offsite-backup.test.ts` (6) |
| Migration logic | `tests/ops/workspace-migration.test.ts` (5) |
