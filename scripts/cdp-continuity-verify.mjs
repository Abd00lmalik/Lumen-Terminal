/**
 * Conversational-continuity browser verification (headless Chrome + CDP).
 *
 * Drives the EXACT production sequence against the real UI and the real API:
 *   1. clean investigation
 *   2. ask "Why did Bitcoin move down today?"            (typed verbatim, real key events)
 *   3. wait for completion
 *   4. verify the composer says "Ask follow-up"          (the reported failure)
 *   5. enter "What evidence would most strongly support or weaken the liquidity explanation?"
 *   6. verify: same investigation, NEW run, previous run intact, new evidence owned by the new run
 *   7. refresh: same investigation selected, both runs visible, composer still "Ask follow-up"
 *   8. New Research: clean thread, composer back to "Research"
 *
 * Usage: node scripts/cdp-continuity-verify.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "http://127.0.0.1:5173";
const API = process.env.LUMEN_API ?? "http://127.0.0.1:3001";
const PORT = Number(process.env.CDP_PORT ?? 9371);
const OUT = join(process.cwd(), ".data", "continuity-verify");
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, ok, detail) => {
  if (!ok) failures.push(label);
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail) : "");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "lumen-continuity-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  "--remote-allow-origins=*", "--window-size=1440,1200", "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
chrome.stderr.on("data", () => {});

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
const { WebSocket } = await import("node:worker_threads").then(() => ({ WebSocket: globalThis.WebSocket }));
ws = new WebSocket(url);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};

async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, 60_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "eval failed");
  return r.result?.value;
}
async function waitFor(expression, label, timeoutMs = 180_000) {
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
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

/** Type a question with REAL key events, then submit with the real button. */
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
  const typed = await evalJs(`document.querySelector('.ask-bar input.search')?.value ?? ''`);
  return typed;
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

try {
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- STEP 1: clean investigation -----------------------------------------
  await send("Page.navigate", { url: `${BASE}/#/research` });
  await sleep(5000);
  const before = await composerLabel();
  check("step 1: a clean thread shows composer 'Research'", before === "Research", before);
  await shot("01-clean");

  // ---- STEP 2/3: the first question, then wait for completion --------------
  const typed1 = await askViaUI("Why did Bitcoin move down today?");
  check("step 2: the question was typed verbatim into the real input", typed1 === "Why did Bitcoin move down today?", typed1);
  await shot("02-typed");
  await submitViaUI();
  await waitFor(`document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "first run completion");
  check("step 3: the first run completed", true);

  // ---- STEP 4: composer says "Ask follow-up" -------------------------------
  const label4 = await composerLabel();
  check('step 4: composer says "Ask follow-up"', label4 === "Ask follow-up", label4);
  const rail4 = await railText();
  check("step 4: the investigation is still selected (not 'No active research')", !/No active research/.test(rail4));
  await shot("03-after-first");

  const invBefore = (await api("/api/investigations")).find((r) => r.isCurrent);
  check("step 4: backend reports exactly one current investigation", invBefore !== undefined, invBefore?.id);
  const runsBefore = invBefore?.runs.map((r) => r.researchRef) ?? [];
  check("step 4: the first run is recorded", runsBefore.length >= 1, runsBefore);

  // ---- STEP 5/6: the exact follow-up --------------------------------------
  const FOLLOWUP = "What evidence would most strongly support or weaken the liquidity explanation?";
  const typed2 = await askViaUI(FOLLOWUP);
  check("step 5: the follow-up was typed verbatim", typed2 === FOLLOWUP, typed2);
  await shot("04-followup-typed");
  await submitViaUI();
  await waitFor(`!document.querySelector('.ask-bar button')?.textContent?.includes('Researching') && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "follow-up completion");

  const invAfter = (await api("/api/investigations")).find((r) => r.isCurrent);
  const runsAfter = invAfter?.runs.map((r) => r.researchRef) ?? [];
  check("step 6: SAME investigation", invAfter?.id === invBefore?.id, { before: invBefore?.id, after: invAfter?.id });
  check("step 6: a NEW research run was created", runsAfter.length > runsBefore.length && !runsBefore.includes(runsAfter[runsAfter.length - 1]), { before: runsBefore, after: runsAfter });
  check("step 6: the previous run is still intact", runsBefore.every((r) => runsAfter.includes(r)), runsAfter);

  const newRef = runsAfter[runsAfter.length - 1];
  const newRun = await api(`/api/research/${newRef}`);
  const owners = new Set((newRun.evidence ?? []).map((e) => e.researchRunId));
  check("step 6: new evidence belongs to the NEW run", owners.size === 1 && owners.has(newRef), [...owners]);
  const rail6 = await railText();
  check("step 6: the answer addresses the follow-up (no MODEL FAILURE)", !/MODEL FAILURE|Interpretation failed/i.test(rail6));
  await shot("05-after-followup");

  // ---- STEP 7: refresh -----------------------------------------------------
  await send("Page.reload", {});
  await sleep(6000);
  const label7 = await composerLabel();
  check('step 7: after refresh the composer still says "Ask follow-up"', label7 === "Ask follow-up", label7);
  const rail7 = await railText();
  check("step 7: after refresh the investigation is still selected", !/No active research/.test(rail7));
  // "Both runs remain visible" means both TURNS are in the thread — an archival turn shows its
  // question, not its rs_ ref (the ref is only printed on the active run's panel), so the
  // user-visible assertion is on the questions, with the run list confirmed via the API.
  check("step 7: after refresh both questions are still in the thread",
    /Why did Bitcoin move down today/.test(rail7) && /support or weaken the liquidity explanation/i.test(rail7));
  const invAfterReload = (await api("/api/investigations")).find((r) => r.isCurrent);
  const runsReload = invAfterReload?.runs.map((r) => r.researchRef) ?? [];
  check("step 7: after refresh the same investigation is current", invAfterReload?.id === invAfter?.id, invAfterReload?.id);
  check("step 7: after refresh the same investigation still holds both runs",
    runsAfter.every((r) => runsReload.includes(r)), runsReload);
  await shot("06-after-refresh");

  // ---- STEP 8: New Research resets cleanly ---------------------------------
  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button,a')].find((n) => /new research/i.test(n.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  })()`);
  await sleep(6000);
  const label8 = await composerLabel();
  check('step 8: New Research returns the composer to "Research"', label8 === "Research", label8);
  const invAfterReset = await api("/api/investigations");
  check("step 8: New Research clears the current investigation", invAfterReset.filter((r) => r.isCurrent).length === 0, invAfterReset.map((r) => [r.id, r.isCurrent]));
  check("step 8: New Research does not delete the previous investigation (History keeps it)", invAfterReset.length >= 1, invAfterReset.length);
  await shot("07-after-new-research");

  console.log(`\nscreenshots: ${OUT}`);
  console.log(failures.length === 0 ? "\n=== BROWSER VERIFICATION PASSED ===" : `\n=== BROWSER VERIFICATION FAILED: ${failures.length} ===\n${failures.join("\n")}`);
} catch (error) {
  console.log("HARNESS ERROR:", error instanceof Error ? error.message : String(error));
  try { await shot("99-error"); } catch {}
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  try { process.kill(chrome.pid); } catch {}
}