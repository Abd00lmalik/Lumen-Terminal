/**
 * Phase G: derive persistent CHALLENGE records from a Flow 7 falsification result.
 *
 * This is a DETERMINISTIC product/domain layer over Flow 7 — never a second research engine:
 * - Every challenge cites the engine's own objects (evidence ids validated against the graph;
 *   unknown refs are dropped, never invented).
 * - Epistemic honesty: PROPOSED falsifier conditions stay labeled; "nothing found" produces no
 *   fabricated challenge; a proposed target with no observed condition becomes an
 *   INFORMATION_GAP only when the model itself said what is unknown (via earlyWarnings), not
 *   merely because a data point is missing (uncertainty ≠ falsifier).
 * - Materiality: a challenge is recorded for MEANINGFUL_WARNING and above (M4 §21: one weak
 *   source is MINOR and does not become a warning record).
 * - Freshness: staleness is judged from the CITED evidence's own freshness flags (STALE/
 *   HISTORICAL), never from wall-clock age alone; an old conflicting article whose evidence
 *   object is CURRENT is not degraded by age.
 * - The thesis object is never touched: challenges reference thesisId + thesisVersion only.
 */
import type { FalsificationAssessment, Flow7Result } from "../research/flow7.js";
import type { Workspace } from "../domain/workspace.js";
import type { Challenge, ChallengeFalsifier, ChallengeMateriality, ChallengeStatus } from "../domain/challenge.js";

/** Deterministic status from the engine's own facts. */
export function deriveChallengeStatus(input: {
  readonly conditionObserved: boolean;
  readonly hasCounterEvidence: boolean;
  readonly citedEvidenceStale: boolean;
  readonly hasGaps: boolean;
}): ChallengeStatus {
  if (input.citedEvidenceStale) return "STALE";
  if (input.hasCounterEvidence) return "CONTRADICTION";
  if (input.conditionObserved) return "ACTIVE";
  if (input.hasGaps) return "INFORMATION_GAP";
  return "ACTIVE";
}

/**
 * Map one Flow 7 falsification target (+ its contradiction, when the model linked them through
 * the same assumption) to a Challenge record. Returns undefined when materiality/honesty rules
 * say this must NOT become a persistent warning.
 */
export function challengeFromFalsificationTarget(input: {
  readonly assessment: FalsificationAssessment;
  readonly target: FalsificationAssessment["falsificationTargets"][number];
  readonly workspace: Workspace;
  readonly thesisId: string;
  readonly thesisVersion: number;
  readonly researchRef: string;
}): Challenge | undefined {
  const { assessment, target, workspace } = input;

  // MATERIALITY GATE: MINOR disagreement never becomes a persistent challenge (no endless
  // warnings; M4 §21). Contradictions grade MEANINGFUL_WARNING and above.
  const contradiction = assessment.contradictionsFound.find(
    (c) => c.materiality !== "MINOR" && (c.objectRefs.length > 0 || target.objectRefs.length > 0),
  );
  // Record gate: the thesis's OWN condition (DERIVED_FROM_BELIEF) is always worth watching;
  // a non-MINOR contradiction justifies a record; a PROPOSED condition only when the model
  // gave honest unknown-context (early warnings / explicit no-contradiction note) — a bare
  // proposed threshold with no context is noise, not a challenge (no endless warnings).
  const hasHonestGapContext = assessment.earlyWarnings.length > 0 || assessment.noCredibleContradictionFound;
  const meaningful = target.conditionStatus === "DERIVED_FROM_BELIEF" || contradiction !== undefined || hasHonestGapContext;
  if (!meaningful) return undefined;

  // Evidence refs: validated against the graph (never invented). Supporting = the run's cited
  // evidence; counter = evidence the engine flagged as contradicting + the contradiction's refs.
  const supporting = assessment.citedObjectRefs.filter((ref) => workspace.getEvidence(ref) !== undefined);
  const counterRefs = new Set<string>([
    ...target.objectRefs.filter((ref) => workspace.getEvidence(ref) !== undefined),
    ...(contradiction?.objectRefs.filter((ref) => workspace.getEvidence(ref) !== undefined) ?? []),
  ]);

  // Freshness from the cited evidence's OWN flags, judged on the basis that CARRIES the
  // challenge: the counter evidence when present (an old conflicting article is NOT an active
  // falsifier without a freshness check), else all cited refs. An old-but-CURRENT source
  // stays active regardless of its age; staleness is never wall-clock.
  const allCited = [...supporting, ...counterRefs];
  const basisRefs = counterRefs.size > 0 ? [...counterRefs] : allCited;
  const citedEvidenceStale = basisRefs.length > 0 && basisRefs.every((ref) => {
    const e = workspace.getEvidence(ref);
    return e !== undefined && e.freshness !== "CURRENT";
  });

  // Condition observed: the contradiction exists in the graph, or the model reported the
  // condition as present with citations. A PROPOSED condition nobody observed is not "observed".
  const conditionObserved = counterRefs.size > 0;

  // Information gaps: only HONEST unknowns — the run's own unavailability/limitations and the
  // model's declared early warnings, not invented "missing data points".
  const informationGaps = [
    ...flowOutcomeGaps(assessment, target),
  ];

  const falsifier: ChallengeFalsifier = {
    condition: target.condition,
    attacksClaim: target.attacksAssumption,
    origin: target.conditionStatus,
    // Materiality grades the falsifier's POTENTIAL impact (M4 §21 ladder). With no mapped
    // contradiction: a thesis-derived condition is at least a meaningful warning; a PROPOSED
    // unobserved threshold stays MEANINGFUL_WARNING and carries its PROPOSED label + gap note
    // (never INVALIDATING: nothing established was contradicted).
    materiality: (contradiction?.materiality ?? "MEANINGFUL_WARNING") as ChallengeMateriality,
  };

  const status = deriveChallengeStatus({
    conditionObserved,
    hasCounterEvidence: counterRefs.size > 0,
    citedEvidenceStale,
    hasGaps: informationGaps.length > 0,
  });

  return {
    id: "", // minted by Workspace.recordChallenges via createChallenge
    thesisId: input.thesisId,
    thesisVersion: input.thesisVersion,
    claim: contradiction !== undefined ? contradiction.description : `If the thesis's own condition fails: ${target.condition}`,
    falsifier,
    status,
    materialityRationale: contradiction?.rationale ?? assessment.rationale,
    supportingEvidenceRefs: supporting,
    counterEvidenceRefs: [...counterRefs],
    informationGaps,
    conditionObserved,
    fingerprint: "", // computed by createChallenge
    researchRef: input.researchRef,
    assessment: assessment.currentAssessment,
    provenance: [], // created by createChallenge
    createdAt: "",
    updatedAt: "",
  } as unknown as Challenge;
}

/** Honest unknowns only: model-declared early warnings + proposed-condition caveats. */
function flowOutcomeGaps(assessment: FalsificationAssessment, target: { readonly conditionStatus: string }): readonly string[] {
  const gaps: string[] = [];
  if (assessment.noCredibleContradictionFound) gaps.push("no credible contradiction was found in the researched context; this is NOT confirmation");
  for (const w of assessment.earlyWarnings.slice(0, 2)) gaps.push(`early warning (unverified): ${w}`);
  if (target.conditionStatus === "PROPOSED") gaps.push("falsification threshold is PROPOSED by the model, not derived from the thesis; it is not an established number");
  return gaps;
}

/**
 * Derive the full challenge generation from a Flow 7 result and record it in the workspace
 * (idempotent by fingerprint; superseded challenges go STALE). Returns the written records.
 * Never called when the flow failed: a model failure yields NO challenges (fail-closed).
 */
export function recordChallengesFromFlow7(result: Flow7Result, workspace: Workspace, thesisId: string, thesisVersion: number, origin: import("../domain/provenance.js").ProvenanceOrigin, at?: Date): readonly Challenge[] {
  // Fail-closed: a model failure / failed assessment asserts nothing — no challenges derive.
  if (result.modelFailure !== undefined) return [];
  const assessment = result.assessment;
  if (assessment === undefined) return [];
  const researchRef = result.outcome.researchId;
  if (researchRef === "n/a") return [];
  const derived: Parameters<typeof import("../domain/challenge.js").createChallenge>[0][] = [];
  for (const target of assessment.falsificationTargets) {
    const challenge = challengeFromFalsificationTarget({ assessment, target, workspace, thesisId, thesisVersion, researchRef });
    if (challenge !== undefined) derived.push(toCreateInput(challenge));
  }
  if (derived.length === 0) return [];
  return workspace.recordChallenges(derived, origin, at);
}

/** Adapt a mapped Challenge-shaped object into createChallenge input (drops minted fields). */
function toCreateInput(c: Challenge): Parameters<Workspace["recordChallenges"]>[0][number] {
  return {
    thesisId: c.thesisId,
    thesisVersion: c.thesisVersion,
    claim: c.claim,
    falsifier: c.falsifier,
    status: c.status,
    materialityRationale: c.materialityRationale,
    supportingEvidenceRefs: c.supportingEvidenceRefs,
    counterEvidenceRefs: c.counterEvidenceRefs,
    informationGaps: [...c.informationGaps],
    conditionObserved: c.conditionObserved,
    researchRef: c.researchRef,
    assessment: c.assessment,
  };
}
