/**
 * Phase F watchdog endpoint wiring: compose READ-ONLY probes with the pure classifier.
 * Admin-gated by the caller (routes.ts) like every storage tool. Never mutates storage.
 */
import { classifyStorageHealth, type StorageFacts, type WatchdogSample } from "./storage-watchdog.js";
import { diagnoseBlobTransport } from "../persistence/vercel-edge.js";
import type { ResearchApp } from "../api/research-app.js";

/**
 * Sample ring for deltas (growth rate, record-count drops, hash continuity). Persisted in
 * the OPS blob — a SEPARATE object from any workspace snapshot, so watchdog bookkeeping
 * can never touch workspace state. Bounded (last 8 samples).
 */
const OPS_SAMPLE_PATH = "ops/watchdog-samples.json";
const MAX_SAMPLES = 8;

async function readOpsSamples(): Promise<WatchdogSample[]> {
  try {
    const { get } = await import("@vercel/blob");
    const blob = await get(OPS_SAMPLE_PATH, { access: "public", useCache: false });
    if (blob === null || blob.stream === null) return [];
    const reader = blob.stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as WatchdogSample[]).slice(-MAX_SAMPLES) : [];
  } catch {
    return []; // no samples yet (or transient read hiccup): deltas are simply unavailable
  }
}

/** Best-effort sample persistence; a failed sample write degrades deltas, never health. */
async function appendOpsSample(sample: WatchdogSample): Promise<void> {
  try {
    const { put } = await import("@vercel/blob");
    const samples = [...(await readOpsSamples()), sample].slice(-MAX_SAMPLES);
    await put(OPS_SAMPLE_PATH, JSON.stringify(samples), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
  } catch {
    // Watchdog bookkeeping must never create a new failure mode; drop the sample.
  }
}

/** FNV-1a over the raw body: a cheap, dependency-free continuity hash (not cryptographic;
 *  its job is detecting UNEXPECTED byte drift between samples, not defending against
 *  adversaries — tampering detection is the backup chain's job). */
function continuityHash(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export async function storageWatchdogReport(app: ResearchApp): Promise<unknown> {
  const diagnosis = await diagnoseBlobTransport();
  const transport: StorageFacts["transport"] =
    diagnosis.read.startsWith("ok") ? "ok"
      : diagnosis.read.startsWith("absent") ? "absent"
        : "error";
  const storeUnavailable = /store does not exist|no blob credentials/i.test(diagnosis.head + diagnosis.read);

  // Read-only audit facts (counts) — never mutates; absent snapshot => no counts.
  let snapshotBytes: number | undefined;
  let recordCount: number | undefined;
  let unparseableContent = false;
  let currentIntegrityHash: string | undefined;
  if (transport === "ok") {
    try {
      const audit = app.storageAudit() as { totalBytes?: number; runRecords?: { count?: number } };
      snapshotBytes = audit.totalBytes;
      recordCount = audit.runRecords?.count;
    } catch {
      // storageAudit throws NOT_FOUND on an absent snapshot; the transport probe already
      // distinguishes absence, so leave counts undefined here.
      void 0;
    }
  }

  // Continuity hash needs the raw body; reuse the diagnostic byte count + a fresh small GET.
  // (One extra bounded GET per watchdog run; reads stay origin-fresh and cheap relative to
  // the snapshot size because the transport probe already streamed the body once.)
  if (transport === "ok") {
    try {
      const { get } = await import("@vercel/blob");
      const blob = await get("workspace/snapshot.json", { access: "public", useCache: false });
      if (blob !== null && blob.stream !== null) {
        const reader = blob.stream.getReader();
        const decoder = new TextDecoder();
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        try { void JSON.parse(text); } catch { unparseableContent = true; }
        currentIntegrityHash = continuityHash(text);
        snapshotBytes = snapshotBytes ?? text.length;
      }
    } catch {
      void 0; // the transport probe already reported the error shape
    }
  }

  const samples = await readOpsSamples();
  const last = samples[samples.length - 1];
  const now = new Date().toISOString();

  const backupRaw = process.env.BACKUP_STATUS_URL;
  let backup: StorageFacts["backup"];
  if (backupRaw !== undefined && backupRaw !== "") {
    try {
      const res = await fetch(backupRaw, { signal: AbortSignal.timeout(5000) });
      if (res.ok) backup = (await res.json()) as StorageFacts["backup"];
    } catch {
      // Backup status is optional context; its unavailability is not storage unhealth.
      void 0;
    }
  }

  const facts: StorageFacts = {
    transport,
    ...(storeUnavailable ? { storeUnavailable: true } : {}),
    ...(unparseableContent ? { unparseableContent: true } : {}),
    ...(snapshotBytes !== undefined ? { snapshotBytes } : {}),
    ...(last?.snapshotBytes !== undefined ? { previousBytes: last.snapshotBytes } : {}),
    ...(last?.at !== undefined ? { previousAgeMs: Date.now() - Date.parse(last.at) } : {}),
    ...(recordCount !== undefined ? { recordCount } : {}),
    ...(last?.recordCount !== undefined ? { previousRecordCount: last.recordCount } : {}),
    ...(backup !== undefined ? { backup } : {}),
    schemaVersion: 2,
    ...(last?.integrityHash !== undefined ? { lastIntegrityHash: last.integrityHash } : {}),
    ...(currentIntegrityHash !== undefined ? { currentIntegrityHash } : {}),
  };

  const verdict = classifyStorageHealth(facts);

  // Record THIS sample (best-effort) so the NEXT run can compute deltas.
  if (snapshotBytes !== undefined || recordCount !== undefined) {
    await appendOpsSample({
      at: now,
      ...(snapshotBytes !== undefined ? { snapshotBytes } : {}),
      ...(recordCount !== undefined ? { recordCount } : {}),
      ...(currentIntegrityHash !== undefined ? { integrityHash: currentIntegrityHash } : {}),
    });
  }

  return { at: now, ...verdict, facts: { transport, snapshotBytes, recordCount, ...(backup !== undefined ? { backup } : {}) } };
}
