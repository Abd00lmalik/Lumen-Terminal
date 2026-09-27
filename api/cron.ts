/**
 * Vercel Cron entrypoint (Phase F): scheduled storage watchdog + offsite backup.
 *
 * Configured in vercel.json (daily, inside every plan's limits). The handler:
 * 1. runs the watchdog classification for the legacy workspace (read-only),
 * 2. backs up every workspace snapshot found under workspaces/ (parse-verified source
 *    only) to the offsite bucket, then prunes to retention,
 * 3. appends a status object the watchdog reads (BACKUP_STATUS_URL contract).
 *
 * AUTH: Vercel Cron sends the `Authorization: Bearer ${CRON_SECRET}` header when
 * CRON_SECRET is set; the handler rejects anything else. Never a public endpoint.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { list, get } from "@vercel/blob";
import { OffsiteBackuper, readBackupEnv, type BackupStatus } from "../src/ops/offsite-backup.js";
import { storageWatchdogReport } from "../src/ops/storage-watchdog-endpoint.js";
import { LEGACY_BLOB_PATH } from "../src/persistence/vercel-edge.js";

const STATUS_PATH = "ops/backup-status.json";

async function readStatus(): Promise<BackupStatus> {
  try {
    const blob = await get(STATUS_PATH, { access: "public", useCache: false });
    if (blob === null || blob.stream === null) return {};
    const reader = blob.stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    return JSON.parse(text) as BackupStatus;
  } catch { return {}; }
}

async function writeStatus(status: BackupStatus): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(STATUS_PATH, JSON.stringify(status), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
}

/** A minimal headless app for the watchdog probe (no research routes are invoked). */
async function watchdogProbe(): Promise<unknown> {
  // The watchdog endpoint needs a ResearchApp for counts; construct through the same
  // production wiring the API uses (open mode: one legacy workspace + diagnostics).
  const { buildApi } = await import("../src/api/server.js");
  const { GeminiProvider } = await import("../src/model/gemini.js");
  const { createBitgetAdapterSet } = await import("../src/adapters/bitget-skills.js");
  const { createProductionStore } = await import("./research.js");
  const { registry, bindWorkspace } = createBitgetAdapterSet();
  const { researchApp } = await buildApi({
    provider: new GeminiProvider({ deferCredentialCheck: true }),
    registry,
    store: createProductionStore(),
    bindWorkspaceAccessor: bindWorkspace,
  });
  try {
    return await storageWatchdogReport(researchApp);
  } catch (err) {
    return { health: "UNAVAILABLE", error: err instanceof Error ? err.message : String(err) };
  }
}

async function runBackup(): Promise<{ backed: number; failed: number; skipped: number; detail: unknown[] }> {
  const backupEnv = readBackupEnv();
  if (backupEnv === undefined) return { backed: 0, failed: 0, skipped: 1, detail: [{ note: "backup env not configured" }] };
  const backuper = new OffsiteBackuper(backupEnv);
  const detail: unknown[] = [];
  let backed = 0, failed = 0, skipped = 0;

  // Legacy workspace (quarantine) — backed up like any other snapshot, never modified.
  const targets: Array<{ id: string; path: string }> = [{ id: "_legacy", path: LEGACY_BLOB_PATH }];
  try {
    const blobs = await list({ prefix: "workspaces/" });
    for (const b of blobs.blobs) {
      if (!b.pathname.endsWith("/snapshot.json")) continue;
      const uid = b.pathname.split("/")[1] ?? "";
      if (uid !== "") targets.push({ id: uid, path: b.pathname });
    }
  } catch { detail.push({ note: "workspace listing failed; legacy-only backup" }); }

  for (const target of targets) {
    try {
      const blob = await get(target.path, { access: "public", useCache: false });
      if (blob === null || blob.stream === null) { skipped += 1; continue; }
      const reader = blob.stream.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
      try { JSON.parse(text); } catch { failed += 1; detail.push({ workspaceId: target.id, error: "source unparseable — NOT backed up (partial-content law)" }); continue; }
      const result = await backuper.backupSnapshot(target.id, text, 2);
      if (result.ok) backed += 1; else failed += 1;
      detail.push(result);
    } catch (err) {
      failed += 1;
      detail.push({ workspaceId: target.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Retention prune per workspace (legacy included).
  for (const target of targets) {
    try { await backuper.prune(target.id); } catch { void 0; }
  }
  return { backed, failed, skipped, detail };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CRON SECRET gate (Vercel injects `Authorization: Bearer ${CRON_SECRET}` when set).
  const secret = process.env.CRON_SECRET;
  if (secret !== undefined && secret !== "") {
    const header = req.headers.authorization;
    if (header !== `Bearer ${secret}`) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Cron authentication failed." } });
      return;
    }
  }
  const status = await readStatus();
  try {
    const watchdog = await watchdogProbe();
    const backup = await runBackup();
    const next: BackupStatus = {
      ...(backup.backed > 0 ? { lastSuccessAt: new Date().toISOString() } : {}),
      lastAttemptAt: new Date().toISOString(),
      ...(status.lastDrillAt !== undefined ? { lastDrillAt: status.lastDrillAt } : {}),
    };
    await writeStatus(next);
    void watchdog;
    res.status(200).json({ ok: true, backup: { backed: backup.backed, failed: backup.failed, skipped: backup.skipped } });
  } catch (err) {
    await writeStatus({ ...status, lastAttemptAt: new Date().toISOString() });
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
