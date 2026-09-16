# Implementation Plan (post architecture-lock, pre-M0)

> Produced 2026-09-12 per the final architecture lock. **M0 only is authorized to start after this plan.**
> Source-of-truth hierarchy: `docs/architecture/` → `AGENT.md` → `FINDINGS.md` → `handoff.md`.

## 1. Repository structure

```text
/                         existing architecture docs, AGENT.md, FINDINGS.md, handoff.md, IMPLEMENTATION_PLAN.md
/docs/architecture/       maintained architecture (source of truth; root .txt = originals, untouched)
/tools/                   maintenance scripts (converter)
/src/
  domain/                 research object model — pure types + factories, no I/O
    ids.ts                id generation
    provenance.ts         Provenance type + factories
    lifecycle.ts          lifecycle states + transition tables + applyTransition
    objects.ts            WORKSPACE/RESEARCH/BRANCH/CLAIM/EVIDENCE/SOURCE/HYPOTHESIS/ANALYSIS/JUDGMENT
                          (THESIS/FRAMEWORK/MONITOR/SNAPSHOT/ANNOTATION/SAVED_ARTIFACT reserved but not
                          implemented in M0 — they arrive with M3–M5)
    tool-result.ts        TOOL_RESULT type + normalizedResult factory
    evidence.ts           evidence classification (raw/observation/derived/interpretation/proxy/speculation)
    workspace.ts          workspace aggregate root (add/update, one current judgment rule)
  persistence/            storage behind a WorkspaceStore interface
    memory-store.ts       in-memory store
    file-store.ts         JSON file store (data/ dir)
    index.ts              createStore() factory
  adapters/               PROVIDER_ADAPTER seam (transport stays out of M0)
    capability-registry.ts  capability → provider registrations (no hardcoded Flow→Tool maps)
    historical/         G1 stub: interface + NotConnectedError (no invented data)
    web/                G2 stub: interface + NotConnectedError
  research/               orchestration seam (M2 will implement flows here; M0 ships the shell)
    engine.ts            placeholder that routes via capability registry
tests/                    vitest, mirrors src/ structure
```

## 2. Runtime architecture

Layered, dependencies point downward only:

```text
LUI (M3)  →  Research Engine (M2)  →  Capability Router  →  Provider/Skill Registry  →  Adapters
                                                        →  Evidence validation/classification
                                                        →  Research graph (domain objects)
                                    →  WorkspaceStore (persistence)
```

M0 implements domain + persistence + the adapter/capability seams (stubs). No UI, no LUI, no transports.

## 3. Main modules / classes / interfaces

| Module | Exports | Architectural role |
|---|---|---|
| `domain/lifecycle.ts` | `applyTransition`, transition tables, guards | `object-lifecycle-state-machine.md` — per-object state machines; invalid transitions throw |
| `domain/objects.ts` | factories: `createResearch`, `createBranch`, `createClaim`, `createEvidence`, `createHypothesis`, `createAnalysis`, `createJudgment`, `createSource` | `research-object-model.md` schemas |
| `domain/provenance.ts` | `createProvenance` | every object traceable (`research-object-model.md` §21) |
| `domain/evidence.ts` | `classifyEvidence`, quality assessment | `evidence-source.md` observation/interpretation/proxy separation |
| `domain/tool-result.ts` | `normalizedResult` | `tool-skill-orchestration.md` §18 TOOL_RESULT contract |
| `persistence/*` | `WorkspaceStore` interface, memory/file impls | `research-object-model.md` §17/§20; smallest persistence (lock §14) |
| `adapters/capability-registry.ts` | `CapabilityRegistry` | capability-before-tool; Bitget-specific logic stays in adapters (lock §6) |
| `adapters/historical`, `adapters/web` | `HistoricalDataProvider`, `WebRetrievalProvider` interfaces + stubs | lock §4: interfaces defined, vendor selection deferred |

## 4. Data flow (M0)

```text
provider result → normalizeToolResult() → TOOL_RESULT
TOOL_RESULT → classifyEvidence() → EVIDENCE (class + freshness + limitations preserved)
EVIDENCE → workspace.addEvidence() → research graph (supports/contradicts links)
HYPOTHESIS/CLAIM updates → judgment supersession via workspace (one ACTIVE judgment)
workspace → WorkspaceStore.save() → JSON files
```

## 5. Adapter boundaries

- The research engine asks "what capability?" — never "which Bitget tool?" (`tool-skill-orchestration.md` §2.1).
- Adapters own: provider identity, invocation parameters, throttling/retry (M1), output normalization to `TOOL_RESULT`, classification of skill interpretation vs observation.
- G1 historical + G2 web: interfaces + failing stubs now (`NotConnectedError`); no vendor chosen, no fabricated data (lock §4, `FINDINGS.md` §5).
- On-chain: no dedicated provider (lock §5); proxy evidence must remain labeled `proxy` — enforced by `evidence.ts`.

## 6. Persistence approach

In-memory store + file-backed JSON store (lock §14 allows this MVP). Store interface is object-typed
(`save/get/list` per object kind), so a database can replace it later without touching domain logic.
History is append-only inside objects (`history[]`), superseded judgments are never deleted.

## 7–9. M0 / M1 / M2 steps

**M0 — runtime foundation (this authorization):**
1. Scaffold `package.json`, `tsconfig.json`, vitest.
2. `domain/` object model + lifecycle + provenance + TOOL_RESULT + evidence classification.
3. `persistence/` memory + file stores behind `WorkspaceStore`.
4. `adapters/` capability registry + G1/G2 stubs.
5. Tests per §17 (below). **No UI, no LUI, no flows, no Bitget transport yet.**

**M1 — Bitget adapter layer (after human go):** MCP transport client + Bitget public REST client; five skill adapters normalizing into `TOOL_RESULT`; freshness profiles per `FINDINGS.md` §6; throttling + retry/backoff + partial-failure handling (`failure-recovery.md`); provenance capture (skill, tool, params, raw reference).

**M2 — Flow 1 (after M1):** Flow 1 end-to-end (lock §8): intent stub → research target → living plan → capability selection → Bitget execution → optional web verification (stub → real when G2 chosen) → evidence validation → timeline/claims/contradictions → primary judgment → progressive-disclosure response → state update. Smallest useful capabilities first: `news-briefing` + `technical-analysis`; others only when planning shows material value (lock §9). Adaptive depth; no auto-invoking all skills.

## 10. Test strategy (per lock §17)

Vitest, behavioral assertions (architecture behavior, not mere function outputs):

- object creation/lifecycle; provenance preservation; TOOL_RESULT normalization
- observation vs interpretation classification; proxy evidence labeling
- stale data handling; tool failure recovery; partial results
- contradiction preservation; hypothesis updates; judgment revision (supersession, one current)
- current vs historical separation; (M3+) LUI classification, SAVE vs MANAGE_STATE, confirmation boundaries, no autonomous execution

## 11. Known limitations (intentional, documented)

- No LUI/flows/transport yet — M0 is foundation only.
- G1/G2 adapters are stubs: invoking them throws `NotConnectedError` (no vendor selected, per lock §4).
- No dedicated on-chain provider (lock §5); market-intel proxies must stay labeled `proxy`.
- File-backed persistence is single-process; no concurrency control (fine for MVP; re-evaluate post-hackathon).
- The domain model implements the M0-relevant object subset; THESIS/FRAMEWORK/MONITOR/SAVE-ARTIFACT arrive with M3–M5 per plan phasing.

## 12. Remaining architecture conflicts

- **None open.** The LUI 5-vs-6 action contradiction was resolved by the human lock (2026-09-12): 6 actions incl. SAVE. Amendment notes live in `docs/architecture/lui-flow-extensions.md`, `README.md`, `AGENT.md`, `FINDINGS.md`; root `.txt` originals untouched.
- Watch item: root `.txt` originals intentionally still contain the old 5-action text — this is by design (preservation), not an active contradiction. The `.md` layer is authoritative.
