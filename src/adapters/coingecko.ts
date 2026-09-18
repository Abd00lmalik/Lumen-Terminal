/**
 * CoinGecko public crypto market-data fallback (keyless).
 *
 * Why: when Bitget MCP upstreams fail from production (ConnectTimeout on their side), the
 * crypto market-data chain previously had NO market-data fallback (RSS is news, not prices).
 * CoinGecko's public API is keyless, CORS-friendly, production-reachable, and serves the
 * same observation vocabulary (price, 24h change, market cap, volume) for BTC/ETH/any coin.
 *
 * Laws: same as every adapter — registry-resolved (registered BELOW Bitget), provenance
 * preserved (raw capture + timestamps), outputs are QUANTITATIVE_OBSERVATION, retrieval
 * failure is a technical condition never negative evidence, no execution surface.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RestTransport } from "./transports/rest.js";

/** Coin id inference from the question's asset token (e.g. "BTC" -> "bitcoin"). */
const COMMON_COIN_IDS: ReadonlyMap<string, string> = new Map([
  ["BTC", "bitcoin"],
  ["ETH", "ethereum"],
  ["SOL", "solana"],
  ["XRP", "ripple"],
  ["BNB", "binancecoin"],
  ["ADA", "cardano"],
  ["DOGE", "dogecoin"],
  ["AVAX", "avalanche-2"],
  ["LINK", "chainlink"],
  ["DOT", "polkadot"],
  ["MATIC", "matic-network"],
  ["LTC", "litecoin"],
  ["TON", "the-open-network"],
  ["TRX", "tron"],
  ["SHIB", "shiba-inu"],
]);

interface CoinGeckoSimple {
  readonly [id: string]: {
    readonly usd?: number;
    readonly usd_market_cap?: number;
    readonly usd_24h_vol?: number;
    readonly usd_24h_change?: number;
    readonly last_updated_at?: number;
  };
}

function coinIdOf(params: Record<string, unknown>): string | undefined {
  const raw = [params.asset, params.symbol, params.coin].find((v) => typeof v === "string" && v.trim() !== "");
  if (typeof raw !== "string") return undefined;
  const token = raw.trim().toUpperCase().split(/[\s/:\-]/)[0] ?? "";
  return COMMON_COIN_IDS.get(token) ?? token.toLowerCase();
}

export class CoinGeckoMarketDataAdapter implements ProviderAdapter {
  readonly providerId = "fallback/coingecko-market";
  readonly capabilities: readonly CapabilityName[] = ["MARKET_DATA_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "CoinGecko public API: aggregated USD market data, not an exchange-native order-book view",
    "spot price/24h statistics only; no order book, no OHLCV klines from this fallback",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "coingecko:public";

  private readonly rest: RestTransport;

  constructor(rest?: RestTransport) {
    this.rest = rest ?? new RestTransport({ baseUrl: "https://api.coingecko.com", defaultHeaders: { "user-agent": "Mozilla/5.0 (compatible; LumenTerminal/1.0; research read-only)" } });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "MARKET_DATA_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const coinId = coinIdOf(params);
    if (coinId === undefined) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:api.coingecko.com",
        params,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: "no crypto asset resolved for this question; cannot query CoinGecko" }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "SCHEMA_ERROR", message: "missing asset", retriable: false },
        limitations: this.limitations,
      };
    }

    const outcome = await this.rest.get("/api/v3/simple/price", {
      params: { ids: coinId, vs_currencies: "usd", include_market_cap: "true", include_24hr_vol: "true", include_24hr_change: "true", include_last_updated_at: "true" },
    });
    const body = outcome.body as CoinGeckoSimple;
    const entry = body[coinId];
    const price = entry?.usd;
    if (entry === undefined || price === undefined) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:api.coingecko.com",
        params: { ...params, coinId },
        rawReference: outcome.rawReference,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: `CoinGecko returned no market data for ${coinId}` }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: `no data for ${coinId}`, retriable: true },
        limitations: this.limitations,
      };
    }

    const outputs: ToolOutput[] = [
      {
        outputClass: "QUANTITATIVE_OBSERVATION" as const,
        content: {
          coin: coinId,
          priceUsd: price,
          change24hPct: entry.usd_24h_change,
          marketCapUsd: entry.usd_market_cap,
          volume24hUsd: entry.usd_24h_vol,
          asOf: entry.last_updated_at !== undefined ? new Date(entry.last_updated_at * 1000).toISOString() : undefined,
          source: "CoinGecko",
        },
        about: coinId,
      },
    ];
    return {
      tool: this.providerId,
      capability,
      transport: "rest:api.coingecko.com",
      params: { ...params, coinId },
      rawReference: outcome.rawReference,
      outputs,
      completeness: "COMPLETE",
      freshness: "CURRENT",
      validation: "VALID",
      ...(entry.last_updated_at !== undefined ? { sourceTimestamp: new Date(entry.last_updated_at * 1000).toISOString() } : {}),
      limitations: this.limitations,
    };
  }
}
