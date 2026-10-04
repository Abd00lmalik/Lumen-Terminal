/**
 * PREMISE VALIDATION (product law: distinguish USER PREMISE from OBSERVED FACT).
 *
 * A trader asks "Why did Bitcoin move down today?" and the freshest observation says Bitcoin
 * is UP 0.81% over 24 hours. A research system that silently answers the causal question anyway
 * leaves the trader reasoning from a premise the market has already contradicted. Lumen instead
 * says so, plainly, and then investigates the move the trader actually saw.
 *
 * This check is DETERMINISTIC and evidence-bound: it only ever reports a direction and a
 * percentage that appear in an ADMITTED evidence observation about the SUBJECT. It never
 * invents a price, a move, or a catalyst, and when the evidence cannot decide the premise it
 * says nothing (the answer proceeds untouched).
 */
import { expandSubjectTerms } from "../domain/instruments.js";

export type PremiseDirection = "UP" | "DOWN";

export type PremiseVerdict = "CONTRADICTED" | "CONSISTENT" | "UNTESTABLE";

export interface PremiseCheck {
  readonly verdict: PremiseVerdict;
  /** The subject the question and the evidence share (ticker form, e.g. BTC). */
  readonly subject: string;
  /** The direction the trader's question asserts. */
  readonly assertedDirection: PremiseDirection;
  /** The magnitude the question asserts as a percentage, when it states one. */
  readonly assertedMagnitudePct: number | undefined;
  readonly observedDirection: PremiseDirection | undefined;
  /** The observed percentage change, as reported by the observation. */
  readonly observedChangePct: number | undefined;
  /** The window the observation measures ("24h", "session"). */
  readonly observedWindow: string;
  /** The evidence object the observation came from. */
  readonly evidenceRef: string;
  /** One trader-facing sentence; never contains identifiers or engine vocabulary. */
  readonly note: string;
}

/** Direction words a trader's question can assert. Order is irrelevant; matches are word-bound. */
const DOWN_WORDS = /\b(fell|falling|fall|falls|dropped|dropping|drop|drops|declined|declining|decline|declines|sank|sinking|slump|slumped|plunge|plunged|tumbled|crashed|crash|selloff|sell-off|downside|down)\b/i;
const UP_WORDS = /\b(rose|rising|rise|rises|rallied|rallying|rally|surge|surged|surging|jumped|jumping|climbed|climbing|gained|gaining|soared|soaring|upside|up)\b/i;

/** A percentage so small it is noise, not a move. */
const MATERIAL_PCT = 0.1;

/** "fell 8%", "dropped by 8 percent", "down 8%" */
const MAGNITUDE = /(\d+(?:\.\d+)?)\s*(?:%|percent|per cent|percentage points?|pts?)/i;

interface ObservedMove {
  readonly changePct: number;
  readonly window: string;
}

/**
 * Read a percentage change out of ONE observation, but only when the observation is ABOUT the
 * subject. Adapter payloads are structured JSON ("change24hPct": 0.81), so the numeric field is
 * read directly; anything unparsable yields nothing rather than a guess.
 */
function observedMoveIn(observation: string, subjectTerms: ReadonlySet<string>): ObservedMove | undefined {
  const upper = observation.toUpperCase();
  const mentionsSubject = [...subjectTerms].some((t) => t.length >= 3 && upper.includes(t));
  if (!mentionsSubject) return undefined;
  // Crypto quote shape (the adapters' canonical current-move field).
  const crypto24h = /"(?:change24hPct|change_24h_pct|change24hPercent)"\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(observation);
  if (crypto24h?.[1] !== undefined) return { changePct: Number(crypto24h[1]), window: "24h" };
  // Generic quote shape ("changePct": -0.267).
  const generic = /"(?:changePct|changePercent|priceChangePct)"\s*:\s*(-?\d+(?:\.\d+)?)/i.exec(observation);
  if (generic?.[1] !== undefined) return { changePct: Number(generic[1]), window: "current session" };
  // Prose shape, only when it is unambiguous.
  const prose = /(-?\d+(?:\.\d+)?)\s*%\s*(?:24\s*-?\s*h|24hour|24-hour)\s*(?:change|move|return)/i.exec(observation);
  if (prose?.[1] !== undefined) return { changePct: Number(prose[1]), window: "24h" };
  return undefined;
}

/**
 * The premise a question asserts, or undefined when it asserts no direction ("Why did BTC move?").
 * Direction words are read from the QUESTION only — a negation ("why didn't it fall") must not
 * be read as an assertion of a fall.
 */
function assertedPremiseOf(question: string): { direction: PremiseDirection; magnitudePct: number | undefined } | undefined {
  // A negated assertion is not a premise about the world.
  if (/\b(didn'?t|did not|doesn'?t|does not|hasn'?t|has not|never|without|instead of)\b[^.?!]{0,40}\b(fell|fall|drop|dropped|decline|declined|rose|rise|rallied|rally|surge|surged)\b/i.test(question)) {
    return undefined;
  }
  const down = DOWN_WORDS.test(question);
  const up = UP_WORDS.test(question);
  if (down === up) return undefined; // neither, or contradictory wording: nothing to validate
  const magnitude = MAGNITUDE.exec(question);
  return {
    direction: down ? "DOWN" : "UP",
    magnitudePct: magnitude?.[1] !== undefined ? Number(magnitude[1]) : undefined,
  };
}

function subjectLabel(subject: string): string {
  // "BTC" -> "Bitcoin" reads as English in a trader sentence; unknown tickers stay as written.
  const names: Readonly<Record<string, string>> = {
    BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", XRP: "XRP", DOGE: "Dogecoin", NVDA: "NVIDIA", AAPL: "Apple", TSLA: "Tesla",
  };
  return names[subject.toUpperCase()] ?? subject;
}

function formatPct(value: number): string {
  return `${Math.abs(value).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/**
 * Validate the question's premise against the run's own evidence. Returns undefined when there
 * is nothing honest to say (no asserted direction, no subject, or no usable observation).
 */
export function checkQuestionPremise(input: {
  readonly question: string;
  readonly subject: string | undefined;
  readonly evidence: readonly { readonly ref: string; readonly observation: string }[];
}): PremiseCheck | undefined {
  const asserted = assertedPremiseOf(input.question);
  if (asserted === undefined) return undefined;
  const subject = input.subject ?? "";
  if (subject.trim() === "") return undefined;
  const subjectTerms = expandSubjectTerms(new Set([subject.trim().toUpperCase(), subjectLabel(subject).toUpperCase()]));

  let best: { readonly ref: string; readonly move: ObservedMove } | undefined;
  for (const e of input.evidence) {
    const move = observedMoveIn(e.observation, subjectTerms);
    if (move === undefined) continue;
    // Prefer the most material observation about the subject; ties keep the first.
    if (best === undefined || Math.abs(move.changePct) > Math.abs(best.move.changePct)) best = { ref: e.ref, move };
  }
  if (best === undefined) return undefined; // the run holds no observation that can speak to it

  const observedDirection: PremiseDirection = best.move.changePct < 0 ? "DOWN" : "UP";
  const observedMagnitude = Math.abs(best.move.changePct);
  const magnitudeMaterial = observedMagnitude >= MATERIAL_PCT;
  // The premise is contradicted when the observed DIRECTION is the opposite of the one the
  // question asserts, or when a magnitude the question named is far larger than the move the
  // evidence actually shows ("fell 8%" against a 0.4% day).
  const directionContradiction = magnitudeMaterial && observedDirection !== asserted.direction;
  const magnitudeContradiction =
    asserted.magnitudePct !== undefined && magnitudeMaterial && observedMagnitude < asserted.magnitudePct / 2;
  const contradicted = directionContradiction || magnitudeContradiction;
  const subjectName = subjectLabel(subject);

  const verdict: PremiseVerdict = contradicted
    ? "CONTRADICTED"
    : observedDirection === asserted.direction
      ? "CONSISTENT"
      : !magnitudeMaterial
        ? "UNTESTABLE"
        : "CONTRADICTED";
  if (verdict !== "CONTRADICTED") return undefined;

  const observed = `${observedDirection === "UP" ? "up" : "down"} ${formatPct(best.move.changePct)} over the last ${best.move.window}`;
  const assertedPhrase =
    asserted.magnitudePct !== undefined
      ? `moved ${asserted.direction === "DOWN" ? "down" : "up"} about ${asserted.magnitudePct}%`
      : `moved ${asserted.direction === "DOWN" ? "down" : "up"}`;
  const note =
    `One thing to flag before the analysis: the current market data shows ${subjectName} is ${observed}, ` +
    `which does not match the premise that it ${assertedPhrase}. ` +
    `I am treating your question as referring to the move you observed rather than to the current ${best.move.window} direction.`;

  return {
    verdict,
    subject,
    assertedDirection: asserted.direction,
    assertedMagnitudePct: asserted.magnitudePct,
    observedDirection,
    observedChangePct: best.move.changePct,
    observedWindow: best.move.window,
    evidenceRef: best.ref,
    note,
  };
}