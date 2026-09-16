---
title: "RESEARCH QUALITY CONTROL INTELLIGENCE"
source: RESEARCH QUALITY CONTROL INTELLIGEN.txt
converted: 2026-09-12
type: architecture-spec
related: [completion-stopping.md, evidence-source.md, failure-recovery.md]
---

**Related documents:** `completion-stopping.md` · `evidence-source.md` · `failure-recovery.md`

> Converted from `RESEARCH QUALITY CONTROL INTELLIGEN.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

RESEARCH QUALITY CONTROL INTELLIGENCE

## 1. Purpose

Quality Control continuously evaluates whether research is:

- relevant
- sufficiently complete
- evidence-grounded
- internally consistent
- source-traceable
- current enough
- appropriately scoped
- resistant to confirmation bias
- analytically coherent
- transparent about uncertainty

Quality Control does NOT decide what the trader should believe.

It determines whether the research is strong enough to support the conclusions being presented.
```

## 2. Quality Model

```text id="m7v2kc"
RESEARCH_QUALITY {
  id
  research_ref
  scope_quality
  target_quality
  evidence_quality
  source_quality
  coverage_quality
  contradiction_quality
  hypothesis_quality
  analysis_quality
  synthesis_quality
  freshness_quality
  provenance_quality
  uncertainty_quality
  personalization_integrity
  completion_quality
  overall_quality
  weaknesses[]
  unresolved_gaps[]
  required_actions[]
  confidence
  timestamp
  provenance
  history
}
```

## 3. Quality Dimensions

```text id="c5x8qn"
TARGET
SCOPE
EVIDENCE
SOURCE
COVERAGE
CONTRADICTIONS
HYPOTHESES
ANALYSIS
SYNTHESIS
FRESHNESS
PROVENANCE
UNCERTAINTY
PERSONALIZATION
COMPLETENESS
```

Every dimension is evaluated independently before contributing to an overall assessment.

## 4. Quality Is Not Confidence

Research confidence answers:

```text "How confident are we in this judgment?"
```

Quality answers:

```text "How strong is the research process and evidence supporting that judgment?"
```

A research project can have:

```text high quality + low confidence
```

when the available evidence is genuinely inconclusive.

It can also have:

```text low quality + high apparent confidence
```

when the research is incomplete or poorly supported.

The second case should trigger QC intervention.

## 5. Target Quality

Check:

```text id="r4n7xp"
correct entity
correct asset
correct event
correct timeframe
correct interpretation
correct question
```

A research project cannot be considered high quality if it investigates the wrong target.

## 6. Scope Quality

Evaluate whether the actual research scope matches the intended scope.

Detect:

* accidental scope expansion
* accidental scope reduction
* silently excluded domains
* missing required domains
* irrelevant research
* stale constraints
* contradictory scope instructions

## 7. Scope Drift

During adaptive research, the system may legitimately change scope.

Every material scope change must record:

```text id="v6m2qy"
original_scope
new_scope
reason
trigger
affected_tasks
affected_judgment
timestamp
```

Adaptive scope change is valid.

Silent scope drift is not.

## 8. Evidence Quality

Each material evidence item is evaluated for:

```text id="p8c4mk"
directness
reliability
recency
specificity
corroboration
independence
provenance
context
relevance
```

Evidence quality is claim-specific.

## 9. Evidence Classification

QC must verify that evidence has not been incorrectly classified.

Examples:

```text FACTUAL_OBSERVATION
QUANTITATIVE_OBSERVATION
INTERPRETATION
INFERENCE
SPECULATION
MODEL_OUTPUT
SENTIMENT_SIGNAL
UNAVAILABLE
```

An inference must never silently become a fact.

## 10. Source Quality

Source evaluation considers:

* authority
* directness
* provenance
* independence
* publication date
* retrieval date
* source type
* jurisdiction
* specificity
* conflict of interest
* accessibility

Source preference does not equal source quality.

## 11. Source Independence

QC must detect multiple sources that simply repeat the same underlying source.

Example:

```text Primary announcement
        ↓
News article A
News article B
News article C
```

This is not four independent confirmations.

## 12. Evidence Duplication

Duplicate or near-duplicate evidence should be consolidated.

The original provenance remains available.

Derived evidence must retain its relationship to the original source.

## 13. Coverage Quality

Coverage asks:

```text Did the research investigate the information required to answer the question?
```

Not:

```text Did the system collect a large amount of information?
```

More information does not automatically mean better research.

## 14. Information Requirements

Every material research objective should produce information requirements.

QC checks:

```text requirement
→ required evidence
→ retrieved evidence
→ validated evidence
→ conclusion
```

Missing links become research gaps.

## 15. Coverage Matrix

```text id="k9x3mv"
COVERAGE_MATRIX {
  requirement
  required_evidence
  evidence_found[]
  evidence_quality
  status
  unresolved_reason
  materiality
}
```

Statuses:

```text SATISFIED
PARTIALLY_SATISFIED
UNSATISFIED
NOT_AVAILABLE
NOT_APPLICABLE
```

## 16. Contradiction Quality

The system must actively check for contradictions.

Contradictions may occur between:

* sources
* evidence
* claims
* hypotheses
* analyses
* judgments
* historical precedent
* thesis assumptions

## 17. Contradiction Handling

Contradictions should not simply be averaged away.

The system evaluates:

```text source quality
directness
recency
specificity
independence
context
measurement differences
time differences
definition differences
```

Then determines whether the contradiction is:

```text apparent
resolvable
material
unresolved
```

## 18. Material Contradiction

A contradiction is material when resolving it could change:

* a major claim
* leading hypothesis
* current judgment
* thesis assessment
* decision-relevant implication
* monitoring condition

Material contradictions should remain visible.

## 19. Hypothesis Quality

For each material hypothesis:

```text id="x5m8qv"
supporting evidence
contradicting evidence
assumptions
dependencies
alternatives
expected observations
disconfirming observations
explanatory fit
confidence
```

QC checks whether the hypothesis is genuinely supported rather than merely plausible.

## 20. Alternative Explanation Check

For important conclusions, QC asks:

```text Could the observed result be explained by something else?
```

This is especially important for:

* causal research
* thesis validation
* historical precedent
* market reactions
* event attribution

## 21. Confirmation-Bias Check

QC should detect patterns such as:

```text supporting evidence heavily searched
contradictory evidence ignored
alternative explanations absent
same-source repetition
negative evidence dismissed without evaluation
```

The system should trigger additional falsification research when material.

## 22. Analysis Quality

Analysis must correctly connect:

```text evidence
→ claims
→ relationships
→ hypotheses
→ conclusion
```

QC checks for unsupported analytical leaps.

## 23. Analytical Leap Detection

Example:

```text Evidence:
Asset price increased.

Unsupported conclusion:
Therefore the protocol adoption campaign caused the increase.
```

The missing causal evidence should be identified.

## 24. Causal Quality

For causal claims, QC checks:

```text temporal order
mechanism
intermediate steps
alternative causes
confounders
counterfactual plausibility
supporting evidence
disconfirming evidence
```

Correlation alone must not be presented as established causation.

## 25. Historical Quality

Historical precedent must distinguish:

```text surface similarity
causal similarity
context similarity
outcome similarity
```

QC should flag cases where the current event merely resembles a historical event superficially.

## 26. Synthesis Quality

Final synthesis must:

* answer the original question
* reflect strongest evidence
* include material opposition
* preserve uncertainty
* avoid unsupported certainty
* remain consistent with the underlying research graph

## 27. Judgment Traceability

Every material judgment should trace:

```text JUDGMENT
```text
   ↓
ANALYSIS
   ↓
CLAIMS
   ↓
EVIDENCE
   ↓
```
SOURCES
```

A judgment without sufficient provenance should be downgraded.

## 28. Confidence Calibration

QC evaluates whether confidence matches the evidence.

High confidence should generally require:

```text strong evidence
```text
+
good coverage
+
low material contradiction
+
```
clear reasoning
```

Low confidence can be correct when uncertainty is genuine.

## 29. No Fabricated Probabilities

QC must reject unsupported numerical confidence.

The system should not produce:

```text "82% confidence"
```

unless a valid methodology supports that number.

Qualitative confidence is acceptable.

## 30. Freshness Quality

Freshness is evaluated relative to the research question.

A source from yesterday may be:

```text highly relevant
```

for historical research but:

```text stale
```

for rapidly changing market conditions.

Freshness is contextual.

## 31. Freshness Requirements

Each material information requirement may specify:

```text required_freshness
```

QC compares retrieved evidence against that requirement.

## 32. Stale Evidence

Stale evidence remains in history.

It should not silently be treated as current evidence.

## 33. Provenance Quality

Every material conclusion should have a provenance chain.

```text ORIGIN
→ SOURCE
→ RETRIEVAL
→ EXTRACTION
→ EVIDENCE
→ CLAIM
→ HYPOTHESIS
→ ANALYSIS
→ JUDGMENT
```

Broken provenance reduces quality.

## 34. Tool Output Validation

QC validates tool results before they become evidence.

Checks:

```text schema
entity
timestamp
units
source
freshness
completeness
status
```

Malformed output must not become research evidence.

## 35. Skill Output Validation

Bitget Skill outputs must be treated according to their output type.

For example:

```text Technical Analysis output
≠ independent market observation
```

Derived analysis must remain distinguishable from raw data.

## 36. Cross-Skill Independence

QC must detect false corroboration.

Example:

```text MARKET_INTEL
TECHNICAL_ANALYSIS
```

may both ultimately depend on the same underlying market data.

They should not automatically count as independent confirmations.

## 37. Data Consistency

QC checks:

* units
* currencies
* timestamps
* timezone
* asset identifiers
* contract identifiers
* decimal precision
* timeframe
* data frequency

Inconsistent normalization can invalidate an otherwise correct analysis.

## 38. Entity Resolution

QC must verify that evidence refers to the intended:

```text asset
protocol
company
token
event
person
jurisdiction
time period
```

Entity confusion is a critical research failure.

## 39. Temporal Consistency

The system must detect impossible or inconsistent timelines.

Example:

```text event occurs at T2
source claims cause occurred at T3
```

This requires investigation before causal interpretation.

## 40. Scope Completeness

Research is not complete merely because all planned tasks finished.

QC asks:

```text Does the completed work actually satisfy the research objective?
```

## 41. Completion Quality

Completion requires:

```text objective addressed
```text
+
required evidence sufficiently covered
+
material contradictions evaluated
+
judgment traceable
+
```
limitations disclosed
```

## 42. Unresolved Gaps

Every material unresolved gap should contain:

```text id="n7v4cx"
gap
why_missing
materiality
possible_resolution
impact_on_judgment
```

## 43. Research Sufficiency

QC determines whether remaining gaps could materially change the judgment.

If:

```text remaining gap has low materiality
```

research may complete.

If:

```text remaining gap could materially change judgment
```

research should continue or explicitly return an insufficient-evidence state.

## 44. Quality Thresholds

Quality states:

```text INSUFFICIENT
WEAK
ADEQUATE
STRONG
ROBUST
```

These describe research quality, not investment attractiveness.

## 45. Quality State

```text id="q3m8vx"
QUALITY_STATE {
  level
  blocking_issues[]
  material_issues[]
  minor_issues[]
  unresolved_gaps[]
  confidence
  completion_eligibility
}
```

## 46. Blocking Issues

Blocking issues prevent completion when they materially undermine the objective.

Examples:

* wrong target
* broken provenance
* missing essential evidence
* unresolved critical contradiction
* invalid data
* major scope failure

## 47. Material Issues

Material issues may allow completion only if explicitly disclosed and the judgment remains sufficiently supported.

## 48. Minor Issues

Minor issues should not interrupt the trader unless they affect interpretation.

They remain available in the research history.

## 49. Automatic QC

QC runs automatically at:

```text research initialization
major evidence ingestion
major scope change
hypothesis change
major contradiction
analysis completion
judgment update
research completion
```

## 50. Continuous QC

QC is not only a final checklist.

It should operate continuously during research.

```text NEW EVIDENCE
```text
      ↓
QUALITY REASSESSMENT
      ↓
CLAIMS
      ↓
HYPOTHESES
      ↓
ANALYSIS
      ↓
JUDGMENT
      ↓
```
QUALITY REASSESSMENT
```

## 51. Adaptive QC

The amount of QC should scale with materiality.

Simple research:

```text lightweight validation
```

Complex/high-impact research:

```text deeper provenance
contradiction checks
alternative explanation checks
cross-source validation
freshness validation
```

## 52. Quality-Control Actions

QC can trigger:

```text VALIDATE_SOURCE
RECHECK_EVIDENCE
SEARCH_CONTRADICTION
SEARCH_ALTERNATIVE
REFRESH_DATA
EXPAND_SCOPE
NARROW_SCOPE
REASSESS_HYPOTHESIS
REASSESS_JUDGMENT
REQUEST_CLARIFICATION
MARK_INSUFFICIENT
```

## 53. QC Does Not Rewrite Evidence

QC may flag an evidence classification error.

It must not silently rewrite the underlying observation.

Corrections preserve history.

## 54. QC Does Not Manufacture Evidence

If evidence is unavailable:

```text unavailable
```

must remain unavailable.

The system cannot fill the gap with plausible reasoning and present it as evidence.

## 55. QC and Failure Handling

Technical failure and research weakness remain distinct.

```text retrieval failure
≠
negative evidence
```

```text insufficient evidence
≠
system failure
```

## 56. QC and Personalization

Personal preferences may influence research style.

They must not lower evidence requirements merely because the trader prefers a fast answer.

## 57. QC and Thesis

Thesis-aware research must undergo the same quality checks as neutral research.

A thesis cannot receive stronger evidence merely because it is the trader's thesis.

## 58. QC and Framework

Framework evaluation must verify:

```text correct framework version
correct factor mapping
correct evidence
correct conditions
correct weights
correct rules
```

The system must not alter the framework to improve the result.

## 59. QC and Monitoring

Monitor-generated evidence enters the same quality system.

Repeated monitor observations must not become independent confirmations simply because they arrived at different times.

## 60. QC and Historical Memory

Historical memory can inform research.

It must be labeled and revalidated when required.

Memory cannot silently become current evidence.

## 61. QC and Saved Research

Saved research retains its quality state at save time.

When reused later:

```text freshness check
+
revalidation
```

may be required.

## 62. Quality Degradation

Research quality may decline over time because:

* evidence becomes stale
* sources change
* assumptions become invalid
* new contradictory evidence appears
* context changes

Quality should therefore be recalculated when research is restored.

## 63. Quality Improvement

New evidence can improve quality.

Example:

```text weak evidence
→ primary source retrieved
→ corroboration found
→ contradiction resolved
→ quality improves
```

## 64. Quality Regression

New evidence can reduce quality.

Example:

```text strong judgment
→ major contradiction discovered
→ confidence decreases
→ research quality decreases
→ investigation reopens
```

The system must preserve the earlier state.

## 65. Quality History

```text id="v8c4mq"
QUALITY_HISTORY {
  previous_state
  new_state
  trigger
  affected_objects[]
  explanation
  timestamp
  provenance
}
```

## 66. Quality Gate Before Judgment

Before producing a major judgment:

```text TARGET VALID?
SCOPE VALID?
EVIDENCE SUFFICIENT?
CONTRADICTIONS CHECKED?
ALTERNATIVES CONSIDERED?
PROVENANCE COMPLETE?
FRESHNESS ACCEPTABLE?
UNCERTAINTY REPRESENTED?
```

If not, either continue research or explicitly produce an insufficient-evidence judgment.

## 67. Quality Gate Before Completion

```text OBJECTIVE SATISFIED?
MATERIAL GAPS KNOWN?
MATERIAL CONTRADICTIONS HANDLED?
JUDGMENT TRACEABLE?
LIMITATIONS DISCLOSED?
CURRENT ENOUGH?
```

## 68. Quality Report

```text id="x6m9kp"
QUALITY_REPORT {
  overall_quality
  strongest_dimensions[]
  weakest_dimensions[]
  blocking_issues[]
  material_issues[]
  unresolved_gaps[]
  contradiction_summary
  evidence_summary
  provenance_summary
  freshness_summary
  confidence_summary
  recommended_actions[]
  completion_status
}
```

## 69. Trader-Facing Quality Output

Default presentation should remain concise:

```text Research quality: Strong

Strongest:
- Primary evidence
- Good source corroboration
- Clear event timeline

Weakness:
- One material causal relationship remains uncertain

Impact:
The uncertainty does not currently overturn the main judgment.
```

The trader can request deeper QC.

## 70. Explainability

When asked:

```text "Why is this research only adequate?"
```

the system should expose the actual quality deficiencies.

It must not generate a fictional explanation after the fact.

## 71. QC Audit Trail

Every material quality decision should be traceable to:

```text quality_check
→ affected_object
→ evidence
→ source
→ result
→ action
```

## 72. Quality Object

```text id="b5q8nx"
QUALITY_CHECK {
  id
  research_ref
  check_type
  target_refs[]
  criteria
  inputs[]
  result
  severity
  detected_issues[]
  recommended_action
  executed_action
  timestamp
  provenance
}
```

## 73. Check Types

```text TARGET_VALIDATION
SCOPE_VALIDATION
SOURCE_VALIDATION
EVIDENCE_VALIDATION
COVERAGE_CHECK
CONTRADICTION_CHECK
ALTERNATIVE_CHECK
CAUSAL_CHECK
FRESHNESS_CHECK
PROVENANCE_CHECK
ENTITY_CHECK
TEMPORAL_CHECK
CONFIDENCE_CHECK
COMPLETION_CHECK
PERSONALIZATION_CHECK
```

## 74. Quality Scoring

A numerical score should not be the primary user-facing representation.

Internally, dimensions may be normalized for scheduler decisions.

The UI should prioritize qualitative states and concrete reasons.

## 75. Quality and Resource Allocation

QC findings can influence the execution scheduler.

Example:

```text contradiction risk high
→ allocate resources to contradiction research
```

```text provenance weak
→ prioritize source validation
```

```text coverage complete
→ reduce further discovery
```

## 76. Quality and Information Value

QC should prioritize problems according to:

```text materiality
```text
+
probability of changing judgment
+
cost of resolution
+
```
urgency
```

## 77. Quality and Stopping

QC feeds the Completion & Stopping Intelligence.

Research may stop when:

```text remaining uncertainty
+
remaining quality issues
```

are unlikely to materially change the answer, subject to explicit research constraints.

## 78. Quality and Replanning

Material QC failure can reopen the research plan.

Example:

```text causal evidence inadequate
→ create causal investigation task
→ allocate resources
→ reassess judgment
```

## 79. Quality and Branching

If one hypothesis has poor evidence:

```text weaken that branch
```

not:

```text reject the entire research.
```

Other branches remain intact.

## 80. Quality and Evidence Correction

When evidence is corrected:

```text evidence
→ claims
→ hypotheses
→ analyses
→ judgment
→ quality
```

are selectively reassessed.

## 81. Quality and Judgment Revision

A judgment may change without research being invalid.

New evidence can legitimately produce a new judgment.

QC records:

```text previous judgment
new judgment
trigger
evidence
quality impact
```

## 82. Quality and Confidence Revision

Confidence should change when material evidence or research quality changes.

Minor evidence should not cause unnecessary confidence oscillation.

## 83. Quality Stability

The system should avoid repeatedly changing quality state because of trivial fluctuations.

Materiality thresholds and evidence aggregation prevent noise-driven instability.

## 84. Quality Control Failure

If QC itself cannot run:

```text QC_UNAVAILABLE
```

The system must not claim the research has passed QC.

Research may continue if otherwise valid, but the limitation must be disclosed.

## 85. Quality-Control Integrity

QC must never:

* fabricate validation
* fabricate corroboration
* fabricate source quality
* hide contradictions
* manufacture completeness
* inflate confidence
* silently change scope
* silently downgrade evidence
* silently rewrite research history

## 86. Completion Criteria

Research Quality Control Intelligence is complete when:

* every major research object can be quality-checked
* evidence quality is claim-specific
* source independence is evaluated
* coverage is measurable
* contradictions are actively checked
* alternative explanations can be tested
* causal claims receive causal QC
* historical research receives precedent QC
* provenance is traceable
* freshness is contextual
* entity and temporal consistency are checked
* confidence is separated from research quality
* personalization cannot corrupt QC
* material QC findings can trigger replanning
* quality can improve or regress
* quality history is preserved
* completion gates exist
* insufficient evidence is a valid outcome
* QC failures do not become fabricated evidence
* the trader can inspect why research quality has a particular state

## 87. Global QC Loop

```text
RESEARCH
```text
   ↓
QUALITY CHECK
   ↓
IDENTIFY GAPS / CONTRADICTIONS / WEAKNESSES
   ↓
ASSESS MATERIALITY
   ↓
IF MATERIAL
   ↓
REPLAN / VALIDATE / REFRESH / CHALLENGE
   ↓
NEW EVIDENCE
   ↓
REASSESS CLAIMS
   ↓
REASSESS HYPOTHESES
   ↓
REASSESS ANALYSIS
   ↓
REASSESS JUDGMENT
   ↓
REASSESS QUALITY
   ↓
```
CONTINUE OR COMPLETE
```

## Core Principle

```text
GOOD RESEARCH IS NOT RESEARCH WITH A CONFIDENT ANSWER.

GOOD RESEARCH IS RESEARCH WHERE THE ANSWER IS PROPORTIONAL
TO THE QUALITY, COVERAGE, FRESHNESS, AND LIMITATIONS OF THE EVIDENCE.
