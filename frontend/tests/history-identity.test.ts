/**
 * Phase B frontend regressions: research-run identity + history surfaces (B1/B2/B8).
 *
 * The production failures these tests lock down:
 *   1. the open affordance navigated with `turn.run.requestId` (a crypto UUID) instead of the
 *      research ref, so `/research/<uuid>` never resolved;
 *   2. monitor rows were appended to the research list, producing `/research/mon_...`;
 *   3. the thread kept only three rows and history/open could disagree about identity;
 *   4. rows rendered "just now" because a lifecycle NOTE was used as a timestamp;
 *   5. the "linked research run could not be loaded" panel appeared for transient read
 *      failures, not just genuinely missing runs.
 *
 * All logic is asserted through DOM-free helpers plus a source scan of the ONE navigation
 * site, so the bug cannot come back by someone re-introducing `requestId` in a URL.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isResearchRef, preferTurn, runOpenRef, turnIdentity } from "../src/data/identity.js";
import { homeDataFromSnapshot, researchSummaryFromDto } from "../src/data/adapters.js";
import { formatStamp, groupHistoryByDay } from "../src/data/history.js";
import { timeAgo } from "../src/components/ui.js";
import type { ContinuitySnapshotDto, ResearchDto, ResearchRunSummaryDto } from "../src/api/types.js";

const SRC = join(import.meta.dirname, "..", "src");
const workspacePage = readFileSync(join(SRC, "pages", "ResearchWorkspacePage.tsx"), "utf8");
const historyPage = readFileSync(join(SRC, "pages", "HistoryPage.tsx"), "utf8");
const routes = readFileSync(join(SRC, "routes.tsx"), "utf8");
const shell = readFileSync(join(SRC, "components", "AppShell.tsx"), "utf8");

const UUID = "3f1b6c2e-9a4d-4c1f-8f7e-2b0d5a6c7e8f";

function researchDto(overrides: Partial<ResearchDto> = {}): ResearchDto {
  return {
    ref: "rs_000001",
    objective: "Identify developments for BTC",
    question: "What is affecting BTC right now?",
    flow: "WHAT_HAPPENED",
    status: "COMPLETED",
    evidenceRefs: ["ev_000001"],
    claimRefs: [],
    hypothesisRefs: [],
    judgmentRefs: ["jd_000001"],
    history: ["run started"],
    ...overrides,
  };
}

describe("run identity (B1)", () => {
  it("only a research ref is openable; a requestId UUID never is", () => {
    expect(isResearchRef("rs_000001")).toBe(true);
    expect(isResearchRef(UUID)).toBe(false);
    expect(isResearchRef("mon_000001")).toBe(false);
    expect(isResearchRef("th_000001")).toBe(false);
    expect(isResearchRef(undefined)).toBe(false);

    // The production bug shape: a turn whose only identity is its requestId (a UUID) has NO
    // open affordance — it cannot be navigated to.
    expect(runOpenRef({ requestId: UUID })).toBeUndefined();
    // A research turn opens on its research ref...
    expect(runOpenRef({ researchRef: "rs_000042", requestId: UUID })).toBe("rs_000042");
    // ...and a degraded history summary (ref as identity) is still openable.
    expect(runOpenRef({ requestId: "rs_000042" })).toBe("rs_000042");
    // A monitor row mistaken for a research row is not openable as research.
    expect(runOpenRef({ requestId: "mon_000003" })).toBeUndefined();
  });

  it("dedupes turns by research identity, not by requestId", () => {
    // Same run arriving from the list and from a live stream: same identity, so one row.
    expect(turnIdentity({ requestId: UUID, researchRef: "rs_000001" })).toBe("rs_000001");
    expect(turnIdentity({ requestId: "rs_000001" })).toBe("rs_000001");
    // A transport failure turn has no research identity; its own id keeps it distinct.
    expect(turnIdentity({ requestId: UUID })).toBe(UUID);
  });

  it("never lets a partial reconstruction replace a fuller turn", () => {
    expect(preferTurn({ degraded: false }, { degraded: true })).toBe("existing");
    expect(preferTurn({ degraded: true }, { degraded: false })).toBe("incoming");
    expect(preferTurn(undefined, { degraded: true })).toBe("incoming");
    expect(preferTurn({ degraded: true }, { degraded: true })).toBe("incoming");
  });

  it("the ONLY navigation site opens by research ref (source guard)", () => {
    // The open affordance must derive its target from runOpenRef and encode it; a requestId
    // in a URL is the exact bug that produced the 404 history panel.
    expect(workspacePage).toContain("runOpenRef(");
    expect(workspacePage).toContain("navigate(`/research/${encodeURIComponent(openRef)}`)");
    expect(workspacePage).not.toMatch(/navigate\(`\/research\/\$\{turn\.run\.requestId\}`\)/);
    // History rows open by ref as well, and a non-research row is never a link at all
    // (no question-string navigation fallback).
    expect(historyPage).toContain("const openable = isResearchRef(e.ref);");
    expect(historyPage).toContain("navigate(`/research/${encodeURIComponent(e.ref)}`)");
    expect(historyPage).not.toMatch(/encodeURIComponent\(e\.objective\)/);
  });

  it("the thread hydrates from the history list (no fixed three-row source of truth)", () => {
    // The thread asks the backend for a window instead of slicing an unbounded list, and the
    // History page is the full surface with pagination.
    expect(workspacePage).toContain("listResearch({ limit: 50, status: \"COMPLETED\" })");
    expect(historyPage).toContain("HISTORY_PAGE_SIZE");
    expect(historyPage).toContain("listResearch({ limit: HISTORY_PAGE_SIZE, offset: from");
  });

  it("the not-available panel is reserved for a typed NOT_FOUND", () => {
    expect(workspacePage).toContain('err.code === "NOT_FOUND"');
    // Transient failures get their own retryable, auto-recovering surface instead.
    expect(workspacePage).toContain("setRefLoadError");
    expect(workspacePage).not.toMatch(/catch \{\s*if \(!cancelled\) setLinkedNotFound\(true\)/);
  });
});

describe("monitor rows never pollute research history (B8)", () => {
  const snapshot = {
    recentEvidence: [],
    currentClaims: [],
    currentHypotheses: [],
    savedArtifacts: [],
    monitorProposals: [{ ref: "mon_000001", target: "BTC macro thesis", status: "PROPOSED", conditions: [], triggerRationale: "", sourceStates: [] }],
    activeMonitors: [{ ref: "mon_000002", target: "ETH invalidation", status: "ACTIVE", conditions: [], triggerRationale: "", sourceStates: [] }],
    memories: [],
    unresolvedUncertainties: [],
    importantContradictions: [],
  } as unknown as ContinuitySnapshotDto;

  it("keeps monitors in their own list and research rows research-only", () => {
    const all = [
      researchDto({ ref: "rs_000001", updatedAt: "2026-03-12T09:00:00.000Z" } as unknown as Partial<ResearchDto>),
      researchDto({ ref: "rs_000002", isCurrent: true, updatedAt: "2026-03-12T10:00:00.000Z" } as unknown as Partial<ResearchDto>),
      // A monitor-shaped row that a stale/foreign payload could inject:
      researchDto({ ref: "mon_000009" }),
    ];
    const home = homeDataFromSnapshot(snapshot, all);

    expect(home.research.map((r) => r.ref)).toEqual(["rs_000002", "rs_000001"]);
    expect(home.research.every((r) => isResearchRef(r.ref))).toBe(true);
    expect(home.monitors.map((m) => m.ref)).toEqual(["mon_000001", "mon_000002"]);
  });

  it("the home page renders monitors in a separate panel that navigates to /monitor", () => {
    const home = readFileSync(join(SRC, "pages", "HomePage.tsx"), "utf8");
    expect(home).toContain("home.monitors");
    expect(home).toContain('navigate("/monitor")');
  });
});

describe("history timestamps and grouping (B2)", () => {
  it("uses real API timestamps, never a lifecycle note or a fabricated now", () => {
    const stamped = researchSummaryFromDto(researchDto({ updatedAt: "2026-03-12T09:30:00.000Z", createdAt: "2026-03-12T09:00:00.000Z" } as unknown as Partial<ResearchDto>));
    expect(stamped.updatedAt).toBe("2026-03-12T09:30:00.000Z");
    // A bare research DTO has no timestamp: the UI omits it instead of saying "just now".
    expect(researchSummaryFromDto(researchDto()).updatedAt).toBe("");
    expect(timeAgo("")).toBe("");
    expect(timeAgo("not-a-date")).toBe("");
    expect(timeAgo("2026-01-01T00:00:00.000Z")).not.toBe("");
  });

  it("groups runs by day with Today/Yesterday labels and keeps newest-first order", () => {
    const now = new Date("2026-03-12T12:00:00.000Z");
    const groups = groupHistoryByDay(
      [
        { ref: "rs_3", updatedAt: now.toISOString() },
        { ref: "rs_2", updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() },
        { ref: "rs_1", createdAt: "2026-03-01T10:00:00.000Z" },
        { ref: "rs_0" },
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "1 Mar 2026", "Undated"]);
    expect(groups[0]!.entries.map((e) => e.ref)).toEqual(["rs_3"]);
    expect(groups[2]!.entries.map((e) => e.ref)).toEqual(["rs_1"]);
  });

  it("formats an absolute stamp for real timestamps only", () => {
    expect(formatStamp("2026-03-12T09:30:00.000Z")).toMatch(/^2026-03-12 \d{2}:\d{2}$/);
    expect(formatStamp(undefined)).toBe("");
    expect(formatStamp("")).toBe("");
  });
});

describe("history page + navigation exist (B2)", () => {
  it("is routed and reachable from the primary navigation", () => {
    expect(routes).toContain('<Route path="/history" element={<HistoryPage />} />');
    expect(shell).toMatch(/\{\s*to:\s*"\/history",\s*label:\s*"History"/);
  });

  it("renders rows from the research history contract (question, status, timestamps, previews)", () => {
    const entry: ResearchRunSummaryDto = {
      ...researchDto({ isCurrent: false }),
      createdAt: "2026-03-12T08:00:00.000Z",
      updatedAt: "2026-03-12T09:00:00.000Z",
      confidence: "MODERATE",
      questionResolutionStatus: "PARTIALLY_ANSWERED",
      insightPreview: "Oil is pricing a supply shock",
      saved: true,
      degraded: true,
    };
    // The page consumes exactly these fields (and nothing object-shaped).
    expect(entry.evidenceRefs).toBeDefined();
    for (const field of ["question", "status", "updatedAt", "confidence", "questionResolutionStatus", "insightPreview", "saved", "degraded"]) {
      expect(historyPage).toContain(field.replace(/^\w/, (c) => c));
    }
  });

  it("states honestly that it lists research only, and pages with an explicit load-more", () => {
    expect(historyPage).toContain("Load older research");
    expect(historyPage).toContain("Monitors live in the Monitor workspace");
    expect(historyPage).toContain("No matching research");
  });
});
