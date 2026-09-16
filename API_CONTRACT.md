# API_CONTRACT.md — F0 API boundary contract

**Status:** implemented and tested (`tests/api/`). This document describes only what the code actually provides. Aligned with `FRONTEND_ARCHITECTURE.md` §3–§9.

**Base URL (dev):** `http://127.0.0.1:3001` (env: `API_PORT`, `API_HOST`). **CORS (dev):** localhost origins `:5173` / `:4173` only — a development convenience, no production security claim. **Auth:** none at F0 — single local trader identity derived **server-side** (never from client payloads).

**Hard rules baked into the surface:**
- The client sends **natural language only** — never a flow name or action. Flow classification is internal LUI routing (the locked six actions remain the action model).
- Gemini and Bitget are reachable **only inside the API process**. No key appears in any response or event.
- There is **no endpoint that mutates memory/artifacts/theses directly**. SAVE runs through the LUI authorization boundary; thesis selection goes through the domain (`setActiveThesis`); monitor activation goes through the domain's trader-confirmation boundary.
- There is **no trading/execution endpoint** — the workbench is research-only.
- **No background monitoring exists.** Monitor state is persistent handoff representation only.

---

## Endpoints

| Method | Path | Purpose | Errors |
|---|---|---|---|
| GET | `/api/health` | API process availability only. Never claims provider health, monitoring activity, or trading. | — |
| POST | `/api/session` | Bootstrap a session; returns the continuity snapshot. | — |
| GET | `/api/workspace` | Current continuity snapshot (safe DTO). | 404 if no session |
| POST | `/api/research` | Submit a natural-language research request. `?stream=1` → SSE. | see error model |
| GET | `/api/research` | Research history with explicit `isCurrent` status. | 404 if no session |
| GET | `/api/research/:ref` | One research object. | 404 |
| GET | `/api/evidence` `/api/evidence/:ref` | Evidence with epistemic class/freshness preserved. | 404 |
| GET | `/api/claims` | Claims. | 404 if no session |
| GET | `/api/hypotheses` | Hypotheses with ranking/status. | 404 if no session |
| GET | `/api/judgments` | Judgments with confidence/uncertainty/implications. | 404 if no session |
| GET | `/api/thesis` | All theses with `isActive`. | 404 if no session |
| GET | `/api/thesis/:ref` | Thesis + full assessment history. | 404 |
| POST | `/api/thesis/select` | Set the active thesis (working state via the domain; persisted). Body: `{"thesisRef": string}`. | 400 / 404 |
| GET | `/api/assessments?thesisRef=` | Assessment history (optionally per thesis). | 404 if no session |
| GET | `/api/memory` | Memory entries with explicit `status` (CURRENT/STALE/HISTORICAL). | 404 if no session |
| GET | `/api/artifacts` | Saved artifacts (SAVE products). | 404 if no session |
| GET | `/api/monitors` | Monitors grouped by lifecycle: `proposals` / `active` / `paused` / `stale` / `completed`. | 404 if no session |
| POST | `/api/monitors/:ref/activate` | Activate a monitor through the domain's trader boundary (local single-trader MVP). Still no background worker. | 400 / 404 |

### POST /api/research

Request:
```json
{ "message": "What is affecting BTC right now?", "confirmed": false }
```
- `message` (required, string, ≤8000 chars). `confirmed` (optional boolean) mirrors the frontend's explicit confirmation dialog for consequential steps (SAVE / monitor activation). **Without it, gated steps persist nothing** — the response is `AWAITING_CONFIRMATION`.

Response (`ResearchResponseDTO`):
```json
{
  "requestId": "uuid",
  "action": "RESEARCH",                     // one of the locked six (model-interpreted)
  "outcome": "COMPLETED | AWAITING_CONFIRMATION | REJECTED | MODEL_FAILURE",
  "answer": {
    "answer": "…",                          // L0 answer card
    "supportingReasons": ["…"],
    "opposingReasons": ["…"],
    "confidence": "HIGH | MODERATE | LOW | UNKNOWN",
    "keyUncertainty": "…",
    "implication": "…",
    "citedObjectRefs": ["ev_…", "jd_…"]     // validated refs only; invented citations dropped by the LUI
  },
  "modelFailure": { "type": "PROVIDER_UNAVAILABLE", "message": "…" },   // when applicable
  "limitations": ["…"],                     // provider failures/partial data — NEVER negative evidence
  "researchRef": "rs_…",
  "evidenceRefs": ["ev_…"],
  "judgmentRef": "jd_…",
  "evidence": [ { "ref": "ev_…", "observation": "…", "evidenceType": "…",
      "evidenceClass": "RAW_DATA | OBSERVATION | DERIVED_OBSERVATION | INTERPRETATION | PROXY_EVIDENCE | SPECULATION",
      "proxyBasis": "…",                    // PROXY_EVIDENCE only
      "freshness": "CURRENT | STALE | HISTORICAL",
      "observedAt": "ISO", "eventTimestamp": "ISO",
      "sourceRefs": ["…"], "toolResultRef": "tr_…", "supports": ["cl_…"], "contradicts": ["cl_…"] } ],
  "judgments": [ { "ref": "jd_…", "statement": "…", "confidence": "…",
      "uncertainty": ["…"], "implications": ["…"], "unresolvedQuestions": ["…"],
      "supportingEvidence": ["…"], "opposingEvidence": ["…"], "keyClaims": ["…"], "hypotheses": ["…"],
      "status": "…"} ]
}
```

## SSE stream (`POST /api/research?stream=1`)

`text/event-stream`; named events only — `progress`, `final`, `error`. Progress events are emitted at **actual application lifecycle transitions** (threaded from the engine's optional progress listener; nothing fabricated):

| Stage | Meaning |
|---|---|
| `request_accepted` | message received |
| `intent_understood` | validated interpretation (action name only) |
| `target_resolved` | workspace-grounded target resolution done |
| `ambiguity_checked` / `consequence_checked` / `safety_checked` | pipeline gates evaluated |
| `plan_created` | validated action plan ready (`steps` count) |
| `step_started` | plan step dispatched (`stepIndex`, `action`) |
| `research_plan_created` | living research plan created (`tasks` count) |
| `capability_started` / `capability_completed` | real capability execution (`capability`, `completeness` or `failureType`) |
| `research_round_completed` | adaptive round done (`round`, `decision`) |
| `research_stopped` | loop ended (`reason`) |
| `response_ready` | final response assembled |

Terminal event: `final` (the `ResearchResponseDTO`) or `error` (the `ApiErrorDTO`). No event ever contains model reasoning, prompts, raw provider payloads, or secrets.

## Error model

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 | malformed/empty input |
| `NOT_FOUND` | 404 | unknown route or object ref |
| `AWAITING_CONFIRMATION` | 409 | consequential step halted; nothing persisted (also surfaced as `outcome: AWAITING_CONFIRMATION` in the research response) |
| `MODEL_FAILURE` | 503 | interpretation layer unavailable **when the engine itself cannot proceed**; in-request typed model failures return 200 with `outcome: MODEL_FAILURE` + `modelFailure` (never fabricated evidence) |
| `PERSISTENCE_FAILURE` | 500 | store failed — never reported as success |
| `INTERNAL_ERROR` | 500 | sanitized; no stack traces/paths/env |

Shape: `{ "error": { "code": string, "message": string, "confirmation"?: { "stepIndex": number, "reason": string } } }`.

## Identifiers

`rs_` research · `ev_` evidence · `cl_` claim · `hyp_` hypothesis · `an_` analysis · `jd_` judgment · `br_` branch · `th_` thesis · `thv_` thesis version · `ass_` assessment · `art_` artifact · `mem_` memory · `mon_` monitor · `tr_` tool result · `src_` source.

## Epistemic statuses (data, never client-derived)

- Evidence class: `RAW_DATA | OBSERVATION | DERIVED_OBSERVATION | INTERPRETATION | PROXY_EVIDENCE | SPECULATION` (+ `proxyBasis` when proxy).
- Freshness: `CURRENT | STALE | HISTORICAL` (on evidence and tool results).
- Memory status: `CURRENT | STALE | HISTORICAL` (+ `statusReason`); STALE/HISTORICAL must render demoted, never merged into current.
- Monitor lifecycle: `PROPOSED | ACTIVE | PAUSED | STALE | COMPLETED`; condition kinds `INVALIDATION | EARLY_WARNING` (never merged); source states `OK | SOURCE_UNAVAILABLE` (a state, never an invalidation alert).
- Assessment status: `SUPPORTED | WEAKENED | MATERIALLY_CHALLENGED | UNSUPPORTED | INDETERMINATE`; `researchQuality` (STRONG/MIXED/WEAK/UNAVAILABLE) is a **separate field** from `confidence` (quality ≠ confidence).
- Flow 5 (`HAS_THIS_HAPPENED_BEFORE`) is intentionally unavailable — never fabricated.

## Explicit non-goals (this surface)

No trading/order/execution/transfer/leverage endpoints (the registry structurally exposes no such capability). No arbitrary memory/artifact/thesis write endpoints. No auth (future migration step). No WebSocket (SSE suffices; the event vocabulary carries over). No fake real-time or polling semantics for monitors — clients refresh manually.
