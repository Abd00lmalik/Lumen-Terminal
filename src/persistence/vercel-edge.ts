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
 * CDN CACHE IS OFF FOR READS (Phase B root cause, found live). `get()` caches through the
 * CDN by default (`useCache: true`) and a Blob's default cache lifetime is a month
 * (`cacheControlMaxAge` defaults to 30 days). So merge-before-write could read a CDN copy
 * that predated another instance's write: the merged state then MISSED that instance's
 * runs, and the write erased them (observed live as history shrinking between reads and
 * completed runs disappearing). Every read here now passes `useCache: false` (origin
 * storage, current ETag) and every write sets a 1-minute `cacheControlMaxAge` — a mutable
 * snapshot must never be served from a cache that can be a month behind.
 *
 * MULTI-INSTANCE WRITES (audit B5): save() is merge-before-write, but a merge alone is a
 * lost-update race — two warm instances can both read the same blob, merge, and then write
 * in an order that drops one side's runs. Vercel Blob supports conditional writes via ETags,
 * so the write is CONDITIONAL on the ETag we merged from: if another instance wrote in
 * between, Blob rejects it with a precondition failure, we re-read the winner's state, merge
 * again and retry (bounded). A first write against a missing blob is create-only, so two
 * instances racing to create it resolve the same way instead of one silently erasing the
 * other.
 *
 * BOUNDED I/O (Phase B): a hung blob request must not stall the serverless invocation (or
 * every later save queued behind it) until the platform kills it, losing the run's record.
 * Each transport operation is raced against a hard I/O deadline and aborted, surfacing as a
 * genuine persistence failure the caller reports honestly.
 *
 * THE CLIENT IS INJECTABLE (BlobClient): the optimistic-concurrency, cache-bypass and timeout
 * logic are exercised by tests against an in-memory blob that enforces the same semantics,
 * without network.
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

/**
 * Ceiling on a single blob read/write. The snapshot is small (hundreds of KB); a request that
 * has not answered in this window is a hung transport, and waiting longer only risks the
 * platform killing the whole invocation (and with it the run record we were trying to write).
 */
export const BLOB_IO_TIMEOUT_MS = 20_000;

/** Cache lifetime for the snapshot blob. Mutable state must never be cached for the default month. */
export const SNAPSHOT_CACHE_CONTROL_MAX_AGE_SECONDS = 60;

/** Conditional-write options; `ifMatch` (existing blob) or `createOnly` (first write). */
export interface BlobWriteGuard {
  readonly ifMatch?: string;
  readonly createOnly?: boolean;
}

/** Read options; `useCache: false` is LAW here (see the header: a CDN copy is a stale copy). */
export interface BlobReadOptions {
  readonly useCache: boolean;
  readonly signal?: AbortSignal;
}

/** Write options: the snapshot is mutable, so its blob must expire from any cache quickly. */
export interface BlobWriteOptions {
  readonly cacheControlMaxAge: number;
  readonly signal?: AbortSignal;
}

/**
 * The minimal Blob transport this store needs. Injectable so the store's merge + ETag
 * concurrency behavior is testable without network access; the default implementation is
 * the real @vercel/blob SDK (lazily imported).
 */
export interface BlobClient {
  /** Current content + ETag, or undefined when the blob does not exist. */
  read(pathname: string, access: BlobAccess, options: BlobReadOptions): Promise<{ body: string; etag: string } | undefined>;
  /** Write the blob; the guard makes the write fail when the blob changed since we read it. */
  write(pathname: string, body: string, access: BlobAccess, guard?: BlobWriteGuard, options?: BlobWriteOptions): Promise<void>;
  /**
   * Current STRONG ETag for conditional writes, or undefined when unavailable (blob absent /
   * metadata hiccup). Production finding: a blob GET returns a WEAK etag (`W/"…"`), and an
   * `If-Match` conditional write requires a STRONG validator, so the GET etag produced
   * "Precondition failed: ETag mismatch" on every conditional write. The metadata endpoint
   * (`head`) returns the strong etag. Optional so an in-memory fake without metadata still works.
   */
  head?(pathname: string, access: BlobAccess, signal?: AbortSignal): Promise<{ etag: string } | undefined>;
}

/**
 * Read options for the workspace snapshot. `useCache: false` is deliberate and must stay:
 * a CDN-cached body carries a CDN-cached ETag, so a stale read both hides other instances'
 * runs from the merge AND makes the conditional write fail against the real ETag.
 */
export function snapshotReadOptions(signal?: AbortSignal): BlobReadOptions {
  return { useCache: false, ...(signal !== undefined ? { signal } : {}) };
}

/** Write options for the workspace snapshot (mutable state: never the 30-day default cache). */
export function snapshotWriteOptions(signal?: AbortSignal): BlobWriteOptions {
  return { cacheControlMaxAge: SNAPSHOT_CACHE_CONTROL_MAX_AGE_SECONDS, ...(signal !== undefined ? { signal } : {}) };
}

/** The real @vercel/blob transport (lazy import keeps local dev without the package working). */
export function vercelBlobClient(): BlobClient {
  return {
    async head(pathname, _access, signal) {
      const { head } = await import("@vercel/blob");
      try {
        const meta = await head(pathname, { ...(signal !== undefined ? { abortSignal: signal } : {}) });
        return meta.etag !== "" ? { etag: meta.etag } : undefined;
      } catch {
        return undefined;
      }
    },
    async read(pathname, access, options) {
      const { get, head } = await import("@vercel/blob");
      // PUBLIC-STORE CDN BYPASS (Phase C production finding): the SDK's `useCache: false`
      // only appends its cache-buster for PRIVATE stores (see @vercel/blob get.ts). A public
      // blob GET is served from the CDN, so `useCache: false` was a no-op there: the read
      // returned a STALE body AND a stale ETag, and every conditional write then failed with
      // "Precondition failed: ETag mismatch" (production: POST /api/saved returned 500).
      // For public stores, read the current metadata and fetch the body through a unique URL
      // so neither the body nor the ETag can be a cached copy. Private stores keep the SDK's
      // own cache-buster. Reads stay inside the store's bounded I/O deadline (the extra head
      // request is part of the same bounded operation).
      let target = pathname;
      if (options.useCache === false && access === "public") {
        let base = pathname;
        try {
          const meta = await head(pathname, {
            ...(options.signal !== undefined ? { abortSignal: options.signal } : {}),
          });
          base = meta.url;
        } catch {
          // Missing blob / metadata hiccup: fall through with the pathname; get() reports the
          // absence honestly (null) rather than the store inventing content.
          base = pathname;
        }
        target = `${base}${base.includes("?") ? "&" : "?"}cachebust=${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
      const blob = await get(target, {
        access,
        useCache: options.useCache,
        ...(options.signal !== undefined ? { abortSignal: options.signal } : {}),
      });
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
    async write(pathname, body, access, guard, options) {
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
        ...(options !== undefined ? { cacheControlMaxAge: options.cacheControlMaxAge } : {}),
        ...(options?.signal !== undefined ? { abortSignal: options.signal } : {}),
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

/** A blob operation that outlived its budget (honest, typed so callers can report it). */
export class BlobIoTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Blob ${operation} timed out after ${timeoutMs}ms`);
    this.name = "BlobIoTimeoutError";
  }
}

export interface VercelBlobStoreOptions {
  /** Per-operation ceiling; overridable so tests can exercise the timeout without waiting. */
  readonly ioTimeoutMs?: number;
}

export class VercelBlobStore implements WorkspaceStore {
  private cache?: WorkspaceSnapshot;
  /** When the cache was written (load or save); older than LOAD_TTL_MS = re-fetch. */
  private cacheAt = 0;
  /** In-process serialization: concurrent saves must not interleave read/merge/write. */
  private queue: Promise<void> = Promise.resolve();
  /** Access mode of the connected store; auto-detected on first use (private preferred). */
  private access?: BlobAccess;

  constructor(
    private readonly client: BlobClient = vercelBlobClient(),
    private readonly options: VercelBlobStoreOptions = {},
  ) {}

  private get ioTimeoutMs(): number {
    return this.options.ioTimeoutMs ?? BLOB_IO_TIMEOUT_MS;
  }

  /**
   * Run one transport operation under a hard deadline: the abort signal cancels the request,
   * and the race guarantees the caller is never left waiting on a transport that stopped
   * answering (the platform killing the invocation is what loses a completed run's record).
   */
  private async bounded<T>(operation: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BlobIoTimeoutError(operation, this.ioTimeoutMs));
      }, this.ioTimeoutMs);
    });
    try {
      return await Promise.race([run(controller.signal), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

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
        // MERGE-BEFORE-WRITE (multi-instance law): re-read the blob's CURRENT state (from
        // origin storage, never a CDN copy) and union it with ours. A stale warm instance
        // must never erase runs another instance completed while it was idle. A failed
        // re-read (transient) degrades to an unconditional write: our own state is never
        // lost to a read hiccup.
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
        // CONDITIONAL-WRITE VALIDATOR (Phase C production finding): use the STRONG etag from
        // the metadata endpoint, never the weak `W/"…"` etag a GET returns — an If-Match
        // write requires a strong validator, so the GET etag failed every conditional write.
        const strongEtag = await this.readStrongEtag();
        const body = JSON.stringify(merged);
        const guard: BlobWriteGuard | undefined =
          strongEtag !== undefined ? { ifMatch: strongEtag }
            : remote !== undefined ? { ifMatch: remote.etag }
              : { createOnly: true };
        try {
          await this.withDetectedAccess(async (access) => {
            await this.bounded("write", (signal) =>
              this.client.write(BLOB_PATH, body, access, guard, snapshotWriteOptions(signal)),
            );
          });
          this.cache = merged;
          this.cacheAt = Date.now(); // our own write is by definition current
          return;
        } catch (error) {
          // Lost the race: re-read the winner's state, merge again, retry (bounded). A timeout
          // is NOT a race: retrying a hung transport three times only burns the budget.
          attempt += 1;
          if (!isWriteConflict(error) || attempt >= MAX_WRITE_ATTEMPTS) throw error;
        }
      }
    });
    await this.queue;
  }

  /**
   * Re-read the blob from origin storage regardless of the TTL cache (cross-instance READ
   * freshness). The Saved library read path uses this so a warm instance can never serve a
   * library that omits another instance's explicit SAVE/UNSAVE. The fresh read still updates
   * the local cache so a following merge/save stays coherent.
   */
  async loadFresh(): Promise<Workspace | undefined> {
    this.cacheAt = 0;
    return this.load();
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

  /** Current STRONG etag for the conditional write guard (undefined when the client has no
   *  metadata support, the blob is absent, or the metadata call failed). Bounded like every
   *  other transport operation. */
  private async readStrongEtag(): Promise<string | undefined> {
    const head = this.client.head;
    if (head === undefined) return undefined;
    try {
      const access = this.access ?? "private";
      const meta = await this.bounded("head", (signal) => head(BLOB_PATH, access, signal));
      return meta?.etag !== undefined && meta.etag !== "" ? meta.etag : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Current blob content + ETag under the detected access mode, read from origin storage
   * (never the CDN cache; see the header). Returns undefined when the blob is absent/empty;
   * throws on a non-access transport failure (callers decide whether to degrade). Access
   * detection is recorded so later reads skip the probe.
   */
  private async readRawWithEtag(): Promise<{ body: string; etag: string } | undefined> {
    const read = async (access: BlobAccess): Promise<{ body: string; etag: string } | undefined> => {
      const found = await this.bounded("read", (signal) => this.client.read(BLOB_PATH, access, snapshotReadOptions(signal)));
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
