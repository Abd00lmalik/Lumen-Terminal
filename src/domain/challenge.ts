/**
 * Phase G: CHALLENGE — persistent falsification records over Flow 7 (WHAT_COULD_PROVE_ME_WRONG).
 *
 * Architectural basis:
 * - research-flows.md FLOW 7 + thesis.md: an assessment ABOUT a thesis is never a mutation of
 *   the thesis. A Challenge is a RESEARCH RESULT about the thesis (the ThesisAssessmentRecord
 *   analogue for falsification); it can never change thesis statement, status, or version.
 * - M4 §19/§20/§21 honesty rules carry over: proposed conditions stay labeled PROPOSED;
 *   "nothing found" is not confirmation; one weak source is MINOR, not INVALIDATING.
 * - FINITE BY CONSTRUCTION: a challenge exists only when Flow 7 produced one; every field
 *   carries the evidence refs that justify it; deduplication (fingerprint) prevents endless
 *   re-warning across refreshes; staleness is derived from evidence freshness, not from age.
 * - Epistemic distinctions preserved: observations/interpretations stay in Evidence objects —
 *   a challenge references them by id and NEVER restates their content as its own claim.
 *
 * Object chain (brief §Model): THESIS → CLAIM → SUPPORTING EVIDENCE → COUNTEREVIDENCE →
 * FALSIFIER → MATERIAL CONDITION → INFORMATION GAP → CHALLENGE STATUS.
 */
import { newId, idPrefixes } from "./ids.js";
import { createProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";
import type { ISO } from "./objects.js";

/**
 * Challenge lifecycle. Distinct from ThesisStatus (the thesis's own state) and from
 * ThesisAssessmentStatus (the run's overall verdict vocabulary).
 *
 * - ACTIVE: currently observed, materially relevant.
 * - CONTRADICTION: engine-evaluated counter-evidence exists in the cited graph objects.
 * - INFORMATION_GAP: what is unknown, not a data error; gaps are recorded honestly.
 * - STALE: the challenge's cited evidence has gone STALE/HISTORICAL (re-derive or resolve;
 *   freshness is judged by the engine, never by wall-clock age alone).
 * - RESOLVED: the cited evidence no longer supports the challenge (resolved on RE-derivation
 *   by Flow 7 only — never by a model assertion alone).
 */
export type ChallengeStatus = "ACTIVE" | "RESOLVED" | "STALE" | "INFORMATION_GAP" | "CONTRADICTION";

/**
 * Deterministic transitions. Active/contradiction/gap states re-evaluate on every research
 * refresh; STALE/RESOLVED are terminal-unless-researched (a new Flow 7 pass re-derives).
 */
export const CHALLENGE_TRANSITIONS: Readonly<Record<ChallengeStatus, readonly ChallengeStatus[]>> = Object.freeze({
  ACTIVE: ["CONTRADICTION", "INFORMATION_GAP", "STALE", "RESOLVED"],
  CONTRADICTION: ["ACTIVE", "STALE", "RESOLVED"],
  INFORMATION_GAP: ["ACTIVE", "CONTRADICTION", "STALE", "RESOLVED"],
  STALE: ["ACTIVE", "RESOLVED"],
  RESOLVED: ["ACTIVE"], // only new research may re-open a resolved challenge
});

export function challengeTransitionAllowed(from: ChallengeStatus, to: ChallengeStatus): boolean {
  return (CHALLENGE_TRANSITIONS[from] ?? []).includes(to);
}

/** Falsifier strength uses Flow 7's materiality ladder verbatim (M4 §21; no new taxonomy). */
export type ChallengeMateriality = "MINOR" | "MEANINGFUL_WARNING" | "MATERIAL_CONTRADICTION" | "INVALIDATING";

export interface ChallengeFalsifier {
  /** The concrete condition/development that would weaken or invalidate the thesis. */
  readonly condition: string;
  /** Which claim/assumption of the thesis this attacks (thesis claim text; refs stay in evidenceRefs). */
  readonly attacksClaim: string;
  /** DERIVED_FROM_BELIEF: from the thesis's own statements; PROPOSED: model-proposed, labeled. */
  readonly origin: "DERIVED_FROM_BELIEF" | "PROPOSED";
  /** Flow 7 materiality grade for this falsifier. */
  readonly materiality: ChallengeMateriality;
}

export interface Challenge {
  readonly id: string;
  /** The challenged thesis (ref only; the thesis object is never copied or mutated). */
  readonly thesisId: string;
  /** Exact thesis version at challenge time (provenance chain: challenge → thesis version). */
  readonly thesisVersion: number;
  /** Short statement of what part of the thesis this challenges (WHY it could matter). */
  readonly claim: string;
  /** The falsifier: what would actually falsify or materially weaken the thesis. */
  readonly falsifier: ChallengeFalsifier;
  /** Deterministic status (above). */
  readonly status: ChallengeStatus;
  /** Why this could matter (materiality rationale in trader language). */
  readonly materialityRationale: string;
  /** Supporting evidence FOR the thesis (refs only; the engine owns the objects). */
  readonly supportingEvidenceRefs: readonly string[];
  /** Counter-evidence AGAINST the thesis (refs only). */
  readonly counterEvidenceRefs: readonly string[];
  /** What remains unknown (information gaps; text + refs, never fabricated data). */
  readonly informationGaps: readonly string[];
  /** Whether the falsifying condition is currently observed in the cited evidence. */
  readonly conditionObserved: boolean;
  /** Idempotency fingerprint (below): stable across refreshes for the same challenge shape. */
  readonly fingerprint: string;
  /** The Flow 7 research run this challenge was derived from (provenance). */
  readonly researchRef: string;
  /** Overall Flow 7 assessment vocabulary (the run's verdict, separate from this challenge). */
  readonly assessment: "SUPPORTED" | "WEAKENED" | "MATERIALLY_CHALLENGED" | "UNSUPPORTED" | "INDETERMINATE";
  readonly provenance: Provenance;
  readonly createdAt: ISO;
  readonly updatedAt: ISO;
}

/**
 * Stable idempotency fingerprint: the same falsifier against the same thesis claim must not
 * multiply across refreshes (NO ENDLESS WARNINGS). Deliberately excludes status/timestamps/
 * evidence-ref sets (those change legitimately between runs); covers the challenge IDENTITY.
 */
export function challengeFingerprint(input: {
  thesisId: string;
  claim: string;
  falsifier: Pick<ChallengeFalsifier, "condition" | "attacksClaim" | "origin">;
}): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const material = JSON.stringify([
    norm(input.thesisId),
    norm(input.claim),
    norm(input.falsifier.condition),
    norm(input.falsifier.attacksClaim),
    input.falsifier.origin,
  ]);
  // FNV-1a (deterministic, dependency-free); hex output keeps the record readable.
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Structural validation on load: a malformed persisted challenge is normalized, never guessed. */
export function normalizeChallenge(c: Challenge): Challenge {
  const raw = c as Partial<Challenge>;
  return {
    ...c,
    status: raw.status ?? "ACTIVE",
    supportingEvidenceRefs: Array.isArray(raw.supportingEvidenceRefs) ? raw.supportingEvidenceRefs : [],
    counterEvidenceRefs: Array.isArray(raw.counterEvidenceRefs) ? raw.counterEvidenceRefs : [],
    informationGaps: Array.isArray(raw.informationGaps) ? raw.informationGaps : [],
    conditionObserved: raw.conditionObserved ?? false,
    provenance: Array.isArray(raw.provenance) ? raw.provenance : createProvenance({ kind: "system", detail: "challenge normalized on load" }),
    createdAt: raw.createdAt ?? raw.updatedAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date(0).toISOString(),
  };
}

export function createChallenge(
  input: {
    thesisId: string;
    thesisVersion: number;
    claim: string;
    falsifier: ChallengeFalsifier;
    status: ChallengeStatus;
    materialityRationale: string;
    supportingEvidenceRefs: readonly string[];
    counterEvidenceRefs: readonly string[];
    informationGaps: readonly string[];
    conditionObserved: boolean;
    researchRef: string;
    assessment: Challenge["assessment"];
  },
  origin: ProvenanceOrigin,
  at?: Date,
): Challenge {
  const now = (at ?? new Date()).toISOString();
  return Object.freeze({
    id: newId(idPrefixes.challenge),
    thesisId: input.thesisId,
    thesisVersion: input.thesisVersion,
    claim: input.claim,
    falsifier: input.falsifier,
    status: input.status,
    materialityRationale: input.materialityRationale,
    supportingEvidenceRefs: Object.freeze([...input.supportingEvidenceRefs]),
    counterEvidenceRefs: Object.freeze([...input.counterEvidenceRefs]),
    informationGaps: Object.freeze([...input.informationGaps]),
    conditionObserved: input.conditionObserved,
    fingerprint: challengeFingerprint({ thesisId: input.thesisId, claim: input.claim, falsifier: input.falsifier }),
    researchRef: input.researchRef,
    assessment: input.assessment,
    provenance: createProvenance(
      origin,
      `challenge derived from Flow 7 run (${input.researchRef}); thesis object unchanged`,
      at,
    ),
    createdAt: now,
    updatedAt: now,
  });
}
