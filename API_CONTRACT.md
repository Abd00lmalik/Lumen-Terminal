# API_CONTRACT.md; F0 API boundary contract

**Status:** implemented and tested (`tests/api/`). This document describes only what the code actually provides. Aligned with `FRONTEND_ARCHITECTURE.md` §3–§9.

**Base URL (dev):** `http://127.0.0.1:3001` (env: `API_PORT`, `API_HOST`). **CORS (dev):** localhost origins `:5173` / `:4173` only; a development convenience, no production security claim. **Auth:** none at F0; single local trader identity derived **server-side** (never from client payloads).

**Hard rules baked into the surface:**
- The client sends **natural language only**; never a flow name or action. Flow classification is internal LUI routing (the locked six actions remain the action model).
- Gemini and Bitget are reachable **only inside the API process**. No key appears in any response or event.
- The only endpoints that mutate persistent state directly are the **explicit SAVE/UNSAVE of a saved artifact** (`POST /api/saved`, `DELETE /api/saved/:savedId`): a trader's deliberate action, resolved against the real graph and confirmed only after the write succeeds. Everything else goes through a boundary: natural-language SAVE and memory promotion run through the LUI authorization boundary; thesis selection goes through the domain (`setActiveThesis`); monitor activation goes through the domain's trader-confirmation boundary.

## Saved workspace (Phase C)

HISTORY is everything Lumen researched; SAVED is exactly what the trader chose to keep. No completed run is auto-saved.

- `kind` is a closed vocabulary: `RESEARCH | JUDGMENT | EVIDENCE | INSIGHT | WATCH_NEXT`.
- Every artifact retains its origin: `researchRef` (the originating run) plus `sourceRef` (the exact originating judgment/evidence ref, `insight`, or `watch_<index>`). An origin-less saved fact is never created by this endpoint.
- **Identity / idempotency:** `researchRef` + `kind` + `sourceRef`. Saving the same artifact twice returns the same `savedId` (updated in place; never an uncontrolled duplicate). Title/question text is not identity.
- **DTOs:** library rows are `SavedItemSummaryDTO` (no body dump); `GET /api/saved/:savedId` returns `SavedItemDTO` with `content`, `snapshot`, `derivedFromRefs`, `provenance[]` and `origin` (question/date/`recordTier`/`degraded`/`available`). Internal workspace structures are never leaked.
- **Failure semantics:** a failed write returns `500 PERSISTENCE_FAILURE` and rolls back the in-memory mutation; the response never claims "saved" unless the durable write actually succeeded. Unsave records a tombstone so a stale instance's later merge cannot resurrect the artifact.
- **Read freshness:** `GET /api/saved` and `GET /api/saved/:savedId` refresh the Saved collection from the durable store before answering (a warm serverless instance can otherwise serve a library that omits another instance's SAVE/UNSAVE). Idempotency therefore also holds across instances: the same identity SAVEd on two instances converges on one `savedId`. The refresh is scoped to Saved; a transient store read failure degrades to local state rather than failing the read.
- There is **no trading/execution endpoint**; the workbench is research-only.
- **No background monitoring exists.** Monitor state is persistent handoff representation only.

---

## Endpoints

| Method | Path | Purpose | Errors |
|---|---|---|---|
| GET | `/api/health` | API process availability only. Never claims provider health, monitoring activity, or trading. |; |
| POST | `/api/session` | Bootstrap a session; returns the continuity snapshot. |; |
| GET | `/api/workspace` | Current continuity snapshot (safe DTO). | 404 if no session |
| POST | `/api/research` | Submit a natural-language research request. `?stream=1` → SSE. | see error model |
| GET | `/api/research` | Research history: ONE lightweight entry per RUN, newest first, windowed/filterable (`?limit&offset&sort=recent|oldest&status&q`). Explicit `isCurrent` status. | 400 bad window / 404 if no session |
| GET | `/api/research/:ref` | The run AGGREGATE (see §"History list + run aggregate"): research object fields + the retained response surface + provenance/timestamps/saved/thesis associations + honest `recordTier`. | 404 |
| GET | `/api/evidence` `/api/evidence/:ref` | Evidence with epistemic class/freshness preserved. | 404 |
| GET | `/api/claims` | Claims. | 404 if no session |
| GET | `/api/hypotheses` | Hypotheses with ranking/status. | 404 if no session |
| GET | `/api/judgments` | Judgments with confidence/uncertainty/implications. | 404 if no session |
| GET | `/api/thesis` | All theses with `isActive`. | 404 if no session |
| GET | `/api/thesis/:ref` | Thesis + full assessment history. | 404 |
| POST | `/api/thesis/select` | Set the active thesis (working state via the domain; persisted). Body: `{"thesisRef": string}`. | 400 / 404 |
| GET | `/api/assessments?thesisRef=` | Assessment history (optionally per thesis). | 404 if no session |
| GET | `/api/memory` | Memory entries with explicit `status` (CURRENT/STALE/HISTORICAL). | 404 if no session |
| GET | `/api/artifacts` | Saved artifacts (SAVE products; legacy continuity surface). | 404 if no session |
| GET | `/api/saved` | Saved library: ONE row per kept artifact, newest first, windowed/filterable (`?limit&offset&sort=recent|oldest&kind&q`). | 400 bad window/kind / 404 if no session |
| GET | `/api/saved/:savedId` | One saved artifact + its provenance/origin context. | 404 |
| POST | `/api/saved` | Explicit SAVE. Body `{researchRef, kind, sourceRef?, tags?, rationale?}`. Idempotent per originating artifact. | 400 / 404 / 500 PERSISTENCE_FAILURE |
| DELETE | `/api/saved/:savedId` | Explicit UNSAVE. Removes only the saved artifact; the original research is untouched. | 404 / 500 PERSISTENCE_FAILURE |
| GET | `/api/monitors` | Monitors grouped by lifecycle: `proposals` / `active` / `paused` / `stale` / `completed`. | 404 if no session |
| POST | `/api/monitors/:ref/activate` | Activate a monitor through the domain's trader boundary (local single-trader MVP). Still no background worker. | 400 / 404 |

### POST /api/research

Request:
```json
{ "message": "What is affecting BTC right now?", "confirmed": false }
```
- `message` (required, string, ≤8000 chars). `confirmed` (optional boolean) mirrors the frontend's explicit confirmation dialog for consequential steps (SAVE / monitor activation). **Without it, gated steps persist nothing**; the response is `AWAITING_CONFIRMATION`.

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
  "limitations": ["…"],                     // provider failures/partial data; NEVER negative evidence
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

### History list + run aggregate (Phase B, 2026-09-25)

**List (`GET /api/research`)** returns `ResearchRunSummaryDTO[]` — one entry per research RUN (a submission's internal plan-step research objects are grouped under the run's answer-bearing object, exposed as `internalRefs`). A row is deliberately lightweight (question, status, `createdAt`/`updatedAt` from provenance, `confidence`, `questionResolutionStatus`, `insightPreview`, `judgmentPreview`, `saved`, `degraded`, `isCurrent`) — never an object dump.

- `limit` (default 50, max 200), `offset`, `sort` (`recent` default → newest first, or `oldest`), `status` (exact, plus `CURRENT` for the active run), `q` (case-insensitive substring over question/objective). Invalid values (`limit=0`, `limit=999`, `limit=abc`, `offset=-1`, `sort=sideways`) are a typed **400**, never a silently different list.
- Only research objects are listed: a monitor/other ref can never appear, so `GET /api/research/mon_…` is a typed 404.

**Aggregate (`GET /api/research/:ref`)** is the ONE call the run view needs; the frontend does not stitch list + workspace + evidence + judgments.

- `researchRef` is ALWAYS the ref the request was made with (list and open can never disagree).
- When the run's presentation record is retained, the aggregate carries the full response surface: `answer`, `limitations`, `researchGaps`, `researchDiagnostics` (disclosure), `evidence[]`, `judgments[]`, `evidenceRefs`, `judgmentRef`.
- Hoisted presentation fields: `questionResolution`, `actionableInsight`, `watchNext`, `confidence`, `stoppedBecause` (= the completion gate), `causalLinks`, `weakestCausalLink`.
- Run-level: `createdAt`/`updatedAt`, `isCurrent`, `provenance[]`, `saved` (a SAVE artifact derives from this run), `thesisAssessments[]` (assessments whose `researchRef` is this run), `summary { evidenceCount, claimCount, hypothesisCount, judgmentCount }`.
- **Honest reconstruction tier:** `recordTier` = `FULL` (record retained; `degraded: false`) | `JUDGMENT` (legacy pre-record run: the answer is its real persisted judgment) | `SUMMARY` (only the research object remains — the question, status and provenance are shown and NO answer/judgment is fabricated). `degraded` = `recordTier !== "FULL"`.

## SSE stream (`POST /api/research?stream=1`)

`text/event-stream`; named events only; `progress`, `final`, `error`. Progress events are emitted at **actual application lifecycle transitions** (threaded from the engine's optional progress listener; nothing fabricated):

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

**Client law (2026-09-25):** a stream that ENDS without any terminal event (e.g. the serverless function killed at the platform limit) is reported as a lost connection, not left spinning — the client emits exactly one terminal signal per run (`final`, `error`, or connection-lost) and the UI says the completed research object, if any, is reachable from Research history.

## Error model

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_REQUEST` | 400 | malformed/empty input |
| `NOT_FOUND` | 404 | unknown route or object ref |
| `AWAITING_CONFIRMATION` | 409 | consequential step halted; nothing persisted (also surfaced as `outcome: AWAITING_CONFIRMATION` in the research response) |
| `MODEL_FAILURE` | 503 | interpretation layer unavailable **when the engine itself cannot proceed**; in-request typed model failures return 200 with `outcome: MODEL_FAILURE` + `modelFailure` (never fabricated evidence) |
| `PERSISTENCE_FAILURE` | 500 | store failed; never reported as success |
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
- Flow 5 (`HAS_THIS_HAPPENED_BEFORE`) is intentionally unavailable; never fabricated.

## Explicit non-goals (this surface)

No trading/order/execution/transfer/leverage endpoints (the registry structurally exposes no such capability). No arbitrary memory/artifact/thesis write endpoints. No auth (future migration step). No WebSocket (SSE suffices; the event vocabulary carries over). No fake real-time or polling semantics for monitors; clients refresh manually.
