---
title: "RESEARCH TIMELINE & ACTIVITY INTELLIGENCE"
source: RESEARCH TIMELINE & ACTIVITY INTELL.txt
converted: 2026-09-12
type: architecture-spec
related: [workspace-presentation.md, research-object-model.md]
---

**Related documents:** `workspace-presentation.md` · `research-object-model.md`

> Converted from `RESEARCH TIMELINE & ACTIVITY INTELL.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

RESEARCH TIMELINE & ACTIVITY INTELLIGENCE

## 1. Purpose

Research Timeline & Activity Intelligence records and organizes the temporal evolution of research.

It answers:

- What happened?
- When did it happen?
- What was the system doing?
- What changed?
- Why did it change?
- Which evidence caused the change?
- Which judgment was active at each point?
- What did the trader do?
- What remains unresolved?

It connects:

RESEARCH EXECUTION
→ OBJECT STATE CHANGES
→ EVIDENCE
→ HYPOTHESES
→ ANALYSIS
→ JUDGMENT
→ THESIS
→ MONITORING
→ USER ACTIONS

The timeline is not merely an activity log.

It is a structured history of meaningful research evolution.

---

# 2. Core Principle

The timeline should preserve causally meaningful research history without overwhelming the trader with implementation noise.

Therefore:

```text
ALL MATERIAL EVENTS
+
SELECTED OPERATIONAL EVENTS
+
FULL AUDIT HISTORY
```

are maintained at different levels.

The trader sees material events by default.

Detailed operational history remains available when needed.

---

# 3. Timeline Model

```text id="t7p4qa"
RESEARCH_TIMELINE {
  id
  research_ref
  workspace_ref
  events[]
  current_position
  start_time
  last_updated
  filters
  presentation_state
  provenance
}
```

---

# 4. Timeline Event

```text id="j9c3vx"
TIMELINE_EVENT {
  id

  event_type
  category

  timestamp
  duration

  actor
  source_object
  affected_objects[]

  previous_state
  new_state

  trigger
  cause
  consequence

  materiality
  significance

  user_visible
  reversible

  provenance
  related_events[]
  propagation_event_ref

  status
}
```

---

# 5. Event Categories

Core categories:

```text id="2m5h7n"
RESEARCH
PLAN
EXECUTION
EVIDENCE
CLAIM
HYPOTHESIS
ANALYSIS
JUDGMENT
THESIS
FRAMEWORK
MONITOR
STATE
USER_ACTION
SOURCE
SYSTEM
```

---

# 6. Research Events

Examples:

```text id="v8r4ye"
Research created
Research activated
Research paused
Research resumed
Research scope changed
Research depth changed
Research target changed
Research completed
Research stopped
Research became stale
Research restored
Research invalidated
```

Only material research changes should normally appear in the primary timeline.

---

# 7. Plan Events

Examples:

```text id="8w5n1c"
Plan created
Task added
Task reprioritized
Branch created
Branch paused
Branch resumed
Branch completed
Plan replanned
Research depth expanded
Research scope narrowed
Research scope expanded
Completion criteria changed
```

The timeline should explain significant plan changes rather than showing every scheduler cycle.

---

# 8. Execution Events

Execution events include:

```text id="7z8m4k"
Task started
Task completed
Task failed
Tool invoked
Skill invoked
Tool failed
Capability substituted
Research branch started
Research branch blocked
Research branch resumed
```

These are primarily operational history.

Only material execution events should appear in the default timeline.

---

# 9. Evidence Events

Important evidence events include:

```text id="2f9p1a"
Evidence discovered
Evidence validated
Evidence contradicted
Evidence invalidated
Evidence became stale
Evidence corrected
New source discovered
Source updated
Source conflict detected
Discriminating evidence discovered
```

---

# 10. Hypothesis Events

Important hypothesis events include:

```text id="5u7k9d"
Hypothesis created
Hypothesis promoted
Hypothesis weakened
Hypothesis rejected
Hypothesis supported
Alternative hypothesis created
Hypothesis ranking changed
Hypothesis confidence changed materially
Hypothesis replaced
Hypothesis reactivated
```

A ranking change should be recorded only when materially meaningful.

---

# 11. Analysis Events

Examples:

```text id="m3w6qa"
Analysis started
Analysis completed
New analytical finding
Alternative explanation identified
Material contradiction resolved
Analysis revised
Analysis superseded
```

---

# 12. Judgment Events

Judgment events are especially important.

Examples:

```text id="y4c8bz"
Initial judgment created
Judgment revised
Judgment confidence changed materially
Judgment weakened
Judgment strengthened
Judgment became uncertain
Judgment superseded
Judgment became stale
```

Every material judgment revision should preserve the previous judgment.

---

# 13. Judgment Change Record

When a judgment changes materially, the timeline should capture:

```text id="r6f1qx"
PREVIOUS JUDGMENT
```text
        ↓
NEW EVIDENCE / CHANGE
        ↓
AFFECTED HYPOTHESIS
        ↓
NEW JUDGMENT
        ↓
```
CONFIDENCE CHANGE
```

Example:

```text
Judgment changed

Previous:
Macro risk-off was the leading explanation.

Trigger:
New derivatives evidence showed a significant liquidation event.

Current:
Liquidation pressure is now the leading explanation.

Confidence:
Moderate → Moderate

Reason:
New evidence changed hypothesis ranking but did not eliminate
macro risk-off as a contributing factor.
```

---

# 14. Thesis Events

Thesis timeline events include:

```text id="2n5g7w"
Thesis created
Thesis activated
Thesis evaluated
Thesis strengthened
Thesis weakened
Thesis rejected
Thesis version created
Thesis scope changed
Thesis invalidation condition changed
Thesis superseded
```

The system must distinguish thesis modification from thesis assessment.

---

# 15. Framework Events

Framework events include:

```text id="h7x4q2"
Framework created
Framework activated
Framework applied
Framework version created
Framework factor changed
Framework weighting changed
Framework rule changed
Framework archived
```

Historical evaluations retain the framework version that was used.

---

# 16. Monitor Events

Monitor timeline events include:

```text id="c5p8yn"
Monitor created
Monitor activated
Condition triggered
Alert generated
Reassessment performed
Monitor adapted
Monitor paused
Monitor resumed
Monitor expired
Monitor stopped
Monitor archived
```

Monitor events should link back to the research or thesis that created the monitoring context.

---

# 17. User Action Events

Important trader actions should be recorded.

Examples:

```text id="x4n7sa"
User changed scope
User changed depth
User challenged hypothesis
User created thesis
User modified thesis
User approved monitor
User paused branch
User restored research
User saved artifact
User changed framework
User overrode recommendation
```

The system should record the action's consequence, not necessarily the complete natural-language message.

---

# 18. Actor Model

Timeline events should identify the actor.

Possible actors:

```text id="9f5m2k"
TRADER
RESEARCH_AGENT
SCHEDULER
TOOL
SKILL
MONITOR
SYSTEM
```

Where multiple components contributed, the primary initiating actor should be recorded with related events preserving the execution chain.

---

# 19. Trigger

Every material event should identify what triggered it.

Possible triggers:

```text id="g8x3vp"
USER_REQUEST
NEW_EVIDENCE
CONTRADICTION
TOOL_RESULT
SOURCE_UPDATE
HYPOTHESIS_CHANGE
JUDGMENT_CHANGE
MONITOR_EVENT
TIME
RESTORATION
STATE_CHANGE
DEPENDENCY_PROPAGATION
```

---

# 20. Cause vs Trigger

The timeline should distinguish:

```text id="a5f8n2"
TRIGGER
```

from:

```text id="m7c2qd"
CAUSE
```

Example:

```text Trigger:
New derivatives data arrived.

Cause:
The new evidence contradicted a key assumption
behind the leading hypothesis.

Result:
Hypothesis ranking changed.
```

This prevents the timeline from confusing chronology with causality.

---

# 21. Consequence

Material events should record affected objects.

Example:

```text id="p8q4wc"
Evidence invalidated

Affected:
Claim A
Hypothesis B
Analysis C
Judgment D
Monitor E
```

The propagation graph remains available for deeper inspection.

---

# 22. Materiality

Each event receives an internal materiality classification.

Suggested levels:

```text id="f7y3kx"
TRIVIAL
MINOR
MATERIAL
MAJOR
CRITICAL
```

Default trader-facing timeline:

```text
MATERIAL
MAJOR
CRITICAL
```

Minor events may be surfaced when specifically relevant.

---

# 23. Materiality Criteria

An event is material when it may change:

* current judgment
* confidence
* hypothesis ranking
* thesis status
* framework evaluation
* research scope
* research direction
* evidence validity
* monitoring conditions
* decision-relevant uncertainty

---

# 24. Timeline Granularity

The timeline should support multiple levels:

```text id="q4x8mz"
SUMMARY
STANDARD
DETAILED
AUDIT
```

Summary:

```text
Major research changes only.
```

Standard:

```text
Material evidence, hypotheses, judgments, scope and execution changes.
```

Detailed:

```text
More operational events.
```

Audit:

```text
Full available event history.
```

---

# 25. Default Timeline

The default timeline should be concise.

Example:

```text id="e3x7qa"
TODAY

14:02 — Research started
14:08 — Macro evidence added
14:15 — Alternative hypothesis created
14:23 — Contradictory evidence discovered
14:31 — Leading hypothesis changed
14:34 — Judgment revised
```

---

# 26. Event Expansion

Selecting an event should reveal:

```text id="q6m9tb"
What happened
Why it happened
What triggered it
What changed
Affected objects
Evidence involved
Previous state
New state
Related events
```

---

# 27. Timeline → Object Navigation

Every meaningful event should be navigable to its underlying object.

Example:

```text id="w8r2kn"
"Judgment revised"
```text
        ↓
Open Judgment
        ↓
Open supporting evidence
        ↓
Open triggering evidence
        ↓
```
Open previous judgment
```

---

# 28. Timeline → Evidence Navigation

Evidence events should expose:

```text id="v6t4pm"
Source
Evidence observation
Timestamp
Claim relationship
Hypothesis relationship
Effect on judgment
```

---

# 29. Timeline → Hypothesis Navigation

Hypothesis events should expose:

```text id="s5m8dr"
Hypothesis
Previous status
New status
Supporting evidence
Contradicting evidence
Ranking change
Confidence change
Trigger
```

---

# 30. Timeline → Judgment Navigation

Judgment events should expose:

```text id="n2c7vk"
Previous judgment
Current judgment
Supporting evidence
Opposing evidence
Confidence
Uncertainty
Reason for change
```

---

# 31. Timeline → Thesis Navigation

Thesis changes should show:

```text id="r3p6yb"
Previous version
New version
Changed claims
Changed assumptions
Changed expected outcomes
Changed invalidation conditions
Reason
Actor
```

---

# 32. Timeline → Monitor Navigation

Monitor events should show:

```text id="j7k3px"
Condition
Signal
Previous status
New status
Reassessment
Affected judgment
Resulting adaptation
```

---

# 33. Event Grouping

Related events should be grouped.

Example:

```text id="p4m7vc"
14:20 — New derivatives evidence discovered

Expanded:
• Source retrieved
• Evidence extracted
• Claim updated
• Hypothesis ranking changed
• Judgment reassessed
```

The trader sees one material event by default.

---

# 34. Event Deduplication

The same underlying event should not appear repeatedly because multiple internal components processed it.

For example:

```text
Tool result
→ Evidence ingestion
→ Claim update
→ Hypothesis update
→ Analysis update
```

may be grouped into one material timeline event when appropriate.

Detailed history preserves the individual operations.

---

# 35. Timeline Causality

Where causality is known, events should be linked.

Example:

```text id="n4f6qy"
New evidence
```text
   ↓
Contradiction detected
   ↓
Hypothesis weakened
   ↓
Judgment revised
   ↓
```
Monitor reassessed
```

The timeline should distinguish known causal relationships from simple chronological sequence.

---

# 36. Event Ordering

Primary ordering uses timestamp.

Where events occur concurrently:

```text id="a8x5mz"
same timestamp
+
dependency order
+
causal relationship
```

should determine presentation ordering.

The system must not invent exact ordering where none exists.

---

# 37. Time Precision

The system should preserve the highest reliable timestamp available.

Possible precision:

```text id="e7k2pn"
YEAR
DATE
HOUR
MINUTE
SECOND
```

Unknown precision should remain unknown.

---

# 38. Time Zones

Timestamps should preserve their source timezone or UTC representation.

The interface may display local time while retaining canonical timestamp data.

Market/event timestamps should not be silently converted in a way that changes their meaning.

---

# 39. Historical Event Integration

Historical research may have its own timeline.

Historical events should be clearly separated from the current research timeline.

Example:

```text id="c2r8mq"
CURRENT RESEARCH
2026

Historical precedent
2024
2022
2020
```

Historical events should not appear as current research events.

---

# 40. Research Session Timeline

Each session may have a session timeline.

Example:

```text id="w7m2bc"
SESSION START
→ restored previous research
→ changed scope
→ challenged thesis
→ ran new research
→ saved updated artifact
→ session ended
```

Session history supports continuity.

---

# 41. Cross-Session Timeline

Research may span multiple sessions.

The research timeline therefore persists beyond a single conversation.

A session is an interaction boundary.

Research is the persistent intellectual object.

---

# 42. Session Re-entry

When the trader returns:

```text id="u4j8qa"
LAST SESSION
```text
        ↓
MATERIAL EVENTS SINCE LAST SESSION
        ↓
CURRENT JUDGMENT
        ↓
```
CURRENT RESEARCH STATE
```

The trader should not have to reconstruct the research manually.

---

# 43. "What Changed?" Queries

The timeline must support natural-language queries such as:

```text id="v5p7cx"
"What changed?"

"What changed since yesterday?"

"Why did the judgment change?"

"What changed in my thesis?"

"What happened after that evidence came in?"
```

These requests should use timeline + object graph + context.

---

# 44. "Since" Queries

The system should resolve temporal comparison requests:

```text id="n6z4wy"
since yesterday
since last session
since the last judgment
since the monitor started
since the thesis changed
```

The relevant baseline must be identified.

If multiple baselines are plausible, clarification is required.

---

# 45. Baseline

Timeline comparison requires a baseline.

Possible baseline:

```text id="y7m3pq"
TIME
SESSION
JUDGMENT VERSION
THESIS VERSION
SNAPSHOT
MONITOR ACTIVATION
USER-SPECIFIED EVENT
```

---

# 46. Timeline Comparison

The system may produce:

```text id="q8f4va"
BEFORE
AFTER
CHANGES
IMPACT
```

Example:

```text
Before:
Macro hypothesis leading.

After:
Liquidation hypothesis leading.

Why:
New derivatives evidence.

Impact:
Judgment explanation changed.
```

---

# 47. State Transition Events

Important object state changes should be represented as transitions.

Example:

```text id="m6q2rt"
HYPOTHESIS
LEADING → WEAKENED
```

or:

```text id="s3p8ky"
RESEARCH
ACTIVE → COMPLETED
```

State transitions should preserve prior state.

---

# 48. State Transition Cause

Where possible:

```text id="c7n4wp"
STATE CHANGE
```text
+
TRIGGER
+
CAUSE
+
```
ACTOR
```

Example:

```text
Hypothesis:
Leading → Weakened

Trigger:
Contradictory evidence

Actor:
Research Agent

Cause:
Key causal assumption no longer supported
```

---

# 49. Reversible Events

Events resulting from reversible actions should maintain references to the prior state.

This supports:

```text
UNDO
RESTORE
REVERT
```

through MANAGE_STATE.

---

# 50. Permanent Actions

Permanent deletion or destructive changes require explicit confirmation and should have an audit event.

Example:

```text id="k8r3fv"
Permanent deletion confirmed
Object:
Saved artifact X
Actor:
Trader
```

---

# 51. User Overrides

When the trader overrides the agent:

```text id="q5x9mb"
Agent recommendation:
Continue macro research.

Trader:
Stop macro branch.

Timeline:
Trader override
→ branch paused
→ scheduler reallocated resources
```

This preserves the decision boundary.

---

# 52. Research Replanning Events

When research adapts:

```text id="v3p7na"
REPLAN

Trigger:
New evidence

Changed:
Branch priorities
Research depth
Hypothesis testing order

Reason:
Evidence increased information value of alternative hypothesis.
```

---

# 53. Research Scope Changes

Scope changes should be explicitly recorded.

Example:

```text id="m8x2rq"
Scope changed

Previous:
BTC, 90 days, all domains

New:
BTC, 30 days, market + derivatives

Actor:
Trader
```

Previous research is preserved.

---

# 54. Research Depth Changes

Depth changes should be recorded when material.

Example:

```text id="c4p7zx"
Depth changed

Standard → Deep

Reason:
Trader requested deeper investigation.
```

---

# 55. Evidence Freshness Events

Important freshness changes should appear:

```text id="b6m2vy"
Evidence became stale
Source updated
Source corrected
Historical evidence revalidated
```

These events may trigger downstream reassessment.

---

# 56. Source Update Events

If a source is corrected or materially updated:

```text id="x7r4kc"
SOURCE UPDATED

Affected:
Evidence A
Claim B
Hypothesis C
Judgment D
```

The system should automatically evaluate whether the update is material.

---

# 57. Tool Failure Events

Tool failures should be represented proportionally.

Example:

```text id="f9m3qw"
Data source unavailable

Alternative source used.

Impact:
Low

Research continued.
```

The failure should become prominent only if it materially affects research quality.

---

# 58. Research Quality Events

Quality-control events may include:

```text id="j4n7sx"
Evidence conflict detected
Insufficient evidence detected
Source independence issue detected
Potential confirmation bias detected
Causal inference weakness detected
Historical analogy weakness detected
Framework integrity issue detected
```

These events should be presented when they materially affect the research.

---

# 59. Timeline Alerts

Timeline itself should not become an alert system.

Only material events requiring trader attention should be elevated to notifications.

MONITOR owns active monitoring alerts.

Timeline records the history.

---

# 60. Activity Feed vs Timeline

These are distinct.

```text id="x5m8cz"
ACTIVITY FEED
=
what the system is doing now

TIMELINE
=
what materially happened over time
```

Activity is live and transient.

Timeline is persistent and historical.

---

# 61. Live Activity

Live activity may show:

```text id="p7q4kn"
Searching regulatory sources...
Checking derivatives data...
Testing alternative hypothesis...
Cross-validating source...
Reassessing judgment...
```

This is not permanent unless it becomes materially relevant.

---

# 62. Activity Completion

Live activities transition into:

```text id="m3v8ry"
COMPLETED
FAILED
BLOCKED
CANCELLED
```

Only meaningful outcomes become timeline events.

---

# 63. Activity Cancellation

If the trader interrupts research:

```text id="q9x2bm"
Activity:
Macro investigation

Action:
Trader interrupted

Result:
Branch paused

Timeline:
Trader interruption recorded
```

---

# 64. Activity Concurrency

Concurrent tasks may appear together:

```text id="y6p4vz"
ACTIVE NOW

Macro analysis
Derivatives investigation
News cross-check
Historical comparison
```

The activity layer should avoid exposing unnecessary scheduler internals.

---

# 65. Research Completion Event

Completion should record:

```text id="n5r8cx"
Research completed

Objective:
Answered

Current judgment:
...

Confidence:
...

Remaining uncertainty:
...

Open questions:
...
```

Completion does not imply certainty.

---

# 66. Incomplete Completion

If the objective is only partially addressed:

```text id="z4m7qa"
Research completed provisionally

Reason:
Evidence ceiling reached

Current judgment:
Provisional

Unresolved:
...
```

---

# 67. Reopening Completed Research

New material evidence or a trader request may reopen research.

Timeline:

```text id="c8x5nr"
COMPLETED
→ NEW MATERIAL EVIDENCE
→ REOPENED
→ ACTIVE
```

The previous completion remains historical.

---

# 68. Research Supersession

If one research object replaces another:

```text id="f6q3vy"
Research A
SUPERSEDED BY
Research B
```

The relationship and reason should be preserved.

---

# 69. Timeline Persistence

Timeline events should persist independently of the current conversation.

They belong to the research/workspace history.

---

# 70. Retention

Major research history should persist for the useful life of the research object.

Minor operational events may use system-defined retention.

The retention policy must not remove material provenance required to understand a judgment.

---

# 71. Event Integrity

Timeline events must never claim:

* an action occurred when it did not
* a source was consulted when it was not
* evidence changed when it did not
* a user approved something they did not approve
* a tool succeeded when it failed

Every event must be grounded in actual system state.

---

# 72. Event Provenance

Each material event should link to:

```text id="a3p8wy"
source object
actor
trigger
affected objects
timestamp
related evidence
related action
```

This creates an auditable history.

---

# 73. Timeline Search

Natural-language timeline queries should be supported.

Examples:

```text id="q7n4mp"
"Show me every time the thesis weakened."

"What caused the biggest change in confidence?"

"Find when the liquidation hypothesis became leading."

"What happened after the Fed announcement?"
```

Timeline Intelligence resolves the temporal request and relevant objects.

---

# 74. Timeline Filtering

Supported filters may include:

```text id="s8k2qx"
time
event type
actor
object
branch
hypothesis
source
materiality
status
```

Filtering changes presentation only.

---

# 75. Timeline Grouping

Events may be grouped by:

```text id="w3p7cz"
DATE
SESSION
RESEARCH PHASE
HYPOTHESIS
BRANCH
OBJECT
EVENT TYPE
```

Default grouping should favor chronological research phases.

---

# 76. Research Phases

The timeline may identify phases such as:

```text id="m5q8vr"
INTAKE
PLANNING
DISCOVERY
INVESTIGATION
CONTRADICTION
SYNTHESIS
JUDGMENT
MONITORING
REASSESSMENT
```

Phases are presentation constructs unless explicitly represented by execution state.

---

# 77. Timeline and Progressive Disclosure

Default:

```text id="p8c4ny"
Material events
```

Expand:

```text
Related evidence
Related hypotheses
State transitions
```

Deep:

```text
Execution operations
Tool results
Source retrieval
Scheduler events
```

---

# 78. Timeline and Workspace

The timeline should be accessible from the primary workspace.

The trader should be able to move from:

```text id="r4n7bx"
Current Judgment
```text
→
Why it changed
→
Timeline event
→
Triggering evidence
→
```
Previous judgment
```

---

# 79. Timeline and Object Graph

Timeline events are temporal representations of object-graph changes.

The graph answers:

```text
WHAT IS CONNECTED?
```

The timeline answers:

```text
WHEN DID IT CHANGE?
```

Both should remain linked.

---

# 80. Timeline and Memory

Historical research memory may reference timeline events.

However, timeline history is not automatically promoted to persistent memory.

Memory decides what should remain reusable beyond the research session.

---

# 81. Timeline and Save

Saving a research artifact should preserve relevant timeline provenance.

The saved artifact should indicate:

```text id="z6m3pk"
Research version
Judgment version
Framework version where applicable
Relevant snapshot
Saved timestamp
```

---

# 82. Timeline and Monitor

Monitor events extend the research timeline.

A monitor alert may produce:

```text id="k5r8mv"
Signal detected
→ Reassessment
→ Judgment unchanged
```

or:

```text
Signal detected
→ Reassessment
→ Judgment materially changed
→ Thesis weakened
```

The complete transition should be traceable.

---

# 83. Timeline and Challenge

A challenge should create a meaningful timeline event when it materially changes research.

Example:

```text id="v9c4px"
Challenge completed

Result:
Thesis partially weakened

New:
Alternative explanation elevated

Impact:
Research reopened
```

---

# 84. Timeline and Analyze

Analytical revisions become timeline events only when material.

Minor recalculations should remain operational history.

---

# 85. Timeline and MANAGE_STATE

State changes initiated through MANAGE_STATE may produce timeline events.

Examples:

```text
Scope changed
Branch paused
Research restored
Evidence hidden
Snapshot restored
Framework version selected
```

Presentation-only operations should generally not enter the research timeline.

---

# 86. Timeline and LUI

Natural-language timeline actions include:

```text id="x7m3qk"
"Show me what changed."

"Go back to the judgment before the liquidation evidence."

"What happened after this?"

"Show the last three major changes."

"Why did confidence fall?"
```

These should resolve into timeline queries, state restoration, or analysis depending on intent.

---

# 87. Timeline Restoration

The timeline should support restoration references but should not directly mutate state.

Example:

```text id="m4q7vz"
"Go back to before the thesis changed."
```

Timeline identifies the relevant historical state.

MANAGE_STATE performs restoration.

---

# 88. Timeline Integrity With Restoration

Restoring a prior state must not erase subsequent history.

Instead:

```text id="r8p2yc"
Current state
```text
    ↓
Restore prior snapshot
    ↓
New state created
    ↓
```
Previous history preserved
```

The restoration itself becomes a timeline event.

---

# 89. Timeline Branching

Restoring an earlier state may create a new research path.

Example:

```text id="c6m9wp"
Original research
```text
       ↓
State at T1
       ↓
Research continues to T2
       ↓
Restore T1
       ↓
```
New branch of research
```

Original history remains intact.

---

# 90. Timeline Comparison Across Research

The system may compare related research timelines.

Example:

```text id="p3x8vq"
Compare:
BTC research
vs
ETH research
```

Comparison should identify meaningful differences in:

* evidence
* hypotheses
* judgments
* confidence
* conclusions
* research evolution

It must not imply that unrelated timelines are directly comparable without sufficient context.

---

# 91. Timeline Completion Criteria

Timeline Intelligence is complete when:

* material research events are recorded
* state transitions are preserved
* evidence and judgment changes are traceable
* user actions are distinguishable
* causes and triggers are separated
* activity and historical timeline are distinct
* events can be grouped and filtered
* object navigation works
* restoration does not erase history
* cross-session continuity works
* historical information remains distinct from current evidence
* timeline does not overwhelm the primary workspace
* natural-language temporal queries are supported

---

# 92. Global Timeline Loop

```text id="7m4x9p"
SYSTEM / TRADER ACTION
```text
        ↓
STATE OR RESEARCH CHANGE
        ↓
IDENTIFY EVENT
        ↓
IDENTIFY ACTOR
        ↓
IDENTIFY TRIGGER
        ↓
IDENTIFY CAUSE
        ↓
IDENTIFY AFFECTED OBJECTS
        ↓
ASSESS MATERIALITY
        ↓
RECORD EVENT
        ↓
LINK OBJECT GRAPH
        ↓
UPDATE ACTIVITY / TIMELINE
        ↓
SURFACE MATERIAL CHANGE
        ↓
PRESERVE HISTORY
        ↓
```
ENABLE FUTURE RECONSTRUCTION
```

# Global Principle

The timeline should make research evolution reconstructable.

**Not just what the system currently thinks, but how it got there, what changed its mind, what the trader changed, which evidence caused the change, and what happened afterward.**

The activity feed tells the trader what is happening now.

The timeline tells the trader what happened over time.

The object graph tells the trader how everything is connected.

Together, they provide temporal, structural, and evidentiary traceability.

```
```
