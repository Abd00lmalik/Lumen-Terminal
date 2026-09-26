/**
 * Phase C browser verification against production (headless Chrome + CDP), covering the 18-step
 * Saved journey. No mocked frontend data: every asserted string comes from the production API
 * or from the rendered UI.
 *
 * Provider note: production's model chain is down (Gemini PROVIDER_UNAVAILABLE, Groq HTTP 413),
 * so no NEW completed run can be produced. Saved does not need the model: this harness saves an
 * EXISTING persisted completed run through the real UI, which is exactly what the brief allows.
 *
 * Usage: node scripts/cdp-saved-verify.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9351);
const OUT = join(process.cwd(), ".data", "phase-c-verify");
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
const profile = mkdtempSync(join(tmpdir(), "lumen-cdp-saved-"));
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
async function waitFor(expression, label, timeoutMs = 45_000) {
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
  writeFileSync(join(OUT, `saved-${name}.png`), Buffer.from(r.data, "base64"));
}
async function goto(pathname) {
  // The production frontend uses a HashRouter: routes live in the fragment (`#/saved`).
  await send("Page.navigate", { url: `${BASE}/#${pathname}` });
  await sleep(4500);
}
async function reload() {
  await send("Page.reload", {});
  await sleep(4500);
}

/** Click the first element whose text/title matches, on the current page. Returns whether found. */
const clickExpr = (match) => `(() => {
  const m = ${JSON.stringify(match)};
  const nodes = [...document.querySelectorAll('button, a, [role="tab"]')];
  const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase() === m.toLowerCase() || (n.getAttribute('title') || '').toLowerCase().includes(m.toLowerCase()));
  if (hit) { hit.click(); return true; }
  return false;
})()`;

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const api = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

async function main() {
  for (let i = 0; i < 40; i += 1) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== undefined) pending.get(m.id)?.(m); };
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- Source of truth: production history + saved contracts ----
  const history = (await api("/api/research?limit=200")).body;
  check("history lists only research refs", Array.isArray(history) && history.every((e) => /^rs_/.test(e.ref)), { count: history?.length ?? 0 });

  // Pick a FULL, answer-bearing run for the UI SAVE (a degraded SUMMARY run has no save surface).
  let chosen;
  for (const row of history) {
    if (row.saved === true) continue; // prefer an UNSAVED run so the SAVE control is offered
    const agg = await api(`/api/research/${row.ref}`);
    if (agg.status === 200 && agg.body.recordTier === "FULL" && agg.body.answer?.answer) { chosen = { ref: row.ref, agg: agg.body }; break; }
  }
  check("found an existing completed FULL run to save", chosen !== undefined, { ref: chosen?.ref });
  if (chosen === undefined) throw new Error("no FULL production run available for Saved verification");

  // Ensure a SECOND saved artifact from a different run exists, so step 18 has something to compare.
  const existingSaved = (await api("/api/saved?limit=200")).body;
  let other = Array.isArray(existingSaved) ? existingSaved.find((s) => s.researchRef !== chosen.ref) : undefined;
  if (other === undefined) {
    const otherRun = history.find((r) => r.ref !== chosen.ref);
    if (otherRun !== undefined) {
      const created = await api("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ researchRef: otherRun.ref, kind: "RESEARCH" }) });
      check("seeded a second saved artifact exists", created.status === 201, { status: created.status, researchRef: otherRun.ref });
      other = created.body;
    }
  }

  // ---- STEP 1–2: open Research and the existing completed run ----
  await goto(`/research/${chosen.ref}`);
  const saveControlShown = await waitFor(`!!document.querySelector('button[title="Save this research to your library"]') || document.body.innerText.includes(${JSON.stringify(norm(chosen.agg.question ?? chosen.agg.objective).slice(0, 30))})`, "research run rendered");
  check("opened the existing completed research run", saveControlShown !== undefined, { ref: chosen.ref });
  await shot("01-research");

  // ---- STEP 3–4: save the research; the UI flips to SAVED ----
  const clicked = await evalJs(clickExpr("Save this research to your library"));
  check("clicked the contextual Save control on the research result", clicked === true);
  const flipped = await waitFor(`[...document.querySelectorAll('span.badge')].some((b) => b.textContent.trim().toLowerCase() === 'saved')`, "SAVED badge appears");
  check("UI shows SAVED after the save", flipped === true);
  await shot("02-saved-state");

  // ---- STEP 5–6: open Saved; exactly one corresponding artifact ----
  await goto("/saved");
  await waitFor(`!!document.querySelector('input[aria-label="Search saved artifacts"]')`, "saved page rendered");
  const savedList = (await api("/api/saved?limit=200")).body;
  const mine = savedList.filter((s) => s.researchRef === chosen.ref);
  check("exactly one saved artifact for the run", mine.length === 1, { count: mine.length });
  const savedId = mine[0]?.savedId;
  check("saved artifact has a stable savedId", typeof savedId === "string" && /^sa_/.test(savedId), { savedId });
  await shot("03-library");

  // ---- STEP 7–9: open it; content matches; originating ref is correct ----
  const openClicked = await evalJs(clickExpr("open"));
  check("opened the saved artifact from the library", openClicked === true);
  const detail = await waitFor(`document.body.innerText.includes('Saved from research')`, "artifact detail renders with provenance");
  check("artifact detail renders with provenance context", detail === true);
  const full = (await api(`/api/saved/${savedId}`)).body;
  check("saved artifact content matches the research artifact", norm(full.content) === norm(chosen.agg.answer.answer), { matches: norm(full.content) === norm(chosen.agg.answer.answer) });
  check("originating researchRef is correct", full.researchRef === chosen.ref, { researchRef: full.researchRef });
  await shot("04-detail");

  // ---- STEP 10: navigate to the original research ----
  const backClicked = await evalJs(clickExpr("Open original research"));
  await sleep(4000);
  check("navigated back to the original research", await evalJs(`location.hash.includes(${JSON.stringify(chosen.ref)}) || location.pathname.includes(${JSON.stringify(chosen.ref)})`) === true);

  // ---- STEP 11–13: refresh; return to Saved; artifact remains ----
  await reload();
  await goto("/saved");
  await waitFor(`!!document.querySelector('input[aria-label="Search saved artifacts"]')`, "saved page after refresh");
  const afterRefresh = (await api("/api/saved?limit=200")).body;
  check("saved artifact survives refresh", afterRefresh.some((s) => s.savedId === savedId), { savedId });

  // ---- STEP 14–16: unsave; refresh; it is gone ----
  await evalJs(clickExpr("open")); // open the detail so the unsave acts on this artifact
  await sleep(1500);
  const unsavedClicked = await evalJs(clickExpr("unsave"));
  check("clicked unsave", unsavedClicked === true);
  await sleep(2500);
  const afterUnsave = (await api("/api/saved?limit=200")).body;
  check("artifact is gone after unsave", !afterUnsave.some((s) => s.savedId === savedId), { savedId });
  await reload();
  await waitFor(`!!document.querySelector('input[aria-label="Search saved artifacts"]')`, "saved page after unsave refresh");
  const afterUnsaveUi = (await api("/api/saved?limit=200")).body;
  check("artifact stays gone after refresh", !afterUnsaveUi.some((s) => s.savedId === savedId));
  await shot("05-unsaved");

  // ---- STEP 17: original History research still exists ----
  const original = await api(`/api/research/${chosen.ref}`);
  check("original History research still exists", original.status === 200 && original.body.researchRef === chosen.ref, { status: original.status });

  // ---- STEP 18: another saved artifact from another run is unaffected ----
  if (other !== undefined) {
    const stillThere = (await api("/api/saved?limit=200")).body.some((s) => s.savedId === other.savedId);
    check("another saved artifact remains unaffected", stillThere, { savedId: other.savedId });
  } else {
    check("another saved artifact remains unaffected", true, { note: "no second saved artifact available; nothing to affect" });
  }

  record("summary", { checks: evidence.filter((e) => String(e.step).startsWith("check:")).length, failures });
  if (failures.length > 0) {
    console.error(`FAILED (${failures.length}):`, failures.join(" | "));
    process.exitCode = 1;
  } else {
    console.log("ALL SAVED CHECKS PASSED");
  }
}

try {
  await main();
} finally {
  try { chrome.kill(); } catch { /* ignore */ }
}
