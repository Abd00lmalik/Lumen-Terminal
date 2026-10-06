/**
 * FLOW-ISOLATION — BROWSER VERIFICATION (headless Chrome + CDP).
 *
 * WHY THIS FILE EXISTS: the reproduced defect was not an answer-quality miss but an ARCHITECTURAL
 * one — a WHAT_HAPPENED request that forbade causes, drivers, mechanisms, theses,
 * counterevidence, materiality and trading implications came back as question type CAUSAL with the
 * full thesis machinery. Unit tests pin the ledger; this drives the real UI + real HTTP + real
 * engine and asserts what the TRADER'S SCREEN shows.
 *
 * Scenarios (verbatim from the report):
 *   A. WHAT HAPPENED      "What happened to Bitcoin over the last 24 hours? Give me a factual timeline."
 *                         → WHAT_HAPPENED, non-causal, timestamped observations, no thesis machinery
 *   B. WHY                "Why did Bitcoin move today?"            → WHY_IT_HAPPENED, causal requirements present
 *   C. WHAT COULD AFFECT  "What could affect Bitcoin over the next few days?" → forward/conditional
 *   D. THESIS             "Does my Bitcoin thesis still hold?"     → support/challenge
 *   E. FOLLOW-UP          A then "Now focus specifically on ETF flows."
 *                         → same investigation, NEW research run
 *   F. NEW RESEARCH       → clean composer, no previous content/evidence/investigation state
 *
 * The model transport is the deterministic scripted provider (scripts/browser-verify-server.ts);
 * no live key is spent. Consequence, stated plainly: this proves ROUTING, LEDGER ISOLATION and
 * RESPONSE SHAPE through the real UI and API — not live answer quality.
 *
 * Usage: node scripts/cdp-flow-isolation.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH
  ?? join(homedir(), ".cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome");
// The frontend dev server already serves the app on 5173 (a documented local CORS origin and the
// client's default API target). The harness supplies ONLY the API, so the browser drives the real
// UI against this run's engine and never touches the managed preview process.
const WEB_PORT = Number(process.env.FI_WEB_PORT ?? 5173);
const API_PORT = Number(process.env.FI_API_PORT ?? 3001);
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const CDP_PORT = Number(process.env.FI_CDP_PORT ?? 9481);
const OUT = join(process.cwd(), ".data", "flow-isolation");
mkdirSync(OUT, { recursive: true });

const A = "What happened to Bitcoin over the last 24 hours? Give me a factual timeline.";
const B = "Why did Bitcoin move today?";
const C = "What could affect Bitcoin over the next few days?";
const D = "Does my Bitcoin thesis still hold?";
const E = "Now focus specifically on ETF flows.";
/**
 * The FIELD-COVERAGE reproduction, verbatim and never paraphrased: an enumerated observational
 * ask whose answer was one CoinGecko spot snapshot reported as a satisfied 24-hour path.
 */
const G =
  "What was the Bitcoin price path during that 24-hour window? Give me the observed high, low, opening/reference price, closing/current price, timestamps, and volume. Use only market-data observations. If any of these are unavailable, explicitly say which ones are unavailable.";

/** Vocabulary a WHAT_HAPPENED answer must never contain (the forbidden causal machinery). */
const FORBIDDEN_IN_OBSERVATION_ANSWER =
  /strongest support|meaningful opposition|counterevidence|mechanism|transmission|materiality|thesis|what would change (?:this|the) conclusion|actionable insight/i;

const failures = [];
const results = [];
const check = (label, ok, detail) => {
  if (!ok) failures.push(label);
  results.push({ label, ok, detail });
  console.log(ok ? "PASS" : "FAIL", label, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : "");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the harness (real API + real registry + real store; scripted model only) -----------
// detached so the whole tsx process GROUP can be killed on exit: killing only the npx wrapper
// orphaned the real server, which then held port 3001 and made the NEXT run talk to a stale
// engine — exactly the class of mistake this script exists to catch.
const server = spawn("npx", ["tsx", "scripts/browser-verify-server.ts"], {
  cwd: process.cwd(),
  detached: true,
  env: {
    ...process.env,
    VERIFY_API_PORT: String(API_PORT),
    PREVIEW_PORT: String(WEB_PORT),
    SKIP_WEB: "1",
    WORKSPACE_FILE: ".data/flow-isolation-workspace.json",
  },
  stdio: "ignore",
});
let chrome;
try {
  let up = false;
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${API}/api/health`); if (r.ok) { up = true; break; } } catch { /* retry */ }
    await sleep(1000);
  }
  check("harness: api came up", up, API);
  if (!up) throw new Error("harness api never came up");

  const profile = mkdtempSync(join(tmpdir(), "lumen-flow-"));
  chrome = spawn(CHROME, [
    "--headless=new", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    // Required to run Chrome inside an unprivileged container; does not affect what is asserted.
    "--no-sandbox", "--disable-dev-shm-usage", "--remote-allow-origins=*",
    "--window-size=1440,1400", "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stderr.on("data", () => {});

  let ws;
  let msgId = 0;
  const pending = new Map();
  const send = (method, params = {}, timeoutMs = 60_000) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      pending.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  let pageUrl;
  for (let i = 0; i < 40; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) { pageUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (pageUrl === undefined) throw new Error("Chrome DevTools endpoint never appeared");
  ws = new WebSocket(pageUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "eval failed");
    return r.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 120_000) => {
    const started = Date.now();
    for (;;) {
      const value = await evalJs(expression);
      if (value) return value;
      if (Date.now() - started > timeoutMs) throw new Error(`waitFor timed out (${label})`);
      await sleep(1500);
    }
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
    const text = await evalJs(`(document.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 6000)`);
    writeFileSync(join(OUT, `${name}.txt`), String(text ?? ""));
  };
  const askViaUI = async (question) => {
    await evalJs(`(() => { const i = document.querySelector('.ask-bar input.search'); if (!i) return 'no input'; i.focus(); return 'ok'; })()`);
    for (const ch of question) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", text: ch, unmodifiedText: ch });
    }
    await sleep(300);
    return evalJs(`document.querySelector('.ask-bar input.search')?.value ?? ''`);
  };
  const submitViaUI = () => evalJs(`(() => {
    const buttons = [...document.querySelectorAll('.ask-bar button')];
    const btn = buttons.find((b) => /primary/i.test(b.className)) ?? buttons[buttons.length - 1];
    if (!btn) return false; btn.click(); return true;
  })()`);
  const composerLabel = () => evalJs(`(() => {
    const buttons = [...document.querySelectorAll('.ask-bar button')];
    const btn = buttons.find((b) => /primary/i.test(b.className)) ?? buttons[buttons.length - 1];
    return (btn?.textContent ?? '').replace(/\\s+/g,' ').trim();
  })()`);
  const railText = () => evalJs(`(document.body.innerText || '').replace(/\\s+/g,' ')`);
  const newResearch = async () => {
    const clicked = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /new research/i.test(x.textContent ?? ''));
      if (b) { b.click(); return true; } return false;
    })()`);
    await sleep(4000);
    // VERIFIED, not assumed: without this the next question is submitted as a FOLLOW-UP to the
    // previous thread, and the router then resolves the thread's flow instead of the new
    // question's — which silently invalidates the scenario that follows.
    const label = await composerLabel();
    return { clicked, label };
  };
  const api = async (p) => (await fetch(`${API}${p}`)).json();
  const idle = `!document.querySelector('.ask-bar button')?.textContent?.includes('Researching')`;
  const currentInvestigation = async () => (await api("/api/investigations")).find((r) => r.isCurrent);
  /** The aggregate for a run: flow identity + answer + engine diagnostics. */
  const runAggregate = async (ref) => (await fetch(`${API}/api/research/${ref}`)).json();

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `${BASE}/#/research` });
  await sleep(5000);

  // ---- A: WHAT HAPPENED ----------------------------------------------------------
  const typedA = await askViaUI(A);
  check("A: the exact scenario question is typed", typedA === A, typedA);
  await shot("A0-typed");
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "run A");
  const invA = await currentInvestigation();
  const refsA = invA?.runs.map((r) => r.researchRef) ?? [];
  check("A: the run completed and is recorded", refsA.length >= 1, refsA);
  const aggA = refsA.length > 0 ? await runAggregate(refsA[0]) : {};
  check("A: FLOW IS WHAT_HAPPENED", aggA.flow === "WHAT_HAPPENED", aggA.flow);
  const diag = (agg) => agg.researchDiagnostics ?? agg.diagnostics ?? {};
  const reqA = (diag(aggA).requirements ?? []).map((r) => `${r.role ?? ""} ${r.description}`.trim());
  const typeA = diag(aggA).questionType;
  check("A: question type is OBSERVATION, never CAUSAL", typeA === "OBSERVATION", typeA);
  check("A: the ledger owes NO causal/thesis/materiality/falsification row",
    !reqA.some((r) => /driver|mechanism|transmission|counter|thesis|falsif|material|catalyst|supply|demand|what would (?:change|prove)/i.test(r)),
    reqA);
  check("A: the ledger owes NO CHALLENGE row", reqA.length > 0 && !reqA.some((r) => /^CHALLENGE/i.test(r)), reqA);
  // POSITIVE CONTROL, the mirror of scenario G. The scripted provider DOES serve windowed OHLCV
  // here, so the atomic shape rows must actually RESOLVE. This is the check the suite was
  // missing: when the coverage mapping dropped the measured span, `windowCovers` saw no span
  // and left every window-bearing row unresolved no matter how good the data was — the exact
  // inverse false negative of the reproduction's false positive, and scenario A never noticed
  // because it only asserted WHICH rows existed, never whether one could be satisfied.
  const reqsA = diag(aggA).requirements ?? [];
  const windowedA = reqsA.filter((r) => /(sequence|high|low|volume)/i.test(r.description ?? ""));
  check("A: windowed OHLCV SATISFIES the atomic shape rows it actually carries",
    windowedA.length > 0 && windowedA.some((r) => r.status === "SATISFIED"),
    windowedA.map((r) => `${r.description} [${r.status}]`));
  const answerA = String(aggA.answer?.answer ?? "");
  check("A: the answer uses the observation contract (timeline + observed/reported/missing)",
    /\*\*What happened\*\*/.test(answerA) && /What is directly observed/i.test(answerA) && /What is reported/i.test(answerA) && /Missing evidence/i.test(answerA),
    answerA.slice(0, 220));
  check("A: the answer carries NO causal/thesis machinery", !FORBIDDEN_IN_OBSERVATION_ANSWER.test(answerA), answerA.slice(0, 220));
  check("A: the answer carries NO counterevidence status claim", (aggA.answer?.counterevidenceStatus ?? "NOT_ASSESSED") === "NOT_ASSESSED", aggA.answer?.counterevidenceStatus);
  const evidenceA = await api("/api/evidence?limit=200");
  // Identified by the SHAPE the payload carries, not by wording: the stub serves structured
  // OHLCV rows, and a coverage law that has to grep prose is not the law being tested.
  const prints = evidenceA.filter((e) => (e.dataFacets ?? []).some((f) => f === "SERIES" || f === "HIGH" || f === "LOW"));
  check("A: the retrieved price prints are DIRECT_OBSERVATION",
    prints.length >= 1 && prints.every((e) => e.sourceClass === "DIRECT_OBSERVATION"),
    prints.slice(0, 2).map((e) => ({ ref: e.ref, sourceClass: e.sourceClass, dataFacets: e.dataFacets })));
  check("A: the retrieved headline is labelled a REPORTED_CLAIM, not an observation",
    evidenceA.some((e) => e.sourceClass === "REPORTED_CLAIM"),
    evidenceA.filter((e) => /Reported headline/.test(e.observation ?? "")).map((e) => ({ ref: e.ref, sourceClass: e.sourceClass })));
  check("A: the answer cites real evidence objects",
    (aggA.answer?.citedObjectRefs ?? []).length > 0 && (aggA.answer?.citedObjectRefs ?? []).every((r) => evidenceA.some((e) => e.ref === r)),
    aggA.answer?.citedObjectRefs);
  const railA = await railText();
  check("A: the screen shows the timeline, not causal machinery", /What happened/.test(railA) && !/strongest support|meaningful opposition/i.test(railA));
  await shot("A1-answer");
  console.log("   investigationId:", invA?.id, "run:", refsA[0]);

  // ---- E: FOLLOW-UP CONTINUITY ---------------------------------------------------
  const typedE = await askViaUI(E);
  check("E: the follow-up is typed verbatim", typedE === E, typedE);
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "run E");
  const invE = await currentInvestigation();
  const refsE = invE?.runs.map((r) => r.researchRef) ?? [];
  check("E: SAME investigation, NEW research run", invE?.id === invA?.id && refsE.length === refsA.length + 1, { before: refsA, after: refsE, sameInv: invE?.id === invA?.id });
  check("E: the first run survives the follow-up", refsA.every((r) => refsE.includes(r)), refsE);
  check("E: still exactly ONE investigation (no new one opened)", (await api("/api/investigations")).length === 1);
  const aggE = refsE.length > refsA.length ? await runAggregate(refsE[refsE.length - 1]) : {};
  check("E: the follow-up run carries a CANONICAL flow (it joined the thread, it did not start an orphan)",
    ["WHAT_HAPPENED", "WHY_IT_HAPPENED", "WHAT_COULD_AFFECT_IT", "DOES_MY_THESIS_HOLD", "HAS_THIS_HAPPENED_BEFORE",
      "WHAT_DOES_ALL_INFORMATION_SAY", "WHAT_COULD_PROVE_ME_WRONG", "EVALUATE_WITH_MY_FRAMEWORK"].includes(aggE.flow), aggE.flow);
  await shot("E1-followup");

  // ---- fresh thread for B/C/D ----------------------------------------------------
  const fresh1 = await newResearch();
  check("setup: a fresh thread is open before scenario B", fresh1.label === "Research", fresh1);

  // ---- B: WHY ---------------------------------------------------------------------
  const typedB = await askViaUI(B);
  check("B: the exact scenario question is typed", typedB === B, typedB);
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "run B");
  const invB = await currentInvestigation();
  const refsB = invB?.runs.map((r) => r.researchRef) ?? [];
  const aggB = refsB.length > 0 ? await runAggregate(refsB[refsB.length - 1]) : {};
  check("B: FLOW IS WHY_IT_HAPPENED", aggB.flow === "WHY_IT_HAPPENED", aggB.flow);
  const answerB = String(aggB.answer?.answer ?? "");
  check("B: the causal machinery IS present here (explanation + competing explanations)",
    /explanation|mechanism|competing|caus/i.test(answerB), answerB.slice(0, 200));
  await shot("B1-answer");

  const fresh2 = await newResearch();
  check("setup: a fresh thread is open before scenario C", fresh2.label === "Research", fresh2);
  // ---- C: WHAT COULD AFFECT IT ----------------------------------------------------
  await askViaUI(C);
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "run C");
  const invC = await currentInvestigation();
  const refsC = invC?.runs.map((r) => r.researchRef) ?? [];
  const aggC = refsC.length > 0 ? await runAggregate(refsC[refsC.length - 1]) : {};
  check("C: FLOW IS WHAT_COULD_AFFECT_IT", aggC.flow === "WHAT_COULD_AFFECT_IT", aggC.flow);
  const answerC = String(aggC.answer?.answer ?? "");
  check("C: forward-looking CONDITIONAL factors are answered (no prediction, no certainty)",
    /would matter when|conditional|factor/i.test(answerC) && !/will (?:rise|fall|go up|go down)/i.test(answerC), answerC.slice(0, 200));
  await shot("C1-answer");

  const fresh3 = await newResearch();
  check("setup: a fresh thread is open before scenario D", fresh3.label === "Research", fresh3);
  // A thesis belongs to the TRADER (never inferred from an LLM sentence), and Flow 4 answers an
  // honest shell when there is none. Scenario D therefore states the thesis first, through the
  // trader's own endpoint, so the run has something to evaluate.
  const thesisRes = await fetch(`${API}/api/thesis`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "BTC breakout holds",
      statement: "Bitcoin breaks out and holds above the prior range while ETF inflows continue.",
      invalidationConditions: ["a close back inside the prior range"],
    }),
  });
  check("D setup: the trader's thesis was created through the trader endpoint", thesisRes.ok, thesisRes.status);
  // ---- D: THESIS ------------------------------------------------------------------
  await askViaUI(D);
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "run D");
  const invD = await currentInvestigation();
  const refsD = invD?.runs.map((r) => r.researchRef) ?? [];
  const aggD = refsD.length > 0 ? await runAggregate(refsD[refsD.length - 1]) : {};
  check("D: FLOW IS DOES_MY_THESIS_HOLD", aggD.flow === "DOES_MY_THESIS_HOLD", aggD.flow);
  const answerD = String(aggD.answer?.answer ?? "");
  check("D: support AND opposition are both reported",
    /support/i.test(answerD) && /oppos|against|weaken/i.test(answerD), answerD.slice(0, 240));
  await shot("D1-answer");

  // ---- G: FIELD-LEVEL COVERAGE (the enumerated-ask reproduction) --------------------
  // The scripted provider answers with ONE CoinGecko simple-price snapshot, exactly as the
  // production run did. The ledger must therefore resolve the snapshot's own shape and leave
  // every shape it does not carry UNRESOLVED and NAMED — never "every requirement established".
  await newResearch();
  const freshG = await composerLabel();
  check("setup: a fresh thread is open before scenario G", freshG === "Research", freshG);
  const typedG = await askViaUI(G);
  check("G: the exact reproduction question is typed", typedG === G, typedG);
  await submitViaUI();
  await waitFor(`${idle} && document.querySelector('.ask-bar button')?.textContent?.includes('Ask follow-up') ? 'done' : ''`, "run G");
  const invG = await currentInvestigation();
  const refsG = invG?.runs.map((r) => r.researchRef) ?? [];
  const aggG = refsG.length > 0 ? await runAggregate(refsG[refsG.length - 1]) : {};
  check("G: FLOW IS WHAT_HAPPENED", aggG.flow === "WHAT_HAPPENED", aggG.flow);

  const reqsG = aggG.researchDiagnostics?.requirements ?? [];
  const shapesG = reqsG.map((r) => r.description).join(" | ");
  check("G: the enumerated ask became SEPARATE requirements per shape",
    reqsG.length >= 4 && /high/i.test(shapesG) && /low/i.test(shapesG) && /volume/i.test(shapesG) && /(sequence|timestamp)/i.test(shapesG),
    reqsG.map((r) => `${r.description} [${r.status}]`));
  const openG = reqsG.filter((r) => r.importance === "CRITICAL" && r.status !== "SATISFIED");
  check("G: a spot snapshot leaves the shapes it cannot carry UNRESOLVED",
    openG.length > 0 && openG.some((r) => /high|low|sequence|opening|volume/i.test(r.description)),
    openG.map((r) => `${r.description} [${r.status}]`));
  const snapshotRows = reqsG.filter((r) => r.status === "SATISFIED");
  check("G: the snapshot satisfies ONLY the shape it actually carries",
    snapshotRows.length > 0 && snapshotRows.every((r) => !/high|low/i.test(r.description)),
    snapshotRows.map((r) => r.description));
  // The inflation guard, proven through the real HTTP/engine path rather than asserted on a
  // bound. The scripted provider serves ONE headline payload, which the capability fan-out
  // mints into several Evidence objects; before the coverage mapping carried payloadIdentity
  // each of them counted as an independent fact, and every row here reported 0 duplicates.
  check("G: a re-served provider response is counted ONCE, never as corroboration",
    reqsG.some((r) => (r.duplicateEvidenceCount ?? 0) > 0),
    reqsG.map((r) => `${r.description.slice(0, 30)}: ${r.evidenceCount}+${r.duplicateEvidenceCount ?? 0}dup`));
  const runEvidenceG = (await api("/api/evidence?limit=200"))
    .filter((e) => e.researchRunId === refsG[refsG.length - 1]);
  const distinctIdentitiesG = new Set(runEvidenceG.map((e) => e.payloadIdentity).filter(Boolean)).size;
  check("G: no requirement cites more observations than the run holds distinct payloads",
    distinctIdentitiesG > 0 && reqsG.every((r) => r.evidenceCount <= distinctIdentitiesG),
    { distinctIdentitiesG, maxRowCount: Math.max(...reqsG.map((r) => r.evidenceCount ?? 0)) });

  const answerG = String(aggG.answer?.answer ?? "");
  check("G: the answer NEVER claims every requirement was established",
    !/Nothing outstanding/.test(answerG) && !/every requirement/i.test(answerG), answerG.slice(0, 320));
  check("G: the answer NAMES the shapes that could not be established",
    /high|low|sequence|opening|volume/i.test(answerG) && /not established|could not be established|unavailable/i.test(answerG),
    answerG.slice(0, 400));
  await shot("G1-field-coverage-answer");

  // ---- F: NEW RESEARCH IS CLEAN ---------------------------------------------------
  const before = (await api("/api/investigations")).length;
  const clicked = await newResearch();
  check("F: the New Research control is clickable", clicked.clicked === true);
  const labelF = clicked.label;
  check("F: the composer is back to 'Research'", labelF === "Research", labelF);
  const railF = await railText();
  check("F: no previous research content is shown", !/What happened to Bitcoin over the last 24 hours/.test(railF) && !/Why did Bitcoin move today/.test(railF));
  const invF = await currentInvestigation();
  const runsF = invF?.runs?.length ?? 0;
  check("F: the new thread carries NO investigation state", runsF === 0, { investigation: invF?.id, runs: runsF });
  const after = (await api("/api/investigations")).length;
  check("F: nothing was deleted: earlier investigations remain in History", after >= before, { before, after });
  await shot("F1-after-new-research");
} catch (err) {
  check("harness completed without throwing", false, String(err));
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ results, failures }, null, 2));
  console.log(`\n=== ${results.length - failures.length}/${results.length} checks passed ===`);
  if (failures.length) console.log("FAILURES:\n - " + failures.join("\n - "));
  console.log("artifacts:", OUT);
  try { process.kill(-server.pid, "SIGKILL"); } catch { try { server.kill("SIGKILL"); } catch { /* already gone */ } }
  try { chrome?.kill("SIGKILL"); } catch { /* already gone */ }
  process.exit(failures.length ? 1 : 0);
}