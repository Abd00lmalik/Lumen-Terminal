/**
 * In-memory Vercel Blob service for tests: enforces the SAME semantics the store depends on —
 * content + ETag, conditional writes (`ifMatch`), create-only first writes, missing blobs,
 * read options (`useCache`) and an injectable failure mode. Shared by the store suite and the
 * cold-start acceptance suite so production persistence is exercised by more than one path.
 */
import type { BlobClient, BlobReadOptions, BlobWriteGuard, BlobWriteOptions } from "../../src/persistence/vercel-edge.js";

/** Vercel Blob's own precondition error shape (name + message). */
export function preconditionFailed(): Error {
  const error = new Error("Precondition failed: ETag mismatch.");
  error.name = "BlobPreconditionFailedError";
  return error;
}

export class FakeBlob {
  value?: { body: string; etag: string };
  private counter = 0;
  readonly writes: Array<{ body: string; guard?: BlobWriteGuard; access: string; options?: BlobWriteOptions }> = [];
  /** Every read the store performed, so tests can assert the origin-read (no-CDN) invariant. */
  readonly reads: Array<{ access: string; options: BlobReadOptions }> = [];
  /** Test hook: runs before each write, so a test can simulate a concurrent winner. */
  beforeWrite?: (writeIndex: number) => void;
  /** When set, writes reject with this error (proves failures surface, not swallowed). */
  failNextWrite?: Error;
  /** When set, writes never settle (proves a hung transport cannot stall the store forever). */
  hangWrites = false;
  /** Access mode this fake accepts; a mismatch mimics the store-level misconfiguration. */
  acceptAccess?: "public" | "private";

  client(): BlobClient {
    return {
      read: async (_pathname, access, options) => {
        this.assertAccess(access);
        this.reads.push({ access, options });
        if (options.signal?.aborted === true) throw new Error("aborted");
        return this.value === undefined ? undefined : { ...this.value };
      },
      head: async (_pathname, access, signal) => {
        this.assertAccess(access);
        if (signal?.aborted === true) throw new Error("aborted");
        return this.value === undefined ? undefined : { etag: this.value.etag };
      },
      write: async (_pathname, body, access, guard, options) => {
        this.assertAccess(access);
        this.writes.push({ body, guard, access, options });
        this.beforeWrite?.(this.writes.length);
        if (this.hangWrites) return await new Promise<void>(() => {}); // never settles
        if (this.failNextWrite !== undefined) {
          const error = this.failNextWrite;
          this.failNextWrite = undefined;
          throw error;
        }
        if (guard?.createOnly === true && this.value !== undefined) {
          throw new Error("This blob already exists. Use allowOverwrite to overwrite it.");
        }
        if (guard?.ifMatch !== undefined && this.value?.etag !== guard.ifMatch) throw preconditionFailed();
        this.value = { body, etag: `etag-${++this.counter}` };
      },
    };
  }

  private assertAccess(access: string): void {
    if (this.acceptAccess !== undefined && this.acceptAccess !== access) {
      throw new Error(`Cannot use ${access} access on a ${this.acceptAccess} store`);
    }
  }

  /** Unsafe direct write (a concurrent instance's action, not ours). */
  put(body: string): void {
    this.value = { body, etag: `etag-${++this.counter}` };
  }

  body(): string | undefined {
    return this.value?.body;
  }
}

/**
 * A blob service WITH A CDN IN FRONT OF IT (the production failure mode this store was fixed
 * for): a cached-eligible read (`useCache: true`) can be answered from a copy taken before the
 * last write, while an origin read (`useCache: false`) always sees the current content.
 *
 * Serves `wrapped`'s content and records/forwards writes; the stale copy is refreshed only by
 * writes performed through THIS object (exactly like a cache that has not been invalidated).
 */
export class CdnCachedBlob extends FakeBlob {
  /** Body/ETag the CDN will hand out for a cached read (refreshed on our own writes). */
  private cached?: { body: string; etag: string };
  /** Reads served from the stale CDN copy (non-zero proves the cache was actually consulted). */
  staleReads = 0;

  override client(): BlobClient {
    const origin = super.client();
    return {
      read: async (pathname, access, options) => {
        if (options.useCache) {
          this.staleReads += 1;
          this.reads.push({ access, options });
          return this.cached === undefined ? undefined : { ...this.cached };
        }
        const fresh = await origin.read(pathname, access, options);
        // An origin read does not refresh the CDN copy; only a write does (see write()).
        return fresh;
      },
      write: async (pathname, body, access, guard, options) => {
        await origin.write(pathname, body, access, guard, options);
        // Our write invalidates the cached copy for this key.
        this.cached = this.value === undefined ? undefined : { ...this.value };
      },
    };
  }

  /** A DIFFERENT instance's write lands in origin storage; the CDN copy stays stale. */
  override put(body: string): void {
    super.put(body);
  }

  /** Prime the CDN with the CURRENT origin content (first read after a cold cache). */
  primeCache(): void {
    this.cached = this.value === undefined ? undefined : { ...this.value };
  }
}
