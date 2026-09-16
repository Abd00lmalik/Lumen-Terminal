/**
 * Frontend boundary tests — deterministic, no network.
 *
 * Laws under test (hardening mandate §10/§12):
 * - URL RESOLUTION: production resolves to same-origin `/api` (never localhost);
 *   dev default is the local Fastify server; VITE_API_URL wins when set.
 * - ERROR ENVIRONMENT: NetworkError carries environment "production" | "development";
 *   the production message NEVER contains the dev instruction (`npm run api`).
 * - SHARED NOTICE: BackendDownNote renders environment-appropriate guidance and never
 *   shows dev instructions for production errors.
 * - SINGLE FETCH BOUNDARY: client.ts remains the only fetch in frontend source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveBaseUrl, ApiError, NetworkError } from "../src/api/client.js";
import { BackendDownNote } from "../src/components/BackendDownNote.js";

describe("production API URL resolution (mandate §2)", () => {
  it("production env → same-origin /api (never localhost)", () => {
    expect(resolveBaseUrl({ PROD: true, DEV: false })).toBe("");
  });

  it("dev env → local Fastify server", () => {
    expect(resolveBaseUrl({ PROD: false, DEV: true })).toBe("http://127.0.0.1:3001");
  });

  it("VITE_API_URL wins in any environment when set", () => {
    expect(resolveBaseUrl({ PROD: true, VITE_API_URL: "https://api.example.com" })).toBe("https://api.example.com");
    expect(resolveBaseUrl({ PROD: false, VITE_API_URL: "http://localhost:3001" })).toBe("http://localhost:3001");
  });

  it("empty VITE_API_URL falls through to environment default", () => {
    expect(resolveBaseUrl({ PROD: true, VITE_API_URL: "" })).toBe("");
    expect(resolveBaseUrl({})).toBe("http://127.0.0.1:3001");
  });
});

describe("NetworkError environment vocabulary (mandate §10)", () => {
  it("production error: honest service-unavailable message, NO dev instruction, environment=production", () => {
    const err = new NetworkError(new Error("boom"), { production: true });
    expect(err.environment).toBe("production");
    expect(err.message).toContain("Research service unavailable");
    expect(err.message).not.toContain("npm run api");
    expect(err.message).not.toContain("localhost");
  });

  it("development error: local guidance with the dev instruction, environment=development", () => {
    const err = new NetworkError(new Error("boom"), { production: false });
    expect(err.environment).toBe("development");
    expect(err.message).toContain("npm run api");
  });
});

describe("ApiError preserves the backend's typed vocabulary", () => {
  it("carries code/status/confirmation untouched", () => {
    const err = new ApiError("INSUFFICIENT_EVIDENCE", "not enough evidence", 422, { stepIndex: 1, reason: "awaiting confirmation" });
    expect(err.code).toBe("INSUFFICIENT_EVIDENCE");
    expect(err.httpStatus).toBe(422);
    expect(err.confirmation?.stepIndex).toBe(1);
  });
});

describe("BackendDownNote renders environment-appropriate guidance (mandate §10)", () => {
  it("production NetworkError → no dev instruction in the DOM", () => {
    const err = new NetworkError(new Error("x"), { production: true });
    const html = renderToStaticMarkup(<BackendDownNote error={err} />);
    expect(html).toContain("Research service unavailable.");
    expect(html).toContain("try again shortly");
    expect(html).not.toContain("npm run api");
  });

  it("development NetworkError → dev instruction present", () => {
    const err = new NetworkError(new Error("x"), { production: false });
    const html = renderToStaticMarkup(<BackendDownNote error={err} />);
    expect(html).toContain("npm run api");
  });

  it("ApiError keeps the backend's typed code visible", () => {
    const html = renderToStaticMarkup(
      <BackendDownNote error={new ApiError("MODEL_FAILURE", "model unavailable", 502)} />,
    );
    expect(html).toContain("MODEL_FAILURE");
    expect(html).not.toContain("npm run api");
  });
});

describe("single fetch boundary (mandate §12)", () => {
  it("client.ts is the ONLY frontend source file calling fetch", () => {
    const root = join(import.meta.dirname, "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          const text = readFileSync(full, "utf8");
          if (/\bfetch\s*\(/.test(text) && !full.endsWith("client.ts")) offenders.push(full);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
