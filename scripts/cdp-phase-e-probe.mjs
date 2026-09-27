/**
 * Phase E focused probe: load /#/research/rs_000242 repeatedly and record, per attempt:
 *  - every /api/* response (status, ms)
 *  - the rendered body (first 300 chars + whether the requested ref and its answer appear)
 *  - the ref the run view ACTUALLY shows (active-run confusion check)
 * Diagnoses the intermittent "run view does not show the requested run" smoke failures.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const PORT = Number(process.env.CDP_PORT ?? 9363);
const REF = process.env.PROBE_REF ?? "rs_000242";
const OUT = join(process.cwd(), ".data", "phase-e-probe");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "lumen-probe-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,1000",
  "about:blank",
], { stdio: "ignore" });

let ws; let msgId = 0; const pending = new Map();
function send(method, params = {}, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, 60_000);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};

const attempts = [];
async function main() {
  for (let i = 0; i < 40; i += 1) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const apiCalls = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) { pending.get(m.id)?.(m); return; }
    if (m.method === "Network.responseReceived") {
      const url = m.params?.response?.url ?? "";
      if (url.includes("/api/")) apiCalls.push({ url: url.replace(BASE, ""), status: m.params.response.status, at: Date.now() });
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  // The answer text the server says rs_000242 should render.
  const agg = await (await fetch(`${BASE}/api/research/${REF}`)).json();
  const answerHead = String(agg.answer?.answer ?? "").slice(0, 60);
  console.log("server answer head:", JSON.stringify(answerHead));

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    apiCalls.length = 0;
    const t0 = Date.now();
    await send("Page.navigate", { url: `${BASE}/#/research/${REF}` });
    await sleep(8000);
    const state = await evalJs(`(() => {
      const text = document.body.innerText;
      const refs = (text.match(/rs_\\d{6}/g) ?? []);
      const counts = {};
      for (const r of refs) counts[r] = (counts[r] ?? 0) + 1;
      return { len: text.length, head: text.slice(0, 200), refCounts: counts, hasLoading: /loading|researching/i.test(text) };
    })()`);
    const runApi = apiCalls.filter((c) => c.url.includes(`/api/research/${REF}`));
    attempts.push({
      attempt, ms: Date.now() - t0,
      refShown: state.refCounts,
      answerVisible: typeof state.head === "string" && (await evalJs(`document.body.innerText.includes(${JSON.stringify(answerHead)})`)),
      runApiCalls: runApi.map((c) => ({ status: c.status })),
      otherApi: apiCalls.filter((c) => !c.url.includes(`/api/research/${REF}`)).slice(0, 8).map((c) => `${c.status} ${c.url.slice(0, 60)}`),
      head: state.head,
      hasLoading: state.hasLoading,
    });
    const a = attempts[attempts.length - 1];
    console.log(`attempt ${attempt}: ${a.ms}ms refCounts=${JSON.stringify(a.refShown)} answerVisible=${a.answerVisible} runApi=${JSON.stringify(a.runApiCalls)}`);
    if (!a.answerVisible) console.log("  head:", JSON.stringify(a.head), " otherApi:", JSON.stringify(a.otherApi));
    await sleep(2000);
  }
  writeFileSync(join(OUT, "probe.json"), JSON.stringify({ ref: REF, answerHead, attempts }, null, 2));
  console.log("probe written to", OUT);
}

main().finally(() => chrome.kill()).catch((e) => { console.error("FATAL", e); process.exitCode = 1; });
