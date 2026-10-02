/**
 * LEDGER INVARIANTS (research contract, D3): the requirement ledger is the engine's evidence
 * state, and a row whose status contradicts its own evidence refs silently corrupts coverage,
 * the completion law, and confidence. These tests pin:
 *   1. the pure checker flags every breach class (SATISFIED without evidence, PARTIALLY without
 *      stale evidence, terminal rows holding fresh evidence, duplicate ids) and nothing else;
 *   2. the checker is WIRED into the shared contract boundary — a breach reaches the violation
 *      report as action RECORDED on BOTH the adaptive/direct path and the flow helper every
 *      flow calls, without touching the prose, the stop reason, or confidence (record, never
 *      throw, never re-classify);
 *   3. a healthy production-shaped ledger (assessCoverage output) produces no records.
 */
import { describe, expect, it } from "vitest";
import { ledgerInvariantViolations } from "../../src/research/ledger-invariants.js";
import { validateContractOutcome } from "../../src/research/contract-boundary.js";
import { validateFlowOutcome, type FlowOutcome } from "../../src/research/flow-runner.js";
import {
  assessCoverage,
  buildRequirements,
  completeRequirements,
  subjectMarketClassOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";

/** Minimal full-shaped row: every required field is present, tests override what they probe. */
function row(partial: Partial<ResearchRequirement> & { readonly id: string }): ResearchRequirement {
  return {
    description: `requirement ${partial.id}`,
    importance: "SUPPORTING",
    role: "SUPPORTING",
    timeSensitivity: "CURRENT",
    domains: [],
    status: "PENDING",
    evidenceRefs: [],
    staleOnlyRefs: [],
    recoveryAttempts: 0,
    ...partial,
  };
}

const types = (ledger: readonly ResearchRequirement[]): readonly string[] =>
  ledgerInvariantViolations(ledger).map((v) => v.type);

describe("ledgerInvariantViolations flags status/evidence contradictions", () => {
  it("reports nothing for a healthy ledger (every status consistent with its refs)", () => {
    const ledger = [
      row({ id: "req_a", status: "SATISFIED", evidenceRefs: ["ev_1"] }),
      row({ id: "req_b", status: "PARTIALLY_SATISFIED", staleOnlyRefs: ["ev_0"] }),
      // Terminal rows may legitimately KEEP stale refs (exhaustUnresolved records why).
      row({ id: "req_c", status: "EXHAUSTED", staleOnlyRefs: ["ev_0"], missingReason: "stale only" }),
      row({ id: "req_d", status: "UNAVAILABLE", missingReason: "no provider" }),
      row({ id: "req_e", status: "PENDING" }),
      [],
    ].flat();
    expect(ledgerInvariantViolations(ledger)).toEqual([]);
  });

  it("flags SATISFIED with no fresh evidence (with or without stale refs)", () => {
    expect(types([row({ id: "req_sat", status: "SATISFIED" })])).toEqual([
      "LEDGER_SATISFIED_WITHOUT_EVIDENCE",
    ]);
    expect(
      types([row({ id: "req_sat2", status: "SATISFIED", staleOnlyRefs: ["ev_0"] })]),
    ).toEqual(["LEDGER_SATISFIED_WITHOUT_EVIDENCE"]);
  });

  it("flags PARTIALLY_SATISFIED with no stale evidence at all", () => {
    expect(types([row({ id: "req_part", status: "PARTIALLY_SATISFIED" })])).toEqual([
      "LEDGER_PARTIAL_WITHOUT_STALE_EVIDENCE",
    ]);
  });

  it("flags EXHAUSTED/UNAVAILABLE rows still carrying fresh evidence refs", () => {
    expect(
      types([
        row({ id: "req_ex", status: "EXHAUSTED", evidenceRefs: ["ev_1"] }),
        row({ id: "req_un", status: "UNAVAILABLE", evidenceRefs: ["ev_2"] }),
      ]),
    ).toEqual([
      "LEDGER_TERMINAL_WITH_FRESH_EVIDENCE",
      "LEDGER_TERMINAL_WITH_FRESH_EVIDENCE",
    ]);
  });

  it("flags duplicate requirement ids exactly once per repeat", () => {
    expect(
      types([
        row({ id: "req_dup", status: "PENDING" }),
        row({ id: "req_dup", status: "PENDING" }),
        row({ id: "req_dup", status: "PENDING" }),
      ]),
    ).toEqual([
      "LEDGER_DUPLICATE_REQUIREMENT_ID",
      "LEDGER_DUPLICATE_REQUIREMENT_ID",
    ]);
  });

  it("is pure and order-stable: same ledger in, same records out", () => {
    const ledger = [
      row({ id: "req_1", status: "SATISFIED" }),
      row({ id: "req_2", status: "PARTIALLY_SATISFIED" }),
    ];
    expect(ledgerInvariantViolations(ledger)).toEqual(ledgerInvariantViolations(ledger));
    expect(types(ledger)).toEqual([
      "LEDGER_SATISFIED_WITHOUT_EVIDENCE",
      "LEDGER_PARTIAL_WITHOUT_STALE_EVIDENCE",
    ]);
  });
});

// ---------------------------------------------------------------------------
// WIRING: the boundary is the single call site every research path passes through.
// ---------------------------------------------------------------------------

const QUESTION = "What drove the move in crude oil this week";

/** A CRITICAL CORE gap that the completion law must still see (records never mask it). */
const CORRUPTED_LEDGER: readonly ResearchRequirement[] = [
  // Corrupt: claims SATISFIED with nothing behind it.
  row({
    id: "req_sat",
    description: "WTI price move",
    importance: "CRITICAL",
    role: "CORE",
    status: "SATISFIED",
  }),
  // Healthy: satisfies normally, so the corruption below is the only breach reported.
  row({ id: "req_ok", status: "SATISFIED", evidenceRefs: ["ev_1"] }),
];

interface BoundaryOutcome {
  answer: string;
  contractViolations?: readonly { readonly type: string; readonly detail: string }[];
}

function runBoundary(ledger: readonly ResearchRequirement[]) {
  return validateContractOutcome<BoundaryOutcome>(
    {
      prose: "WTI crude oil settled 4% higher this week on a supply disruption.",
      ledger,
      evidenceText: "WTI crude oil settled 4% higher this week on a supply disruption",
      executedCapabilities: [],
      stoppedBecause: "EVIDENCE_SUFFICIENT",
      failedPaths: 0,
    },
    // Real callers (adaptive.ts, flow-runner.ts) copy the report onto their outcome so it is
    // never swallowed — the fixture mirrors that wiring.
    (patch) => ({
      answer: patch.prose,
      ...(patch.contractViolations !== undefined
        ? { contractViolations: patch.contractViolations.map((v) => ({ type: v.type, detail: v.detail })) }
        : {}),
    }),
  );
}

describe("the shared boundary records ledger invariant breaches", () => {
  it("appends a RECORDED entry to the violation report without touching the prose", () => {
    const enforced = runBoundary(CORRUPTED_LEDGER);
    const recorded = enforced.violationReport.filter((v) => v.action === "RECORDED");
    expect(recorded.map((v) => v.type)).toContain("LEDGER_SATISFIED_WITHOUT_EVIDENCE");
    expect(recorded[0].detail).toContain("req_sat");
    // Record-only: the prose is untouched (no claim was stripped) ...
    expect(enforced.prose).toBe("WTI crude oil settled 4% higher this week on a supply disruption.");
    // ... and the laws still decide on the ledger itself (req_ok is SATISFIED, so nothing
    // blocks): a record must not silently become a second, competing completion law.
    expect(enforced.stoppedBecause).toBe("EVIDENCE_SUFFICIENT");
  });

  it("carries the record onto the outcome as contractViolations (never swallowed)", () => {
    const enforced = runBoundary(CORRUPTED_LEDGER);
    expect(
      (enforced.outcome.contractViolations ?? []).map((v) => v.type),
    ).toContain("LEDGER_SATISFIED_WITHOUT_EVIDENCE");
  });

  it("reports no ledger records for a healthy production-shaped ledger", () => {
    const question = QUESTION;
    const base = completeRequirements(question, buildRequirements([]), {
      subject: "oil",
      marketClass: subjectMarketClassOf(question),
    });
    const items: readonly CoverageEvidence[] = [
      {
        ref: "ev_oil",
        text: "WTI crude oil settled 4% higher this week on supply disruption",
        sourceProvider: "commodity-market-data",
        sourceType: "PRIMARY",
      },
      {
        ref: "ev_yields",
        text: "Treasury yields rose 12 basis points this week as rate markets repriced policy",
        sourceProvider: "market-regime",
        sourceType: "PRIMARY",
      },
    ];
    const covered = assessCoverage(base, items, { now: new Date() });
    expect(ledgerInvariantViolations(covered)).toEqual([]);
  });

  it("flows through validateFlowOutcome — the helper every flow calls", () => {
    const outcome = {
      requirements: CORRUPTED_LEDGER,
      evidence: [{ observation: "WTI crude oil settled 4% higher this week on supply disruption" }],
      executions: [{ capability: "NEWS_ANALYSIS" }],
      stoppedBecause: "EVIDENCE_SUFFICIENT",
      context: { currentResearchQuestion: QUESTION },
    } as unknown as FlowOutcome;
    const result = validateFlowOutcome(
      { outcome, response: "WTI crude oil settled 4% higher this week on a supply disruption." },
      { failedPaths: 0 },
    );
    expect((result.outcome.contractViolations ?? []).map((v) => v.type)).toContain(
      "LEDGER_SATISFIED_WITHOUT_EVIDENCE",
    );
    expect(result.response).toBe(
      "WTI crude oil settled 4% higher this week on a supply disruption.",
    );
  });
});
