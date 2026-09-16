---
title: "CHALLENGE; Universal Core Action"
source: # CHALLENGE; Universal Core Action.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-universal-core.md, hypothesis.md, research-flows.md]
---

**Related documents:** `lui-universal-core.md` · `hypothesis.md` · `research-flows.md`

> Converted from `# CHALLENGE; Universal Core Action.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

# CHALLENGE; Universal Core Action

## 1. Definition

`CHALLENGE` = deliberately stress-test a trader-defined thesis, belief, claim, assumption, position, interpretation, expected outcome, or strategy-related idea.

The purpose is to determine whether the target can survive serious evidence-based attempts to weaken, falsify, or invalidate it.

The agent owns the burden of challenging the target.

The trader remains the final decision-maker.

Core principle:

> **CHALLENGE asks whether a belief can survive serious opposition, not merely whether supporting evidence exists.**

---

## 2. Internal Schema

```text id="c8n4wp"
CHALLENGE {
  objective {
    original
    structured_type
    success_criteria
  }

  target {
    requested
    resolved
    target_type
    entities
    thesis_refs
    position_refs
    context_refs
    resolution_source
    confidence
  }

  thesis_structure {
    conclusion
    claims
    assumptions
    dependencies
    causal_links
    expected_outcome
  }

  challenge_intensity {
    requested
    resolved
    adaptive
  }

  invalidation_conditions {
    identified
    conditions
    evidence_required
  }

  alternative_explanations {
    identified
    relevant
    tested
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
    explicit
    inferred
    active_research_refs
    memory_refs
    thesis_refs
    override
  }
}
```

---

## 3. Challenge Targets

`CHALLENGE` can operate on:

```text id="4prv8d"
thesis
belief
claim
expected_outcome
position
interpretation
assumption
strategy_claim
framework
```

The target can be explicitly stated or resolved from the active research context.

A framework can be challenged when the trader explicitly asks for that.

Ordinary thesis challenges may use a trader's framework as context, but do not automatically challenge the framework itself.

Framework application remains the responsibility of `EVALUATE_ACCORDING_TO_MY_FRAMEWORK`.

---

## 4. Target Resolution

Target resolution is hybrid.

Priority:

```text id="w3z0rk"
1. Explicit target
2. Active research context
3. Conversation context
4. Relevant research memory
```

If the trader uses a vague reference such as:

> "Challenge this."

the agent determines whether one target is clearly dominant.

```text id="e5n9za"
One clearly dominant target?
       ↙              ↘
     YES              NO
      ↓                ↓
   Infer            Clarify
```

Clarification is required only when multiple plausible targets exist and choosing between them could materially change the challenge.

The agent must never pretend an uncertain target is certain.

---

## 5. Thesis Decomposition

When sufficient structure exists, the agent decomposes the target into:

```text id="7w4n2c"
Conclusion
```text
├── Claims
├── Assumptions
├── Dependencies
└── Causal links
```
```

Each materially important component can then be challenged.

The purpose is not to attack wording or semantics unnecessarily.

The purpose is to identify where the reasoning could fail.

---

## 6. Challenge Intensity

Challenge intensity is adaptive.

The agent begins with evidence-based opposition and increases adversarial depth when warranted by factors such as:

* thesis strength
* uncertainty
* complexity
* resistance to ordinary challenge
* decision consequences
* quality of available evidence

Conceptually:

```text id="7n0fmc"
Evidence-based challenge
          ↓
Assess thesis + uncertainty + consequences
          ↓
Does stronger opposition add value?
       ↙              ↘
     YES              NO
      ↓                ↓
Increase          Remain evidence-based
adversarial depth
```

The agent must not manufacture objections merely to make the challenge appear rigorous.

---

## 7. What the Challenge Tests

The agent actively searches for:

* disconfirming evidence
* contradictory evidence
* broken assumptions
* weak causal links
* dependency failures
* counterexamples
* alternative explanations
* failure scenarios
* overlooked evidence
* conditions that could invalidate the expected outcome

The challenge should test the strongest vulnerable points rather than attacking trivial details.

---

## 8. Alternative Explanations

The agent searches for alternative explanations whenever they could materially:

* produce the same expected outcome
* explain the observed evidence
* weaken the stated causal argument
* undermine confidence in the thesis

Alternative explanations are ranked by relevance and evidence rather than treated equally by default.

Example:

```text id="9xw2jq"
Thesis:
BTC recovers because ETF inflows are strong.

Potential alternatives:
- short covering
- spot demand
- macro repricing
- derivatives positioning
```

The agent investigates alternatives when they could materially change the assessment.

---

## 9. Invalidation Conditions

`CHALLENGE` identifies invalidation conditions whenever the target has a meaningful, testable failure point.

The agent should determine:

```text id="q0a7ne"
What would contradict the thesis?
        ↓
What evidence would demonstrate failure?
        ↓
What observable condition would confirm that failure?
```

The system must not invent arbitrary thresholds merely to produce an invalidation condition.

If no meaningful testable failure condition exists, the agent should not force one.

---

## 10. Research Scope

The challenge can investigate across whatever domains are relevant to breaking or testing the target.

Potential domains include:

```text id="z7p4wq"
market data
macro
news
sentiment
technical analysis
derivatives
on-chain activity
market structure
liquidity
related assets
regulation
ecosystem data
```

The agent determines which domains are materially useful.

The trader can also constrain or modify scope through natural language.

---

## 11. Depth

`CHALLENGE` uses adaptive research depth.

```text id="0q6x5j"
depth {
  requested
  resolved_level
  minimum
  maximum
  adaptive
}
```

Internal levels may include:

```text id="k4t8wy"
quick
standard
deep
exhaustive
```

Natural language can determine requested depth.

Adaptive depth allows the agent to investigate further when additional evidence could materially change the challenge assessment.

Explicit hard limits must not be silently overridden.

---

## 12. Research Execution

Execution follows:

```text id="x5r2pm"
Interpret target
```text
        ↓
Resolve context
        ↓
Decompose thesis / target
        ↓
Identify vulnerable components
        ↓
Search disconfirming evidence
        ↓
Test assumptions + dependencies
        ↓
Search relevant alternatives
        ↓
Evaluate invalidation conditions
        ↓
Assess evidence
        ↓
```
Update challenge judgment
```

The agent does not stop merely because it found one counterargument.

It continues while additional research could materially change the assessment.

```text id="v3n8qa"
Is further research likely to materially
change the assessment?
          ↙                 ↘
        YES                 NO
         ↓                   ↓
     Continue             Conclude
```

---

## 13. Evidence Management

The challenge uses the common Evidence Management layer.

Evidence is evaluated according to:

* source quality
* provenance
* directness
* recency
* specificity
* corroboration
* conflicts of interest
* observation vs interpretation vs speculation

Evidence remains traceable:

```text id="u9q3mx"
Source
```text
  ↓
Claim
  ↓
Evidence
  ↓
Target component / hypothesis
  ↓
```
Challenge judgment
```

The strongest evidence against the thesis should receive appropriate attention, but supporting evidence must also be preserved.

---

## 14. Hypothesis Management

`CHALLENGE` may generate new hypotheses when warranted.

A new hypothesis should be formally created only when it materially affects the challenge.

For example:

```text id="q2m6rv"
Observed outcome
      ↓
Alternative explanation discovered
      ↓
Could it materially weaken the thesis?
      ↓
YES
      ↓
Create + test hypothesis
```

Minor observations remain evidence or context.

This prevents the challenge from becoming cluttered with irrelevant hypotheses.

---

## 15. Evidence-Driven Adaptation

The challenge can change direction when evidence warrants it.

If an important assumption survives, attention may move toward another vulnerable component.

If an alternative explanation becomes stronger, the agent investigates it further.

If a previously strong counterargument is disproven, the challenge adjusts accordingly.

Completed research and provenance are preserved.

The agent does not silently discard previous findings.

---

## 16. Challenge Result

The default result should provide a direct verdict first.

```text id="f1v8ks"
CHALLENGE RESULT

Verdict

Why

Key evidence

Main weakness / strength
```

Possible verdicts can be expressed naturally, for example:

```text id="3q0nzw"
Survives
Partially weakened
Materially weakened
Fails
```

The exact wording should depend on the evidence rather than forcing every challenge into a rigid classification.

Detailed information remains available through progressive disclosure:

```text id="e8v2lc"
Attacked claims
Assumptions tested
Dependencies tested
Counterarguments
Alternative explanations
Invalidation conditions
Evidence conflicts
Confidence
Research trail
```

---

## 17. Nuanced Conclusions

A challenge does not require a binary result.

A thesis may survive while one of its assumptions fails.

The agent should distinguish between:

```text id="7m5xqp"
What survived
What failed
What remains uncertain
How the failure affects the conclusion
```

If the conclusion may still hold despite a weak assumption, the agent should explain that relationship.

---

## 18. Revised Thesis Suggestions

When the challenge exposes a weak assumption but leaves a defensible core intact, the agent may suggest a possible revised thesis.

```text id="n4y7pc"
Original thesis
```text
      ↓
Challenge
      ↓
Surviving components
      ↓
Failed / weakened components
      ↓
```
Possible revised thesis
```

The revised thesis is only a suggestion.

The agent must never automatically replace the trader's original thesis.

The trader decides whether to adopt, modify, or reject it.

---

## 19. Next Research Steps

`CHALLENGE` may recommend a next research step when the challenge reveals a meaningful:

* unresolved weakness
* uncertainty
* potential invalidation
* evidence gap
* competing explanation

It should not prescribe a next step merely because the challenge has finished.

The recommendation is informational unless the trader explicitly initiates another action.

---

## 20. Relationship With MONITOR

If the challenge identifies a meaningful invalidation condition that could benefit from ongoing observation, the agent may recommend monitoring.

It must not activate monitoring automatically.

```text id="s7j2kx"
Challenge
```text
   ↓
Meaningful invalidation condition
   ↓
Recommend monitoring
   ↓
```
Trader confirms?
      ↙          ↘
    YES          NO
     ↓            ↓
 MONITOR       End
```

Activation of `MONITOR` remains subject to the universal confirmation boundary.

---

## 21. Framework Challenges

`CHALLENGE` can explicitly challenge a trader's framework.

For example:

> "Challenge my BTC research framework."

The agent can examine:

```text id="m0v4rs"
factors
weights
assumptions
thresholds
evaluation rules
dependencies
```

However, a framework is not silently modified as a result.

A possible improved framework can be suggested, but the trader decides whether to change it.

Persistent framework modification follows the existing confirmation boundary.

---

## 22. Natural-Language Control

The trader controls an active challenge naturally.

Examples:

```text id="y4c9qp"
"Try harder to break this."

"Focus on derivatives."

"Find historical examples where this failed."

"Challenge the assumption about ETF demand."

"What would invalidate this?"

"Look for another explanation."

"Go deeper on the strongest counterargument."

"Actually, challenge the causal link instead."
```

The system maps these requests to the appropriate universal action or state modification internally.

The trader never needs to learn the internal schema.

---

## 23. Relationship to Other Universal Actions

`CHALLENGE` is one of the six Universal Core actions (locked 2026-09-12):

```text id="p8v3mw"
RESEARCH
ANALYZE
CHALLENGE
MANAGE_STATE
MONITOR
SAVE
```

The distinction is based on primary trader intent.

```text id="r6k1az"
"Find out what happened."
→ RESEARCH

"Explain what these findings mean."
→ ANALYZE

"Try to prove my thesis wrong."
→ CHALLENGE

"Ignore sentiment and focus on derivatives."
→ MANAGE_STATE

"Keep watching funding rates."
→ MONITOR
```

`CHALLENGE` may internally perform research and analysis, but its primary intent remains falsification and stress testing.

---

## 24. Universal Core + Flow-Specific Extensions

`CHALLENGE` provides the universal challenge behavior.

Research flows can add specialized extensions.

Conceptually:

```text id="j5q8rx"
Natural language
```text
       ↓
Intent interpretation
       ↓
CHALLENGE
       ↓
Active research flow
       ↓
Flow-specific extension
       ↓
Parameters / targets / constraints
       ↓
```
Research state
```

Examples:

```text id="b6w2nt"
CHALLENGE
+ DOES_MY_THESIS_HOLD
+ thesis_component_stress_test

CHALLENGE
+ WHAT_COULD_PROVE_ME_WRONG
+ invalidation_search

CHALLENGE
+ HAS_THIS_HAPPENED_BEFORE
+ historical_failure_cases
```

The universal action remains stable while flow-specific extensions provide specialized behavior.

---

## 25. Core Principle

`CHALLENGE` should function as an adversarial research capability inside the workbench, not as a generic "devil's advocate" button.

The trader provides a belief, claim, thesis, assumption, position, interpretation, or framework.

The agent:

* identifies what must be true for it to hold
* decomposes the reasoning
* searches for disconfirming evidence
* attacks important assumptions and dependencies
* searches for meaningful alternatives
* identifies testable invalidation conditions
* adapts challenge intensity and depth
* creates material counter-hypotheses when warranted
* continues while further research could change the assessment
* produces a direct verdict
* explains what survived and what failed
* suggests a revised thesis only when useful
* recommends monitoring when a meaningful invalidation condition warrants it

The trader remains the final decision-maker.

> **The purpose of `CHALLENGE` is not to disagree. It is to find out whether the trader's reasoning survives serious attempts to break it.**
