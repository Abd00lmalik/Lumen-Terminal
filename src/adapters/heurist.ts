/**
 * Heurist Mesh provider: specialized agent/data-provider fallback layer.
 *
 * Research basis (docs/integrations/heurist.md, VERIFIED against official docs + live
 * metadata endpoint 2026-09-18):
 * - REST: POST https://mesh.heurist.xyz/mesh_request, key via `Authorization: Bearer`
 *   or `api_key` body field; response `{ result: ... }`; synchronous JSON.
 * - `raw_data_only: true` requests the tool's data without the agents' LLM summary layer,
 *   so observations stay observation-classified (mandate §11: the agent's wording must
 *   never upgrade its epistemic status).
 * - Cost control (mandate §24): Mesh agents are credit-based; they register at LOWER
 *   registry priority than the direct keyless providers, so they serve only when the
 *   direct chain cannot (options chains, funding/OI, SEC filings, FRED series).
 *
 * Laws preserved:
 * - Registry owns selection: no flow ever names Heurist; these register capabilities.
 * - Provenance: every result carries agent_id + tool + raw capture reference.
 * - Lineage dedup (mandate §10): outputs carry `upstreamSource` (e.g. yahoo-finance,
 *   sec-edgar, fred) so the evidence layer can never count Heurist-served and
 *   directly-served copies of the same upstream as independent corroboration.
 * - Retrieval failure is a technical condition, never negative evidence.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RawCapture, TransportError, classifyHttpFailure, timeoutError } from "./transports/resilience.js";

export const HEURIST_MESH_BASE_URL = "https://mesh.heurist.xyz";

// ---------------------------------------------------------------------------
// Transport: one POST boundary, typed failures, raw capture
// ---------------------------------------------------------------------------

export interface HeuristMeshTransportOptions {
  /** Defaults to HEURIST_API_KEY at request time (deferred: serverless-safe). */
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string;
  readonly requestTimeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class HeuristMeshTransport {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly rawCapture = new RawCapture();

  constructor(options: HeuristMeshTransportOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? HEURIST_MESH_BASE_URL;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Credential presence (never the value). Evaluated per call so serverless cold starts with a later-injected env still work. */
  get hasApiKey(): boolean {
    const key = (this.apiKey ?? process.env.HEURIST_API_KEY ?? "").trim();
    return key !== "";
  }

  /** Invoke one agent tool; returns the parsed `result` plus a raw provenance reference. */
  async invokeTool(agentId: string, tool: string, toolArguments: Record<string, unknown>): Promise<{ result: unknown; rawReference: string }> {
    const apiKey = (this.apiKey ?? process.env.HEURIST_API_KEY ?? "").trim();
    if (apiKey === "") {
      throw new TransportError("AUTHENTICATION_FAILURE", "HEURIST_API_KEY is not configured", { retriable: false });
    }
    const path = "/mesh_request";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ api_key: apiKey, agent_id: agentId, input: { tool, tool_arguments: toolArguments, raw_data_only: true } }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(`Heurist ${agentId}.${tool}`, this.requestTimeoutMs);
      throw new TransportError("PROVIDER_ERROR", `network error calling Heurist ${agentId}.${tool}: ${error instanceof Error ? error.message : String(error)}`, { retriable: true });
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw classifyHttpFailure(response.status, text, response.headers.get("retry-after"));
    }
    const rawReference = this.rawCapture.capture("rest", `POST ${path} ${agentId}.${tool}`, text);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new TransportError("INVALID_RESPONSE", `Heurist ${agentId}.${tool} returned non-JSON body (raw captured: ${rawReference})`, { retriable: false });
    }
    const detail = (body as { detail?: unknown }).detail;
    if (detail !== undefined) {
      // Heurist reports application-level failures as { detail: "..." } with HTTP 200.
      throw new TransportError("PROVIDER_ERROR", `Heurist ${agentId}.${tool} failed: ${String(detail).slice(0, 300)}`, { retriable: true });
    }
    const result = (body as { result?: unknown }).result;
    if (result === undefined) {
      throw new TransportError("INVALID_RESPONSE", `Heurist ${agentId}.${tool} response has no result (raw captured: ${rawReference})`, { retriable: false });
    }
    return { result, rawReference };
  }

  /** Introspection for tests. */
  get capturedRawCount(): number {
    return this.rawCapture.size;
  }
}

// ---------------------------------------------------------------------------
// Normalization: Heurist tool payloads → ToolOutput[] (lineage-tagged)
// ---------------------------------------------------------------------------

/** Flatten one agent result item into a content object, preserving scalars and one nesting level. */
function itemContent(item: unknown): Record<string, unknown> | undefined {
  if (item === null || typeof item !== "object") return item !== undefined ? { value: item } : undefined;
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (innerValue !== null && innerValue !== undefined && typeof innerValue !== "object") content[`${key}.${inner}`] = innerValue;
      }
      continue;
    }
    content[key] = value;
  }
  return Object.keys(content).length > 0 ? content : undefined;
}

/**
 * Parse a Heurist tool result into observation outputs. Handles the shapes the agents
 * actually return: arrays of objects, {content|text|summary|result} wrappers, plain objects.
 * Every output carries `upstreamSource` for lineage dedup (mandate §10).
 */
export function parseHeuristOutputs(result: unknown, upstreamSource: string, about?: string): ToolOutput[] {
  const outputs: ToolOutput[] = [];
  const push = (item: unknown): void => {
    const content = itemContent(item);
    if (content === undefined) return;
    outputs.push({ outputClass: "QUANTITATIVE_OBSERVATION" as const, content: { ...content, upstreamSource }, ...(about !== undefined ? { about } : {}) });
  };
  if (Array.isArray(result)) {
    for (const item of result) push(item);
  } else if (result !== null && typeof result === "object") {
    const record = result as Record<string, unknown>;
    for (const key of ["data", "results", "items", "chain", "option_chain", "snapshots", "series", "observations"]) {
      if (Array.isArray(record[key])) {
        for (const item of record[key]) push(item);
        break;
      }
    }
    if (outputs.length === 0) {
      for (const key of ["content", "text", "summary", "answer", "analysis", "result", "quote"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim() !== "") {
          // A prose answer without raw data is the agent's analysis, never an observation.
          outputs.push({
            outputClass: "ANALYST_INTERPRETATION" as const,
            content: { text: value, upstreamSource, agentGenerated: true },
            interpretationBasis: `generated by a Heurist Mesh agent over ${upstreamSource} data; external analysis, not a direct market observation`,
            ...(about !== undefined ? { about } : {}),
          });
          return outputs;
        }
      }
      push(result);
    }
  } else if (typeof result === "string" && result.trim() !== "") {
    outputs.push({
      outputClass: "ANALYST_INTERPRETATION" as const,
      content: { text: result, upstreamSource, agentGenerated: true },
      interpretationBasis: `generated by a Heurist Mesh agent over ${upstreamSource} data; external analysis, not a direct market observation`,
      ...(about !== undefined ? { about } : {}),
    });
  }
  return outputs;
}

/** Prose outputs are the agent's own analysis; they must carry the interpretation basis. */
function withInterpretationBasis(outputs: ToolOutput[], upstreamSource: string): ToolOutput[] {
  return outputs.map((o) => {
    const text = (o.content as { text?: unknown } | undefined)?.text;
    return typeof text === "string"
      ? { ...o, interpretationBasis: o.interpretationBasis ?? `generated by a Heurist Mesh agent over ${upstreamSource} data; external analysis, not a direct market observation` }
      : o;
  });
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface HeuristAgentSpec {
  readonly agentId: string;
  readonly upstreamSource: string;
  /** Default tool invoked for the capability; params.tool overrides. */
  readonly tool: string;
  /** Param name carrying the subject (e.g. "symbol"); omitted → subject-less tool. */
  readonly subjectParam?: string;
  /** Fallback subject value when the question resolved no target (e.g. index overviews). */
  readonly defaultSubject?: string;
  readonly limitations: readonly string[];
  readonly freshnessProfile: string;
}

const BASE_LIMITATIONS: readonly string[] = [
  "Heurist Mesh is a paid credit-based agent service; registered as fallback/secondary to direct keyless providers",
  "agent output is tool-normalized third-party data; lineage (upstreamSource) is preserved for no-double-count",
  "retrieval failure is a technical condition, never negative evidence",
];

export class HeuristAgentAdapter implements ProviderAdapter {
  readonly providerId: string;
  readonly capabilities: readonly CapabilityName[];
  readonly limitations: readonly string[];
  readonly freshnessProfile: string;

  private readonly transport: HeuristMeshTransport;
  private readonly spec: HeuristAgentSpec;

  constructor(capabilities: readonly CapabilityName[], spec: HeuristAgentSpec, transport?: HeuristMeshTransport) {
    this.capabilities = capabilities;
    this.spec = spec;
    this.transport = transport ?? new HeuristMeshTransport();
    this.providerId = `heurist/${spec.agentId}`;
    this.limitations = [...BASE_LIMITATIONS, ...spec.limitations];
    this.freshnessProfile = spec.freshnessProfile;
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (!this.capabilities.includes(capability)) {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const tool = typeof params.tool === "string" && params.tool.trim() !== "" ? params.tool : this.spec.tool;
    const toolArguments: Record<string, unknown> = {};
    if (this.spec.subjectParam !== undefined) {
      const raw = [params[this.spec.subjectParam], params.asset, params.symbol].find((v) => typeof v === "string" && v.trim() !== "");
      const subject = typeof raw === "string" ? raw.trim() : this.spec.defaultSubject;
      if (subject === undefined) {
        return {
          tool: this.providerId,
          capability,
          transport: "rest:mesh.heurist.xyz",
          params,
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `no ${this.spec.subjectParam} resolved for this question; cannot invoke ${this.spec.agentId}.${tool}` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: { type: "SCHEMA_ERROR", message: `missing ${this.spec.subjectParam}`, retriable: false },
          limitations: this.limitations,
        };
      }
      toolArguments[this.spec.subjectParam] = subject;
    }
    // Pass through any explicitly requested extra arguments (bounded, scalar only).
    const extra = params.toolArguments;
    if (extra !== null && typeof extra === "object" && !Array.isArray(extra)) {
      for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") toolArguments[key] = value;
      }
    }

    // Missing credential = technical failure → the registry fails over to the next provider
    // and preserves the attempt; it is never negative evidence and never a fabricated result.
    if (!this.transport.hasApiKey) {
      throw new TransportError("AUTHENTICATION_FAILURE", "HEURIST_API_KEY is not configured", { retriable: false });
    }

    try {
      const { result, rawReference } = await this.transport.invokeTool(this.spec.agentId, tool, toolArguments);
      const about = typeof toolArguments[this.spec.subjectParam ?? ""] === "string" ? (toolArguments[this.spec.subjectParam ?? ""] as string) : undefined;
      const outputs = withInterpretationBasis(parseHeuristOutputs(result, this.spec.upstreamSource, about), this.spec.upstreamSource);
      if (outputs.length === 0) {
        return {
          tool: this.providerId,
          capability,
          transport: "rest:mesh.heurist.xyz",
          params: { ...params, ...toolArguments },
          rawReference,
          outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Heurist ${this.spec.agentId}.${tool} returned no usable data` }],
          completeness: "EMPTY",
          freshness: "CURRENT",
          validation: "VALID",
          failure: { type: "EMPTY_RESULT", message: "no usable outputs", retriable: true },
          limitations: this.limitations,
        };
      }
      return {
        tool: this.providerId,
        capability,
        transport: "rest:mesh.heurist.xyz",
        params: { ...params, ...toolArguments },
        rawReference,
        outputs,
        completeness: "COMPLETE",
        freshness: "CURRENT",
        validation: "VALID",
        limitations: this.limitations,
      };
    } catch (error) {
      const failureType = error instanceof TransportError ? error.failureType : "PROVIDER_ERROR";
      const retriable = error instanceof TransportError ? error.retriable : true;
      return {
        tool: this.providerId,
        capability,
        transport: "rest:mesh.heurist.xyz",
        params: { ...params, ...toolArguments },
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `Heurist ${this.spec.agentId}.${tool} failed: ${error instanceof Error ? error.message : String(error)}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: failureType, message: error instanceof Error ? error.message : String(error), retriable },
        limitations: this.limitations,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Registrations: capability chains after Heurist (registry resolves priority)
// ---------------------------------------------------------------------------

/** Heurist Yahoo options_chain — the ONLY working options source (direct Yahoo options API 401s; see capability matrix). */
export function createHeuristOptionsAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["OPTIONS_CHAIN_ANALYSIS"],
    {
      agentId: "YahooFinanceAgent",
      upstreamSource: "yahoo-finance",
      tool: "options_chain",
      subjectParam: "symbol",
      limitations: [
        "options metrics limited to what the Yahoo options chain provides (strikes, prices, volume, OI, IV where present)",
        "same upstream (Yahoo) as the direct equity adapter; not independent corroboration of it",
      ],
      freshnessProfile: "equity:intraday",
    },
    transport,
  );
}

/** Heurist Yahoo technical_snapshot — technical-analysis fallback when Bitget/ETA direct paths fail. */
export function createHeuristTechnicalAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["TECHNICAL_ANALYSIS"],
    {
      agentId: "YahooFinanceAgent",
      upstreamSource: "yahoo-finance",
      tool: "technical_snapshot",
      subjectParam: "symbols",
      limitations: ["indicator parameters are chosen by the Heurist agent; parameters are not ours to tune here"],
      freshnessProfile: "equity:daily-session",
    },
    transport,
  );
}

/** Heurist SEC EDGAR — primary-source company filings (G2-adjacent; filing URLs are the provenance). */
export function createHeuristSecAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["SOURCE_VALIDATION"],
    {
      agentId: "SecEdgarAgent",
      upstreamSource: "sec-edgar",
      tool: "filing_timeline",
      subjectParam: "query",
      limitations: [
        "the filing itself is the primary source; Heurist's summary of it is secondary treatment of that source",
        "filing links/identifiers are preserved in outputs; verify against the filing text when material",
      ],
      freshnessProfile: "filings:as-filed",
    },
    transport,
  );
}

/** Heurist FRED macro — macro fallback/expansion beyond the World Bank series. */
export function createHeuristFredAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["MACRO_ANALYSIS"],
    {
      agentId: "FredMacroAgent",
      upstreamSource: "fred",
      tool: "macro_series_snapshot",
      subjectParam: "series_key",
      defaultSubject: "FEDFUNDS",
      limitations: ["FRED series semantics vary by series_key; observation dates are those FRED reports"],
      freshnessProfile: "economic-release:1-2d-lag",
    },
    transport,
  );
}

/** Heurist Funding Rate agent — crypto funding/OI fallback (Binance USDⓈ-M data). */
export function createHeuristFundingRateAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["DERIVATIVES_ANALYSIS"],
    {
      agentId: "FundingRateAgent",
      upstreamSource: "binance-usdm",
      tool: "get_symbol_oi_and_funding",
      subjectParam: "symbol",
      defaultSubject: "BTCUSDT",
      limitations: ["funding/OI data is Binance USDⓈ-M sourced, not Bitget; exchange-specific positioning views are not comparable"],
      freshnessProfile: "derivatives:minutes",
    },
    transport,
  );
}

/** Register all Heurist adapters at low priority (they serve when direct providers cannot). */
export function registerHeuristAdapters(registry: import("./capability-registry.js").CapabilityRegistry, priority = 300): void {
  registry.register(createHeuristOptionsAdapter(), priority);
  registry.register(createHeuristTechnicalAdapter(), priority);
  registry.register(createHeuristSecAdapter(), priority);
  registry.register(createHeuristFredAdapter(), priority);
  registry.register(createHeuristFundingRateAdapter(), priority);
}
