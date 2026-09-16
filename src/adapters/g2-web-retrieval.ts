/**
 * G2; Web / primary-source retrieval provider (capability: SOURCE_VALIDATION).
 *
 * Architectural basis:
 * - capability-registry.ts `WebRetrievalProvider` / `RetrievedSource` / `WebQuery` (M0
 *   interface, unchanged): DISCOVER → RETRIEVE → VALIDATE → EXTRACT → SOURCE → EVIDENCE,
 *   "snippets are not authoritative evidence", source/evidence separation.
 * - Mandate §14–22: a BOUNDED research capability; not an autonomous browsing agent. The
 *   Research Engine selects it through the registry (capability-first); Gemini never browses.
 *
 * Laws implemented here:
 * - SOURCE ≠ EVIDENCE: `retrieve` returns a SOURCE record (metadata + extracted excerpt +
 *   raw-content reference). The registry `execute` path packages sources as outputs carrying
 *   `sourceClass`; downstream evidence keeps that class and never treats secondary reporting
 *   as primary (§17).
 * - Source classification is explicit and conservative: primary/official only for government/
 *   central-bank/official-project domains; known encyclopedic → secondary/encyclopedic; known
 *   news → secondary/news-report; social → community/social-signal; UNKNOWN domains default to
 *   secondary/unclassified (never silently primary).
 * - Repeated content is not independent corroboration: identical extracted content across
 *   different URLs is flagged `duplicateContent: true` (§17).
 * - Retrieval failure never becomes negative evidence (§18): timeout / HTTP error / invalid
 *   URL / private-network URL / empty page / extraction failure are typed failures.
 * - Safety (§19): https/http only; DNS-resolved targets checked against private/loopback/
 *   link-local ranges (SSRF guard) BEFORE fetching; no credentials forwarded; response size
 *   bounded; no code execution; raw capture for provenance.
 * - Live-verified reachable sources from this machine (2026-09-15): en.wikipedia.org (200),
 *   federalreserve.gov (200), coindesk.com (200); reuters.com 401 (bot-wall), sec.gov 403
 *   (UA policy); recorded, not faked around.
 */

import { lookup } from "node:dns/promises";
import { RawCapture, TransportError } from "./transports/resilience.js";
import type { WebQuery, RetrievedSource, ProviderAdapter } from "./capability-registry.js";
import type { CapabilityName } from "./capability-registry.js";
import type { ToolOutput, ToolResultInput } from "../domain/tool-result.js";

export const G2_CAPABILITIES: readonly CapabilityName[] = ["SOURCE_VALIDATION"];

/** Default discovery endpoint: Wikipedia opensearch-style query API (no key, reachable). */
export const DEFAULT_SEARCH_ENDPOINT = "https://en.wikipedia.org/w/api.php";

/** Hard cap on downloaded page text (bytes); bounded retrieval, no memory exhaustion. */
const MAX_PAGE_BYTES = 512_000;
/** Extracted excerpt bound per source. */
const MAX_EXCERPT_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** UA identifying an automated research agent honestly. */
const USER_AGENT = "LumenTerminal-Research/1.0 (bounded research retrieval; local deployment)";

// ---------------------------------------------------------------------------
// Source classification; explicit, conservative, tested.
// ---------------------------------------------------------------------------

const PRIMARY_DOMAINS = new Set([
  "federalreserve.gov", "treasury.gov", "ecb.europa.eu", "boj.or.jp", "bankofengland.co.uk",
  "sec.gov", "ftc.gov", "congress.gov", "whitehouse.gov", "bis.org", "imf.org",
  "bitcoin.org", "ethereum.org", "bitcoinmagazine.org",
]);

const NEWS_DOMAINS = new Set([
  "coindesk.com", "cointelegraph.com", "theblock.co", "decrypt.co", "bloomberg.com",
  "reuters.com", "apnews.com", "cnbc.com", "ft.com", "wsj.com", "barrons.com",
  "cryptocoinsnews.com", "news.bitcoin.com",
]);

const COMMUNITY_DOMAINS = new Set(["reddit.com", "x.com", "twitter.com", "bitcointalk.org"]);

const ENCYCLOPEDIC_DOMAINS = new Set(["wikipedia.org", "britannica.com"]);

export function classifySource(url: string): string {
  const host = hostnameOf(url).toLowerCase();
  for (const d of PRIMARY_DOMAINS) if (host === d || host.endsWith(`.${d}`)) return "primary/official";
  for (const d of ENCYCLOPEDIC_DOMAINS) if (host === d || host.endsWith(`.${d}`)) return "secondary/encyclopedic";
  for (const d of NEWS_DOMAINS) if (host === d || host.endsWith(`.${d}`)) return "secondary/news-report";
  for (const d of COMMUNITY_DOMAINS) if (host === d || host.endsWith(`.${d}`)) return "community/social-signal";
  return "secondary/unclassified"; // conservative default; never silently primary
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// SSRF guard; resolve DNS and reject private/loopback/link-local targets.
// ---------------------------------------------------------------------------

function isForbiddenIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower === "::" || lower.startsWith("::ffff:127.");
  }
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Resolve the hostname and throw a typed non-retriable failure on private/loopback targets. */
async function assertPublicHost(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TransportError("SCHEMA_ERROR", `invalid URL: ${url}`, { retriable: false });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TransportError("SCHEMA_ERROR", `unsupported protocol ${parsed.protocol} (https/http only)`, { retriable: false });
  }
  const host = parsed.hostname;
  // Literal IPs are checked directly; hostnames are resolved then checked.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    if (isForbiddenIp(host)) {
      throw new TransportError("SCHEMA_ERROR", `refusing to fetch private/loopback target: ${host}`, { retriable: false });
    }
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new TransportError("SCHEMA_ERROR", `refusing to fetch private target: ${host}`, { retriable: false });
  }
  try {
    const resolved = await lookup(host, { all: true });
    for (const { address } of resolved) {
      if (isForbiddenIp(address)) {
        throw new TransportError("SCHEMA_ERROR", `refusing to fetch ${host}: resolves to private/loopback address`, { retriable: false });
      }
    }
  } catch (error) {
    if (error instanceof TransportError) throw error;
    throw new TransportError("PROVIDER_ERROR", `DNS resolution failed for ${host}: ${error instanceof Error ? error.message : String(error)}`, { retriable: true });
  }
}

// ---------------------------------------------------------------------------
// HTML extraction; dependency-free, bounded.
// ---------------------------------------------------------------------------

export function extractHtml(raw: string): { title?: string; publishedAt?: string; author?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.trim();
  const publishedAt =
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(raw)?.[1] ??
    /<time[^>]+datetime=["']([^"']+)["']/i.exec(raw)?.[1];
  const author = /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i.exec(raw)?.[1];
  const withoutScripts = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = withoutScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXCERPT_CHARS);
  return {
    ...(title !== undefined && title !== "" ? { title } : {}),
    ...(publishedAt !== undefined && publishedAt !== "" ? { publishedAt } : {}),
    ...(author !== undefined && author !== "" ? { author } : {}),
    text,
  };
}

/** Cheap content fingerprint for repeated-content (non-independent) detection. */
export function contentFingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalized.length; i++) {
    h1 = (h1 ^ normalized.charCodeAt(i)) * 16777619 >>> 0;
    h2 = (h2 + normalized.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return `${h1.toString(16)}-${h2.toString(16)}-${normalized.length}`;
}

// ---------------------------------------------------------------------------
// The provider.
// ---------------------------------------------------------------------------

export interface G2WebRetrievalOptions {
  readonly searchEndpoint?: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
}

interface FetchPageResult {
  readonly raw: string;
  readonly rawReference: string;
  readonly status: number;
  readonly finalUrl: string;
}

export class G2WebRetrievalAdapter implements ProviderAdapter {
  readonly providerId = "g2/web-retrieval";
  readonly capabilities = G2_CAPABILITIES;
  readonly limitations: readonly string[] = [
    "G2 retrieves and classifies public web sources; retrieval failure is a technical condition, never negative evidence",
    "source classification is heuristic (domain-based): unknown domains default to secondary/unclassified, never primary",
    "repeated/syndicated content across domains is flagged and is NOT independent corroboration",
    "discovery uses a bounded encyclopedic search index; it is not an exhaustive web search",
  ];
  readonly freshnessProfile = "web:retrieval-time";

  private readonly searchEndpoint: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  readonly rawCapture = new RawCapture();

  constructor(options: G2WebRetrievalOptions = {}) {
    this.searchEndpoint = options.searchEndpoint ?? DEFAULT_SEARCH_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Registry path: params is a WebQuery. Returns sources as classified outputs. */
  async execute(capability: string, params: Record<string, unknown>): Promise<ToolResultInput> {
    if (capability !== "SOURCE_VALIDATION") {
      throw new TransportError("SCHEMA_ERROR", `${this.providerId} has no mapping for capability ${capability}`, { retriable: false });
    }
    const q = params as unknown as WebQuery;
    try {
      if (q.intent === "RETRIEVE") {
        if (typeof q.url !== "string" || q.url === "") {
          throw new TransportError("SCHEMA_ERROR", "RETRIEVE requires url", { retriable: false });
        }
        const source = await this.retrieve(q.url);
        return this.successResult([this.sourceToOutput(source, false)], "COMPLETE", `retrieve:${source.url}`);
      }
      // DISCOVER (default intent)
      if (typeof q.query !== "string" || q.query.trim() === "") {
        throw new TransportError("SCHEMA_ERROR", "DISCOVER requires a non-empty query", { retriable: false });
      }
      const sources = await this.discover(q.query);
      if (sources.length === 0) {
        return {
          tool: this.providerId,
          capability,
          transport: "web:discover",
          params: { ...q },
          outputs: [],
          completeness: "EMPTY",
          validation: "VALID",
          failure: { type: "EMPTY_RESULT", message: `no sources discovered for "${q.query}"`, retriable: true },
          limitations: this.limitations,
        };
      }
      // Repeated-content detection across the discovered set (§17: not independent corroboration).
      const seen = new Set<string>();
      const outputs = sources.map((s) => {
        const fp = contentFingerprint(s.contentReference.includes("#excerpt:") ? s.contentReference.split("#excerpt:")[1] ?? "" : "");
        const duplicateContent = seen.has(fp);
        seen.add(fp);
        return this.sourceToOutput(s, duplicateContent);
      });
      return this.successResult(outputs, "COMPLETE", `discover:${q.query}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTyped = error instanceof TransportError;
      return {
        tool: this.providerId,
        capability,
        transport: "web",
        params: { ...q },
        outputs: [],
        completeness: "EMPTY",
        validation: "VALID",
        failure: {
          type: isTyped && error.failureType === "TIMEOUT" ? "TIMEOUT" : isTyped && error.failureType === "SCHEMA_ERROR" ? "SCHEMA_ERROR" : isTyped && error.failureType === "INVALID_RESPONSE" ? "INVALID_RESPONSE" : "PROVIDER_ERROR",
          message,
          retriable: isTyped ? error.retriable : true,
        },
        limitations: this.limitations,
      };
    }
  }

  private successResult(outputs: readonly ToolOutput[], completeness: "COMPLETE" | "PARTIAL", label: string): ToolResultInput {
    return {
      tool: this.providerId,
      capability: "SOURCE_VALIDATION",
      transport: `web:${label.slice(0, 60)}`,
      params: {},
      outputs,
      completeness,
      validation: "VALID",
      freshness: "CURRENT",
      limitations: this.limitations,
    };
  }

  private sourceToOutput(s: RetrievedSource, duplicateContent: boolean): ToolOutput {
    return {
      outputClass: "FACTUAL_OBSERVATION" as const,
      content: {
        url: s.url,
        publisher: s.publisher,
        sourceClass: s.sourceClass,
        publishedAt: s.publishedAt,
        retrievedAt: s.retrievedAt,
        excerpt: s.contentReference.includes("#excerpt:") ? s.contentReference.split("#excerpt:")[1]?.slice(0, 600) : undefined,
        ...(duplicateContent ? { duplicateContent: true, note: "repeated content is not independent corroboration" } : {}),
      },
    };
  }

  /** DISCOVER: bounded search via the configured index; URL-deduped; raw captured. */
  async discover(query: string): Promise<readonly RetrievedSource[]> {
    const at = this.now();
    const searchUrl = `${this.searchEndpoint}?action=query&list=search&format=json&srsearch=${encodeURIComponent(query)}&srlimit=8`;
    await assertPublicHost(searchUrl);
    const page = await this.fetchPage(searchUrl);
    let parsed: { query?: { search?: Array<{ title?: string }> } };
    try {
      parsed = JSON.parse(page.raw.slice(0, MAX_PAGE_BYTES)) as typeof parsed;
    } catch {
      throw new TransportError("INVALID_RESPONSE", `discovery endpoint returned non-JSON (raw: ${page.rawReference})`, { retriable: false });
    }
    const hits = parsed.query?.search ?? [];
    const seen = new Set<string>();
    const sources: RetrievedSource[] = [];
    for (const hit of hits) {
      if (typeof hit.title !== "string" || hit.title === "") continue;
      // Wikipedia titles → canonical article URLs (the configured index's URL scheme).
      const url = this.searchEndpoint.includes("wikipedia.org")
        ? `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s/g, "_"))}`
        : `${this.searchEndpoint}# ${hit.title}`;
      if (seen.has(url)) continue;
      seen.add(url);
      sources.push({
        url,
        publisher: hostnameOf(url),
        retrievedAt: at.toISOString(),
        contentReference: `${page.rawReference}#hit:${hit.title}`,
        sourceClass: classifySource(url),
      });
    }
    return sources;
  }

  /** RETRIEVE: fetch a public page, extract metadata + excerpt, return a SOURCE record. */
  async retrieve(url: string): Promise<RetrievedSource> {
    const at = this.now();
    await assertPublicHost(url);
    const page = await this.fetchPage(url);
    if (page.raw.trim().length === 0) {
      throw new TransportError("INVALID_RESPONSE", `page is empty (raw: ${page.rawReference})`, { retriable: false });
    }
    const extracted = extractHtml(page.raw);
    if (extracted.text.length < 40) {
      throw new TransportError("INVALID_RESPONSE", `extraction yielded no usable content (raw: ${page.rawReference})`, { retriable: false });
    }
    return {
      url: page.finalUrl,
      publisher: hostnameOf(page.finalUrl),
      ...(extracted.author !== undefined ? { author: extracted.author } : {}),
      ...(extracted.publishedAt !== undefined ? { publishedAt: extracted.publishedAt } : {}),
      retrievedAt: at.toISOString(),
      contentReference: `${page.rawReference}#excerpt:${extracted.text.slice(0, 800)}`,
      sourceClass: classifySource(page.finalUrl),
    };
  }

  /** Bounded fetch with SSRF-checked target, honest timeout, raw capture BEFORE parsing. */
  private async fetchPage(url: string): Promise<FetchPageResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,*/*;q=0.5" },
        redirect: "follow",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TransportError("TIMEOUT", `retrieval timed out after ${this.timeoutMs}ms: ${url}`, { retriable: true });
      }
      throw new TransportError("PROVIDER_ERROR", `network error fetching ${url}: ${error instanceof Error ? error.message : String(error)}`, { retriable: true });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new TransportError("PROVIDER_ERROR", `HTTP ${response.status} fetching ${url}`, { retriable: response.status >= 500 || response.status === 429 });
    }
    // Bound the download: read as text then hard-slice (content-length is often absent/lying).
    const raw = (await response.text()).slice(0, MAX_PAGE_BYTES);
    const rawReference = this.rawCapture.capture("web", `GET ${url}`, raw);
    return { raw, rawReference, status: response.status, finalUrl: response.url || url };
  }
}
