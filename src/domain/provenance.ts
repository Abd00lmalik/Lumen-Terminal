/**
 * Provenance; where information came from and how it entered the system.
 *
 * Architectural basis:
 * - docs/architecture/research-object-model.md §21 (provenance traversal: Judgment → Hypothesis →
 *   Claim → Evidence → Source must be followable without reconstructing reasoning).
 * - tool-skill-orchestration.md §37 (credentials stay out of research objects; this type carries
 *   references, never secrets) and §38 (material tool results preserve tool/provider/time/inputs).
 */

export type ProvenanceOrigin =
  | { kind: "system"; detail?: string }
  | { kind: "agent"; detail?: string }
  | { kind: "trader"; detail?: string }
  | { kind: "tool"; toolRef: string; invocation?: Record<string, unknown> };

export interface ProvenanceEntry {
  readonly at: string; // ISO timestamp
  readonly origin: ProvenanceOrigin;
  readonly note?: string;
}

/** Every domain object carries an immutable-ordered provenance trail. */
export type Provenance = readonly ProvenanceEntry[];

export function createProvenance(origin: ProvenanceOrigin, note?: string, at = new Date()): Provenance {
  const entry: ProvenanceEntry = { at: at.toISOString(), origin, ...(note !== undefined ? { note } : {}) };
  return Object.freeze([entry]);
}

export function appendProvenance(
  provenance: Provenance,
  origin: ProvenanceOrigin,
  note?: string,
  at = new Date(),
): Provenance {
  const entry: ProvenanceEntry = { at: at.toISOString(), origin, ...(note !== undefined ? { note } : {}) };
  return Object.freeze([...provenance, entry]);
}
