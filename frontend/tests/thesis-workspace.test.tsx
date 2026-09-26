/**
 * Phase D frontend: Saved-by-research filtering (SAVED-RUN-004) and the Thesis workspace.
 *
 * DOM-free assertions on the real source + a server-render smoke test of the /thesis route,
 * matching this repo's existing frontend test style.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../src/routes.js";

const SRC = join(import.meta.dirname, "..", "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const savedPage = read("pages/SavedPage.tsx");
const workspacePage = read("pages/ResearchWorkspacePage.tsx");
const thesisPage = read("pages/ThesisPage.tsx");
const savedApi = read("api/saved.ts");
const thesisApi = read("api/thesis.ts");
const routes = read("routes.tsx");

describe("SAVED-RUN-004: Saved filtering uses the backend, never a client-side filter", () => {
  it("the Saved service sends researchRef to the backend", () => {
    expect(savedApi).toContain("query.researchRef");
    expect(savedApi).toContain('params.set("researchRef"');
  });

  it("the research page shows a 'Saved from this research' section fed by ?researchRef=", () => {
    expect(workspacePage).toContain("SavedFromResearch");
    expect(workspacePage).toContain('listSaved({ researchRef: runRef');
    expect(workspacePage).toContain("saved from this research");
  });

  it("the Saved library applies the run filter server-side and supports deep links", () => {
    expect(savedPage).toContain('searchParams.get("researchRef")');
    expect(savedPage).toContain("researchRef: runFilter.trim()");
    expect(savedPage).toContain('searchParams.get("open")');
    expect(savedPage).toContain("clear filter");
  });
});

describe("Phase D thesis workspace", () => {
  it("is routed (list + detail) and uses explicit API actions only", () => {
    expect(routes).toContain('<Route path="/thesis" element={<ThesisPage />} />');
    expect(routes).toContain('<Route path="/thesis/:ref" element={<ThesisPage />} />');
    expect(thesisApi).toContain("createThesis");
    expect(thesisApi).toContain("updateThesis");
    expect(thesisApi).toContain("setThesisStatus");
    expect(thesisApi).toContain("archiveThesis");
    expect(thesisApi).toContain("linkThesisSaved");
  });

  it("renders the central question: belief, support, and what would change it", () => {
    expect(thesisPage).toContain("What would prove this wrong?");
    expect(thesisPage).toContain("supporting evidence");
    expect(thesisPage).toContain("counterevidence");
    expect(thesisPage).toContain("assumptions");
    expect(thesisPage).toContain("material conditions");
    expect(thesisPage).toContain("linked research");
    expect(thesisPage).toContain("linked saved artifacts");
    expect(thesisPage).toContain("current assessment");
  });

  it("offers only domain-allowed status transitions and never a trading surface", () => {
    expect(thesisPage).toContain("allowedTransitions");
    expect(thesisPage).not.toContain("localStorage.setItem");
    expect(thesisPage).not.toMatch(/place (an )?order|execute trade|buy now/i);
  });

  it("renders the Thesis route inside the app shell (server render smoke)", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/thesis"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(html).toContain("Thesis");
    expect(html).toContain("What you believe, what supports it, and what would change your mind.");
  });
});
