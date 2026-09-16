---
title: "ANALYZE; Universal Core Action"
source: ANALYZE; Universal Core Action.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-universal-core.md, analysis-synthesis.md]
---

**Related documents:** `lui-universal-core.md` · `analysis-synthesis.md`

> Converted from `ANALYZE; Universal Core Action.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

ANALYZE; Universal Core Action
1. Definition
ANALYZE = perform analytical work toward a trader-defined objective.
The analytical intent remains primary, but the agent may conduct additional research whenever the available evidence is insufficient for a reliable analysis.
The action supports explanation, comparison, interpretation, synthesis, and analytical requests that do not fit neatly into predefined modes.
The trader expresses intent naturally. Internal analytical modes and parameters are implementation structures, not commands exposed to the trader.
Core principle:

The action describes what the trader wants to understand, not which tools the agent must use.


2. Internal Schema
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


3. Objective
Preserve the trader's original natural-language objective while deriving a structured representation for planning.
objective.original
objective.structured_type
objective.success_criteria

The structured type is a planning aid, not a rigid command taxonomy.
The agent should infer the intended analytical outcome where reasonable and clarify only when ambiguity materially changes the analysis.

4. Analytical Modes
ANALYZE maintains structured analytical modes while allowing arbitrary natural-language analytical requests.
Common modes include:
compare
explain
interpret
synthesize

The system may infer or construct another analytical mode when the request does not fit these categories.
The trader never needs to know or explicitly select these modes.
Examples:
"Compare BTC with ETH."
→ compare

"Explain why BTC reacted this way."
→ explain

"What does this mean for my thesis?"
→ interpret

"Pull everything together and tell me what it means."
→ synthesize


5. Target Resolution
Target resolution is hybrid.
Priority:
1. Explicit target
2. Active research context
3. Conversation context
4. Relevant research memory
5. Clarification when material ambiguity remains

Explicitly named targets take priority.
Contextual references such as:

"this"
"these findings"
"the current setup"
"my thesis"

may be resolved from the active research context.
The agent must not present an uncertain target as certain.

6. Scope
ANALYZE begins with the evidence already available.
If that evidence is insufficient for a meaningful or reliable analysis, the agent automatically conducts additional research.
Available evidence
        ↓
Sufficient?
   ↙          ↘
 YES          NO
  ↓            ↓
Analyze    Research missing evidence
       ↘      ↙
        Analysis

The trader does not need to explicitly switch from ANALYZE to RESEARCH.
Additional research remains subordinate to the analytical objective.
The agent must distinguish between:

conclusions supported by available evidence
conclusions requiring newly researched evidence
important information that remains unavailable

Missing information must never be silently replaced with assumptions.

7. Depth
ANALYZE uses the same adaptive depth model as RESEARCH.
depth {
  requested
  resolved_level
  minimum
  maximum
  adaptive
}

Internal levels may include:
quick
standard
deep
exhaustive

Natural language determines the requested depth.
Examples:

"Give me a quick comparison."

→ constrained analytical depth.

"Do an exhaustive comparison."

→ high analytical depth.

"Compare them, and go deeper wherever something looks unusual."

→ adaptive depth.
Adaptive depth may increase where evidence, complexity, uncertainty, or analytical importance warrants it.
Explicit hard limits must not be silently overridden.

8. Context
Context can be inferred from:

active research
current workspace
conversation
relevant research memory
existing thesis
relevant trader context

Explicit context overrides inferred context.
Historical research and memory must remain distinguishable from current evidence.

9. Analytical Orientation
ANALYZE is neutral by default.
When a thesis, position, belief, or expected outcome is explicitly or contextually relevant, the analysis becomes thesis-aware.
Example:
"Analyze BTC ETF inflows."
→ neutral analysis

"Analyze whether BTC ETF inflows support my thesis."
→ thesis-aware analysis

Thesis awareness does not mean confirmation bias.
The agent must still search for contradictory evidence and present evidence that weakens the thesis.

10. Research Execution
Execution follows:
Interpret objective
```text
        ↓
Resolve targets and context
        ↓
Determine analytical mode
        ↓
Assess available evidence
        ↓
Identify missing evidence
        ↓
Research where necessary
        ↓
Analyze
        ↓
Synthesize
        ↓
```
Produce judgment

The agent owns the research burden.
The trader owns the final decision.

11. Evidence Handling
Analytical conclusions use the common Evidence Management layer.
Evidence is evaluated according to:

source quality
provenance
directness
recency
specificity
corroboration
conflicts of interest
observation vs interpretation vs speculation

Evidence remains connected through:
Source
```text
  ↓
Claim
  ↓
Evidence
  ↓
Hypothesis
  ↓
```
Analytical judgment


12. Conflicting Evidence
The agent should not simply return conflicting information to the trader without attempting to resolve it.
When evidence conflicts:
Identify conflict
```text
      ↓
Evaluate competing evidence
      ↓
Weight evidence quality
      ↓
Determine better-supported interpretation
      ↓
Produce primary judgment
      ↓
```
Preserve conflicting evidence

The agent should use evidence quality, directness, recency, corroboration, specificity, provenance, and other relevant evidence characteristics to determine which interpretation is better supported.
The weaker or contradictory evidence remains inspectable.

13. Analytical Result
Every analysis has a universal underlying result structure:
ANALYTICAL RESULT

Primary judgment
Supporting evidence
Opposing evidence
Key relationships / findings
Uncertainty
Confidence

Presentation adapts to the analytical mode.
Compare
Target A ↔ Target B
Similarities
Differences
Material distinctions
Why the differences matter

Explain
What is being explained
Relevant factors
Evidence
Alternative explanations
Best-supported explanation

Interpret
Observation
Meaning
Implications
Dependencies / conditions
Relevance to thesis or decision

Synthesize
Information gathered
Cross-domain relationships
Areas of agreement
Areas of conflict
Primary conclusion
Remaining uncertainty

Other analytical requests may generate an appropriate presentation while retaining the universal analytical core.

14. Hypothesis Creation
ANALYZE may discover relationships or explanations that were not part of the original request.
However, it should formally create a new hypothesis only when that discovery materially affects the requested analysis.
Minor observations remain evidence or context.
When a material new hypothesis emerges:
Discovery
   ↓
Material to analysis?
```text
   ↓
   YES
   ↓
Create hypothesis
   ↓
Test against available evidence
   ↓
```
Update analysis

This connects ANALYZE to the common Hypothesis Management layer.

15. Evidence-Driven Revision
If newly discovered evidence materially changes the analytical conclusion, ANALYZE automatically revises its judgment.
The previous judgment is preserved in research history.
The system should clearly expose:
Previous judgment
```text
        ↓
New evidence
        ↓
What changed
        ↓
Why it changed
        ↓
```
Updated judgment

The trader should be able to trace the evolution rather than seeing a silent replacement.

16. Confidence and Uncertainty
The final analysis includes:

overall confidence
strongest evidence
weakest evidence
meaningful uncertainty
unresolved information gaps
contested findings
factors that could change the conclusion

Confidence is dynamic and explainable.
Prefer qualitative levels:
High
Moderate
Low

unless quantitative confidence is genuinely justified.

17. Progressive Disclosure
The default analytical result should be concise enough for decision-making.
The trader can progressively inspect:
Primary judgment
```text
      ↓
Key evidence
      ↓
Supporting / opposing evidence
      ↓
Relationships and findings
      ↓
Hypotheses
      ↓
Research sources and tools
      ↓
Reasoning
      ↓
Confidence and uncertainty
      ↓
```
Previous judgments / change history

The interface should not force the trader to inspect the entire research trail before seeing the conclusion.

18. Natural-Language Control
The trader can modify an active analysis naturally.
Examples:
"Compare only the last three months."

"Actually, focus on derivatives."

"Explain why that difference matters."

"Go deeper on the strongest contradiction."

"Now compare that with the 2021 setup."

"Ignore sentiment for this analysis."

These requests modify the analytical state through the universal MANAGE_STATE or initiate another appropriate primary action when the intent changes.
The trader never needs to learn an internal command language.

19. Relationship to Other Universal Actions
ANALYZE is one of six universal primary LUI actions (locked 2026-09-12):
RESEARCH
ANALYZE
CHALLENGE
MANAGE_STATE
MONITOR
SAVE

The distinction is based on the trader's primary intent.
Examples:
"Find out what happened."
→ RESEARCH

"Compare BTC's move with previous similar cases."
→ ANALYZE

"Try to prove my thesis wrong."
→ CHALLENGE

"Actually, ignore sentiment and focus on derivatives."
→ MANAGE_STATE

"Keep watching funding rates."
→ MONITOR

ANALYZE may internally perform research, but the primary intent remains analytical.

20. Universal Core + Flow Extensions
ANALYZE provides the universal analytical behavior.
Active research flows may add specialized analytical extensions.
Conceptually:
Natural language
```text
       ↓
Intent interpretation
       ↓
ANALYZE
       ↓
Active research flow
       ↓
Flow-specific extension
       ↓
Parameters / targets / constraints
       ↓
```
Research state

Examples:
ANALYZE
+ HAS_THIS_HAPPENED_BEFORE
+ historical_similarity

ANALYZE
+ WHAT_DOES_ALL_INFORMATION_SAY
+ cross_domain_synthesis

ANALYZE
+ EVALUATE_ACCORDING_TO_MY_FRAMEWORK
+ framework_evaluation

The universal action remains stable while flow-specific behavior provides specialization.

21. Core Principle
ANALYZE should behave less like a static “analysis button” and more like an analytical capability embedded inside the research workbench.
The trader provides the analytical intent in natural language.
The agent:

understands the objective
resolves the target
determines the appropriate analytical approach
gathers missing evidence when necessary
weighs conflicting evidence
creates material hypotheses when warranted
adapts analytical depth
revises conclusions when evidence changes
preserves the reasoning trail
presents a clear primary judgment

The trader remains the final decision-maker.

Natural language defines what the trader wants to understand. The agent determines how much research and analysis is necessary to answer it well.

