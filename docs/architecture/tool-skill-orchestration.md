---
title: "TOOL & SKILL ORCHESTRATION INTELLIGENCE"
source: # TOOL & SKILL ORCHESTRATION INTELL.txt
converted: 2026-09-12
type: architecture-spec
related: [data-market-intelligence.md, evidence-source.md, failure-recovery.md, research-execution-engine.md]
---

**Related documents:** `data-market-intelligence.md` · `evidence-source.md` · `failure-recovery.md` · `research-execution-engine.md`

> Converted from `# TOOL & SKILL ORCHESTRATION INTELL.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

# TOOL & SKILL ORCHESTRATION INTELLIGENCE

## 1. Purpose

Tool & Skill Orchestration Intelligence determines which capabilities the research system should invoke, when they should be invoked, how they should be combined, and how their outputs should be validated and incorporated into the research.

It connects the Research Execution Engine to:

- Bitget Skills
- market-data tools
- news tools
- sentiment tools
- technical-analysis tools
- macroeconomic data
- on-chain data
- external research tools
- internal analytical capabilities
- source discovery and retrieval

The system should not treat Skills as fixed workflows.

A Skill is a capability available to the research engine.

The orchestrator decides when that capability is useful.

The core loop is:

```text
RESEARCH REQUIREMENT
→ CAPABILITY REQUIREMENTS
→ TOOL/SKILL DISCOVERY
→ CANDIDATE RANKING
→ TOOL/SKILL SELECTION
→ EXECUTION STRATEGY
→ EXECUTION
→ OUTPUT VALIDATION
→ EVIDENCE INGESTION
→ REASSESSMENT
→ NEXT CAPABILITY
```

The objective is not to invoke every available Skill.

The objective is to use the smallest useful set of capabilities capable of producing a strong research result.

---

# 2. Core Principles

### 2.1 Capability before tool

The system first determines:

> What capability do I need?

before determining:

> Which tool should provide it?

For example:

```text
Need:
"Understand current market positioning"

Capability:
MARKET_SENTIMENT_ANALYSIS

Possible providers:
sentiment Skill
social-data tool
market-positioning tool
```

This keeps the architecture provider-independent.

### 2.2 Skills are capabilities, not mandatory steps

A research flow may require a Skill, but the Skill does not automatically run simply because it exists.

The orchestrator determines whether the Skill can materially improve the research.

### 2.3 One Skill may serve multiple flows

For example, technical analysis may contribute to:

* What happened?
* What could affect it?
* Does my thesis hold?
* What does all the information say?
* What could prove me wrong?

### 2.4 Multiple capabilities may be combined

A single research question may require:

```text
NEWS
```text
+
MACRO
+
SENTIMENT
+
TECHNICAL
+
```
MARKET DATA
```

The orchestrator determines whether these should execute:

* in parallel
* sequentially
* conditionally
* iteratively

### 2.5 Tool output is not automatically truth

A Skill or tool produces information.

The Evidence Intelligence layer determines its evidentiary status.

Tool output must not bypass:

* provenance
* source evaluation
* evidence classification
* contradiction detection
* freshness assessment

### 2.6 Research remains adaptive

Tool selection can change after new evidence arrives.

The orchestrator may:

* add a Skill
* remove a Skill
* change priority
* repeat a Skill
* switch tools
* request another source
* investigate a contradiction

---

# 3. Capability Model

```text
CAPABILITY {
  id
  name
  category
  description
  supported_tasks[]
  supported_flows[]
  input_requirements[]
  output_types[]
  source_types[]
  freshness
  reliability
  latency
  cost
  coverage
  constraints[]
  provider_refs[]
  status
  provenance
}
```

Capabilities may include:

```text
EVENT_RECONSTRUCTION
CAUSAL_INVESTIGATION
IMPACT_ANALYSIS
MARKET_DATA_ANALYSIS
MACRO_ANALYSIS
NEWS_ANALYSIS
SENTIMENT_ANALYSIS
TECHNICAL_ANALYSIS
DERIVATIVES_ANALYSIS
ONCHAIN_ANALYSIS
HISTORICAL_COMPARISON
SOURCE_VALIDATION
EVIDENCE_VALIDATION
FALSIFICATION
THESIS_TESTING
FRAMEWORK_EVALUATION
CROSS_DOMAIN_SYNTHESIS
```

---

# 4. Tool Model

```text
TOOL {
  id
  name
  provider
  capability_refs[]
  input_schema
  output_schema
  execution_mode
  reliability
  freshness
  latency
  cost
  rate_limits
  source_types[]
  constraints[]
  authentication_state
  availability
  provenance
  status
}
```

The system should maintain a capability-to-tool mapping rather than embedding provider-specific logic throughout the research engine.

---

# 5. Skill Model

```text
SKILL {
  id
  name
  provider
  capability_refs[]
  supported_tasks[]
  supported_flows[]
  input_schema
  output_schema
  execution_characteristics
  reliability
  freshness
  limitations[]
  dependencies[]
  provenance
  version
  status
}
```

Bitget Skills are treated as specialized research capabilities within this model.

The initial Skill registry includes:

```text
MACRO_ANALYST
MARKET_INTEL
NEWS_BRIEFING
SENTIMENT_ANALYST
TECHNICAL_ANALYSIS
```

The architecture should allow additional Skills to be added without changing the research engine.

---

# 6. Capability Requirement

Every research task may produce a capability requirement.

```text
CAPABILITY_REQUIREMENT {
  id
  task_ref
  objective
  capability_type
  required
  preferred
  minimum_quality
  minimum_freshness
  scope
  depth
  priority
  information_value
  constraints
  alternatives[]
  completion_criteria[]
  status
}
```

Examples:

```text
"Why did BTC fall today?"
→ EVENT_RECONSTRUCTION
→ NEWS_ANALYSIS
→ MARKET_DATA_ANALYSIS
→ MACRO_ANALYSIS
```

or:

```text
"Does my BTC bullish thesis still hold?"
→ THESIS_TESTING
→ MARKET_DATA_ANALYSIS
→ MACRO_ANALYSIS
→ TECHNICAL_ANALYSIS
→ FALSIFICATION
```

Not every capability requirement must become a separate user-visible branch.

---

# 7. Capability Discovery

The orchestrator identifies candidate capabilities from:

* research flow
* task type
* information requirements
* target
* timeframe
* market context
* thesis
* hypothesis structure
* framework
* missing evidence
* existing evidence
* contradictions
* user constraints

The research flow provides minimum capability expectations.

The orchestrator may add capabilities when evidence warrants them.

---

# 8. Tool/Skill Selection

Candidate tools and Skills are ranked according to:

```text
RELEVANCE
```text
+
CAPABILITY FIT
+
DATA QUALITY
+
SOURCE QUALITY
+
FRESHNESS
+
COVERAGE
+
RELIABILITY
+
LATENCY
+
COST
+
```
AVAILABILITY
```

The highest-ranked provider is not always selected.

For example, a slower but more authoritative source may be preferred for a consequential factual claim.

---

# 9. Provider Independence

The research engine should not depend on one provider whenever practical.

If multiple providers can satisfy the same requirement, the orchestrator may use:

```text
PRIMARY PROVIDER
+
INDEPENDENT VALIDATION PROVIDER
```

when the claim is sufficiently important.

This prevents a single tool failure or systematic limitation from silently determining the research result.

---

# 10. Execution Strategy

The orchestrator may select:

```text
SEQUENTIAL
PARALLEL
CONDITIONAL
ITERATIVE
```

### Sequential

Used when one capability depends on another.

```text
NEWS
→ identify event
→ MARKET DATA
→ determine market reaction
```

### Parallel

Used when capabilities are independent.

```text
NEWS
MACRO
SENTIMENT
TECHNICAL
```

may run simultaneously.

### Conditional

Used when the result of one capability determines whether another is required.

```text
NEWS
→ discovers regulatory event
→ activate REGULATORY analysis
```

### Iterative

Used when new information repeatedly changes the research requirements.

```text
RESEARCH
→ evidence
→ new hypothesis
→ new capability
→ evidence
→ revised judgment
```

---

# 11. Parallelism

Independent capability tasks should run in parallel where practical.

Parallel execution should consider:

* dependency constraints
* resource limits
* rate limits
* cost
* latency
* tool availability
* evidence freshness

Parallelism must not create duplicate work.

---

# 12. Dependency-Aware Execution

A capability may depend on another capability.

Example:

```text
EVENT_RECONSTRUCTION
        ↓
CAUSAL_INVESTIGATION
```

or:

```text
SOURCE_DISCOVERY
        ↓
EVIDENCE_VALIDATION
        ↓
THESIS_TEST
```

The scheduler should not execute dependent tasks before their required inputs are available.

---

# 13. Evidence-Driven Tool Selection

Tool selection should adapt to the evidence state.

Example:

```text
Current evidence:
"BTC moved sharply after a major announcement."

Remaining uncertainty:
Did the announcement actually cause the move?

Required capability:
CAUSAL_INVESTIGATION

Additional capabilities:
MARKET_DATA
NEWS
MACRO
```

The orchestrator should not continue broad sentiment research simply because sentiment is available.

It should target the unresolved question.

---

# 14. Hypothesis-Driven Orchestration

Competing hypotheses may require different capabilities.

Example:

```text
H1:
Macro announcement caused the move.

H2:
Large liquidation event caused the move.

H3:
Exchange-specific event caused the move.
```

The orchestrator may allocate:

```text
H1 → MACRO + NEWS
H2 → DERIVATIVES + MARKET DATA
H3 → EXCHANGE/NEWS + MARKET DATA
```

The scheduler then prioritizes the evidence most capable of distinguishing the hypotheses.

---

# 15. Contradiction-Driven Orchestration

When two capabilities produce conflicting results, the orchestrator should not arbitrarily choose one.

It should:

1. identify the conflict
2. inspect provenance
3. compare timestamps
4. compare definitions
5. compare methodology
6. assess source quality
7. determine whether additional validation is useful
8. update evidence state
9. revise analysis if necessary

Additional tools may be invoked when they have meaningful information value.

---

# 16. Cross-Domain Orchestration

Cross-domain research should be intentional.

The system should ask:

> Would information from another domain materially improve this research?

Possible domains:

```text
MARKET
MACRO
NEWS
SENTIMENT
ONCHAIN
TECHNICAL
DERIVATIVES
REGULATION
ECOSYSTEM
HISTORICAL
```

The orchestrator should not automatically query every domain.

---

# 17. Skill Chaining

One Skill may create information requirements for another.

Example:

```text
NEWS_BRIEFING
→ identifies central-bank decision

MACRO_ANALYST
→ evaluates macro significance

MARKET_INTEL
→ evaluates market reaction

TECHNICAL_ANALYSIS
→ evaluates structural reaction
```

Each result becomes input to the next stage when relevant.

---

# 18. Output Normalization

Different tools may return different formats.

The orchestrator should normalize outputs into common internal structures.

Possible normalized result:

```text
TOOL_RESULT {
  id
  task_ref
  provider
  capability
  execution_time
  source_refs[]
  observations[]
  claims[]
  metrics[]
  interpretations[]
  uncertainties[]
  limitations[]
  raw_reference
  provenance
  freshness
  confidence
  status
}
```

Tool-specific formatting should not leak into the core reasoning architecture.

---

# 19. Tool Output Classification

Outputs should be classified before entering the evidence graph.

Possible classes:

```text
FACTUAL_OBSERVATION
QUANTITATIVE_OBSERVATION
ANALYST_INTERPRETATION
MODEL_OUTPUT
SENTIMENT_SIGNAL
INFERENCE
SPECULATION
UNAVAILABLE
ERROR
```

A model-generated interpretation must not silently become factual evidence.

---

# 20. Tool Result Validation

The orchestrator should validate:

* schema correctness
* required fields
* timestamps
* source references
* target identity
* timeframe
* units
* data completeness
* freshness
* obvious inconsistencies
* provider errors

Invalid tool output should not enter the research graph as valid evidence.

---

# 21. Tool Failure

Possible failures:

```text
TIMEOUT
RATE_LIMIT
AUTHENTICATION_FAILURE
UNAVAILABLE
INVALID_RESPONSE
PARTIAL_RESPONSE
STALE_DATA
SCHEMA_ERROR
PROVIDER_ERROR
EMPTY_RESULT
```

Recovery may include:

```text
RETRY
→ ALTERNATIVE TOOL
→ ALTERNATIVE SKILL
→ ALTERNATIVE SOURCE
→ REDUCE SCOPE
→ CONTINUE WITHOUT CAPABILITY
→ REPORT LIMITATION
```

The system must not fabricate missing tool output.

---

# 22. Retry Policy

Retries should depend on failure type.

Transient failures may be retried.

Persistent failures should trigger alternative-provider selection.

Examples:

```text
TIMEOUT
→ retry

RATE_LIMIT
→ wait / alternate provider

AUTH_FAILURE
→ do not repeatedly retry

EMPTY RESULT
→ modify query or capability

STALE DATA
→ request fresher source
```

Retry limits should prevent infinite loops.

---

# 23. Capability Substitution

If a preferred Skill is unavailable, the orchestrator may select another capability if it satisfies the same requirement sufficiently.

Example:

```text
Preferred:
Bitget NEWS_BRIEFING

Unavailable:
Alternative news retrieval + source analysis
```

Substitution must preserve provenance and clearly distinguish provider differences internally.

---

# 24. Capability Redundancy

Redundant execution may be useful when:

* the claim is highly material
* confidence is low
* providers have different methodologies
* a contradiction exists
* the result would materially change the judgment

Redundancy should not become automatic duplication.

---

# 25. Tool Freshness

The orchestrator should consider the temporal characteristics of each capability.

For example:

```text
LIVE MARKET DATA
→ seconds/minutes

NEWS
→ minutes/hours

MACRO DATA
→ release-dependent

HISTORICAL DATA
→ relatively stable

TECHNICAL ANALYSIS
→ depends on underlying market data freshness
```

A tool may technically succeed while still providing data too stale for the research requirement.

---

# 26. Tool Cost and Resource Allocation

The scheduler may consider:

* execution cost
* latency
* API limits
* compute requirements
* research budget
* expected information value

High-cost capabilities should receive resources when their expected information value justifies them.

---

# 27. Information-Value Scheduling

A tool should be prioritized when its output is likely to:

* resolve uncertainty
* distinguish hypotheses
* validate an important claim
* invalidate an assumption
* change confidence
* change judgment
* satisfy a critical evidence requirement

This connects orchestration to the Execution Scheduler.

---

# 28. User Steering

Natural language may directly alter orchestration.

Examples:

```text
"Use macro data too."

→ add MACRO capability
```

```text
"Don't use sentiment."

→ exclude SENTIMENT capability
```

```text
"Focus on on-chain data."

→ increase ONCHAIN priority
```

```text
"Only use primary sources."

→ update source constraints
```

```text
"Go deeper on derivatives."

→ increase DERIVATIVES research depth
```

These changes are handled through LUI + MANAGE_STATE and reflected in the active research plan.

---

# 29. Hard Constraints

User-defined hard constraints must be respected.

Examples:

```text
ONLY_PRIMARY_SOURCES
NO_SENTIMENT
LAST_30_DAYS
MACRO_REQUIRED
MAX_RESEARCH_TIME
SPECIFIC_DATA_PROVIDER
```

The orchestrator must not silently violate a hard constraint.

If satisfying the research objective becomes impossible under the constraint, the system should report the limitation or request clarification.

---

# 30. Soft Preferences

Preferences may guide selection without becoming hard requirements.

Examples:

```text
Prefer primary sources.
Prefer recent data.
Prefer official data.
Prefer deep analysis.
Prefer technical analysis.
```

Soft preferences may be overridden when necessary to satisfy the research objective.

---

# 31. Trader Overrides

The trader may override orchestration.

Examples:

```text
"Use only technical analysis."

"Ignore the macro branch."

"Add derivatives."

"Don't spend more time on sentiment."

"Search primary sources first."
```

The override affects the active research state while preserving history.

---

# 32. Automatic Replanning

The orchestrator should replan when:

* a major hypothesis changes
* a critical evidence gap appears
* a tool fails materially
* a contradiction emerges
* a new event changes the research target
* a user changes scope
* a Skill result materially changes the information requirements

Minor tool-level changes should not rebuild the entire research plan.

---

# 33. Capability Completion

A capability task is complete when:

* its required information was retrieved
* output passed validation
* relevant source/provenance information is preserved
* required evidence was produced or unavailable status established
* downstream dependencies are unlocked
* additional execution is unlikely to materially improve the task

---

# 34. Capability Result Reuse

Tool results may be reused across:

* branches
* claims
* hypotheses
* analyses
* research objects

provided:

* provenance is preserved
* timeframe remains relevant
* freshness remains appropriate
* context remains compatible

Reusing a result does not make it newly retrieved evidence.

---

# 35. Historical Tool Results

Historical tool results should remain distinguishable from current results.

The system must preserve:

```text
RETRIEVED_AT
OBSERVED_AT
RESEARCH_CONTEXT
SOURCE_VERSION
```

Historical results may inform current research but should not silently masquerade as current data.

---

# 36. Tool Relationship Graph

The system may maintain relationships such as:

```text
CAPABILITY
```text
  ├── PROVIDED_BY → TOOL
  ├── PROVIDED_BY → SKILL
  ├── REQUIRES → CAPABILITY
  ├── COMPLEMENTS → CAPABILITY
  ├── VALIDATES → CAPABILITY
  ├── ALTERNATIVE_TO → TOOL/SKILL
  └── DEPENDS_ON → TOOL/SKILL
```
```

This allows orchestration to become capability-aware rather than provider-hardcoded.

---

# 37. Security and Credential Boundary

Tool credentials should remain outside the research reasoning objects.

The research system may know:

```text
TOOL AVAILABLE
TOOL UNAVAILABLE
```

but should not expose credentials through:

* research objects
* evidence
* source records
* conversation history
* saved artifacts
* model-generated output

Credential management belongs to the runtime/tool infrastructure.

---

# 38. Provenance

Every material tool result should preserve:

```text
TOOL/SKILL
PROVIDER
EXECUTION TIME
INPUT CONTEXT
SOURCE REFERENCES
DATA TIMEFRAME
RESULT VERSION
```

This allows the system to answer:

> Which capability produced this information?

and:

> Is this information still valid?

---

# 39. Completion Quality Gate

Before a tool result is treated as successfully contributing to research:

```text
CAPABILITY MATCH?
TARGET CORRECT?
TIMEFRAME CORRECT?
OUTPUT VALID?
SOURCE IDENTIFIED?
FRESHNESS ACCEPTABLE?
PROVENANCE PRESERVED?
LIMITATIONS KNOWN?
RESULT RELEVANT?
```

If these conditions fail materially, the result should not silently enter the judgment chain.

---

# 40. Interaction With Research Components

### Research

Determines the objective.

### Planning

Determines required tasks and capabilities.

### Scheduler

Determines execution priority and resources.

### Source Discovery

Finds and retrieves source material.

### Evidence Intelligence

Evaluates resulting evidence.

### Hypothesis Intelligence

Determines what evidence is useful for competing explanations.

### Analysis

Combines validated information.

### Judgment

Determines the current best-supported assessment.

### Challenge

Requests adversarial or falsification-oriented capability execution.

### Monitor

May trigger capabilities when monitored conditions change.

### Memory

Preserves reusable capability results where appropriate.

### Save

Preserves intentional reusable research artifacts.

---

# 41. Global Orchestration Loop

```text
RESEARCH OBJECTIVE
```text
        ↓
IDENTIFY INFORMATION REQUIREMENTS
        ↓
IDENTIFY CAPABILITY REQUIREMENTS
        ↓
DISCOVER AVAILABLE TOOLS/SKILLS
        ↓
RANK CANDIDATES
        ↓
SELECT CAPABILITIES
        ↓
BUILD EXECUTION STRATEGY
        ↓
RUN IN PARALLEL / SEQUENCE / CONDITIONALLY
        ↓
VALIDATE OUTPUTS
        ↓
NORMALIZE RESULTS
        ↓
PRESERVE PROVENANCE
        ↓
HAND OFF TO EVIDENCE INTELLIGENCE
        ↓
UPDATE CLAIMS / HYPOTHESES
        ↓
REASSESS INFORMATION REQUIREMENTS
        ↓
REPLAN WHEN MATERIAL
        ↓
ALLOCATE NEXT CAPABILITIES
        ↓
```
COMPLETE OR CONTINUE
```

## Global Principle

Tool & Skill Orchestration Intelligence should answer:

> “What capability does this research need, which available tool or Skill can provide it most effectively, how should it be executed, and did its result actually improve the research?”

The orchestrator owns **capability selection and execution strategy**.

It does not own truth.

Evidence Intelligence evaluates evidence.

Analysis Intelligence interprets information.

Judgment Intelligence produces the current assessment.

The trader remains the final decision-maker.

```
```
