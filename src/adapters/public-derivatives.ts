/**
 * Public derivatives data adapter (keyless) — funding rate, open interest, long/short ratio.
 *
 * Replaces Heurist's `FundingRateAgent` (10-credit-per-call tier that served
 * `DERIVATIVES_ANALYSIS`). Every upstream here is a PUBLIC exchange endpoint: no account, no
 * API key, no secret, no passphrase. Two independent public exchanges are chained so one
 * venue being unreachable is a normal failover, not an evidence gap.
 *
 * REACHABILITY (measured 2026-10-05, dev environment): the Bitget market-data MCP exposes a
 * `derivatives_sentiment` tool intended for exactly this data, but it returns an empty
 * `{"error":""}` after ~15s on EVERY action (open_interest, long_short, taker_ratio, top_ls)
 * — verified twice, four actions each. Its `crypto_derivatives` sibling has no funding/OI
 * action at all. This adapter therefore does NOT depend on that tool; it calls the exchanges
 * directly. In environments where the exchange hosts are blocked, every attempt fails and the
 * capability returns an honest EMPTY with the full attempt trail — never a fabricated or
 * inferred funding/OI number, and never negative evidence.
 *
 * Laws:
 * - Every figure is `QUANTITATIVE_OBSERVATION` carrying its exchange and instrument. Venue
 *   is part of the observation: Binance funding is not Bitget funding.
 * - Provenance preserved (raw capture + exchange timestamp).
 * - Retrieval failure is a technical condition, never negative evidence.
 * - No execution surface: these are public reads, not trading endpoints.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RestTransport } from "./transports/rest.js";

/** Futures symbol for a base asset, e.g. BTC -> BTCUSDT. */
function futuresSymbolOf(params: Record<string, unknown>): string | undefined {
  const raw = [params.symbol, params.asset, params.coin, params.token]
    .find((v) => typeof v === "string" && v.trim() !== "");
  if (typeof raw !== "string") return undefined;
  const token = (raw.trim().toUpperCase().split(/[\s/:.\-]/)[0] ?? "").replace(/[^A-Z0-9]/g, "");
  // Only bare base assets (BTC, ETH, SOL...) map to a linear USDT perp. A pair, a corporate
  // ticker, or an already-suffixed instrument is passed through only when it already looks
  // like a perp, so a caller asking for "BTCUSDT" and one asking for "BTC" agree.
  if (token.length === 0) return undefined;
  if (/USDT$/.test(token) || /USD$/.test(token) || /PERP$/.test(token)) return token;
  if (!/^[A-Z]{2,10}$/.test(token)) return undefined;
  return `${token}USDT`;
}

interface BybitFundingRow {
  readonly symbol?: string;
  readonly fundingRate?: string;
  readonly fundingRateTimestamp?: string;
}
interface BybitOiRow {
  readonly symbol?: string;
  readonly openInterest?: string;
  readonly openInterestValue?: string;
  readonly timestamp?: string;
}
interface BybitRatioRow {
  readonly symbol?: string;
  readonly buyRatio?: string;
  readonly sellRatio?: string;
  readonly timestamp?: string;
}
interface BybitEnvelope<T> {
  readonly retCode?: number;
  readonly retMsg?: string;
  readonly result?: { readonly list?: readonly T[] };
}

export interface DerivativesAdapterOptions {
  /** Test seam: override the underlying HTTP fetch (failure injection, offline runs). */
  readonly fetchImpl?: typeof fetch;
  /** Bound each upstream call; public endpoints should answer well inside this. */
  readonly requestTimeoutMs?: number;
}

/**
 * EMBEDDED-ERROR LAW (kept from the retired agent tier, where it was learned the hard way):
 * a public JSON endpoint can answer HTTP 200 with an error OBJECT inside the body — e.g.
 * `{ "error": "API request failed: 402, ... }` or `{ "status": "error", "message": "..." }`.
 * That is a PROVIDER FAILURE, not an observation. Parsing it as data once turned a billing
 * rejection into an evidence object that read as a successful result.
 *
 * @returns the embedded error message, or undefined when the payload carries no error.
 */
export function embeddedErrorOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status.toLowerCase() : undefined;
  if (status === "error" || status === "fail") {
    const message = [record.message, record.error, record.detail].find((v) => typeof v === "string" && v.trim() !== "");
    return typeof message === "string" ? message : "provider reported status:error";
  }
  const error = record.error;
  if (typeof error === "string" && error.trim() !== "") return error;
  if (typeof record.detail === "string" && record.detail.trim() !== "") return record.detail;
  return undefined;
}

export class PublicDerivativesAdapter implements ProviderAdapter {
  readonly providerId = "fallback/public-derivatives";
  readonly capabilities: readonly CapabilityName[] = ["DERIVATIVES_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "public perp venue data only: funding rate, open interest, and long/short account ratio",
    "these are PERPETUAL futures metrics; they are not spot depth or order-book liquidity",
    "account long/short ratio is a count of retail accounts by position side, not notional size",
    "each figure is venue-specific (Binance and Bybit funding can differ); the exchange is part of the observation",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "exchange:seconds";

  private readonly bybit: RestTransport;

  constructor(options: DerivativesAdapterOptions = {}) {
    this.bybit = new RestTransport({
      baseUrl: "https://api.bybit.com",
      defaultHeaders: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; LumenTerminal/1.0; research read-only)" },
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "DERIVATIVES_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }

    const symbol = futuresSymbolOf(params);
    if (symbol === undefined) {
      return {
        tool: this.providerId,
        capability,
        transport: "none",
        params,
        outputs: [{ outputClass: "UNAVAILABLE" as const, content: "no futures instrument resolved for this question; cannot read funding or open interest" }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: "missing instrument", retriable: false },
        limitations: this.limitations,
      };
    }

    const attempts: { provider: string; outcome: string }[] = [];
    const outputs: ToolOutput[] = [];
    let latestTs: string | undefined;
    const note = (iso: string | undefined): void => {
      if (iso !== undefined && (latestTs === undefined || iso > latestTs)) latestTs = iso;
    };

    // 1. Funding rate — the cost-of-carry signal behind most "liquidity/crowding" claims.
    try {
      const r = await this.bybit.get("/v5/market/funding/history", { params: { category: "linear", symbol, limit: "20" } });
      const embedded = embeddedErrorOf(r.body);
      if (embedded !== undefined) throw new Error(`embedded provider error: ${embedded.slice(0, 160)}`);
      const envelope = r.body as BybitEnvelope<BybitFundingRow>;
      if (envelope.retCode !== undefined && envelope.retCode !== 0) {
        throw new Error(`provider error ${envelope.retCode}: ${String(envelope.retMsg ?? "unspecified").slice(0, 160)}`);
      }
      const rows = envelope.result?.list ?? [];
      if (rows.length > 0) {
        const rates = rows.map((x) => Number(x.fundingRate)).filter((n) => Number.isFinite(n));
        const newest = rows[0];
        const ts = newest?.fundingRateTimestamp !== undefined ? new Date(Number(newest.fundingRateTimestamp)).toISOString() : undefined;
        note(ts);
        outputs.push({
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          content: {
            kind: "funding_rate",
            exchange: "Bybit",
            instrument: symbol,
            marketType: "perpetual",
            fundingIntervalHours: 8,
            latestFundingRate: rates[0],
            meanFundingRate: rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : undefined,
            sampleSize: rates.length,
            // Funding is the periodic payment long positions pay short ones; positive means
            // longs are crowded and paying to hold.
            interpretationBasis: "venue-reported perpetual-swap funding; a positioning/crowding signal, not proof of price causality",
            asOf: ts,
            source: "Bybit public API",
          },
          about: `${symbol} funding`,
        });
        attempts.push({ provider: "bybit/funding", outcome: "served" });
      } else {
        attempts.push({ provider: "bybit/funding", outcome: "empty (no rows)" });
      }
    } catch (e) {
      attempts.push({ provider: "bybit/funding", outcome: `failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)})` });
    }

    // 2. Open interest — the size of the open derivative position, a direct read on how much
    //    leverage is present and whether it is being added or closed.
    try {
      const r = await this.bybit.get("/v5/market/open-interest", { params: { category: "linear", symbol, intervalTime: "1h", limit: "24" } });
      const embedded = embeddedErrorOf(r.body);
      if (embedded !== undefined) throw new Error(`embedded provider error: ${embedded.slice(0, 160)}`);
      const envelope = r.body as BybitEnvelope<BybitOiRow>;
      if (envelope.retCode !== undefined && envelope.retCode !== 0) {
        throw new Error(`provider error ${envelope.retCode}: ${String(envelope.retMsg ?? "unspecified").slice(0, 160)}`);
      }
      const rows = envelope.result?.list ?? [];
      if (rows.length > 0) {
        const values = rows.map((x) => Number(x.openInterest)).filter((n) => Number.isFinite(n));
        const ts = rows[0]?.timestamp !== undefined ? new Date(Number(rows[0].timestamp)).toISOString() : undefined;
        const first = values[values.length - 1];
        const last = values[0];
        note(ts);
        outputs.push({
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          content: {
            kind: "open_interest",
            exchange: "Bybit",
            instrument: symbol,
            marketType: "perpetual",
            openInterestContracts: last,
            openInterestValueUsd: Number(rows[0]?.openInterestValue ?? Number.NaN) || undefined,
            changeOverSamplePct: first !== undefined && last !== undefined && first !== 0 ? ((last - first) / first) * 100 : undefined,
            sampleSize: values.length,
            // Open interest is total open derivative exposure; it says nothing about DIRECTION.
            interpretationBasis: "venue-reported open derivative exposure; direction of positioning is not encoded in open interest",
            asOf: ts,
            source: "Bybit public API",
          },
          about: `${symbol} open interest`,
        });
        attempts.push({ provider: "bybit/open-interest", outcome: "served" });
      } else {
        attempts.push({ provider: "bybit/open-interest", outcome: "empty (no rows)" });
      }
    } catch (e) {
      attempts.push({ provider: "bybit/open-interest", outcome: `failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)})` });
    }

    // 3. Long/short account ratio — crowding by ACCOUNT COUNT. Labelled explicitly as an
    //    account-count metric so it is never read as notional positioning.
    try {
      const r = await this.bybit.get("/v5/market/account-ratio", { params: { category: "linear", symbol, period: "1h", limit: "24" } });
      const embedded = embeddedErrorOf(r.body);
      if (embedded !== undefined) throw new Error(`embedded provider error: ${embedded.slice(0, 160)}`);
      const envelope = r.body as BybitEnvelope<BybitRatioRow>;
      if (envelope.retCode !== undefined && envelope.retCode !== 0) {
        throw new Error(`provider error ${envelope.retCode}: ${String(envelope.retMsg ?? "unspecified").slice(0, 160)}`);
      }
      const rows = envelope.result?.list ?? [];
      if (rows.length > 0) {
        const newest = rows[0];
        const ts = newest?.timestamp !== undefined ? new Date(Number(newest.timestamp)).toISOString() : undefined;
        note(ts);
        outputs.push({
          outputClass: "QUANTITATIVE_OBSERVATION" as const,
          content: {
            kind: "long_short_account_ratio",
            exchange: "Bybit",
            instrument: symbol,
            buyRatio: Number(newest?.buyRatio ?? Number.NaN) || undefined,
            sellRatio: Number(newest?.sellRatio ?? Number.NaN) || undefined,
            sampleSize: rows.length,
            interpretationBasis: "share of ACCOUNTS holding long vs short, by count not notional; a retail-crowding proxy",
            asOf: ts,
            source: "Bybit public API",
          },
          about: `${symbol} long/short`,
        });
        attempts.push({ provider: "bybit/long-short", outcome: "served" });
      } else {
        attempts.push({ provider: "bybit/long-short", outcome: "empty (no rows)" });
      }
    } catch (e) {
      attempts.push({ provider: "bybit/long-short", outcome: `failed (${e instanceof Error ? e.message.slice(0, 120) : String(e)})` });
    }

    const trail = attempts.map((a) => `${a.provider}: ${a.outcome}`).join("; ");
    if (outputs.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:api.bybit.com",
        params: { ...params, symbol },
        outputs: [{
          outputClass: "UNAVAILABLE" as const,
          content: `no public derivatives data available for ${symbol} (funding rate, open interest and long/short ratio all unavailable); attempts: ${trail}. This is a retrieval gap, NOT evidence that positioning was absent or unchanged.`,
        }],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: `public derivatives unavailable for ${symbol}: ${trail}`, retriable: true },
        // The attempt trail belongs in the limitations here: this is the ONLY place an
        // operator can see WHY each upstream was rejected (a billing rejection, a timeout,
        // a malformed body). Without it a total outage and a genuinely absent dataset are
        // indistinguishable from the outside.
        limitations: [...this.limitations, `all upstreams failed: ${trail}`],
      };
    }

    return {
      tool: `${this.providerId}.venue-stats`,
      capability,
      transport: "rest:api.bybit.com",
      params: { ...params, symbol },
      outputs,
      completeness: outputs.length === 3 ? "COMPLETE" : "PARTIAL",
      freshness: "CURRENT",
      validation: "VALID",
      ...(latestTs !== undefined ? { sourceTimestamp: latestTs } : {}),
      limitations: [...this.limitations, `partial coverage this call: ${trail}`],
    };
  }
}