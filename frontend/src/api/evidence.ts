/**
 * Evidence service; evidence objects with the backend's epistemic class,
 * freshness, proxy basis, and support/contradiction relationships intact.
 * Claims and hypotheses come from the same workspace graph.
 */
import { http } from "./client.js";
import type { EvidenceDto, ClaimDto, HypothesisDto, JudgmentDto } from "./types.js";

export function listEvidence(): Promise<readonly EvidenceDto[]> {
  return http.get<readonly EvidenceDto[]>("/api/evidence");
}

export function getEvidence(ref: string): Promise<EvidenceDto> {
  return http.get<EvidenceDto>(`/api/evidence/${encodeURIComponent(ref)}`);
}

export function listClaims(): Promise<readonly ClaimDto[]> {
  return http.get<readonly ClaimDto[]>("/api/claims");
}

export function listHypotheses(): Promise<readonly HypothesisDto[]> {
  return http.get<readonly HypothesisDto[]>("/api/hypotheses");
}

export function listJudgments(): Promise<readonly JudgmentDto[]> {
  return http.get<readonly JudgmentDto[]>("/api/judgments");
}
