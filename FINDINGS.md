# Bitget Capability Research — Findings Report

> **Status:** Research phase deliverable. No application implementation has been done.
> **Research date:** 2026-09-12. **Researcher:** Buffy (coding agent), via official sources only.
> **Classification labels:** CONFIRMED (verified against official Bitget sources) · INFERRED (reasonable conclusion from official sources, not stated verbatim) · UNKNOWN (not documented in accessible sources) · GAP (capability Bitget does not provide).
>
> **Sources used (all official):**
> 1. Bitget AI Base Camp Hackathon docs (official GitBook): `bitget-ai.gitbook.io/hackathon`
> 2. `Bitget-AI/agent_hub` (official ecosystem entry point, GitHub)
> 3. `Bitget-AI/agent-skill` (official trading-skill repo, GitHub)
> 4. `Bitget-AI/bitget-signal` (official market-analysis skills repo, GitHub): README, `llms.txt`, `CHANGELOG.md`, `VERSION` (v1.2.0), and the five per-skill `SKILL.md` files
> 5. `kukapay/awesome-crypto-skills` (community index — used only as a discovery pointer, not as evidence)
>
> **Vendor-neutrality note:** all five skill files instruct the AI to never name underlying data providers in output ("market data", "derivatives market data", etc.). This is a skill-level presentation rule; it does not affect our provenance obligations — our PROVIDER_ADAPTER layer must still record the real provider/Skill/tool per TOOL_RESULT.

---

## 1. What was actually found

The Bitget AI ecosystem (official, open-source, MIT-licensed) consists of:

| Component | What it is | Auth | Relevance to us |
|---|---|---|---|
| **`bitget-signal`** (v1.2.0) | **5 analyst-grade market-analysis skills** + shared public market-data MCP server | **None** (no account, no API key) | **PRIMARY research capability** — the runtime agent's perception layer |
| `bitget-agent-skill` + `bitget-agent-cli` (`bgc`) | Trading skill + CLI over 89 Bitget UTA v3 operations (14 intent verbs) | Bitget API key (HMAC-SHA256) | Trading execution — **out of scope** for the research workbench (Track: research, not execution) |
| `bitget-agent-mcp` | MCP server for desktop AI over the same 89 ops | Bitget API key | Alternative surface for the same trading ops |
| `bitget-agent-sdk` | TypeScript SDK foundation | n/a | Underlying SDK if we build custom adapters |
| **MCP Server (public)** | HTTP market-data MCP at `https://datahub.noxiaohao.com/mcp`, maintained by Bitget, no cost | None | The data backend the 5 skills call |

The architecture's initial Skill registry (5 Skills named in `# TOOL & SKILL ORCHESTRATION INTELL.txt`) matches exactly what exists — **CONFIRMED, with material caveats on what each Skill actually provides (see §2).**

Installation mechanism (for our runtime agent's host environment): `npx @bitget-ai/bitget-signal --target all` installs the skill files and registers the public MCP server. The `technical-analysis` skill additionally requires local Python with `pandas`/`numpy`. — CONFIRMED

## 2. Detailed capability matrix (verified per skill)

### 2.1 `macro-analyst`
| Dimension | Finding | Status |
|---|---|---|
| Purpose | Macro & cross-asset analysis; produces a RISK-ON / MIXED / RISK-OFF verdict for crypto | CONFIRMED |
| Data | Fed policy/FOMC news, rates & yields (yield curve, 10y2y spread, breakevens), macro indicators (CPI, core PCE, nonfarm payrolls, GDP, unemployment), cross-asset correlations (BTC vs Gold/DXY/NDX/SPX/T10Y/VIX, selectable period & window), global market prices (DXY, S&P, Nasdaq, Gold, 10Y, VIX, Oil), Chinese/Asian market context, forex, crypto-relevant earnings calendar | CONFIRMED |
| Output | Inline verdict format + fuller report templates (skill `references/output-templates.md`) | CONFIRMED |
| Output class | **Analysis/interpretation** built on observed data (not raw data; not a signal) | CONFIRMED |
| Assets | Crypto (BTC focus) + macro series + major TradFi assets/indices/forex | CONFIRMED |
| Timeframes | Correlation `period`/`window` parameters (e.g. 1y/30d); "recent" release-based data | CONFIRMED (parameterized) |
| Freshness | Economic data has **1–2 day release lag**; market prices may be stale on weekends | CONFIRMED (documented) |
| Historical coverage | Rate history via `rates_yields(action="history", rate_key=..., limit=24)` (e.g., monthly spread history) | CONFIRMED (limited depth) |
| Auth / cost / rate limits | No API key; free (MIT, data backend maintained by Bitget at no cost) | CONFIRMED |
| Invocation | MCP tools over Bitget public market-data MCP (e.g. `rates_yields`, `macro_indicators`, `cross_asset`, `global_assets`, `cn_market`, `global_data`, `tradfi_news`) | CONFIRMED |
| Failure behavior | Returns "data temporarily unavailable" — never exposes provider names | CONFIRMED |
| Limitations | Economic-data lag; weekend staleness; yield-curve inversion is a 12–24-month leading indicator (not a timing signal); vendor-neutral output rule | CONFIRMED |
| Provenance | Skill/tool invocation + parameters observable; **provider names deliberately masked** in skill output — our adapter must restore provenance | CONFIRMED |

### 2.2 `market-intel`
| Dimension | Finding | Status |
|---|---|---|
| Purpose | Structural/positional market intelligence: capital flows, institutions, market cycle, network health | CONFIRMED |
| Data actually available | DeFi TVL rankings, chain TVL, stablecoin supply, DeFi yields & fees, DEX trending/search/token, crypto market global stats & rankings & trending, OHLCV (via CoinGecko-style coin IDs), ETH gas, BTC fees & mempool | CONFIRMED |
| ⚠ **Material caveats** | **Direct ETF flow data: NOT available** (skill uses news search as a proxy). **Direct on-chain whale tracking / exchange reserves / token unlocks: NOT available** (uses derivatives positioning as proxy). **Cycle indicators (AHR999, Pi Cycle, Rainbow, Coinbase Premium, Puell): NOT available** (uses dominance/stablecoin proxies). Skill explicitly instructs informing the user of these gaps. Full list: skill `references/data-availability.md` | CONFIRMED |
| Output class | Mixed: raw observations + skill-authored proxy interpretation | CONFIRMED |
| Freshness / limits / cost | Live public data; no key; free; rate limits UNKNOWN (not documented) | CONFIRMED / UNKNOWN |
| Failure behavior | Neutral "data temporarily unavailable" | CONFIRMED |

### 2.3 `sentiment-analyst`
| Dimension | Finding | Status |
|---|---|---|
| Purpose | Sentiment & positioning synthesis; emphasizes **divergences** (e.g., retail vs top-trader long/short) | CONFIRMED |
| Data | Fear & Greed Index (current + 14-day history), retail long/short, **top-trader long/short**, taker buy/sell ratio, open interest, Reddit trending | CONFIRMED |
| Symbols / periods | `BTCUSDT`-style futures symbols (no slash); periods `5m`–`1d` | CONFIRMED |
| Output class | Numeric observations + threshold interpretation (F&G bands, L/S thresholds, funding ranges in `references/signal-guide.md`) | CONFIRMED |
| Freshness | Community data ~15 min lag (documented) | CONFIRMED |
| Limitations | **On-chain exchange flows not available on this server** (documented); altcoins need futures symbol format | CONFIRMED |
| Auth / cost | None; free | CONFIRMED |

### 2.4 `technical-analysis`
| Dimension | Finding | Status |
|---|---|---|
| Purpose | 23 technical indicators across 6 categories (trend, volatility, oscillator, volume, momentum, S/R), output as **time-series arrays** (trend evolution, not single points) | CONFIRMED |
| Data source | **Direct Bitget public REST API**: `api.bitget.com/api/v2/spot/market/candles` (spot) and `/api/v2/mix/market/candles` (USDT futures); local CSV/Parquet/JSON also supported | CONFIRMED |
| Intervals | `1min, 5min, 15min, 30min, 1h, 4h, 1d, 1w`; default 200 klines; TAIL window configurable | CONFIRMED |
| Environment requirement | **Local Python with pandas/numpy required** (calculation runs locally, not via MCP) | CONFIRMED |
| Output class | Raw computed indicator data + explicit rules: present conflicting indicators objectively; no trading advice; label data source/timeframe | CONFIRMED |
| Provenance | Skill must show timeframe, kline count, and data source label | CONFIRMED |
| Auth / cost | None (public API endpoint); free | CONFIRMED |
| Rate limits | Public Bitget API rate limits apply; exact numbers not stated in skill → UNKNOWN (consult `bitget.com/api-doc` at implementation) | UNKNOWN |

### 2.5 `news-briefing`
| Dimension | Finding | Status |
|---|---|---|
| Purpose | News aggregation, briefing, narrative synthesis, keyword search | CONFIRMED |
| Data | **44 RSS/Atom feeds** (crypto: Cointelegraph, CoinDesk, Decrypt, Blockworks, The Defiant, BlockBeats; TradFi: CNBC, BBC, Guardian, Al Jazeera, NPR, Fed; KOL/research: Hayes, Vitalik, Cobie, Messari; tech: HN, TechCrunch…), social trending boards (Weibo, Douyin, Bilibili, GitHub), Reddit trending | CONFIRMED |
| Output class | Aggregated observations + skill-authored narrative synthesis; filtering rules (market-moving first, dedupe, flag 3+ source coverage, add price context, disclose gaps) | CONFIRMED |
| Freshness | RSS updates every 15–60 min — **not real-time**; failed feeds return per-feed errors and are skipped | CONFIRMED |
| Auth / cost / limits | None; free; rate limits UNKNOWN | CONFIRMED / UNKNOWN |

### 2.6 Ecosystem extras
- **Planned Bitget-exclusive signals** (announced in official README + CHANGELOG roadmap; **not shipped at research date — status: announced future capability**): `top-trader-flow` (aggregated copy-trading leader positioning), `derivatives-structure` (perp basis, term structure, funding-rate curve from Bitget orderbook), `large-flow-detect` (whale-sized order detection on Bitget pairs). These map directly onto our DERIVATIVES data domain and Falsification/Monitoring needs — track and adopt when released.
- **Trading stack** (`bgc` CLI + trading skill + SDK): 89 UTA v3 ops, paper trading (`--paper-trading`), `--read-only` mode, demo API keys. Relevant to us only for potential future account/position context and for the hackathon's demo expectations; **the research workbench itself must not execute trades** (architecture: Safety & Decision Boundary).

## 3. Architecture assumptions: confirmed / invalidated / unknown

**Confirmed by research:**
- The 5-Skill initial registry in `tool-skill-orchestration.md` matches the real ecosystem 1:1 (names and domains). — CONFIRMED
- Skills are plug-in capabilities delivered as markdown instructions + a shared MCP data service — consistent with our SKILL/TOOL/CAPABILITY model and the capability-before-tool principle. — CONFIRMED
- Skills are composable (skill files explicitly recommend combining, e.g., sentiment + technical for setup assessment; market-intel runs sections in parallel). — CONFIRMED
- Skill outputs include interpretation, thresholds, and verdicts — meaning our Evidence layer MUST classify skill output (observation vs interpretation) rather than treating it as raw data. The architecture already requires this (tool output ≠ truth). — CONFIRMED
- No auth/cost barrier for the research layer. — CONFIRMED

**Invalidated or needing modification (architecture assumptions vs reality):**
1. **"market-intel" ≠ on-chain intelligence.** The architecture lists ONCHAIN as a data domain and the Skill's marketing says "on-chain whale flows", but the skill itself documents that whale tracking, exchange reserves, token unlocks, ETF flow figures, and on-chain cycle indicators are **NOT available** — it substitutes news/derivatives/dominance proxies. Treating `market-intel` as an ONCHAIN provider would silently corrupt evidence quality. It is primarily a DEFI/ECOSYSTEM/MARKET-structure provider with proxy reasoning.
2. **ETF flow data is not directly available** from any verified Bitget skill — the architecture's NEWS/ECOSYSTEM assumptions that ETF flows are queryable must be downgraded to news-derived narrative only (until `derivatives-structure` or other exclusive signals ship).
3. **Vendor-neutrality rule conflicts with our provenance requirement.** Skills deliberately mask underlying providers. Our PROVIDER_ADAPTER/TOOL_RESULT layer must record the actual Skill, MCP tool, and parameters at the orchestration layer (which the mask rule does not prevent — it only governs user-facing text).
4. **The Skill set is not the whole Bitget capability surface.** Real additional capability exists in the trading stack's `market` module (public market data, no key) and a derivatives-data roadmap. The registry should be treated as extensible (the architecture already says so).

**Remaining UNKNOWN after research:**
- Rate limits on the public market-data MCP and on the public REST endpoints (not published in the repos reviewed) — verify at implementation and build client-side throttling.
- Whether the public MCP service offers historical depth beyond what skills use (e.g., long OHLCV ranges) — UNKNOWN.
- SLA/reliability of the community-hosted-looking MCP domain (`datahub.noxiaohao.com`) despite official bundling — treat as a reliability risk; design fallbacks.
- Skill behavior under concurrent/parallel calls (the skills encourage parallel calls; throttling behavior UNKNOWN).
- Exact list of all 44 feeds and full data-availability matrix lives in skill `references/` files — consult the installed package rather than the summary above when implementing.

## 4. Bitget → 8 research-flow capability mapping

Legend: ● primary contributor · ◐ secondary/supporting · — not a fit (by verified capability, not by name).

| Flow | macro-analyst | market-intel | sentiment-analyst | technical-analysis | news-briefing |
|---|---|---|---|---|---|
| 1 WHAT HAPPENED? | ◐ (macro context around the event window) | ◐ (structure/TVL/gas context) | ◐ (positioning around the event) | ◐ (pre/post price-structure observations) | ● (timeline reconstruction from news; 15–60 min feed lag limits intra-hour precision) |
| 2 WHY DID IT HAPPEN? | ● (macro-branch evidence: CPI/Fed/DXY/correlations) | ● (derivatives-positioning & stablecoin proxies; DeFi context) | ● (liquidation-risk & positioning evidence: OI, L/S divergence, funding) | ◐ (technical trigger context) | ● (narrative/regulatory/institutional evidence) |
| 3 WHAT COULD AFFECT IT? | ● (scheduled macro catalysts, FOMC, earnings calendar) | ● (unlocks≈GAP→proxies, TVL shifts, cycle position) | ◐ (crowding/squeeze preconditions) | ◐ (S/R levels where moves trigger) | ● (emerging stories) |
| 4 DOES MY THESIS HOLD? | ● (macro-dependent claims) | ◐ (structural/flow-dependent claims; ETF claims → news proxy only) | ● (positioning-dependent claims) | ● (technical-dependent claims) | ◐ (narrative shift detection) |
| 5 HAS THIS HAPPENED BEFORE? | ◐ (current regime vs historical regimes — shallow history only) | — (no deep on-chain history) | ◐ (current positioning vs documented historical episodes) | — (indicator series are recent-window only) | ◐ (historical narrative via news search; archive depth UNKNOWN) |
| 6 WHAT DOES ALL THE INFORMATION SAY? | ● | ● | ● | ● | ● (all five, cross-domain synthesis — the architecture's Flow 6 maps cleanly onto the 5-skill union) |
| 7 WHAT COULD PROVE ME WRONG? | ● (macro-invalidation conditions: hawkish pivot, DXY reversal) | ◐ (stablecoin supply contraction, TVL flight) | ● (positioning warnings: crowded longs, negative funding flips, F&G extremes) | ● (S/R breaks, indicator divergence as observable invalidation conditions) | ◐ (contrarian narratives) |
| 8 EVALUATE ACCORDING TO MY FRAMEWORK | ● if framework factors are macro | ● if DeFi/structure | ● if sentiment/positioning | ● if technical | ● if narrative — framework factors map onto skills dynamically (capability-before-tool; no fixed mapping) |

**Per-flow notes (evidence contributed / limitations / combinations):**
- **Flow 1:** news-briefing leads timeline reconstruction; cross-check timestamps against technical-analysis klines (exact timestamps available) — the two together satisfy the flow's timestamp-comparison requirement. Gap: intra-hour news granularity (RSS lag).
- **Flow 2:** the five skills naturally cover the architecture's candidate-cause map branches (macro / derivatives / news / technical / structure). Derivatives-liquidation evidence comes from sentiment-analyst's OI/funding/L/S — but note Bitget-exclusive `derivatives-structure` (basis/term structure) is not yet shipped; deeper derivatives evidence is a GAP (see §5).
- **Flow 5:** **weakest flow for Bitget-only.** Historical depth is shallow (14-day sentiment history, ~24-point rate history, 200-kline defaults). Serious precedent research needs external historical data.
- **Flow 6:** clean fit — the 5 skills ≈ the architecture's 10 data domains minus ONCHAIN-proper, REGULATION (news-only), and HISTORICAL.
- **All flows:** skill outputs supply observations and skill-authored interpretation; hypothesis ranking, contradiction resolution, falsification logic, and judgment remain the agent's job (architecture reasoning layers), not the Skills'.

## 5. Capability gaps → smallest reliable external set

Only genuine, verified gaps are listed. Bitget stays primary; externals are fallback/complementary.

| # | Verified gap | Why Bitget can't satisfy it | Minimal external capability | Status of recommendation |
|---|---|---|---|---|
| G1 | Deep historical datasets (multi-year OHLCV, historical funding/OI, past liquidation cascades) | Skill history windows are shallow (14d / ~24 points / 200 klines default) | Historical market-data provider (candidates exist; selection deferred) | RECOMMENDED — required by Flow 5 and serious Flow 2/7 work |
| G2 | Primary-source retrieval / general web search (on-chain forensics, regulatory filings, original articles, postmortems) | Skills aggregate RSS only; no open web retrieval | Web search + page-fetch capability | RECOMMENDED — required by Flow 2 branching and source-verification duties (SOURCE DISCOVERY & RETRIEVAL) |
| G3 | True on-chain intelligence (whale wallets, exchange reserves, unlocks, ETF flow figures) | Explicitly NOT available in market-intel (documented); only proxies | On-chain analytics provider (e.g., candidates in the skills ecosystem; selection deferred) | RECOMMENDED for ONCHAIN domain fidelity — or consciously accept proxy-level ONCHAIN evidence for the hackathon MVP and document the limitation |
| G4 | Regulation-specific structured information | News covers regulation narratively; no structured regulatory data | None for MVP — treat REGULATION as news-derived domain | RECOMMENDED to defer (not required to satisfy the architecture's domain at MVP depth) |
| G5 | Long-horizon monitoring/scheduling infrastructure | No verified scheduling capability in the ecosystem (agent-host dependent) | Runtime-host scheduling (cron/host-native), not an external SaaS | RECOMMENDED to implement in the runtime host, not an external provider |
| G6 | Persistent storage for research objects | Not a Bitget concern at all | Local/DB storage — implementation decision (UNRESOLVED question) | Implementation-layer, not a "provider" |

**Not gaps (Bitget sufficient):** macro context (macro-analyst), sentiment/positioning (sentiment-analyst), technical indicators (technical-analysis), news aggregation & search (news-briefing), DeFi/DEX/market structure (market-intel), public market data (Bitget public REST/MCP).

**External-provider selection is deliberately NOT finalized:** candidates exist for G1–G3 but choosing specific vendors is an implementation decision requiring a fresh capability/cost/auth comparison at build time. Marking specific vendor names here would present INFERRED as CONFIRMED — deferred to the human/next phase.

## 6. Provider/adapter implications (mapping to our architecture objects)

- Each of the 5 Skills becomes a **SKILL** object in the registry (per `tool-skill-orchestration.md`), backed by **TOOL** entries for the MCP tools each skill calls (`rates_yields`, `macro_indicators`, `cross_asset`, `global_assets`, `cn_market`, `global_data`, `tradfi_news`, `news_feed`, `social_trending`, `sentiment_index`, `derivatives_sentiment`, `crypto_market`, `defi_analytics`, `dex_market`, `network_status`) plus the Bitget public REST endpoints used by technical-analysis. Tool names above are CONFIRMED from skill files.
- **One shared transport** (public market-data MCP, HTTP) + one REST transport (public candles API) → the PROVIDER_ADAPTER layer should be implemented as: Skill adapters (per skill, normalizing output into TOOL_RESULT) over a small transport layer (MCP client; REST client). No per-provider logic in the research engine.
- **Classification map (skill output → evidence class):** technical-analysis ≈ raw computed observations; sentiment/market-intel/macro numeric sections ≈ observations; verdicts/templates/threshold interpretations and news narrative synthesis ≈ interpretation — must be recorded as such in the Evidence model (supporting the architecture's observation-vs-interpretation distinction).
- **Freshness profiles** to register per domain: economic data 1–2d lag; RSS 15–60 min; community ~15 min; market prices weekend-stale; TA = kline timestamp exact.
- **Failure handling** already aligns: skills fail with neutral "data temporarily unavailable" per source; per-feed errors are skipped — our adapters must record these as failed/partial TOOL_RESULTs (never silently fill), matching `failure-recovery.md`.
- **Extensibility:** planned Bitget-exclusive signals (`top-trader-flow`, `derivatives-structure`, `large-flow-detect`) slot into the same registry when shipped — no engine changes (validates the architecture's registration-based extensibility).

## 7. Implementation implications

1. Runtime agent host needs: Node ≥ 20 (installer/MCP), Python + pandas/numpy (technical-analysis), network access to the public MCP endpoint and `api.bitget.com`.
2. Install path: `npx @bitget-ai/bitget-signal --target all` for skill+MCP deployment in the agent host — but for a product runtime we more likely call the same MCP tools directly from our own orchestrator rather than depending on a specific AI host's skill directories. Both routes are open; decision belongs to the implementation phase.
3. No API keys are needed for the research layer. If account/position context is ever added (hackathon demo), that requires Bitget API keys via env vars only (never committed) — plus `--read-only`/paper-trading safeguards.
4. Rate-limit handling (client-side throttling) must be built before parallel skill fan-out is used in production research runs.
5. Evidence-provenance implementation must capture: skill name, MCP tool + action + parameters, raw response reference, retrieval timestamp — regardless of the skills' user-facing vendor-masking.

## 8. Risks

- **R1 — MCP backend dependency:** all four MCP-backed skills share one public endpoint; if it goes down, 4/5 research capabilities degrade simultaneously. Mitigation: fallback provider (G2 web retrieval + G1 historical data) and partial-output research behavior (already architectural).
- **R2 — Proxy evidence mislabeling:** market-intel's substitutes (news-derived "ETF flows", derivatives-derived "whale activity") could enter the evidence graph as if they were direct on-chain observations. Mitigation: adapter-level classification + explicit "proxy evidence" marking; skill files themselves instruct disclosing these gaps — we must preserve that in our TOOL_RESULT limitations.
- **R3 — Vendor-mask vs provenance tension:** user-facing vendor masking is fine; internal provenance masking would violate the architecture. Keep the two layers separate.
- **R4 — Shallow history:** Flow 5 (historical precedent) is Bitget-crippled; without G1 the flow produces weak research. Do not fake depth.
- **R5 — Ecosystem velocity:** package was renamed (`bitget-skill-hub` → `bitget-signal`) and restructured within recent months; more changes (new exclusive signals) are announced. Adapter layer must isolate these changes.
- **R6 — Rate limits unknown:** parallel fan-out (encouraged by the skills) may hit undocumented limits. Throttle + retry with backoff from day one.

## 9. Unresolved questions (for human decision / next phase)

1. **ONCHAIN domain strategy:** accept proxy-level on-chain evidence for MVP (documented limitation) vs integrate a dedicated on-chain provider (G3) — cost/complexity tradeoff. UNRESOLVED.
2. **Historical-data provider selection** (G1) — vendor choice deferred to implementation phase. UNRESOLVED.
3. **Web-retrieval provider selection** (G2) — same. UNRESOLVED.
4. **Persistence/storage technology** for research objects. UNRESOLVED (pre-existing).
5. **Model/provider choice** for the runtime agent (hackathon provides Qwen credits via a Bitget proxy base URL for registered teams; alternatively any provider). UNRESOLVED — note the model layer must remain replaceable per the architecture/handoff.
6. **Invocation route:** install skills into the coding-agent host vs call the public MCP tools directly from our own orchestrator. UNRESOLVED.
7. **LUI 5-action vs 6-action (SAVE) contradiction** — ~~needs human decision~~ **RESOLVED 2026-09-12 by human architecture lock:** the universal LUI action set is 6 actions (RESEARCH, ANALYZE, CHALLENGE, MANAGE_STATE, MONITOR, SAVE — SAVE first-class). Locked model defined in `docs/architecture/lui-universal-core.md` + `lui-save-action.md`; `lui-flow-extensions.md` amended. M3 therefore implements the 6-action model.

## 10. Recommended next implementation phase (proposal — requires human approval)

1. **M0 — Runtime skeleton:** research-object model persistence (in-memory + file store is fine for MVP), TOOL_RESULT ingestion, evidence-graph basics. No UI yet.
2. **M1 — Bitget adapter layer:** MCP transport + REST transport; 5 skill adapters producing classified, provenance-carrying TOOL_RESULTs; throttling + failure handling per `failure-recovery.md`.
3. **M2 — Single-flow E2E:** implement Flow 1 (WHAT HAPPENED?) end-to-end against the adapter layer, with judgment-first presentation. This validates the whole architecture path with the smallest surface.
4. **M3 — LUI core:** intent interpretation + universal actions (after the human resolves the 5-vs-6 question) + flow selection + MANAGE_STATE basics.
5. **M4 — Flows 2/6/7** (causal, synthesis, falsification) reusing M1–M3 machinery; then 3/4/8; Flow 5 once G1 (historical data) is chosen.
6. **M5 — Monitoring handoff + memory + workspace presentation** (trader-confirmed monitors, CURRENT vs HISTORICAL separation).
7. Throughout: model layer behind a replaceable interface; Bitget stays the primary capability source; externals only for G1/G2/(G3).

---

## Verification appendix

- Everything labeled CONFIRMED above cites: official GitBook hackathon docs; official GitHub repos `Bitget-AI/agent_hub`, `Bitget-AI/agent-skill`, `Bitget-AI/bitget-signal` (README, `llms.txt`, `CHANGELOG.md` v1.2.0 2026-05-29, `VERSION`, five `skills/*/SKILL.md` files) — retrieved 2026-09-12.
- Items labeled UNKNOWN could not be verified from official documentation accessible at research time (rate limits, historical archive depth, backend SLA, concurrent-call behavior).
- Items labeled INFERRED are conclusions drawn from official material without verbatim statements (e.g., "skills are composable" is explicit; "one shared transport" is inferred from the shared MCP endpoint documented across all five skill files).
- No capability was assumed from our architecture files; where architecture assumptions conflicted with verified reality, they are listed in §3 as needing modification.

**This report completes the research phase. No application implementation has been started. Awaiting human review and approval.**

---

## 7b. Live endpoint validation — M2 discoveries (2026-09-13)

M2 exercised the real endpoints. Everything below is **CONFIRMED by direct live observation** (not from docs) and supersedes assumptions where they conflict. Raw fixtures live in `tests/research/flow1.live.test.ts` and `tests/research/flow1.test.ts`.

| # | Discovery | Status | Consequence |
|---|-----------|--------|-------------|
| L1 | The MCP endpoint implements **streamable-HTTP MCP with sessions**: bare `tools/call` → HTTP 400 / JSON-RPC -32600 `Bad Request: Missing session ID`. Handshake: `initialize` → `mcp-session-id` response header → `notifications/initialized` (HTTP 202, empty body) → `tools/call` with the session header. `initialize` responds SSE-framed (`text/event-stream`) with `protocolVersion`, `serverInfo`, `capabilities` directly under `result`. | CONFIRMED (live) | M1's stateless-call assumption was wrong; `McpTransport` now handshakes lazily and re-handshakes when the server drops a session (treated as transient). |
| L2 | Server identity: `market-data-mcp` v1.26.0, protocol `2025-03-26`, **19 tools** (all FINDINGS.md names confirmed; also `crypto_price`, `crypto_derivatives`, `backtest`). | CONFIRMED (live) | Tool registry matches FINDINGS.md §2/§6; extras catalogued. |
| L3 | **Every tool requires an `action` enum argument.** M1's empty-args assumption returns `{"error": "Unknown action: "}` (e.g. `macro_indicators`, `global_data`, `crypto_market`); `news_feed` requires `action: "latest"|"sources"`. | CONFIRMED (live) | All MCP-backed adapters now map capability params → documented `action` args; M1's `{keywords}` arg for news was silently ignored. |
| L4 | `news_feed` args (live): `{ action, keyword? (case-insensitive title+summary filter), feeds?, limit? 1-10 default 5 }` — FINDINGS.md's `limit 1-50` was wrong; M1's `{keywords}` array did nothing (0 items). Response: one text block containing a **JSON array of `{ feed, error, items[{title, link, published, summary}] }`**; feed-level `error: ""` = OK. | CONFIRMED (live) | Adapter flattens to item-level outputs; feed errors → UNAVAILABLE outputs (PARTIAL completeness); `published` feeds event-time freshness. |
| L5 | Per-record error envelopes are common: `{"cpi": {"error": ""}}` (macro multi_indicator), `{"alt_me_error": ""}` (sentiment), `crypto_market {action:'global'}` returned `Error executing tool crypto_market: ConnectTimeout('')`. | CONFIRMED (live) | All-error objects now classify as UNAVAILABLE outputs (never observations); adapters surface PARTIAL/EMPTY with limitations. |
| L6 | The MCP server exposes a **working `technical_analysis` tool** (`rsi|macd|bollinger|ma|ema|atr|support_resistance|full_analysis|batch_analysis`; symbol format `BTC/USDT` **with slash**). | CONFIRMED (live) | technical-analysis now runs MCP-first; REST klines demoted to adapter-level fallback. |
| L7 | `technical_analysis` output mixes measurements (`rsi: 31.89`, macd values, S/R levels) with **skill-authored judgments** (`verdict: "STRONG BEARISH"`, `signal: "neutral"`, `trend: "bear"`, `bull_signals/bear_signals`, `suggested_stop: 76479.05`). Field ambiguity is type-dependent: `signal: "neutral"` is a judgment; `signal: -44.24` (MACD signal line) is a measurement. | CONFIRMED (live) | Adapter splits leaf-level: text `verdict/signal/trend/cross/position` → ANALYST_INTERPRETATION; numerics stay QUANTITATIVE_OBSERVATION; `suggested_stop`+tallies always judgment (lock §3 — never a trading recommendation). |
| L8 | `api.bitget.com` REST **connect-timeouts from this dev environment** (UND_ERR_CONNECT_TIMEOUT, repeated). Server-side, not code: 401-class failures would classify differently. | CONFIRMED (environment) | REST klines path is validated by fixtures + fallback tests; live REST validation is recorded as unreachable, not fabricated. |
| L9 | `news_feed` live (2026-09-13): 44 feeds returned, **0 items across all feeds, no feed-level errors** — an upstream data condition, not a transport failure. | CONFIRMED (live) | Flow 1 live run completes honestly as INSUFFICIENT_EVIDENCE; the pipeline records WHY and asserts nothing. |
| L10 | `derivatives_sentiment` has NO funding-rate action (actions: `reddit_trending, long_short, top_ls, top_position, open_interest, taker_ratio`). | CONFIRMED (live) | Funding context must come from other capabilities when needed; FINDINGS.md §2.3 wording refined. |

**Net effect on the evidence model:** no weakening. Every discovery is implemented as *tighter* classification (error envelopes → UNAVAILABLE, verdict fields → interpretation, feed errors → PARTIAL) or as provenance (session/server identity, fallback method limitations).

**Live validation results (2026-09-13):** `FREEBUFF_LIVE=1` suite — 5/5 pass. MCP handshake ✓, MCP tool calls ✓ (sentiment_index, technical_analysis, news_feed), REST ✗ unreachable from this environment (recorded honestly), Flow 1 end-to-end → INSUFFICIENT_EVIDENCE with full research structure + persistence ✓.
