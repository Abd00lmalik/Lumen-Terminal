# SYSTEM_AUDIT.md; M6 Full System Audit

**Date:** 2026-09-14 · **Baseline:** 269/269 deterministic tests (M5) · **After audit:** 285/285 deterministic tests + 16 E2E scenario tests folded into the suite · TypeScript typecheck clean · zero regressions M0–M5.

---

## 1. Executive summary

The system behaves as **one coherent research agent**, not a collection of passing modules. The full request path; natural language → LUI → validated structured intent → safety/consequence gates → flow dispatch → living plan → capability registry → provider adapters → TOOL_RESULT → evidence → claims/hypotheses/analysis/judgment → persistence → progressive response; is exercised end-to-end by the new deterministic E2E scenario suite (`tests/research/e2e-scenarios.test.ts`, 16 tests covering the 8 mandated scenarios).

The audit found **4 genuine defects** (all fixed with architecture-preserving changes + regression tests), **8 architectural gaps**, **7 product/UX gaps**, and confirmed the **intentional limitations** are correctly represented (Flow 5 unavailable, monitor state ≠ monitoring infrastructure, G1/G2 unselected). No trading/execution surface exists at any layer. No secrets are committed. Evidence laws survive every audited path, including the model-failure and partial-capability paths.

**Defect fixes (all small, all architecture-preserving):**

| ID | Defect | Where | Fix |
|---|---|---|---|
| D1 | `set-active-thesis` validated but never applied; no persisted active-thesis selection existed (continuity snapshot guessed via `updatedAt`) | `src/lui/lui.ts` dispatchManageState, `src/domain/workspace.ts` | `Workspace.setActiveThesis/getActiveThesis` (trader selection persisted, unknown refs rejected, snapshot round-trip); dispatcher now applies the validated proposal |
| D2 | Successful MANAGE_STATE fell through to "produced no research outcome" | `src/lui/lui.ts` buildResponse | Dedicated truthful state-change branch ("Working state updated … persistent memory was not changed") |
| D3 | Flow 4 evaluations never entered the auditable thesis-assessment history | `src/research/flow4.ts` | Evaluation now records a `ThesisAssessmentRecord` (thesis object still untouched) |
| D4 | Assessment-history records smuggled flow vocabulary through a cast; MANAGE_STATE could not resolve *which* thesis a trader meant | `src/domain/thesis.ts`, `src/research/context.ts` | First-class `ThesisAssessmentStatus` (`SUPPORTED/WEAKENED/MATERIALLY_CHALLENGED/UNSUPPORTED/INDETERMINATE`); research context exposes the trader's theses inventory (refs + status, for selection only) |

---

## 2. Actual end-to-end architecture map

```
USER (natural language)
  → src/lui/lui.ts Lui.handle()
      INPUT NORMALIZATION     → model "lui.normalized_request"   (validated: LuiNormalizedRequest)
      TARGET RESOLUTION       → model "lui.resolved_target"      (validated: ResolvedTarget)
      AMBIGUITY CHECK         → model "lui.ambiguity"            (validated; halt → clarification, no state change)
      CONSEQUENCE CHECK       → model "lui.consequence"          (validated; consequence level + confirmation need)
      SAFETY SCREEN           → model "safety.screen"            (execution-like intent rejected BEFORE dispatch)
      ACTION PLAN             → model "lui.action_plan"          (validated: 6 locked actions only)
      DISPATCH                → research / analyze / challenge / manage_state / monitor / save handlers
  → src/research/flow-runner.ts runFlow()      (living plan → capability selection → adaptive rounds)
      capabilities            → src/adapters/capability-registry.ts (generic, capability-first)
      adapters                → src/adapters/bitget-skill-adapter.ts (+ mcp.ts / rest.ts transports)
  → TOOL_RESULT normalization → src/domain/tool-result.ts
  → EVIDENCE                  → src/domain/evidence.ts (class/quality gates; interpretation ≠ observation)
  → CLAIMS/HYPOTHESES/ANALYSIS/JUDGMENT → src/domain/workspace.ts, src/domain/objects.ts
  → PERSISTENCE               → src/persistence/index.ts (FileStore/MemoryStore, snapshot round-trip)
  → RESPONSE                  → buildResponse(): progressive disclosure (L0 default; no CoT)
```

Every stage above has a named module, a typed input/output, a validation boundary (`validateModelOutput` for every model output; schema-level rejection of invented refs/unknown capabilities), typed failure behavior (`ModelFailure` ≠ research failure ≠ tool failure), provenance on every created object, and persistence through the single `WorkspaceStore` architecture.

## 3. Request lifecycle

1. `Lui.handle(message, origin)`; origin is a `ProvenanceOrigin`; explicit trader confirmation is recorded in origin detail and verified before consequential persistence (SAVE/MONITOR/MANAGE_STATE).
2. Normalization → target → ambiguity → consequence → safety → plan, each a separate model call with its own schema. **Invalid model output becomes a typed model failure, never an execution command.**
3. Ambiguous + consequential → halt with `awaitingClarification`; workspace untouched (Scenario 2).
4. Execution-like language → rejected by the safety screen before any dispatch (Scenario 8); even a model that smuggles `action: "PLACE_ORDER"` into the plan is rejected by schema validation (not one of the six locked actions).
5. Flow dispatch (RESEARCH/ANALYZE/CHALLENGE) → `runFlow` with flow objective metadata; **no Flow→Tool hardcoding** exists anywhere in the dispatch path (verified by test).
6. Capability execution through the registry; failures become limitations; results become TOOL_RESULT → evidence with class/freshness/provenance preserved.
7. Response built with progressive disclosure; citations validated against the actual research context (fabricated refs are dropped at `validateCitations`).

## 4. State lifecycle

- **Working state** (MANAGE_STATE): active research target, active thesis selection (D1 fix), branch context; mutable by the trader, never persisted as reusable memory.
- **Research state**: workspace objects (evidence/claims/hypotheses/analyses/judgments), auto-persisted per research round, never auto-promoted to memory.
- **Persistent memory** (SAVE only): artifacts + memory entries with category/status/decay. Confirmed by Scenario 5: research produces zero memory entries; unconfirmed SAVE persists nothing.
- Branching: research branches via the existing branch model; restoration preserves provenance; no branch silently overwrites another.

## 5. Data/provenance lifecycle

ORIGIN → SOURCE → RETRIEVAL → EXTRACTION → EVIDENCE → CLAIM → HYPOTHESIS → ANALYSIS → JUDGMENT is preserved on every material object (spot-verified across flows and continuity operations). Relationship vocabulary is the architecture's (`supports/contradicts/derived_from/depends_on/tests/challenges/references/supersedes/related_to/branched_from/evaluates/informs/uses/contains/version_of/restores_from`); no invented relationship types found. Model-authored objects are never granted evidence status by authorship.

## 6. Evidence lifecycle

- `normalizedResult` → `evidenceFromToolResult` classification gates: interpretation/skill output never becomes OBSERVATION; proxy evidence keeps `proxyBasis`; freshness assessed, stale stays stale.
- Tool failure/empty/partial → **limitations only** (Scenario 1b, Scenario 7): unavailable output never enters the evidence graph; retrieval failure is never negative evidence.
- Contradictions are graph-preserved in both directions; Flow 6 preserves typed disagreement without forced synthesis (Scenario 3).
- Citations in model outputs are validated against real context refs; fabricated refs are dropped.

## 7. Thesis lifecycle

Trader-owned. Creation requires trader origin. Assessment (Flow 4), challenge (Flow 7/CHALLENGE), and reassessment (M5 pathway) all produce **assessment-history records**, never mutations (Scenario 4: version stays 1; D3 regression test). Revision exists as a separate trader-only `reviseThesis` with version + provenance preserved. MANAGE_STATE `set-active-thesis` is now a persisted, trader-confirmed *selection* (not a lifecycle change) with unknown-ref rejection (D1).

## 8. Memory lifecycle

SAVE (explicit, confirmed, trader-origin) → artifact + categorized memory entry. Categories: research/thesis/framework/preference/historical/monitor. Decay `CURRENT → STALE → HISTORICAL` reduces influence without deletion. Revalidation records outcomes without overwriting. **Conflict law holds** (Scenario 5b): current validated research wins; the contradicted memory is marked STALE with the validation relationship recorded; the historical record is untouched. Memory never outranks current evidence.

## 9. Monitoring lifecycle

MONITOR → persistent `MonitorProposal` (PROPOSED) with invalidation vs early-warning conditions kept as distinct kinds, source dependencies and freshness expectations recorded. **Activation is trader-only** (system/model origins are rejected by the domain, not just the LUI). SOURCE_UNAVAILABLE is a recorded state; never a false invalidation (Scenario 6). No background worker, cron, notification, or delivery exists anywhere; the UI contract must present monitor *state*, not live monitoring.

## 10. Flow interaction matrix

| Flow | Entry | Capabilities decided by | Contradiction handling | Insufficient-evidence behavior | Can it overclaim? (verified) |
|---|---|---|---|---|---|
| 1 WHAT HAPPENED | RESEARCH (event wording) | living plan + registry | preserved | honest completion | No; timeline from evidence only |
| 2 WHY | RESEARCH (causal wording) | living plan + registry | causal-status ladder; temporal ≠ causal | INCONCLUSIVE allowed | No; correlation never asserted as causation |
| 3 COULD AFFECT | RESEARCH (factor wording) | living plan + registry | factor status vocabulary | unresolved ≠ absent | No; no prediction/signal language (tested) |
| 4 THESIS HOLD | RESEARCH/ANALYZE (thesis wording) | plan scoped to thesis claims | component-level statuses | UNAVAILABLE/INDETERMINATE | No; assessment ≠ mutation (tested) |
| 6 ALL INFO | RESEARCH (synthesis wording) | material-dimension planning | typed disagreement preserved | limitations surfaced | No; weighting qualitative, no forced agreement |
| 7 PROVE WRONG | CHALLENGE | falsification-biased planning | materiality tiers | "nothing found" ≠ true | No; no manufactured opposition |
| 8 FRAMEWORK | RESEARCH/ANALYZE (framework wording) | criteria-driven | contradicted vs unsatisfied distinct | INSUFFICIENT_EVIDENCE + evidenceNeeded | No; no invented scoring (validated) |
| 5 HAS THIS HAPPENED | **explicitly unavailable** |; |; |; | G1 not selected; Gemini background knowledge is never substituted (verified: no HISTORICAL capability registered; stubs throw NotConnectedError) |

## 11. Failure and recovery matrix (verified paths)

| Failure | Becomes | Never becomes |
|---|---|---|
| Gemini unavailable | typed `ModelFailure` PROVIDER_UNAVAILABLE, state preserved | fabricated response, negative evidence |
| Malformed model output | INVALID_OUTPUT model failure | execution command |
| Capability/transport failure | limitation `tool_failure` + TOOL_RESULT failure state | negative evidence, claim refutation |
| Empty upstream data | limitation `empty_result` | evidence of absence |
| Partial results | limitation `partial_result` + preserved partials | silent completeness |
| Insufficient evidence | valid completion state | system failure, forced conclusion |
| Persistence failure | explicit persistence failure | reported-as-successful save |
| Monitor source outage | SOURCE_UNAVAILABLE state | thesis invalidation alert |

## 12. Confirmation/authorization matrix

| Operation | Origin required | Confirmation | Unconfirmed behavior |
|---|---|---|---|
| SAVE (persistent memory) | trader | explicit (user request or confirmation flow) | persists **nothing**; `awaitingConfirmation` (Scenario 5) |
| MANAGE_STATE set-active-thesis | trader | explicit selection | not applied; unknown refs rejected (D1) |
| MONITOR activation | **trader only** (enforced in domain) | explicit | stays PROPOSED; no worker implied (Scenario 6) |
| Thesis revision | trader | explicit separate action | never triggered by assessment/challenge/reassessment |
| RESEARCH/ANALYZE/CHALLENGE | any | none (non-consequential to persistent state) | no memory promotion, no thesis mutation |

## 13. Security and secret-handling review

- `GEMINI_API_KEY` read from env only, in `src/model/gemini.ts`; never logged, never in errors, provenance, snapshots, or tests (grep-audited across `src/` and `tests/`).
- `.env` git-ignored; `.env.example` contains placeholders only; no key material anywhere in the repo.
- Gemini is isolated behind `ModelProvider` (`src/model/provider.ts`); no Google types leak outside `src/model/gemini.ts`.
- No trading/execution endpoints, adapters, or capability names exist (Scenario 8 asserts the registry cannot even express them).
- Frontend plan (Phase 4/5 docs): Gemini keys server-side only; browser never calls Gemini or Bitget directly.

## 14. Identified defects (all fixed + regression-tested)

**CONFIRMED DEFECT D1; MANAGE_STATE set-active-thesis was a silent no-op with no persisted selection.**
Where: `src/lui/lui.ts` (dispatcher validated the proposal then discarded it), `src/domain/workspace.ts` (no active-thesis pointer; `getContinuitySnapshot` inferred "active" by `updatedAt` ordering). How: any "make thesis X active" request reported success without changing working state; a later session recovered the wrong thesis. Why tests missed it: earlier MANAGE_STATE tests asserted validation/rejection paths only, not workspace mutation. Fix: `Workspace.setActiveThesis` (rejects unknown ids, snapshot round-trip) + dispatcher applies the validated proposal + the change-proposal step now receives the theses inventory so the model can resolve *which* thesis (D4b). Regression: e2e "D1/D1b" tests. Architecture: unchanged (working-state selection is an existing MANAGE_STATE concept).

**CONFIRMED DEFECT D2; successful MANAGE_STATE answered "produced no research outcome".**
Where: `buildResponse` had no stateChange branch. How: every successful state change produced a false self-report. Why tests missed it: response content for MANAGE_STATE was previously unasserted. Fix: truthful branch; what changed, implication that persistent memory was untouched. Regression: e2e "D2" test. Architecture: unchanged.

**CONFIRMED DEFECT D3; Flow 4 results bypassed the auditable assessment history.**
Where: `src/research/flow4.ts` never called `recordThesisAssessment`; only the M5 reassessment pathway did. How: "Does my thesis hold?" left no history; `latestThesisAssessment` empty. Why tests missed it: flow tests asserted evaluation output, not history. Fix: record after judgment creation. Regression: e2e "D3 regression" test. Architecture: unchanged (uses the M5 record type).

**CONFIRMED DEFECT D4; assessment vocabulary type-unsound + selection context missing.**
Where: `ThesisAssessmentRecord.assessment` used thesis *lifecycle* `ThesisStatus` with a cast in `reassess.ts`; research context exposed only the single active thesis, so a state-change step could not resolve "the halving thesis". Fix: first-class `ThesisAssessmentStatus` union (matches the M4b mandate vocabulary); context exposes `theses` inventory (refs/status, explicitly trader-owned, selection-only). Regressions: e2e D1/D2 tests + full suite. Architecture: unchanged (additive types).

## 15. Identified architectural gaps (not defects; documented, unfixed by design/scope)

1. **GAP**; Flow 5 unavailable until G1 vendor selection; stubs fail loudly (correct behavior, still a capability hole).
2. **GAP**; Monitor state is persistence-only; no evaluation engine will ever set conditions to *triggered* until monitoring infrastructure exists.
3. **GAP**; Memory retrieval is tag/thesis-scoped, not semantic; architecture defers storage backend choice.
4. **GAP**; Research context is rebuilt from workspace state per request; no cross-session caching layer (fine at current scale, noted for frontend API design).
5. **GAP**; Framework criteria are model-parsed from saved free-text artifacts; no structured framework schema (M5 report noted this; persists).
6. **GAP**; Adaptive scheduler's flow-objective metadata is guidance, not a formal utility model; stopping rules are conservative (heuristic, documented).
7. **GAP**; No HTTP/API layer exists yet; the engine is an in-process TypeScript API. The frontend architecture doc addresses this as F0.
8. **GAP**; Contradiction detection between evidence items is direction-based on the graph; no cross-capability semantic contradiction sweep beyond Flow 6's model-mediated pass.

## 16. Identified product/UX gaps (for frontend MVP)

1. Research sessions currently have no user-visible identity; the UI needs a workspace/session selector (F1).
2. Progressive disclosure exists in data but has no interaction model yet; L0→L5 needs explicit UI affordances (F3).
3. Limitations and uncertainty are first-class data but easy to visually bury; the design must give them persistent visibility, not footnote status.
4. Monitor state vs live monitoring distinction must be visually explicit to avoid implying background workers exist.
5. Stale memory must not render like current findings (status-colored, visually demoted).
6. Thesis revision is a separate confirmation flow; the UI must not offer a casual "edit thesis" control.
7. Long research runs need a progress/interim model; the engine is request/response today (F0 streaming contract defined in the frontend docs).

## 17. Intentional limitations (verified correctly represented)

- Flow 5 blocked on G1; Gemini background knowledge never substitutes for historical research.
- G1/G2 vendor-neutral stubs throw `NotConnectedError`; no vendor selected.
- No monitoring workers/cron/notifications; monitor handoff is persistent state only.
- No trading/execution anywhere; the trader is the final decision-maker.
- No UI exists (as of M6 audit phase); frontend docs only.
- Live Gemini/Bitget tests are env-gated; deterministic suite needs no network or credentials.

## 18. Recommended fixes (ordering)

1. ✅ D1–D4 (fixed this phase, regression-tested).
2. F0 API boundary before any UI work (the engine's in-process API is clean enough to wrap directly).
3. Structured framework schema (removes model-parsed criteria) when SAVE artifacts get a schema field; low urgency.
4. G1 vendor decision to unblock Flow 5; product decision, not engineering.
5. Monitoring infrastructure only after the monitor-state UI proves the handoff representation.

---

**Audit verdict:** the backend is a coherent research agent with sound evidence, provenance, failure, confirmation, and continuity behavior. All confirmed defects were small and fixed without architectural change. The system is ready for the frontend MVP defined in `FRONTEND_ARCHITECTURE.md` / `FRONTEND_IMPLEMENTATION_PLAN.md`.
