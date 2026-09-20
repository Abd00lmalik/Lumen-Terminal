/**
 * ID generation for research objects.
 * Prefixed ids keep object graphs readable in provenance trails (e.g. `ev_000001`).
 * MVP runtime is single-process; a monotonic counter is deterministic and test-friendly.
 * `resetIdCounters` exists for tests only.
 */

const COUNTERS = new Map<string, number>();

export function resetIdCounters(): void {
  COUNTERS.clear();
}

/**
 * Advance a prefix's counter past `n` if it is currently lower (never backward).
 * Used when restoring a persisted workspace: a fresh process must not re-mint ids that
 * already exist in the loaded graph (a restart previously OVERWROTE persisted objects
 * because counters restart at 1 while the store kept `rs_000006` etc.).
 */
export function bumpIdCounterPast(prefix: string, n: number): void {
  const current = COUNTERS.get(prefix) ?? 0;
  if (n > current) COUNTERS.set(prefix, n);
}

/** Parse the numeric suffix of a `prefix_NNNNNN` id; undefined when the id is foreign-shaped. */
function numericSuffix(id: string): number | undefined {
  const m = /_(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

export function newId(prefix: string): string {
  const next = (COUNTERS.get(prefix) ?? 0) + 1;
  COUNTERS.set(prefix, next);
  return `${prefix}_${String(next).padStart(6, "0")}`;
}

export const idPrefixes = {
  workspace: "ws",
  run: "run", // one user submission = one history run (see run-context.ts)
  research: "rs",
  branch: "br",
  claim: "cl",
  evidence: "ev",
  source: "src",
  hypothesis: "hy",
  analysis: "an",
  judgment: "jd",
  toolResult: "tr",
  thesis: "th",
  artifact: "sa",
  memory: "mem", // M5 research memory
  monitor: "mon", // M5 monitoring handoff
} as const;

/**
 * Restore counter continuity from a persisted object graph: for every known prefix, bump
 * the counter past the highest numeric suffix present among the loaded ids. MUST be called
 * whenever a workspace is restored from a snapshot (fromSnapshot) before any new object is
 * minted, or a restart will collide with (and overwrite) persisted objects.
 */
export function seedIdCountersFromIds(ids: readonly string[]): void {
  for (const id of ids) {
    if (typeof id !== "string" || id === "") continue; // tolerate malformed persisted entries — restoration must never throw
    const prefix = id.slice(0, id.lastIndexOf("_"));
    if (!prefix) continue;
    const n = numericSuffix(id);
    if (n !== undefined) bumpIdCounterPast(prefix, n);
  }
}
