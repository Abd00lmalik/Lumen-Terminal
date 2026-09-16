/**
 * Flow 6 — WHAT DOES ALL THE INFORMATION SAY? (broad multi-source synthesis) — M4.
 *
 * Architectural basis: research-flows.md FLOW 6.
 * - Adaptive information scope: relevant DOMAINS are selected from the question — never all
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
 * - Synthesis (M4 §16): research FIRST, synthesize SECOND — Gemini's background knowledge never
 *   substitutes for current researched evidence. One primary judgment is produced.
 * - The flow defines objective + mode (SYNTHESIS); the shared runner + registry pick capabilities.
 */

import type { ModelProvider } from "../model/provider.js";
import { ModelFailure } from "../model/provider.js";
import { validateModelOutput, type OutputSchema } from "../model/provider.js";
import { FLOW_OBJECTIVES, runFlow, type FlowOutcome } from "./flow-runner.js";
import { renderResearchContext } from "./context.js";
import type { Workspace } from "../domain/workspace.js";
import type { WorkspaceStore } from "../persistence/index.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";

// ---------------------------------------------------------------------------
// Synthesis schema — disagreement-typed cross-domain read over validated evidence
// ---------------------------------------------------------------------------

export interface Disagreement {
  /** What conflicts (domain/evidence summaries, each citing real objects where applicable). */
  readonly sideA: string;
  readonly sideB: string;
  /** The architecture's disagreement typology (research-flows.md FLOW 6; M4 §14). */
  readonly type: "GENUINE_CONTRADICTION" | "DIFFERENT_TIME_HORIZON" | "DIFFERENT_VARIABLE" | "EVIDENCE_TYPE_MISMATCH" | "INTERPRETATION_VS_OBSERVATION" | "UNRESOLVED_UNCERTAINTY";
  /** Which side is more defensible and why — or that it cannot be resolved (honesty over forced agreement). */
  readonly assessment: string;
  readonly objectRefsA: readonly string[];
  readonly objectRefsB: readonly string[];
}

export interface CrossDomainSynthesis {
  /** One coherent picture — not a dump of ten perspectives (FLOW 6 §8). */
  readonly overallPicture: string;
  readonly supportingSignals: readonly string[];
  readonly opposingSignals: readonly string[];
  /** Meaningful cross-domain relationships only (FLOW 6 §4) — no blind correlation. */
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
    thesisImplication: "string", // optional — only when a trader thesis exists in the context
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
  "You are the cross-domain synthesizer of a trading RESEARCH workbench (Flow 6 — WHAT DOES ALL THE INFORMATION SAY?).",
  "You receive the VALIDATED research context (epistemic classes preserved, domains labeled).",
  "Hard rules:",
  "- One primary judgment (overallPicture). Do not dump perspectives for the trader to synthesize.",
  "- Preserve disagreement: when domains conflict, record a typed disagreement entry. NEVER force artificial agreement. If the conflict cannot be resolved, say so in the assessment.",
  "- An analyst interpretation conflicting with quantitative observations is INTERPRETATION_VS_OBSERVATION — the interpretation does not win by being confident.",
  "- Cross-domain relationships must be contextually meaningful; do not correlate everything.",
  "- Weight qualitatively: direct observation > interpretation; recent > stale; independent corroboration > repetition of one source. Do not count repeated secondary reports as independent confirmation.",
  "- Everything factual must come from the provided context. Your background knowledge may clarify concepts but is NOT evidence — do not present it as researched.",
  "- LIMITATIONS are not negative evidence. Only cite evidence ids present in the context.",
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
  readonly maxRounds?: number;
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
  if (flowObjective === undefined) throw new Error("Flow 6 objective metadata missing — architecture inconsistency");

  const flowOutcome = await runFlow(objective, flowObjective, research.id, {
    provider: options.provider,
    registry: options.registry,
    workspace,
    store: options.store,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    capabilityParams: options.asset !== undefined ? { asset: options.asset } : {},
    ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  let synthesis: CrossDomainSynthesis | undefined;
  try {
    synthesis = await synthesize(flowOutcome, options);
  } catch (error) {
    // M4 §33: provider-level failure keeps its type — never laundered into a validation failure.
    const failure = error instanceof ModelFailure ? error : new ModelFailure("INVALID_OUTPUT", String(error), false);
    return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: synthesisFailureResponse(failure) };
  }
  if (synthesis === undefined) {
    const failure = new ModelFailure("INVALID_OUTPUT", "cross-domain synthesis failed validation — no overall picture is asserted", false);
    return { outcome: flowOutcome, synthesis: undefined, modelFailure: failure, response: synthesisFailureResponse(failure) };
  }

  // Analysis object — the deliberate analytical step (object model §8), synthesizing evidence.
  const analysis = workspace.addAnalysis(
    {
      objective: `Cross-domain synthesis: ${objective}`,
      mode: "SYNTHESIZE",
      inputs: flowOutcome.evidence.map((e) => e.id),
      findings: [
        synthesis.overallPicture,
        ...synthesis.disagreements.map((d) => `disagreement (${d.type}): ${d.sideA} ↔ ${d.sideB} — ${d.assessment}`),
      ],
      conclusion: synthesis.overallPicture,
      uncertainty: synthesis.uncertainty,
    },
    systemOrigin,
    at(),
  );

  // Primary judgment — one judgment, supporting AND opposing evidence, material disagreement preserved.
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
  return { outcome: { ...flowOutcome, analysisId: analysis.id, judgmentId: judgment.id }, synthesis, response };
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
        `Research status: ${flowOutcome.stoppedBecause} — ${flowOutcome.finalDecision.rationale}`,
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

function buildFlow6Response(synthesis: CrossDomainSynthesis, flowOutcome: FlowOutcome): string {
  const lines: string[] = [];
  lines.push(`**Overall picture:** ${synthesis.overallPicture}`);
  if (synthesis.supportingSignals.length > 0) lines.push(`**Supporting signals:** ${synthesis.supportingSignals.slice(0, 3).join("; ")}`);
  if (synthesis.opposingSignals.length > 0) lines.push(`**Opposing signals:** ${synthesis.opposingSignals.slice(0, 3).join("; ")}`);
  if (synthesis.disagreements.length > 0) {
    lines.push(`**Disagreements (preserved, not forced):**`);
    for (const d of synthesis.disagreements.slice(0, 3)) {
      lines.push(`  • [${d.type}] ${d.sideA} ↔ ${d.sideB} — ${d.assessment}`);
    }
  }
  if (synthesis.missingInformation.length > 0) lines.push(`**Missing information:** ${synthesis.missingInformation.slice(0, 3).join("; ")}`);
  lines.push(`**Confidence:** ${synthesis.confidence} — evidence objects: ${flowOutcome.evidence.length}, domains investigated: ${new Set(flowOutcome.executions.map((e) => e.capability)).size}`);
  if (synthesis.thesisImplication !== undefined) lines.push(`**Thesis implication:** ${synthesis.thesisImplication}`);
  lines.push(`**Traceability:** research ${flowOutcome.researchId}; deeper levels available on request.`);
  return lines.join("\n");
}
