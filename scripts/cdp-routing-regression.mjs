/**
 * CONVERSATIONAL ROUTING — BROWSER VERIFICATION (headless Chrome + CDP).
 *
 * WHY THIS FILE EXISTS: `cdp-continuity-verify.mjs` reported 21/21 passing while the exact
 * sequence below failed in the deployed app. It typed a DIFFERENT follow-up sentence
 * ("What evidence would most strongly support or weaken the liquidity explanation?") against a
 * SINGLE local backend process where the in-memory graph IS the store. Neither difference could
 * surface the defect, which lives in the multi-instance persistence path.
 *
 * THIS script uses the TRADER-REPORTED sentence verbatim and adds the step the old one had no
 * way to exercise: a follow-up submitted to a SECOND server-side instance, which is what the
 * deployed topology does on every request. That is the path that produced "started a NEW
 * RESEARCH".
 *
 * Steps (each captured with a screenshot and extracted rendered text):
 *   1. clean investigation; composer reads "Research"
 *   2. ask "Why did Bitcoin move down today?" and wait for completion
 *   3. composer reads "Ask follow-up"
 *   4. type THE EXACT FAILING SENTENCE and submit
 *   5. investigation identity UNCHANGED; run count 1 -> 2; first run intact
 *   6. HARD RELOAD: both runs still on the same investigation
 *   7. second follow-up served by a FRESH process (cold instance) — the deployed topology
 *   8. New Research: genuinely empty, does not inherit the thread
 *
 * Usage: node scripts/cdp-routing-regression.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

const CHROME = process.env.CHROME_PATH
  ?? join(homedir(), ".cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome");
const BASE = process.env.LUMEN_BASE ?? "http://127.0.0.1:5173";
const API = process.env.LUMEN_API ?? "http://127.0.0.1:3001";
const PORT = Number(process.env.CDP_PORT ?? 9471);
const OUT = join(process.cwd(), ".data", "routing-regression");
mkdirSync(OUT, { recursive: true });

// THE EXACT message from the production report. Never paraphrased.
const Q1 = "Why did Bitcoin move down today?";
const FAILING = "Given that Bitcoin is actually up over the current 24-hour window, what caused the most recent meaningful intraday move, and what evidence supports that explanation?";

const failures = [];
const results = [];
/** Child processes this script owns and must clean up (never the managed preview). */
const coldProcesses = [];
const check = (label, ok, detail) => {
  if (!ok) failures.push(label);
  results.push({ label, ok, detail });
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail) : "");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "lumen-routing-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  // Required to run Chrome inside an unprivileged container; does not affect what is asserted.
  "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-allow-origins=*", "--window-size=1440,1400", "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
chrome.stderr.on("data", () => {});

let ws;
let msgId = 0;
const pending = new Map();
function send(method, params = {}, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("Chrome DevTools endpoint never appeared");
}
const url = await connect();
ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};

async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "eval failed");
  return r.result?.value;
}
async function waitFor(expression, label, timeoutMs = 120_000) {
  const started = Date.now();
  for (;;) {
    const value = await evalJs(expression);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timed out (${label})`);
    await sleep(1500);
  }
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  const text = await evalJs(`(document.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 4000)`);
  writeFileSync(join(OUT, `${name}.txt`), String(text ?? ""));
}

async function askViaUI(question) {
  await evalJs(`(() => {
    const input = document.querySelector('.ask-bar input.search');
    if (!input) return 'no input';
    input.focus();
    return 'focused';
  })()`);
  for (const ch of question) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", text: ch, unmodifiedText: ch });
  }
  await sleep(300);
  return evalJs(`document.querySelector('.ask-bar input.search')?.value ?? ''`);
}
async function submitViaUI() {
  return evalJs(`(() => {
    const buttons = [...document.querySelectorAll('.ask-bar button')];
    const btn = buttons.find((b) => /primary/i.test(b.className)) ?? buttons[buttons.length - 1];
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}
const composerLabel = () => evalJs(`(() => {
  const buttons = [...document.querySelectorAll('.ask-bar button')];
  const btn = buttons.find((b) => /primary/i.test(b.className)) ?? buttons[buttons.length - 1];
  return (btn?.textContent ?? '').replace(/\\s+/g,' ').trim();
})()`);
const railText = () => evalJs(`(document.body.innerText || '').replace(/\\s+/g,' ')`);
const api = async (p) => (await fetch(`${API}${p}`)).json();
const idle = `!document.querySelector('.ask-bar button')?.textContent?.includes('Researching')`;

try {
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- 1: clean thread ------------------------------------------------------
  await send("Page.navigate", { url: `${BASE}/#/research` });
  await sleep(5000);
  const label1 = await composerLabel();
  check("1: clean thread shows composer 'Research'", label1 === "Research", label1);
  await shot("01-clean");

  // ---- 2: first research run ------------------------------------------------
  const typed1 = await askViaUI(Q1);
  check("2: first question typed verbatim", typed1 === Q1, typed1);
  await shot("02-first-typed");
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "first run");
  const invA = (await api("/api/investigations")).find((r) => r.isCurrent);
  const runsA = invA?.runs.map((r) => r.researchRef) ?? [];
  check("2: first run completed and recorded", runsA.length >= 1, runsA);
  console.log("   investigationId:", invA?.id, "runs:", JSON.stringify(runsA));

  // ---- 3: composer in follow-up mode ----------------------------------------
  const label3 = await composerLabel();
  check("3: composer says 'Ask follow-up'", label3 === "Ask follow-up", label3);
  check("3: thread is still selected", !/No active research/.test(await railText()));
  await shot("03-after-first");

  // ---- 4: THE EXACT FAILING SENTENCE ----------------------------------------
  const typed2 = await askViaUI(FAILING);
  check("4: the exact failing sentence typed verbatim", typed2 === FAILING, typed2);
  await shot("04-failing-typed");
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "follow-up run");

  // ---- 5: the acceptance criterion ------------------------------------------
  const invB = (await api("/api/investigations")).find((r) => r.isCurrent);
  const runsB = invB?.runs.map((r) => r.researchRef) ?? [];
  check("5: THE INVESTIGATION IDENTITY IS UNCHANGED", invB?.id === invA?.id, { before: invA?.id, after: invB?.id });
  check("5: RUN COUNT INCREASED 1 -> 2", runsB.length === runsA.length + 1, { before: runsA, after: runsB });
  check("5: THE FIRST RUN REMAINS INTACT", runsA.every((r) => runsB.includes(r)), runsB);
  check("5: EXACTLY ONE INVESTIGATION EXISTS", (await api("/api/investigations")).length === 1);
  const newRun = runsB.find((r) => !runsA.includes(r));
  const turnFlags = (invB?.turns ?? []).filter((t) => t.role === "TRADER").map((t) => ({ c: t.content.slice(0, 40), cont: t.continuedInvestigation }));
  check("5: the follow-up turn is recorded as a CONTINUATION", turnFlags.at(-1)?.cont === true, turnFlags);
  console.log("   newRunId:", newRun);
  await shot("05-after-followup");

  // ---- 6: HARD RELOAD --------------------------------------------------------
  await send("Page.reload", {});
  await sleep(7000);
  const label6 = await composerLabel();
  check("6: after HARD RELOAD the composer still says 'Ask follow-up'", label6 === "Ask follow-up", label6);
  const invC = (await api("/api/investigations")).find((r) => r.isCurrent);
  const runsC = invC?.runs.map((r) => r.researchRef) ?? [];
  check("6: after HARD RELOAD the same investigation is current", invC?.id === invA?.id, invC?.id);
  check("6: after HARD RELOAD BOTH runs remain attached", runsB.every((r) => runsC.includes(r)) && runsC.length === runsB.length, { expected: runsB, actual: runsC });
  const rail6 = await railText();
  check("6: both questions are visible in the thread", /Why did Bitcoin move down today/.test(rail6) && /what evidence supports that explanation/i.test(rail6));
  await shot("06-after-hard-reload");

  // ---- 7: a follow-up served by a COLD SECOND instance (deployed topology) ----
  // A second API process is started against the SAME durable store on a different port. It
  // holds an EMPTY in-memory graph and must absorb the persisted thread before routing —
  // this is precisely the condition that produced "started a NEW RESEARCH". It is started
  // ALONGSIDE the preview (not by killing it), so the check proves multi-instance behaviour
  // rather than a restart, and the managed preview is left untouched.
  console.log("   [7] starting a SECOND cold API instance over the same durable store");
  const coldApi = "http://127.0.0.1:3002";
  // A LEFTOVER instance from an earlier run would answer these checks with its own stale
  // in-memory graph and silently invalidate step 7 — which is exactly the class of mistake
  // this script exists to catch. Refuse to run against a port we do not own.
  let portBusy = false;
  try { const r = await fetch(`${coldApi}/api/health`, { signal: AbortSignal.timeout(2000) }); portBusy = r.ok; } catch { /* free */ }
  check("7: the cold-instance port is free (no stale server to mislead the check)", !portBusy, coldApi);
  if (portBusy) throw new Error("port 3002 is already serving; a stale instance would invalidate step 7");
  const cold = spawn("npx", ["tsx", "scripts/browser-verify-server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, VERIFY_API_PORT: "3002", PREVIEW_PORT: "5199" },
    stdio: "ignore",
  });
  coldProcesses.push(cold);
  let coldUp = false;
  for (let i = 0; i < 45; i += 1) {
    try { const r = await fetch(`${coldApi}/api/health`); if (r.ok) { coldUp = true; break; } } catch { /* retry */ }
    await sleep(2000);
  }
  check("7: a SECOND cold api instance came up (deployed topology)", coldUp, coldApi);
  if (coldUp) {
    // The cold instance must restore the SAME thread from the durable store...
    const coldInv = (await (await fetch(`${coldApi}/api/investigations`)).json()).find((r) => r.isCurrent);
    check("7: the COLD instance restored the SAME investigation", coldInv?.id === invA?.id, { cold: coldInv?.id, expected: invA?.id });
    const coldRunsBefore = coldInv?.runs.map((r) => r.researchRef) ?? [];
    check("7: the COLD instance restored BOTH prior runs", coldRunsBefore.length === runsC.length && runsC.every((r) => coldRunsBefore.includes(r)), { expected: runsC, actual: coldRunsBefore });

    // ...and a follow-up submitted to it must stay in that thread.
    const third = "Dig deeper into the liquidity explanation.";
    const res = await fetch(`${coldApi}/api/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: third, confirmed: false, investigationId: invA?.id }),
    });
    const dto = await res.json();
    check("7: the cold instance answered the follow-up", res.ok && typeof dto?.answer?.answer === "string", res.status);

    const coldAfter = (await (await fetch(`${coldApi}/api/investigations`)).json()).find((r) => r.isCurrent);
    const coldRunsAfter = coldAfter?.runs.map((r) => r.researchRef) ?? [];
    check("7: COLD-INSTANCE FOLLOW-UP STAYED IN THE SAME INVESTIGATION", coldAfter?.id === invA?.id, { expected: invA?.id, actual: coldAfter?.id });
    check("7: the cold-instance follow-up added a run to THAT thread", coldRunsAfter.length === coldRunsBefore.length + 1, { before: coldRunsBefore, after: coldRunsAfter });
    check("7: earlier runs all survived on the cold instance", coldRunsBefore.every((r) => coldRunsAfter.includes(r)), coldRunsAfter);
    check("7: the cold instance opened NO new investigation", (await (await fetch(`${coldApi}/api/investigations`)).json()).length === 1);

    // And the ORIGINAL (warm) instance must still see that third run after absorbing —
    // proving the merge does not silently drop a run another instance appended.
    const warmAfter = (await api("/api/investigations")).find((r) => r.isCurrent);
    const warmRuns = warmAfter?.runs.map((r) => r.researchRef) ?? [];
    check("7: the WARM instance sees the run the cold instance appended", coldRunsAfter.every((r) => warmRuns.includes(r)), { warm: warmRuns, cold: coldRunsAfter });
  }

  // ---- 8: New Research is genuinely clean ------------------------------------
  await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => /new research/i.test(x.textContent ?? ''));
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await sleep(4000);
  const label8 = await composerLabel();
  check("8: New Research resets the composer to 'Research'", label8 === "Research", label8);
  const rail8 = await railText();
  check("8: the new thread does NOT inherit the previous question", !/Why did Bitcoin move down today/.test(rail8));
  const invs8 = await api("/api/investigations");
  check("8: the previous investigation still exists in History (nothing deleted)", invs8.length >= 1, invs8.map((i) => i.id));
  await shot("08-after-new-research");
} catch (err) {
  check("harness completed without throwing", false, String(err));
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ results, failures }, null, 2));
  console.log(`\n=== ${results.length - failures.length}/${results.length} checks passed ===`);
  if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
  console.log("artifacts:", OUT);
  for (const p of coldProcesses) { try { p.kill("SIGKILL"); } catch { /* already gone */ } }
  chrome.kill();
  process.exit(failures.length ? 1 : 0);
}
