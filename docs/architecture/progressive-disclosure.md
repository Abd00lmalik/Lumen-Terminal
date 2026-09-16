---
title: "PROGRESSIVE DISCLOSURE & EXPLAINABILITY INTELLIGENCE"
source: PROGRESSIVE DISCLOSURE & EXPLAINABI.txt
converted: 2026-09-12
type: architecture-spec
related: [workspace-presentation.md, judgment-confidence.md]
---

**Related documents:** `workspace-presentation.md` · `judgment-confidence.md`

> Converted from `PROGRESSIVE DISCLOSURE & EXPLAINABI.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

PROGRESSIVE DISCLOSURE & EXPLAINABILITY INTELLIGENCE

## 1. Purpose

Progressive Disclosure & Explainability Intelligence determines how much research information should be exposed to the trader at each moment.

Its purpose is to make complex research understandable without overwhelming the trader.

It answers:

- Why is this the current judgment?
- What evidence supports it?
- What evidence contradicts it?
- Which hypothesis produced this conclusion?
- What changed?
- How confident is the system?
- What remains uncertain?
- How deep should the explanation go?
- What additional detail is available?

The system should provide enough information to make the judgment understandable and auditable without exposing private internal chain-of-thought.

---

# 2. Core Principle

The default interface should provide the smallest useful explanation.

The trader can progressively request more detail.

```text
CURRENT JUDGMENT
```text
        ↓
KEY REASONS
        ↓
KEY EVIDENCE
        ↓
CLAIMS / HYPOTHESES
        ↓
RELATIONSHIPS
        ↓
SOURCE / PROVENANCE
        ↓
```
DETAILED RESEARCH HISTORY
```

The system should not begin with the full research graph.

---

# 3. Explainability Model

```text
EXPLANATION {
  id
  target_ref
  explanation_type
  audience_context
  depth
  summary
  supporting_objects[]
  opposing_objects[]
  relationships[]
  uncertainty
  confidence
  provenance
  generated_at
  visibility
}
```

---

# 4. Explanation Types

Core explanation types:

```text
WHY
EVIDENCE
CHANGE
CONFIDENCE
UNCERTAINTY
HYPOTHESIS
CLAIM
SOURCE
CAUSAL_CHAIN
COMPARISON
DECISION_IMPLICATION
HISTORY
PROVENANCE
```

The explanation type should determine which information is prioritized.

---

# 5. Default Explanation

For a judgment, the default explanation should contain:

```text
PRIMARY JUDGMENT
```text
+
2–4 strongest supporting factors
+
most important opposing factor
+
confidence
+
```
key uncertainty
```

Example:

```text
Current judgment:
Liquidation pressure is the strongest explanation.

Why:
• Liquidations increased sharply during the decline.
• Derivatives positioning deteriorated beforehand.
• The timing is consistent with forced selling.

Weakness:
The initial decline preceded the largest liquidation spike.

Confidence:
Moderate.

Key uncertainty:
Whether the initial move was caused by macro risk-off conditions.
```

The exact evidence comes from the underlying research state.

---

# 6. Progressive Levels

The system should support explicit explanation levels.

```text
LEVEL 0 — ANSWER
LEVEL 1 — WHY
LEVEL 2 — EVIDENCE
LEVEL 3 — RESEARCH STRUCTURE
LEVEL 4 — TRACEABILITY
LEVEL 5 — FULL HISTORY
```

---

# 7. Level 0 — Answer

The trader receives only the current conclusion.

Example:

```text
The strongest-supported explanation is liquidation pressure.

Confidence: Moderate.
```

Useful for quick interactions.

---

# 8. Level 1 — Why

Adds the principal reasons.

```text
The strongest-supported explanation is liquidation pressure.

Why:
• Positioning deteriorated before the move.
• Liquidations accelerated during the decline.
• The timing fits a forced-selling mechanism.

Confidence: Moderate.
```

---

# 9. Level 2 — Evidence

Adds specific evidence behind the reasons.

```text
Why:

1. Positioning deteriorated
   Evidence: funding and open-interest data

2. Liquidations accelerated
   Evidence: derivatives liquidation data

3. Timing fits forced selling
   Evidence: event timeline
```

---

# 10. Level 3 — Research Structure

Adds:

* claims
* hypotheses
* alternatives
* branches
* analytical findings
* contradictions

Example:

```text
Leading hypothesis:
Liquidation cascade

Alternative:
Macro risk-off

Supporting claims:
...

Contradicting claims:
...

Unresolved:
...
```

---

# 11. Level 4 — Traceability

Adds:

* source provenance
* timestamps
* evidence relationships
* object relationships
* hypothesis ranking
* judgment history
* relevant state transitions

The trader can inspect exactly where a conclusion originated.

---

# 12. Level 5 — Full History

Provides the deepest available research history:

* research timeline
* branch evolution
* hypothesis evolution
* judgment revisions
* source changes
* evidence updates
* scope changes
* trader interventions
* tool/Skill execution history where useful
* restoration history

This should be explicitly requested or entered through an advanced inspection view.

---

# 13. Explanation Depth

Depth may be expressed naturally:

```text
"Why?"
"Explain that."
"Go deeper."
"Show the evidence."
"Show me everything."
"Give me the full trail."
```

The system maps these requests to progressive levels.

---

# 14. Natural-Language Depth Mapping

Examples:

```text
"Why?"
→ LEVEL 1

"Show me the evidence."
→ LEVEL 2

"How did you reach that?"
→ LEVEL 3

"Show the source trail."
→ LEVEL 4

"Show everything that happened."
→ LEVEL 5
```

These are defaults, not rigid commands.

---

# 15. Explicit Depth Override

The trader can explicitly control explanation depth.

Examples:

```text
"Give me the short version."

"Explain it in detail."

"Show the full research trail."

"Just give me the conclusion."
```

Explicit depth requests override presentation defaults.

---

# 16. Explanation Target Resolution

The system must determine what the trader wants explained.

Possible targets:

```text
JUDGMENT
HYPOTHESIS
CLAIM
ANALYSIS
THESIS
FRAMEWORK EVALUATION
MONITOR ALERT
STATE CHANGE
SOURCE
EVIDENCE
```

Context Intelligence resolves ambiguous references.

---

# 17. "Why?" Resolution

If the trader says:

```text
"Why?"
```

the system should resolve it to the most recent materially relevant conclusion, judgment, hypothesis, or recommendation.

If multiple plausible targets exist, clarify.

---

# 18. "Why Did You Change?" Resolution

This should retrieve:

```text
PREVIOUS STATE
```text
+
TRIGGER
+
NEW EVIDENCE
+
AFFECTED HYPOTHESIS
+
```
NEW STATE
```

Example:

```text
The judgment changed because new derivatives evidence
weakened the previous macro explanation and elevated
the liquidation hypothesis.
```

---

# 19. Evidence Explanation

When asked:

```text
"Show me the evidence."
```

the system should prioritize evidence with the highest decision relevance.

Ranking should consider:

```text
directness
reliability
specificity
recency
corroboration
independence
materiality
relationship to current judgment
```

Not simply the most recently retrieved evidence.

---

# 20. Supporting Evidence

The strongest supporting evidence should be shown first.

Each item should explain:

```text
OBSERVATION
SOURCE
RELATIONSHIP
IMPORTANCE
```

Example:

```text
Observation:
Open interest rose while price weakened.

Source:
Derivatives market data.

Relationship:
Supports liquidation-pressure hypothesis.

Importance:
High.
```

---

# 21. Opposing Evidence

Opposing evidence must be equally discoverable.

Example:

```text
Opposing evidence:
The initial price decline preceded the liquidation spike.

Effect:
Weakens the claim that liquidations initiated the entire move.
```

The system must not suppress opposing evidence because the current judgment favors another hypothesis.

---

# 22. Evidence Quality Explanation

When useful, the system should explain why evidence matters.

Possible factors:

```text
DIRECTNESS
RELIABILITY
RECENCY
SPECIFICITY
CORROBORATION
SOURCE INDEPENDENCE
PROVENANCE
RELEVANCE
```

It should not produce an artificial numerical score unless the architecture explicitly supports one.

---

# 23. Source Explanation

For:

```text
"Why trust this source?"
```

the system should explain:

* source type
* proximity to primary information
* historical reliability where relevant
* independence
* publication context
* potential conflicts
* relevance to the claim

It must distinguish source reliability from truth.

---

# 24. Source Independence

If five articles repeat the same original report, the explanation should not present them as five independent confirmations.

Example:

```text
5 reports found.

Independent underlying sources:
2

The remaining reports appear to rely on the same original report.
```

---

# 25. Hypothesis Explanation

For:

```text
"Why is this the leading hypothesis?"
```

show:

```text
EXPLANATORY FIT
SUPPORTING EVIDENCE
CONTRADICTING EVIDENCE
ASSUMPTION BURDEN
ALTERNATIVES
EXPECTED OBSERVATIONS
DISCONFIRMING CONDITIONS
CONFIDENCE
```

Leading does not mean proven.

---

# 26. Alternative Explanation

For:

```text
"What else could explain this?"
```

the system should retrieve relevant alternatives.

For each:

```text
HYPOTHESIS
WHY PLAUSIBLE
SUPPORTING EVIDENCE
OPPOSING EVIDENCE
DISCRIMINATING EVIDENCE
CURRENT RANKING
```

---

# 27. Causal Explanation

When explaining causality, the system should expose:

```text
EVENT
→ PROPOSED MECHANISM
→ INTERMEDIATE EFFECT
→ OBSERVED OUTCOME
```

and test:

```text
TEMPORAL ORDER
MECHANISM
ALTERNATIVES
CONFOUNDERS
CONDITIONS
DISCONFIRMING EVIDENCE
```

The system must distinguish:

```text
CORRELATION
```

from:

```text
CAUSATION
```

---

# 28. Causal Confidence

The system should explicitly qualify causal conclusions when evidence is observational.

Example:

```text
Evidence is consistent with X causing Y,
but the available evidence does not establish
that X was the sole cause.
```

---

# 29. Claim Explanation

For:

```text
"Why is this claim considered supported?"
```

show:

```text
CLAIM
```text
+
SUPPORTING EVIDENCE
+
OPPOSING EVIDENCE
+
EVIDENCE QUALITY
+
```
CURRENT STATUS
```

---

# 30. Claim Importance

The explanation should distinguish:

```text
CORE CLAIM
SUPPORTING CLAIM
CONTEXTUAL CLAIM
```

A weak contextual claim should not be presented as if it undermines the entire research.

---

# 31. Judgment Explanation

A judgment explanation should answer:

```text
WHAT IS THE CURRENT ASSESSMENT?
WHY?
WHAT SUPPORTS IT?
WHAT WEAKENS IT?
WHAT ALTERNATIVES EXIST?
WHAT REMAINS UNKNOWN?
WHAT WOULD CHANGE IT?
HOW CONFIDENT ARE WE?
```

This is the primary explainability contract.

---

# 32. Confidence Explanation

For:

```text
"Why only moderate confidence?"
```

show the confidence drivers.

Example:

```text
Confidence: Moderate

Reasons:
• Strong supporting evidence
• One material contradiction
• Alternative explanation remains plausible
• Causal sequence is not fully established
```

Confidence should never be justified by fabricated probabilities.

---

# 33. Confidence Change

For:

```text
"Why did confidence fall?"
```

show:

```text
PREVIOUS CONFIDENCE
NEW EVIDENCE / CHANGE
AFFECTED CLAIM OR HYPOTHESIS
NEW CONFIDENCE
```

Example:

```text
Moderate → Low

Reason:
A previously important source was corrected,
removing support for a core claim.
```

---

# 34. Uncertainty Explanation

For:

```text
"What are we uncertain about?"
```

show only material uncertainty by default.

Each uncertainty should contain:

```text
UNKNOWN
WHY UNKNOWN
IMPACT
WHAT WOULD RESOLVE IT
```

---

# 35. What Would Change the Judgment

Every meaningful judgment should attempt to expose:

```text
WHAT WOULD CHANGE THIS ASSESSMENT?
```

This may include:

* new evidence
* invalidated assumptions
* stronger alternative explanation
* changed market conditions
* source correction
* threshold crossing where justified
* disappearance of supporting evidence

Conditions must be derived from the research, not invented arbitrarily.

---

# 36. Thesis Explainability

For an active thesis:

```text
WHY DOES THE SYSTEM THINK MY THESIS HOLDS?
```

should expose:

```text
SUPPORTED CLAIMS
WEAK CLAIMS
CONTRADICTED CLAIMS
ASSUMPTIONS
ALTERNATIVES
CURRENT JUDGMENT
INVALIDATION CONDITIONS
CONFIDENCE
```

The system should never imply that its assessment automatically changes the trader's thesis.

---

# 37. Framework Explainability

For framework evaluation:

```text
"Why did my framework give this result?"
```

show:

```text
FACTOR
CONDITION
REQUIRED EVIDENCE
EVIDENCE FOUND
EVALUATION
WEIGHT
RULE APPLIED
FACTOR RESULT
AGGREGATED RESULT
```

The exact framework version must be identified.

---

# 38. Monitor Explainability

For a monitor alert:

```text
"Why did I get this alert?"
```

show:

```text
TRIGGER
OBSERVED CHANGE
RELEVANT CONDITION
ORIGINAL RESEARCH CONTEXT
REASSESSMENT
CURRENT JUDGMENT
MATERIALITY
```

---

# 39. State Change Explainability

For:

```text
"Why was this branch paused?"
```

show:

```text
Previous state
Trigger
Scheduler decision
Resource / priority reason
Affected research
Current state
```

If the trader caused the change, that should be clear.

---

# 40. Automatic Action Explainability

For any material autonomous system action, the trader should be able to ask:

```text
"Why did you do that?"
```

The system should provide an operational rationale based on observable system state and rules.

It should not expose hidden chain-of-thought.

Example:

```text
The branch was reprioritized because new contradictory
evidence made it more likely to change the current judgment.
```

---

# 41. Explainability vs Chain-of-Thought

The system must provide useful reasoning traceability without exposing private internal chain-of-thought.

Expose:

```text
FACTS
EVIDENCE
CLAIMS
HYPOTHESES
RELATIONSHIPS
ANALYTICAL FINDINGS
DECISION-RELEVANT RATIONALE
CONFIDENCE
UNCERTAINTY
STATE TRANSITIONS
```

Do not expose:

```text
PRIVATE TOKEN-BY-TOKEN REASONING
HIDDEN INTERNAL MONOLOGUE
RAW CHAIN-OF-THOUGHT
```

---

# 42. Explanation Evidence Boundary

Every explanation should be grounded in actual research objects.

The system must not invent a rationale after the fact.

If the research state does not contain sufficient support:

```text
The available research does not establish why
this occurred with high confidence.
```

---

# 43. Explanation Provenance

An explanation should be traceable to:

```text
JUDGMENT
ANALYSIS
HYPOTHESIS
CLAIMS
EVIDENCE
SOURCES
TIMELINE
```

The explanation layer does not become a new source of truth.

---

# 44. Explanation Freshness

If the explanation uses historical evidence, that distinction should remain visible.

Example:

```text
Current evidence:
...

Historical context:
A similar event occurred in 2024.
```

Historical information should not be presented as current evidence.

---

# 45. Explanation Context

An explanation should respect the current scope.

If research currently covers:

```text
BTC
Last 30 days
Market + derivatives
```

the explanation should not silently introduce unrelated historical evidence simply because it exists.

It may mention relevant historical context if clearly labeled.

---

# 46. Explanation Scope Expansion

The trader may explicitly request broader explanation:

```text
"Include macro."

"Compare this with previous cycles."

"Show what sentiment says."

```

The system may then invoke additional research.

Explainability itself should not automatically expand research scope unless the requested explanation cannot be produced otherwise and the research engine determines additional research is necessary.

---

# 47. Explanation vs New Research

Important distinction:

```text
"Why did you reach that conclusion?"
```

→ explain existing research.

```text
"Find out whether that conclusion is actually correct."
```

→ new research / analysis.

The system should not silently treat explanation as a fresh investigation.

---

# 48. Explanation and New Evidence

If explanation reveals insufficient evidence:

```text
Existing research:
Insufficient evidence.
```

The system may say:

```text
I cannot support a stronger explanation from the
current evidence.
```

If the trader asks for deeper investigation, research resumes.

---

# 49. Explanation Adaptation

The system should adapt explanations to:

```text
question type
research stage
trader request
object type
confidence
uncertainty
complexity
```

A simple research result should not receive a 30-step explanation.

A complex causal judgment should receive more structure.

---

# 50. Explanation Materiality

Not every object deserves equal explanation depth.

Priority should be:

```text
CURRENT JUDGMENT
CORE CLAIMS
LEADING HYPOTHESES
MATERIAL OPPOSING EVIDENCE
KEY UNCERTAINTIES
DECISION-RELEVANT RELATIONSHIPS
```

---

# 51. Explanation Ordering

Default ordering:

```text
ANSWER
→ WHY
→ STRONGEST SUPPORT
→ STRONGEST OPPOSITION
→ UNCERTAINTY
→ WHAT WOULD CHANGE
→ DEEPER TRAIL
```

---

# 52. Explanation for Conflicting Evidence

When evidence conflicts, explain:

```text
WHAT CONFLICTS
WHY
WHICH EVIDENCE IS WEIGHTED MORE
WHY IT IS WEIGHTED MORE
WHAT REMAINS UNRESOLVED
```

The system should consider:

```text
directness
reliability
specificity
recency
source independence
provenance
timeframe
scope
measurement differences
```

---

# 53. Explanation for Unresolved Conflict

If conflict cannot be resolved:

```text
The evidence remains conflicting.

Evidence A supports X.
Evidence B supports Y.

Evidence A is more direct,
but the difference is not sufficient
to eliminate B.

Confidence remains Low.
```

Unresolved conflict should lower confidence where materially appropriate.

---

# 54. Explanation of Missing Evidence

The system should distinguish:

```text
NOT FOUND
NOT SEARCHED
UNAVAILABLE
CONTRADICTORY
NOT APPLICABLE
```

These are not equivalent.

---

# 55. Explanation of Research Gaps

For:

```text
"What are we missing?"
```

show:

```text
MISSING INFORMATION
WHY IT MATTERS
WHICH CLAIM IT AFFECTS
WHICH HYPOTHESIS IT AFFECTS
EXPECTED INFORMATION VALUE
```

---

# 56. Explanation of Research Stopping

For:

```text
"Why did you stop?"
```

possible explanations:

```text
Objective sufficiently addressed
Additional research unlikely to change judgment
Evidence ceiling reached
Research budget exhausted
Required source unavailable
Remaining uncertainty is unlikely to be resolved
Trader constraint reached
```

The system should identify the actual reason.

---

# 57. Explanation of Research Expansion

For:

```text
"Why are you still researching?"
```

show:

```text
Unresolved issue
+
Potential impact
+
Expected information value
```

Example:

```text
Research is continuing because the leading hypothesis
and strongest alternative remain difficult to distinguish,
and additional derivatives evidence could materially change
the current judgment.
```

---

# 58. Explanation of Tool / Skill Selection

The system may explain tool or Skill selection when useful.

Example:

```text
Why derivatives analysis?

The current uncertainty concerns positioning and forced
selling, so derivatives data has the highest expected
information value among available capabilities.
```

This explains capability selection without exposing internal reasoning.

---

# 59. Explanation of Tool Failure

For:

```text
"Why didn't you use that source?"
```

possible explanation:

```text
The source was unavailable.

An alternative source was used because it covered
the same information requirement with sufficient reliability.
```

The system must never claim a source was consulted if it was not.

---

# 60. Explanation of Historical Comparison

For:

```text
"Why is this historical case relevant?"
```

show:

```text
Surface similarity
Causal similarity
Relevant conditions
Differences
Applicability
Counterexamples
```

Historical precedent should never be treated as proof of repetition.

---

# 61. Explanation of Personalization

If a personalized preference changes presentation or research:

```text
"You usually prefer primary sources for thesis evaluation."
```

The trader should be able to inspect or change that preference.

Persistent preference changes follow confirmation rules.

---

# 62. Explanation of Context Resolution

For ambiguous contextual actions:

```text
"Why did you interpret 'that' as the liquidation hypothesis?"
```

the system may explain:

```text
The liquidation hypothesis was the active hypothesis
being discussed immediately before your request.
```

This is contextual provenance.

---

# 63. Explanation of Automatic Context

The system should not over-explain normal contextual resolution.

Only expose it when:

* ambiguity exists
* user asks
* context materially affected the result
* the system made a consequential interpretation

---

# 64. Explanation of State Propagation

For:

```text
"Why did this change the monitor?"
```

show:

```text
Evidence changed
→ Judgment materially changed
→ Monitor's original condition became less relevant
→ Monitor was paused
```

This is dependency propagation, not hidden reasoning.

---

# 65. Explanation of Version Changes

For versioned objects:

```text
"What's different in this thesis version?"
```

show:

```text
ADDED
REMOVED
CHANGED
UNCHANGED
```

For frameworks:

```text
factor changes
weight changes
threshold changes
rule changes
```

For judgments:

```text
support
opposition
confidence
uncertainty
conclusion
```

---

# 66. Explanation of Reassessment

When research is reassessed:

```text
REASSESSMENT
Previous judgment
New evidence
Updated analysis
Current judgment
Confidence change
```

The previous state remains accessible.

---

# 67. Explanation of Reversal

If the system reverses a prior conclusion:

```text
Previous:
Hypothesis A leading

Current:
Hypothesis B leading

Why:
New evidence materially contradicted A
and provided stronger support for B.

Confidence:
Moderate → Low
```

A reversal should be treated as a normal evidence-driven update, not hidden.

---

# 68. Explanation Stability

Explanations should remain stable enough for the trader to understand the current judgment.

Minor evidence changes should not cause constant rewriting of the entire explanation.

Material changes should update the explanation.

---

# 69. Explanation History

Material explanation changes may be linked to judgment history.

Example:

```text
Current explanation
Previous explanation
What changed
Why it changed
```

---

# 70. Explanation Personalization

The trader may establish durable preferences such as:

```text
"Always show opposing evidence."

"Keep explanations concise."

"Show sources for every major claim."

"Give me the full trail for thesis evaluations."
```

These become presentation preferences only if explicitly made persistent.

---

# 71. Explanation Override

Current explicit requests override persistent presentation preferences.

Example:

Preference:

```text
Concise explanations.
```

Current request:

```text
"Give me the full research trail."
```

Current request wins.

---

# 72. Explanation Interaction With Presentation

Presentation Intelligence determines:

```text
WHERE
```

information appears.

Explainability Intelligence determines:

```text
HOW MUCH
WHY
AND
IN WHAT ORDER
```

information should be exposed.

---

# 73. Explanation Interaction With Timeline

Timeline provides temporal context.

For:

```text
"Why did the judgment change?"
```

Explainability retrieves the relevant timeline event and connected objects.

---

# 74. Explanation Interaction With Evidence

Evidence Intelligence supplies the actual evidence.

Explainability decides which evidence is most useful to expose.

It must not fabricate or reinterpret evidence beyond the underlying evidence state.

---

# 75. Explanation Interaction With Hypothesis Intelligence

Hypothesis Intelligence provides:

* ranking
* confidence
* support
* opposition
* alternatives
* expected observations
* disconfirming conditions

Explainability presents these in understandable form.

---

# 76. Explanation Interaction With Analysis

Analysis provides:

* findings
* relationships
* alternatives
* uncertainty
* implications

Explainability turns these into progressive explanations.

---

# 77. Explanation Interaction With Judgment

Judgment is the primary target for decision-oriented explanations.

Explainability must preserve:

```text
judgment
confidence
uncertainty
support
opposition
conditions
```

---

# 78. Explanation Interaction With Thesis

Explainability distinguishes:

```text
WHAT THE TRADER BELIEVES
```

from:

```text
WHAT THE CURRENT EVIDENCE SUPPORTS
```

This distinction must remain visible.

---

# 79. Explanation Interaction With Monitor

Monitor alerts should explain their relevance through the original research context.

The trader should understand not merely:

```text
"Something changed."
```

but:

```text
"What changed relative to the research you asked me to watch?"
```

---

# 80. Explanation Interaction With Save

Saved artifacts should preserve enough explanation metadata to reconstruct:

```text
what was concluded
why
based on which evidence
under which framework/thesis
at what time
```

---

# 81. Explanation Interaction With Memory

Historical memory should be labeled.

An explanation may say:

```text
Previous research suggested X.

Current evidence now suggests Y.
```

rather than blending the two.

---

# 82. Explanation Error Handling

If the system cannot reconstruct a reliable explanation:

```text
The current research state does not preserve enough
information to establish why that conclusion was reached.
```

It should not invent a retrospective rationale.

---

# 83. Explanation Completeness

A high-quality explanation should answer enough of:

```text
WHAT
WHY
EVIDENCE
OPPOSITION
UNCERTAINTY
CONFIDENCE
WHAT WOULD CHANGE
```

The required subset depends on the question.

---

# 84. Explanation Quality Control

Before presenting an explanation, verify:

```text TARGET CORRECT?
CURRENT STATE?
EVIDENCE ACTUAL?
SOURCE TRACEABLE?
OPPOSITION INCLUDED?
HISTORICAL INFO LABELED?
CONFIDENCE CONSISTENT?
UNCERTAINTY CONSISTENT?
NO FABRICATED REASONING?
```

---

# 85. Explanation Output Contract

```text id="3f7m2c"
EXPLANATION_OUTPUT {
  target
  answer
  reasons[]
  supporting_evidence[]
  opposing_evidence[]
  hypotheses[]
  uncertainty[]
  confidence
  what_would_change[]
  provenance_refs[]
  available_depth
}
```

---

# 86. Completion Criteria

Progressive Disclosure & Explainability Intelligence is complete when:

* explanations begin with the useful answer
* deeper detail is available progressively
* evidence is traceable
* opposing evidence remains visible
* hypotheses are distinguishable
* uncertainty is explicit
* confidence is explained
* state changes are explainable
* historical context remains distinct
* tool/Skill selection can be explained when useful
* research stopping/continuation can be explained
* context resolution can be explained
* no hidden chain-of-thought is exposed
* explanations never invent retrospective reasoning
* natural-language depth control works
* explicit user requests override presentation preferences

---

# 87. Global Explainability Loop

```text
TRADER REQUEST
```text
        ↓
RESOLVE TARGET
        ↓
IDENTIFY EXPLANATION TYPE
        ↓
ASSESS CURRENT RESEARCH STATE
        ↓
SELECT RELEVANT OBJECTS
        ↓
SELECT APPROPRIATE EXPLANATION DEPTH
        ↓
ASSEMBLE JUDGMENT / EVIDENCE / OPPOSITION
        ↓
ADD UNCERTAINTY + CONFIDENCE
        ↓
ADD WHAT WOULD CHANGE
        ↓
ADD TRACEABILITY IF REQUESTED
        ↓
PRESENT
        ↓
ALLOW DEEPER DISCLOSURE
        ↓
```
STOP WHEN SUFFICIENT
```

# Global Principle

Explainability should make the research **auditable without making it overwhelming**.

**Answer first.
Explain why.
Show the evidence.
Show what challenges it.
Show uncertainty.
Let the trader go deeper.
Never invent reasoning that the research state cannot support.**

```
```
