/**
 * VercelBlobStore; WorkspaceStore over Vercel Blob (@vercel/blob).
 *
 * Purpose: production research history used to live ONLY in a per-instance MemoryStore, so
 * a cold start (or the user's own refresh hitting a different instance) silently dropped
 * every completed research run. This store persists the workspace snapshot to Vercel Blob
 * (server-side only; requires the BLOB_READ_WRITE_TOKEN that the Vercel runtime injects
 * automatically when Blob is enabled for the project), keeping research history durable
 * across instances while staying behind the SAME WorkspaceStore interface (no domain
 * changes; lock §14: the object model is respected, the workspace is never flattened).
 *
 * Access mode: Vercel Blob stores are configured public OR private at the store level, and
 * the SDK rejects a mismatched `access` ("Cannot use public access on a private store").
 * The store type is not discoverable from the token, so the mode is AUTO-DETECTED: private
 * is preferred (research state should not be publicly URL-readable); on an access-mismatch
 * error the other mode is used and remembered for the lifetime of this instance.
 *
 * MULTI-INSTANCE WRITES (audit B5): save() is merge-before-write, but a merge alone is a
 * lost-update race — two warm instances can both read the same blob, merge, and then write
 * in an order that drops one side's runs (observed live: history shrank between reads).
 * Vercel Blob supports conditional writes via ETags, so the write is now CONDITIONAL on the
 * ETag we merged from: if another instance wrote in between, Blob rejects the write with a
 * precondition failure, we re-read the winner's state, merge again and retry (bounded). A
 * first write against a missing blob is create-only, so two instances racing to create it
 * resolve the same way instead of one silently erasing the other.
 *
 * THE CLIENT IS INJECTABLE (BlobClient): the optimistic-concurrency logic is exercised by
 * tests against an in-memory blob that enforces the same ETag semantics, without network.
 *
 * Failure semantics: a failed save must never claim persistence succeeded (the caller's
 * save path surfaces the error); a missing/unreadable blob is "no workspace yet", not a
 * crash; one failed save must not poison the queue for subsequent saves; a read hiccup
 * degrades to an unconditional write so our own state is never lost. The dependency is
 * imported lazily so local dev without the package still works.
 */
import type { WorkspaceStore } from "./index.js";
import { Workspace, type WorkspaceSnapshot } from "../domain/workspace.js";
import { mergeSnapshots } from "../domain/merge.js";

const BLOB_PATH = "workspace/snapshot.json";

type BlobAccess = "public" | "private";

/** How long a loaded snapshot may serve reads before a fresh blob GET is required. */
const LOAD_TTL_MS = 3_000;

/** Bounded optimistic-concurrency retries before a genuine persistence failure surfaces. */
const MAX_WRITE_ATTEMPTS = 3;

/** Conditional-write options; `ifMatch` (existing blob) or `createOnly` (first write). */
export interface BlobWriteGuard {
  readonly ifMatch?: string;
  readonly createOnly?: boolean;
}

/**
 * The minimal Blob transport this store needs. Injectable so the store's merge + ETag
 * concurrency behavior is testable without network access; the default implementation is
 * the real @vercel/blob SDK (lazily imported).
 */
export interface BlobClient {
  /** Current content + ETag, or undefined when the blob does not exist. */
  read(pathname: string, access: BlobAccess): Promise<{ body: string; etag: string } | undefined>;
  /** Write the blob; the guard makes the write fail when the blob changed since we read it. */
  write(pathname: string, body: string, access: BlobAccess, guard?: BlobWriteGuard): Promise<void>;
}

/** The real @vercel/blob transport (lazy import keeps local dev without the package working). */
export function vercelBlobClient(): BlobClient {
  return {
    async read(pathname, access) {
      const { get } = await import("@vercel/blob");
      const blob = await get(pathname, { access });
      if (blob === null || blob.stream === null) return undefined;
      // GetBlobResult exposes the body as a Web ReadableStream; collect it to a string.
      const chunks: string[] = [];
      const reader = blob.stream.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return { body: chunks.join(""), etag: blob.blob.etag };
    },
    async write(pathname, body, access, guard) {
      const { put } = await import("@vercel/blob");
      await put(pathname, body, {
        access,
        contentType: "application/json",
        addRandomSuffix: false,
        // createOnly: fail when the blob appeared since our read (first-write race).
        // ifMatch: fail when the blob changed since our read (lost-update race).
        // Otherwise: plain overwrite (the deliberately degraded path after a read hiccup).
        allowOverwrite: guard?.createOnly !== true,
        ...(guard?.ifMatch !== undefined ? { ifMatch: guard.ifMatch } : {}),
      });
    },
  };
}

/** The SDK's store-level access-mismatch error; the only signal we auto-flip on. */
function isAccessMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /public access on a private store|private access on a public store/i.test(message);
}

/**
 * A conditional write that lost the race: the SDK throws BlobPreconditionFailedError
 * ("Precondition failed: ETag mismatch."), and a create-only write against a blob that
 * appeared in the meantime is rejected by the API. Either way the correct response is to
 * re-read, re-merge and retry — never to overwrite.
 */
function isWriteConflict(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "BlobPreconditionFailedError"
    || /precondition|etag mismatch/i.test(message)
    || /already exists/i.test(message);
}

export class VercelBlobStore implements WorkspaceStore {
  private cache?: WorkspaceSnapshot;
  /** When the cache was written (load or save); older than LOAD_TTL_MS = re-fetch. */
  private cacheAt = 0;
  /** In-process serialization: concurrent saves must not interleave read/merge/write. */
  private queue: Promise<void> = Promise.resolve();
  /** Access mode of the connected store; auto-detected on first use (private preferred). */
  private access?: BlobAccess;

  constructor(private readonly client: BlobClient = vercelBlobClient()) {}

  /** Run a blob operation with the detected (or detected-then-flipped) access mode. */
  private async withDetectedAccess(operate: (access: BlobAccess) => Promise<void>): Promise<void> {
    const first = this.access ?? "private";
    try {
      await operate(first);
      this.access = first;
    } catch (error) {
      if (!isAccessMismatch(error)) throw error;
      const second: BlobAccess = first === "private" ? "public" : "private";
      await operate(second);
      this.access = second;
    }
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    // Serialize in-process saves; a rejected predecessor is contained so one failed save
    // cannot silently skip every subsequent save.
    this.queue = this.queue.catch(() => {}).then(async () => {
      let attempt = 0;
      for (;;) {
        // MERGE-BEFORE-WRITE (multi-instance law): re-read the blob's CURRENT state and
        // union it with ours. A stale warm instance must never erase runs another instance
        // completed while it was idle. A failed re-read (transient) degrades to an
        // unconditional write: our own state is never lost to a read hiccup.
        let remote: { body: string; etag: string } | undefined;
        try {
          remote = await this.readRawWithEtag();
        } catch {
          remote = undefined;
        }
        let merged = snapshot;
        if (remote !== undefined) {
          try {
            merged = mergeSnapshots(snapshot, JSON.parse(remote.body) as WorkspaceSnapshot);
          } catch {
            merged = snapshot; // unparseable remote: our state wins (never lose our own runs)
          }
        }
        const body = JSON.stringify(merged);
        const guard: BlobWriteGuard | undefined =
          remote !== undefined ? { ifMatch: remote.etag } : { createOnly: true };
        try {
          await this.withDetectedAccess(async (access) => {
            await this.client.write(BLOB_PATH, body, access, guard);
          });
          this.cache = merged;
          this.cacheAt = Date.now(); // our own write is by definition current
          return;
        } catch (error) {
          // Lost the race: re-read the winner's state, merge again, retry (bounded).
          attempt += 1;
          if (!isWriteConflict(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
        }
      }
    });
    await this.queue;
  }

  async load(): Promise<Workspace | undefined> {
    // TTL re-read (cross-instance staleness law): another serverless instance may have
    // advanced the blob between our requests. Serving our own cache forever used to pin
    // a stale graph for the instance's whole lifetime — a stale instance then answered
    // history reads with bare summaries AND overwrote the blob, erasing the other
    // instance's runs. Within the TTL window the cache serves (cheap, coherent).
    if (this.cache !== undefined && Date.now() - this.cacheAt < LOAD_TTL_MS) {
      return Workspace.fromSnapshot(this.cache);
    }
    let raw: string | undefined;
    try {
      raw = (await this.readRawWithEtag())?.body;
    } catch {
      raw = undefined;
    }
    if (raw === undefined) return this.cache !== undefined ? Workspace.fromSnapshot(this.cache) : undefined;
    try {
      this.cache = JSON.parse(raw) as WorkspaceSnapshot;
      this.cacheAt = Date.now();
      return Workspace.fromSnapshot(this.cache);
    } catch {
      // A corrupt snapshot is "no workspace yet", not a crash.
      return this.cache !== undefined ? Workspace.fromSnapshot(this.cache) : undefined;
    }
  }

  /**
   * Current blob content + ETag under the detected access mode. Returns undefined when the
   * blob is absent/empty; throws on a non-access transport failure (callers decide whether
   * to degrade). Access detection is recorded so later reads skip the probe.
   */
  private async readRawWithEtag(): Promise<{ body: string; etag: string } | undefined> {
    const read = async (access: BlobAccess): Promise<{ body: string; etag: string } | undefined> => {
      const found = await this.client.read(BLOB_PATH, access);
      if (found === undefined || found.body.trim() === "") return undefined;
      return found;
    };
    if (this.access !== undefined) return await read(this.access);
    let result: { body: string; etag: string } | undefined;
    await this.withDetectedAccess(async (access) => {
      result = await read(access);
    });
    return result;
  }
}
