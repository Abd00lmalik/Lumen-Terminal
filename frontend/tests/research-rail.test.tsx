/**
 * RESEARCH STATE RAIL + LABEL SEPARATION (manual test 1, regressions R2/R3/R4).
 *
 * The acceptance failure: the rail asserted "No active research" beside a live investigation
 * whose selected run was persisted (INSUFFICIENT/FAILED) — because activeResearchTarget only
 * ever holds COMPLETED runs, the member-ref ≠ turn-ref equality gate broke, and the Empty
 * branch rendered anyway. Three DISTINCT facts were collapsed into one guess.
 *
 * `researchRailState` decides ONCE: execution state → the selected run's OWN record-first
 * state → the snapshot's COMPLETED active research (scoped) → genuinely empty (with a hint
 * matching whether a thread exists). The component only renders the decided state, so the
 * rail can never re-derive "current" itself.
 *
 * Also locked here: Home rows show the record's OUTCOME with currentness as its OWN badge
 * (History parity), and adjacent text-bearing labels are separated in source (`{" "}` —
 * whitespace-only text nodes are ignored by flex layout, so spacing is unchanged, while text
 * extraction / screen readers read separate words instead of "INSUFFICIENTresearch...").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { researchRailState } from "../src/pages/researchView.js";
import { ResearchStateRail } from "../src/components/ResearchStateRail.js";
import { homeDataFromSnapshot } from "../src/data/adapters.js";
import type { ContinuitySnapshotDto, ResearchRunSummaryDto } from "../src/api/types.js";

const SRC = join(import.meta.dirname, "..", "src");
const readSource = (dir: string, file: string): string =>
  readFileSync(join(SRC, dir, file), "utf8").replace(/\r\n/g, "\n");
const workspacePage = readSource("pages", "ResearchWorkspacePage.tsx");
const historyPage = readSource("pages", "HistoryPage.tsx");
const homePage = readSource("pages", "HomePage.tsx");
const activePage = readSource("pages", "ActiveResearchPage.tsx");
const ui = readSource("components", "ui.tsx");

/** Rendered text with tags stripped and whitespace collapsed — what a reader actually reads. */
const renderedText = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// The ONE rail decision (pure)
// ---------------------------------------------------------------------------

describe("research rail: four distinct facts, decided once (R2)", () => {
  const snapshotActive = { ref: "rs_000363", flow: "WHAT_HAPPENED", status: "COMPLETED", evidenceCount: 3 };
  const activeRun = { ref: "rs_000365", status: "INSUFFICIENT", flow: "WHAT_HAPPENED", evidenceCount: 0 };

  it("execution state wins: while running, no run and no snapshot render", () => {
    const state = researchRailState({
      running: true,
      runningQuestion: "Why did BTC move?",
      runningStage: "ingest",
      activeRun,
      snapshotActive,
      railScoped: true,
      hasInvestigation: true,
    });
    expect(state).toEqual({ kind: "running", question: "Why did BTC move?", stage: "ingest" });
  });

  it("the SELECTED RUN's own record wins over the snapshot — never an empty state (the acceptance failure)", () => {
    // Production shape: snapshot.activeResearch holds a COMPLETED sibling (rs_000363) with a
    // member ref that never equals the turn ref (rs_000365), so the old equality gate failed
    // and the Empty branch rendered beside the live investigation.
    const state = researchRailState({ running: false, activeRun, snapshotActive, railScoped: false, hasInvestigation: true });
    expect(state.kind).toBe("run");
    if (state.kind !== "run") throw new Error("expected the run branch");
    expect(state.ref).toBe("rs_000365");
    // Record-first: the outcome decides, exactly as the opened run view shows it.
    expect(state.status).toBe("INSUFFICIENT");
    expect(state.flow).toBe("WHAT_HAPPENED");
    expect(state.evidenceCount).toBe(0);
  });

  it("the selected run needs no row facts to show its state (flow/evidence are optional)", () => {
    const state = researchRailState({
      running: false,
      activeRun: { ref: "rs_000365", status: "FAILED" },
      railScoped: true,
      hasInvestigation: true,
    });
    expect(state).toEqual({ kind: "run", ref: "rs_000365", status: "FAILED" });
    expect("flow" in state).toBe(false);
    expect("evidenceCount" in state).toBe(false);
  });

  it("the snapshot only speaks when it describes the active view (scoped), as its own fact", () => {
    const scoped = researchRailState({ running: false, snapshotActive, railScoped: true, hasInvestigation: true });
    expect(scoped).toEqual({ kind: "run", ...snapshotActive });

    const stale = researchRailState({ running: false, snapshotActive, railScoped: false, hasInvestigation: true });
    expect(stale.kind).toBe("empty");
  });

  it("empty splits honestly: a thread exists → open a run; no thread → ask a question", () => {
    const withThread = researchRailState({ running: false, railScoped: false, hasInvestigation: true });
    expect(withThread).toEqual({
      kind: "empty",
      hint: "Open a run from this investigation to see its research state.",
    });
    const newWorkspace = researchRailState({ running: false, railScoped: false, hasInvestigation: false });
    expect(newWorkspace).toEqual({
      kind: "empty",
      hint: "Ask a question to start a new investigation.",
    });
  });
});

// ---------------------------------------------------------------------------
// The component renders the decided state (rendered report, not just the helper)
// ---------------------------------------------------------------------------

describe("ResearchStateRail renders exactly the decided state", () => {
  const refresh = () => {};

  it("running: execution state only", () => {
    const html = renderToStaticMarkup(
      <ResearchStateRail state={researchRailState({ running: true, runningQuestion: "Why did BTC move?", runningStage: "ingest", railScoped: false, hasInvestigation: false })} onRefresh={refresh} />,
    );
    const text = renderedText(html);
    expect(text).toMatch(/research running/);
    expect(text).toMatch(/stage ingest/);
    expect(text).toContain("Why did BTC move?");
    expect(text).not.toContain("No active research");
  });

  it("a persisted INSUFFICIENT run shows ITS state, record-first, with spaced labels", () => {
    const html = renderToStaticMarkup(
      <ResearchStateRail
        state={researchRailState({
          running: false,
          activeRun: { ref: "rs_000365", status: "INSUFFICIENT", flow: "WHAT_HAPPENED", evidenceCount: 4 },
          railScoped: false,
          hasInvestigation: true,
        })}
        onRefresh={refresh}
      />,
    );
    const text = renderedText(html);
    expect(text).toMatch(/research rs_000365/);
    expect(text).toMatch(/status INSUFFICIENT/);
    expect(text).toMatch(/flow what happened/);
    expect(text).toMatch(/evidence 4/);
    expect(text).not.toContain("No active research");
    for (const glyph of ["▲", "▼", "◇", "⊘", "◆"]) expect(text).not.toContain(glyph);
    expect(text).not.toContain("**");
  });

  it("the empty state separates 'no active research' from the thread's existence", () => {
    const withThread = renderToStaticMarkup(
      <ResearchStateRail state={researchRailState({ running: false, railScoped: false, hasInvestigation: true })} onRefresh={refresh} />,
    );
    const threadText = renderedText(withThread);
    expect(threadText).toContain("No active research");
    expect(threadText).toContain("Open a run from this investigation to see its research state.");
    expect(threadText).not.toContain("Ask a question to start");

    const fresh = renderToStaticMarkup(
      <ResearchStateRail state={researchRailState({ running: false, railScoped: false, hasInvestigation: false })} onRefresh={refresh} />,
    );
    const freshText = renderedText(fresh);
    expect(freshText).toContain("No active research");
    expect(freshText).toContain("Ask a question to start a new investigation.");
  });
});

// ---------------------------------------------------------------------------
// Home = History parity (R1): outcome first, currentness its own badge
// ---------------------------------------------------------------------------

describe("Home rows speak the record's outcome, with currentness as its own badge", () => {
  const snapshot = {
    recentEvidence: [],
    currentClaims: [],
    currentHypotheses: [],
    savedArtifacts: [],
    monitorProposals: [],
    activeMonitors: [],
    memories: [],
    unresolvedUncertainties: [],
    importantContradictions: [],
  } as unknown as ContinuitySnapshotDto;

  const row = (overrides: Partial<ResearchRunSummaryDto>): ResearchRunSummaryDto => ({
    ref: "rs_000086",
    objective: "What happened to BTC?",
    question: "What happened to BTC?",
    flow: "WHAT_HAPPENED",
    status: "FAILED",
    isCurrent: false,
    evidenceRefs: [],
    claimRefs: [],
    hypothesisRefs: [],
    judgmentRefs: [],
    history: [],
    ...overrides,
  } as unknown as ResearchRunSummaryDto);

  it("the exact production divergence: outcome INSUFFICIENT beside lifecycle status FAILED", () => {
    const home = homeDataFromSnapshot(snapshot, [row({ outcome: "INSUFFICIENT" as const, status: "FAILED" })]);
    expect(home.research).toHaveLength(1);
    // Outcome first — the opened run view renders INSUFFICIENT, so the Home row says it too.
    expect(home.research[0]!.status).toBe("INSUFFICIENT");
    // Current-ness is a DIFFERENT fact, kept explicit and never merged into the badge.
    expect(home.research[0]!.isCurrent).toBe(false);
  });

  it("falls back to lifecycle status only when no record is retained, and keeps isCurrent", () => {
    const home = homeDataFromSnapshot(snapshot, [row({ status: "FAILED" }), row({ ref: "rs_000087", status: "COMPLETED", isCurrent: true })]);
    expect(home.research.find((r) => r.ref === "rs_000086")!.status).toBe("FAILED");
    expect(home.research.find((r) => r.ref === "rs_000087")!.isCurrent).toBe(true);
  });

  it("Home partitions on ACTIVE or explicit isCurrent — never on a CURRENT status string", () => {
    expect(homePage).toContain('research.filter((r) => r.status === "ACTIVE" || r.isCurrent === true)');
    expect(homePage).toContain("status: historyDisplayStatus(r)");
    expect(homePage).toContain("isCurrent: r.isCurrent === true");
  });

  it("Home badge rows separate the status badge from the current badge in source", () => {
    const separators = homePage.match(/<StatusBadge status=\{r\.status\} \/>\{" "\}/g) ?? [];
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Label separation in source (R4): `{" "}` between adjacent text-bearing siblings
// ---------------------------------------------------------------------------

describe("adjacent text-bearing labels are separated (layout-neutral, flex-safe)", () => {
  it("KV and Panel separate their label/value and kicker/title pairs", () => {
    expect(ui).toContain('<span className="k">{k}</span>{" "}<span className="v">{v}</span>');
    const head = ui.slice(ui.indexOf('className="panel-head"'), ui.indexOf("</header>", ui.indexOf('className="panel-head"')));
    expect(head.split('{" "}').length - 1).toBeGreaterThanOrEqual(2);
  });

  it("the run status row separates badge, action, lineage, resolution and stop reason", () => {
    expect(workspacePage).toMatch(/<StatusBadge status=\{shownStatus\} \/>\s*\{" "\}/);
    // The exact production run-together: "INSUFFICIENT" + "research" + "question not answered".
    expect(workspacePage).toMatch(/<span className="mono"[^>]*>\{run\.action\.toLowerCase\(\)\}<\/span>\s*\{" "\}/);
    expect(workspacePage).toMatch(/\)\}\s*\{" "\}\s*\{resolution !== undefined && \(/);
  });

  it("the diagnostics rows separate their KV cells and requirement-ledger spans", () => {
    expect(workspacePage).toMatch(/<KV k="gate" v=\{d\.completionGate\} \/>\s*\{" "\}/);
    expect(workspacePage).toMatch(/\{r\.description\}\{" "\}\s*<span className="mono"/);
  });

  it("History's row-right separates the outcome badge from current/follow-up/resolution", () => {
    expect(historyPage).toMatch(/<StatusBadge status=\{historyDisplayStatus\(e\)\} \/>\s*\{" "\}/);
    expect(historyPage).toMatch(/\{" "\}\s*\{e\.followUpDepth !== undefined/);
  });

  it("ActiveResearch's quality rows separate their label cells", () => {
    expect(activePage).toMatch(/<span className="counts">coverage \{d\.coverage\.toLowerCase\(\)\}<\/span>\s*\{" "\}/);
    expect(activePage).toMatch(/<\/span>\s*\{" "\}\s*<span className="counts">\{c\.covered\}/);
  });

  it("the rail component itself is glyph-free and never emits raw markdown", () => {
    // Comments stripped: a doc-comment opener is not markdown reaching the screen.
    const railSource = readSource("components", "ResearchStateRail.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const glyph of ["▲", "▼", "◇", "⊘", "◆"]) expect(railSource).not.toContain(glyph);
    expect(railSource).not.toContain("**");
  });
});
