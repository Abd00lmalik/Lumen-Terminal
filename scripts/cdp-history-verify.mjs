/**
 * Phase B production browser verification (B10) via headless Chrome + CDP against
 * https://asklumen.vercel.app.
 *
 * The journey the product brief requires, split into two parts so each stays inside a single
 * command window (each part runs at most one real research run, ~2-5 min):
 *
 *   --part=1: start research A → wait for the result → Home → History → see the entry →
 *             click it → verify the EXACT question / judgment / actionable insight →
 *             reload → open it again → verify it is still the same run.
 *   --part=2: start research B → return to History → verify BOTH runs are listed →
 *             open the FIRST, then the SECOND → verify they stay distinct →
 *             verify research history exposes no monitor rows.
 *
 * Verification reads the DOM by PAIRING each question bubble with the judgment that belongs to
 * it (the run view renders them as siblings), so a pre-existing expanded run can never satisfy
 * an assertion about a newly asked question.
 *
 * State is carried between parts through .data/phase-b-verify/state.json; screenshots and the
 * per-part evidence log are written beside it.
 *
 * Usage: node scripts/cdp-history-verify.mjs --part=1   (then --part=2)
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9347);
const PART = process.argv.find((a) => a.startsWith("--part="))?.slice("--part=".length) ?? "1";
const OUT = join(process.cwd(), ".data", "phase-b-verify");
const STATE_FILE = join(OUT, "state.json");
mkdirSync(OUT, { recursive: true });

const QUESTION_A = process.env.QUESTION_A ?? "What is driving nat gas prices this week?";
const QUESTION_B = process.env.QUESTION_B ?? "Have we seen this kind of ETH setup before?";

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const evidence = [];
const record = (step, detail) => {
  evidence.push({ step, ...detail });
  console.log("EVIDENCE", JSON.stringify({ step, ...detail }));
};

const profile = mkdtempSync(join(tmpdir(), "lumen-cdp-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,1000",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
let msgId = 0;
const pending = new Map();
function send(method, params = {}, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJsOnce(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, 60_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + String(r.exceptionDetails.exception?.description ?? "").slice(0, 300));
  return r.result?.value;
}
/**
 * Evaluate with bounded retries. A runtime can be transiently unresponsive while a long
 * synchronous render settles (and a navigation tears the execution context down); a single
 * timeout must not fail an otherwise healthy browser journey.
 */
async function evalJs(expression, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await evalJsOnce(expression);
    } catch (err) {
      last = err;
      if (!/CDP timeout/.test(String(err?.message))) throw err;
      console.log("EVAL_RETRY", i, String(err.message).slice(0, 80));
      await sleep(2000);
    }
  }
  throw last;
}
async function waitFor(expression, label, timeoutMs) {
  const started = Date.now();
  let polls = 0;
  for (;;) {
    polls += 1;
    const value = await evalJs(expression);
    if (value) return value;
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (polls % 4 === 1) console.log(`WAIT ${label} (${elapsed}s)`);
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timed out (${label})`);
    await sleep(2500);
  }
}

/** Diagnostic dump so a failed step produces evidence instead of silence. */
async function diag(tag) {
  try {
    const d = await evalJsOnce(`(() => ({ ready: document.readyState, hash: location.hash, text: document.body.innerText.slice(0, 500) }))()`);
    record(`diag-${tag}`, d);
  } catch (err) {
    record(`diag-${tag}`, { failed: String(err?.message).slice(0, 200) });
  }
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, `${PART}-${name}.png`);
  writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}
async function goto(hash) {
  await send("Page.navigate", { url: `${BASE}/${hash}` });
  await sleep(5000);
}

/** question → judgment pairs, read from the run views (each pair is a sibling group). */
const PAIRS = `(() => {
  const col = document.querySelector('.center-col');
  if (!col) return {};
  const pairs = {};
  let question = null;
  for (const el of [...col.children]) {
    if (el.classList.contains('chat-user')) {
      const bubble = el.querySelector('.bubble');
      if (bubble) question = bubble.textContent.trim();
      continue;
    }
    if (el.classList.contains('surface-judgment')) {
      const verdict = el.querySelector('.verdict');
      if (question !== null && verdict) { pairs[question] = verdict.textContent.trim(); question = null; }
    }
  }
  return pairs;
})()`;

const PAGE_STATE = `(() => ({
  hash: location.hash,
  running: /Researching/.test(document.querySelector('.ask-bar button.primary')?.textContent ?? ''),
  pairs: ${PAIRS},
  kickers: [...document.querySelectorAll('.panel-kicker')].map((k) => k.textContent.trim()),
  rowTitles: [...document.querySelectorAll('.row-title')].map((t) => t.textContent.trim()),
  historyLinks: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h && h.includes('/history')),
  researchLinks: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h && h.includes('/research')),
  notAvailableText: /could not be loaded|is not available/i.test(document.body.innerText),
  degradedSummaryText: /Only this research's summary is retained|Full reasoning is not retained/i.test(document.body.innerText),
  bodyHead: document.body.innerText.slice(0, 900),
}))()`;

async function ask(question) {
  // The ask bar is a controlled React input: set the value through the native setter and
  // dispatch a real input event so React sees the change, then submit.
  const set = await evalJs(`(() => {
    const el = document.querySelector('.ask-bar input.search');
    if (!el) return 'NO_INPUT';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(question)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);
  if (set === "NO_INPUT") throw new Error("ask bar input not found");
  await sleep(400);
  const clicked = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.ask-bar button')].find((b) => /^Research/.test(b.textContent.trim()) && !b.disabled);
    if (!btn) return 'NO_BUTTON';
    btn.click();
    return 'CLICKED';
  })()`);
  if (clicked !== "CLICKED") throw new Error("research button not clickable: " + clicked);
}

/** Wait until the UI has finished running and shows a judgment for THIS exact question. */
async function waitForAnswer(question, timeoutMs) {
  return waitFor(
    `(() => {
      const s = (${PAGE_STATE});
      if (s.running) return null;
      const v = s.pairs[${JSON.stringify(question)}];
      return v && v.length > 20 ? v : null;
    })()`,
    `answer for: ${question}`,
    timeoutMs,
  );
}

async function clickHistoryRow(question) {
  return evalJs(`(() => {
    const rows = [...document.querySelectorAll('button.row')];
    const row = rows.find((r) => r.textContent.includes(${JSON.stringify(question)}));
    if (!row) return 'ROW_NOT_FOUND';
    row.click();
    return 'CLICKED';
  })()`);
}

try {
  for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) {
      const cb = pending.get(m.id);
      if (cb) { pending.delete(m.id); cb(m); }
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");

  if (PART === "1") {
    // 1. Start a new research run through the real UI and wait for ITS answer.
    await goto("#/research");
    const before = await evalJs(PAGE_STATE);
    await ask(QUESTION_A);
    const verdictA = await waitForAnswer(QUESTION_A, 330_000);
    state.questionA = QUESTION_A;
    state.verdictA = verdictA;
    const runView = await evalJs(PAGE_STATE);
    record("1-new-research-A", {
      question: QUESTION_A,
      verdict: verdictA.slice(0, 220),
      verdictWasNew: before.pairs[QUESTION_A] === undefined,
      panels: runView.kickers,
      hasActionableInsight: runView.kickers.some((k) => /actionable insight/i.test(k)),
      hasWatchNext: runView.kickers.some((k) => /watch next/i.test(k)),
      hasStatusChips: /question |stopped:|conclusion only|summary only/.test(runView.bodyHead),
      hasDecisionNote: /informs your decision/.test(runView.bodyHead),
    });
    await shot("1-research-a");

    // 2-3. Home → History and see the entry.
    await goto("#/home");
    const home = await evalJs(PAGE_STATE);
    record("2-home", { rowTitles: home.rowTitles.slice(0, 5), hasHistoryLink: home.historyLinks.length > 0 });

    await goto("#/history");
    const history = await waitFor(
      `(() => { const s = (${PAGE_STATE}); return s.rowTitles.some((t) => t.includes(${JSON.stringify(QUESTION_A)})) ? s : null; })()`,
      "history row for A",
      60_000,
    );
    record("3-history", { rowCount: history.rowTitles.length, rows: history.rowTitles.slice(0, 5) });
    await shot("3-history");

    // 4-5. Click the row → the URL carries a research ref, and the view is THAT run.
    record("4-click-row", { result: await clickHistoryRow(QUESTION_A) });
    const openedHash = await waitFor(`location.hash.includes('/research/rs_') ? location.hash : null`, "open run A", 60_000);
    state.refA = openedHash.replace("#/research/", "");
    await sleep(5000);
    const opened = await evalJs(PAGE_STATE);
    record("5-open-A", {
      hash: opened.hash,
      refA: state.refA,
      isResearchRef: /^rs_/.test(state.refA),
      questionMatches: opened.pairs[QUESTION_A] === verdictA,
      verdict: String(opened.pairs[QUESTION_A] ?? "").slice(0, 220),
      hasActionableInsight: opened.kickers.some((k) => /actionable insight/i.test(k)),
      notAvailableText: opened.notAvailableText,
      degradedSummaryText: opened.degradedSummaryText,
      provenanceVisible: /provenance|diagnostics/.test(opened.bodyHead),
    });
    await shot("5-open-a");

    // 6. Refresh the browser and open it again: the SAME run, from durable storage.
    await send("Page.reload", { ignoreCache: false });
    await sleep(7000);
    const afterReload = await evalJs(PAGE_STATE);
    record("6-after-refresh", {
      hash: afterReload.hash,
      questionMatches: afterReload.pairs[QUESTION_A] === verdictA,
      notAvailableText: afterReload.notAvailableText,
    });
    await shot("6-after-refresh");

    state.part1Complete = true;
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    writeFileSync(join(OUT, "evidence-part1.json"), JSON.stringify(evidence, null, 2));
    console.log("PART1_DONE", JSON.stringify({ refA: state.refA, verdictA: verdictA.slice(0, 140) }));
  } else {
    if (state.part1Complete !== true) throw new Error("part 1 has not completed; run --part=1 first");
    // 7. A SECOND research run.
    await goto("#/research");
    await ask(QUESTION_B);
    const verdictB = await waitForAnswer(QUESTION_B, 330_000);
    state.questionB = QUESTION_B;
    state.verdictB = verdictB;
    record("7-new-research-B", { question: QUESTION_B, verdict: verdictB.slice(0, 220) });
    await shot("7-research-b");

    // 8. History lists BOTH runs.
    await goto("#/history");
    const both = await waitFor(
      `(() => {
        const s = (${PAGE_STATE});
        return s.rowTitles.some((t) => t.includes(${JSON.stringify(QUESTION_A)})) && s.rowTitles.some((t) => t.includes(${JSON.stringify(QUESTION_B)})) ? s : null;
      })()`,
      "both rows listed",
      60_000,
    );
    record("8-history-both", { rowTitles: both.rowTitles.slice(0, 6) });
    await shot("8-history-both");

    // 9. Open the FIRST (older) run again — still the same run and answer.
    record("9-click-first", { result: await clickHistoryRow(QUESTION_A) });
    const hashA = await waitFor(`location.hash.includes('/research/rs_') ? location.hash : null`, "open A again", 60_000);
    await sleep(5000);
    const openedA = await evalJs(PAGE_STATE);
    record("9-open-first-A", {
      hash: hashA,
      sameRefAsPart1: hashA.replace("#/research/", "") === state.refA,
      verdictMatches: openedA.pairs[QUESTION_A] === state.verdictA,
      notAvailableText: openedA.notAvailableText,
    });
    await shot("9-open-first-a");

    // 10. Open the SECOND run — distinct ref, distinct question, distinct answer.
    await goto("#/history");
    await waitFor(`(${PAGE_STATE}).rowTitles.length > 0`, "history rows after B", 40_000);
    record("10-click-second", { result: await clickHistoryRow(QUESTION_B) });
    const hashB = await waitFor(`location.hash.includes('/research/rs_') ? location.hash : null`, "open B", 60_000);
    await sleep(5000);
    const openedB = await evalJs(PAGE_STATE);
    const refB = hashB.replace("#/research/", "");
    record("10-open-second-B", {
      hash: hashB,
      refB,
      distinctRefs: refB !== state.refA,
      verdictMatches: openedB.pairs[QUESTION_B] === state.verdictB,
      distinctVerdicts: state.verdictB !== state.verdictA,
      notAvailableText: openedB.notAvailableText,
    });
    await shot("10-open-second-b");

    // 11. Research history exposes no monitor rows (API is the source of truth for refs).
    const listedRefs = await fetch(`${BASE}/api/research?limit=50`).then((r) => r.json()).then((rows) => rows.map((r) => r.ref));
    record("11-monitor-separation", {
      listed: listedRefs.length,
      allResearchRefs: listedRefs.every((r) => /^rs_/.test(r)),
      nonResearchRefs: listedRefs.filter((r) => !/^rs_/.test(r)),
      historyNavPresent: both.historyLinks.length > 0,
    });

    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    writeFileSync(join(OUT, "evidence-part2.json"), JSON.stringify(evidence, null, 2));
    console.log("PART2_DONE", JSON.stringify({ refA: state.refA, refB, distinct: refB !== state.refA }));
  }
} catch (err) {
  await diag(`failure-part${PART}`);
  await shot(`failure-part${PART}`).catch(() => undefined);
  writeFileSync(join(OUT, `evidence-part${PART}.json`), JSON.stringify(evidence, null, 2));
  console.error("VERIFY_FAILED", err.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
