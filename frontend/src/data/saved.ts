/**
 * Saved-library view helpers (Phase C): pure, DOM-free, unit-testable.
 *
 * The distinction this encodes: HISTORY answers "what have I researched?"; SAVED answers
 * "what do I want to keep?". Identity of a saved artifact is its ORIGIN (research + kind +
 * source object), never its title text — so the UI can tell SAVE from SAVED without comparing
 * prose.
 */
import type { SavedKindDto } from "../api/types.js";
import type { SavedItemView } from "./types.js";

/** Saved-library page size: pages are requested from the backend, never sliced locally. */
export const SAVED_PAGE_SIZE = 50;

export interface SavedKindTab {
  readonly value: "ALL" | SavedKindDto;
  readonly label: string;
}

/** The library structure: All / Research / Judgments / Evidence / Insights / Watch Next. */
export const SAVED_KIND_TABS: readonly SavedKindTab[] = [
  { value: "ALL", label: "All" },
  { value: "RESEARCH", label: "Research" },
  { value: "JUDGMENT", label: "Judgments" },
  { value: "EVIDENCE", label: "Evidence" },
  { value: "INSIGHT", label: "Insights" },
  { value: "WATCH_NEXT", label: "Watch Next" },
];

const KIND_LABELS: Record<string, string> = {
  RESEARCH: "research",
  JUDGMENT: "judgment",
  EVIDENCE: "evidence",
  INSIGHT: "insight",
  WATCH_NEXT: "watch next",
};

export function savedKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.toLowerCase();
}

/** Deterministic identity of a saved artifact (mirrors the backend). */
export function savedKey(researchRef: string | undefined, kind: string, sourceRef: string | undefined): string {
  const origin = researchRef ?? "";
  const source = sourceRef ?? origin;
  return `${origin}::${kind}::${source}`;
}

export function savedKeyOf(item: Pick<SavedItemView, "researchRef" | "kind" | "sourceRef">): string {
  return savedKey(item.researchRef, item.kind, item.sourceRef);
}

/**
 * Client-side filter used only as a defensive fallback / for already-loaded rows. The backend
 * owns filtering; this keeps the page honest if a non-filtered page is on screen.
 */
export function filterSaved<T extends Pick<SavedItemView, "kind" | "title" | "summary" | "tags">>(
  items: readonly T[],
  kind: "ALL" | SavedKindDto,
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (kind !== "ALL" && item.kind !== kind) return false;
    if (needle === "") return true;
    return [item.title, item.summary, ...item.tags].some((text) => text.toLowerCase().includes(needle));
  });
}
