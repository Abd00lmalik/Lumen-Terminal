/**
 * INVESTIGATION — conversational continuity above the research run.
 *
 * The trader experiences an investigation as one ongoing conversation ("Why did Bitcoin fall
 * today?" → "Focus on ETF flows." → "Has this happened before?"). Underneath, each of those
 * turns is its own ISOLATED research run with its own evidence ownership.
 *
 * The distinction this file exists to keep honest:
 *
 *   INVESTIGATION = conversational continuity   (many runs, one thread)
 *   RESEARCH RUN  = isolated research execution (one run, one owner of its evidence)
 *
 * Continuity must never become contamination. A follow-up may RECEIVE an earlier run's findings
 * as labelled context; it may never OWN that run's evidence. That boundary is enforced in the
 * domain (immutable `researchRef` on Evidence/Judgment, from 37a0fe3) and nowhere weakened here.
 * An investigation is a REFERENCE GRAPH between runs, never an ownership relationship.
 *
 * Nothing in this file is a summary the trader did not produce. `InvestigationState` is derived
 * from real research artifacts (evidence, claims, hypotheses, judgments, provenance, the trader's
 * own explicit statements) — never an invented narrative, and never a thesis the trader did not
 * state.
 */

import { newId, idPrefixes } from "./ids.js";
import { appendProvenance, createProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";

// ---------------------------------------------------------------------------
// Investigation
// ---------------------------------------------------------------------------

export type InvestigationStatus = "ACTIVE" | "PAUSED" | "CONCLUDED";

/**
 * A durable investigation: what the trader experiences as one ongoing research conversation.
 *
 * `subject` is the thing being investigated, not the first question's wording — it is what the
 * conversation is ABOUT, and it is what a follow-up is resolved against. It is set from the
 * trader's own words and never invented from market data.
 */
export interface Investigation {
  readonly id: string;
  /** A trader-readable title for the thread; derived from the trader's first question. */
  readonly title: string;
  /** The subject of the investigation ("Bitcoin", "Oil", "ETH relative strength"). */
  readonly subject: string;
  readonly status: InvestigationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Ordered turn refs; the conversation, oldest first. */
  readonly turnRefs: readonly string[];
  /** Every research run the conversation produced, in submission order. */
  readonly runRefs: readonly string[];
  /** The trader's OWN thesis for this investigation, only ever stated by the trader. */
  readonly thesisRef?: string;
  readonly provenance: Provenance;
}

const INVESTIGATION_TRANSITIONS: Readonly<Record<InvestigationStatus, readonly InvestigationStatus[]>> = {
  ACTIVE: ["PAUSED", "CONCLUDED"],
  PAUSED: ["ACTIVE", "CONCLUDED"],
  CONCLUDED: [],
};

export function createInvestigation(
  input: { title: string; subject: string },
  origin: ProvenanceOrigin,
  at = new Date(),
): Investigation {
  const now = at.toISOString();
  return Object.freeze({
    id: newId(idPrefixes.investigation),
    title: input.title.trim() === "" ? input.subject : input.title.trim(),
    subject: input.subject,
    status: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
    turnRefs: Object.freeze([]),
    runRefs: Object.freeze([]),
    provenance: createProvenance(origin, "investigation created", at),
  });
}

/** Illegal transitions throw; the conversation's lifecycle is never silently rewritten. */
export function transitionInvestigation(
  investigation: Investigation,
  to: InvestigationStatus,
  origin: ProvenanceOrigin,
  note: string,
  at = new Date(),
): Investigation {
  const allowed = INVESTIGATION_TRANSITIONS[investigation.status];
  if (!allowed.includes(to)) {
    throw new Error(`illegal investigation transition ${investigation.status} -> ${to}`);
  }
  return Object.freeze({
    ...investigation,
    status: to,
    updatedAt: at.toISOString(),
    provenance: appendProvenance(investigation.provenance, origin, note, at),
  });
}

/** Append a turn ref and the run it produced (ordered; never reordered, never deduplicated away). */
export function withTurn(investigation: Investigation, turnRef: string, runRef: string | undefined, at = new Date()): Investigation {
  const now = at.toISOString();
  return Object.freeze({
    ...investigation,
    turnRefs: Object.freeze([...investigation.turnRefs, turnRef]),
    ...(runRef !== undefined ? { runRefs: Object.freeze([...investigation.runRefs, runRef]) } : {}),
    updatedAt: now,
  });
}

/**
 * Attach the trader's OWN thesis to the investigation.
 *
 * THESIS CONTINUITY (investigation law): the thesis is attached ONLY when the trader stated one
 * or explicitly asked to evaluate an existing thesis. An ordinary statement inside a
 * conversation never becomes a thesis silently — `Workspace.attachInvestigationThesis` is the only
 * writer and it requires a thesis object the trader already owns.
 */
export function withThesis(investigation: Investigation, thesisRef: string, at = new Date()): Investigation {
  return Object.freeze({ ...investigation, thesisRef, updatedAt: at.toISOString() });
}

// ---------------------------------------------------------------------------
// Conversation turns
// ---------------------------------------------------------------------------

export type TurnRole = "TRADER" | "LUMEN";

/**
 * CONVERSATION-LEVEL intent (Phase 2).
 *
 * These are NOT the eight canonical research flows. A turn says what the trader MEANT in the
 * context of the conversation ("this is a follow-up on what we just found"); the research layer
 * then decides the FLOW (Phase 2: "the conversation layer determines what the user means in
 * context, the research layer determines how to investigate it").
 */
export type ConversationIntent =
  | "NEW_INVESTIGATION"   // a fresh question about a subject; starts a thread
  | "FOLLOW_UP"           // a short reference back to what was just established
  | "DEEPER"             // narrow the current investigation onto one angle
  | "RELATED"            // a related question in the same investigation
  | "HISTORICAL"         // has this happened before
  | "THESIS_EVALUATION"  // does my thesis hold
  | "FALSIFICATION"      // what could prove me wrong
  | "SYNTHESIS"          // what have we established so far
  | "OBSERVATION"        // a raw measurement request (obeys the 4d92351 execution contract)
  | "THESIS_STATEMENT"   // the trader states their own thesis
  | "TOPIC_SWITCH";      // a different subject; never inherits the current investigation

export interface ConversationTurn {
  readonly id: string;
  readonly investigationId: string;
  readonly role: TurnRole;
  /** The trader's or Lumen's verbatim text for this turn. */
  readonly content: string;
  /** Determined conversation intent; the routing decision, recorded as state not prose. */
  readonly intent: ConversationIntent;
  /**
   * The ISOLATED research run this turn produced, if it researched. One turn creates at most one
   * run identity; the run's evidence ownership is entirely the run's own.
   */
  readonly researchRunId?: string;
  /** Whether the turn REUSED the investigation instead of starting a new one. */
  readonly continuedInvestigation: boolean;
  readonly createdAt: string;
}

export function createTurn(
  input: {
    investigationId: string;
    role: TurnRole;
    content: string;
    intent: ConversationIntent;
    researchRunId?: string;
    continuedInvestigation: boolean;
  },
  at = new Date(),
): ConversationTurn {
  return Object.freeze({
    id: newId(idPrefixes.turn),
    investigationId: input.investigationId,
    role: input.role,
    content: input.content,
    intent: input.intent,
    ...(input.researchRunId !== undefined ? { researchRunId: input.researchRunId } : {}),
    continuedInvestigation: input.continuedInvestigation,
    createdAt: at.toISOString(),
  });
}

/** Bind the run a turn actually produced (recorded after the run exists, never guessed). */
export function withTurnRun(turn: ConversationTurn, researchRunId: string): ConversationTurn {
  return Object.freeze({ ...turn, researchRunId });
}

// ---------------------------------------------------------------------------
// Investigation state (Phase 5 / Phase 10)
// ---------------------------------------------------------------------------

/**
 * Accumulated decision context for an investigation, DERIVED from real research artifacts.
 *
 * Every field here is a projection over evidence, claims, hypotheses, judgments, provenance and
 * the trader's OWN words. It is never an invented narrative and never a thesis the trader did not
 * state — an empty field means "nothing established", not "nothing to say".
 */
export interface InvestigationState {
  readonly investigationId: string;
  readonly subject: string;
  /** Observations the runs actually established, each with the run + evidence that support it. */
  readonly establishedFacts: readonly {
    readonly statement: string;
    readonly runId?: string;
    readonly evidenceRefs: readonly string[];
  }[];
  /** Judgments the runs produced, as findings with their owning run. */
  readonly findings: readonly {
    readonly statement: string;
    readonly runId?: string;
    readonly judgmentRef: string;
    readonly confidence: string;
  }[];
  /** Competing explanations, when the runs produced more than one. */
  readonly competingExplanations: readonly { readonly statement: string; readonly runId?: string }[];
  /** What the runs could NOT establish (honest gaps, never filled in). */
  readonly unresolvedQuestions: readonly string[];
  /** The trader's OWN thesis, if they stated one. Never inferred. */
  readonly thesis?: {
    readonly thesisRef: string;
    readonly statement: string;
  };
  /** Falsification/challenge records the investigation produced. */
  readonly challenges: readonly { readonly ref: string; readonly statement: string }[];
  /** Historical comparisons the investigation produced. */
  readonly historicalComparisons: readonly { readonly runId: string; readonly statement: string }[];
  /** How many research runs the conversation produced. */
  readonly runCount: number;
}