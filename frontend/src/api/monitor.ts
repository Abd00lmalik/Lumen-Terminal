/**
 * Monitor service; the persistent monitoring HANDOFF state. Reads are grouped by
 * lifecycle; activation is an explicit trader action through the backend domain
 * boundary. No polling, no background anything: clients refresh on demand.
 */
import { http } from "./client.js";
import type { MonitorsDto, MonitorDto } from "./types.js";

export function listMonitors(): Promise<MonitorsDto> {
  return http.get<MonitorsDto>("/api/monitors");
}

export function activateMonitor(ref: string): Promise<MonitorDto> {
  return http.post<MonitorDto>(`/api/monitors/${encodeURIComponent(ref)}/activate`);
}
