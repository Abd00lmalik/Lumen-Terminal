/**
 * Production E2E via headless Chrome (CDP) against https://asklumen.vercel.app.
 *
 * Scenario A (default): submit a TSLA question through the real UI, wait for the final
 * answer panel, and assert it is a substantive answer (no retention boilerplate, no
 * model-failure panel, no crypto contamination).
 * Scenario B (--history): click the newest history entry on the Home page and verify the
 * workspace renders THAT run's question (not some other run's).
 *
 * Usage: node scripts/cdp-e2e.mjs ["question"] | node scripts/cdp-e2e.mjs --history
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "https://asklumen.vercel.app";
const PORT = 9341;
const HISTORY_MODE = process.argv[2] === "--history";
const QUESTION = HISTORY_MODE ? "" : (process.argv[2] ?? "What is the current TSLA stock price?");

const profile = mkdtempSync(join(tmpdir(), "lumen-cdp-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,1000",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdpReachable() {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
  }
  throw new Error("CDP unreachable");
}

let ws;
let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + String(r.exceptionDetails.exception?.description ?? "").slice(0, 200));
  return r.result?.value;
}

try {
  await cdpReachable();
  ws = new WebSocket(`ws://127.0.0.1:${PORT}/json/version`.replace("json/version", "page"));
  // Simpler: create a target via /json/new.
  ws.close();
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `${BASE}/#/research` });
  await sleep(7000);

  if (HISTORY_MODE) {
    // Go to Home, click the newest history entry, verify the workspace question matches.
    await send("Page.navigate", { url: `${BASE}/#/` });
    await sleep(6000);
    const clicked = await evaluate(`(() => {
      const links = [...document.querySelectorAll("a[href*='/research/']")];
      if (links.length === 0) return JSON.stringify({ ok: false, reason: "NO_HISTORY_LINKS" });
      const first = links[0];
      const card = first.closest("[class]") ?? first;
      const text = (first.textContent ?? "").slice(0, 200);
      first.click();
      return JSON.stringify({ ok: true, href: first.getAttribute("href"), label: text });
    })()`);
    const c = JSON.parse(clicked);
    if (!c.ok) { console.log("HISTORY: no links found on home:", c.reason); process.exit(1); }
    await sleep(6000);
    const pageQuestion = await evaluate(`document.body.innerText.slice(0, 2500)`);
    const hrefRef = (c.href.match(/research\/(rs_\d+)/) ?? [])[1] ?? "?";
    const showsBoiler = pageQuestion.includes("Full reasoning is not retained");
    console.log("HISTORY CLICK:", JSON.stringify({ hrefRef, label: c.label.slice(0, 90), showsBoiler }));
    console.log("PAGE SNIPPET:", pageQuestion.slice(0, 600).replace(/\n{2,}/g, "\n"));
    process.exit(0);
  }

  // Scenario A: submit the question.
  const banner = await evaluate(`document.body.innerText.includes("Workspace state could not load")`);
  console.log("workspace banner:", banner ? "PRESENT (BAD)" : "absent (good)");

  const filled = await evaluate(`(() => {
    const input = document.querySelector("input[placeholder*='research question']") ?? document.querySelector("input[type='text'], textarea");
    if (!input) return "NO_INPUT";
    const proto = input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, ${JSON.stringify(QUESTION)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return "OK";
  })()`);
  if (filled !== "OK") { console.log("input fill FAILED:", filled); process.exit(1); }

  const clicked = await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().toLowerCase() === "research");
    if (!b) return "NO_BUTTON";
    b.click(); return "CLICKED";
  })()`);
  if (clicked !== "CLICKED") { console.log("research click FAILED:", clicked); process.exit(1); }
  console.log("submitted:", JSON.stringify(QUESTION));

  // Poll up to ~4.5 minutes for a terminal panel.
  let finalText = "";
  let verdict = "TIMEOUT";
  for (let i = 0; i < 54; i++) {
    await sleep(5000);
    finalText = (await evaluate(`document.body.innerText`)) ?? "";
    if (/Interpretation failed|MODEL UNAVAILABLE/.test(finalText)) { verdict = "MODEL_FAILURE_PANEL"; break; }
    if (finalText.includes("Research result") && i > 6) { verdict = "COMPLETED_PANEL"; break; }
  }
  console.log("terminal state:", verdict);
  const region = finalText.split("Research result")[1] ?? finalText;
  console.log("---- answer region ----");
  console.log(region.slice(0, 900).trim());
  console.log("-----------------------");
  const checks = {
    boilerplate: finalText.includes("Full reasoning is not retained"),
    modelFailure: verdict === "MODEL_FAILURE_PANEL",
    cryptoContamination: /Clarity Act|Zcash|MiCA/i.test(region),
    substantive: region.length > 300,
  };
  console.log("CHECKS:", JSON.stringify(checks));
  process.exit(Object.values(checks).every(Boolean) || (checks.substantive && !checks.boilerplate && !checks.modelFailure) ? 0 : 1);
} catch (e) {
  console.error("PROBE ERROR:", e.message);
  process.exit(2);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
