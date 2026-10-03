/**
 * Research service; submit requests (JSON or SSE) and read research objects/history.
 * The client message is natural language ONLY; flow/action selection belongs to the backend LUI.
 */
import { http, streamResearch } from "./client.js";
import type {
  ResearchResponseDto, ResearchRunAggregateDto, ResearchRunSummaryDto, ResearchListQuery,
  InvestigationDto,
} from "./types.js";

export function submitResearch(message: string, confirmed = false): Promise<ResearchResponseDto> {
  return http.post<ResearchResponseDto>("/api/research", { message, confirmed });
}

/**
 * InvestigATIONS (conversational workbench). A thread of isolated research runs.
 *
 * The client names the investigation it is CONTINUING; the backend still decides, from the
 * trader's own words, whether the turn actually continues it — a turn that switches subject
 * opens a new investigation instead of contaminating this one.
 */
export function listInvestigations(): Promise<readonly InvestigationDto[]> {
  return http.get<readonly InvestigationDto[]>("/api/investigations");
}

export function getInvestigation(ref: string): Promise<InvestigationDto> {
  return http.get<InvestigationDto>(`/api/investigations/${encodeURIComponent(ref)}`);
}

export function enterInvestigation(ref: string): Promise<InvestigationDto> {
  return http.post<InvestigationDto>(`/api/investigations/${encodeURIComponent(ref)}/enter`, {});
}

/**
 * NEW RESEARCH: clear the current-investigation SELECTION on the server.
 *
 * A client-only reset is what left the composer in follow-up mode: the next refresh read the
 * backend's still-current investigation and put the trader back in the thread they left.
 * Nothing is deleted — every investigation stays in History.
 */
export function startNewInvestigation(): Promise<readonly InvestigationDto[]> {
  return http.post<readonly InvestigationDto[]>("/api/investigations/new", {});
}

export interface StreamCallbacks {
  readonly onProgress: (event: { stage: string; summary: string; data?: Record<string, string | number | boolean> }) => void;
  readonly onFinal: (result: ResearchResponseDto) => void;
  readonly onError: (error: { code: string; message: string; httpStatus: number }) => void;
  readonly onConnectionLost?: () => void;
}

/** Submit over SSE: real lifecycle progress, terminal final/error. */
export function streamResearchRequest(message: string, cb: StreamCallbacks, options?: { confirmed?: boolean; signal?: AbortSignal; investigationId?: string }): Promise<void> {
  return streamResearch(
    message,
    { confirmed: options?.confirmed, signal: options?.signal, investigationId: options?.investigationId },
    {
      onProgress: cb.onProgress,
      onFinal: (result) => cb.onFinal(result as ResearchResponseDto),
      onError: (err) => cb.onError({ code: err.code, message: err.message, httpStatus: err.httpStatus }),
      onConnectionLost: cb.onConnectionLost,
    },
  );
}

/**
 * Research history (one lightweight entry per RUN, newest first by default). Windowed and
 * filterable so the History page pages instead of loading the whole workspace: `limit`
 * defaults to the backend's page size, and callers detect the end of the list by receiving
 * fewer entries than the page size they asked for.
 */
export function listResearch(query: ResearchListQuery = {}): Promise<readonly ResearchRunSummaryDto[]> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.sort !== undefined) params.set("sort", query.sort);
  if (query.status !== undefined && query.status !== "") params.set("status", query.status);
  if (query.q !== undefined && query.q.trim() !== "") params.set("q", query.q.trim());
  const suffix = params.toString();
  return http.get<readonly ResearchRunSummaryDto[]>(`/api/research${suffix === "" ? "" : `?${suffix}`}`);
}

/**
 * Open ONE research run: the run aggregate (the same contract a new run renders through), so
 * a reopened historical run and a fresh result share a single presentation path.
 */
export function getResearch(ref: string): Promise<ResearchRunAggregateDto> {
  return http.get<ResearchRunAggregateDto>(`/api/research/${encodeURIComponent(ref)}`);
}
