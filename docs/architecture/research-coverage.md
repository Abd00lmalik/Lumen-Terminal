# Research Coverage Matrix

> **Superseded provider chains.** This matrix predates the 2026-10-05 removal of the paid Heurist
> Mesh tier (every "Heurist …" fallback below no longer exists) and the withdrawal of
> `CROSS_DOMAIN_SYNTHESIS` and `OPTIONS_CHAIN_ANALYSIS` from the planner vocabulary.
> [`capability-matrix.md`](capability-matrix.md) is the maintained source of truth for who serves
> each capability today; the rows naming removed capabilities are corrected in place below.

Zero-dead-end mandate (§28): for every major research domain, who serves it, what the
fallback chain is, and the honest verification status. Labels: **VERIFIED LIVE** (exercised
against the real provider/production), **VERIFIED DETERMINISTICALLY** (deterministic tests),
**PARTIALLY VERIFIED**, **BLOCKED-EXTERNAL**, **UNVERIFIED**.

Architecture laws that hold for every row: the research engine requests CAPABILITIES; the
capability registry resolves providers (primary → specialized fallback → search/research
fallback → synthesis fallback); no flow ever names a provider; a provider failure is never
negative evidence; duplicate underlying sources never become independent corroboration;
agent-generated analysis is never classified as direct observation; no fabrication.

| Domain | Capability | Primary | Fallback chain (in order) | Status |
|---|---|---|---|---|
| Crypto market data | MARKET_DATA_ANALYSIS | Bitget market-intel (MCP) | CoinGecko public (keyless) → Heurist CoinGeckoTokenInfo | VERIFIED LIVE (CoinGecko served ZEC/BTC in production 2026-09-18) |
| Crypto technicals | TECHNICAL_ANALYSIS | Bitget/ETA klines | Heurist YahooFinanceAgent technical_snapshot | PARTIALLY VERIFIED |
| Crypto news | NEWS_ANALYSIS | Bitget news-briefing | equity/yahoo-headlines → fallback/news-rss (CoinDesk/Cointelegraph) → Heurist search tier | VERIFIED LIVE |
| Crypto sentiment | SENTIMENT_ANALYSIS | Bitget sentiment-analyst | fallback/fear-greed (alternative.me; PROXY) | VERIFIED LIVE |
| Crypto derivatives | DERIVATIVES_ANALYSIS | fallback/public-derivatives (Bybit/Binance public REST; keyless) | — | VERIFIED DETERMINISTICALLY (the Bitget MCP derivatives tool returns an empty error; the Heurist FundingRateAgent tier was removed 2026-10-05) |
| On-chain | ONCHAIN_ANALYSIS | Heurist EtherscanAgent | Heurist CoinGeckoTokenInfoAgent (holders/large trades) | VERIFIED DETERMINISTICALLY (adapter); live subject/address resolution required for real chains |
| DeFi / L2 | DEFI_ANALYSIS | Heurist DefiLlamaAgent | Heurist L2BeatAgent | VERIFIED DETERMINISTICALLY; BLOCKED-EXTERNAL pending live probes (credit-based) |
| Equity market data | EQUITY_MARKET_DATA | Yahoo v8 chart (any ticker; gold/oil/FX/index names resolve) | Stooq daily CSV (adapter-level) → Heurist YahooFinanceAgent | VERIFIED LIVE |
| Equity fundamentals | EQUITY_FUNDAMENTALS | Yahoo quoteSummary (kind-tagged: HISTORICAL_ACTUAL/ESTIMATE/DERIVED_METRIC) | Heurist YahooFinanceAgent | VERIFIED LIVE |
| Earnings | EARNINGS_CALENDAR (alias EQUITY_EARNINGS) | Yahoo calendarEvents | — | VERIFIED LIVE |
| Equity news | EQUITY_NEWS | Yahoo per-ticker RSS | registry-level NEWS_ANALYSIS failover | VERIFIED LIVE |
| Options | (removed) — no structured chain provider | — | — | UNAVAILABLE: no keyless source exists; `OPTIONS_CHAIN_ANALYSIS` was removed from the planner vocabulary 2026-10-05, and the OPTIONS evidence domain now maps to `WEB_SEARCH` discovery |
| Macro | MACRO_ANALYSIS | Bitget macro-analyst | World Bank indicators → Heurist FredMacroAgent | VERIFIED LIVE |
| Web search / discovery | WEB_SEARCH | G2 bounded discovery (primary-source-bounded) | Heurist ExaSearchAgent → Heurist DuckDuckGoSearchAgent | VERIFIED LIVE (G2); agents VERIFIED DETERMINISTICALLY |
| Source validation | SOURCE_VALIDATION | G2 web retrieval | Heurist SecEdgarAgent (filing timelines, XBRL) | VERIFIED LIVE (G2) |
| Historical analogues | HISTORICAL_COMPARISON | G1 (Bitget → Binance Vision mirror; no look-ahead) | — | VERIFIED LIVE |
| Project research | PROJECT_RESEARCH | Heurist ProjectKnowledgeAgent | Heurist DexScreenerTokenInfoAgent | VERIFIED DETERMINISTICALLY; BLOCKED-EXTERNAL pending live probes |
| Cross-domain synthesis | CROSS_DOMAIN_SYNTHESIS | none (deliberately) | — | WITHDRAWN 2026-10-05: its providers purchased generated answers; a run never buys an answer instead of gathering evidence (see capability-matrix.md) |
| Local knowledge | LOCAL_KNOWLEDGE_RETRIEVAL | Workspace artifacts/memories/frameworks (trader-owned; provenance + staleness labeled) | — | VERIFIED DETERMINISTICALLY |

## Genuine external limitations (not manufactured)

- Bitget REST/MCP upstreams time out from the Vercel network (their side); the fallback
  chains above carry every affected capability, and failures stay typed technical conditions.
- Heurist Mesh is credit-based; specialized agents are registered as fallback/secondary
  tiers so normal research does not spend credits, and deep-research agents fire only when
  the direct chain produced no coverage.
- Whale/exchange-reserve/token-unlock/ETF-flow figures: no legitimate free provider; never
  fabricated; proxy evidence (where used) is labeled PROXY with its basis.
- On-chain questions require a resolvable address/contract; a token name alone cannot be
  converted into an address without a resolver, and none is currently registered.

Last full update: 2026-09-18 (zero-dead-end + local-knowledge phase).
