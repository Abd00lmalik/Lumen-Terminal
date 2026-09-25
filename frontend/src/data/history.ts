/**
 * History-list view helpers (B2): pure, DOM-free, unit-testable.
 *
 * The History page answers "what did I research?" — so it groups runs by the day they last
 * changed, newest first. Timestamps come from the backend (provenance-derived); a run with no
 * usable timestamp is grouped honestly as "Undated" rather than shown as "just now".
 */

/** History page size: pages are requested from the backend, never sliced out of a full list. */
export const HISTORY_PAGE_SIZE = 25;

export interface DatedEntry {
  readonly updatedAt?: string;
  readonly createdAt?: string;
}

export interface HistoryDayGroup<T> {
  /** "Today" | "Yesterday" | "12 Mar 2026" | "Undated". */
  readonly label: string;
  readonly entries: readonly T[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local calendar day key (YYYY-MM-DD) for a real timestamp; undefined when unusable. */
function dayKey(iso: string | undefined): string | undefined {
  if (iso === undefined || iso === "") return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayKeyOf(entry: DatedEntry): string | undefined {
  return dayKey(entry.updatedAt) ?? dayKey(entry.createdAt);
}

function labelFor(key: string | undefined, now: Date): string {
  if (key === undefined) return "Undated";
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/**
 * Group entries by their (already sorted) day, preserving input order inside each group and
 * the order of the groups themselves — the backend's newest-first order is authoritative.
 */
export function groupHistoryByDay<T extends DatedEntry>(entries: readonly T[], now: Date = new Date()): readonly HistoryDayGroup<T>[] {
  const groups: { key: string | undefined; label: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const key = dayKeyOf(entry);
    let group = groups[groups.length - 1];
    if (group === undefined || group.key !== key) {
      group = { key, label: labelFor(key, now), entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups.map((g) => ({ label: g.label, entries: g.entries }));
}

/** Absolute timestamp for a history row (rendered beside the relative time). */
export function formatStamp(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
