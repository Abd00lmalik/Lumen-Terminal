/**
 * Memory service — read-only over saved artifacts and persistent memory.
 * There is deliberately NO client write path: SAVE happens through the LUI's
 * authorization boundary (a natural-language request via /api/research), never a
 * direct HTTP shortcut. STALE/HISTORICAL arrive with explicit status data.
 */
import { http } from "./client.js";
import type { MemoryDto, SavedArtifactDto } from "./types.js";

export function listMemories(): Promise<readonly MemoryDto[]> {
  return http.get<readonly MemoryDto[]>("/api/memory");
}

export function listArtifacts(): Promise<readonly SavedArtifactDto[]> {
  return http.get<readonly SavedArtifactDto[]>("/api/artifacts");
}
