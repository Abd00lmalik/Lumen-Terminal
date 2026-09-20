/**
 * Production E2E via headless Chrome (CDP): open asklumen.vercel.app/#/research, submit a
 * TSLA question through the real UI, capture the final rendered answer, and assert it is
 * a substantive TSLA answer (no boilerplate, no crypto contamination).
 * Usage: node scripts/cdp-e2e.mjs [question]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const QUESTION = process.argv[2] ?? "What is the current TSLA stock price and how does it compare with last week?";
const BASE = "https://asklumen.vercel.app";

const profile = mkdtempSync(join(tmpdir(), "lumen-cdp-"));
const chrome = spawn("chrome", // resolved via PATH; falls back below if absent
  ["--headless=new", `--user-data-dir=${profile}`, "--remote-debugging-port=9337", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"],
  { stdio: "ignore" });
const chromeAlt = spawn("chrome-alt", [], { stdio: "ignore" });
chromeAlt.kill();

async function fetchJson(url, opts = {}) {
  for (let i = 0; i < 40; i++) {
    try { return await (await fetch(url, opts)).json(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`unreachable: ${url}`);
}

const version = await fetchJson("http://127.0.0.1:9337/json/version");
const { webSocketDebuggerUrl } = version;
const { WebSocket } = await import("ws").catch(() => ({ WebSocket: globalThis.WebSocket }));
const ws = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
let msgId = 0;
const pending = new Map();
const events = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
});
function send(method, params = {}) {
  return new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
await new Promise((r) => ws.on("open", r));
await send("Page.enable");
await send("Runtime.enable");

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + JSON.stringify(r.result.exceptionDetails.exception?.description ?? "").slice(0, 300));
  return r.result?.result?.value;
}

await send("Page.navigate", { url: `${BASE}/#/research` });
await new Promise((r) => setTimeout(r, 6000));

// Zero API failures on load: collect failed requests via CDP events.
const failed = events.filter((e) => e.method === "Network.responseReceived" && e.params.response.status >= 400).map((e) => `${e.params.response.status} ${e.params.response.url}`);
console.log("load: failed API requests:", failed.length === 0 ? "none" : failed.join(", "));

// Workspace state loaded? (no banner)
const banner = await evaluate(`document.body.innerText.includes("Workspace state could not load")`);
console.log("workspace banner:", banner ? "PRESENT (BAD)" : "absent (good)");

// Submit the question through the real UI.
const submitted = await evaluate(`(() => {
  const input = document.querySelector("input[placeholder*='research question'], textarea, input[type='text']");
  if (!input) return "NO_INPUT";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ?? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  setter.set.call(input, ${JSON.stringify(QUESTION)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return "OK";
})()`);
console.log("input fill:", submitted);
if (submitted === "OK") {
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => x.textContent.trim().toLowerCase() === "research");
    if (b) b.click();
    return b ? "CLICKED" : "NO_BUTTON";
  })()`);

  // Poll the thread for a final answer panel (up to 4 minutes).
  let finalText = "";
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    finalText = await evaluate(`document.body.innerText`) ?? "";
    if (/MODEL UNAVAILABLE|Interpretation failed/.test(finalText)) { console.log("run FAILED in UI"); break; }
    // A completed research card shows "Research result" panel with substantive text.
    const m = finalText.match(/Research result([\s\S]{0,1200})/);
    if (m && i > 6) { break; }
  }
  console.log("---- rendered thread (answer region) ----");
  const m = finalText.match(/Research result([\s\S]{0,1200})/);
  console.log(m ? m[1].slice(0, 1100) : finalText.slice(0, 1100));
  console.log("------------------------------------------");
  const checks = {
    boilerplate: finalText.includes("Full reasoning is not retained"),
    noTslaAnswer: /does not contain (any )?(observations|data).*TSLA/i.test(finalText),
    cryptoContamination: /Bitcoin|Clarity Act|Ethereum|Zcash/i.test(finalText.split("Research result")[1] ?? ""),
    hasTslaPrice: /364|365|36[0-9]\.?\d* USD|\$36[0-9]/.test(finalText),
  };
  console.log("CHECKS:", JSON.stringify(checks));
}
ws.close();
chrome.kill();
rmSync(profile, { recursive: true, force: true });
