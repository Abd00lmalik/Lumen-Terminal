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
    const payload = (body as { result?: unknown; data?: unknown });
    let result = payload.result !== undefined && payload.result !== null ? payload.result : payload.data;
    // Search-style tools wrap twice: {data:{status:'success', data:{results:[...]}}}
    // (VERIFIED LIVE: DuckDuckGoSearchAgent). Unwrap exactly that wrapper shape — nothing
    // else — so direct tool outputs (chain/tvl/fees objects) pass through untouched.
    if (result !== null && typeof result === "object" && !Array.isArray(result)) {
      const r = result as Record<string, unknown>;
      const keys = Object.keys(r);
      if (r.data !== undefined && r.data !== null && keys.length <= 2 && keys.every((k) => k === "status" || k === "data")) {
        result = r.data;
      }
    }
    if (result === undefined || result === null) {
      // Distinguish honest emptiness from malformed output: agents legitimately return
      // null/absent results when they have no coverage for a subject. That is "no data",
      // NOT a protocol failure; the registry records it as an empty attempt and any
      // earlier direct provider's data still stands. Only structurally wrong payloads
      // (non-JSON, wrong types) are INVALID_RESPONSE.
      // NOTE: Mesh wraps successful tool output in `data` (VERIFIED LIVE 2026-09-18: every
      // agent answers {data: ...}; `result` is not part of the success envelope). Both keys
      // are accepted; accepting `result` first keeps forward compatibility.
      throw new TransportError("EMPTY_RESULT", `Heurist ${agentId}.${tool} has no result for this subject (raw captured: ${rawReference})`, { retriable: false });
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
 *
 * ERROR-PAYLOAD LAW: some agents return HTTP 200 with an embedded failure object — observed
 * live: Caesar returned {error: "API request failed: 402, message='Payment Required'..."}.
 * Such payloads are PROVIDER failures, not observations; they previously became evidence
 * (ev_000616) and even upgraded a dead-end into a false "COMPLETE". Detect them before any
 * other parsing and surface them as an EMPTY result so the registry records a failed tier.
 */
export function parseHeuristOutputs(result: unknown, upstreamSource: string, about?: string): ToolOutput[] {
  // Embedded error objects: {error: "..."} / {errorMessage: ...} / {status: "error", ...}.
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const errorText = typeof r.error === "string" ? r.error : typeof r.errorMessage === "string" ? r.errorMessage : undefined;
    const statusError = r.status === "error" || r.status === "failed";
    if (errorText !== undefined || statusError) {
      throw new TransportError("PROVIDER_ERROR", `Heurist agent returned an embedded error: ${(errorText ?? JSON.stringify(r)).slice(0, 200)}`, { retriable: true });
    }
  }
  const outputs: ToolOutput[] = [];
  const push = (item: unknown): void => {
    const content = itemContent(item);
    if (content === undefined) return;
    // Mesh success payloads nest under `data` (VERIFIED LIVE 2026-09-18); unwrap one level so
    // the observation fields are the content, not a lone "data: {...}" object.
    const inner = content as Record<string, unknown>;
    if (Object.keys(inner).length === 1 && inner.data !== undefined && typeof inner.data === "object" && !Array.isArray(inner.data)) {
      const unwrapped = itemContent(inner.data);
      if (unwrapped === undefined) return;
      outputs.push({ outputClass: "QUANTITATIVE_OBSERVATION" as const, content: { ...unwrapped, upstreamSource }, ...(about !== undefined ? { about } : {}) });
      return;
    }
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
  /** Fixed extra tool arguments for subjectless/question-agnostic tools (e.g. network scope). */
  readonly defaultSubjectParams?: Readonly<Record<string, unknown>>;
  /** Tool substituted when the subject fell back to defaultSubject (subjectless variants). */
  readonly fallbackTool?: string;
  /** Extra arguments used together with fallbackTool. */
  readonly fallbackToolParams?: Readonly<Record<string, unknown>>;
  /** Deep-research agents accept the raw question text as their subject (query/prompt). */
  readonly acceptsQuestion?: boolean;
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
    let fellBack = false;
    if (this.spec.subjectParam !== undefined) {
      const raw = [
        params[this.spec.subjectParam], params.asset, params.symbol,
        ...(this.spec.acceptsQuestion === true ? [params.question] : []),
      ].find((v) => typeof v === "string" && v.trim() !== "");
      const fellBackSubject = raw === undefined && this.spec.defaultSubject !== undefined;
      fellBack = fellBackSubject;
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
    } else if (this.spec.acceptsQuestion === true && typeof params.question === "string" && params.question.trim() !== "") {
      toolArguments.query = params.question;
    }
    const activeTool = fellBack === true && this.spec.fallbackTool !== undefined ? this.spec.fallbackTool : tool;
    const extraParams = fellBack === true && this.spec.fallbackToolParams !== undefined
      ? { ...this.spec.defaultSubjectParams, ...this.spec.fallbackToolParams }
      : this.spec.defaultSubjectParams;
    for (const [key, value] of Object.entries(extraParams ?? {})) {
      toolArguments[key] = value;
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
      const { result, rawReference } = await this.transport.invokeTool(this.spec.agentId, activeTool, toolArguments);
      const about = typeof toolArguments[this.spec.subjectParam ?? ""] === "string" ? (toolArguments[this.spec.subjectParam ?? ""] as string) : undefined;
      const outputs = withInterpretationBasis(parseHeuristOutputs(result, this.spec.upstreamSource, about), this.spec.upstreamSource);
      if (outputs.length === 0) {
        return {
          tool: `${this.providerId}.${activeTool}`,
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
        tool: `${this.providerId}.${activeTool}`,
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

/**
 * Heurist Yahoo equity_overview — EARNINGS_CALENDAR fallback when the direct Yahoo
 * calendarEvents path fails. The agent has no dedicated calendar tool; its analyst
 * section legitimately serves earnings context, and its output is classified by the
 * normal epistemic rules (estimates stay ESTIMATE-classified, never reported results).
 */
export function createHeuristEarningsAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["EARNINGS_CALENDAR"],
    {
      agentId: "YahooFinanceAgent",
      upstreamSource: "yahoo-finance",
      tool: "equity_overview",
      subjectParam: "symbols",
      limitations: [
        "fallback earnings context via equity_overview (analyst section): no dedicated calendar tool exists, so exact announcement dates may be absent",
        "analyst/consensus figures are ESTIMATES, never reported results; same upstream (Yahoo) as the direct earnings adapter; not independent corroboration of it",
      ],
      freshnessProfile: "equity:quarterly",
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
      acceptsQuestion: true,
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

/**
 * Heurist Caesar research agent — LAST-RESORT deep research for synthesis questions the direct
 * capability chain could not answer (mandate: "for anything we could not answer, use a Heurist
 * deep-research agent"). Output is generated research analysis: it arrives pre-classified as
 * ANALYST_INTERPRETATION (agent-generated, never a direct observation) and the evidence layer
 * treats it as EXTERNAL_AGENT_ANALYSIS, never as market data.
 */
export function createHeuristCaesarAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["CROSS_DOMAIN_SYNTHESIS"],
    {
      agentId: "CaesarResearchAgent",
      upstreamSource: "caesar-research",
      tool: "caesar_research",
      subjectParam: "query",
      acceptsQuestion: true,
      limitations: [
        "Caesar is an AI research agent: its output is generated analysis over web/academic sources, NOT direct market observation",
        "expensive (10 credits/call): only invoked when the direct capability chain produced no coverage",
        "synchronous call can take up to ~2 minutes for deep queries",
      ],
      freshnessProfile: "web:retrieval-time",
    },
    transport,
  );
}

/**
 * Heurist AskHeurist agent — crypto Q&A deep research, same last-resort tier as Caesar.
 * `mode: "quick"` keeps latency bounded; output is AGENT analysis, classified accordingly.
 */
export function createHeuristAskAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["CROSS_DOMAIN_SYNTHESIS"],
    {
      agentId: "AskHeuristAgent",
      upstreamSource: "ask-heurist",
      tool: "ask_heurist",
      subjectParam: "prompt",
      acceptsQuestion: true,
      limitations: [
        "AskHeurist is a crypto Q&A research agent: its output is generated analysis, NOT direct market observation",
        "expensive (10 credits/call): only invoked when the direct capability chain produced no coverage",
        "async-capable agent invoked in quick mode; deep jobs are not awaited here",
      ],
      freshnessProfile: "web:retrieval-time",
    },
    transport,
  );
}

/**
 * Heurist search agents (Exa, DuckDuckGo) — bounded WEB_SEARCH fallback tier.
 * Registered BELOW G2: primary-source-bounded discovery first, commercial neural search
 * second, keyless DDG third. All outputs are FACTUAL_OBSERVATION (secondary reporting
 * until the URL is retrieved and validated by G2 semantics).
 */
export function createHeuristExaSearchAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["WEB_SEARCH"],
    {
      agentId: "ExaSearchAgent",
      upstreamSource: "exa-search",
      tool: "exa_web_search",
      subjectParam: "search_term",
      acceptsQuestion: true,
      limitations: [
        "search results are discovery, not verified evidence; snippets are secondary reporting",
        "same underlying article across search agents is one source, never independent corroboration",
      ],
      freshnessProfile: "web:retrieval-time",
    },
    transport,
  );
}

/** DuckDuckGo keyless search — final WEB_SEARCH tier when G2 and Exa cannot serve. */
export function createHeuristDuckDuckGoAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["WEB_SEARCH"],
    {
      agentId: "DuckDuckGoSearchAgent",
      upstreamSource: "duckduckgo",
      tool: "search_web",
      subjectParam: "search_term",
      acceptsQuestion: true,
      limitations: [
        "keyless web search; result titles/URLs only, not extracted primary-source content",
      ],
      freshnessProfile: "web:retrieval-time",
    },
    transport,
  );
}

/**
 * Heurist on-chain agents (Etherscan, CoinGecko on-chain) — first real ONCHAIN_ANALYSIS
 * providers. Previously ONCHAIN_ANALYSIS was honestly UNAVAILABLE ("NOT true on-chain
 * intelligence"); these provide address history, top holders, and large DEX trades with
 * upstream lineage preserved. Holder counts are DIRECT_OBSERVATION of chain data via the
 * agent's tool normalization; wallet attribution remains ANALYST_INTERPRETATION at most.
 */
export function createHeuristEtherscanAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["ONCHAIN_ANALYSIS"],
    {
      agentId: "EtherscanAgent",
      upstreamSource: "etherscan",
      tool: "get_erc20_token_transfers",
      subjectParam: "address",
      limitations: [
        "EVM chains only; requires a resolved contract/address; a token name alone is not an address",
        "transfer/holder observations are chain data; behavioral interpretation of them is NOT included",
      ],
      freshnessProfile: "chain:near-realtime",
    },
    transport,
  );
}

/** CoinGecko on-chain toolset (holders, large trades) as a second ONCHAIN_ANALYSIS provider. */
export function createHeuristOnchainAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["ONCHAIN_ANALYSIS"],
    {
      agentId: "CoinGeckoTokenInfoAgent",
      upstreamSource: "coingecko-onchain",
      tool: "get_recent_large_trades",
      subjectParam: "address",
      defaultSubjectParams: { network: "eth" },
      limitations: [
        "CoinGecko on-chain network scope (eth etc.); requires token contract address for holder/trade tools",
        "large-trade feed is DEX activity, not exchange order flow",
      ],
      freshnessProfile: "chain:near-realtime",
    },
    transport,
  );
}

/**
 * Heurist DeFi agents (DefiLlama, L2Beat) — DEFI_ANALYSIS providers: protocol TVL, fees,
 * revenue, chain metrics, L2 summary/costs. All quantitative tool-normalized observations
 * with DefiLlama/L2Beat lineage (no double-count with market price data).
 */
export function createHeuristDefiLlamaAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["DEFI_ANALYSIS"],
    {
      agentId: "DefiLlamaAgent",
      upstreamSource: "defillama",
      tool: "get_protocol_metrics",
      subjectParam: "protocol",
      // Subjectless DeFi questions ("how much value is locked in DeFi?") fall back to
      // chain-level metrics instead of failing schema validation (VERIFIED LIVE:
      // get_chain_metrics returns chain TVL/fees; zero-dead-end mandate §0/§4).
      defaultSubject: "Ethereum",
      limitations: [
        "protocol slug resolution is heuristic; an unknown slug returns no data rather than a guess",
        "subjectless DeFi questions default to Ethereum chain metrics (TVL/fees), not whole-industry totals",
      ],
      fallbackTool: "get_chain_metrics",
      fallbackToolParams: { chain: "Ethereum" },
      freshnessProfile: "defi:daily",
    },
    transport,
  );
}

/** L2Beat — L2 ecosystem metrics as a second DEFI_ANALYSIS provider (subjectless tools). */
export function createHeuristL2BeatAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["DEFI_ANALYSIS"],
    {
      agentId: "L2BeatAgent",
      upstreamSource: "l2beat",
      tool: "get_l2_summary",
      limitations: ["L2 ecosystem aggregates; per-project depth is bounded to what L2Beat publishes"],
      freshnessProfile: "defi:daily",
    },
    transport,
  );
}

/**
 * Heurist project-research agents (ProjectKnowledge, DexScreener, TrendingToken) —
 * PROJECT_RESEARCH providers: project description/links, DEX pair discovery, trending
 * narrative signals. Descriptions are project-reported facts (secondary), trends are
 * PROXY_EVIDENCE for attention, never for price direction.
 */
export function createHeuristProjectAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["PROJECT_RESEARCH"],
    {
      agentId: "ProjectKnowledgeAgent",
      upstreamSource: "project-knowledge",
      tool: "get_project",
      subjectParam: "name",
      acceptsQuestion: true,
      limitations: [
        "project descriptions are self-reported/project-reported facts, not verified claims",
      ],
      freshnessProfile: "project:descriptor",
    },
    transport,
  );
}

/** DexScreener pair discovery — second PROJECT_RESEARCH provider (market-structure data). */
export function createHeuristDexScreenerAdapter(transport?: HeuristMeshTransport): HeuristAgentAdapter {
  return new HeuristAgentAdapter(
    ["PROJECT_RESEARCH"],
    {
      agentId: "DexScreenerTokenInfoAgent",
      upstreamSource: "dexscreener",
      tool: "search_pairs",
      subjectParam: "search_term",
      acceptsQuestion: false,
      limitations: ["DEX pair data is venue-level; CEX market structure is not covered here"],
      freshnessProfile: "defi:minutes",
    },
    transport,
  );
}

/**
 * Register the extended research tier. Sits at the Heurist priority band (direct keyless
 * providers first); deep-research agents (Caesar/AskHeurist) remain the last tier.
 */
export function registerExtendedHeuristAdapters(registry: import("./capability-registry.js").CapabilityRegistry, priority = 300): void {
  registry.register(createHeuristExaSearchAdapter(), priority);
  registry.register(createHeuristDuckDuckGoAdapter(), priority + 1);
  registry.register(createHeuristEtherscanAdapter(), priority);
  registry.register(createHeuristOnchainAdapter(), priority + 1);
  registry.register(createHeuristDefiLlamaAdapter(), priority);
  registry.register(createHeuristL2BeatAdapter(), priority + 1);
  registry.register(createHeuristProjectAdapter(), priority);
  registry.register(createHeuristDexScreenerAdapter(), priority + 1);
}

/**
 * Register all Heurist adapters at low priority (they serve when direct providers cannot). */
export function registerHeuristAdapters(registry: import("./capability-registry.js").CapabilityRegistry, priority = 300): void {
  registry.register(createHeuristOptionsAdapter(), priority);
  registry.register(createHeuristEarningsAdapter(), priority);
  registry.register(createHeuristTechnicalAdapter(), priority);
  registry.register(createHeuristSecAdapter(), priority);
  registry.register(createHeuristFredAdapter(), priority);
  registry.register(createHeuristFundingRateAdapter(), priority);
  // Deep-research tier (priority +1 = after the specialized agents): synthesis questions the
  // capability chain could not answer get ONE generated-analysis attempt each, clearly labeled.
  registry.register(createHeuristCaesarAdapter(), priority + 1);
  registry.register(createHeuristAskAdapter(), priority + 1);
  registerExtendedHeuristAdapters(registry, priority);
}
