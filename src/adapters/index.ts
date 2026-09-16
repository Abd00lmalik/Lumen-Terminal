/** Adapter layer exports — the only surface the research engine and tests need. */

export { CapabilityRegistry, HistoricalDataStub, WebRetrievalStub, NotConnectedError, type ProviderAdapter, type CapabilityName, type Registration, type HistoricalQuery, type HistoricalDataProvider, type WebQuery, type WebRetrievalProvider, type RetrievedSource } from "./capability-registry.js";

export { BitgetSkillAdapter, type SkillDescriptor, type OutputMapping, type McpToolSpec, type BitgetSkillAdapterOptions } from "./bitget-skill-adapter.js";

export {
  MACRO_ANALYST,
  MARKET_INTEL,
  SENTIMENT_ANALYST,
  NEWS_BRIEFING,
  TECHNICAL_ANALYSIS,
  TECHNICAL_REST_PATHS,
  createMacroAnalystAdapter,
  createMarketIntelAdapter,
  createSentimentAnalystAdapter,
  createNewsBriefingAdapter,
  TechnicalAnalysisAdapter,
  createBitgetAdapterSet,
  type TechnicalQuery,
  type BitgetAdapterSetOptions,
} from "./bitget-skills.js";

export { McpTransport, McpJsonRpcError, DEFAULT_MCP_ENDPOINT, type McpTransportOptions, type McpCallOutcome } from "./transports/mcp.js";
export { RestTransport, DEFAULT_REST_BASE_URL, type RestTransportOptions, type RestGetOptions, type RestGetOutcome, type Candle } from "./transports/rest.js";
export {
  Throttler,
  withRetry,
  TransportError,
  RetryExhaustedError,
  RawCapture,
  isTransientFailure,
  classifyHttpFailure,
  timeoutError,
  DEFAULT_RETRY_POLICY,
  type TransportFailureType,
  type ThrottlerOptions,
  type RetryPolicy,
  type RetryOptions,
} from "./transports/resilience.js";
export { FRESHNESS_PROFILES, assessFreshness, freshnessLimitations, type FreshnessProfile, type FreshnessVerdict, type ProfileKey } from "./freshness.js";
