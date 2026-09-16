/**
 * Vercel API-boundary tests (hardening mandate §12); deterministic, no network, no key.
 *
 * Laws under test:
 * - DELEGATION: the Vercel handler serves the REAL Fastify app (health + error surface),
 *   through genuine Node req/res objects; the same surface Vercel's runtime provides.
 * - PERSISTENCE HONESTY: no WORKSPACE_FILE → MemoryStore (serverless disks are ephemeral);
 *   WORKSPACE_FILE set → FileStore. Never silently claims durable persistence.
 * - SECURITY: a missing GEMINI_API_KEY fails typed (names the variable, never a value);
 *   the handler is never constructed with credentials in the response surface.
 *
 * The delegation test spins an actual node:http server whose handler IS the Vercel
 * handler fed synthetic Vercel-shaped req/res; proving app.routing() consumes the
 * real Node objects end-to-end (POST body parsing included).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { createProductionStore, default as handler } from "../../api/research.js";
import { MemoryStore, FileStore } from "../../src/persistence/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("persistence honesty (mandate §2)", () => {
  it("no WORKSPACE_FILE → MemoryStore (ephemeral, documented; never a fake-durable file)", () => {
    expect(createProductionStore({}) instanceof MemoryStore).toBe(true);
  });

  it("WORKSPACE_FILE set → FileStore at the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-"));
    const store = createProductionStore({ WORKSPACE_FILE: join(dir, "ws.json") });
    expect(store instanceof FileStore).toBe(true);
  });
});

describe("security: typed credential absence (mandate §17)", () => {
  it("missing GEMINI_API_KEY → error names the variable, never a value", async () => {
    const { GeminiProvider } = await import("../../src/model/gemini.js");
    const attempt = (): unknown => new GeminiProvider({ env: {} });
    expect(attempt).toThrowError(/GEMINI_API_KEY/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toMatch(/sk-|AIza|[A-Za-z0-9_-]{20,}/); // no value-shaped content
    }
  });
});

describe("Vercel handler delegates to the real Fastify app", () => {
  let server: Server | undefined;
  let baseUrl = "";

  afterEach(async () => {
    await new Promise<void>((resolve) => (server !== undefined ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  function startServer(): Promise<void> {
    return new Promise((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        // Synthesize the VercelRequest/VercelResponse shape over real Node objects.
        void handler(req as never, res as never);
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  it("GET /api/health returns the real app's health payload", async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "test-not-a-real-key";
    await startServer();
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; api: string };
    expect(body.status).toBe("ok");
    expect(body.api).toBe("f0");
  });

  it("malformed research request → the real app's typed 400 (not a generic 500)", async () => {
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "test-not-a-real-key";
    await startServer();
    const res = await fetch(`${baseUrl}/api/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});
