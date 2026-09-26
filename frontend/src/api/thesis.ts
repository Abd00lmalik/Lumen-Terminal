/**
 * Thesis service. Reads list/open theses and assessments. Phase D adds EXPLICIT trader actions
 * (create/update/status/archive/link): each one is a deliberate trader call through the backend
 * domain boundary. Assessments remain research results, never edits; nothing here silently
 * rewrites a thesis.
 */
import { http } from "./client.js";
import type { ThesisDto, ThesisAssessmentDto, ThesisCreateRequest, ThesisUpdateRequest } from "./types.js";

export function listTheses(query: { readonly status?: string; readonly q?: string } = {}): Promise<readonly ThesisDto[]> {
  const params = new URLSearchParams();
  if (query.status !== undefined && query.status.trim() !== "") params.set("status", query.status.trim());
  if (query.q !== undefined && query.q.trim() !== "") params.set("q", query.q.trim());
  const suffix = params.toString();
  return http.get<readonly ThesisDto[]>(`/api/thesis${suffix === "" ? "" : `?${suffix}`}`);
}

export function getThesis(ref: string): Promise<ThesisDto & { assessments: readonly ThesisAssessmentDto[] }> {
  return http.get<ThesisDto & { assessments: readonly ThesisAssessmentDto[] }>(`/api/thesis/${encodeURIComponent(ref)}`);
}

export function selectThesis(thesisRef: string): Promise<{ selected: string; thesis: ThesisDto }> {
  return http.post<{ selected: string; thesis: ThesisDto }>("/api/thesis/select", { thesisRef });
}

/** Phase D explicit thesis actions; every one is the trader's call, never silent. */
export function createThesis(request: ThesisCreateRequest): Promise<ThesisDto> {
  return http.post<ThesisDto>("/api/thesis", request);
}

export function updateThesis(ref: string, patch: ThesisUpdateRequest): Promise<ThesisDto> {
  return http.patch<ThesisDto>(`/api/thesis/${encodeURIComponent(ref)}`, patch);
}

export function setThesisStatus(ref: string, status: string): Promise<ThesisDto> {
  return http.post<ThesisDto>(`/api/thesis/${encodeURIComponent(ref)}/status`, { status });
}

export function archiveThesis(ref: string): Promise<{ archived: string }> {
  return http.del<{ archived: string }>(`/api/thesis/${encodeURIComponent(ref)}`);
}

export function linkThesisSaved(ref: string, savedId: string): Promise<ThesisDto> {
  return http.post<ThesisDto>(`/api/thesis/${encodeURIComponent(ref)}/link-saved`, { savedId });
}

export function unlinkThesisSaved(ref: string, savedId: string): Promise<ThesisDto> {
  return http.del<ThesisDto>(`/api/thesis/${encodeURIComponent(ref)}/link-saved/${encodeURIComponent(savedId)}`);
}

export function listAssessments(thesisRef?: string): Promise<readonly ThesisAssessmentDto[]> {
  const q = thesisRef !== undefined ? `?thesisRef=${encodeURIComponent(thesisRef)}` : "";
  return http.get<readonly ThesisAssessmentDto[]>(`/api/assessments${q}`);
}
