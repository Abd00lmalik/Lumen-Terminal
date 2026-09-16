---
title: "PERSONALIZATION INTELLIGENCE"
source: PERSONALIZATION INTELLIGENCE.txt
converted: 2026-09-12
type: architecture-spec
related: [framework.md, memory.md, safety-boundaries.md]
---

**Related documents:** `framework.md` · `memory.md` · `safety-boundaries.md`

> Converted from `PERSONALIZATION INTELLIGENCE.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

PERSONALIZATION INTELLIGENCE

## 1. Purpose

Personalization Intelligence defines how the research workbench adapts to an individual trader without allowing personal preferences to distort evidence, research integrity, or decision boundaries.

The system should learn:

- research preferences
- preferred depth
- preferred domains
- evidence standards
- analytical style
- presentation preferences
- recurring frameworks
- thesis history
- monitoring preferences
- workflow preferences

But personalization must remain separate from truth.

Global principle:

PERSONALIZATION CHANGES HOW THE SYSTEM WORKS WITH THE TRADER.
IT DOES NOT CHANGE WHAT THE EVIDENCE MEANS.
```

# 2. Personalization Model

```text id="k3m7qa"
PERSONALIZATION_PROFILE {
  id
  research_preferences
  evidence_preferences
  analytical_preferences
  presentation_preferences
  workflow_preferences
  notification_preferences
  framework_preferences
  thesis_context
  monitor_preferences
  persistent_preferences[]
  temporary_preferences[]
  inferred_preferences[]
  confirmed_preferences[]
  provenance
  confidence
  history
  created_at
  updated_at
}
```

# 3. Personalization Categories

```text id="q8v4mx"
RESEARCH_DEPTH
RESEARCH_SCOPE
DATA_DOMAIN_PREFERENCES
SOURCE_PREFERENCES
EVIDENCE_STANDARDS
ANALYTICAL_ORIENTATION
EXPLANATION_STYLE
PRESENTATION_STYLE
WORKFLOW
NOTIFICATIONS
MONITORING
FRAMEWORK_USAGE
THESIS_CONTEXT
HISTORICAL_CONTEXT
OUTPUT_FORMAT
```

# 4. Personalization Boundary

Personalization may affect:

```text id="j5n2vc"
HOW RESEARCH IS DONE
HOW RESULTS ARE PRESENTED
WHAT INFORMATION IS PRIORITIZED
HOW MUCH DETAIL IS SHOWN
```

It must not silently affect:

```text id="p7w6dx"
FACTUAL TRUTH
EVIDENCE CLASSIFICATION
SOURCE PROVENANCE
CONTRADICTIONS
RESEARCH INTEGRITY
CONFIDENCE
```

# 5. Explicit Preferences

The strongest personalization signal is an explicit trader instruction.

Examples:

```text id="c8r4qp"
"Always use primary sources where possible."

"Keep research concise."

"Show me opposing evidence."

"Go deep on macro."

"Don't automatically create monitors."

"Use my framework whenever I ask for an evaluation."
```

These may become persistent preferences according to confirmation rules.

# 6. Temporary Preferences

A preference may apply only to the current research.

Example:

```text id="m7x2vn"
"For this research, ignore sentiment."
```

This changes the current scope.

It should not automatically become a permanent preference.

# 7. Persistent Preferences

Persistent preferences are durable instructions that affect future research.

Examples:

```text id="r9k5tb"
preferred research depth
preferred evidence sources
default presentation style
notification behavior
preferred analytical orientation
preferred domains
```

Consequential persistent preferences require explicit confirmation.

# 8. Inferred Preferences

The system may observe repeated behavior and infer a possible preference.

Example:

```text id="z4c8mp"
The trader repeatedly asks for primary-source validation.
```

This may become:

```text id="a6n3vq"
Possible preference:
Primary-source validation is important to this trader.
```

It should not silently become a permanent rule.

# 9. Preference Confidence

Inferred preferences should have confidence:

```text id="y7w2kc"
LOW
MODERATE
HIGH
```

Confidence reflects evidence for the preference, not factual truth.

# 10. Preference Promotion

A possible inferred preference can be promoted to persistent preference when:

* behavior is repeated
* pattern is consistent
* preference is broadly useful
* persistence would materially change future behavior

The system should request confirmation when appropriate.

# 11. Preference Confirmation

Example:

```text id="f6q9xm"
"You've consistently asked for primary-source validation.
Should I make that your default research preference?"
```

Once confirmed, it becomes persistent.

# 12. No Silent Learning of Consequential Preferences

The system must not silently learn preferences that materially affect:

* financial decisions
* monitoring
* persistent frameworks
* execution
* risk tolerance
* destructive actions

These require explicit confirmation.

# 13. Research Depth Personalization

The trader may prefer:

```text id="x5n7cq"
QUICK
STANDARD
DEEP
EXHAUSTIVE
```

The preference becomes the default.

Explicit current requests override it.

# 14. Depth Override

Persistent preference:

```text id="m4q8hz"
STANDARD
```

Current request:

```text id="d8x3pv"
"Do an exhaustive investigation."
```

Current request wins.

# 15. Research Domain Preferences

The trader may prefer certain domains.

Examples:

```text id="c3v7mn"
Macro
Derivatives
On-chain
Technical
News
Sentiment
Regulation
Ecosystem
```

These preferences influence planning.

They do not exclude materially necessary evidence unless the trader explicitly imposes that constraint.

# 16. Domain Preference vs Research Requirement

If a trader dislikes sentiment but sentiment is directly relevant to the question:

The system may state:

```text id="q5w2jk"
Sentiment is normally outside your preferred research scope,
but it appears materially relevant to this question.
```

The trader can exclude it.

# 17. Source Preferences

The trader may prefer:

* primary sources
* official documents
* academic research
* regulatory sources
* market data
* independent reporting
* specific providers

These influence source ranking.

They do not override source quality or relevance.

# 18. Evidence Standards

A trader may prefer stricter evidence.

Examples:

```text id="g7c4mp"
"Don't use social posts as primary evidence."

"Require two independent sources for major claims."

"Use primary data whenever available."
```

These can become research constraints/preferences.

# 19. Evidence Preference Boundary

Personal evidence preferences may affect:

```text id="r3k8vx"
source selection
corroboration requirements
presentation
research depth
```

They must not cause the system to relabel weak evidence as strong evidence.

# 20. Analytical Orientation

The system may personalize:

```text id="t6v2qy"
neutral
thesis-aware
skeptical
exploratory
comparative
```

Neutral remains the default.

# 21. Thesis-Aware Personalization

If the trader consistently researches from the perspective of an active thesis, the system may prioritize:

* thesis-linked evidence
* contradictions
* invalidation conditions
* alternative explanations

But it must not become confirmation-biased.

# 22. Anti-Confirmation Personalization

A trader may explicitly request:

```text id="h9w3ka"
"Always try to disprove my thesis."
```

The system can prioritize falsification.

It should still represent supporting evidence fairly.

# 23. Explanation Preferences

The trader may prefer:

```text id="p4m8cx"
CONCISE
BALANCED
DETAILED
AUDIT-LEVEL
```

This controls progressive disclosure defaults.

# 24. Presentation Preferences

Possible preferences:

```text id="s8q5yn"
judgment-first
evidence-first
timeline-first
hypothesis-first
compact
detailed
```

These affect presentation, not underlying research state.

# 25. Current Request Override

Presentation preferences never override explicit current requests.

```text id="w3n7vc"
Preference:
compact

Current:
"Show the complete evidence trail."

Result:
complete evidence trail.
```

# 26. Workflow Preferences

The trader may prefer:

* automatic research continuation
* more visible planning
* fewer interruptions
* more frequent clarification
* aggressive contradiction search
* deeper source validation
* automatic historical comparisons

These influence orchestration.

# 27. Interruption Preferences

The trader may prefer fewer interruptions.

The system may therefore infer more low-risk context automatically.

But material ambiguity must still trigger clarification.

# 28. Research Automation Preference

A trader may prefer:

```text id="y6k4mp"
"Keep researching until the answer is solid."
```

This can influence stopping thresholds.

It cannot override hard resource or safety limits.

# 29. Stopping Preference

A trader may prefer quick answers.

This can reduce default depth.

But the system must still identify material unresolved uncertainty.

# 30. Notification Preferences

Possible preferences:

```text id="q8m3fx"
IMMEDIATE
IMPORTANT_ONLY
BATCHED
QUIET
```

Material monitoring events remain subject to core monitoring rules.

# 31. Notification Personalization Boundary

A preference for quiet notifications cannot suppress a material system state that must be surfaced.

The system can minimize noise, not hide material information.

# 32. Framework Personalization

Frameworks are not merely preferences.

They are structured methodologies and therefore remain first-class persistent objects.

Personalization may remember:

```text id="j4v8pc"
preferred framework
framework applicability
framework usage patterns
```

But framework definitions remain separate.

# 33. Multiple Frameworks

The trader may maintain multiple frameworks.

The system must not silently combine them.

If multiple frameworks are applicable:

```text id="x7c5nm"
select based on explicit context
or
clarify when materially ambiguous
```

# 34. Framework Default

A trader may say:

```text id="r2m8qf"
"Use my default framework for protocol evaluations."
```

This can establish a persistent preference linking a framework to a class of research.

# 35. Framework Version

When applying a saved framework:

The exact version used must be preserved.

Personalization must not silently switch framework versions.

# 36. Thesis Personalization

Theses are not preferences.

They represent trader beliefs.

Personalization may remember:

* active thesis
* thesis history
* related research
* preferred thesis context

But the system must never infer a thesis merely because the trader frequently researches an asset.

# 37. Thesis Context Retrieval

When relevant, the system may surface:

```text id="m8v3cz"
"You previously had a thesis that X would..."
```

Historical thesis state must remain labeled.

# 38. Current Thesis Priority

Current explicit thesis context takes precedence over historical thesis context.

Historical thesis should never silently become current.

# 39. Historical Personalization

The system may remember:

* prior research
* prior conclusions
* prior hypotheses
* prior decisions
* previous framework evaluations
* previous monitoring events

These provide continuity.

They do not become current evidence automatically.

# 40. Decision History

Decision history may help the system understand:

```text id="p7n5mc"
what the trader previously cared about
which assumptions mattered
what evidence influenced prior decisions
```

It should not be used to manipulate the trader toward repeating previous decisions.

# 41. Personalization and Bias

Personalization creates risk of:

* confirmation bias
* overfitting to preferences
* source monoculture
* excessive familiarity
* anchoring
* reduced exploration

The system should actively preserve research integrity.

# 42. Preference vs Truth

If a trader prefers a conclusion, the system must not adjust evidence to match it.

Example:

```text id="f4q8yn"
Preference:
Bullish interpretation.

Evidence:
Contradictory.

Result:
Contradiction remains visible.
```

# 43. Preference vs Source Quality

A trader may prefer a source.

If the source is materially weaker for the claim, the system should communicate the limitation.

# 44. Preference vs Contradiction

The system should not hide contradictory evidence because the trader usually prefers a certain conclusion.

# 45. Preference vs Confidence

Personalization must not artificially increase or decrease confidence.

Confidence remains evidence-based.

# 46. Preference vs Hypothesis Ranking

Trader preference can influence research priority.

It must not determine hypothesis ranking.

Example:

```text id="h7n2vc"
Trader prefers testing hypothesis A first.

This does not mean:
Hypothesis A is more likely.
```

# 47. Preference vs Research Priority

Preferences may affect:

```text id="q3m8vk"
depth
source choice
domain order
presentation
```

Material information value remains a core scheduler consideration.

# 48. Personalized Research Planning

The planner may combine:

```text id="n5x7qm"
CURRENT REQUEST
```text
+
CURRENT CONSTRAINTS
+
PERSISTENT PREFERENCES
+
RESEARCH OBJECTIVE
+
```
EVIDENCE REQUIREMENTS
```

Explicit current constraints take precedence.

# 49. Preference Conflict Resolution

Hierarchy:

```text id="s4v9cx"
SYSTEM INTEGRITY
>
CURRENT EXPLICIT REQUEST
>
CURRENT HARD CONSTRAINT
>
CURRENT RESEARCH STATE
>
PERSISTENT PREFERENCE
>
INFERRED PREFERENCE
>
HISTORICAL BEHAVIOR
```

# 50. Preference Conflict Example

Persistent:

```text id="c7m2pk"
"Keep research concise."
```

Current:

```text id="d4n8vx"
"Show the full audit trail."
```

Current request wins.

# 51. Preference Conflict With Framework

If a persistent presentation preference conflicts with a framework's required output:

The framework's methodological requirements remain intact.

Presentation can adapt around them.

# 52. Preference Conflict With Safety

Safety and integrity boundaries always win.

# 53. Preference Storage

Persistent preferences should be stored separately from:

* research evidence
* thesis
* framework
* judgment
* source data

This prevents preference contamination.

# 54. Preference Object

```text id="k6v3zr"
PREFERENCE {
  id
  category
  name
  value
  scope
  source
  confidence
  status
  created_at
  updated_at
  confirmation
  provenance
  history
}
```

# 55. Preference Scope

Possible scopes:

```text id="w9m4hx"
SESSION
RESEARCH
ASSET
RESEARCH_TYPE
FRAMEWORK
MONITOR
GLOBAL
```

The narrowest appropriate scope should be preferred.

# 56. Preference Expiration

Temporary preferences may expire:

```text id="n3c8qv"
SESSION_END
RESEARCH_COMPLETE
TIME_BASED
EXPLICIT_RESET
```

Persistent preferences remain until changed or forgotten.

# 57. Preference Modification

Natural language:

```text id="r5v7mc"
"From now on, give me detailed explanations."
```

may create a persistent preference after the appropriate confirmation boundary.

# 58. Preference Removal

Natural language:

```text id="j8c3xp"
"Stop using my old primary-source preference."
```

removes or deactivates the relevant preference.

The system should preserve historical provenance where appropriate.

# 59. Preference Reset

Trader may request:

```text id="x6n2mq"
"Reset my research preferences."
```

The system should clearly identify the scope before making a broad persistent change.

# 60. Preference History

Material preference changes should preserve:

```text id="b4q8vk"
previous value
new value
timestamp
actor
reason if provided
```

# 61. Preference Provenance

The system should know whether a preference came from:

```text id="z7m5cn"
EXPLICIT_TRADER_INSTRUCTION
CONFIRMED_INFERENCE
INFERRED_BEHAVIOR
RESEARCH_CONTEXT
SYSTEM_DEFAULT
```

# 62. Inference Transparency

If behavior is being used to suggest a preference, the trader should be able to inspect that inference.

Example:

```text id="m8x4qy"
"Why do you keep prioritizing primary sources?"

"Because you have repeatedly requested primary-source validation."
```

# 63. Learning Conservatism

The system should learn slowly rather than overfit to one or two interactions.

One unusual request should not permanently change the profile.

# 64. Preference Generalization

A preference should only generalize as far as the evidence supports.

Example:

```text id="p6n3vx"
"Use primary sources for regulatory research."
```

does not imply:

```text "Use only primary sources for everything."
```

# 65. Preference Specificity

Preferences should preserve specificity:

```text id="f5q9mw"
domain
asset class
research type
framework
timeframe
presentation
```

Broadening scope should require evidence or explicit instruction.

# 66. Personalization and Memory

Personalization is a consumer of memory but is not identical to memory.

Memory stores historical context.

Personalization stores durable behavior/preferences.

# 67. Personalization and Context

Current context overrides persistent personalization when explicitly specified.

# 68. Personalization and Workspace

Workspace presentation can adapt to preferences.

The underlying research graph remains unchanged.

# 69. Personalization and Explainability

Explainability depth may adapt to preferred detail.

The trader can always request deeper disclosure.

# 70. Personalization and Error Recovery

Recovery preferences may influence:

* retry aggressiveness
* fallback preference
* interruption behavior

But the system must still preserve evidence integrity.

# 71. Personalization and Monitoring

The trader may prefer:

* fewer alerts
* immediate alerts
* grouped alerts
* specific domains
* certain monitor types

Material monitor conditions remain subject to core monitoring rules.

# 72. Personalization and Save

The system may remember preferred save locations or naming styles.

It must not silently save consequential persistent artifacts unless allowed by the existing SAVE boundary.

# 73. Personalization and MANAGE_STATE

Preferences may define default presentation/state behavior.

Explicit state changes always override defaults.

# 74. Personalization and LUI

Natural language remains the personalization interface.

Examples:

```text id="a4m7kc"
"Keep my research concise."

"Always challenge my thesis."

"Use macro by default."

"Don't notify me for minor monitor changes."

"Show opposing evidence first."
```

The LUI maps these to structured preference operations.

# 75. Personalization and Research Flow

Different flows may use different preferences.

Example:

```text id="z8c4pv"
Historical research:
deep

Quick market update:
quick
```

A global preference should not override more specific research-type preferences.

# 76. Preference Precedence

More specific preferences take precedence over broader preferences.

```text id="m5n8qx"
RESEARCH-SPECIFIC
>
RESEARCH-TYPE
>
ASSET-SPECIFIC
>
GLOBAL
```

Subject to current explicit instructions.

# 77. Personalized Research Depth

Resolved depth:

```text id="c9x4mp"
current explicit request
→ current research preference
→ research-type preference
→ global preference
→ system default
```

# 78. Personalized Source Selection

Resolved source preference:

```text id="v7n2qk"
current constraint
→ research-specific preference
→ research-type preference
→ global preference
→ system source strategy
```

Evidence quality remains authoritative.

# 79. Personalized Explanation

Resolved explanation depth:

```text id="x6q8mc"
explicit request
→ current research preference
→ object-specific preference
→ global preference
→ default progressive disclosure
```

# 80. Personalization Integrity Check

Before applying personalization:

```text id="r4m9vk"
IS IT EXPLICIT?
IS IT CONFIRMED?
IS IT INFERRED?
WHAT IS ITS SCOPE?
COULD IT DISTORT EVIDENCE?
COULD IT CHANGE A CONSEQUENTIAL ACTION?
DOES A CURRENT REQUEST OVERRIDE IT?
```

# 81. Personalization Quality Control

The system should periodically detect:

* contradictory preferences
* obsolete preferences
* overly broad preferences
* preferences that conflict with current behavior
* preferences that reduce research quality
* preferences that create confirmation bias

It may recommend cleanup.

# 82. Preference Conflict Detection

Example:

```text id="y5c8qm"
Preference A:
"Only use primary sources."

Preference B:
"Always include independent reporting."

Conflict:
Some claims cannot satisfy both simultaneously.
```

The system should clarify or establish scope.

# 83. Preference Staleness

Preferences can become stale.

Example:

```text id="p8n3vx"
Trader previously preferred one data provider.
Provider is no longer available.
```

The preference remains historical but may be marked stale.

# 84. Preference Revalidation

A stale preference may be revalidated when the relevant workflow resumes.

# 85. Forgetting Preferences

When a trader asks the system to forget a preference:

* remove future influence
* preserve historical research
* preserve audit history where appropriate
* do not delete unrelated objects

# 86. Personalization Safety Boundary

The system must never personalize toward:

* hiding uncertainty
* hiding contradictory evidence
* fabricating confidence
* weakening evidence standards without instruction
* automatic execution
* unauthorized persistence
* destructive behavior

# 87. Personalized Decision Support

Personalization may determine:

```text id="g4m7xy"
how decision context is displayed
which known thesis is surfaced
which framework is relevant
how much explanation is shown
```

It must not silently determine:

```text id="b8q2mc"
what action the trader should take
```

# 88. Personalization and Bias Monitoring

The system should be able to detect if personalization repeatedly produces:

```text id="m3v7kp"
one-sided evidence exposure
one-source dependence
repeated confirmation
suppressed alternatives
```

It should recommend corrective research behavior where useful.

# 89. Personalized Challenge

A trader may prefer stronger challenge intensity.

The system can adapt CHALLENGE intensity.

But it should not manufacture objections simply to satisfy the preference.

# 90. Personalized Historical Research

A trader may prefer historical precedent.

The system may prioritize historical comparison.

It must still test applicability and counterexamples.

# 91. Personalized Framework Evaluation

If a framework is applicable and selected through personalization:

The system should still perform the complete framework integrity check.

# 92. Personalization Audit

Material personalized behavior should be traceable to:

```text id="v5n8cx"
preference
scope
source
confirmation
research context
```

# 93. Personalization Output

The system should be able to answer:

```text id="k7m3pq"
"How are you personalizing this research?"
```

with:

```text current preferences
applied frameworks
relevant thesis context
research depth preference
source preferences
presentation preferences
```

# 94. Personalization Control

The trader should be able to:

* view preferences
* modify preferences
* remove preferences
* disable inferred personalization
* reset categories
* override preferences per research

# 95. Personalization State

```text id="q4n8vy"
PERSONALIZATION_STATE {
  active_preferences[]
  inferred_preferences[]
  confirmed_preferences[]
  overridden_preferences[]
  stale_preferences[]
  conflicts[]
  current_overrides[]
  personalization_scope
  last_updated
}
```

# 96. Completion Criteria

Personalization Intelligence is complete when:

* explicit preferences are supported
* temporary and persistent preferences are distinct
* inferred preferences are conservative
* consequential preferences require confirmation
* current requests override persistent defaults
* preferences have scopes
* source/evidence preferences do not corrupt evidence
* thesis history is distinct from preference
* frameworks remain first-class objects
* presentation can be personalized
* research depth can be personalized
* notification behavior can be personalized
* personalization conflicts can be detected
* stale preferences can be identified
* preferences can be forgotten
* personalization remains auditable
* anti-confirmation safeguards remain active
* personalization never silently becomes a trading decision

# 97. Global Personalization Loop

```text id="6x9m2c"
CURRENT REQUEST
```text
        ↓
LOAD CURRENT CONTEXT
        ↓
LOAD RELEVANT PREFERENCES
        ↓
CHECK SCOPE + PRECEDENCE
        ↓
APPLY CURRENT OVERRIDES
        ↓
PLAN / PRESENT / EXECUTE RESEARCH
        ↓
OBSERVE INTERACTION
        ↓
IDENTIFY POSSIBLE PREFERENCE
        ↓
ASSESS GENERALIZATION + CONSEQUENCE
        ↓
CONFIRM IF NECESSARY
        ↓
PERSIST OR KEEP TEMPORARY
        ↓
USE IN FUTURE RESEARCH
        ↓
```
REVALIDATE OVER TIME
```

# Global Principle

**Personalization should make the workbench feel like the trader's own research environment without making the evidence behave like the trader's preferences.

Preferences guide.
Frameworks evaluate.
Theses represent belief.
Memory preserves context.
Evidence determines what is supported.
The trader remains the decision-maker.**
