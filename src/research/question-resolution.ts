/**
 * QUESTION RESOLUTION (research contract: QUESTION RESOLUTION ≠ EVIDENCE COLLECTION).
 *
 * Evidence quality alone never proves the trader's information need was met. This module
 * derives the question's decision intent and required answer dimensions from its own wording,
 * evaluates whether the ledger + prose actually resolve those dimensions, and produces an
 * actionable insight structure (what evidence shows / does not show / what it means / what
 * would change / what to watch) without ever issuing buy/sell instructions.
 *
 * Deterministic and generic: intents and dimensions describe QUESTION SHAPES, never assets,
 * topics, or individual questions. One evaluator shared by the adaptive loop and every
 * flow-routed path through the contract boundary.
 */
import { sentencesOf } from "./contract-checks.js";
import { deriveCausalLinkStatuses } from "./causal.js";
import { domainOfEvidenceType, type EvidenceDomain, type ResearchRequirement } from "./requirements.js";

// ---------------------------------------------------------------------------
// Intent (extends the existing questionTypeOf / LUI flow vocabulary)
// ---------------------------------------------------------------------------

export type QuestionIntent =
  | "CURRENT_STATE"
  | "WHAT_HAPPENED"
  | "CURRENT_DRIVERS"
  | "WHY_DID_IT_HAPPEN"
  | "WHAT_COULD_AFFECT_IT"
  | "HISTORICAL_COMPARISON"
  | "THESIS_EVALUATION"
  | "FALSIFICATION"
  | "FRAMEWORK_EVALUATION"
  | "CROSS_DOMAIN_SYNTHESIS";

/**
 * The question's decision intent, read from its own wording. Order is most-specific-first:
 * a falsification question may also mention history, but falsification is what must resolve.
 * Patterns describe question shapes (test a belief, explain a move, compare periods), never
 * assets or topics.
 */
export function questionIntentOf(question: string): QuestionIntent {
  const q = question.toLowerCase();
  if (/\bprove\b.*\bwrong\b|\binvalidate\b|\bfalsif\w*|\bwhat would change\b|\bdisconfirm\w*|\bwhat could prove\b|\bprove me wrong\b/.test(q)) {
    return "FALSIFICATION";
  }
  if (/\bmy framework\b|\bagainst my framework\b|\busing my framework\b|\bframework criteria\b|\bevaluate with my\b|\bmy (rules|criteria|checklist)\b|\bmy \w+ framework\b|\bagainst \w+ framework\b|\bevaluate.*\bframework\b|\bsaved framework\b/.test(q)) {
    return "FRAMEWORK_EVALUATION";
  }
  if (/\bmy thesis\b|\bthesis\b|\bdoes (this|the|my) (thesis|view|position|read|call)\b|\bstill hold\b|\bdoes my\b|\bmy (view|position|read|call)\b/.test(q)) {
    return "THESIS_EVALUATION";
  }
  if (/\bhas (this|it|that)\b.*\bhappened\b|\bhappened before\b|\bhistor\w*|\bsimilar setup\b|\banalog\w*|\bcompared? (with|to)\b|\bversus\b|\bvs\.?\b|\bweek over week\b|\bprevious (week|month|period)\b|\blast (week|year|time|period)\b|\bbetter than\b|\bperformance (vs|versus)\b|\brelative to\b/.test(q)) {
    return "HISTORICAL_COMPARISON";
  }
  if (/\bwhat could affect\b|\bwhat factors could\b|\baround (its|his|her|their) next\b|\bupcoming\b|\bcatalysts?\b|\bwhat might\b.*\baffect\b|\brisks? (to|for)\b|\bpotential(ly)?\b.*\b(impact|affect|move)\b/.test(q)) {
    return "WHAT_COULD_AFFECT_IT";
  }
  if (/\bwhy (did|has|have|is|are|was|were|do|does)\b|\bwhy\b.*\b(move|drop|rally|fall|crash|surge|change)\b|\bwhat caused\b|\bwhat drove\b|\bwhat.s behind\b|\bexplain(ing)?\b.*\b(move|drop|rally|fall|crash|surge)\b/.test(q)) {
    return "WHY_DID_IT_HAPPEN";
  }
  if (/\bwhat happened\b|\bwhat has happened\b|\bwhat.s happened\b/.test(q)) {
    return "WHAT_HAPPENED";
  }
  // Synthesis wording outranks a bare "drivers" mention: "synthesize all the information on
  // current inflation drivers" is a cross-domain overview, not a pure CURRENT_DRIVERS ask.
  if (/\ball (the )?(information|evidence|data|research)\b|\bsynthesi[sz]e\b|\bwhat does .* say\b|\beverything\b|\boverview\b|\bcross[- ]domain\b/.test(q)) {
    return "CROSS_DOMAIN_SYNTHESIS";
  }
  if (/\bdriv\w*|\bdriving\b|\bpressur\w*|\bpushing\b|\bbehind\b.*\bprices?\b|\bwhat is moving\b|\bmain (factors|drivers)\b|\bwhat.s (moving|pushing|pressuring)\b/.test(q)) {
    return "CURRENT_DRIVERS";
  }
  if (/\bright now\b|\bcurrently\b|\bcurrent (state|condition|status|level|price|regime)\b|\bas of now\b|\btoday\b|\bhow is\b.*\btrading\b|\bstate of\b|\bconditions?\b.*\b(risk|market|macro)\b/.test(q)) {
    return "CURRENT_STATE";
  }
  if (/\bwhat is\b|\bwhat's\b|\bhow are\b|\bstatus of\b/.test(q)) return "CURRENT_STATE";
  return "CROSS_DOMAIN_SYNTHESIS";
}

// ---------------------------------------------------------------------------
// Temporal scope (generic wording → evidence recency window)
// ---------------------------------------------------------------------------

export type TemporalScope = "CURRENT" | "WEEKLY" | "MONTHLY" | "HISTORICAL" | "ANY";

const TEMPORAL_WINDOWS: readonly { readonly scope: TemporalScope; readonly pattern: RegExp }[] = [
  { scope: "CURRENT", pattern: /\b(right now|currently|tonight|intraday|at the moment|this very moment|today|yesterday)\b/i },
  { scope: "WEEKLY", pattern: /\b(this week|week to date|this-week|weekly)\b/i },
  { scope: "MONTHLY", pattern: /\b(this month|month to date|monthly)\b/i },
  { scope: "HISTORICAL", pattern: /\b(last year|histor\w*|previous year|in the past|before|last time|last week|last month)\b/i },
];

/** Generic recency window the question's own temporal wording names (no asset branches). */
export function temporalScopeOf(question: string): TemporalScope {
  for (const { scope, pattern } of TEMPORAL_WINDOWS) if (pattern.test(question)) return scope;
  return "ANY";
}

/** Days a scope tolerates for CURRENT/RECENT requirement satisfaction (mirrors explicit windows). */
export function scopeMaxAgeDays(scope: TemporalScope): number | undefined {
  switch (scope) {
    case "CURRENT": return 3;
    case "WEEKLY": return 7;
    case "MONTHLY": return 31;
    case "HISTORICAL": return undefined;
    case "ANY": return undefined;
  }
}

// ---------------------------------------------------------------------------
// Required answer dimensions per intent
// ---------------------------------------------------------------------------

export type AnswerDimension =
  | "CURRENT_STATE"
  | "WHAT_HAPPENED"
  | "CURRENT_DRIVERS"
  | "DRIVER_RELATIONSHIP"
  | "FORWARD_FACTORS"
  | "HISTORICAL_EPISODE"
  | "COMPARISON_BASELINE"
  | "THESIS_SUPPORT"
  | "THESIS_CHALLENGE"
  | "FALSIFICATION_CONDITIONS"
  | "FRAMEWORK_CRITERIA"
  | "CROSS_DOMAIN_COVERAGE"
  | "RECENCY"
  | "COUNTEREVIDENCE"
  | "MATERIALITY";

const REQUIRED_DIMENSIONS: Readonly<Record<QuestionIntent, readonly AnswerDimension[]>> = {
  CURRENT_STATE: ["CURRENT_STATE", "RECENCY", "MATERIALITY"],
  WHAT_HAPPENED: ["WHAT_HAPPENED", "RECENCY", "MATERIALITY"],
  CURRENT_DRIVERS: ["CURRENT_DRIVERS", "DRIVER_RELATIONSHIP", "RECENCY", "MATERIALITY", "COUNTEREVIDENCE"],
  WHY_DID_IT_HAPPEN: ["WHAT_HAPPENED", "CURRENT_DRIVERS", "DRIVER_RELATIONSHIP", "RECENCY", "MATERIALITY", "COUNTEREVIDENCE"],
  WHAT_COULD_AFFECT_IT: ["FORWARD_FACTORS", "MATERIALITY", "COUNTEREVIDENCE"],
  HISTORICAL_COMPARISON: ["HISTORICAL_EPISODE", "COMPARISON_BASELINE", "MATERIALITY"],
  THESIS_EVALUATION: ["THESIS_SUPPORT", "THESIS_CHALLENGE", "RECENCY", "MATERIALITY"],
  FALSIFICATION: ["FALSIFICATION_CONDITIONS", "COUNTEREVIDENCE", "MATERIALITY"],
  FRAMEWORK_EVALUATION: ["FRAMEWORK_CRITERIA", "MATERIALITY", "COUNTEREVIDENCE"],
  CROSS_DOMAIN_SYNTHESIS: ["CROSS_DOMAIN_COVERAGE", "MATERIALITY", "COUNTEREVIDENCE"],
};

/** Dimensions a bounded recovery round may target when missing (mandate recovery set). */
export const RECOVERY_TARGET_DIMENSIONS: ReadonlySet<AnswerDimension> = new Set<AnswerDimension>([
  "CURRENT_DRIVERS",
  "RECENCY",
  "DRIVER_RELATIONSHIP",
  "COUNTEREVIDENCE",
  "MATERIALITY",
]);

export function requiredDimensionsFor(intent: QuestionIntent): readonly AnswerDimension[] {
  return REQUIRED_DIMENSIONS[intent];
}

// ---------------------------------------------------------------------------
// Materiality ladder and epistemic claim levels
// ---------------------------------------------------------------------------

export type MaterialityLevel = "NONE" | "OBSERVED" | "RELEVANT" | "MATERIAL" | "CURRENTLY_ACTIVE";

const MATERIALITY_ORDER: Readonly<Record<MaterialityLevel, number>> = {
  NONE: 0, OBSERVED: 1, RELEVANT: 2, MATERIAL: 3, CURRENTLY_ACTIVE: 4,
};

export function materialityAtLeast(level: MaterialityLevel, minimum: MaterialityLevel): boolean {
  return MATERIALITY_ORDER[level] >= MATERIALITY_ORDER[minimum];
}

export type EpistemicLevel =
  | "OBSERVATION"
  | "ANALYTICAL_CLAIM"
  | "DRIVER_CLAIM"
  | "COMPARATIVE_DRIVER_JUDGMENT";

const DRIVER_MARKERS =
  /\b(driven by|drives|drove|because of|due to|as a result|leading to|causing|pushed|pushing|pressuring|behind|stemming from|on the back of|fuelling|fueling|transmit\w*|pass[- ]through)\b/i;
const COMPARATIVE_MARKERS =
  /\b(more than|less than|compared with|compared to|relative to|versus|vs\.?|outperformed|underperformed|widened|narrowed|higher than|lower than|week[- ]over[- ]week|month[- ]over[- ]month)\b/i;
const ANALYTICAL_MARKERS =
  /\b(suggests?|indicates?|implies?|points? to|signals?|reads as|appears|likely|probably|may|might|could|consistent with)\b/i;

/** Deterministic epistemic level for one answer claim (never upgrades observation to cause). */
export function classifyClaimLevel(sentence: string): EpistemicLevel {
  const comparative = COMPARATIVE_MARKERS.test(sentence);
  const driver = DRIVER_MARKERS.test(sentence);
  if (comparative && driver) return "COMPARATIVE_DRIVER_JUDGMENT";
  if (comparative && /\b(factor|driver|pressure|boost|headwind|tailwind|regime)\b/i.test(sentence)) {
    return "COMPARATIVE_DRIVER_JUDGMENT";
  }
  if (driver) return "DRIVER_CLAIM";
  if (ANALYTICAL_MARKERS.test(sentence)) return "ANALYTICAL_CLAIM";
  return "OBSERVATION";
}

export interface AnswerClaim {
  readonly text: string;
  readonly level: EpistemicLevel;
  readonly evidenceRefs: readonly string[];
}

/** Split prose into claims and tag each with its epistemic level and cited evidence refs. */
export function extractAnswerClaims(prose: string): readonly AnswerClaim[] {
  if (prose.trim() === "") return [];
  return sentencesOf(prose).map((text) => ({
    text,
    level: classifyClaimLevel(text),
    evidenceRefs: [...new Set(text.match(/ev_\d+/g) ?? [])],
  }));
}

// ---------------------------------------------------------------------------
// Actionable insight (no buy/sell instructions)
// ---------------------------------------------------------------------------

export interface ActionableInsight {
  readonly whatEvidenceShows: readonly string[];
  readonly whatEvidenceDoesNotShow: readonly string[];
  readonly whatItMeans: string;
  readonly whatWouldChangeConclusion: readonly string[];
  readonly watchItems: readonly string[];
}

/**
 * Imperative trade directives the insight must never contain (trader decides). Noun uses
 * like "sell-off" or "long-term" are not instructions and must not trip this pattern.
 */
const TRADE_DIRECTIVE =
  /\b(you should|we recommend|time to|go long|go short|buy now|sell now|open a (long|short|position)|enter a (long|short|trade|position)|place an? (order|buy|sell)|take a (long|short)|buy|sell)\s+(now|immediately|today)\b|\byou should\s+(buy|sell|go long|go short)\b|\bgo (long|short)\b|\bopen a (long|short)\b|\btime to (buy|sell)\b/i;

/** True when the prose contains an imperative buy/sell instruction (benchmark failure). */
export function containsTradeDirective(prose: string): boolean {
  return TRADE_DIRECTIVE.test(prose);
}

const WHAT_WOULD_CHANGE =
  /what would change this view:?\s*(.+?)(?:\n\n|$)/i;
const MEANS_MARKERS = /\b(means?|implies?|therefore|thus|so that|matters because|for the trader|suggests that|signals that)\b/i;

function extractWouldChange(prose: string): readonly string[] {
  const match = WHAT_WOULD_CHANGE.exec(prose);
  if (match?.[1] !== undefined) {
    return match[1].split(/;\s*|\.\s+/).map((s) => s.trim()).filter((s) => s !== "").slice(0, 6);
  }
  return sentencesOf(prose)
    .filter((s) => /\bwould change\b|\binvalidat\w*|\bbreaks?\b|\bfails?\b/i.test(s))
    .slice(0, 4);
}

function extractMeans(prose: string): string {
  const sentence = sentencesOf(prose).find((s) => MEANS_MARKERS.test(s) && /ev_\d+|\d/.test(s));
  return sentence ?? sentencesOf(prose).find((s) => MEANS_MARKERS.test(s)) ?? "";
}

/**
 * Deterministic means/watch fallbacks when the trader-facing prose is a stripped gap
 * statement (or too thin to carry "that means" / "what to watch" markers). Still engine-owned
 * and trade-directive free: they name the ledger's satisfied vs unresolved dimensions.
 */
function deriveMeansFallback(dimensions: readonly DimensionStatus[], materiality: MaterialityLevel): string {
  const satisfied = dimensions.filter((d) => d.fit === "SATISFIED" && d.dimension !== "MATERIALITY").map((d) => d.dimension);
  const unresolved = dimensions.filter((d) => d.fit === "MISSING" || d.fit === "PARTIAL").map((d) => d.dimension);
  if (satisfied.length === 0 && unresolved.length === 0) return "";
  const shows = satisfied.length > 0 ? `the evidence addresses ${satisfied.slice(0, 3).map((d) => d.replaceAll("_", " ").toLowerCase()).join(", ")}` : "no required dimension is fully established";
  const gaps = unresolved.length > 0 ? ` while ${unresolved.slice(0, 3).map((d) => d.replaceAll("_", " ").toLowerCase()).join(", ")} remain open` : "";
  return `For the trader this means ${shows}${gaps}; materiality sits at ${materiality.toLowerCase()}, so the read is provisional until the open dimensions close.`;
}

function deriveWouldChangeFallback(unresolved: readonly AnswerDimension[]): readonly string[] {
  return unresolved
    .filter((d) => d !== "MATERIALITY")
    .map((d) => `fresh evidence that closes ${d.replaceAll("_", " ").toLowerCase()}`)
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// Dimension evaluation against the ledger
// ---------------------------------------------------------------------------

export type DimensionFit = "SATISFIED" | "PARTIAL" | "MISSING" | "NOT_APPLICABLE";

export interface DimensionStatus {
  readonly dimension: AnswerDimension;
  readonly fit: DimensionFit;
  readonly requirementIds: readonly string[];
  readonly note: string;
}

/** Vocabulary that identifies ledger rows belonging to a decision dimension. */
const DIMENSION_PATTERNS: Readonly<Record<AnswerDimension, RegExp>> = {
  CURRENT_STATE: /\b(current|state|status|level|price|trading|quote|condition|regime|right now|currently|latest)\b/i,
  WHAT_HAPPENED: /\b(what happened|event|move|drop|rally|decline|announcement|development|happened|action)\b/i,
  CURRENT_DRIVERS: /\b(driv\w*|catalysts?|behind|push\w*|pressur\w*|moving|reasons?|factors?|supply|demand|differential)\b/i,
  DRIVER_RELATIONSHIP: /\b(transmission|mechanism|relationship|channel|pass[- ]?through|link|arrow|through how|into how)\b/i,
  FORWARD_FACTORS: /\b(could affect|factor|catalyst|risk|upcoming|event|opportunity|threat|dependency|would matter)\b/i,
  HISTORICAL_EPISODE: /\b(episode|analog|similar|historical|past|previous|before|happened before|comparable)\b/i,
  COMPARISON_BASELINE: /\b(previous|prior|last|comparison|baseline|week over|month over|versus|vs|period over)\b/i,
  THESIS_SUPPORT: /\b(support|confirm|consistent|for the thesis|validat|aligns)\b/i,
  THESIS_CHALLENGE: /\b(challeng|contradict|weaken|against|oppos|counter)\b/i,
  FALSIFICATION_CONDITIONS: /\b(falsif|disconfirm|prove.{0,12}wrong|invalidate|would change|break|fail|disprov)\b/i,
  FRAMEWORK_CRITERIA: /\b(criteri|framework|rule|threshold|score|checklist|methodolog)\b/i,
  CROSS_DOMAIN_COVERAGE: /\b(synthesis|cross[- ]domain|cross[- ]asset|spillover|all (evidence|information|domains)|integration)\b/i,
  RECENCY: /\b(current|recent|today|this week|latest|fresh|now|freshness|timely)\b/i,
  COUNTEREVIDENCE: /\b(challeng|contradict|weaken|oppos|counter|disconfirm|falsif|risk to)\b/i,
  MATERIALITY: /\b(material|significant|meaningful|decisive|matters?|critical dimension)\b/i,
};

function requirementsForDimension(dimension: AnswerDimension, ledger: readonly ResearchRequirement[]): readonly ResearchRequirement[] {
  const pattern = DIMENSION_PATTERNS[dimension];
  return ledger.filter((r) => {
    if (r.role === "CONTEXT") return false;
    if (dimension === "COUNTEREVIDENCE") return r.role === "CHALLENGE" || pattern.test(r.description);
    if (dimension === "THESIS_CHALLENGE") return r.role === "CHALLENGE" || pattern.test(r.description);
    if (dimension === "THESIS_SUPPORT") return r.role === "CORE" && pattern.test(r.description);
    if (dimension === "DRIVER_RELATIONSHIP") {
      return (r.targetTerms ?? []).length > 0 || r.relationshipType !== undefined || pattern.test(r.description);
    }
    return pattern.test(r.description);
  });
}

function evaluateDimension(
  dimension: AnswerDimension,
  ledger: readonly ResearchRequirement[],
  scope: TemporalScope,
  materiality: MaterialityLevel,
  attemptPool?: ReadonlySet<EvidenceDomain>,
): DimensionStatus {
  if (dimension === "MATERIALITY") {
    const fit: DimensionFit = materialityAtLeast(materiality, "MATERIAL")
      ? "SATISFIED"
      : materialityAtLeast(materiality, "RELEVANT")
        ? "PARTIAL"
        : "MISSING";
    return {
      dimension,
      fit,
      requirementIds: [],
      note: `materiality ladder at ${materiality}`,
    };
  }
  if (dimension === "RECENCY") {
    if (scope === "ANY" || scope === "HISTORICAL") {
      return { dimension, fit: "NOT_APPLICABLE", requirementIds: [], note: `scope ${scope} imposes no current-window gate` };
    }
    const currentReqs = ledger.filter((r) => r.timeSensitivity === "CURRENT" && r.role !== "CONTEXT");
    if (currentReqs.length === 0) {
      return { dimension, fit: "NOT_APPLICABLE", requirementIds: [], note: "no CURRENT requirement by construction" };
    }
    const freshSatisfied = currentReqs.filter((r) => r.status === "SATISFIED" && r.staleOnlyRefs.length === 0);
    const stale = currentReqs.filter((r) => r.staleOnlyRefs.length > 0);
    // RECENCY is a freshness gate, not a completeness gate: it fails only when some CURRENT
    // satisfaction rests on stale-only evidence. Unsatisfied CRITICAL/PENDING/UNAVAILABLE rows
    // are coverage gaps (blockingRequirements / attempt law own those), never a recency
    // violation — an unattempted challenge or a still-pending watch row cannot make fresh
    // evidence "old".
    if (stale.length === 0) {
      return {
        dimension,
        fit: "SATISFIED",
        requirementIds: freshSatisfied.map((r) => r.id),
        note: freshSatisfied.length > 0 ? "no stale CURRENT satisfaction; CRITICAL window fresh" : "no stale CURRENT satisfaction (gaps owned by coverage)",
      };
    }
    if (freshSatisfied.length > 0) {
      return { dimension, fit: "PARTIAL", requirementIds: freshSatisfied.map((r) => r.id), note: `${freshSatisfied.length}/${currentReqs.length} CURRENT requirements fresh; ${stale.length} stale-touched` };
    }
    return { dimension, fit: "MISSING", requirementIds: [], note: "CURRENT requirements stale-only" };
  }
  if (dimension === "DRIVER_RELATIONSHIP") {
    const links = deriveCausalLinkStatuses(ledger);
    const rows = requirementsForDimension(dimension, ledger);
    if (links.length > 0) {
      const supported = links.filter((l) => l.status === "SUPPORTED" || l.status === "PARTIALLY_SUPPORTED");
      if (supported.length === links.length) {
        return { dimension, fit: "SATISFIED", requirementIds: supported.map((l) => l.requirementId), note: `${supported.length}/${links.length} transmission links supported` };
      }
      if (supported.length > 0) {
        return { dimension, fit: "PARTIAL", requirementIds: supported.map((l) => l.requirementId), note: `${supported.length}/${links.length} links supported; weakest ${links.find((l) => l.status !== "SUPPORTED" && l.status !== "PARTIALLY_SUPPORTED")?.target ?? "?"}` };
      }
      return { dimension, fit: "MISSING", requirementIds: [], note: "no transmission link supported" };
    }
    if (rows.length === 0) {
      return { dimension, fit: "NOT_APPLICABLE", requirementIds: [], note: "question named no transmission links" };
    }
    // Coverage law owns SATISFIED: a satisfied relationship row answers the dimension.
    // evidenceQuality (CORRELATIONAL / UNRESOLVED provenance) is a confidence input, never a
    // reason to re-open a dimension the ledger already closed — fixtures and production both
    // may leave source metadata incomplete without that meaning the link is unknown.
    const satisfiedRows = rows.filter((r) => r.status === "SATISFIED");
    const criticalRows = rows.filter((r) => r.importance === "CRITICAL");
    const criticalSatisfied = criticalRows.filter((r) => r.status === "SATISFIED");
    if (satisfiedRows.length > 0 && (criticalRows.length === 0 || criticalSatisfied.length === criticalRows.length)) {
      const weakQuality = satisfiedRows.every(
        (r) => r.evidenceQuality === "CORRELATIONAL" || r.evidenceQuality === "UNRESOLVED" || r.sourceDiversity === 1,
      );
      return {
        dimension,
        fit: "SATISFIED",
        requirementIds: satisfiedRows.map((r) => r.id),
        note: weakQuality ? "relationship rows satisfied (quality noted for confidence)" : "relationship requirement satisfied by direct/inferred evidence",
      };
    }
    if (satisfiedRows.length > 0) {
      return { dimension, fit: "PARTIAL", requirementIds: satisfiedRows.map((r) => r.id), note: "relationship partially satisfied" };
    }
    const partialRows = rows.filter((r) => r.status === "PARTIALLY_SATISFIED");
    if (partialRows.length > 0) {
      return { dimension, fit: "PARTIAL", requirementIds: partialRows.map((r) => r.id), note: "relationship only stale/partially satisfied" };
    }
    return { dimension, fit: "MISSING", requirementIds: rows.map((r) => r.id), note: "relationship requirement unsatisfied" };
  }
  // COUNTEREVIDENCE (attempt law): the CHALLENGE role decides the dimension. Pattern-matched
  // SUPPORTING rows ("counter-case flows") may lag without re-opening a completed challenge.
  if (dimension === "COUNTEREVIDENCE") {
    const rows = requirementsForDimension(dimension, ledger);
    if (rows.length === 0) {
      return { dimension, fit: "NOT_APPLICABLE", requirementIds: [], note: "no counterevidence dimension by construction" };
    }
    const challengeRows = rows.filter((r) => r.role === "CHALLENGE");
    const otherRows = rows.filter((r) => r.role !== "CHALLENGE");
    const challengeHandled = challengeRows.every(
      (r) => r.status === "SATISFIED" || r.recoveryAttempts > 0 || r.status === "EXHAUSTED" || r.status === "UNAVAILABLE",
    );
    const challengeActive = challengeRows.some((r) => r.status === "SATISFIED" || r.recoveryAttempts > 0);
    const otherSatisfied = otherRows.filter((r) => r.status === "SATISFIED");
    if (challengeRows.length > 0 && challengeHandled && challengeActive) {
      if (otherRows.length === 0 || otherSatisfied.length === otherRows.length || otherRows.every((r) => r.status === "PENDING" || r.status === "SATISFIED")) {
        // Other pattern rows pending do not un-complete an attempted/satisfied challenge.
        if (otherSatisfied.length > 0 || otherRows.length === 0 || challengeRows.some((r) => r.status === "SATISFIED")) {
          const ids = [...challengeRows, ...otherSatisfied].map((r) => r.id);
          return { dimension, fit: "SATISFIED", requirementIds: ids, note: challengeRows.some((r) => r.status === "SATISFIED") ? "counterevidence satisfied" : "disconfirmation attempted (attempt law)" };
        }
      }
    }
    const satisfied = rows.filter((r) => r.status === "SATISFIED");
    const partial = rows.filter((r) => r.status === "PARTIALLY_SATISFIED");
    if (satisfied.length === rows.length) {
      return { dimension, fit: "SATISFIED", requirementIds: satisfied.map((r) => r.id), note: `${satisfied.length}/${rows.length} rows satisfied` };
    }
    const critical = rows.filter((r) => r.importance === "CRITICAL");
    const criticalSatisfied = critical.filter((r) => r.status === "SATISFIED");
    if (critical.length > 0 && criticalSatisfied.length === critical.length && satisfied.length > 0) {
      return { dimension, fit: "SATISFIED", requirementIds: satisfied.map((r) => r.id), note: "CRITICAL counterevidence rows satisfied" };
    }
    if (satisfied.length > 0 || partial.length > 0) {
      return { dimension, fit: "PARTIAL", requirementIds: [...satisfied, ...partial].map((r) => r.id), note: `${satisfied.length} satisfied, ${partial.length} partial of ${rows.length}` };
    }
    const attempted = rows.filter((r) => r.recoveryAttempts > 0 || r.status === "EXHAUSTED" || r.status === "UNAVAILABLE");
    if (attempted.length > 0) {
      return { dimension, fit: "SATISFIED", requirementIds: attempted.map((r) => r.id), note: "disconfirmation attempted (attempt law)" };
    }
    return { dimension, fit: "MISSING", requirementIds: rows.map((r) => r.id), note: `${rows.length} row(s) unsatisfied (${rows.map((r) => r.status).join(",")})` };
  }
  const rows = requirementsForDimension(dimension, ledger);
  if (rows.length === 0) {
    return { dimension, fit: "NOT_APPLICABLE", requirementIds: [], note: "no ledger row states this dimension" };
  }
  const satisfied = rows.filter((r) => r.status === "SATISFIED");
  const partial = rows.filter((r) => r.status === "PARTIALLY_SATISFIED");
  if (satisfied.length === rows.length) {
    return { dimension, fit: "SATISFIED", requirementIds: satisfied.map((r) => r.id), note: `${satisfied.length}/${rows.length} rows satisfied` };
  }
  // Coverage-law alignment: CRITICAL rows decide the dimension; lagging SUPPORTING rows do
  // not re-open an otherwise complete dimension (blockingRequirements uses the same rule).
  const critical = rows.filter((r) => r.importance === "CRITICAL");
  const criticalSatisfied = critical.filter((r) => r.status === "SATISFIED");
  if (critical.length > 0 && criticalSatisfied.length === critical.length && satisfied.length > 0) {
    return { dimension, fit: "SATISFIED", requirementIds: satisfied.map((r) => r.id), note: `${criticalSatisfied.length}/${critical.length} CRITICAL rows satisfied (${satisfied.length}/${rows.length} total)` };
  }
  if (critical.length === 0 && satisfied.length > 0) {
    return { dimension, fit: "SATISFIED", requirementIds: satisfied.map((r) => r.id), note: `${satisfied.length}/${rows.length} rows satisfied (no CRITICAL rows)` };
  }
  if (satisfied.length > 0 || partial.length > 0) {
    const ids = [...satisfied, ...partial].map((r) => r.id);
    return { dimension, fit: "PARTIAL", requirementIds: ids, note: `${satisfied.length} satisfied, ${partial.length} partial of ${rows.length}` };
  }
  const attempted = rows.filter(
    (r) =>
      (r.recoveryAttempts > 0 || r.status === "EXHAUSTED" || r.status === "UNAVAILABLE") &&
      (attemptPool === undefined || rowCouldBeAttempted(r, attemptPool)),
  );
  if (attempted.length > 0 && attempted.length === rows.length) {
    return { dimension, fit: "SATISFIED", requirementIds: attempted.map((r) => r.id), note: "all rows attempted/exhausted (attempt law)" };
  }
  return { dimension, fit: "MISSING", requirementIds: rows.map((r) => r.id), note: `${rows.length} row(s) unsatisfied (${rows.map((r) => r.status).join(",")})` };
}

/**
 * ATTEMPT-COMPATIBILITY PROBE (research contract): "this requirement was attempted and
 * exhausted" is a claim about THIS run's retrieval, not about the world. It may only stand
 * when the run actually held admitted evidence the row could have accepted - otherwise the
 * exhaustion means the right information kind never entered the run, which is a coverage GAP,
 * not a completed attempt. Live failure this prevents: a price-only crude-oil run reported
 * CURRENT_DRIVERS as covered because every driver row read EXHAUSTED, while no NEWS-class
 * observation had ever been admitted (evidence quality was mistaken for question resolution).
 * A row accepting GENERAL evidence is compatible with any admitted pool; recovery scheduling
 * keeps using the ungated law (whether we may still TRY is a different question from whether
 * this answer COVERED the dimension).
 */
function rowCouldBeAttempted(req: ResearchRequirement, attemptPool: ReadonlySet<EvidenceDomain>): boolean {
  if (attemptPool.size === 0) return false;
  if (req.domains.length === 0) return true;
  return req.domains.some((d) => d === "GENERAL" || attemptPool.has(d));
}

// ---------------------------------------------------------------------------
// Materiality from ledger + evidence
// ---------------------------------------------------------------------------

function computeMateriality(
  ledger: readonly ResearchRequirement[],
  dimensionStatuses: readonly DimensionStatus[],
  scope: TemporalScope,
  totalEvidenceCount: number,
): MaterialityLevel {
  if (totalEvidenceCount === 0) return "NONE";
  const withEvidence = ledger.filter((r) => r.role !== "CONTEXT" && (r.evidenceRefs.length > 0 || r.staleOnlyRefs.length > 0));
  if (withEvidence.length === 0) return "OBSERVED";
  const relevantSatisfied = withEvidence.filter((r) => r.status === "SATISFIED");
  if (relevantSatisfied.length === 0) return "RELEVANT";
  // Core dimensions the question actually posed (NOT_APPLICABLE means the ledger has no row
  // for that dimension — e.g. a synthesis ask whose CROSS_DOMAIN row was never created — and
  // must not pin materiality at RELEVANT forever). When applicable core dimensions exist,
  // at least one must be SATISFIED before the ladder climbs past RELEVANT.
  const applicableCore = dimensionStatuses.filter(
    (d) => d.dimension !== "MATERIALITY" && d.dimension !== "COUNTEREVIDENCE" && d.fit !== "NOT_APPLICABLE",
  );
  if (applicableCore.length > 0 && applicableCore.every((d) => d.fit !== "SATISFIED")) return "RELEVANT";
  const currentSatisfied = relevantSatisfied.some((r) => r.timeSensitivity === "CURRENT" && r.staleOnlyRefs.length === 0);
  const timeBound = scope === "CURRENT" || scope === "WEEKLY" || scope === "MONTHLY";
  if (timeBound && currentSatisfied) return "CURRENTLY_ACTIVE";
  return "MATERIAL";
}

// ---------------------------------------------------------------------------
// Full question resolution
// ---------------------------------------------------------------------------

export type QuestionResolutionStatus = "ANSWERED" | "PARTIALLY_ANSWERED" | "NOT_ANSWERED";

export interface QuestionResolutionInput {
  /** The trader's verbatim question (contract question). */
  readonly question: string;
  readonly ledger: readonly ResearchRequirement[];
  /** Text of the evidence the answer drew on. */
  readonly evidenceText: string;
  /** The trader-facing prose (flow response or adaptive answer); "" when none was produced. */
  readonly prose: string;
  /** Capabilities that actually executed (attempt semantics). */
  readonly executedCapabilities: readonly string[];
  /** Evidence type tags of the ADMITTED observations (drives the attempt-compatibility probe). */
  readonly evidenceTypes?: readonly string[];
  /** Total evidence objects collected this run (defaults to refs on the ledger). */
  readonly evidenceCount?: number;
}

export interface QuestionResolution {
  readonly intent: QuestionIntent;
  readonly temporalScope: TemporalScope;
  readonly status: QuestionResolutionStatus;
  readonly dimensions: readonly DimensionStatus[];
  readonly unresolvedDimensions: readonly AnswerDimension[];
  readonly materiality: MaterialityLevel;
  readonly evidenceCount: number;
  readonly relevantEvidenceCount: number;
  readonly staleEvidenceCount: number;
  readonly answerClaims: readonly AnswerClaim[];
  readonly claimEvidenceLinks: number;
  readonly actionableInsight: ActionableInsight;
}

function ledgerEvidenceCount(ledger: readonly ResearchRequirement[]): number {
  return new Set(ledger.flatMap((r) => [...r.evidenceRefs, ...r.staleOnlyRefs])).size;
}

/**
 * Evaluate whether the run actually RESOLVES the trader's question (not merely whether
 * evidence was collected). Deterministic: intent and required dimensions come from the
 * question wording; satisfaction comes from the ledger; claim support comes from the prose.
 */
export function evaluateQuestionResolution(input: QuestionResolutionInput): QuestionResolution {
  const intent = questionIntentOf(input.question);
  const temporalScope = temporalScopeOf(input.question);
  const required = requiredDimensionsFor(intent);
  const evidenceCount = input.evidenceCount ?? ledgerEvidenceCount(input.ledger);
  const relevantEvidenceCount = input.ledger
    .filter((r) => r.role !== "CONTEXT" && r.evidenceRefs.length > 0)
    .reduce((n, r) => n + r.evidenceRefs.length, 0);
  const staleEvidenceCount = input.ledger.reduce((n, r) => n + r.staleOnlyRefs.length, 0);
  // The domains the run actually HELD (admitted observations only): what the attempt law may
  // claim was reachable. Absent when the caller has no observation pool to describe.
  const attemptPool =
    input.evidenceTypes !== undefined
      ? new Set<EvidenceDomain>(input.evidenceTypes.map((t) => domainOfEvidenceType(t)))
      : undefined;

  // Materiality needs a first pass over non-ladder dimensions.
  const preliminary: DimensionStatus[] = required
    .filter((d) => d !== "MATERIALITY")
    .map((d) => evaluateDimension(d, input.ledger, temporalScope, "RELEVANT", attemptPool));
  const materiality = computeMateriality(input.ledger, preliminary, temporalScope, evidenceCount);
  const dimensions: DimensionStatus[] = required.map((d) =>
    d === "MATERIALITY"
      ? evaluateDimension(d, input.ledger, temporalScope, materiality, attemptPool)
      : (preliminary.find((p) => p.dimension === d) ?? evaluateDimension(d, input.ledger, temporalScope, materiality, attemptPool)),
  );

  const answerClaims = extractAnswerClaims(input.prose);
  const claimEvidenceLinks = answerClaims.filter((c) => c.evidenceRefs.length > 0).length;
  const unresolvedDimensions = dimensions
    .filter((d) => d.fit === "MISSING" || d.fit === "PARTIAL")
    .map((d) => d.dimension);

  const actionableInsight = deriveActionableInsight({
    prose: input.prose,
    dimensions,
    unresolvedDimensions,
    ledger: input.ledger,
    materiality,
    temporalScope,
  });

  // STATUS: evidence-side and answer-side both must hold for ANSWERED.
  const blockingMissing = dimensions.filter((d) => d.fit === "MISSING");
  const applicable = dimensions.filter((d) => d.fit !== "NOT_APPLICABLE");
  const satisfied = dimensions.filter((d) => d.fit === "SATISFIED");

  let status: QuestionResolutionStatus;
  if (evidenceCount === 0 || relevantEvidenceCount === 0) {
    status = "NOT_ANSWERED";
  } else if (input.prose.trim() === "" && satisfied.length === 0) {
    status = "NOT_ANSWERED";
  } else if (applicable.length > 0 && blockingMissing.length === 0 && satisfied.length === applicable.length && materialityAtLeast(materiality, "MATERIAL")) {
    status = "ANSWERED";
  } else if (satisfied.length > 0 || materialityAtLeast(materiality, "RELEVANT")) {
    status = "PARTIALLY_ANSWERED";
  } else {
    status = "NOT_ANSWERED";
  }

  // Claim-support downgrade: an unsupported DRIVER_CLAIM only downgrades when the ledger
  // itself does not back the driver/relationship dimensions. Inline `ev_` refs are optional
  // (many rendered answers cite at the document level, not per sentence); the boundary already
  // strips claims the evidence text cannot support, so a surviving driver claim over a
  // SATISFIED driver dimension is resolved, not a false ANSWERED.
  if (status === "ANSWERED") {
    const driverDims = dimensions.filter(
      (d) =>
        d.dimension === "CURRENT_DRIVERS" ||
        d.dimension === "DRIVER_RELATIONSHIP" ||
        d.dimension === "WHAT_HAPPENED",
    );
    const driverBacked =
      driverDims.length === 0 || driverDims.every((d) => d.fit === "SATISFIED" || d.fit === "NOT_APPLICABLE");
    const unsupportedDriver =
      !driverBacked &&
      answerClaims.some(
        (c) =>
          (c.level === "DRIVER_CLAIM" || c.level === "COMPARATIVE_DRIVER_JUDGMENT") &&
          c.evidenceRefs.length === 0 &&
          !ANALYTICAL_MARKERS.test(c.text),
      );
    if (unsupportedDriver) status = "PARTIALLY_ANSWERED";
  }

  return {
    intent,
    temporalScope,
    status,
    dimensions,
    unresolvedDimensions,
    materiality,
    evidenceCount,
    relevantEvidenceCount,
    staleEvidenceCount,
    answerClaims,
    claimEvidenceLinks,
    actionableInsight,
  };
}

/**
 * Evidence-side only (no prose): which recovery-target dimensions are still missing?
 * Used by the adaptive/flow loops to schedule bounded recovery before the final boundary.
 */
export function missingRecoveryDimensions(
  question: string,
  ledger: readonly ResearchRequirement[],
  totalEvidenceCount?: number,
): readonly AnswerDimension[] {
  const intent = questionIntentOf(question);
  const scope = temporalScopeOf(question);
  const required = requiredDimensionsFor(intent).filter((d) => RECOVERY_TARGET_DIMENSIONS.has(d));
  const count = totalEvidenceCount ?? ledgerEvidenceCount(ledger);
  const preliminary = required
    .filter((d) => d !== "MATERIALITY")
    .map((d) => evaluateDimension(d, ledger, scope, "RELEVANT"));
  const materiality = computeMateriality(ledger, preliminary, scope, count);
  return required.filter((d) => {
    if (d === "MATERIALITY") return !materialityAtLeast(materiality, "MATERIAL");
    const status = preliminary.find((p) => p.dimension === d);
    return status !== undefined && (status.fit === "MISSING" || status.fit === "PARTIAL");
  });
}

/** Ledger rows a recovery round should target for the given missing dimensions. */
export function requirementsForMissingDimensions(
  ledger: readonly ResearchRequirement[],
  missing: readonly AnswerDimension[],
): readonly ResearchRequirement[] {
  if (missing.length === 0) return [];
  const ids = new Set<string>();
  for (const dimension of missing) {
    for (const r of requirementsForDimension(dimension, ledger)) {
      if (r.status !== "SATISFIED" && r.status !== "UNAVAILABLE" && r.role !== "CONTEXT") ids.add(r.id);
    }
  }
  return ledger.filter((r) => ids.has(r.id));
}

// ---------------------------------------------------------------------------
// Actionable insight builder
// ---------------------------------------------------------------------------

export function deriveActionableInsight(input: {
  readonly prose: string;
  readonly dimensions: readonly DimensionStatus[];
  readonly unresolvedDimensions: readonly AnswerDimension[];
  readonly ledger: readonly ResearchRequirement[];
  readonly materiality: MaterialityLevel;
  readonly temporalScope: TemporalScope;
}): ActionableInsight {
  const shows = input.dimensions
    .filter((d) => d.fit === "SATISFIED" && d.dimension !== "MATERIALITY")
    .map((d) => {
      const row = input.ledger.find((r) => d.requirementIds.includes(r.id));
      return row?.description ?? d.dimension.replaceAll("_", " ").toLowerCase();
    })
    .slice(0, 6);
  const doesNotShow = [
    ...input.unresolvedDimensions.map((d) => `${d.replaceAll("_", " ").toLowerCase()} not established`),
    ...input.ledger
      .filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED" && r.role !== "CONTEXT")
      .map((r) => `${r.description} (${r.status.toLowerCase()})`),
  ].slice(0, 6);
  const proseMeans = extractMeans(input.prose);
  const proseWouldChange = extractWouldChange(input.prose);
  const whatItMeans = proseMeans !== "" ? proseMeans : deriveMeansFallback(input.dimensions, input.materiality);
  const whatWouldChangeConclusion = proseWouldChange.length > 0 ? proseWouldChange : deriveWouldChangeFallback(input.unresolvedDimensions);
  const watchItems = [
    ...whatWouldChangeConclusion.map((w) => `watch: ${w}`),
    ...input.unresolvedDimensions
      .filter((d) => d !== "MATERIALITY")
      .map((d) => `watch: ${d.replaceAll("_", " ").toLowerCase()} evidence`),
  ].slice(0, 6);
  return {
    whatEvidenceShows: shows,
    whatEvidenceDoesNotShow: doesNotShow,
    whatItMeans,
    whatWouldChangeConclusion,
    watchItems,
  };
}

/** Confidence ceiling the resolution status permits (mandate: resolution gates confidence). */
export function resolutionConfidenceCeiling(status: QuestionResolutionStatus): "LOW" | "MODERATE" | "HIGH" {
  switch (status) {
    case "NOT_ANSWERED": return "LOW";
    case "PARTIALLY_ANSWERED": return "MODERATE";
    case "ANSWERED": return "HIGH";
  }
}
