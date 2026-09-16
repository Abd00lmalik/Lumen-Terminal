/**
 * Workspace service — session bootstrap and the continuity snapshot (the safe
 * backend representation of current state: active research/thesis/judgment,
 * recent evidence, hypotheses, artifacts, memory, monitors).
 */
import { http } from "./client.js";
import type { ContinuitySnapshotDto, SessionDto } from "./types.js";

export function createSession(): Promise<SessionDto> {
  return http.post<SessionDto>("/api/session");
}

export function getWorkspace(): Promise<ContinuitySnapshotDto> {
  return http.get<ContinuitySnapshotDto>("/api/workspace");
}
