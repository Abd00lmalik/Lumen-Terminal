---
title: "ANALYSIS & SYNTHESIS INTELLIGENCE"
source: ANALYSIS & SYNTHESIS INTELLIGENCE.txt
converted: 2026-09-12
type: architecture-spec
related: [judgment-confidence.md, hypothesis.md, evidence-source.md, thesis-monitor-reassessment.md, research-flows.md, framework.md]
---

**Related documents:** `judgment-confidence.md` · `hypothesis.md` · `evidence-source.md` · `thesis-monitor-reassessment.md` · `research-flows.md` · `framework.md`

> Converted from `ANALYSIS & SYNTHESIS INTELLIGENCE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

ANALYSIS & SYNTHESIS INTELLIGENCE

PURPOSE

Analysis & Synthesis Intelligence is the layer that transforms researched evidence, claims, hypotheses, relationships, and context into coherent analytical findings.

It answers:

“What does the available evidence mean when considered together?”

It sits between research/hypothesis management and final judgment.

Core relationship:

EVIDENCE
→ CLAIMS
→ HYPOTHESES
→ ANALYSIS & SYNTHESIS
→ JUDGMENT
→ THESIS / MONITOR / NEXT ACTION

Analysis is not the same as Judgment.

Analysis organizes, compares, explains, interprets, and synthesizes information.

Judgment is the current best-supported assessment produced from the analytical work.

Analysis may contain a conclusion, but the JUDGMENT object remains the authoritative current assessment for a research investigation.


1. ANALYSIS OBJECT

```text
ANALYSIS {
  id

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
    framework_refs
    override
  }

  inputs {
    evidence_refs
    claim_refs
    hypothesis_refs
    analysis_refs
    judgment_refs
  }

  findings {
    primary
    supporting
    opposing
    relationships
    patterns
    anomalies
    gaps
  }

  assumptions

  alternatives

  relationships

  conclusion

  implications

  unresolved_questions

  uncertainty

  confidence

  provenance

  timestamps

  history

  status
}
```

2. ANALYTICAL MODES

The system supports structured analytical modes while remaining capable of handling arbitrary natural-language analytical requests.

Core modes:

COMPARE
EXPLAIN
INTERPRET
SYNTHESIZE

Additional analytical requests may be represented as freeform analytical objectives rather than forcing them into an unsuitable predefined mode.

The system should infer the analytical mode from natural language.

Examples:

“Compare Solana and Ethereum”
→ COMPARE

“Why did this happen?”
→ EXPLAIN

“What does this mean for my thesis?”
→ INTERPRET

“What does everything we found say?”
→ SYNTHESIZE

If multiple analytical modes are materially required, the system may combine them internally.

Example:

“What happened, why did it happen, and what does it mean for my position?”

May become:

EXPLAIN
```text
+
CAUSAL ANALYSIS
+
INTERPRET
+
```
SYNTHESIZE

The trader does not need to know or explicitly invoke these internal modes.

3. TARGET RESOLUTION

Analysis must resolve what is actually being analyzed.

Resolution priority:

1. Explicit target in the request
2. Active research context
3. Current conversation context
4. Relevant research memory
5. Relevant thesis/framework context
6. Clarification when materially ambiguous

Target resolution may include:

* asset
* market
* event
* protocol
* entity
* thesis
* hypothesis
* claim
* position context
* historical period
* relationship
* research result

If multiple materially different targets are plausible, clarify instead of silently choosing.

4. INPUT SELECTION

Analysis should use the strongest relevant available inputs.

Potential inputs:

* Evidence
* Claims
* Hypotheses
* Previous analyses
* Historical judgments
* Market data
* News
* Sentiment
* Macro information
* On-chain information
* Technical information
* Derivatives information
* Ecosystem information
* Regulatory information
* Framework evaluations
* Trader-provided context

The system should not treat every available object as equally relevant.

Input selection is relevance-driven.

Irrelevant information should not be included simply because it exists.

5. EVIDENCE SUFFICIENCY

Analysis begins with available evidence.

The system evaluates whether the available evidence is sufficient for the requested analysis.

Three states must remain distinguishable:

AVAILABLE EVIDENCE

The conclusion is based only on evidence already present in the workspace.

RESEARCHED EVIDENCE

Additional research was performed because the available evidence was insufficient.

UNAVAILABLE INFORMATION

Important information could not be obtained or verified.

The system must never silently treat unavailable information as established fact.

6. ADDITIONAL RESEARCH

Analysis is allowed to request additional research when necessary.

If evidence is insufficient and additional research could materially improve the analysis:

→ identify the missing information
→ request/trigger RESEARCH
→ ingest new evidence
→ update the analysis

The system should not research indefinitely.

Additional research should stop when:

* sufficient evidence exists
* additional research has low expected information value
* the relevant question has been adequately resolved
* available sources are exhausted
* remaining uncertainty cannot reasonably be reduced

7. ANALYTICAL ORIENTATION

Default orientation:

NEUTRAL

The system should evaluate the evidence without assuming that the trader's preferred conclusion is correct.

THESIS-AWARE analysis is activated when a relevant:

* thesis
* position
* belief
* expected outcome
* framework
* strategy assumption

is explicitly or contextually relevant.

Thesis-aware analysis does not mean confirmation.

The system must still search for contradictory evidence and competing interpretations.

8. COMPARATIVE ANALYSIS

COMPARE identifies meaningful similarities and differences between targets.

It should evaluate:

* common characteristics
* important differences
* magnitude of differences
* contextual differences
* historical differences
* structural differences
* causal differences
* market implications
* relevance to the requested decision

The system should distinguish:

SUPERFICIAL SIMILARITY

from

MATERIAL SIMILARITY.

Likewise:

SUPERFICIAL DIFFERENCE

from

DECISION-RELEVANT DIFFERENCE.

Comparisons must avoid false equivalence.

When appropriate, the system should identify which differences actually matter to the trader's question.

9. EXPLANATORY ANALYSIS

EXPLAIN determines the strongest-supported explanation for an observed phenomenon.

The system should:

1. Define what needs explaining
2. Identify relevant factors
3. Identify candidate explanations
4. Examine evidence for each
5. Examine evidence against each
6. Compare alternative explanations
7. Identify dependencies and causal relationships
8. Assess whether the explanation fits the observed outcome
9. Identify remaining uncertainty
10. Produce the strongest-supported explanation

The system must distinguish:

CORRELATION

from

CAUSATION.

A correlated event must not automatically be presented as the cause.

When causal evidence is weak, the analysis should say so.

10. CAUSAL ANALYSIS

When analysis requires causal reasoning, the system should construct a causal structure where useful.

Potential structure:

CAUSE
→ MECHANISM
→ INTERMEDIATE EFFECT
→ OBSERVED OUTCOME

The system should examine:

* temporal ordering
* mechanism
* alternative causes
* confounding factors
* dependencies
* expected observations
* contradictory observations
* scope conditions
* counterexamples

A causal explanation should become stronger when multiple independent pieces of evidence support both the proposed mechanism and the observed outcome.

Causal confidence should decrease when:

* timing does not fit
* mechanism is unsupported
* strong alternatives exist
* evidence is merely correlational
* contradictory evidence is material
* important assumptions remain untested.

11. INTERPRETIVE ANALYSIS

INTERPRET determines what researched information means in context.

It may analyze:

* implications
* relevance
* significance
* dependencies
* consequences
* relationship to a thesis
* relationship to a market condition
* relationship to a historical pattern
* potential changes in expectations

Interpretation must remain connected to evidence.

The system should distinguish:

OBSERVATION

from

INTERPRETATION

from

SPECULATION.

Interpretation may extend beyond directly observed facts, but the distinction must remain visible when material.

12. SYNTHESIS

SYNTHESIZE combines information across relevant sources, domains, claims, hypotheses, and analyses.

The goal is not to produce the largest summary.

The goal is to produce the strongest coherent picture.

Synthesis should identify:

* areas of agreement
* areas of disagreement
* relationships across domains
* important supporting evidence
* important opposing evidence
* dominant patterns
* anomalies
* unresolved conflicts
* missing information
* implications
* primary conclusion

Cross-domain relationships should only be surfaced when they are materially relevant.

The system should avoid creating artificial connections merely because two data points exist.

13. RELATIONSHIP IDENTIFICATION

Analysis may identify relationships between objects.

Potential relationships include:

* supports
* contradicts
* derived_from
* depends_on
* tests
* challenges
* references
* caused_by
* related_to
* informs
* evaluates

Relationships should be evidence-backed where material.

The system may infer clear relationships automatically.

Materially ambiguous relationships should not be silently asserted.

When a relationship changes downstream interpretation, its provenance and confidence should be preserved.

14. SUPPORTING AND OPPOSING EVIDENCE

Every material analytical conclusion should consider both sides.

Supporting evidence answers:

“What makes this interpretation more likely?”

Opposing evidence answers:

“What makes this interpretation less likely?”

The system should actively search for meaningful opposition when:

* the conclusion is uncertain
* the thesis is strong
* stakes are high
* evidence conflicts
* one hypothesis dominates
* confirmation bias is possible

Opposing evidence does not need to be given equal weight.

Evidence is weighted according to quality and relevance.

15. EVIDENCE WEIGHTING

Evidence should be evaluated using the existing Evidence & Source Intelligence model.

Relevant dimensions include:

* reliability
* directness
* recency
* specificity
* corroboration
* source independence
* provenance quality
* context completeness
* relevance
* consistency

Source authority is claim-specific.

A source that is highly authoritative for one claim may be less useful for another.

Multiple reports repeating the same underlying source do not automatically constitute independent corroboration.

16. CONFLICT RESOLUTION

When evidence conflicts, the system should not simply average the evidence.

It should investigate:

* source quality
* directness
* recency
* specificity
* source independence
* timeframe
* entity definition
* measurement methodology
* geographic scope
* market conditions
* underlying source origin
* possible conflicts of interest
* whether the evidence actually addresses the same claim

Possible outcomes:

CONFLICT RESOLVED

One interpretation is materially better supported.

CONFLICT QUALIFIED

Both pieces of evidence are valid but apply under different conditions.

CONFLICT UNRESOLVED

The evidence genuinely cannot currently be reconciled.

When conflict remains material, uncertainty must increase.

17. ALTERNATIVE EXPLANATIONS

Analysis should identify alternative explanations when they could materially change the conclusion.

Alternative explanations may come from:

* existing hypotheses
* new research findings
* historical precedent
* different causal mechanisms
* market structure
* macro conditions
* unrelated external factors

Alternatives should be ranked according to:

* explanatory power
* evidence
* relevance
* plausibility
* assumption burden
* ability to explain observed outcomes

The system should not manufacture alternatives merely to appear balanced.

18. ASSUMPTIONS

Analysis should identify assumptions that materially affect its conclusion.

For each important assumption, determine:

* what is assumed
* why it matters
* what evidence supports it
* what could invalidate it
* whether the conclusion depends heavily on it

High-impact unsupported assumptions should reduce confidence.

19. DEPENDENCIES

The analysis should identify dependencies between:

* claims
* hypotheses
* evidence
* causal mechanisms
* assumptions
* external conditions
* thesis components

If a critical dependency changes, the system should determine whether the analytical conclusion also needs revision.

Unrelated objects should not be affected.

20. TEMPORAL ANALYSIS

When time matters, analysis should preserve temporal context.

The system should distinguish:

* what was true previously
* what is true now
* what changed
* when it changed
* whether the current evidence reflects the change

Historical information must not silently become current evidence.

Time-sensitive conclusions should carry appropriate freshness and confidence.

21. QUANTITATIVE AND QUALITATIVE ANALYSIS

Analysis can combine quantitative and qualitative evidence.

Quantitative evidence may include:

* price
* volume
* volatility
* liquidity
* flows
* market share
* on-chain activity
* derivatives metrics
* macroeconomic indicators

Qualitative evidence may include:

* statements
* news
* narratives
* sentiment
* policy developments
* analyst interpretations
* community signals

The system should not allow a large quantity of weak qualitative information to automatically outweigh a smaller amount of strong quantitative or primary evidence.

Likewise, quantitative data should not automatically dominate when the analytical question is fundamentally qualitative.

22. PATTERN DETECTION

Analysis may identify:

* trends
* recurring relationships
* anomalies
* regime changes
* divergences
* clusters
* structural shifts

Patterns must be distinguished from explanations.

Detecting a pattern does not prove why the pattern exists.

23. UNCERTAINTY

Uncertainty is a first-class analytical output.

The system should identify uncertainty caused by:

* missing evidence
* conflicting evidence
* weak evidence
* ambiguous interpretation
* unstable conditions
* competing hypotheses
* untested assumptions
* historical limitations
* unreliable sources

Uncertainty should be specific where possible.

Instead of merely saying:

“Uncertain.”

The system should identify:

* what is uncertain
* why it is uncertain
* what evidence would reduce uncertainty
* whether the uncertainty materially affects the conclusion

24. CONFIDENCE

Confidence represents confidence in the analytical conclusion, not confidence that every input is correct.

Preferred levels:

HIGH
MODERATE
LOW

Confidence should depend on:

* evidence quality
* evidence sufficiency
* consistency
* corroboration
* alternative explanations
* unresolved conflicts
* assumption burden
* causal strength
* stability of relevant conditions

Confidence should not be increased merely because the system has produced a detailed analysis.

25. MATERIALITY

Not every finding deserves equal analytical weight.

The system should prioritize findings based on whether they could materially affect:

* the conclusion
* the thesis
* the expected outcome
* the relevant decision
* confidence
* important hypotheses

Minor information should not overwhelm the primary judgment.

Material findings should be retained in the analytical object and surfaced progressively.

26. NEW HYPOTHESIS CREATION

Analysis may create a new formal hypothesis only when a discovery materially changes the interpretation of the research.

Examples:

* unexpected evidence cannot be explained by current hypotheses
* a new causal mechanism appears
* an existing explanation becomes inadequate
* a major alternative interpretation emerges

Routine observations should not automatically become hypotheses.

When a new hypothesis is created:

→ preserve provenance
→ link it to the evidence that triggered it
→ send it to Hypothesis Intelligence
→ allow the Research Execution Engine to replan if necessary.

27. ANALYTICAL REVISION

Material new evidence must be able to change the analysis.

If new evidence materially affects the conclusion:

1. ingest the evidence
2. evaluate its quality
3. identify affected claims/hypotheses
4. reassess relationships
5. update the analysis
6. preserve the previous analytical state
7. determine whether the judgment must change
8. update confidence/uncertainty
9. propagate material downstream effects

Revision should happen automatically when the evidence is clearly material.

Minor evidence should not cause unnecessary analytical churn.

28. ANALYSIS HISTORY

Previous analytical conclusions must remain recoverable.

Material revisions should preserve:

* previous conclusion
* previous evidence basis
* previous confidence
* reason for revision
* triggering evidence
* timestamp
* affected relationships

The newest valid analysis is the current analytical state.

Previous analysis remains historical context.

29. DEPTH

Analysis uses the same adaptive depth model as RESEARCH.

Depth may be:

QUICK
STANDARD
DEEP
EXHAUSTIVE

These are internal representations.

The trader may request a specific depth.

The agent may dynamically increase analytical depth when evidence complexity or uncertainty warrants it.

The agent must not exceed an explicit hard depth/time/resource constraint without trader authorization.

30. COMPLETION

Analysis is considered sufficiently complete when:

* the requested analytical objective has been addressed
* material evidence has been considered
* important opposing evidence has been considered
* relevant alternatives have been evaluated
* major conflicts have been addressed
* remaining uncertainty is understood
* additional analysis is unlikely to materially change the result

Completion does not require certainty.

31. OUTPUT MODEL

The universal analytical output should contain:

PRIMARY FINDING

What the analysis currently supports.

SUPPORTING EVIDENCE

The strongest evidence supporting the finding.

OPPOSING EVIDENCE

The strongest evidence against it.

KEY RELATIONSHIPS

The relationships that materially explain the result.

ALTERNATIVES

Important competing explanations or interpretations.

UNCERTAINTY

What remains unresolved and why.

CONFIDENCE

HIGH / MODERATE / LOW.

IMPLICATIONS

What the finding means in the relevant context.

The presentation then adapts to the analytical mode.

COMPARE:
similarities → differences → material distinctions → conclusion.

EXPLAIN:
factors → mechanisms → alternatives → strongest explanation → uncertainty.

INTERPRET:
meaning → implications → dependencies → relevance → uncertainty.

SYNTHESIZE:
evidence → relationships → agreement/conflict → integrated conclusion → uncertainty.

32. PROGRESSIVE DISCLOSURE

The default analytical response should not expose the entire reasoning graph.

Default:

PRIMARY FINDING
```text
+
KEY SUPPORT
+
KEY OPPOSITION
+
CONFIDENCE
+
```
UNCERTAINTY

The trader can request deeper detail.

Examples:

“Show me the evidence.”

“Why do you think that?”

“What contradicts this?”

“Show me the competing explanations.”

“Show me how this changed.”

The deeper view exposes the relevant:

Evidence
→ Claims
→ Hypotheses
→ Relationships
→ Analysis
→ Judgment

without overwhelming the initial result.

33. TRACEABILITY

Every material analytical conclusion must be traceable to its inputs.

Required chain:

ANALYSIS
→ FINDING
→ CLAIM
→ EVIDENCE
→ SOURCE

Where hypotheses are involved:

ANALYSIS
→ FINDING
→ HYPOTHESIS
→ CLAIMS
→ EVIDENCE
→ SOURCES

Traceability must preserve:

* provenance
* timestamps
* source references
* analytical version
* relevant hypotheses
* relevant assumptions
* material conflicts

34. RELATIONSHIP TO JUDGMENT

Analysis produces analytical findings.

JUDGMENT produces the current best-supported assessment.

Therefore:

ANALYSIS ≠ JUDGMENT.

Multiple analyses may contribute to one judgment.

Example:

Technical Analysis
```text
+
Macro Analysis
+
Sentiment Analysis
+
Historical Analysis
→
SYNTHESIS
→
```
JUDGMENT

The Judgment layer decides how those analytical results combine into the current overall assessment.

35. RELATIONSHIP TO THESIS

Analysis may evaluate a trader's thesis when the thesis is relevant.

It may identify:

* supporting claims
* weak assumptions
* contradictions
* missing evidence
* alternative explanations
* implications

But analysis must never silently rewrite the trader's thesis.

If the thesis appears materially weakened:

→ report the analytical result
→ optionally suggest a revised thesis
→ preserve the original thesis
→ let the trader decide whether to change it.

36. RELATIONSHIP TO CHALLENGE

Analysis may identify weaknesses that warrant CHALLENGE.

When a conclusion depends on:

* fragile assumptions
* strong alternative explanations
* unresolved contradictions
* low-confidence evidence
* high-impact uncertainty

the system may recommend CHALLENGE.

CHALLENGE remains a separate action.

Analysis does not automatically become an adversarial challenge unless the request or research context requires it.

37. RELATIONSHIP TO MONITOR

Analysis may identify conditions worth monitoring.

Examples:

* an unresolved macro variable
* an emerging regulatory development
* a hypothesis-dependent market signal
* a condition that could materially change the conclusion

The system may recommend MONITOR.

Monitoring activation still requires the established confirmation boundary.

38. RELATIONSHIP TO MEMORY

Analysis may use historical research memory when relevant.

Retrieved memory must remain explicitly distinguishable from current evidence.

Current validated evidence takes precedence.

Historical analysis may provide:

* precedent
* prior conclusions
* previous hypotheses
* thesis evolution
* prior framework evaluations

but must not silently become current evidence.

39. RELATIONSHIP TO MANAGE_STATE

Analysis may cause workspace state changes such as:

* creating a new analysis
* updating an existing analysis
* superseding a previous analysis
* attaching findings to research
* updating relationships
* creating a checkpoint after a material revision

MANAGE_STATE remains responsible for state manipulation.

Analysis is responsible for analytical content.

40. RELATIONSHIP TO SAVE

Analysis is automatically preserved as workspace state.

Explicit SAVE may preserve an analysis as a reusable artifact.

Saving does not alter the active analytical state.

Material updates create new versions where appropriate.

41. ERROR AND FAILURE HANDLING

If analysis fails because evidence is insufficient:

→ identify missing evidence
→ request additional research when useful.

If analysis fails because evidence conflicts:

→ investigate conflict
→ reduce confidence if unresolved.

If analysis fails because target resolution is ambiguous:

→ ask for clarification.

If a source becomes invalid:

→ remove or downgrade affected evidence
→ identify affected claims
→ reassess analysis
→ update judgment if material.

If an analytical tool fails:

→ preserve completed work
→ retry or use alternative tools
→ continue where possible
→ do not discard unrelated research.

42. INTEGRITY RULES

The system must never:

* present speculation as fact
* confuse correlation with causation
* silently rewrite the trader's thesis
* silently turn historical information into current evidence
* hide material opposing evidence
* treat all sources as equally authoritative
* treat repeated copies of one source as independent corroboration
* create hypotheses without material justification
* claim certainty where evidence is insufficient
* ignore material conflicts
* overwrite analytical history
* allow irrelevant information to dominate synthesis
* manufacture relationships
* manufacture uncertainty merely to appear cautious
* manufacture confidence merely because the analysis is detailed

43. ANALYTICAL LOOP

The core loop is:

RESOLVE ANALYTICAL OBJECTIVE
→ RESOLVE TARGET
→ RESOLVE CONTEXT
→ SELECT ANALYTICAL MODE
→ SELECT RELEVANT INPUTS
→ ASSESS EVIDENCE SUFFICIENCY
→ IDENTIFY MISSING INFORMATION
→ RESEARCH IF NECESSARY
→ IDENTIFY CLAIMS
→ EVALUATE HYPOTHESES
→ IDENTIFY RELATIONSHIPS
→ COMPARE / EXPLAIN / INTERPRET / SYNTHESIZE
→ WEIGH SUPPORTING AND OPPOSING EVIDENCE
→ RESOLVE CONFLICTS
→ EVALUATE ALTERNATIVES
→ ASSESS UNCERTAINTY
→ ASSIGN CONFIDENCE
→ PRODUCE ANALYTICAL FINDINGS
→ UPDATE ANALYSIS OBJECT
→ DETERMINE WHETHER JUDGMENT CHANGES
→ PRESERVE HISTORY
→ UPDATE OBJECT GRAPH
→ COMPLETE OR CONTINUE

44. GLOBAL PRINCIPLE

Analysis & Synthesis Intelligence exists to turn information into understanding without pretending that uncertainty has disappeared.

The system should not optimize for:

“the longest analysis.”

It should optimize for:

“the strongest defensible interpretation of the available evidence.”

The final analytical result should make clear:

WHAT THE EVIDENCE SUPPORTS

WHAT IT DOES NOT SUPPORT

WHAT COMPETING EXPLANATIONS REMAIN

WHAT COULD CHANGE THE CONCLUSION

HOW CONFIDENT THE SYSTEM IS

The trader remains the final decision-maker.

```

This gives us the analytical layer. The next logical layer is **Judgment & Confidence Intelligence**, because we now have the machinery for producing findings but still need to define exactly how those findings become the single current best-supported judgment.
```
