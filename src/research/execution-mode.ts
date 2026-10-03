/**
 * EXECUTION MODE (the request's execution contract).
 *
 * The trader may state, in their own words, that they do NOT want the analytical apparatus:
 *
 *   "Use CRYPTO_MARKET_DATA only. Retrieve one fresh Bitcoin spot-price observation. Return only
 *    the raw observation: price, timestamp, source, and evidence ID. Do not create a judgment.
 *    Do not perform synthesis, falsification, counterevidence analysis, or any other capability."
 *
 * Capability isolation (capability-constraints.ts) already stopped the WRONG CAPABILITIES from
 * running. What it could not stop was the analytical PIPELINE AROUND them. That pipeline added:
 *
 *   - a judgment (`ensureRunJudgment` mints one for every COMPLETED run, unconditionally),
 *   - a canonical research-flow identity stamped on the record ("what happened"),
 *   - a CHALLENGE requirement and a FALSIFICATION round,
 *   - a synthesis, an actionable insight, materiality and "what would change this conclusion".
 *
 * All of it was requested to be absent. The reason it survived is the same reason capability
 * isolation needed fixing: the trader's constraint existed only as PROMPT TEXT. Text is not a
 * control. A constraint the engine does not read at the layer that violates it is a suggestion.
 *
 * The law here:
 *   - the prohibitions are parsed DETERMINISTICALLY (no model call, no prompt instruction), and
 *   - they become a structured ExecutionConstraints record that every execution layer reads —
 *     the planner, the requirement ledger, the capability floor, the counterevidence floor, gap
 *     recovery, the adaptive loop, the flow router, and the response assembler.
 *
 * A downstream component that tries to violate the contract is prevented, not asked not to.
 *
 * TWO MODES:
 *   RESEARCH         - the normal canonical analytical flow. Every law in requirements.ts applies.
 *   RAW_OBSERVATION  - capability-only retrieval. The capability result IS the answer. No
 *                      judgment, no synthesis, no falsification, no counterevidence, no thesis
 *                      context, no actionable insight, no recommendation language, no canonical
 *                      research flow, and no ledger beyond what retrieving the observation needs.
 *
 * RAW_OBSERVATION is deliberately NOT a ninth canonical research flow. It is an operation type,
 * recorded as its own marker (`RAW_OBSERVATION_FLOW`), exactly as an unidentified methodology is
 * recorded as `INDEPENDENT_RESEARCH` rather than borrowing a canonical flow's identity.
 */

/** The two execution modes. */
export type ExecutionMode = "RESEARCH" | "RAW_OBSERVATION";

/**
 * The structured execution contract for ONE request. Every field is an instruction the
 * APPLICATION enforces; none of it is handed to the model as text and left to compliance.
 */
export interface ExecutionConstraints {
  readonly mode: ExecutionMode;
  /** Capabilities the trader named as the only ones that may run (undefined = no allowlist). */
  readonly allowedCapabilities?: readonly string[];
  /** Capabilities the trader explicitly prohibited. */
  readonly forbiddenCapabilities: readonly string[];
  /** May this request create a judgment? ("Do not create a judgment." → false) */
  readonly createJudgment: boolean;
  /** May the answer be synthesized / an actionable insight derived? ("Do not perform synthesis.") */
  readonly allowSynthesis: boolean;
  /** May falsification run? ("Do not perform falsification.") */
  readonly allowFalsification: boolean;
  /** May a counterevidence / challenge requirement exist? ("...or counterevidence analysis.") */
  readonly allowCounterevidence: boolean;
  /** May the active thesis enter the research context? (Never, unless the trader asks for it.) */
  readonly allowThesisContext: boolean;
  /** May the engine schedule bounded gap-recovery rounds? ("Do not retrieve additional evidence.") */
  readonly allowGapRecovery: boolean;
  /** True when the trader asked for ONLY a raw observation, with no interpretation of it. */
  readonly rawObservationOnly: boolean;
  /** The output fields the trader named ("price, timestamp, source, and evidence ID"). */
  readonly expectedOutputShape: readonly string[];
  /** The trader's prohibitions, verbatim (audit trail; never fed to a prompt as compliance). */
  readonly statedProhibitions: readonly string[];
}

/** The marker recorded on a Research object for an observation-mode run. Not a canonical flow. */
export const RAW_OBSERVATION_FLOW = "RAW_OBSERVATION";

// ---------------------------------------------------------------------------
// Prohibition detection
// ---------------------------------------------------------------------------

/**
 * A prohibition clause in trader language: "do not create a judgment", "no synthesis",
 * "don't perform falsification", "without counterevidence analysis", "never retrieve additional
 * evidence", "any other capability".
 *
 * Matched as whole clauses up to a terminator so the prohibition's own words can be removed from
 * the text before question classification. This matters on its own: `questionTypeOf` classified
 * the reproduction as FALSIFICATION purely because the words "falsification" appeared inside
 * "Do not perform synthesis, falsification, counterevidence analysis" — the trader forbade
 * falsification and the classifier read the ban as a request for it.
 */
const PROHIBITION_CLAUSE =
  /\b(?:do not|don'?t|never|no|without|avoid|omit|skip)\b[^.;!?]*?(?=[.;!?]|$)/gi;

/**
 * Remove every prohibition clause from a message, leaving what the trader actually ASKED for.
 * "Retrieve one fresh Bitcoin spot-price observation. Do not create a judgment. Do not perform
 * synthesis, falsification, counterevidence analysis, or any other capability."
 *   → "Retrieve one fresh Bitcoin spot-price observation."
 */
export function withoutProhibitions(message: string): string {
  PROHIBITION_CLAUSE.lastIndex = 0;
  const stripped = message.replace(PROHIBITION_CLAUSE, " ");
  return stripped.replace(/\s{2,}/g, " ").trim();
}

/** Every prohibition clause in the message, verbatim (the audit trail). */
export function statedProhibitions(message: string): readonly string[] {
  PROHIBITION_CLAUSE.lastIndex = 0;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = PROHIBITION_CLAUSE.exec(message)) !== null) {
    const clause = match[0].trim().replace(/[.;,]+$/, "");
    if (clause !== "") out.push(clause);
  }
  return out;
}

/** Does any prohibition clause forbid <subject>? */
function forbids(message: string, subject: RegExp): boolean {
  return statedProhibitions(message).some((clause) => subject.test(clause));
}

const JUDGMENT_PROHIBITION = /\b(judg(?:e)?ments?|conclusions?|verdicts?)\b/i;
const SYNTHESIS_PROHIBITION = /\b(synthes\w*|interpret\w*|analys[ie]s|analysis|implication\w*)\b/i;
const FALSIFICATION_PROHIBITION = /\b(falsif\w*|disconfirm\w*|invalidat\w*)\b/i;
const COUNTEREVIDENCE_PROHIBITION = /\b(counter[\s-]?evidence|counterevidence|opposing|contradict\w*)\b/i;
const EXTRA_RETRIEVAL_PROHIBITION = /\b(retrieve|fetch|pull|collect|gather|additional|further|more)\b/i;
const THESIS_PROHIBITION = /\b(thesis|my (?:view|position|setup|case))\b/i;

/**
 * "Return only the raw observation", "just the raw price", "only the raw values", "give me the
 * raw observation and nothing else". The explicit demand for a measurement with no reading of it.
 */
const RAW_ONLY_DEMAND =
  /\b(?:return|report|give|show|provide|output)\s+(?:me\s+)?(?:only|just)\s+the\s+raw\b/i;

/** "price, timestamp, source, and evidence ID" — the fields the trader named. */
function outputShapeOf(message: string): readonly string[] {
  const fields: string[] = [];
  const wanted = /\b(price|value|level|timestamp|time|date|source|provider|evidence id|evidence ref|volume|range|open|high|low|close)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = wanted.exec(message)) !== null) {
    const field = match[1]!.toLowerCase();
    if (!fields.includes(field)) fields.push(field);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * Parse a trader message into the execution contract the application must enforce.
 *
 * Conservative by construction: RESEARCH mode is the default and every permission defaults to
 * allowed, so an ordinary analytical question is completely unaffected. A permission is revoked
 * only on an explicit trader prohibition. RAW_OBSERVATION mode additionally requires the trader
 * to have ASKED for a raw observation ("return only the raw observation"); a bare "do not create
 * a judgment" revokes the judgment alone without downgrading the whole request.
 *
 * Capability allow/deny lists are read from the existing capability-constraint parse so the two
 * contracts can never disagree about which capabilities may run.
 */
export function executionConstraintsOf(
  message: string,
  capabilityConstraint: {
    readonly allowed?: readonly string[];
    readonly forbidden: readonly string[];
  } = { forbidden: [] },
): ExecutionConstraints {
  const rawObservationOnly = RAW_ONLY_DEMAND.test(message);
  const prohibitsJudgment = forbids(message, JUDGMENT_PROHIBITION);
  const prohibitsSynthesis = forbids(message, SYNTHESIS_PROHIBITION);
  const prohibitsFalsification = forbids(message, FALSIFICATION_PROHIBITION);
  const prohibitsCounterevidence = forbids(message, COUNTEREVIDENCE_PROHIBITION);
  const prohibitsExtraRetrieval = forbids(message, EXTRA_RETRIEVAL_PROHIBITION);
  const prohibitsThesis = forbids(message, THESIS_PROHIBITION);

  // A raw-observation demand revokes the whole analytical apparatus by construction: the trader
  // asked for a measurement, and every layer downstream of retrieval is interpretation of it.
  const mode: ExecutionMode = rawObservationOnly ? "RAW_OBSERVATION" : "RESEARCH";

  return {
    mode,
    ...(capabilityConstraint.allowed !== undefined ? { allowedCapabilities: capabilityConstraint.allowed } : {}),
    forbiddenCapabilities: capabilityConstraint.forbidden,
    createJudgment: !(rawObservationOnly || prohibitsJudgment),
    allowSynthesis: !(rawObservationOnly || prohibitsSynthesis),
    allowFalsification: !(rawObservationOnly || prohibitsFalsification),
    allowCounterevidence: !(rawObservationOnly || prohibitsCounterevidence),
    // Thesis context is already gated on an explicit thesis-facing flow or explicit "my thesis"
    // phrasing (research-integrity remediation). A raw observation never earns it, and an
    // explicit thesis prohibition removes even that.
    allowThesisContext: !rawObservationOnly && !prohibitsThesis,
    allowGapRecovery: !(rawObservationOnly || prohibitsExtraRetrieval),
    rawObservationOnly,
    expectedOutputShape: outputShapeOf(message),
    statedProhibitions: statedProhibitions(message),
  };
}

/** Is this request an observation-mode run? */
export function isObservationMode(constraints: ExecutionConstraints): boolean {
  return constraints.mode === "RAW_OBSERVATION";
}

/**
 * May a judgment be created for this request? The single question the judgment backstop asks.
 * "A completed run must carry a judgment" is a law about ANALYTICAL runs; asking it of a raw
 * observation is how `jd_000144` came to exist for a request that forbade judgments in writing.
 */
export function judgmentPermitted(constraints: ExecutionConstraints): boolean {
  return constraints.createJudgment;
}

/** Human-readable statement of the enforced contract (diagnostics; never a prompt). */
export function describeExecutionConstraints(constraints: ExecutionConstraints): string {
  const parts: string[] = [`mode=${constraints.mode}`];
  if (constraints.allowedCapabilities !== undefined) {
    parts.push(`only ${constraints.allowedCapabilities.join(", ")} may execute`);
  }
  if (constraints.forbiddenCapabilities.length > 0) {
    parts.push(`forbidden capabilities: ${constraints.forbiddenCapabilities.join(", ")}`);
  }
  if (!constraints.createJudgment) parts.push("no judgment");
  if (!constraints.allowSynthesis) parts.push("no synthesis/actionable insight");
  if (!constraints.allowFalsification) parts.push("no falsification");
  if (!constraints.allowCounterevidence) parts.push("no counterevidence/challenge requirement");
  if (!constraints.allowThesisContext) parts.push("no thesis context");
  if (!constraints.allowGapRecovery) parts.push("no gap-recovery retrieval");
  return parts.join("; ");
}

/** The RESEARCH-mode contract: every permission granted. The default for ordinary questions. */
export const UNCONSTRAINED_RESEARCH: ExecutionConstraints = {
  mode: "RESEARCH",
  forbiddenCapabilities: [],
  createJudgment: true,
  allowSynthesis: true,
  allowFalsification: true,
  allowCounterevidence: true,
  allowThesisContext: true,
  allowGapRecovery: true,
  rawObservationOnly: false,
  expectedOutputShape: [],
  statedProhibitions: [],
};

/**
 * What a run's outcome implies about its contract when only the MODE is carried forward. The
 * outcome records the mode (not the whole parsed contract) because the mode is the only thing a
 * consumer of a finished run needs: RAW_OBSERVATION means no judgment, no synthesis, no
 * challenge requirement and no actionable insight were permitted.
 */
export const OBSERVATION_ONLY_CONTRACT: ExecutionConstraints = {
  mode: "RAW_OBSERVATION",
  forbiddenCapabilities: [],
  createJudgment: false,
  allowSynthesis: false,
  allowFalsification: false,
  allowCounterevidence: false,
  allowThesisContext: false,
  allowGapRecovery: false,
  rawObservationOnly: true,
  expectedOutputShape: [],
  statedProhibitions: [],
};

// ---------------------------------------------------------------------------
// The raw-observation response
// ---------------------------------------------------------------------------

/**
 * The minimum a raw observation can report, when the trader named no explicit output shape.
 * These four are the fields of an OBSERVATION, not an interpretation of one: the measured value,
 * when it was observed, where it came from, and the identity of the evidence record itself.
 */
const DEFAULT_OBSERVATION_FIELDS: readonly string[] = ["price", "timestamp", "source", "evidence id"];

/** A single observed value, extracted from the observation text when it states one. */
function measuredValueOf(observation: string): string | undefined {
  // A currency amount, a bare decimal, or a signed percentage — the shapes a measurement takes.
  const match =
    /(?:[$€£]\s?[\d,]+(?:\.\d+)?(?:[kKmM])?|(?:\bUSD\b|\bEUR\b)\s?[\d,]+(?:\.\d+)?|\b-?\d[\d,]*(?:\.\d+)?%|\b\d[\d,]*(?:\.\d+)?)/.exec(observation);
  return match?.[0];
}

/**
 * Render the raw observation response: exactly the fields the trader asked for, read from the
 * run's OWN evidence.
 *
 * Every field is taken from the evidence object, never from generated prose, so the response
 * cannot report a value, timestamp or source the run did not actually retrieve. Nothing is
 * interpreted, ranked, or recommended: no factors, no counterevidence, no materiality, no "what
 * would change this", no position language, no thesis implication.
 *
 * The evidence id is always reported. It is the field that makes the response checkable: a trader
 * can look the record up and see exactly what was observed, with its provenance.
 */
export function renderRawObservation(
  evidence: readonly {
    readonly id: string;
    readonly observation: string;
    readonly timestamp?: string;
    readonly observedAt: string;
    readonly sourceRefs: readonly string[];
    readonly sourceProvider?: string;
    readonly subject?: string;
  }[],
  expectedOutputShape: readonly string[],
): string {
  if (evidence.length === 0) {
    return "No observation was returned by the requested capability.";
  }
  const wanted = expectedOutputShape.length > 0 ? expectedOutputShape : DEFAULT_OBSERVATION_FIELDS;
  const lines: string[] = [];
  evidence.slice(0, 5).forEach((item, index) => {
    const value = measuredValueOf(item.observation);
    const source = item.sourceProvider ?? item.sourceRefs[0] ?? "unknown source";
    const fields: string[] = [];
    if (index > 0) fields.push(`observation ${index + 1}`);
    if (item.subject !== undefined) fields.push(`subject: ${item.subject}`);
    if (wanted.some((f) => f === "price" || f === "value" || f === "level") && value !== undefined) {
      fields.push(`value: ${value}`);
    }
    fields.push(`observation: ${item.observation}`);
    if (wanted.some((f) => f === "timestamp" || f === "time" || f === "date")) {
      fields.push(`timestamp: ${item.timestamp ?? item.observedAt}`);
    }
    if (wanted.some((f) => f === "source" || f === "provider")) fields.push(`source: ${source}`);
    // The evidence id is unconditional: it is the provenance handle for everything above.
    fields.push(`evidence id: ${item.id}`);
    lines.push(fields.join(" | "));
  });
  return lines.join("\n");
}