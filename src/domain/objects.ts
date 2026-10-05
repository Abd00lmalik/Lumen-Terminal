/**
 * Research Object Model; the M0 object subset.
 *
 * Architectural basis: docs/architecture/research-object-model.md
 * - Object schemas (SOURCE/EVIDENCE/CLAIM/HYPOTHESIS/ANALYSIS/JUDGMENT/BRANCH/RESEARCH) per §2–9.
 * - §23 distinctions: Evidence ≠ Claim, Claim ≠ Hypothesis, Judgment ≠ Thesis, Research ≠ Conversation.
 * - §17 ownership: judgment belongs to a research context and has historical versions; one current.
 * - §19/§7 (object-lifecycle-state-machine.md): superseded judgments remain fully preserved.
 * - THESIS/FRAMEWORK/MONITOR/SNAPSHOT/ANNOTATION/SAVED_ARTIFACT are architecture objects but are
 *   deliberately NOT implemented in M0; they arrive with M3–M5 per IMPLEMENTATION_PLAN.md.
 */

import { newId, idPrefixes } from "./ids.js";
import { createProvenance, appendProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";
import { applyTransition, type ObjectKind, type ObjectStatus } from "./lifecycle.js";

export type ISO = string; // ISO-8601 timestamp

// ---------------------------------------------------------------------------
// SOURCE; the origin from which information was obtained (§6)
// ---------------------------------------------------------------------------

export interface Source {
  readonly id: string;
  readonly type: string;
  readonly locator?: string;
  readonly publisher?: string;
  readonly author?: string;
  readonly publishedAt?: ISO;
  readonly retrievedAt: ISO;
  readonly contentReference?: string;
  readonly reliability?: number; // 0..1, source-quality estimate; evidence weighting stays claim-specific
  readonly provenance: Provenance;
}

export function createSource(
  input: Pick<Source, "type" | "retrievedAt"> &
    Partial<Pick<Source, "locator" | "publisher" | "author" | "publishedAt" | "contentReference" | "reliability">>,
  origin: ProvenanceOrigin,
  at = new Date(),
): Source {
  return Object.freeze({
    id: newId(idPrefixes.source),
    type: input.type,
    ...(input.locator !== undefined ? { locator: input.locator } : {}),
    ...(input.publisher !== undefined ? { publisher: input.publisher } : {}),
    ...(input.author !== undefined ? { author: input.author } : {}),
    ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
    retrievedAt: input.retrievedAt,
    ...(input.contentReference !== undefined ? { contentReference: input.contentReference } : {}),
    ...(input.reliability !== undefined ? { reliability: input.reliability } : {}),
    provenance: createProvenance(origin, "source created", at),
  });
}

// ---------------------------------------------------------------------------
// EVIDENCE; observed/retrieved information bearing on a claim/hypothesis (§5)
// ---------------------------------------------------------------------------

/** Evidence class; observation vs interpretation is an architectural rule, not a nice-to-have. */
export type EvidenceClass =
  | "RAW_DATA"
  | "OBSERVATION"
  | "DERIVED_OBSERVATION"
  | "INTERPRETATION"
  | "PROXY_EVIDENCE"
  | "SPECULATION";

export type Freshness = "CURRENT" | "STALE" | "HISTORICAL";

/**
 * SOURCE CLASS (source classification): DIRECT_OBSERVATION vs REPORTED_CLAIM.
 *
 * An exchange price print, an OHLCV candle and a market-data series are direct observations of the
 * market. A news headline, an analyst statement and a company announcement reported by a secondary
 * source are REPORTED CLAIMS about it. Successful retrieval is not observation: an RSS headline that
 * arrived cleanly is still a claim, and labelling it an observation is what let a factual-timeline
 * request be answered with unrelated headlines. Resolved at the ingestion boundary from the
 * adapter's declared output/source class, never from the payload's wording.
 */
export type SourcingClass = "DIRECT_OBSERVATION" | "REPORTED_CLAIM";

export interface Evidence {
  readonly id: string;
  readonly observation: string;
  readonly evidenceType: string; // free-form domain tag, e.g. "price", "news", "sentiment", "macro"
  readonly evidenceClass: EvidenceClass;
  readonly sourceRefs: readonly string[];
  readonly timestamp?: ISO; // when the observed thing happened (event time)
  readonly observedAt: ISO; // when we obtained it
  readonly supports: readonly string[]; // claim ids
  readonly contradicts: readonly string[]; // claim ids
  readonly freshness: Freshness;
  /** Only for PROXY_EVIDENCE: what the proxy actually measures, per the market-intel lock. */
  readonly proxyBasis?: string;
  /** Tool-result provenance when this evidence came from a capability invocation. */
  readonly toolResultRef?: string;
  /**
   * Explicit subject/asset/entity the producing tool declared this output concerns (the
   * adapter's `about`). Carried so the target-relevance gate can honor a declaration that
   * the free-text observation never names (an indicator reading often omits its ticker).
   */
  readonly subject?: string;
  /**
   * Serving source identity for evidence-quality assessment (research contract §evidence
   * quality): the distinct origin this observation came from (a transport endpoint or, when
   * the payload names one, its publisher/upstream). Repeated reporting from the same origin
   * is never independent corroboration; distinct origins feed source diversity.
   */
  readonly sourceProvider?: string;
  /**
   * Source kind the adapter declared or that is derivable from the payload: PRIMARY (official
   * data/primary document), SECONDARY (reporting about it), COMMUNITY (social/community
   * signal), ANALYSIS (an authored interpretation). Undefined when nothing is known.
   */
  readonly sourceType?: "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS";
  /**
   * DIRECT_OBSERVATION vs REPORTED_CLAIM for this specific observation (source classification).
   * Set at ingestion from the adapter's declared output/source class. Undefined means the item was
   * never classified, which is NOT the same as being an observation.
   */
  readonly sourcing?: SourcingClass;
  /**
   * True when the adapter flagged this item as repeated content (same substance as another
   * item in the same result). A duplicate never ADDS source diversity — it is the same
   * underlying report, not independent corroboration.
   */
  readonly duplicateContent?: boolean;
  /**
   * RUN OWNERSHIP (provenance contract): the research object whose run retrieved this
   * observation. This is the AUTHORITATIVE relational owner — never inferred from a timestamp,
   * an id's numeric prefix, a capability name, or a source. Undefined only for evidence that
   * was never attached to a run (legacy records, tests, direct domain construction).
   *
   * Immutable once set: a later retrieval creates a NEW evidence record, it never re-parents
   * or overwrites an existing one. Answers, judgments and traceability are validated against
   * this field, so a run can only ever consume evidence it actually retrieved.
   */
  readonly researchRef?: string;
  readonly provenance: Provenance;
}

export function createEvidence(
  input: {
    observation: string;
    evidenceType: string;
    evidenceClass: EvidenceClass;
    sourceRefs?: readonly string[];
    timestamp?: ISO;
    supports?: readonly string[];
    contradicts?: readonly string[];
    freshness?: Freshness;
    proxyBasis?: string;
    toolResultRef?: string;
    /** Owning research object (see Evidence.researchRef); stamped by the workspace boundary. */
    researchRef?: string;
    subject?: string;
    sourceProvider?: string;
    sourceType?: "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS";
    sourcing?: SourcingClass;
    duplicateContent?: boolean;
  },
  origin: ProvenanceOrigin,
  at = new Date(),
): Evidence {
  if (input.evidenceClass === "PROXY_EVIDENCE" && !input.proxyBasis) {
    // Lock §5: "Proxy evidence must be explicitly labeled"; an unlabeled proxy must not exist.
    throw new Error("PROXY_EVIDENCE requires proxyBasis (what the proxy actually measures)");
  }
  return Object.freeze({
    id: newId(idPrefixes.evidence),
    observation: input.observation,
    evidenceType: input.evidenceType,
    evidenceClass: input.evidenceClass,
    sourceRefs: Object.freeze([...(input.sourceRefs ?? [])]),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
    observedAt: at.toISOString(),
    supports: Object.freeze([...(input.supports ?? [])]),
    contradicts: Object.freeze([...(input.contradicts ?? [])]),
    freshness: input.freshness ?? "CURRENT",
    ...(input.proxyBasis !== undefined ? { proxyBasis: input.proxyBasis } : {}),
    ...(input.toolResultRef !== undefined ? { toolResultRef: input.toolResultRef } : {}),
    ...(input.sourceProvider !== undefined ? { sourceProvider: input.sourceProvider } : {}),
    ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
    ...(input.sourcing !== undefined ? { sourcing: input.sourcing } : {}),
    ...(input.duplicateContent !== undefined ? { duplicateContent: input.duplicateContent } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.researchRef !== undefined ? { researchRef: input.researchRef } : {}),
    provenance: createProvenance(origin, `evidence classified as ${input.evidenceClass}`, at),
  });
}

// ---------------------------------------------------------------------------
// CLAIM; a proposition that requires evidence; not necessarily true (§4)
// ---------------------------------------------------------------------------

export interface Claim {
  readonly id: string;
  readonly statement: string;
  readonly type?: string;
  readonly evidenceRefs: readonly string[];
  readonly hypothesisRefs: readonly string[];
  readonly status: ObjectStatus;
  readonly provenance: Provenance;
}

export function createClaim(
  input: { statement: string; type?: string; hypothesisRefs?: readonly string[] },
  origin: ProvenanceOrigin,
  at = new Date(),
): Claim {
  return Object.freeze({
    id: newId(idPrefixes.claim),
    statement: input.statement,
    ...(input.type !== undefined ? { type: input.type } : {}),
    evidenceRefs: Object.freeze([]),
    hypothesisRefs: Object.freeze([...(input.hypothesisRefs ?? [])]),
    status: "UNTESTED",
    provenance: createProvenance(origin, "claim created", at),
  });
}

// ---------------------------------------------------------------------------
// HYPOTHESIS; candidate explanation; living object (§7)
// ---------------------------------------------------------------------------

export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly type: "CAUSAL" | "COMPARATIVE" | "PREDICTIVE" | "INTERPRETIVE";
  readonly supportingClaims: readonly string[];
  readonly contradictingClaims: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly alternatives: readonly string[];
  readonly ranking: number;
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly status: ObjectStatus;
  readonly provenance: Provenance;
}

export function createHypothesis(
  input: { statement: string; type?: Hypothesis["type"]; alternatives?: readonly string[] },
  origin: ProvenanceOrigin,
  at = new Date(),
): Hypothesis {
  return Object.freeze({
    id: newId(idPrefixes.hypothesis),
    statement: input.statement,
    type: input.type ?? "CAUSAL",
    supportingClaims: Object.freeze([]),
    contradictingClaims: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    alternatives: Object.freeze([...(input.alternatives ?? [])]),
    ranking: 0,
    status: "CANDIDATE",
    provenance: createProvenance(origin, "hypothesis created", at),
  });
}

// ---------------------------------------------------------------------------
// ANALYSIS; deliberate analytical operation; result of the ANALYZE action (§8)
// ---------------------------------------------------------------------------

export interface Analysis {
  readonly id: string;
  readonly objective: string;
  readonly mode: "COMPARE" | "EXPLAIN" | "INTERPRET" | "SYNTHESIZE";
  readonly targetRefs: readonly string[];
  readonly inputs: readonly string[];
  readonly findings: readonly string[];
  readonly conclusion: string;
  readonly uncertainty: readonly string[];
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly provenance: Provenance;
}

export function createAnalysis(
  input: {
    objective: string;
    mode: Analysis["mode"];
    targetRefs?: readonly string[];
    inputs?: readonly string[];
    findings?: readonly string[];
    conclusion: string;
    uncertainty?: readonly string[];
  },
  origin: ProvenanceOrigin,
  at = new Date(),
): Analysis {
  return Object.freeze({
    id: newId(idPrefixes.analysis),
    objective: input.objective,
    mode: input.mode,
    targetRefs: Object.freeze([...(input.targetRefs ?? [])]),
    inputs: Object.freeze([...(input.inputs ?? [])]),
    findings: Object.freeze([...(input.findings ?? [])]),
    conclusion: input.conclusion,
    uncertainty: Object.freeze([...(input.uncertainty ?? [])]),
    provenance: createProvenance(origin, `analysis (${input.mode}) created`, at),
  });
}

// ---------------------------------------------------------------------------
// JUDGMENT; current best-supported assessment; versioned through history (§9)
// ---------------------------------------------------------------------------

export interface JudgmentBasis {
  readonly supportingEvidence: readonly string[];
  readonly opposingEvidence: readonly string[];
  readonly keyClaims: readonly string[];
  readonly hypotheses: readonly string[];
}

export interface Judgment {
  readonly id: string;
  readonly statement: string;
  /**
   * RUN OWNERSHIP (provenance contract): the research object whose run produced this
   * judgment. Stamped at creation and immutable — a judgment may never be re-parented to
   * another run, and Current Judgment is resolved through this field rather than through a
   * global "latest judgment" query. A judgment without an owner can never become current.
   */
  readonly researchRef: string;
  readonly basis: JudgmentBasis;
  readonly confidence?: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  readonly implications: readonly string[];
  readonly unresolvedQuestions: readonly string[];
  readonly status: ObjectStatus;
  readonly provenance: Provenance;
}

export function createJudgment(
  input: {
    statement: string;
    /** Owning research object (see Judgment.researchRef). Required: an unowned judgment is not a conclusion of anything. */
    researchRef: string;
    basis: JudgmentBasis;
    confidence?: "HIGH" | "MODERATE" | "LOW";
    uncertainty?: readonly string[];
    implications?: readonly string[];
    unresolvedQuestions?: readonly string[];
  },
  origin: ProvenanceOrigin,
  at = new Date(),
): Judgment {
  return Object.freeze({
    id: newId(idPrefixes.judgment),
    statement: input.statement,
    researchRef: input.researchRef,
    basis: input.basis,
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    uncertainty: Object.freeze([...(input.uncertainty ?? [])]),
    implications: Object.freeze([...(implicationsOf(input))]),
    unresolvedQuestions: Object.freeze([...(input.unresolvedQuestions ?? [])]),
    status: "ACTIVE",
    provenance: createProvenance(origin, "judgment created", at),
  });
}

function implicationsOf(input: { implications?: readonly string[] }): readonly string[] {
  return input.implications ?? [];
}

// ---------------------------------------------------------------------------
// BRANCH; independent line of investigation (§3)
// ---------------------------------------------------------------------------

export interface Branch {
  readonly id: string;
  readonly researchRef: string;
  readonly objective: string;
  readonly hypothesisRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly claimRefs: readonly string[];
  readonly status: ObjectStatus;
  readonly priority: number;
  readonly createdFrom?: string;
  readonly provenance: Provenance;
}

export function createBranch(
  researchRef: string,
  objective: string,
  origin: ProvenanceOrigin,
  at = new Date(),
  createdFrom?: string,
): Branch {
  return Object.freeze({
    id: newId(idPrefixes.branch),
    researchRef,
    objective,
    hypothesisRefs: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    claimRefs: Object.freeze([]),
    status: "DRAFT",
    priority: 0,
    ...(createdFrom !== undefined ? { createdFrom } : {}),
    provenance: createProvenance(origin, "branch created", at),
  });
}

// ---------------------------------------------------------------------------
// RESEARCH; the primary investigation object (§2)
// ---------------------------------------------------------------------------

export interface Research {
  readonly id: string;
  readonly objective: string;
  readonly question: string;
  readonly flow: string; // one of the 8 locked flows (see research-flows.md)
  /**
   * The user submission this object belongs to. One trader question = one run, even when the
   * action plan / flow phases create several internal Research objects. History groups by
   * this id so intermediate tasks never appear as separate top-level questions.
   */
  readonly runId?: string;
  /** The trader's verbatim question for the run — the text history is allowed to show. */
  readonly userQuestion?: string;
  /**
   * INVESTIGATION CONVERSATION: the conversation this run belongs to. One turn of a multi-turn
   * investigation creates one run, and each run keeps its OWN evidence ownership — belonging to
   * the same conversation never makes two runs' evidence interchangeable.
   */
  readonly investigationRef?: string;
  readonly status: ObjectStatus;
  readonly branchRefs: readonly string[];
  readonly claimRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly hypothesisRefs: readonly string[];
  readonly analysisRefs: readonly string[];
  readonly judgmentRefs: readonly string[];
  readonly currentJudgmentRef?: string;
  readonly provenance: Provenance;
  readonly history: readonly string[]; // material transition notes
}

export function createResearch(
  input: { objective: string; question: string; flow: string; runId?: string; userQuestion?: string; investigationRef?: string },
  origin: ProvenanceOrigin,
  at = new Date(),
): Research {
  return Object.freeze({
    id: newId(idPrefixes.research),
    objective: input.objective,
    question: input.question,
    flow: input.flow,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.userQuestion !== undefined ? { userQuestion: input.userQuestion } : {}),
    ...(input.investigationRef !== undefined ? { investigationRef: input.investigationRef } : {}),
    status: "DRAFT",
    branchRefs: Object.freeze([]),
    claimRefs: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    hypothesisRefs: Object.freeze([]),
    analysisRefs: Object.freeze([]),
    judgmentRefs: Object.freeze([]),
    provenance: createProvenance(origin, "research created", at),
    history: Object.freeze([]),
  });
}

// ---------------------------------------------------------------------------
// Mutation helpers; immutable updates that preserve provenance and history.
// These keep frozen objects ergonomic without ever overwriting the past.
// ---------------------------------------------------------------------------

export function withStatus<T extends { status: ObjectStatus; provenance: Provenance }>(
  kind: ObjectKind,
  obj: T,
  to: ObjectStatus,
  origin: ProvenanceOrigin,
  note: string,
  at = new Date(),
): T {
  applyTransition(kind, obj.status, to); // throws on invalid transitions
  return Object.freeze({
    ...obj,
    status: to,
    provenance: appendProvenance(obj.provenance, origin, note, at),
  });
}

/** Append one ref to an array-valued property without mutating; preserves the object's own type. */
export function appendRef<T extends object, K extends keyof T & string>(
  obj: T,
  key: K,
  ref: string,
): T {
  const current: unknown = obj[key];
  if (!Array.isArray(current)) throw new Error(`appendRef: property ${String(key)} is not an array`);
  return Object.freeze({ ...obj, [key]: Object.freeze([...current, ref]) }) as T;
}

export function withProvenance<T extends { provenance: Provenance }>(
  obj: T,
  origin: ProvenanceOrigin,
  note?: string,
  at = new Date(),
): T {
  return Object.freeze({ ...obj, provenance: appendProvenance(obj.provenance, origin, note, at) });
}
