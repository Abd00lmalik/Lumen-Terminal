/**
 * Capability-level fallback providers — the REGISTRY owns selection (never flow→tool).
 *
 * Mandate §3: Bitget stays PRIMARY for every capability; these adapters register at LOWER
 * priority so the registry's existing failover loop (`resolve()` ordering → first success)
 * reaches them only when the primary fails/unavailable. Every fallback:
 * - preserves full provenance (tool id, transport, raw capture, retrieval time),
 * - classifies outputs epistemically (FACTUAL_OBSERVATION for reportable facts,
 *   SENTIMENT_SIGNAL only for real sentiment indices — with an explicit proxyBasis),
 * - states exactly what it provides — it never invents funding/OI/positioning data,
 * - treats retrieval failure as a technical condition, never negative evidence.
 *
 * Sources chosen for keyless reliability (live-probed 2026-09-16 from this network):
 * - NEWS: CoinDesk RSS + Cointelegraph RSS (public feeds; secondary reporting by default).
 * - SENTIMENT: alternative.me Fear & Greed Index (public JSON, no key).
 * - MACRO: World Bank API (official indicators; keyless; low-frequency — labeled STALE).
 */
import type { ProviderAdapter, CapabilityName } from "./capability-registry.js";
import type { ToolResultInput, ToolOutput } from "../domain/tool-result.js";
import { RestTransport } from "./transports/rest.js";
import { RawCapture } from "./transports/resilience.js";

// ---------------------------------------------------------------------------
// Shared RSS helpers (feeds are XML — the JSON-only RestTransport cannot parse them)
// ---------------------------------------------------------------------------

const XML_TITLE = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
const XML_PUBDATE = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/;
const XML_ITEM = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/g;

function parseFeedItems(xml: string, limit: number): { title: string; pubDate?: string; link?: string }[] {
  const items: { title: string; pubDate?: string; link?: string }[] = [];
  for (const match of xml.matchAll(XML_ITEM)) {
    const block = match[0];
    const title = XML_TITLE.exec(block)?.[1]?.trim();
    if (!title) continue;
    const pubDate = XML_PUBDATE.exec(block)?.[1]?.trim();
    const link =
      /<link[^>]*href="([^"]+)"/.exec(block)?.[1] ?? /<link[^>]*>([\s\S]*?)<\/link>/.exec(block)?.[1]?.trim();
    items.push({ title, ...(pubDate !== undefined ? { pubDate } : {}), ...(link !== undefined ? { link } : {}) });
    if (items.length >= limit) break;
  }
  return items;
}

/** Feed fetch with timeout + raw capture (retrieval failure is technical, never evidence). */
async function fetchFeedXml(
  url: string,
  rawCapture: RawCapture,
  fetchImpl: typeof fetch,
  timeoutMs = 12_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    rawCapture.capture("web", `GET ${url}`, text);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// NEWS fallback — public crypto RSS feeds. Each item carries publisher + timestamp + url;
// reporting is SECONDARY by default (G2's classification law applied at this layer).
// ---------------------------------------------------------------------------

const NEWS_FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", publisher: "CoinDesk" },
  { url: "https://cointelegraph.com/rss", publisher: "Cointelegraph" },
] as const;

export class NewsFallbackAdapter implements ProviderAdapter {
  readonly providerId = "fallback/news-rss";
  readonly capabilities: readonly CapabilityName[] = ["NEWS_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "fallback provider: public crypto RSS feeds (CoinDesk/Cointelegraph) — secondary reporting, not primary sources",
    "headline-level aggregation; per-feed errors skip that feed (completeness may be PARTIAL)",
    "retrieval failure is a technical condition, never negative evidence",
  ];
  readonly freshnessProfile = "rss";

  private readonly rawCapture = new RawCapture();
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "NEWS_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const keyword = typeof params.keyword === "string" ? params.keyword.toLowerCase() : undefined;
    const outputs: ToolOutput[] = [];
    const errors: string[] = [];
    let lastRawReference: string | undefined;
    for (const feed of NEWS_FEEDS) {
      try {
        const xml = await fetchFeedXml(feed.url, this.rawCapture, this.fetchImpl);
        lastRawReference = `web:GET ${feed.url}`;
        const items = parseFeedItems(xml, 8);
        if (items.length === 0) {
          errors.push(`${feed.publisher}: feed contained no items`);
          continue;
        }
        for (const item of items) {
          if (keyword !== undefined && !item.title.toLowerCase().includes(keyword)) continue;
          outputs.push({
            outputClass: "FACTUAL_OBSERVATION",
            content: { title: item.title, publisher: feed.publisher, publishedAt: item.pubDate, url: item.link },
            about: feed.publisher,
          });
        }
      } catch (error) {
        errors.push(`${feed.publisher}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (outputs.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "web:rss",
        params,
        outputs: errors.map((e) => ({ outputClass: "UNAVAILABLE" as const, content: `feed error: ${e}` })),
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: `all fallback news feeds failed: ${errors.join("; ")}`, retriable: true },
        limitations: this.limitations,
      };
    }
    return {
      tool: this.providerId,
      capability,
      transport: "web:rss",
      params,
      ...(lastRawReference !== undefined ? { rawReference: lastRawReference } : {}),
      outputs,
      completeness: errors.length > 0 ? "PARTIAL" : "COMPLETE",
      freshness: "CURRENT",
      validation: "VALID",
      failure: { type: "NONE", retriable: false },
      limitations: this.limitations,
    };
  }
}

// ---------------------------------------------------------------------------
// SENTIMENT fallback — alternative.me Fear & Greed Index (public, keyless).
// Provides ONLY the index: a real sentiment proxy (SENTIMENT_SIGNAL + proxyBasis).
// Does NOT provide funding/OI/positioning — never invented.
// ---------------------------------------------------------------------------

interface FngResponse {
  readonly data?: readonly { readonly value?: string; readonly value_classification?: string; readonly timestamp?: string }[];
}

export class SentimentFallbackAdapter implements ProviderAdapter {
  readonly providerId = "fallback/fear-greed";
  readonly capabilities: readonly CapabilityName[] = ["SENTIMENT_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "fallback provider: alternative.me Fear & Greed Index only — a market sentiment proxy",
    "does NOT provide funding, open interest, liquidations, or trader positioning (never invented)",
    "daily-updated index; not intra-day sentiment",
  ];
  readonly freshnessProfile = "community:daily";

  private readonly rest: RestTransport;

  constructor(fetchImpl?: typeof fetch) {
    this.rest = new RestTransport({ baseUrl: "https://api.alternative.me", ...(fetchImpl ? { fetchImpl } : {}) });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "SENTIMENT_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const outcome = await this.rest.get("/fng/", { params: { limit: "3" } });
    const parsed = outcome.body as FngResponse;
    const entries = parsed.data ?? [];
    if (entries.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:api.alternative.me",
        params,
        rawReference: outcome.rawReference,
        outputs: [],
        completeness: "EMPTY",
        freshness: "CURRENT",
        validation: "VALID",
        failure: { type: "EMPTY_RESULT", message: "Fear & Greed endpoint returned no data", retriable: true },
        limitations: this.limitations,
      };
    }
    const outputs: ToolOutput[] = entries.map((e) => ({
      outputClass: "SENTIMENT_SIGNAL" as const,
      content: {
        index: "Fear & Greed (alternative.me)",
        value: e.value,
        classification: e.value_classification,
        timestamp: e.timestamp,
      },
      about: "crypto market sentiment",
      proxyBasis: "index value is a proxy for market sentiment, not a direct observation of trader behavior",
    }));
    return {
      tool: this.providerId,
      capability,
      transport: "rest:api.alternative.me",
      params,
      rawReference: outcome.rawReference,
      outputs,
      completeness: "COMPLETE",
      freshness: "CURRENT",
      validation: "VALID",
      failure: { type: "NONE", retriable: false },
      limitations: this.limitations,
    };
  }
}

// ---------------------------------------------------------------------------
// MACRO fallback — World Bank official indicators (keyless, authoritative, annual lag).
// Freshness is honestly STALE — low-frequency official data is never labeled CURRENT.
// ---------------------------------------------------------------------------

interface WbResponse {
  readonly 1?: readonly { readonly date?: string; readonly value?: number | null }[];
}

export class MacroFallbackAdapter implements ProviderAdapter {
  readonly providerId = "fallback/world-bank";
  readonly capabilities: readonly CapabilityName[] = ["MACRO_ANALYSIS"];
  readonly limitations: readonly string[] = [
    "fallback provider: World Bank official indicators (US CPI inflation, US GDP growth) — authoritative but low-frequency (annual lag)",
    "NOT real-time macro data; monthly-frequency releases are out of coverage",
    "crypto-relevant market macro (DXY, VIX, yields) is NOT provided",
  ];
  readonly freshnessProfile = "macro:annual-lag";

  private readonly rest: RestTransport;

  constructor(fetchImpl?: typeof fetch) {
    this.rest = new RestTransport({ baseUrl: "https://api.worldbank.org", ...(fetchImpl ? { fetchImpl } : {}) });
  }

  async execute(capability: CapabilityName, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "MACRO_ANALYSIS") {
      throw new Error(`${this.providerId} has no mapping for capability ${capability}`);
    }
    const outputs: ToolOutput[] = [];
    const errors: string[] = [];
    let lastRawReference: string | undefined;
    const series = [
      { path: "/v2/country/US/indicator/FP.CPI.TOTL.ZG", label: "US CPI inflation (annual %)" },
      { path: "/v2/country/US/indicator/NY.GDP.MKTP.KD.ZG", label: "US GDP growth (annual %)" },
    ] as const;
    for (const s of series) {
      try {
        const outcome = await this.rest.get(s.path, { params: { format: "json", per_page: "3" } });
        lastRawReference = outcome.rawReference;
        const rows = (outcome.body as WbResponse)[1] ?? [];
        for (const row of rows) {
          if (row.value === null || row.value === undefined) continue;
          outputs.push({
            outputClass: "QUANTITATIVE_OBSERVATION",
            content: { indicator: s.label, year: row.date, value: row.value, source: "World Bank" },
            about: "US macro",
          });
        }
      } catch (error) {
        errors.push(`${s.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (outputs.length === 0) {
      return {
        tool: this.providerId,
        capability,
        transport: "rest:api.worldbank.org",
        params,
        outputs: errors.map((e) => ({ outputClass: "UNAVAILABLE" as const, content: `series error: ${e}` })),
        completeness: "EMPTY",
        freshness: "STALE",
        validation: "VALID",
        failure: { type: "PROVIDER_ERROR", message: `all World Bank series failed: ${errors.join("; ")}`, retriable: true },
        limitations: this.limitations,
      };
    }
    return {
      tool: this.providerId,
      capability,
      transport: "rest:api.worldbank.org",
      params,
      ...(lastRawReference !== undefined ? { rawReference: lastRawReference } : {}),
      outputs,
      completeness: errors.length > 0 ? "PARTIAL" : "COMPLETE",
      freshness: "STALE",
      validation: "VALID",
      failure: { type: "NONE", retriable: false },
      limitations: this.limitations,
    };
  }
}
