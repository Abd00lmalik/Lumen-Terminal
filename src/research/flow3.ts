/**
 * Flow 3 — WHAT COULD AFFECT IT? (drivers/catalysts/risks/dependencies investigation) — M4b.
 *
 * Architectural basis: research-flows.md FLOW 3.
 * - This is an investigation of POTENTIAL drivers, catalysts, risks, dependencies, and external
 *   factors that could materially affect the target — NOT price prediction, NOT a trading
 *   strategy, NOT autonomous decision-making (M4b §2/§8).
 * - Epistemic distinctions (M4b §2): a possible driver is not automatically a current driver;
 *   a plausible mechanism is not evidence the event will happen; a model suggestion is not
 *   evidence; missing data is not evidence the factor does not exist. Every factor carries an
 *   explicit status: OBSERVED_CURRENT_DRIVER / POTENTIAL_DRIVER / CATALYST / RISK / DEPENDENCY /
 *   SPECULATIVE_FACTOR (factor-status vocabulary authored for this flow's OUTPUT STRUCTURE —
 *   the underlying objects remain the existing Evidence/Claim/Hypothesis/Analysis/Judgment set;
 *   no new domain enums were invented).
 * - For each material factor: what it is, why it could matter, supporting AND contradicting
 *   evidence, transmission mechanism, current-vs-potential status, uncertainty, provenance.
 * - "Could affect" stays CONDITIONAL wherever evidence does not establish a current effect.
 * - The flow defines objective + mode (EXPLORATORY); the shared runner + registry pick
 *   capabilities — no Flow→Tool hardcoding (M4b §5); the adaptive loop handles follow-ups.
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { runFlow, type FlowObjective, type FlowOutcome } from "./flow-runner.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Flow objective — EXPLORATORY mode (drivers/catalysts/risks; no prediction)
// ---------------------------------------------------------------------------

const EXPLORATORY_GUIDANCE = [
  "EXPLORATORY MODE (Flow 3 — WHAT COULD AFFECT IT?): identify potentially material factors, not predictions.",
  "- Investigate: current drivers, future catalysts, risks, dependencies, macro/market/sector/ecosystem factors, and regulatory/policy factors WHEN capabilities can support them.",
  "- For each factor, capture the TRANSMISSION MECHANISM (how it would reach the target) and the CONDITIONS under which it would matter.",
  "- EPISTEMIC RULES: a possible driver is not automatically a current driver; a plausible mechanism is not evidence the event will happen; your own suggestion is not evidence; missing data does not mean the factor does not exist.",
  "- Label factor status honestly: OBSERVED_CURRENT_DRIVER only where evidence shows current effect; otherwise POTENTIAL_DRIVER / CATALYST / RISK / DEPENDENCY / SPECULATIVE_FACTOR.",
  "- This flow NEVER outputs price predictions, return probabilities, or trade signals — conditional influence only.",
  "- PRIORITY: factors whose materiality is uncertain but impact-relevant get one more targeted look; do not research every conceivable factor.",
].join("\n");

export const FLOW3_OBJECTIVE: FlowObjective = {
  flow: "WHAT_COULD_AFFECT_IT",
  mode: "EXPLORATORY",
  schedulerGuidance: EXPLORATORY_GUIDANCE,
};

// ---------------------------------------------------------------------------
// Factor schema — output structure over validated evidence (no new domain objects)
// ---------------------------------------------------------------------------

export type FactorStatus =
  | "OBSERVED_CURRENT_DRIVER"
  | "POTENTIAL_DRIVER"
  | "CATALYST"
  | "RISK"
  | "DEPENDENCY"
  | "SPECULATIVE_FACTOR";

const FACTOR_STATUSES = new Set<string>([
  "OBSERVED_CURRENT_DRIVER", "POTENTIAL_DRIVER", "CATALYST", "RISK", "DEPENDENCY", "SPECULATIVE_FACTOR",
]);

export interface Factor {
  /** What the factor is. */
  readonly name: string;
  /** Why it could materially affect the target — the transmission mechanism. */
  readonly mechanism: string;
  /** Current vs potential vs speculative — the epistemic heart of Flow 3. */
  readonly status: FactorStatus;
  /** Conditions under which this factor would actually matter (conditional influence). */
  readonly wouldMatterWhen: readonly string[];
  /** Evidence supporting the factor's relevance (must cite context refs — validated below). */
  readonly supportingRefs: readonly string[];
  /** Evidence contradicting or weakening the factor's relevance (contradictions preserved). */
  readonly contradictingRefs: readonly string[];
  /** Uncertainty about whether/how much this factor is actually material. */
  readonly uncertainty: readonly string[];
}

export interface FactorLandscape {
  /** One coherent statement of what could move the target — not a factor dump. */
  readonly overallAssessment: string;
  readonly factors: readonly Factor[];
  /** Factors the research could NOT establish — absence of evidence, not evidence of absence. */
  readonly unresolvedFactors: readonly string[];
  readonly missingInformation: readonly string[];
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  /** What would change this landscape (new evidence, changed conditions). */
  readonly whatWouldChange: readonly string[];
  readonly citedObjectRefs: readonly string[];
}

export const FACTOR_LANDSCAPE_SCHEMA: OutputSchema = {
  name: "flow3.factor_landscape",
  properties: {
    overallAssessment: "string",
    factors: "array", // entry-level validation below drops malformed entries (never coerced)
    unresolvedFactors: "string[]",
    missingInformation: "string[]",
    confidence: "string",
    uncertainty: "string[]",
    whatWouldChange: "string[]",
    citedObjectRefs: "string[]",
  },
};

export const FACTOR_LANDSCAPE_SCHEMA_DESC = [
  '{"overallAssessment": string,',
  ' "factors": [{"name": string, "mechanism": string,',
  '   "status": "OBSERVED_CURRENT_DRIVER"|"POTENTIAL_DRIVER"|"CATALYST"|"RISK"|"DEPENDENCY"|"SPECULATIVE_FACTOR",',
  '   "wouldMatterWhen": string[], "supportingRefs": string[], "contradictingRefs": string[],',
  '   "uncertainty": string[]}],',
  ' "unresolvedFactors": string[], "missingInformation": string[],',
  ' "confidence": "HIGH"|"MODERATE"|"LOW", "uncertainty": string[], "whatWouldChange": string[],',
  ' "citedObjectRefs": string[]  // evidence ids from the context only',
].join("\n");

const FACTOR_SYSTEM = [
  "You are the factor analyst of a trading RESEARCH workbench (Flow 3 — WHAT COULD AFFECT IT?).",
  "You receive the VALIDATED research context (epistemic classes preserved). You investigate influence, you do not predict prices.",
  "Hard rules:",
  "- A POSSIBLE driver is not a CURRENT driver. Use OBSERVED_CURRENT_DRIVER only when context evidence demonstrates a current effect; otherwise use POTENTIAL_DRIVER / CATALYST / RISK / DEPENDENCY / SPECULATIVE_FACTOR.",
  "- Every factor needs a transmission MECHANISM (how it reaches the target) and the conditions under which it would matter — 'could affect' stays conditional.",
  "- Your own background knowledge is NOT evidence. Only cite evidence ids present in the context; do not fabricate refs.",
  "- Missing data is NOT evidence that a factor does not exist — list it under unresolvedFactors/missingInformation instead.",
  "- Record evidence that WEAKENS a factor too (contradictingRefs) — do not curate only supportive items.",
  "- NO price predictions, NO probability of returns, NO buy/sell recommendations. Influence and conditions only.",
].join("\n");

// ---------------------------------------------------------------------------
// Flow 3 runner
// ---------------------------------------------------------------------------

export interface Flow3Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  readonly asset?: string;
  readonly horizon?: string; // e.g. "next few weeks" — a scope input, never a prediction
  readonly constraints?: readonly string[];
  readonly maxRounds?: number;
  readonly now?: () => Date;
}

export interface Flow3Result {
  readonly outcome: FlowOutcome;
  readonly landscape: FactorLandscape | undefined;
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

/** Flow 3: adaptive investigation → factor landscape (status-typed, conditional, provenance-bound). */
export async function runFlow3(objective: string, options: Flow3Options): Promise<Flow3Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 3 orchestration" };
  const workspace = options.workspace;

  const research = workspace.addResearch(
    { objective, question: objective, flow: "WHAT_COULD_AFFECT_IT" },
    { kind: "trader", detail: "Flow 3 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const flowOutcome = await runFlow(objective, FLOW3_OBJECTIVE, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: options.asset !== undefined ? { asset: options.asset } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  let landscape: FactorLandscape | undefined;
  try {
    landscape = await mapFactors(flowOutcome, objective, options);
  } catch (error) {
    // M4 §33 failure law: provider-level failure keeps its type — never laundered.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return { outcome: flowOutcome, landscape: undefined, modelFailure: failure, response: failureResponse(failure) };
  }
  if (landscape === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "factor landscape failed validation — no factor claims asserted", false);
    return { outcome: flowOutcome, landscape: undefined, modelFailure: failure, response: failureResponse(failure) };
  }

  const analysis = workspace.addAnalysis(
    {
      objective: `Factor landscape: ${objective}`,
      mode: "INTERPRET",
      inputs: flowOutcome.evidence.map((e) => e.id),
      findings: [
        landscape.overallAssessment,
        ...landscape.factors.map((f) => `[${f.status}] ${f.name} — mechanism: ${f.mechanism}`),
      ],
      conclusion: landscape.overallAssessment,
      uncertainty: [...landscape.uncertainty, ...landscape.unresolvedFactors.map((u) => `unresolved factor: ${u}`)],
    },
    systemOrigin,
    at(),
  );

  // Judgment: what could affect the target — with current-vs-potential distinction preserved.
  const judgment = workspace.addJudgment(
    {
      researchRef: research.id,
      statement: `FACTOR LANDSCAPE: ${landscape.overallAssessment} (current vs potential factors distinguished; conditional influence, not prediction)`,
      basis: {
        supportingEvidence: landscape.citedObjectRefs,
        opposingEvidence: flowOutcome.evidence.filter((e) => e.contradicts.length > 0).map((e) => e.id),
        keyClaims: workspace.listClaims().map((c) => c.id).slice(0, 6),
        hypotheses: flowOutcome.hypotheses.map((h) => h.id),
      },
      confidence: landscape.confidence,
      uncertainty: [...landscape.uncertainty, ...landscape.unresolvedFactors.map((u) => `unresolved: ${u}`)],
      unresolvedQuestions: landscape.missingInformation,
      implications: [
        "factors are influence candidates with conditions — not predictions or trade signals",
        "monitoring specific factors requires separate trader confirmation",
      ],
    },
    systemOrigin,
    at(),
  );

  return {
    outcome: { ...flowOutcome, analysisId: analysis.id, judgmentId: judgment.id },
    landscape,
    response: buildFlow3Response(landscape, flowOutcome, objective),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mapFactors(flowOutcome: FlowOutcome, objective: string, options: Flow3Options): Promise<FactorLandscape | undefined> {
  if (flowOutcome.context.items.length === 0 && flowOutcome.context.limitations.length === 0) return undefined;
  const res = await options.provider.structured<string>({
    schemaName: "flow3.factor_landscape",
    schemaDescription: FACTOR_LANDSCAPE_SCHEMA_DESC,
    system: FACTOR_SYSTEM,
    prompt: [
      `Research objective: ${objective}`,
      `Research status: ${flowOutcome.stoppedBecause} — ${flowOutcome.finalDecision.rationale}`,
      "VALIDATED RESEARCH CONTEXT:",
      renderResearchContext(flowOutcome.context),
    ].join("\n"),
    preferJson: true,
  });
  const parsed = validateModelOutput<FactorLandscape & Record<string, unknown>>(FACTOR_LANDSCAPE_SCHEMA, res.raw).data;
  if (!["HIGH", "MODERATE", "LOW"].includes(parsed.confidence)) return undefined;
  const known = new Set<string>(flowOutcome.context.items.map((i) => i.ref));
  const refs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((r): r is string => typeof r === "string" && known.has(r)) : []);
  const strs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((s): s is string => typeof s === "string") : []);
  // Entry-level validation: malformed factor entries are DROPPED, never coerced into structure.
  const factors = (parsed.factors as unknown[]).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const f = entry as Record<string, unknown>;
    if (typeof f.name !== "string" || typeof f.mechanism !== "string") return [];
    if (typeof f.status !== "string" || !FACTOR_STATUSES.has(f.status)) return [];
    return [{
      name: f.name,
      mechanism: f.mechanism,
      status: f.status as FactorStatus,
      wouldMatterWhen: strs(f.wouldMatterWhen),
      supportingRefs: refs(f.supportingRefs),
      contradictingRefs: refs(f.contradictingRefs),
      uncertainty: strs(f.uncertainty),
    }];
  });
  return {
    ...parsed,
    factors,
    citedObjectRefs: parsed.citedObjectRefs.filter((ref) => known.has(ref)),
  };
}

function failureResponse(failure: ModelFailure): string {
  return [
    `**Answer:** The factor landscape could not be completed: ${failure.message}`,
    `**Why this is not a finding:** system conditions are not evidence about any factor.`,
    `**What would change this:** a reachable model provider; re-run when available.`,
  ].join("\n");
}

function buildFlow3Response(landscape: FactorLandscape, flowOutcome: FlowOutcome, objective: string): string {
  const lines: string[] = [];
  lines.push(`**Answer:** ${landscape.overallAssessment}`);
  const current = landscape.factors.filter((f) => f.status === "OBSERVED_CURRENT_DRIVER");
  const potential = landscape.factors.filter((f) => f.status !== "OBSERVED_CURRENT_DRIVER");
  if (current.length > 0) {
    lines.push(`**Observed current drivers:**`);
    for (const f of current.slice(0, 3)) lines.push(`  • ${f.name} — ${f.mechanism}`);
  }
  if (potential.length > 0) {
    lines.push(`**Potential factors (conditional — not predictions):**`);
    for (const f of potential.slice(0, 4)) lines.push(`  • [${f.status}] ${f.name} — matters when: ${f.wouldMatterWhen.slice(0, 2).join("; ") || "conditions unclear"}`);
  }
  if (landscape.unresolvedFactors.length > 0) {
    lines.push(`**Unresolved factors:** ${landscape.unresolvedFactors.slice(0, 3).join("; ")} (missing data is not evidence of absence)`);
  }
  lines.push(`**Confidence:** ${landscape.confidence}${landscape.uncertainty.length > 0 ? ` — key uncertainty: ${landscape.uncertainty[0]}` : ""}`);
  if (landscape.whatWouldChange.length > 0) lines.push(`**What would change this:** ${landscape.whatWouldChange.slice(0, 2).join("; ")}`);
  lines.push(`**Traceability:** research ${flowOutcome.researchId} — every factor's evidence lives in the research state; deeper levels available on request.`);
  void objective;
  return lines.join("\n");
}
