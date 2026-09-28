# Backups & Recovery Runbook (Phase F)

Status: **PROVEN IN PRODUCTION (Phase F.1, 2026-09-28)**: offsite backup to R2 verified by
read-back, restore drill PASSED against the real destination, watchdog HEALTHY, daily cron
observed succeeding on its own. See §3.1 and §4.1.

## 1. Why Cloudflare R2 (decision record)

- S3-compatible API (aws4fetch — ~2KB client, no SDK), **zero egress fees** (restore is free).
- Separate failure domain from Vercel Blob (different vendor/account plane) — a second key
  or folder in the SAME store would NOT be offsite.
- AES-256 at rest (R2 default, keys controlled by the operator's CF account), TLS in transit.
- ~$0 at this scale (10GB free tier; the snapshot is ~16.5MB/day).

Rejected: same-store copies (not offsite), S3/GCS (egress + heavier creds), Azure (same).

## 2. One-time destination setup (operator)

1. Cloudflare dashboard → R2 → Create bucket (e.g. `lumen-backups`). Region: any; pick
   the one nearest your users for latency (irrelevant for backups).
2. R2 → Manage API tokens → Create API token with **Object Read & Write** scoped to the
   bucket. Record Account ID, Access Key ID, Secret Access Key.
3. Set project env (server-side only; NEVER in the frontend, NEVER committed):

| Variable | Value |
|---|---|
| `BACKUP_R2_ACCOUNT_ID` | Cloudflare account id (32-hex) |
| `BACKUP_R2_ACCESS_KEY_ID` | R2 token access key |
| `BACKUP_R2_SECRET_ACCESS_KEY` | R2 token secret |
| `BACKUP_R2_BUCKET` | Bucket name |
| `BACKUP_R2_PREFIX` | Optional (default `lumen-backups/`) |

4. Redeploy. Trigger a manual run: `POST /api/storage/backup` (admin) or wait for the
   daily cron (03:00 UTC).

## 3. What gets backed up, and how

- Every workspace snapshot: the legacy quarantine (`workspace/snapshot.json`, as
  workspace id `_legacy`) plus each `workspaces/{uid}/snapshot.json`.
- Object layout: `{prefix}/{workspaceId}/{YYYY-MM-DD}/snapshot-{HHmmss}.json`.
- Envelope (the uploaded JSON): `format`, `version`, `schemaVersion`, `workspaceId`,
  `createdAt`, `bytes`, `sha256`, `snapshot`. The source is parsed BEFORE upload — a
  partial/unparseable snapshot is never backed up as if valid.
- Verification law: the upload is read BACK and its `sha256`/`bytes` checked before the
  job reports success. No verified read → the run reports failure.
- Retention: keep newest daily points for 30 days, but NEVER prune below 7 objects per
  workspace (protects the only known-good recovery point). Pruning only touches
  already-verified objects.
- Backups are server-side only; credentials live in env; the bucket is private.

### 3.1 Phase F.1 activation result (2026-09-28)

- First production run: `POST /api/storage/backup` (admin) → verified read-back
  (`verified:true`), legacy snapshot `_legacy/2026-09-28/snapshot-081933.json`, 16,507,548
  bytes, sha256 recorded. Manual runs are idempotent/safe (ran 3×).
- Envelope now carries `sourceIntegrity.danglingRunRecords` (count recorded AT BACKUP
  TIME). Rationale: the legacy source contains 1 documented dangling run-record reference
  (rs_000251 zombie; inventory reports `danglingRunRecords:1`), which the drill's
  reference check would otherwise misclassify as corruption. `classifyDanglingRefs()` →
  `clean | faithful-with-condition | corrupted`; only `corrupted` fails a drill; the
  condition stays visible and is NEVER repaired silently.
- Retention in force: 30 daily points, never below 7 objects per workspace.

## 4. Restore drill (non-destructive, and required)

A backup is not proven until restored. `POST /api/storage/restore-drill
{"backupKey":"<key from the backup result>"}` (admin):

1. Fetches the chosen backup from R2.
2. Verifies the envelope + recomputed SHA-256 against `envelope.sha256`.
3. Parses the embedded snapshot and checks invariants: non-empty collections, run-record
   references resolve (no dangling), counts recorded.
4. Writes the verified copy ONLY to `ops/drill-restore/…` (never a workspace path).
5. Reports `{ ok, checks[], counts, bytes }` and records `lastDrillAt`.

Run the drill after enabling backups (once), after any restore-worthy incident, and at
least quarterly.

### 4.1 Phase F.1 drill result (2026-09-28, real destination)

- `POST /api/storage/restore-drill` → `ok:true`, all checks passed against the real R2
  backup: envelope + recomputed SHA-256 match, counts match the source
  (249 researches / 103 run-records / 10 theses / 0 saved / 15 tombstones), the 1
  documented dangling run-record reference classified `faithful-with-condition` (not
  corruption), and the isolated write check is byte-exact (`Buffer.byteLength` UTF-8 vs
  bytes — an earlier chars-vs-bytes comparison false-failed on non-ASCII).
- Watchdog then reports **HEALTHY** (`findings:[]`); `BACKUP_DRILL_MISSING` correctly
  appeared before the drill was recorded. NOTE: there is a brief blob write→read
  visibility gap — a status read immediately after a drill/backup can lag one read;
  re-run the read before investigating (see `blob-storage.md` §7).
- Watchdog wiring fix during F.1: the endpoint previously read backup facts only from a
  never-configured `BACKUP_STATUS_URL` env (silently vacuous findings); it now reads
  `ops/backup-status.json` in-process first, env fallback kept
  (`src/ops/storage-watchdog-endpoint.ts`).

## 5. Real recovery (destructive by definition — follow exactly)

1. Stop writes: the app's honest-abort already fail-closes on unreadable state; if the
   problem is bad DATA (not reads), remove write access by revoking the Blob token
   binding (dashboard) before touching anything.
2. Take a forensic copy of the current (broken) object: `npx vercel blob` download or a
   GET to the blob URL; store it locally with a timestamp.
3. Pick the newest backup whose drill passed. Download it from R2 (S3 API or dashboard).
4. Verify its envelope hash locally (`sha256sum` on the extracted `snapshot` equals
   `envelope.sha256`).
5. Write the snapshot JSON (just the `snapshot` field, pretty-printed or compact — both
   parse identically) to the target workspace path via `put('workspaces/{uid}/
   snapshot.json', …, { allowOverwrite: true, contentType: 'application/json',
   cacheControlMaxAge: 60 })`.
6. Verify: `GET /api/storage/audit` (admin) — counts must match the drill report; open a
   run in the UI; run the smoke suite.
7. Record what was restored, from which backup, into `handoff.md`.

## 6. Threat coverage matrix

| Threat | Covered by |
|---|---|
| Accidental blob/store deletion (Phase E incident 4) | Offsite copies + recovery procedure |
| Corrupt/truncated/blank snapshot (Phase E incidents 1–3) | Honest-abort (fail-closed) + offsite copies |
| Bad migration/compaction | Recovery points taken before the act; compaction's own recovery point |
| Platform/storage outage | R2 is a different vendor plane |
| Incorrect application writes | Merge/conditional-write law + count-integrity watchdog + backups |
| Compromised storage account | Backups in a separate CF account with separate credentials |
