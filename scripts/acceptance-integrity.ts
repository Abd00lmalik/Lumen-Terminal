/**
 * MANUAL ACCEPTANCE CHECK — the reported failure, reproduced and verified end to end.
 *
 * Steps (brief §"first manual check after the fix"):
 *   1. New Research                        -> a fresh, isolated run context
 *   2. "Use CRYPTO_MARKET_DATA only.
 *       Retrieve one fresh Bitcoin spot-price observation."
 *   3. verify the fresh evidence id
 *   4. verify the displayed research answer uses THAT evidence
 *   5. verify any judgment uses THAT evidence
 *   6. refresh                              -> a cold instance restores from the snapshot
 *   7. verify the same run/evidence/judgment remain current
 *
 * This drives the REAL pipeline (Lui dispatch -> adaptive loop -> capability registry ->
 * evidence -> judgment) and the REAL application read path (ResearchApp over the real
 * snapshot store). Only the two network edges are substituted: the model provider (scripted,
 * so the run is deterministic) and the capability transport (a stub CoinGecko-shaped
 * observation). Everything being verified — ownership stamping, context scoping, citation
 * filtering, judgment provenance, CURRENT selection, refresh reconstruction — is production
 * code, unchanged by this harness.
 *
 * Run: npx tsx scripts/acceptance-integrity.ts
 */
import { Lui } from "../src/lui/lui.js";
import { Workspace } from "../src/domain/workspace.js";
import { MemoryStore } from "../src/persistence/index.js";
import { CapabilityRegistry } from "../src/adapters/capability-registry.js";
import { ResearchApp } from "../src/api/research-app.js";
import { resetIdCounters } from "../src/domain/ids.js";
import { endRun, beginRun } from "../src/domain/run-context.js";
import type { ModelProvider, StructuredRequest } from "../src/model/provider.js";
import type { ProviderAdapter } from "../src/adapters/provider.js";
import type { ProvenanceOrigin } from "../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "acceptance check" };
const QUESTION = "Use CRYPTO_MARKET_DATA only. Retrieve one fresh Bitcoin spot-price observation.";

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === "" ? "" : `  (${detail})`}`);
  if (!ok) failures.push(label);
}

// ---------------------------------------------------------------------------
// Scripted model. Every schema the pipeline calls returns a valid, minimal object.
// ---------------------------------------------------------------------------
function scripted(schemaName: string): string {
  switch (schemaName) {
    case "lui.normalized_request":
      return JSON.stringify({
        primaryAction: "RESEARCH",
        compoundActions: [],
        objective: QUESTION,
        isExplanationOnly: false,
        disclosureLevel: 0,
      });
    case "lui.resolved_target":
      // No `flow`: the router must decide the methodology from the request itself.
      return JSON.stringify({ asset: "BTC", researchRef: "", objectRefs: [], unresolved: [] });
    case "lui.ambiguity":
      return JSON.stringify({ isAmbiguous: false, questions: [], reason: "clear retrieval request" });
    case "lui.consequence":
      return JSON.stringify({ level: "INFORMATIONAL", rationale: "read-only research", requiresConfirmation: false });
    case "safety.screen":
      return JSON.stringify({ isExecutionCommand: false, detectedViolations: [], rationale: "research question" });
    case "lui.action_plan":
      return JSON.stringify({
        steps: [{
          action: "RESEARCH",
          description: QUESTION,
          capabilities: ["CRYPTO_MARKET_DATA"],
          params: { objective: QUESTION, question: QUESTION },
        }],
        requiresConfirmationFor: [],
      });
    case "research.plan":
      return JSON.stringify({
        objective: QUESTION,
        scopeIncluded: ["Bitcoin spot price"],
        scopeExcluded: [],
        tasks: [{
          type: "FACT_FINDING",
          objective: QUESTION,
          capabilities: ["CRYPTO_MARKET_DATA"],
          completion: "one fresh spot observation",
        }],
        completionCriteria: ["a fresh BTC spot observation"],
        adaptationPolicy: "stop once the observation is collected",
      });
    case "research.adaptive_decision":
      return JSON.stringify({
        decision: "COMPLETE",
        rationale: "a fresh spot observation was collected",
        nextTasks: [],
      });
    case "research.answer_synthesis":
      return JSON.stringify({
        directAnswer: "BTC spot is $84,624 as observed at 2026-10-03T08:46:10.000Z; that is the fresh observation this request retrieved.",
        keyFactors: [{
          factor: "fresh spot price",
          mechanism: "the quoted spot level at the observation time",
          direction: "current",
          evidenceRefs: [],
          counterevidenceRefs: [],
          evidenceQuality: "DIRECT_EVIDENCE",
          evidenceDirectness: "DIRECT",
        }],
        whatWouldChangeTheView: [],
        implication: "the trader decides",
        uncertainty: [],
        confidence: "MODERATE",
        citedObjectRefs: [],
      });
    default:
      return JSON.stringify({});
  }
}

const model: ModelProvider = {
  providerId: "acceptance/scripted",
  modelId: "acceptance-1",
  async structured<T>(request: StructuredRequest): Promise<{ data: T; raw: string; schemaName: string; modelId: string }> {
    const raw = scripted(request.schemaName);
    return { data: JSON.parse(raw) as T, raw, schemaName: request.schemaName, modelId: "acceptance-1" };
  },
};

// ---------------------------------------------------------------------------
// Stub capability transport. The ISOLATION GATE is what is under test, so this adapter serves
// CRYPTO_MARKET_DATA only; the registry owns provider fallback within a capability.
// ---------------------------------------------------------------------------
const executed: string[] = [];

const coingecko: ProviderAdapter = {
  providerId: "coingecko-market",
  capabilities: ["CRYPTO_MARKET_DATA"],
  limitations: ["acceptance stub"],
  freshnessProfile: "test:live",
  async execute(capability: string) {
    return {
      tool: "coingecko-market",
      capability,
      transport: "https",
      outputs: [{
        outputClass: "QUANTITATIVE_OBSERVATION",
        content: JSON.stringify({ symbol: "BTC", price: 84624, observed_at: "2026-10-03T08:46:10.000Z" }),
        about: "BTC",
      }],
    };
  },
};

/**
 * Seed the workspace with the state the reported failure was observed in: an EARLIER Bitcoin
 * run that already retrieved an observation, at an earlier timestamp. Without this seed the
 * check would pass trivially on an empty workspace; with it, the exact contamination path is
 * live — a 07:41 observation from an earlier run sitting in the archive while the current run
 * retrieves a fresh 08:46 one.
 */
function seedEarlierBitcoinRun(ws: Workspace): { readonly researchId: string; readonly evidenceId: string } {
  const runId = "run_000000-seed";
  beginRun({ runId, userQuestion: "What is Bitcoin's current spot price?" });
  const research = ws.addResearch(
    { objective: "What is Bitcoin's current spot price?", question: "What is Bitcoin's current spot price?", flow: "INDEPENDENT_RESEARCH" },
    trader,
    new Date("2026-10-01T07:41:20.000Z"),
  );
  ws.transitionResearch(research.id, "ACTIVE", trader, "research activated", new Date("2026-10-01T07:41:20.000Z"));
  const stale = ws.addEvidence(
    {
      observation: JSON.stringify({ symbol: "BTC", price: 83394, observed_at: "2026-10-01T07:41:20.000Z" }),
      evidenceType: "market_data",
      evidenceClass: "RAW_DATA",
      timestamp: "2026-10-01T07:41:20.000Z",
    },
    trader,
    new Date("2026-10-01T07:41:20.000Z"),
  );
  ws.ingestEvidence(stale, research.id);
  ws.addJudgment(
    {
      researchRef: research.id,
      statement: "BTC is at $83,394",
      basis: { supportingEvidence: [stale.id], opposingEvidence: [], keyClaims: [], hypotheses: [] },
    },
    trader,
    new Date("2026-10-01T07:41:21.000Z"),
  );
  ws.transitionResearch(research.id, "COMPLETED", trader, "run completed", new Date("2026-10-01T07:41:30.000Z"));
  endRun(runId);
  return { researchId: research.id, evidenceId: stale.id };
}

async function main(): Promise<void> {
  resetIdCounters();
  endRun();

  const store = new MemoryStore();
  const ws = new Workspace();
  const earlier = seedEarlierBitcoinRun(ws);
  await store.save(ws.toSnapshot());
  const registry = new CapabilityRegistry();
  registry.register(coingecko);

  // Record which capabilities actually executed (capability isolation).
  const originalExecute = registry.execute.bind(registry);
  Object.defineProperty(registry, "execute", {
    value: (capability: string, ...rest: unknown[]) => {
      executed.push(capability);
      return (originalExecute as (...args: unknown[]) => unknown)(capability, ...rest);
    },
  });

  const lui = new Lui({
    provider: model,
    workspace: ws,
    store,
    registry,
    now: () => new Date("2026-10-03T08:46:00.000Z"),
  });
  void lui;

  console.log("\n=== ACCEPTANCE: fresh observation -> answer -> judgment -> refresh ===\n");
  console.log(`REQUEST: ${QUESTION}\n`);

  // Drive the APPLICATION path the UI actually calls: it owns the run context, the completion
  // judgment backstop, the response record and persistence.
  const app = await ResearchApp.create({ provider: model, registry, store, workspace: ws });
  const response = await app.submitResearchRequest(QUESTION);
  const live = app.getWorkspace();

  const current = live.getContinuitySnapshot();
  const runId = current.currentResearchRunId;
  check("a current research run exists", runId !== undefined, runId);
  if (runId === undefined) {
    console.log("\n=== ACCEPTANCE FAILED (pipeline produced no run) ===");
    process.exit(1);
  }

  const runEvidence = live.evidenceForResearch(runId);
  const freshEvidenceId = runEvidence[0]?.id;
  console.log(`--- current run ${runId}, canonical flow: ${live.getResearch(runId)?.flow ?? "n/a"}`);
  console.log(`--- evidence: ${runEvidence.map((e) => `${e.id} (${e.observation.slice(0, 60)})`).join(" | ") || "none"}`);
  console.log(`--- response researchRunId: ${response.researchRunId ?? "none"}; answer: ${response.answer.answer.slice(0, 90)}\n`);

  check("step 3: the run retrieved fresh evidence", runEvidence.length > 0, runEvidence.map((e) => e.id).join(", "));
  check("step 3: it is owned by the current run", freshEvidenceId !== undefined && live.getEvidence(freshEvidenceId)?.researchRef === runId,
    `owner=${String(live.getEvidence(freshEvidenceId ?? "")?.researchRef)} currentRun=${runId}`);
  check("step 3: it is the fresh 08:46 observation ($84,624)", live.getEvidence(freshEvidenceId ?? "")?.observation.includes("84624") === true);
  check("step 3: the earlier run's 07:41 observation is NOT in the current run",
    !runEvidence.some((e) => e.id === earlier.evidenceId),
    `earlier run ${earlier.researchId} owns ${earlier.evidenceId}`);
  check("step 3: the earlier run's judgment is not current",
    current.currentJudgment?.researchRef !== earlier.researchId);

  // Step 4 — the answer's traceability.
  const cited = response.answer.citedObjectRefs ?? [];
  check("step 4: the answer cites evidence", cited.length > 0, cited.join(", "));
  check("step 4: every cited object belongs to the current run", cited.every((ref) => live.isRunEvidence(runId, ref)),
    `current-run evidence: ${runEvidence.map((e) => e.id).join(", ")}`);
  check("step 4: the answer cites the FRESH observation, not an older one",
    cited.length > 0 && cited.every((ref) => ref === freshEvidenceId));
  check("step 4: the answer is the one this run produced", response.answer.answer.includes("84,624") === true,
    response.answer.answer.slice(0, 80));
  check("step 4: the response carries its research run id", response.researchRunId === runId, response.researchRunId);

  // Step 5 — judgment provenance.
  const judgment = current.currentJudgment;
  check("step 5: a judgment exists for the current run", judgment !== undefined, judgment?.id);
  check("step 5: it belongs to the current run", judgment?.researchRef === runId);
  const basis = judgment?.basis.supportingEvidence ?? [];
  check("step 5: its basis cites only this run's evidence", basis.every((ref) => live.isRunEvidence(runId, ref)), basis.join(", ") || "(empty)");
  check("step 5: exactly one judgment is ACTIVE FOR THIS RUN", live.judgmentsForResearch(runId).filter((j) => j.status === "ACTIVE").length === 1,
    live.listJudgments().map((j) => `${j.id}@${j.researchRef}`).join(", "));
  check("step 5: the response's judgments belong to this run",
    (response.judgments ?? []).every((j) => j.researchRunId === runId),
    (response.judgments ?? []).map((j) => `${j.ref}@${j.researchRunId}`).join(", ") || "(none)");

  // Capability isolation (reported defect 5).
  console.log("\n--- capability isolation ---");
  check("CRYPTO_MARKET_DATA executed", executed.includes("CRYPTO_MARKET_DATA"), executed.join(", "));
  check("no capability outside the stated boundary executed", executed.every((c) => c === "CRYPTO_MARKET_DATA"), executed.join(", "));
  for (const forbidden of ["FALSIFICATION", "WEB_SEARCH", "CROSS_DOMAIN_SYNTHESIS", "COMMODITY_MARKET_DATA", "NEWS_ANALYSIS", "DEEP_RESEARCH"]) {
    check(`${forbidden} did not execute`, !executed.includes(forbidden));
  }
  check("no FALSIFICATION requirement was injected into the ledger",
    !(response.researchDiagnostics?.requirements ?? []).some((r) => /counterevidence|contradicts|falsif/i.test(r.description)));

  // Steps 6-7 — refresh, through the real application read path.
  console.log("\n--- refresh ---");
  await store.save(live.toSnapshot());
  const reloaded = Workspace.fromSnapshot((await store.load())!.toSnapshot());
  const after = reloaded.getContinuitySnapshot();
  check("step 7: the same run is current", after.currentResearchRunId === runId, after.currentResearchRunId);
  check("step 7: the same evidence is current", after.recentEvidence.map((e) => e.id).join(",") === runEvidence.map((e) => e.id).join(","));
  check("step 7: the same judgment is current", after.currentJudgment?.id === judgment?.id);
  check("step 7: its provenance still points at the fresh evidence",
    (after.currentJudgment?.basis.supportingEvidence ?? []).join(",") === basis.join(","));

  // The application's own read path (what the UI calls), over a warm instance.
  const aggregate = await app.getResearchFresh(runId);
  check("read path: the run aggregate reports the same run", aggregate.researchRef === runId);
  check("read path: every judgment it serves belongs to this run",
    (aggregate.judgments ?? []).every((j) => j.researchRunId === runId),
    (aggregate.judgments ?? []).map((j) => `${j.ref}@${j.researchRunId}`).join(", ") || "(none)");
  check("read path: every evidence object it serves belongs to this run",
    (aggregate.evidence ?? []).every((e) => e.researchRunId === runId),
    (aggregate.evidence ?? []).map((e) => `${e.ref}@${e.researchRunId ?? "unowned"}`).join(", "));
  const snapshot = await app.continuityFresh();
  check("read path: the continuity snapshot points at the same run", snapshot.currentResearchRunId === runId, snapshot.currentResearchRunId);
  check("read path: Current Judgment agrees with the run", snapshot.currentJudgment?.researchRunId === runId);

  console.log(`\n=== ${failures.length === 0 ? "ACCEPTANCE PASSED" : `ACCEPTANCE FAILED (${failures.length})`} ===`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("acceptance check crashed:", error);
  process.exit(1);
});