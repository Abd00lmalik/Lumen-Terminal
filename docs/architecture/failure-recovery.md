---
title: "ERROR, FAILURE & RECOVERY INTELLIGENCE"
source: ERROR, FAILURE & RECOVERY INTELLIGE.txt
converted: 2026-09-12
type: architecture-spec
related: [quality-control.md, tool-skill-orchestration.md, execution-scheduler.md]
---

**Related documents:** `quality-control.md` · `tool-skill-orchestration.md` · `execution-scheduler.md`

> Converted from `ERROR, FAILURE & RECOVERY INTELLIGE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

ERROR, FAILURE & RECOVERY INTELLIGENCE

## 1. Purpose

Error, Failure & Recovery Intelligence defines how the research workbench behaves when something goes wrong.

Failures may occur in:

- intent resolution
- target resolution
- context resolution
- planning
- scheduling
- source discovery
- source retrieval
- data providers
- Bitget Skills
- external tools
- extraction
- evidence validation
- hypothesis investigation
- analysis
- synthesis
- state management
- persistence
- monitoring
- memory retrieval
- restoration

The system must remain truthful, preserve research integrity, avoid silently degrading evidence quality, and recover whenever possible.

Global principle:

FAILURE MUST REDUCE CAPABILITY BEFORE IT REDUCES TRUTHFULNESS.

The system should never hide a failure merely to produce a more complete-looking answer.
```

# 2. Failure Model

```text id="p4v8cx"
FAILURE {
  id
  type
  stage
  severity
  affected_objects[]
  affected_tasks[]
  affected_capabilities[]
  detected_at
  detected_by
  cause
  symptoms
  recoverability
  retry_policy
  fallback_policy
  impact
  user_visible
  resolution
  provenance
  history
}
```

# 3. Failure Categories

Core categories:

```text id="0f4r1a"
INTENT_FAILURE
CONTEXT_FAILURE
TARGET_FAILURE
PLANNING_FAILURE
SCHEDULING_FAILURE
TOOL_FAILURE
SKILL_FAILURE
SOURCE_DISCOVERY_FAILURE
SOURCE_RETRIEVAL_FAILURE
EXTRACTION_FAILURE
DATA_QUALITY_FAILURE
EVIDENCE_FAILURE
HYPOTHESIS_FAILURE
ANALYSIS_FAILURE
SYNTHESIS_FAILURE
STATE_FAILURE
PERSISTENCE_FAILURE
MEMORY_FAILURE
MONITOR_FAILURE
RESTORATION_FAILURE
NETWORK_FAILURE
AUTHENTICATION_FAILURE
RATE_LIMIT_FAILURE
TIMEOUT
RESOURCE_EXHAUSTION
UNKNOWN_FAILURE
```

# 4. Failure Severity

```text id="j7zq3e"
TRIVIAL
MINOR
MATERIAL
MAJOR
CRITICAL
```

Severity depends on research impact, not merely technical seriousness.

A failed optional sentiment provider may be minor.

A failed primary source needed to establish a core claim may be major.

# 5. Failure Impact

Every failure should be assessed against:

```text id="r3v5ay"
CURRENT RESEARCH OBJECTIVE
CORE CLAIMS
LEADING HYPOTHESES
CURRENT JUDGMENT
CONFIDENCE
COMPLETION CRITERIA
TIME SENSITIVITY
TRADER CONSTRAINTS
```

A technical failure that does not affect the research should not unnecessarily interrupt the trader.

# 6. Failure State

Failed work should not automatically become:

```text
REJECTED
FALSE
CONTRADICTED
INVALID
```

Failure to retrieve evidence is not evidence against the claim.

Example:

```text
Source unavailable
≠
Claim disproven
```

# 7. Task Failure

Tasks use:

```text id="m2v8ks"
PENDING
READY
RUNNING
BLOCKED
PAUSED
COMPLETED
FAILED
CANCELLED
```

A failed task preserves:

* objective
* attempted execution
* failure
* partial results
* provenance
* retry history

It may be retried, replaced, escalated, or abandoned.

# 8. Failure Detection

Failures may be detected by:

```text id="x1n7jd"
SYSTEM
SCHEDULER
TOOL
SKILL
SOURCE LAYER
EVIDENCE LAYER
ANALYSIS LAYER
MONITOR
TRADER
```

The system must distinguish an actual failure from:

* empty results
* insufficient evidence
* contradictory evidence
* unavailable information
* normal research uncertainty

# 9. Failure vs Insufficient Evidence

These are different states.

```text id="8d2z4m"
FAILURE:
The system could not retrieve the required information.

INSUFFICIENT EVIDENCE:
The system retrieved available information,
but it is not sufficient for a strong conclusion.
```

The distinction must remain visible.

# 10. Failure vs Negative Evidence

A source returning no relevant information is not necessarily evidence against a claim.

The system should distinguish:

```text id="v6j9qs"
NO RESULT
NEGATIVE RESULT
UNAVAILABLE RESULT
FAILED RETRIEVAL
```

# 11. Automatic Recovery

The system should attempt recovery automatically when:

* the failure is transient
* retry is safe
* the task remains relevant
* retry limits have not been reached
* no consequential state change is involved

Recovery should be proportional to the failure.

# 12. Retry Policy

```text id="s9h4wm"
RETRY {
  max_attempts
  backoff
  retry_conditions
  alternate_strategy
  escalation_condition
}
```

Retries should not continue indefinitely.

# 13. Retry Limits

Retry limits depend on:

```text id="n2b7fv"
failure type
tool reliability
time sensitivity
research importance
resource cost
alternative availability
```

High-value tasks may receive more recovery effort.

# 14. Exponential / Adaptive Backoff

Transient failures such as:

* network errors
* temporary provider errors
* rate limits

should use appropriate backoff.

Rate-limit failures should respect provider constraints.

# 15. Alternative Tool Recovery

If a tool fails and another capability can satisfy the same information requirement, the orchestrator may substitute it.

Example:

```text
PRIMARY MARKET DATA TOOL
        ↓ failure
ALTERNATIVE MARKET DATA PROVIDER
        ↓
VALIDATE OUTPUT
        ↓
CONTINUE
```

The substitute must not be treated as equivalent automatically.

# 16. Capability Substitution

Substitution should preserve:

```text
information requirement
required evidence type
freshness requirement
quality requirement
scope
```

If the substitute is materially weaker, the research state should record that limitation.

# 17. Skill Failure

If a Bitget Skill fails:

```text id="g3p8zn"
identify failed capability
→ determine whether partial output exists
→ validate partial output
→ retry
→ substitute capability if available
→ continue
```

A failed Skill should not automatically fail the entire research.

# 18. Partial Skill Results

Partial output may be retained only when its provenance and completeness are clear.

Example:

```text
Skill returned 7 of 10 requested indicators.

Available:
7 validated observations.

Missing:
3 indicators.
```

The missing information must not be silently filled.

# 19. Tool Output Validation

Tool output should be validated before entering the evidence graph.

Check:

```text id="u8m2pl"
schema
source
timestamp
freshness
completeness
entity
timeframe
units
consistency
limitations
```

Malformed output should be rejected or quarantined.

# 20. Tool Failure and Evidence

A tool failure must never create evidence.

```text
TOOL FAILURE
≠
EVIDENCE
```

Only successfully retrieved and validated information enters the evidence layer.

# 21. Source Retrieval Failure

Possible states:

```text id="h2j6va"
TEMPORARILY_UNAVAILABLE
BLOCKED
PAYWALLED
REMOVED
BROKEN
TIMEOUT
AUTHENTICATION_REQUIRED
RATE_LIMITED
UNKNOWN
```

The source object preserves the access state.

# 22. Retrieval Fallback

For an important source:

```text id="q8m1ct"
retry
→ alternate endpoint
→ alternate representation
→ primary-source alternative
→ independent source
→ mark unavailable
```

The system must not fabricate the missing source content.

# 23. Primary Source Failure

If a primary source is unavailable:

The system may use reliable secondary sources where appropriate.

But the final result should distinguish:

```text
PRIMARY SOURCE VERIFIED
```

from:

```text
SECONDARY REPORTING USED
```

# 24. Source Contradiction

A source disagreement is not a retrieval failure.

It enters the evidence/conflict pipeline.

```text
SOURCE A
      ↘
       CONFLICT
      ↗
SOURCE B
```

Evidence Intelligence determines how the conflict affects the judgment.

# 25. Extraction Failure

If a document or source is accessible but information cannot be extracted:

```text id="n5w3qk"
preserve source
record extraction failure
attempt alternate extraction
attempt structured endpoint if available
retry
mark extraction incomplete
```

Do not treat unreadable information as evidence.

# 26. Entity Resolution Failure

If the system cannot confidently determine which asset, protocol, company, event, or entity is intended:

```text id="c6z4hp"
clarify before material research
```

Do not silently select a similarly named entity.

# 27. Timeframe Resolution Failure

If the requested timeframe materially affects the answer and cannot be resolved:

```text id="w1y8mr"
clarify timeframe
```

If ambiguity is immaterial, use the strongest contextual interpretation and record it.

# 28. Intent Resolution Failure

If multiple research flows are equally plausible:

```text id="d8f2qa"
ASK ONE MINIMAL CLARIFICATION
```

Do not launch a large investigation based on an uncertain intent.

# 29. Context Failure

If context cannot determine what "this", "that", "it", or similar references mean:

```text id="e4p9bx"
preserve current state
identify ambiguity
ask targeted clarification
```

No unrelated research should be started.

# 30. Planning Failure

If a coherent research plan cannot be produced:

The system should simplify the plan.

```text
COMPLEX PLAN
    ↓ failure
REDUCED PLAN
    ↓ failure
MINIMUM VIABLE RESEARCH
    ↓
CLARIFY OR STOP
```

The trader should not receive a false sense of completeness.

# 31. Scheduler Failure

If scheduling fails:

* preserve current tasks
* preserve completed results
* avoid duplicate execution
* recover scheduler state
* resume from last consistent checkpoint

# 32. Duplicate Execution Protection

Recovery must prevent the same task from being unknowingly executed twice and treated as independent evidence.

Every execution should have an execution identifier.

```text id="e7h2kc"
EXECUTION_ID
TASK_ID
ATTEMPT_ID
PROVIDER
TIMESTAMP
```

# 33. Branch Failure

A failed branch does not automatically invalidate its hypothesis.

Example:

```text
Branch failed to retrieve derivatives data.

Result:
Derivatives hypothesis remains UNRESOLVED.

Not:
Derivatives hypothesis REJECTED.
```

# 34. Branch Recovery

A failed branch may:

* retry
* change source
* change tool
* reduce scope
* increase scope
* pause
* be replaced by another branch
* be cancelled

Parent research remains intact.

# 35. Branch Isolation

A failed branch should not corrupt unrelated branches.

```text
BRANCH A failure
        ↓
BRANCH B continues
BRANCH C continues
```

Only materially dependent work should be affected.

# 36. Dependency Failure

If object A depends on failed object B:

```text id="h5p1kc"
identify dependency
→ assess materiality
→ mark dependent work
→ pause/revalidate if necessary
```

Unrelated objects remain active.

# 37. Cascading Failure Prevention

Propagation must stop when:

* dependency is no longer material
* affected object has independent sufficient evidence
* the same propagation event already processed the object
* further propagation would be speculative

Use propagation event identifiers as defined in Object Relationships Intelligence.

# 38. Evidence Failure

Evidence may become:

```text id="z2x6fw"
CONTESTED
STALE
INVALID
```

when new information undermines its validity.

The system should identify all material claims and hypotheses affected.

# 39. Evidence Correction

If a source corrects previous information:

```text
OLD EVIDENCE
→ mark affected state
→ create/update corrected evidence
→ reassess claims
→ reassess hypotheses
→ reassess analysis
→ reassess judgment
```

Old evidence remains historically visible.

# 40. Evidence Invalidity

Invalid evidence should be excluded from current decision-making.

It remains available for provenance/history.

# 41. Analysis Failure

If analysis cannot reach a defensible conclusion:

Valid output may be:

```text
Insufficient evidence for a strong conclusion.
```

The system should not force a conclusion merely because analysis was requested.

# 42. Hypothesis Failure

A hypothesis may fail because:

* evidence contradicts it
* assumptions fail
* expected observations do not appear
* a stronger alternative emerges

That is an analytical outcome.

It is different from a technical failure.

# 43. Hypothesis Investigation Failure

If the system cannot adequately test a hypothesis:

```text
HYPOTHESIS STATUS:
INCONCLUSIVE
```

not:

```text
REJECTED
```

unless evidence actually supports rejection.

# 44. Synthesis Failure

If cross-domain synthesis cannot reconcile available evidence:

The system should preserve the conflict.

```text
Cross-domain evidence remains unresolved.

Market data supports X.
Macro evidence supports Y.
The available evidence does not establish which effect dominates.
```

Confidence may decrease.

# 45. Judgment Failure

If a judgment cannot be responsibly formed:

```text
CURRENT JUDGMENT:
INSUFFICIENT EVIDENCE
```

This is a valid research outcome.

# 46. Confidence Under Failure

Failures should affect confidence only when they materially limit the basis for the judgment.

Example:

```text
Optional sentiment provider failed.
→ no meaningful confidence change.

Primary evidence unavailable.
→ confidence may decrease.
```

# 47. Completion Under Failure

Research may complete with unresolved failures if:

* the objective is still adequately addressed
* failures do not materially affect the conclusion
* remaining information has low expected value

Otherwise the research remains incomplete.

# 48. Incomplete Research

Research status should clearly indicate incomplete work.

Possible presentation:

```text
Judgment: Moderate confidence

Research limitation:
The primary regulatory filing could not be retrieved.
Secondary reporting was used instead.
```

# 49. Research Completion Gate

Before marking research COMPLETED:

```text id="m8y3rs"
critical tasks complete?
material failures resolved or accepted?
required evidence available?
important contradictions assessed?
current judgment supported?
uncertainty represented?
known limitations recorded?
```

# 50. Failure Acceptance

A trader may explicitly accept a limitation.

Example:

```text
"Proceed with what you have."
```

The system may continue with incomplete evidence but must preserve the limitation.

# 51. Explicit Failure Override

Trader instructions may override ordinary recovery effort:

```text
"Don't retry."
"Use whatever source is available."
"Stop researching."
```

Hard system integrity rules remain unchanged.

# 52. Failure Transparency

Material failures should be visible.

Minor internal failures need not interrupt the trader if they have no material impact.

Default:

```text
MATERIAL → visible
MINOR → summarized when relevant
TRIVIAL → internal
```

# 53. Failure Presentation

Material failure presentation should answer:

```text
WHAT FAILED?
WHY?
WHAT WAS AFFECTED?
WHAT WAS RECOVERED?
WHAT REMAINS MISSING?
DOES IT AFFECT THE JUDGMENT?
```

# 54. Failure Notifications

The trader should not receive an alert for every technical error.

Notifications are based on materiality.

Example:

```text
"One optional data provider failed; another source covered the requirement."
```

No interruption necessary.

Versus:

```text
"Primary evidence for a core claim is unavailable.
Confidence has been reduced."
```

Material notification required.

# 55. Recovery Strategy Selection

Recovery should consider:

```text id="x9p3kd"
research importance
failure type
time sensitivity
available alternatives
expected information value
resource cost
source quality
current confidence
trader constraints
```

# 56. Recovery Modes

```text id="e7q4ps"
RETRY
SUBSTITUTE
REDUCE_SCOPE
EXPAND_SCOPE
REPLAN
PAUSE
ESCALATE
CONTINUE_WITH_LIMITATION
STOP
CLARIFY
```

# 57. Automatic Recovery Boundary

Automatic recovery is allowed for routine operational failures.

Clarification is required when recovery would materially change:

* research objective
* target
* thesis
* framework
* persistent state
* monitoring
* consequential interpretation

# 58. Replanning After Failure

A failure may trigger replanning.

Example:

```text
Primary source unavailable
```text
        ↓
Search independent secondary sources
        ↓
Compare coverage
        ↓
Determine whether evidence suffices
        ↓
```
Continue / escalate / stop
```

The original plan remains in history.

# 59. Recovery History

Every material recovery should record:

```text id="b5n8lc"
failure
attempt
recovery strategy
result
affected objects
state change
```

This integrates with Research Timeline Intelligence.

# 60. Failure and Timeline

Timeline should record material failures such as:

* primary source unavailable
* major tool failure
* branch failure
* evidence invalidation
* judgment affected by failure
* recovery
* research resumed

Minor retries should normally remain out of the visible timeline.

# 61. Failure and Provenance

Failed operations should not create false provenance.

The system must never claim:

```text "Source consulted"
```

when the retrieval failed.

Instead:

```text "Source retrieval attempted but failed."
```

# 62. Failure and Memory

Failures should not automatically become persistent memory.

A recurring provider limitation may be useful historical knowledge.

A one-off timeout generally is not.

# 63. Failure and Save

Saving incomplete research must preserve:

```text incomplete status
known failures
limitations
current confidence
provenance
```

The saved artifact must not appear to be a completed conclusion.

# 64. Failure and Monitor

If a monitor's data source fails:

```text
retry
→ alternate source
→ determine whether condition can still be evaluated
```

If monitoring can no longer reliably evaluate a critical condition:

```text
mark condition degraded
→ notify trader if material
→ pause if necessary
```

The monitor must not generate false alerts from missing data.

# 65. Missing Data During Monitoring

Missing data should not automatically mean:

```text condition triggered
```

It should be:

```text condition unknown
```

unless the monitoring condition explicitly defines missing data as meaningful.

# 66. Monitor Recovery

A paused monitor may resume after:

```text source recovery
context validation
condition revalidation
freshness check
```

Long-paused monitors follow the existing restoration rules.

# 67. Persistence Failure

If the system cannot persist a material state change:

```text preserve in-memory/session state
record persistence failure
attempt recovery
avoid claiming successful persistence
```

The trader must be informed if the failure could cause loss of important state.

# 68. Checkpoint Recovery

Automatic checkpoints should protect against:

* runtime crash
* connection failure
* service interruption
* state corruption

Recovery should restore the latest consistent checkpoint rather than the latest partially written state.

# 69. Transactional State Updates

Material multi-object changes should be atomic where possible.

Example:

```text Judgment updated
```text
+
Hypothesis status updated
+
Timeline event recorded
+
```
Dependency propagation recorded
```

If the operation cannot complete consistently, the system should roll back or mark the affected state as incomplete.

# 70. State Corruption

If object relationships become inconsistent:

```text detect
→ isolate affected objects
→ restore last valid state
→ revalidate dependencies
→ preserve corrupted state as diagnostic history where appropriate
```

Do not silently delete corrupted objects.

# 71. Restoration Failure

If an old snapshot cannot be restored:

```text preserve current state
identify unavailable objects
restore what can safely be restored
report incomplete restoration
```

Never pretend a partial restoration is complete.

# 72. Memory Retrieval Failure

If relevant memory cannot be retrieved:

The system may continue using current conversation/workspace state.

It must not claim that historical context was considered if it was not successfully retrieved.

# 73. Authentication Failure

Authentication failures should be distinguished from:

```text source unavailable
tool unavailable
empty result
invalid data
```

Credentials must never be exposed in explanations, logs, or research objects.

# 74. Rate Limit Handling

When rate-limited:

```text respect provider limit
→ backoff
→ alternate provider if appropriate
→ continue other independent tasks
```

Do not repeatedly hammer the provider.

# 75. Network Failure

Network failure should preserve completed work.

Independent local or cached work may continue when safe.

# 76. Resource Exhaustion

If research exceeds resource limits:

```text prioritize highest-value work
→ pause low-value branches
→ preserve critical research
→ inform trader if completion is materially affected
```

This integrates with Scheduler resource allocation.

# 77. Time Constraint Failure

If a trader requests:

```text "Give me the answer in 2 minutes."
```

the system should adapt depth and resource allocation.

If the deadline prevents adequate research:

```text provide provisional result
+
explicit limitation
```

rather than pretending exhaustive research occurred.

# 78. Freshness Failure

If current information cannot be established:

```text current evidence unavailable
```

Historical information may still be used as context, clearly labeled.

# 79. Recovery and Evidence Independence

A fallback source must not be treated as independent merely because it came from a different provider.

Source lineage and duplication detection remain active.

# 80. Recovery and Confidence

Recovery should update confidence only when the recovered evidence materially changes the evidence base.

A successful technical retry alone should not alter confidence.

# 81. Recovery and Judgment

When recovered evidence changes the judgment:

```text preserve previous judgment
→ create new current judgment
→ record trigger
→ update confidence
→ update timeline
→ propagate dependencies
```

# 82. Trader-Initiated Recovery

Natural language may control recovery:

```text
"Retry that source."
"Use another provider."
"Skip sentiment."
"Go with secondary sources."
"Stop this branch."
"Continue with what you have."
```

These map to MANAGE_STATE, RESEARCH, or orchestration actions as appropriate.

# 83. Recovery Confirmation Boundary

No confirmation for ordinary operational recovery.

Confirmation may be required when recovery changes:

* persistent preferences
* saved frameworks
* monitoring activation
* consequential persistent state
* destructive state
* permanent deletion

# 84. Unknown Failure

When the cause is unknown:

```text cause = UNKNOWN
```

Do not invent a technical explanation.

The system should report:

```text
The operation failed for an unknown reason.
Recovery attempts were unsuccessful.
```

# 85. Failure Escalation

Escalation occurs when:

* retries fail
* alternatives fail
* the objective remains materially affected
* the failure affects a core claim
* system integrity is uncertain

Possible escalation:

```text retry
→ alternative
→ replan
→ clarify
→ stop with limitation
```

# 86. Failure Containment

Failures should remain localized whenever possible.

```text
ONE TOOL FAILURE
≠
RESEARCH FAILURE

ONE BRANCH FAILURE
≠
WORKSPACE FAILURE

ONE SOURCE FAILURE
≠
CLAIM FAILURE
```

# 87. Failure Recovery and Anti-Bias

Recovery should not selectively search only for evidence supporting the leading hypothesis.

When a major source or branch fails, replacement research should preserve the original information requirement and include contradiction/alternative searches where relevant.

# 88. Recovery and Research Balance

If one hypothesis loses a source because of failure, the scheduler should avoid accidentally starving competing hypotheses.

Recovery should preserve balanced investigation.

# 89. Failure and Progressive Disclosure

Default workspace should show only material failures.

The trader can request:

```text
"Show failures."
"Why was this incomplete?"
"Show the recovery history."
```

Then progressively reveal operational detail.

# 90. Failure Explanation Contract

```text id="r8c5km"
FAILURE_EXPLANATION {
  what_failed
  stage
  cause
  affected_research
  affected_objects[]
  recovery_attempted[]
  recovery_result
  remaining_limitation
  judgment_impact
  confidence_impact
  next_available_action
}
```

# 91. Recovery Integrity Rules

The system must never:

* fabricate successful retrieval
* fabricate evidence
* treat failed retrieval as negative evidence
* silently downgrade source quality
* silently change research scope
* silently abandon important branches
* silently convert unresolved hypotheses into rejected hypotheses
* claim a monitor is active when activation failed
* claim a save succeeded when persistence failed
* claim restoration succeeded when incomplete
* expose credentials
* erase material failure history
* hide material limitations from the trader

# 92. Completion Criteria

Error, Failure & Recovery Intelligence is complete when:

* failures have standardized representations
* failure severity is materiality-based
* technical failure is distinguished from analytical uncertainty
* retry and fallback strategies exist
* failed tools/Skills can be substituted
* partial results are handled safely
* source failures do not become evidence
* branch failures remain isolated
* dependency failures propagate selectively
* research can complete with explicit limitations
* material failures affect confidence appropriately
* checkpoints protect state
* persistence failures are visible
* monitoring cannot create false alerts from missing data
* recovery is recorded in history
* natural language can control recovery
* unknown failures are reported honestly
* no failure creates fabricated provenance

# 93. Global Recovery Loop

```text
FAILURE DETECTED
```text
        ↓
CLASSIFY FAILURE
        ↓
ASSESS MATERIALITY
        ↓
IDENTIFY AFFECTED OBJECTS
        ↓
CHECK RECOVERABILITY
        ↓
RETRY / SUBSTITUTE / REPLAN
        ↓
VALIDATE RECOVERED RESULT
        ↓
UPDATE EVIDENCE / STATE
        ↓
PROPAGATE MATERIAL EFFECTS
        ↓
UPDATE CONFIDENCE / JUDGMENT IF REQUIRED
        ↓
RECORD TIMELINE + PROVENANCE
        ↓
CONTINUE / PAUSE / ESCALATE / STOP
        ↓
```
SURFACE MATERIAL LIMITATIONS
```

# Global Principle

**A failed operation is not a fact.
Missing information is not negative evidence.
Uncertainty is not failure.
Failure must be contained, recoverable, traceable, and visible when it materially affects the trader's decision.**

```
