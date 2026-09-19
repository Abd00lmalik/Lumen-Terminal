/**
 * Client transport laws (workspace-400 root-cause fix); deterministic, no network.
 *
 * Root cause pinned here: the client used to declare `Content-Type: application/json`
 * on EVERY request, including bodyless GETs. The production runtime rejected such
 * requests with an opaque, bodyless HTTP 400 before any app handler ran — every real
 * browser session failed its workspace/evidence/thesis reads while curl-style probes
 * (which omit CT on GET) succeeded. Laws:
 * - CT ONLY WITH A BODY: fetch receives `Content-Type: application/json` exactly when
 *   a body is sent, never on bodyless GET/HEAD requests.
 * - TYPED ERRORS PRESERVED: POST error responses still normalize through the typed
 *   envelope; the fix must not change error semantics.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { http, ApiError } from "../src/api/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fetchCalls(): { url: string; init: RequestInit }[] {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("client transport: content-type law", () => {
  it("bodyless GET sends NO Content-Type header (the production 400 trigger)", async () => {
    const calls = fetchCalls();
    await http.get("/api/workspace");
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("content-type")).toBeNull();
  });

  it("POST with a JSON body sends Content-Type: application/json", async () => {
    const calls = fetchCalls();
    await http.post("/api/thesis/select", { thesisRef: "th_1" });
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("POST with undefined body still sends no Content-Type", async () => {
    const calls = fetchCalls();
    await http.post("/api/monitors/m_1/activate", undefined);
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("content-type")).toBeNull();
  });
});

describe("client transport: error semantics unchanged", () => {
  it("typed 400 envelope still normalizes to ApiError with the server's code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "bad" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(http.get("/api/x")).rejects.toMatchObject({ code: "INVALID_REQUEST", httpStatus: 400 });
    expect(vi.mocked(fetch).mock.calls.length).toBe(1); // typed errors never retried
  });

  it("non-envelope 400 on GET retries once, then surfaces the HTTP fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("opaque", { status: 400 })),
    );
    const err = await http.get("/api/x").catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain("HTTP 400");
    expect(vi.mocked(fetch).mock.calls.length).toBe(2); // one retry for safe reads
  });
});
