/**
 * RESULT PRESENTATION (D7): the research result must read as a visible hierarchy of real
 * sections built from the structured data — never literal `**` markdown, never raw glyph
 * markers, never a JSON dump presented as prose, and never the run's raw `answer` string
 * rendered verbatim as a single paragraph.
 *
 * Production defects under test:
 *  - answers showed "**What happened**" asterisks and ◆▲▼◇ markers as literal text;
 *  - evidence rendered as raw payload blobs with no read path;
 *  - a History row said FAILED while the opened run said INSUFFICIENT for the same record
 *    (summary DTO has no outcome → status shown instead of the record's outcome);
 *  - completion/selection/epoch races (two-click New research, empty research page after a
 *    run, History flash) — guarded here at the source level alongside new-research-reset.
 *
 * Laws: presentation never edits content (markers removed, text verbatim), uncertainty is
 * labelled rather than glyph-coded, and every load/supersession path is epoch-guarded so a
 * late response cannot resurrect the thread being abandoned.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { condenseText, looksLikePayload, parseAnswerSections } from "../src/data/answerSections.js";
import { historyDisplayStatus } from "../src/data/history.js";
import { linkedRunIsPending, mergePendingLiveTurn, selectActiveTurnRef, type IdentifiedTurn } from "../src/pages/researchView.js";
import { AnswerProse } from "../src/components/ui.js";

const SRC = join(import.meta.dirname, "..", "src");
const readSource = (dir: string, file: string): string =>
  readFileSync(join(SRC, dir, file), "utf8").replace(/\r\n/g, "\n");
const workspacePage = readSource("pages", "ResearchWorkspacePage.tsx");
const historyPage = readSource("pages", "HistoryPage.tsx");
const activePage = readSource("pages", "ActiveResearchPage.tsx");
const homePage = readSource("pages", "HomePage.tsx");
const ui = readSource("components", "ui.tsx");

const glyphCount = (text: string, glyph: string): number => text.split(glyph).length - 1;

describe("answer sections parse into a real hierarchy", () => {
  it("recognizes the inline '**Heading:** value' form", () => {
    const sections = parseAnswerSections("**What happened:** BTC fell 4%.\n\n**Why it matters:** Risk-off flows.");
    expect(sections).toHaveLength(2);
    expect(sections[0]!.heading).toBe("What happened");
    expect(sections[0]!.body).toEqual(["BTC fell 4%."]);
    expect(sections[1]!.heading).toBe("Why it matters");
    expect(sections[1]!.body).toEqual(["Risk-off flows."]);
  });

  it("recognizes the own-line '**Heading**' form with its body below", () => {
    const sections = parseAnswerSections("**What happened**\nBTC fell 4% on rising funding.\n\nSecond paragraph stays here.");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.heading).toBe("What happened");
    expect(sections[0]!.body).toHaveLength(2);
    expect(sections[0]!.body[0]).toBe("BTC fell 4% on rising funding.");
    expect(sections[0]!.body[1]).toBe("Second paragraph stays here.");
  });

  it("keeps leading text as a preamble and strips markers without rewording", () => {
    const sections = parseAnswerSections("One-line lead.\n**Bottom line:** unchanged words.");
    expect(sections[0]!.heading).toBeUndefined();
    expect(sections[0]!.body).toEqual(["One-line lead."]);
    const all = JSON.stringify(sections);
    expect(all).not.toContain("**");
    expect(all).toContain("unchanged words.");
  });

  it("renders headings + paragraphs, never literal asterisks or glyph markers", () => {
    const html = renderToStaticMarkup(
      <AnswerProse className="answer-prose" text={"**What happened:** BTC fell 4%.\n\n**Key uncertainty:** funding."} />,
    );
    expect(html).toContain('class="section-h"');
    expect(html).toContain("What happened");
    expect(html).toContain("Key uncertainty");
    expect(html).not.toContain("**");
    for (const glyph of ["◆", "▲", "▼", "◇", "⊘", "↳"]) expect(html).not.toContain(glyph);
  });
});

describe("condense + payload detection (read path vs raw path)", () => {
  it("short prose is shown as-is", () => {
    const out = condenseText("plain sentence", 100);
    expect(out).toEqual({ preview: "plain sentence", full: "plain sentence", truncated: false });
  });

  it("long text keeps the full content for inspection and bounds only the preview", () => {
    const full = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const out = condenseText(full, 40);
    expect(out.truncated).toBe(true);
    expect(out.full).toBe(full);
    expect(out.preview.length).toBeLessThan(full.length);
    expect(out.preview.endsWith("…")).toBe(true);
  });

  it("detects transport payloads so they render monospace, never as prose paragraphs", () => {
    expect(looksLikePayload('{"price": 84000, "src": "okx"}')).toBe(true);
    expect(looksLikePayload('[{"a":1}]')).toBe(true);
    expect(looksLikePayload('"sourceProvider": "binance"')).toBe(true);
    expect(looksLikePayload("Funding rates stayed flat through the drop.")).toBe(false);
  });
});

describe("History row status = the record's own outcome", () => {
  it("shows the retained record's outcome when present", () => {
    expect(historyDisplayStatus({ outcome: "INSUFFICIENT", status: "COMPLETED" })).toBe("INSUFFICIENT");
    expect(historyDisplayStatus({ outcome: "FAILED", status: "COMPLETED" })).toBe("FAILED");
    expect(historyDisplayStatus({ outcome: "COMPLETED", status: "COMPLETED" })).toBe("COMPLETED");
  });

  it("falls back to the lifecycle status only when no record is retained", () => {
    expect(historyDisplayStatus({ status: "RUNNING" })).toBe("RUNNING");
    expect(historyDisplayStatus({ status: "FAILED" })).toBe("FAILED");
  });
});

describe("pending live turn merge + linked-run pending state (pure)", () => {
  type T = { question: string; requestId: string; researchRef?: string };
  const id = (t: T): { question: string; requestId: string; researchRef?: string } => t;

  it("returns the same turns when nothing is pending", () => {
    const turns: T[] = [{ question: "q", requestId: "r" }];
    expect(mergePendingLiveTurn(turns, undefined, id)).toBe(turns);
  });

  it("replaces the just-completed run instead of duplicating it (ref identity)", () => {
    const done: T = { question: "q", requestId: "r1", researchRef: "ref-1" };
    const pending: T = { question: "q", requestId: "r1", researchRef: "ref-1" };
    const out = mergePendingLiveTurn([done], pending, id);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(pending);
  });

  it("replaces by question when no ref is known yet, and by requestId otherwise", () => {
    const byQuestion: T = { question: "same", requestId: "a" };
    const pendingQuestion: T = { question: "same", requestId: "b" };
    expect(mergePendingLiveTurn([byQuestion], pendingQuestion, id)).toHaveLength(1);
    const one: T = { question: "one", requestId: "x" };
    const two: T = { question: "two", requestId: "x" };
    expect(mergePendingLiveTurn([one], two, id)).toHaveLength(1);
  });

  it("keeps an unrelated existing run when a new one is pending", () => {
    const other: T = { question: "old", requestId: "o", researchRef: "ref-old" };
    const pending: T = { question: "new", requestId: "n", researchRef: "ref-new" };
    const out = mergePendingLiveTurn([other], pending, id);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(pending);
  });

  it("a linked run is pending only while it is actually loading", () => {
    expect(linkedRunIsPending({ linkedRef: "r1", runLoaded: false, notFound: false, loadFailed: false })).toBe(true);
    expect(linkedRunIsPending({ linkedRef: "r1", runLoaded: true, notFound: false, loadFailed: false })).toBe(false);
    expect(linkedRunIsPending({ linkedRef: "r1", runLoaded: false, notFound: true, loadFailed: false })).toBe(false);
    expect(linkedRunIsPending({ linkedRef: "r1", runLoaded: false, notFound: false, loadFailed: true })).toBe(false);
    expect(linkedRunIsPending({ runLoaded: false, notFound: false, loadFailed: false })).toBe(false);
    expect(linkedRunIsPending({ linkedRef: "", runLoaded: false, notFound: false, loadFailed: false })).toBe(false);
  });
});

describe("URL-linked run owns the active area (pure selectActiveTurnRef)", () => {
  const turns: readonly IdentifiedTurn[] = [
    { question: "What could affect NVDA around earnings?", requestId: "r1", researchRef: "rs_000051" },
    { question: "What is driving oil prices this week?", requestId: "r2", researchRef: "rs_000052" },
  ];

  it("a pinned link beats the newest-run fallback (the opened History row is THE result)", () => {
    expect(selectActiveTurnRef({ turns, running: false, pinnedRef: "rs_000051" })).toBe("rs_000051");
    expect(selectActiveTurnRef({ turns, running: false, pinnedRef: "rs_000052" })).toBe("rs_000052");
  });

  it("while a run is in flight even a pinned link never becomes active", () => {
    expect(selectActiveTurnRef({ turns, running: true, pinnedRef: "rs_000051" })).toBeUndefined();
  });

  it("a just-completed run still wins over the pinned link (fresh answer stays visible)", () => {
    expect(selectActiveTurnRef({ turns, running: false, pinnedRef: "rs_000051", liveRef: "rs_000053" })).toBe("rs_000053");
  });

  it("an explicit selection outranks the pinned link (later user intent wins)", () => {
    expect(selectActiveTurnRef({ turns, running: false, pinnedRef: "rs_000052", viewedRef: "rs_000051" })).toBe("rs_000051");
  });
});

describe("workspace result surface: selection/epoch guards (source)", () => {
  it("the New-research epoch bump is FIRST — before stream reset and before creating a new investigation", () => {
    const bump = workspacePage.indexOf("stateEpoch.current += 1;");
    expect(bump).toBeGreaterThan(-1);
    expect(workspacePage.indexOf("resetStream();")).toBeGreaterThan(bump);
    expect(workspacePage.indexOf("void startNewInvestigation()")).toBeGreaterThan(bump);
    expect(workspacePage).toContain("if (!isNewResearchRequest(location.state)) return;");
  });

  it("every async read checks the epoch before writing state", () => {
    // refresh + refreshInvestigation each capture on entry and re-check before each write.
    expect(workspacePage.split("const epoch = stateEpoch.current;").length - 1).toBe(2);
    expect(workspacePage.split("if (epoch !== stateEpoch.current) return;").length - 1).toBeGreaterThanOrEqual(4);
  });

  it("a failed investigation read never wipes what is on screen", () => {
    const start = workspacePage.indexOf("const refreshInvestigation = useCallback");
    expect(start).toBeGreaterThan(-1);
    const body = workspacePage.slice(start, workspacePage.indexOf("}, []);", start));
    expect(body).toContain("// A TRANSIENT read failure keeps whatever is on screen");
    expect(body).not.toContain("setInvestigation(undefined);");
  });

  it("completion selects the new run and clears supersession so the result is visible", () => {
    const completion = workspacePage.indexOf("if (liveRef !== undefined) setViewedRef(liveRef);");
    expect(completion).toBeGreaterThan(-1);
    expect(workspacePage.slice(completion, completion + 120)).toContain("setLiveSuperseded(false);");
  });

  it("the empty state cannot flash over a linked run, a live stream or a stored result", () => {
    expect(workspacePage).toContain(
      "displayRuns.length === 0 && !stream.running && stream.result === undefined && !linkedPending && ws.loadError === undefined &&",
    );
    // While the linked run is still loading, an explicit panel renders — never Empty.
    expect(workspacePage).toContain("{linkedPending && (");
    expect(workspacePage).toContain('title="Opening saved research…"');
    expect(workspacePage).toContain("linkedRunIsPending({");
  });

  it("the URL-linked run is pinned active and retained across a thread replacement", () => {
    expect(workspacePage).toContain("pinnedRef: linkedRef");
    expect(workspacePage).toContain("const linked = linkedRefRef.current;");
    expect(workspacePage).toContain("if (linked === undefined) return historyTurns;");
    expect(workspacePage).toContain("setLiveSuperseded(true);");
  });

  it("the completion turn is merged into the thread (never only appended after paint)", () => {
    expect(workspacePage).toContain("mergePendingLiveTurn(");
    expect(workspacePage).toContain("const pendingLiveTurn: Turn | undefined =");
    expect(workspacePage).toContain("displayRuns = mergePendingLiveTurn(");
  });
});

describe("run status vocabulary is the record's, never the synthesized one (source)", () => {
  it("summary turns carry their own status as displayStatus", () => {
    expect(workspacePage).toContain("displayStatus: dto.status,");
  });

  it("transport failures READ as FAILED while the retained outcome stays untouched", () => {
    expect(workspacePage).toContain('const displayStatus = outcome === "COMPLETED" ? "FAILED" : undefined;');
    expect(workspacePage).toContain('(displayStatus !== undefined ? { displayStatus } : {})');
  });

  it("the header, badge and panel title all key off the same shown status", () => {
    expect(workspacePage).toContain("const shownStatus = turn.displayStatus ?? run.outcome;");
    expect(workspacePage).toContain("<StatusBadge status={shownStatus} />");
    expect(workspacePage).toContain("PANEL_TITLES[shownStatus]");
    expect(workspacePage).toContain('FAILED: "Research run failed"');
  });

  it("the History row uses the same vocabulary through historyDisplayStatus", () => {
    expect(historyPage).toContain("historyDisplayStatus(");
    expect(historyPage).toContain("<StatusBadge status={historyDisplayStatus(e)} />");
  });
});

describe("evidence renders as a read path over structured data (source)", () => {
  it("uses the readable rendering first and keeps the raw text one disclosure away", () => {
    expect(workspacePage).toContain("e.displayText ?? item.observation");
    expect(workspacePage).toContain("condenseText(readable, 480)");
    expect(workspacePage).toContain("Inspect raw evidence");
    expect(workspacePage).toContain('className="ev-raw"');
  });

  it("shows a source title and provenance instead of an anonymous dump", () => {
    expect(workspacePage).toContain("const sourceTitle = item.sourceProvider ?? item.sourceRefs[0] ?? e.evidenceType.toLowerCase();");
    expect(workspacePage).toContain('kicker="traceability"');
    expect(workspacePage).toContain("evidenceFromDto(e)");
  });
});

describe("no literal markdown, no raw glyph markers in the result surfaces", () => {
  it("the workspace never renders a glyph marker or the raw answer paragraph", () => {
    for (const glyph of ["▲", "▼", "◇", "⊘"]) expect(workspacePage).not.toContain(glyph);
    // The single ◆/↳ occurrence is prose in a code comment stating the law itself.
    expect(glyphCount(workspacePage, "◆")).toBe(1);
    expect(workspacePage).toContain("never ◆/↳ characters");
    expect(workspacePage).not.toMatch(/\{run\.answer\.answer\}<\/p>/);
    expect(workspacePage).not.toMatch(/<p[^>]*>\s*\{run\.answer\.answer\}/);
    expect(workspacePage).toContain('<AnswerProse className="answer-prose" text={run.answer.answer} />');
  });

  it("the other result surfaces are glyph-free too", () => {
    for (const src of [historyPage, activePage, homePage, ui]) {
      for (const glyph of ["◆", "▲", "▼", "◇", "⊘"]) expect(src).not.toContain(glyph);
    }
    expect(activePage).toContain('<AnswerProse className="answer-prose" text={result.answer.answer} />');
    expect(activePage).toContain('className="uncertainty-row"');
  });
});
