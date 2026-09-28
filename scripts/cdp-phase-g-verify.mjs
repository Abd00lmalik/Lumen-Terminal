/**
 * Phase G — Real-browser Challenge verification (production, brief §Verification).
 *
 * Admin (persisted Firebase session from Phase F.1, profile-d):
 *   node scripts/cdp-phase-g-verify.mjs g1a   # research via UI → run completes → create thesis via UI
 *   node scripts/cdp-phase-g-verify.mjs g1b   # /challenge → "Challenge my thesis" → records persist → reload proves persistence
 *
 * Second-user isolation (g2) needs a fresh sign-in link for User B (Firebase daily email
 * quota permitting); LINK='<paste>' node scripts/cdp-phase-g-verify.mjs g2
 *
 * State: .data/phase-g-verify/ ; Chrome profiles reused from .data/phase-f1-acceptance/
 * (the admin session lives there). Tokens are captured from the page's own 200-producing
 * traffic and never printed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const CHROME_PATH = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9372);
const F1 = join(process.cwd(), ".data", "phase-f1-acceptance");
const OUT = join(process.cwd(), ".data", "phase-g-verify");
mkdirSync(OUT, { recursive: true });

const QUESTION = "What is the current Bitcoin price in US dollars and its 24h trend?";
const stage = process.argv[2] ?? "";
const LINK = process.env.LINK ?? "";

const results = [];
const check = (label, ok, detail) => {
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail) : "");
  results.push({ label, ok, ...(detail !== undefined ? { detail } : {}) });
};
const saveResults = (name) => writeFileSync(join(OUT, name), JSON.stringify(results, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statePath = (name) => join(OUT, name);
const loadState = (name) => (existsSync(statePath(name)) ? JSON.parse(readFileSync(statePath(name), "utf8")) : {});
const saveState = (name, obj) => writeFileSync(statePath(name), JSON.stringify(obj, null, 2));

// ---------------------------------------------------------------- CDP client (F.1 helpers)
function launchChrome(tag) {
  const dir = join(F1, `profile-${tag}`);
  mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", `--user-data-dir=${dir}`, `--remote-debugging-port=${PORT}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,1000",
    "about:blank",
  ], { stdio: "ignore" });
  const shutdown = () => { try { chrome.kill(); } catch { /* already dead */ } };
  process.on("exit", shutdown);
  process.on("SIGINT", shutdown);
  return chrome;
}

let ws;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
let lastAuthHeader = null;
const reqHeaders = new Map();

function attach(socket) {
  socket.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) { pending.get(m.id)?.(m); return; }
    if (m.method === "Runtime.exceptionThrown") consoleErrors.push(`exception: ${m.params?.exceptionDetails?.text ?? "?"}`);
    if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
      consoleErrors.push(`console.error: ${JSON.stringify(m.params?.args?.map((a) => a.value ?? a.description) ?? [])}`);
    }
    if (m.method === "Network.requestWillBeSent") {
      const r = m.params?.request;
      if (r?.url?.startsWith(`${BASE}/api/`)) reqHeaders.set(m.params.requestId, r.headers ?? {});
    }
    if (m.method === "Network.responseReceived") {
      const res = m.params?.response;
      if (res?.status === 200 && res?.url?.startsWith(`${BASE}/api/`)) {
        const h = reqHeaders.get(m.params.requestId) ?? {};
        const auth = h.Authorization ?? h.authorization;
        if (typeof auth === "string" && /^Bearer .+/.test(auth)) lastAuthHeader = auth;
      }
    }
  };
}

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); }
  }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  attach(ws);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
}

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "eval failed");
  return r.result?.value;
}
async function waitFor(expression, label, timeoutMs = 45_000) {
  const started = Date.now();
  for (;;) {
    const v = await evalJs(expression).catch(() => undefined);
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timed out (${label})`);
    await sleep(1500);
  }
}
async function goto(pathname) {
  await send("Page.navigate", { url: `${BASE}/#${pathname}` });
  await waitFor(`document.body.innerText.trim().length > 50`, "page paint", 15_000).catch(() => {});
  await sleep(1500);
}
async function reload() {
  await send("Page.reload", {});
  await waitFor(`document.body.innerText.trim().length > 50`, "page paint", 15_000).catch(() => {});
  await sleep(1500);
}
const setValue = (aria, value) => evalJs(`(() => {
  const i = document.querySelector('input[aria-label="${aria}"]');
  if (!i) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const clickByTitleContains = (needle) => evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes(${JSON.stringify(needle)}));
  if (!b) return false; b.click(); return true;
})()`);
const clickByText = (text) => evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false; b.click(); return true;
})()`);

/** Authenticated API call using the token captured from the page's own 200 traffic. */
async function api(path, init = {}) {
  if (lastAuthHeader === null) throw new Error("no Authorization header captured yet (page has not called the API signed-in)");
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: lastAuthHeader } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/** Wait for a run with the given question SUBMITTED AFTER startedAfter to reach a persisted FULL state. */
async function waitForRun(question, startedAfter) {
  const deadline = Date.now() + 330_000;
  while (Date.now() < deadline) {
    try {
      const list = await api("/api/research?limit=10");
      const rows = Array.isArray(list.body) ? list.body : [];
      const row = rows.find((r) => typeof r?.question === "string" && r.question.includes(question)
        && (typeof r?.createdAt === "string" ? r.createdAt > startedAfter : true));
      if (row !== undefined) {
        const agg = await api(`/api/research/${row.ref}`);
        const full = agg.status === 200 && agg.body?.recordTier === "FULL" && typeof agg.body?.answer?.answer === "string" && agg.body.answer.answer.length > 0;
        if (full) return row.ref;
        if (agg.body?.outcome === "MODEL_FAILURE") { console.log("NOTE: provider chain failure recorded honestly:", JSON.stringify(agg.body?.modelFailure ?? null)); return null; }
      }
    } catch { /* token not captured yet or transient; retry */ }
    await sleep(6000);
  }
  return null;
}

async function researchViaUi(question) {
  const startedAfter = new Date(Date.now() - 5_000).toISOString();
  await goto("/research");
  const typed = await setValue("Ask a research question", question);
  check("[g] question typed into the research composer", typed === true);
  const clicked = await clickByText("Research");
  check("[g] Research submitted through the real UI", clicked === true);
  const running = await waitFor(`document.body.innerText.includes('Researching') || document.body.innerText.includes('research pipeline')`, "run started", 30_000).catch(() => false);
  check("[g] run stream started (progress visible)", running === true);
  console.log("[g] waiting for the run to complete (real provider chain; up to ~5.5 min)...");
  const ref = await waitForRun(question, startedAfter);
  check("[g] research completed and persisted (FULL record)", typeof ref === "string", { ref: ref ?? null });
  return ref;
}

/** Re-enter the authenticated app until a 200-producing auth header is captured. */
async function ensureSession(label) {
  await goto("/history");
  const deadline = Date.now() + 30_000;
  while (lastAuthHeader === null && Date.now() < deadline) {
    await goto("/history");
    await sleep(2000);
  }
  const who = await evalJs(`document.querySelector('[aria-label="Account identity indicator"]')?.getAttribute('title') ?? null`);
  check(`[${label}] signed-in session live (account indicator present)`, typeof who === "string" && who.length > 0, { indicator: who ?? null });
  return who;
}

async function main() {
  if (!["g1a", "g1b", "g2"].includes(stage)) throw new Error("stage must be g1a | g1b | g2");
  const profileTag = stage === "g2" ? "b" : "d";
  const chrome = launchChrome(profileTag);
  try {
    await connect();

    if (stage === "g1a") {
      await ensureSession(stage);
      const ref = await researchViaUi(QUESTION);
      if (typeof ref !== "string") { saveResults(`results-${stage}.json`); return; }

      await goto(`/research/${ref}`);
      await sleep(2500);
      const created = await clickByTitleContains("trader-owned thesis");
      if (created !== true) { await sleep(2500); }
      check("[g1a] thesis creation control present and clicked on the run view", created === true);
      // The create navigates to the thesis page; give the POST time to land, then verify.
      let mine;
      const thesisDeadline = Date.now() + 30_000;
      while (Date.now() < thesisDeadline) {
        const theses = await api("/api/theses");
        mine = (Array.isArray(theses.body) ? theses.body : []).find((t) => Array.isArray(t.linkedResearchRefs) && t.linkedResearchRefs.includes(ref));
        if (mine !== undefined) break;
        await sleep(3000);
      }
      check("[g1a] thesis exists and links the run (API)", mine !== undefined, { thesisRef: mine?.ref ?? null, status: mine?.status ?? null });
      const allTheses = await api("/api/theses");
      const active = (Array.isArray(allTheses.body) ? allTheses.body : []).filter((t) => t.status !== "ARCHIVED");
      check("[g1a] exactly one active thesis in the workspace (challenge target is unambiguous)", active.length === 1, { count: active.length });
      check("[g1a] thesis statement is trader material (the question), never a process notice", mine === undefined || !(mine.statement ?? "").includes("Request understood"), { statement: String(mine?.statement ?? "").slice(0, 80) });
      saveState("admin.json", { runRef: ref, thesisRef: mine?.ref ?? null, question: QUESTION });
      saveResults(`results-${stage}.json`);
      return;
    }

    if (stage === "g1b") {
      const state = loadState("admin.json");
      if (typeof state.thesisRef !== "string") throw new Error("g1a state missing; run g1a first");
      await ensureSession(stage);

      // Thesis untouched before the challenge.
      const before = await api(`/api/thesis/${state.thesisRef}`);
      check("[g1b] thesis readable before the challenge", before.status === 200 && before.body?.version === 1, { version: before.body?.version ?? null });

      // Zero challenges FOR THIS THESIS (the workspace may legitimately hold records for
      // other/older theses; the page shows them under their own status badges).
      const pre = await api(`/api/challenges?thesisRef=${state.thesisRef}`);
      check("[g1b] zero persisted challenges for the new thesis (honest empty state)", pre.status === 200 && Array.isArray(pre.body) && pre.body.length === 0, { rows: Array.isArray(pre.body) ? pre.body.length : "n/a" });

      await goto("/challenge");
      await sleep(1500);
      const sections = await evalJs(`document.body.innerText`);
      check("[g1b] Challenge page renders the persistent-record surface", sections.includes("What could prove this wrong?") && sections.includes("Last researched"), {});

      const clicked = (await clickByText("Challenge my thesis")) === true ? true : (await clickByText("Re-run challenge research")) === true;
      check("[g1b] challenge run started through the real UI control", clicked === true);

      // Wait for the derivation to land. Fast path: records may already exist for this thesis
      // (previous verified run) — then this stage re-verifies persistence/render without
      // burning another 3.5-minute research cycle.
      let challenges = [];
      const preExisting = await api(`/api/challenges?thesisRef=${state.thesisRef}`);
      const already = preExisting.status === 200 && Array.isArray(preExisting.body) && preExisting.body.length > 0;
      if (already) {
        console.log("[g1b] records already persisted for this thesis; verifying persistence/render directly");
        challenges = preExisting.body;
      } else {
        console.log("[g1b] falsification research running (real provider chain; up to ~4 min)...");
        const deadline = Date.now() + 340_000;
        while (Date.now() < deadline) {
          const list = await api(`/api/challenges?thesisRef=${state.thesisRef}`);
          if (list.status === 200 && Array.isArray(list.body) && list.body.length > 0) { challenges = list.body; break; }
          await sleep(6000);
        }
      }
      check("[g1b] challenge records persisted (API)", challenges.length > 0, { count: challenges.length, fastPath: already });
      if (challenges.length > 0) {
        const c = challenges[0];
        check("[g1b] record carries the full brief chain (falsifier, evidence, gaps, status, provenance)",
          typeof c.falsifier?.condition === "string" && Array.isArray(c.supportingEvidenceRefs) && Array.isArray(c.counterEvidenceRefs)
          && Array.isArray(c.informationGaps) && typeof c.status === "string" && Array.isArray(c.provenance) && c.provenance.length > 0,
          { ref: c.ref, status: c.status, materiality: c.falsifier?.materiality, origin: c.falsifier?.origin });
        check("[g1b] challenge references the thesis version (never mutates it)", c.thesisRef === state.thesisRef && typeof c.thesisVersion === "number", { thesisVersion: c.thesisVersion });
      }
      await reload();
      await sleep(2000);
      const after = await evalJs(`document.body.innerText`);
      const rendered = challenges.length > 0 && challenges.every((c) => after.includes(c.ref));
      check("[g1b] records SURVIVE REFRESH and render in the UI (persistence law)", rendered === true, { renderedRefs: challenges.map((c) => c.ref) });
      check("[g1b] UI shows the required sections (thesis, falsifier, provenance, last researched)",
        after.includes("falsifier:") && after.includes("provenance") && after.includes("Last researched"), {});

      const afterApi = await api(`/api/thesis/${state.thesisRef}`);
      check("[g1b] thesis IMMUTABLE after challenge (version/statement unchanged)",
        afterApi.status === 200 && afterApi.body?.version === 1 && afterApi.body?.statement === before.body?.statement,
        { version: afterApi.body?.version ?? null });
      saveState("admin-after.json", { challenges: challenges.map((c) => ({ ref: c.ref, status: c.status })) });
      saveResults(`results-${stage}.json`);
      return;
    }

    if (stage === "g2") {
      if (LINK === "") throw new Error("g2 needs LINK='<paste the B sign-in link>' (B's session was signed out after the F.1 run)");
      await send("Page.navigate", { url: LINK });
      await waitFor(
        `!!document.querySelector('[aria-label="Account identity indicator"]') || document.body.innerText.includes('Signed in as')`,
        "B email-link completion", 45_000,
      ).catch(() => {});
      const who = await ensureSession(stage);
      check("[g2] second user signed in (distinct account)", typeof who === "string" && who.includes("phasef1b"), { indicator: who ?? null });

      const admin = loadState("admin.json");
      const bEmpty = await api("/api/challenges");
      check("[g2] B's challenge list is EMPTY (cannot see A's records)", bEmpty.status === 200 && Array.isArray(bEmpty.body) && bEmpty.body.length === 0, { rows: Array.isArray(bEmpty.body) ? bEmpty.body.length : "n/a" });
      if (typeof admin.thesisRef === "string") {
        const bCross = await api(`/api/challenges?thesisRef=${admin.thesisRef}`);
        check("[g2] B querying A's thesisRef yields nothing (existence hidden, 200-empty/404)", bCross.status === 200 ? (Array.isArray(bCross.body) && bCross.body.length === 0) : bCross.status === 404, { status: bCross.status });
        const bThesis = await api(`/api/thesis/${admin.thesisRef}`);
        check("[g2] B cannot open A's thesis (404)", bThesis.status === 404, { status: bThesis.status });
      }
      const bRun = await api("/api/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      check("[g2] B's challenge run on an empty workspace is a typed clarification (400 no-active-thesis)", bRun.status === 400 && String(bRun.body?.error?.message ?? "").includes("no active thesis"), { status: bRun.status, message: String(bRun.body?.error?.message ?? "").slice(0, 80) });
      saveResults(`results-${stage}.json`);
      return;
    }
  } catch (err) {
    console.log("FATAL", err instanceof Error ? err.message : String(err));
    saveResults(`results-${stage}.json`);
    process.exitCode = 1;
  } finally {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\nSTAGE ${stage}: ${passed}/${results.length} checks passed`);
    try { chrome.kill(); } catch { /* already dead */ }
  }
}
main();
