/**
 * In-memory Vercel Blob service for tests: enforces the SAME semantics the store depends on —
 * content + ETag, conditional writes (`ifMatch`), create-only first writes, missing blobs, and
 * an injectable failure mode. Shared by the store suite and the cold-start acceptance suite so
 * production persistence is exercised by more than one path.
 */
import type { BlobClient, BlobWriteGuard } from "../../src/persistence/vercel-edge.js";

/** Vercel Blob's own precondition error shape (name + message). */
export function preconditionFailed(): Error {
  const error = new Error("Precondition failed: ETag mismatch.");
  error.name = "BlobPreconditionFailedError";
  return error;
}

export class FakeBlob {
  value?: { body: string; etag: string };
  private counter = 0;
  readonly writes: Array<{ body: string; guard?: BlobWriteGuard; access: string }> = [];
  /** Test hook: runs before each write, so a test can simulate a concurrent winner. */
  beforeWrite?: (writeIndex: number) => void;
  /** When set, writes reject with this error (proves failures surface, not swallowed). */
  failNextWrite?: Error;
  /** Access mode this fake accepts; a mismatch mimics the store-level misconfiguration. */
  acceptAccess?: "public" | "private";

  client(): BlobClient {
    return {
      read: async (_pathname, access) => {
        this.assertAccess(access);
        return this.value === undefined ? undefined : { ...this.value };
      },
      write: async (_pathname, body, access, guard) => {
        this.assertAccess(access);
        this.writes.push({ body, guard, access });
        this.beforeWrite?.(this.writes.length);
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
