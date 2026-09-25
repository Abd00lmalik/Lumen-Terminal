# Lumen Terminal

**An AI research workbench for traders**; ask a natural-language question about a market, and the system investigates it like a research analyst: it plans the research, retrieves real market evidence, classifies what it *observed* versus what it *interpreted*, preserves provenance for every claim, and reports its judgment **with** its uncertainty.

> **This is not a trading terminal.** Lumen Terminal performs research only. There are no orders, no execution, no position management, and no buy/sell signals anywhere in the system; by architecture, not by policy. *Research can inform a decision; research does not become the decision.*

Lumen Terminal is an independent research product: a workbench that turns natural-language questions into evidence-backed investigations. It integrates exchange and public data providers (Bitget as a primary market-data source among fallbacks) behind a provider-neutral capability registry.

---

## The problem

Traders ask questions like *"Why did BTC move today?"* or *"Has this setup happened before?"* and get one of two bad answers:

1. **A chatbot answer**; fluent text generated from a model's background knowledge, with no way to tell what was actually measured, what was inferred, and what is simply made up.
2. **A dashboard**; raw numbers with no synthesis, no contradiction handling, and no honest statement of what the data does not establish.

Both hide the most important thing: **the difference between an observation and an opinion.** Lumen Terminal is built to make that difference impossible to hide.

## What we built

- **Natural-language research intake**; a Gemini-interpreted LUI classifies every request into one of six actions (`RESEARCH`, `ANALYZE`, `CHALLENGE`, `MANAGE_STATE`, `MONITOR`, `SAVE`) and one of eight research flows. The model interprets; it never executes.
- **A research engine**; model-proposed, schema-validated research plans executed through a **capability registry** (no flow→tool hardcoding; the registry resolves providers, with fallback).
- **Real evidence with epistemic classes**; every piece of evidence is an `OBSERVATION`, `QUANTITATIVE_OBSERVATION`, `DERIVED_OBSERVATION`, `ANALYST_INTERPRETATION`, `INFERENCE`, `SPECULATION`, or `PROXY_EVIDENCE`; and unavailable data stays `UNAVAILABLE` (a failed fetch is never laundered into negative evidence).
- **Provenance on every object**; who/what created it, when, from which tool invocation, with raw-capture references for audit.
- **Historical precedent research (Flow 5)**; real multi-year candles, deterministic episode detection with **explainable** similarity (matched vs. differing dimensions; never a bare score), forward outcome windows, and **look-ahead protection** (episode features never use future data; outcomes are computed separately).
- **Thesis lifecycle**; trader-owned theses are assessed, challenged, and reassessed; they are never silently rewritten, and monitor activation always requires explicit confirmation.
- **Memory with decay**; saved knowledge is `CURRENT`, `STALE`, or `HISTORICAL`; current research always outranks stale memory.

## The 8 research flows

| # | Question | Status |
|---|---|---|
| 1 | **What happened?** | ✅ live-verified (real Bitget technical evidence) |
| 2 | **Why did it happen?** | ✅ deterministic |
| 3 | **What could affect it?** | ✅ deterministic |
| 4 | **Does my thesis hold?** | ✅ deterministic + API E2E |
| 5 | **Has this happened before?** | ✅ **live-verified** (1,095 real daily candles → episode analysis) |
| 6 | **What does all the information say?** | ✅ deterministic |
| 7 | **What could prove me wrong?** | ✅ deterministic |
| 8 | **Evaluate it by my framework** | ✅ deterministic |

A benchmark "pass" is the **correct epistemic outcome**; `COMPLETED`, `INSUFFICIENT_EVIDENCE`, `UNAVAILABLE`, or honest failure; never a forced success.

## Architecture

```mermaid
flowchart TD
    USER[Trader] --> UI[Lumen Terminal UI<br/>React + Vite]
    UI -->|natural language + SSE| API[F0 API<br/>Fastify]
    API --> LUI[LUI<br/>intent · target · ambiguity · consequence · safety]
    LUI -->|structured requests| GEMINI[Model Providers<br/>Gemini primary → Groq fallback<br/>server-side keys only]
    LUI --> ENGINE[Research Engine]
    ENGINE --> REG[Capability Registry]
    REG --> BITGET[Bitget research capabilities<br/>MCP + REST]
    REG --> G1[G1 Historical Data<br/>Bitget → Binance Vision fallback]
    REG --> G2[G2 Web / Primary Sources<br/>bounded retrieval]
    BITGET --> EV[Evidence Validation<br/>epistemic classes + provenance]
    G1 --> EV
    G2 --> EV
    EV --> RO[Research Objects<br/>claims · hypotheses · analyses · judgments]
    GEMINI -.->|interpretation only,<br/>never facts| RO
    RO --> MEM[Thesis · Memory · Monitor handoff]
    RO --> STORE[Persistence<br/>FileStore]
    STORE --> API
    RO --> API
    API -->|safe DTOs| UI
```

### LUI pipeline

```mermaid
flowchart LR
    MSG[Trader message] --> NORM[Normalize + intent<br/>6 actions] --> TGT[Target resolution<br/>workspace-grounded] --> AMB[Ambiguity check<br/>clarify before consequential work] --> CONS[Consequence check] --> SAFE[Safety screen<br/>execution-like requests rejected] --> DISP{Dispatch}
    DISP -->|RESEARCH| F[Flow runner 1–8]
    DISP -->|CHALLENGE| F7[Flow 7 falsification]
    DISP -->|SAVE| AUTH[Explicit trader<br/>confirmation required]
    DISP -->|MONITOR| PROP[Proposal only —<br/>activation gated]
```

### Research execution (per flow)

```mermaid
flowchart LR
    OBJ[Flow objective] --> PLAN[Model proposes plan<br/>schema-validated] --> EXEC[Engine executes capabilities<br/>registry-resolved, parallel rounds]
    EXEC --> ING[Evidence ingestion<br/>dedupe + classification]
    ING --> DEC{Adaptive decision<br/>model proposes, engine bounds}
    DEC -->|more needed| PLAN
    DEC -->|sufficient / insufficient| HYP[Hypothesis lifecycle]
    HYP --> JUDG[Judgment + uncertainty<br/>deterministic or evidence-grounded]
    JUDG --> RESP[Progressive response]
```

### Evidence & provenance

```mermaid
flowchart LR
    CAP[Capability adapter] --> TR[TOOL_RESULT<br/>normalized + validated] -->|failure ≠ negative evidence| FB[Failure record]
    TR --> EV1[Evidence object<br/>class · freshness · completeness]
    EV1 --> PROV[Provenance chain<br/>origin → tool → invocation → raw capture]
    EV1 --> CL[Claims] --> AN[Analysis] --> J[Judgment]
```

### Capability / provider fallback

```mermaid
flowchart TD
    FLOW[Flow requests a capability<br/>never names a provider] --> REG[Capability Registry<br/>priority-ordered providers]
    REG --> P1[Primary: Bitget MCP/REST · Yahoo direct]
    REG --> P2[Fallback: news RSS · Fear&Greed · World Bank · Stooq]
    REG --> P3[Last tier: Heurist Mesh agents<br/>options chains · funding/OI · SEC · FRED<br/>credit-based, upstream lineage preserved]
    P1 -->|typed failure OR empty coverage| REG
    P2 -->|serves| TR[TOOL_RESULT + attemptedProviders trail<br/>+ fallback limitation]
    P3 -->|serves| TR3[TOOL_RESULT + upstreamSource lineage<br/>no double-counting with direct providers]
    P1 -->|serves| TR2[TOOL_RESULT; no fallback noise]
    REG -->|all fail / all empty| EMPTY[Honest EMPTY<br/>never fabricated, never negative evidence]
```

### Flow 5 historical analysis

```mermaid
flowchart TD
    Q["Has this happened before?"] --> HQ[Engine-built HistoricalQuery<br/>symbol · metric · window · interval]
    HQ --> G1A[G1 adapter: Bitget first,<br/>Binance Vision fallback]
    G1A --> CHUNKS[Monthly evidence chunks<br/>candles verbatim]
    CHUNKS --> CS[Current setup<br/>trend · momentum · volatility · range]
    CHUNKS --> EP[Episode detection<br/>features from anchor-time data ONLY]
    EP --> SIM[Explainable similarity<br/>matched vs differing dimensions]
    EP --> OUT[Outcome windows 1/3/7/14d<br/>separate from detection; no look-ahead]
    SIM --> RESP["CURRENT SETUP → HISTORICAL ANALOGUES →<br/>WHAT THIS DOES NOT ESTABLISH"]
    OUT --> RESP
    RESP --> J5[Judgment: precedent ≠ prediction]
```

### Thesis lifecycle

```mermaid
flowchart LR
    T[Trader-owned thesis] --> ASSESS[Flow 4 assessment<br/>evidence-grounded] --> HIST[Assessment history<br/>immutable versions]
    T --> CHAL[Flow 7 challenge<br/>falsification targets]
    NEW[New material evidence] --> MAT{Materiality gate<br/>model proposes, system validates}
    MAT -->|irrelevant| NOOP[Honest no-op]
    MAT -->|material| RE[Explicit reassessment] --> HIST
    MON[Monitor proposal] --> CONF[Trader confirmation] --> ACT[Activated handoff<br/>no background worker exists]
```

## The Gemini boundary

- Gemini **interprets** natural language, proposes research plans, and drafts synthesis; always schema-validated, always retry-bounded.
- Gemini **never** executes tools, never invents evidence, and its background knowledge is never presented as current market data. All market facts come from capabilities with provenance.
- The API key lives **server-side only** (`GEMINI_API_KEY`); the browser never sees it and never calls Gemini.
- Default model: `gemini-3.5-flash-lite` (selected by a live free-tier audit; see `.env.example`); configurable via `GEMINI_MODEL`.
- **Model fallback** (optional, `GROQ_API_KEY`): technical model failures (quota exhaustion, outages, timeouts) fail over to Groq behind the same `ModelProvider` interface; a genuine safety refusal is never bypassed; providers get a bounded circuit-breaker cooldown rather than permanent disablement; provenance records which model served. See `docs/architecture/model-provider-fallback.md`.
- Model/provider failures surface as typed `MODEL_FAILURE` states; never silently retried into fabrication.

## Bitget, G1, and G2 capabilities

- **Bitget (M1/M2)**; MCP + REST transports with throttling, bounded retry, freshness, and `TOOL_RESULT` normalization. Live-verified: real technical-analysis evidence (RSI/MACD/Bollinger) with conflicting interpretations preserved as genuine disagreement. Live-verified from production Vercel: real kline-derived technical evidence flowing end to end.
- **G1 historical data**; engine-selected `HistoricalQuery` (symbol, metric, window, interval) served by **Bitget REST when reachable**, with **Binance Vision** (`data-api.binance.vision`, Binance's official keyless market-data mirror) as the live fallback; the serving venue is recorded in provenance. OHLCV is real and multi-year; funding/open-interest/liquidations are honestly `UNAVAILABLE` (mirrored nowhere reachable; never fabricated).
- **G2 web/primary sources**; bounded retrieval with URL validation (SSRF-safe), HTML-to-text extraction, source classification (**primary / secondary / commentary / community**), and source/evidence separation: a web page is a *source*, not automatically evidence. Repeated syndication of one origin is not counted as independent corroboration.
- **Heurist Mesh agents** (optional, `HEURIST_API_KEY`); specialized data-provider fallbacks registered at the lowest registry tier: Yahoo options chains, Binance funding/OI, SEC EDGAR filings, FRED macro series. Every output carries `upstreamSource` lineage so the same upstream served via Heurist and directly is never double-counted as corroboration; agent-generated prose is classified as external analysis, never as direct observation. See `docs/integrations/heurist.md`.

### Provider fallback (registry-owned)

The **capability registry owns failover**; flows never name providers. When the primary
(Bitget) fails *or returns empty coverage*, the next registered provider for that
capability serves:

- **NEWS** → curated public crypto RSS (CoinDesk/Cointelegraph); classified as secondary
  reporting; per-item publisher/timestamp/URL preserved.
- **SENTIMENT** → alternative.me Fear & Greed Index; a `SENTIMENT_SIGNAL` with explicit
  `proxyBasis`; never upgraded to a market observation.
- **MACRO** → World Bank official indicators; `QUANTITATIVE_OBSERVATION` with
  freshness `STALE` (annual official lag is never labeled current).

A serving fallback **must not erase the primary's failure**: every tool result carries an
`attemptedProviders` audit trail plus a human-readable limitation ("Bitget unavailable —
research continued using fallback/news-rss"). All providers failing/empty is an honest
`EMPTY`; never fabricated coverage, never negative evidence about the market.

Live-verified from production: Bitget news/sentiment returned empty coverage and the
fallbacks served with the provenance trail intact (COMPLETED, HIGH confidence).

## Safety boundary

Structurally enforced, not prompt-enforced:

- No trading/execution capability exists in the registry, the API, or the frontend. Execution-like requests are rejected at the LUI safety screen (live-verified with adversarial phrasing).
- `SAVE` persists memory only through the explicit trader-confirmation boundary.
- Monitors are proposals; activation is confirmation-gated; **no background worker, cron, or notification infrastructure exists**; the UI labels monitor state as a handoff, not live surveillance.
- Source failure becomes `SOURCE_UNAVAILABLE`, never invalidation; retrieval failure never becomes negative evidence.
- The frontend renders backend **typed** epistemic state and never infers meaning from raw text.

## Benchmark proof

Verification categories are never collapsed (`VERIFIED LIVE` / `VERIFIED DETERMINISTICALLY` / `MOCKED` / `UNVERIFIED` / `BLOCKED-EXTERNAL`). Full details: [`BENCHMARK_REPORT.md`](BENCHMARK_REPORT.md), spec in [`BENCHMARK.md`](BENCHMARK.md).

| Layer | Result |
|---|---|
| Deterministic tests | **817 backend + 60 frontend passed / 0 failed** (25 env-gated live tests skipped without credentials) |
| Backend typecheck | clean |
| Frontend typecheck + production build | clean |
| **Production deployment** | **VERIFIED LIVE at https://asklumen.vercel.app**; same-origin serverless API, health 200, real research COMPLETED |
| Live research (Suite B) | Flow 1 and Flow 5 COMPLETED with real evidence; Flow 5 live UI run verified |
| Live provider fallback | VERIFIED LIVE from production: Bitget empty coverage → news/sentiment fallbacks served, provenance trail preserved |
| Browser E2E (Suite C / CDP) | real ask-bar submission → new backend research object → judgment (backend-side proof) |
| **Research history (Phase B)** | **VERIFIED LIVE at API level**: windowed history list, run aggregate with `recordTier`, typed 404s for a `requestId`/monitor ref; browser journey BLOCKED by a live provider outage on 2026-09-25 (see `handoff.md`) |
| Security scans | no secrets, `.env` ignored, one fetch boundary in the frontend, no trading surface |

## Known limitations

- **Production workspace state IS durable in Vercel Blob** (updated 2026-09-25; `DEPLOYMENT.md` §3). It used to be per-instance memory; that is no longer true. History rows can still be genuinely degraded (`recordTier` JUDGMENT/SUMMARY) for runs completed before records were persisted, or for a run whose serverless invocation was killed before its record landed — the UI marks those honestly rather than inventing a result.
- **News / sentiment / macro upstreams** can be unreachable from some networks (Bitget endpoint blocking); registry-owned fallbacks now cover news/sentiment/macro; all-fail remains an honest EMPTY, never fabricated.
- **G1 depth beyond OHLCV**; historical funding/OI/liquidations are not mirrored by any reachable source; reported `UNAVAILABLE`.
- **Monitoring is a handoff, not a worker**; proposed/activated monitors persist, but nothing runs in the background. This is intentional for this phase.
- **Local dev persistence**; `FileStore` (`.data/workspace.json`) is local and single-user; multi-user auth is future work.
- **Free-tier model quotas**; per-model daily limits on Gemini's free tier; quota exhaustion surfaces as an honest `MODEL_FAILURE`, and retries are bounded so it fails fast.

## Local setup

Requirements: Node.js ≥ 20, npm.

```bash
# 1. Install
npm install
cd frontend && npm ci && cd ..

# 2. Configure (server-side only; never committed)
cp .env.example .env
#   → set GEMINI_API_KEY (GEMINI_MODEL defaults to gemini-3.5-flash-lite)

# 3. Run the backend API (port 3001)
npm run api

# 4. Run the frontend (port 5173)
cd frontend && npm run dev
```

**Production:** the same app deploys to Vercel with serverless API functions —
same-origin `/api`, streaming SSE, server-side-only credentials. See [`DEPLOYMENT.md`](DEPLOYMENT.md).

Open **http://localhost:5173**, go to *Research*, and ask e.g.
`Search historical data for similar BTC setups and patterns.`

## Testing

```bash
npm test                # full deterministic suite (no API key needed)
npx tsc --noEmit        # backend typecheck
cd frontend && npm run build   # frontend typecheck + production build
```

Live tests are **env-gated** (`FREEBUFF_LIVE=1` + credentials) and never run in the deterministic suite. Browser E2E uses raw CDP against a real Chrome and asserts **backend-side** proof of submissions.

## Demo workflow

1. **What happened?**; `What is affecting BTC right now?` → Flow 1: current evidence, confidence, uncertainty.
2. **Has this happened before?**; `Search historical data for similar BTC setups and patterns.` → Flow 5: current setup → historical analogues (with matched/differing dimensions) → what the record does *not* establish.
3. **Does my thesis hold?**; save a thesis, then ask → Flow 4: evidence-grounded assessment, versioned history.
4. **What could prove me wrong?**; `What would prove my BTC thesis wrong?` → Flow 7: falsification targets, disconfirming evidence, monitor *proposals*.
5. **Watch the honesty paths**; submit an execution-like request (rejected), or exhaust the model quota (typed `MODEL_FAILURE`, no fabricated content).

## Project structure

```
├─ src/
│  ├─ domain/          # research objects, lifecycle, provenance, evidence laws
│  ├─ model/           # provider-neutral model layer (Gemini implementation, schemas)
│  ├─ lui/             # natural-language understanding + dispatch (6 actions)
│  ├─ research/        # flow runner, flows 1–8, episode analysis, context
│  ├─ adapters/        # capability registry + failover, Bitget MCP/REST, G1 historical, G2 web, fallbacks
│  ├─ persistence/     # WorkspaceStore (file + memory)
│  └─ api/             # F0 boundary: Fastify server, routes, DTOs, SSE, error model
├─ api/                # Vercel function adapter (hosts the same Fastify app; no second backend)
├─ frontend/           # React + Vite research workbench (single fetch boundary)
├─ tests/              # deterministic + env-gated live suites, benchmark suites A/B/C
├─ docs/architecture/  # the source-of-truth architecture documents
├─ AGENT.md            # operating laws for agents working in this repo
├─ API_CONTRACT.md     # frontend ↔ backend contract
└─ BENCHMARK.md / BENCHMARK_REPORT.md
```

Source-of-truth hierarchy: `docs/architecture/` → `AGENT.md` → `FINDINGS.md` → `handoff.md`.

## Deployment

**Deployed and live:** https://asklumen.vercel.app; same-origin serverless API + SPA on
Vercel, with registry-owned provider fallbacks. Full architecture, environment variables,
persistence honesty, and known limits: [`DEPLOYMENT.md`](DEPLOYMENT.md).
