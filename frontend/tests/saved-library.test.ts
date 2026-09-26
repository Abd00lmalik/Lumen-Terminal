/**
 * Phase C frontend: Saved library helpers (DOM-free).
 *
 * The bug these lock down: a saved artifact's identity must be its ORIGIN (research + kind +
 * source object), never its title text — otherwise the SAVE/SAVED state comparison silently
 * mismatches and the control never flips to SAVED.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAVED_KIND_TABS, savedKey, savedKeyOf, filterSaved, savedKindLabel, SAVED_PAGE_SIZE } from "../src/data/saved.js";
import { savedItemFromDto } from "../src/data/adapters.js";
import type { SavedItemDto } from "../src/api/types.js";

const SRC = join(import.meta.dirname, "..", "src");
const savedPage = readFileSync(join(SRC, "pages", "SavedPage.tsx"), "utf8");
const workspacePage = readFileSync(join(SRC, "pages", "ResearchWorkspacePage.tsx"), "utf8");
const routes = readFileSync(join(SRC, "routes.tsx"), "utf8");
const shell = readFileSync(join(SRC, "components", "AppShell.tsx"), "utf8");

function dto(overrides: Partial<SavedItemDto> = {}): SavedItemDto {
  return {
    savedId: "sa_000001",
    kind: "RESEARCH",
    title: "What is affecting BTC right now?",
    summary: "BTC is bid on ETF inflows",
    researchRef: "rs_000001",
    sourceRef: "rs_000001",
    tags: [],
    createdAt: "2026-03-12T08:00:00.000Z",
    updatedAt: "2026-03-12T08:00:00.000Z",
    content: "BTC is bid on ETF inflows",
    derivedFromRefs: ["rs_000001"],
    rationale: "trader saved it",
    provenance: [{ at: "2026-03-12T08:00:00.000Z", originKind: "trader" }],
    origin: { researchRef: "rs_000001", question: "What is affecting BTC right now?", available: true },
    ...overrides,
  };
}

describe("saved identity", () => {
  it("is origin + kind + source, never title text", () => {
    expect(savedKey("rs_000001", "RESEARCH", undefined)).toBe("rs_000001::RESEARCH::rs_000001");
    expect(savedKey("rs_000001", "JUDGMENT", "jd_000002")).toBe("rs_000001::JUDGMENT::jd_000002");
    // A saved item's key matches the backend identity regardless of its title.
    expect(savedKeyOf({ researchRef: "rs_000001", kind: "JUDGMENT", sourceRef: "jd_000002" })).toBe("rs_000001::JUDGMENT::jd_000002");
  });
});

describe("saved library structure + filtering", () => {
  it("exposes the library kinds in the required order", () => {
    expect(SAVED_KIND_TABS.map((t) => t.label)).toEqual(["All", "Research", "Judgments", "Evidence", "Insights", "Watch Next"]);
    expect(SAVED_KIND_TABS[0]!.value).toBe("ALL");
    expect(SAVED_PAGE_SIZE).toBeGreaterThan(0);
  });

  it("labels kinds for humans", () => {
    expect(savedKindLabel("WATCH_NEXT")).toBe("watch next");
    expect(savedKindLabel("UNKNOWN_KIND")).toBe("unknown_kind");
  });

  it("filters by kind and searches title/summary/tags", () => {
    const items = [
      { kind: "RESEARCH" as const, title: "BTC flows", summary: "inflows", tags: ["btc"] },
      { kind: "JUDGMENT" as const, title: "Verdict", summary: "bullish now", tags: [] },
      { kind: "WATCH_NEXT" as const, title: "Watch funding", summary: "funding flips", tags: ["watch"] },
    ];
    expect(filterSaved(items, "JUDGMENT", "").length).toBe(1);
    expect(filterSaved(items, "ALL", "flows").length).toBe(1);
    expect(filterSaved(items, "ALL", "funding").length).toBe(1);
    expect(filterSaved(items, "ALL", "nothing").length).toBe(0);
  });

  it("adapts a DTO verbatim (no fabricated fields)", () => {
    const view = savedItemFromDto(dto());
    expect(view.savedId).toBe("sa_000001");
    expect(view.kind).toBe("RESEARCH");
    expect(view.origin?.available).toBe(true);
    // A summary row (no content/provenance) omits those fields instead of inventing them.
    const summary = savedItemFromDto(dto({ content: undefined as never }));
    expect(summary.content).toBeUndefined();
  });
});

describe("saved page + navigation exist and expose the required affordances", () => {
  it("is routed and reachable from the primary navigation", () => {
    expect(routes).toContain('<Route path="/saved" element={<SavedPage />} />');
    expect(shell).toMatch(/\{\s*to:\s*"\/saved",\s*label:\s*"Saved"/);
  });

  it("renders the library: kind tabs, search, open and unsave, provenance context", () => {
    expect(savedPage).toContain("SAVED_KIND_TABS");
    expect(savedPage).toContain("Search saved artifacts");
    expect(savedPage).toContain("open");
    expect(savedPage).toContain("unsave");
    expect(savedPage).toContain("Saved from research:");
    expect(savedPage).toContain("Open original research");
    expect(savedPage).toContain("Loading saved artifacts");
    expect(savedPage).toContain("Nothing saved yet");
  });

  it("depends only on the backend for saved state (never browser-local storage)", () => {
    expect(savedPage).not.toContain("localStorage.setItem");
    expect(savedPage).not.toContain("localStorage.getItem");
    expect(savedPage).toContain("listSaved");
    expect(savedPage).toContain("deleteSaved");
  });
});

describe("research page contextual save controls", () => {
  it("exposes save for research, judgment, evidence, insight and watch-next", () => {
    expect(workspacePage).toContain('saveControl("RESEARCH"');
    expect(workspacePage).toContain('saveControl("JUDGMENT"');
    expect(workspacePage).toContain('saveControl("EVIDENCE"');
    expect(workspacePage).toContain('saveControl("INSIGHT"');
    expect(workspacePage).toContain('saveControl("WATCH_NEXT"');
  });

  it("shows an explicit SAVE / SAVED / UNSAVE state and never fakes persistence", () => {
    expect(workspacePage).toContain(">saved<"); // the SAVED badge
    expect(workspacePage).toContain("unsave");
    expect(workspacePage).toContain("Not saved:"); // a failed write never reads as Saved
    expect(workspacePage).toContain("createSaved");
    expect(workspacePage).toContain("deleteSaved");
  });
});
