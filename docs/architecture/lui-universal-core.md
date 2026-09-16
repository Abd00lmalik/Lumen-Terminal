---
title: "UNIVERSAL LUI CORE"
source: # UNIVERSAL LUI CORE.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-flow-extensions.md, lui-research-action.md, lui-analyze-action.md, lui-challenge-action.md, lui-manage-state-action.md, lui-monitor-action.md, lui-save-action.md, lui-interaction-model.md]
---

**Related documents:** `lui-flow-extensions.md` · `lui-research-action.md` · `lui-analyze-action.md` · `lui-challenge-action.md` · `lui-manage-state-action.md` · `lui-monitor-action.md` · `lui-save-action.md` · `lui-interaction-model.md`

> Converted from `# UNIVERSAL LUI CORE.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

# UNIVERSAL LUI CORE

## Definition

The Universal LUI Core is the common intelligence and action layer shared by every research flow in the AI Trading Research Workbench.

It provides six first-class LUI actions:

```text
RESEARCH
ANALYZE
CHALLENGE
MANAGE_STATE
MONITOR
SAVE
```

The trader interacts through natural language.

The system maps natural language into these internal actions and their parameters without exposing a rigid command language.

The Universal Core determines **what the trader wants to accomplish**.

Flow-specific extensions determine **how that objective is specialized for the current research question**.

---

# 1. Core Philosophy

The workbench is not a chatbot with research tools.

It is an agentic research environment where natural language is the primary control surface.

The trader can:

* start research;
* change direction;
* narrow or expand scope;
* challenge conclusions;
* modify active state;
* save knowledge;
* monitor developments;
* revisit previous research;
* change depth;
* correct the agent;
* branch investigations;
* restore previous states.

The agent owns the burden of orchestration.

The trader remains the final decision-maker.

---

# 2. Universal Core Actions

## RESEARCH

Performs research toward a trader-defined objective.

```text
Trader objective
→ target
→ scope
→ depth
→ constraints
→ context
→ research plan
→ tool/data orchestration
→ evidence
→ hypotheses
→ synthesis
→ judgment
```

## ANALYZE

Interprets, compares, explains, or synthesizes information.

Analysis may conduct additional research when available evidence is insufficient.

```text
Analytical objective
→ resolve target
→ assess evidence
→ identify gaps
→ research if needed
→ analyze
→ synthesize
→ judgment
```

## CHALLENGE

Attempts to falsify or materially weaken a thesis, belief, claim, interpretation, assumption, position, or expected outcome.

```text
Target
→ decompose
→ identify weaknesses
→ seek contradictory evidence
→ test alternatives
→ identify invalidation conditions
→ verdict
```

## MANAGE_STATE

Controls the state and organization of the research workspace.

```text
Change state
→ preserve prior state
→ propagate valid dependencies
→ maintain provenance
→ create checkpoint/history
```

## MONITOR

Continuously watches selected signals and interprets meaningful changes in the context of existing research.

```text
Signal
→ materiality
→ reassessment
→ judgment update
→ research/challenge when warranted
→ alert
→ continue monitoring
```

## SAVE

Intentionally preserves trader-selected knowledge, state, or reusable artifacts.

```text
Resolve target
→ classify artifact
→ detect existing artifact
→ assess materiality
→ version/update
→ preserve provenance
```

---

# 3. Natural Language Control

The trader does not need to learn system commands.

Examples:

```text
"Research why BTC dropped."

"Go deeper on the macro side."

"Actually ignore macro and focus on derivatives."

"Try to prove my thesis wrong."

"Save this as my BTC framework."

"Pause the ETF branch."

"Watch for anything that would invalidate this."

"Restore the research from before the FOMC."

"Compare this with previous similar events."
```

The LLM maps these requests into internal action structures.

The internal taxonomy is structured.

The external interface remains natural language.

---

# 4. Universal Action Resolution

Every LUI request follows:

```text
Natural language
```text
      ↓
Intent recognition
      ↓
Action classification
      ↓
Target resolution
      ↓
Context resolution
      ↓
Parameter extraction
      ↓
Execution
      ↓
State update
      ↓
```
Evidence/provenance preservation
```

The system should start immediately when intent is sufficiently clear.

If ambiguity could materially change the result, clarification is required.

The system should not ask unnecessary clarification questions.

---

# 5. Context Resolution

Universal target/context resolution follows:

```text
Explicit user reference
```text
        ↓
Active workspace context
        ↓
Current research
        ↓
Conversation context
        ↓
Relevant memory
        ↓
```
Clarification
```

Explicit trader instructions override inferred context.

Material ambiguity must not be resolved by guessing.

---

# 6. Common Intelligence Layer

All universal actions share the following intelligence capabilities.

## 6.1 Intent & Context Understanding

The system identifies:

* intent;
* action;
* target;
* entities;
* event;
* timeframe;
* research context;
* thesis;
* position when relevant;
* constraints;
* prior research;
* relevant memory.

It should state its interpretation briefly when useful and then begin execution.

---

## 6.2 Research Planning

Planning is adaptive.

For simple requests, the system can begin directly.

For complex requests, it creates a living research plan.

The plan is a control surface rather than a static checklist.

New evidence may change the plan.

Completed work is preserved.

---

## 6.3 Tool and Data Orchestration

The agent chooses:

* data sources;
* tools;
* Skills;
* research branches;
* evidence sources;
* cross-validation requirements.

Tool selection is internal.

The trader does not need to know which internal tool was selected unless transparency is requested.

---

## 6.4 Evidence Management

Evidence is maintained through:

```text
Source
```text
  ↓
Observation
  ↓
Claim
  ↓
Evidence
  ↓
Hypothesis
  ↓
```
Judgment
```

Evidence records preserve:

* provenance;
* timestamp;
* source quality;
* directness;
* recency;
* specificity;
* corroboration;
* contradictions;
* conflicts of interest;
* observation vs interpretation vs speculation.

Evidence weighting is claim-specific.

---

## 6.5 Hypothesis Management

Hypotheses are living research objects.

They may be:

* created;
* ranked;
* weakened;
* strengthened;
* challenged;
* replaced;
* preserved historically.

The agent does not create formal hypotheses merely for cosmetic structure.

A new hypothesis should be created when it materially affects the requested research.

---

## 6.6 Reasoning and Synthesis

The system produces:

* primary judgment;
* strongest supporting evidence;
* opposing evidence;
* key relationships;
* unresolved uncertainty;
* confidence.

Conflicting evidence is reconciled using evidence quality and relevance rather than simply majority count.

When new material evidence changes the conclusion, the system revises the judgment automatically.

Previous material judgments remain preserved.

---

## 6.7 Uncertainty and Confidence

Confidence should generally use qualitative levels:

```text
HIGH
MODERATE
LOW
```

Confidence is based on:

* evidence quality;
* evidence quantity;
* corroboration;
* contradictions;
* uncertainty;
* research completeness;
* hypothesis stability;
* source reliability.

Confidence is not the same as importance.

---

## 6.8 Research Memory

Memory may contain:

* trader preferences;
* frameworks;
* previous research;
* thesis evolution;
* historical decisions;
* reusable conclusions;
* relevant context.

Memory must distinguish:

```text
CURRENT EVIDENCE
HISTORICAL INFORMATION
TRADER PREFERENCE
PERSISTENT FRAMEWORK
PRIOR JUDGMENT
```

Old research must never silently become current evidence.

---

## 6.9 Monitoring Handoff

Research can transition into monitoring.

Monitoring inherits relevant:

* question;
* objective;
* thesis;
* hypotheses;
* evidence;
* judgment;
* invalidation conditions;
* framework;
* context.

Activation of persistent monitoring requires explicit confirmation.

---

# 7. Universal Research State

The workbench maintains a living state containing:

```text
Workspace
```text
├── Objective
├── Active Target
├── Scope
├── Depth
├── Constraints
├── Research Plan
├── Branches
├── Evidence
├── Hypotheses
├── Judgment
├── Thesis
├── Framework
├── Monitors
├── Saved Artifacts
├── Relationships
├── Dependencies
└── History
```
```

State is persistent and reversible.

---

# 8. Evidence Can Change Direction

Research is not obligated to confirm the trader's initial belief.

If evidence materially changes the investigation:

* the agent may replan;
* new hypotheses may emerge;
* existing hypotheses may weaken;
* scope may expand;
* scope may narrow;
* conclusions may change.

The original research remains preserved.

---

# 9. Trader Corrections

Clear factual corrections from the trader are applied immediately.

Example:

```text
Trader:
"The event happened on Tuesday, not Wednesday."
```

The system:

1. corrects the affected state;
2. identifies dependent research;
3. revalidates affected conclusions;
4. preserves the previous state in history.

The agent must not silently discard the fact that a correction occurred.

---

# 10. Research Branching

Branches allow competing or independent research paths.

The agent may create branches when:

* alternative explanations emerge;
* scope requires parallel investigation;
* contradictory evidence requires independent examination;
* a new hypothesis materially affects the research.

Branches should remain traceable to their origin.

The agent can pause, resume, prioritize, or reprioritize branches.

---

# 11. Adaptive Research Depth

Depth supports:

```text
QUICK
STANDARD
DEEP
EXHAUSTIVE
```

Natural-language equivalents are accepted.

Examples:

```text
"Give me a quick answer."

"Go deeper."

"Do a comprehensive investigation."

"Keep it lightweight."
```

The agent can dynamically adjust depth when evidence warrants it.

However, an explicit hard limit from the trader cannot be silently overridden.

---

# 12. Selective Interruption

A new instruction does not necessarily destroy existing work.

The agent identifies affected branches.

```text
New instruction
```text
      ↓
Identify affected research
      ↓
Pause/replan affected branches
      ↓
Preserve unaffected branches
      ↓
```
Continue relevant work
```

Completed work remains preserved.

---

# 13. Intent Changes

A fundamental intent change replaces the active plan.

Example:

```text
Previous:
Why did BTC fall?

New:
Compare ETH and SOL for the next month.
```

The previous research is preserved as historical context.

The new intent starts a new active plan.

---

# 14. Scope Replacement

An explicit scope change replaces the active scope.

Example:

```text
"Ignore macro and focus on derivatives and on-chain data."
```

The active scope becomes:

```text
INCLUDED:
derivatives
on-chain

EXCLUDED:
macro
```

Previous research is preserved.

---

# 15. Challenge and Replanning

When the trader challenges a conclusion:

```text
Current judgment
```text
      ↓
New challenge
      ↓
New hypothesis / attack path
      ↓
Test against existing evidence
      ↓
Additional research if necessary
      ↓
```
Updated assessment
```

The challenge does not automatically replace the original judgment.

---

# 16. Confirmation Boundary

The system follows a clear boundary between ordinary research manipulation and consequential persistence.

### Immediate

Clear, reversible actions such as:

* changing active scope;
* changing research depth;
* changing branch priority;
* hiding/collapsing objects;
* pausing a branch;
* saving ordinary research;
* creating checkpoints.

### Confirmation Required

Consequential persistent actions such as:

* activating monitoring;
* replacing a persistent framework;
* changing persistent preferences;
* materially changing active monitor conditions;
* permanent deletion;
* other persistent changes with meaningful future consequences.

---

# 17. RESEARCH Specification

```text
RESEARCH {
  objective {
    original
    structured_type
    success_criteria
  }

  target {
    requested
    resolved
    entities
    event
    timeframe
    resolution_source
    confidence
  }

  scope {
    requested
    resolved
    included_domains
    excluded_domains
    boundaries
  }

  depth {
    requested
    resolved_level
    minimum
    maximum
    adaptive
  }

  constraints {
    requested
    resolved
    hard_constraints
    preferences
  }

  context {
    inferred
    explicit
    active_research_refs
    memory_refs
    override
  }
}
```

Execution:

```text
Interpret
→ Resolve
→ Assess complexity
→ Plan
→ Orchestrate
→ Gather evidence
→ Manage hypotheses
→ Adapt research
→ Synthesize
→ Judgment
```

---

# 18. ANALYZE Specification

```text
ANALYZE {
  objective {
    original
    structured_type
    success_criteria
  }

  mode {
    structured
    inferred
  }

  targets {
    requested
    resolved
    entities
    events
    relationships
    timeframe
    resolution_source
    confidence
  }

  scope {
    requested
    resolved
    included_domains
    excluded_domains
    boundaries
  }

  depth {
    requested
    resolved_level
    minimum
    maximum
    adaptive
  }

  context {
    explicit
    inferred
    active_research_refs
    memory_refs
    thesis_refs
    override
  }

  constraints {
    requested
    resolved
    hard_constraints
    preferences
  }

  analytical_orientation {
    neutral_by_default
    thesis_aware_when_relevant
  }
}
```

Supported analytical modes include:

```text
COMPARE
EXPLAIN
INTERPRET
SYNTHESIZE
```

Freeform analytical requests remain supported.

Output adapts to the mode but always retains:

* primary judgment;
* supporting evidence;
* opposing evidence;
* key findings;
* uncertainty;
* confidence.

---

# 19. CHALLENGE Specification

```text
CHALLENGE {
  objective {
    original
    structured_type
    success_criteria
  }

  target {
    requested
    resolved
    target_type
    entities
    thesis_refs
    position_refs
    context_refs
    resolution_source
    confidence
  }

  thesis_structure {
    conclusion
    claims
    assumptions
    dependencies
    causal_links
    expected_outcome
  }

  challenge_intensity {
    requested
    resolved
    adaptive
  }

  invalidation_conditions {
    identified
    conditions
    evidence_required
  }

  alternative_explanations {
    identified
    relevant
    tested
  }

  scope {
    requested
    resolved
    included_domains
    excluded_domains
    boundaries
  }

  depth {
    requested
    resolved_level
    minimum
    maximum
    adaptive
  }

  constraints {
    requested
    resolved
    hard_constraints
    preferences
  }

  context {
    explicit
    inferred
    active_research_refs
    memory_refs
    thesis_refs
    override
  }
}
```

Challenge intensity is adaptive.

Possible verdicts:

```text
SURVIVES
PARTIALLY_WEAKENED
MATERIALLY_WEAKENED
FAILS
```

The verdict is presented first.

Detailed reasoning is progressively disclosed.

---

# 20. MANAGE_STATE Specification

`MANAGE_STATE` controls:

* active objects;
* branches;
* workspace organization;
* relationships;
* dependencies;
* constraints;
* priorities;
* lifecycle;
* snapshots;
* checkpoints;
* restoration.

```text
MANAGE_STATE {
  operation {
    type
    target
    requested_change
    resolution
    confidence
  }

  target {
    object
    branch
    workspace
    relationship
    session
    snapshot
  }

  state_change {
    current_state
    requested_state
    affected_objects
    propagated_changes
  }

  history {
    prior_state
    provenance
    reversible
    checkpoint_refs
    snapshot_refs
  }

  persistence {
    session_only
    persistent
    confirmation_required
  }

  dependencies {
    object_dependencies
    execution_dependencies
    relationship_dependencies
  }

  constraints {
    active_constraints
    changed_constraints
    hard_constraints
    preferences
  }

  lifecycle {
    status
    priority
    ownership
    lock_state
    visibility
    archive_state
  }
}
```

Fundamental rule:

> Active state changes. History is preserved unless the trader explicitly chooses permanent deletion.

---

# 21. MANAGE_STATE Operations

Supported operations include:

```text
Change target
Change objective
Change intent
Change mode
Change scope
Change depth
Change timeframe
Change constraints
Change completion criteria
Change assigned Skill
Change research strategy
Change evidence prioritization
Pause branch
Resume branch
Cancel branch
Reprioritize branch
Set branch limit
Set deadline
Clone branch
Reset branch
Rename
Label
Pin
Unpin
Hide
Collapse
Group
Tag
Archive
Restore
Lock
Unlock
Annotate
Create relationship
Modify relationship
Remove relationship
Create dependency
Modify dependency
Remove dependency
Undo
Redo
Checkpoint
Snapshot
Restore snapshot
Restore baseline
Open previous session
Import historical information
```

No state-management operation may silently destroy provenance.

---

# 22. MONITOR Specification

```text
MONITOR {
  objective {
    original
    current
    success_criteria
  }

  context {
    original_research_ref
    research_refs
    thesis_refs
    judgment_refs
    hypothesis_refs
    framework_refs
    memory_refs
    current_context
  }

  conditions {
    conditions
    condition_defaults
    condition_overrides
    condition_statuses
    condition_severity
    condition_relevance
  }

  signals {
    sources
    data_types
    domains
    signal_definitions
  }

  trigger {
    type
    threshold
    qualitative_condition
    persistence_requirement
    confidence_requirement
  }

  reassessment {
    enabled
    proportionality
    scope
    confidence_update
    judgment_update
  }

  research {
    automatic_research_conditions
    research_recommendation_conditions
    research_context
  }

  challenge {
    automatic_challenge_conditions
    challenge_context
  }

  alerts {
    severity
    batching
    duplicate_suppression
    acknowledgement
    handled_events
  }

  lifecycle {
    status
    paused
    stopped
    expired
    archived
    invalid
  }

  scheduling {
    frequency
    immediate_conditions
    batching_policy
  }

  persistence {
    persistent
    confirmation_required
  }

  provenance {
    source_refs
    transition_history
    lineage
  }

  history {
    judgments
    confidence_changes
    condition_changes
    alerts
    handled_events
    adaptations
    reversals
  }
}
```

Monitoring is hybrid.

It watches selected signals, interprets material changes in context, reassesses affected research, and alerts the trader.

---

# 23. MONITOR Principles

Monitoring:

* uses evidence-based conditions;
* supports quantitative and qualitative triggers;
* evaluates materiality;
* reassesses proportionally;
* updates confidence when warranted;
* updates judgment when materially warranted;
* may trigger RESEARCH under predefined/high-confidence conditions;
* may trigger CHALLENGE when meaningful thesis risk emerges;
* suppresses materially duplicate alerts;
* preserves history;
* preserves provenance;
* can pause;
* can stop;
* can expire;
* can be restored.

The trader remains in control of consequential persistent changes.

---

# 24. MONITOR and Thesis

When monitoring materially changes a linked research conclusion:

1. update the current conclusion when warranted;
2. preserve the previous conclusion;
3. assess thesis impact;
4. automatically trigger CHALLENGE only when there is a meaningful reason to question the thesis.

If the thesis materially weakens:

* recommend monitor condition changes;
* require confirmation before consequential changes.

If the thesis fails and monitoring becomes irrelevant:

* pause the monitor;
* preserve configuration/history;
* recommend replacement where appropriate.

---

# 25. MONITOR and RESEARCH

Monitoring may automatically trigger research when:

* the condition is predefined;
* confidence is high;
* additional research is clearly warranted.

Otherwise it recommends research.

Automatically triggered research inherits relevant context.

If the resulting research materially changes judgment:

* update the judgment when warranted;
* preserve the previous judgment;
* show the change explicitly.

---

# 26. MONITOR and CHALLENGE

Monitoring can automatically trigger CHALLENGE when:

* a high-risk thesis condition occurs;
* meaningful invalidation evidence emerges;
* persistent uncertainty threatens the thesis;
* the monitor's evidence materially contradicts the thesis.

The challenge does not automatically rewrite the thesis.

---

# 27. SAVE Specification

```text
SAVE {
  target {
    requested
    resolved
    object_type
    object_ref
    resolution_source
    confidence
  }

  artifact {
    type
    name
    description
    content
    status
  }

  destination {
    workspace
    location
    collection
    inferred
  }

  persistence {
    session_only
    persistent
    confirmation_required
  }

  versioning {
    existing_artifact
    materiality
    action
    current_version
    new_version
    previous_version_ref
  }

  provenance {
    source_refs
    research_refs
    evidence_refs
    hypothesis_refs
    judgment_refs
    thesis_refs
    framework_refs
    timestamp
    origin
  }

  context {
    current_context
    historical_context
    memory_refs
    active_research_refs
  }

  state {
    completeness
    freshness
    validity
    confidence
  }

  relationships {
    related_objects
    dependencies
    replaced_artifact
    derived_from
  }

  history {
    prior_versions
    checkpoints
    reversible
  }
}
```

---

# 28. SAVE Principles

Normal workspace state is automatically persisted.

Explicit SAVE intentionally preserves:

* research;
* conclusions;
* judgments;
* hypotheses;
* frameworks;
* theses;
* monitors;
* snapshots;
* preferences;
* other workspace objects.

Material changes create new versions.

Minor changes update the current version.

Previous material versions remain recoverable.

---

# 29. SAVE and Frameworks

Frameworks preserve their exact logical structure.

```text
Framework {
  factors
  conditions
  evidence_required
  weights
  thresholds
  evaluation_rules
}
```

Saving a framework does not silently modify it.

Replacing a persistent framework requires confirmation.

---

# 30. SAVE and Monitoring

Saving a monitor preserves its configuration.

Saving does not activate it.

```text
SAVE monitor
≠
ACTIVATE monitor
```

Activation remains a consequential action requiring confirmation.

---

# 31. SAVE and Historical Information

Saved historical information preserves:

* timestamp;
* original context;
* provenance;
* original evidence;
* original judgment.

It does not automatically become current evidence.

---

# 32. SAVE Versioning

Materiality is determined automatically by default.

The trader can override the determination.

```text
Minor change
→ update current version

Material change
→ create new version
→ preserve previous version
```

---

# 33. SAVE and Deletion

SAVE never performs permanent deletion.

Deletion is managed through `MANAGE_STATE`.

Default deletion is reversible.

Permanent deletion requires explicit confirmation.

---

# 34. Universal Evidence Standard

Across all actions, evidence is evaluated using:

```text
Source quality
Directness
Recency
Specificity
Corroboration
Provenance
Conflict of interest
Observation vs interpretation
Contradictory evidence
Contextual relevance
```

Evidence is claim-specific.

The system must not treat source count as equivalent to evidence strength.

---

# 35. Universal Confidence Standard

Confidence reflects the strength of the current research assessment.

Confidence considers:

* evidence quality;
* evidence consistency;
* uncertainty;
* contradictions;
* research completeness;
* hypothesis stability;
* source reliability.

Confidence may change automatically when material evidence warrants it.

Material confidence changes are preserved in history.

---

# 36. Progressive Disclosure

The default interface should prioritize:

```text
What happened / what matters
```text
        ↓
Current judgment
        ↓
Key supporting evidence
        ↓
Opposing evidence
        ↓
Confidence
        ↓
```
Recommended next action
```

The trader can request deeper detail.

Detailed views may expose:

* research plan;
* evidence chain;
* hypotheses;
* reasoning;
* contradictions;
* provenance;
* historical judgments;
* branch states;
* monitoring conditions;
* version history.

The system should not overwhelm the trader with internal detail by default.

---

# 37. Universal Revision Rule

If new evidence materially changes the conclusion:

```text
Previous judgment
```text
        ↓
New evidence
        ↓
Reassessment
        ↓
```
New judgment
```

The new judgment becomes current.

The previous material judgment remains historical.

The system should make the change visible when material.

---

# 38. Universal Contradiction Rule

Contradictory evidence is not discarded merely because it conflicts with the current thesis.

The system should:

1. identify the conflict;
2. assess evidence quality;
3. assess directness;
4. assess recency;
5. assess specificity;
6. assess corroboration;
7. determine whether the conflict is material;
8. update judgment/confidence when warranted;
9. preserve unresolved uncertainty when appropriate.

---

# 39. Universal Replanning Rule

The agent may replan automatically when:

* new evidence materially changes the research direction;
* a hypothesis becomes significantly stronger/weaker;
* the current path becomes unproductive;
* a new branch becomes necessary;
* the trader changes intent;
* a dependency becomes invalid.

Completed research remains preserved.

The agent should explain material replanning.

---

# 40. Universal State Preservation

The system preserves:

```text
Research
Evidence
Hypotheses
Judgments
Theses
Frameworks
Branches
Monitors
Snapshots
Versions
Provenance
Relationships
Dependencies
```

unless the trader explicitly requests permanent deletion.

---

# 41. Universal Trader Control

The agent is responsible for:

* interpretation;
* planning;
* orchestration;
* evidence management;
* adaptive research;
* reasoning;
* monitoring;
* state maintenance;
* versioning;
* provenance.

The trader controls:

* research objectives;
* final decisions;
* thesis adoption;
* consequential persistent changes;
* monitor activation;
* framework replacement;
* persistent preferences;
* permanent deletion.

---

# 42. Universal LUI Action Mapping

Natural language maps to the universal action taxonomy.

```text
"Find out what happened."
→ RESEARCH

"Compare these two."
→ ANALYZE

"Try to prove me wrong."
→ CHALLENGE

"Ignore macro."
→ MANAGE_STATE

"Watch for anything that changes this."
→ MONITOR

"Save this."
→ SAVE
```

A single request may involve multiple internal actions.

Example:

```text
"Research whether my BTC thesis still holds and tell me what could prove it wrong."

RESEARCH
    ↓
ANALYZE
    ↓
CHALLENGE
```

The user does not need to explicitly invoke each internal action.

---

# 43. Action Composition

Universal actions may compose.

Common patterns:

```text
RESEARCH → ANALYZE

RESEARCH → CHALLENGE

RESEARCH → MONITOR

ANALYZE → CHALLENGE

MONITOR → RESEARCH

MONITOR → CHALLENGE

RESEARCH → SAVE

ANALYZE → SAVE

CHALLENGE → SAVE

MANAGE_STATE → RESEARCH

SAVE → MANAGE_STATE
```

Composition is internal.

The trader experiences one continuous research workflow.

---

# 44. Universal Research Loop

The complete system operates as:

```text
QUESTION
```text
   ↓
RESEARCH
   ↓
JUDGMENT
   ↓
THESIS
   ↓
MONITOR
   ↓
NEW EVIDENCE
   ↓
REASSESS
   ↓
ANALYZE
   ↓
CHALLENGE WHEN WARRANTED
   ↓
UPDATED JUDGMENT
   ↓
SAVE / MANAGE STATE
   ↓
```
CONTINUE
```

This is a persistent research loop rather than a one-off chat interaction.

---

# 45. Universal Architecture Rule

The Universal Core is responsible for:

```text
WHAT
```

Flow-specific extensions are responsible for:

```text
HOW
```

For example:

```text
Universal:
RESEARCH

Flow-specific:
WHAT HAPPENED?
→ event reconstruction

WHY DID IT HAPPEN?
→ causal investigation

WHAT COULD AFFECT IT?
→ impact analysis

DOES MY THESIS HOLD?
→ thesis stress testing
```

The universal action remains stable.

The flow extension specializes its execution.

---

# 46. Final Architecture

```text
                    NATURAL LANGUAGE
```text
                           │
                           ▼
                 INTENT & CONTEXT LAYER
                           │
                           ▼
                  UNIVERSAL LUI CORE
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    RESEARCH            ANALYZE           CHALLENGE
        │                  │                  │
        ├──────────────┬───┴──────────────┬───┤
        │              │                  │
   MANAGE_STATE      MONITOR             SAVE
        │              │                  │
        └──────────────┴──────────────────┘
                           │
                           ▼
                 FLOW-SPECIFIC EXTENSION
                           │
        ┌──────────────────┼───────────────────┐
        │                  │                   │
```
   WHAT HAPPENED?     WHY DID IT HAPPEN?   WHAT COULD AFFECT IT?
        │                  │                   │
   DOES MY THESIS?    HAS THIS HAPPENED?   ALL INFORMATION
        │                  │                   │
   PROVE ME WRONG?    EVALUATE FRAMEWORK
```text
                           │
                           ▼
                    RESEARCH JUDGMENT
                           │
                           ▼
```
                     TRADER DECISION
```

---

# 47. Governing Principles

The Universal LUI Core follows these final principles:

1. Natural language is the control surface.
2. The agent owns the research burden.
3. The trader owns the decision.
4. Evidence can change direction.
5. Research is adaptive.
6. Ambiguity that materially affects outcomes requires clarification.
7. Clear instructions execute immediately.
8. Consequential persistent changes require confirmation.
9. Active state can change without destroying history.
10. Provenance is preserved.
11. Historical information is never silently treated as current evidence.
12. Material judgments are versioned through history.
13. Monitoring is contextual, not merely alert-based.
14. Challenges seek genuine falsification rather than manufactured objections.
15. Saved artifacts remain traceable.
16. The system uses progressive disclosure.
17. The Universal Core stays stable while flow-specific extensions specialize behavior.
18. The entire system forms a persistent loop:

```text
Question
→ Research
→ Judgment
→ Thesis
→ Monitoring
→ New Evidence
→ Reassessment
→ Challenge
→ Updated Judgment
→ Trader Decision
```

The final authority remains with the trader.
