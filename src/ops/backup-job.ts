/**
 * Phase F backup job + restore drill, shared by the cron entrypoint and the admin routes.
 *
 * The restore drill is strictly NON-DESTRUCTIVE: it copies a chosen backup into an
 * isolated verification path (drill-restore/…), validates envelope + integrity + parse +
 * invariants, reports the comparison — and never writes any workspace path.
 */
import { get, put, head } from "@vercel/blob";
import { OffsiteBackuper, readBackupEnv, sha256Hex, type BackupResult } from "./offsite-backup.js";

/**
 * Dangling-reference verdict for the restore drill: the drill's job is proving the BACKUP
 * is FAITHFUL to its source, not that the source itself was historically pristine.
 * - clean: no dangling references anywhere.
 * - faithful-with-condition: the source already had exactly these dangling references
 *   (recorded in the envelope at backup time); the restore preserves them — a PRE-EXISTING
 *   data condition (e.g. the documented rs_000251 zombie), reported visibly, never deleted.
 * - corrupted: the backup has MORE dangling references than its source → the backup or
 *   the restore introduced damage → the drill MUST fail.
 */
export function classifyDanglingRefs(dangling: number, sourceDangling: number | undefined): "clean" | "faithful-with-condition" | "corrupted" {
  if (dangling === 0) return "clean";
  if (sourceDangling !== undefined && dangling === sourceDangling) return "faithful-with-condition";
  return "corrupted";
}

/** Count run records whose researchId does not resolve (same rule the drill applies). */
export function countDanglingRunRecords(snapshot: Record<string, unknown>): number {
  const researchIds = new Set(
    ((Array.isArray(snapshot.researches) ? snapshot.researches : []) as Array<{ id?: string }>)
      .map((r) => r.id)
      .filter((id): id is string => id !== undefined),
  );
  let dangling = 0;
  for (const rec of (Array.isArray(snapshot.researchResponses) ? snapshot.researchResponses : []) as Array<{ researchId?: string }>) {
    if (rec.researchId === undefined || !researchIds.has(rec.researchId)) dangling += 1;
  }
  return dangling;
}

const STATUS_PATH = "ops/backup-status.json";
const DRILL_PATH_PREFIX = "ops/drill-restore/";

export async function readBackupStatus(): Promise<unknown> {
  try {
    const blob = await get(STATUS_PATH, { access: "public", useCache: false });
    if (blob === null || blob.stream === null) return { configured: readBackupEnv() !== undefined };
    const reader = blob.stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    return { ...(JSON.parse(text) as object), configured: readBackupEnv() !== undefined };
  } catch {
    return { configured: readBackupEnv() !== undefined };
  }
}

async function writeStatus(status: object): Promise<void> {
  await put(STATUS_PATH, JSON.stringify(status), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
}

/** Read a blob fully to text (origin-fresh), returning undefined when absent. */
async function readBlobText(pathname: string): Promise<string | undefined> {
  try {
    const blob = await get(pathname, { access: "public", useCache: false });
    if (blob === null || blob.stream === null) return undefined;
    const reader = blob.stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    return text;
  } catch {
    return undefined;
  }
}

/** Back up the legacy workspace + every per-user workspace to the offsite destination. */
export async function runOffsiteBackup(): Promise<{ ok: boolean; backed: number; failed: number; skipped: number; detail: BackupResult[]; note?: string }> {
  const env = readBackupEnv();
  if (env === undefined) {
    return { ok: false, backed: 0, failed: 0, skipped: 0, detail: [], note: "offsite backup not configured (BACKUP_R2_* env missing)" };
  }
  const backuper = new OffsiteBackuper(env);
  const detail: BackupResult[] = [];
  let backed = 0, failed = 0, skipped = 0;
  const targets: Array<{ id: string; path: string }> = [{ id: "_legacy", path: "workspace/snapshot.json" }];
  try {
    const { list } = await import("@vercel/blob");
    const blobs = await list({ prefix: "workspaces/" });
    for (const b of blobs.blobs) {
      if (!b.pathname.endsWith("/snapshot.json")) continue;
      const uid = b.pathname.split("/")[1] ?? "";
      if (uid !== "") targets.push({ id: uid, path: b.pathname });
    }
  } catch { void 0; }

  for (const target of targets) {
    const text = await readBlobText(target.path);
    if (text === undefined) { skipped += 1; continue; }
    try {
      JSON.parse(text); // partial-content law: an unparseable source is never uploaded
    } catch {
      failed += 1;
      detail.push({ ok: false, at: new Date().toISOString(), error: "source unparseable — not backed up", workspaceId: target.id });
      continue;
    }
    // Record the source's own integrity in the envelope so the drill can distinguish a
    // faithful restore of imperfect source data from restore-introduced corruption.
    let sourceIntegrity: { danglingRunRecords: number } | undefined;
    try { sourceIntegrity = { danglingRunRecords: countDanglingRunRecords(JSON.parse(text) as Record<string, unknown>) }; } catch { void 0; }
    const result = await backuper.backupSnapshot(target.id, text, 2, sourceIntegrity);
    detail.push(result);
    if (result.ok) backed += 1; else failed += 1;
  }
  for (const target of targets) {
    try { await backuper.prune(target.id); } catch { void 0; }
  }
  const status = await readBackupStatus() as { lastDrillAt?: string };
  await writeStatus({
    ...(backed > 0 ? { lastSuccessAt: new Date().toISOString() } : {}),
    lastAttemptAt: new Date().toISOString(),
    ...(status.lastDrillAt !== undefined ? { lastDrillAt: status.lastDrillAt } : {}),
  });
  return { ok: failed === 0 && backed > 0, backed, failed, skipped, detail };
}

/** Invariants checked by the drill (mirrors what recovery would rely on). */
export interface DrillReport {
  ok: boolean;
  backupKey: string;
  checks: Array<{ check: string; ok: boolean; detail?: string }>;
  counts?: { researches?: number; runRecords?: number; theses?: number; savedArtifacts?: number; tombstones?: number };
  at: string;
  drillRestorePath?: string;
  bytes?: number;
}

export async function runRestoreDrill(backupKey: string): Promise<DrillReport> {
  const at = new Date().toISOString();
  const checks: DrillReport["checks"] = [];
  const env = readBackupEnv();
  if (env === undefined) {
    return { ok: false, backupKey, at, checks: [{ check: "backup-configured", ok: false, detail: "BACKUP_R2_* env missing" }] };
  }
  const backuper = new OffsiteBackuper(env);

  // 1. Fetch the chosen backup from the offsite destination.
  const url = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${backupKey}`;
  let fetched: string | undefined;
  try {
    const client = (backuper as unknown as { client: { fetch: (u: string, i?: RequestInit) => Promise<Response> } }).client;
    const res = await client.fetch(url, { method: "GET" });
    if (!res.ok) {
      return { ok: false, backupKey, at, checks: [{ check: "backup-fetch", ok: false, detail: `HTTP ${res.status}` }] };
    }
    fetched = await res.text();
  } catch (err) {
    return { ok: false, backupKey, at, checks: [{ check: "backup-fetch", ok: false, detail: err instanceof Error ? err.message : String(err) }] };
  }
  checks.push({ check: "backup-fetch", ok: fetched !== undefined });

  // 2. Envelope + integrity.
  let envelope: { sha256?: string; bytes?: number; workspaceId?: string; schemaVersion?: number; snapshot?: unknown; sourceIntegrity?: { danglingRunRecords?: number } };
  try {
    envelope = JSON.parse(fetched ?? "{}");
  } catch {
    return { ok: false, backupKey, at, checks: [...checks, { check: "envelope-parse", ok: false }] };
  }
  checks.push({ check: "envelope-parse", ok: true });
  const hash = await sha256Hex(JSON.stringify(envelope.snapshot));
  checks.push({ check: "integrity-hash", ok: envelope.sha256 === hash, ...(envelope.sha256 === hash ? {} : { detail: `expected ${envelope.sha256}, recomputed ${hash}` }) });

  // 3. Parse the snapshot itself and compare invariants.
  let snapshot: Record<string, unknown> | undefined;
  try {
    snapshot = envelope.snapshot as Record<string, unknown>;
    if (snapshot === null || typeof snapshot !== "object") throw new Error("not an object");
  } catch {
    return { ok: false, backupKey, at, checks: [...checks, { check: "snapshot-parse", ok: false }] };
  }
  checks.push({ check: "snapshot-parse", ok: true });

  const counts = {
    researches: Array.isArray(snapshot.researches) ? snapshot.researches.length : 0,
    runRecords: Array.isArray(snapshot.researchResponses) ? snapshot.researchResponses.length : 0,
    theses: Array.isArray(snapshot.theses) ? snapshot.theses.length : 0,
    savedArtifacts: Array.isArray(snapshot.savedArtifacts) ? snapshot.savedArtifacts.length : 0,
    tombstones: Array.isArray(snapshot.savedTombstones) ? snapshot.savedTombstones.length : 0,
  };
  const countsOk = counts.researches > 0 || counts.runRecords > 0 || counts.theses > 0 || counts.savedArtifacts > 0;
  checks.push({ check: "non-empty-collections", ok: countsOk, detail: JSON.stringify(counts) });

  // Graph integrity: every run record must reference an existing research id — now
  // judged against the SOURCE's own recorded condition (see classifyDanglingRefs).
  const dangling = countDanglingRunRecords(snapshot);
  const sourceDangling = typeof envelope.sourceIntegrity?.danglingRunRecords === "number" ? envelope.sourceIntegrity.danglingRunRecords : undefined;
  const danglingVerdict = classifyDanglingRefs(dangling, sourceDangling);
  checks.push({
    check: "run-record-references",
    ok: danglingVerdict !== "corrupted",
    ...(danglingVerdict === "clean" ? {}
      : danglingVerdict === "faithful-with-condition"
        ? { detail: `${dangling} dangling run record(s) pre-existing in the SOURCE (envelope-recorded); restore is faithful — condition is visible in the legacy inventory, never repaired silently` }
        : { detail: `${dangling} dangling run records vs ${sourceDangling ?? "unknown"} in source — backup/restore introduced corruption` }),
  });

  // 4. Restore into an ISOLATED verification path (never a workspace path).
  const drillPath = `${DRILL_PATH_PREFIX}${backupKey.replaceAll("/", "_")}`;
  try {
    await put(drillPath, fetched ?? "", {
      access: "public", addRandomSuffix: false, allowOverwrite: true,
      contentType: "application/json", cacheControlMaxAge: 60,
    });
    const meta = await head(drillPath);
    // Byte-level comparison: head().size is UTF-8 BYTES while string .length is CHARS —
    // they differ whenever the snapshot contains non-ASCII (they did; first real drill
    // failed here despite a byte-faithful write).
    checks.push({ check: "isolated-restore-write", ok: meta.size === Buffer.byteLength(fetched ?? "", "utf8") });
  } catch (err) {
    checks.push({ check: "isolated-restore-write", ok: false, detail: err instanceof Error ? err.message : String(err) });
  }

  const ok = checks.every((c) => c.ok);
  if (ok) {
    // Record the drill (watchdog reads lastDrillAt).
    const status = await readBackupStatus() as { lastSuccessAt?: string; lastAttemptAt?: string };
    await writeStatus({ ...(status as object), lastDrillAt: at });
  }
  return {
    ok,
    backupKey,
    at,
    checks,
    counts,
    drillRestorePath: drillPath,
    ...(fetched !== undefined ? { bytes: fetched.length } : {}),
  };
}
