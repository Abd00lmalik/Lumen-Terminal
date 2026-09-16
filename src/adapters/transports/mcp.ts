/**
 * Bitget public market-data MCP transport.
 *
 * Architectural basis:
 * - FINDINGS.md §1/§2: the five research skills are backed by one shared public market-data MCP
 *   service (HTTP), no auth, no cost. Exposed tools (live-verified 2026-09-13): crypto_market,
 *   defi_analytics, dex_market, sentiment_index, tradfi_news, crypto_price, social_trending,
 *   network_status, derivatives_sentiment, global_data, news_feed, cn_market, global_assets,
 *   crypto_derivatives, technical_analysis, backtest, macro_indicators, rates_yields, cross_asset.
 * - Final lock §7: every invocation must produce a normalized TOOL_RESULT preserving transport
 *   identity, invocation parameters, timestamps, raw reference, completeness, failure state.
 * - failure-recovery.md §12–15: bounded retries with backoff; provider substitution happens at
 *   the registry, not inside the transport.
 *
 * DISCOVERED (live, 2026-09-13; M2 validation, supersedes the M1 assumption of stateless calls):
 * - The endpoint implements streamable-HTTP MCP **with sessions**. A bare `tools/call` returns
 *   HTTP 400 / JSON-RPC -32600 "Bad Request: Missing session ID".
 * - Handshake: POST `initialize` → response header `mcp-session-id` → POST
 *   `notifications/initialized` (202, empty body) → subsequent `tools/call` with the
 *   `mcp-session-id` header.
 * - `initialize` responds as `text/event-stream` (SSE-framed JSON) even for plain JSON requests;
 *   tools/list + tools/call respond as plain JSON. Both framings are tolerated by parsePayload.
 * - Session loss / expiry is treated as transient (PROVIDER_ERROR): the transport re-handshakes
 *   and replays the call once per attempt.
 *
 * This boundary stays deliberately small: callTool + raw capture + resilience. If the official
 * SDK is adopted later, it replaces the internals; the adapter-facing surface does not change.
 */

import {
  Throttler,
  withRetry,
  TransportError,
  RetryExhaustedError,
  timeoutError,
  classifyHttpFailure,
  RawCapture,
  type RetryPolicy,
  type RetryOptions,
  type ThrottlerOptions,
} from "./resilience.js";

export const DEFAULT_MCP_ENDPOINT = "https://datahub.noxiaohao.com/mcp";

/** Live-verified server identity (2026-09-13): serverInfo from `initialize`. */
export const DISCOVERED_SERVER_INFO = { name: "market-data-mcp", version: "1.26.0", protocolVersion: "2025-03-26" };

export interface McpTransportOptions {
  readonly endpoint?: string;
  readonly retryPolicy?: RetryPolicy;
  readonly throttler?: ThrottlerOptions;
  readonly retryOptions?: Pick<RetryOptions, "now" | "sleep" | "onRetry">;
  readonly requestTimeoutMs?: number;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /** Test seam: override the underlying HTTP fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** JSON-RPC error payload when the server rejects the call. */
export class McpJsonRpcError extends TransportError {
  constructor(message: string, retriable: boolean) {
    super("PROVIDER_ERROR", message, { retriable });
    this.name = "McpJsonRpcError";
  }
}

export interface McpCallOutcome {
  /** Tool-provided content blocks (text first for our skills' text outputs). */
  readonly content: readonly unknown[];
  readonly isError: boolean;
  readonly rawReference: string;
  /** Attempts actually made (1 = no retry engaged); provenance for the TOOL_RESULT. */
  readonly attempts?: number;
  readonly durationMs?: number;
  /** Live provenance: server identity reported during initialize (when observed). */
  readonly serverInfo?: { readonly name: string; readonly version: string; readonly protocolVersion: string };
}

interface McpFetchOutcome {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly text: string;
}

interface JsonRpcResult {
  result?: { content?: unknown[]; isError?: boolean };
  error?: { code?: number; message?: string };
}

export class McpTransport {
  private readonly endpoint: string;
  private readonly retryPolicy: RetryPolicy;
  private readonly throttler: Throttler;
  private readonly retryOptions: Pick<RetryOptions, "now" | "sleep" | "onRetry">;
  private readonly requestTimeoutMs: number;
  private readonly clientInfo: { readonly name: string; readonly version: string };
  private readonly fetchImpl: typeof fetch;
  /** JSON-RPC id monotonic per transport. */
  private nextId = 0;
  /** Session state; established lazily on first call, re-established when the server drops it. */
  private sessionId: string | undefined;
  private serverInfo: McpCallOutcome["serverInfo"];

  readonly rawCapture: RawCapture;

  constructor(options: McpTransportOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_MCP_ENDPOINT;
    this.retryPolicy = options.retryPolicy ?? { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 4_000, honorRetryAfter: true };
    this.throttler = new Throttler(options.throttler ?? { minIntervalMs: 150 });
    this.retryOptions = options.retryOptions ?? {};
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.clientInfo = options.clientInfo ?? { name: "trading-research-workbench", version: "0.1.0" };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.rawCapture = new RawCapture();
  }

  /**
   * Invoke one MCP tool (`tools/call`). Establishes/reuses the MCP session transparently
   * (DISCOVERED: the endpoint requires initialize → mcp-session-id → notifications/initialized).
   * Failures throw typed TransportErrors; adapters convert them into failed TOOL_RESULTs
   * they never fabricate outputs (final lock §18).
   */
  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<McpCallOutcome> {
    const startedAt = Date.now();
    let attempts = 0;
    return this.throttler.run(async () => {
      try {
        const outcome = await withRetry(async (attempt) => {
          attempts = attempt;
          return this.callWithSession(toolName, args);
        }, { policy: this.retryPolicy, ...this.retryOptions });
        return { ...outcome, attempts, durationMs: Date.now() - startedAt };
      } catch (error) {
        if (error instanceof RetryExhaustedError) {
          throw error.lastError; // adapters classify; attempts already counted
        }
        throw error;
      }
    });
  }

  /** Server identity observed during the live handshake (provenance; undefined pre-connect). */
  get connectedServerInfo(): McpCallOutcome["serverInfo"] {
    return this.serverInfo;
  }

  private async callWithSession(toolName: string, args: Record<string, unknown>): Promise<McpCallOutcome> {
    if (this.sessionId === undefined) {
      await this.initializeSession();
    }
    try {
      return await this.callOnce(toolName, args);
    } catch (error) {
      // A missing/expired session surfaces as HTTP 400 "Missing session ID" (DISCOVERED).
      // Treat it as transient transport state: reset and let the bounded retry re-handshake.
      if (error instanceof TransportError && /missing session/i.test(error.message)) {
        this.sessionId = undefined;
        throw new TransportError("PROVIDER_ERROR", `MCP session rejected during ${toolName} call; will re-handshake: ${error.message}`, { retriable: true });
      }
      throw error;
    }
  }

  /** One full handshake: initialize → mcp-session-id header → notifications/initialized (202, empty). */
  private async initializeSession(): Promise<void> {
    const id = ++this.nextId;
    const response = await this.post(undefined, {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: this.clientInfo },
    });
    const rawReference = this.rawCapture.capture("mcp", `initialize@${this.endpoint}`, response.text);
    if (response.status !== 200) {
      throw classifyHttpFailure(response.status, response.text, response.headers["retry-after"]);
    }
    const parsed = this.parsePayload(response.text, "initialize");
    // initialize results carry protocolVersion/serverInfo directly under `result` (live-verified).
    const initResult = (parsed.result ?? {}) as {
      protocolVersion?: string;
      serverInfo?: { name?: string; version?: string };
    };
    if (initResult.serverInfo === undefined) {
      throw new TransportError("INVALID_RESPONSE", `MCP initialize returned no server info (raw: ${rawReference})`, { retriable: false });
    }
    const sessionId = response.headers["mcp-session-id"];
    if (sessionId === undefined) {
      throw new TransportError("INVALID_RESPONSE", "MCP initialize response carried no mcp-session-id header", { retriable: false });
    }
    this.serverInfo = {
      name: initResult.serverInfo.name ?? "unknown",
      version: initResult.serverInfo.version ?? "unknown",
      protocolVersion: initResult.protocolVersion ?? "unknown",
    };

    this.sessionId = sessionId;
    // Mandatory completion of the handshake (DISCOVERED: 202 with an empty body).
    const notified = await this.post(sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
    if (notified.status !== 202 && notified.status !== 200) {
      this.sessionId = undefined;
      throw classifyHttpFailure(notified.status, notified.text, notified.headers["retry-after"]);
    }
  }

  private async callOnce(toolName: string, args: Record<string, unknown>): Promise<McpCallOutcome> {
    const id = ++this.nextId;
    const response = await this.post(this.sessionId, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    });

    if (response.status !== 200) {
      // Capture the raw rejection before classifying: provenance must stay inspectable (lock §7).
      this.rawCapture.capture("mcp", `tools/call:${toolName}@${this.endpoint}`, response.text);
      throw classifyHttpFailure(response.status, response.text, response.headers["retry-after"]);
    }

    const parsed = this.parsePayload(response.text, toolName);
    const rawReference = this.rawCapture.capture("mcp", `${toolName}@${this.endpoint}`, response.text);

    if (parsed.error !== undefined) {
      const code = parsed.error.code ?? -32603;
      // Retry server/transport-level JSON-RPC errors (-32xxx); method errors (method not found,
      // invalid params) are permanent for this request. Message already carries the code.
      const retriable = code <= -32000 && code >= -32099;
      throw new McpJsonRpcError(`${parsed.error.message ?? "unknown JSON-RPC error"} (jsonrpc code ${code})`, retriable);
    }
    if (parsed.result === undefined) {
      throw new TransportError("SCHEMA_ERROR", `MCP response for ${toolName} has no result`, { retriable: false });
    }
    if (parsed.result.isError === true) {
      // Tool-level error. FINDINGS.md documents neutral per-source failures; transient for our
      // skills; bounded retry decides, and adapters never fabricate over failures (lock §18).
      throw new TransportError("PROVIDER_ERROR", `MCP tool ${toolName} reported isError: ${summarizeContent(parsed.result.content ?? [])}`, { retriable: true });
    }

    return {
      content: parsed.result.content ?? [],
      isError: false,
      rawReference,
      ...(this.serverInfo !== undefined ? { serverInfo: this.serverInfo } : {}),
    };
  }

  private async post(sessionId: string | undefined, body: unknown): Promise<McpFetchOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(sessionId !== undefined ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(`MCP request ${this.endpoint}`, this.requestTimeoutMs);
      throw new TransportError("PROVIDER_ERROR", `network error calling MCP endpoint: ${error instanceof Error ? error.message : String(error)}`, { retriable: true });
    } finally {
      clearTimeout(timeout);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    return { status: response.status, headers, text: await response.text() };
  }

  private parsePayload(text: string, toolName: string): JsonRpcResult & { content?: readonly unknown[]; isError?: boolean } {
    if (text.trim() === "") return {};
    const json = this.parseJsonOrSse(text, toolName);
    return json as JsonRpcResult & { content?: readonly unknown[]; isError?: boolean };
  }

  private parseJsonOrSse(text: string, toolName: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      // Streamable-HTTP MCP may respond as SSE; extract the `data:` JSON payload(s) if so.
      const sseData = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (sseData) {
        try {
          return JSON.parse(sseData);
        } catch {
          throw new TransportError("INVALID_RESPONSE", `MCP response for ${toolName} is neither JSON nor SSE-JSON`, { retriable: false });
        }
      }
      throw new TransportError("INVALID_RESPONSE", `MCP response for ${toolName} is not valid JSON`, { retriable: false });
    }
  }

  /** Introspection for tests. */
  get capturedRawCount(): number {
    return this.rawCapture.size;
  }

  /** Test/introspection seam: current session id (undefined until first handshake). */
  get currentSessionId(): string | undefined {
    return this.sessionId;
  }
}

function summarizeContent(content: readonly unknown[]): string {
  const first = content[0];
  if (first && typeof first === "object" && "text" in (first as Record<string, unknown>)) {
    return String((first as Record<string, unknown>).text);
  }
  return JSON.stringify(content);
}
