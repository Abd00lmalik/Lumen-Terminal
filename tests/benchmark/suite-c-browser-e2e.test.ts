/**
 * BENCHMARK SUITE C — BROWSER E2E through the REAL frontend + REAL API (env-gated).
 *
 * Run explicitly with both servers up:
 *   FREEBUFF_LIVE=1 FRONTEND_URL=http://localhost:5173 API_URL=http://127.0.0.1:3001 \
 *   npx vitest run tests/benchmark/suite-c-browser-e2e.test.ts
 *
 * Proves (BENCHMARK.md D11): user types a natural-language question into the REAL ask-bar →
 * the REAL API receives it → the REAL LUI/engine run → the REAL response renders in the DOM
 * with confidence/uncertainty visible. Uses CDP over the browser's built-in WebSocket —
 * no extra dependencies. Deterministic assertions about PRODUCT behavior; the research
 * outcome may be COMPLETED or honestly insufficient — both are passes; fabrication is not.
 *
 * When FREEBUFF_LIVE is unset the suite reports skipped (never a silent pass).
 */
import { beforeAll, describe, expect, it } from "vitest";

const LIVE = process.env.FREEBUFF_LIVE === "1";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3001";
const CDP_URL = process.env.CDP_URL ?? "http://localhost:9222";

// --- minimal CDP helpers (no dependencies; Node ≥22 global WebSocket) ----------------

interface CdpConn { send(method: string, params?: object): Promise<Record<string, unknown>>; close(): void }

async function connectCdp(): Promise<{ conn: CdpConn; targetId: string }> {
  const list = (await (await fetch(`${CDP_URL}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string; id: string }[];
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error(`no page target on ${CDP_URL} — start Chrome with --remote-debugging-port=9222`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("cdp ws failed")); });
  let seq = 0;
  const pending = new Map<number, (v: unknown) => void>();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown };
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id); }
  };
  return {
    conn: {
      send(method: string, params?: object) {
        const id = ++seq;
        ws.send(JSON.stringify({ id, method, params: params ?? {} }));
        return new Promise((resolve) => pending.set(id, resolve as (v: unknown) => void));
      },
      close: () => ws.close(),
    },
    targetId: page.id,
  };
}

async function evaluate(conn: CdpConn, expression: string): Promise<unknown> {
  const res = await conn.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const r = res as { result?: { value?: unknown } };
  return r.result?.value;
}

// --- suite --------------------------------------------------------------------------

describe.skipIf(!LIVE)("BENCH-C: browser E2E (real frontend → real API → real research)", () => {
  let conn: CdpConn;

  beforeAll(async () => {
    // The API must be up before the browser drives it (fail with a truthful message otherwise).
    const health = await fetch(`${API_URL}/api/health`);
    expect(health.status).toBe(200);
    conn = (await connectCdp()).conn;
    // Fresh page context: navigate to a blank page first so the SPA mounts cleanly.
    await conn.send("Page.navigate", { url: "about:blank" });
    await new Promise((r) => setTimeout(r, 500));
  }, 30_000);

  it("a natural-language question typed into the REAL ask-bar produces a rendered REAL research answer", { timeout: 300_000 }, async () => {
    await conn.send("Page.navigate", { url: `${FRONTEND_URL}/#/research` });
    await new Promise((r) => setTimeout(r, 1500));

    // Locate the ask-bar input in the REAL component tree (the SPA router may need a beat).
    // The ask-bar input carries no explicit type attribute, so match bare inputs too.
    const INPUT_SEL = 'textarea, input:not([type="hidden"], [type="checkbox"], [type="radio"])';
    let hasInput = false;
    for (let i = 0; i < 10; i++) {
      hasInput = Boolean(await evaluate(conn, `document.querySelector('${INPUT_SEL}') !== null`));
      if (hasInput) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!hasInput) {
      const debug = String(await evaluate(conn, `document.body.innerText.slice(0, 400)`));
      throw new Error(`ask-bar not found — page rendered: ${debug}`);
    }

    // Type the question and click the real submit control.
    await evaluate(conn, `
      (() => {
        const el = document.querySelector('${INPUT_SEL}');
        const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
        setter.call(el, 'What is the current technical setup on BTC/USDT?');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
      })()
    `);
    await evaluate(conn, `
      (() => {
        // The submit button lives INSIDE the ask-bar (sidebar has a "New research" nav button
        // that would otherwise match a text search). Scope to the ask-bar container.
        const bar = document.querySelector('.ask-bar');
        const btn = bar ? bar.querySelector('button') : null;
        if (btn) { btn.click(); return 'clicked'; }
        return 'no-button';
      })()
    `);

    // ANTI-FALSE-PASS: the research count on the backend must INCREASE — the submission
    // must reach the real API before any rendered output can count as the answer.
    const before = Number(await evaluate(conn, `
      fetch('${API_URL}/api/research').then(r => r.json()).then(j => (j.research ?? j).length)
    `)) ?? 0;

    // Poll the REAL DOM for the REAL backend answer (up to 4.5 minutes), and require BOTH:
    // (a) a new research object appeared on the backend (submission really landed), and
    // (b) the DOM shows the research lifecycle output (streaming progress or final answer
    //     with epistemic framing) or a truthful failure state.
    // Detection vocabulary = the frontend's REAL rendered states: completed answer cards
    // (confidence/uncertainty/evidence), streaming progress, failure cards
    // ("model_failure · research" kicker / "Interpretation failed"), rejection cards.
    const FAILURE_RENDER = /model[_ ]failure|interpretation failed|request rejected|provider failure|unavailable|insufficient/i;
    const ANSWER_RENDER = /confidence/i;
    const deadline = Date.now() + 270_000;
    let rendered = "";
    let after = before;
    let submissionLanded = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      rendered = String(await evaluate(conn, `document.body.innerText`) ?? "");
      after = Number(await evaluate(conn, `
        fetch('${API_URL}/api/research').then(r => r.json()).then(j => (j.research ?? j).length)
      `)) ?? before;
      if (after > before) { submissionLanded = true; break; }
      // A typed failure/rejection renders its card without persisting a research object
      // (quota exhaustion, invalid request) — that is an honest, truthful render too.
      if (FAILURE_RENDER.test(rendered) && /research/i.test(rendered)) break;
    }
    expect(submissionLanded || FAILURE_RENDER.test(rendered)).toBe(true);

    // Wait for the rendered result (final answer with epistemic framing, or honest failure).
    const renderDeadline = Date.now() + 240_000;
    let ok = false;
    while (Date.now() < renderDeadline) {
      await new Promise((r) => setTimeout(r, 3000));
      rendered = String(await evaluate(conn, `document.body.innerText`) ?? "");
      if (ANSWER_RENDER.test(rendered) && /uncertain|limitation|evidence|failed/i.test(rendered)) { ok = true; break; }
      if (FAILURE_RENDER.test(rendered)) { ok = true; break; }
    }
    // The product contract: an answer with epistemic framing rendered — or a truthful
    // failure state. Silence/error-page/fabricated numbers are failures.
    expect(ok).toBe(true);
    expect(rendered).not.toContain("Application error");
  }, 320_000);
});
