/**
 * Evidence classification and quality; the boundary between a TOOL_RESULT and the research graph.
 *
 * Architectural basis:
 * - evidence-source.md: evidence carries class (observation/interpretation/speculation),
 *   directness/reliability/recency/specificity/corroboration, freshness.
 * - Final lock §7: "A Skill's own interpretation must never silently become a factual observation."
 * - Final lock §10 (QUALITY ≠ CONFIDENCE): quality describes the evidence; confidence describes
 *   the assessment. Tool failure is not negative evidence; missing evidence is not evidence against.
 * - Final lock §3: market-intel-style proxies stay explicitly labeled PROXY_EVIDENCE with basis.
 */

import type { Evidence, EvidenceClass, Freshness } from "./objects.js";
import { createEvidence } from "./objects.js";
import type { ToolOutput, ToolResult } from "./tool-result.js";
import { isInterpretationClass } from "./tool-result.js";
import type { ProvenanceOrigin } from "./provenance.js";

/** Mapping from normalized tool-output class to evidence class. */
export function evidenceClassForOutput(output: ToolOutput): EvidenceClass {
  switch (output.outputClass) {
    case "FACTUAL_OBSERVATION":
      return "OBSERVATION";
    case "QUANTITATIVE_OBSERVATION":
    case "SENTIMENT_SIGNAL":
      return "OBSERVATION";
    case "ANALYST_INTERPRETATION":
    case "MODEL_OUTPUT":
    case "INFERENCE":
      return "DERIVED_OBSERVATION";
    case "SPECULATION":
      return "SPECULATION";
    case "UNAVAILABLE":
    case "ERROR":
      // A failed/unavailable output never becomes evidence.
      throw new Error("UNAVAILABLE/ERROR tool outputs must not become evidence");
  }
}

/**
 * SOURCE CLASS for evidence-quality assessment (research contract §evidence quality): what the
 * system can honestly say about the ORIGIN of this output. Derived only from validated
 * provenance and payload facts the engine itself verified — never invented:
 * - an interpretation-class output is authored analysis, not a market observation;
 * - the G2 adapter's payload-level sourceClass maps to the typed kind it already declares;
 * - everything else: the serving transport is the only known origin (the transport IS the
 *   serving source for a quantitative feed, and counting it is factual).
 * A source class is NEVER assigned from the output TEXT (no content sniffing).
 */
export function sourceTypeForOutput(output: ToolOutput): "PRIMARY" | "SECONDARY" | "COMMUNITY" | "ANALYSIS" {
  if (isInterpretationClass(output.outputClass)) return "ANALYSIS";
  const payload = output.content;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    switch (rec["sourceClass"]) {
      case "primary/official":
        return "PRIMARY";
      case "secondary/encyclopedic":
      case "secondary/news-report":
      case "secondary/unclassified":
        return "SECONDARY";
      case "community/social-signal":
        return "COMMUNITY";
    }
  }
  // No declared source class: a direct quantitative feed served by its own transport is a
  // primary observation; a textual/structured FACTUAL payload without one is treated as
  // SECONDARY reporting (conservative default, never silently primary; g2 law).
  if (output.outputClass === "QUANTITATIVE_OBSERVATION" || output.outputClass === "SENTIMENT_SIGNAL") return "PRIMARY";
  return "SECONDARY";
}

/**
 * SOURCE IDENTITY for evidence-quality assessment: the distinct origin this output came from.
 * Priority: an in-payload publisher/upstream declaration the system verified, else the serving
 * transport (which IS the serving origin for a quantitative feed). Repeated outputs from the
 * same origin never add diversity; the duplicateContent flag makes that explicit per item.
 */
export function sourceProviderForOutput(result: ToolResult, output: ToolOutput): string {
  const payload = output.content;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    const publisher = rec["publisher"];
    if (typeof publisher === "string" && publisher.trim() !== "") return publisher.trim();
    const upstream = rec["upstreamSource"];
    if (typeof upstream === "string" && upstream.trim() !== "") return upstream.trim();
  }
  return result.transport;
}

export interface EvidenceQuality {
  /** 0..1; how directly the observation bears on the claim (primary data > narration). */
  directness: number;
  /** 0..1; source/observation reliability estimate. */
  reliability: number;
  /** 0..1; recency given the research requirement's freshness needs. */
  recency: number;
  /** 0..1; specificity to the researched target/event. */
  specificity: number;
  /** 0..1; independent corroboration (source count is NOT strength; independence matters). */
  corroboration: number;
}

/**
 * QUALITY ≠ CONFIDENCE: this assesses the evidence itself. Confidence lives on judgments and
 * is derived separately (judgment-confidence.md). None of these numbers are fabricated by M0
 * the caller (research engine, M2) supplies them from source quality + requirement context.
 */
export function assessEvidenceQuality(e: Evidence): EvidenceQuality {
  const reliability = e.sourceRefs.length > 0 ? 0.5 : 0.2; // neutral defaults; replaced by M2 source scoring
  return {
    directness: e.evidenceClass === "OBSERVATION" ? 0.8 : 0.4,
    reliability,
    recency: e.freshness === "CURRENT" ? 0.9 : e.freshness === "STALE" ? 0.3 : 0.1,
    specificity: e.evidenceClass === "OBSERVATION" ? 0.7 : 0.4,
    corroboration: e.sourceRefs.length >= 2 ? 0.7 : e.sourceRefs.length === 1 ? 0.4 : 0.1,
  };
}

export interface EvidenceFromToolResultOptions {
  /** Explicit override when the adapter knows a number is a proxy (lock §3, market-intel). */
  forceProxy?: { basis: string };
  freshness?: Freshness;
  claimRefs?: { supports?: readonly string[]; contradicts?: readonly string[] };
  evidenceType?: string;
  /**
   * Override the default provenance refs ([rawReference]); used by flow orchestration to point
   * at real SOURCE objects created per item (M2 Flow 1). The raw reference should normally be
   * included; it keeps the raw payload reachable via the evidence's sourceRefs.
   */
  sourceRefs?: readonly string[];
}

/**
 * Convert one validated TOOL_RESULT output into an EVIDENCE object.
 * Rules enforced:
 * - interpretation-class outputs are recorded as DERIVED_OBSERVATION with interpretationBasis
 *   never as OBSERVATION (lock §7).
 * - failed tool results produce NO evidence (lock §10: failure is not negative evidence).
 * - invalid results are rejected; they must not enter the research graph (orchestration §20).
 * - proxy classification is preserved with its limitation (lock §3).
 */
export function evidenceFromToolResult(
  result: ToolResult,
  output: ToolOutput,
  origin: ProvenanceOrigin,
  options: EvidenceFromToolResultOptions = {},
  at = new Date(),
): Evidence {
  if (result.failure.type !== "NONE") {
    throw new Error(
      `Tool result ${result.id} failed (${result.failure.type}); failed results must not become evidence`,
    );
  }
  if (result.validation === "INVALID") {
    throw new Error(`Tool result ${result.id} failed validation; invalid results must not enter the research graph`);
  }

  let evidenceClass = evidenceClassForOutput(output);
  let proxyBasis: string | undefined;
  if (options.forceProxy) {
    evidenceClass = "PROXY_EVIDENCE";
    proxyBasis = options.forceProxy.basis;
  } else if (output.proxyBasis !== undefined) {
    // Adapter boundary marked this output as proxy-derived; the label survives into the graph
    // no matter what downstream callers want (lock §3; M1 adapter contract).
    evidenceClass = "PROXY_EVIDENCE";
    proxyBasis = output.proxyBasis;
  }

  return createEvidence(
    {
      observation:
        typeof output.content === "string"
          ? output.content
          : JSON.stringify(output.content),
      evidenceType: options.evidenceType ?? result.capability,
      evidenceClass,
      sourceRefs: options.sourceRefs ?? (result.rawReference ? [result.rawReference] : [`tool-result:${result.id}`]),
      ...(result.sourceTimestamp !== undefined ? { timestamp: result.sourceTimestamp } : {}),
      supports: options.claimRefs?.supports ?? [],
      contradicts: options.claimRefs?.contradicts ?? [],
      freshness: options.freshness ?? result.freshness,
      ...(proxyBasis !== undefined ? { proxyBasis } : {}),
      // The producing adapter's explicit subject declaration survives into the graph: the
      // target-relevance gate must be able to honor it when the observation text itself
      // never names the ticker (real indicator/news payloads often don't).
      ...(output.about !== undefined && output.about.trim() !== "" ? { subject: output.about } : {}),
      toolResultRef: result.id,
      // Provenance-derived source identity/kind for the evidence-quality assessment
      // (research contract §evidence quality): a requirement's sourceDiversity counts DISTINCT
      // origins, and G2 payloads that declare publisher/upstream are honored so the
      // same upstream reached via different paths is never counted as independent corroboration.
      sourceProvider: sourceProviderForOutput(result, output),
      sourceType: sourceTypeForOutput(output),
      ...(payloadDuplicateFlag(output) ? { duplicateContent: true } : {}),
    },
    origin,
    at,
  );
}

/** The adapter's repeated-content flag, when the payload carries one. */
function payloadDuplicateFlag(output: ToolOutput): boolean {
  const payload = output.content;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    return (payload as Record<string, unknown>)["duplicateContent"] === true;
  }
  return false;
}
