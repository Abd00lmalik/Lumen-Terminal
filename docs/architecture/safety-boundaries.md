---
title: "SAFETY & DECISION BOUNDARY INTELLIGENCE"
source: SAFETY & DECISION BOUNDARY INTELLIG.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-monitor-action.md, lui-save-action.md, framework.md, memory.md]
---

**Related documents:** `lui-monitor-action.md` · `lui-save-action.md` · `framework.md` · `memory.md`

> Converted from `SAFETY & DECISION BOUNDARY INTELLIG.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

SAFETY & DECISION BOUNDARY INTELLIGENCE

## 1. Purpose

Safety & Decision Boundary Intelligence defines the boundary between:

- research
- analysis
- recommendation
- trader decision
- persistent state changes
- monitoring
- execution assistance
- actual trade execution

The workbench is fundamentally a research system.

Its job is to help the trader understand information, test beliefs, identify uncertainty, surface risks, and make better-informed decisions.

The system must not silently transform an analytical conclusion into a trading instruction or execution.

Global principle:

RESEARCH CAN INFORM A DECISION.
RESEARCH DOES NOT BECOME THE DECISION.
```

# 2. Decision Boundary

```text id="h2c7ma"
INFORMATION
```text
    ↓
EVIDENCE
    ↓
ANALYSIS
    ↓
JUDGMENT
    ↓
IMPLICATIONS
    ↓
OPTIONAL DECISION SUPPORT
    ↓
TRADER DECISION
    ↓
```
OPTIONAL EXECUTION ASSISTANCE
```

The boundary between system judgment and trader decision must remain explicit.

# 3. Core System Roles

```text id="n8f4xp"
SYSTEM:
researches
analyzes
tests
challenges
summarizes
monitors
surfaces implications

TRADER:
decides
accepts/rejects thesis changes
approves consequential actions
controls persistent frameworks
controls monitoring activation
controls execution
```

# 4. Decision Object

The system may represent decision context without becoming the decision-maker.

```text id="r6z1bw"
DECISION_CONTEXT {
  id
  research_ref
  judgment_ref
  thesis_refs[]
  framework_refs[]
  options[]
  implications[]
  risks[]
  uncertainties[]
  conditions[]
  invalidation_conditions[]
  supporting_evidence[]
  opposing_evidence[]
  confidence
  trader_decision
  decision_status
  provenance
  history
}
```

# 5. Decision Status

```text id="m3q7vt"
INFORMATION_ONLY
ANALYSIS_READY
DECISION_RELEVANT
TRADER_REVIEW_REQUIRED
TRADER_DECIDED
EXECUTION_ASSISTANCE_REQUESTED
EXECUTION_COMPLETED
CANCELLED
SUPERSEDED
```

The system may reach `DECISION_RELEVANT`.

Only the trader can establish the actual decision.

# 6. Research vs Recommendation

The system should distinguish:

```text id="z8c1kp"
FACT
EVIDENCE
ANALYTICAL FINDING
CURRENT JUDGMENT
IMPLICATION
OPTION
RECOMMENDATION
TRADER DECISION
```

These are not interchangeable.

# 7. Judgment

A judgment states what the available evidence currently supports.

Example:

```text id="d5w7xa"
Current judgment:
Evidence moderately supports X as the strongest explanation.
```

This does not mean:

```text
"Therefore you should trade X."
```

# 8. Implications

The system may explain implications:

```text id="q9m3fv"
If X is correct:
- condition A becomes more important
- risk B increases
- evidence C should be monitored
```

Implications remain analytical.

# 9. Decision Support

When explicitly requested, the system may structure decision support around:

```text id="k8s2dr"
OPTIONS
EVIDENCE
UPSIDE CONDITIONS
DOWNSIDE CONDITIONS
RISKS
UNCERTAINTIES
INVALIDATION
ALTERNATIVES
WHAT WOULD CHANGE THE ASSESSMENT
```

The final choice remains external to the research engine.

# 10. No Silent Trading Instruction

The system must not silently convert:

```text id="v2r8cm"
"BTC is likely to recover."
```

into:

```text
"Buy BTC."
```

A research conclusion and an action recommendation are different outputs.

# 11. Explicit Recommendation Requests

If the trader explicitly asks for a recommendation, the system should first determine whether the request is:

```text id="j4n7yx"
ANALYTICAL COMPARISON
DECISION SUPPORT
PERSONALIZED FINANCIAL ADVICE
EXECUTION REQUEST
```

The workbench should remain primarily an analytical research system.

# 12. Decision Context Requirements

Before presenting decision-oriented analysis, relevant context should include:

```text id="p7v3cn"
objective
timeframe
scope
current judgment
uncertainty
key evidence
opposing evidence
thesis
relevant framework
material risks
invalidation conditions
```

Missing material context should reduce confidence rather than be silently assumed.

# 13. Risk Representation

Risks should be represented explicitly.

```text id="t6x4qb"
RISK {
  id
  description
  source
  affected_claims[]
  affected_hypotheses[]
  severity
  likelihood_assessment
  uncertainty
  conditions
  mitigation_context
  provenance
}
```

The system must not invent precise probabilities when the evidence does not support them.

# 14. Risk vs Uncertainty

These are different.

```text id="x7k5sa"
RISK:
A potentially harmful outcome.

UNCERTAINTY:
Lack of sufficient knowledge about what is true.
```

High uncertainty does not automatically mean high risk.

# 15. Invalidation Conditions

The system should surface conditions that would undermine:

* a hypothesis
* a thesis
* a judgment
* a framework evaluation
* a monitoring assumption

These conditions must be evidence-derived.

# 16. Decision-Relevant Uncertainty

The system should prioritize uncertainty that could materially change the decision context.

```text id="u5r8qh"
HIGH MATERIALITY
→ prominent

LOW MATERIALITY
→ progressive disclosure
```

# 17. Contradictory Evidence

Decision-oriented presentation must include material contradictory evidence.

The system must not optimize presentation for persuasion.

# 18. Confidence

Confidence describes confidence in the research judgment.

It does not describe:

```text id="s2w8vd"
profitability
trade success
future price
certainty
```

Use:

```text
High
Moderate
Low
```

where appropriate.

# 19. No Fabricated Probability

The system must not invent:

```text id="b8c4nk"
"87% chance of success"
```

unless the underlying methodology genuinely supports such a probability.

Qualitative confidence is preferred.

# 20. Scenario Analysis

The workbench may present scenarios.

```text id="e9h6ps"
SCENARIO A
condition
supporting evidence
implication

SCENARIO B
condition
supporting evidence
implication

SCENARIO C
condition
supporting evidence
implication
```

Scenarios must not be presented as guaranteed outcomes.

# 21. Scenario Conditions

Each scenario should identify what would make it more or less relevant.

This prevents scenario analysis from becoming unsupported prediction.

# 22. Alternative Actions

When decision support requires comparing options, the system may structure:

```text id="v4n6cy"
OPTION
RATIONALE
SUPPORT
OPPOSITION
RISKS
UNCERTAINTY
CONDITIONS
```

The system should not hide viable alternatives.

# 23. Trader Decision Boundary

The trader remains responsible for deciding:

* whether to act
* whether to change a thesis
* whether to accept a framework result
* whether to activate monitoring
* whether to execute
* whether to save consequential persistent changes

# 24. Consequential Actions

Consequential actions require explicit confirmation where appropriate.

Examples:

```text id="f5m8qt"
ACTIVATE MONITOR
REPLACE FRAMEWORK
PERSIST PREFERENCE
PERMANENT DELETE
EXECUTE TRADE
```

Ordinary research manipulation does not require unnecessary confirmation.

# 25. Confirmation Model

```text id="a7k3pd"
ACTION
→ CLASSIFY CONSEQUENCE
→ IF ROUTINE: EXECUTE
→ IF CONSEQUENTIAL: REQUEST CONFIRMATION
→ EXECUTE AFTER CONFIRMATION
→ RECORD RESULT
```

# 26. Confirmation Language

Confirmation should clearly state:

```text id="z2v6hm"
WHAT WILL HAPPEN
WHAT OBJECTS ARE AFFECTED
WHETHER IT IS REVERSIBLE
WHAT PERSISTENCE IS CREATED
```

No ambiguous confirmation requests.

# 27. Execution Boundary

Execution assistance is separate from research.

The architecture must maintain:

```text id="r4c8jy"
RESEARCH ENGINE
        ≠
EXECUTION ENGINE
```

The research engine can provide information required for execution assistance without directly becoming an execution engine.

# 28. Execution Assistance

If execution assistance is part of the product:

It should be treated as a separate capability with its own:

* permissions
* authentication
* validation
* confirmation
* audit
* failure handling
* cancellation
* limits

Research state should not automatically trigger execution.

# 29. No Automatic Execution

Research completion must never automatically cause:

```text id="q9t3xk"
order placement
position opening
position closing
fund transfer
leverage change
```

Execution requires a separate explicit action.

# 30. Execution Intent

A request such as:

```text id="c6v8rp"
"Research BTC."
```

must remain research.

A request explicitly asking for an execution-related action is a separate intent.

The system should not infer execution intent from analytical language.

# 31. Execution Confirmation

Where execution capability exists, the system should require explicit confirmation immediately before consequential execution.

The confirmation must reflect current:

* asset
* direction
* size
* relevant conditions
* execution venue
* material constraints

No stale confirmation should be reused.

# 32. Research-to-Execution Handoff

If execution assistance is explicitly requested:

```text id="w5j2sa"
CURRENT RESEARCH
→ CURRENT JUDGMENT
→ DECISION CONTEXT
→ USER-REQUESTED ACTION
→ VALIDATE CURRENT STATE
→ CONFIRM
→ EXECUTION LAYER
```

The research engine does not directly mutate execution state.

# 33. Stale Research

Before consequential action based on older research:

```text id="y7m4qn"
check freshness
check material changes
check judgment
check thesis
check relevant monitoring events
```

If the research is materially stale, the system should flag this before relying on it.

# 34. Historical Research

Historical research can inform decision context but cannot silently become current evidence.

```text id="k8d2vw"
HISTORICAL
≠
CURRENT
```

# 35. Saved Research

Saved research remains historical/reusable context unless revalidated.

Saving does not make old information current.

# 36. Thesis Decision Boundary

The system may say:

```text id="p3c6xm"
Your thesis is materially weakened.
```

It must not silently say:

```text
Your thesis has been replaced.
```

unless the trader explicitly changes it.

# 37. Framework Decision Boundary

The system may say:

```text id="x4h8vc"
Your framework evaluates the current evidence as unfavorable.
```

It must not modify the framework to make the result more favorable.

# 38. Monitor Decision Boundary

The system may recommend:

```text id="n6v2qm"
This condition appears important enough to monitor.
```

Activation remains subject to the existing confirmation rule.

# 39. Challenge Decision Boundary

CHALLENGE can determine:

```text id="b7q5ks"
Thesis materially weakened.
```

It may propose:

```text
Possible revised thesis:
...
```

It must not replace the trader's thesis automatically.

# 40. Decision Support and Personalization

Personalization may influence:

* preferred research depth
* preferred domains
* evidence standards
* presentation
* frameworks
* notification behavior

It must not silently determine what financial action the trader should take.

# 41. User Preference vs Safety Boundary

A persistent preference cannot override core integrity rules.

Example:

```text id="m3r7cy"
Preference:
"Never show opposing evidence."

System:
Material opposing evidence remains available.
```

Presentation may be customized, but material research limitations cannot be hidden.

# 42. Risk Escalation

When the research contains major unresolved uncertainty, the system should increase visibility.

Example:

```text id="e6q4bp"
LOW CONFIDENCE
+
MATERIAL CONFLICT
+
HIGH DECISION RELEVANCE
```

→ prominent warning.

# 43. Warning Design

Warnings should be specific.

Bad:

```text
"Be careful."
```

Better:

```text
"The current judgment depends heavily on one uncorroborated source."
```

# 44. No Fear-Based Presentation

Warnings should describe evidence and uncertainty, not manipulate the trader emotionally.

# 45. No False Certainty

The system must avoid:

```text id="h5w8rx"
"Definitely"
"Guaranteed"
"Cannot fail"
"Certain"
```

unless the statement is genuinely logically or factually certain.

# 46. No Performance Claims

The research system should not imply that better research guarantees:

* profit
* successful trades
* market prediction
* risk elimination

# 47. Decision Quality

The architecture optimizes for:

```text id="p2c8md"
INFORMED DECISION-MAKING
```

not:

```text
MAXIMUM TRADING ACTIVITY
```

# 48. Research Completion Does Not Mean Action

A completed research task means:

```text id="v7m3hs"
objective addressed
```

not:

```text
trade should happen
```

# 49. Decision Context Completion

Decision support is complete when:

```text id="s6x9ka"
current judgment available
supporting evidence available
opposing evidence available
uncertainty represented
material risks represented
conditions identified
alternatives considered where relevant
freshness established
```

# 50. Decision Support Quality Gate

Before decision-oriented output:

```text id="x3p7fd"
TARGET CORRECT?
CURRENT?
EVIDENCE SUFFICIENT?
OPPOSITION CONSIDERED?
UNCERTAINTY VISIBLE?
CONFIDENCE GROUNDED?
HISTORICAL INFO LABELED?
NO AUTOMATIC DECISION?
```

# 51. Safety State

```text id="q8w4mn"
SAFETY_STATE {
  research_integrity
  evidence_integrity
  freshness
  uncertainty
  confidence
  consequential_action
  confirmation_required
  execution_state
  limitations[]
  warnings[]
}
```

# 52. Decision Boundary Events

Material decision-boundary events should enter the timeline:

```text id="c5r8yb"
decision context created
judgment materially changed
thesis challenged
framework evaluated
monitor activated
monitor materially changed
execution assistance requested
confirmation requested
confirmation received
execution requested
execution completed/failed
```

# 53. Decision Auditability

The system should preserve:

```text id="n7q3xp"
what research supported the decision context
what judgment existed at the time
what uncertainty existed
what the trader explicitly requested
what confirmation occurred
what system action followed
```

This allows later reconstruction without exposing hidden chain-of-thought.

# 54. Decision Reversal

If the trader changes their decision:

The system preserves the previous decision as history.

It does not reinterpret the previous research to justify the new decision.

# 55. Decision vs Outcome

A good decision can produce a bad outcome.

A bad decision can produce a good outcome.

The architecture should not evaluate research quality solely from outcome.

# 56. Outcome Attribution

Where outcomes are later observed, the system may analyze:

```text id="d9w5jk"
WHAT WAS KNOWN THEN
WHAT WAS UNKNOWN
WHAT DECISION WAS MADE
WHAT HAPPENED
WHICH ASSUMPTIONS HELD
WHICH FAILED
```

This belongs to retrospective research, not automatic blame assignment.

# 57. Post-Decision Learning

Post-decision analysis may identify:

* incorrect assumptions
* missing evidence
* poor source selection
* weak framework factors
* overlooked alternatives
* research gaps

It should not automatically rewrite historical research.

# 58. Safety and Memory

Post-decision learning may become persistent knowledge only when it satisfies existing memory-promotion rules.

One outcome should not automatically become a permanent rule.

# 59. Safety and Framework Learning

If repeated evaluations expose a framework weakness, the system may recommend a framework modification.

The trader decides whether to modify it.

# 60. Safety and Monitor Learning

If repeated alerts prove noisy, the system may recommend changing monitoring conditions.

The change requires confirmation where already defined.

# 61. Safety and Agent Autonomy

The agent may autonomously:

* research
* select capabilities
* replan
* reprioritize
* cross-check
* challenge
* reassess
* update evidence
* update judgments
* surface risks
* recommend monitoring

The agent may not autonomously:

* silently change the trader's thesis
* silently modify a persistent framework
* silently activate consequential monitoring
* silently execute a trade
* silently perform destructive permanent actions
* conceal material uncertainty or failure

# 62. Safety and Natural Language

Natural language remains the universal control surface.

Safety does not require rigid commands.

Instead, the architecture classifies the requested action and applies the appropriate boundary.

# 63. Ambiguous Consequential Requests

If a request could cause a materially different consequential action depending on interpretation:

```text id="r8c5nv"
clarify
```

Do not choose the more aggressive interpretation.

# 64. Explicit Trader Override

The trader may override analytical preferences and research scope.

They cannot override factual integrity.

Example:

```text
"Ignore that source."
```

is valid as a research-scope preference.

But:

```text
"Treat this unverified claim as confirmed."
```

cannot convert unverified information into verified evidence.

# 65. Safety and Evidence Labels

The system should preserve evidence classification:

```text id="b4m8cz"
FACTUAL_OBSERVATION
QUANTITATIVE_OBSERVATION
INTERPRETATION
INFERENCE
SPECULATION
UNAVAILABLE
```

Safety-critical decision support should never collapse these categories.

# 66. Safety and Source Quality

A highly reputable source can still be wrong.

A low-reputation source can still contain useful information.

Source quality should be claim-specific and evidence-based.

# 67. Safety and Model Output

Model-generated interpretation is not automatically evidence.

Model output should remain classified appropriately.

```text id="y5n2kd"
MODEL OUTPUT
≠
OBSERVED FACT
```

# 68. Safety and Tool Output

Tool output requires validation before entering the evidence graph.

Malformed or unverified output must not become decision support.

# 69. Safety and Cross-Domain Synthesis

Cross-domain agreement does not automatically establish truth.

For example:

```text price data
+
social sentiment
+
technical indicator
```

may all derive from the same underlying market movement.

The system must avoid false independence.

# 70. Safety and Correlation

Correlated indicators should not be counted as independent confirmations.

This follows the Evidence Intelligence rules.

# 71. Safety and Causality

The system should not present correlation as causal proof.

Causal claims require:

```text temporal ordering
mechanism
alternative explanation analysis
confounder consideration
appropriate evidence
```

# 72. Safety and Historical Precedent

Historical similarity should not become:

```text "therefore it will happen again."
```

Historical evidence informs conditional judgment.

# 73. Safety and Prediction

Prediction is allowed as an analytical research object when appropriately framed.

It must include:

```text assumptions
conditions
uncertainty
alternatives
invalidation
```

It must not be presented as certainty.

# 74. Safety and Decision Presentation

The overview should visually distinguish:

```text id="k4q7hs"
CURRENT JUDGMENT
```

from:

```text
TRADER THESIS
```

and:

```text
TRADER DECISION
```

These must never appear as the same object.

# 75. Decision UI Hierarchy

Default:

```text id="m8r2cx"
QUESTION
```text
↓
CURRENT JUDGMENT
↓
WHY
↓
SUPPORT
↓
OPPOSITION
↓
UNCERTAINTY
↓
IMPLICATIONS
↓
```
TRADER DECISION
```

# 76. Execution UI Boundary

If execution assistance exists:

```text id="f6c3qa"
RESEARCH
```text
|
v
DECISION CONTEXT
|
v
EXPLICIT EXECUTION REQUEST
|
v
CONFIRMATION
|
```
v
EXECUTION SYSTEM
```

No automatic bridge.

# 77. Failure During Consequential Action

If execution or another consequential action fails:

The system must clearly distinguish:

```text id="y3q7kc"
REQUESTED
CONFIRMED
SUBMITTED
COMPLETED
FAILED
UNKNOWN
```

No action should be reported as completed unless completion is verified.

# 78. Unknown Execution State

If the system cannot determine whether an external action completed:

```text id="w6p2nr"
STATUS:
UNKNOWN
```

It must not retry blindly if doing so could duplicate a consequential action.

# 79. Safety Logging

Material consequential actions require audit records containing:

```text id="n4v8sd"
request
resolved action
confirmation
timestamp
affected objects
result
failure state if applicable
provenance
```

Sensitive credentials must never be stored in research logs.

# 80. Completion Criteria

Safety & Decision Boundary Intelligence is complete when:

* research and decision are distinct
* judgment and thesis remain distinct
* decision support can be structured
* material uncertainty is visible
* opposing evidence remains accessible
* no fabricated certainty is produced
* consequential actions require appropriate confirmation
* research does not automatically trigger execution
* stale research is revalidated
* historical research is clearly separated
* framework and thesis ownership remain with the trader
* monitoring activation follows confirmation rules
* failures during consequential actions are explicit
* execution status is never fabricated
* material actions are auditable
* the system never silently converts analysis into a trading decision

# 81. Global Safety Loop

```text id="s8x5hm"
RESEARCH
```text
    ↓
EVIDENCE
    ↓
ANALYSIS
    ↓
JUDGMENT
    ↓
UNCERTAINTY + RISKS
    ↓
IMPLICATIONS / OPTIONS
    ↓
TRADER REVIEW
    ↓
TRADER DECISION
    ↓
EXPLICIT CONSEQUENT ACTION
    ↓
CONFIRMATION WHEN REQUIRED
    ↓
ACTION
    ↓
AUDIT / RESULT
    ↓
NEW EVIDENCE
    ↓
```
REASSESSMENT
```

# Global Principle

**The workbench can think through the research with the trader, but it does not become the trader.

It can investigate.
It can analyze.
It can challenge.
It can identify risks.
It can explain implications.
It can monitor.

The trader remains the decision-maker, and consequential actions remain explicitly separated from research.**
