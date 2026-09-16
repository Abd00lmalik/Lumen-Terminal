# FRONTEND_IMPLEMENTATION_PLAN.md; M6 Implementation Plan (milestones only; not implemented)

**Companion to** `FRONTEND_ARCHITECTURE.md`. Milestones are ordered by dependency; each is independently verifiable and ends with a green deterministic suite. No milestone begins until the previous one's acceptance criteria pass.

---

## F0; Application/API boundary

- **Goal:** expose the in-process engine over HTTP without moving any business logic.
- **Files/modules:** `apps/api/` (or `src/api/` per repo conventions): server bootstrap (Fastify), route modules, DTO mappers, SSE endpoint, error-mapping middleware, session-stub (single local trader identity).
- **Backend requirements:** none new; wraps `Lui.handle`, flow runners, `reassessThesis`, workspace reads/writes, WorkspaceStore persistence. Re-derives `origin` server-side; enforces confirmation rules independently (defense in depth).
- **Frontend components:** none yet (API-only milestone).
- **State/data:** session bootstrap returns `getContinuitySnapshot()` DTO.
- **Acceptance criteria:** every existing deterministic test still passes untouched; new API integration tests cover: research POST → SSE events → final response; confirmation-required SAVE without confirmation persists nothing; monitor POST without trader confirmation stays PROPOSED; unknown-ref mutations rejected; no route can reach Gemini or Bitget except through the engine.
- **Tests:** API integration tests (deterministic fakes, no network); DTO round-trip tests.

## F1; App shell and research workspace

- **Goal:** a running app with navigation and the primary research screen rendering a real L0 answer.
- **Files:** `frontend/` scaffold (Vite + React + TS strict), app shell, `ResearchWorkspace`, `AnswerCard`, `ConfidenceMeter`, `UncertaintyList`, `LimitationBanner`, API client + session hook.
- **Backend requirements:** F0.
- **Frontend components:** SessionNav, AskInput, ProgressTimeline, AnswerCard.
- **State/data:** session query; research mutation with SSE progress.
- **Acceptance criteria:** user submits "What is affecting BTC right now?" against the deterministic fake provider stack and sees: real progress lines (capability names), L0 answer with confidence/uncertainty/limitations; no chat-bubble-only layout; failures render as limitation banners.
- **Tests:** component tests with MSW fixtures derived from backend deterministic fixtures; a11y smoke (landmarks, labels).

## F2; Natural-language research interaction

- **Goal:** full request lifecycle UX: clarification, confirmation, compound requests.
- **Files:** AskInput enhancements, `ClarificationDialog`, `ConfirmationDialog`, error-event mapping.
- **Backend requirements:** `awaiting_clarification` / `awaiting_confirmation` typed events (already exist as LUI states; verify F0 exposes them as SSE events).
- **Frontend components:** ClarificationDialog (renders the backend's question verbatim; no client-side re-interpretation), ConfirmationDialog (names the exact consequence).
- **State/data:** pending-interaction state tied to the in-flight request; state untouched notice.
- **Acceptance criteria:** ambiguous consequential request → dialog, and the UI shows "nothing changed yet"; unconfirmed SAVE → nothing persisted (visible in memory screen); execution-like input → typed rejection surface, never an attempted action.
- **Tests:** scenario-mirroring integration tests (Scenarios 2/5/8 fixtures).

## F3; Progressive research results and evidence views

- **Goal:** research basis with faithful epistemic rendering; L0→L5 disclosure.
- **Files:** `ResearchBasis`, `EvidenceItem`, `ClassBadge`, `FreshnessBadge`, `ProxyNotice`, `DisclosureLevels`, `ProvenanceTrail`, deep-disclosure fetch hook.
- **Backend requirements:** deep-disclosure endpoint (F0 route with level param).
- **Frontend components:** grouped-by-class evidence list (observations / derived / interpretations / proxy / unavailable-as-limitations), opposition vs support split.
- **State/data:** disclosure level state; lazy fetch per level.
- **Acceptance criteria:** every evidence item shows class + freshness (+ proxyBasis when proxy); interpretations never render with observation styling; unavailable sources appear under limitations; fabricated citations impossible (refs come from validated backend data only).
- **Tests:** badge-rendering matrix per evidence class; disclosure lazy-load tests.

## F4; Research history and persistence views

- **Goal:** revisit prior research objects and their lifecycle.
- **Files:** `ResearchHistory` screen, `ResearchObjectList`, `ResearchDetail`.
- **Backend requirements:** history listing routes over workspace objects (F0).
- **Acceptance criteria:** past research loads from persisted state after refresh (no conversation memory); each entry shows outcome, confidence, and links into basis/provenance views.
- **Tests:** history navigation tests; refresh-persistence test.

## F5; Thesis and assessment workspace

- **Goal:** thesis ownership made visible and safe.
- **Files:** `ThesisWorkspace`, `ThesisHeader`, `ClaimList`, `AssessmentHistory`, `RevisionControl`.
- **Backend requirements:** thesis routes (F0); revision stays behind the confirmed PATCH.
- **Acceptance criteria:** active thesis, version, claims/assumptions/invalidation conditions, full assessment history (including Flow 4 records; D3), latest assessment; revision control requires the backend confirmation contract and shows "assessment never modifies the thesis"; stale assessments never restyle the thesis.
- **Tests:** assessment-history rendering; revision-gate tests (unconfirmed → no mutation, verifiable in UI state).

## F6; Challenge and framework views

- **Goal:** falsification and framework-constrained evaluation surfaces.
- **Files:** `ChallengeWorkspace`, `FrameworkEvaluation`, `FalsificationTargetList`, `MaterialityBadge`, `CriterionRow`.
- **Acceptance criteria:** challenge view shows what could disprove the thesis, evidence sought, materiality tiers, unresolved questions; framework view renders per-criterion rows with satisfied/unsatisfied/partial/insufficient + `evidenceNeeded`; numeric scores appear only when the framework itself defines them (backend-validated).
- **Tests:** criterion-row matrix including INSUFFICIENT_EVIDENCE and CONTRADICTED cases.

## F7; Saved artifacts and memory

- **Goal:** SAVE artifacts distinct from memory; honest memory status.
- **Files:** `MemoryScreen`, `SavedArtifacts`, `MemoryList`, status token styles.
- **Acceptance criteria:** artifacts and memory entries are separate sections; CURRENT/STALE/HISTORICAL rendered with explicit demotion for STALE/HISTORICAL (muted, status chip, last-validated time); ordinary research never appears here (mirrors Scenario 5).
- **Tests:** status-rendering tests; "research did not create memory" UI test.

## F8; Monitoring state UI

- **Goal:** monitor handoff state with zero implied infrastructure.
- **Files:** `MonitorsScreen`, `MonitorCard`, condition/state badges, explainer banner.
- **Acceptance criteria:** proposals vs active vs paused/stale/completed clearly separated; early-warning vs invalidation conditions visually distinct; SOURCE_UNAVAILABLE rendered as source status, never as invalidation alert; persistent explainer: "persistent research state only; no background monitoring is running"; activation requires confirmation dialog; manual refresh only (no polling that implies liveness).
- **Tests:** lifecycle-state rendering matrix; source-unavailable test.

## F9; Responsive / accessibility / error polish

- **Goal:** the information-density requirements hold at every breakpoint.
- **Files:** layout grids, token refinements, EmptyState/ErrorState completion, focus management, reduced-motion support.
- **Acceptance criteria:** three-pane → stacked → single-column behavior per the responsive strategy; keyboard-navigable disclosure; status colors pass contrast; error/empty states for every screen; no layout shifts that hide limitations.
- **Tests:** responsive snapshot tests; axe accessibility checks.

## F10; End-to-end validation

- **Goal:** prove the MVP against the audited scenario suite.
- **Files:** e2e harness (Playwright) driving the real F0 API with the deterministic fake provider stack.
- **Acceptance criteria:** Scenarios 1–8 from `SYSTEM_AUDIT.md` pass through the UI: basic research with honest uncertainty; ambiguity halts untouched; conflicting evidence preserved; thesis lifecycle with immutable thesis; save/memory boundary; monitor proposal-only; insufficient-evidence honesty; execution language rejected at the UI/API/engine layers. Full deterministic backend suite + frontend suites green; no secret in any bundle (CI grep); Gemini/Bitget reachable only from the API process.
- **Tests:** 8 e2e scenario tests mirroring the backend audit 1:1.

---

## Dependency notes

- F0 blocks everything; F1 blocks F2/F3; F4–F8 depend on F0 routes but not on each other (can be interleaved after F1); F9 polishes all screens; F10 is last.
- Backend work inside milestones is limited to F0 route surface and, if genuinely required, additive read-only DTO endpoints; no engine behavior changes are planned or permitted by this plan.

## Non-goals reminder (each milestone)

No trading UI, no fake real-time data, no chain-of-thought rendering, no client-side epistemic logic, no implied background monitoring, no auth (single stubbed trader), no new external dependencies beyond the stack named in `FRONTEND_ARCHITECTURE.md` §1.
