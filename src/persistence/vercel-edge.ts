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
 * Failure semantics: a failed save must never claim persistence succeeded (the caller's
 * save path surfaces the error); a missing/unreadable blob is "no workspace yet", not a
 * crash. The dependency is imported lazily so local dev without the package still works.
 */
import type { WorkspaceStore } from "./index.js";
import { Workspace, type WorkspaceSnapshot } from "../domain/workspace.js";

const BLOB_PATH = "workspace/snapshot.json";

export class VercelBlobStore implements WorkspaceStore {
  private cache?: WorkspaceSnapshot;
  /** In-process serialization: concurrent saves must not interleave put/copy races. */
  private queue: Promise<void> = Promise.resolve();

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    this.cache = snapshot;
    const body = JSON.stringify(snapshot);
    // Serialize saves; each waits for the previous one to finish (bounded chain).
    this.queue = this.queue.then(async () => {
      const { put } = await import("@vercel/blob");
      await put(BLOB_PATH, body, {
        access: "public",
        allowOverwrite: true,
        contentType: "application/json",
        addRandomSuffix: false,
      });
    });
    await this.queue;
  }

  async load(): Promise<Workspace | undefined> {
    if (this.cache !== undefined) return Workspace.fromSnapshot(this.cache);
    try {
      const { get } = await import("@vercel/blob");
      const blob = await get(BLOB_PATH, { access: "public" });
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
      if (raw.trim() === "") return undefined;
      this.cache = JSON.parse(raw) as WorkspaceSnapshot;
      return Workspace.fromSnapshot(this.cache);
    } catch {
      // Missing blob (first run) or transient read failure = "no workspace yet";
      // never crash the request on a cold store.
      return undefined;
    }
  }
}
