---
title: "THESIS → MONITOR → REASSESSMENT LOOP"
source: THESIS → MONITOR → REASSESSMENT LOO.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-universal-core.md, research-flows.md, thesis.md, lui-monitor-action.md, memory.md]
---

**Related documents:** `lui-universal-core.md` · `research-flows.md` · `thesis.md` · `lui-monitor-action.md` · `memory.md`

> Converted from `THESIS → MONITOR → REASSESSMENT LOO.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

THESIS → MONITOR → REASSESSMENT LOOP

## 1. Purpose

This system connects:

THESIS
```text
    ↓
RESEARCH
    ↓
JUDGMENT
    ↓
MONITORING
    ↓
NEW EVIDENCE
    ↓
REASSESSMENT
    ↓
THESIS STATE
    ↓
```
UPDATED MONITORING

The loop provides continuity between research sessions.

The system evaluates the trader's thesis.

The trader owns the thesis.

The system does not silently rewrite or replace it.
```

## 2. Core Principle

```text id="m8q4vx"
RESEARCH answers:
"What does the available evidence currently support?"

THESIS represents:
"What does the trader currently believe?"

MONITOR represents:
"What observable changes should cause us to reassess?"

REASSESSMENT answers:
"Has new evidence materially changed the basis for the thesis?"
```

## 3. Thesis Object

```text id="t4n7mc"
THESIS {
  id
  statement
  status
  claims[]
  assumptions[]
  dependencies[]
  causal_links[]
  expected_outcomes[]
  supporting_evidence[]
  contradicting_evidence[]
  invalidation_conditions[]
  early_warning_conditions[]
  alternative_explanations[]
  confidence
  uncertainty[]
  related_research[]
  related_judgments[]
  related_monitors[]
  owner
  created_at
  updated_at
  version
  history
  provenance
}
```

## 4. Thesis Ownership

The trader owns:

```text thesis statement
thesis adoption
thesis modification
thesis rejection
thesis replacement
```

The system owns:

```text evidence collection
research
testing
monitoring
reassessment
surfacing contradictions
```

## 5. Thesis States

```text id="q7x3kp"
DRAFT
ACTIVE
SUPPORTED
WEAKENED
REJECTED
SUPERSEDED
ARCHIVED
```

These states describe the system's assessment of the thesis.

They do not automatically determine what the trader should do.

## 6. Thesis State Is Not Trader Decision

Example:

```text Thesis:
"Condition X will lead to outcome Y."

System:
THESIS = WEAKENED
```

This does not mean:

```text "Exit the position."
```

It means the evidence supporting the thesis has materially deteriorated.

## 7. Thesis Versioning

Every material thesis modification creates a new version.

```text id="p5c8mv"
THESIS v1
```text
    ↓
research
    ↓
THESIS ASSESSMENT
    ↓
```
THESIS v2
```

Previous versions remain accessible.

## 8. Thesis History

History records:

```text id="w4n8qx"
previous statement
new statement
reason
supporting research
contradicting research
actor
timestamp
```

The system must never overwrite historical thesis state.

## 9. Thesis Capture

A thesis can originate from:

```text trader explicitly states it
research workspace
saved thesis
previous session
framework evaluation
```

The system must distinguish explicit trader thesis from inferred interpretation.

## 10. Inferred Thesis Boundary

If the trader says:

```text "I'm starting to think this move is driven by liquidity."
```

The system may identify this as a possible thesis.

It should not automatically promote it to a persistent thesis.

## 11. Thesis Confirmation

For ambiguous inferred theses:

```text "Do you want me to treat this as your active thesis?"
```

Explicit confirmation establishes ownership.

## 12. Thesis Decomposition

Every material thesis should be decomposable into:

```text conclusion
claims
assumptions
dependencies
causal relationships
expected outcomes
invalidation conditions
```

Example:

```text THESIS
```text
  ↓
CLAIM A
  ↓
ASSUMPTION B
  ↓
DEPENDENCY C
  ↓
```
EXPECTED OUTCOME D
```

## 13. Thesis Claims

Each claim receives independent evaluation.

```text id="r8m3vc"
CLAIM {
  thesis_ref
  statement
  importance
  evidence_refs[]
  support_strength
  contradiction_strength
  status
  confidence
}
```

## 14. Assumption Tracking

Assumptions are first-class objects within the thesis.

Examples:

```text id="c5x9mq"
market condition remains stable
expected catalyst occurs
liquidity remains available
regulatory condition does not change
```

The system monitors assumptions when observable evidence exists.

## 15. Dependency Tracking

A thesis can depend on another condition.

```text id="v6m2pk"
THESIS
  ↓ depends_on
MARKET CONDITION
  ↓ depends_on
MACRO CONDITION
```

Material dependency changes can trigger reassessment.

## 16. Expected Outcomes

Every thesis may contain expected outcomes.

These are not predictions that must happen.

They are observable consequences that would provide support or contradiction.

```text id="q3n8vx"
EXPECTED_OUTCOME {
  description
  timeframe
  expected_conditions
  supporting_observations[]
  contradicting_observations[]
  status
}
```

## 17. Invalidation Conditions

Invalidation conditions define what would materially undermine the thesis.

They should be evidence-based.

Not:

```text arbitrary threshold
```

unless the trader explicitly specifies one.

## 18. Early Warning Conditions

An early warning is weaker than invalidation.

```text EARLY WARNING
      ↓
suggests thesis may be weakening

INVALIDATION
      ↓
material evidence against thesis
```

The distinction must remain explicit.

## 19. Monitor Generation

After thesis evaluation, the system may recommend monitoring:

```text thesis
→ identify material conditions
→ identify observable signals
→ define trigger conditions
→ propose monitor
→ trader confirmation
→ activate
```

## 20. No Silent Monitor Activation

Research may recommend monitoring.

It should not silently create an active consequential monitor unless the existing monitoring rules explicitly permit it.

Activation requires the established confirmation boundary.

## 21. Monitor Object

```text id="n7c4mx"
MONITOR {
  id
  target_ref
  target_type
  thesis_refs[]
  research_refs[]
  judgment_refs[]
  conditions[]
  signals[]
  trigger_rules[]
  severity
  frequency
  reassessment_policy
  status
  expiration
  lineage
  history
  provenance
}
```

## 22. Monitor Condition

```text id="m5x8qv"
MONITOR_CONDITION {
  id
  description
  signal
  expected_state
  trigger_type
  threshold
  evidence_requirement
  materiality
  severity
  status
  provenance
}
```

## 23. Trigger Types

```text id="v9c3mk"
THRESHOLD
STATE_CHANGE
EVENT
PATTERN
CONTRADICTION
NEW_EVIDENCE
TIME
DEPENDENCY_CHANGE
SOURCE_UPDATE
```

## 24. Trigger Semantics

A trigger should represent a meaningful research condition.

The system should not create arbitrary triggers merely to produce activity.

## 25. Evidence-Driven Monitoring

Monitoring should prefer:

```text observable evidence
+
meaningful interpretation
+
clear materiality
```

over noisy signals.

## 26. Monitor Frequency

Frequency may be:

```text REAL_TIME
HIGH
MEDIUM
LOW
EVENT_DRIVEN
ON_DEMAND
```

The actual capability depends on available data providers.

## 27. Frequency Personalization

Trader preferences can influence default frequency.

Explicit current instructions override preferences.

## 28. Monitor Severity

```text INFORMATIONAL
LOW
MEDIUM
HIGH
CRITICAL
```

Severity represents potential impact on the monitored thesis/research state.

It does not mean trade urgency.

## 29. Monitoring Pipeline

```text id="x8m4qp"
MONITOR
```text
   ↓
OBSERVE
   ↓
VALIDATE
   ↓
COMPARE WITH PRIOR STATE
   ↓
ASSESS MATERIALITY
   ↓
REASSESS CONDITION
   ↓
IF MATERIAL
   ↓
UPDATE RESEARCH STATE
   ↓
UPDATE JUDGMENT
   ↓
ASSESS THESIS
   ↓
```
ALERT TRADER
```

## 30. Noise Filtering

A monitor should suppress:

* duplicate observations
* immaterial fluctuations
* repeated unchanged states
* low-quality sources
* unsupported interpretations

The underlying evidence remains available when relevant.

## 31. Duplicate Alert Suppression

If the same material event is reported by multiple dependent sources:

```text one underlying event
+
multiple source confirmations
```

should normally produce one consolidated alert.

## 32. Materiality Assessment

For every detected change:

```text id="k6v3px"
Does this change:
- affect a thesis claim?
- affect an assumption?
- affect an expected outcome?
- affect an invalidation condition?
- affect the current judgment?
- change relevant evidence quality?
```

If no, no thesis reassessment may be necessary.

## 33. Proportional Reassessment

Not every monitor event requires a complete research restart.

```text minor event
→ condition update

material event
→ targeted reassessment

major contradiction
→ broader research

thesis invalidation
→ full thesis reassessment
```

## 34. Targeted Reassessment

A material change should first identify affected objects.

```text event
→ affected condition
→ affected claim
→ affected hypothesis
→ affected judgment
```

Only affected research should be reopened initially.

## 35. Full Reassessment

A full reassessment occurs when:

* multiple thesis claims are affected
* core assumption changes
* primary causal mechanism changes
* major contradiction appears
* thesis invalidation condition is met

## 36. Reassessment Object

```text id="r4n7cx"
REASSESSMENT {
  id
  trigger
  thesis_ref
  affected_claims[]
  affected_assumptions[]
  affected_dependencies[]
  new_evidence[]
  changed_conditions[]
  research_ref
  previous_assessment
  current_assessment
  confidence_change
  uncertainty_change
  recommended_action
  provenance
  history
}
```

## 37. Reassessment Trigger

Every reassessment must identify what caused it.

Possible triggers:

```text id="q8m5vx"
NEW_EVIDENCE
CONTRADICTION
INVALIDATION
EARLY_WARNING
DEPENDENCY_CHANGE
THESIS_UPDATE
SOURCE_UPDATE
JUDGMENT_CHANGE
MONITOR_EVENT
MANUAL_REQUEST
```

## 38. Evidence Validation Before Reassessment

A monitor event should not immediately alter a thesis.

First:

```text observation
→ source validation
→ evidence classification
→ materiality
→ reassessment
```

This prevents noisy or incorrect signals from destabilizing the thesis.

## 39. Reassessment Evidence

New evidence should be compared against:

```text existing evidence
historical evidence
supporting evidence
contradicting evidence
previous judgment
thesis assumptions
```

## 40. Evidence Freshness

If the trigger is stale or uncertain:

```text revalidate
```

before changing thesis state.

## 41. Thesis Assessment

Possible assessment:

```text id="x7m4kp"
STRENGTHENED
UNCHANGED
WEAKENED
MATERIALLY_WEAKENED
INVALIDATED
INCONCLUSIVE
```

## 42. Assessment vs State

The assessment describes the latest change.

The thesis lifecycle state describes the current thesis condition.

Example:

```text Assessment:
WEAKENED

Current state:
ACTIVE
```

The thesis can be weakened without being rejected.

## 43. Thesis Rejection

A thesis becomes:

```text REJECTED
```

only when evidence materially contradicts its core claims according to the research assessment.

The trader does not need to adopt that conclusion automatically.

## 44. Thesis Supersession

A thesis may become:

```text SUPERSEDED
```

when the trader explicitly replaces it with another thesis.

This is different from system assessment that the thesis failed.

## 45. Trader Rejection vs System Rejection

These are distinct events.

```text SYSTEM_ASSESSMENT = REJECTED
```

means evidence no longer supports the thesis.

```text TRADER_ACTION = REJECTED
```

means the trader chose to abandon it.

Both should be recorded separately.

## 46. Trader Thesis Update

The trader may say:

```text "My thesis has changed."
```

The system should create a new thesis version.

Previous research remains linked.

## 47. Thesis Modification

Modification may affect:

```text conclusion
claim
assumption
dependency
timeframe
expected outcome
invalidation condition
```

The affected monitor relationships must be reassessed.

## 48. Monitor Adaptation

When a thesis changes:

```text thesis version changes
        ↓
evaluate existing monitors
        ↓
related conditions still valid?
        ↓
YES → update lineage
NO  → stop/archive condition
```

## 49. Monitor Preservation

Monitor history remains available even when a thesis changes.

Past alerts must not disappear.

## 50. Monitor Lineage

```text id="c8m5vq"
MONITOR v1
```text
    ↓
THESIS v1
    ↓
THESIS v2
    ↓
MONITOR REVALIDATION
    ↓
```
MONITOR v2
```

The lineage explains why the monitor changed.

## 51. Monitor Revalidation

After thesis modification:

```text target still valid?
conditions still relevant?
signals still meaningful?
thresholds still valid?
research context still fresh?
```

## 52. Monitor Stop

Stop a monitor when:

* thesis becomes irrelevant
* objective is resolved
* condition is permanently invalid
* trader stops it
* thesis is superseded
* monitor is no longer informative

History remains preserved.

## 53. Monitor Pause

Pause when:

* data source temporarily unavailable
* thesis temporarily inactive
* trader explicitly pauses
* conditions require revalidation

Configuration remains intact.

## 54. Monitor Resume

On resume:

```text validate current context
validate freshness
validate conditions
validate thesis relationship
```

Then reactivate or recommend changes.

## 55. Stale Monitor

A monitor may become stale if:

```text data source changes
thesis changes
conditions change
market context changes
long pause occurs
```

Stale monitors require revalidation.

## 56. Automatic Thesis Reassessment

Automatic reassessment is allowed when:

```text trigger is clearly defined
+
evidence is sufficiently reliable
+
materiality is clear
```

Otherwise the system should alert and recommend reassessment.

## 57. Automatic Research Trigger

A monitor may initiate targeted research automatically when:

```text predefined condition
+
high-confidence trigger
+
known research path
```

exists.

Otherwise:

```text alert
→ recommend research
```

rather than silently launching an uncontrolled investigation.

## 58. Automatic Challenge

Automatic CHALLENGE may occur for:

```text clearly defined high-risk thesis conditions
```

such as a core invalidation condition being approached.

Otherwise challenge remains user-requested or recommended.

## 59. Thesis Judgment Loop

```text id="q6m3vx"
THESIS
```text
   ↓
RESEARCH
   ↓
JUDGMENT
   ↓
THESIS ASSESSMENT
   ↓
MONITOR
   ↓
NEW EVIDENCE
   ↓
REASSESSMENT
   ↓
NEW JUDGMENT
   ↓
```
THESIS ASSESSMENT
```

## 60. Judgment History

Every material reassessment preserves:

```text previous judgment
new judgment
triggering evidence
confidence change
uncertainty change
```

## 61. No Retroactive Rewrite

New evidence should not rewrite history.

Instead:

```text Previous judgment:
X

New evidence:
Y

Current judgment:
Z
```

All three remain traceable.

## 62. Confidence Change

Confidence may:

```text increase
decrease
remain stable
```

based on evidence.

A confidence change must have identifiable supporting reasons.

## 63. Uncertainty Change

New evidence may reduce uncertainty without changing the judgment.

Example:

```text judgment unchanged
uncertainty reduced
confidence increased
```

This is valid.

## 64. Judgment Change Without Thesis Change

A research judgment can change while the trader's thesis remains active.

The system should assess whether the change is material enough to challenge the thesis.

## 65. Thesis Change Without Judgment Change

The trader may change their thesis even when research has not changed.

The system records the trader's new belief without rewriting the evidence.

## 66. Contradiction Handling

If new evidence contradicts a thesis:

```text validate evidence
→ compare source quality
→ identify affected claim
→ assess materiality
→ challenge thesis
→ update assessment
```

Do not immediately mark the thesis invalid.

## 67. Repeated Contradictions

Repeated independent contradictions should increase reassessment priority.

They should not automatically determine the conclusion.

## 68. Supporting Evidence

Supporting evidence should also be monitored for degradation.

The system should detect when:

```text previously strong support becomes stale
```

or:

```text original source is corrected/retracted
```

## 69. Source Retraction

If a source supporting a thesis is corrected or retracted:

```text source update
→ evidence quality reassessment
→ dependent claims
→ hypotheses
→ judgment
→ thesis
```

Selective propagation is required.

## 70. Dependency Propagation

Strong propagation relationships:

```text supports
contradicts
depends_on
tests
caused_by
monitors
```

Materiality determines how far the change propagates.

## 71. Propagation Control

Every propagation event records:

```text id="m7q3vx"
origin_object
affected_objects[]
relationship_path
material_change
propagation_event_id
timestamp
```

This prevents hidden cascading changes.

## 72. Circular Dependency Protection

If:

```text Thesis → Monitor → Research → Thesis
```

creates a cycle, the system must prevent infinite reassessment.

Each propagation event gets an identity and traversal history.

## 73. Reassessment Deduplication

If multiple monitors detect the same underlying event:

```text consolidate event
→ perform one material reassessment
```

rather than repeatedly rerunning the same research.

## 74. Reassessment Cooldown

Where appropriate, the system may temporarily suppress repeated reassessment caused by the same unchanged condition.

The underlying evidence remains recorded.

## 75. Alert Escalation

If repeated monitoring signals strengthen the same concern:

```text INFORMATIONAL
→ LOW
→ MEDIUM
→ HIGH
```

based on materiality.

Severity must be evidence-driven.

## 76. Alert Resolution

An alert condition can become:

```text OPEN
ACKNOWLEDGED
INVESTIGATING
RESOLVED
EXPIRED
SUPERSEDED
```

The evidence remains in research history.

## 77. Acknowledgment

Trader acknowledgment means:

```text "I have seen this."
```

It does not mean:

```text "I agree."
```

## 78. Trader Response

The trader may:

```text investigate
challenge
ignore
pause
stop monitor
modify thesis
modify monitor
save research
```

Each action remains distinct.

## 79. Monitoring Recommendation

After reassessment, the system may recommend:

```text continue existing monitor
modify monitor
create new monitor
stop monitor
```

The recommendation is separate from activation.

## 80. Existing Monitor Extension

Extend an existing monitor when the new condition is directly related.

Otherwise create a separate monitor.

This prevents unrelated conditions from becoming one unmanageable monitor.

## 81. Thesis Recovery

A weakened thesis can strengthen again.

```text THESIS
```text
  ↓
WEAKENED
  ↓
new supporting evidence
  ↓
```
SUPPORTED
```

History preserves the complete trajectory.

## 82. Thesis Oscillation

The system should avoid rapidly flipping states from small evidence changes.

Materiality and evidence aggregation should stabilize state transitions.

## 83. Thesis Reassessment Frequency

Frequency should depend on:

```text thesis sensitivity
monitor conditions
data availability
materiality
freshness
```

Not all theses require continuous monitoring.

## 84. Thesis Expiration

A thesis may have a natural timeframe.

After expiration:

```text active monitoring may stop
thesis becomes historical
```

unless the trader extends or renews it.

## 85. Thesis Renewal

Renewal should create a new version or explicit lifecycle event.

Historical context remains linked.

## 86. Research-to-Thesis Relationship

```text id="f8m3qc"
RESEARCH
```text
  ├── SUPPORTS → THESIS
  ├── CONTRADICTS → THESIS
  ├── TESTS → THESIS
  └── INFORMS → THESIS
```
```

Research does not own the thesis.

## 87. Monitor-to-Thesis Relationship

```text id="v4n8mx"
MONITOR
```text
  ├── MONITORS → THESIS
  ├── MONITORS → CLAIM
  ├── MONITORS → CONDITION
  └── MONITORS → JUDGMENT
```
```

## 88. Reassessment-to-Thesis Relationship

```text id="q5m7cx"
REASSESSMENT
```text
  ├── TRIGGERED_BY → EVIDENCE
  ├── AFFECTS → CLAIM
  ├── AFFECTS → HYPOTHESIS
  ├── UPDATES → JUDGMENT
  └── EVALUATES → THESIS
```
```

## 89. Full Lifecycle

```text id="x3m8vq"
TRADER THESIS
```text
      ↓
DECOMPOSE
      ↓
RESEARCH
      ↓
CURRENT JUDGMENT
      ↓
IDENTIFY MATERIAL CONDITIONS
      ↓
PROPOSE MONITOR
      ↓
TRADER CONFIRMS
      ↓
MONITOR ACTIVE
      ↓
OBSERVE
      ↓
VALIDATE
      ↓
```
MATERIAL CHANGE?
   ↙          ↘
 NO            YES
```text
 ↓              ↓
CONTINUE      REASSESS
                ↓
           UPDATE JUDGMENT
                ↓
           ASSESS THESIS
                ↓
        ┌───────┼────────┐
        ↓       ↓        ↓
     SUPPORT WEAKEN   INVALIDATE
        ↓       ↓        ↓
```
    UPDATE    CHALLENGE   PAUSE/
    MONITOR   /RESEARCH   STOP
```

## 90. Reassessment Completion Criteria

A reassessment is complete when:

* triggering evidence is validated
* affected thesis components are identified
* materiality is assessed
* relevant research is updated
* current judgment is reassessed
* confidence/uncertainty are recalculated where warranted
* thesis status is assessed
* monitor conditions are revalidated
* trader-facing implications are surfaced
* history is preserved

## 91. Reassessment Does Not Mean Automatic Thesis Rewrite

The final state may be:

```text Thesis remains unchanged.
```

even after significant new research.

Or:

```text Thesis appears materially weakened.
```

The trader decides whether to modify the thesis.

## 92. Reassessment Output

```text id="n4c8mx"
REASSESSMENT_OUTPUT {
  trigger
  what_changed
  affected_thesis_components[]
  supporting_new_evidence[]
  opposing_new_evidence[]
  judgment_change
  thesis_assessment
  confidence_change
  uncertainty_change
  monitor_status
  recommended_next_step
  provenance[]
}
```

## 93. Trader-Facing Example

```text Thesis status: WEAKENED

What changed:
A new development contradicts one of the thesis's core assumptions.

Evidence:
2 relevant sources support the change.

What remains:
The central thesis mechanism is still possible, but its supporting assumption has weakened.

Monitoring:
Existing monitor remains active.

Recommended next step:
Reassess the affected claim.
```

The system should not turn this into an unsolicited trading instruction.

## 94. Global Integrity Rules

The loop must never:

* silently rewrite a thesis
* silently activate monitoring
* silently deactivate important monitoring
* treat one noisy signal as invalidation
* convert inference into evidence
* erase previous judgments
* erase previous thesis versions
* manufacture invalidation conditions
* fabricate monitoring data
* fabricate confidence
* turn reassessment into execution
* treat trader acknowledgment as agreement

## 95. Completion Criteria

Thesis → Monitor → Reassessment Loop is complete when:

* thesis ownership is explicit
* thesis versions are preserved
* claims and assumptions are decomposable
* expected outcomes exist
* invalidation conditions can be defined
* early warnings are distinct from invalidation
* monitoring can be proposed and activated
* monitor conditions are evidence-based
* materiality determines reassessment depth
* targeted reassessment is supported
* full reassessment is supported
* evidence is validated before thesis changes
* thesis states and assessment events are distinct
* trader decisions and system assessments are distinct
* monitor lineage is preserved
* thesis changes revalidate monitors
* source corrections propagate selectively
* contradictions trigger proportional reassessment
* repeated events are deduplicated
* thesis strengthening and weakening are reversible
* history is never silently rewritten
* automatic research/challenge is bounded
* no automatic trade execution occurs
* every material transition is traceable

## 96. Global Loop

```text id="c7m4vx"
THESIS
```text
   ↓
CLAIMS / ASSUMPTIONS / DEPENDENCIES
   ↓
RESEARCH
   ↓
EVIDENCE
   ↓
JUDGMENT
   ↓
THESIS ASSESSMENT
   ↓
MATERIAL CONDITIONS
   ↓
MONITOR
   ↓
NEW EVIDENCE
   ↓
VALIDATION
   ↓
MATERIALITY
   ↓
REASSESSMENT
   ↓
NEW JUDGMENT
   ↓
THESIS ASSESSMENT
   ↓
MONITOR REVALIDATION
   ↓
```
CONTINUE LOOP
```

## Core Principle

```text id="9v5m3q"
THE RESEARCH WORKBENCH SHOULD NOT TREAT
A THESIS AS A FINAL ANSWER.

A THESIS IS A LIVING CLAIM.

RESEARCH TESTS IT.
MONITORING WATCHES ITS CONDITIONS.
NEW EVIDENCE CAN STRENGTHEN OR WEAKEN IT.
REASSESSMENT KEEPS THE RESEARCH CURRENT.

BUT THE TRADER REMAINS THE OWNER OF THE THESIS
AND THE FINAL DECISION-MAKER.
