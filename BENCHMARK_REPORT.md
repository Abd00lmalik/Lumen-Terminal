# Lumen Terminal — Benchmark Report

Latest update: **2026-09-16** (production deployment + provider fallbacks + frontend boundary tests) · Spec: [`BENCHMARK.md`](BENCHMARK.md) · Verification categories are never collapsed:
**VERIFIED LIVE** / **VERIFIED DETERMINISTICALLY** / **MOCKED** / **UNVERIFIED** / **BLOCKED-EXTERNAL**.

## Overall status

| Layer | Result | Mode |
|---|---|---|
| Deterministic suite (backend) | **389 passed / 0 failed**, 25 env-gated skipped (414 total) — one known load-sensitive G2 test flakes under full-suite parallel load and passes standalone (noted, not hidden) | VERIFIED DETERMINISTICALLY |
| Frontend deterministic suite (new) | **11 passed / 0 failed** — URL resolution (prod = same-origin, never localhost), NetworkError environment vocabulary, BackendDownNote rendering, single-fetch-boundary scan | VERIFIED DETERMINISTICALLY |
| Backend typecheck (`tsc --noEmit`) | clean | VERIFIED DETERMINISTICALLY |
| Frontend typecheck + production build | clean | VERIFIED DETERMINISTICALLY |
| **Production deployment** | **https://asklumen.vercel.app — health 200; Flow 1 research COMPLETED end-to-end on the serverless API; provider fallback served live with provenance trail; SPA same-origin /api (no localhost dependency)** | VERIFIED LIVE |
| Live suite (Suite B, env-gated) | Flow 1 TA scenario COMPLETED with real Bitget evidence (2026-09-15); Flow 5 COMPLETED with 1,095 real historical candles (2026-09-16) | VERIFIED LIVE |
| Browser E2E (Suite C / raw CDP) | real ask-bar submission → **new backend research object with judgment** (backend-side proof, not DOM-only) | VERIFIED LIVE |
| Security / mock / trading / fetch scans | clean — no secrets, no `mock.ts`, exactly one fetch boundary (`frontend/src/api/client.ts`), no execution surface, encrypted server-side env vars on Vercel | VERIFIED DETERMINISTICALLY |

## Flow coverage (all 8)

| Flow | Deterministic | Live | E2E | Status |
|---|---|---|---|---|
| 1 WHAT HAPPENED? | ✅ suite | ✅ COMPLETED, real Bitget TA evidence, conflicting MACD interpretations preserved | ✅ suite C | VERIFIED LIVE + DETERMINISTICALLY |
| 2 WHY DID IT HAPPEN? | ✅ suite | — (quota) | — | VERIFIED DETERMINISTICALLY |
| 3 WHAT COULD AFFECT IT? | ✅ suite | — (quota) | — | VERIFIED DETERMINISTICALLY |
| 4 DOES MY THESIS HOLD? | ✅ suite | — (quota) | ✅ API E2E (thesis assessment in DTO) | VERIFIED DETERMINISTICALLY |
| 5 HAS THIS HAPPENED BEFORE? | ✅ suite (13+ tests incl. look-ahead leakage) | ✅ **COMPLETED — 37 monthly chunks / 1,095 real daily candles → episode analysis (5 analogues from 118 candidates) → judgment** | ✅ **UI E2E with backend-side proof (rs_000007)** | VERIFIED LIVE + DETERMINISTICALLY |
| 6 WHAT DOES ALL THE INFO SAY? | ✅ suite | — (quota) | — | VERIFIED DETERMINISTICALLY |
| 7 WHAT COULD PROVE ME WRONG? | ✅ suite | — (quota) | — | VERIFIED DETERMINISTICALLY |
| 8 EVALUATE MY FRAMEWORK? | ✅ suite | — (quota) | — | VERIFIED DETERMINISTICALLY |

A benchmark "pass" = correct epistemic outcome, not forced COMPLETED. Quota-limited scenarios are BLOCKED-EXTERNAL, not failures; the same phrasing classes were verified live in earlier runs.

## Capability coverage

- **TECHNICAL_ANALYSIS — VERIFIED LIVE** (2026-09-15): real BTC/USDT RSI 33.34/34.93, MACD golden cross (+75.58 hist), Bollinger %b 0.95; conflicting MACD interpretations preserved as genuine disagreement (no forced synthesis).
- **G1 HISTORICAL_COMPARISON — VERIFIED LIVE** (2026-09-16): Bitget-first → **Binance Vision fallback** served 3 years of real daily candles; the 2021-05-19 crash episode returns the exact real bar (O 42,849.78 / L 30,000 / C 36,690.09); provenance records the serving venue and raw-capture refs of the actual HTTP fetches. Funding/OI/liquidations honestly `UNAVAILABLE` (mirrored nowhere reachable — never fabricated).
- **G2 WEB_RETRIEVAL — VERIFIED DETERMINISTICALLY** (14 tests: URL validation, SSRF guard, extraction, source classification primary/secondary/commentary/community, duplicate-source non-corroboration, failure ≠ negative evidence); **live retrieval BLOCKED-EXTERNAL in the last automated run** (sandbox network policy), general-web reachability confirmed by live probes earlier in the phase (Wikipedia/federalreserve.gov/CoinDesk HTTP 200).
- **PROVIDER FAILOVER — VERIFIED LIVE from production** (2026-09-16): Bitget news/sentiment returned empty coverage from Vercel; registry-owned fallbacks (`fallback/news-rss`, `fallback/fear-greed`) served; final DTO COMPLETED (HIGH confidence, 21 evidence) with the `attemptedProviders` trail and human-readable fallback limitations intact. TECHNICAL_ANALYSIS served by Bitget primary in the same run (real RSI 45.35).
- NEWS / SENTIMENT / MARKET_INTEL upstreams: previously **BLOCKED-EXTERNAL** (FINDINGS.md risk R1) — now mitigated by registry-owned fallbacks for news/sentiment/macro; total-failure remains an honest EMPTY (deterministic tests: 12 fallback laws).

## Model reliability (configured: `gemini-3.5-flash-lite` via `GEMINI_MODEL`)

- Structured output: valid JSON on every live call; validator repair/normalization laws tested deterministically.
- Quota behavior: daily per-model 429 fails fast (typed, non-retriable); per-minute 429/5xx retriable with bounded backoff. Live-observed MODEL_FAILURE rendered honestly in the UI (no fabricated content).
- Live intent classification: SAFETY scenario rejected "Buy BTC and open a 10x long" before any dispatch — VERIFIED LIVE.
- Routing variance note (honest): flash-lite occasionally routes an ambiguous historical phrasing to the generic loop; the canonical Flow 5 phrasing classifies correctly and the generic loop cannot launder current data as history (scope guard + G1-only evidence class). Model-mediated routing is by design.

## Epistemic integrity

Consolidated anti-laundering probe (Suite A, 11 tests): observation vs derived vs interpretation vs proxy vs speculation vs unavailable all classified correctly through the real pipeline; tool failure never becomes negative evidence; partial results preserve limitations; missing provenance rejected; correlation/causation boundary held; no-evidence ≠ confirmation (Flow 7 verdict vocabulary). Conflict preservation verified LIVE in the TA scenario. Flow 5 look-ahead leakage has a dedicated failing-if-leaked test.

## Defects found & fixed (cumulative, with regression tests)

1. **Flow 5 fall-through to the generic loop** (benchmark phase) — HISTORICAL objective registered; dedicated `flow5.ts`; scope guard; 5 regression tests.
2. **API DTO omitted Flow 5 evidence** (G1 phase) — `research-app.ts` flow loop missed `flow5`; one-line fix + API regression test.
3. **Generic-loop calls to HISTORICAL_COMPARISON lacked a query envelope** (G1 phase) — capability-level defaults (explicit params win); regression-tested.
4. **Flow 5 produced no Judgment object** (G1-analysis phase) — every other flow attaches one; Flow 5 now records a deterministic judgment (confidence MODERATE only when comparable episodes exist; explicit "precedent ≠ prediction" language). Regression test asserts the judgment, its evidence basis, and non-predictive wording.
5. **Cross-round evidence duplication** (G1-analysis phase) — a repeated identical capability call re-ingested the same outputs (live run: 111 blocks for 37 real ones). Fixed in the shared runner with invocation+output signatures; regression test with a repeated-capability plan.
6. **Restart ID collision (CONFIRMED DEFECT, data loss)** (G1-analysis phase) — fresh process counters restarted at 1 and the first new research object OVERWROTE persisted `rs_000001`. Fixed in `Workspace.fromSnapshot` via counter seeding from the loaded graph; regression test in `file-store.test.ts`.
7. **Interrupted runs stayed ACTIVE forever** (G1-analysis phase) — runs killed by a process restart never left ACTIVE. Startup sweep marks judgment-less ACTIVE research as STOPPED with an honest note; regression test through the API.
8. **Test-infra flakiness** (benchmark + analysis phases) — load-sensitive real-timer assertions given explicit budgets; no assertions weakened.
9. **Production UI pointed at localhost** (hardening phase) — the deployed SPA fell back to `http://127.0.0.1:3001` in production and no `/api` functions existed on Vercel. Fixed: same-origin resolution in `client.ts` (regression-tested), thin `api/research.ts` function hosting the same Fastify app (regression-tested through real node:http), `vercel.json` with SPA rewrites + 300s function duration. Root cause of the original "Backend unreachable" screen.
10. **Empty-coverage primary blocked fallback** (hardening phase, found via live production test) — the registry only failed over on *thrown* failures, but Bitget from Vercel returned valid empty payloads → NEWS/SENTIMENT/MACRO stayed EMPTY. Fixed: "serves" now requires actual coverage (≥1 non-UNAVAILABLE output); empty result preserved as honest lastFailure. Regression tests: empty-primary→fallback-serves and all-empty→honest-EMPTY.
11. **Fallback adapters ignored the fetch test seam** (hardening phase) — Sentiment/Macro adapters hardcoded transports, so the all-fail test hit the LIVE World Bank API. Fixed with constructor-injected `fetchImpl` (same seam News already had).
12. **Production error text leaked dev instructions** (hardening phase) — every page rendered "start it with `npm run api`" regardless of environment. Fixed: environment-aware `NetworkError` + shared `BackendDownNote` (production never sees dev instructions; regression-tested).

## Known external limitations (not code defects)

1. Gemini free-tier quota is per model per day — several benchmark scenarios BLOCKED-EXTERNAL on 2026-09-16 after live verification runs consumed the bucket.
2. MCP hub upstream outage (R1): news/sentiment/market-intel degraded from this environment — now mitigated by registry-owned fallbacks (see capability coverage).
3. `api.bitget.com` REST network-unreachable from this machine (verified twice); Bitget MCP path and Binance Vision fallback both live-verified.
4. Production workspace state is per-instance memory (serverless disks are ephemeral) — documented in DEPLOYMENT.md §3, upgrade path defined behind the two-method store interface.

## Final gate

All 17 gate questions answerable from evidence: NL entry ✅, Gemini interpretation ✅ (live), flow selection ✅, capability selection without hardcoding ✅, real Bitget data ✅ (live), real historical data ✅ (live), measurement/interpretation split ✅ (live), provenance ✅ (live), conflict preservation ✅ (live), honest insufficiency ✅ (live ×2), thesis eval without mutation ✅ (det.), challenge without false confirmation ✅ (det.), explicit SAVE only ✅ (det.), confirmation-gated monitoring ✅ (det.), structural no-trading ✅ (det. + live SAFETY), frontend over real API ✅ (live E2E with backend-side proof), truthful failures ✅ (live), repeatable benchmarks ✅.

**Next recommended phase**: demo preparation on the deployed target (see `DEPLOYMENT.md`), or G2 live-source expansion once sandbox network policy permits.
