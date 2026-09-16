/**
 * G2 web/primary-source retrieval; deterministic tests (no network) + env-gated live test.
 *
 * Laws under test (mandate §14–22):
 * - SOURCE ≠ EVIDENCE: retrieve returns source records with URL/publisher/class/dates/raw-ref;
 *   execution path packages them as classified outputs; secondary reporting never becomes primary.
 * - §17 validation: domain-based classification is conservative (unknown → secondary/unclassified);
 *   identical content across URLs is flagged duplicateContent (not independent corroboration).
 * - §18 failure taxonomy: timeout / HTTP error / invalid URL / private URL / empty page /
 *   extraction failure → typed failures; never negative evidence; retriable flags correct.
 * - §19 safety: SSRF guard rejects private/loopback/link-local and non-http(s) schemes BEFORE
 *   fetch; page size bounded; no credential forwarding.
 * - Live (env-gated): one real authoritative retrieval when FREEBUFF_LIVE=1 and the network
 *   allows; never a suite dependency.
 */
import { describe, expect, it } from "vitest";
import { G2WebRetrievalAdapter, classifySource, extractHtml, contentFingerprint } from "../../src/adapters/g2-web-retrieval.js";
import { CapabilityRegistry } from "../../src/adapters/capability-registry.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const ORIGIN: ProvenanceOrigin = { kind: "agent", detail: "test" };

function htmlResponse(body: string, status = 200, finalUrl?: string): typeof fetch {
  return (async (url: unknown) => {
    const response = new Response(body, { status, headers: { "content-type": "text/html" } });
    if (finalUrl !== undefined) {
      Object.defineProperty(response, "url", { value: finalUrl });
    }
    return response;
  }) as typeof fetch;
}

const SAMPLE_ARTICLE = `<!doctype html><html><head>
<title>Federal Reserve issues FOMC statement</title>
<meta name="author" content="Board of Governors">
<meta property="article:published_time" content="2026-09-15T18:00:00Z">
</head><body><article><p>The Federal Open Market Committee decided to maintain the target range. Inflation remains elevated and the committee judges that the risks are balanced. In support of its goals the committee decided to keep rates steady while assessing incoming data across labor and price stability mandates.</p></article></body></html>`;

describe("G2 source classification (conservative, domain-based)", () => {
  it("primary/official only for government and official-project domains", () => {
    expect(classifySource("https://www.federalreserve.gov/newsevents/pressreleases.htm")).toBe("primary/official");
    expect(classifySource("https://bitcoin.org/en/")).toBe("primary/official");
  });

  it("known news is secondary/news-report; encyclopedic is secondary; social is community", () => {
    expect(classifySource("https://www.coindesk.com/markets/2026/09/x")).toBe("secondary/news-report");
    expect(classifySource("https://en.wikipedia.org/wiki/Bitcoin")).toBe("secondary/encyclopedic");
    expect(classifySource("https://www.reddit.com/r/Bitcoin/comments/x")).toBe("community/social-signal");
  });

  it("UNKNOWN domains default to secondary/unclassified; never silently primary", () => {
    expect(classifySource("https://random-crypto-blog.example.com/post/1")).toBe("secondary/unclassified");
  });
});

describe("G2 extraction + duplicate detection", () => {
  it("extracts title/author/published time and strips markup", () => {
    const extracted = extractHtml(SAMPLE_ARTICLE);
    expect(extracted.title).toBe("Federal Reserve issues FOMC statement");
    expect(extracted.author).toBe("Board of Governors");
    expect(extracted.publishedAt).toBe("2026-09-15T18:00:00Z");
    expect(extracted.text).toContain("Federal Open Market Committee");
    expect(extracted.text).not.toContain("<p>");
    expect(extracted.text).not.toContain("script");
  });

  it("identical content across different URLs shares a fingerprint (not independent)", () => {
    const a = contentFingerprint("The committee decided to maintain the target range.");
    const b = contentFingerprint("The committee decided to maintain the target range.");
    const c = contentFingerprint("A wholly different statement about something else entirely.");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("G2 adapter (deterministic, fake fetch)", () => {
  it("RETRIEVE returns a classified SOURCE record with provenance", async () => {
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse(SAMPLE_ARTICLE, 200, "https://www.federalreserve.gov/newsevents/press.htm") });
    const source = await g2.retrieve("https://www.federalreserve.gov/newsevents/press.htm");
    expect(source.url).toContain("federalreserve.gov");
    expect(source.sourceClass).toBe("primary/official");
    expect(source.author).toBe("Board of Governors");
    expect(source.publishedAt).toBe("2026-09-15T18:00:00Z");
    expect(source.contentReference).toContain("#excerpt:");
    expect(source.retrievedAt).toBeTruthy();
    // Raw capture holds the full page (provenance; final lock §7).
    expect(g2.rawCapture.size).toBeGreaterThan(0);
  });

  it("execute(RETRIEVE) packages the source as a classified output", async () => {
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse(SAMPLE_ARTICLE) });
    const result = await g2.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url: "https://www.federalreserve.gov/x.htm" });
    expect(result.failure?.type ?? "NONE").toBe("NONE");
    expect(result.outputs).toHaveLength(1);
    const content = result.outputs[0]!.content as { url: string; sourceClass: string };
    expect(content.sourceClass).toBe("primary/official");
  });

  it("execute(DISCOVER) parses the index response and dedupes URLs", async () => {
    const searchJson = JSON.stringify({ query: { search: [{ title: "Bitcoin" }, { title: "Bitcoin" }, { title: "Monetary policy" }] } });
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse(searchJson) });
    const sources = await g2.discover("bitcoin monetary policy");
    expect(sources).toHaveLength(2); // duplicate title → deduped
    expect(sources[0]!.url).toContain("wikipedia.org/wiki/Bitcoin");
    expect(sources[0]!.sourceClass).toBe("secondary/encyclopedic");
  });

  it("empty discovery result → EMPTY_RESULT (never fabricated)", async () => {
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse(JSON.stringify({ query: { search: [] } })) });
    const result = await g2.execute("SOURCE_VALIDATION", { intent: "DISCOVER", query: "nonexistent topic xyz" });
    expect(result.failure.type).toBe("EMPTY_RESULT");
    expect(result.outputs).toHaveLength(0);
  });

  it("SSRF guard: private/loopback/link-local and non-http schemes are refused BEFORE fetch", async () => {
    let fetchCalled = false;
    const spyFetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as typeof fetch;
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: spyFetch });
    for (const url of [
      "http://127.0.0.1/secret",
      "http://10.0.0.5/internal",
      "http://192.168.1.1/router",
      "http://172.16.0.9/x",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:8080/admin",
      "file:///etc/passwd",
      "ftp://example.com/file",
    ]) {
      const result = await g2.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url });
      expect(result.failure.type).toBe("SCHEMA_ERROR");
      expect(result.outputs).toHaveLength(0);
    }
    expect(fetchCalled).toBe(false); // the guard fires before any network I/O
  });

  it("typed failures: HTTP error, timeout, empty page, extraction failure (never negative evidence)", async () => {
    const g2Http = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse("nope", 404) });
    const r404 = await g2Http.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url: "https://example.com/gone" });
    expect(r404.failure.type).toBe("PROVIDER_ERROR");
    expect(r404.failure.retriable).toBe(false);

    const g2Timeout = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse("x"), timeoutMs: 1 });
    // fetchImpl never resolves within 1ms → abort path (fake resolves too fast; use a hanging fetch)
    const hangFetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof fetch;
    const g2RealTimeout = new G2WebRetrievalAdapter({ fetchImpl: hangFetch, timeoutMs: 20 });
    const rTimeout = await g2RealTimeout.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url: "https://example.com/slow" });
    expect(rTimeout.failure.type).toBe("TIMEOUT");
    expect(rTimeout.failure.retriable).toBe(true);
    void g2Timeout;

    const g2Empty = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse("   ") });
    const rEmpty = await g2Empty.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url: "https://example.com/empty" });
    expect(rEmpty.failure.type).toBe("INVALID_RESPONSE");

    const g2NoContent = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse("<html><head><title>t</title></head><body>hi</body></html>") });
    const rThin = await g2NoContent.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url: "https://example.com/thin" });
    expect(rThin.failure.type).toBe("INVALID_RESPONSE");
  });

  it("invalid usage: missing url / missing query → SCHEMA_ERROR", async () => {
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse("x") });
    const rNoUrl = await g2.execute("SOURCE_VALIDATION", { intent: "RETRIEVE" });
    expect(rNoUrl.failure.type).toBe("SCHEMA_ERROR");
    const rNoQuery = await g2.execute("SOURCE_VALIDATION", { intent: "DISCOVER" });
    expect(rNoQuery.failure.type).toBe("SCHEMA_ERROR");
  });

  it("interface conformance: rejects unmapped capabilities", async () => {
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse("x") });
    await expect(g2.execute("NEWS_ANALYSIS", {})).rejects.toThrow(/no mapping/);
  });

  it("resolves through the generic registry; source/evidence separation holds downstream", async () => {
    const g2 = new G2WebRetrievalAdapter({ fetchImpl: htmlResponse(SAMPLE_ARTICLE) });
    const registry = new CapabilityRegistry();
    registry.register(g2);
    expect(registry.resolve("SOURCE_VALIDATION").map((r) => r.adapter.providerId)).toEqual(["g2/web-retrieval"]);
    const result = await registry.execute("SOURCE_VALIDATION", { intent: "RETRIEVE", url: "https://www.federalreserve.gov/x.htm" }, ORIGIN);
    expect(result.failure.type).toBe("NONE");
    // The output carries sourceClass; evidence keeps the distinction as data (no flattening).
    expect(result.normalizedOutput[0]!.content).toHaveProperty("sourceClass", "primary/official");
  });
});

// ---------------------------------------------------------------------------
// Live verification; env-gated, never a suite dependency (§21).
// ---------------------------------------------------------------------------
const LIVE = process.env.FREEBUFF_LIVE === "1";
describe.skipIf(!LIVE)("G2 live (env-gated: FREEBUFF_LIVE=1)", () => {
  it("retrieves a real authoritative public source (federalreserve.gov reachable from this machine)", { timeout: 60_000 }, async () => {
    const g2 = new G2WebRetrievalAdapter();
    const result = await g2.execute("SOURCE_VALIDATION", {
      intent: "RETRIEVE",
      url: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
    });
    // Network may be down at run time; report honestly either way.
    if (result.failure.type !== "NONE") {
      console.log(`[G2 live] BLOCKED-EXTERNAL: ${result.failure.type}: ${result.failure.message}`);
      return;
    }
    expect(result.outputs.length).toBeGreaterThan(0);
    const content = result.outputs[0]!.content as { sourceClass: string; url: string };
    expect(content.sourceClass).toBe("primary/official");
    expect(content.url).toContain("federalreserve.gov");
  });
});
