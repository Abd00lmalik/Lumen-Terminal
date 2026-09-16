/**
 * Research service — submit requests (JSON or SSE) and read research objects/history.
 * The client message is natural language ONLY; flow/action selection belongs to the backend LUI.
 */
import { http, streamResearch } from "./client.js";
import type { ResearchResponseDto, ResearchDto } from "./types.js";

export function submitResearch(message: string, confirmed = false): Promise<ResearchResponseDto> {
  return http.post<ResearchResponseDto>("/api/research", { message, confirmed });
}

export interface StreamCallbacks {
  readonly onProgress: (event: { stage: string; summary: string; data?: Record<string, string | number | boolean> }) => void;
  readonly onFinal: (result: ResearchResponseDto) => void;
  readonly onError: (error: { code: string; message: string; httpStatus: number }) => void;
  readonly onConnectionLost?: () => void;
}

/** Submit over SSE: real lifecycle progress, terminal final/error. */
export function streamResearchRequest(message: string, cb: StreamCallbacks, options?: { confirmed?: boolean; signal?: AbortSignal }): Promise<void> {
  return streamResearch(
    message,
    { confirmed: options?.confirmed, signal: options?.signal },
    {
      onProgress: cb.onProgress,
      onFinal: (result) => cb.onFinal(result as ResearchResponseDto),
      onError: (err) => cb.onError({ code: err.code, message: err.message, httpStatus: err.httpStatus }),
      onConnectionLost: cb.onConnectionLost,
    },
  );
}

export function listResearch(): Promise<readonly ResearchDto[]> {
  return http.get<readonly ResearchDto[]>("/api/research");
}

export function getResearch(ref: string): Promise<ResearchDto> {
  return http.get<ResearchDto>(`/api/research/${encodeURIComponent(ref)}`);
}
