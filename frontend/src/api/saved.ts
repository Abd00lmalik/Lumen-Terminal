/**
 * Saved workspace service (Phase C): the trader's explicitly-kept artifacts.
 *
 * Reads list/open the durable Saved library; create/delete are the typed SAVE/UNSAVE actions.
 * A SAVE confirmation is only ever shown after the backend confirms the write — the client
 * never treats an optimistic click as proof of persistence.
 */
import { http } from "./client.js";
import type {
  SavedItemDto, SavedItemSummaryDto, SavedListQuery, SavedCreateRequest,
} from "./types.js";

export function listSaved(query: SavedListQuery = {}): Promise<readonly SavedItemSummaryDto[]> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.sort !== undefined) params.set("sort", query.sort);
  if (query.kind !== undefined && query.kind !== "") params.set("kind", query.kind);
  // Phase D: exact originating-run filter (answered server-side; never filtered in React).
  if (query.researchRef !== undefined && query.researchRef.trim() !== "") params.set("researchRef", query.researchRef.trim());
  if (query.q !== undefined && query.q.trim() !== "") params.set("q", query.q.trim());
  const suffix = params.toString();
  return http.get<readonly SavedItemSummaryDto[]>(`/api/saved${suffix === "" ? "" : `?${suffix}`}`);
}

export function getSaved(savedId: string): Promise<SavedItemDto> {
  return http.get<SavedItemDto>(`/api/saved/${encodeURIComponent(savedId)}`);
}

export function createSaved(request: SavedCreateRequest): Promise<SavedItemDto> {
  return http.post<SavedItemDto>("/api/saved", request);
}

export function deleteSaved(savedId: string): Promise<{ readonly removed: string }> {
  return http.del<{ readonly removed: string }>(`/api/saved/${encodeURIComponent(savedId)}`);
}
