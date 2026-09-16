---
title: "LUI Layer — Natural Language Interaction Model"
source: # LUI Layer — Natural Language Inte.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-universal-core.md, lui-flow-extensions.md]
---

**Related documents:** `lui-universal-core.md` · `lui-flow-extensions.md`

> Converted from `# LUI Layer — Natural Language Inte.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

# LUI Layer — Natural Language Interaction Model

## Purpose

The LUI (Language User Interface) is the control system through which the trader interacts with the research engine.

Natural language is not merely a chat interface. It allows the trader to control, redirect, challenge, modify, and navigate ongoing research without manually managing the underlying research architecture.

The LUI uses an internal structured action model for reliability, while allowing traders to communicate entirely through natural language.

---

## LUI Design Decisions

### 1. Hybrid Natural-Language Action Model

The system maintains an internal taxonomy of research actions for reliable execution, but these actions are never exposed as rigid commands.

The LLM maps arbitrary trader language into the appropriate internal action.

Examples:

- "Go deeper on derivatives." → `DEEPEN`
- "I don't buy this explanation." → `CHALLENGE`
- "Focus only on macro." → `REFOCUS`
- "Compare this with previous crashes." → `COMPARE`
- "What makes you think that?" → `EXPLAIN`
- "Actually, I meant ETH." → `CORRECT`
- "Forget the macro angle." → `REMOVE_SCOPE`
- "Go back to the liquidity hypothesis." → `RESTORE`
- "Keep watching this." → `MONITOR`

The taxonomy provides structure underneath the LUI without making interaction feel command-driven.

---

### 2. Ambiguous Commands Require Clarification

When a natural-language request does not clearly identify its target, the agent asks for clarification rather than guessing.

Example:

> "Look deeper into this."

If multiple research objects could be targeted, such as a hypothesis, factor, source, or the entire research question, the agent asks which one the trader means.

The agent should not silently select an arbitrary target.

Core principle:

> Ambiguity should be resolved before consequential research actions are taken.

---

### 3. Selective Interruption

The trader can interrupt ongoing research through natural language.

Example:

> "Stop researching macro and focus on derivatives."

The agent selectively stops or deprioritizes the affected research branches while preserving useful completed work and unrelated active research.

It then reallocates research effort toward the trader's new focus.

The interruption should not unnecessarily destroy existing research.

Core principle:

> Interrupt the work that is no longer relevant, not the entire research state.

---

### 4. Challenging the Agent

When the trader challenges the current conclusion, the system treats the challenge as both:

1. A new hypothesis.
2. A direct stress test of the current judgment.

Example:

> "I don't think the news caused the move. I think liquidity did."

The agent registers the liquidity explanation as a hypothesis and compares it against the existing leading explanation using existing evidence before conducting additional research where necessary.

This prevents the system from simply agreeing with the trader while also preventing it from ignoring the trader's alternative interpretation.

Core principle:

> Trader disagreement becomes evidence to investigate, not an instruction to accept.

---

### 5. Automatic Correction and Re-planning

Clear factual corrections should be applied immediately without requiring confirmation.

Example:

> "Actually, I meant ETH, not BTC."

The agent corrects the active research context and automatically re-plans affected work.

Previously completed work is preserved in the research history rather than silently deleted.

Core principle:

> Clear corrections should be frictionless.

---

### 6. Context-Aware Branching

When the trader introduces a new research direction, the agent determines whether it belongs inside the current investigation or deserves a separate branch.

Example:

> "Also check what happens if the Fed cuts rates."

The agent evaluates its relationship to the active research.

It may:

- add it as a branch of the current investigation, or
- create a separate research branch if it represents a distinct question.

The trader does not need to manually specify the research structure.

Core principle:

> The trader states what they want investigated; the agent determines the appropriate research structure.

---

### 7. Research Restoration and Freshness

When the trader returns to an earlier hypothesis or research path, the agent restores its existing research state first.

It then evaluates whether the information is still sufficiently fresh or whether new research is necessary.

Example:

> "Go back to the liquidity hypothesis."

The agent should not blindly rerun everything, nor should it blindly trust stale research.

Core principle:

> Restore first, refresh only where necessary.

---

### 8. Hybrid Research Depth Control

The trader can explicitly control research depth through natural language.

Examples:

> "Give me the quick version."

> "Go much deeper on derivatives."

The system supports explicit depth preferences while allowing the agent to dynamically increase or decrease depth for individual branches when the evidence warrants it.

For example, the trader may request a quick investigation, but the agent can recognize that a key unresolved hypothesis requires deeper investigation.

Core principle:

> Trader controls desired depth; evidence determines where additional depth is justified.

---

### 9. Scope Replacement

When the trader explicitly changes the research scope, the new scope replaces the previous active scope.

Example:

> "Forget the macro angle. Focus on derivatives and on-chain data."

The agent stops allocating active research effort to the previous scope and reorients the research plan around the new scope.

Previously completed research is preserved rather than destroyed.

Core principle:

> Explicit scope changes are decisive.

---

### 10. Intent Changes Replace the Active Research Plan

When the trader fundamentally changes the research objective, the agent automatically transitions to the new intent.

Example:

Current question:

> "Why did BTC fall?"

Trader:

> "Actually, forget why it fell. Tell me whether this is a good entry."

The agent abandons the old active research plan and creates a new plan for the new research intent.

Relevant existing evidence may be reused when appropriate.

The old research remains preserved as historical context.

Core principle:

> A clear change in intent changes the active task.

---

### 11. Context-Aware Undo and Removal

Natural-language requests such as:

> "Remove that hypothesis."

> "Undo the last change."

are interpreted according to context.

The agent determines whether the trader intends to:

- remove an item from the active workspace,
- mark a hypothesis inactive/rejected,
- remove a scope element,
- or reverse a recent state change.

The underlying research history remains auditable even when an item is removed from the active workspace.

Core principle:

> "Remove" changes active research state without destroying research provenance.

---

### 12. Confirmation Boundary

The system distinguishes between ordinary research manipulation and persistent or consequential actions.

Ordinary research actions execute immediately when sufficiently clear.

Examples:

- changing research scope
- deepening an investigation
- challenging a hypothesis
- switching focus
- correcting an asset
- comparing historical cases

Persistent or externally consequential actions require confirmation.

Examples:

- saving a new persistent framework
- replacing an existing framework
- activating monitoring
- creating a persistent research preference

Example:

> "Start monitoring this."

The agent should explain what will be monitored and request confirmation before activation.

Core principle:

> Fast interaction for research; confirmation for persistent or consequential state changes.

---

## LUI Behavioral Principles

### Natural Language as the Control Surface

The trader should not need to learn application-specific commands.

Natural language should be capable of expressing:

- research requests
- corrections
- challenges
- scope changes
- interruptions
- comparisons
- explanations
- branching
- restoration
- depth changes
- monitoring requests
- persistent preferences

---

### Agent Owns Research Structure

The trader specifies intent.

The agent determines:

- what research action is required
- which research object is affected
- whether to branch
- which tools and sources are relevant
- how much investigation is necessary
- how existing research can be reused

The trader should not have to manually orchestrate the research process.

---

### Trader Remains in Control

The agent can structure and execute research, but the trader remains the final decision-maker.

The system should never silently:

- change a thesis
- change a personal framework
- treat historical research as current evidence
- activate monitoring
- persist a new preference
- replace a trader-defined framework

---

### Preserve Research Continuity

Changes to active research should not destroy the underlying research history.

The system should preserve:

- previous hypotheses
- discarded branches
- previous conclusions
- evidence
- research plans
- corrections
- changes in direction
- framework evolution

This allows the trader to return to previous research without starting from zero.

---

### Progressive Disclosure

The LUI should support increasing levels of detail:

1. Decision-ready judgment
2. Why the agent reached the judgment
3. Supporting and opposing evidence
4. Hypotheses and research branches
5. Full research trail

The trader can move deeper through natural language.

Example:

> "Why?"

> "Show me the evidence."

> "What did you rule out?"

> "Show me the full research trail."

---

## LUI Architecture Direction

The LUI should ultimately operate through:

Natural-language input
→ Intent interpretation
→ Internal LUI action classification
→ Target resolution
→ Context/state validation
→ Research-state modification
→ Research-plan update
→ Tool/data orchestration
→ Workspace update
→ Response to trader

The internal action taxonomy provides reliability, while the natural-language layer preserves flexibility.

The next design task is to define the actual action taxonomy.

### Chosen Architecture

The LUI will use:

> Universal Core Actions + Flow-Specific Extensions

The universal core handles common research interactions across all eight research flows.

Each research flow can then add specialized actions where its research semantics require them.
