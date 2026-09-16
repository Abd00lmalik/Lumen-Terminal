---
title: "OBJECT LIFECYCLE / STATE MACHINE"
source: OBJECT LIFECYCLE  STATE MACHINE.txt
converted: 2026-09-12
type: architecture-spec
related: [research-object-model.md, object-relationships.md, lui-manage-state-action.md]
---

**Related documents:** `research-object-model.md` · `object-relationships.md` · `lui-manage-state-action.md`

> Converted from `OBJECT LIFECYCLE  STATE MACHINE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

OBJECT LIFECYCLE / STATE MACHINE

PURPOSE

The Research Workbench uses object-specific lifecycle state machines rather than forcing every object through the same sequence.

A universal state vocabulary exists for consistency, but each object uses only the states appropriate to its role.

Core principle:

Current state can change, but historical state remains available unless the trader explicitly chooses permanent deletion.

UNIVERSAL LIFECYCLE STATES

DRAFT
ACTIVE
PAUSED
COMPLETED
SUPERSEDED
STALE
INVALID
STOPPED
ARCHIVED

These states are not a universal linear sequence.

Object-specific lifecycle rules determine which states and transitions are valid.

Definitions:

DRAFT = object exists but is not yet actively executing or established.

ACTIVE = object is currently valid and/or actively participating in the research process.

PAUSED = temporarily inactive while remaining valid and resumable.

COMPLETED = the object's assigned objective has been reached or useful work has been exhausted.

SUPERSEDED = replaced by a newer state, judgment, version, or conclusion while remaining historically available.

STALE = may still be historically valid but is no longer sufficiently fresh for current use.

INVALID = should no longer be relied upon under the object's governing conditions.

STOPPED = intentionally ended rather than merely paused.

ARCHIVED = retained as historical state but removed from active workspace.

ARCHIVED does not mean deleted.

STALE does not mean INVALID.

SUPERSEDED does not mean destroyed.

DELETION

Deletion is a state-management operation rather than a normal lifecycle state.

Normal deletion is reversible.

Permanent deletion requires explicit trader confirmation.

Deleting an object must not silently delete dependent objects.

Dependency consequences must be assessed separately.

RESEARCH LIFECYCLE

Primary lifecycle:

DRAFT → ACTIVE → COMPLETED → ARCHIVED

Additional valid transitions:

ACTIVE → PAUSED → ACTIVE

ACTIVE → STOPPED → ARCHIVED

ACTIVE → STALE

ACTIVE → INVALID

ACTIVE → SUPERSEDED

COMPLETED → SUPERSEDED

COMPLETED → STALE

COMPLETED → ARCHIVED

ARCHIVED → restoration process

STALE → ACTIVE after freshness validation

INVALID → ACTIVE only when validity is re-established

Research is the primary intellectual investigation object.

Completion does not make research immutable.

New evidence may make completed research stale, superseded, invalid, or worth reopening.

Previous research conclusions remain preserved in history.

BRANCH LIFECYCLE

Branches are execution units rather than complete intellectual objects.

Simpler lifecycle:

DRAFT → ACTIVE → COMPLETED

Execution controls:

ACTIVE → PAUSED → ACTIVE

ACTIVE → CANCELLED

COMPLETED → ARCHIVED

CANCELLED → ARCHIVED

Branches do not use STALE, INVALID, or SUPERSEDED as primary lifecycle states.

Those conditions normally apply to objects contained within the branch.

EVIDENCE LIFECYCLE

Evidence uses evidentiary status directly:

ACTIVE
VERIFIED
CONTESTED
STALE
INVALID
ARCHIVED

Typical transitions:

ACTIVE → VERIFIED
ACTIVE → CONTESTED
ACTIVE → STALE
ACTIVE → INVALID

STALE → ACTIVE after revalidation

CONTESTED → VERIFIED after conflict resolution

CONTESTED → INVALID if disproven

INVALID → ACTIVE only if validity is re-established

Any state → ARCHIVED

ARCHIVED → restoration and full revalidation

Definitions:

VERIFIED means the evidence has sufficient provenance/reliability for the relevant research context.

VERIFIED does not mean the claim supported by the evidence is true.

CONTESTED means meaningful conflict exists around the evidence's reliability, interpretation, provenance, or relationship to other evidence.

STALE means the evidence may remain historically valid but is no longer sufficiently current.

INVALID means the evidence should no longer be relied upon.

CLAIM LIFECYCLE

Claims use a deliberately simple lifecycle:

UNTESTED → ACTIVE → RESOLVED

Additional transitions:

ACTIVE → ARCHIVED

RESOLVED → ARCHIVED

ARCHIVED → restoration and revalidation

Support, contradiction, and evidentiary strength are properties of the claim rather than lifecycle states.

Example:

status: ACTIVE
support: strong
contradiction: present

Claim lifecycle represents whether the proposition is being investigated or resolved.

Evidence status represents the quality/currentness of evidence bearing on the claim.

HYPOTHESIS LIFECYCLE

Hypotheses require a richer lifecycle:

CANDIDATE
UNDER_INVESTIGATION
LEADING
SUPPORTED
WEAKENED
REJECTED
INCONCLUSIVE
HISTORICAL

Typical transitions:

CANDIDATE → UNDER_INVESTIGATION

UNDER_INVESTIGATION → LEADING

UNDER_INVESTIGATION → SUPPORTED

UNDER_INVESTIGATION → WEAKENED

UNDER_INVESTIGATION → REJECTED

UNDER_INVESTIGATION → INCONCLUSIVE

LEADING → SUPPORTED

LEADING → WEAKENED

LEADING → REJECTED

SUPPORTED → WEAKENED

INCONCLUSIVE → UNDER_INVESTIGATION

Any resolved/retired hypothesis → HISTORICAL

These transitions are not strictly linear.

Ranking and confidence are separate properties.

A LEADING hypothesis can still have low confidence.

HISTORICAL means the hypothesis is no longer an active candidate but remains available for provenance and future comparison.

JUDGMENT LIFECYCLE

Judgment lifecycle:

ACTIVE → SUPERSEDED → ARCHIVED

Rules:

Only one ACTIVE judgment is current within a research context.

A materially changed judgment supersedes the previous judgment.

The previous judgment remains fully preserved with its evidence, confidence, reasoning, and timestamp.

Minor updates that do not materially change the judgment do not create a new lifecycle state.

Superseded judgments remain available for historical explanation.

Restoring an old judgment does not silently make it current.

Restoration requires explicit state management and appropriate revalidation.

THESIS LIFECYCLE

Thesis lifecycle:

DRAFT
→ ACTIVE
→ CONFIRMED / WEAKENED / REJECTED
→ SUPERSEDED
→ ARCHIVED

Assessment states are not strictly linear.

A CONFIRMED thesis may become WEAKENED when new evidence materially damages it.

Lifecycle state represents the thesis's current status.

Confidence represents strength of support.

History records how and why the thesis changed.

The system must never silently replace a trader's thesis.

The agent may recommend a revised thesis, but the trader remains the decision-maker.

FRAMEWORK LIFECYCLE

Framework lifecycle:

DRAFT → ACTIVE → COMPLETED → ARCHIVED

Material framework changes create a new framework version rather than mutating historical methodology.

Example:

Framework v1 → Framework v2 → Framework v3

Previous framework versions remain available and restorable.

COMPLETED means the framework definition is established and usable.

It does not mean the framework can never be revised.

MONITOR LIFECYCLE

Monitor lifecycle:

DRAFT
→ ACTIVE
↕
PAUSED
→ STOPPED
→ ARCHIVED

Rules:

ACTIVE → PAUSED preserves conditions, configuration, history, and provenance.

PAUSED → ACTIVE resumes after appropriate freshness/context checks.

ACTIVE → STOPPED intentionally ends active monitoring.

Automatic expiration results in ARCHIVED rather than deletion.

Archived monitors remain restorable.

Restoration requires revalidation before becoming ACTIVE.

A handled alert does not necessarily terminate the monitor.

Material monitor adaptations create history rather than silently overwriting configuration.

STALE AND INVALID OBJECTS

Stale or invalid objects are preserved rather than automatically deleted.

They are excluded from current decision-making until appropriately revalidated.

General model:

STALE / INVALID
→ historical context
→ excluded from current decision-making
→ revalidation when restored or reused
→ valid object may return to current use

The system must distinguish:

CURRENT EVIDENCE
HISTORICAL EVIDENCE
STALE INFORMATION
INVALID INFORMATION

The system must never silently treat stale information as current evidence.

ARCHIVE AND RESTORE

All archived object restoration requires full revalidation.

General process:

ARCHIVED
→ RESTORE REQUEST
→ FULL REVALIDATION
→ VALID → RESTORED / ACTIVE
→ INVALID → REMAINS ARCHIVED

This applies because archived information may have changed in freshness, relevance, dependencies, or validity.

DELETION

Normal deletion is reversible.

General process:

ACTIVE / ARCHIVED
→ DELETE
→ RECOVERABLE DELETED STATE
→ RESTORE

Permanent deletion:

DELETE
→ PERMANENT DELETE REQUEST
→ EXPLICIT TRADER CONFIRMATION
→ PERMANENTLY REMOVED

Rules:

Normal deletion does not immediately destroy provenance.

Deleted objects remain recoverable according to system retention rules.

Restoring a deleted object follows appropriate restoration and revalidation rules.

Permanent deletion is explicitly trader-controlled.

Material objects that contributed to judgments should retain enough provenance for historical explanations unless the trader explicitly chooses permanent deletion.

DEPENDENCY PROPAGATION

When an object changes materially, the system uses adaptive propagation.

Process:

OBJECT A CHANGES
→ identify connected objects
→ determine actual dependency
→ assess material consequence
→ automatically update/revalidate affected objects
→ preserve previous states
→ record material transition

Relationship does not automatically mean dependency.

For example:

related_to ≠ automatic propagation

depends_on, tests, or materially causal relationships may create propagation.

Example:

New evidence
→ claim may need reassessment
→ hypothesis may change
→ current judgment may change
→ thesis may or may not change
→ monitor may or may not require adaptation

Only materially affected objects should change.

VERSIONING AND HISTORY

Versioning is object-specific.

Versioned objects include:

- Thesis
- Framework
- Judgment
- Snapshot
- Saved Artifact
- Other objects where independently restorable material versions are necessary

History-based objects include:

- Research
- Branch
- Claim
- Evidence
- Hypothesis
- Analysis
- Monitor
- Source
- Annotation

Definitions:

VERSION = independently restorable object state.

HISTORY = record of how an object changed.

History-based objects may be updated while preserving material state transitions, provenance, timestamps, and previous judgments/configurations where relevant.

This avoids unnecessary versions for every minor research change while preserving strong version control where it is useful.

CROSS-OBJECT STATE TRANSITIONS

When one object's state materially affects another object:

OBJECT A CHANGES
→ detect connected objects
→ determine actual dependency
→ assess material consequence
→ automatically update/revalidate affected objects
→ preserve previous states
→ record material transition

The agent does not blindly propagate changes across the entire object graph.

Unaffected objects remain untouched.

AGENT VS TRADER OWNERSHIP

Lifecycle management uses hybrid ownership.

AGENT RESPONSIBILITIES:

- Perform routine lifecycle transitions automatically when rules are clear.
- Detect material state changes.
- Identify affected dependencies.
- Revalidate dependent objects.
- Maintain provenance and history.
- Handle clear and reversible lifecycle changes.
- Preserve previous states.
- Recommend consequential changes when appropriate.

TRADER RESPONSIBILITIES:

- Control consequential persistent changes.
- Control destructive/permanent deletion.
- Control persistent framework changes.
- Control monitoring activation.
- Resolve genuinely ambiguous decisions.
- Override agent-assigned lifecycle decisions when desired.

GLOBAL PRINCIPLE

The agent carries the operational burden.

The trader retains decision authority.

The system should automate routine, clear, reversible lifecycle transitions while preserving trader control over consequential, persistent, destructive, or ambiguous changes.
