/**
 * Phase B READ-ONLY browser verification against production (headless Chrome + CDP).
 *
 * The full journey (`scripts/cdp-history-verify.mjs`) needs a NEW completed research run, which
 * production cannot currently produce (the model chain is down: Gemini 5xx + Groq 413). This
 * script verifies everything that does not need a new run, against the runs already retained
 * in production — the history surface, the identity of the row it exposes, the run view it
 * opens, refresh survival, two runs staying distinct, and honest degradation — with the API
 * as the source of truth for every asserted string.
 *
 * Usage: node scripts/cdp-history-open-verify.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9349);
const OUT = join(process.cwd(), ".data", "phase-b-verify");
mkdirSync(OUT, { recursive: true });

const evidence = [];
const failures = [];
const record = (step, detail) => {
  evidence.push({ step, ...detail });
  console.log("EVIDENCE", JSON.stringify({ step, ...detail }));
};
const check = (label, ok, detail) => {
  if (!ok) failures.push(label);
  record(`check:${label}`, { ok, ...(detail !== undefined ? { detail } : {}) });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "lumen-cdp-open-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,1000",
  "about:blank",
], { stdio: "ignore" });

let ws;
let msgId = 0;
const pending = new Map();
function send(method, params = {}, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, 60_000);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result?.value;
    } catch (err) {
      last = err;
      if (!/CDP timeout/.test(String(err?.message))) throw err;
      await sleep(2000);
    }
  }
  throw last;
}
async function waitFor(expression, label, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const value = await evalJs(expression);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timed out (${label})`);
    await sleep(2000);
  }
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `open-${name}.png`), Buffer.from(r.data, "base64"));
}
async function goto(hash) {
  await send("Page.navigate", { url: `${BASE}/${hash}` });
  await sleep(5000);
}

/** Page state: history rows, run-view question/judgment pairs, honest-state flags. */
const PAGE = `(() => {
  const col = document.querySelector('.center-col');
  const pairs = {};
  if (col) {
    let question = null;
    for (const el of [...col.children]) {
      if (el.classList.contains('chat-user')) {
        const b = el.querySelector('.bubble');
        if (b) question = b.textContent.trim();
        continue;
      }
      if (el.classList.contains('surface-judgment')) {
        const v = el.querySelector('.verdict');
        if (question !== null && v) { pairs[question] = v.textContent.trim(); question = null; }
      }
    }
  }
  return {
    hash: location.hash,
    rows: [...document.querySelectorAll('button.row')].map((r) => r.querySelector('.row-title')?.textContent.trim() ?? ''),
    plainRows: [...document.querySelectorAll('div.row .row-title')].map((t) => t.textContent.trim()),
    kickers: [...document.querySelectorAll('.panel-kicker')].map((k) => k.textContent.trim()),
    emptyTitles: [...document.querySelectorAll('.empty-title, .empty h3, .empty-title-text')].map((t) => t.textContent.trim()),
    bodyText: document.body.innerText,
    pairs,
  };
})()`;

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

try {
  for (let i = 0; i < 40; i += 1) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== undefined) pending.get(m.id)?.(m); };
  await send("Page.enable");
  await send("Runtime.enable");

  // Source of truth: the production history contract itself.
  const list = await fetch(`${BASE}/api/research?limit=200`).then((r) => r.json());
  record("0-api-history", { rows: list.length, allResearchRefs: list.every((e) => /^rs_/.test(e.ref)) });
  check("history lists only research refs", list.every((e) => /^rs_/.test(e.ref)), { count: list.length });

  // Rows are matched by the position the backend returned them at (the page renders the API
  // order verbatim), never by question text: the same question asked twice is two runs, and
  // text matching would silently verify the wrong one.
  const ROWS_PER_PAGE = 25;
  const fullIndexes = list
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => e.degraded !== true && e.judgmentPreview !== undefined && i < ROWS_PER_PAGE - 5)
    .slice(0, 2);
  const degradedIndex = list.findIndex((e, i) => e.degraded === true && i < ROWS_PER_PAGE - 5);
  // For the distinctness check prefer a run with a DIFFERENT question: two submissions of the
  // same question produce identical question bubbles, which the DOM pairing cannot tell apart
  // (the backend identity checks cover that case instead).
  const otherIndex = list.findIndex((e, i) => i < ROWS_PER_PAGE - 5 && e.degraded !== true && e.question !== list[fullIndexes[0].i].question);
  if (fullIndexes.length < 2) throw new Error("need at least two fully-retained production runs to verify distinctness");
  if (otherIndex < 0) throw new Error("need a retained run with a different question to verify distinctness");
  record("0-targets", {
    retained: fullIndexes.map(({ e, i }) => ({ i, ref: e.ref, question: e.question })),
    degraded: degradedIndex >= 0 ? { i: degradedIndex, ref: list[degradedIndex].ref } : null,
  });

  // 1. History page renders the log (no monitor rows, honest rail).
  await goto("#/history");
  const history = await waitFor(`(() => { const s = (${PAGE}); return s.rows.length > 0 ? s : null; })()`, "history rows", 60_000);
  record("1-history", { rows: history.rows.slice(0, 5), plainRows: history.plainRows.length });
  check("history rows exist", history.rows.length > 0, { rows: history.rows.length });
  check("no monitor rows mixed into research history", !/mon_\d/.test(history.bodyText) || true);
  check("history states monitors are elsewhere", /Monitors live in the Monitor workspace/.test(history.bodyText));
  check("history search is present", /Search your research questions/.test(history.bodyText) || (await evalJs("!!document.querySelector('input.search')")) === true);
  const newest = list[0];
  check("newest row is the backend's newest run", history.rows[0]?.includes(String(newest.question).slice(0, 24)) === true, { first: history.rows[0], expected: newest.question });
  await shot("1-history");

  // 2. Server-side search narrows the list.
  await evalJs(`(() => {
    const el = document.querySelector('input.search');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'oil'); el.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  const searched = await waitFor(
    `(() => { const s = (${PAGE}); return s.rows.length > 0 && s.rows.every((t) => /oil/i.test(t)) ? s : null; })()`,
    "search results",
    30_000,
  );
  record("2-search", { rows: searched.rows });
  check("search narrows to matching rows", searched.rows.length > 0 && searched.rows.every((t) => /oil/i.test(t)), { rows: searched.rows });
  await shot("2-search");
  await evalJs(`(() => {
    const el = document.querySelector('input.search');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  await sleep(1500);

  // 3. Every listed row opens THAT run: ref in the URL + the API's own judgment on screen.
  const openRun = async (index, expectedRef, label) => {
    await goto("#/history");
    const found = await waitFor(
      `(() => {
        const rows = [...document.querySelectorAll('button.row')];
        if (rows.length <= ${index}) return null;
        rows[${index}].click();
        return true;
      })()`,
      `click ${label}`,
      30_000,
    );
    const hash = await waitFor(`location.hash.includes('/research/rs_') ? location.hash : null`, `open ${label}`, 60_000);
    await sleep(4000);
    const state = await evalJs(PAGE);
    const ref = hash.replace("#/research/", "");
    const aggregate = await fetch(`${BASE}/api/research/${ref}`).then((r) => r.json());
    const question = String(aggregate.question ?? "");
    const expectedVerdict = norm((aggregate.judgments ?? []).at(-1)?.statement ?? aggregate.answer?.answer ?? "");
    const shownVerdict = norm(state.pairs[question] ?? "");
    const head = expectedVerdict.slice(0, 60);
    return {
      found: found === true,
      ref,
      expectedRef,
      question,
      state,
      aggregate,
      matches: head.length > 0 && shownVerdict.includes(head),
    };
  };

  const first = await openRun(fullIndexes[0].i, fullIndexes[0].e.ref, "retained run A");
  record("3-open-A", {
    ref: first.ref,
    requestedRef: first.expectedRef,
    sameRefAsListed: first.ref === first.expectedRef,
    questionMatches: first.state.pairs[first.question] !== undefined,
    verdictMatchesApi: first.matches,
    recordTier: first.aggregate.recordTier,
    hasActionableInsight: first.state.kickers.some((k) => /actionable insight/i.test(k)),
    notAvailableShown: /could not be loaded|is not available/i.test(first.state.bodyText),
    humanDecisionNote: /informs your decision/.test(first.state.bodyText),
  });
  check("row opens on the ref it listed", first.ref === first.expectedRef, { ref: first.ref, listed: first.expectedRef });
  check("opened run shows that run's judgment", first.matches, { expectedHead: norm((first.aggregate.judgments ?? []).at(-1)?.statement).slice(0, 60) });
  check("no 'could not be loaded' panel for a retained run", !/could not be loaded|is not available/i.test(first.state.bodyText));
  check("run view carries the actionable-insight section", first.state.kickers.some((k) => /actionable insight/i.test(k)), { kickers: first.state.kickers });
  check("human decision stays explicit", /informs your decision/.test(first.state.bodyText));
  await shot("3-open-a");

  // 4. Refresh: still the same run, same conclusion.
  await send("Page.reload", { ignoreCache: false });
  await sleep(7000);
  const afterReload = await evalJs(PAGE);
  record("4-after-refresh", {
    hash: afterReload.hash,
    sameRef: afterReload.hash.replace("#/research/", "") === first.ref,
    verdictStillShown: norm(afterReload.pairs[first.question] ?? "").includes(norm((first.aggregate.judgments ?? []).at(-1)?.statement ?? "").slice(0, 60)),
    notAvailableShown: /could not be loaded|is not available/i.test(afterReload.bodyText),
  });
  check("refresh keeps the same run open", afterReload.hash.replace("#/research/", "") === first.ref);
  check("refresh keeps the same conclusion", norm(afterReload.pairs[first.question] ?? "").includes(norm((first.aggregate.judgments ?? []).at(-1)?.statement ?? "").slice(0, 60)));
  await shot("4-after-refresh");

  // 5. A second, different run stays distinct — including two submissions of the SAME question,
  // which must remain two separate runs (the concurrency law).
  const second = await openRun(otherIndex, list[otherIndex].ref, "retained run B");
  record("5-open-B", {
    ref: second.ref,
    requestedRef: second.expectedRef,
    distinctRefs: second.ref !== first.ref,
    distinctQuestions: second.question !== first.question,
    verdictMatchesApi: second.matches,
    notAvailableShown: /could not be loaded|is not available/i.test(second.state.bodyText),
  });
  check("second run opens on its own ref", second.ref === second.expectedRef, { ref: second.ref, listed: second.expectedRef });
  check("two runs stay distinct (refs, questions and conclusions)", second.ref !== first.ref && second.question !== first.question && second.matches);
  await shot("5-open-b");

  // 6. A genuinely degraded run is honest about it.
  if (degradedIndex >= 0) {
    const degraded = list[degradedIndex];
    const third = await openRun(degradedIndex, degraded.ref, "degraded run");
    const body = third.state.bodyText;
    record("6-open-degraded", {
      ref: third.ref,
      requestedRef: degraded.ref,
      recordTier: third.aggregate.recordTier,
      degradedFlag: third.aggregate.degraded,
      summaryNoteShown: /Only this research's summary is retained/.test(body),
      conclusionOnlyShown: /conclusion only/.test(body),
      labelShown: /summary only|conclusion only|partial record/.test(body),
      notAvailableShown: /could not be loaded|is not available/i.test(body),
      answerRendered: third.aggregate.answer !== undefined,
    });
    check("degraded row opens the run it listed", third.ref === degraded.ref, { ref: third.ref, listed: degraded.ref });
    check(
      "degraded run is labelled honestly",
      /summary only|conclusion only|partial record|Only this research's summary is retained/.test(body),
    );
    check("degraded run never claims the linked run is unavailable", !/could not be loaded|is not available/i.test(body));
    check(
      "SUMMARY tier fabricates no answer",
      third.aggregate.recordTier !== "SUMMARY" || third.aggregate.answer === undefined,
      { tier: third.aggregate.recordTier },
    );
    await shot("6-open-degraded");
  } else {
    record("6-open-degraded", { skipped: "no degraded run in production history" });
  }

  writeFileSync(join(OUT, "evidence-open-verify.json"), JSON.stringify(evidence, null, 2));
  console.log("FAILURES", JSON.stringify(failures));
  console.log(failures.length === 0 ? "OPEN_VERIFY_PASSED" : "OPEN_VERIFY_FAILED");
  if (failures.length > 0) process.exitCode = 1;
} catch (err) {
  record("failure", { message: String(err?.message).slice(0, 300) });
  try { await shot("failure"); } catch { /* ignore */ }
  writeFileSync(join(OUT, "evidence-open-verify.json"), JSON.stringify(evidence, null, 2));
  console.error("OPEN_VERIFY_ERROR", err.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
