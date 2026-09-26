# Model provider runbook

Operational guide for the model layer (`src/model/`). It records the ACTUAL diagnosed
production failure classes, the typed diagnostic record, and how to verify/fix them without
touching research semantics.

## 1. Architecture in one paragraph

The LUI and the research engine depend on a single provider-neutral seam,
`ModelProvider.structured()` (`src/model/provider.ts`). `api/research.ts` builds a
`ModelFallbackProvider` whose chain is **Gemini first, Groq second** (Groq only when
`GROQ_API_KEY` is present). The fallback triggers on TECHNICAL failures only
(`PROVIDER_UNAVAILABLE`, `RATE_LIMITED`, `TIMEOUT`, `INVALID_OUTPUT`, `EMPTY_OUTPUT`,
`UNKNOWN`); a genuine safety refusal is never bypassed. Every response is validated against a
schema before any caller may act on it. Provider failures are typed `ModelFailure` values and
are never fabricated into an answer, never become evidence, and never reduce a thesis's
validity.

## 2. Typed failure taxonomy

| Type | Meaning | Retriable | Fallback-eligible |
|---|---|---|---|
| `PROVIDER_UNAVAILABLE` | 5xx / network outage | yes | yes |
| `AUTH_FAILURE` | missing/invalid credentials | no | no (skipped for the request) |
| `RATE_LIMITED` | 429; per-day quota buckets fail fast | rate-shape yes / daily no | yes |
| `PAYLOAD_TOO_LARGE` | **HTTP 413: request body exceeds the provider's accepted size** | **no** | yes (next provider still tried) |
| `INVALID_OUTPUT` | response failed schema/structural validation | no | yes |
| `TIMEOUT` | request exceeded the deadline | yes | yes |
| `EMPTY_OUTPUT` | response had no usable content (a safety refusal stays distinct) | no | yes unless safety refusal |
| `UNKNOWN` | unclassified | no | yes |

## 3. Typed diagnostic record

### D-1: Gemini `PROVIDER_UNAVAILABLE`

| Field | Value |
|---|---|
| PROVIDER | Google Gemini (`google/gemini`) |
| MODEL | `gemini-3.5-flash-lite` (configurable via `GEMINI_MODEL`) |
| REQUEST CLASS | LUI structured interpretation / planning / synthesis |
| FAILURE TYPE | `PROVIDER_UNAVAILABLE` |
| HTTP STATUS | 5xx (500/503) or a network-level failure |
| UPSTREAM MESSAGE CLASS | service unavailable / overloaded |
| RETRYABILITY | retriable: adapter retries 3× with 1.5s exponential backoff, then falls back |
| LIKELY ROOT CAUSE | transient upstream 5xx / free-tier capacity; NOT a code or credential defect |
| CONFIDENCE IN DIAGNOSIS | medium-high (typed mapping is deterministic; the precise upstream code is not observable at the time of writing) |
| RECOMMENDED FIX | none required while transient; the daily-quota 429 path already fails fast and honestly |
| VERIFICATION METHOD | `POST /api/research?stream=1` with a minimal question; terminal SSE event must be a real answer or an honest `MODEL_FAILURE` |

### D-2: Groq `HTTP 413`

| Field | Value |
|---|---|
| PROVIDER | Groq (`groq`) |
| MODEL | `openai/gpt-oss-120b` (configurable via `GROQ_MODEL`) |
| REQUEST CLASS | fallback for the SAME structured request Gemini received |
| FAILURE TYPE | was `UNKNOWN` (413 fell through the mapper); now `PAYLOAD_TOO_LARGE` |
| HTTP STATUS | 413 |
| UPSTREAM MESSAGE CLASS | request entity too large |
| RETRYABILITY | no (a size condition does not improve on retry) |
| LIKELY ROOT CAUSE | the request body (system prompt + rendered research context from `renderResearchContext`) exceeds Groq's accepted request size for this model; the fallback resends the identical payload |
| CONFIDENCE IN DIAGNOSIS | medium (413 is unambiguously a size rejection; the exact byte threshold depends on Groq's tier) |
| RECOMMENDED FIX | **bounded adapter fix applied** — 413 maps to `PAYLOAD_TOO_LARGE` with a clear, key-free message and no retry. A payload-TRIMMING fix was deliberately NOT applied: truncating the context at the fallback boundary would change what the model sees, i.e. research semantics, which are frozen. |
| VERIFICATION METHOD | `tests/model/model-fallback.test.ts` (413 → `PAYLOAD_TOO_LARGE`, non-retriable, no secret/body leak) and `POST /api/research?stream=1` on production |

## 4. Current status (2026-09-26, Phase D)

The outage observed during Phases B/C (Gemini `PROVIDER_UNAVAILABLE` + Groq `HTTP 413`) is
**not reproducible** as of this writing: a minimal production run completed and persisted
(`POST /api/research?stream=1` → `COMPLETED`, listed as `rs_000242`). The failure classes above
remain the correct readings of the earlier evidence, and the Groq typing fix is permanent.

## 5. What never to do

- Never weaken evidence requirements, completion gates, confidence, or persistence to work
  around a provider failure.
- Never fabricate an answer, evidence, or a research completion when a provider fails.
- Never treat a provider failure as evidence against a thesis.
- Never log, print, or commit credentials (`GEMINI_API_KEY`, `GROQ_API_KEY`). Error messages
  are key-free by construction; keep them that way.

## 6. Debugging procedure

1. `GET /api/health` — process availability and which keys are DEFINED (never their values).
2. `POST /api/research?stream=1` with a short question and watch the `progress` events: a
   failure before `intent_understood` is a model/credential problem; a failure after
   `capability_started` is a data/capability problem.
3. Read the terminal `error` event: the typed `code`/`type` names the failure class above.
4. For 413, inspect the size of the prompt/context builders (`src/research/context.ts`); for
   429, check whether it is a per-day bucket (`RATE_LIMITED` non-retriable) or per-minute.
5. For `AUTH_FAILURE`, confirm the env var exists in the deployment (never echo it).
