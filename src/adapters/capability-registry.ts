/**
 * Capability registry; the capability-first seam between the research engine and providers.
 *
 * Architectural basis:
 * - tool-skill-orchestration.md §2.1 capability-before-tool, §4 TOOL model, §8 selection ranking,
 *   §23 capability substitution, §36 tool relationship graph.
 * - Final lock §6: provider-independent capability layer; Bitget-specific logic lives in adapters;
 *   the engine asks "what capability do I need?", never "which Bitget tool should I call?".
 * - Final lock §18: hardcoded Flow→Tool mappings are forbidden. This registry therefore has no
 *   flow keys; flows (M2) declare capability requirements, the registry resolves providers.
 * - Final lock §4: G1 (historical data) and G2 (web retrieval) are interfaces + stubs until a
 *   vendor is selected. No invented data. On-chain gets no dedicated provider (lock §5).
 */

import type { ProvenanceOrigin } from "../domain/provenance.js";
import type { ToolResult, ToolResultInput } from "../domain/tool-result.js";
import { normalizedResult } from "../domain/tool-result.js";

/** Capability names come from the architecture's CAPABILITY list (tool-skill-orchestration.md §3). */
export type CapabilityName =
  | "EVENT_RECONSTRUCTION"
  | "CAUSAL_INVESTIGATION"
  | "NEWS_ANALYSIS"
  | "MACRO_ANALYSIS"
  | "SENTIMENT_ANALYSIS"
  | "TECHNICAL_ANALYSIS"
  | "MARKET_DATA_ANALYSIS"
  | "ONCHAIN_ANALYSIS"
  | "HISTORICAL_COMPARISON"
  | "SOURCE_VALIDATION"
  | "FALSIFICATION"
  | "DERIVATIVES_ANALYSIS"
  | "CROSS_DOMAIN_SYNTHESIS"
  | (string & {}); // extensible; new capabilities register without engine changes

/**
 * The one interface every provider adapter satisfies. Adapters own transport, auth, throttling,
 * normalization, and classification; the engine never sees provider specifics.
 */
export interface ProviderAdapter {
  readonly providerId: string; // e.g. "bitget-signal/news-briefing"
  readonly capabilities: readonly CapabilityName[];
  /** Human-readable limitations preserved into TOOL_RESULT.limitations (e.g. RSS 15–60min lag). */
  readonly limitations: readonly string[];
  /** Freshness profile, e.g. "rss:15-60min", "economic-release:1-2d-lag". */
  readonly freshnessProfile: string;
  execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput>;
}

export interface Registration {
  readonly adapter: ProviderAdapter;
  readonly priority: number; // lower = preferred on ties
}

export class CapabilityRegistry {
  private readonly byCapability = new Map<CapabilityName, Registration[]>();

  register(adapter: ProviderAdapter, priority = 100): void {
    for (const capability of adapter.capabilities) {
      const list = this.byCapability.get(capability) ?? [];
      list.push({ adapter, priority });
      list.sort((a, b) => a.priority - b.priority);
      this.byCapability.set(capability, list);
    }
  }

  /** All providers able to satisfy a capability, ranked. Selection may pick any; ranking is a hint, not a rule (orchestration §8: highest-ranked is not always selected). */
  resolve(capability: CapabilityName): readonly Registration[] {
    return this.byCapability.get(capability) ?? [];
  }

  /** Execute with automatic fallback to the next provider on failure (orchestration §21–23). */
  async execute(
    capability: CapabilityName,
    params: Record<string, unknown>,
    origin: ProvenanceOrigin,
    at = new Date(),
  ): Promise<ToolResult> {
    const candidates = this.resolve(capability);
    if (candidates.length === 0) {
      return normalizedResult(
        {
          tool: "capability-registry",
          capability,
          transport: "none",
          params,
          completeness: "EMPTY",
          validation: "VALID",
          failure: { type: "UNAVAILABLE", message: `no provider registered for capability ${capability}`, retriable: false },
          limitations: [`no provider registered for capability ${capability}`],
        },
        origin,
        at,
      );
    }

    let lastFailure: ToolResult | undefined;
    /** Fallback audit trail: every non-serving provider attempt, preserved on the winner. */
    const attempts: { provider: string; outcome: string; failureType?: ToolResult["failure"]["type"] }[] = [];
    for (const { adapter } of candidates) {
      try {
        const input = await adapter.execute(capability, params);
        // Fallback law (provider-failover policy): a serving fallback must not erase the
        // primary's failure. attemptedProviders carries the machine-readable trail; the
        // limitation makes it surfaceable ("continued using [fallback]").
        const servedAfterAttempts = attempts.length > 0;
        const trailText = attempts.map((a) => `${a.provider}: ${a.outcome}`).join("; ");
        const result = normalizedResult(
          {
            ...input,
            capability,
            limitations: [
              ...adapter.limitations,
              ...(input.limitations ?? []),
              ...(servedAfterAttempts ? [`provider fallback: ${trailText}; research continued using ${adapter.providerId}`] : []),
            ],
            ...(servedAfterAttempts ? { attemptedProviders: [...attempts] } : {}),
          },
          origin,
          at,
        );
        // Fallback law (provider-failover policy §4): a candidate "serves" only when it
        // provides actual coverage; at least one output that is not an UNAVAILABLE
        // diagnostic. NONE + empty coverage is INSUFFICIENT COVERAGE, not success: the
        // next provider gets a chance, and the empty result is preserved as lastFailure
        // so an all-empty outcome stays an honest EMPTY (never fabricated evidence).
        const hasCoverage = result.normalizedOutput.some((o) => o.outputClass !== "UNAVAILABLE");
        if (result.failure.type === "NONE" && hasCoverage) return result;
        attempts.push({
          provider: adapter.providerId,
          outcome:
            result.failure.type === "NONE"
              ? "empty (no coverage)"
              : `failed (${result.failure.type})`,
          ...(result.failure.type !== "NONE" ? { failureType: result.failure.type } : {}),
        });
        lastFailure = result;
      } catch (error) {
        attempts.push({ provider: adapter.providerId, outcome: "threw" });
        lastFailure = normalizedResult(
          {
            tool: adapter.providerId,
            capability,
            transport: "adapter",
            params,
            completeness: "EMPTY",
            validation: "VALID",
            failure: {
              type: "PROVIDER_ERROR",
              message: error instanceof Error ? error.message : String(error),
              retriable: true,
            },
            limitations: [...adapter.limitations],
          },
          origin,
          at,
        );
      }
    }
    return lastFailure!;
  }
}

// ---------------------------------------------------------------------------
// G1; Historical market data: interface + stub. Vendor NOT selected (lock §4).
// ---------------------------------------------------------------------------

export class NotConnectedError extends Error {
  constructor(providerId: string) {
    super(`${providerId} is not connected: no vendor has been selected yet (final lock §4; dependency documented in IMPLEMENTATION_PLAN.md §11). Do not fabricate data.`);
    this.name = "NotConnectedError";
  }
}

export interface HistoricalQuery {
  symbol: string;
  metric: "ohlcv" | "funding" | "open_interest" | "liquidations";
  from: string; // ISO date
  to: string; // ISO date
  interval?: string;
}

export interface HistoricalDataProvider extends ProviderAdapter {
  query(query: HistoricalQuery): Promise<ToolResultInput>;
}

export class HistoricalDataStub implements HistoricalDataProvider {
  readonly providerId = "stub/historical-data";
  readonly capabilities = ["HISTORICAL_COMPARISON"] as const;
  readonly limitations = [
    "G1 historical-data vendor not yet selected (final lock §4)",
    "must not fabricate historical data",
  ];
  readonly freshnessProfile = "historical:stable";

  async execute(): Promise<ToolResultInput> {
    throw new NotConnectedError(this.providerId);
  }

  async query(): Promise<ToolResultInput> {
    throw new NotConnectedError(this.providerId);
  }
}

// ---------------------------------------------------------------------------
// G2; Web / primary-source retrieval: interface + stub. Vendor NOT selected (lock §4).
// Pipeline: DISCOVER → RETRIEVE → VALIDATE → EXTRACT → SOURCE → EVIDENCE (lock §4).
// ---------------------------------------------------------------------------

export interface WebQuery {
  intent: "DISCOVER" | "RETRIEVE";
  query?: string; // DISCOVER
  url?: string; // RETRIEVE
}

export interface RetrievedSource {
  url: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  retrievedAt: string;
  contentReference: string; // reference to retrieved content; snippets are not authoritative evidence
  sourceClass: string; // e.g. "primary/official-announcement", "secondary/news-report"
}

export interface WebRetrievalProvider extends ProviderAdapter {
  discover(query: string): Promise<readonly RetrievedSource[]>;
  retrieve(url: string): Promise<RetrievedSource>;
}

export class WebRetrievalStub implements WebRetrievalProvider {
  readonly providerId = "stub/web-retrieval";
  readonly capabilities = ["SOURCE_VALIDATION"] as const;
  readonly limitations = [
    "G2 web-retrieval vendor not yet selected (final lock §4)",
    "search snippets must not be treated as authoritative evidence",
  ];
  readonly freshnessProfile = "web:retrieval-time";

  async execute(): Promise<ToolResultInput> {
    throw new NotConnectedError(this.providerId);
  }

  async discover(): Promise<readonly RetrievedSource[]> {
    throw new NotConnectedError(this.providerId);
  }

  async retrieve(): Promise<RetrievedSource> {
    throw new NotConnectedError(this.providerId);
  }
}
