---
title: "EVIDENCE & SOURCE INTELLIGENCE"
source: EVIDENCE & SOURCE INTELLIGENCE.txt
converted: 2026-09-12
type: architecture-spec
related: [source-discovery-retrieval.md, source-intelligence.md, hypothesis.md, judgment-confidence.md]
---

**Related documents:** `source-discovery-retrieval.md` · `source-intelligence.md` · `hypothesis.md` · `judgment-confidence.md`

> Converted from `EVIDENCE & SOURCE INTELLIGENCE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

EVIDENCE & SOURCE INTELLIGENCE

Purpose
-------

Evidence & Source Intelligence is the system responsible for discovering, retrieving, extracting, evaluating, organizing, validating, weighting, linking, and maintaining the information used by the research system.

Its purpose is not simply to collect information.

It must determine:

- What information is relevant.
- Where that information came from.
- What exactly the source establishes.
- How directly the source supports a claim.
- How reliable and current the information is.
- Whether independent sources corroborate it.
- Whether sources conflict.
- Whether information is observation, interpretation, or speculation.
- Whether evidence is sufficient for a judgment.
- Whether evidence has become stale or invalid.
- How evidence should affect claims, hypotheses, analyses, judgments, theses, and monitoring.

Evidence & Source Intelligence operates underneath all research flows and universal actions.

Core principle:

The system must optimize for evidence quality and decision relevance, not information volume.


1. SOURCE MODEL
---------------

A SOURCE is the origin from which information is obtained.

A source may be:

- Official announcement
- Company filing
- Regulatory filing
- Government publication
- Exchange data
- Market-data provider
- Blockchain/on-chain data
- Protocol documentation
- Research publication
- Academic paper
- News organization
- Journalist
- Analyst
- Social-media post
- Community discussion
- Dataset
- API
- Search result
- Tool-generated observation
- Direct market observation
- Historical record
- Trader-provided information

Source object:

SOURCE {
  id
  type
  subtype

  locator
  publisher
  author
  organization

  published_at
  updated_at
  retrieved_at

  content_reference

  source_reliability
  provenance

  jurisdiction
  language

  source_relationships

  status
  freshness

  history
}


2. SOURCE IDENTITY
------------------

Every retrieved source should receive a stable internal identity.

The system should preserve:

- Source ID
- Original locator
- Publisher
- Author when available
- Publication timestamp
- Retrieval timestamp
- Update timestamp when available
- Content reference
- Retrieval method
- Tool or Skill that retrieved it
- Research context in which it was retrieved

The system must distinguish:

- When information was published.
- When information was retrieved.
- When the underlying event occurred.

These timestamps must never be silently conflated.


3. SOURCE PROVENANCE
--------------------

Every source must maintain provenance.

Provenance should answer:

- Where did this information originate?
- How was it retrieved?
- When was it retrieved?
- Was it directly observed or obtained through another source?
- Has the content been transformed?
- Which research task retrieved it?
- Which tool or Skill retrieved it?
- Which claims currently depend on it?

Derived information must preserve its origin.

A secondary source quoting a primary source must not be treated as equivalent to the primary source.

The system should preserve the provenance chain:

ORIGIN
→ SOURCE
→ RETRIEVAL
→ EXTRACTION
→ EVIDENCE
→ CLAIM
→ HYPOTHESIS
→ ANALYSIS
→ JUDGMENT


4. SOURCE HIERARCHY
-------------------

The system should distinguish source authority based on context.

There is no universal source ranking.

A source's usefulness depends on the claim being evaluated.

For example:

- Official filing may be strongest for a company's reported financial information.
- Blockchain data may be strongest for an on-chain transaction.
- Exchange data may be strongest for observed trading activity on that exchange.
- A regulatory publication may be strongest for regulatory action.
- A reputable news source may be useful for breaking developments before primary confirmation.
- Social media may be valuable for discovering emerging information but weaker for independently verified factual claims.

Therefore:

Source authority is claim-specific, not absolute.


5. PRIMARY VS SECONDARY INFORMATION
-----------------------------------

The system should distinguish:

PRIMARY INFORMATION

Information directly originating from the entity, system, event, dataset, or authoritative record being studied.

Examples:

- Official announcement
- Filing
- Blockchain transaction
- Exchange data
- Government record
- Protocol documentation
- Direct measurement

SECONDARY INFORMATION

Information reported, interpreted, summarized, or analyzed by another party.

Examples:

- News report
- Analyst commentary
- Research article
- Social-media interpretation
- Community discussion

Secondary sources remain useful.

They must not automatically be treated as independently corroborating evidence when they ultimately derive from the same primary source.


6. EVIDENCE MODEL
-----------------

EVIDENCE represents an observed or retrieved piece of information that bears on one or more research claims or hypotheses.

Evidence object:

EVIDENCE {
  id

  observation
  evidence_type

  source_refs

  timestamp
  observed_at

  supports[]
  contradicts[]

  directness
  reliability
  recency
  specificity
  corroboration

  source_independence

  interpretation

  status

  provenance
  context

  freshness
  confidence

  history
}


7. EVIDENCE TYPES
-----------------

The system should distinguish at minimum:

- FACTUAL_OBSERVATION
- QUANTITATIVE_OBSERVATION
- MARKET_DATA
- ONCHAIN_OBSERVATION
- DOCUMENTED_STATEMENT
- HISTORICAL_RECORD
- EXPERT_INTERPRETATION
- ANALYST_INTERPRETATION
- MARKET_SENTIMENT
- COMMUNITY_SIGNAL
- INFERENCE
- SPECULATION

The system must not silently upgrade:

SPECULATION → FACT

INTERPRETATION → FACT

INFERENCE → OBSERVATION

A source may contain several evidence types.

For example:

A news article may contain:
- verified event information
- journalist interpretation
- quoted analyst opinion
- speculation about future consequences

These components should be separated where materially relevant.


8. OBSERVATION VS INTERPRETATION VS SPECULATION
------------------------------------------------

Evidence management must preserve epistemic distinctions.

OBSERVATION:

Something directly observed, recorded, measured, documented, or explicitly stated.

INTERPRETATION:

A reasoned meaning assigned to observations.

SPECULATION:

A possibility without sufficient evidence to establish it.

The system must clearly distinguish these categories in the evidence graph.

Example:

Observation:
A token experienced a 15% price increase after an announcement.

Interpretation:
The announcement may have contributed to the price increase.

Speculation:
The announcement will cause sustained appreciation.

These are different epistemic objects and must not be collapsed.


9. EVIDENCE EXTRACTION
----------------------

Retrieved information should be converted into structured evidence where useful.

Extraction may identify:

- Facts
- Numbers
- Dates
- Events
- Statements
- Relationships
- Changes
- Entities
- Market observations
- Claims
- Contradictions
- Conditions
- Signals

The system should retain the original source reference alongside extracted evidence.

Extraction must not lose:

- Context
- Qualifiers
- Timeframe
- Conditions
- Uncertainty
- Attribution

A sentence saying:

"X may increase demand if Y occurs"

must not become:

"X increases demand."


10. CLAIM-SPECIFIC EVIDENCE LINKING
-----------------------------------

Evidence should be linked to the specific claims it supports or contradicts.

Evidence must not be treated as globally positive or negative.

For each evidence-claim relationship:

EVIDENCE
→ CLAIM
→ RELATIONSHIP
→ STRENGTH
→ BASIS

Possible relationships:

- SUPPORTS
- CONTRADICTS
- QUALIFIES
- CONTEXTUALIZES
- NEUTRAL_TO
- DOES_NOT_ADDRESS

The same evidence may:

- Support one claim.
- Contradict another.
- Be irrelevant to a third.

Therefore evidence evaluation is claim-specific.


11. CLAIM IMPORTANCE
--------------------

Not every claim deserves equal research effort.

Claims should have an importance level based on:

- Impact on the research objective.
- Impact on final judgment.
- Dependency relationships.
- Centrality to the thesis.
- Uncertainty.
- Potential to change the conclusion.

High-impact uncertain claims receive more evidence scrutiny.

Low-impact claims should not consume disproportionate research resources.


12. EVIDENCE QUALITY DIMENSIONS
------------------------------

Evidence quality should be evaluated across multiple dimensions.

Core dimensions:

1. Reliability
2. Directness
3. Recency
4. Specificity
5. Corroboration
6. Source independence
7. Provenance quality
8. Context completeness
9. Consistency
10. Relevance

No single dimension determines evidence quality.

A highly reliable source may still provide weak evidence for a particular claim if the source does not directly address that claim.


13. RELIABILITY
--------------

Reliability measures how trustworthy the source or observation is for the relevant type of information.

Factors include:

- Historical accuracy
- Source authority
- Transparency
- Methodology
- Data quality
- Verification
- Track record
- Primary-source status
- Potential incentives to mislead
- Reproducibility

Reliability is contextual.

A source may be reliable for one type of information and weak for another.


14. DIRECTNESS
--------------

Directness measures how directly evidence bears on a claim.

High directness:

The evidence directly observes or establishes the claim.

Medium directness:

The evidence provides strong indirect support.

Low directness:

The evidence is several inferential steps away.

The system should prefer direct evidence where available.

Indirect evidence remains valuable when direct evidence is unavailable.


15. SPECIFICITY
--------------

Specificity measures how precisely evidence addresses the claim.

Specific evidence should receive greater weight than broad or generic information when evaluating a specific claim.

The system should distinguish:

"Market sentiment is positive."

from:

"Open interest increased 18% while funding remained positive during the price move."

The second may be substantially more specific for a market-structure claim.


16. RECENCY
-----------

Recency measures how current evidence is relative to the research question.

Recency must be evaluated relative to context.

Examples:

- Seconds may matter for market microstructure.
- Hours may matter for breaking news.
- Days may matter for macro developments.
- Months or years may matter for structural research.
- Historical evidence may remain valuable even when old.

Old does not mean useless.

Old evidence should be classified according to whether it remains relevant.

Possible freshness states:

- CURRENTLY_RELEVANT
- HISTORICALLY_RELEVANT
- STALE
- INVALID
- UNKNOWN


17. CORROBORATION
-----------------

Corroboration measures whether independent evidence supports the same claim.

Corroboration should consider source independence.

Five articles repeating the same original report are not five independent confirmations.

The system should identify common ancestry where possible.

Example:

PRIMARY SOURCE
```text
↓
Newswire
↓
Article A
↓
Article B
↓
```
Social Post

This should not be counted as five independent sources.


18. SOURCE INDEPENDENCE
-----------------------

Source independence measures whether apparently separate sources are actually independent.

The system should detect:

- Shared original source
- Shared data provider
- Shared quoted statement
- Shared dataset
- Syndicated reporting
- Copying/republication
- Common analytical origin

Independent corroboration should receive greater evidentiary value than duplicated reporting.


19. SOURCE CONFLICTS OF INTEREST
-------------------------------

The system should identify material incentives that may affect source reliability.

Potential factors:

- Financial interest
- Promotional relationship
- Token ownership
- Corporate affiliation
- Political incentive
- Competitive relationship
- Sponsored research
- Anonymous sourcing
- Reputation incentives

A conflict of interest does not automatically invalidate evidence.

It affects the evidence-quality assessment.


20. SOURCE BIAS
---------------

The system should distinguish:

SOURCE BIAS

from:

SOURCE FALSEHOOD.

A biased source may still provide accurate information.

The system should therefore:

- Identify relevant bias.
- Reduce confidence when appropriate.
- Seek independent corroboration.
- Preserve the source rather than automatically discarding it.

Bias is evidence about source quality, not proof that the information is false.


21. EVIDENCE WEIGHTING
---------------------

Evidence weight should be dynamic.

Weight should consider:

- Relevance
- Reliability
- Directness
- Recency
- Specificity
- Corroboration
- Independence
- Provenance
- Contradictions
- Context
- Claim importance

The system must avoid a single rigid universal scoring formula.

Different claims require different weighting.

Example:

For a current price claim:
recency and direct market data may dominate.

For a historical causal claim:
source reliability, methodological quality, causal relevance, and historical context may dominate.


22. DYNAMIC WEIGHTING
---------------------

Evidence weight may change when new information appears.

Examples:

New independent confirmation:
→ increase confidence.

Primary source contradiction:
→ reduce confidence.

Source discovered to be derivative:
→ reduce apparent corroboration.

Information becomes stale:
→ reduce current relevance.

New contextual information:
→ change interpretation.

A material weight change should be recorded in evidence history when it affects a judgment.


23. EVIDENCE CONFLICTS
---------------------

Conflicting evidence must be preserved.

The system must never silently select one side simply because it is easier to synthesize.

For conflicting evidence, evaluate:

- Source reliability
- Directness
- Recency
- Specificity
- Corroboration
- Independence
- Methodology
- Context
- Possible conflicts of interest
- Whether the evidence addresses the same timeframe
- Whether the evidence actually concerns the same claim

Possible outcomes:

- One side clearly stronger.
- Evidence remains genuinely mixed.
- Evidence refers to different conditions.
- Evidence refers to different time periods.
- Apparent contradiction disappears after context resolution.
- Additional research required.

When unresolved, preserve the conflict and reduce confidence when materially justified.


24. CONTRADICTION DETECTION
---------------------------

Contradictions may occur between:

- Sources
- Evidence
- Claims
- Hypotheses
- Historical research
- Current research
- Thesis assumptions
- Framework expectations

The system should distinguish:

DIRECT CONTRADICTION

from:

APPARENT CONTRADICTION

from:

CONTEXTUAL DIFFERENCE.

Before declaring contradiction, check:

- Timeframe
- Entity
- Definition
- Measurement
- Conditions
- Source origin
- Scope


25. EVIDENCE DEDUPLICATION
--------------------------

Duplicate evidence should not inflate confidence.

Duplicates may arise from:

- Same source retrieved twice.
- Same event reported repeatedly.
- Syndicated articles.
- Repeated API results.
- Cached information.
- Multiple tools returning identical information.
- Different URLs pointing to the same underlying content.

The system should consolidate materially identical evidence while preserving all useful provenance.

Deduplication must not remove genuinely independent corroboration.


26. EVIDENCE REUSE
-----------------

Evidence may be reused across research objects.

Reusable evidence must retain:

- Original source.
- Retrieval time.
- Original context.
- Claim relationship.
- Research context.
- Freshness.
- Interpretation.
- Provenance.

Reuse does not automatically mean current validity.

When reused for a new research question, the system must reassess:

- Relevance.
- Freshness.
- Claim applicability.
- Context.
- Evidence quality.


27. HISTORICAL EVIDENCE
----------------------

Historical evidence remains valuable.

Historical evidence may inform:

- Precedent.
- Pattern recognition.
- Thesis evolution.
- Historical comparisons.
- Hypothesis generation.
- Risk assessment.

Historical evidence must not silently become current evidence.

The system must label historical evidence explicitly when material.


28. STALE EVIDENCE
------------------

Evidence becomes stale when it is no longer sufficiently current for the research context.

Staleness depends on:

- Research domain.
- Time sensitivity.
- Market conditions.
- Original claim.
- New information.
- Source update status.

Stale evidence remains in history.

It should be excluded from current decision-making unless revalidated.


29. INVALID EVIDENCE
--------------------

Evidence becomes INVALID when it should no longer be relied upon.

Examples:

- Source corrected the information.
- Data was proven erroneous.
- Underlying event was misidentified.
- Extraction was incorrect.
- Source was fraudulent.
- Evidence was based on a false premise.
- Context materially invalidates the observation.

Invalid evidence remains preserved for provenance.

It must not contribute to current judgment unless validity is re-established.


30. EVIDENCE REVALIDATION
-------------------------

Revalidation may be triggered when:

- Stale evidence is reused.
- Historical evidence becomes relevant to a current claim.
- Source content changes.
- Contradictory evidence appears.
- A dependent judgment changes materially.
- A monitor retrieves new information.
- Trader explicitly requests fresh validation.

Revalidation should determine:

- Still valid?
- Still relevant?
- Still current?
- Same interpretation?
- Changed context?

Previous state must remain in history.


31. SOURCE FRESHNESS
--------------------

Source freshness and evidence freshness are distinct.

A source may be current while containing historical information.

A source may be old while documenting a timeless or still-valid fact.

Therefore freshness must be evaluated against the evidence and claim, not merely the publication date.


32. CURRENT VS HISTORICAL INFORMATION
-------------------------------------

The system should maintain explicit epistemic status:

CURRENT EVIDENCE
Historical evidence that remains relevant and validated.

HISTORICAL EVIDENCE
Useful for context or precedent but not current proof.

STALE EVIDENCE
Potentially relevant but requires revalidation.

INVALID EVIDENCE
Should not influence current conclusions.

UNKNOWN
Freshness or validity cannot currently be established.


33. EVIDENCE SUFFICIENCY
------------------------

Research should stop when evidence is sufficient for the research objective.

Sufficiency depends on:

- Claim importance.
- Evidence quality.
- Contradiction level.
- Uncertainty.
- Research flow.
- Potential impact on judgment.
- Remaining information value.

Evidence volume is not the objective.

The scheduler should prioritize additional evidence when it could materially change:

- Claim status.
- Hypothesis ranking.
- Analysis.
- Judgment.
- Thesis assessment.
- Monitoring conditions.


34. MISSING EVIDENCE
-------------------

The system should explicitly identify important missing evidence.

Missing evidence may include:

- Unavailable data.
- Unverified claim.
- Missing primary source.
- Missing timeframe.
- Missing market data.
- Missing historical comparison.
- Missing independent corroboration.
- Missing causal evidence.

The system must distinguish:

"Evidence does not support the claim."

from:

"Evidence required to evaluate the claim is unavailable."


35. EVIDENCE GAPS
----------------

Evidence gaps should be linked to claims or hypotheses.

Example:

CLAIM
```text
↓
Evidence available
↓
Evidence gap
↓
Required evidence
↓
```
Research task

Evidence gaps may create new tasks in the Research Plan.

High-impact evidence gaps should receive higher scheduler priority.


36. WEAK EVIDENCE
-----------------

Weak evidence should not automatically be discarded.

Weak evidence may:

- Generate hypotheses.
- Identify emerging signals.
- Suggest further research.
- Provide context.
- Indicate possible risks.

But weak evidence must not be presented as strong confirmation.

The system should preserve epistemic labeling.


37. NOISY INFORMATION
---------------------

The system should distinguish meaningful signals from noise.

Noise may include:

- Repeated low-value social posts.
- Unverified rumors.
- Short-lived market fluctuations.
- Duplicate reporting.
- Low-quality sentiment.
- Irrelevant correlations.

Noise should not dominate research simply because it is abundant.

High-volume information is not automatically high-value information.


38. SIGNAL DETECTION
--------------------

Signal detection should consider:

- Magnitude
- Persistence
- Novelty
- Corroboration
- Relevance
- Context
- Historical baseline
- Relationship to active hypotheses

Potential signals should be classified as:

- CONFIRMED
- PROBABLE
- EARLY_SIGNAL
- WEAK_SIGNAL
- NOISE
- UNKNOWN

Early signals may justify further research without being treated as established facts.


39. EVIDENCE TO HYPOTHESIS LINKING
----------------------------------

Evidence may:

- Support hypothesis.
- Contradict hypothesis.
- Qualify hypothesis.
- Introduce a new hypothesis.
- Reduce confidence in hypothesis.
- Increase confidence in hypothesis.

Hypothesis confidence must be based on the complete evidence set rather than a single supporting source.

When a leading hypothesis receives strong contradictory evidence:

- Reassess it.
- Preserve previous ranking.
- Re-rank alternatives.
- Create a new hypothesis if warranted.
- Replan research when material.


40. EVIDENCE TO JUDGMENT LINKING
--------------------------------

The current judgment must be traceable to its evidence.

Judgment basis:

JUDGMENT
```text
├── Supporting evidence
├── Opposing evidence
├── Key claims
├── Leading hypotheses
├── Unresolved uncertainty
└── Confidence
```

The system should be able to answer:

"Why is this the current judgment?"

with a progressive evidence trail.


41. EVIDENCE TO THESIS LINKING
-----------------------------

Evidence may affect a trader's thesis through:

- Supporting evidence.
- Contradicting evidence.
- Evidence affecting an assumption.
- Evidence affecting a dependency.
- Evidence affecting expected outcome.
- Evidence affecting invalidation conditions.

Evidence must never silently rewrite the trader's thesis.

The system may reassess the thesis and recommend changes.

The trader remains the decision-maker.


42. EVIDENCE AND FRAMEWORKS
---------------------------

A framework defines how evidence should be evaluated.

Evidence should be gathered according to:

- Factor.
- Condition.
- Required evidence.
- Weight.
- Threshold/state.
- Evaluation rule.

Evidence strength and framework importance are different concepts.

A high-weight factor does not automatically have strong evidence.

The system must preserve that distinction.


43. CROSS-DOMAIN EVIDENCE
------------------------

Evidence may originate from multiple domains:

- Market data
- Macro
- News
- Sentiment
- On-chain
- Technical analysis
- Derivatives
- Market structure
- Ecosystem activity
- Regulation
- Historical precedent

Cross-domain evidence should be combined only when the relationship is meaningful.

The system should not manufacture relationships merely because two signals occur simultaneously.


44. CROSS-VALIDATION
--------------------

Cross-validation should be used when:

- Claim importance is high.
- Evidence is uncertain.
- Source reliability is questionable.
- Sources conflict.
- The conclusion has material implications.
- Primary confirmation is unavailable.
- A single source dominates the judgment.

Cross-validation may use:

- Independent sources.
- Different data providers.
- Primary-source confirmation.
- Different methodologies.
- Different data domains.

The goal is not maximum source count.

The goal is stronger confidence.


45. TOOL AND SKILL INTEGRATION
------------------------------

Evidence & Source Intelligence must integrate with the Research Execution Engine.

The execution system determines:

- Which Skills to use.
- Which tools to use.
- Which sources to query.
- How much research to perform.

Evidence Intelligence determines:

- What was actually obtained.
- What it means.
- How reliable it is.
- What it supports.
- What it contradicts.
- Whether it is sufficient.

The Bitget research Skills may provide specialized evidence:

- Macro analyst
- Market intel
- News briefing
- Sentiment analyst
- Technical analysis

Skills are evidence-generation mechanisms, not unquestionable authorities.

Skill outputs must still enter the evidence evaluation system.


46. TOOL FAILURE
----------------

If a source or tool fails:

- Record the failure.
- Preserve the attempted research task.
- Do not fabricate evidence.
- Try an appropriate alternative when useful.
- Reallocate research resources when necessary.
- Mark unavailable information explicitly.

A failed source lookup must never be represented as evidence.


47. SOURCE AVAILABILITY
----------------------

The system should distinguish:

AVAILABLE
The source was successfully retrieved.

PARTIALLY_AVAILABLE
Some information was retrieved but relevant content is missing.

UNAVAILABLE
The source could not be accessed.

UNVERIFIED
The source was encountered but authenticity or reliability is unresolved.

The system must not silently treat unavailable information as negative evidence.


48. DATA QUALITY
----------------

Structured data should be evaluated for:

- Completeness
- Accuracy
- Timestamp integrity
- Missing values
- Outliers
- Unit consistency
- Source consistency
- Update frequency
- Methodology

Narrative information should be evaluated for:

- Attribution
- Context
- Exact wording
- Claims vs observations
- Qualifiers
- Publication timing
- Source credibility


49. QUANTITATIVE EVIDENCE
-------------------------

Quantitative evidence should preserve:

- Value
- Unit
- Timestamp
- Timeframe
- Measurement definition
- Source
- Methodology
- Relevant baseline
- Comparison period

Numbers without context should not be treated as complete evidence.

For market data, relevant context may include:

- Exchange
- Trading pair
- Time interval
- Liquidity
- Volume
- Price source
- Timestamp


50. NARRATIVE EVIDENCE
---------------------

Narrative evidence should preserve:

- Exact source
- Attribution
- Speaker
- Date
- Context
- Qualifiers
- Whether statement is factual, interpretive, or speculative

Quoted statements should remain attributed.

The system must not convert an individual's opinion into an established fact.


51. EVIDENCE CONTEXT
--------------------

Evidence should retain the context in which it was retrieved.

Context includes:

- Research objective.
- Research flow.
- Claim.
- Hypothesis.
- Timeframe.
- Market conditions.
- Trader thesis when relevant.
- Framework when relevant.

The same evidence may have different significance in different contexts.


52. EVIDENCE CONFIDENCE
----------------------

Evidence confidence is not the same as judgment confidence.

Evidence confidence reflects confidence that the evidence itself is:

- Authentic.
- Correctly interpreted.
- Relevant.
- Current.
- Properly attributed.

Judgment confidence reflects confidence in the overall conclusion.

A judgment may have moderate confidence even when individual evidence items have high confidence because the evidence may remain incomplete or causally insufficient.


53. EVIDENCE HISTORY
-------------------

Material evidence changes should preserve history.

History may record:

- Original interpretation.
- Updated interpretation.
- Reliability changes.
- Freshness changes.
- Validation status.
- Claim relationships.
- Hypothesis relationships.
- Judgment impact.

Minor internal changes need not create excessive history noise.

Material changes must remain traceable.


54. EVIDENCE MATERIALITY
-----------------------

Not every evidence change should trigger downstream work.

Materiality depends on whether the change could affect:

- Claim status.
- Hypothesis ranking.
- Judgment.
- Thesis assessment.
- Monitoring conditions.
- Framework evaluation.

Material evidence changes trigger appropriate reassessment.

Non-material changes should not create unnecessary research churn.


55. EVIDENCE PROPAGATION
-----------------------

When evidence materially changes:

1. Identify linked claims.
2. Reassess affected claims.
3. Identify dependent hypotheses.
4. Reassess hypothesis ranking.
5. Identify affected analyses.
6. Reassess current judgment.
7. Determine thesis relevance.
8. Determine monitor relevance.
9. Preserve previous states.
10. Record the material transition.

Propagation must follow the dependency graph.

Unrelated research must remain untouched.


56. EVIDENCE AND CIRCULAR DEPENDENCIES
--------------------------------------

Evidence may participate in feedback loops.

Example:

New evidence
→ hypothesis changes
→ research direction changes
→ new evidence retrieved.

This is valid.

The system must prevent uncontrolled propagation loops using the existing propagation-event model:

- propagation_event_id
- origin_object
- affected_objects
- propagation_path
- material_change
- timestamp

An object already processed for the same material change should not be repeatedly processed within the same propagation event.


57. EVIDENCE RETRIEVAL STRATEGY
------------------------------

Evidence retrieval should be adaptive.

Initial retrieval should target the highest-value information.

Additional retrieval should occur when:

- Important claims remain unsupported.
- Evidence conflicts.
- Leading hypotheses remain uncertain.
- Primary sources are missing.
- New evidence changes the research direction.
- Additional research has high expected information value.

Retrieval should stop when additional information is unlikely to materially improve the judgment.


58. SOURCE DIVERSITY
--------------------

Source diversity should be considered when evaluating important claims.

Useful diversity may include:

- Different publishers.
- Different methodologies.
- Different data providers.
- Primary + secondary sources.
- Different domains.

Diversity should not become a mechanical requirement.

Multiple low-quality sources do not necessarily outperform one strong primary source.


59. INFORMATION VALUE
---------------------

Evidence collection should prioritize information with high expected value.

High-value evidence is information likely to:

- Resolve a major uncertainty.
- Distinguish competing hypotheses.
- Confirm or falsify a critical claim.
- Resolve a contradiction.
- Change the current judgment.
- Affect a consequential thesis assumption.

The scheduler should use evidence information value when prioritizing research tasks.


60. EVIDENCE STOPPING RULE
--------------------------

Evidence gathering should stop when:

- Critical claims have adequate support.
- Major contradictions are resolved or explicitly represented.
- Leading hypotheses have sufficient differentiation.
- Remaining uncertainty is understood.
- Additional research has low expected information value.
- Completion criteria are satisfied.

The system should not continue researching indefinitely merely because additional information exists.


61. EVIDENCE AND UNCERTAINTY
---------------------------

Evidence should explicitly contribute to uncertainty assessment.

Uncertainty may arise from:

- Missing evidence.
- Conflicting evidence.
- Weak evidence.
- Indirect evidence.
- Rapidly changing conditions.
- Limited historical precedent.
- Ambiguous source information.
- Unknown variables.

The system should distinguish:

LOW UNCERTAINTY
Evidence is strong, consistent, and sufficient.

MODERATE UNCERTAINTY
Evidence is useful but incomplete or mixed.

HIGH UNCERTAINTY
Evidence is weak, conflicting, sparse, or rapidly changing.


62. EVIDENCE AND CONFIDENCE
---------------------------

Evidence contributes to overall confidence but does not mechanically determine it.

Confidence should consider:

- Evidence quality.
- Evidence consistency.
- Hypothesis differentiation.
- Alternative explanations.
- Missing evidence.
- Contradictions.
- Research completeness.
- Currentness.

Confidence should remain qualitative by default:

- HIGH
- MODERATE
- LOW

Confidence changes should be visible when materially relevant.


63. EVIDENCE DECAY
-----------------

Evidence relevance can decay over time.

Decay depends on:

- Domain.
- Claim type.
- Market conditions.
- Research objective.
- New information.

Fast-changing market evidence may decay rapidly.

Structural or historical information may decay slowly.

Decay should influence freshness, not erase evidence.


64. SOURCE UPDATES
------------------

If a source is updated:

- Preserve the original retrieved version when material.
- Store the updated version.
- Compare material changes.
- Reassess affected evidence.
- Propagate only if the change is material.

A changed source must not silently overwrite historical provenance.


65. SOURCE CORRECTIONS
----------------------

When a source corrects previously published information:

- Mark affected evidence.
- Preserve the original version.
- Mark incorrect evidence INVALID where appropriate.
- Reassess linked claims.
- Propagate the correction.
- Preserve the correction provenance.

The system should clearly distinguish:

original report
from
corrected report.


66. SOURCE DELETION
------------------

If a source becomes unavailable:

- Preserve previously retrieved content when permitted by the system.
- Preserve provenance.
- Mark current accessibility status.
- Do not automatically invalidate previously verified evidence.

Loss of access is not equivalent to evidence invalidity.


67. USER-PROVIDED INFORMATION
-----------------------------

Trader-provided information may enter the evidence system.

It should be marked as:

TRADER_PROVIDED

and must not automatically receive the same reliability as independently verified evidence.

The system may use it as:

- Context.
- Research lead.
- Hypothesis input.
- Evidence when independently verifiable.

If the trader explicitly declares information authoritative for their own framework or preferences, preserve that distinction.


68. TRADER SOURCE CONSTRAINTS
-----------------------------

The trader may specify:

- Preferred sources.
- Excluded sources.
- Minimum evidence quality.
- Required primary sources.
- Minimum corroboration.
- Maximum research depth.
- Time constraints.
- Domain restrictions.

Hard constraints must be respected.

Preferences guide research unless they conflict with a higher-priority research requirement or explicit trader override.


69. SOURCE PREFERENCE VS SOURCE TRUTH
-------------------------------------

A preferred source does not become true merely because the trader prefers it.

A source exclusion should also not erase contradictory information from existence.

When source constraints materially limit research, the system should identify the resulting evidence limitation.


70. EVIDENCE ANNOTATIONS
-----------------------

Evidence may receive annotations such as:

- Important
- Needs verification
- Trader note
- Conflicting
- Primary source
- High confidence
- Historical
- Stale
- Potential signal

Annotations must not silently alter the underlying evidence.

They remain contextual metadata.


71. PROGRESSIVE DISCLOSURE
--------------------------

Default evidence presentation should be concise.

Show:

- Key evidence.
- Source.
- Relationship to conclusion.
- Evidence strength.
- Major contradiction when relevant.

On request, expose:

- Full source list.
- Provenance.
- Evidence weighting.
- Claim relationships.
- Hypothesis relationships.
- Contradictions.
- Historical versions.
- Retrieval details.

The system should not overwhelm the trader with every retrieved source by default.


72. EVIDENCE TRACEABILITY
------------------------

Every material judgment must be traceable through:

JUDGMENT
→ CLAIM
→ EVIDENCE
→ SOURCE

When hypotheses are involved:

JUDGMENT
→ HYPOTHESIS
→ CLAIM
→ EVIDENCE
→ SOURCE

The trader should be able to inspect the chain when desired.


73. EVIDENCE EXPLANATION
-----------------------

When asked:

"Why do you believe this?"

The system should provide:

1. Current judgment.
2. Most important supporting evidence.
3. Most important opposing evidence.
4. Key hypothesis or causal relationship.
5. Confidence.
6. Remaining uncertainty.

It should not dump the entire evidence database unless requested.


74. EVIDENCE QUALITY FAILURE
----------------------------

If evidence quality is insufficient:

The system should say so directly.

Possible outcomes:

- Research further.
- Reduce confidence.
- Mark conclusion provisional.
- Identify evidence gap.
- Present competing explanations.
- Ask for clarification when the missing information depends on trader intent.

The system must never fabricate certainty to produce a cleaner answer.


75. EVIDENCE INCOMPLETE RESEARCH
--------------------------------

Research may produce a useful but incomplete evidence set.

Such research should be marked:

INCOMPLETE

and preserve:

- What was investigated.
- What remains unknown.
- Why research stopped.
- Evidence collected.
- Confidence.
- Recommended next research when useful.

Incomplete research can be saved as a draft artifact.


76. EVIDENCE AND MONITORING
---------------------------

MONITOR may continuously retrieve new evidence.

New monitoring evidence should:

- Enter the evidence graph.
- Be linked to relevant claims.
- Reassess hypotheses when material.
- Reassess judgment when material.
- Affect thesis assessment when clearly relevant.
- Trigger alerts according to MONITOR rules.

Monitoring must not create independent disconnected evidence silos.


77. EVIDENCE AND CHALLENGE
--------------------------

CHALLENGE uses evidence to attempt falsification.

It should prioritize:

- Contradictory evidence.
- Weak assumptions.
- Alternative explanations.
- Missing evidence.
- Conditions that could invalidate the thesis.

Challenge should not selectively retrieve only evidence that supports the existing judgment.


78. EVIDENCE AND ANALYZE
------------------------

ANALYZE consumes evidence and produces structured analytical results.

Analysis must retain links to:

- Input evidence.
- Claims.
- Hypotheses.
- Sources.
- Prior analysis when relevant.

When new evidence materially changes the analysis:

- Reanalyze.
- Preserve the previous result.
- Record what changed.


79. EVIDENCE AND RESEARCH MEMORY
--------------------------------

Research Memory may preserve evidence references.

Memory must distinguish:

CURRENT EVIDENCE
from
HISTORICAL EVIDENCE
from
PRIOR RESEARCH CONTEXT.

Retrieved memory should never silently bypass current evidence validation.

When historical evidence becomes relevant to a new research question, it should be revalidated according to current context.


80. EVIDENCE AND SAVE
---------------------

SAVE may preserve:

- Evidence collections.
- Research results.
- Source sets.
- Evidence maps.
- Historical research.
- Reusable evidence packages.

Saved evidence must preserve:

- Source references.
- Provenance.
- Context.
- Timestamp.
- Status.
- Freshness.
- Relationships.

Saving evidence does not make it permanently current.


81. EVIDENCE AND RESEARCH FLOWS
------------------------------

Different research flows use evidence differently.

WHAT HAPPENED?
→ event evidence and timeline evidence.

WHY DID IT HAPPEN?
→ causal evidence and competing explanations.

WHAT COULD AFFECT IT?
→ forward-looking signals and conditional evidence.

DOES MY THESIS HOLD?
→ supporting and disconfirming thesis evidence.

HAS THIS HAPPENED BEFORE?
→ historical evidence and causal precedent.

WHAT DOES ALL THE INFORMATION SAY?
→ cross-domain evidence synthesis.

WHAT COULD PROVE ME WRONG?
→ falsifying evidence and early-warning signals.

EVALUATE ACCORDING TO MY FRAMEWORK
→ factor-specific evidence against required conditions and rules.


82. EVIDENCE INTEGRITY RULES
---------------------------

The evidence system must obey:

1. Never fabricate evidence.
2. Never fabricate sources.
3. Never silently upgrade speculation into fact.
4. Never treat duplicate reporting as independent corroboration.
5. Never hide material contradictions.
6. Never silently discard contradictory evidence.
7. Never silently rewrite historical evidence.
8. Never confuse retrieval time with event time.
9. Never confuse source reliability with claim relevance.
10. Never confuse evidence confidence with judgment confidence.
11. Never treat historical evidence as current without validation.
12. Never let source preference override factual integrity.
13. Never silently change evidence interpretation when provenance would be affected.
14. Never allow weak evidence to appear stronger merely because it is abundant.
15. Preserve traceability from judgment back to source.


83. EVIDENCE INTELLIGENCE EXECUTION LOOP
---------------------------------------

REQUEST
→ IDENTIFY INFORMATION REQUIREMENTS
→ SELECT SOURCES
→ RETRIEVE INFORMATION
→ VERIFY SOURCE
→ EXTRACT EVIDENCE
→ CLASSIFY EVIDENCE
→ NORMALIZE
→ DEDUPLICATE
→ EVALUATE QUALITY
→ LINK TO CLAIMS
→ LINK TO HYPOTHESES
→ DETECT CONTRADICTIONS
→ CROSS-VALIDATE
→ UPDATE EVIDENCE GRAPH
→ ASSESS SUFFICIENCY
→ REASSESS RESEARCH
→ UPDATE JUDGMENT
→ PRESERVE PROVENANCE
→ CONTINUE / STOP


84. GLOBAL EVIDENCE PRINCIPLE
-----------------------------

The system should not ask:

"How much information did we collect?"

It should ask:

"Do we have enough high-quality, relevant, sufficiently independent evidence to support the strongest defensible judgment?"

Evidence is valuable when it improves understanding, distinguishes hypotheses, reduces uncertainty, resolves contradictions, or changes the decision-relevant assessment.

Sources provide information.

Evidence provides support.

Claims provide propositions.

Hypotheses provide explanations.

Analysis provides interpretation.

Judgment provides the current best-supported assessment.

The evidence system connects all of them while preserving provenance, uncertainty, contradiction, freshness, and epistemic integrity.
