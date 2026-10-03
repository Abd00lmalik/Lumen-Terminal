/**
 * RESEARCH-INTEGRITY REGRESSION SUITE (tests A-O).
 *
 * The invariant under test:
 *   FRESH RETRIEVAL -> CURRENT RESEARCH RUN -> CURRENT EVIDENCE -> CURRENT ANSWER -> CURRENT JUDGMENT
 * For the current run R: answer, judgment, evidence-used, traceability and Current Judgment
 * all satisfy `researchRunId === R`, and no artifact from another run can become current.
 *
 * Every test here reproduces a defect observed in manual acceptance testing, where a run
 * retrieved fresh evidence (ev_008489, 08:46) while the displayed answer cited an older
 * run's observation (ev_006748, 07:41 the previous day) and Current Judgment cited a third
 * one. The failures were never "the model chose badly": the model was choosing correctly
 * from a context that contained every run's evidence as equal peers.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { buildResearchContext, renderResearchContext } from "../../src/research/context.js";
import { completeRequirements, questionTypeOf } from "../../src/research/requirements.js";
import { capabilityConstraintOf, capabilityPermitted } from "../../src/lui/capability-constraints.js";
import { guardFlow } from "../../src/lui/flow-guard.js";
import { endRun, beginRun, currentRun } from "../../src/domain/run-context.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";
import type { ResearchResponseDTO } from "../../src/api/dto.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "regression test" };
const T0 = new Date("2026-10-03T08:00:00.000Z");

beforeEach(() => {
  resetIdCounters();
  endRun();
});

// ---------------------------------------------------------------------------
// Helpers: a run is created through the real run context, as the app layer does.
// ---------------------------------------------------------------------------

interface RunHandle {
  readonly researchId: string;
  readonly runId: string;
}

/** Begin a submission run and create its research object, exactly like submitResearchRequest. */
function beginRunWith(ws: Workspace, question: string, flow: string, at: Date = T0): RunHandle {
  const runId = `run_${String(researchCounter++).padStart(6, "0")}-tok`;
  beginRun({ runId, userQuestion: question });
  const research = ws.addResearch({ objective: question, question, flow }, trader, at);
  ws.transitionResearch(research.id, "ACTIVE", trader, "research activated", at);
  return { researchId: research.id, runId };
}
let researchCounter = 1;

/** Retrieve one observation into the run (capability execution -> evidence creation). */
function retrieve(ws: Workspace, researchId: string, observation: string, at: Date): string {
  const evidence = ws.addEvidence(
    { observation, evidenceType: "market_data", evidenceClass: "RAW_DATA", timestamp: at.toISOString() },
    trader,
    at,
  );
  return ws.ingestEvidence(evidence, researchId).id;
}

function complete(ws: Workspace, researchId: string, at: Date): void {
  ws.transitionResearch(researchId, "COMPLETED", trader, "run completed", at);
}

// ---------------------------------------------------------------------------
// TEST A — Fresh evidence binding
// ---------------------------------------------------------------------------

describe("TEST A — fresh evidence binding", () => {
  it("run 2's answer and judgment use run 2's evidence; run 1's evidence is never selected", () => {
    const ws = new Workspace();
    const run1 = beginRunWith(ws, "What is Bitcoin's current spot price?", "INDEPENDENT_RESEARCH", new Date("2026-10-01T07:41:20.000Z"));
    const oldEvidence = retrieve(ws, run1.researchId, "BTC spot $83,394", new Date("2026-10-01T07:41:20.000Z"));
    complete(ws, run1.researchId, new Date("2026-10-01T07:41:30.000Z"));
    endRun();

    const run2 = beginRunWith(ws, "What is Bitcoin's current spot price?", "INDEPENDENT_RESEARCH", new Date("2026-10-03T08:46:10.000Z"));
    const freshEvidence = retrieve(ws, run2.researchId, "BTC spot $84,624", new Date("2026-10-03T08:46:10.000Z"));
    complete(ws, run2.researchId, new Date("2026-10-03T08:46:20.000Z"));
    endRun();

    // The answer is generated from the run's synthesis context: only its own evidence.
    const ctx = buildResearchContext(ws, { researchRef: run2.researchId, relevantTo: "What is Bitcoin's current spot price?" });
    expect(ctx.items.map((i) => i.ref)).toEqual([freshEvidence]);
    expect(ctx.runEvidenceRefs).toEqual([freshEvidence]);
    // Run 1's observation is NOT selectable for run 2.
    expect(ctx.items.map((i) => i.ref)).not.toContain(oldEvidence);
    expect(ctx.runEvidenceRefs).not.toContain(oldEvidence);
  });
});

// ---------------------------------------------------------------------------
// TEST B — Exact evidence provenance
// ---------------------------------------------------------------------------

describe("TEST B — exact evidence provenance", () => {
  it("with R2 current, the resolver can only select evidence R2 owns", () => {
    const ws = new Workspace();
    const r1 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH");
    const e1 = retrieve(ws, r1.researchId, "BTC $83,394", T0);
    complete(ws, r1.researchId, new Date("2026-10-01T08:00:10.000Z"));
    endRun();
    const r2 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T08:00:00.000Z"));
    const e2 = retrieve(ws, r2.researchId, "BTC $84,624", new Date("2026-10-03T08:00:00.000Z"));
    complete(ws, r2.researchId, new Date("2026-10-03T08:00:10.000Z"));
    endRun();

    expect(ws.isRunEvidence(r2.researchId, e2)).toBe(true);
    expect(ws.isRunEvidence(r2.researchId, e1)).toBe(false);
    // Ownership is a property of the evidence object, not something re-derived per lookup.
    expect(ws.getEvidence(e2)?.researchRef).toBe(r2.researchId);
    expect(ws.getEvidence(e1)?.researchRef).toBe(r1.researchId);
  });

  it("evidence is immutable: an observation is never re-parented to another run", () => {
    const ws = new Workspace();
    const r1 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH");
    const evidence = ws.addEvidence(
      { observation: "BTC $84,624", evidenceType: "market_data", evidenceClass: "RAW_DATA" },
      trader,
      T0,
    );
    ws.ingestEvidence(evidence, r1.researchId);
    const r2 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    expect(() => ws.ingestEvidence(evidence, r2.researchId)).toThrow(/must create a new evidence record/);
    expect(ws.getEvidence(evidence.id)?.researchRef).toBe(r1.researchId);
  });
});

// ---------------------------------------------------------------------------
// TEST C / D — Current Judgment selection
// ---------------------------------------------------------------------------

function judge(ws: Workspace, researchId: string, statement: string, evidenceRefs: readonly string[]): string {
  return ws.addJudgment(
    {
      researchRef: researchId,
      statement,
      basis: { supportingEvidence: [...evidenceRefs], opposingEvidence: [], keyClaims: [], hypotheses: [] },
    },
    trader,
    T0,
  ).id;
}

describe("TEST C — current judgment isolation", () => {
  it("R2 current shows J2, before and after a refresh (never J1)", () => {
    const ws = new Workspace();
    const r1 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T08:00:00.000Z"));
    const e1 = retrieve(ws, r1.researchId, "BTC $83,394", new Date("2026-10-01T08:00:00.000Z"));
    j1: { const j1 = judge(ws, r1.researchId, "BTC is at $83,394", [e1]); complete(ws, r1.researchId, new Date("2026-10-01T08:01:00.000Z")); endRun();
      expect(j1).toMatch(/^jd_/); }
    const r2 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    const e2 = retrieve(ws, r2.researchId, "BTC $84,624", new Date("2026-10-03T09:00:00.000Z"));
    const j2 = judge(ws, r2.researchId, "BTC is at $84,624", [e2]);
    complete(ws, r2.researchId, new Date("2026-10-03T09:01:00.000Z"));
    endRun();

    const current = ws.getContinuitySnapshot();
    expect(current.currentResearchRunId).toBe(r2.researchId);
    expect(current.currentJudgment?.id).toBe(j2);
    expect(current.currentJudgment?.researchRef).toBe(r2.researchId);

    // REFRESH: a fresh instance restores the same graph and must resolve the same verdict.
    const reloaded = Workspace.fromSnapshot(JSON.parse(JSON.stringify(ws.toSnapshot())) as never);
    const afterRefresh = reloaded.getContinuitySnapshot();
    expect(afterRefresh.currentResearchRunId).toBe(r2.researchId);
    expect(afterRefresh.currentJudgment?.id).toBe(j2);
  });
});

describe("TEST D — no judgment means no stale judgment", () => {
  it("a run without its own conclusion shows none, not the previous run's", () => {
    const ws = new Workspace();
    const r1 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T08:00:00.000Z"));
    const e1 = retrieve(ws, r1.researchId, "BTC $83,394", new Date("2026-10-01T08:00:00.000Z"));
    const j1 = judge(ws, r1.researchId, "BTC is at $83,394", [e1]);
    complete(ws, r1.researchId, new Date("2026-10-01T08:01:00.000Z"));
    endRun();
    // R2 retrieves evidence but produces no judgment.
    const r2 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    retrieve(ws, r2.researchId, "BTC $84,624", new Date("2026-10-03T09:00:00.000Z"));
    complete(ws, r2.researchId, new Date("2026-10-03T09:01:00.000Z"));
    endRun();

    const current = ws.getContinuitySnapshot();
    expect(current.currentResearchRunId).toBe(r2.researchId);
    expect(current.currentJudgment).toBeUndefined();
    expect(ws.currentJudgment(r2.researchId)).toBeUndefined();
    // J1 still exists as history — it is simply not current.
    expect(ws.getJudgment(j1)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TEST E / F — judgment provenance and uniqueness
// ---------------------------------------------------------------------------

describe("TEST E — evidence count consistency", () => {
  it("a run with one evidence record cannot produce a judgment citing another object", () => {
    const ws = new Workspace();
    const r1 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T08:00:00.000Z"));
    const foreign = retrieve(ws, r1.researchId, "BTC $83,394", new Date("2026-10-01T08:00:00.000Z"));
    complete(ws, r1.researchId, new Date("2026-10-01T08:01:00.000Z"));
    endRun();
    const r2 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    const own = retrieve(ws, r2.researchId, "BTC $84,624", new Date("2026-10-03T09:00:00.000Z"));

    // The model cites both; the engine records only what this run retrieved.
    const judgment = ws.addJudgment(
      {
        researchRef: r2.researchId,
        statement: "BTC is at $84,624",
        basis: { supportingEvidence: [own, foreign], opposingEvidence: [], keyClaims: [], hypotheses: [] },
      },
      trader,
      T0,
    );
    expect(judgment.basis.supportingEvidence).toEqual([own]);
    // The strip is auditable, not silent.
    expect(judgment.provenance.some((p) => p.note.includes(foreign))).toBe(true);
  });
});

describe("TEST F — judgment uniqueness", () => {
  it("one request produces exactly one judgment with one id; a re-add reuses it", () => {
    const ws = new Workspace();
    const run = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH");
    const evidence = retrieve(ws, run.researchId, "BTC $84,624", T0);
    const first = judge(ws, run.researchId, "BTC is at $84,624", [evidence]);
    // The completion backstop arriving after a merge must not mint a second judgment.
    const again = judge(ws, run.researchId, "BTC is at $84,624", [evidence]);
    expect(again).toBe(first);
    expect(ws.listJudgments()).toHaveLength(1);
    expect(ws.judgmentsForResearch(run.researchId)).toHaveLength(1);
    expect(ws.currentJudgment(run.researchId)?.id).toBe(first);
  });

  it("a similar question in a LATER run never reuses the earlier run's judgment", () => {
    const ws = new Workspace();
    const r1 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T08:00:00.000Z"));
    const e1 = retrieve(ws, r1.researchId, "BTC $83,394", new Date("2026-10-01T08:00:00.000Z"));
    const j1 = judge(ws, r1.researchId, "BTC is at $83,394", [e1]);
    complete(ws, r1.researchId, new Date("2026-10-01T08:01:00.000Z"));
    endRun();
    // Identical statement text, different run: a NEW judgment, because ids are never reused.
    const r2 = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    const e2 = retrieve(ws, r2.researchId, "BTC $84,624", new Date("2026-10-03T09:00:00.000Z"));
    const j2 = judge(ws, r2.researchId, "BTC is at $83,394", [e2]);
    expect(j2).not.toBe(j1);
    expect(ws.getJudgment(j2)?.researchRef).toBe(r2.researchId);
  });
});

// ---------------------------------------------------------------------------
// TEST G — async stale completion
// ---------------------------------------------------------------------------

describe("TEST G — async stale completion", () => {
  it("an earlier run that finishes after a newer one cannot become CURRENT", () => {
    const ws = new Workspace();
    // R1 starts first...
    const runId1 = `run_000001-aaa`;
    beginRun({ runId: runId1, userQuestion: "BTC price" });
    const r1 = ws.addResearch({ objective: "BTC price", question: "BTC price", flow: "INDEPENDENT_RESEARCH" }, trader, new Date("2026-10-03T08:00:00.000Z"));
    ws.transitionResearch(r1.id, "ACTIVE", trader, "activated", new Date("2026-10-03T08:00:00.000Z"));
    const e1 = retrieve(ws, r1.id, "BTC $83,394", new Date("2026-10-03T08:00:00.000Z"));
    judge(ws, r1.id, "BTC is at $83,394", [e1]);
    // ...R2 starts and completes before R1 finishes.
    endRun(runId1);
    const runId2 = `run_000002-bbb`;
    beginRun({ runId: runId2, userQuestion: "BTC price" });
    const r2 = ws.addResearch({ objective: "BTC price", question: "BTC price", flow: "INDEPENDENT_RESEARCH" }, trader, new Date("2026-10-03T09:00:00.000Z"));
    ws.transitionResearch(r2.id, "ACTIVE", trader, "activated", new Date("2026-10-03T09:00:00.000Z"));
    const e2 = retrieve(ws, r2.id, "BTC $84,624", new Date("2026-10-03T09:00:00.000Z"));
    const j2 = judge(ws, r2.id, "BTC is at $84,624", [e2]);
    complete(ws, r2.id, new Date("2026-10-03T09:00:10.000Z"));
    // R1's late completion lands LAST in insertion order but was submitted FIRST.
    complete(ws, r1.id, new Date("2026-10-03T09:30:00.000Z"));
    endRun(runId2);

    // CURRENT is the run the trader submitted last, not the one that finished last.
    const current = ws.getContinuitySnapshot();
    expect(current.currentResearchRunId).toBe(r2.id);
    expect(current.currentJudgment?.id).toBe(j2);
    expect(current.currentJudgment?.statement).not.toContain("83,394");
  });

  it("ending one run never clears another run's active context", () => {
    const runId1 = `run_000001-aaa`;
    beginRun({ runId: runId1, userQuestion: "first" });
    const runId2 = `run_000002-bbb`;
    beginRun({ runId: runId2, userQuestion: "second" });
    // The first request's `finally` fires after the second request already began.
    endRun(runId1);
    expect(currentRun()?.runId).toBe(runId2);
  });
});

// ---------------------------------------------------------------------------
// TEST H — New Research isolation
// ---------------------------------------------------------------------------

describe("TEST H — new research isolation", () => {
  it("an Ethereum run leaves nothing behind for a following Bitcoin run", () => {
    const ws = new Workspace();
    const eth = beginRunWith(ws, "Research the Ethereum halving thesis", "DOES_MY_THESIS_HOLD");
    const ethEvidence = retrieve(ws, eth.researchId, "ETH block 21,000,000 mined; staking yield 3.1%", new Date("2026-10-01T08:00:00.000Z"));
    ws.addThesis({ statement: "Ethereum halving thesis", objective: "position" }, trader);
    complete(ws, eth.researchId, new Date("2026-10-01T08:01:00.000Z"));
    endRun();

    const btc = beginRunWith(ws, "What is Bitcoin's current spot price?", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    const btcEvidence = retrieve(ws, btc.researchId, "BTC spot $84,624", new Date("2026-10-03T09:00:00.000Z"));
    complete(ws, btc.researchId, new Date("2026-10-03T09:01:00.000Z"));
    endRun();

    const ctx = buildResearchContext(ws, {
      researchRef: btc.researchId,
      relevantTo: "What is Bitcoin's current spot price?",
      // An independent question never earns thesis context.
      includeThesis: false,
    });
    const rendered = renderResearchContext(ctx);
    expect(ctx.items.map((i) => i.ref)).toEqual([btcEvidence]);
    expect(rendered).not.toContain("ETH block");
    expect(rendered).not.toContain("halving");
    expect(ctx.thesis).toBeUndefined();
    expect(ctx.runEvidenceRefs).not.toContain(ethEvidence);

    // The continuity snapshot's evidence panel is the Bitcoin run's, not the Ethereum run's.
    const current = ws.getContinuitySnapshot();
    expect(current.currentResearchRunId).toBe(btc.researchId);
    expect(current.recentEvidence.map((e) => e.id)).toEqual([btcEvidence]);
  });
});

// ---------------------------------------------------------------------------
// TEST I — capability isolation
// ---------------------------------------------------------------------------

describe("TEST I — capability isolation", () => {
  const request = "Use CRYPTO_MARKET_DATA only. Retrieve one fresh Bitcoin spot-price observation.";

  it("the explicit boundary is parsed deterministically into an allowlist", () => {
    const constraint = capabilityConstraintOf(request);
    expect(constraint.allowed).toEqual(["CRYPTO_MARKET_DATA"]);
  });

  it("unrelated capabilities may not execute; the fallback provider inside the capability may", () => {
    const constraint = capabilityConstraintOf(request);
    expect(capabilityPermitted("CRYPTO_MARKET_DATA", constraint)).toBe(true);
    // A provider fallback INSIDE the capability is the registry's business, not a violation.
    expect(capabilityPermitted("CRYPTO_MARKET_DATA", constraint)).toBe(true);
    for (const blocked of ["FALSIFICATION", "WEB_SEARCH", "CROSS_DOMAIN_SYNTHESIS", "COMMODITY_MARKET_DATA", "NEWS_ANALYSIS", "DEEP_RESEARCH"]) {
      expect(capabilityPermitted(blocked, constraint)).toBe(false);
    }
  });

  it("a message with no boundary constrains nothing", () => {
    const constraint = capabilityConstraintOf("What happened to BTC yesterday?");
    expect(constraint.allowed).toBeUndefined();
    expect(capabilityPermitted("WEB_SEARCH", constraint)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST J — canonical flow isolation
// ---------------------------------------------------------------------------

describe("TEST J — canonical flow isolation", () => {
  it("each canonical request persists its own flow, never a Flow 6 fallback", () => {
    const ws = new Workspace();
    const cases: readonly { readonly message: string; readonly flow: string }[] = [
      { message: "What happened to Bitcoin in the last 24 hours?", flow: "WHAT_HAPPENED" },
      { message: "Why did Bitcoin fall yesterday?", flow: "WHY_IT_HAPPENED" },
      { message: "What could affect Bitcoin next week?", flow: "WHAT_COULD_AFFECT_IT" },
      { message: "Has this Bitcoin setup happened before?", flow: "HAS_THIS_HAPPENED_BEFORE" },
      { message: "What does all the information say about Bitcoin?", flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
      { message: "What could prove my Bitcoin thesis wrong?", flow: "WHAT_COULD_PROVE_ME_WRONG" },
    ];
    for (const c of cases) {
      const guarded = guardFlow({ message: c.message });
      expect(guarded.flow, `message: ${c.message}`).toBe(c.flow);
    }
  });

  it("an unidentified request is recorded honestly, not under a canonical flow", () => {
    const guarded = guardFlow({ message: "retrieve a fresh bitcoin observation" });
    expect(guarded.flow).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TEST K — challenge isolation
// ---------------------------------------------------------------------------

describe("TEST K — challenge isolation", () => {
  it("a raw market-data request acquires no counterevidence requirement", () => {
    const q = "What is Bitcoin's current spot price?";
    expect(questionTypeOf(q)).toBe("OBSERVATION");
    const ledger = completeRequirements(q, [], { marketClass: "CRYPTO" });
    expect(ledger.some((r) => r.role === "CHALLENGE")).toBe(false);
    expect(ledger.some((r) => /counterevidence|contradicts/i.test(r.description))).toBe(false);
  });

  it("an analytic question still earns its counterevidence dimension", () => {
    const q = "What is driving oil prices this week?";
    expect(questionTypeOf(q)).toBe("CAUSAL");
    const ledger = completeRequirements(q, [], { marketClass: "COMMODITY" });
    expect(ledger.some((r) => r.role === "CHALLENGE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST L — active thesis isolation
// ---------------------------------------------------------------------------

describe("TEST L — active thesis isolation", () => {
  it("an active Ethereum thesis never enters an unrelated Bitcoin price question", () => {
    const ws = new Workspace();
    ws.addThesis(
      {
        statement: "Ethereum outperforms after every halving",
        objective: "position sizing",
        claims: [{ statement: "ETH supply issuance falls after the halving", importance: "CORE", invalidationConditions: [] }],
        invalidationConditions: ["ETH/BTC below 0.05 for two weeks"],
      },
      trader,
    );
    const run = beginRunWith(ws, "What is Bitcoin's current spot price?", "INDEPENDENT_RESEARCH");
    retrieve(ws, run.researchId, "BTC spot $84,624", T0);

    const independent = buildResearchContext(ws, { researchRef: run.researchId, relevantTo: "What is Bitcoin's current spot price?" });
    expect(independent.thesis).toBeUndefined();
    expect(renderResearchContext(independent)).not.toContain("Ethereum");
    expect(renderResearchContext(independent)).not.toContain("ETH/BTC");

    // The thesis-facing flow earns it.
    const thesisRun = buildResearchContext(ws, { researchRef: run.researchId, includeThesis: true });
    expect(thesisRun.thesis?.statement).toBe("Ethereum outperforms after every halving");
  });
});

// ---------------------------------------------------------------------------
// TEST M — refresh integrity
// ---------------------------------------------------------------------------

describe("TEST M — refresh integrity", () => {
  it("the same run, evidence, answer, judgment and provenance survive a refresh", () => {
    const ws = new Workspace();
    const older = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T07:41:20.000Z"));
    retrieve(ws, older.researchId, "BTC $83,394", new Date("2026-10-01T07:41:20.000Z"));
    complete(ws, older.researchId, new Date("2026-10-01T07:42:00.000Z"));
    endRun();

    const current = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T08:46:10.000Z"));
    const evidence = retrieve(ws, current.researchId, "BTC $84,624", new Date("2026-10-03T08:46:10.000Z"));
    const judgment = judge(ws, current.researchId, "BTC is at $84,624", [evidence]);
    complete(ws, current.researchId, new Date("2026-10-03T08:47:00.000Z"));
    endRun();

    // Refresh = a cold instance restoring the persisted snapshot.
    const reloaded = Workspace.fromSnapshot(JSON.parse(JSON.stringify(ws.toSnapshot())) as never);
    const snapshot = reloaded.getContinuitySnapshot();
    expect(snapshot.currentResearchRunId).toBe(current.researchId);
    expect(snapshot.currentJudgment?.id).toBe(judgment);
    expect(snapshot.recentEvidence.map((e) => e.id)).toEqual([evidence]);
    expect(snapshot.currentJudgment?.basis.supportingEvidence).toEqual([evidence]);
    // No older evidence or judgment is reachable from the current pointers.
    expect(snapshot.currentJudgment?.statement).not.toContain("83,394");
  });
});

// ---------------------------------------------------------------------------
// TEST N — history integrity
// ---------------------------------------------------------------------------

describe("TEST N — history integrity", () => {
  it("each run keeps its own evidence and judgment; history never determines CURRENT", () => {
    const ws = new Workspace();
    const btc = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T08:00:00.000Z"));
    const btcEvidence = retrieve(ws, btc.researchId, "BTC $83,394", new Date("2026-10-01T08:00:00.000Z"));
    const btcJudgment = judge(ws, btc.researchId, "BTC is at $83,394", [btcEvidence]);
    complete(ws, btc.researchId, new Date("2026-10-01T08:01:00.000Z"));
    endRun();

    const eth = beginRunWith(ws, "ETH price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    const ethEvidence = retrieve(ws, eth.researchId, "ETH $2,900", new Date("2026-10-03T09:00:00.000Z"));
    const ethJudgment = judge(ws, eth.researchId, "ETH is at $2,900", [ethEvidence]);
    complete(ws, eth.researchId, new Date("2026-10-03T09:01:00.000Z"));
    endRun();

    // Each run's own aggregate is intact...
    expect(ws.judgmentsForResearch(btc.researchId).map((j) => j.id)).toEqual([btcJudgment]);
    expect(ws.judgmentsForResearch(eth.researchId).map((j) => j.id)).toEqual([ethJudgment]);
    expect(ws.currentJudgment(btc.researchId)?.basis.supportingEvidence).toEqual([btcEvidence]);
    expect(ws.currentJudgment(eth.researchId)?.basis.supportingEvidence).toEqual([ethEvidence]);
    // ...and CURRENT comes from the workspace pointer, never from the history list.
    expect(ws.getContinuitySnapshot().currentResearchRunId).toBe(eth.researchId);
  });
});

// ---------------------------------------------------------------------------
// TEST O — save integrity
// ---------------------------------------------------------------------------

describe("TEST O — save integrity", () => {
  it("a saved artifact keeps pointing at its own run's evidence and judgment", () => {
    const ws = new Workspace();
    const older = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-01T08:00:00.000Z"));
    const olderEvidence = retrieve(ws, older.researchId, "BTC $83,394", new Date("2026-10-01T08:00:00.000Z"));
    const olderJudgment = judge(ws, older.researchId, "BTC is at $83,394", [olderEvidence]);
    complete(ws, older.researchId, new Date("2026-10-01T08:01:00.000Z"));
    endRun();

    const saved = beginRunWith(ws, "BTC price", "INDEPENDENT_RESEARCH", new Date("2026-10-03T09:00:00.000Z"));
    const savedEvidence = retrieve(ws, saved.researchId, "BTC $84,624", new Date("2026-10-03T09:00:00.000Z"));
    const savedJudgment = judge(ws, saved.researchId, "BTC is at $84,624", [savedEvidence]);
    complete(ws, saved.researchId, new Date("2026-10-03T09:01:00.000Z"));
    endRun();

    const artifact = ws.saveArtifact(
      {
        type: "finding",
        kind: "RESEARCH",
        content: "BTC at $84,624",
        rationale: "fresh observation",
        researchRef: saved.researchId,
        derivedFromRefs: [savedEvidence, savedJudgment],
      },
      { kind: "trader", detail: "confirmed save" },
      T0,
    );
    // Refresh, then open Saved: the artifact still resolves to ITS run's objects.
    const reloaded = Workspace.fromSnapshot(JSON.parse(JSON.stringify(ws.toSnapshot())) as never);
    const restored = reloaded.listSavedArtifacts().find((a) => a.id === artifact.id);
    expect(restored).toBeDefined();
    expect(restored?.researchRef).toBe(saved.researchId);
    expect(restored?.derivedFromRefs).toContain(savedEvidence);
    expect(restored?.derivedFromRefs).toContain(savedJudgment);
    expect(restored?.derivedFromRefs).not.toContain(olderEvidence);
    expect(restored?.derivedFromRefs).not.toContain(olderJudgment);
    expect(reloaded.getJudgment(savedJudgment)?.researchRef).toBe(saved.researchId);
  });
});

// ---------------------------------------------------------------------------
// Provenance contract, stated as one check over a realistic multi-run workspace.
// ---------------------------------------------------------------------------

describe("PROVENANCE CONTRACT — one current run, one consistent artifact set", () => {
  it("every current artifact satisfies researchRunId === currentResearchRunId", () => {
    const ws = new Workspace();
    for (const [i, asset] of ["BTC", "ETH", "SOL"].entries()) {
      const run = beginRunWith(ws, `${asset} price`, "INDEPENDENT_RESEARCH", new Date(`2026-10-0${i + 1}T09:00:00.000Z`));
      const evidence = retrieve(ws, run.researchId, `${asset} spot $${100 + i}`, new Date(`2026-10-0${i + 1}T09:00:00.000Z`));
      judge(ws, run.researchId, `${asset} is at $${100 + i}`, [evidence]);
      complete(ws, run.researchId, new Date(`2026-10-0${i + 1}T09:01:00.000Z`));
      endRun();
    }
    const current = ws.getContinuitySnapshot();
    const R = current.currentResearchRunId;
    expect(R).toBeDefined();
    expect(current.activeResearchTarget?.id).toBe(R);
    expect(current.currentJudgment?.researchRef).toBe(R);
    for (const e of current.recentEvidence) expect(e.researchRef).toBe(R);
    for (const j of current.currentJudgment !== undefined ? [current.currentJudgment] : []) expect(j.researchRef).toBe(R);

    // The client-facing response shape carries the same identity end to end.
    const response: Partial<ResearchResponseDTO> = {
      researchRef: R,
      researchRunId: R,
      evidence: current.recentEvidence.map((e) => ({ ref: e.id, researchRunId: e.researchRef, observation: e.observation, evidenceType: e.evidenceType, evidenceClass: "RAW_DATA", freshness: "CURRENT", observedAt: e.observedAt, sourceRefs: e.sourceRefs, supports: e.supports, contradicts: e.contradicts })),
      judgments: current.currentJudgment !== undefined
        ? [{ ref: current.currentJudgment.id, researchRunId: current.currentJudgment.researchRef, statement: current.currentJudgment.statement, uncertainty: [], implications: [], unresolvedQuestions: [], supportingEvidence: [...current.currentJudgment.basis.supportingEvidence], opposingEvidence: [], keyClaims: [], hypotheses: [], status: "ACTIVE" }]
        : [],
    };
    expect(response.evidence!.every((e) => e.researchRunId === R)).toBe(true);
    expect(response.judgments!.every((j) => j.researchRunId === R)).toBe(true);
  });
});