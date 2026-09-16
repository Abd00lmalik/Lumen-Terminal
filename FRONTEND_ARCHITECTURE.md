# FRONTEND_ARCHITECTURE.md; M6 Frontend Product Architecture (design only; not implemented)

**Purpose:** define the frontend MVP that exposes the existing M0–M5 research engine as one coherent product. The frontend exposes the system; it never invents a second product architecture, never duplicates backend logic, and never calls model/provider APIs directly.

---

## 1. Recommended stack and rationale

| Choice | Rationale (grounded in repository inspection) |
|---|---|
| **Vite + React 18 + TypeScript (strict)** | The entire backend is strict-mode TypeScript with `NodeNext` ESM. A TypeScript-first SPA shares the **view-model types** (section 9) directly with the engine's domain types; zero drift. Vite keeps the build minimal; no framework migration risk. |
| **No state-management library**; React Query (TanStack Query) + local React state | The backend owns all research state (single WorkspaceStore). The frontend is a **view/cache layer**, not a state authority. React Query gives caching, refetch, and loading/error semantics out of the box. Redux/Zustand would create a second state model; explicitly forbidden. |
| **Plain CSS / CSS modules with a small design-token file** | Design principles call for information-dense, professional, calm. A token file (typography scale, status colors for evidence classes / freshness / memory status) is sufficient; a component library would fight the evidence-density requirements. |
| **Native `fetch` + a thin typed API client** | No GraphQL/gRPC; the API boundary (section 3) is small and typed. |
| **React Router** | Screen inventory (section 13) is URL-addressable: workspace, thesis, memory, monitors are distinct surfaces users revisit. |

**No new framework is required.** Anything heavier (Next.js SSR, Angular, Svelte) adds constraints the backend does not need; the MVP is a desktop-first client of one API.

## 2. Directory structure

```
frontend/
  src/
    api/                    # typed client: request/response types mirror engine DTOs
      client.ts             # fetch wrapper, error normalization
      types.ts              # view-model + DTO types (re-exported from engine where possible)
      hooks/                # React Query hooks per resource (research, thesis, memory, monitors)
    app/                    # shell: nav, layout, routes, providers
    screens/
      workspace/            # Research workspace (primary)
      basis/                # Research basis (evidence/claims, progressive disclosure)
      history/              # Research history
      thesis/               # Thesis workspace
      challenge/            # Challenge results
      framework/            # Framework evaluation
      memory/               # Saved artifacts + memory status
      monitors/             # Monitor proposals/state
    components/
      evidence/             # EvidenceItem, ClassBadge, FreshnessBadge, ProxyNotice, LimitationBanner
      disclosure/           # DisclosureLevel, ExpandableEvidence, ProvenanceTrail
      research/             # AnswerCard, ConfidenceMeter, UncertaintyList, PlanTimeline
      common/               # StatusChip, EmptyState, ErrorState, ConfirmationDialog
    styles/tokens.css       # status colors: evidence classes, freshness, memory CURRENT/STALE/HISTORICAL
  tests/                    # vitest + testing-library; MSW for API fixtures
```

## 3. Backend/API boundary

The engine today is an **in-process TypeScript API** (`Lui.handle`, `runFlow*`, `reassessThesis`, `Workspace`). The MVP adds the smallest possible seam:

**F0 introduces a thin Node HTTP layer (Fastify) inside the existing repo** (`apps/api/` or `src/api/`; decided at F0 by repo conventions) that wraps the engine:

| Route | Method | Purpose | Engine call |
|---|---|---|---|
| `/api/session` | POST/GET | workspace/session identity | Workspace load/create via WorkspaceStore |
| `/api/research` | POST | natural-language request (SSE stream of progress + final) | `Lui.handle` |
| `/api/research/:ref` | GET | a research object + its graph at disclosure levels | workspace read |
| `/api/thesis` | GET/PATCH | active thesis, revision (PATCH = consequential, confirmed) | workspace thesis methods |
| `/api/assessments` | POST | reassessment trigger | `reassessThesis` |
| `/api/memory` | GET | memory + artifacts with status | workspace memory methods |
| `/api/memory/save` | POST | SAVE (confirmed) | LUI SAVE dispatch |
| `/api/monitors` | GET/POST | monitor list; propose/activate (POST = confirmed) | workspace monitor methods |
| `/api/frameworks` | GET | saved frameworks | saved artifacts (type `framework`) |

**Rules:**
- The API layer contains **no business logic**; it validates transport input, calls the engine, maps domain objects to DTOs, and enforces the same confirmation/origin rules the LUI enforces (origin is derived from the authenticated session concept, stubbed as a fixed trader identity until auth exists).
- **Gemini stays server-side.** The key exists only in the API process env. The browser never sees it and never talks to Google.
- **Bitget stays server-side.** Adapters/transports are never imported by frontend code.
- Raw TOOL_RESULT payloads and full provenance are exposed only through a dedicated deep-disclosure endpoint that strips nothing the architecture already marks safe, and never includes env/config.

## 4. State management approach

- **Server state = the only state that matters.** React Query caches DTOs keyed by workspace/session; research mutations invalidate affected queries.
- **Optimistic updates only for harmless UI state** (expanded panels, active disclosure level). All consequential actions (SAVE, MANAGE_STATE, monitor activation, thesis revision) use explicit request → response → refetch; the UI reflects **what the engine actually persisted**, never what the UI hoped.
- Confirmation dialogs are part of the request payload flow (the backend's confirmation boundary remains the authority).

## 5. Workspace/session model

- One browser tab = one workspace session. Session bootstrap (`GET /api/session`) returns the continuity snapshot (`getContinuitySnapshot()` already exists; the domain was built for this).
- No client-side session storage of research data beyond the query cache; refresh always re-recovers from persisted state (Scenario: context recovery works from persistence, not conversation memory).

## 6. Request lifecycle

1. User submits natural-language input.
2. `POST /api/research` opens an **SSE stream**: named progress events (`interpretation → planning → capability:news-briefing → evidence → synthesis → judgment → response`) map 1:1 to the audited request lifecycle, so progress is **real**, not decorative (no fake "AI thinking" animations).
3. Terminal event carries the progressive-disclosure response (L0) + refs for deeper levels.
4. Errors arrive as typed events (`model_failure`, `research_failure`, `tool_failure`, `awaiting_clarification`, `awaiting_confirmation`) and render distinctly; the UI never converts a failure into a fake success.

## 7. Loading/progress model

- Every capability execution becomes a progress line with its real capability name and completion state (COMPLETE/PARTIAL/EMPTY/FAILED). Failed/partial capabilities render as **limitations**, not spinners-forever.
- A research run is cancellable at the HTTP layer only (backend request abort); no pretend cancellation of in-flight adapter calls.

## 8. Error model

| Backend condition | UI representation |
|---|---|
| `awaiting_clarification` | clarification question with explicit "state untouched" notice |
| `awaiting_confirmation` | confirmation dialog naming the exact consequence |
| `model_failure` | "interpretation layer unavailable" banner; preserved state still viewable |
| `research_failure` / tool limitations | limitations list with epistemic note (never negative evidence) |
| `insufficient_evidence` | honest completion state, not an error |
| transport/network | retry affordance; no fabricated data |

## 9. Research-object view models

DTOs map 1:1 to domain objects with **epistemic status preserved as data**, never flattened:

- `EvidenceVM { ref, class: OBSERVATION|DERIVED_OBSERVATION|PROXY_EVIDENCE|SPECULATION|RAW_DATA, freshness, proxyBasis?, sourceRefs, supports, contradicts }`
- `ClaimVM`, `HypothesisVM { status, ranking }`, `JudgmentVM { confidence, uncertainty }`
- `ThesisVM { version, status, claims, assumptions, invalidationConditions, assessments[] }`; revision controls rendered only from the backend's confirmation contract
- `MemoryVM { category, status: CURRENT|STALE|HISTORICAL, lastValidatedAt }`; STALE/HISTORICAL render visually demoted (muted + explicit status chip)
- `MonitorVM { lifecycle: PROPOSED|ACTIVE|PAUSED|STALE|COMPLETED, conditions: {kind: INVALIDATION|EARLY_WARNING}[], sourceState: OK|SOURCE_UNAVAILABLE }`; with a persistent explainer: "persistent state only; no background worker is running"
- `FlowOutcomeVM` per flow type (causal ladder for Flow 2, factor statuses for Flow 3, disagreement types for Flow 6, falsification targets for Flow 7, criterion rows for Flow 8)

The API layer owns this mapping; the frontend never re-derives epistemic status.

## 10. Progressive disclosure model

L0 answer card is always rendered first: answer/judgment, 2–4 strongest reasons, strongest opposition, confidence, key uncertainty, implication. Levels L1 (why) → L2 (evidence) → L3 (research structure: plan/hypotheses) → L4 (provenance/source trail) → L5 (full history) are progressive-expansion states over the same object refs; deeper levels lazy-fetch from the deep-disclosure endpoint. The model's reasoning is never rendered; only research objects, evidence, and decision-relevant rationale exist in the payload.

## 11. Responsive strategy

Desktop-first three-pane (nav / content / evidence-detail). ≤1024px: panes collapse to stacked sections with an evidence drawer. ≤640px: single column, disclosure levels become accordions. Information density degrades gracefully; nothing is hidden that changes the meaning of a judgment.

## 12. Component hierarchy

```
AppShell
 ├─ SessionNav (workspace, thesis, memory, monitors)
 └─ ScreenRouter
     ├─ ResearchWorkspace
     │   ├─ AskInput (NL input, clarification/confirmation intercepts)
     │   ├─ ProgressTimeline (real capability events)
     │   └─ AnswerCard → DisclosureLevels → EvidenceDetail (drawer)
     ├─ ResearchBasis (EvidenceItem[] grouped by class; LimitationBanner; ProxyNotice)
     ├─ ResearchHistory (ResearchObjectList → ResearchDetail)
     ├─ ThesisWorkspace (ThesisHeader, ClaimList, AssessmentHistory, RevisionControl*)
     ├─ ChallengeWorkspace (FalsificationTargetList, MaterialityBadge, ContradictionList)
     ├─ FrameworkEvaluation (CriterionRow[]: satisfied/unsatisfied/partial/insufficient + evidenceNeeded)
     ├─ MemoryScreen (SavedArtifacts | MemoryList with status demotion)
     └─ MonitorsScreen (MonitorCard[] with lifecycle + SOURCE_UNAVAILABLE states + explainer)
```

## 13. Screen inventory

1. **Research workspace** (default); NL input, active target, answer, confidence, uncertainty, limitations, disclosure levels.
2. **Research basis**; full evidence/claims with epistemic badges; unavailable sources listed as limitations.
3. **Research history**; prior research objects, lifecycle, outcomes.
4. **Thesis workspace**; active thesis, version, claims/assumptions/invalidation conditions, assessment history, latest assessment, guarded revision control.
5. **Challenge workspace**; belief under challenge, falsification targets, evidence sought, materiality, unresolved questions.
6. **Framework evaluation**; saved framework, per-criterion rows, evidence per criterion, insufficient-evidence requirements.
7. **Saved artifacts & memory**; artifacts separate from memory; CURRENT/STALE/HISTORICAL explicitly.
8. **Monitoring**; proposals/active/paused/stale/completed, early-warning vs invalidation, source-unavailable, "no background worker" explainer.

## 14. Data-fetching strategy

- React Query: session + continuity snapshot on load; research mutations stream via SSE then invalidate; deep-disclosure endpoints fetched lazily per expansion; monitors/memory polled **manually** (refresh button); **no fake real-time polling**, since no monitoring worker exists.
- All fixtures for frontend tests come from the deterministic backend fixtures (no invented data in charts; no chart exists in the MVP unless it plots actual klines fetched through the API).

## 15. Security boundaries

- Gemini API key: API process env only; never shipped, never fetched, never logged by the API layer.
- Bitget: server-side only through the existing transports.
- CORS locked to the app origin; no cookies/storage carry credentials.
- The API layer re-enforces origin/confirmation rules (defense in depth with the LUI), so a crafted browser request cannot bypass the trader boundary.
- Raw provenance endpoint excludes env/config/paths; snapshot responses are DTO-mapped, never raw internal state dumps.

## 16. MVP scope

Screens 1–8 as listed; L0–L2 disclosure fully interactive (L3–L5 read-only views); SSE progress; clarification/confirmation dialogs; memory/monitor/thesis/assessment views; typed error/limitation rendering. **Out of MVP:** auth (single local trader identity), multi-user, live charts, notifications, settings.

## 17. Explicit non-goals (frontend)

- No trading/execution/order UI of any kind; no portfolio view.
- No fake real-time data, no invented charts, no "AI thinking" theatrics.
- No chain-of-thought rendering; no presenting model text as evidence.
- No client-side business logic (evidence classification, confirmation rules, epistemic status all come from the backend).
- No implying background monitoring exists.

## 18. Migration path from MVP to production

1. **Auth:** session identity is already an explicit seam (`origin`); swap the stub for real auth + per-user workspaces.
2. **Persistence:** WorkspaceStore file backend → DB backend behind the same store interface (the M0 persistence seam).
3. **Monitoring:** when workers exist, add a `/api/monitors/events` stream; the UI contract (section 9 MonitorVM) already anticipates trigger states.
4. **Deployment:** split `apps/api` and `frontend` builds; API keeps model/provider keys; add rate limiting at the API edge.
5. **Streaming:** SSE → WebSocket only if bi-directional needs appear; the event vocabulary stays the same.
