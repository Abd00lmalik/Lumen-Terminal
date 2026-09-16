/**
 * Flow 1 — WHAT HAPPENED? (event reconstruction) — the first end-to-end research pipeline.
 *
 * Architectural basis:
 * - research-flows.md FLOW 1: reconstruct the event → build a timeline → identify candidate
 *   explanations → cross-check → identify contradictions → strongest-supported explanation →
 *   confidence. "It is primarily event reconstruction, not deep causal investigation."
 * - research-planning.md: the plan is a LIVING execution model — scope, tasks, capabilities,
 *   completion criteria, adaptation policy — preserved as first-class objects in the response.
 * - tool-skill-orchestration.md §2.1 + final lock §6: capability-first selection. The flow
 *   declares capabilities (NEWS_ANALYSIS, TECHNICAL_ANALYSIS); the registry resolves providers.
 *   No flow→tool hardcoding: swapping providers needs zero changes here.
 * - Final lock §7/§10: evidence classification is mandatory; failure is not negative evidence;
 *   completeness is never fabricated; QUALITY ≠ CONFIDENCE.
 * - Final lock §12 + progressive-disclosure.md: the response explains conclusions through
 *   observable evidence, sources, uncertainty, and structure only — no chain-of-thought.
 * - Final lock §13: research only. No trading/execution surface exists in this module.
 * - M2 scope (per authorization): the intent entry point is a narrow structured stub — full
 *   natural-language LUI (intent detection, entity resolution, ambiguity, action classification)
 *   is M3. No LUI, no UI, no G1/G2 vendors.
 */

import type { CapabilityRegistry } from "../adapters/capability-registry.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { ToolResult } from "../domain/tool-result.js";
import type { Evidence, Judgment, Research } from "../domain/objects.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import { evidenceFromToolResult } from "../domain/evidence.js";

// ---------------------------------------------------------------------------
// Narrow intent entry point (M2 stub — full LUI is M3)
// ---------------------------------------------------------------------------

/**
 * Deliberately narrow, fully structured input for M2. The full natural-language LUI (intent
 * detection, entity resolution, ambiguity handling, action classification) is M3 per the phase
 * plan — this stub exists so the research path can be validated end-to-end first.
 */
export interface Flow1Request {
  /** The trader's question, preserved verbatim for provenance (never paraphrased). */
  readonly question: string;
  /** Asset under investigation, e.g. "BTC". */
  readonly asset: string;
  /**
   * Rough event window: [from, to] as ISO strings. Optional — when absent the plan notes the
   * window as unresolved and the response's uncertainty names it (no fabricated precision).
   */
  readonly window?: readonly [string, string];
  /** Optional trader constraints, e.g. ["ignore social sentiment"] (research-planning.md §29). */
  readonly constraints?: readonly string[];
}

/** Resolved research target for the flow. */
export interface Flow1Target {
  readonly asset: string;
  readonly window: readonly [string, string] | undefined;
  readonly windowResolved: boolean;
}

/** Resolve a request into a research target. (M2: direct mapping; M3 adds NL resolution.) */
export function resolveFlow1Target(request: Flow1Request): Flow1Target {
  return {
    asset: request.asset,
    window: request.window,
    windowResolved: request.window !== undefined,
  };
}

// ---------------------------------------------------------------------------
// Living research plan (research-planning.md §2)
// ---------------------------------------------------------------------------

export interface Flow1Plan {
  readonly researchRef: string;
  readonly objective: string;
  readonly scope: { readonly included: readonly string[]; readonly excluded: readonly string[] };
  /** Task list with the required capabilities per task — the capability-first seam. */
  readonly tasks: readonly {
    readonly type: string;
    readonly objective: string;
    readonly capabilities: readonly string[];
    readonly completion: string;
  }[];
  readonly completionCriteria: readonly string[];
  readonly adaptationPolicy: string;
}

/**
 * Build the living plan. Capability selection is requirement-driven: the plan names CAPABILITIES,
 * never providers — the registry decides who serves them (final lock §6/§11). Additional
 * capabilities join only when the plan determines material information value (final lock §3:
 * adaptive depth; here: a fourth task is added only when the window is resolved, because
 * cross-checking sentiment/positioning context is only meaningful for a bounded window).
 */
export function buildFlow1Plan(request: Flow1Request, researchRef: string): Flow1Plan {
  const target = resolveFlow1Target(request);
  const tasks: Flow1Plan["tasks"][number][] = [
    {
      type: "EVENT_RECONSTRUCTION",
      objective: `Establish what happened to ${target.asset}: exact price action and timestamps.`,
      capabilities: ["TECHNICAL_ANALYSIS"],
      completion: "price structure for the window established or unavailability recorded",
    },
    {
      type: "FACT_FINDING",
      objective: `Identify major contemporaneous developments and narratives for ${target.asset}.`,
      capabilities: ["NEWS_ANALYSIS"],
      completion: "candidate developments collected from available feeds or unavailability recorded",
    },
  ];
  const scopeIncluded = ["market data (recent klines/indicators)", "news aggregation and narratives"];
  if (target.windowResolved) {
    tasks.push({
      type: "MARKET_STRUCTURE_ANALYSIS",
      objective: "Check positioning/sentiment context for the resolved window (material only when the window is bounded).",
      capabilities: ["SENTIMENT_ANALYSIS", "MARKET_DATA_ANALYSIS"],
      completion: "positioning context collected or deemed immaterial",
    });
    scopeIncluded.push("positioning/sentiment context (window-resolved only)");
  }
  tasks.push({
    type: "SYNTHESIS",
    objective: "Cross-check candidate explanations, identify contradictions, and rank by evidence support.",
    capabilities: [],
    completion: "strongest-supported explanation selected with contradictions preserved",
  });
  return {
    researchRef,
    objective: request.question,
    scope: {
      included: scopeIncluded,
      excluded: [
        "causal investigation (Flow 2 territory)",
        "historical precedent (Flow 5 — G1 vendor not connected)",
        "primary-source retrieval (G2 vendor not connected)",
        ...(request.constraints ?? []),
      ],
    },
    tasks,
    completionCriteria: [
      "event reconstruction attempted with exact timestamps, or tool unavailability recorded",
      "news/narrative candidates collected, or feed unavailability recorded",
      "contradictions preserved, not resolved by deletion",
      "judgment states what remains uncertain",
    ],
    adaptationPolicy: "additional capabilities are added only when the evidence shows material information value (final lock §9)",
  };
}

// ---------------------------------------------------------------------------
// Execution result + progressive-disclosure response (final lock §12/§15)
// ---------------------------------------------------------------------------

export interface Flow1ExecutionRecord {
  readonly capability: string;
  readonly result: ToolResult;
  readonly evidenceIds: readonly string[];
}

export interface Flow1Outcome {
  readonly research: Research;
  readonly plan: Flow1Plan;
  readonly target: Flow1Target;
  /** What was executed, in order — full provenance path (request → tool → evidence → graph). */
  readonly executions: readonly Flow1ExecutionRecord[];
  readonly judgment: Judgment | undefined;
  readonly analysisId: string;
  /** Concise default response (progressive-disclosure levels 0–1; deeper levels live in state). */
  readonly response: string;
  /** Structured completion signal (completion-stopping.md: insufficient evidence is a valid completion). */
  readonly completion: "COMPLETE" | "INSUFFICIENT_EVIDENCE" | "PARTIAL";
}

/** Evidence gathered with exact event timestamps (klines, dated news items). */
interface Dated {
  readonly at: string;
  readonly label: string;
}

/** Parse the discovered envelope shapes of the two flow capabilities. */
function parseDatedObservation(content: unknown): Dated | undefined {
  if (typeof content !== "object" || content === null) return undefined;
  const record = content as Record<string, unknown>;
  // REST kline: { ts, open, high, low, close, ... }
  if (typeof record.ts === "string" && typeof record.close === "string") {
    return { at: new Date(Number(record.ts)).toISOString(), label: `close ${record.close}` };
  }
  // news_feed item (DISCOVERED live): { title, link, published?, summary?, feed? }
  if (typeof record.title === "string") {
    const published = typeof record.published === "string" ? Date.parse(record.published) : NaN;
    return {
      at: Number.isNaN(published) ? "" : new Date(published).toISOString(),
      label: record.title,
    };
  }
  return undefined;
}

/**
 * Run Flow 1 end-to-end: request → target → plan → capability selection → execution →
 * TOOL_RESULT → evidence validation/classification → claims → contradictions → analysis →
 * judgment → workspace/state update → progressive-disclosure response.
 */
export async function runFlow1(
  request: Flow1Request,
  options: {
    readonly registry: CapabilityRegistry;
    readonly workspace: Workspace;
    readonly store: WorkspaceStore;
    /** Injectable clock (tests); defaults to now. */
    readonly now?: () => Date;
  },
): Promise<Flow1Outcome> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 1 orchestration" };
  const workspace = options.workspace;

  // 1. Research object (objective/question preserved verbatim; flow is locked vocabulary).
  const research = workspace.addResearch(
    { objective: request.question, question: request.question, flow: "WHAT_HAPPENED" },
    { kind: "trader", detail: "Flow 1 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  // 2. Target + living plan (planning doc §3: plan never replaces the objective).
  const target = resolveFlow1Target(request);
  const plan = buildFlow1Plan(request, research.id);

  // 3. Execute plan tasks through the capability registry (capability-first; provider-agnostic).
  const executions: Flow1ExecutionRecord[] = [];
  const dated: Dated[] = [];
  const newsEvidence: Evidence[] = [];
  let toolFailures = 0;

  for (const task of plan.tasks) {
    if (task.capabilities.length === 0) continue; // synthesis is local (no more capabilities in M2)
    for (const capability of task.capabilities) {
      const result = await options.registry.execute(capability, {}, systemOrigin, at());
      const evidenceIds: string[] = [];

      if (result.failure.type === "NONE") {
        for (const output of result.normalizedOutput) {
          try {
            const evidence = evidenceFromToolResult(result, output, { kind: "tool", toolRef: result.tool, invocation: result.invocation.params }, {}, at());
            workspace.ingestEvidence(evidence, research.id);
            evidenceIds.push(evidence.id);

            const datedItem = parseDatedObservation(output.content);
            if (datedItem !== undefined && datedItem.at !== "") {
              dated.push(datedItem);
              if (output.outputClass === "FACTUAL_OBSERVATION") newsEvidence.push(evidence);
            }
          } catch {
            // UNAVAILABLE/invalid outputs never become evidence (evidence.ts invariant).
          }
        }
      } else {
        toolFailures += 1;
        // Failure is NOT negative evidence (final lock §10): nothing enters the graph; the
        // failure itself is recorded in the execution record + limitations + response.
      }

      executions.push({ capability, result, evidenceIds });
    }
  }

  // 4. Claims — the propositions the judgment will weigh (one per reconstruction dimension).
  const priceClaim = workspace.addClaim(
    { statement: `Price structure for ${target.asset} over the research window is established from market data.`, type: "EVENT_RECONSTRUCTION", researchRef: research.id },
    systemOrigin,
    at(),
  );
  const newsClaim = workspace.addClaim(
    { statement: `Contemporaneous developments for ${target.asset} are identified from available feeds.`, type: "FACT_FINDING", researchRef: research.id },
    systemOrigin,
    at(),
  );

  // Link supporting evidence to claims (direction recorded on the evidence, graph is truth).
  for (const execution of executions) {
    for (const evidenceId of execution.evidenceIds) {
      const evidence = workspace.getEvidence(evidenceId);
      if (evidence === undefined) continue;
      const isPrice = execution.capability === "TECHNICAL_ANALYSIS";
      workspace.linkEvidenceToClaim(
        evidenceId,
        isPrice ? priceClaim.id : newsClaim.id,
        "supports",
        { kind: "agent", detail: "flow-1 linking" },
        `linked to ${isPrice ? "price-structure" : "developments"} claim`,
        at(),
      );
    }
  }

  // 5. Contradiction/alternative handling (final lock §11): contradictions are OBSERVED, not
  // manufactured — Flow 1 records them when the evidence itself carries opposing directions
  // (news items whose text contradicts the dominant narrative direction). M2 keeps this honest
  // and minimal: a CONTRADICTION_CHECK analysis over news evidence classes.
  const contradictions = findContradictions(newsEvidence);

  // 6. Analysis — deliberate analytical step with explicit uncertainty (object model §8).
  const priceExec = executions.find((e) => e.capability === "TECHNICAL_ANALYSIS");
  const newsExec = executions.find((e) => e.capability === "NEWS_ANALYSIS");
  const priceAvailable = priceExec !== undefined && priceExec.result.failure.type === "NONE" && priceExec.evidenceIds.length > 0;
  const newsAvailable = newsExec !== undefined && newsExec.result.failure.type === "NONE" && newsExec.evidenceIds.length > 0;

  const uncertainty: string[] = [];
  if (!target.windowResolved) uncertainty.push("event window was not specified; reconstruction covers the most recent data only");
  if (!priceAvailable) uncertainty.push("exact price structure unavailable — market-data capability returned no usable evidence");
  if (!newsAvailable) uncertainty.push("no news/narrative evidence was obtainable — absence of news evidence is NOT evidence of absence of events");
  if (toolFailures > 0) uncertainty.push(`${toolFailures} capability invocation(s) failed; failed retrievals are not treated as negative evidence`);

  const analysis = workspace.addAnalysis(
    {
      objective: `Reconstruct what happened to ${target.asset} and identify the strongest-supported explanation.`,
      mode: "SYNTHESIZE",
      targetRefs: [priceClaim.id, newsClaim.id],
      inputs: executions.flatMap((e) => e.evidenceIds),
      findings: [
        priceAvailable ? `price-structure evidence collected (${priceExec!.evidenceIds.length} observations)` : "price-structure evidence unavailable",
        newsAvailable ? `news evidence collected (${newsExec!.evidenceIds.length} items)` : "news evidence unavailable",
        ...(contradictions.length > 0 ? [`contradictions observed: ${contradictions.join("; ")}`] : []),
      ],
      conclusion: buildAnalysisConclusion(priceAvailable, newsAvailable, target),
      uncertainty,
    },      systemOrigin,
      at(),
  );

  // 7. Judgment (final lock §12): what is observed / inferred / uncertain / would-change —
  // with confidence derived separately from evidence quality (QUALITY ≠ CONFIDENCE).
  let judgment: Judgment | undefined;
  let completion: Flow1Outcome["completion"] = "PARTIAL";

  if (priceAvailable && newsAvailable) {
    const judgmentStatement = buildJudgmentStatement(target, dated, newsEvidence);
    judgment = workspace.addJudgment(
      {
        researchRef: research.id,
        statement: judgmentStatement,
        basis: {
          supportingEvidence: executions.flatMap((e) => e.evidenceIds),
          opposingEvidence: [],
          keyClaims: [priceClaim.id, newsClaim.id],
          hypotheses: [],
        },
        confidence: confidenceFor(dated.length, newsEvidence.length),
        uncertainty,
        unresolvedQuestions: [
          "which contemporaneous development (if any) causally explains the price movement — Flow 2 (WHY DID IT HAPPEN?) territory",
          ...(target.windowResolved ? [] : ["the precise event window"]),
        ],
        implications: ["Flow 2 can investigate causality on this reconstructed event"],
      },
      systemOrigin,
      at(),
    );
    completion = "COMPLETE";
  } else {
    // Graceful completion when evidence is insufficient (research-flows.md FLOW 1 low-confidence
    // behavior): record WHY, never fabricate. M2 notes the expansion options rather than
    // auto-invoking further capabilities (adaptive depth is bounded by the M2 capability set).
    judgment = workspace.addJudgment(
      {
        researchRef: research.id,
        statement:
          `Reconstruction of the ${target.asset} event could not be completed from the available capabilities: ` +
          `${priceAvailable ? "price evidence available" : "price evidence unavailable"}; ` +
          `${newsAvailable ? "news evidence available" : "news evidence unavailable"}. ` +
          `No explanation is asserted. This is a data-availability outcome, not a negative finding.`,
        basis: {
          supportingEvidence: executions.flatMap((e) => e.evidenceIds),
          opposingEvidence: [],
          keyClaims: [priceClaim.id, newsClaim.id],
          hypotheses: [],
        },
        confidence: "LOW",
        uncertainty,
        unresolvedQuestions: ["retry when capabilities are reachable", "expand capability set when M2+ flows connect more providers"],
        implications: ["Flow 1 cannot assert an explanation without both dimensions of evidence"],
      },
      systemOrigin,
      at(),
    );
    completion = "INSUFFICIENT_EVIDENCE";
  }

  // 8. Persist workspace (final lock §14: state survives the request).
  await options.store.save(workspace.toSnapshot());
  workspace.transitionResearch(research.id, "COMPLETED", systemOrigin, `flow 1 ${completion}`, at());
  await options.store.save(workspace.toSnapshot());

  // 9. Progressive-disclosure response — concise default (final lock §15): answer, strongest
  // reasons, meaningful opposition, confidence, key uncertainty. No chain-of-thought; deeper
  // levels remain available through the research state (workspace), not dumped here.
  const response = buildResponse({ target, executions, judgment, completion, uncertainty, contradictions });

  return { research: workspace.getResearch(research.id) ?? research, plan, target, executions, judgment, analysisId: analysis.id, response, completion };
}

// ---------------------------------------------------------------------------
// Synthesis helpers — deterministic, auditable, no hidden reasoning
// ---------------------------------------------------------------------------

function findContradictions(newsEvidence: readonly Evidence[]): readonly string[] {
  const bullish = /\b(surge|rally|inflow|inflows|rise|rose|jump(?:ed)?|record|approval|approved|upgrade)\b/i;
  const bearish = /\b(drop|crash|plunge|outflow|outflows|fall|fell|slash(?:ed)?|hack|exploit|lawsuit|ban(?:ned)?|downgrade|liquidat)\b/i;
  const bullishTitles: string[] = [];
  const bearishTitles: string[] = [];
  for (const title of newsTitlesFrom(newsEvidence)) {
    if (bullish.test(title)) bullishTitles.push(title.slice(0, 90));
    if (bearish.test(title)) bearishTitles.push(title.slice(0, 90));
  }
  const contradictions: string[] = [];
  if (bullishTitles.length > 0 && bearishTitles.length > 0) {
    contradictions.push(`feed coverage contains both supportive ("${bullishTitles[0]}") and opposing ("${bearishTitles[0]}") narratives`);
  }
  return contradictions;
}

/** News item observations are JSON-serialized item objects (see evidenceFromToolResult) — extract titles. */
function newsTitlesFrom(newsEvidence: readonly Evidence[]): readonly string[] {
  const titles: string[] = [];
  for (const evidence of newsEvidence) {
    try {
      const parsed = JSON.parse(evidence.observation) as { title?: unknown };
      if (typeof parsed.title === "string") titles.push(parsed.title);
    } catch {
      titles.push(evidence.observation); // non-JSON observation — use as-is
    }
  }
  return titles;
}

function buildAnalysisConclusion(priceAvailable: boolean, newsAvailable: boolean, target: Flow1Target): string {
  if (priceAvailable && newsAvailable) {
    return `Event reconstruction for ${target.asset} combines exact-timestamp price structure with contemporaneous developments; strongest-supported explanation selected in the judgment.`;
  }
  if (priceAvailable && !newsAvailable) {
    return `Price structure for ${target.asset} is established, but no contemporaneous developments could be retrieved; explanation formation is blocked by missing news evidence, not by contradictory news.`;
  }
  if (!priceAvailable && newsAvailable) {
    return `Developments were retrieved for ${target.asset}, but exact price structure is unavailable; timing relationships cannot be checked without market data.`;
  }
  return `Neither dimension of Flow 1 evidence was obtainable for ${target.asset}; no reconstruction is possible from the available capabilities.`;
}

function buildJudgmentStatement(target: Flow1Target, dated: readonly Dated[], newsEvidence: readonly Evidence[]): string {
  const sorted = [...dated].sort((a, b) => a.at.localeCompare(b.at));
  const lastPrice = [...sorted].reverse().find((d) => d.label.startsWith("close "));
  const newsTitles = newsTitlesFrom(newsEvidence).slice(0, 2).map((t) => `"${t.slice(0, 100)}"`);
  const parts: string[] = [];
  if (lastPrice !== undefined) {
    parts.push(`most recent observed price point: ${lastPrice.label} at ${lastPrice.at}`);
  }
  if (newsTitles.length > 0) {
    parts.push(`leading contemporaneous developments: ${newsTitles.join(", ")}`);
  }
  return `WHAT HAPPENED (reconstruction, not causal explanation): for ${target.asset}, ${parts.join("; ")}. The causal driver is explicitly not asserted (Flow 2 question).`;
}

function confidenceFor(pricePoints: number, newsItems: number): "HIGH" | "MODERATE" | "LOW" {
  // QUALITY ≠ CONFIDENCE: confidence reflects how well the two evidence dimensions cover the
  // reconstruction, never the mere count of tool calls. Low coverage → low confidence.
  if (pricePoints === 0 || newsItems === 0) return "LOW";
  if (pricePoints >= 2 && newsItems >= 2) return "MODERATE";
  return "LOW";
}

function buildResponse(input: {
  target: Flow1Target;
  executions: readonly Flow1ExecutionRecord[];
  judgment: Judgment | undefined;
  completion: Flow1Outcome["completion"];
  uncertainty: readonly string[];
  contradictions: readonly string[];
}): string {
  const lines: string[] = [];
  const { judgment, completion, target } = input;

  if (completion === "INSUFFICIENT_EVIDENCE") {
    lines.push(`**Answer:** Insufficient evidence to reconstruct what happened to ${target.asset}. No explanation is asserted.`);
    lines.push(`**Why:** ${input.uncertainty.join("; ") || "both required evidence dimensions were unavailable"}.`);
    lines.push(`**Not a negative finding:** failed/absent retrievals are not evidence against any explanation.`);
    lines.push(`**What would change this:** reachable market-data and news capabilities, or a resolved event window.`);
    return lines.join("\n");
  }

  const statement = judgment?.statement ?? "No judgment was formed.";
  lines.push(`**Answer:** ${statement}`);
  const supporting = judgment?.basis.supportingEvidence.length ?? 0;
  lines.push(`**Basis:** ${supporting} evidence object(s) in the research graph (price structure + contemporaneous developments); full traceability: research ${input.executions[0]?.result.id ? "and tool results" : ""} available in the workspace state.`);
  if (input.contradictions.length > 0) {
    lines.push(`**Contradictions:** ${input.contradictions.join("; ")}`);
  }
  lines.push(`**Confidence:** ${judgment?.confidence ?? "LOW"}${(judgment?.uncertainty.length ?? 0) > 0 ? ` — key uncertainty: ${judgment!.uncertainty[0]}` : ""}`);
  lines.push(`**What would change this conclusion:** causal analysis (Flow 2) on the reconstructed timeline; a resolved event window would tighten the reconstruction.`);
  return lines.join("\n");
}
