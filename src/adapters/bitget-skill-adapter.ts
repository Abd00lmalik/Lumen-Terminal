/**
 * Bitget skill adapter base; one generic `ProviderAdapter` implementation shared by the five
 * confirmed skills (FINDINGS.md §1). Skills are registered through the generic CapabilityRegistry
 * mechanism; no hidden Flow→Tool mappings (final lock §6/§11).
 *
 * Responsibilities (all inside the adapter; the research engine never sees provider specifics):
 * - invoke the documented MCP tool (or REST endpoint for technical-analysis) via the transports
 * - normalize the outcome into the TOOL_RESULT contract (final lock §7)
 * - classify outputs: skill narrative/verdict text → interpretation-class outputs; numeric/
 *   factual payloads → observation-class outputs (never silently upgraded)
 * - capture provenance: skill, tool, params, timestamps, raw reference, attempts
 * - assess freshness against the skill's FINDINGS.md profile
 * - convert transport failures into failed TOOL_RESULTs; no fabricated fallback data (lock §18)
 */

import type { CapabilityName, ProviderAdapter } from "./capability-registry.js";
import type { ToolOutput, ToolOutputClass, ToolResultInput } from "../domain/tool-result.js";
import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { McpTransport, McpCallOutcome } from "./transports/mcp.js";
import { TransportError, RetryExhaustedError } from "./transports/resilience.js";
import { FRESHNESS_PROFILES, assessFreshness, freshnessLimitations, type FreshnessProfile, type ProfileKey } from "./freshness.js";

/** Re-exported for adapter-factory convenience. */
export type { ProfileKey };

/** Static description of one Bitget skill, from FINDINGS.md §2 (CONFIRMED facts). */
export interface SkillDescriptor {
  /** Provider id, e.g. "bitget-signal/news-briefing". */
  readonly providerId: string;
  /** Capabilities this skill can satisfy (capability-first; flows never name skills). */
  readonly capabilities: readonly CapabilityName[];
  /** Documented limitations preserved into every TOOL_RESULT (FINDINGS.md §2 per-skill). */
  readonly limitations: readonly string[];
  /** Freshness profile key (FINDINGS.md §2 documented lag). */
  readonly freshnessProfile: ProfileKey;
  /** Documented data classes this skill produces (for classification + provenance). */
  readonly dataClasses: readonly string[];
}

/** One MCP tool invocation this adapter can make for a capability. */
export interface McpToolSpec {
  readonly toolName: string;
  /** Maps capability-specific params into this tool's documented arguments. */
  readonly buildArgs: (params: Record<string, unknown>) => Record<string, unknown>;
}

/** How the skill's raw tool content maps to classified outputs. */
export interface OutputMapping {
  /**
   * Default class for narrative/tool-synthesized content from this skill. Per FINDINGS.md:
   * verdicts, threshold interpretations, and narrative synthesis are skill-authored analysis
   * never raw observations (lock §3/§7).
   */
  readonly narrativeClass: Extract<ToolOutputClass, "ANALYST_INTERPRETATION" | "MODEL_OUTPUT" | "INFERENCE">;
  /** Class for structured/numeric/factual payload content this tool returns. */
  readonly dataClass: Extract<ToolOutputClass, "FACTUAL_OBSERVATION" | "QUANTITATIVE_OBSERVATION" | "SENTIMENT_SIGNAL">;
  /** Marks content that is a proxy for something the provider cannot observe directly (lock §3). */
  readonly proxyBasis?: string;
}

export interface BitgetSkillAdapterOptions {
  readonly descriptor: SkillDescriptor;
  readonly transport: McpTransport;
  /** Capability → tool mapping. Multiple capabilities may share one tool (documented). */
  readonly toolFor: (capability: string) => McpToolSpec | undefined;
  readonly outputMapping: OutputMapping;
  /** Extracts event/source time from tool content when present (exact timestamps otherwise absent). */
  readonly extractSourceTimestamp?: (content: readonly unknown[]) => string | undefined;
  /** Optional per-call override for narrative classification (rare; defaults to descriptor). */
  readonly origin?: ProvenanceOrigin;
  /**
   * Flattens one classified output into 0..n outputs. DISCOVERED live: some tools return one
   * text block holding a JSON array of per-feed/per-source records; the useful evidence unit
   * is the record, not the block. Defaults to identity (one block → one output).
   */
  readonly flattenOutput?: (output: ToolOutput) => readonly ToolOutput[];
}

export class BitgetSkillAdapter implements ProviderAdapter {
  readonly providerId: string;
  readonly capabilities: readonly CapabilityName[];
  readonly limitations: readonly string[];
  readonly freshnessProfile: string;
  readonly profile: FreshnessProfile;

  private readonly transport: McpTransport;
  private readonly toolFor: (capability: string) => McpToolSpec | undefined;
  private readonly outputMapping: OutputMapping;
  private readonly extractSourceTimestamp: ((content: readonly unknown[]) => string | undefined) | undefined;
  private readonly flattenOutput: (output: ToolOutput) => readonly ToolOutput[];

  constructor(options: BitgetSkillAdapterOptions) {
    this.providerId = options.descriptor.providerId;
    this.capabilities = options.descriptor.capabilities;
    this.limitations = options.descriptor.limitations;
    this.profile = FRESHNESS_PROFILES[options.descriptor.freshnessProfile];
    this.freshnessProfile = this.profile.id;
    this.transport = options.transport;
    this.toolFor = options.toolFor;
    this.outputMapping = options.outputMapping;
    this.extractSourceTimestamp = options.extractSourceTimestamp;
    this.flattenOutput = options.flattenOutput ?? ((o) => [o]);
  }

  async execute(capability: string, params: Record<string, unknown>): Promise<ToolResultInput> {
    const spec = this.toolFor(capability);
    if (spec === undefined) {
      throw new TransportError("SCHEMA_ERROR", `${this.providerId} has no tool mapped for capability ${capability}`, { retriable: false });
    }

    const args = spec.buildArgs(params);
    let outcome: McpCallOutcome;
    try {
      outcome = await this.transport.callTool(spec.toolName, args);
    } catch (error) {
      throw this.rethrowAsTransportError(error, spec.toolName);
    }    const content = outcome.content;
    const sourceTimestamp = this.extractSourceTimestamp?.(content);
    const verdict = assessFreshness(this.profile, sourceTimestamp);

    const outputs: ToolOutput[] = content.flatMap((block) => this.flattenOutput(this.classifyContentBlock(block)));
    if (outputs.length === 0) {
      // Tool responded but returned nothing usable; EMPTY, not a failure (failure-recovery.md
      // §10: NO RESULT ≠ FAILED RETRIEVAL ≠ NEGATIVE RESULT).
      return {
        tool: this.providerId,
        capability,
        transport: `mcp:${spec.toolName}`,
        params: { ...params, __tool: spec.toolName },
        rawReference: outcome.rawReference,
        outputs: [],
        completeness: "EMPTY",
        validation: "VALID",
        freshness: verdict,
        limitations: this.limitationsFor(verdict, outcome.attempts ?? 1, 0, 0),
      };
    }

    // Per-source failure handling (FINDINGS.md §2.1/§2.5: skills return the neutral "data
    // temporarily unavailable" per source; failed feeds are skipped). UNAVAILABLE outputs are
    // preserved (never fabricated over) but can never become evidence (evidence.ts throws).
    const unavailable = outputs.filter((o) => o.outputClass === "UNAVAILABLE").length;
    const completeness = unavailable === outputs.length ? "EMPTY" : unavailable > 0 ? "PARTIAL" : "COMPLETE";

    return {
      tool: this.providerId,
      capability,
      transport: `mcp:${spec.toolName}`,
      params: { ...params, __tool: spec.toolName },
      rawReference: outcome.rawReference,
      outputs,
      completeness,
      validation: "VALID",
      ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
      freshness: verdict,
      limitations: this.limitationsFor(verdict, outcome.attempts ?? 1, unavailable, outputs.length),
    };
  }

  /**
   * Classify one content block. Text blocks from these skills are skill-authored narrative or
   * structured text. When the block carries a parseable JSON payload with an explicit class hint
   * (`"_class"`), honor it; otherwise narrative text uses the skill's narrativeClass.
   */
  private classifyContentBlock(block: unknown): ToolOutput {
    if (typeof block === "object" && block !== null && "text" in (block as Record<string, unknown>)) {
      const text = String((block as Record<string, unknown>).text);
      return this.classifyText(text);
    }
    // Structured payload block.
    const payload = block as Record<string, unknown>;
    const unavailableOutput = errorEnvelopeOutput(payload);
    if (unavailableOutput !== undefined) return unavailableOutput;
    const hintedClass = typeof payload["_class"] === "string" ? (payload["_class"] as ToolOutputClass) : undefined;
    const outputClass = hintedClass ?? this.outputMapping.dataClass;
    const proxyBasis = this.outputMapping.proxyBasis;
    return {
      outputClass,
      content: block,
      ...(typeof payload["about"] === "string" ? { about: payload["about"] } : {}),
      ...(typeof payload["timeframe"] === "string" ? { timeframe: payload["timeframe"] } : {}),
      ...(proxyBasis !== undefined ? { proxyBasis } : {}),
    };
  }

  private classifyText(text: string): ToolOutput {
    // Neutral per-source failure marker (CONFIRMED in FINDINGS.md §2.1/§2.2/§2.5: skills return
    // "data temporarily unavailable" without exposing provider names). Preserved as UNAVAILABLE
    // never replaced with fabricated content, never silently dropped.
    if (/^data temporarily unavailable/i.test(text.trim())) {
      return { outputClass: "UNAVAILABLE", content: text };
    }
    // JSON-encoded text payloads (some MCP tools return JSON strings) are data, not narrative.
    if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const unavailable = errorEnvelopeOutput(parsed);
        if (unavailable !== undefined) return unavailable;
        const hintedClass = typeof parsed["_class"] === "string" ? (parsed["_class"] as ToolOutputClass) : undefined;
        const proxyBasis = this.outputMapping.proxyBasis;
        return {
          outputClass: hintedClass ?? this.outputMapping.dataClass,
          content: parsed,
          ...(typeof parsed["about"] === "string" ? { about: parsed["about"] } : {}),
          ...(typeof parsed["timeframe"] === "string" ? { timeframe: parsed["timeframe"] } : {}),
          // Proxy labeling must survive the JSON-text path too (lock §3).
          ...(proxyBasis !== undefined ? { proxyBasis } : {}),
        };
      } catch {
        // fall through to narrative classification
      }
    }
    const outputClass = this.outputMapping.narrativeClass;
    return {
      outputClass,
      content: text,
      interpretationBasis: `skill-authored narrative from ${this.providerId} (output templates/threshold synthesis per FINDINGS.md §2)`,
    };
  }


/**
 * Freshness/observational limitations for this specific result. Descriptor-level limitations
 * are merged by the CapabilityRegistry (single source, no duplication).
 */
  private limitationsFor(verdict: string, attempts: number, unavailable: number, total: number): readonly string[] {
    const items = [...freshnessLimitations(this.profile, verdict as "CURRENT" | "STALE" | "HISTORICAL")];
    if (attempts > 1) items.push(`succeeded after ${attempts} attempts (retry/backoff engaged)`);
    if (unavailable > 0 && total > 0) {
      items.push(
        unavailable === total
          ? `all ${total} content blocks reported data temporarily unavailable; no usable output`
          : `${unavailable} of ${total} content blocks reported data temporarily unavailable (per-source failure skipped per FINDINGS.md §2.5)`,
      );
    }
    return items;
  }

  private rethrowAsTransportError(error: unknown, toolName: string): TransportError {
    if (error instanceof TransportError) return error;
    if (error instanceof RetryExhaustedError) return error.lastError;
    return new TransportError("PROVIDER_ERROR", `${this.providerId} tool ${toolName} failed: ${error instanceof Error ? error.message : String(error)}`, { retriable: false });
  }
}

/**
 * DISCOVERED (live 2026-09-13): many tools return per-record error envelopes; a bare object like
 * `{"error": "Unknown action: "}` or `{"cpi": {"error": ""}}` instead of data. An object whose
 * ONLY content is error fields is a per-record failure: preserved as UNAVAILABLE (never turned
 * into an observation, never fabricated over; final lock §18). Mixed objects (error fields AND
 * data keys) pass through so record-level flattening can decide per record.
 */
function errorEnvelopeOutput(payload: Record<string, unknown>): ToolOutput | undefined {
  const keys = Object.keys(payload);
  if (keys.length === 0) return undefined;
  const isErrorKey = (key: string): boolean => /^error$/i.test(key) || /_error$/i.test(key);
  // An entry signals an error when the key itself is an error key (e.g. "error", "alt_me_error")
  // OR the value is an object whose own keys are all error keys (e.g. "cpi": {"error": ""}).
  const signalsError = (key: string, value: unknown): boolean => {
    if (isErrorKey(key)) return true;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const innerKeys = Object.keys(value as Record<string, unknown>);
      return innerKeys.length > 0 && innerKeys.every((k) => isErrorKey(k));
    }
    return false;
  };
  if (!keys.every((k) => signalsError(k, payload[k]))) return undefined;
  const summary = JSON.stringify(payload).slice(0, 200);
  // All-empty ("") envelopes mean the provider could not fetch the record; non-empty error text
  // is an explicit failure message. Both are the same architectural fact: no data was returned.
  return { outputClass: "UNAVAILABLE", content: summary };
}
