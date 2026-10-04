/**
 * D6 — "New research" reset (manual acceptance defect).
 *
 * The production failure: the shell's New research button only called navigate("/research").
 * On that route the workspace component never remounted, so the previous thread, the viewed
 * run, the completed stream result (and even a still-typed input) all survived — "New
 * research" reopened the old conversation instead of a clean workspace.
 *
 * Laws under test (DOM-free helper + source guards, the pattern of history-identity.test.ts):
 *  1. The flag is strict: only navigation state `{ newResearch: true }` is a new-research
 *     handoff; the home hero's `{ question }` state (also navigation state on this route) must
 *     never be mistaken for one.
 *  2. The shell's button carries the flag.
 *  3. The workspace consumes the flag by resetting EVERY conversation-scoped piece of state
 *     (thread, viewed ref, linked-run error surfaces, input, in-flight submit, stream) and
 *     then consumes it so a refresh/replay cannot reset again.
 *  4. The mount-time history hydration is held back exactly once for a flag arrival, so a
 *     cross-page New research lands on the same clean thread as an in-page one.
 *  5. The stream reset bumps the run token BEFORE aborting, so the abandoned run's late
 *     callbacks can never write into the fresh conversation, and errorId stays monotonic
 *     (a later failure still records a turn).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewResearchRequest } from "../src/pages/researchView.js";

const SRC = join(import.meta.dirname, "..", "src");
// Line-ending-agnostic reads: a git checkout with autocrlf may present the sources with
// CRLF while the assertions below match multi-line patterns written with \n.
const readSource = (dir: string, file: string): string =>
  readFileSync(join(SRC, dir, file), "utf8").replace(/\r\n/g, "\n");
const workspacePage = readSource("pages", "ResearchWorkspacePage.tsx");
const shell = readSource("components", "AppShell.tsx");
const streamHook = readSource("hooks", "useResearchStream.ts");

describe("new-research handoff flag (strict)", () => {
  it("accepts only the explicit true flag", () => {
    expect(isNewResearchRequest({ newResearch: true })).toBe(true);
  });

  it("never mistakes other navigation state for a new-research handoff", () => {
    // The home hero navigates to this route with { question } — asking must not reset.
    expect(isNewResearchRequest({ question: "why did BTC drop?" })).toBe(false);
    expect(isNewResearchRequest({ newResearch: false })).toBe(false);
    expect(isNewResearchRequest({ newResearch: "yes" })).toBe(false);
    expect(isNewResearchRequest({ newResearch: 1 })).toBe(false);
    expect(isNewResearchRequest(null)).toBe(false);
    expect(isNewResearchRequest(undefined)).toBe(false);
    expect(isNewResearchRequest("newResearch")).toBe(false);
  });
});

describe("New research button carries the flag (source guard)", () => {
  it("the shell's New research button navigates with { newResearch: true }", () => {
    expect(shell).toContain('navigate("/research", { state: { newResearch: true } })');
  });

  it("the sidebar Research entry stays a plain navigation (browsing ≠ resetting)", () => {
    // NAV is data-driven (`{ to: "/research", label: "Research" }`); the flag exists only on
    // the explicit New research ACTION so ordinary navigation never wipes the thread.
    expect(shell).toContain('{ to: "/research", label: "Research", glyph: "◎" }');
    expect(shell).not.toMatch(/to:\s*"\/research",\s*label:\s*"Research".*state/);
  });
});

describe("workspace resets every conversation-scoped state on the flag (source guard)", () => {
  it("consumes the flag through the strict helper, not a loose truthiness check", () => {
    expect(workspacePage).toContain("isNewResearchRequest(location.state)");
    expect(workspacePage).not.toMatch(/if \(\(location\.state as [^)]*\)\?\.newResearch\)/);
  });

  it("resets thread, selection, linked-run surfaces, input, submit and stream", () => {
    // Each reset targets one piece of the observed defect (stale thread / stale active run /
    // stale 404 banner / typed text / disabled ask bar / stale stream result).
    expect(workspacePage).toContain("resetStream();");
    expect(workspacePage).toContain("setRuns([]);");
    expect(workspacePage).toContain("setViewedRef(undefined);");
    expect(workspacePage).toContain("setLinkedNotFound(false);");
    expect(workspacePage).toContain("setRefLoadError(undefined);");
    expect(workspacePage).toContain('setInput("");');
    expect(workspacePage).toContain("setSubmitting(false);");
    expect(workspacePage).toContain("setSaveError(undefined);");
    // The previous investigation's readouts (evidence, judgment, thesis, snapshot) are CLEARED,
    // not merely hidden: the rail must not keep presenting the old thread's state.
    expect(workspacePage).toContain("setWs((prev) => ({ ...prev, evidence: [], judgment: undefined, thesis: undefined, snapshot: undefined, loadError: undefined }));");
    // The thread's OWNER is dropped too, so the next hydration cannot refill the fresh thread
    // from the previous investigation's runs.
    expect(workspacePage).toContain("threadOwnerRef.current = undefined;");
    expect(workspacePage).toContain("investigationRefRef.current = undefined;");
  });

  it("consumes the flag after the reset (one-shot; a replay cannot reset twice)", () => {
    expect(workspacePage).toContain("navigate(location.pathname, { replace: true }); // consume the flag");
  });

  it("holds the mount-time history hydration exactly once for a flag arrival", () => {
    // Without the hold, arriving from ANOTHER page would re-hydrate the old history into the
    // just-reset thread — the same defect through the back door.
    expect(workspacePage).toContain("mountedForNewResearch.current = false;");
    expect(workspacePage).toContain("const mountedForNewResearch = useRef(isNewResearchRequest(location.state));");
    // The hold is consumed even on a failed history read so it cannot leak into a later refresh.
    const holdIdx = workspacePage.indexOf("if (mountedForNewResearch.current)");
    const mergeIdx = workspacePage.indexOf("if (historyTurns !== undefined) {");
    expect(holdIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(holdIdx);
  });
});

describe("stream reset obeys the state-isolation law (source guard)", () => {
  it("bumps the run token before aborting, so abandoned callbacks are stale", () => {
    const resetIdx = streamHook.indexOf("const reset = useCallback(");
    expect(resetIdx).toBeGreaterThan(-1);
    const body = streamHook.slice(resetIdx, streamHook.indexOf("return { state, submit, reset };"));
    const bumpIdx = body.indexOf("runToken.current += 1;");
    const abortIdx = body.indexOf("abortRef.current?.abort();");
    expect(bumpIdx).toBeGreaterThan(-1);
    expect(abortIdx).toBeGreaterThan(bumpIdx);
  });

  it("keeps errorId monotonic across a reset (a later failure still records a turn)", () => {
    const resetIdx = streamHook.indexOf("const reset = useCallback(");
    const body = streamHook.slice(resetIdx, streamHook.indexOf("return { state, submit, reset };"));
    expect(body).toContain("errorId: prev.errorId,");
    expect(body).not.toContain("errorId: 0,");
  });

  it("a live submit is aborted through a real AbortController signal", () => {
    expect(streamHook).toContain("const controller = new AbortController();");
    expect(streamHook).toContain("{ ...options, signal: controller.signal }");
    // Detach any leftover stream before starting a new one (defensive double-reset).
    expect(streamHook).toContain("abortRef.current?.abort(); // defensive: detach any leftover stream before a new one");
  });
});
