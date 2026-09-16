/**
 * Thesis service — read theses/assessments; selection is the only write and goes
 * through the backend domain boundary (setActiveThesis). The frontend NEVER mutates
 * a thesis: assessments are research results, not edits.
 */
import { http } from "./client.js";
import type { ThesisDto, ThesisAssessmentDto } from "./types.js";

export function listTheses(): Promise<readonly ThesisDto[]> {
  return http.get<readonly ThesisDto[]>("/api/thesis");
}

export function getThesis(ref: string): Promise<ThesisDto & { assessments: readonly ThesisAssessmentDto[] }> {
  return http.get<ThesisDto & { assessments: readonly ThesisAssessmentDto[] }>(`/api/thesis/${encodeURIComponent(ref)}`);
}

export function selectThesis(thesisRef: string): Promise<{ selected: string; thesis: ThesisDto }> {
  return http.post<{ selected: string; thesis: ThesisDto }>("/api/thesis/select", { thesisRef });
}

export function listAssessments(thesisRef?: string): Promise<readonly ThesisAssessmentDto[]> {
  const q = thesisRef !== undefined ? `?thesisRef=${encodeURIComponent(thesisRef)}` : "";
  return http.get<readonly ThesisAssessmentDto[]>(`/api/assessments${q}`);
}
