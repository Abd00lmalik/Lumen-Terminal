---
title: "AI Trading Desk; Common Intelligence Layer"
source: commonintelligencelayer.txt
converted: 2026-09-12
type: architecture-spec
related: [research-flows.md, research-execution-engine.md, judgment-confidence.md]
---

**Related documents:** `research-flows.md` · `research-execution-engine.md` · `judgment-confidence.md`

> Converted from `commonintelligencelayer.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

AI Trading Desk; Common Intelligence Layer
Purpose
The Common Intelligence Layer is the shared intelligence infrastructure underneath all eight research flows.
The eight flows define what kind of research the trader wants.
The Common Intelligence Layer defines how the AI conducts, manages, evaluates, and evolves that research.
It ensures that the product behaves as one coherent research workbench rather than eight independent prompt workflows.
Core Architecture
Natural-Language Request
```text
        ↓
Intent & Context Understanding
        ↓
Living Research Plan
        ↓
Tool / Data Orchestration
        ↓
Evidence Management
        ↓
Hypothesis Management
        ↓
Reasoning & Synthesis
        ↓
Uncertainty & Confidence
        ↓
Decision-Ready Judgment
        ↓
Optional Monitoring Handoff
        ↓
```
Persistent Research Memory

The process is not strictly linear.
Evidence can change hypotheses.
Hypotheses can change the research plan.
New research can change the judgment.
A trader can modify the request while research is underway.
Therefore, the system operates as a dynamic research loop rather than a fixed pipeline.

1. Intent & Context Understanding
Purpose
Understand what the trader actually wants to investigate from natural language and determine the appropriate research behavior.
Natural language is the primary control surface.
The trader should not need to manually select a research mode for normal interactions.
Responsibilities
The agent should infer:

Research intent
Asset/entity
Event
Timeframe
Market context
Relevant trader context
Implied constraints
Relevant prior research
Applicable research flow

Behavior
The agent should:

Parse the trader's request.
Determine the most appropriate research flow.
Briefly state its interpretation.
Begin research immediately.
Remain steerable while research is running.
Re-plan when the trader changes direction.

Example
Trader:

"BTC looks weak. What should I be worried about?"

Agent:

"I'm treating this as a downside-risk assessment, focusing on factors that could materially worsen BTC's current setup."

Research begins immediately.
Trader:

"Actually, focus more on whether the weakness is coming from derivatives."

The agent adapts the investigation without requiring the trader to restart.
Core Principle

Interpret first, act immediately, remain steerable.


2. Research Planning
Purpose
Convert the trader's request into an investigation strategy.
The research plan is a living object, not a static checklist.
Target Behavior
The preferred behavior is a fully visible and interactive research plan.
If exposing the complete plan would create unnecessary complexity or cognitive load, the system falls back to a compact visible plan.
Responsibilities
The agent should:

Determine what needs to be investigated.
Break research into meaningful objectives.
Select relevant investigation branches.
Identify required tools/data.
Prioritize research tasks.
Display the current plan.
Modify the plan as research evolves.

Dynamic Planning
The plan can change when:

New evidence appears.
A hypothesis weakens.
A new hypothesis emerges.
A research branch becomes irrelevant.
The trader changes the request.
A previously unknown dependency is discovered.

Completed work should be preserved when the plan changes.
The agent should not restart unnecessarily.
Example
Initial plan:
1. Establish the BTC move
2. Investigate macro catalysts
3. Investigate derivatives
4. Investigate news
5. Compare competing explanations

Trader:

"Skip macro for now and dig deeper into derivatives."

The plan updates immediately.
Core Principle

The research plan is a living control surface, not a progress indicator.


3. Tool & Data Orchestration
Purpose
Determine which data sources, tools, and research Skills are appropriate for the current research task.
The agent should choose tools based on the research objective rather than indiscriminately using everything available.
Responsibilities
The agent should:

Select appropriate tools automatically.
Select relevant data sources.
Select relevant research Skills.
Use multiple sources when cross-validation matters.
Adapt tool selection when research direction changes.
Avoid unnecessary tool usage.
Show the trader what sources/tools are being used.

Visibility
The trader should be able to see:
Sources / Skills in use

Market Data
Derivatives Data
News Intelligence
Technical Analysis

The system does not need to expose implementation-level details unless useful.
Dynamic Orchestration
If new evidence changes the research direction, the agent can change the tools it uses.
For example:
Initial research
```text
    ↓
News + Market Data
    ↓
Unexpected derivatives signal
    ↓
Add Derivatives Analysis
    ↓
```
Investigate liquidation structure

Core Principle

The agent decides how to research; the trader can see what it is using.


4. Evidence Management
Purpose
Create a connected evidence layer that allows the system to understand not only what sources exist, but how individual pieces of evidence relate to claims and hypotheses.
Evidence is a living research object.
Evidence Model
Evidence should maintain relationships between:
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
Judgment

Responsibilities
The agent should:

Preserve source provenance.
Preserve timestamps.
Connect claims to supporting evidence.
Connect claims to contradicting evidence.
Track evidence supporting each hypothesis.
Track evidence weakening each hypothesis.
Evaluate evidence quality.
Detect conflicting sources.
Reassess evidence quality as new information appears.
Preserve the research trail.

Evidence Quality
Evidence should be evaluated contextually using factors such as:

Source quality
Provenance
Directness
Recency
Specificity
Corroboration
Potential conflicts of interest
Observation vs interpretation
Speculation vs verified information

Evidence should not receive a universal reliability score independent of context.
A source can be highly useful for one claim and weak for another.
Dynamic Evidence
Evidence quality can change when:

A better source becomes available.
New data contradicts an earlier claim.
A source is corrected.
A timestamp changes the causal interpretation.
Independent corroboration appears.

Core Principle

Evidence strength is dynamic and claim-specific.


5. Hypothesis Management
Purpose
Manage competing explanations as living research objects.
The agent should follow evidence rather than becoming anchored to its first explanation.
Responsibilities
The agent should:

Create initial hypotheses automatically.
Rank hypotheses based on current evidence.
Track supporting evidence.
Track contradicting evidence.
Continuously update hypothesis strength.
Preserve weakened/rejected hypotheses.
Create new hypotheses when unexpected evidence warrants them.
Branch investigations when necessary.
Compare competing hypotheses.

Dynamic Hypothesis Evolution
Example:
Initial research

Hypothesis A
    ↓
Strongest explanation

New evidence
    ↓
A weakens

Hypothesis B emerges
    ↓
Investigate B

Compare A vs B
    ↓
Updated judgment

The original hypothesis and its research should remain available.
The agent should not delete previous reasoning simply because the conclusion changed.
Anti-Anchoring Principle
A hypothesis that appears strongest early in the investigation should not automatically control the rest of the research.
New evidence must be capable of changing the direction of the investigation.
Core Principle

The agent follows evidence, not its first hypothesis.


6. Reasoning & Synthesis
Purpose
Convert the evolving evidence and hypotheses into a coherent, decision-ready judgment.
The judgment is a living research object, not a one-time summary.
Responsibilities
The agent should:

Synthesize evidence.
Compare competing hypotheses.
Resolve conflicts.
Produce a primary judgment.
Identify supporting evidence.
Identify opposing evidence.
Identify uncertainty.
Assign appropriate confidence.
Continuously reassess the judgment.

Dynamic Judgment
When new evidence materially changes the conclusion, the agent should revise the judgment.
It should preserve the previous judgment and explain what caused the change.
Example:
Previous judgment:
Macro conditions are the strongest explanation.

New evidence:
Large liquidation activity occurred immediately before the move.

Updated judgment:
Derivatives/liquidations now appear to be the primary driver.
Macro remains a contributing factor.

Materiality Requirement
The agent should not constantly change its conclusion because of weak or irrelevant information.
A revision should occur when new evidence is materially relevant.
Progressive Traceability
The trader sees the judgment first.
Underlying evidence and reasoning remain available on demand.
Example:

"Show me why."

The system then exposes:

Relevant hypotheses
Supporting evidence
Contradicting evidence
Important research branches
Reasoning behind the judgment

Core Principle

The conclusion is a living research object, but revisions require material evidence.


7. Uncertainty & Confidence
Purpose
Represent how strongly the agent supports a conclusion and what prevents greater certainty.
Confidence should be explainable rather than merely numerical.
The Agent Should Show

Overall confidence.
Main sources of uncertainty.
Strong vs weak evidence.
Unknown information.
Contested information.
Evidence that would increase confidence.
Evidence that would decrease confidence.

Example
Confidence: Moderate

Main uncertainty:
Conflicting derivatives data from two sources.

Confidence would increase if:
Independent market data corroborates the positioning.

Confidence would decrease if:
New data invalidates the current positioning estimate.

Confidence Representation
The system may use:

High
Moderate
Low

or another appropriate qualitative representation.
Numerical confidence should only be used when the underlying methodology justifies the precision.
The system should avoid false precision.
Dynamic Confidence
Confidence changes when meaningful evidence changes.
It should not fluctuate simply because more information was collected.
Core Principle

Uncertainty tells the trader what is unknown; confidence tells them how strongly the agent supports the judgment.


8. Research Memory
Purpose
Provide continuity across research sessions while clearly separating historical context from current evidence.
Memory Includes

Trader frameworks
Research preferences
Previous research
Prior hypotheses
Previous conclusions
Relevant research context
Thesis evolution
Relevant historical decisions/context

Contextual Retrieval
When new research begins, the agent may surface relevant prior research.
Example:

"You previously investigated BTC liquidity conditions. That research concluded liquidity was improving, with moderate confidence. Current data now shows..."

Critical Distinction
The system must clearly distinguish:
CURRENT EVIDENCE
vs
HISTORICAL RESEARCH
vs
TRADER PREFERENCE

Old research must never silently become current evidence.
Memory Correction
The trader should be able to correct or override remembered context through natural language.
Example:

"Don't use my previous BTC liquidity assumption. I've changed my view."

The system updates the relevant context.
Core Principle

Memory provides continuity, not authority.


9. Monitoring Handoff
Purpose
Allow research conclusions to become explicitly approved monitoring tasks while preserving the reasoning context that created them.
Monitoring is an extension of research rather than an isolated alert system.
Activation
The agent can propose monitoring opportunities.
Monitoring requires explicit trader confirmation before activation.
Example:

"These three conditions are worth monitoring."

Trader:

"Monitor those."

The monitoring task becomes active.
Connected Monitoring
An active monitoring task remains connected to:

Original research question
Thesis/belief
Relevant hypotheses
Evidence
Invalidation conditions
Important factors
Confidence
Research framework, where applicable

Intelligent Updates
When new information arrives, the agent evaluates it against the original research context.
It should not simply send a raw alert.
Example:
Instead of:

"BTC crossed X."

The system can determine:

"BTC has reached the condition identified in your earlier research as a meaningful threat to the bullish thesis."

Natural-Language Modification
The trader can modify monitoring naturally.
Example:

"Stop watching X. Only alert me if Y happens."

The monitoring task updates accordingly.
Core Principle

Monitoring preserves the reasoning context that created the alert.


Cross-Layer Behavior
The nine capabilities are interconnected.
They should not behave as isolated modules.
A simplified interaction model:
```text
                    ┌──────────────────────┐
                    │ Natural-Language LUI │
                    └──────────┬───────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Intent & Context        │
                  │ Understanding           │
                  └────────────┬────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Living Research Plan    │
                  └────────────┬────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Tool / Data             │
                  │ Orchestration            │
                  └────────────┬────────────┘
                               ↓
             ┌─────────────────┴─────────────────┐
             ↓                                   ↓
┌────────────────────────┐          ┌────────────────────────┐
│ Evidence Management    │ ←──────→ │ Hypothesis Management  │
└────────────┬───────────┘          └────────────┬───────────┘
             └─────────────────┬─────────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Reasoning & Synthesis   │
                  └────────────┬────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Uncertainty & Confidence│
                  └────────────┬────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Decision-Ready Judgment │
                  └────────────┬────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Monitoring Handoff      │
                  └────────────┬────────────┘
                               ↓
                  ┌─────────────────────────┐
                  │ Research Memory         │
                  └─────────────────────────┘
```

The architecture should support feedback loops.
For example:
New Evidence
```text
     ↓
Hypothesis changes
     ↓
Research Plan changes
     ↓
New Tools selected
     ↓
More Evidence
     ↓
Judgment changes
     ↓
```
Confidence changes


Global Design Principles
1. Natural Language Is the Control Surface
The trader should be able to modify research using ordinary language.
Examples:

"Go deeper on derivatives."


"Ignore social sentiment."


"Compare this with 2022."


"Show me why."


"That assumption is wrong. Use this instead."


"Keep watching that."

The system translates these commands into structured changes internally.

2. The Agent Owns the Research Burden
The system should not repeatedly transfer analytical work back to the trader.
Bad:

"Here are five possible explanations. Which one should I investigate?"

Better:

"I investigated all five. Two are strongly supported. This is the leading explanation and here's why."

The trader should spend effort on decisions, not manually coordinating research.

3. Evidence Can Change the Research Direction
The system should not treat the initial research plan as sacred.
Unexpected evidence can:

Create hypotheses.
Remove branches.
Increase research depth.
Change tool selection.
Change the final judgment.


4. The Trader Remains the Decision-Maker
The agent can:

Research
Analyze
Challenge
Stress-test
Recommend
Monitor after confirmation

The agent does not autonomously make the trader's final investment decision.

5. No Silent Changes
The agent should not silently:

Modify the trader's thesis.
Modify the trader's framework.
Convert historical evidence into current evidence.
Remove contradictory research.
Change monitoring conditions.
Rewrite conclusions without explanation.

Material changes should be visible and traceable.

6. Progressive Disclosure
The default interface should prioritize:
What should I know?
        ↓
Why?
        ↓
Show evidence.
        ↓
Show deeper reasoning.
        ↓
Show full research trail.

The trader should not be forced to read the entire investigation to understand the conclusion.

7. Research Is Persistent
Important research should remain useful after the immediate answer.
The workbench should allow the trader to move naturally between:
Question
→ Research
→ Judgment
→ Thesis
→ Monitoring
→ New Evidence
→ Reassessment


Relationship to the 8 Research Flows
The Common Intelligence Layer supports all eight flows:


Research Flow
Most Important Common Capabilities


What happened?
Intent, Planning, Evidence, Synthesis, Confidence


Why did it happen?
Planning, Evidence, Hypotheses, Synthesis, Falsification


What could affect it?
Intent, Planning, Evidence, Impact Analysis, Monitoring


Does my thesis hold?
Evidence, Hypotheses, Falsification, Synthesis, Memory


Has this happened before?
Evidence, Historical Research, Hypotheses, Synthesis


What does all the information say?
Tool Orchestration, Evidence, Cross-Domain Synthesis, Confidence


What could prove me wrong?
Evidence, Hypotheses, Falsification, Monitoring


Evaluate according to my framework
Memory, Evidence, Framework Evaluation, Synthesis, Integrity Checks


The flows remain specialized.
The Common Intelligence Layer provides their shared reasoning infrastructure.

Final System Principle
The complete product should behave like this:
TRADER
```text
  ↓
Natural-language question
  ↓
AI understands intent
  ↓
AI creates a research plan
  ↓
AI researches autonomously
  ↓
Evidence continuously updates
  ↓
Hypotheses evolve
  ↓
Research plan adapts
  ↓
Judgment evolves
  ↓
Confidence evolves
  ↓
Trader can steer at any point
  ↓
Decision-ready conclusion
  ↓
Trader decides
  ↓
Optional monitoring
  ↓
```
Research becomes future context

The central product philosophy is:

The trader provides the question and judgment. The AI carries the research burden.

This is what turns the system from a conventional chatbot into an AI Research Workbench.
