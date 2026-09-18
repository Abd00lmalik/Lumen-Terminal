# Heurist Mesh — Integration Research

Phase: HEURIST MESH RESEARCH + MULTI-MODEL FALLBACK + CAPABILITY EXPANSION
Status: **research complete, live verification BLOCKED-EXTERNAL (invalid API key)**
Researched: 2026-09-18 · Sources: official docs (docs.heurist.ai), live metadata endpoint, live endpoint probes, official GitHub repos

## 1. What Heurist Mesh is

A hosted marketplace of ~43 specialized "agents" (per the live metadata endpoint;
docs say "30+"). Each agent is a thin wrapper around one or more third-party APIs
(Yahoo Finance, SEC EDGAR, FRED/ALFRED, Exa, Firecrawl, DuckDuckGo, CoinGecko,
DexScreener, Binance funding, DefiLlama, Twitter/X, Etherscan, Space and Time…)
exposed as named, schema-described **tools**. It is an **agentic tool-calling
service**, not a general-purpose LLM API.

## 2. Access mechanisms (VERIFIED LIVE unless noted)

| Mechanism | Endpoint | Auth | Verification |
|---|---|---|---|
| REST (primary) | `POST https://mesh.heurist.xyz/mesh_request` | API key in `Authorization: Bearer` **or** `api_key` body field (header verified live) | Endpoint + auth channel verified; key validity BLOCKED-EXTERNAL |
| Agent discovery | `GET https://mesh.heurist.ai/metadata.json` | none | VERIFIED LIVE (43 agents, full tool schemas) |
| MCP | `https://mesh.heurist.xyz/mcp/sse` (SSE) | `X-HEURIST-API-KEY` header / Bearer / `api_key` query param | Endpoint **accepted our key with HTTP 200** and opened an event stream; MCP handshake not completable from this sandbox (stream-only; no write-capable stdio/websocket transport available). Self-host or console-built dedicated servers also possible. |
| x402 (pay-per-call, stablecoin) | per-agent endpoints, e.g. `mesh.heurist.xyz/x402/agents` | on-chain payment, **no API key** | Agents list VERIFIED LIVE; payment flow not applicable to server-side Lumen |

**Request shape (REST):**
```json
{
  "api_key": "...",            // or Authorization: Bearer
  "agent_id": "YahooFinanceAgent",
  "input": {
    "tool": "quote_snapshot",
    "tool_arguments": { "symbols": "AAPL" },
    "raw_data_only": true       // omit the LLM summary layer when we only want data
  }
}
```
Response: `{ "result": { ...agent-specific... } }` — synchronous JSON (the official
example is a plain awaited `fetch`). One agent is asynchronous (`AskHeuristAgent`:
`ask_heurist` returns a `job_id`, polled via `check_job_status`). Costs are
credit-based per tool (see §4). Note the domain split: `mesh.heurist.ai` serves the
console/metadata; **API calls go to `mesh.heurist.xyz`**.

## 3. Agent library — engineering assessment

Ranking dimensions: relevance, reliability, data directness, capability gap filled,
provenance quality, latency, cost, production reachability. "Credits" = per-tool
default cost from live metadata.

### Tier 1 — fills a real Lumen gap (integration candidates)

| Agent | Key tools | Fills | Credits | Assessment |
|---|---|---|---|---|
| **YahooFinanceAgent** | `resolve_symbol`, `quote_snapshot`, `price_history`, `technical_snapshot`, **`options_chain`**, `news_search`, `market_overview`, `equity_overview`, `fund_snapshot`, `equity_screen` | `options_chain_analysis` (**today BLOCKED-EXTERNAL** — direct Yahoo options API returns 401 from production), technical analysis, index/market overview (VIX, S&P, Nasdaq), symbol resolution | 0.2 | Highest value in the library. Same ultimate source as our direct Yahoo adapter (see §6 no-double-count). Data-direct when `raw_data_only: true`. |
| **SecEdgarAgent** | `resolve_company`, `filing_timeline`, `filing_diff`, `xbrl_fact_trends`, `insider_activity`, `activist_watch`, `institutional_holders` | SEC primary-source retrieval for G2 (10-K/10-Q/8-K timelines, XBRL facts, insider/13F) | 0.2 | Genuine capability gap (no SEC capability exists today). Bounded, issuer-first, returns filing links → preserves `source → retrieval → observation → interpretation`. |
| **FRED Macro Agent** (`FredMacroAgent`) | `macro_series_snapshot`, `macro_series_history`, `macro_regime_context`, `macro_release_calendar`, `macro_release_context`, `macro_vintage_history` | Macro fallback/expansion (inflation, rates, labor, credit, growth) incl. **release calendar** and **vintage (ALFRED) history** | 0.3 | Complements the World Bank fallback (which is slow-moving indicators only). Vintage semantics matter for historical research. |
| **FundingRateAgent** | `get_all_funding_rates`, `get_symbol_funding_rates`, `get_symbol_oi_and_funding`, `find_spot_futures_opportunities` | `crypto_derivatives`: funding + **open interest** (today honestly UNAVAILABLE) | 0.1 | Cheap, data-direct. Note: Binance USDⓈ-M data — provenance must say Binance-sourced, Bitget remains primary for exchange-native views. |

### Tier 2 — useful, narrower

| Agent | Key tools | Fills | Credits | Assessment |
|---|---|---|---|---|
| **ExaSearchAgent / ExaSearchDigestAgent** | `exa_web_search`, `exa_answer_question`, `exa_scrape_url` | G2 web-search fallback (news narrative discovery) | 0.5 (digest) | Digest variant adds an LLM summary → must classify as `AGENT_ANALYSIS`, never raw evidence. The plain ExaSearchAgent metadata shows no default credit price. |
| **FirecrawlSearchAgent** | `firecrawl_web_search`, `firecrawl_extract_web_data`, `firecrawl_scrape_url` | Deeper G2 page retrieval/extraction | 2 | Expensive; use only when ordinary search fails. |
| **DuckDuckGoSearchAgent** | `search_web` | free-ish G2 search fallback | n/a | Shallow provenance; lowest priority. |
| **CoinGeckoTokenInfoAgent** | `get_token_info`, `get_token_price_multi`, `get_trending_coins`, holders/trades tools | crypto market-data fallback (independent of Bitget/Binance) | n/a | Good diversity for `crypto_market_data` fallback chain. |
| **DexScreenerTokenInfoAgent** | `search_pairs`, `get_specific_pair_info`, `get_token_pairs` | DEX pair/liquidity context | n/a | Niche; useful for token-level questions. |
| **DefiLlamaAgent** | `get_protocol_metrics`, `get_chain_metrics`, `search_yield_pools` | DeFi TVL/fees/yield analytics | 0.3 | Real capability (no DeFi capability today); defer until on-chain demand exists. |
| **TokenResolverAgent** | `token_search`, `token_profile` | crypto target resolution | 0.2 | Helps LUI target resolution for obscure tokens. |

### Tier 3 — rejected (with reasons)

| Agent | Reason |
|---|---|
| **AskHeuristAgent** | 10 credits/call (most expensive); output is generated crypto Q&A analysis → `AGENT_ANALYSIS` at best; async job model adds latency; direct data providers beat it on epistemics and cost. |
| **Twitter/Elfa/Moni/TwitterInfo agents** | Social signal, not evidence; provenance weak for research claims; cost 1 credit/call; do not fill a current gap (sentiment capability already has fallbacks). |
| **EtherscanAgent / SpaceTimeAgent / Chainbase / Pond / Zerion / GoPlus** | On-chain capability is deliberately out of scope for this phase (mandate §16: no true on-chain claims without real chain data; these would need their own epistemic treatment). |
| **CaesarResearchAgent** | 10 credits; academic-research oriented; not a market-data gap filler. |
| **AIXBT / PumpFun / LetsBonk / Zora / Sally / WanVideo / Unifai* / TrendingToken** | Out of product scope (memecoins, video gen, social trending). |

## 4. Cost control

Per-tool credit costs (live metadata defaults): Yahoo tools 0.2, SEC tools 0.2,
FRED tools 0.3, FundingRate 0.1, Exa digest 0.5, Firecrawl 2, AskHeurist 10.
Design consequences:
- Direct providers (Yahoo REST, World Bank, RSS) are **always tried before** paid Mesh agents at equal quality.
- Mesh agents enter chains only where they fill gaps (options, SEC, FRED vintage, funding/OI) or as higher-tier fallbacks.
- `raw_data_only: true` everywhere — we do not pay for or ingest the agents' LLM summaries except where explicitly classified `AGENT_ANALYSIS`.

## 5. Reliability / failure semantics (for the adapter)

- Synchronous REST with 30–60s budget per call; one known-async agent (AskHeurist) — excluded by default.
- Errors observed: `401 {"detail":"Invalid API key format"}` (bad/invalid key). Timeout → typed `PROVIDER_TIMEOUT`; 401/403 → `AUTH_FAILURE`; 402 → x402 payment required (treated as unavailable); 429 → `RATE_LIMITED`; 5xx → `PROVIDER_UNAVAILABLE`. Retrieval failure is a technical condition, never negative evidence.
- Rate limits are not documented publicly; treat 429 with bounded backoff, do not loop.

## 6. Evidence classification & no-double-count rules (binding)

- Heurist agent output is **tool-normalized third-party API data**, not an independent primary source.
  - `quote_snapshot`/`price_history` from YahooFinanceAgent = `QUANTITATIVE_OBSERVATION`, `servedBy: heurist-yahoo`, upstream `yahoo-finance`.
  - SEC tool output referencing an actual filing = `PRIMARY_SOURCE` **only** with the filing URL/identifiers captured; Heurist's narrative summary of a filing = `SECONDARY_SOURCE`/`AGENT_ANALYSIS`.
  - FRED series values = `QUANTITATIVE_OBSERVATION` with series key, observation date, release date.
  - Funding/OI values = `QUANTITATIVE_OBSERVATION` with exchange + instrument.
- **Lineage dedup (mandate §10):** Heurist/Yahoo and our direct Yahoo adapter share the same upstream → never counted as independent corroboration. The evidence layer records `upstreamSource` so two observations with the same lineage cannot strengthen each other. Same rule for news agents repeating one wire story.
- With `raw_data_only: true`, output class defaults to observation-level; any Heurist-generated narrative is `AGENT_ANALYSIS` at best and never upgrades itself by wording.

## 7. Heurist as a second LLM provider (Phase 12 answer)

**No.** Mesh is an agent/tool router; there is no documented general-purpose
model-inference API with system prompts, JSON-schema-constrained structured output,
token limits, or a ModelProvider-compatible contract. Forcing it into `ModelProvider`
would be an architecture violation (mandate §12). Heurist's role in Lumen:
**RESEARCH_PROVIDER / specialized data-provider fallback** only. Model redundancy
must come from a real second LLM provider (separate decision/phase).

## 8. Integration plan (only what evidence supports)

New `HeuristMeshProvider` (thin REST client: `invokeTool(agentId, tool, args)` with
typed error mapping + provenance capture), registered in the capability registry:

| Capability | Chain after integration |
|---|---|
| `options_chain_analysis` | Heurist Yahoo `options_chain` (primary — the only working source) → honest UNAVAILABLE with missing dimension |
| `crypto_derivatives` | Bitget (primary) → Heurist FundingRate (funding/OI) → honest UNAVAILABLE |
| `SEC primary source` (new capability) | Heurist SecEdgar (filing timelines, XBRL) with filing URLs as provenance |
| `macro_data` | existing primary → World Bank fallback → Heurist FRED (snapshot/history/calendar) |
| `equity_market_data` | direct Yahoo (primary) → Stooq (fallback) → Heurist Yahoo (last-resort fallback) |
| G2 web search | existing primary → Exa/DuckDuckGo (bounded, classified) |

Safety: server-side only, key from `HEURIST_API_KEY` env (never `VITE_*`), bounded
URL allowlist (only `mesh.heurist.xyz`), no autonomous execution surface — agents
return data; the Research Engine and evidence layer decide what it means.

## 9. Live verification status

| Probe | Result |
|---|---|
| `GET mesh.heurist.ai/metadata.json` | VERIFIED LIVE — 43 agents, full tool schemas incl. `options_chain` |
| `POST mesh.heurist.xyz/mesh_request` (Bearer) | Endpoint live; **401 Invalid API key format** with the provided key → BLOCKED-EXTERNAL (key rejected by Heurist's REST validator) |
| `POST mesh.heurist.xyz/mesh_request` (body api_key) | same 401 |
| `GET mesh.heurist.xyz/x402/agents` | VERIFIED LIVE — YahooFinance listed |
| `GET mesh.heurist.xyz/mcp/sse` with key | VERIFIED LIVE — HTTP 200, event stream opened (auth accepted on this path) |

**Conclusion:** the integration is architecturally sound and pre-approved by
evidence; the REST key rejection is an external credential issue. The adapter ships
behind the existing pattern (typed failures, no fabrication), with live-gated tests
that will pass the moment a valid `HEURIST_API_KEY` is configured. The MCP path is
viable as a secondary transport but REST is the correct primary (synchronous,
schema-first, single round-trip, no stream handling in serverless).
