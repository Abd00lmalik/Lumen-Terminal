/**
 * History route render test (B2): `/history` must exist as a real page inside the app shell —
 * the audit's finding was that there was no History page at all (only a three-row fragment on
 * Home and an orphaned research view).
 *
 * Render-only (no jsdom): the page's initial server-rendered state is asserted, which is also
 * the state a user sees before the first fetch resolves.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../src/routes.js";

describe("history route", () => {
  it("renders the History page (search + honest loading state) inside the app shell", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/history"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(html).toContain("Search your research questions");
    expect(html).toContain("Loading research history");
    expect(html).toContain("History"); // shell title + navigation entry
    // It states what it is: research runs only, monitors elsewhere.
    expect(html).toContain("Monitors live in the Monitor workspace");
  });
});
