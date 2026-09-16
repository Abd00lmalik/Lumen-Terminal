# Architecture Documentation

Converted 2026-09-12 from the 39 root `*.txt` specification files (one-to-one; originals preserved at repo root). See [`conversion_log.md`](conversion_log.md) for the file-by-file mapping, fidelity verification, and the one documented formatting exception.

**Source of truth:** these documents carry the full architectural specification. Formatting was normalized (fences, diagram runs, line endings); architectural content was not re-worded, reordered, or removed. Where this tree and the root `.txt` files ever diverge, flag it; do not silently resolve.

**RESOLVED CONTRADICTION (final architecture lock, human-approved 2026-09-12):** the LUI universal action set is now locked as **6 actions: RESEARCH, ANALYZE, CHALLENGE, MANAGE_STATE, MONITOR, SAVE**; SAVE is a first-class action. Rationale: `MANAGE_STATE` modifies current research/workspace state; `SAVE` intentionally promotes eligible state into persistent reusable memory/artifacts (different semantics and confirmation requirements). [`lui-universal-core.md`](lui-universal-core.md) and [`lui-save-action.md`](lui-save-action.md) define the locked model; [`lui-flow-extensions.md`](lui-flow-extensions.md) (originally 5-action, excluding SAVE) carries an amendment note and internally consistent updates. The root `.txt` originals remain preserved unmodified.

## Reading order (first pass)

1. [`research-flows.md`](research-flows.md); the 8 locked research flows (canonical product behavior)
2. [`core-principles.md`](core-principles.md); Common Intelligence Layer shared by all flows + global design principles
3. [`research-object-model.md`](research-object-model.md); the research object hierarchy
4. [`lui-universal-core.md`](lui-universal-core.md) + [`lui-flow-extensions.md`](lui-flow-extensions.md); LUI architecture (6-action locked model incl. SAVE; see lock note above)
5. [`tool-skill-orchestration.md`](tool-skill-orchestration.md) + [`data-market-intelligence.md`](data-market-intelligence.md); capability/tool/provider model
6. [`safety-boundaries.md`](safety-boundaries.md); decision boundary and confirmation rules

## Document map

### Flows & shared intelligence
| Document | Original source | Covers |
|---|---|---|
| [`research-flows.md`](research-flows.md) | `researchflows.txt` | The 8 locked research flows, step by step |
| [`core-principles.md`](core-principles.md) | `commonintelligencelayer.txt` | Common Intelligence Layer; 9 capabilities; global principles |

### Research objects, lifecycle, relationships, memory
| Document | Original source | Covers |
|---|---|---|
| [`research-object-model.md`](research-object-model.md) | `# Research Object Model.txt` | WORKSPACE/RESEARCH/THESIS/... object hierarchy and schemas |
| [`object-lifecycle-state-machine.md`](object-lifecycle-state-machine.md) | `OBJECT LIFECYCLE  STATE MACHINE.txt` | Per-object lifecycle states and transitions |
| [`object-relationships.md`](object-relationships.md) | `OBJECT RELATIONSHIPS  DEPENDENCY GR.txt` | Relationship types vs dependencies; propagation rules |
| [`memory.md`](memory.md) | `RESEARCH MEMORY  KNOWLEDGE PERSISTE.txt` | Memory categories; continuity vs authority |

### Execution pipeline
| Document | Original source | Covers |
|---|---|---|
| [`research-planning.md`](research-planning.md) | `RESEARCH PLANNING & ORCHESTRATION.txt` | Living research plan; task/skill/tool selection |
| [`research-execution-engine.md`](research-execution-engine.md) | `RESEARCH EXECUTION ENGINE.txt` | Execution model; FULL ADAPTIVE ORCHESTRATION |
| [`execution-scheduler.md`](execution-scheduler.md) | `EXECUTION SCHEDULER & RESOURCE ALLO.txt` | Scheduling, parallelism, priorities |
| [`completion-stopping.md`](completion-stopping.md) | `RESEARCH COMPLETION & STOPPING INTE.txt` | When research is done; diminishing returns |
| [`quality-control.md`](quality-control.md) | `RESEARCH QUALITY CONTROL INTELLIGEN.txt` | Continuous quality evaluation |
| [`failure-recovery.md`](failure-recovery.md) | `ERROR, FAILURE & RECOVERY INTELLIGE.txt` | Failure handling; skill failure; substitution |

### Tools, data, evidence, sources
| Document | Original source | Covers |
|---|---|---|
| [`tool-skill-orchestration.md`](tool-skill-orchestration.md) | `# TOOL & SKILL ORCHESTRATION INTELL.txt` | CAPABILITY/TOOL/SKILL/TOOL_RESULT models; initial Bitget Skill registry |
| [`data-market-intelligence.md`](data-market-intelligence.md) | `DATA & MARKET INTELLIGENCE LAYER.txt` | 10 data domains; PROVIDER_ADAPTER; raw data preservation |
| [`source-intelligence.md`](source-intelligence.md) | `SOURCE INTELLIGENCE.txt` | Origin layer: source selection, provenance, reliability |
| [`source-discovery-retrieval.md`](source-discovery-retrieval.md) | `SOURCE DISCOVERY & RETRIEVAL INTELL.txt` | Operational retrieval during research |
| [`evidence-source.md`](evidence-source.md) | `EVIDENCE & SOURCE INTELLIGENCE.txt` | Evidence evaluation, weighting, linking, maintenance |

### Reasoning layers
| Document | Original source | Covers |
|---|---|---|
| [`hypothesis.md`](hypothesis.md) | `HYPOTHESIS INTELLIGENCE.txt` | Competing explanations as living objects |
| [`branch.md`](branch.md) | `BRANCH INTELLIGENCE.txt` | Independent investigation branches |
| [`analysis-synthesis.md`](analysis-synthesis.md) | `ANALYSIS & SYNTHESIS INTELLIGENCE.txt` | Evidence → analytical findings |
| [`judgment-confidence.md`](judgment-confidence.md) | `JUDGMENT & CONFIDENCE INTELLIGENCE.txt` | Best-supported assessment; confidence & uncertainty |

### Trader-level objects
| Document | Original source | Covers |
|---|---|---|
| [`framework.md`](framework.md) | `FRAMEWORK INTELLIGENCE.txt` | Persistent trader evaluation frameworks |
| [`thesis.md`](thesis.md) | `THESIS INTELLIGENCE.txt` | Persistent trader theses |
| [`thesis-monitor-reassessment.md`](thesis-monitor-reassessment.md) | `THESIS → MONITOR → REASSESSMENT LOO.txt` | Thesis → monitor → reassessment continuity loop |

### LUI (language user interface)
| Document | Original source | Covers |
|---|---|---|
| [`lui-universal-core.md`](lui-universal-core.md) | `# UNIVERSAL LUI CORE.txt` | Universal LUI core actions; **locked 6-action model incl. SAVE** |
| [`lui-flow-extensions.md`](lui-flow-extensions.md) | `LUI; Universal Core + Flow-Specifi.txt` | Universal core + flow extensions (originally 5-action excl. SAVE; amended to the locked 6-action model; see lock note above) |
| [`lui-research-action.md`](lui-research-action.md) | `LUI; RESEARCH Action Specification.txt` | RESEARCH action detail |
| [`lui-analyze-action.md`](lui-analyze-action.md) | `ANALYZE; Universal Core Action.txt` | ANALYZE action detail |
| [`lui-challenge-action.md`](lui-challenge-action.md) | `# CHALLENGE; Universal Core Action.txt` | CHALLENGE action detail |
| [`lui-manage-state-action.md`](lui-manage-state-action.md) | `MANAGE_STATE.txt` | MANAGE_STATE action detail |
| [`lui-monitor-action.md`](lui-monitor-action.md) | `# MONITOR.txt` | MONITOR action detail |
| [`lui-save-action.md`](lui-save-action.md) | `# SAVE.txt` | SAVE action detail |
| [`lui-interaction-model.md`](lui-interaction-model.md) | `# LUI Layer; Natural Language Inte.txt` | NL as control system, not chat |

### Presentation, context, personalization, safety
| Document | Original source | Covers |
|---|---|---|
| [`workspace-presentation.md`](workspace-presentation.md) | `RESEARCH STATE  WORKSPACE PRESENTAT.txt` | Internal graph → trader-facing workspace |
| [`timeline-activity.md`](timeline-activity.md) | `RESEARCH TIMELINE & ACTIVITY INTELL.txt` | Temporal evolution of research |
| [`progressive-disclosure.md`](progressive-disclosure.md) | `PROGRESSIVE DISCLOSURE & EXPLAINABI.txt` | What to expose when; "show me why" |
| [`context-session.md`](context-session.md) | `RESEARCH CONTEXT & SESSION INTELLIG.txt` | Context and reference resolution |
| [`personalization.md`](personalization.md) | `PERSONALIZATION INTELLIGENCE.txt` | Trader adaptation without distortion |
| [`safety-boundaries.md`](safety-boundaries.md) | `SAFETY & DECISION BOUNDARY INTELLIG.txt` | Research vs decision boundary |

## Related layers

- `AGENT.md` (repo root); runtime research-agent routing/orchestration over this documentation.
- `FINDINGS.md` (repo root); Bitget capability research, flow mapping, gaps, and the findings report.
- `handoff.md` (repo root); concise continuity note for future coding agents (does not duplicate architecture).
