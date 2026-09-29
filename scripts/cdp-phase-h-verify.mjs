/**
 * Phase H production verification (staged; mirrors the proven Phase G CDP driver):
 *   h1a: admin session → monitors baseline → create-from-challenge → explicit activate.
 *   h1b: Check now → assessment persisted (+notification if material) → idempotent re-check →
 *        reload → persistence + thesis byte-identical.
 *   h2:  second-user isolation (needs LINK): B sees zero monitors/notifications, 404 on A's ref.
 * State: .data/phase-h-acceptance/. Auth headers are captured from 200 traffic only; never printed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const CHROME_PATH = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9382);
const F1 = join(process.cwd(), ".data", "phase-f1-acceptance");
const OUT = join(process.cwd(), ".data", "phase-h-acceptance");
mkdirSync(OUT, { recursive: true });

const stage = process.argv[2] ?? "";
const LINK = process.env.LINK ?? "";
const THESIS_REF = process.env.THESIS_REF ?? "th_000012";

const results = [];
const check = (label, ok, detail) => {
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail) : "");
  results.push({ label, ok, ...(detail !== undefined ? { detail } : {}) });
};
const saveResults = (name) => writeFileSync(join(OUT, name), JSON.stringify(results, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
/** Wait for a 200-producing /api request to expose a Bearer header (F.1 capture law). */
async function waitForAuth(timeoutMs = 60_000) {
  const started = Date.now();
  while (lastAuthHeader === null) {
    if (Date.now() - started > timeoutMs) throw new Error("no Authorization header captured from 200 traffic");
    await sleep(800);
  }
  return lastAuthHeader;
}
/** Authenticated API call using the captured token. */
async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: lastAuthHeader } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
if (stage === "h1a") {
  launchChrome("d");
  await connect();
  await goto("/history");
  const deadline = Date.now() + 30_000;
  while (lastAuthHeader === null && Date.now() < deadline) {
    await goto("/history");
    await sleep(2000);
  }
  await waitForAuth();
  const who = await evalJs(`document.querySelector('[aria-label="Account identity indicator"]')?.getAttribute('title') ?? null`);
  check("h1a.0 admin session live (account indicator present)", typeof who === "string" && who.length > 0, { indicator: who ?? null });
  // The real route is /monitor (singular) — verified below against the rendered UI.

  const list = await api("/api/monitors");
  check("h1a.1 monitors list 200", list.status === 200, Object.keys(list.body ?? {}));

  const thesis = await api(`/api/thesis/${THESIS_REF}`);
  check("h1a.2 target thesis exists", thesis.status === 200, String(thesis.body?.statement ?? "").slice(0, 70));

  const challenges = await api(`/api/challenges?thesisRef=${THESIS_REF}`);
  const chCount = Array.isArray(challenges.body) ? challenges.body.length : 0;
  check("h1a.3 challenge records exist to derive conditions from", challenges.status === 200 && chCount > 0, { count: chCount });

  const created = await api("/api/monitors/from-challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thesisRef: THESIS_REF, cadence: "MANUAL", title: "BTC liquidity falsifier watch" }) });
  check("h1a.4 monitor created from challenge (PROPOSED)", created.status === 200 && created.body?.monitor?.status === "PROPOSED", { ref: created.body?.monitor?.ref });
  if (created.status !== 200) { saveResults("h1a.json"); process.exit(1); }
  const monitorRef = created.body.monitor.ref;

  const activated = await api(`/api/monitors/${monitorRef}/activate`, { method: "POST" });
  check("h1a.5 explicit activation → ACTIVE", activated.status === 200 && activated.body?.status === "ACTIVE");

  const grouped = await api("/api/monitors");
  check("h1a.6 monitor listed under active", Array.isArray(grouped.body?.active) && grouped.body.active.some((m) => m.ref === monitorRef));

  // UI rendering: the Monitor page (route /monitor) shows the ACTIVE monitor with its
  // challenge-derived condition and the Check now control (§14).
  await goto("/monitor");
  await sleep(2500);
  const uiText = await evalJs("document.body.innerText");
  const uiOk = typeof uiText === "string" && uiText.includes(created.body.monitor.target) && uiText.includes("Check now") && /Invalidation|Early warning/i.test(uiText);
  check("h1a.7 Monitor page renders the active monitor (target, condition, Check now)", uiOk, { route: "/monitor", target: created.body.monitor.target });

  writeFileSync(join(OUT, "monitor-ref.txt"), monitorRef);
  saveResults("h1a.json");
  process.exit(0);
}

// ---------------------------------------------------------------------------
if (stage === "h1b") {
  const monitorRef = readFileSync(join(OUT, "monitor-ref.txt"), "utf8").trim();
  launchChrome("d");
  await connect();
  await goto("/history");
  const authDeadline = Date.now() + 30_000;
  while (lastAuthHeader === null && Date.now() < authDeadline) {
    await goto("/history");
    await sleep(2000);
  }
  await waitForAuth();

  const thesisBefore = await api(`/api/thesis/${THESIS_REF}`);
  const thesisBeforeStr = JSON.stringify(thesisBefore.body);

  // Check now — may run real research; poll up to 5 minutes.
  let checkRes;
  {
    const started = Date.now();
    for (;;) {
      try {
        checkRes = await api(`/api/monitors/${monitorRef}/check`, { method: "POST" });
        break;
      } catch (e) {
        if (Date.now() - started > 300_000) { console.log("FAIL h1b.1 check did not return within 300s", String(e).slice(0, 120)); process.exit(1); }
        process.stdout.write(`  ...check still in flight (${Math.round((Date.now() - started) / 1000)}s)\n`);
        await sleep(15_000);
      }
    }
  }
  const cb = checkRes.body ?? {};
  check("h1b.1 Check now 200 + executed", checkRes.status === 200 && cb.executed === true, { outcome: cb.assessment?.outcome });
  check("h1b.2 assessment persisted with checkId", typeof cb.assessment?.checkId === "string" && cb.assessment.checkId.length > 0);
  check("h1b.3 typed thesis impact present (never auto-invalidates)", cb.assessment?.thesisImpact !== undefined, String(cb.assessment?.thesisImpact));
  if (cb.assessment?.outcome === "MATERIAL_CHANGE") {
    check("h1b.4 material change produced notification", cb.notification !== undefined && String(cb.notification.ref ?? "").startsWith("nt_"));
    check("h1b.5 notification links the assessment's research", cb.notification?.researchRef === cb.assessment?.researchRef);
  } else {
    check("h1b.4 non-material outcome → no notification", cb.notification === undefined, { outcome: cb.assessment?.outcome });
  }
  check("h1b.6 outcome in the typed enum", ["NO_MATERIAL_CHANGE", "MATERIAL_CHANGE", "INSUFFICIENT_EVIDENCE", "PROVIDER_UNAVAILABLE", "MONITOR_PAUSED"].includes(cb.assessment?.outcome), { outcome: cb.assessment?.outcome });

  const assessments = await api(`/api/monitors/${monitorRef}/assessments`);
  check("h1b.7 assessments endpoint serves the persisted record", assessments.status === 200 && Array.isArray(assessments.body) && assessments.body.some((a) => a.checkId === cb.assessment?.checkId), { count: Array.isArray(assessments.body) ? assessments.body.length : 0 });

  const again = await api(`/api/monitors/${monitorRef}/check`, { method: "POST" });
  const ab = again.body ?? {};
  check("h1b.8 duplicate check is idempotent", again.status === 200 && ab.executed === false && ab.assessment?.id === cb.assessment?.id, { executed: ab.executed });

  await reload();
  await waitForAuth();
  const reloaded = await api(`/api/monitors/${monitorRef}/assessments`);
  check("h1b.9 assessment survives refresh (persistence)", reloaded.status === 200 && Array.isArray(reloaded.body) && reloaded.body.some((a) => a.id === cb.assessment?.id));

  const thesisAfter = await api(`/api/thesis/${THESIS_REF}`);
  check("h1b.10 thesis byte-identical after check", JSON.stringify(thesisAfter.body) === thesisBeforeStr);

  const notifications = await api("/api/notifications");
  check("h1b.11 notifications endpoint 200 (workspace-scoped)", notifications.status === 200 && Array.isArray(notifications.body), { count: Array.isArray(notifications.body) ? notifications.body.length : 0 });

  saveResults("h1b.json");
  process.exit(0);
}

// ---------------------------------------------------------------------------
if (stage === "h2") {
  const monitorRef = readFileSync(join(OUT, "monitor-ref.txt"), "utf8").trim();
  launchChrome("b");
  await connect();
  if (LINK !== "") {
    // Complete the email-link sign-in in this profile (only needed when the persisted
    // profile-b session from the Phase G g2 run is no longer live).
    await send("Page.navigate", { url: LINK });
    await waitFor(`document.body.innerText.trim().length > 20`, "signin completion", 30_000).catch(() => {});
    await sleep(6000);
  }
  // Enter the workspace via /history (the G-script law: deep-linked workspace routes from a
  // cold profile land on the marketing hero; /history triggers session restore + API traffic).
  await goto("/history");
  const bDeadline = Date.now() + 45_000;
  while (lastAuthHeader === null && Date.now() < bDeadline) {
    await goto("/history");
    await sleep(2000);
  }
  await waitForAuth();
  const whoB = await evalJs(`document.querySelector('[aria-label="Account identity indicator"]')?.getAttribute('title') ?? null`);
  check("h2.0 B session live (account indicator)", typeof whoB === "string" && whoB.includes("phasef1b"), { indicator: whoB ?? null });
  await goto("/monitors");

  const bList = await api("/api/monitors");
  const g = bList.body ?? {};
  check("h2.1 B sees zero monitors", bList.status === 200 && (g.active ?? []).length === 0 && (g.proposals ?? []).length === 0);
  const bStatus = await api(`/api/monitors/${monitorRef}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "PAUSED" }) });
  check("h2.2 B cannot pause A's monitor (404)", bStatus.status === 404, { got: bStatus.status });
  const bCheck = await api(`/api/monitors/${monitorRef}/check`, { method: "POST" });
  check("h2.3 B cannot check A's monitor (404)", bCheck.status === 404, { got: bCheck.status });
  const bAssess = await api(`/api/monitors/${monitorRef}/assessments`);
  check("h2.4 B cannot read A's assessments (404)", bAssess.status === 404, { got: bAssess.status });
  const bNotifs = await api("/api/notifications");
  check("h2.5 B sees zero notifications", bNotifs.status === 200 && Array.isArray(bNotifs.body) && bNotifs.body.length === 0);

  saveResults("h2.json");
  process.exit(0);
}

console.log("stages: h1a | h1b | h2 (LINK=... THESIS_REF=...)");
process.exit(0);
