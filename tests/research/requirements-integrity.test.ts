/**
 * REQUIREMENT INTEGRITY regression tests.
 *
 * Three laws, each added because a real defect broke it:
 *
 * 1. DECOMPOSITION FIDELITY (requirement-fidelity contract): splitting a multi-shape
 *    requirement into atomic rows must never mangle the trader's wording. The reproduction:
 *    "Retrieve current Bitcoin price, today's high, today's low, and 24-hour volume" used to
 *    decompose with the shape nouns deleted in place, leaving
 *    "today's , today's , and 24-hour" — the possessives and the quantifier orphaned with
 *    nothing to modify. Every clause now survives whole.
 *
 * 2. EXPLICIT WINDOW LIMITS ALL EVIDENCE KINDS (temporal tightening): when a requirement's
 *    own wording names a window, that window bounds how old ANY observation may be — not only
 *    event-dated headlines. Age and span are different axes: a candle set from three weeks ago
 *    can SPAN 24 hours and still not answer "the last 24 hours". The window is read by the ONE
 *    temporal parser, and a requirement that names no window keeps its base limits untouched.
 *
 * 3. INHERITED COVERAGE (follow-up continuity): a follow-up turn is handed the previous
 *    run's honest end state — its unresolved requirements and the evidence it OWNS, as
 *    labelled references — plus the thread's original question, so it continues the
 *    conversation instead of re-asking it. References are context, never owned evidence.
 */
import { describe, expect, it } from "vitest";
import {
  decomposeFieldRequirements,
  explicitWindowDays,
  freshnessSufficient,
  matchRequirement,
  coverageItemOf,
  type CoverageEvidence,
  type ResearchRequirement,
} from "../../src/research/requirements.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import { Workspace } from "../../src/domain/workspace.js";
import { createTurn } from "../../src/domain/investigation.js";
import { beginRun, endRun } from "../../src/domain/run-context.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { buildInvestigationContext, renderInvestigationContext } from "../../src/research/investigation-context.js";

const NOW = new Date("2026-10-05T16:00:00.000Z");
const ORIGIN = { kind: "tool" as const, detail: "test", toolRef: "t", invocation: { params: {} } };
const OPTS = { subjectTerms: new Set(["BTC", "BITCOIN"]), questionMarketClass: "CRYPTO" as const, now: NOW };

function requirement(description: string, over: Partial<ResearchRequirement> = {}): ResearchRequirement {
  return {
    id: "rq_01",
    description,
    importance: "CRITICAL",
    role: "CORE",
    timeSensitivity: "CURRENT",
    domains: ["PRICE_MARKET"],
    status: "PENDING",
    evidenceRefs: [],
    staleOnlyRefs: [],
    recoveryAttempts: 0,
    engineRequired: false,
    ...over,
  };
}

/** An hourly candle set ENDING at `endIso`; its span is measured by the real ingestion boundary. */
function candlesEnding(endIso: string, count = 24): CoverageEvidence {
  const end = Date.parse(endIso);
  const start = end - count * 3_600_000;
  const rows = Array.from({ length: count }, (_, i) => ({
    ts: (start + i * 3_600_000) / 1000,
    open: 84000 + i * 50,
    high: 84100 + i * 55,
    low: 83950 + i * 45,
    close: 84050 + i * 50,
    baseVol: 1000 + i,
    quoteVol: 84_000_000 + i * 100_000,
  }));
  const result = {
    tool: "bitget-signal/market-intel",
    capability: "CRYPTO_MARKET_DATA",
    transport: "mcp:crypto_market",
    outputs: [{ outputClass: "QUANTITATIVE_OBSERVATION" as const, content: rows, about: "BTCUSDT", timeframe: "1h" }],
    validation: "VALID" as const,
    freshness: "CURRENT" as const,
    failure: { type: "NONE" as const, retriable: false },
    completeness: "COMPLETE" as const,
    limitations: [],
    sourceTimestamp: endIso,
  };
  return coverageItemOf(evidenceFromToolResult(result, result.outputs[0]!, ORIGIN, {}, NOW));
}

// ---------------------------------------------------------------------------
// 1. DECOMPOSITION FIDELITY
// ---------------------------------------------------------------------------

describe("decomposition fidelity: the trader's wording survives the split", () => {
  const PARENT = "Retrieve current Bitcoin price, today's high, today's low, and 24-hour volume";
  const rows = decomposeFieldRequirements([requirement(PARENT)]);

  it("each shape's clause is kept verbatim — possessive and quantifier intact", () => {
    const descriptions = rows.map((r) => r.description);
    expect(descriptions.some((d) => /today's high/.test(d))).toBe(true);
    expect(descriptions.some((d) => /today's low/.test(d))).toBe(true);
    expect(descriptions.some((d) => /24-hour volume/.test(d))).toBe(true);
  });

  it("no row is left with an orphaned fragment (the exact mangling reproduction)", () => {
    for (const row of rows) {
      expect(row.description).not.toMatch(/today's\s*,/);
      expect(row.description).not.toMatch(/,\s*and\s*$/);
      expect(row.description).not.toMatch(/\b24-hour\s*[,.]?\s*$/);
    }
  });

  it("each atomic row demands exactly the shape its clause names", () => {
    const facets = rows.map((r) => r.dataFacets?.[0]);
    expect(facets).toContain("HIGH");
    expect(facets).toContain("LOW");
    expect(facets).toContain("VOLUME");
  });

  it("the window the parent named travels onto every atomic row", () => {
    for (const row of rows) {
      expect(row.windowHours).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. TEMPORAL TIGHTENING — the explicit window bounds ALL evidence kinds
// ---------------------------------------------------------------------------

describe("temporal tightening: a named window bounds the age of every observation", () => {
  it("explicit windows are read by the ONE temporal parser, not a second phrase list", () => {
    expect(explicitWindowDays("Retrieve the price sequence for the last 48 hours.")).toBe(2);
    expect(explicitWindowDays("What is driving Bitcoin today?")).toBe(1);
    expect(explicitWindowDays("Catalysts this week?")).toBe(7);
    // A phrase that names no fixed duration never tightens anything.
    expect(explicitWindowDays("Retrieve Bitcoin's current price.")).toBeUndefined();
    expect(explicitWindowDays("What has happened since the breakout?")).toBeUndefined();
  });

  it("a 24h-spanning candle set from 20 days ago does NOT answer 'the last 24 hours'", () => {
    // Its span is right; its age betrays it. The old law bounded only NEWS evidence, so this
    // quant observation passed the span check and the 21-day CURRENT base limit.
    const old = candlesEnding("2026-09-15T16:00:00.000Z");
    const req = requirement("Retrieve Bitcoin hourly price sequence for the last 24 hours.");
    expect(matchRequirement(req, old, OPTS)).not.toBe("SATISFIES");
  });

  it("the same span fetched now DOES answer it (span and freshness both hold)", () => {
    const fresh = candlesEnding("2026-10-05T15:00:00.000Z");
    const req = requirement("Retrieve Bitcoin hourly price sequence for the last 24 hours.");
    expect(matchRequirement(req, fresh, OPTS)).toBe("SATISFIES");
  });

  it("a requirement naming no window keeps its base freshness limit", () => {
    const item: CoverageEvidence = { ...candlesEnding("2026-09-15T16:00:00.000Z") };
    const windowed = requirement("Bitcoin price level in the last 24 hours");
    const state = requirement("Bitcoin price level");
    // Named window: 20 days is outside it. No window: the CURRENT base (21 days) still admits it.
    expect(freshnessSufficient(windowed, item, NOW)).toBe(false);
    expect(freshnessSufficient(state, item, NOW)).toBe(true);
  });

  it("a named window can TIGHTEN but never LOOSEN the base limit", () => {
    // Year-to-date resolves to a ~9-month window, far wider than the 21-day CURRENT base;
    // the effective limit stays the base, so a 15-day-old item is admitted and the window
    // never widened the gate.
    const item: CoverageEvidence = { ...candlesEnding("2026-09-20T16:00:00.000Z") };
    const ytd = requirement("Bitcoin price level year to date");
    expect(freshnessSufficient(ytd, item, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. INHERITED COVERAGE — the follow-up continues the thread with labelled facts
// ---------------------------------------------------------------------------

describe("inherited coverage: the follow-up is handed the thread's honest state", () => {
  function workspaceWithFinishedParent(): { ws: Workspace; investigationId: string; parentRunId: string } {
    const ws = new Workspace();
    const origin = { kind: "trader" as const, detail: "requirements-integrity test" };
    resetIdCounters();
    const inv = ws.addInvestigation({ title: "Bitcoin today", subject: "Bitcoin" }, origin);
    ws.appendTurn(
      createTurn({ investigationId: inv.id, role: "TRADER", content: "Why did Bitcoin move down today?", intent: "RESEARCH", continuedInvestigation: false }),
    );
    ws.appendTurn(
      createTurn({ investigationId: inv.id, role: "TRADER", content: "Focus specifically on ETF flows.", intent: "RESEARCH", continuedInvestigation: true }),
    );
    // Production wiring: the run is created inside the run context (stamped with the run id
    // and the trader's question) and joins the thread through its turn's run reference.
    beginRun({ runId: "run_1", userQuestion: "Why did Bitcoin move down today?", investigationId: inv.id });
    const run = ws.addResearch({ objective: "Explain the move", question: "Why did Bitcoin move down today?", flow: "FLOW_2" }, origin);
    endRun("run_1");
    ws.transitionResearch(run.id, "ACTIVE", origin, "test run started");
    ws.transitionResearch(run.id, "COMPLETED", origin, "test run finished");
    ws.appendTurn(
      createTurn({ investigationId: inv.id, role: "LUMEN", content: "Research complete.", intent: "RESEARCH", continuedInvestigation: true, researchRunId: run.id }),
      run.id,
    );
    // The parent's persisted run record: an INSUFFICIENT end state with one requirement left open.
    ws.saveResearchResponse(run.id, {
      recordVersion: 2,
      response: {
        ref: run.id,
        outcome: "INSUFFICIENT",
        answer: { answer: "", supportingReasons: [], opposingReasons: [], confidence: "UNKNOWN", keyUncertainty: "", implication: "", citedObjectRefs: [] },
        limitations: [],
        evidenceRefs: ["ev_1", "ev_2"],
        evidence: [],
        judgments: [],
        researchDiagnostics: {
          requirements: [
            { description: "Current Bitcoin spot price", importance: "CRITICAL", timeSensitivity: "CURRENT", status: "SATISFIED", evidenceCount: 1, evidenceRefs: ["ev_1"], duplicateEvidenceCount: 0, staleEvidenceCount: 0, recoveryAttempts: 0 },
            { description: "ETF flow data for the last 24 hours", importance: "CRITICAL", timeSensitivity: "CURRENT", status: "EXHAUSTED", evidenceCount: 0, evidenceRefs: [], duplicateEvidenceCount: 0, staleEvidenceCount: 0, recoveryAttempts: 2, unresolvedReason: "no provider returned the requested window" },
          ],
          executions: [],
          floorCapabilities: [],
          recoveryRounds: 0,
          completionGates: ["TIME_BUDGET_EXHAUSTED"],
          completionGate: "TIME_BUDGET_EXHAUSTED",
          coverage: "INSUFFICIENT",
        },
      },
    });
    return { ws, investigationId: inv.id, parentRunId: run.id };
  }

  it("the thread's ORIGINAL question survives outside the bounded recent-turns window", () => {
    const { ws, investigationId } = workspaceWithFinishedParent();
    const ctx = buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(investigationId), question: "Focus specifically on ETF flows." });
    expect(ctx.originalQuestion).toBe("Why did Bitcoin move down today?");
  });

  it("parentCoverage carries the parent's outcome, its UNRESOLVED rows only, and its evidence as owned references", () => {
    const { ws, investigationId, parentRunId } = workspaceWithFinishedParent();
    const ctx = buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(investigationId), question: "Focus specifically on ETF flows." });
    expect(ctx.parentCoverage).toBeDefined();
    expect(ctx.parentCoverage?.runId).toBe(parentRunId);
    expect(ctx.parentCoverage?.outcome).toBe("INSUFFICIENT");
    // The SATISFIED row is not an open thread; the EXHAUSTED row is.
    expect(ctx.parentCoverage?.unresolved).toHaveLength(1);
    expect(ctx.parentCoverage?.unresolved[0]?.description).toBe("ETF flow data for the last 24 hours");
    expect(ctx.parentCoverage?.unresolved[0]?.status).toBe("EXHAUSTED");
    expect(ctx.parentCoverage?.unresolved[0]?.reason).toBe("no provider returned the requested window");
    // References are labelled with the run that OWNS them.
    expect(ctx.parentCoverage?.evidenceRefs).toEqual([
      { ref: "ev_1", runId: parentRunId },
      { ref: "ev_2", runId: parentRunId },
    ]);
  });

  it("the rendered context labels everything as prior context, never as this run's evidence", () => {
    const { ws, investigationId } = workspaceWithFinishedParent();
    const ctx = buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(investigationId), question: "Focus specifically on ETF flows." });
    const text = renderInvestigationContext(ctx);
    expect(text).toContain("ORIGINAL QUESTION OF THIS INVESTIGATION: Why did Bitcoin move down today?");
    expect(text).toContain("LEFT UNRESOLVED");
    expect(text).toContain("[EXHAUSTED] ETF flow data for the last 24 hours");
    expect(text).toContain(`ev_1 [run`);
    expect(text).toContain("must retrieve and own its own");
    expect(text).toContain("RUN BOUNDARY");
  });

  it("a thread with no persisted records builds context without inheritance facts", () => {
    const ws = new Workspace();
    const origin = { kind: "trader" as const, detail: "requirements-integrity empty thread" };
    resetIdCounters();
    const inv = ws.addInvestigation({ title: "Oil", subject: "Oil" }, origin);
    ws.appendTurn(createTurn({ investigationId: inv.id, role: "TRADER", content: "What is driving oil prices?", intent: "RESEARCH", continuedInvestigation: false }));
    const ctx = buildInvestigationContext({ workspace: ws, investigation: ws.getInvestigation(inv.id), question: "What is driving oil prices?" });
    expect(ctx.parentCoverage).toBeUndefined();
    expect(ctx.originalQuestion).toBe("What is driving oil prices?");
  });
});
