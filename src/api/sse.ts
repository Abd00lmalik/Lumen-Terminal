/**
 * F0 SSE progress-event schema (F0 mandate §14/§15; FRONTEND_ARCHITECTURE.md §6).
 *
 * Named SSE events over `POST /api/research` (query `?stream=1`). Each event corresponds to an
 * ACTUAL application lifecycle transition; the LUI pipeline stages, research-plan creation,
 * capability execution, completion; threaded from the engine's optional progress listener.
 * Nothing is fabricated to make the UI look active; no event contains model reasoning, raw
 * provider payloads, or secrets (the listener only receives safe summaries + identifiers).
 */

import type { ProgressEvent } from "../research/progress.js";
import type { ResearchResponseDTO, ApiErrorDTO } from "./dto.js";

/** The SSE envelope; every event is one of exactly these three shapes. */
export type SseEvent =
  | { readonly event: "progress"; readonly data: ProgressEvent }
  | { readonly event: "final"; readonly data: ResearchResponseDTO }
  | { readonly event: "error"; readonly data: ApiErrorDTO };

export const SSE_EVENT_NAMES = ["progress", "final", "error"] as const;

/** Serialize one event as a complete SSE message block (final newline included). */
export function formatSseEvent(e: SseEvent): string {
  const name = e.event;
  return `event: ${name}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  };
}
