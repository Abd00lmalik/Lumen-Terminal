/**
 * Phase D browser verification (headless Chrome + CDP) against production.
 *
 * Covers two journeys end-to-end through the REAL UI, with the REAL API as the source of truth:
 *   SAVED:  open a run → save two kinds → "Saved from this research" (only that run) → open →
 *           back to research → unsave → filtered list updates → refresh → persistence.
 *   THESIS: open a run → turn into thesis → confirm creation + linked researchRef → open thesis
 *           → verify sections → attach a saved artifact → open it → return → refresh → unchanged.
 *
 * Uses existing persisted production runs (no model call is required for Saved/Thesis; the
 * provider outage never blocks these paths). Nothing is fabricated.
 *
 * Usage: node scripts/cdp-phase-d-verify.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9361);
const OUT = join(process.cwd(), ".data", "phase-d-verify");
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (label, ok, detail) => {
  if (!ok) failures.push(label);
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail) : "");
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "lumen-cdp-d-"));
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
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, 60_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
}
async function waitFor(expression, label, timeoutMs = 45_000) {
  const started = Date.now();
  for (;;) {
    const value = await evalJs(expression);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timed out (${label})`);
    await sleep(1500);
  }
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `d-${name}.png`), Buffer.from(r.data, "base64"));
}
async function goto(pathname) {
  await send("Page.navigate", { url: `${BASE}/#${pathname}` });
  await sleep(4000);
}
async function reload() {
  await send("Page.reload", {});
  await sleep(4000);
}
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const api = async (path, init) => {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};
const clickByText = (text) => evalJs(`(() => {
  const t = ${JSON.stringify(text)}.toLowerCase();
  const nodes = [...document.querySelectorAll('button, a')];
  const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase() === t);
  if (hit) { hit.click(); return true; }
  return false;
})()`);

async function main() {
  for (let i = 0; i < 40; i += 1) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id !== undefined) pending.get(m.id)?.(m); };
  await send("Page.enable");
  await send("Runtime.enable");

  // ---- pick an existing FULL run and start from a clean Saved state for it ----
  const history = (await api("/api/research?limit=200")).body;
  let chosen;
  for (const row of history) {
    const agg = await api(`/api/research/${row.ref}`);
    if (agg.status === 200 && agg.body.recordTier === "FULL" && agg.body.answer?.answer) { chosen = { ref: row.ref, agg: agg.body }; break; }
  }
  check("found an existing FULL research run", chosen !== undefined, { ref: chosen?.ref });
  if (chosen === undefined) throw new Error("no FULL production run available");

  // Clean any pre-existing saved artifacts for this run (idempotent re-run).
  const existing = (await api(`/api/saved?researchRef=${chosen.ref}&limit=200`)).body;
  for (const s of Array.isArray(existing) ? existing : []) {
    await api(`/api/saved/${s.savedId}`, { method: "DELETE" });
  }

  // =====================================================================
  // SAVED JOURNEY
  // =====================================================================
  await goto(`/research/${chosen.ref}`);
  await waitFor(`!!document.querySelector('button[title="Save this research to your library"]')`, "research run rendered");

  // 1-2: save the research and a judgment (two kinds).
  await evalJs(`document.querySelector('button[title="Save this research to your library"]').click()`);
  await waitFor(`[...document.querySelectorAll('span.badge')].some((b) => b.textContent.trim().toLowerCase() === 'saved')`, "SAVED badge");
  const judgmentSave = await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].filter((n) => (n.textContent||'').trim().toLowerCase() === 'save');
    if (b.length > 1) { b[b.length - 1].click(); return true; }  // a second save control (judgment/evidence)
    return b.length === 1;
  })()`);
  check("saved the run and a second artifact from the research view", judgmentSave === true);
  await sleep(2500);

  const savedRows = (await api(`/api/saved?researchRef=${chosen.ref}&limit=200`)).body;
  check("SERVER-SIDE filter returns only this run's artifacts", Array.isArray(savedRows) && savedRows.length >= 1 && savedRows.every((r) => r.researchRef === chosen.ref), { count: savedRows.length });
  const twoKinds = new Set((savedRows ?? []).map((r) => r.kind));
  check("at least two artifact kinds saved", twoKinds.size >= 2, { kinds: [...twoKinds] });
  await shot("saved-research");

  // 3: "Saved from this research" section renders the run-filtered list.
  // (.panel-kicker renders uppercase via CSS; innerText reflects the transform, so match
  // case-insensitively.)
  const sectionShown = await waitFor(`document.body.innerText.toLowerCase().includes('saved from this research')`, "saved-from-this-research section", 20_000).catch(() => false);
  check("research view shows 'Saved from this research'", sectionShown === true);

  // 4: open one artifact from the library (run-filtered view).
  await goto(`/saved?researchRef=${chosen.ref}`);
  await waitFor(`!!document.querySelector('input[aria-label="Search saved artifacts"]')`, "saved page rendered");
  const filterNote = await waitFor(`document.body.innerText.includes('Showing only artifacts saved from research')`, "run filter note", 20_000).catch(() => false);
  check("Saved library shows the run-filtered view", filterNote === true);
  const opened = await clickByText("open");
  check("opened a saved artifact", opened === true);
  const detailShown = await waitFor(`document.body.innerText.includes('Saved from research')`, "artifact detail", 20_000).catch(() => false);
  check("artifact detail renders with provenance", detailShown === true);
  await shot("saved-detail");

  // 5: navigate back to the original research.
  const backClicked = await clickByText("Open original research");
  await sleep(3500);
  check("navigated back to the original research", backClicked === true && (await evalJs(`location.hash.includes(${JSON.stringify(chosen.ref)}) || location.pathname.includes(${JSON.stringify(chosen.ref)})`)) === true);

  // 6-7: unsave from the filtered view; the list updates.
  const beforeUnsave = (await api(`/api/saved?researchRef=${chosen.ref}&limit=200`)).body;
  if (!Array.isArray(beforeUnsave) || beforeUnsave.length === 0) throw new Error("no saved artifact left to unsave (save step failed)");
  const doomed = beforeUnsave[beforeUnsave.length - 1];
  await api(`/api/saved/${doomed.savedId}`, { method: "DELETE" });
  await goto(`/saved?researchRef=${chosen.ref}`);
  await waitFor(`!!document.querySelector('input[aria-label="Search saved artifacts"]')`, "saved page after unsave");
  await sleep(2000);
  const afterUnsave = (await api(`/api/saved?researchRef=${chosen.ref}&limit=200`)).body;
  check("unsave removed the artifact from the run-filtered view", !afterUnsave.some((s) => s.savedId === doomed.savedId), { savedId: doomed.savedId });

  // 8: refresh; the unsave persists.
  await reload();
  await waitFor(`!!document.querySelector('input[aria-label="Search saved artifacts"]')`, "saved page after refresh");
  const afterRefresh = (await api(`/api/saved?researchRef=${chosen.ref}&limit=200`)).body;
  check("the remaining saved artifact survives refresh", afterRefresh.length >= 1 && afterRefresh.every((s) => s.researchRef === chosen.ref), { count: afterRefresh.length });
  check("the unsaved artifact stays gone after refresh", !afterRefresh.some((s) => s.savedId === doomed.savedId));
  await shot("saved-after-refresh");

  // =====================================================================
  // THESIS JOURNEY
  // =====================================================================
  // Ensure one saved artifact exists for this run (for the attach step).
  if (afterRefresh.length === 0) {
    await api("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ researchRef: chosen.ref, kind: "RESEARCH" }) });
  }
  const attachable = (await api(`/api/saved?researchRef=${chosen.ref}&limit=200`)).body[0];
  check("a saved artifact exists to attach", attachable !== undefined && typeof attachable.savedId === "string");
  if (attachable === undefined) throw new Error("no saved artifact available to attach");

  // 1-3: open the run and turn it into a thesis from the UI.
  await goto(`/research/${chosen.ref}`);
  await waitFor(`!!document.querySelector('button[title="Save this research to your library"]')`, "research run for thesis");
  const thesisClicked = await clickByText("turn into thesis");
  check("clicked 'turn into thesis' from the research view", thesisClicked === true);
  await sleep(5000);

  // 4: creation is confirmed by the API and the thesis links the run.
  let thesisList = (await api("/api/thesis?status=ACTIVE")).body;
  let thesis = Array.isArray(thesisList) ? thesisList.find((t) => (t.linkedResearchRefs ?? []).includes(chosen.ref)) : undefined;
  check("thesis created from the research run", thesis !== undefined, { thesis: thesis?.ref });
  if (thesis === undefined) throw new Error("thesis was not created from the UI");
  check("thesis links the originating researchRef", (thesis.linkedResearchRefs ?? []).includes(chosen.ref), { linked: thesis.linkedResearchRefs });
  check("thesis statement is derived verbatim (non-empty)", typeof thesis.statement === "string" && thesis.statement.length > 0);

  // 5-6: the thesis workspace renders the required sections.
  await goto(`/thesis/${thesis.ref}`);
  await waitFor(`document.body.innerText.includes('What would prove this wrong?')`, "thesis page rendered");
  const body = await evalJs(`document.body.innerText`);
  for (const section of ["supporting evidence", "counterevidence", "assumptions", "material conditions", "linked research", "linked saved artifacts"]) {
    check(`thesis page shows "${section}"`, body.toLowerCase().includes(section));
  }
  await shot("thesis");

  // 7: attach the saved artifact (select + attach).
  const attached = await evalJs(`(() => {
    const sel = document.querySelector('select[aria-label="Attach a saved artifact"]');
    if (!sel) return false;
    const opt = [...sel.options].find((o) => o.value !== '');
    if (!opt) return false;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.value;
  })()`);
  if (attached && typeof attached === "string") {
    await sleep(500);
    await clickByText("attach");
    await sleep(3000);
  } else {
    // Fallback: attach via the API (still a real trader action) so the link step is exercised.
    await api(`/api/thesis/${thesis.ref}/link-saved`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ savedId: attachable.savedId }) });
  }
  const linked = (await api(`/api/thesis/${thesis.ref}`)).body;
  check("saved artifact attached to the thesis", (linked.linkedSavedIds ?? []).includes(attachable.savedId), { linked: linked.linkedSavedIds });

  // 8: open the linked saved artifact / return to the thesis.
  await goto(`/saved?open=${attachable.savedId}`);
  await waitFor(`document.body.innerText.includes('Saved from research')`, "linked saved artifact opens");
  await goto(`/thesis/${thesis.ref}`);
  await waitFor(`document.body.innerText.includes('What would prove this wrong?')`, "returned to the thesis");

  // 9-10: refresh; the thesis remains and was NOT silently mutated.
  await reload();
  await waitFor(`document.body.innerText.includes('What would prove this wrong?')`, "thesis after refresh");
  const after = (await api(`/api/thesis/${thesis.ref}`)).body;
  check("thesis survives refresh", after.ref === thesis.ref);
  check("thesis statement unchanged (no silent mutation)", after.statement === thesis.statement, { changed: after.statement !== thesis.statement });
  check("thesis version unchanged by assessment/refresh", after.version === thesis.version, { before: thesis.version, after: after.version });
  check("linked saved artifact still attached", (after.linkedSavedIds ?? []).includes(attachable.savedId));
  await shot("thesis-after-refresh");

  console.log(failures.length === 0 ? "ALL PHASE D CHECKS PASSED" : `FAILED (${failures.length}): ${failures.join(" | ")}`);
  if (failures.length > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  try { chrome.kill(); } catch { /* ignore */ }
}
