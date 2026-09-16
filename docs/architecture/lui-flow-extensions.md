---
title: "LUI; Universal Core + Flow-Specific Extensions"
source: LUI; Universal Core + Flow-Specifi.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-universal-core.md, lui-interaction-model.md]
---

**Related documents:** `lui-universal-core.md` · `lui-interaction-model.md`

> Converted from `LUI; Universal Core + Flow-Specifi.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.
>
> **Amended 2026-09-12 (final architecture lock, human-approved):** this document originally specified a five-action universal core excluding SAVE. Per the lock, the universal action set is **six actions including SAVE** as a first-class action (see [`lui-universal-core.md`](lui-universal-core.md) and [`lui-save-action.md`](lui-save-action.md)). Rationale: `MANAGE_STATE` modifies current research/workspace state; `SAVE` intentionally promotes eligible state into persistent reusable memory/artifacts; different semantics and confirmation requirements. Inconsistent references in this file were updated to the locked model; the original `.txt` source remains preserved unmodified at the repo root.

LUI; Universal Core + Flow-Specific Extensions
1. Architecture Decision
The LUI uses a hybrid two-layer architecture:

Universal Action = Primary Trader Intent
Flow-Specific Extension = Specialized Research Behavior

Natural language is mapped to a small set of universal actions. The active research flow then adds specialized behavior, parameters, and operations relevant to that flow.
This prevents the LUI from becoming fragmented while still allowing each of the 8 research flows to behave differently.

2. Universal Core Actions
The LUI has six universal first-class actions:
1. RESEARCH
Represents the trader's intent to investigate or discover information.
Examples:

"Find out what's happening with BTC."
"Dig deeper into derivatives."
"Look into the macro picture."
"Broaden the investigation."

The action can accept parameters controlling scope, target, depth, priority, constraints, and research mode.
RESEARCH may internally invoke analysis, hypothesis generation, evidence gathering, tool calls, and synthesis.

2. ANALYZE
Represents an explicit request to understand, interpret, compare, or examine identified research objects.
Examples:

"Compare this crash with the March crash."
"Explain why derivatives matter here."
"Compare the strongest two explanations."
"What is different between these historical cases?"

ANALYZE may trigger additional research when required evidence is missing.
The requested intent remains ANALYZE; additional research is an internal execution step.

3. CHALLENGE
Represents an explicit request to stress-test, falsify, or attempt to invalidate a thesis, hypothesis, belief, or current judgment.
Examples:

"Try to prove me wrong."
"Stress-test my BTC thesis."
"Find evidence that would invalidate this."
"What would make this thesis fail?"

CHALLENGE is distinct from ordinary research because its purpose is deliberately adversarial toward the current belief or judgment.

4. MANAGE_STATE
Represents explicit changes to the current research state.
Examples:

"Ignore sentiment for now."
"Focus on derivatives instead."
"That's the wrong timeframe."
"Remove this hypothesis."
"Stop investigating this branch."
"Go back to the previous research state."

Possible internal operations include:
change_scope
change_depth
correct
remove
interrupt
resume
restore

These operations remain internal parameters rather than separate first-class LUI actions.
Completed research and provenance must be preserved when state changes unless the trader explicitly requests otherwise.

5. MONITOR
Represents an explicit request to continue observing something after or alongside research.
Examples:

"Keep an eye on funding rates."
"Watch this thesis for invalidation."
"Tell me if something changes."
"Monitor the factors that could break this thesis."

Monitoring remains connected to its originating research context.
Activation of persistent monitoring requires explicit trader confirmation.

6. SAVE
Represents the trader's explicit intent to intentionally preserve research, knowledge, preferences, frameworks, or other eligible state as a persistent reusable artifact.
Examples:

"Save this."
"Save this as my BTC framework."
"Keep this research for later."

SAVE is distinct from MANAGE_STATE. MANAGE_STATE modifies current research/workspace state. SAVE intentionally promotes eligible state into persistent reusable memory/artifacts. Persistence of normal workspace state remains system behavior; explicit SAVE creates an intentional, versioned, provenance-carrying artifact. Saving does not activate monitors or replace frameworks; consequential persistence still requires the existing confirmation boundary.

3. What Is NOT a Universal Core Action
The following are deliberately not first-class universal LUI actions:
NAVIGATE
Workspace navigation is primarily an interface/context operation rather than a research intent.
The trader should be able to move through the research workspace without requiring a dedicated LUI action taxonomy.
REPLAN
Replanning is an internal agent behavior.
When new evidence, changed scope, or a changed intent requires a new plan, the agent can re-plan automatically while preserving completed work.
NEW_INTENT
A fundamental intent change is detected by intent interpretation rather than exposed as a separate action.
For example:

"Actually, forget the macro investigation. I want to know why BTC dumped."

The system recognizes the intent change, preserves the previous research, and creates the appropriate new research plan.
REFOCUS, EXPAND, NARROW, DEEPEN, etc.
These are variations of RESEARCH or state modification rather than independent first-class actions.

4. Primary Intent vs Internal Execution
A critical LUI principle:

The primary LUI action represents what the trader wants. Internal operations represent how the agent accomplishes it.

Example:

"BTC is dumping. Find out what's going on."

Primary intent:
RESEARCH

Internal execution may involve:
investigate
→ gather evidence
→ analyze
→ generate hypotheses
→ cross-check
→ synthesize
→ produce judgment

The presence of internal ANALYZE operations does not change the primary LUI action.

5. Universal Core + Flow-Specific Extensions
The universal action remains the primary intent, while the active research flow determines specialized behavior.
Conceptually:
Natural Language
```text
       ↓
Intent Interpretation
       ↓
Universal Core Action
       ↓
Active Research Flow
       ↓
Flow-Specific Extension
       ↓
Parameters / Targets / Constraints
       ↓
```
Research State

The same universal action can therefore behave differently depending on the active flow.

Example 1; Historical Research
User:

"Find historical cases where this pattern failed."

Primary action:
RESEARCH

Active flow:
HAS_THIS_HAPPENED_BEFORE

Flow-specific extension:
historical_counterexamples


Example 2; Thesis Falsification
User:

"Try to prove my BTC thesis wrong using derivatives."

Primary action:
CHALLENGE

Active flow:
DOES_MY_THESIS_HOLD

or:
WHAT_COULD_PROVE_ME_WRONG

Flow-specific extension:
derivatives_falsification


Example 3; Framework Evaluation
User:

"Evaluate this using my BTC framework, but make macro twice as important."

Primary intent is determined from the actual request and context, while the active flow is:
EVALUATE_ACCORDING_TO_MY_FRAMEWORK

Flow-specific extension:
framework_weight_override

The framework itself must not be silently changed. If the weighting change is intended to persist beyond the current evaluation, the system follows the existing confirmation boundary.

6. Design Principles Locked In
1. Small Universal Core
The LUI should have a small number of reliable first-class intents rather than dozens of specialized commands.
2. Natural Language Remains the Interface
Traders do not need to learn a command language.
Different natural-language expressions can map to the same internal action.
3. Internal Structure, External Flexibility
The system uses a structured internal taxonomy for reliable execution, while the trader interacts entirely through natural language.
4. Flow-Specific Intelligence
The six universal actions do not force every research task into the same workflow.
Each of the eight research flows can introduce specialized behavior beneath the universal action.
5. Internal Operations Stay Internal
Planning, replanning, tool selection, hypothesis generation, evidence gathering, synthesis, and other execution steps do not automatically become LUI actions.
6. Intent Takes Priority
When multiple internal operations are required, the system preserves the trader's original intent as the primary LUI action.
7. Context Determines Behavior
The same action can behave differently depending on the active research flow, research state, target, and context.
8. Trader Remains in Control
The agent performs research and manages its internal process, but consequential persistent actions such as activating monitoring or permanently changing a framework require the appropriate confirmation boundary.

7. Final Locked Model
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
             ┌───────────────────┐
             │  UNIVERSAL CORE   │
             ├───────────────────┤
             │ RESEARCH          │
             │ ANALYZE           │
             │ CHALLENGE         │
             │ MANAGE_STATE      │
             │ MONITOR           │
             │ SAVE              │
             └───────────────────┘
                       │
                       ▼
             ACTIVE RESEARCH FLOW
                       │
                       ▼
          FLOW-SPECIFIC EXTENSION
                       │
                       ▼
          PARAMETERS / TARGETS /
             CONSTRAINTS
                       │
                       ▼
               RESEARCH STATE
                       │
                       ▼
```
             AGENT EXECUTION

Locked decision (amended 2026-09-12, final architecture lock): The LUI uses a six-action Universal Core + Flow-Specific Extensions architecture; RESEARCH, ANALYZE, CHALLENGE, MANAGE_STATE, MONITOR, SAVE; with universal actions representing primary trader intent and specialized flow behavior represented through extensions and parameters.
