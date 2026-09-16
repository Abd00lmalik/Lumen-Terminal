/**
 * Normalized TOOL_RESULT — the contract every external/Skill invocation must satisfy.
 *
 * Architectural basis:
 * - tool-skill-orchestration.md §18 (normalization schema), §19 (output classification),
 *   §20 (validation), §21 (failure taxonomy), §25 (freshness), §38 (provenance).
 * - Final lock §7: tool identity, capability, provider/transport, invocation parameters,
 *   retrieval/source timestamps, raw reference, normalized output, completeness, freshness,
 *   validation/failure status, limitations, provenance — and the rule that a Skill's own
 *   interpretation must never silently become a factual observation.
 * - Lock §3: market-intel outputs are NOT true on-chain observations; proxies stay labeled.
 */

import { newId, idPrefixes } from "./ids.js";
import { createProvenance, type Provenance, type ProvenanceOrigin } from "./provenance.js";

/** Classification of what a tool/skill actually produced (tool-skill-orchestration.md §19). */
export type ToolOutputClass =
  | "FACTUAL_OBSERVATION"
  | "QUANTITATIVE_OBSERVATION"
  | "ANALYST_INTERPRETATION"
  | "MODEL_OUTPUT"
  | "SENTIMENT_SIGNAL"
  | "INFERENCE"
  | "SPECULATION"
  | "UNAVAILABLE"
  | "ERROR";

export type ToolFailureType =
  | "NONE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "AUTHENTICATION_FAILURE"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "PARTIAL_RESPONSE"
  | "STALE_DATA"
  | "SCHEMA_ERROR"
  | "PROVIDER_ERROR"
  | "EMPTY_RESULT";

export interface ToolResult {
  readonly id: string;
  /** Tool/Skill identity, e.g. "bitget-signal/news-briefing". Vendor-neutral user-facing text is an output concern; provenance here is internal. */
  readonly tool: string;
  readonly capability: string; // architecture CAPABILITY name, e.g. NEWS_ANALYSIS
  /** Which transport/provider served the call, e.g. "mcp:public-market-data" | "rest:api.bitget.com". */
  readonly transport: string;
  readonly invocation: {
    readonly params: Record<string, unknown>;
    readonly at: string; // retrieval timestamp
  };
  readonly rawReference?: string; // pointer to raw response (never inline secrets)
  readonly normalizedOutput: readonly ToolOutput[];
  readonly completeness: "COMPLETE" | "PARTIAL" | "EMPTY";
  readonly freshness: "CURRENT" | "STALE" | "HISTORICAL";
  /** Observed/source timestamp when the tool provides one (event time, distinct from retrieval). */
  readonly sourceTimestamp?: string;
  readonly validation: "VALID" | "INVALID" | "NOT_VALIDATED";
  readonly failure: {
    readonly type: ToolFailureType;
    readonly message?: string;
    readonly retriable: boolean;
  };
  readonly limitations: readonly string[];
  /**
   * Provider-failover audit trail (fallback policy): providers attempted BEFORE the serving
   * one, with their outcomes. Present only when a fallback actually served after earlier
   * attempts failed — the serving fallback must not erase the primary's failure.
   */
  readonly attemptedProviders?: readonly {
    readonly provider: string;
    readonly outcome: string;
    readonly failureType?: ToolResult["failure"]["type"];
  }[];
  readonly provenance: Provenance;
}

export interface ToolOutput {
  readonly outputClass: ToolOutputClass;
  /** The actual content — kept provider-neutral here; adapters may keep structured payloads. */
  readonly content: unknown;
  readonly about?: string; // subject/asset/entity this output concerns
  readonly timeframe?: string; // e.g. "1h", "2026-09-01..2026-09-12"
  /** Required when outputClass is interpretation-like: the Skill authored this, not the market. */
  readonly interpretationBasis?: string;
  /**
   * Required when the output is a proxy for something the provider cannot observe directly
   * (lock §3: e.g. market-intel ETF-flow/unlock/whale proxies). Presence forces the evidence
   * layer to classify this as PROXY_EVIDENCE with this basis — it can never enter the graph
   * as a direct OBSERVATION. Adapters set this at the boundary; callers cannot silently drop it.
   */
  readonly proxyBasis?: string;
}

/** Skill-authored interpretation classes — these must never silently become factual evidence. */
const INTERPRETATION_CLASSES: ReadonlySet<ToolOutputClass> = new Set([
  "ANALYST_INTERPRETATION",
  "MODEL_OUTPUT",
  "INFERENCE",
  "SPECULATION",
]);

export function isInterpretationClass(c: ToolOutputClass): boolean {
  return INTERPRETATION_CLASSES.has(c);
}

export type ToolResultInput = {
  tool: string;
  capability: string;
  transport: string;
  params?: Record<string, unknown>;
  rawReference?: string;
  outputs?: readonly ToolOutput[];
  completeness?: ToolResult["completeness"];
  freshness?: ToolResult["freshness"];
  sourceTimestamp?: string;
  validation?: ToolResult["validation"];
  failure?: ToolResult["failure"];
  limitations?: readonly string[];
  attemptedProviders?: readonly {
    provider: string;
    outcome: string;
    failureType?: ToolResult["failure"]["type"];
  }[];
};

/**
 * Normalize a provider payload into a TOOL_RESULT. Never fabricates: when a call fails,
 * build a result with failure set and completeness EMPTY/PARTIAL — do not invent outputs.
 */
export function normalizedResult(input: ToolResultInput, origin: ProvenanceOrigin, at = new Date()): ToolResult {
  const failure: ToolResult["failure"] =
    input.failure ?? { type: "NONE", retriable: false };
  const outputs = Object.freeze([...(input.outputs ?? [])]);
  return Object.freeze({
    id: newId(idPrefixes.toolResult),
    tool: input.tool,
    capability: input.capability,
    transport: input.transport,
    invocation: Object.freeze({ params: Object.freeze({ ...(input.params ?? {}) }), at: at.toISOString() }),
    ...(input.rawReference !== undefined ? { rawReference: input.rawReference } : {}),
    normalizedOutput: outputs,
    completeness: input.completeness ?? (outputs.length > 0 ? "COMPLETE" : "EMPTY"),
    freshness: input.freshness ?? "CURRENT",
    ...(input.sourceTimestamp !== undefined ? { sourceTimestamp: input.sourceTimestamp } : {}),
    validation: input.validation ?? "NOT_VALIDATED",
    failure,
    limitations: Object.freeze([...(input.limitations ?? [])]),
    ...(input.attemptedProviders !== undefined ? { attemptedProviders: Object.freeze([...input.attemptedProviders]) } : {}),
    provenance: createProvenance(origin, `tool result from ${input.tool} via ${input.transport}`, at),
  });
}
