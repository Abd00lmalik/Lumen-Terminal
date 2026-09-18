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
 * Failure semantics: a failed save must never claim persistence succeeded (the caller's
 * save path surfaces the error); a missing/unreadable blob is "no workspace yet", not a
 * crash; one failed save must not poison the queue for subsequent saves. The dependency is
 * imported lazily so local dev without the package still works.
 */
import type { WorkspaceStore } from "./index.js";
import { Workspace, type WorkspaceSnapshot } from "../domain/workspace.js";

const BLOB_PATH = "workspace/snapshot.json";

type BlobAccess = "public" | "private";

/** The SDK's store-level access-mismatch error; the only signal we auto-flip on. */
function isAccessMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /public access on a private store|private access on a public store/i.test(message);
}

export class VercelBlobStore implements WorkspaceStore {
  private cache?: WorkspaceSnapshot;
  /** In-process serialization: concurrent saves must not interleave put/copy races. */
  private queue: Promise<void> = Promise.resolve();
  /** Access mode of the connected store; auto-detected on first use (private preferred). */
  private access?: BlobAccess;

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
    this.cache = snapshot;
    const body = JSON.stringify(snapshot);
    // Serialize saves; each waits for the previous one to finish. A rejected predecessor
    // is contained so one failed save cannot silently skip every subsequent save.
    this.queue = this.queue.catch(() => {}).then(async () => {
      const { put } = await import("@vercel/blob");
      await this.withDetectedAccess(async (access) => {
        await put(BLOB_PATH, body, {
          access,
          allowOverwrite: true,
          contentType: "application/json",
          addRandomSuffix: false,
        });
      });
    });
    await this.queue;
  }

  async load(): Promise<Workspace | undefined> {
    if (this.cache !== undefined) return Workspace.fromSnapshot(this.cache);
    const raw = await this.readRaw();
    if (raw === undefined) return undefined;
    try {
      this.cache = JSON.parse(raw) as WorkspaceSnapshot;
      return Workspace.fromSnapshot(this.cache);
    } catch {
      // A corrupt snapshot is "no workspace yet", not a crash.
      return undefined;
    }
  }

  private async readRaw(): Promise<string | undefined> {
    try {
      const { get } = await import("@vercel/blob");
      const read = async (access: BlobAccess): Promise<string | undefined> => {
        const blob = await get(BLOB_PATH, { access });
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
        const raw = chunks.join("");
        return raw.trim() === "" ? undefined : raw;
      };
      if (this.access !== undefined) return await read(this.access);
      let result: string | undefined;
      await this.withDetectedAccess(async (access) => {
        result = await read(access);
      });
      return result;
    } catch {
      // Missing blob (first run) or transient read failure = "no workspace yet";
      // never crash the request on a cold store.
      return undefined;
    }
  }
}
