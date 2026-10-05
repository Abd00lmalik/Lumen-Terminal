# Provider architecture — how Lumen chooses where data comes from

Status: **Heurist Mesh removed from the research path (2026-10-05)**; the findings that
justified its removal are preserved below, followed by the architecture that replaced it.

## 1. Why Heurist was removed

Heurist Mesh was a **credit-based agent marketplace**, not a model provider. Lumen registered
**12 adapters across 9 capabilities** against it at priority 300 (last-resort tier). Two facts
ended its use in this product:

1. **It was invoked several times per single research question.** The capability registry is
   failover, not fan-out — it stops at the first provider with real coverage — but each of the
   ~9–12 capabilities a causal run requests could independently fall through to a Heurist
   adapter. A run touching macro + derivatives + web search + cross-domain synthesis spent four
   agent calls; a run hitting the last-resort tier reached agents priced at **10 credits each**.
   That is a per-run cost multiplier attached to ordinary research questions.
2. **Its only provider for `CROSS_DOMAIN_SYNTHESIS` was a "buy a generated answer" service**, and
   the engine invoked it as an automatic *backstop* whenever the direct chain came up empty.
   A research workbench that purchases an answer instead of gathering evidence has stopped
   doing research.

The account's credits were exhausted. `HTTP 402 {"detail":"Insufficient credits"}` was the
visible symptom, but the architectural fault is the one above, and it would recur with any
paid agent in the same chain position.

### What Heurist was never good for

It also never offered model inference: no system prompts, no JSON-schema-constrained structured
output, no `ModelProvider` contract. Forcing it into the model layer would have been an
architecture violation. Its role was always **data/capability retrieval**, and that is the only
role its replacements take.

## 2. What replaced it

Nothing was swapped one-for-one, because Heurist covered nine capabilities and no single
replacement covers them. The migration mapped each capability to the best available source.

### The Bitget public data surface (no credential required)

The five Bitget Signal skills were **already integrated** (`src/adapters/bitget-skills.ts`) over a
streamable-HTTP MCP endpoint. Verified live 2026-10-05 against `market-data-mcp` v1.26.0:
`initialize` returns HTTP 200 and 19 tools **with no API key, account, secret or passphrase**.

| Capability | Provider | MCP tool | Live result |
|---|---|---|---|
| `MARKET_DATA_ANALYSIS`, `CRYPTO_MARKET_DATA` | `bitget-signal/market-intel` | `crypto_market` | OK |
| `TECHNICAL_ANALYSIS` | `bitget-signal/technical-analysis` | `technical_analysis` | RSI/MACD/BB verified |
| `NEWS_ANALYSIS` | `bitget-signal/news-briefing` | `news_feed` | OK (44 RSS feeds) |
| `MACRO_ANALYSIS` | `bitget-signal/macro-analyst` | `rates_yields`, `macro_indicators`, `cross_asset` | OK |
| `DERIVATIVES_ANALYSIS` | `fallback/public-derivatives` | public exchange REST | see §3 |
| `SOURCE_VALIDATION`, `EQUITY_FUNDAMENTALS` | `fallback/sec-edgar` | SEC EDGAR REST | see §3 |
| `ONCHAIN_ANALYSIS` | `bitget/keyless-research-surface` | `network_status` | gas/fees/mempool only |
| `DEFI_ANALYSIS` | `bitget/keyless-research-surface` | `defi_analytics` | DeFiLlama aggregates |
| `PROJECT_RESEARCH` | `bitget/keyless-research-surface` | `crypto_market` | public market metadata |

**Why the MCP transport rather than an npm package.** `bitget-agent-mcp`, `bitget-agent-sdk`,
`bitget-agent-cli` and `bitget-signal` target desktop AI hosts (a CLI client, a Claude Code /
Codex style MCP config). Lumen is a server with its own backend that already speaks this MCP
protocol directly, so a package would add a dependency and a process without adding capability.
The correct integration was the existing transport over the official public data surface.

### The two gaps, filled with keyless sources

| Formerly | Now | Why |
|---|---|---|
| `SecEdgarAgent` (0.2 cr) | `fallback/sec-edgar` | SEC EDGAR needs no credential at all — only an identifying `User-Agent`. Verified live: `company_tickers.json`, `submissions/CIK….json` and full-text search all return HTTP 200 with real data. Bitget has no SEC surface, so EDGAR is the whole answer. |
| `FundingRateAgent` (0.1 cr) | `fallback/public-derivatives` | Public exchange REST (funding history, open interest, long/short account ratio). No account, no key. |

### Capabilities deliberately withdrawn

Two capabilities had **no source at all** once the paid tier was gone. Rather than leave the
planner able to request a capability that can only return empty — the dead-end the
zero-dead-end conformance test exists to prevent — both were removed from the planner and
canonical vocabularies:

- **`CROSS_DOMAIN_SYNTHESIS`** — its only providers *purchased generated research answers*. A
  run must never buy an answer instead of gathering evidence, so this is now unreachable by
  design. Both deep-research backstops self-gate on `resolve("CROSS_DOMAIN_SYNTHESIS").length > 0`
  and therefore no longer fire.
- **`OPTIONS_CHAIN_ANALYSIS`** — no keyless source exists anywhere in the stack. Bitget exposes
  no options data and no other provider covers it.

Both names remain valid `CapabilityName` values in the domain vocabulary, so either returns the
day a real provider exists — with a provider, never before.

## 3. Known limitations (stated, not hidden)

- **`derivatives_sentiment` on the Bitget MCP is broken.** It is the tool nominally intended for
  funding rate / open interest / long/short, and it returns an empty `{"error":""}` after ~15s on
  every action (`open_interest`, `long_short`, `taker_ratio`, `top_ls`) — verified twice, four
  actions each. `fallback/public-derivatives` therefore reads the exchange REST API directly and
  does not depend on it.
- **`crypto_market` (CoinGecko) intermittently times out**; CoinGecko remains a market-data
  fallback behind the MCP primary.
- **`ONCHAIN_ANALYSIS` means public chain telemetry only** — gas, fees, mempool, recent blocks.
  It is **not** whale tracking, exchange reserves, token unlocks or ETF flows. This limitation
  travels with every output.
- **Perp venue data is venue-specific.** Binance and Bybit funding differ; the exchange is part
  of the observation, and the long/short ratio counts **accounts**, not notional size.

A provider failure is never evidence: when no source answers, the capability returns an honest
`EMPTY` carrying the full attempt trail, and a missing field is never rendered as a market fact.

## 4. The architecture that remains

```
USER
  ↓
CONVERSATIONAL CONTEXT  (investigation + prior turns — context, never evidence ownership)
  ↓
RESEARCH ROUTER         (requirement ledger → required evidence dimensions)
  ↓
CAPABILITY SELECTION    (capability-first; the planner never names a provider or tool)
  ↓
CAPABILITY REGISTRY     (priority-ordered failover; stops at the first real coverage)
  ↓
KEYLESS PROVIDER ADAPTERS  (Bitget MCP surface · SEC EDGAR · public exchange REST · RSS)
  ↓
NORMALIZED EVIDENCE     (observation / analysis classes preserved; lineage kept)
  ↓
HYPOTHESIS + COUNTEREVIDENCE
  ↓
SYNTHESIS → TRADER-FACING ANSWER
```

Bitget is a **data and specialized-analysis layer**. Lumen retains interpretation, conversational
continuity, requirement derivation, capability selection, provenance, hypothesis testing,
counterevidence search and synthesis. No provider is a single point of failure, and no provider
failure can corrupt investigation state.

## 5. Cost model after the change

Every capability in the research path is served by a **free, keyless** source. A research
question's external cost is now zero credits, and the failure mode that produced the credit
exhaustion — several paid agents invoked per run as fallbacks — cannot recur.