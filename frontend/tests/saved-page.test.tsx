/**
 * Saved route render test (Phase C): `/saved` must exist as a real library page inside the app
 * shell — the audit's finding was that "Saved" was a memory+artifact fragment that was not a
 * workspace at all.
 *
 * Render-only (no jsdom): asserts the page's initial server-rendered state (loading + structure).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AppRoutes } from "../src/routes.js";
vi.mock("../src/auth.js", () => ({
  authActive: true,
  useAuth: () => ({ loading: false, user: { uid: "uid-test", email: "t@example.com", emailVerified: true, provider: "google.com", label: "t" }, authActive: true, token: async () => "test-token" }),
  logout: async () => {},
}));

describe("saved route", () => {
  it("renders the Saved library (kind tabs + honest loading state) inside the app shell", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/saved"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(html).toContain("Search saved artifacts");
    expect(html).toContain("Loading saved artifacts");
    expect(html).toContain("Watch Next");
    expect(html).toContain("Saved");
    // It states the Saved-vs-History distinction.
    expect(html).toContain("History keeps everything researched");
  });
});
