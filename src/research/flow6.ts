/**
 * Flow 6; WHAT DOES ALL THE INFORMATION SAY? (broad multi-source synthesis); M4.
 *
 * Architectural basis: research-flows.md FLOW 6.
 * - Adaptive information scope: relevant DOMAINS are selected from the question; never all
 *   capabilities blindly (M4 §11/§12). "All the information" = all material information.
 * - Broad investigation runs INDEPENDENT dimension research concurrently (FLOW 6 §3; M4 §13);
 *   dependent work stays sequential (handled by adaptive rounds).
 * - Cross-domain CONTRADICTION handling (M4 §14): disagreement is represented explicitly and
 *   TYPED (genuine contradiction / different time horizon / different variable / evidence-type
 *   mismatch / interpretation-vs-observation / unresolved uncertainty). Agreement is never forced.
 * - Claim-specific evidence weighting (FLOW 6 §5; M4 §15): qualitative weighting via the
 *   existing evidence/source model (directness, reliability, recency, specificity, corroboration,
 *   independence, quantitative-vs-interpretive, freshness). No invented numeric weights; repeated
 *   secondary reports of one source are not independent confirmation.
 * - Synthesis (M4 §16): research FIRST, synthesize SECOND; Gemini's background knowledge never
 *   substitutes for current researched evidence. One primary judgment is produced.
 * - The flow defines objective + mode (SYNTHESIS); the shared runner + registry pick capabilities.
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { readableLimitation, readableLimitations } from "./limitation-text.js";
import { readableObservation } from "./observation-text.js";
import { FLOW_OBJECTIVES, runFlow, validateFlowOutcome, type FlowOutcome } from "./flow-runner.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Synthesis schema; disagreement-typed cross-domain read over validated evidence
// ---------------------------------------------------------------------------

export interface Disagreement {
  /** What conflicts (domain/evidence summaries, each citing real objects where applicable). */
  readonly sideA: string;
  readonly sideB: string;
  /** The architecture's disagreement typology (research-flows.md FLOW 6; M4 §14). */
  readonly type: "GENUINE_CONTRADICTION" | "DIFFERENT_TIME_HORIZON" | "DIFFERENT_VARIABLE" | "EVIDENCE_TYPE_MISMATCH" | "INTERPRETATION_VS_OBSERVATION" | "UNRESOLVED_UNCERTAINTY";
  /** Which side is more defensible and why; or that it cannot be resolved (honesty over forced agreement). */
  readonly assessment: string;
  readonly objectRefsA: readonly string[];
  readonly objectRefsB: readonly string[];
}

export interface CrossDomainSynthesis {
  /** One coherent picture; not a dump of ten perspectives (FLOW 6 §8). */
  readonly overallPicture: string;
  readonly supportingSignals: readonly string[];
  readonly opposingSignals: readonly string[];
  /** Meaningful cross-domain relationships only (FLOW 6 §4); no blind correlation. */
  readonly crossDomainRelationships: readonly string[];
  readonly disagreements: readonly Disagreement[];
  /** Where a thesis exists: what the picture implies for it (assessment, never mutation). */
  readonly thesisImplication?: string;
  readonly missingInformation: readonly string[];
  readonly confidence: "HIGH" | "MODERATE" | "LOW";
  readonly uncertainty: readonly string[];
  readonly citedObjectRefs: readonly string[];
}

export const CROSS_DOMAIN_SYNTHESIS_SCHEMA: OutputSchema = {
  name: "flow6.cross_domain_synthesis",
  properties: {
    overallPicture: "string",
    supportingSignals: "string[]",
    opposingSignals: "string[]",
    crossDomainRelationships: "string[]",
    disagreements: "array", // entry-level validation below drops malformed entries (M4 §14: never coerce)
    missingInformation: "string[]",
    confidence: "string",
    uncertainty: "string[]",
    citedObjectRefs: "string[]",
    thesisImplication: "string", // optional; only when a trader thesis exists in the context
  },
  optional: ["thesisImplication"],
};

export const CROSS_DOMAIN_SYNTHESIS_SCHEMA_DESC = [
  '{"overallPicture": string, "supportingSignals": string[], "opposingSignals": string[],',
  ' "crossDomainRelationships": string[],',
  ' "disagreements": [{"sideA": string, "sideB": string,',
  '   "type": "GENUINE_CONTRADICTION"|"DIFFERENT_TIME_HORIZON"|"DIFFERENT_VARIABLE"|"EVIDENCE_TYPE_MISMATCH"|"INTERPRETATION_VS_OBSERVATION"|"UNRESOLVED_UNCERTAINTY",',
  '   "assessment": string, "objectRefsA": string[], "objectRefsB": string[]}],',
  ' "thesisImplication": string,  // only when a trader thesis exists in the context',
  ' "missingInformation": string[], "confidence": "HIGH"|"MODERATE"|"LOW",',
  ' "uncertainty": string[], "citedObjectRefs": string[]  // evidence ids from the context only',
].join("\n");

const SYNTHESIS_SYSTEM = [
  "You are the cross-domain synthesizer of a trading RESEARCH workbench (Flow 6; WHAT DOES ALL THE INFORMATION SAY?).",
  "You receive the VALIDATED research context (epistemic classes preserved, domains labeled).",
  "Hard rules:",
  "- One primary judgment (overallPicture). Do not dump perspectives for the trader to synthesize.",
  "- Preserve disagreement: when domains conflict, record a typed disagreement entry. NEVER force artificial agreement. If the conflict cannot be resolved, say so in the assessment.",
  "- An analyst interpretation conflicting with quantitative observations is INTERPRETATION_VS_OBSERVATION; the interpretation does not win by being confident.",
  "- Cross-domain relationships must be contextually meaningful; do not correlate everything.",
  "- Weight qualitatively: direct observation > interpretation; recent > stale; independent corroboration > repetition of one source. Do not count repeated secondary reports as independent confirmation.",
  "- Everything factual must come from the provided context. Your background knowledge may clarify concepts but is NOT evidence; do not present it as researched.",
  "- LIMITATIONS are not negative evidence. Only cite evidence ids present in the context.",
  "Output style: write plain professional prose. Never use em dash or en dash punctuation characters anywhere in your output; separate clauses with commas, semicolons, or periods.",
].join("\n");

// ---------------------------------------------------------------------------
// Flow 6 runner
// ---------------------------------------------------------------------------

export interface Flow6Options {
  readonly provider: ModelProvider;
  readonly registry: import("../adapters/capability-registry.js").CapabilityRegistry;
  readonly workspace: Workspace;
  readonly store: WorkspaceStore;
  readonly asset?: string;
  readonly constraints?: readonly string[];
  /** CAPABILITY ISOLATION: the trader's explicit capability boundary ("use X only"); a hard filter on the plan, the engine floor and gap recovery. */
  readonly capabilityConstraint?: { readonly allowed?: readonly string[]; readonly forbidden?: readonly string[] };
  readonly maxRounds?: number;
  /**
   * Wall-clock deadline for the whole run (epoch ms); forwarded to the shared flow runner's
   * honest TIME_BUDGET_EXHAUSTED stop. Optional; tests omit it.
   */
  readonly deadlineMs?: number;
  readonly now?: () => Date;
}

export interface Flow6Result {
  readonly outcome: FlowOutcome;
  readonly synthesis: CrossDomainSynthesis | undefined;
  readonly modelFailure?: ModelFailure;
  readonly response: string;
}

/** Flow 6: adaptive scope → broad (parallel) investigation → cross-domain synthesis → judgment. */
export async function runFlow6(objective: string, options: Flow6Options): Promise<Flow6Result> {
  const at = options.now ?? (() => new Date());
  const systemOrigin: ProvenanceOrigin = { kind: "agent", detail: "Flow 6 orchestration" };
  const workspace = options.workspace;

  const research = workspace.addResearch(
    { objective, question: objective, flow: "WHAT_DOES_ALL_INFORMATION_SAY" },
    { kind: "trader", detail: "Flow 6 request" },
    at(),
  );
  workspace.transitionResearch(research.id, "ACTIVE", systemOrigin, "research activated", at());

  const flowObjective = FLOW_OBJECTIVES.WHAT_DOES_ALL_INFORMATION_SAY;
  if (flowObjective === undefined) throw new Error("Flow 6 objective metadata missing; architecture inconsistency");

  const flowOutcome = await runFlow(objective, flowObjective, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    ...(options.capabilityConstraint !== undefined ? { capabilityConstraint: options.capabilityConstraint } : {}),
    capabilityParams: options.asset !== undefined ? { asset: options.asset } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  let synthesis: CrossDomainSynthesis | undefined;
  try {
    synthesis = await synthesize(flowOutcome, options);
  } catch (error) {
    // M4 §33: provider-level failure keeps its type; never laundered into a validation failure.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    // DEGRADED-PROVIDER LAW (synthesis remediation): provider failure must not erase
    // already-valid evidence. When the flow actually gathered evidence, the run returns a
    // STRUCTURED PARTIAL RESULT built deterministically from that evidence (what is
    // established, what is not, why, what is missing); the modelFailure stays typed and the
    // response NEVER pretends no research material exists. Only a run with NO evidence at all
    // ends as a pure failure response.
    if (flowOutcome.evidence.length > 0) {
      return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: partialSynthesisResponse(flowOutcome, failure) };
    }
    return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: synthesisFailureResponse(failure) };
  }
  if (synthesis === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "cross-domain synthesis failed validation; no overall picture is asserted", false);
    if (flowOutcome.evidence.length > 0) {
      return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: partialSynthesisResponse(flowOutcome, failure) };
    }
    return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: synthesisFailureResponse(failure) };
  }

  // Analysis object; the deliberate analytical step (object model §8), synthesizing evidence.
  const analysis = workspace.addAnalysis(
    {
      objective: `Cross-domain synthesis: ${objective}`,
      mode: "SYNTHESIZE",
      inputs: flowOutcome.evidence.map((e) => e.id),
      findings: [
        synthesis.overallPicture,
        ...synthesis.disagreements.map((d) => `disagreement (${d.type}): ${d.sideA} ↔ ${d.sideB}; ${d.assessment}`),
      ],
      conclusion: synthesis.overallPicture,
      uncertainty: synthesis.uncertainty,
    },
    systemOrigin,
    at(),
  );

  // Primary judgment; one judgment, supporting AND opposing evidence, material disagreement preserved.
  const opposing = flowOutcome.evidence.filter((e) => e.contradicts.length > 0).map((e) => e.id);
  const judgment = workspace.addJudgment(
    {
      researchRef: research.id,
      statement: `OVERALL PICTURE: ${synthesis.overallPicture}`,
      basis: {
        supportingEvidence: synthesis.citedObjectRefs,
        opposingEvidence: opposing,
        keyClaims: workspace.listClaims().map((c) => c.id).slice(0, 6),
        hypotheses: flowOutcome.hypotheses.map((h) => h.id),
      },
      confidence: synthesis.confidence,
      uncertainty: [...synthesis.uncertainty, ...synthesis.disagreements.map((d) => `unresolved disagreement (${d.type}): ${d.assessment}`)],
      unresolvedQuestions: synthesis.missingInformation,
      implications: synthesis.thesisImplication !== undefined ? [synthesis.thesisImplication] : ["trader decides; no action is implied by this synthesis"],
    },
    systemOrigin,
    at(),
  );

  const response = buildFlow6Response(synthesis, flowOutcome);
  // SHARED CONTRACT BOUNDARY: same validation law as the adaptive loop (no per-flow validator).
  return validateFlowOutcome(
    { outcome: { ...flowOutcome, analysisId: analysis.id, judgmentId: judgment.id }, synthesis, response },
    { failedPaths: flowOutcome.executions.filter((e) => e.result.failure.type !== "NONE").length },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function synthesize(flowOutcome: FlowOutcome, options: Flow6Options): Promise<CrossDomainSynthesis | undefined> {
  if (flowOutcome.context.items.length === 0 && flowOutcome.context.limitations.length === 0) return undefined;
  try {
    const res = await options.provider.structured<string>({
      schemaName: "flow6.cross_domain_synthesis",
      schemaDescription: CROSS_DOMAIN_SYNTHESIS_SCHEMA_DESC,
      system: SYNTHESIS_SYSTEM,
      prompt: [
        `Synthesis objective: ${flowOutcome.plan.objective}`,
        `Research status: ${flowOutcome.stoppedBecause}; ${flowOutcome.finalDecision.rationale}`,
        "VALIDATED RESEARCH CONTEXT:",
        renderResearchContext(flowOutcome.context),
      ].join("\n"),
      preferJson: true,
    });
    const parsed = validateModelOutput<CrossDomainSynthesis & Record<string, unknown>>(CROSS_DOMAIN_SYNTHESIS_SCHEMA, res.raw).data;
    if (!["HIGH", "MODERATE", "LOW"].includes(parsed.confidence)) return undefined;
    const known = new Set<string>(flowOutcome.context.items.map((i) => i.ref));
    const validTypes = new Set(["GENUINE_CONTRADICTION", "DIFFERENT_TIME_HORIZON", "DIFFERENT_VARIABLE", "EVIDENCE_TYPE_MISMATCH", "INTERPRETATION_VS_OBSERVATION", "UNRESOLVED_UNCERTAINTY"]);
    // Validate disagreement entries; drop malformed ones rather than fabricating structure.
    const disagreements = (parsed.disagreements as unknown[]).flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const d = entry as Record<string, unknown>;
      if (typeof d.sideA !== "string" || typeof d.sideB !== "string" || typeof d.assessment !== "string") return [];
      if (typeof d.type !== "string" || !validTypes.has(d.type)) return [];
      const refs = (arr: unknown): string[] => (Array.isArray(arr) ? (arr as unknown[]).filter((r): r is string => typeof r === "string" && known.has(r)) : []);
      return [{ sideA: d.sideA, sideB: d.sideB, type: d.type as Disagreement["type"], assessment: d.assessment, objectRefsA: refs(d.objectRefsA), objectRefsB: refs(d.objectRefsB) }];
    });
    return {
      ...parsed,
      disagreements,
      citedObjectRefs: parsed.citedObjectRefs.filter((ref) => known.has(ref)),
    };
  } catch (error) {
    // Provider failures propagate with their type; only local validation issues → undefined.
    if (error instanceof ModelFailure && error.type !== "INVALID_OUTPUT") throw error;
    return undefined;
  }
}

function synthesisFailureResponse(failure: ModelFailure): string {
  return [
    `**Answer:** The cross-domain synthesis could not be completed: ${failure.message}`,
    `**Why this is not a finding:** model/provider failure is a system condition, not evidence about the market.`,
    `**What would change this:** a reachable model provider; already-collected research state is preserved.`,
  ].join("\n");
}

/**
 * DEGRADED-PROVIDER partial result (synthesis remediation): the model failed to synthesize
 * AFTER real evidence was gathered. The evidence is valid research material; the failure is
 * infrastructure. This deterministic partial answer states what IS established (from the
 * gathered evidence, verbatim observations), what is NOT established, why, which evidence is
 * missing, and what would resolve the gap. Nothing is fabricated; no overall picture is
 * asserted (that is the synthesizer's job and it did not run).
 */
function partialSynthesisResponse(flowOutcome: FlowOutcome, failure: ModelFailure): string {
  const domains = [...new Set(flowOutcome.executions.map((e) => e.capability))];
  // Provider plumbing (capability ids, raw provider error bodies) is diagnostics; the answer
  // surface says only that a path could not be completed.
  const failedPaths = flowOutcome.executions
    .filter((e) => e.result.failure.type !== "NONE")
    .map((e) => readableLimitation({ kind: e.result.failure.type === "EMPTY_RESULT" ? "empty_result" : "tool_failure", description: e.result.failure.message ?? "provider path failed", capability: e.capability }));
  // No `[ev_... ]` ids and no raw payloads: the trader reads what was observed, and the id
  // belongs to the archive rather than to the sentence.
  const established = flowOutcome.evidence.slice(0, 5).map((e) => `  • ${readableObservation(e.observation, 160)}`);
  const gaps = flowOutcome.context.limitations.slice(0, 4);
  const lines: string[] = [];
  lines.push(`**Answer:** Cross-domain synthesis could not be completed (${failure.type}: ${failure.message}). The gathered evidence is preserved below; no overall picture is asserted without the synthesis step.`);
  lines.push(`**What is established (from the observations gathered across ${domains.length} investigation path(s)):**`);
  lines.push(...(established.length > 0 ? established : ["  • (nothing was established before the synthesis step failed)"]));
  lines.push(`**What is NOT established:** the cross-domain overall picture, typed disagreements, and the weighted confidence judgment. The research ran; the synthesis step failed.`);
  lines.push(`**Why it could not be established:** ${failure.type} is a system condition, not evidence about the market. The failure keeps its type and is never read as a negative finding.`);
  if (failedPaths.length > 0) lines.push([`**Provider paths that failed (technical conditions):**`, ...failedPaths.slice(0, 4).map((f) => `  • ${f}`)].join("\n"));
  const gapText = readableLimitations(gaps, 4);
  if (gapText !== undefined) lines.push(`**Missing evidence / limitations:** ${gapText}`);
  lines.push("**What would resolve the gap:** a reachable model provider for the synthesis step; the observations already gathered stay in the research state and remain citable.");
  return lines.join("\n");
}


function buildFlow6Response(synthesis: CrossDomainSynthesis, flowOutcome: FlowOutcome): string {
  void flowOutcome; // run identifiers/counts live in the research state, not in trader prose
  const lines: string[] = [];
  lines.push(`**Overall picture:** ${synthesis.overallPicture}`);
  if (synthesis.supportingSignals.length > 0) lines.push(`**Supporting signals:** ${synthesis.supportingSignals.slice(0, 3).join("; ")}`);
  if (synthesis.opposingSignals.length > 0) lines.push(`**Opposing signals:** ${synthesis.opposingSignals.slice(0, 3).join("; ")}`);
  if (synthesis.disagreements.length > 0) {
    lines.push(`**Disagreements (preserved, not forced):**`);
    for (const d of synthesis.disagreements.slice(0, 3)) {
      lines.push(`  • [${d.type}] ${d.sideA} ↔ ${d.sideB}; ${d.assessment}`);
    }
  }
  if (synthesis.missingInformation.length > 0) lines.push(`**Missing information:** ${synthesis.missingInformation.slice(0, 3).join("; ")}`);
  lines.push(`**Confidence:** ${synthesis.confidence}.`);
  if (synthesis.thesisImplication !== undefined) lines.push(`**Thesis implication:** ${synthesis.thesisImplication}`);
  return lines.join("\n");
}
