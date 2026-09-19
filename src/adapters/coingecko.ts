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
  ["ZEC", "zcash"],
  ["XMR", "monero"],
  ["ATOM", "cosmos"],
  ["NEAR", "near"],
  ["APT", "aptos"],
  ["ARB", "arbitrum"],
  ["OP", "optimism"],
  ["SUI", "sui"],
  ["INJ", "injective-protocol"],
  ["FIL", "filecoin"],
  ["ETC", "ethereum-classic"],
  ["BCH", "bitcoin-cash"],
  ["UNI", "uniswap"],
  ["AAVE", "aave"],
  ["PEPE", "pepe"],
  // Full asset names (the LUI may resolve "zcash" rather than the ticker):
  ["ZCASH", "zcash"], ["MONERO", "monero"], ["SOLANA", "solana"], ["RIPPLE", "ripple"],
  ["CARDANO", "cardano"], ["DOGECOIN", "dogecoin"], ["CHAINLINK", "chainlink"], ["POLKADOT", "polkadot"],
  ["LITECOIN", "litecoin"], ["TRON", "tron"], ["AVALANCHE", "avalanche-2"], ["COSMOS", "cosmos"],
  ["UNISWAP", "uniswap"], ["FILECOIN", "filecoin"], ["SHIBAINU", "shiba-inu"], ["STELLAR", "stellar"],
  ["HEDERA", "hedera-hashgraph"], ["ALGORAND", "algorand"], ["VECHAIN", "vechain"], ["BITCOINCASH", "bitcoin-cash"],
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

/** Targets CoinGecko honestly cannot serve (commodities/FX/indexes): quiet no-coverage. */
const NON_CRYPTO_TARGETS: ReadonlySet<string> = new Set(["GOLD", "XAU", "XAUUSD", "SILVER", "XAG", "OIL", "CRUDE", "WTI", "BRENT", "COPPER", "NATGAS", "SPX", "SP500", "NASDAQ", "DOW", "RUSSELL", "VIX", "DXY", "EURUSD", "GBPUSD", "USDJPY", "USDNGN"]);

/**
 * Corporate-ticker shape (AAPL, MSFT, TSLA, NVDA...): equities are NOT crypto assets. The
 * blind `token.toLowerCase()` fallback once resolved "aapl" to an unrelated CoinGecko token
 * and returned its price as the equity's (production-verified garbage). A ticker is treated
 * as a probable equity when it is a 1-5 letter alphabetic token, NOT in the known-coin
 * dictionary, and not a common word-like crypto name (use the dictionary for those).
 */
function looksLikeEquityTicker(token: string): boolean {
  return /^[A-Z]{1,5}$/.test(token) && !COMMON_COIN_IDS.has(token);
}

function coinIdOf(params: Record<string, unknown>): string | undefined {
  const raw = [params.asset, params.symbol, params.coin].find((v) => typeof v === "string" && v.trim() !== "");
  if (typeof raw !== "string") return undefined;
  const token = raw.trim().toUpperCase().split(/[\s/:\-]/)[0] ?? "";
  if (NON_CRYPTO_TARGETS.has(token)) return undefined;
  if (looksLikeEquityTicker(token)) return undefined;
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
      const requested = [params.asset, params.symbol, params.coin].find((v) => typeof v === "string" && (v as string).trim() !== "");
      const requestedToken = typeof requested === "string" ? (requested.trim().toUpperCase().split(/[\s/:\-]/)[0] ?? "") : "";
      const notCrypto = requestedToken !== "" && (NON_CRYPTO_TARGETS.has(requestedToken) || looksLikeEquityTicker(requestedToken));
      return {
        tool: this.providerId,
        capability,
        transport: "none",
        params,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: notCrypto
          ? `${requested} is not a crypto asset; CoinGecko market data does not cover it`
          : "no crypto asset resolved for this question; cannot query CoinGecko" }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: notCrypto ? `capability not applicable to ${requested}` : "missing asset", retriable: false },
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
