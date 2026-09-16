# Conversion Log; architecture .txt → docs/architecture/*.md

Generated: 2026-09-12. One-time fidelity conversion. **2026-09-16: the root `.txt` sources were removed after conversion verification**; these `.md` files are the sole architecture source of truth.

| Source .txt (root) | Output .md | Lines (in → out) | Cross-references |
|---|---|---|---|
| `# CHALLENGE; Universal Core Action.txt` | [`lui-challenge-action.md`](lui-challenge-action.md) | 742 → 754 | `lui-universal-core.md`, `hypothesis.md`, `research-flows.md` |
| `# LUI Layer; Natural Language Inte.txt` | [`lui-interaction-model.md`](lui-interaction-model.md) | 405 → 405 | `lui-universal-core.md`, `lui-flow-extensions.md` |
| `# MONITOR.txt` | [`lui-monitor-action.md`](lui-monitor-action.md) | 1918 → 1944 | `thesis-monitor-reassessment.md`, `lui-universal-core.md`, `research-flows.md` |
| `# Research Object Model.txt` | [`research-object-model.md`](research-object-model.md) | 1099 → 1121 | `object-lifecycle-state-machine.md`, `object-relationships.md`, `workspace-presentation.md` |
| `# SAVE.txt` | [`lui-save-action.md`](lui-save-action.md) | 996 → 1002 | `lui-universal-core.md`, `memory.md` |
| `# TOOL & SKILL ORCHESTRATION INTELL.txt` | [`tool-skill-orchestration.md`](tool-skill-orchestration.md) | 1213 → 1221 | `data-market-intelligence.md`, `evidence-source.md`, `failure-recovery.md`, `research-execution-engine.md` |
| `# UNIVERSAL LUI CORE.txt` | [`lui-universal-core.md`](lui-universal-core.md) | 1880 → 1902 | `lui-flow-extensions.md`, `lui-research-action.md`, `lui-analyze-action.md`, `lui-challenge-action.md`, `lui-manage-state-action.md`, `lui-monitor-action.md`, `lui-save-action.md`, `lui-interaction-model.md` |
| `ANALYSIS & SYNTHESIS INTELLIGENCE.txt` | [`analysis-synthesis.md`](analysis-synthesis.md) | 1201 → 1207 | `judgment-confidence.md`, `hypothesis.md`, `evidence-source.md`, `thesis-monitor-reassessment.md`, `research-flows.md`, `framework.md` |
| `ANALYZE; Universal Core Action.txt` | [`lui-analyze-action.md`](lui-analyze-action.md) | 493 → 507 | `lui-universal-core.md`, `analysis-synthesis.md` |
| `BRANCH INTELLIGENCE.txt` | [`branch.md`](branch.md) | 1474 → 1476 | `hypothesis.md`, `execution-scheduler.md`, `research-flows.md` |
| `DATA & MARKET INTELLIGENCE LAYER.txt` | [`data-market-intelligence.md`](data-market-intelligence.md) | 1263 → 1267 | `tool-skill-orchestration.md`, `source-intelligence.md` |
| `ERROR, FAILURE & RECOVERY INTELLIGE.txt` | [`failure-recovery.md`](failure-recovery.md) | 1393 → 1398 | `quality-control.md`, `tool-skill-orchestration.md`, `execution-scheduler.md` |
| `EVIDENCE & SOURCE INTELLIGENCE.txt` | [`evidence-source.md`](evidence-source.md) | 2012 → 2018 | `source-discovery-retrieval.md`, `source-intelligence.md`, `hypothesis.md`, `judgment-confidence.md` |
| `EXECUTION SCHEDULER & RESOURCE ALLO.txt` | [`execution-scheduler.md`](execution-scheduler.md) | 822 → 824 | `research-execution-engine.md`, `research-planning.md`, `branch.md` |
| `FRAMEWORK INTELLIGENCE.txt` | [`framework.md`](framework.md) | 1393 → 1392 | `research-flows.md`, `memory.md`, `personalization.md` |
| `HYPOTHESIS INTELLIGENCE.txt` | [`hypothesis.md`](hypothesis.md) | 1405 → 1411 | `branch.md`, `analysis-synthesis.md`, `evidence-source.md`, `research-flows.md`, `thesis-monitor-reassessment.md`, `framework.md` |
| `JUDGMENT & CONFIDENCE INTELLIGENCE.txt` | [`judgment-confidence.md`](judgment-confidence.md) | 1106 → 1106 | `analysis-synthesis.md`, `hypothesis.md`, `research-flows.md` |
| `LUI; RESEARCH Action Specification.txt` | [`lui-research-action.md`](lui-research-action.md) | 700 → 708 |; |
| `LUI; Universal Core + Flow-Specifi.txt` | [`lui-flow-extensions.md`](lui-flow-extensions.md) | 248 → 252 | `lui-universal-core.md`, `lui-interaction-model.md` |
| `MANAGE_STATE.txt` | [`lui-manage-state-action.md`](lui-manage-state-action.md) | 200 → 200 | `lui-universal-core.md`, `object-lifecycle-state-machine.md` |
| `OBJECT LIFECYCLE  STATE MACHINE.txt` | [`object-lifecycle-state-machine.md`](object-lifecycle-state-machine.md) | 516 → 516 | `research-object-model.md`, `object-relationships.md`, `lui-manage-state-action.md` |
| `OBJECT RELATIONSHIPS  DEPENDENCY GR.txt` | [`object-relationships.md`](object-relationships.md) | 742 → 744 | `research-object-model.md`, `object-lifecycle-state-machine.md`, `memory.md` |
| `PERSONALIZATION INTELLIGENCE.txt` | [`personalization.md`](personalization.md) | 1278 → 1282 | `framework.md`, `memory.md`, `safety-boundaries.md` |
| `PROGRESSIVE DISCLOSURE & EXPLAINABI.txt` | [`progressive-disclosure.md`](progressive-disclosure.md) | 1818 → 1828 | `workspace-presentation.md`, `judgment-confidence.md` |
| `RESEARCH COMPLETION & STOPPING INTE.txt` | [`completion-stopping.md`](completion-stopping.md) | 1187 → 1206 | `quality-control.md`, `research-planning.md`, `research-execution-engine.md` |
| `RESEARCH CONTEXT & SESSION INTELLIG.txt` | [`context-session.md`](context-session.md) | 1417 → 1429 | `memory.md`, `workspace-presentation.md`, `lui-interaction-model.md` |
| `RESEARCH EXECUTION ENGINE.txt` | [`research-execution-engine.md`](research-execution-engine.md) | 1120 → 1120 | `research-planning.md`, `execution-scheduler.md`, `tool-skill-orchestration.md`, `quality-control.md` |
| `RESEARCH MEMORY  KNOWLEDGE PERSISTE.txt` | [`memory.md`](memory.md) | 578 → 580 | `research-object-model.md`, `context-session.md`, `thesis-monitor-reassessment.md` |
| `RESEARCH PLANNING & ORCHESTRATION.txt` | [`research-planning.md`](research-planning.md) | 993 → 997 | `research-execution-engine.md`, `execution-scheduler.md`, `tool-skill-orchestration.md`, `completion-stopping.md` |
| `RESEARCH QUALITY CONTROL INTELLIGEN.txt` | [`quality-control.md`](quality-control.md) | 1278 → 1289 | `completion-stopping.md`, `evidence-source.md`, `failure-recovery.md` |
| `RESEARCH STATE  WORKSPACE PRESENTAT.txt` | [`workspace-presentation.md`](workspace-presentation.md) | 1970 → 1982 |; |
| `RESEARCH TIMELINE & ACTIVITY INTELL.txt` | [`timeline-activity.md`](timeline-activity.md) | 1876 → 1894 | `workspace-presentation.md`, `research-object-model.md` |
| `SAFETY & DECISION BOUNDARY INTELLIG.txt` | [`safety-boundaries.md`](safety-boundaries.md) | 1198 → 1206 | `lui-monitor-action.md`, `lui-save-action.md`, `framework.md`, `memory.md` |
| `SOURCE DISCOVERY & RETRIEVAL INTELL.txt` | [`source-discovery-retrieval.md`](source-discovery-retrieval.md) | 1160 → 1174 | `source-intelligence.md`, `evidence-source.md`, `tool-skill-orchestration.md` |
| `SOURCE INTELLIGENCE.txt` | [`source-intelligence.md`](source-intelligence.md) | 1160 → 1160 | `source-discovery-retrieval.md`, `evidence-source.md` |
| `THESIS INTELLIGENCE.txt` | [`thesis.md`](thesis.md) | 1184 → 1186 | `thesis-monitor-reassessment.md`, `research-flows.md`, `framework.md` |
| `THESIS → MONITOR → REASSESSMENT LOO.txt` | [`thesis-monitor-reassessment.md`](thesis-monitor-reassessment.md) | 1429 → 1454 | `lui-universal-core.md`, `research-flows.md`, `thesis.md`, `lui-monitor-action.md`, `memory.md` |
| `commonintelligencelayer.txt` | [`core-principles.md`](core-principles.md) | 719 → 727 | `research-flows.md`, `research-execution-engine.md`, `judgment-confidence.md` |
| `researchflows.txt` | [`research-flows.md`](research-flows.md) | 774 → 770 | `core-principles.md`, `lui-universal-core.md` |

## Verification notes

- 39/39 source files converted (see table).
- Original root `.txt` files untouched.
- Line-count deltas are frontmatter/related-links/wrapping artifacts only.
- No architectural content re-worded, reordered, or removed by the converter.
- Contiguous ASCII-diagram runs are fenced for rendering; prose is never fenced.
- Documented exception: `FRAMEWORK INTELLIGENCE.txt` contains exactly one unpaired trailing ``` fence at EOF (line 1393), a stray artifact with no opening fence anywhere in the file. The converter removed that single fence line; no prose, schema, or list content was affected.
- Known unresolved contradiction (NOT silently resolved): LUI action set is 5 actions in `LUI; Universal Core + Flow-Specifi.txt` vs 6 actions (incl. SAVE) in `# UNIVERSAL LUI CORE.txt`; both converted as-is, pending human decision. See `../../FINDINGS.md` and `../../../handoff.md`.
