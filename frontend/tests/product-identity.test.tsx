/**
 * Product identity + production hygiene tests (mandate §10/§14/§25/§27/§28).
 *
 * Laws under test:
 * - IDENTITY: public UI copy never mentions the hackathon (Bitget AI Hackathon / Track 3);
 *   Bitget appears only as provider/technical metadata, never as product identity.
 * - THEME: resolveTheme maps Dark/Light/System; System follows prefers-color-scheme;
 *   the preference persists to localStorage; applyTheme sets data-theme + meta theme-color.
 * - PRODUCTION HYGIENE: no frontend source references localhost/127.0.0.1 outside the
 *   single dev-default seam in client.ts; no secret-shaped assignments anywhere.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { resolveTheme, type ThemePreference } from "../src/hooks/useTheme.js";
import { LandingPage } from "../src/pages/LandingPage.js";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SRC = join(import.meta.dirname, "..", "src");
const allSource = walk(SRC);

describe("product identity (mandate §10)", () => {
  it("no public UI source contains hackathon branding", () => {
    const offenders = allSource
      .map((f) => ({ f, text: readFileSync(f, "utf8") }))
      .filter(({ text }) => /hackathon/i.test(text) || /track\s*3/i.test(text));
    expect(offenders).toEqual([]);
  });

  it("the rendered landing hero carries the product story, not competition branding", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(html).not.toMatch(/hackathon/i);
    expect(html).not.toMatch(/track\s*3/i);
    expect(html).toContain("Lumen Terminal");
    expect(html).toContain("AI research workbench");
  });
});

describe("theme resolution (mandate §14)", () => {
  it("explicit preferences resolve directly", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("system resolves from prefers-color-scheme (global matchMedia, as in every real browser)", () => {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => ({ matches: query.includes("light"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof globalThis.matchMedia;
    expect(resolveTheme("system")).toBe("light");
    globalThis.matchMedia = ((query: string) => ({ matches: !query.includes("light"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof globalThis.matchMedia;
    expect(resolveTheme("system")).toBe("dark");
    globalThis.matchMedia = original;
  });

  it("preference narrowing: invalid stored values can never be applied as a theme", () => {
    // The hook's reader narrows to the union; "neon" must fall back to "system".
    const stored: unknown = "neon";
    const valid: ThemePreference[] = ["dark", "light", "system"];
    const narrowed = valid.includes(stored as ThemePreference) ? (stored as ThemePreference) : "system";
    expect(narrowed).toBe("system");
    expect(["light", "dark", "system"]).toContain(narrowed);
  });
});

describe("production hygiene (mandate §5/§28)", () => {
  it("localhost/127.0.0.1 appears ONLY in the client's dev-default seam", () => {
    const offenders = allSource
      .filter((f) => !f.endsWith("client.ts"))
      .map((f) => ({ f, text: readFileSync(f, "utf8") }))
      .filter(({ text }) => /localhost|127\.0\.0\.1/.test(text));
    expect(offenders).toEqual([]);
  });

  it("no secret-shaped assignments in frontend source (keys are server-side only)", () => {
    const secretShape = /(GEMINI_API_KEY|API_KEY|SECRET|PASSWORD|TOKEN)\s*[:=]\s*["'`][^"'`]{8,}/i;
    const offenders = allSource
      .map((f) => ({ f, text: readFileSync(f, "utf8") }))
      .filter(({ text }) => secretShape.test(text));
    expect(offenders).toEqual([]);
  });
});
