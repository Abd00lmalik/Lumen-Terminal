---
title: "THESIS INTELLIGENCE"
source: THESIS INTELLIGENCE.txt
converted: 2026-09-12
type: architecture-spec
related: [thesis-monitor-reassessment.md, research-flows.md, framework.md]
---

**Related documents:** `thesis-monitor-reassessment.md` · `research-flows.md` · `framework.md`

> Converted from `THESIS INTELLIGENCE.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

THESIS INTELLIGENCE

PURPOSE

Thesis Intelligence is the layer responsible for representing, evaluating, maintaining, challenging, and evolving the trader's persistent thesis.

A thesis is a trader-level belief or proposition that exists beyond a single research investigation.

Core relationship:

THESIS
→ CLAIMS
→ ASSUMPTIONS
→ DEPENDENCIES
→ EXPECTED OUTCOMES
→ RESEARCH
→ EVIDENCE
→ JUDGMENT
→ THESIS STATUS
→ THESIS EVOLUTION

The system evaluates the thesis.

The trader owns the thesis.

The system must never silently rewrite it.


1. THESIS OBJECT

```text
THESIS {
  id

  statement

  objective

  scope {
    entities
    timeframe
    market_context
    conditions
  }

  claims[] {
    id
    statement
    importance
    status
    evidence_refs[]
  }

  assumptions[] {
    id
    statement
    importance
    evidence_refs[]
    invalidation_conditions[]
    status
  }

  dependencies[] {
    object_ref
    relationship
    importance
    status
  }

  expected_outcomes[] {
    outcome
    timeframe
    conditions
    evidence_required
    status
  }

  supporting_research_refs[]

  contradicting_research_refs[]

  supporting_evidence_refs[]

  contradicting_evidence_refs[]

  invalidation_conditions[]

  alternatives[]

  confidence

  status

  current_assessment

  created_at
  updated_at

  provenance

  version

  history
}
```

2. THESIS DEFINITION

A thesis is a structured representation of what the trader currently believes about a relevant subject.

It may concern:

* an asset
* market direction
* macro condition
* protocol
* sector
* narrative
* catalyst
* strategy assumption
* expected event
* causal explanation
* market relationship

A thesis can be simple or complex.

Simple:

“BTC remains structurally bullish over the next six months.”

Complex:

“BTC remains structurally bullish because institutional demand is increasing, liquidity conditions are improving, and supply-side pressure is declining, provided those conditions persist.”

The system should preserve the trader's actual meaning rather than forcing every thesis into a rigid template.

3. THESIS CREATION

A thesis may be created through natural language.

Examples:

“I think ETH will outperform BTC over the next three months.”

“My thesis is that this rally is driven mainly by institutional flows.”

“Save this as my current BTC thesis.”

The system should extract where possible:

* core proposition
* target
* timeframe
* supporting claims
* assumptions
* expected outcomes
* dependencies
* invalidation conditions

If important information is missing, the thesis may still be created with explicit gaps.

The system should not invent missing assumptions.

4. THESIS RESOLUTION

When the trader refers to:

“my thesis”

the system should resolve the relevant thesis using:

1. Explicitly referenced thesis
2. Active thesis for the current research
3. Current workspace context
4. Relevant historical thesis
5. Clarification if multiple materially different theses exist

The system should never silently select an unrelated thesis.

5. THESIS STRUCTURE

A useful thesis can contain:

CONCLUSION

What the trader believes.

CLAIMS

Why the trader believes it.

ASSUMPTIONS

What must be true for the thesis to hold.

DEPENDENCIES

External conditions the thesis relies upon.

EXPECTED OUTCOMES

What should be observable if the thesis is correct.

INVALIDATION CONDITIONS

What would materially weaken or disprove it.

TIMEFRAME

When the thesis applies.

SCOPE

Where it applies and where it does not.

6. CLAIMS

A thesis may contain multiple claims.

Each claim should be independently evaluable where possible.

Example:

THESIS:
“ETH will outperform BTC.”

Claims:

1. ETH network activity is accelerating.
2. ETH demand is increasing.
3. ETH valuation has greater upside.
4. Market conditions favor ETH.

The system should determine which claims are:

SUPPORTED
PARTIALLY_SUPPORTED
UNRESOLVED
WEAKENED
CONTRADICTED

A thesis does not automatically fail because one minor claim fails.

7. CLAIM IMPORTANCE

Claims may have different importance.

CORE CLAIM

Failure materially threatens the thesis.

SUPPORTING CLAIM

Strengthens the thesis but is not essential.

CONTEXTUAL CLAIM

Provides context without being central.

The system should prioritize research against core claims.

8. ASSUMPTIONS

Assumptions are conditions the thesis relies upon.

Examples:

* liquidity remains supportive
* institutional demand continues
* regulatory conditions remain stable
* a particular causal mechanism remains active

The system should identify important assumptions but must not invent them.

When an assumption is inferred from the trader's statement, the system should distinguish inferred structure from explicitly stated belief.

9. ASSUMPTION TESTING

Each material assumption should be testable where possible.

For each assumption:

ASSUMPTION
→ SUPPORTING EVIDENCE
→ CONTRADICTING EVIDENCE
→ CURRENT STATUS
→ INVALIDATION CONDITION

An assumption that cannot reasonably be tested remains an uncertainty rather than being treated as true.

10. DEPENDENCIES

A thesis may depend on:

* macro conditions
* market structure
* liquidity
* technical conditions
* external events
* regulatory developments
* protocol activity
* investor behavior
* other thesis components

Dependencies should be represented explicitly when material.

If a dependency changes, Thesis Intelligence determines whether the thesis status should change.

11. EXPECTED OUTCOMES

A thesis may imply observable outcomes.

Example:

THESIS:
“Institutional accumulation is driving the rally.”

Expected outcomes may include:

* increasing institutional flows
* persistent demand
* relevant market behavior
* supporting derivatives activity

Expected outcomes help distinguish:

WHAT SHOULD BE OBSERVED

from:

WHAT HAS ACTUALLY BEEN OBSERVED.

12. INVALIDATION CONDITIONS

A thesis should contain meaningful conditions under which it would become weakened or invalid.

Examples:

* central assumption fails
* expected outcome repeatedly fails
* stronger alternative explanation emerges
* critical evidence is disproven
* causal mechanism breaks
* relevant timeframe expires

Invalidation conditions must be evidence-derived.

The system must not invent arbitrary thresholds merely to create an apparently precise thesis.

13. THESIS STATUS

Core thesis states:

DRAFT
ACTIVE
CONFIRMED
WEAKENED
REJECTED
SUPERSEDED
ARCHIVED

Status is distinct from confidence.

A thesis may be:

ACTIVE + HIGH CONFIDENCE

or:

ACTIVE + LOW CONFIDENCE

Status describes the thesis condition.

Confidence describes how strongly current evidence supports it.

14. STATUS DEFINITIONS

DRAFT

Thesis exists but has not been established as active.

ACTIVE

Trader currently maintains the thesis.

CONFIRMED

Current evidence strongly supports the thesis within its defined scope and conditions.

WEAKENED

Important evidence or assumptions have weakened the thesis, but it is not fully rejected.

REJECTED

Current evidence materially contradicts the thesis or a critical condition has failed.

SUPERSEDED

Trader has replaced the thesis with a newer thesis.

ARCHIVED

Historical thesis retained for reference but no longer active.

15. STATUS TRANSITIONS

General lifecycle:

DRAFT
→ ACTIVE
→ CONFIRMED
→ WEAKENED
→ REJECTED
→ SUPERSEDED
→ ARCHIVED

The path is not strictly linear.

For example:

ACTIVE
→ WEAKENED
→ ACTIVE

if new evidence restores support.

Likewise:

WEAKENED
→ CONFIRMED

if strong new evidence resolves the weakness.

Historical states remain preserved.

16. THESIS CONFIDENCE

Confidence should use:

HIGH
MODERATE
LOW

Confidence depends on:

* strength of supporting evidence
* strength of contradictory evidence
* core claim status
* assumption stability
* hypothesis strength
* alternative explanations
* evidence freshness
* scope stability
* causal strength
* unresolved uncertainty

Confidence must not simply mirror the number of supporting claims.

17. THESIS STATUS VS CONFIDENCE

These must remain separate.

Example:

ACTIVE + HIGH CONFIDENCE

The trader still holds the thesis and evidence strongly supports it.

ACTIVE + MODERATE CONFIDENCE

The trader still holds the thesis but evidence is mixed.

WEAKENED + MODERATE CONFIDENCE

Important weaknesses exist but the thesis remains viable.

REJECTED + LOW CONFIDENCE

The thesis is no longer supported.

18. RESEARCH EVALUATION

Research may evaluate a thesis through:

RESEARCH
→ CLAIM TESTING
→ EVIDENCE
→ HYPOTHESES
→ ANALYSIS
→ JUDGMENT
→ THESIS ASSESSMENT

The research judgment should determine:

* which claims are supported
* which assumptions hold
* which assumptions weakened
* which alternatives exist
* whether invalidation conditions are approaching
* whether the thesis remains defensible

19. THESIS ASSESSMENT

A thesis assessment should contain:

THESIS STATUS

Current state.

SUPPORTING FACTORS

What currently supports it.

WEAKNESSES

What currently weakens it.

CORE ASSUMPTIONS

Which assumptions remain valid.

ALTERNATIVES

Competing explanations.

CONFIDENCE

Current support level.

INVALIDATION CONDITIONS

What could materially change the assessment.

CURRENT JUDGMENT

The strongest evidence-based assessment.

20. PARTIAL SUPPORT

A thesis may be partially supported.

The system should not force:

TRUE

or:

FALSE.

Example:

Core thesis:
“BTC remains bullish because institutional demand is increasing.”

Assessment:

BTC bullish thesis:
SUPPORTED

Institutional demand claim:
SUPPORTED

Liquidity assumption:
WEAKENED

Therefore:

Overall thesis:
PARTIALLY SUPPORTED / WEAKENED

The trader decides whether the thesis remains useful.

21. CORE CLAIM FAILURE

If a core claim fails, the system should determine whether:

* the thesis still works without it
* another mechanism supports the thesis
* the thesis needs modification
* the thesis should be rejected

The system must not automatically reject the entire thesis merely because one claim fails.

22. ALTERNATIVE EXPLANATIONS

A strong alternative explanation may weaken a thesis even when the expected outcome occurs.

Example:

Thesis:
“Price rose because institutional accumulation increased.”

Alternative:
“Price rose primarily because short positions were liquidated.”

If the observed outcome is compatible with both:

→ thesis is not necessarily confirmed.

The system should identify the evidence needed to distinguish them.

23. OUTCOME VS THESIS VALIDITY

Observed success does not automatically validate the thesis.

Observed failure does not automatically invalidate it.

The system must evaluate:

* expected outcome
* timeframe
* conditions
* causal mechanism
* alternative explanations

A thesis may produce the expected outcome for the wrong reason.

24. THESIS CHALLENGE

CHALLENGE can test a thesis more aggressively.

When triggered:

THESIS
→ DECOMPOSE
→ ATTACK CLAIMS
→ ATTACK ASSUMPTIONS
→ SEARCH ALTERNATIVES
→ IDENTIFY INVALIDATION
→ REASSESS

Thesis Intelligence receives the resulting assessment.

CHALLENGE does not automatically modify the thesis.

25. THESIS EVOLUTION

Theses evolve through evidence and trader decisions.

Possible evolution:

ORIGINAL THESIS
→ NEW EVIDENCE
→ WEAKENING
→ RESEARCH
→ NEW UNDERSTANDING
→ TRADER MODIFICATION
→ NEW THESIS VERSION

Every material evolution should preserve lineage.

26. AUTOMATIC VS TRADER-INITIATED CHANGE

The system may automatically:

* evaluate thesis status
* update evidence associations
* update confidence
* identify weaknesses
* identify invalidation conditions
* recommend changes
* flag contradictions

The system must not automatically:

* rewrite thesis statement
* replace the thesis
* delete the thesis
* change important assumptions
* alter trader-defined conditions

Consequential thesis changes require trader control.

27. NATURAL-LANGUAGE THESIS MODIFICATION

The trader may modify a thesis naturally.

Examples:

“Remove the liquidity assumption.”

“Change the timeframe to six months.”

“I no longer believe the institutional-flow part.”

“Make this my primary thesis.”

“Replace my old thesis with this one.”

The system maps the request to structured thesis changes.

Material changes should create a new thesis version while preserving the previous version.

28. THESIS VERSIONING

Material thesis changes create a new version.

Version history should preserve:

* previous statement
* new statement
* changed claims
* changed assumptions
* changed dependencies
* changed expected outcomes
* changed invalidation conditions
* reason for change
* timestamp
* actor

Minor metadata changes need not create a new material version.

29. THESIS COMPARISON

The trader may ask:

“What changed in my thesis?”

The system should compare versions across:

* conclusion
* claims
* assumptions
* dependencies
* timeframe
* expected outcomes
* invalidation conditions
* confidence
* status

The comparison must distinguish:

TRADER CHANGES

from:

SYSTEM ASSESSMENT CHANGES.

30. THESIS HISTORY

Historical theses should remain available.

History may show:

* original thesis
* evidence that supported it
* evidence that weakened it
* major revisions
* rejected alternatives
* final status
* replacement thesis

Historical theses are valuable for learning and decision review.

They must not silently influence current conclusions.

31. MULTIPLE THESES

A trader may have multiple active theses.

They may concern:

* different assets
* different timeframes
* different strategies
* different hypotheses
* different market conditions

The system should keep them distinct unless an explicit relationship exists.

A thesis may be related to another thesis without being dependent on it.

32. THESIS RELATIONSHIPS

Possible relationships:

* supports
* contradicts
* depends_on
* derived_from
* related_to
* supersedes
* replaces
* tests
* challenges
* informs

Example:

Macro thesis
→ supports
BTC thesis

But the relationship does not automatically mean the BTC thesis changes whenever the macro thesis changes.

Material dependency must be established.

33. CROSS-RESEARCH THESIS SUPPORT

Multiple research investigations may contribute to one thesis.

Example:

Macro research
```text
+
Technical research
+
On-chain research
+
Historical research
→
```
ONE THESIS ASSESSMENT

The system should consolidate relevant findings without duplicating evidence.

34. CONFLICTING RESEARCH

If research investigations disagree:

1. identify disagreement
2. compare scope
3. compare timeframe
4. compare evidence
5. compare assumptions
6. determine whether conclusions are conditionally compatible
7. resolve if possible
8. preserve unresolved conflict
9. adjust thesis confidence/status when material

Conflicting research must not be hidden.

35. THESIS SCOPE

Every thesis should have an applicable scope.

Scope may include:

* asset/entity
* market
* timeframe
* conditions
* geographic context
* strategy context

The system must not generalize a thesis outside its scope without explicit expansion.

36. THESIS EXPIRATION

A thesis may become irrelevant when:

* its timeframe expires
* the underlying event passes
* market regime changes materially
* assumptions become obsolete
* the trader replaces it

Expiration should normally result in:

ARCHIVED

rather than:

REJECTED.

Expiration does not mean the thesis was wrong.

37. STALE THESIS

A thesis may become stale when the evidence supporting it is no longer fresh enough.

A stale thesis remains historical.

The system should:

→ mark stale
→ preserve history
→ recommend revalidation when relevant
→ avoid treating stale evidence as current support

38. THESIS INVALIDATION

A thesis becomes invalid when a critical foundation is no longer defensible.

Examples:

* central assumption fails
* critical evidence is disproven
* core causal mechanism fails
* scope is fundamentally incorrect

Invalidation should:

→ preserve original thesis
→ mark affected components
→ update status
→ trigger reassessment
→ recommend replacement only when justified

39. THESIS RESTORATION

Historical theses may be restored.

Restoration should:

1. recover the selected thesis version
2. revalidate assumptions
3. check current evidence
4. check timeframe
5. check scope
6. reassess confidence
7. activate only after the appropriate confirmation boundary

Restoring a historical thesis must not automatically make its old evidence current.

40. THESIS MEMORY

Thesis memory should preserve:

* versions
* evidence history
* confidence history
* status transitions
* invalidation conditions
* major changes
* supporting research
* contradicting research
* trader modifications

Current thesis state takes precedence over historical versions.

41. THESIS AND MONITOR

A thesis may generate monitoring conditions.

Example:

Thesis:
“BTC remains bullish while institutional demand continues.”

Potential monitor:

Monitor institutional-demand indicators.

The monitor should remain linked to:

* thesis
* relevant claims
* assumptions
* invalidation conditions
* research
* judgment

If the thesis materially changes, the monitor should reassess its relevance.

42. THESIS AND CHALLENGE

A thesis may be challenged when:

* confidence is unusually high
* important evidence contradicts it
* assumptions are fragile
* alternative explanations are strong
* consequences of being wrong are material
* the trader explicitly asks for challenge

CHALLENGE produces an assessment.

Thesis Intelligence decides how that assessment affects thesis status.

43. THESIS AND FRAMEWORK

A framework may be used to evaluate a thesis.

For example:

FRAMEWORK:
Evaluate demand, liquidity, macro, valuation, sentiment.

THESIS:
“BTC remains bullish.”

Framework Intelligence evaluates the thesis against those factors.

Thesis Intelligence receives the result but does not modify the framework.

44. THESIS AND JUDGMENT

Judgment:

“What does the current evidence support?”

Thesis:

“What does the trader believe?”

Relationship:

CURRENT EVIDENCE
→ JUDGMENT
→ THESIS ASSESSMENT

The judgment can disagree with the thesis.

That disagreement is important information, not an error.

45. THESIS CONFIRMATION

The system should avoid using “confirmed” casually.

A thesis may be considered CONFIRMED when:

* core claims are strongly supported
* important assumptions remain valid
* meaningful alternatives are weaker
* contradictions are limited or explainable
* evidence is sufficiently current
* the conclusion remains coherent within scope

Confirmation is contextual, not permanent.

46. THESIS WEAKENING

A thesis becomes WEAKENED when:

* important claims lose support
* assumptions become questionable
* contradictory evidence becomes material
* alternatives become stronger
* confidence materially decreases

The system should explain exactly what weakened it.

47. THESIS REJECTION

A thesis becomes REJECTED when:

* core claims are materially contradicted
* critical assumptions fail
* the central mechanism is disproven
* evidence strongly favors a contradictory interpretation
* invalidation conditions are met

The original thesis remains preserved as historical context.

48. THESIS REPLACEMENT

A replacement thesis should normally be trader-controlled.

The system may propose:

“Your current thesis is materially weakened. A defensible alternative appears to be…”

The trader can then:

* keep current thesis
* modify it
* replace it
* create a new thesis
* reject the proposed alternative

49. THESIS RESEARCH PRIORITY

Thesis Intelligence may inform Research Planning by identifying:

* weakest core claim
* most uncertain assumption
* highest-value discriminating evidence
* strongest alternative
* closest invalidation condition

Research should prioritize information capable of materially changing the thesis assessment.

50. THESIS COMPLETION

A thesis does not necessarily have a “completed” state merely because research finishes.

Research completion means:

“The current research question has been sufficiently investigated.”

Thesis lifecycle is longer:

THESIS
→ CONTINUOUSLY EVALUATED
→ EVOLVES WITH EVIDENCE
→ EVENTUALLY SUPERSEDED / ARCHIVED

A thesis can therefore survive multiple research cycles.

51. THESIS QUALITY

A strong thesis should be:

* clearly stated
* appropriately scoped
* evidence-testable
* explicit about important assumptions
* linked to observable outcomes
* explicit about invalidation
* resistant to confirmation bias
* traceable to supporting research
* revisable
* historically preserved

52. INTEGRITY RULES

The system must never:

* silently rewrite a thesis
* silently replace a thesis
* delete thesis history
* treat expected outcomes as evidence
* treat successful outcomes as automatic proof
* ignore alternative explanations
* confuse confidence with truth
* treat stale evidence as current
* fabricate assumptions
* fabricate invalidation thresholds
* collapse multiple distinct theses into one
* force a binary supported/rejected state when evidence is genuinely mixed
* use research disagreement as a reason to hide uncertainty

53. THESIS LOOP

The complete loop is:

CREATE / RETRIEVE THESIS
→ STRUCTURE CLAIMS
→ IDENTIFY ASSUMPTIONS
→ IDENTIFY DEPENDENCIES
→ DEFINE EXPECTED OUTCOMES
→ DEFINE INVALIDATION CONDITIONS
→ CONNECT RESEARCH
→ COLLECT EVIDENCE
→ EVALUATE CLAIMS
→ TEST ASSUMPTIONS
→ TEST ALTERNATIVES
→ RECEIVE JUDGMENT
→ ASSESS THESIS
→ UPDATE STATUS
→ UPDATE CONFIDENCE
→ IDENTIFY WHAT CHANGED
→ PRESERVE HISTORY
→ RECOMMEND CHALLENGE / MONITOR / RESEARCH WHEN WARRANTED
→ WAIT FOR NEW EVIDENCE OR TRADER DECISION
→ REASSESS

54. GLOBAL PRINCIPLE

Thesis Intelligence exists to maintain the boundary between:

WHAT THE TRADER BELIEVES

and:

WHAT THE CURRENT EVIDENCE SUPPORTS.

The system's job is not to make the trader's thesis correct.

Its job is to continuously show:

WHY THE THESIS IS SUPPORTED

WHY IT IS WEAKENED

WHAT ASSUMPTIONS IT DEPENDS ON

WHAT COULD PROVE IT WRONG

WHAT ALTERNATIVES EXIST

HOW CONFIDENT THE SYSTEM IS

WHAT HAS CHANGED SINCE THE THESIS WAS CREATED

The trader owns the thesis.

The system owns the evidence-based assessment.

The trader decides whether the thesis changes.

```
```
