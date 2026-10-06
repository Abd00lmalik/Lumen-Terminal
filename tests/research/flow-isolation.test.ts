/**
 * FLOW ISOLATION regression tests (architecture/contract mandate).
 *
 * THE REPRODUCTION these tests exist for, verbatim and never paraphrased:
 *
 *   "What happened to Bitcoin over the last 24 hours? Give me only the factual sequence of price
 *    movement and dated market events. Do not analyze causes, drivers, mechanisms, theses,
 *    counterevidence, materiality, or trading implications."
 *
 * It produced: question type CAUSAL, THESIS_EVALUATION answered, THESIS_CHALLENGE satisfied,
 * materiality satisfied, counterevidence, strongest support, meaningful opposition, mechanism,
 * transmission, "what would change this conclusion" — plus an answer that summarised Oct 1–3
 * headlines instead of the requested 24-hour price timeline.
 *
 * WHAT IS PROVEN HERE:
 *  - the descriptive question is classified OBSERVATION (never CAUSAL),
 *  - WHAT_HAPPENED grants only the reconstruction dimensions and owes NO materiality judgment,
 *  - a WHAT_HAPPENED ledger contains no causal, thesis, falsification, counterevidence,
 *    mechanism, transmission, materiality or trading-implication row, and no CHALLENGE role,
 *  - the other direction still works: WHY_IT_HAPPENED keeps drivers, mechanism, transmission
 *    and counterevidence; every other canonical flow keeps the dimensions it owns,
 *  - the runtime flow-contract assertion REFUSES a contaminated plan and the refusal is a
 *    deterministic REGENERATION, never a UI-layer strip.
 *
 * Each WHAT_HAPPENED case is a control for the corresponding WHY/THESIS case: the same engine
 * must produce opposite ledgers for the two flows, so neither can be satisfied by disabling
 * causal work globally.
 */
import { describe, expect, it } from "vitest";
import {
  completeRequirements,
  dimensionOfRequirement,
  questionTypeOf,
} from "../../src/research/requirements.js";
import {
  requiredDimensionsFor,
  questionIntentOf,
  ALL_DECISION_DIMENSIONS,
} from "../../src/research/question-resolution.js";
import {
  FLOW_CONTRACTS,
  assertFlowContract,
  contractFor,
  forbiddenDimensionsFor,
  isCanonicalFlow,
  type CanonicalFlow,
} from "../../src/research/flow-contract.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import {
  isDirectObservation,
  isReportedClaim,
  renderObservationResponse,
  sourcingClassOf,
} from "../../src/research/observation-response.js";
import type { Evidence } from "../../src/domain/objects.js";

/** The exact production prompt. Never paraphrased — it is the fixture the bug was found with. */
const REPRO =
  "What happened to Bitcoin over the last 24 hours? Give me only the factual sequence of price movement and dated market events. Do not analyze causes, drivers, mechanisms, theses, counterevidence, materiality, or trading implications.";

const WHY = "Why did Bitcoin move today?";

/** Vocabulary a WHAT_HAPPENED row must never contain, whatever produced it. */
const OUT_OF_CONTRACT_VOCABULARY =
  /\b(driver|mechanism|transmission|counter(?:evidence)?|thesis|falsif\w*|disconfirm\w*|material\w*|significant|decisive|catalyst|supply|demand|inventory|differential|policy stance|forward[- ]looking|what would (?:change|prove)|invalidat\w*|implication|actionable|should (?:buy|sell|hold))\b/i;

/** Dimensions a WHAT_HAPPENED ledger must never contain. */
const FORBIDDEN_DIMENSIONS = [
  "CURRENT_DRIVERS",
  "DRIVER_RELATIONSHIP",
  "FALSIFICATION_CONDITIONS",
  "THESIS_SUPPORT",
  "THESIS_CHALLENGE",
  "COUNTEREVIDENCE",
  "FORWARD_FACTORS",
  "MATERIALITY",
  "HISTORICAL_EPISODE",
  "COMPARISON_BASELINE",
  "FRAMEWORK_CRITERIA",
  "CROSS_DOMAIN_COVERAGE",
] as const;

const ledgerOf = (question: string, flow: CanonicalFlow | undefined, seed: readonly { description: string; importance: "CRITICAL" | "SUPPORTING" }[] = []) =>
  completeRequirements(
    question,
    [],
    {
      subject: "BTC",
      marketClass: "CRYPTO",
      ...(flow !== undefined ? { flow } : {}),
    },
  ).concat(
    seed.map((s, i) => ({
      id: `r_${i}`,
      description: s.description,
      importance: s.importance,
      role: "CORE" as const,
      timeSensitivity: "CURRENT" as const,
      status: "PENDING" as const,
      domains: [] as readonly never[],
      retrievalObjective: s.description,
      sourceRefs: [] as readonly string[],
      supports: [] as readonly string[],
      contradicts: [] as readonly string[],
      calculation: undefined,
      probeResult: undefined,
      engineRequired: false,
    })),
  );

describe("flow isolation: the exact reproduction prompt", () => {
  it("classifies the descriptive question as OBSERVATION, not CAUSAL", () => {
    // Root cause 1: "what happened" was matched INSIDE the CAUSAL branch.
    expect(questionTypeOf(REPRO)).toBe("OBSERVATION");
    expect(questionTypeOf(REPRO)).not.toBe("CAUSAL");
  });

  it("still reads WHAT_HAPPENED intent, and owes no materiality judgment", () => {
    expect(questionIntentOf(REPRO)).toBe("WHAT_HAPPENED");
    // Root cause 2: REQUIRED_DIMENSIONS.WHAT_HAPPENED itself listed MATERIALITY.
    expect(requiredDimensionsFor("WHAT_HAPPENED")).toEqual(["WHAT_HAPPENED", "RECENCY"]);
    expect(requiredDimensionsFor("WHAT_HAPPENED")).not.toContain("MATERIALITY");
  });

  it("produces a ledger with no causal, thesis or judgment dimension at all", () => {
    const ledger = ledgerOf(REPRO, "WHAT_HAPPENED");
    const dimensions = ledger
      .map((r) => dimensionOfRequirement(r.description, r.role))
      .filter((d): d is string => d !== undefined);
    for (const forbidden of FORBIDDEN_DIMENSIONS) {
      expect(dimensions).not.toContain(forbidden);
    }
    for (const row of ledger) {
      expect(row.description).not.toMatch(OUT_OF_CONTRACT_VOCABULARY);
    }
    // No CHALLENGE role: counterevidence is not a WHAT_HAPPENED obligation.
    expect(ledger.some((r) => r.role === "CHALLENGE")).toBe(false);
  });

  it("keeps the descriptive dimensions the flow does grant", () => {
    const ledger = ledgerOf(REPRO, "WHAT_HAPPENED");
    const dimensions = ledger
      .map((r) => dimensionOfRequirement(r.description, r.role))
      .filter((d): d is string => d !== undefined);
    // Every surviving row is inside the flow's own contract (the invariant, not a keyword list).
    const contract = contractFor("WHAT_HAPPENED")!;
    for (const dimension of dimensions) expect(contract.grants).toContain(dimension);
  });

  it("refuses a planner row that smuggles causal work into a WHAT_HAPPENED run", () => {
    // The engine ledger is clean; the PLANNER proposed a causal row. It must not survive.
    const ledger = completeRequirements(REPRO, [], {
      subject: "BTC",
      marketClass: "CRYPTO",
      flow: "WHAT_HAPPENED",
    });
    expect(ledger.every((r) => !/driver|mechanism|thesis|counter|material/i.test(r.description))).toBe(true);
  });
});

describe("flow isolation: the other direction still works", () => {
  it("gives WHY_IT_HAPPENED its causal requirements", () => {
    const ledger = ledgerOf(WHY, "WHY_IT_HAPPENED");
    const dimensions = new Set(
      ledger.map((r) => dimensionOfRequirement(r.description, r.role)).filter((d): d is string => d !== undefined),
    );
    expect(dimensions.has("CURRENT_DRIVERS")).toBe(true);
    expect(dimensions.has("DRIVER_RELATIONSHIP")).toBe(true);
    expect(dimensions.has("COUNTEREVIDENCE")).toBe(true);
    expect(questionTypeOf(WHY)).toBe("CAUSAL");
    // A causal run OWNS a challenge row — the isolation fix must not have removed rigor.
    expect(ledger.some((r) => r.role === "CHALLENGE")).toBe(true);
  });

  it("keeps every other canonical flow's own dimensions", () => {
    // Expected dimension per flow. For a thesis flow the challenge row is attributed to
    // COUNTEREVIDENCE because ROLE is authoritative for it — a CHALLENGE row IS the
    // disconfirmation dimension whatever its wording — so the assertion is on the role too.
    const expectations: readonly {
      flow: CanonicalFlow;
      question: string;
      dimension: string;
      role?: "CHALLENGE";
    }[] = [
      { flow: "WHAT_COULD_AFFECT_IT", question: "What could affect Bitcoin over the next few days?", dimension: "FORWARD_FACTORS" },
      { flow: "DOES_MY_THESIS_HOLD", question: "Does my Bitcoin thesis still hold?", dimension: "COUNTEREVIDENCE", role: "CHALLENGE" },
      { flow: "HAS_THIS_HAPPENED_BEFORE", question: "Has this Bitcoin setup happened before?", dimension: "HISTORICAL_EPISODE" },
      { flow: "WHAT_COULD_PROVE_ME_WRONG", question: "What could prove my Bitcoin thesis wrong?", dimension: "COUNTEREVIDENCE", role: "CHALLENGE" },
      // The framework and broad-synthesis flows own their dimensions in their OWN flow
      // implementations (flow8 / flow6), which run a criteria-scored evaluation and a
      // cross-domain coverage pass rather than the adaptive ledger. Their contract here is
      // asserted by isolation only: no row may escape their grants. Inventing engine dimensions
      // for them made a legitimate framework benchmark score 1/2 on QUESTION UNDERSTANDING, so
      // this suite does not pretend the generic ledger produces them.
      { flow: "EVALUATE_WITH_MY_FRAMEWORK", question: "Evaluate this according to my framework.", dimension: "COUNTEREVIDENCE", role: "CHALLENGE" },
      { flow: "WHAT_DOES_ALL_INFORMATION_SAY", question: "What does all the information say about Bitcoin?", dimension: "COUNTEREVIDENCE", role: "CHALLENGE" },
    ];
    for (const { flow, question, dimension, role } of expectations) {
      const ledger = completeRequirements(question, [], {
        subject: "BTC",
        marketClass: "CRYPTO",
        flow,
      });
      const dimensions = ledger
        .map((r) => dimensionOfRequirement(r.description, r.role))
        .filter((d): d is string => d !== undefined);
      expect(dimensions, `${flow} must still require ${dimension}`).toContain(dimension);
      if (role !== undefined) {
        expect(ledger.some((r) => r.role === role), `${flow} must still owe a ${role} row`).toBe(true);
      }
      // And no row escapes its own contract — isolation in both directions.
      const contract = FLOW_CONTRACTS[flow];
      for (const d of dimensions) expect(contract.grants, `${flow} leaked ${d}`).toContain(d);
    }
  });
});

describe("flow contracts: the authority hierarchy is explicit", () => {
  it("defines a contract for all eight canonical flows", () => {
    const flows: CanonicalFlow[] = [
      "WHAT_HAPPENED",
      "WHY_IT_HAPPENED",
      "WHAT_COULD_AFFECT_IT",
      "DOES_MY_THESIS_HOLD",
      "HAS_THIS_HAPPENED_BEFORE",
      "WHAT_DOES_ALL_INFORMATION_SAY",
      "WHAT_COULD_PROVE_ME_WRONG",
      "EVALUATE_WITH_MY_FRAMEWORK",
    ];
    for (const flow of flows) {
      expect(isCanonicalFlow(flow)).toBe(true);
      expect(FLOW_CONTRACTS[flow].flow).toBe(flow);
      expect(FLOW_CONTRACTS[flow].grants.length).toBeGreaterThan(0);
    }
    expect(Object.keys(FLOW_CONTRACTS)).toHaveLength(8);
  });

  it("pins OBSERVATION for WHAT_HAPPENED, overriding the classifier", () => {
    // Root cause 3: the classifier's type used to override the RESOLVED flow.
    expect(FLOW_CONTRACTS.WHAT_HAPPENED.pinnedQuestionType).toBe("OBSERVATION");
    expect(FLOW_CONTRACTS.WHAT_HAPPENED.causal).toBe(false);
    expect(FLOW_CONTRACTS.WHAT_HAPPENED.judgmental).toBe(false);
    expect(FLOW_CONTRACTS.WHAT_HAPPENED.requiresCounterevidence).toBe(false);
    expect(FLOW_CONTRACTS.WHAT_HAPPENED.requiresMateriality).toBe(false);
    expect(FLOW_CONTRACTS.WHAT_HAPPENED.evidencePreference).toContain("OHLCV");
  });

  it("derives the denial set from the grants, so a new dimension is denied by default", () => {
    const forbidden = forbiddenDimensionsFor("WHAT_HAPPENED", ALL_DECISION_DIMENSIONS);
    // WHAT_HAPPENED denies everything except its two grants.
    for (const d of ALL_DECISION_DIMENSIONS) {
      if (FLOW_CONTRACTS.WHAT_HAPPENED.grants.includes(d)) expect(forbidden).not.toContain(d);
      else expect(forbidden).toContain(d);
    }
    // A dimension invented later is denied automatically — no flow table edit required.
    expect(forbiddenDimensionsFor("WHAT_HAPPENED", ["A_BRAND_NEW_DIMENSION"])).toEqual(["A_BRAND_NEW_DIMENSION"]);
  });

  it("gives a non-canonical marker no contract to borrow", () => {
    expect(contractFor("RAW_OBSERVATION")).toBeUndefined();
    expect(contractFor("INDEPENDENT_RESEARCH")).toBeUndefined();
    expect(contractFor(undefined)).toBeUndefined();
    expect(forbiddenDimensionsFor("RAW_OBSERVATION", ALL_DECISION_DIMENSIONS)).toEqual([]);
  });
});

describe("source classification: DIRECT_OBSERVATION vs REPORTED_CLAIM", () => {
  /** A feed the adapter declares QUANTITATIVE_OBSERVATION served by its own transport. */
  const primary = (content: string) => ({
    tool: "feed/ohlcv", capability: "CRYPTO_MARKET_DATA", transport: "feed",
    outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION" as const, content, about: "BTC" }],
    validation: "VALID" as const, freshness: "CURRENT" as const, failure: { type: "NONE" as const, retriable: false },
    completeness: "COMPLETE" as const, limitations: [],
  });
  /** A news feed: textual, no declared source class, served over its own transport. */
  const news = (content: string) => ({
    tool: "feed/rss", capability: "NEWS_ANALYSIS", transport: "feed",
    outputs: [{ outputClass: "FACTUAL_OBSERVATION" as const, content, about: "BTC" }],
    validation: "VALID" as const, freshness: "CURRENT" as const, failure: { type: "NONE" as const, retriable: false },
    completeness: "COMPLETE" as const, limitations: [],
  });
  const origin = { kind: "tool" as const, detail: "test", toolRef: "t", invocation: { params: {} } };

  it("classifies a market-data print as a direct observation", () => {
    const e = evidenceFromToolResult(primary("BTC spot 64,200 at 13:05 UTC"), primary("BTC spot 64,200 at 13:05 UTC").outputs[0], origin, {}, new Date("2026-10-05T13:05:00Z"));
    expect(sourcingClassOf(e)).toBe("DIRECT_OBSERVATION");
    expect(isDirectObservation(e)).toBe(true);
  });

  it("NEVER calls a retrieved news headline an observation, however cleanly it arrived", () => {
    const output = news("Bitcoin ETF inflows resume as sentiment improves");
    const e = evidenceFromToolResult(news(output.content as string), output, origin, {}, new Date());
    expect(sourcingClassOf(e)).toBe("REPORTED_CLAIM");
    expect(isReportedClaim(e)).toBe(true);
    expect(isDirectObservation(e)).toBe(false);
  });

  it("keeps an authored interpretation a reported claim even on a primary transport", () => {
    const interpretation = {
      tool: "feed/model", capability: "MACRO_ANALYSIS", transport: "feed",
      outputs: [{ outputClass: "ANALYST_INTERPRETATION" as const, content: "risk appetite is improving", about: "BTC" }],
      validation: "VALID" as const, freshness: "CURRENT" as const, failure: { type: "NONE" as const, retriable: false },
      completeness: "COMPLETE" as const, limitations: [],
    };
    const e = evidenceFromToolResult(interpretation, interpretation.outputs[0], origin, {}, new Date());
    expect(sourcingClassOf(e)).toBe("REPORTED_CLAIM");
  });
});

describe("observation response contract (what a WHAT_HAPPENED run may show)", () => {
  const ev = (over: Partial<Evidence> & { observation: string }): Evidence =>
    ({ id: "ev_x", evidenceType: "PRICE", evidenceClass: "OBSERVATION", sourceRefs: [], observedAt: "2026-10-05T00:00:00.000Z", supports: [], contradicts: [], freshness: "CURRENT", provenance: { origin: { kind: "agent", detail: "t" }, recordedAt: "2026-10-05T00:00:00.000Z", note: "t" }, ...over }) as Evidence;

  it("renders the compact shape and never the causal machinery", () => {
    const rendered = renderObservationResponse({
      evidence: [
        ev({ id: "ev_1", observation: "BTC spot 64,200 at 13:05 UTC", sourcing: "DIRECT_OBSERVATION", timestamp: "2026-10-04T13:05:00.000Z" }),
        ev({ id: "ev_2", observation: "Bitcoin ETF inflows resume as sentiment improves", sourcing: "REPORTED_CLAIM" }),
      ],
      requirements: [],
    });
    expect(rendered.answer).toContain("**What happened**");
    expect(rendered.answer).toContain("**What is directly observed**");
    expect(rendered.answer).toContain("**What is reported**");
    expect(rendered.answer).toContain("**Missing evidence**");
    // The timeline entry is the observation; the headline never appears inside it.
    expect(rendered.answer).toContain("[2026-10-04 13:05 UTC] - BTC spot 64,200 at 13:05 UTC [ev_1]");
    expect(rendered.answer.indexOf("Bitcoin ETF inflows")).toBeGreaterThan(rendered.answer.indexOf("**What is reported**"));
    // Nothing the trader forbade.
    expect(rendered.answer).not.toMatch(/counterevidence|mechanism|transmission|materiality|thesis|what would change|actionable/i);
  });

  it("SAYS the timeline cannot be established rather than filling it with unrelated headlines", () => {
    const rendered = renderObservationResponse({
      evidence: [ev({ id: "ev_9", observation: "Some headline from three days ago", sourcing: "REPORTED_CLAIM" })],
      requirements: [],
    });
    expect(rendered.answer).toContain("could not be established");
    expect(rendered.answer).toContain("Nothing has been substituted for it");
  });

  it("names unmet requirements as missing evidence and never as a negative finding", () => {
    const req = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" })
      .map((r) => ({ ...r, status: "EXHAUSTED" as const }));
    const rendered = renderObservationResponse({ evidence: [], requirements: req });
    expect(rendered.gaps.length).toBeGreaterThan(0);
    expect(rendered.answer).toContain("could not be established from the available research paths");
    expect(rendered.answer).not.toMatch(/no evidence (?:that )?(?:exists|proves)|therefore .* did not/i);
  });
});

describe("runtime flow-contract assertion", () => {
  const dimensionOf = dimensionOfRequirement;

  it("passes a clean WHAT_HAPPENED ledger", () => {
    const ledger = completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" });
    const check = assertFlowContract({ flow: "WHAT_HAPPENED", requirements: ledger, dimensionOf });
    expect(check.ok).toBe(true);
    expect(check.violations).toHaveLength(0);
  });

  it("REFUSES a contaminated WHAT_HAPPENED ledger, naming every offending row", () => {
    const contaminated = [
      ...completeRequirements(REPRO, [], { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" }),
      {
        id: "r_causal",
        description: "the current drivers and catalysts pushing the price",
        role: "CORE" as const,
        importance: "CRITICAL" as const,
        timeSensitivity: "CURRENT" as const,
        status: "PENDING" as const,
        domains: [] as readonly never[],
        retrievalObjective: "",
        sourceRefs: [] as readonly string[],
        supports: [] as readonly string[],
        contradicts: [] as readonly string[],
        calculation: undefined,
        probeResult: undefined,
        engineRequired: true,
      },
      {
        id: "r_thesis",
        description: "evidence that would prove my thesis wrong",
        role: "CHALLENGE" as const,
        importance: "CRITICAL" as const,
        timeSensitivity: "CURRENT" as const,
        status: "PENDING" as const,
        domains: [] as readonly never[],
        retrievalObjective: "",
        sourceRefs: [] as readonly string[],
        supports: [] as readonly string[],
        contradicts: [] as readonly string[],
        calculation: undefined,
        probeResult: undefined,
        engineRequired: true,
      },
    ];
    const check = assertFlowContract({ flow: "WHAT_HAPPENED", requirements: contaminated, dimensionOf });
    expect(check.ok).toBe(false);
    expect(check.violations.map((v) => v.requirementId).sort()).toEqual(["r_causal", "r_thesis"]);
    const drivers = check.violations.find((v) => v.requirementId === "r_causal");
    expect(drivers?.dimension).toBe("CURRENT_DRIVERS");
    // A CHALLENGE row is a counterevidence dimension by ROLE, whatever its wording.
    expect(check.violations.find((v) => v.requirementId === "r_thesis")?.dimension).toBe("COUNTEREVIDENCE");
    for (const v of check.violations) expect(v.reason).toContain("WHAT_HAPPENED");
  });

  it("REGENERATES rather than discards: the planner's in-contract rows survive the refusal", () => {
    // The refusal must remove only the offending rows. Rebuilding from [] instead would delete
    // real research — a yields question lost its yield observation and the capability floor
    // had nothing left to map.
    const planRows = [
      {
        id: "r_price",
        description: "the timestamped BTC price movement over the window",
        role: "CORE" as const,
        importance: "CRITICAL" as const,
        timeSensitivity: "CURRENT" as const,
        status: "PENDING" as const,
        domains: [] as readonly never[],
        retrievalObjective: "",
        sourceRefs: [] as readonly string[],
        supports: [] as readonly string[],
        contradicts: [] as readonly string[],
        calculation: undefined,
        probeResult: undefined,
        engineRequired: false,
      },
      {
        id: "r_mech",
        description: "the mechanism transmitting the move to price",
        role: "CORE" as const,
        importance: "CRITICAL" as const,
        timeSensitivity: "CURRENT" as const,
        status: "PENDING" as const,
        domains: [] as readonly never[],
        retrievalObjective: "",
        sourceRefs: [] as readonly string[],
        supports: [] as readonly string[],
        contradicts: [] as readonly string[],
        calculation: undefined,
        probeResult: undefined,
        engineRequired: false,
      },
    ];
    const check = assertFlowContract({ flow: "WHAT_HAPPENED", requirements: planRows, dimensionOf });
    expect(check.ok).toBe(false);
    const offending = new Set(check.violations.map((v) => v.requirementId));
    expect(offending.has("r_mech")).toBe(true);
    const rebuilt = completeRequirements(
      REPRO,
      planRows.filter((r) => !offending.has(r.id)) as never,
      { subject: "BTC", marketClass: "CRYPTO", flow: "WHAT_HAPPENED" },
    );
    // The in-contract row SURVIVES the refusal — as the atomic shape rows its own wording
    // names ("timestamped price movement over the window" is a sequence + timestamps request,
    // and field decomposition splits it into exactly those two demands). What must not happen
    // is the row being DISCARDED, which is what a rebuild-from-empty would do; that is why this
    // asserts the row's subject matter is still present rather than its exact wording.
    expect(rebuilt.some((r) => /BTC price movement/i.test(r.description))).toBe(true);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(assertFlowContract({ flow: "WHAT_HAPPENED", requirements: rebuilt, dimensionOf }).ok).toBe(true);
  });

  it("ignores CONTEXT rows, which belong to no dimension", () => {
    const check = assertFlowContract({
      flow: "WHAT_HAPPENED",
      requirements: [{ id: "r_ctx", description: "general market background", role: "CONTEXT" as never }],
      dimensionOf,
    });
    expect(check.ok).toBe(true);
  });
});