# Capability Matrix

The complete capability landscape of Lumen Terminal: what exists, who serves it, what it
cannot do. The research engine requests CAPABILITIES; the capability registry resolves
providers (primary first, fallback next). No flow ever names a provider.

Verification labels: **VERIFIED LIVE** (real endpoint probed from this environment),
**VERIFIED DETERMINISTICALLY** (adapter under test with scripted transport),
**UNVERIFIED** (exists but not yet exercised), **BLOCKED-EXTERNAL** (upstream blocked).

## Capability matrix

| CAPABILITY | DOMAIN | PRIMARY PROVIDER | FALLBACK PROVIDER(S) | DATA TYPES | FRESHNESS | HISTORICAL DEPTH | AUTH | STATUS | KNOWN LIMITATIONS |
|---|---|---|---|---|---|---|---|---|---|
| MARKET_DATA_ANALYSIS | crypto market structure | bitget-signal/market-intel (MCP) | none (honest UNAVAILABLE) | DeFi/chain TVL, stablecoin supply, DEX activity, rankings | minutes | none | none (server-side) | VERIFIED LIVE | ETF flows/whale/positioning are news/derivatives PROXIES with proxyBasis; NOT on-chain |
| TECHNICAL_ANALYSIS | crypto technical | bitget-signal/technical-analysis (MCP indicators) | REST klines (Bitget v2 candles, same adapter) | OHLCV, 23 indicators | interval-exact | 200 klines default | none | VERIFIED LIVE | indicators are computed observations, never trading recommendations |
| SENTIMENT_ANALYSIS | crypto sentiment | bitget-signal/sentiment-analyst (MCP) | fallback/fear-greed (alternative.me F&G) | F&G, L/S positioning, OI, taker flow | community | none | none | VERIFIED LIVE | F&G fallback is a SENTIMENT_SIGNAL proxy; funding/OI never invented |
| NEWS_ANALYSIS | news (crypto + equity) | bitget-signal/news-briefing (MCP, 44 feeds) | fallback/news-rss (CoinDesk/Cointelegraph); equity/yahoo-headlines (per-ticker) | headlines, timelines, narrative | 15-60 min | feed archive | none | VERIFIED LIVE | secondary reporting; per-feed errors skip that feed (PARTIAL) |
| MACRO_ANALYSIS | macro | bitget-signal/macro-analyst (MCP) | fallback/world-bank (US CPI/GDP) | rates, CPI/PCE, yields, DXY/VIX | 1-2 day release lag | annual (WB) | none | VERIFIED LIVE | WB fallback is annual-lag STALE; monthly series out of coverage |
| HISTORICAL_COMPARISON | historical OHLCV | g1/historical-data (Bitget REST primary, Binance Vision fallback) | - | daily+ OHLCV | exact timestamps | multi-year | none | VERIFIED LIVE | funding/OI/liquidations UNAVAILABLE (no real provider); Flow 5 episode analysis derives features only at anchor time |
| SOURCE_VALIDATION | web/primary sources | g2/web-retrieval (bounded, SSRF-guarded) | - | extracted page content, source class | retrieval-time | - | none | VERIFIED LIVE | snippets are not authoritative evidence; source ≠ evidence |
| EQUITY_MARKET_DATA | equities | equity/yahoo-chart (Yahoo v8) | Stooq daily CSV (inside adapter); registry-level: none yet | quote, OHLCV, volume, change % | session-close | provider range (1mo default) | none (browser UA) | VERIFIED LIVE | delayed, not real-time; no pre/post-market split; symbol must resolve |
| EQUITY_FUNDAMENTALS | equities | equity/yahoo-quote-summary | none | revenue, margins, cashflow, marketCap, shares, valuation | latest reported/quarterly | latest snapshot | cookie+crumb handshake | VERIFIED LIVE | fields carry kind (HISTORICAL_ACTUAL/ESTIMATE/DERIVED_METRIC); analyst targets are ESTIMATE |
| EARNINGS_CALENDAR | equities | equity/yahoo-earnings-calendar | none | next/last earnings dates, consensus EPS range | quarterly | 1 call date + last call | cookie+crumb handshake | VERIFIED LIVE | reported-EPS history not provided; isEarningsDateEstimate carried verbatim |
| EQUITY_NEWS | equities | equity/yahoo-headlines (per-ticker RSS) | registry-level: any NEWS_ANALYSIS provider | headlines | minutes | feed archive | none | VERIFIED LIVE | secondary reporting; company announcements need primary-source confirmation |
| EVENT_RECONSTRUCTION | causal | engine-composed (news + timeline capabilities) | - | derived | - | - | - | PARTIAL | composed from news capabilities; no dedicated event DB |
| CAUSAL_INVESTIGATION | causal | engine-composed | - | derived | - | - | - | PARTIAL | causality is never asserted from correlation; LUI boundary |
| ONCHAIN_ANALYSIS | on-chain | none | none | - | - | - | - | UNAVAILABLE | no real on-chain provider; proxies stay PROXY_EVIDENCE (never labeled on-chain) |
| DERIVATIVES_ANALYSIS | derivatives | none (crypto) | none | - | - | - | - | UNAVAILABLE | funding/OI/liquidations have no real provider; never invented |
| FALSIFICATION | thesis challenge | engine-composed (news + falsification planning) | - | derived | - | - | - | PARTIAL | disconfirming evidence sought via NEWS/HISTORICAL capabilities |
| CROSS_DOMAIN_SYNTHESIS | synthesis | engine-composed | - | derived | - | - | - | PARTIAL | Flow 6 composition; no new data source |
| OPTIONS_CHAIN_ANALYSIS | options | none | none | - | - | - | - | BLOCKED-EXTERNAL | Yahoo options endpoint requires crumb-protected v7 API currently returning 401; capability returns honest UNAVAILABLE, never synthesized IV/strikes |

## Provider reachability

Tracked per provider as `LOCAL_ONLY | PRODUCTION_REACHABLE | PRODUCTION_BLOCKED | UNKNOWN`.
Bitget MCP has been PRODUCTION_BLOCKED from some networks; the fallback chain exists
exactly for that case, and the registry records `attemptedProviders` when it happens.

## Rules this matrix obeys

1. The registry owns selection; flows request capabilities only (final lock §6/§11).
2. A serving fallback never erases the primary's failure (attemptedProviders trail).
3. Provider failure is technical, never negative evidence.
4. Estimates are never presented as actuals (kind field on fundamentals/earnings).
5. Missing capability = honest UNAVAILABLE with the exact missing dimension.
