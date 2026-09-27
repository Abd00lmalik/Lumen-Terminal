/**
 * Phase F workspace sessions: one ResearchApp (and thus one Workspace graph) per verified
 * workspace identity, with strict concurrency rules and an idle expiry.
 *
 * WHY a container instead of "one global app + userId filters" (brief §5): the Workspace
 * object model is a graph of maps; filtering a shared graph per user would leak in-flight
 * engine state (active run context, response archive, sweep passes) across users. One
 * ResearchApp per workspace keeps EVERY existing engine/persistence behavior identical
 * per user — the smallest safe change that satisfies "no global mutable current user".
 *
 * Concurrency law (verified against Vercel Fluid Compute): two CONCURRENT serverless
 * invocations are separate VMs, so each builds its own session and every save obeys the
 * Phase E law (merge-before-conditional-write). Only requests sharing ONE VM share a
 * session — and they are serialized by the same invocation, never interleaved mid-run
 * (a module-level `beginRun` context is safe again for the same reason).
 *
 * Idle expiry bounds memory on warm instances; an evicted session transparently reloads
 * from the durable per-workspace snapshot on next use.
 */

import type { ResearchApp } from "./research-app.js";

export interface SessionEntry {
  readonly app: ResearchApp;
  lastUsedAt: number;
}

/** Fixed maximum concurrent sessions per warm instance (hard memory bound). */
export const MAX_SESSIONS_PER_INSTANCE = 50;
/** Sessions idle longer than this are evicted (warm-instance memory bound). */
export const SESSION_IDLE_MS = 10 * 60_000;

export class WorkspaceSessions {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    /** Factory for a workspace's app (loads its durable snapshot). */
    private readonly create: (workspaceId: string) => Promise<ResearchApp>,
    private readonly now: () => number = () => Date.now(),
    private readonly idleMs: number = SESSION_IDLE_MS,
    private readonly maxSessions: number = MAX_SESSIONS_PER_INSTANCE,
  ) {}

  /** Existing live session, touching its last-used clock. */
  peek(workspaceId: string): ResearchApp | undefined {
    const entry = this.sessions.get(workspaceId);
    if (entry === undefined) return undefined;
    entry.lastUsedAt = this.now();
    return entry.app;
  }

  /**
   * The workspace's app, building it on first use (and transparently rebuilding after idle
   * eviction). The factory is awaited OUTSIDE the map so a slow load never blocks other
   * workspaces' session creation on this instance.
   */
  async get(workspaceId: string): Promise<ResearchApp> {
    const cached = this.peek(workspaceId);
    if (cached !== undefined) return cached;
    const app = await this.create(workspaceId);
    this.prune();
    this.sessions.set(workspaceId, { app, lastUsedAt: this.now() });
    return app;
  }

  /** Drop idle sessions and, if still full, the single least-recently-used one. */
  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastUsedAt > this.idleMs) this.sessions.delete(id);
    }
    if (this.sessions.size >= this.maxSessions) {
      let oldestId: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.sessions) {
        if (entry.lastUsedAt < oldestAt) {
          oldestAt = entry.lastUsedAt;
          oldestId = id;
        }
      }
      if (oldestId !== undefined) this.sessions.delete(oldestId);
    }
  }

  /** Current session count (diagnostics only). */
  get size(): number {
    return this.sessions.size;
  }
}
