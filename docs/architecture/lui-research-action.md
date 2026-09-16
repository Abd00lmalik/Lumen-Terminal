---
title: "LUI — RESEARCH Action Specification"
source: LUI — RESEARCH Action Specification.txt
converted: 2026-09-12
type: architecture-spec
---

> Converted from `LUI — RESEARCH Action Specification.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

LUI — RESEARCH Action Specification
1. Definition
RESEARCH is a universal first-class LUI action representing the trader's intent to perform research toward a defined objective.

RESEARCH = perform research toward a trader-defined objective, with target, scope, depth, constraints, and context determining how the research is conducted.

The trader does not need to explicitly provide every parameter. The system maintains a structured internal representation and infers missing information when possible.
RESEARCH can represent:

Starting a new investigation
Deepening an existing investigation
Broadening an investigation
Narrowing an investigation
Redirecting research
Investigating a newly discovered direction
Continuing research toward a modified objective

These variations are represented through parameters and internal state operations rather than separate first-class LUI actions.

2. Core Design Principle
The LUI represents what the trader wants, not every operation the agent performs.
For example:

"BTC is dumping. Find out what's going on."

Primary LUI action:
RESEARCH

Internal execution may involve:
intent interpretation
→ evidence gathering
→ hypothesis generation
→ analysis
→ cross-validation
→ contradiction search
→ synthesis
→ judgment

The internal operations do not become separate LUI actions.

3. Internal Schema
RESEARCH {
  objective {
    original
    structured_type
    success_criteria
  }

  target {
    requested
    resolved
    entities
    event
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

  constraints {
    requested
    resolved
    hard_constraints
    preferences
  }

  context {
    inferred
    explicit
    active_research_refs
    memory_refs
    override
  }
}

The complete schema exists internally even when the trader provides only part of it.

4. Objective
4.1 Hybrid Representation
The system preserves the trader's original natural-language objective while deriving a structured representation for planning and orchestration.
objective {
  original
  structured_type
  success_criteria
}

Example:

"BTC just dumped. Find out what actually caused it."

Internal representation:
objective {
  original: "BTC just dumped. Find out what actually caused it."

  structured_type: event_explanation

  success_criteria:
    - identify strongest-supported cause
    - distinguish causation from correlation
    - distinguish verified information from speculation
    - identify meaningful contradictions
    - provide confidence
}

The structured objective supports execution but must not restrict the trader to a predefined command vocabulary.

5. Objective Resolution
The agent should:

Interpret the trader's request.
Infer missing information where reasonable.
Begin research immediately when ambiguity is low-risk.
Ask for clarification only when ambiguity would materially change the research outcome.
State its interpretation briefly when useful.
Remain steerable while research is running.

Example:

"Research BTC."

A reasonable interpretation can be established and research can begin.
However:

"Research the BTC crash."

If multiple relevant BTC crashes exist in the active context, the agent should clarify which event is intended rather than silently choosing one.
Principle

Infer when reasonable. Clarify when materially ambiguous.


6. Target Resolution
Target resolution uses a hybrid approach.
The system first respects explicit references and uses context to resolve ambiguous references.
target {
  requested
  resolved
  entities
  event
  timeframe
  resolution_source
  confidence
}

Resolution Order
1. Explicit reference
Example:

"Research ETH."

→ Entity: ETH

"Research the March 5 crash."

→ Specific event/timeframe.
2. Active research context
Example:

"Research this further."

→ Current research target.

"Investigate the crash."

→ Currently discussed crash.
3. Conversation context
Resolve references such as:

"that move"
"the previous one"
"this thesis"
"that explanation"

4. Research memory
Use relevant prior research when appropriate.
Historical research or memory must not silently become current evidence.
5. Clarification
If multiple plausible targets remain and selecting the wrong one would materially affect the research, ask for clarification.
The system must not present an uncertain target as certain.

7. Scope
7.1 Hybrid Representation
Scope is represented internally through structured research boundaries while allowing arbitrary natural-language scope.
scope {
  requested
  resolved
  included_domains
  excluded_domains
  boundaries
}

Possible structured domains include:
macro
news
sentiment
technical
derivatives
on-chain
market_structure
regulation
ecosystem
liquidity
related_assets

This is not a restriction on the trader's language.
Example:

"Look at BTC, but focus on derivatives and macro. Ignore social sentiment."

Internal representation:
scope {
  requested:
    "focus on derivatives and macro; ignore social sentiment"

  included_domains:
    - derivatives
    - macro

  excluded_domains:
    - sentiment

  boundaries:
    - BTC
}

Custom research boundaries are also valid.
Example:

"Only investigate information that could explain the move within the first two hours."

This can be represented as a temporal/evidence boundary rather than forced into a predefined domain.

8. Depth
8.1 Hybrid Depth Control
The trader can express research depth naturally, while the system maintains structured internal depth levels.
depth {
  requested
  resolved_level
  minimum
  maximum
  adaptive
}

Internal levels:
quick
standard
deep
exhaustive

Examples:

"Give me a quick overview."

resolved_level: quick


"Go deep on derivatives."

resolved_level: deep

Adaptive Depth
The agent may dynamically allocate research depth based on evidence.
For example:
main investigation
```text
    ↓
promising hypothesis discovered
    ↓
increase depth on that branch
    ↓
weak branch identified
    ↓
```
reduce depth on weak branch

However, adaptive depth must respect the trader's requested bounds.
A request for a quick investigation should not silently become exhaustive research.
A deep investigation may receive additional depth where evidence warrants it.

9. Constraints
9.1 Hybrid Constraint Representation
Constraints can be expressed naturally and resolved into structured internal constraints.
constraints {
  requested
  resolved
  hard_constraints
  preferences
}

Example:

"Only use information from the last 24 hours and prioritize primary sources."

Internal representation:
hard_constraints:
  - type: time_window
    value: 24h

preferences:
  - type: source_preference
    value: primary_sources
    priority: high

Hard Constraints vs Preferences
Hard constraint
Must not be violated.
Examples:

Specific time window
Explicitly excluded source/domain
Explicit research boundary

Preference
Should be followed where practical but may be relaxed when necessary.
If a preference must be relaxed, the agent should make that clear.

10. Context
Context connects the current request to relevant research state.
context {
  inferred
  explicit
  active_research_refs
  memory_refs
  override
}

Context can come from:

Current research
Current conversation
Active hypotheses
Current thesis
Current judgment
Research memory
Trader preferences/frameworks

Explicit Context Overrides Inferred Context
Example:

"Using the current BTC research, investigate whether funding rates support the thesis."

The agent links the request to the active BTC investigation.
But:

"Ignore the previous BTC research. Treat this as a completely new investigation."

The explicit instruction overrides the existing context.

11. Research Execution
The agent uses adaptive execution depending on research complexity.
RESEARCH request
```text
      ↓
interpret request
      ↓
resolve target
      ↓
resolve scope
      ↓
resolve depth
      ↓
resolve constraints
      ↓
resolve context
      ↓
assess complexity
      ↓
research
      ↓
evidence + hypotheses
      ↓
synthesis
      ↓
```
judgment

Simple Research
For straightforward requests, the agent begins immediately.
Example:

"Check BTC funding rates."

No large planning interface is required.
Complex Research
For complex or multi-branch requests, the agent exposes a living research plan.
Example:

"BTC dropped 8% today. Find out why, compare it with similar historical events, determine whether the move could continue, and tell me what could invalidate that conclusion."

The plan becomes visible and interactive.

12. Living Research Plan
The research plan is a control surface rather than a progress indicator.
For complex investigations, it may contain:
Research Objective
```text
├── Research Branches
├── Objectives
├── Data / Tools
├── Priorities
├── Hypotheses
└── Dependencies
```

The plan can change when:

New evidence appears
A hypothesis weakens
A new hypothesis emerges
A branch becomes irrelevant
The trader changes direction
A dependency changes
The research objective materially changes

Completed research should be preserved when the plan changes.
The agent should not unnecessarily restart completed work.

13. Evidence-Driven Adaptation
Research is not required to follow the initial plan rigidly.
If material new evidence changes the direction of the investigation, the agent can automatically pivot.
Example:
Initial objective:

Explain why BTC dumped.

Initial hypothesis:

BTC-specific negative catalyst.

New evidence:

Multiple major assets moved simultaneously.

Agent response:
→ reduce priority of BTC-specific explanations
→ investigate market-wide liquidity conditions
→ preserve previous investigation
→ update research plan
→ explain why the research direction changed
→ continue investigation

Principle

Material new evidence can change research direction automatically, but the original research and reason for the pivot are preserved and visible.


14. Output Behavior
The default output model is progressive disclosure.
The trader should receive useful information without being forced to inspect every internal operation.
Default View
Show:

Current objective
Concise research progress
Major developments
Important emerging findings
Current judgment when meaningful

Expandable Research
The trader can inspect:

Research plan
Sources and tools
Evidence
Hypotheses
Contradictions
Reasoning
Previous judgments
Confidence
Full research trail

The experience follows:
Level 1:
What should I know?

Level 2:
Why?

Level 3:
Show me the evidence.

Level 4:
Show me the deeper reasoning.

Level 5:
Show me the full research trail.

Core UX Principle

Show what matters now. Make everything else inspectable.


15. Research State Changes
Changes to the active investigation are handled through the LUI architecture rather than requiring separate research actions.
Examples:

"Dig deeper into derivatives."

RESEARCH
depth = deeper
target = derivatives


"Broaden this beyond macro."

RESEARCH
scope = broadened


"Focus only on derivatives and macro."

RESEARCH
scope = derivatives + macro

The trader does not need to know the internal parameter structure.

16. Interaction With Other Universal Actions
RESEARCH is distinct from the other Universal Core actions.
RESEARCH

"Find out why BTC dumped."

Primary intent:
RESEARCH

ANALYZE

"Compare this dump with the March crash."

Primary intent:
ANALYZE

CHALLENGE

"Try to prove my BTC thesis wrong."

Primary intent:
CHALLENGE

MANAGE_STATE

"Ignore sentiment and focus on derivatives."

Primary intent:
MANAGE_STATE

MONITOR

"Keep watching funding rates for signs that my thesis is failing."

Primary intent:
MONITOR

A primary action may internally invoke other capabilities.
For example, RESEARCH can internally perform analysis without becoming an ANALYZE LUI request.

17. Flow-Specific Extensions
RESEARCH is universal, but its behavior can be specialized by the active research flow.
Conceptually:
RESEARCH
   ↓
ACTIVE RESEARCH FLOW
   ↓
FLOW-SPECIFIC EXTENSION

Examples:
Historical Precedent
RESEARCH
flow:
  HAS_THIS_HAPPENED_BEFORE

extension:
  historical_counterexamples

Impact Analysis
RESEARCH
flow:
  WHAT_COULD_AFFECT_IT

extension:
  conditional_impact_analysis

Comprehensive Synthesis
RESEARCH
flow:
  WHAT_DOES_ALL_THE_INFORMATION_SAY

extension:
  cross_domain_synthesis

Framework Evaluation
RESEARCH
flow:
  EVALUATE_ACCORDING_TO_MY_FRAMEWORK

extension:
  framework_evaluation

The universal action remains the primary trader intent.

18. Global Principles
Natural Language Is the Control Surface
The trader does not need to learn a rigid command syntax.
Agent Owns the Research Burden
The agent should perform the work rather than repeatedly transferring decisions back to the trader.
Infer, Don't Force
Missing parameters should be inferred whenever a reasonable interpretation exists.
Clarify Only When Necessary
Clarification is appropriate when ambiguity would materially change the research outcome.
Research Is Adaptive
Evidence can change hypotheses, priorities, research depth, tools, and direction.
Preserve Provenance
Changing direction does not erase previous research.
No Silent Context Changes
Current evidence, historical research, trader preferences, theses, and frameworks must remain distinguishable.
Progressive Disclosure
The trader receives the important conclusion first and can progressively inspect deeper levels of research.
Trader Remains the Decision-Maker
The agent researches, analyzes, and synthesizes. The trader makes the final decision.

19. Final RESEARCH Model
                    TRADER
```text
                       │
                       ▼
              NATURAL LANGUAGE
                       │
                       ▼
             INTENT INTERPRETATION
                       │
                       ▼
                    RESEARCH
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      OBJECTIVE      TARGET       SCOPE
          │            │            │
          └────────────┼────────────┘
                       │
                  DEPTH + CONSTRAINTS
                       │
                    CONTEXT
                       │
                       ▼
             COMPLEXITY ASSESSMENT
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        SIMPLE REQUEST       COMPLEX REQUEST
             │                   │
       START IMMEDIATELY    LIVING RESEARCH PLAN
             │                   │
             └─────────┬─────────┘
                       ▼
                TOOL / DATA
                ORCHESTRATION
                       │
                       ▼
              EVIDENCE + HYPOTHESES
                       │
                       ↕
              ADAPTIVE RESEARCH
                       │
                       ▼
                   SYNTHESIS
                       │
                       ▼
              DECISION-READY
                  JUDGMENT
                       │
                       ▼
```
             PROGRESSIVE DISCLOSURE

Locked Decisions

RESEARCH represents the general research intent.
Full internal parameter schema is maintained even when parameters are inferred.
Objective uses natural language + structured representation.
Target resolution is hybrid.
Scope is hybrid.
Depth is hybrid and adaptive within trader-defined bounds.
Constraints are hybrid with hard constraints and preferences.
Context is hybrid, with explicit context overriding inferred context.
Clarification occurs only when ambiguity materially affects the outcome.
Simple research starts immediately.
Complex research exposes a living research plan.
Research can automatically pivot when material evidence changes the direction.
Previous work and provenance are preserved during pivots.
Output uses progressive disclosure.
RESEARCH remains the primary LUI intent even when internal analysis or other operations are required.
Flow-specific extensions specialize RESEARCH without replacing the universal action.

