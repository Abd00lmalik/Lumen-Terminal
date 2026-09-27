# Storage Watchdog Runbook (Phase F)

Status: implemented. Endpoint `GET /api/storage/health` (admin-gated); scheduled daily via
Vercel Cron (`/api/cron`, `CRON_SECRET`-gated). READ-ONLY: health checks never mutate
workspace state; the watchdog never deletes, compacts, migrates, or overwrites anything.

## 1. Health states

| State | Meaning | What it is NOT |
|---|---|---|
| `HEALTHY` | All observed facts nominal | — |
| `DEGRADED` | Impaired but not data-loss: flaky saves, size pressure, growth spikes, count anomalies with a plausible explanation pending, stale backup, unexpected schema | Not "fine" — act on findings |
| `UNAVAILABLE` | Storage cannot be trusted right now: store unreachable, content unparseable/blank | NEVER reported as "empty workspace" — absent data and absent storage are distinct findings |

## 2. Checks (classification in `src/ops/storage-watchdog.ts`, pure + unit-tested)

| Finding code | Severity | Trigger | Remediation (also emitted) |
|---|---|---|---|
| `STORE_UNAVAILABLE` | critical | transport error / store missing | Diagnose (`/api/storage/diagnose`), check dashboard Storage binding, recovery runbook §8 — do NOT restore blindly |
| `CONTENT_UNPARSEABLE` | critical | readable body fails JSON.parse | Forensic copy, restore from verified backup; honest-abort keeps saves closed |
| `CONTENT_BLANK` | critical | present blob answers empty (Phase E th_000011) | Saves are refusing (correct); verify store health; restore if persistent |
| `SNAPSHOT_ABSENT` | info | genuinely no object yet | None for new deployments; if data existed, see STORE_UNAVAILABLE |
| `SAVES_FAILING` / `SAVE_FLAKY` | critical/warning | recent save outcomes all/partly failed | Check read path first; never disable honest abort |
| `SIZE_LIMIT_RISK` / `SIZE_WATCH` | warning/info | snapshot > 40MB / > 20MB | Compaction dry-run review; never delete history |
| `GROWTH_SPIKE` | warning | >50% growth in <1h | Hunt a write loop or merge duplication via `/api/storage/audit` |
| `RECORD_COUNT_DROPPED` | critical | run-record count shrank between samples | STOP writes; forensic copy; restore newest verified backup; identify last writer |
| `BACKUP_NEVER_SUCCEEDED` / `BACKUP_STALE` / `BACKUP_DRILL_MISSING` | warning/info | backup status object | Fix job/credentials/scheduler; run the restore drill |
| `SCHEMA_UNEXPECTED` | warning | snapshot `schemaVersion` ≠ expected | Compare against the migration checklist before further writes |
| `HASH_MISMATCH` | warning | continuity hash changed while size+counts did not | Forensic copy; concurrent-instance verification steps |

## 3. Scheduling

- `vercel.json` defines one cron: `0 3 * * *` → `GET /api/cron` (daily, inside every
  plan's limits; timing guaranteed within the hour, UTC).
- The cron handler runs the watchdog AND the offsite backup, then records
  `ops/backup-status.json` (`lastSuccessAt` / `lastAttemptAt` / `lastDrillAt`), which the
  watchdog reads via `BACKUP_STATUS_URL`-style status (the same blob object).
- Set `CRON_SECRET` in project env — Vercel sends it as the Authorization header; without
  it the endpoint would be publicly triggerable.
- Tighter cadence: use an external scheduler (cron-job.org etc.) hitting `/api/cron` with
  the same Bearer secret; Vercel's own Hobby crons are daily-only.

## 4. Sample bookkeeping (why deltas work)

Each watchdog run appends a bounded sample (last 8) to `ops/watchdog-samples.json`:
`{ at, snapshotBytes, recordCount, integrityHash }`. Growth rates, count drops, and hash
continuity are computed against the previous sample. The samples live in a SEPARATE
`ops/` object so bookkeeping can never touch workspace state. A failed sample write only
loses deltas — never health.

## 5. Diagnostics surface (all admin-gated)

- `GET /api/storage/health` — the verdict + findings + facts (no secrets, no content).
- `GET /api/storage/diagnose` — credentials presence by name + bare origin HEAD/GET outcome.
- `GET /api/storage/audit` — byte/record breakdown of the current snapshot.
- `GET /api/storage/sessions` — live per-workspace sessions on this warm instance.
- `GET /api/storage/backup-status` — last backup attempt/success/drill.

Nothing here returns tokens, user emails (beyond the admin allowlist check), or snapshot
content.
