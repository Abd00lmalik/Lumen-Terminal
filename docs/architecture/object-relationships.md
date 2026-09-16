---
title: "OBJECT RELATIONSHIPS / DEPENDENCY GRAPH"
source: OBJECT RELATIONSHIPS  DEPENDENCY GR.txt
converted: 2026-09-12
type: architecture-spec
related: [research-object-model.md, object-lifecycle-state-machine.md, memory.md]
---

**Related documents:** `research-object-model.md` · `object-lifecycle-state-machine.md` · `memory.md`

> Converted from `OBJECT RELATIONSHIPS  DEPENDENCY GR.txt` on 2026-09-12. Formatting only; architectural content, schemas, and decisions are unchanged.

OBJECT RELATIONSHIPS / DEPENDENCY GRAPH

PURPOSE

The Research Workbench represents research as a connected object graph rather than isolated records.

Objects may be related without being dependent.

A relationship describes how objects connect.

A dependency determines whether a change in one object may require reassessment or propagation to another.

Core rule:

RELATIONSHIP ≠ DEPENDENCY

Only materially relevant dependencies can trigger automatic propagation.

OBJECT GRAPH

Core research chain:

SOURCE
```text
  ↓
EVIDENCE
  ↓
CLAIM
  ↓
HYPOTHESIS
  ↓
ANALYSIS
  ↓
JUDGMENT
  ↓
THESIS
  ↓
MONITOR
  ↓
NEW EVIDENCE
  ↓
```
REASSESSMENT

Other relationships connect objects across this chain.

RELATIONSHIP TYPES

The system supports:

supports
contradicts
derived_from
depends_on
tests
challenges
references
supersedes
replaces
related_to
caused_by
part_of
branched_from
evaluates
monitors
informs
uses
contains
annotates
version_of
restores_from

Relationship meanings:

SUPPORTS
An object provides support for another object.

Example:
Evidence → supports → Claim

CONTRADICTS
An object provides meaningful opposition to another object.

Example:
Evidence → contradicts → Claim

DERIVED_FROM
An object was produced from another object.

Example:
Judgment → derived_from → Analysis

DEPENDS_ON
An object's validity, interpretation, or operation materially depends on another object.

Example:
Monitor → depends_on → Thesis

TESTS
An object is used to evaluate another object.

Example:
Research → tests → Thesis

CHALLENGES
An object actively attempts to weaken, falsify, or stress-test another object.

Example:
Hypothesis → challenges → Thesis

REFERENCES
An object uses another object as contextual reference without creating a material dependency.

Example:
Research A → references → Research B

SUPERSEDES
A newer object replaces the active role of an older object while preserving history.

Example:
Judgment v2 → supersedes → Judgment v1

REPLACES
A newer persistent configuration replaces an older configuration.

Example:
Framework v2 → replaces → Framework v1

RELATED_TO
Objects are meaningfully associated but neither depends on the other.

This relationship does not trigger propagation by itself.

CAUSED_BY
Represents a causal relationship established or proposed through research.

Example:
Market move → caused_by → Macro event

PART_OF
Represents structural membership.

Example:
Claim → part_of → Research

BRANCHED_FROM
Represents research execution lineage.

Example:
Branch B → branched_from → Branch A

EVALUATES
Represents framework-based evaluation.

Example:
Framework → evaluates → Thesis

MONITORS
Represents an active monitoring relationship.

Example:
Monitor → monitors → Thesis

INFORMS
Represents useful informational influence without formal dependency.

Example:
Historical Research → informs → Current Research

USES
Represents utilization without ownership.

Example:
Analysis → uses → Evidence

CONTAINS
Represents structural containment.

Example:
Research → contains → Branch

ANNOTATES
Represents an annotation attached to another object.

Example:
Annotation → annotates → Judgment

VERSION_OF
Represents version lineage.

Example:
Framework v2 → version_of → Framework v1

RESTORES_FROM
Represents restoration provenance.

Example:
Restored Research → restores_from → Archived Research

RELATIONSHIP DIRECTION

Relationships are directional.

The system stores:

source_object
relationship_type
target_object

Example:

Evidence_42
supports
Claim_17

The graph may expose the inverse relationship for navigation without storing a separate duplicate relationship.

Example:

Evidence_42 supports Claim_17

can be displayed from the Claim perspective as:

Claim_17 is supported_by Evidence_42

INVERSE RELATIONSHIPS

The system should maintain logical inverse views where useful.

Examples:

supports ↔ supported_by
contradicts ↔ contradicted_by
depends_on ↔ dependency_of
derived_from ↔ source_of
tests ↔ tested_by
challenges ↔ challenged_by
references ↔ referenced_by
supersedes ↔ superseded_by
replaces ↔ replaced_by
caused_by ↔ causes
part_of ↔ contains
branched_from ↔ source_branch_of
evaluates ↔ evaluated_by
monitors ↔ monitored_by
annotates ↔ annotated_by
version_of ↔ has_version

Inverse views are navigation representations, not necessarily separate stored relationships.

DEPENDENCY CLASSES

Dependencies should be classified into three levels.

DIRECT DEPENDENCY

The target materially depends on the source.

Example:

Monitor
depends_on
Thesis

A material thesis change can trigger monitor reassessment.

INDIRECT DEPENDENCY

The target depends on an intermediate object.

Example:

Evidence
→ Claim
→ Hypothesis
→ Judgment
→ Thesis

A change to Evidence may propagate through this chain only when the intermediate relationships make the downstream impact material.

ASSOCIATIVE RELATIONSHIP

The objects are connected but neither materially depends on the other.

Example:

Research A
related_to
Research B

This does not automatically propagate state changes.

PROPAGATION RULE

When an object changes:

1. Identify directly connected objects.
2. Determine relationship types.
3. Determine actual dependency.
4. Assess whether the change is material.
5. Propagate only where the dependency and materiality justify it.
6. Revalidate affected objects.
7. Preserve previous states.
8. Record material transitions.
9. Leave unrelated objects untouched.

The agent must not propagate merely because objects are connected.

PROPAGATION PRIORITY

Strong propagation relationships:

depends_on
tests
monitors
supports
contradicts
caused_by

Contextual/non-automatic relationships:

related_to
references
informs
uses

Lineage relationships:

supersedes
replaces
version_of
restores_from
branched_from

Structural relationships:

contains
part_of
annotates

Relationship type alone does not guarantee propagation.

Materiality and context determine whether propagation occurs.

EVIDENCE PROPAGATION

Evidence changes should normally propagate upward through the research chain only when material.

Example:

Evidence becomes INVALID

→ reassess Claims relying materially on it
→ reassess affected Hypotheses
→ reassess affected Analysis
→ reassess current Judgment
→ determine whether Thesis is materially affected
→ determine whether Monitor conditions remain valid

Evidence that is merely related to a thesis but does not materially support it should not trigger the same propagation.

CLAIM PROPAGATION

If a Claim materially changes:

→ identify dependent Hypotheses
→ reassess affected Analysis
→ reassess Judgment
→ assess Thesis impact
→ assess Monitor impact where relevant

Unrelated claims remain untouched.

HYPOTHESIS PROPAGATION

If a leading Hypothesis is weakened, rejected, or materially strengthened:

→ reassess dependent Analysis
→ reassess current Judgment
→ determine whether competing Hypotheses should be re-ranked
→ assess Thesis implications
→ assess Monitor conditions where relevant

A hypothesis change does not automatically rewrite the Thesis.

JUDGMENT PROPAGATION

A material Judgment change may affect:

→ Thesis
→ Monitor
→ downstream research interpretation

The agent determines whether the effect crosses a meaningful decision boundary.

Minor judgment changes should not cause unnecessary downstream changes.

THESIS PROPAGATION

A material Thesis change may affect:

→ Monitor conditions
→ active Challenge targets
→ relevant Research context
→ framework evaluation context

The system must not silently modify the trader's Thesis.

The trader remains responsible for adopting a revised Thesis.

FRAMEWORK PROPAGATION

A Framework change affects research that explicitly uses that framework.

The system should:

→ preserve the previous framework version
→ identify evaluations using the changed framework
→ determine which evaluations are materially affected
→ revalidate affected evaluations
→ preserve previous evaluation results
→ avoid changing unrelated research

Framework modification that changes persistent evaluation logic remains subject to the existing confirmation boundary.

MONITOR PROPAGATION

Monitor relationships are persistent dependencies.

If the monitored Thesis, Judgment, Hypothesis, or condition changes materially:

→ reassess monitor relevance
→ adapt conditions when clearly warranted
→ preserve previous monitor state/configuration
→ notify the trader when the change is material
→ require confirmation for consequential persistent changes

This follows the MONITOR architecture.

CIRCULAR DEPENDENCIES

The graph must permit legitimate analytical cycles but must prevent uncontrolled propagation loops.

Example:

Research
→ produces Evidence
→ changes Judgment
→ affects Thesis
→ changes Monitor
→ produces New Evidence

This is a legitimate research feedback loop.

However, the same state change must not repeatedly trigger itself indefinitely.

The system therefore tracks:

propagation_event_id
origin_object
affected_objects
propagation_path
material_change
timestamp

If a propagation event reaches an object already processed for the same material change, the system stops that propagation path.

New independent evidence can create a new propagation event.

CROSS-RESEARCH RELATIONSHIPS

Objects may reference objects belonging to another Research object.

Examples:

Research A → references → Research B

Research A → uses → Evidence from Research B

Research A → derived_from → Historical Research B

Cross-research references are allowed.

However, cross-research relationships do not automatically create dependency.

A formal dependency must be established when the target genuinely relies on the source.

REUSABLE EVIDENCE

Evidence can be reused across multiple Research objects.

Example:

Evidence E1
→ supports Claim C1 in Research A
→ supports Claim C9 in Research B

The Evidence object remains independent.

Changing its validity may therefore affect multiple research objects.

Propagation must evaluate each affected research context independently.

HISTORICAL RELATIONSHIPS

Historical objects and relationships remain available for provenance.

Historical relationships do not automatically become current dependencies.

Example:

Historical Judgment
→ supported_by
Historical Evidence

does not mean that the historical evidence is current evidence.

Current use requires appropriate freshness/revalidation rules.

RELATIONSHIP STRENGTH

Relationships may carry a strength or confidence annotation where meaningful.

Examples:

relationship_strength
relationship_confidence
evidence_basis
established_by
created_at
updated_at

Strength is especially useful for:

supports
contradicts
caused_by
depends_on
challenges

The relationship itself should not be treated as evidence.

The evidence supporting the relationship must remain traceable.

RELATIONSHIP PROVENANCE

Material relationships should preserve:

source_object
target_object
relationship_type
created_by
created_at
basis
supporting_evidence
confidence
provenance
history

The system should be able to answer:

"Why does this dependency exist?"

and trace the answer back to evidence or explicit trader configuration.

AGENT-CREATED RELATIONSHIPS

The agent may infer and create relationships when the relationship is clear from research.

Examples:

Evidence supports Claim.

Claim tests Hypothesis.

Hypothesis contributes to Judgment.

The agent should record the basis and confidence.

TRADER-CREATED RELATIONSHIPS

The trader may explicitly create relationships through natural language.

Examples:

"Treat this research as relevant to my thesis."

"Use this evidence in the framework evaluation."

"Make this monitor depend on this thesis."

Explicit trader relationships should be respected unless they violate system integrity.

AMBIGUOUS RELATIONSHIPS

If multiple materially different relationship interpretations are possible, the agent should clarify rather than silently choosing one.

Example:

"Connect this research to my thesis."

If "reference", "test", and "support" would produce materially different behavior, clarification is required.

If the intended relationship is obvious from context, the agent may infer it.

RELATIONSHIP REMOVAL

Relationships can be removed through MANAGE_STATE.

Removing a relationship does not delete either connected object.

The agent should assess downstream effects.

Example:

Removing:

Monitor → depends_on → Thesis

should cause the monitor dependency to be reassessed.

The monitor itself is not deleted.

RELATIONSHIP MODIFICATION

A relationship may be changed when its meaning or strength changes.

Material relationship changes should:

→ preserve prior relationship history
→ reassess affected dependencies
→ propagate if warranted
→ preserve provenance

AUTOMATIC RELATIONSHIP DISCOVERY

The agent may infer relationships during research.

Examples:

- Evidence supporting a claim
- Claims belonging to a research object
- Hypotheses explaining claims
- Analysis derived from evidence
- Judgment derived from analysis
- Monitor linked to thesis

Automatically inferred relationships must have confidence/provenance.

The agent must not invent strong dependencies from weak contextual similarity.

RELATIONSHIP INTEGRITY

The system must prevent invalid graph structures.

Examples:

- An object cannot depend on itself.
- A deleted object cannot remain an active dependency without a valid replacement/reference.
- A permanently deleted source must not leave an unresolved active provenance dependency.
- Version lineage must remain acyclic.
- Branch lineage must preserve origin.
- Supersession must preserve the superseded object's history.
- Restoration must preserve the original object's provenance.

DEPENDENCY VS OWNERSHIP

Dependency does not imply ownership.

Example:

Research owns its active investigation state.

Evidence may be reused by multiple Research objects.

Therefore:

Research A → uses → Evidence E1

does not make Research A the owner of Evidence E1.

Ownership remains defined by the Research Object Model.

DEPENDENCY VS CONTAINMENT

Containment is structural.

Dependency is functional or semantic.

Example:

Research contains Branch.

This does not mean every state change in Research automatically changes every Branch.

Propagation depends on the specific relationship and material consequence.

RELATIONSHIP GRAPH AND LUI

Natural language should control relationships.

Examples:

"Connect this evidence to the claim."

"Use this research as context for my thesis."

"Stop treating this evidence as supporting the claim."

"Make this monitor depend on the thesis."

"Show me everything this judgment depends on."

The LUI maps these requests to structured relationship operations internally.

The user does not need to know the underlying relationship taxonomy.

GRAPH NAVIGATION

The system should support progressive disclosure.

Default:

Show only relationships relevant to the current judgment or requested task.

On demand:

"Show me why."

"Show me what this depends on."

"Show me what will be affected if this changes."

"Show me the evidence behind this relationship."

The system should expose the relevant graph path rather than dumping the entire object graph.

GLOBAL RULE

The object graph exists to preserve traceability, reasoning structure, dependency awareness, and controlled propagation.

It must not become a graph for its own sake.

The agent should maintain only relationships that materially improve research, provenance, state management, or trader understanding.
