/**
 * Phase F.1 — Real-browser two-account acceptance test (hard release gate, brief §4 + §14).
 *
 * Drives the PRODUCTION UI in a real headless Chrome via CDP with REAL Firebase email-link
 * sign-in: the app itself sends each sign-in email through the UI; the operator pastes the
 * link from the mailbox; the SAME browser profile then opens the link — the actual supported
 * flow (same-device case). Sign-out happens in-UI between accounts.
 *
 * Stage-based (each stage is one process, so the operator can paste links in between):
 *   node scripts/cdp-phase-f1-acceptance.mjs a1   # profile A: open sign-in, type email, send link
 *   LINK='<paste>' node ... a2                    # profile A: complete sign-in, full User A flow
 *   node scripts/cdp-phase-f1-acceptance.mjs b1   # profile B: open sign-in, type email, send link
 *   LINK='<paste>' node ... b2                    # profile B: complete sign-in, isolation + own run
 *   LINK='<paste>' node ... a3                    # profile A: sign in AGAIN, verify data intact
 *
 * State: .data/phase-f1-acceptance/ (stable Chrome profiles, captured results, auth tokens).
 * ID tokens are captured from the page's own network traffic (CDP) and used only to call the
 * same production API the UI calls; they are never printed.
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const CHROME_PATH = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9362);
const OUT = join(process.cwd(), ".data", "phase-f1-acceptance");
mkdirSync(OUT, { recursive: true });

const EMAIL_A = process.env.F1_USER_A ?? "asklumenterminal+phasef1c@gmail.com"; // phasef1a/c/d all hit Firebase daily email-quota protection (project-level rolling limit)
const EMAIL_B = process.env.F1_USER_B ?? "asklumenterminal+phasef1b@gmail.com";
const EMAIL_ADMIN = process.env.F1_USER_ADMIN ?? "asklumenterminal@gmail.com"; // ADMIN_EMAILS allowlist member
const QUESTION_A = "What is the current price of gold per ounce?";
const QUESTION_B = "What is the current price of Bitcoin in US dollars?";

const results = [];
const check = (label, ok, detail) => {
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail) : "");
  results.push({ label, ok, detail });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stage = process.argv[2] ?? "";
const LINK = process.env.LINK ?? "";

// ---------------------------------------------------------------- CDP client
function launchChrome(tag) {
  const dir = join(OUT, `profile-${tag}`);
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
let lastAuthHeader = null; // Authorization header that recently produced a 200 (never printed)
const reqHeaders = new Map(); // requestId → request headers (for the 200-correlated capture)

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
      // Only a header that just yielded a 200 counts: headers captured from pre-auth
      // requests (401s) would poison every subsequent scripted call.
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
  // Fresh code every navigation: a cached pre-fix bundle silently no-ops the email-link
  // completion (observed live). The deployed bundle must be what runs, always.
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
const clickBySelector = (sel) => evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
const clickByTitleContains = (needle) => evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').includes(${JSON.stringify(needle)}));
  if (!b) return false; b.click(); return true;
})()`);

/** Authenticated API call using the token captured from the page's own traffic. */
async function api(path, init = {}) {
  if (lastAuthHeader === null) throw new Error("no Authorization header captured yet (page has not called the API signed-in)");
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: lastAuthHeader } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
/** Unauthenticated API call (negative checks). */
async function apiAnon(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function signInSendLink(email) {
  await goto("/signin");
  const sawSignInView = await evalJs(`document.body.innerText.includes('Continue with Google')`);
  check(`[${stage}] sign-in view renders (Continue with Google visible)`, sawSignInView === true);
  const ok = await setValue("Email address", email);
  check(`[${stage}] email typed into the sign-in form`, ok === true, { email });
  await clickBySelector('button.btn.ghost');
  const sent = await waitFor(`!!document.querySelector('[data-testid="email-link-sent"]')`, "link-sent confirmation", 20_000).catch(() => false);
  check(`[${stage}] app reports sign-in link sent to the mailbox`, sent === true, { email });
  if (!sent) {
    const err = await evalJs(`document.body.innerText.slice(0, 400)`);
    console.log("DEBUG sign-in view:", JSON.stringify(err));
  }
}

async function completeSignIn(label) {
  if (LINK !== "") {
    console.log(`[${stage}] navigating the ${label} profile to the pasted sign-in link…`);
    await send("Page.navigate", { url: LINK });
    // The app auto-completes the email-link sign-in (auth.tsx); completion lands on #/signin
    // with either the account indicator (app shell) or the signed-in notice (sign-in view).
    await waitFor(
      `!!document.querySelector('[aria-label="Account identity indicator"]') || document.body.innerText.includes('Signed in as')`,
      `${label} email-link completion`, 45_000,
    ).catch(() => {});
    const completionError = await evalJs(`document.querySelector('[role="alert"]')?.textContent ?? null`);
    if (completionError !== null) console.log(`[${stage}] sign-in completion error (typed, visible): ${completionError.slice(0, 200)}`);
  } else {
    console.log(`[${stage}] no LINK provided — reusing the profile's persisted Firebase session`);
  }
  // Enter the authenticated app so the account indicator + API traffic are observable, and
  // wait until a signed-in API call has actually SUCCEEDED (that is where the valid token
  // header is captured from).
  await goto("/history");
  const deadline = Date.now() + 30_000;
  while (lastAuthHeader === null && Date.now() < deadline) {
    await goto("/history");
    await sleep(2000);
  }
  const who = await evalJs(`document.querySelector('[aria-label="Account identity indicator"]')?.getAttribute('title') ?? null`);
  return who; // email (title) from the account indicator
}

/** Wait for a run with the given question to reach a persisted terminal state; returns its ref or null. */
async function waitForRun(question) {
  const deadline = Date.now() + 330_000;
  while (Date.now() < deadline) {
    try {
      const list = await api("/api/research?limit=10");
      const rows = Array.isArray(list.body) ? list.body : [];
      const row = rows.find((r) => typeof r?.question === "string" && r.question.includes(question));
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
  await goto("/research");
  const typed = await setValue("Ask a research question", question);
  check(`[${stage}] question typed into the research composer`, typed === true);
  const clicked = await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Research'); if (!b) return false; b.click(); return true; })()`);
  check(`[${stage}] Research submitted through the real UI`, clicked === true);
  const running = await waitFor(`document.body.innerText.includes('Researching') || document.body.innerText.includes('research pipeline')`, "run started", 30_000).catch(() => false);
  check(`[${stage}] run stream started (progress visible)`, running === true);
  console.log(`[${stage}] waiting for the run to complete (real provider chain; up to ~5.5 min)…`);
  const ref = await waitForRun(question);
  check(`[${stage}] research completed and persisted (FULL record)`, typeof ref === "string", { ref: ref ?? null });
  return ref;
}

const statePath = (name) => join(OUT, name);
const loadState = (name) => (existsSync(statePath(name)) ? JSON.parse(readFileSync(statePath(name), "utf8")) : {});
const saveState = (name, obj) => writeFileSync(statePath(name), JSON.stringify(obj, null, 2));

// ---------------------------------------------------------------- stages
async function main() {
  const profileTag = stage.startsWith("a") && stage !== "admin" ? "a" : stage.startsWith("d") ? "d" : "b";
  const chrome = launchChrome(profileTag);
  try {
    await connect();

    if (stage === "a1" || stage === "b1" || stage === "d1") {
      const email = stage === "a1" ? EMAIL_A : stage === "d1" ? EMAIL_ADMIN : EMAIL_B;
      await signInSendLink(email);
      console.log(`\nWAITING_FOR_LINK stage=${stage}: open the mailbox, copy the Firebase sign-in link, then run the next stage with LINK='<link>'.`);
      return;
    }

    if (stage === "a2") {
      const who = await completeSignIn("A");
      check("[a2] User A signed in (account indicator shows the test address)", typeof who === "string" && who.toLowerCase().includes(EMAIL_A.toLowerCase()), { indicator: who });
      await goto("/history"); await sleep(1000); // force an authenticated API call so the token is captured
      const empty = await api("/api/research?limit=10");
      check("[a2] User A starts with an EMPTY workspace (new-user policy; no legacy inheritance)", Array.isArray(empty.body) && empty.body.length === 0, { rows: Array.isArray(empty.body) ? empty.body.length : "n/a" });

      const refA = await researchViaUi(QUESTION_A);
      if (typeof refA !== "string") { console.log("Provider chain unavailable — run-dependent checks cannot pass; recording honestly."); }

      await goto("/history"); await sleep(1500);
      const histRows = await evalJs(`document.querySelectorAll('a[href*="/research/"]').length`);
      check("[a2] History page lists the run (UI)", refA !== null && histRows > 0, { rows: histRows });
      if (refA !== null) {
        await goto(`/research/${refA}`);
        const agg = await api(`/api/research/${refA}`);
        const head = String(agg.body?.answer?.answer ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
        const shown = await waitFor(`document.body.innerText.replace(/\\s+/g,' ').includes(${JSON.stringify(head)})`, "run view", 30_000).catch(() => false);
        check("[a2] Run detail reopens with its answer (UI)", shown === true, { ref: refA });

        const savedClicked = await clickByTitleContains("to your library");
        check("[a2] Save control present and clicked on the run view", savedClicked === true);
        const badge = await waitFor(`[...document.querySelectorAll('span.badge')].some((b) => b.textContent.trim().toLowerCase() === 'saved')`, "SAVED badge", 20_000).catch(() => false);
        check("[a2] UI confirms the save (SAVED badge)", badge === true);
        await sleep(1500);
        const saved = await api(`/api/saved?researchRef=${refA}&limit=50`);
        const savedId = Array.isArray(saved.body) && saved.body[0]?.savedId;
        check("[a2] Backend confirms the saved artifact", saved.status === 200 && typeof savedId === "string", { savedId: savedId ?? null });

        await clickByTitleContains("trader-owned thesis");
        await sleep(4000);
        let theses = await api("/api/theses");
        let mine = (Array.isArray(theses.body) ? theses.body : []).find((t) => Array.isArray(t.linkedResearchRefs) && t.linkedResearchRefs.includes(refA));
        if (mine === undefined) {
          const created = await api("/api/thesis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statement: `Phase F.1 acceptance thesis (User A): ${QUESTION_A}`, asset: "GOLD", researchRef: refA }) });
          mine = created.status === 201 ? created.body : undefined;
          check("[a2] thesis created via the authenticated API (UI proposal did not auto-create)", created.status === 201, { status: created.status });
        }
        const thRef = mine?.ref ?? mine?.thesis?.ref ?? null;
        check("[a2] thesis exists for User A", typeof thRef === "string", { thRef });
        if (typeof thRef === "string") {
          await goto(`/thesis/${thRef}`); await sleep(2000);
          const shown = await evalJs(`document.body.innerText.includes(${JSON.stringify(String(mine?.statement ?? ""))})`);
          check("[a2] thesis view shows the statement verbatim (UI)", shown === true, { thRef });
        }

        await reload(); await sleep(1500);
        const afterRefresh = await api(`/api/research/${refA}`);
        check("[a2] refresh: research intact", afterRefresh.status === 200 && afterRefresh.body?.recordTier === "FULL", { ref: refA });
        const savedAfter = await api(`/api/saved?researchRef=${refA}&limit=50`);
        check("[a2] refresh: saved artifact intact", Array.isArray(savedAfter.body) && savedAfter.body.some((s) => s.savedId === savedId), { savedId: savedId ?? null });

        saveState("userA.json", { email: EMAIL_A, refA, savedId: savedId ?? null, thRef: thRef ?? null, statement: mine?.statement ?? null });
      }
      saveState("console-a2.json", { consoleErrors });

      const out = await clickBySelector('button[aria-label="Logout"]');
      check("[a2] sign out via the topbar control", out === true);
      const backToSignIn = await waitFor(`document.body.innerText.includes('Continue with Google')`, "sign-in view returns", 20_000).catch(() => false);
      check("[a2] signed-out state shows the sign-in view", backToSignIn === true);
      return;
    }

    if (stage === "d2") {
      // ADMIN profile (ADMIN_EMAILS member): exercise every admin-gated storage/ops endpoint
      // through the REAL authenticated session. See brief §5–§11.
      const who = await completeSignIn("ADMIN");
      check("[d2]admin signed in", typeof who === "string" && who.length > 0, { indicator: who });
      await goto("/history"); await sleep(1000);
      const me = await api("/api/workspace");
      check("[d2]admin session reaches the API (authenticated)", me.status === 200, { status: me.status });      const audit = await api("/api/storage/audit");
      // audit inspects the CALLER'S OWN workspace snapshot; a fresh admin has none yet →
      // typed 404 (existence-hiding) is the honest answer, not an error.
      check("[d2] GET /api/storage/audit (admin gate passes; 404 = admin has no own snapshot yet)", audit.status === 200 || audit.status === 404, { status: audit.status });
      const diag = await api("/api/storage/diagnose");
      check("[d2]GET /api/storage/diagnose (admin)", diag.status === 200, { status: diag.status });
      const inv = await api("/api/storage/legacy-inventory");
      check("[d2]GET /api/storage/legacy-inventory (admin, read-only)", inv.status === 200, { status: inv.status });
      if (inv.status === 200) {
        saveState("legacy-inventory.json", inv.body);
        console.log("[d1] legacy inventory keys:", JSON.stringify(Object.keys(inv.body ?? {})));
      }      const backup = await api("/api/storage/backup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const details = Array.isArray(backup.body?.detail) ? backup.body.detail : [];
      check("[d2] POST /api/storage/backup → verified read-back for every target", backup.status === 200 && backup.body?.ok === true && details.length > 0 && details.every((r) => r.ok === true && r.verified === true), { status: backup.status, detail: JSON.stringify(details.map((r) => ({ workspaceId: r.workspaceId, key: r.key, bytes: r.bytes, sha256: r.sha256?.slice(0, 12), verified: r.verified }))).slice(0, 400) });
      saveState("backup-result.json", backup.body);

      const bstatus = await api("/api/storage/backup-status");
      check("[d2]GET /api/storage/backup-status", bstatus.status === 200, { status: bstatus.status });
      saveState("backup-status.json", bstatus.body);

      const drillKey = backup.body?.detail?.[0]?.key ?? null;
      if (typeof drillKey === "string") {
        const drill = await api("/api/storage/restore-drill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ backupKey: drillKey }) });
        check("[d2]POST /api/storage/restore-drill → ok:true, invariants hold", drill.status === 200 && drill.body?.ok === true, { status: drill.status, summary: JSON.stringify({ ok: drill.body?.ok, checks: drill.body?.checks, counts: drill.body?.counts }).slice(0, 500) });
        saveState("drill-result.json", drill.body);
      } else {
        console.log("[d1] NOTE: no backup key returned — drill cannot run; backup result:", JSON.stringify(backup.body).slice(0, 300));
      }

      const health = await api("/api/storage/health");
      check("[d2]GET /api/storage/health (watchdog)", health.status === 200, { status: health.status });
      saveState("storage-health.json", health.body);
      console.log("[d2] watchdog verdict:", JSON.stringify({ state: health.body?.state ?? health.body?.verdict, findings: health.body?.findings }));

      const sessions = await api("/api/storage/sessions");
      check("[d2]GET /api/storage/sessions (admin)", sessions.status === 200, { status: sessions.status });
      return;
    }

    if (stage === "b2") {
      const who = await completeSignIn("B");
      check("[b2] User B signed in (distinct account)", typeof who === "string" && who.toLowerCase().includes(EMAIL_B.toLowerCase()), { indicator: who });
      await goto("/history"); await sleep(1000);
      const bList = await api("/api/research?limit=50");
      const A = loadState("userA.json");
      check("[b2] User B sees an EMPTY workspace (not User A's data)", Array.isArray(bList.body) && bList.body.length === 0, { rows: Array.isArray(bList.body) ? bList.body.length : "n/a" });
      const bEmptyUi = await evalJs(`document.body.innerText.includes('No research yet')`);
      check("[b2] History UI shows the empty-workspace state", bEmptyUi === true);

      // B is NOT an admin: admin-gated endpoints must 404 (existence-hiding), never 403/200.
      for (const p of ["/api/storage/health", "/api/storage/audit", "/api/storage/backup", "/api/storage/legacy-inventory", "/api/storage/sessions", "/api/storage/backup-status", "/api/storage/diagnose"]) {
        const r = await api(p, p === "/api/storage/backup" ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : {});
        check(`[b2] non-admin → ${p}: 404 (admin gate, existence hidden)`, r.status === 404, { status: r.status });
      }

      if (typeof A.refA === "string") {
        const direct = await api(`/api/research/${A.refA}`);
        check("[b2] B → A's research ref: 404, existence hidden", direct.status === 404, { status: direct.status, ref: A.refA });
        if (typeof A.savedId === "string") {
          const s = await api(`/api/saved/${A.savedId}`);
          check("[b2] B → A's saved ref: 404", s.status === 404, { status: s.status });
        }
        if (typeof A.thRef === "string") {
          const th = await api(`/api/thesis/${A.thRef}`);
          check("[b2] B → A's thesis ref: 404", th.status === 404, { status: th.status });
        }
        const bTheses = await api("/api/theses");
        check("[b2] B's thesis list does not contain A's thesis", Array.isArray(bTheses.body) && !bTheses.body.some((t) => t.ref === A.thRef), { count: Array.isArray(bTheses.body) ? bTheses.body.length : "n/a" });

        await goto(`/research/${A.refA}`); await sleep(2000);
        const notA = await evalJs(`!document.body.innerText.includes('gold per ounce') && (document.body.innerText.includes('not available') || document.body.innerText.includes('No research') || document.body.innerText.length < 4000)`);
        check("[b2] direct UI navigation to A's research reveals nothing", notA === true);
        await goto("/"); await sleep(1000);
      }

      const refB = await researchViaUi(QUESTION_B);
      if (typeof refB === "string") {
        await goto("/history"); await sleep(1500);
        const rows = await evalJs(`document.querySelectorAll('a[href*="/research/"]').length`);
        check("[b2] B's own run appears in B's History (UI)", rows > 0, { rows });
        const bList2 = await api("/api/research?limit=50");
        const onlyOwn = Array.isArray(bList2.body) && bList2.body.every((r) => r.ref !== A.refA);
        check("[b2] B's history contains B's run and NOT A's", onlyOwn === true && bList2.body.some((r) => r.ref === refB), { refB });
        saveState("userB.json", { email: EMAIL_B, refB });
      }
      saveState("console-b2.json", { consoleErrors });

      const out = await clickBySelector('button[aria-label="Logout"]');
      check("[b2] User B signs out", out === true);
      return;
    }

    if (stage === "a3") {
      const who = await completeSignIn("A");
      check("[a3] User A signed in AGAIN (fresh sign-in)", typeof who === "string" && who.toLowerCase().includes(EMAIL_A.toLowerCase()), { indicator: who });
      const A = loadState("userA.json");
      const B = loadState("userB.json");
      await goto("/history"); await sleep(1000);
      const list = await api("/api/research?limit=50");
      const refs = Array.isArray(list.body) ? list.body.map((r) => r.ref) : [];
      check("[a3] A's research survives the A→B→A round trip", typeof A.refA === "string" && refs.includes(A.refA), { refA: A.refA ?? null, rows: refs.length });
      check("[a3] A's history does NOT contain B's run", typeof B.refB !== "string" || !refs.includes(B.refB), { refB: B.refB ?? null });
      if (typeof A.refA === "string") {
        const agg = await api(`/api/research/${A.refA}`);
        check("[a3] A's run reopens with its FULL record", agg.status === 200 && agg.body?.recordTier === "FULL", { tier: agg.body?.recordTier ?? null });
      }
      if (typeof A.savedId === "string") {
        const saved = await api(`/api/saved?researchRef=${A.refA}&limit=50`);
        check("[a3] A's saved artifact intact", Array.isArray(saved.body) && saved.body.some((s) => s.savedId === A.savedId), { savedId: A.savedId });
      }
      if (typeof A.thRef === "string") {
        const th = await api(`/api/thesis/${A.thRef}`);
        check("[a3] A's thesis intact", th.status === 200 && typeof th.body?.statement === "string", { thRef: A.thRef });
      }
      if (typeof B.refB === "string") {
        const cross = await api(`/api/research/${B.refB}`);
        check("[a3] A cannot open B's run (404)", cross.status === 404, { status: cross.status });
      }
      saveState("console-a3.json", { consoleErrors });
      await clickBySelector('button[aria-label="Logout"]');
      return;
    }

    throw new Error(`unknown stage: ${stage}`);
  } finally {
    const name = `results-${stage}.json`;
    saveState(name, { stage, at: new Date().toISOString(), results, consoleErrors });
    const failed = results.filter((r) => !r.ok);
    console.log(`\nSTAGE ${stage}: ${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) console.log("FAILED:", failed.map((f) => f.label).join(" | "));
    try { chrome.kill(); } catch { /* already dead */ }
    ws?.close?.();
  }
}

main().catch((e) => { console.error("FATAL", e.message); process.exitCode = 1; });
