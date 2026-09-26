/**
 * Persistence; smallest layer that satisfies lock §14: workspaces, research objects, evidence,
 * hypotheses, claims, judgments, provenance, and history must survive beyond individual messages.
 * In-memory + file-backed MVP is explicitly acceptable; the object model must be respected and
 * the research workspace must not be flattened into a conversation transcript.
 *
 * The store interface is object-typed so a database can replace it later without touching domain
 * logic (IMPLEMENTATION_PLAN.md §6). History is append-only inside objects; superseded judgments
 * are never deleted (object-lifecycle-state-machine.md).
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { Workspace, type WorkspaceSnapshot } from "../domain/workspace.js";

export interface WorkspaceStore {
  save(snapshot: WorkspaceSnapshot): Promise<void>;
  load(): Promise<Workspace | undefined>;
  /**
   * Optional: re-read the durable snapshot from origin storage bypassing any short-lived read
   * cache. Used by the application layer to keep FOCUSED reads (the Saved library) fresh across
   * serverless instances, where one instance's explicit SAVE/UNSAVE lives only in the durable
   * store while a warm instance still holds an older graph in memory. Implementations without a
   * cache may simply alias `load`.
   */
  loadFresh?(): Promise<Workspace | undefined>;
}

export class MemoryStore implements WorkspaceStore {
  private snapshot?: WorkspaceSnapshot;

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async load(): Promise<Workspace | undefined> {
    return this.snapshot ? Workspace.fromSnapshot(this.snapshot) : undefined;
  }
}

export class FileStore implements WorkspaceStore {
  constructor(private readonly filePath: string) {}

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const file = this.filePath;
    await fs.mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    await fs.rename(tmp, file); // atomic-ish write so a crash doesn't corrupt the workspace
  }

  async load(): Promise<Workspace | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return undefined; // no workspace yet; not an error
    }
    return Workspace.fromSnapshot(JSON.parse(raw) as WorkspaceSnapshot);
  }
}

export type StoreKind = "memory" | "file";

export function createStore(kind: StoreKind, filePath?: string): WorkspaceStore {
  if (kind === "file") {
    if (!filePath) throw new Error("FileStore requires a filePath");
    return new FileStore(filePath);
  }
  return new MemoryStore();
}

export { join as joinPath };
