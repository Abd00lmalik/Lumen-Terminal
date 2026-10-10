/**
 * SEC EDGAR public filings adapter (keyless).
 *
 * Replaces Heurist's `SecEdgarAgent`, which served `SOURCE_VALIDATION` through the paid Mesh
 * agent tier. EDGAR needs no account, no API key and no secret: SEC's public REST endpoints
 * require only an identifying `User-Agent` (SEC access policy). VERIFIED LIVE 2026-10-05:
 * `https://www.sec.gov/files/company_tickers.json`, `https://data.sec.gov/submissions/CIK….json`
 * and the full-text search endpoint all answer HTTP 200 from the dev environment with real
 * data, so this replacement is genuinely available where the Bitget MCP surface has no
 * equivalent (Bitget exposes no SEC surface at all).
 *
 * Laws (identical to every adapter in this layer):
 * - Registry owns selection: no flow ever names EDGAR; this registers the capability.
 * - PRIMARY_SOURCE only when a real filing URL/identifier is captured. EDGAR's own narrative
 *   is not primary; the filing it points at is. A reference we could not resolve is never
 *   upgraded by the model that asked for it.
 * - Retrieval failure is a technical condition, never negative evidence.
 * - No execution surface: this returns filed documents, it files nothing.
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RestTransport } from "./transports/rest.js";

/**
 * SEC requires a descriptive User-Agent identifying the requester; anonymous agents are
 * throttled. There is no credential here by design — this adapter is keyless BY LAW, so the
 * value is a contact string, not a secret, and belongs in the open source.
 */
const SEC_USER_AGENT = "LumenTerminal/1.0 (research workbench; contact: research@lumen.local)";

const EDGAR_BASE_URL = "https://www.sec.gov";
const EDGAR_DATA_BASE_URL = "https://data.sec.gov";

/** Minimal shape of `company_tickers.json` (verified live: object keyed by row index). */
interface CompanyTickerFile {
  readonly [index: string]: { readonly cik_str?: number; readonly ticker?: string; readonly title?: string } | undefined;
}

/** Minimal shape of `submissions/CIK….json`; only the fields this adapter reports. */
interface SubmissionsFile {
  readonly cik?: string;
  readonly name?: string;
  readonly tickers?: readonly string[];
  readonly exchanges?: readonly string[];
  readonly sic?: string;
  readonly sicDescription?: string;
  readonly filings?: {
    readonly recent?: {
      readonly accessionNumber?: readonly string[];
      readonly filingDate?: readonly string[];
      readonly form?: readonly string[];
      readonly primaryDocument?: readonly string[];
      readonly reportDate?: readonly string[];
    };
  };
}

/**
 * Crypto base assets that are NOT SEC registrants. `BTC` is a three-letter uppercase token
 * and would otherwise sail through the ticker-shape test and resolve to whatever registrant
 * EDGAR happens to list — the same class of bug the CoinGecko adapter documents (an equity
 * ticker silently resolving to an unrelated token's price). These must never be treated as
 * issuers.
 */
const CRYPTO_ASSETS: ReadonlySet<string> = new Set([
  "BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "DOGE", "AVAX", "LINK", "DOT", "MATIC", "LTC",
  "TON", "TRX", "SHIB", "ZEC", "XMR", "ATOM", "NEAR", "APT", "ARB", "OP", "SUI", "INJ",
  "FIL", "ETC", "BCH", "UNI", "AAVE", "PEPE", "ICP", "HBAR", "VET", "ALGO", "XTZ",
]);

/**
 * The issuer this question is about, resolved to an SEC ticker.
 *
 * An issuer is named by a corporate ticker (AAPL, NVDA). Crypto assets are NOT issuers and
 * must resolve to undefined rather than to a same-shaped token — the same class of mistake
 * the CoinGecko adapter documents, so it is refused here too rather than returning an
 * unrelated company's filings.
 */
function issuerTickerOf(params: Record<string, unknown>): string | undefined {
  const raw = [params.symbol, params.asset, params.ticker, params.issuer]
    .find((v) => typeof v === "string" && v.trim() !== "");
  if (typeof raw !== "string") return undefined;
  const head = raw.trim().toUpperCase().split(/[\s/]+/)[0] ?? "";
  // DERIVATIVE/INDEX/FX FORMS ARE NOT ISSUERS (relevance contract): a futures, index or FX
  // symbol carries a contract/exchange marker (`CL=F`, `^GSPC`, `EURUSD=X`) that denotes an
  // instrument, never a corporate registrant. Stripping that marker turned `CL=F` (crude oil
  // futures) into the ticker `CLF` and resolved it to Cleveland-Cliffs, so an oil question
  // silently acquired an unrelated issuer's SEC filings. Such a symbol resolves to NO issuer.
  if (/[=^:/]/.test(head)) return undefined;
  // A CORPORATE FORM IS A BASE SYMBOL PLUS AT MOST A SINGLE-LETTER CLASS SUFFIX (`BRK.B`,
  // `BF-B`). Exchange-qualified index/FX forms (`DX-Y.NYB`) have more segments and are not
  // issuers; resolving their first segment would reach an unrelated registrant.
  const parts = head.split(/[.\-]/).filter((p) => p !== "");
  if (parts.length === 0 || parts.length > 2) return undefined;
  if (parts.length === 2 && !/^[A-Z]$/.test(parts[1]!)) return undefined;
  const token = (parts[0] ?? "").replace(/[^A-Z0-9]/g, "");
  // 1-5 uppercase letters: the corporate-ticker shape. Anything longer (a company name, a
  // crypto pair) is not a ticker and is not silently truncated into one.
  if (!/^[A-Z]{1,5}$/.test(token)) return undefined;
  if (CRYPTO_ASSETS.has(token)) return undefined;
  return token;
}

function unavailable(
  providerId: string,
  capability: CapabilityName,
  params: Record<string, unknown>,
  message: string,
  transport: string,
  retriable: boolean,
  rawReference?: string,
): ToolResultInput {
  return {
    tool: providerId,
    capability,
    transport,
    params,
    ...(rawReference !== undefined ? { rawReference } : {}),
    outputs: [{ outputClass: "UNAVAILABLE" as const, content: message }],
    completeness: "EMPTY",
    freshness: "CURRENT",
    validation: "VALID",
    failure: { type: "EMPTY_RESULT", message, retriable },
    limitations: [],
  };
}

export interface SecEdgarAdapterOptions {
  /** Injectable for deterministic tests (failure injection, offline runs). */
  readonly fetchImpl?: typeof fetch;
}

export class SecEdgarAdapter implements ProviderAdapter {
  readonly providerId = "fallback/sec-edgar";
  readonly capabilities: readonly CapabilityName[] = ["SOURCE_VALIDATION", "EQUITY_FUNDAMENTALS"];
  readonly limitations: readonly string[] = [
    "SEC EDGAR is issuer-first: it covers SEC registrants only, not crypto assets or non-US issuers",
    "a filing reference is PRIMARY_SOURCE only when its EDGAR URL/identifier is captured; EDGAR's own summary text is not",
    "filings are periodic and delayed by days to weeks after the event they describe",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "sec:filing-lag-days-to-weeks";

  private readonly tickerTransport: RestTransport;
  private readonly dataTransport: RestTransport;

  constructor(options: SecEdgarAdapterOptions = {}) {
    const defaultHeaders = { "user-agent": SEC_USER_AGENT, accept: "application/json" };
    this.tickerTransport = new RestTransport({ baseUrl: EDGAR_BASE_URL, defaultHeaders, ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}) });
    this.dataTransport = new RestTransport({ baseUrl: EDGAR_DATA_BASE_URL, defaultHeaders, ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}) });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "SOURCE_VALIDATION" && capability !== "EQUITY_FUNDAMENTALS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }

    const ticker = issuerTickerOf(params);
    if (ticker === undefined) {
      const requested = [params.symbol, params.asset, params.ticker, params.issuer]
        .find((v) => typeof v === "string" && (v as string).trim() !== "");
      return unavailable(
        this.providerId, capability, params,
        `no SEC registrant resolved for this question${typeof requested === "string" ? ` (${requested})` : ""}; EDGAR covers SEC-registered issuers only, not crypto assets`,
        "none", false,
      );
    }

    // 1. Ticker -> CIK. The ticker file is the only mapping SEC publishes; a miss is an honest
    //    no-coverage for this issuer, NOT "this issuer has no filings".
    const tickers = await this.tickerTransport.get("/files/company_tickers.json");
    const file = tickers.body as CompanyTickerFile;
    const row = Object.values(file).find((r) => r?.ticker?.toUpperCase() === ticker);
    if (row?.cik_str === undefined) {
      return unavailable(
        this.providerId, capability, params, `no SEC CIK found for ticker ${ticker}; EDGAR has no registrant under that symbol`,
        "rest:www.sec.gov", false, tickers.rawReference,
      );
    }
    const cik = String(row.cik_str).padStart(10, "0");

    // 2. CIK -> filing history. This is the primary-source surface.
    const subs = await this.dataTransport.get(`/submissions/CIK${cik}.json`);
    const body = subs.body as SubmissionsFile;
    const recent = body.filings?.recent;
    const accession = recent?.accessionNumber ?? [];
    const form = recent?.form ?? [];
    const filingDate = recent?.filingDate ?? [];
    const reportDate = recent?.reportDate ?? [];
    const primaryDocument = recent?.primaryDocument ?? [];

    if (accession.length === 0) {
      return unavailable(
        this.providerId, capability, params, `SEC has no filing history for ${body.name ?? ticker} (CIK ${cik})`,
        "rest:data.sec.gov", false, subs.rawReference,
      );
    }

    // The forms that carry an issuer's own primary statements about itself. Filing-index
    // metadata is a fact ABOUT the filing (what was filed, when) and is never read as a fact
    // ABOUT the company — the distinction the PRIMARY_SOURCE law exists to hold.
    const MATERIAL_FORMS = new Set(["10-K", "10-Q", "8-K", "20-F", "40-F", "S-1", "DEF 14A"]);
    const filings: ToolOutput[] = [];
    let latestFilingDate: string | undefined;
    for (let i = 0; i < accession.length; i += 1) {
      const accNo = accession[i]!;
      const filingForm = form[i] ?? "UNKNOWN";
      if (!MATERIAL_FORMS.has(filingForm)) continue;
      const accNoCompact = accNo.replace(/-/g, "");
      const doc = primaryDocument[i] ?? "";
      const url = `${EDGAR_BASE_URL}/Archives/edgar/data/${Number(cik)}/${accNoCompact}/${doc}`;
      const filed = filingDate[i];
      if (filed !== undefined && (latestFilingDate === undefined || filed > latestFilingDate)) latestFilingDate = filed;
      filings.push({
        outputClass: "FACTUAL_OBSERVATION" as const,
        content: {
          kind: "filing_index_record",
          form: filingForm,
          accessionNumber: accNo,
          filingDate: filed,
          periodOfReport: reportDate[i],
          edgarUrl: url,
          // The filing is the primary source and the URL is what makes this reference
          // checkable; nothing here paraphrases the filing's contents.
          isPrimarySource: true,
          source: "SEC EDGAR",
          cik,
          ticker,
        },
        about: `${ticker} ${filingForm}`,
      });
    }

    if (filings.length === 0) {
      return unavailable(
        this.providerId, capability, params,
        `SEC has filings for ${body.name ?? ticker} but none in the material form set (10-K/10-Q/8-K/20-F/40-F/S-1/DEF 14A)`,
        "rest:data.sec.gov", false, subs.rawReference,
      );
    }

    return {
      tool: `${this.providerId}.filings`,
      capability,
      transport: "rest:data.sec.gov",
      params: { ...params, ticker, cik },
      rawReference: subs.rawReference,
      outputs: [
        {
          outputClass: "FACTUAL_OBSERVATION" as const,
          content: {
            kind: "registrant_profile",
            name: body.name,
            cik,
            tickers: body.tickers,
            exchanges: body.exchanges,
            sic: body.sic,
            sicDescription: body.sicDescription,
            source: "SEC EDGAR",
          },
          about: ticker,
        },
        ...filings.slice(0, 20),
      ],
      completeness: "COMPLETE",
      freshness: "CURRENT",
      validation: "VALID",
      ...(latestFilingDate !== undefined ? { sourceTimestamp: `${latestFilingDate}T00:00:00.000Z` } : {}),
      limitations: this.limitations,
    };
  }
}