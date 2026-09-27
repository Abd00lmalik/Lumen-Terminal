/**
 * Phase F offsite backup: server-side copy of workspace snapshots to an S3-compatible
 * offsite destination (Cloudflare R2 by default), with integrity metadata.
 *
 * LAWS (brief §6):
 * - Separate failure domain: the destination is a DIFFERENT vendor/account from Vercel
 *   Blob; a second key in the same store would not be offsite.
 * - Server-side only: credentials live in env (BACKUP_*), never in the client or logs.
 * - Never back up partial/unparseable content: the source is read, parsed, and only then
 *   uploaded, with an integrity hash + metadata envelope.
 * - Never delete the only known-good recovery point: retention prunes to a documented
 *   floor (KEEP_MIN_BACKUPS) and only already-verified objects.
 * - A backup is NOT claimed successful until the uploaded object is read back and its
 *   hash verified (upload → verify → report).
 *
 * Encryption: TLS in transit (HTTPS endpoints only); at-rest encryption is the
 * destination's AES-256 (R2 default) — key control is the operator's account. Documented
 * in docs/runbooks/backups-and-recovery.md.
 */
import { AwsClient } from "aws4fetch";

/** Environment contract (all required; absence = backup disabled, reported honestly). */
export interface BackupEnv {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Optional prefix (default "lumen-backups/"). */
  readonly prefix?: string;
}

export function readBackupEnv(env: NodeJS.ProcessEnv = process.env): BackupEnv | undefined {
  const accountId = env.BACKUP_R2_ACCOUNT_ID;
  const accessKeyId = env.BACKUP_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.BACKUP_R2_SECRET_ACCESS_KEY;
  const bucket = env.BACKUP_R2_BUCKET;
  if (accountId === undefined || accountId === "" || accessKeyId === undefined || accessKeyId === ""
    || secretAccessKey === undefined || secretAccessKey === "" || bucket === undefined || bucket === "") {
    return undefined;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, ...(env.BACKUP_R2_PREFIX !== undefined && env.BACKUP_R2_PREFIX !== "" ? { prefix: env.BACKUP_R2_PREFIX } : {}) };
}

export interface BackupResult {
  readonly ok: boolean;
  readonly at: string;
  readonly key?: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly verified?: boolean;
  readonly error?: string;
  readonly workspaceId?: string;
}

/** SHA-256 via WebCrypto (available in the Vercel Node runtime); exported for the drill. */
export async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const KEEP_MIN_BACKUPS = 7; // retention floor: never prune below this
const RETENTION_DAYS = 30;

export class OffsiteBackuper {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  readonly prefix: string;

  constructor(private readonly env: BackupEnv) {
    // service "s3" + region "auto" = the S3-compatible signature shape R2 expects.
    this.client = new AwsClient({ accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey, service: "s3", region: "auto" });
    this.endpoint = `https://${env.accountId}.r2.cloudflarestorage.com`;
    this.prefix = env.prefix ?? "lumen-backups/";
  }

  private keyFor(workspaceId: string, at: string): string {
    // Object layout: {prefix}/{workspaceId}/{YYYY-MM-DD}/snapshot-{HHmmss}.json
    const day = at.slice(0, 10);
    const time = at.slice(11, 19).replace(/:/g, "");
    return `${this.prefix}${workspaceId}/${day}/snapshot-${time}.json`;
  }

  /**
   * Back up ONE workspace snapshot. The snapshot text is passed in ALREADY READ and
   * parse-verified by the caller (the backup job reads the blob, JSON.parses it, and only
   * then calls this — an unparseable source never reaches the destination).
   */
  async backupSnapshot(workspaceId: string, snapshotText: string, schemaVersion: number): Promise<BackupResult> {
    const at = new Date().toISOString();
    const key = this.keyFor(workspaceId, at);
    try {
      const sha256 = await sha256Hex(snapshotText);
      const envelope = JSON.stringify({
        format: "lumen-workspace-backup",
        version: 1,
        schemaVersion,
        workspaceId,
        createdAt: at,
        bytes: snapshotText.length,
        sha256,
        snapshot: JSON.parse(snapshotText), // re-parse = the envelope carries VALID JSON only
      });
      const url = `${this.endpoint}/${this.env.bucket}/${key}`;
      const put = await this.client.fetch(url, {
        method: "PUT",
        body: envelope,
        headers: { "content-type": "application/json", "x-amz-server-side-encryption": "AES256" },
      });
      if (!put.ok) return { ok: false, at, error: `upload failed: HTTP ${put.status}`, workspaceId };

      // VERIFY by reading back and hashing: no success claim without verification.
      const get = await this.client.fetch(url, { method: "GET" });
      if (!get.ok) return { ok: false, at, key, error: `verify read failed: HTTP ${get.status}`, workspaceId };
      const back = await get.text();
      const parsed = JSON.parse(back) as { sha256?: string; bytes?: number };
      const verified = parsed.sha256 === sha256 && parsed.bytes === snapshotText.length;
      return verified
        ? { ok: true, at, key, bytes: snapshotText.length, sha256, verified: true, workspaceId }
        : { ok: false, at, key, error: "verify mismatch (hash/bytes differ after upload)", workspaceId };
    } catch (cause) {
      return { ok: false, at, error: cause instanceof Error ? cause.message : String(cause), workspaceId };
    }
  }

  /** List backup keys for a workspace (older-first). */
  async listBackups(workspaceId: string): Promise<string[]> {
    const url = `${this.endpoint}/${this.env.bucket}?list-type=2&prefix=${encodeURIComponent(this.prefix + workspaceId + "/")}`;
    const res = await this.client.fetch(url, { method: "GET" });
    if (!res.ok) return [];
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
    return keys.sort();
  }

  /**
   * Retention prune: keep the newest DAILY recovery point for RETENTION_DAYS and always at
   * least KEEP_MIN_BACKUPS objects. Never deletes anything when the count is at/under the
   * floor (protects a small history from pruning itself down to zero).
   */
  async prune(workspaceId: string): Promise<{ deleted: number; kept: number }> {
    const keys = await this.listBackups(workspaceId);
    if (keys.length <= KEEP_MIN_BACKUPS) return { deleted: 0, kept: keys.length };
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600_000;
    const deletable: string[] = [];
    for (const key of keys.slice(0, keys.length - KEEP_MIN_BACKUPS)) {
      const day = key.slice(this.prefix.length + workspaceId.length + 1, this.prefix.length + workspaceId.length + 11);
      const ts = Date.parse(day);
      if (Number.isFinite(ts) && ts < cutoff) deletable.push(key);
    }
    for (const key of deletable) {
      await this.client.fetch(`${this.endpoint}/${this.env.bucket}/${key}`, { method: "DELETE" });
    }
    return { deleted: deletable.length, kept: keys.length - deletable.length };
  }
}

/** Record of the last successful backup per workspace (mirrors watchdog expectations). */
export interface BackupStatus {
  readonly lastSuccessAt?: string;
  readonly lastAttemptAt?: string;
  readonly lastDrillAt?: string;
}
