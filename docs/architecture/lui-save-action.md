---
title: "SAVE"
source: # SAVE.txt
converted: 2026-09-12
type: architecture-spec
related: [lui-universal-core.md, memory.md]
---

**Related documents:** `lui-universal-core.md` · `memory.md`

> Converted from `# SAVE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

# SAVE

## Definition

`SAVE` is the universal LUI action for intentionally preserving a workspace object, research result, reusable artifact, preference, framework, snapshot, or other trader-selected state for future use.

Normal workspace state and history are persisted automatically by the system.

Explicit `SAVE` exists when the trader intentionally wants something preserved as a reusable or named artifact.

The trader remains the final authority over consequential persistent changes.

---

# 1. Core Principles

1. Normal workspace state and history persist automatically.
2. Explicit `SAVE` allows the trader to intentionally preserve reusable knowledge or state.
3. Any workspace object can be explicitly saved.
4. Specialized save behavior exists for frameworks, snapshots, conclusions, preferences, and other reusable artifacts.
5. Natural language is the primary control surface.
6. The agent resolves the intended target and artifact type from context.
7. Minor changes can update an existing saved artifact.
8. Material changes create a new version.
9. Previous material versions remain recoverable.
10. Provenance and context are preserved.
11. Historical information remains distinguishable from current evidence.
12. Incomplete research can be saved but must remain clearly marked as incomplete.
13. Consequential persistent changes require confirmation.
14. Permanent deletion is separate from SAVE and requires explicit confirmation.
15. Saving an object does not silently change the active research state.

---

# 2. SAVE Schema

```text
SAVE {
  target {
    requested
    resolved
    object_type
    object_ref
    resolution_source
    confidence
  }

  artifact {
    type
    name
    description
    content
    status
  }

  destination {
    workspace
    location
    collection
    inferred
  }

  persistence {
    session_only
    persistent
    confirmation_required
  }

  versioning {
    existing_artifact
    materiality
    action
    current_version
    new_version
    previous_version_ref
  }

  provenance {
    source_refs
    research_refs
    evidence_refs
    hypothesis_refs
    judgment_refs
    thesis_refs
    framework_refs
    timestamp
    origin
  }

  context {
    current_context
    historical_context
    memory_refs
    active_research_refs
  }

  state {
    completeness
    freshness
    validity
    confidence
  }

  relationships {
    related_objects
    dependencies
    replaced_artifact
    derived_from
  }

  history {
    prior_versions
    checkpoints
    reversible
  }
}
```

---

# 3. Automatic Persistence vs Explicit SAVE

The system has two persistence layers.

## Automatic Persistence

The system automatically preserves:

* active workspace state;
* research history;
* material judgments;
* provenance;
* checkpoints;
* monitor history;
* branch history;
* state transitions.

The trader does not need to explicitly say `SAVE` for normal workspace integrity.

## Explicit SAVE

The trader uses `SAVE` when intentionally preserving something for reuse, reference, organization, or future research.

Examples:

```text
"Save this research."

"Save this conclusion."

"Save this as my BTC framework."

"Save this workspace before the FOMC."

"Save this as a reusable research template."

"Save this preference."

"Save this hypothesis."
```

---

# 4. Target Resolution

When the trader explicitly says `SAVE`, the agent resolves the target using:

```text
Explicitly named object
```text
        ↓
Current active object
        ↓
Immediate conversational context
        ↓
Relevant active research
        ↓
Relevant memory
        ↓
```
Clarification if materially ambiguous
```

The agent should not ask unnecessary clarification questions.

If one object is clearly dominant, save it.

If the request could reasonably refer to either:

* the current active object; or
* the entire workspace;

the system may infer the most likely interpretation from context.

If the distinction is consequential, clarify.

---

# 5. "Save This"

When the trader says:

```text
"Save this."
```

the agent uses contextual resolution.

Possible interpretations:

### Current Object

If the conversation is clearly focused on one research object, save that object.

### Workspace Snapshot

If the trader is clearly referring to the current workspace state, create a workspace snapshot.

### Clarification

Only ask when the difference between the two interpretations is consequential.

The system should not interrupt normal workflow unnecessarily.

---

# 6. Artifact Types

`SAVE` supports any workspace object.

Common artifact types include:

```text
research
conclusion
judgment
hypothesis
evidence_set
framework
thesis
monitor
workspace_snapshot
branch_snapshot
preference
research_template
analysis
report
annotation
```

Artifact-specific save behavior may apply.

---

# 7. Naming

The agent may infer a useful name from context.

Example:

```text
"Save this as my FOMC BTC thesis."
```

The resulting artifact may be named:

```text
BTC FOMC Thesis
```

If the trader provides a name, use that name.

The trader can rename the artifact later through `MANAGE_STATE`.

---

# 8. Destination Resolution

The agent may infer the most relevant destination based on:

* artifact type;
* active workspace;
* existing collections;
* previous organization;
* trader preferences.

Example:

```text
Save framework
→ Framework collection

Save workspace snapshot
→ Workspace snapshots

Save research conclusion
→ Research artifacts
```

If multiple destinations would materially differ, clarify.

---

# 9. Persistence

Saved artifacts may be:

```text
SESSION_ONLY
PERSISTENT
```

Normal explicit SAVE requests for reusable artifacts default toward persistent storage.

Session-only saves may be used when the trader explicitly limits the scope.

Consequential persistent saves require confirmation when appropriate.

---

# 10. Materiality Detection

When saving an artifact that already exists, the agent determines whether the new state is materially different.

Materiality considers:

* changed claims;
* changed conclusions;
* changed framework rules;
* changed conditions;
* changed dependencies;
* changed research scope;
* changed thesis;
* changed evidence;
* changed interpretation;
* changed purpose.

Minor formatting or organizational changes are generally not material.

Material analytical or structural changes are material.

The trader may explicitly override the agent's materiality decision.

---

# 11. Versioning

Version behavior is hybrid.

## Minor Change

A minor change updates the current version.

Examples:

* formatting;
* naming;
* non-substantive annotations;
* organization;
* minor metadata changes.

## Material Change

A material change creates a new version.

The previous version remains preserved.

```text
Version 1
    ↓
Material change
    ↓
Version 2

Version 1 remains recoverable.
```

---

# 12. Version History

Material versions preserve:

* content;
* timestamp;
* provenance;
* context;
* evidence;
* relevant relationships;
* reason for change.

The normal workspace should show the current version.

Previous material versions remain available through history.

The trader should not be forced to inspect every minor revision.

---

# 13. Duplicate Detection

Before creating a persistent artifact, the system checks whether an equivalent artifact already exists.

If an existing artifact is materially equivalent:

* avoid unnecessary duplication;
* update or reference the existing artifact where appropriate.

If the new artifact is materially different:

* create a new version or separate artifact depending on its identity.

The agent must preserve provenance when reusing an existing artifact.

---

# 14. Saving Research

Research can be saved at any stage.

Possible states include:

```text
DRAFT
IN_PROGRESS
COMPLETED
SUPERSEDED
ARCHIVED
```

Incomplete research can be saved.

However, incomplete research must never be presented as a completed conclusion.

Example:

```text
Save current research.
→ Save as IN_PROGRESS.
```

---

# 15. Saving Judgments

When saving a judgment, preserve:

* current judgment;
* supporting evidence;
* opposing evidence;
* uncertainty;
* confidence;
* timestamp;
* provenance;
* relevant hypotheses;
* relevant thesis;
* research context.

A saved judgment represents what was concluded at that point in time.

It must not automatically become current truth later.

---

# 16. Saving Conclusions

A saved conclusion should retain the research context necessary to understand it.

Minimum conceptual chain:

```text
Source
```text
  ↓
Evidence
  ↓
Claims
  ↓
Hypotheses
  ↓
Reasoning
  ↓
Judgment
  ↓
```
Conclusion
```

The saved conclusion should remain traceable to its underlying research.

---

# 17. Saving Historical Research

Historical research is preserved with:

* original timestamp;
* original context;
* original evidence;
* original provenance;
* original judgment;
* historical status.

Historical research must never silently become current evidence.

If reused in future research, its freshness must be evaluated.

---

# 18. Freshness

Saved information may become stale.

The system should track:

```text
CURRENT
RECENT
STALE
HISTORICAL
UNKNOWN
```

Freshness depends on:

* subject;
* time sensitivity;
* original research timeframe;
* data source;
* current market conditions;
* changes since saving.

Stale information remains useful as historical context but should not silently be treated as current evidence.

---

# 19. Saving Frameworks

Frameworks receive specialized SAVE behavior.

A saved framework must preserve its exact logical structure.

For example:

```text
Framework {
  factors
  conditions
  evidence_required
  weights
  thresholds
  evaluation_rules
}
```

The system must preserve the framework as defined.

It must not silently modify the framework while saving.

Replacing an existing persistent framework requires confirmation.

---

# 20. Framework Versioning

Material framework changes create a new version.

Example:

```text
BTC Evaluation Framework v1
        ↓
Trader changes weighting
        ↓
BTC Evaluation Framework v2
```

The previous framework remains recoverable.

This preserves the evolution of the trader's research methodology.

---

# 21. Saving Snapshots

Snapshots capture relevant workspace state.

A snapshot may include:

* active research;
* branches;
* objectives;
* scopes;
* constraints;
* hypotheses;
* judgments;
* evidence relationships;
* monitors;
* workspace organization;
* provenance;
* dependencies.

Example:

```text
"Save this workspace as pre-FOMC."
```

creates a named snapshot.

---

# 22. Snapshot Restoration

Saved snapshots are restorable through `MANAGE_STATE`.

Restoration:

* changes active state;
* preserves the state that existed before restoration;
* preserves provenance;
* does not permanently delete newer research.

A restored snapshot must be revalidated when necessary.

---

# 23. Saving Preferences

Persistent preferences affect future research behavior.

Examples:

```text
"Save that I prefer deep research by default."

"Save this as my preferred evidence standard."
```

Preference saves require explicit confirmation when they materially affect future system behavior.

The system must distinguish:

```text
research fact
personal preference
temporary instruction
persistent preference
```

These must not be conflated.

---

# 24. Saving Monitors

A monitor may be explicitly saved as a reusable monitoring configuration.

Saving a monitor preserves:

* conditions;
* signals;
* thresholds;
* context;
* thesis relationships;
* research relationships;
* alert behavior;
* provenance;
* lifecycle state.

Saving a monitor does not automatically activate it.

Activation remains a separate consequential action requiring confirmation.

---

# 25. Save Does Not Mean Activate

Saving an object must not automatically activate it.

Examples:

```text
"Save this monitor."
→ Save monitor configuration.

"Activate this monitor."
→ Separate activation action requiring confirmation.
```

Similarly:

```text
Save framework
≠ Apply framework

Save research
≠ Start monitoring

Save thesis
≠ Adopt thesis
```

---

# 26. Save Does Not Change Active State

Explicit SAVE preserves an object.

It does not automatically:

* change the active research target;
* change the active scope;
* replace the current thesis;
* activate a monitor;
* change the active framework;
* alter research priority.

Any such action must be explicitly requested or handled through the appropriate universal action.

---

# 27. Provenance

Every persistent artifact preserves its origin.

Provenance may include:

```text
source_refs
research_refs
evidence_refs
hypothesis_refs
judgment_refs
thesis_refs
framework_refs
monitor_refs
timestamp
origin
```

The system must be able to answer:

```text
Where did this come from?
What research produced it?
What evidence supported it?
When was it created?
What changed it?
```

---

# 28. Relationships

Saved artifacts retain relevant relationships.

Examples:

```text
derived_from
supports
contradicts
depends_on
tests
invalidates
extends
replaces
related_to
```

Saving must not break existing relationships.

If an artifact is versioned, relevant relationships should remain connected to the appropriate version.

---

# 29. Dependencies

Saved objects preserve dependencies.

For example:

```text
Framework
   ↓
Research evaluation
   ↓
Judgment
```

If the framework changes version, the research should retain the framework version it originally used.

This prevents historical evaluations from silently changing because the framework later changed.

---

# 30. Save Conflicts

If the trader saves something that conflicts with an existing artifact:

1. identify the conflict;
2. preserve the existing artifact;
3. determine whether the new state is a minor update or material change;
4. update or version appropriately;
5. surface material conflicts.

The system must never silently overwrite materially different knowledge.

---

# 31. Confirmation Boundary

Normal SAVE behavior should be low-friction.

Immediate execution is appropriate for:

* saving ordinary research;
* saving a hypothesis;
* saving a judgment;
* creating a snapshot;
* updating minor metadata;
* preserving normal workspace artifacts.

Confirmation is required when SAVE would create a consequential persistent change, such as:

* replacing a persistent framework;
* changing persistent preferences;
* materially replacing an existing artifact;
* activating something as part of the save;
* permanent deletion;
* another persistent change with meaningful future behavioral consequences.

---

# 32. Undo and Recovery

Saved changes remain recoverable when material.

Recovery uses:

* version history;
* snapshots;
* checkpoints;
* `MANAGE_STATE`.

Undo must preserve provenance.

Restoring an earlier version must not erase the existence of later versions.

---

# 33. Permanent Deletion

SAVE does not perform permanent deletion.

Deletion is handled by `MANAGE_STATE`.

Default deletion is reversible.

Permanent deletion requires explicit confirmation.

Permanent deletion must account for:

* dependencies;
* relationships;
* provenance;
* version history;
* downstream research references.

---

# 34. Natural-Language Control

`SAVE` is not a rigid command language.

The trader can express intent naturally.

Examples:

```text
"Keep this."

"Save this research."

"Save this as my ETH framework."

"Remember this framework."

"Save this before we change direction."

"Keep this version."

"Save the current workspace."

"Store this conclusion for later."
```

The agent maps natural language into the internal SAVE structure.

---

# 35. Execution Flow

```text
Trader request
```text
      ↓
Resolve target
      ↓
Resolve artifact type
      ↓
Resolve destination
      ↓
Determine persistence
      ↓
Detect existing artifact
      ↓
Assess materiality
      ↓
Determine version action
      ↓
Check confirmation boundary
      ↓
Save
      ↓
Preserve provenance
      ↓
Preserve history
      ↓
```
Return concise confirmation
```

---

# 36. Relationship With Other Universal Actions

`SAVE` preserves information and state.

It does not replace:

```text
RESEARCH
ANALYZE
CHALLENGE
MANAGE_STATE
MONITOR
```

Examples:

```text
"Research BTC."
→ RESEARCH

"Does this evidence support my thesis?"
→ ANALYZE

"Try to prove this thesis wrong."
→ CHALLENGE

"Save this conclusion."
→ SAVE

"Save this as my BTC framework."
→ SAVE

"Pause the BTC research."
→ MANAGE_STATE

"Watch for evidence that invalidates this thesis."
→ MONITOR
```

---

# 37. Final SAVE Principle

`SAVE` provides intentional persistence on top of the workbench's automatic state preservation.

The governing rule is:

> Normal workspace state is preserved automatically. Explicit SAVE preserves trader-selected knowledge, state, and reusable artifacts.

The agent handles:

* target resolution;
* artifact classification;
* organization;
* materiality detection;
* versioning;
* provenance;
* duplicate detection;
* freshness metadata.

The trader controls consequential persistent changes.

The system preserves history rather than silently overwriting meaningful prior states.

```
```
