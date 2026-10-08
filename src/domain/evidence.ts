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

import type { Evidence, EvidenceClass, Freshness, SourcingClass } from "./objects.js";
import { createEvidence } from "./objects.js";
import type { ToolOutput, ToolResult } from "./tool-result.js";
import { isInterpretationClass } from "./tool-result.js";
import type { ProvenanceOrigin } from "./provenance.js";
import { facetsOfPayload, type DataFacet } from "../research/data-facets.js";
import { resolutionOfStamps, resolutionOfTimeframe, type Resolution } from "../research/resolution.js";
import { payloadIdentityOf } from "./payload-identity.js";

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

/**
 * SOURCE CLASSIFICATION: DIRECT_OBSERVATION vs REPORTED_CLAIM.
 *
 * Derived only from facts the engine verified — the adapter's declared output class and the
 * resolved source kind — and NEVER from the payload's wording. A primary quantitative/factual feed
 * (an exchange print, an OHLCV candle, a macro series) is a direct observation of the market;
 * secondary reporting, community signals and authored analysis are REPORTED CLAIMS about it.
 * Successful retrieval is not observation: an RSS headline that arrived cleanly is still a claim.
 */
export function sourcingClassForOutput(output: ToolOutput): SourcingClass {
  if (isInterpretationClass(output.outputClass)) return "REPORTED_CLAIM";
  return sourceTypeForOutput(output) === "PRIMARY" ? "DIRECT_OBSERVATION" : "REPORTED_CLAIM";
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
      // SOURCE CLASSIFICATION (DIRECT_OBSERVATION vs REPORTED_CLAIM) is resolved HERE, at the
      // ingestion boundary, from the facts the adapter declared — never from the payload text and
      // never by a caller. A retrieved news headline is a REPORTED_CLAIM about the world; only a
      // primary quantitative/factual feed is a DIRECT_OBSERVATION of it. That distinction is what
      // lets a factual-timeline answer separate "what is directly observed" from "what is reported"
      // instead of presenting both as the same kind of thing.
      sourcing: sourcingClassForOutput(output),
      // DATA SHAPE (research-integrity contract): what this payload ACTUALLY carries, resolved
      // here at the only boundary that still holds the raw content. An adapter's declaration
      // is authoritative; otherwise the payload's own shape decides. Either way it is a fact
      // about the data, never about the provider's name or the call having succeeded — which
      // is what makes "BTC price sequence, high, low and volume" unsatisfiable by a spot quote.
      ...(shapeFacets(output) !== undefined
        ? { dataFacets: [...shapeFacets(output)!] }
        : {}),
      ...(coverageHoursOf(output) !== undefined ? { coverageHours: coverageHoursOf(output)! } : {}),
      // GRANULARITY (resolution.ts): the sampling detail of this payload, resolved at the same
      // boundary that measures its shape and span. The adapter's declaration wins; otherwise
      // the bar size is read from the payload's own timestamp spacing. It is a fact about the
      // DATA, so a daily candle set cannot claim to be an hourly series.
      ...(resolutionOfOutput(output) !== undefined ? { resolution: resolutionOfOutput(output)! } : {}),
      // RESPONSE IDENTITY: one provider response routed through several capabilities is ONE
      // observation. Without this, a byte-identical payload became several independent facts.
      payloadIdentity: payloadIdentityOf(result, output),
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

/**
 * The data facets an output carries: the adapter's own declaration when it made one, and
 * otherwise the payload's own shape. An interpretation or model-authored output carries none —
 * a skill's prose about a price is not the price.
 */
function shapeFacets(output: ToolOutput): readonly DataFacet[] | undefined {
  if (output.outputClass === "UNAVAILABLE") return undefined;
  if (isInterpretationClass(output.outputClass)) return undefined;
  if (output.dataFacets !== undefined) return [...output.dataFacets] as readonly DataFacet[];
  const inferred = facetsOfPayload(output.content);
  return inferred.length > 0 ? inferred : undefined;
}

/**
 * The sampling granularity this output carries, from the adapter's declaration or from the
 * payload's own timestamps. Undefined means the granularity cannot be determined — which is
 * the honest answer, and is treated as "not proven fine enough" by the coverage law.
 */
function resolutionOfOutput(output: ToolOutput): Resolution | undefined {
  if (output.outputClass === "UNAVAILABLE" || isInterpretationClass(output.outputClass)) return undefined;
  if (output.resolution !== undefined) {
    const declared = resolutionOfTimeframe(output.resolution);
    if (declared !== undefined) return declared;
  }
  const fromTimeframe = resolutionOfTimeframe(output.timeframe);
  if (fromTimeframe !== undefined) return fromTimeframe;
  return resolutionOfStamps(payloadStamps(output.content));
}

/**
 * NESTED PAYLOAD DESCENT (MC-7).
 *
 * A provider that packages its observations under a conventional key
 * (`{month, candleCount, candles: [...]}`, `{data: [...]}`, `{klines: [...]}`) is STILL a table of
 * observations; the span and granularity laws must read the rows it actually carries, not only the
 * wrapper object's own keys. Without this, a correct windowed candle payload reports NO span at
 * all (its timestamps live one level down) and every windowed requirement becomes unsatisfiable by
 * the very data that answers it. The key list matches `data-facets.ts` so shape and span are read
 * from the same rows.
 */
const NESTED_OBSERVATION_KEYS = ["candles", "klines", "ohlcv", "data", "prices", "series", "points", "bars", "result", "items"] as const;

/** Object rows inside an array (mirrors data-facets' `observationRows`). */
function objectRows(value: readonly unknown[]): readonly Record<string, unknown>[] {
  return value.filter(
    (v): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0,
  );
}

/**
 * Every row a payload carries, including rows nested under a conventional observation key.
 * The wrapper object is included too, so an explicit `from`/`to` window beside the rows survives.
 */
function payloadRows(content: unknown): readonly Record<string, unknown>[] {
  const roots = Array.isArray(content) ? content : [content];
  const rows: Record<string, unknown>[] = [];
  for (const root of roots) {
    if (root === null || typeof root !== "object" || Array.isArray(root)) continue;
    const record = root as Record<string, unknown>;
    rows.push(record);
    for (const key of NESTED_OBSERVATION_KEYS) {
      const nested = record[key];
      if (!Array.isArray(nested)) continue;
      for (const row of objectRows(nested)) rows.push(row);
    }
  }
  return rows;
}

/** Every observation timestamp a payload carries, in milliseconds. */
function payloadStamps(content: unknown): number[] {
  const rows = payloadRows(content);
  const stamps: number[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (/^(ts|time|timestamp|datetime|date|asof|opentime|closetime|lastupdatedat|t)$/i.test(key)) {
        const numeric = numericTime(value);
        if (numeric !== undefined) stamps.push(numeric);
      }
    }
  }
  return stamps;
}

/**
 * Hours of time this output spans, from the adapter's measurement or from its own timestamps.
 * A single print spans 0 — which is the fact that makes a snapshot unable to answer "the last
 * 24 hours" no matter how fresh it is.
 */
function coverageHoursOf(output: ToolOutput): number | undefined {
  if (output.coverageHours !== undefined) return output.coverageHours;
  if (isInterpretationClass(output.outputClass) || output.outputClass === "UNAVAILABLE") return undefined;
  const bounds = temporalBoundsOf(output.content);
  if (bounds === undefined) return undefined;
  const spanHours = (bounds.end - bounds.start) / 3_600_000;
  // ONE PRINT SPANS NOTHING. An observation with a single timestamp is a fact about an
  // instant; stating that explicitly is what stops "fetched one second ago" from ever being
  // read as coverage of anything.
  if (bounds.end - bounds.start === 0) return 0;
  // A BAR IS NOT INSTANTANEOUS: a 24x1h candle set reaches from its first OPEN to the CLOSE
  // of its last bar, so the final bar's own width belongs to the span. The adapter declares
  // the bar size (`timeframe`); without a declared granularity the measured span is all the
  // evidence honestly supports, and a 23-hour reach never claims to be a 24-hour one.
  return spanHours + (barHoursOf(output.timeframe) ?? 0);
}

/** "1h" / "4h" / "15m" / "1d" / "1w" to hours; undefined when the bar size is undeclared. */
function barHoursOf(timeframe: string | undefined): number | undefined {
  if (timeframe === undefined) return undefined;
  const match = /^(\d{1,4})\s*([mhdw])$/i.exec(timeframe.trim());
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "m") return amount / 60;
  if (unit === "h") return amount;
  if (unit === "d") return amount * 24;
  return amount * 168;
}

/**
 * The payload's own time span, read from timestamps on its rows or from an explicit window.
 * Returns undefined when the payload carries no time information at all, which is itself the
 * answer: an undated observation cannot claim to cover any window.
 */
function temporalBoundsOf(content: unknown): { start: number; end: number } | undefined {
  const rows = payloadRows(content);
  const stamps: number[] = [];
  let windowStart: number | undefined;
  let windowEnd: number | undefined;
  for (const record of rows) {
    for (const [key, value] of Object.entries(record)) {
      const lowered = key.toLowerCase();
      const numeric = numericTime(value);
      if (numeric === undefined) continue;
      if (/^(ts|time|timestamp|datetime|date|asof|opentime|closetime|lastupdatedat|t)$/.test(lowered)) stamps.push(numeric);
      else if (/^(from|start|starttime|since|fromms|open_?time)$/.test(lowered)) windowStart = numeric;
      else if (/^(to|end|endtime|until|toms|close_?time)$/.test(lowered)) windowEnd = numeric;
    }
  }
  if (stamps.length >= 1) return { start: Math.min(...stamps), end: Math.max(...stamps) };
  if (windowStart !== undefined && windowEnd !== undefined && windowEnd > windowStart) {
    return { start: windowStart, end: windowEnd };
  }
  return undefined;
}

/** Seconds-epoch or ISO time to milliseconds; anything else is not a time. */
function numericTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic used by every venue in the stack: a 10-digit value is a seconds epoch.
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}
