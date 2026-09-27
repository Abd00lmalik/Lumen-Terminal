/**
 * Phase F storage watchdog: READ-ONLY health classification over observed storage facts.
 *
 * Laws (brief §8):
 * - Health checks never mutate anything; they only CLASSIFY facts provided by read-only
 *   probes (transport diagnosis, audit counts, save-outcome ring, backup status).
 * - Three honest states: HEALTHY / DEGRADED / UNAVAILABLE (never a fake-ok).
 * - Storage unavailable must NEVER be reported as "empty workspace" — absence of data is
 *   distinct from absence of storage (Phase E incident lesson, encoded here).
 * - No secrets, no token values, no user emails, no workspace content in the output.
 * - The watchdog NEVER deletes, compacts, migrates or overwrites anything (no auto-recovery).
 *
 * The decision logic is PURE: `classifyStorageHealth(facts)` maps facts → verdict, so the
 * classification (the part worth testing) has zero I/O. The endpoint wiring composes the
 * pure function with the same read-only probes Phase E already had.
 */

/** Facts observed by read-only probes; the watchdog classifies exactly these. */
export interface StorageFacts {
  /** Origin transport outcome (from diagnoseBlobTransport / equivalent probe). */
  readonly transport: "ok" | "absent" | "error";
  /** True when the blob store itself rejected the request (store missing/deleted). */
  readonly storeUnavailable?: boolean;
  /** True when a read returned content that failed to parse (corruption/truncation). */
  readonly unparseableContent?: boolean;
  /** True when a read of a PRESENT blob answered blank (Phase E incident 3). */
  readonly blankContent?: boolean;
  /** Snapshot byte size when readable (undefined when absent/error). */
  readonly snapshotBytes?: number;
  /** Snapshot bytes from the previous watchdog sample (growth-rate input). */
  readonly previousBytes?: number;
  /** Milliseconds between the two samples (growth-rate input). */
  readonly previousAgeMs?: number;
  /** Persisted run-record count when readable. */
  readonly recordCount?: number;
  /** Record count from the previous sample. */
  readonly previousRecordCount?: number;
  /** Save outcomes since the last sample (newest last). */
  readonly recentSaveOutcomes?: readonly ("ok" | "conflict" | "read-unavailable" | "io-timeout" | "error")[];
  /** Last backup verification result, when a backup schedule exists. */
  readonly backup?: {
    readonly lastSuccessAt?: string;
    readonly lastDrillAt?: string;
    readonly lastAttemptAt?: string;
    readonly staleAfterMs?: number;
  };
  /** Persisted snapshot schema version marker (undefined = pre-versioning legacy). */
  readonly schemaVersion?: number;
  /** Integrity hash from the last verified sample, if recorded. */
  readonly lastIntegrityHash?: string;
  readonly currentIntegrityHash?: string;
}

export type StorageHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export interface StorageFinding {
  readonly code: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
  readonly remediation: string;
}

export interface StorageVerdict {
  readonly health: StorageHealth;
  readonly findings: readonly StorageFinding[];
}

/** Platform ceiling awareness (Vercel Blob default request limits; documented, not tuned). */
const SOFT_SIZE_LIMIT_BYTES = 40 * 1024 * 1024;
const WARN_SIZE_LIMIT_BYTES = 20 * 1024 * 1024;

/** Pure classification: facts → verdict. No I/O, no side effects, fully unit-testable. */
export function classifyStorageHealth(facts: StorageFacts): StorageVerdict {
  const findings: StorageFinding[] = [];
  const push = (finding: StorageFinding): void => { findings.push(finding); };
  let health: StorageHealth = "HEALTHY";

  // 1. Transport / store availability — the hard gate.
  if (facts.transport === "error" || facts.storeUnavailable === true) {
    return {
      health: "UNAVAILABLE",
      findings: [
        {
          code: "STORE_UNAVAILABLE",
          severity: "critical",
          message: "The storage origin could not be read; workspace state is NOT confirmed empty.",
          remediation: "Do NOT restore or rewrite anything yet. Run GET /api/storage/diagnose (admin), check the Vercel dashboard Storage tab for the store binding, and follow docs/runbooks/blob-storage.md §8 (recovery) only with a verified recovery point.",
        },
        ...findings,
      ],
    };
  }

  if (facts.unparseableContent === true) {
    health = "UNAVAILABLE";
    push({
      code: "CONTENT_UNPARSEABLE",
      severity: "critical",
      message: "The snapshot body was readable but did not parse; the workspace is effectively unreadable.",
      remediation: "Treat as an unreadable snapshot: keep honest-abort in place (saves already refuse), take a byte copy of the raw object for forensics, then restore from the newest verified backup per docs/runbooks/backups-and-recovery.md.",
    });
  } else if (facts.blankContent === true) {
    health = "UNAVAILABLE";
    push({
      code: "CONTENT_BLANK",
      severity: "critical",
      message: "A present blob answered BLANK — the Phase E th_000011 failure mode.",
      remediation: "Saves are refusing to write (correct). Verify the store's health in the Vercel dashboard; if it persists, restore from the newest verified backup. Never let a save treat blank as 'absent'.",
    });
  }

  if (facts.transport === "absent") {
    // A genuinely ABSENT snapshot with a healthy store is an honest "no workspace yet".
    push({
      code: "SNAPSHOT_ABSENT",
      severity: "info",
      message: "No snapshot exists yet (fresh store or first write pending).",
      remediation: "No action needed for a new deployment. If this deployment previously had data, see STORE_UNAVAILABLE guidance before assuming the data is gone.",
    });
  }

  // 2. Save-path outcomes — repeated failures are degraded even when reads work.
  const outcomes = facts.recentSaveOutcomes ?? [];
  const saveFails = outcomes.filter((o) => o !== "ok").length;
  if (outcomes.length > 0 && saveFails === outcomes.length) {
    health = health === "HEALTHY" ? "DEGRADED" : health;
    push({
      code: "SAVES_FAILING",
      severity: "critical",
      message: `All ${outcomes.length} recent save attempts failed (${[...new Set(outcomes)].join(", ")}).`,
      remediation: "Check transport health and the Phase E honest-abort reasons (BlobReadUnavailableError). Do not disable honest abort; fix the read path first.",
    });
  } else if (saveFails > 0) {
    health = health === "HEALTHY" ? "DEGRADED" : health;
    push({
      code: "SAVE_FLAKY",
      severity: "warning",
      message: `${saveFails}/${outcomes.length} recent saves failed (conflicts/timeouts may be transient).`,
      remediation: "Watch for recurrence; sustained flakiness means check the store's latency/limits and the conditional-write conflict rate.",
    });
  }

  // 3. Size & growth — approaching platform payload/runtime limits.
  const bytes = facts.snapshotBytes;
  if (bytes !== undefined) {
    if (bytes > SOFT_SIZE_LIMIT_BYTES) {
      health = health === "HEALTHY" ? "DEGRADED" : health;
      push({
        code: "SIZE_LIMIT_RISK",
        severity: "warning",
        message: `Snapshot is ${bytes} bytes (>${SOFT_SIZE_LIMIT_BYTES} soft limit); request limits may start failing writes.`,
        remediation: "Run the compaction dry-run (admin) and review the storage architecture per the Phase F plan; do NOT delete history.",
      });
    } else if (bytes > WARN_SIZE_LIMIT_BYTES) {
      push({
        code: "SIZE_WATCH",
        severity: "info",
        message: `Snapshot is ${bytes} bytes; approaching the soft limit.`,
        remediation: "Keep an eye on growth; consider compaction review in the next maintenance window.",
      });
    }
    if (facts.previousBytes !== undefined && facts.previousAgeMs !== undefined && facts.previousAgeMs > 0) {
      const growth = bytes - facts.previousBytes;
      if (growth > 0 && growth / bytes > 0.5 && facts.previousAgeMs < 3600_000) {
        health = health === "HEALTHY" ? "DEGRADED" : health;
        push({
          code: "GROWTH_SPIKE",
          severity: "warning",
          message: `Snapshot grew ${(100 * growth / bytes).toFixed(0)}% in ${(facts.previousAgeMs / 60_000).toFixed(0)} minutes.`,
          remediation: "Look for a runaway write loop or a merge duplication bug before it hits limits; audit /api/storage/audit (admin) for unexpected counts.",
        });
      }
    }
  }

  // 4. Record-count integrity — shrinkage of a countable collection is data loss.
  if (facts.recordCount !== undefined && facts.previousRecordCount !== undefined
    && facts.recordCount < facts.previousRecordCount) {
    health = "UNAVAILABLE" === health ? health : "DEGRADED";
    push({
      code: "RECORD_COUNT_DROPPED",
      severity: "critical",
      message: `Run-record count fell from ${facts.previousRecordCount} to ${facts.recordCount}; collections must never shrink (no-eviction law).`,
      remediation: "STOP writes to this workspace (honest-abort already blocks most paths). Take a raw copy, then restore the newest verified backup; investigate which instance wrote last.",
    });
  }

  // 5. Backup freshness.
  const backup = facts.backup;
  if (backup !== undefined) {
    const staleAfter = backup.staleAfterMs ?? 26 * 3600_000; // daily + slack
    if (backup.lastAttemptAt !== undefined && backup.lastSuccessAt === undefined) {
      health = health === "HEALTHY" ? "DEGRADED" : health;
      push({
        code: "BACKUP_NEVER_SUCCEEDED",
        severity: "warning",
        message: "Backups have been attempted but none has succeeded yet.",
        remediation: "Check the backup job's credentials and destination (docs/runbooks/backups-and-recovery.md); verify a restore drill before relying on it.",
      });
    }
    if (backup.lastSuccessAt !== undefined) {
      const age = Date.now() - Date.parse(backup.lastSuccessAt);
      if (Number.isFinite(age) && age > staleAfter) {
        health = health === "HEALTHY" ? "DEGRADED" : health;
        push({
          code: "BACKUP_STALE",
          severity: "warning",
          message: `Last verified backup is ${(age / 3600_000).toFixed(1)}h old (limit ${(staleAfter / 3600_000).toFixed(0)}h).`,
          remediation: "Run the backup job manually, then verify; check the scheduler (Vercel Cron or external) is actually firing.",
        });
      }
    }
    if (backup.lastDrillAt === undefined) {
      push({
        code: "BACKUP_DRILL_MISSING",
        severity: "info",
        message: "No restore drill has been recorded; an unverified backup is not yet proven recovery.",
        remediation: "Run the non-destructive restore drill (docs/runbooks/backups-and-recovery.md) and record its result.",
      });
    }
  }

  // 6. Schema version & integrity hash mismatch.
  if (facts.schemaVersion !== undefined && facts.schemaVersion !== 2) {
    health = health === "HEALTHY" ? "DEGRADED" : health;
    push({
      code: "SCHEMA_UNEXPECTED",
      severity: "warning",
      message: `Unexpected snapshot schema version ${facts.schemaVersion} (expected 2).`,
      remediation: "A migration may have partially applied. Compare against the migration checklist in docs/runbooks/blob-storage.md before further writes.",
    });
  }
  if (facts.lastIntegrityHash !== undefined && facts.currentIntegrityHash !== undefined
    && facts.lastIntegrityHash !== facts.currentIntegrityHash && facts.recordCount === facts.previousRecordCount
    && facts.snapshotBytes === facts.previousBytes) {
    health = health === "HEALTHY" ? "DEGRADED" : health;
    push({
      code: "HASH_MISMATCH",
      severity: "warning",
      message: "Integrity hash changed while size and record counts did not.",
      remediation: "Unexpected byte-level mutation: take a forensic copy and audit which instance wrote last (see the concurrent-instance verification steps).",
    });
  }

  return { health, findings };
}

/** Persisted watchdog sample (for growth/count deltas between runs). */
export interface WatchdogSample {
  readonly at: string;
  readonly snapshotBytes?: number;
  readonly recordCount?: number;
  readonly integrityHash?: string;
}
