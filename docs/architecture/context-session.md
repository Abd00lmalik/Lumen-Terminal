---
title: "RESEARCH CONTEXT & SESSION INTELLIGENCE"
source: RESEARCH CONTEXT & SESSION INTELLIG.txt
converted: 2026-09-12
type: architecture-spec
related: [memory.md, workspace-presentation.md, lui-interaction-model.md]
---

**Related documents:** `memory.md` · `workspace-presentation.md` · `lui-interaction-model.md`

> Converted from `RESEARCH CONTEXT & SESSION INTELLIG.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

RESEARCH CONTEXT & SESSION INTELLIGENCE

## 1. Purpose

Research Context & Session Intelligence determines what the trader's current request refers to, what research state is active, which objects are relevant, and which historical context should be brought into the current interaction.

It is the contextual layer connecting:

USER LANGUAGE
→ CURRENT CONVERSATION
→ ACTIVE WORKSPACE
→ ACTIVE RESEARCH
→ OBJECT GRAPH
→ MEMORY
→ HISTORICAL RESEARCH

Its purpose is to allow natural interaction without requiring the trader to repeatedly restate context.

The system should understand requests such as:

```text
"Go deeper."

"Challenge that."

"Look at the last month instead."

"Use the previous research."

"What about the other explanation?"

"Ignore macro for now."

"Compare this with what we found yesterday."

"Does my thesis still hold?"
```

without turning every interaction into a clarification request.

However, contextual inference must stop when multiple interpretations would materially change the research.

---

# 2. Core Principle

The system should use the most relevant available context while preserving explicit user intent as the highest-priority instruction.

The contextual hierarchy is:

```text
EXPLICIT CURRENT REQUEST
```text
        ↓
ACTIVE USER OVERRIDE
        ↓
ACTIVE RESEARCH STATE
        ↓
ACTIVE OBJECTS
        ↓
CURRENT CONVERSATION CONTEXT
        ↓
RELEVANT MEMORY
        ↓
```
HISTORICAL CONTEXT
```

More distant context must never silently override more recent explicit instructions.

---

# 3. Context Model

```text id="f8k4xz"
CONTEXT {
  current_request
  conversation_context
  active_workspace
  active_research
  active_branch
  active_claims[]
  active_hypotheses[]
  active_analysis[]
  current_judgment
  active_thesis[]
  active_framework[]
  active_monitors[]
  relevant_memory[]
  historical_research[]
  user_preferences
  active_constraints
  current_scope
  current_depth
  current_target
  current_time
  context_confidence
  ambiguity_state
  provenance
}
```

---

# 4. Context Types

The system distinguishes:

```text id="y6x1rb"
CURRENT_REQUEST
CURRENT_RESEARCH
CURRENT_OBJECT
CONVERSATION_CONTEXT
ACTIVE_WORKSPACE
MEMORY
HISTORICAL_RESEARCH
PREFERENCE
```

These categories must not be silently mixed.

---

# 5. Current Request

The current user message has highest contextual priority.

The system should extract:

* intended action
* target
* entities
* timeframe
* scope
* constraints
* depth
* requested output
* explicit modifications
* references to previous state

Examples:

```text
"Go deeper on the macro explanation."

Action:
RESEARCH / ANALYZE

Target:
macro explanation

Scope:
existing active research

Depth:
increase
```

---

# 6. Explicit Overrides

An explicit user instruction overrides inferred context.

Example:

Previous:

```text
BTC research
```

User:

```text
"Actually, forget BTC. Research ETH instead."
```

The active target becomes ETH.

The previous BTC research remains historical context unless explicitly discarded.

---

# 7. Active Workspace

The workspace represents the current research environment.

It may contain:

```text id="7n8m1p"
ACTIVE RESEARCH
ACTIVE BRANCHES
CURRENT JUDGMENT
ACTIVE THESIS
ACTIVE FRAMEWORK
ACTIVE MONITORS
RECENT OBJECTS
ACTIVE CONSTRAINTS
```

Context resolution should prioritize objects currently marked active.

---

# 8. Active Research

The active research object is the default target for ambiguous follow-up requests when there is only one materially plausible research context.

Examples:

```text
"Go deeper."
"Why?"
"Challenge that."
"Show me the evidence."
```

If one active research exists, the system may resolve the request against it.

If multiple active research objects exist and the distinction matters, clarification is required.

---

# 9. Active Branch

If the conversation is explicitly operating inside a branch, the branch becomes the default context.

Example:

```text
Research:
Why did BTC fall?

Branch:
Liquidation hypothesis
```

User:

```text
"Go deeper."
```

The system should normally deepen the liquidation branch rather than restarting the entire research.

---

# 10. Active Hypothesis

When a hypothesis is being discussed directly, it becomes the contextual target for references such as:

```text
"Challenge that."

"What evidence supports it?"

"Can we disprove this?"

"What else could explain it?"
```

The system should preserve the distinction between:

* hypothesis
* claim
* judgment
* thesis

---

# 11. Active Judgment

The current judgment is the default referent for:

```text
"Is that still true?"
"How confident are we?"
"What changed?"
"Why did the conclusion change?"
```

The system should retrieve the judgment's supporting and opposing evidence when deeper explanation is requested.

---

# 12. Active Thesis

If a thesis is explicitly active, phrases such as:

```text
"My thesis"
"Does it still hold?"
"Challenge this"
"What would invalidate it?"
```

should resolve to the active thesis.

The system must not confuse the thesis with the latest research judgment.

---

# 13. Active Framework

When a framework is active, requests such as:

```text
"Evaluate it again."
"Apply my framework."
"Which factor failed?"
"Check the weighting."
```

should resolve to the framework and its relevant evaluation.

The exact framework version used must be preserved.

---

# 14. Context Resolution Order

For a reference such as:

```text
"that"
"it"
"this"
"the explanation"
"the thesis"
"the result"
"the other one"
```

the system should resolve using:

```text id="h1b5wq"
EXPLICIT TARGET
```text
        ↓
IMMEDIATELY ACTIVE OBJECT
        ↓
CURRENT RESEARCH OBJECT
        ↓
CURRENT BRANCH
        ↓
CURRENT JUDGMENT / HYPOTHESIS / THESIS
        ↓
RECENT CONVERSATION OBJECT
        ↓
RELEVANT MEMORY
        ↓
```
CLARIFY
```

---

# 15. Ambiguity

Contextual inference should stop when multiple interpretations are materially plausible.

Example:

```text
Active Research A:
Why did BTC fall?

Active Research B:
Why did ETH rise?

User:
"Challenge that."
```

The system should ask which research or hypothesis is intended.

It should not simply select the most recent object if another interpretation remains plausible.

---

# 16. Ambiguity Threshold

Clarification is required when choosing the wrong context could materially change:

* target
* research objective
* thesis
* scope
* evidence
* framework
* persistent state
* monitoring
* saved artifact
* consequential action

Minor ambiguity may be resolved automatically.

---

# 17. Conversation Context

Conversation context contains recent interaction state.

It may include:

* recently mentioned entities
* recently discussed hypotheses
* recent conclusions
* recent user corrections
* recent tool results
* recent scope changes
* recent research instructions

Conversation context is temporary.

It should not automatically become persistent memory.

---

# 18. Context Window Management

The system should prioritize context by relevance rather than simply including the largest possible conversation history.

Priority should consider:

```text
RECENCY
```text
+
SEMANTIC RELEVANCE
+
OBJECT RELATIONSHIP
+
ACTIVE STATE
+
USER EMPHASIS
+
```
MATERIALITY
```

Irrelevant conversation history should not consume research context.

---

# 19. Context Compression

Long research sessions may require compressed context.

Compression should preserve:

* current objective
* active scope
* current judgment
* major hypotheses
* unresolved questions
* critical evidence
* active constraints
* thesis
* framework
* important user decisions
* research state
* provenance references

Compression must not erase important historical distinctions.

---

# 20. Context Restoration

When restoring previous research, the system should reconstruct:

```text id="7r4b8m"
RESEARCH STATE
```text
+
ACTIVE BRANCHES
+
CURRENT JUDGMENT
+
HYPOTHESES
+
CLAIMS
+
EVIDENCE REFERENCES
+
THESIS CONTEXT
+
FRAMEWORK VERSION
+
ACTIVE CONSTRAINTS
+
```
RELEVANT MEMORY
```

Restoration does not automatically mean that historical evidence is still current.

Freshness must be evaluated.

---

# 21. Freshness During Restoration

The system should determine whether:

* sources changed
* market conditions changed
* research assumptions changed
* thesis changed
* framework changed
* relevant events occurred
* monitored conditions changed

Historical research remains available.

Fresh research is initiated when required.

---

# 22. Context vs Memory

Context is temporary and session-oriented.

Memory is persistent and reusable.

Example:

```text
Conversation:
"We are focusing on BTC today."

→ CONTEXT
```

versus:

```text
"User prefers primary sources for thesis evaluation."

→ PREFERENCE MEMORY
```

The system must not promote temporary context into persistent memory automatically unless the memory rules permit it.

---

# 23. Context vs Current Evidence

Historical memory must never silently become current evidence.

For example:

```text
Yesterday's BTC research
```

may inform:

```text
"Previously, we found..."
```

but should not automatically become:

```text
"Current evidence shows..."
```

without revalidation.

---

# 24. Memory Retrieval

Relevant memory may be retrieved when:

* the user references previous research
* an active thesis has historical context
* a framework applies
* a previous decision matters
* prior research can reduce redundant work
* historical precedent is relevant

Memory retrieval must be context-aware.

---

# 25. Contextual Memory Labels

Retrieved memory should be internally classified as:

```text
CURRENT
HISTORICAL
PRIOR_JUDGMENT
PRIOR_HYPOTHESIS
PREFERENCE
FRAMEWORK
HISTORICAL_KNOWLEDGE
```

The UI may expose the distinction when it materially affects the conclusion.

---

# 26. Contextual Scope

Context includes the current research scope:

```text id="b2m6xq"
TARGET
ENTITIES
TIMEFRAME
DOMAINS
EXCLUSIONS
CONSTRAINTS
DEPTH
```

User commands may modify these values.

Example:

```text
"Only look at the last 30 days."

→ update timeframe
→ preserve previous research
→ re-evaluate affected evidence
```

---

# 27. Contextual Depth

Depth instructions should persist for the active research when appropriate.

Examples:

```text
"Go deeper."

→ increase depth

"Give me a quick answer."

→ reduce active analytical depth

"Do an exhaustive comparison."

→ increase maximum depth
```

Hard depth constraints remain binding.

---

# 28. Contextual Domain State

The system should remember active domain selections within the research.

Example:

```text
Included:
NEWS
MACRO
MARKET

Excluded:
SENTIMENT
```

A later command:

```text
"Add sentiment."
```

updates the active scope.

---

# 29. Contextual Constraints

Context should maintain:

* hard constraints
* soft preferences
* source constraints
* timeframe constraints
* domain exclusions
* depth constraints
* research budget
* trader overrides

These should remain attached to the relevant research object.

---

# 30. Contextual Branching

When the trader introduces a materially different question, the system determines whether it is:

```text
CONTINUATION
MODIFICATION
BRANCH
NEW RESEARCH
```

Example:

```text
"Could another explanation be responsible?"
```

Likely:

```text
BRANCH
```

while:

```text
"Actually focus only on macro."
```

is likely:

```text
SCOPE MODIFICATION
```

---

# 31. New Research Detection

A new research object should be created when:

* the objective fundamentally changes
* the target changes materially
* the original research is no longer relevant
* the user explicitly requests a separate investigation
* the new question cannot coherently belong to the current research

The previous research remains preserved.

---

# 32. Research Continuation

A request continues the current research when:

* target remains the same
* objective remains compatible
* scope change is incremental
* the user refers to existing hypotheses/evidence
* new work extends rather than replaces the existing investigation

---

# 33. Contextual Branch Detection

A branch is appropriate when:

* an alternative hypothesis is introduced
* a different explanation needs independent investigation
* one domain requires separate investigation
* falsification requires a separate path
* historical comparison requires an independent path
* source validation needs separation

---

# 34. Contextual State Changes

When the user says:

```text
"Ignore that branch."
"Focus on this one."
"Pause the macro research."
"Use the other hypothesis."
```

the system should map the instruction to MANAGE_STATE.

Context Intelligence identifies the target.

MANAGE_STATE performs the actual state change.

---

# 35. Contextual Action Resolution

Context Intelligence does not execute actions itself.

It resolves:

```text USER REQUEST
→ CONTEXT
→ TARGET
→ ACTION
```

Example:

```text
"Challenge that."

Context:
active research
active hypothesis

Action:
CHALLENGE

Target:
active hypothesis
```

---

# 36. Multi-Action Requests

A single request may contain several actions.

Example:

```text
"Challenge the thesis and then compare it with the previous version."
```

Resolution:

```text
CHALLENGE
→ thesis

ANALYZE
→ compare thesis versions
```

The system should preserve action dependencies.

---

# 37. Contextual User Corrections

If the user corrects an earlier interpretation:

```text
"No, I meant ETH, not BTC."
```

the system should:

1. apply the correction
2. identify affected research state
3. preserve the previous interpretation
4. determine which work remains reusable
5. replan affected research
6. avoid silently deleting the previous work

---

# 38. Contextual Time References

The system should resolve expressions such as:

```text
today
yesterday
this week
last month
recently
since the announcement
before the Fed decision
```

using:

* current time
* research timeframe
* event timestamps
* user-provided dates

Ambiguous time references that materially change research should be clarified.

---

# 39. Contextual Entity Resolution

Entities may be referred to by:

* name
* ticker
* abbreviation
* pronoun
* nickname
* protocol reference
* previously resolved entity

The system should preserve the resolved entity identity.

If multiple entities match, clarification is required when the distinction matters.

---

# 40. Contextual Target Resolution

Target resolution should produce:

```text id="1p4x8z"
TARGET {
  requested
  resolved
  entity_refs[]
  event_refs[]
  research_ref
  branch_ref
  object_refs[]
  timeframe
  resolution_source
  confidence
}
```

---

# 41. Context Confidence

Every inferred contextual resolution should have internal confidence.

Possible states:

```text
HIGH
MODERATE
LOW
AMBIGUOUS
```

Low-confidence but non-consequential resolutions may proceed cautiously.

Material low-confidence resolutions should trigger clarification.

---

# 42. Contextual Override

Explicit user instructions override inferred context.

Example:

```text
Active thesis:
BTC remains bullish.

User:
"Forget my thesis for this analysis. Analyze the market neutrally."
```

The system should switch analytical orientation to neutral for that analysis without deleting the thesis.

---

# 43. Contextual Isolation

Some actions should operate independently of the active research.

Examples:

```text
"Show my saved frameworks."
"Open yesterday's research."
"Create a new framework."
```

These should not accidentally modify the current research.

---

# 44. Persistent Action Boundary

Context resolution must recognize when an action becomes persistent or consequential.

Examples:

```text
"Save this."
"Replace my framework."
"Activate this monitor."
"Remember that I prefer..."
```

These route through SAVE, MANAGE_STATE, MONITOR, or memory mechanisms with the appropriate confirmation rules.

---

# 45. Contextual Workspace Switching

The trader may move between workspaces or research sessions.

Examples:

```text
"Open my BTC research from yesterday."

"Switch back to the ETH research."

"Continue the research we did last week."
```

The system should:

1. identify candidate research
2. resolve the intended session
3. restore the required context
4. validate freshness
5. establish the selected research as active

---

# 46. Multiple Active Research Objects

Multiple research objects may coexist.

Only the contextually relevant one should become the active target for an ambiguous request.

If multiple are equally plausible:

```text
CLARIFY
```

The system must not merge them automatically.

---

# 47. Contextual Research History

Recent research history may include:

```text
CURRENT
RECENT
HISTORICAL
ARCHIVED
SUPERSEDED
STALE
INVALID
```

Historical research can be retrieved but must preserve its state.

---

# 48. Contextual Graph Traversal

The system may traverse object relationships to resolve context.

For example:

```text
USER:
"Why does that matter?"

ACTIVE JUDGMENT
→ based_on
ANALYSIS
→ derived_from
HYPOTHESIS
→ supported_by
CLAIM
→ supported_by
EVIDENCE
```

The system may retrieve the relevant chain to answer the request.

Graph traversal should be relevance-limited rather than retrieving the entire object graph.

---

# 49. Contextual Relevance

Context relevance should consider:

```text
DIRECT REFERENCE
```text
+
OBJECT RELATIONSHIP
+
RECENCY
+
ACTIVE STATUS
+
SEMANTIC SIMILARITY
+
```
MATERIALITY
```

A highly related historical object may outrank an unrelated recent conversation message.

---

# 50. Context Compression and Rehydration

Long sessions may compress inactive context.

Compressed context should retain references to the underlying objects.

When required, the system rehydrates the relevant objects from persistent state.

This allows long-running research without requiring the entire workspace to remain in active model context.

---

# 51. Contextual Consistency

Before executing a context-dependent request, the system should verify:

```text TARGET CONSISTENT?
SCOPE CONSISTENT?
TIMEFRAME CONSISTENT?
OBJECT STATUS VALID?
THESIS VERSION CORRECT?
FRAMEWORK VERSION CORRECT?
EVIDENCE FRESH ENOUGH?
CONSTRAINTS ACTIVE?
```

Material inconsistencies should trigger revalidation.

---

# 52. Contextual State Snapshot

The system may maintain a current contextual snapshot:

```text id="7k2x8n"
CONTEXT_SNAPSHOT {
  active_workspace
  active_research
  active_branch
  active_objects[]
  current_judgment
  active_thesis[]
  active_framework[]
  active_constraints
  active_scope
  active_depth
  active_monitors[]
  timestamp
}
```

Snapshots support:

* restoration
* debugging
* session continuity
* undo
* state comparison through history

---

# 53. Contextual Provenance

Context decisions should preserve why a target was resolved.

Example:

```text
TARGET:
BTC thesis

RESOLUTION:
active thesis associated with current research

SOURCE:
active workspace context

CONFIDENCE:
HIGH
```

This is particularly important for ambiguous pronouns and follow-up requests.

---

# 54. Failure Handling

Context resolution can fail because:

* multiple active targets exist
* referenced object was deleted
* referenced research is unavailable
* memory is insufficient
* target identity is ambiguous
* framework version is unclear
* conversation context is contradictory

The system should:

```text
PRESERVE CURRENT STATE
→ IDENTIFY AMBIGUITY
→ REQUEST MINIMAL CLARIFICATION
```

It must not invent context.

---

# 55. Interaction With Memory

Context Intelligence requests relevant memory.

Memory Intelligence determines what historical information is appropriate to retrieve.

Context Intelligence then decides whether that memory is relevant to the current request.

Memory should not independently override active context.

---

# 56. Interaction With LUI

LUI converts natural language into candidate intent.

Context Intelligence resolves the referents.

Example:

```text
USER:
"Challenge that."

LUI:
CHALLENGE

CONTEXT:
"that" = active leading hypothesis

RESULT:
CHALLENGE(target = hypothesis)
```

---

# 57. Interaction With MANAGE_STATE

Context Intelligence identifies state references.

MANAGE_STATE performs state changes.

Example:

```text
USER:
"Pause the other branch."

Context:
two branches

Resolution:
branch B

Action:
MANAGE_STATE(PAUSE, branch B)
```

---

# 58. Interaction With Research

Context Intelligence determines whether the request:

* continues research
* modifies research
* branches research
* creates new research
* restores research

Research Execution Engine performs the actual investigation.

---

# 59. Interaction With Thesis

Context Intelligence identifies which thesis is referenced.

It does not modify the thesis.

Thesis Intelligence evaluates and manages thesis state.

---

# 60. Interaction With Framework

Context Intelligence resolves which framework/version is intended.

Framework Intelligence applies the framework.

Historical framework versions must remain distinct.

---

# 61. Interaction With Monitor

Context Intelligence resolves monitoring references.

Example:

```text
"Pause that monitor."

→ resolve monitor
→ MANAGE_STATE / MONITOR
```

Consequential monitor actions follow MONITOR confirmation rules.

---

# 62. Interaction With Save

Context Intelligence resolves:

```text
"Save this."
```

to the most likely active object.

Examples:

```text
active framework
→ save framework

current research
→ save research artifact

current workspace
→ save snapshot
```

Clarification is required only when the target is materially ambiguous.

---

# 63. Context Completion

Context resolution is complete when:

* action is identified
* target is resolved
* active research is identified when relevant
* scope is understood
* timeframe is resolved
* constraints are known
* relevant memory is retrieved where necessary
* ambiguity is below the clarification threshold
* provenance of contextual resolution is preserved

---

# 64. Global Context Loop

```text
USER REQUEST
```text
        ↓
PARSE EXPLICIT INTENT
        ↓
IDENTIFY REFERENCES
        ↓
CHECK ACTIVE WORKSPACE
        ↓
CHECK ACTIVE RESEARCH
        ↓
CHECK ACTIVE OBJECTS
        ↓
CHECK CONVERSATION CONTEXT
        ↓
CHECK RELEVANT MEMORY
        ↓
RESOLVE TARGET / SCOPE / TIMEFRAME
        ↓
ASSESS AMBIGUITY
        ↓
CLARIFY IF MATERIAL
        ↓
PRODUCE CONTEXTUALIZED ACTION
        ↓
EXECUTE THROUGH APPROPRIATE ENGINE
        ↓
UPDATE ACTIVE CONTEXT
        ↓
```
PRESERVE HISTORY
```

# Global Principle

Research Context & Session Intelligence should answer:

> “What exactly is the trader referring to right now, what existing research state does that request belong to, and what context is relevant without silently carrying forward outdated or ambiguous information?”

The system should minimize unnecessary clarification while refusing to guess when ambiguity could materially change the research.

**Current request takes priority.
Active state provides continuity.
Memory provides historical context.
Explicit overrides control scope.
Ambiguity triggers clarification.
Historical information never silently becomes current evidence.**

```
```
