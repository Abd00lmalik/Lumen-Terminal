/**
 * Monitor service (Phase H): the persistent monitoring state. Creation derives conditions
 * from the workspace's Challenge records; activation/pause/resume are explicit trader
 * actions; "Check now" runs the same bounded pipeline as scheduled checks. No polling,
 * no background anything: clients refresh on demand.
 */
import { http } from "./client.js";
import type { MonitorsDto, MonitorDto, MonitorAssessmentDto, MonitorNotificationDto, MonitorCheckResultDto } from "./types.js";

export function listMonitors(): Promise<MonitorsDto> {
  return http.get<MonitorsDto>("/api/monitors");
}

export function activateMonitor(ref: string): Promise<MonitorDto> {
  return http.post<MonitorDto>(`/api/monitors/${encodeURIComponent(ref)}/activate`);
}

export function createMonitorFromChallenge(request: { thesisRef?: string; cadence?: "DAILY" | "WEEKLY" | "MANUAL"; title?: string } = {}): Promise<{ monitor: MonitorDto; challengeRefs: readonly string[] }> {
  return http.post<{ monitor: MonitorDto; challengeRefs: readonly string[] }>("/api/monitors/from-challenge", request);
}

export function setMonitorStatus(ref: string, status: "PAUSED" | "ACTIVE" | "COMPLETED"): Promise<MonitorDto> {
  return http.post<MonitorDto>(`/api/monitors/${encodeURIComponent(ref)}/status`, { status });
}

export function checkMonitorNow(ref: string): Promise<MonitorCheckResultDto> {
  return http.post<MonitorCheckResultDto>(`/api/monitors/${encodeURIComponent(ref)}/check`);
}

export function listMonitorAssessments(ref: string): Promise<readonly MonitorAssessmentDto[]> {
  return http.get<readonly MonitorAssessmentDto[]>(`/api/monitors/${encodeURIComponent(ref)}/assessments`);
}

export function listNotifications(): Promise<readonly MonitorNotificationDto[]> {
  return http.get<readonly MonitorNotificationDto[]>("/api/notifications");
}

export function markNotificationRead(ref: string): Promise<MonitorNotificationDto> {
  return http.post<MonitorNotificationDto>(`/api/notifications/${encodeURIComponent(ref)}/read`);
}
