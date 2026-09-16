---
title: "BRANCH INTELLIGENCE"
source: BRANCH INTELLIGENCE.txt
converted: 2026-09-12
type: architecture-spec
related: [hypothesis.md, execution-scheduler.md, research-flows.md]
---

**Related documents:** `hypothesis.md` · `execution-scheduler.md` · `research-flows.md`

> Converted from `BRANCH INTELLIGENCE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

BRANCH INTELLIGENCE

PURPOSE

Branch Intelligence manages independent lines of investigation within a research object.

A branch exists when research needs to explore a distinct hypothesis, explanation, evidence path, question, or analytical direction without destroying or confusing the parent research.

Branches allow the system to:

- explore competing explanations
- investigate alternatives in parallel
- isolate conflicting evidence
- pursue different domains
- test different hypotheses
- preserve abandoned research paths
- allocate resources dynamically
- pause low-priority investigations
- return to previously explored paths
- maintain traceability from exploration to final judgment

Core principle:

RESEARCH = overall investigation
BRANCH = independent investigative path within that research

A branch must remain connected to its parent research while maintaining enough independence to be paused, reprioritized, cloned, completed, or abandoned.

--------------------------------------------------
BRANCH OBJECT
--------------------------------------------------

BRANCH {
  id

  research_ref
  parent_branch_ref

  objective
  question

  hypothesis_refs[]
  claim_refs[]
  evidence_refs[]
  analysis_refs[]
  judgment_refs[]

  target
  scope
  depth
  constraints

  dependencies[]
  dependent_branches[]

  priority
  importance
  information_value

  execution {
    status
    resource_budget
    assigned_skills[]
    assigned_tools[]
    execution_strategy
    parallelism
  }

  completion {
    criteria[]
    progress
    stop_conditions[]
  }

  state {
    status
    ownership
    lock_state
    visibility
    archive_state
  }

  created_from
  provenance

  created_at
  updated_at

  history
}

--------------------------------------------------
BRANCH DEFINITION
--------------------------------------------------

A branch is an independently managed investigation path belonging to a research object.

A branch may represent:

- a hypothesis
- a candidate explanation
- an alternative explanation
- a specific evidence path
- a domain-specific investigation
- a counterargument
- a historical comparison
- a falsification path
- a source-validation path
- a user-requested investigative direction

Branches should be created only when independent investigation provides meaningful value.

The system must not create branches merely to make the workspace appear sophisticated.

--------------------------------------------------
BRANCH CREATION
--------------------------------------------------

Branches may be created automatically or through natural language.

Automatic creation is appropriate when:

- competing hypotheses require separate investigation
- evidence points toward materially different explanations
- an alternative explanation could change the judgment
- a research task naturally separates into independent paths
- parallel investigation provides meaningful information value

Trader-created examples:

"Look into the regulatory angle separately."

"Create a branch to test the bearish case."

"Investigate whether the move was caused by Bitcoin instead."

"Keep the historical comparison separate."

The agent should explain the branch purpose when useful.

--------------------------------------------------
BRANCH PARENTAGE
--------------------------------------------------

Every branch belongs to a research object.

A branch may optionally have a parent branch.

Example:

RESEARCH
```text
├── Main Branch
│   ├── Liquidity Hypothesis
│   └── Macro Hypothesis
└── Historical Branch
```

Parent-child branch relationships represent investigative lineage.

A child branch inherits relevant context from its parent when appropriate.

It does not automatically inherit every state, assumption, evidence item, or conclusion.

Inherited context must remain traceable.

--------------------------------------------------
BRANCH INDEPENDENCE
--------------------------------------------------

A branch should be sufficiently independent to produce a meaningful alternative investigation.

Branch independence means:

- separate objective
- separate investigative state
- separate progress
- separate priority
- separate completion state

It does not mean complete isolation.

Branches may share:

- evidence
- sources
- claims
- hypotheses
- tools
- research context

Shared objects remain reusable through explicit references.

--------------------------------------------------
BRANCH OBJECTIVE
--------------------------------------------------

Every active branch must have an objective.

The objective should define:

- what the branch is investigating
- why it matters
- what evidence would address it
- what would make the branch complete

Objectives may be:

- explicit
- inferred from a hypothesis
- inherited from parent research
- generated by adaptive research planning

If the objective is materially ambiguous, clarify before executing substantial work.

--------------------------------------------------
BRANCH TYPES
--------------------------------------------------

Branches may be classified by purpose.

Possible types include:

HYPOTHESIS_BRANCH

Investigates a candidate explanation.

ALTERNATIVE_BRANCH

Investigates an alternative explanation.

EVIDENCE_BRANCH

Collects or validates a particular evidence class.

DOMAIN_BRANCH

Investigates a specific research domain.

FALSIFICATION_BRANCH

Attempts to disprove or weaken the current leading explanation.

HISTORICAL_BRANCH

Investigates comparable historical cases.

SOURCE_VALIDATION_BRANCH

Validates disputed or important information.

ANALYSIS_BRANCH

Performs a distinct analytical interpretation.

CUSTOM_BRANCH

Trader-defined investigative path.

Branch type is descriptive metadata and must not rigidly constrain execution.

--------------------------------------------------
BRANCH TARGET
--------------------------------------------------

Each branch may have a target including:

- asset
- entity
- event
- hypothesis
- claim
- thesis
- timeframe
- relationship
- source
- market condition

Target resolution follows the general target-resolution rules.

Explicit branch targets take precedence over inherited targets.

--------------------------------------------------
BRANCH SCOPE
--------------------------------------------------

A branch may narrow the parent research scope.

For example:

Parent research:

"Why did the asset decline?"

Branch:

"Investigate macroeconomic causes."

The branch should inherit the parent timeframe and asset unless explicitly changed.

A branch may expand scope only when necessary and justified.

Scope expansion should be visible when material.

--------------------------------------------------
BRANCH DEPTH
--------------------------------------------------

Branch depth follows the adaptive depth model.

A branch may have:

- requested depth
- resolved depth
- minimum depth
- maximum depth
- adaptive depth

The scheduler may allocate more depth to a branch when:

- evidence is contradictory
- hypothesis importance is high
- uncertainty remains high
- information value is high
- the branch could materially change the judgment

The scheduler may reduce depth when:

- evidence becomes sufficient
- branch relevance falls
- information value becomes low
- another branch becomes more important

Explicit trader hard limits must not be exceeded.

--------------------------------------------------
BRANCH PRIORITY
--------------------------------------------------

Branches have dynamic priority.

Priority may depend on:

- objective relevance
- hypothesis importance
- information value
- uncertainty
- evidence weakness
- contradiction
- potential judgment impact
- urgency
- trader-defined priority
- dependency readiness
- available resources

Priority is dynamic.

A branch that begins as low priority may become critical after new evidence arrives.

A branch that begins as high priority may become irrelevant.

The scheduler must continuously reassess priority.

--------------------------------------------------
BRANCH INFORMATION VALUE
--------------------------------------------------

Information value estimates how much completing additional work on a branch could improve the research judgment.

High information value may result from:

- resolving major uncertainty
- distinguishing competing hypotheses
- testing a critical assumption
- resolving a major contradiction
- investigating a potentially decisive factor
- testing a leading hypothesis

Low information value may result from:

- repeated confirmation
- redundant sources
- minor contextual details
- already-resolved questions
- evidence unlikely to change the judgment

Information value affects scheduling but does not replace trader priority.

--------------------------------------------------
BRANCH RESOURCE ALLOCATION
--------------------------------------------------

The scheduler may allocate resources across branches.

Resources may include:

- execution time
- tool calls
- Skills
- data sources
- research depth
- parallel execution capacity

Resource allocation should favor branches with greater expected information value and objective relevance.

Resources may be reallocated dynamically.

A branch must not monopolize resources indefinitely when another branch becomes materially more valuable.

--------------------------------------------------
BRANCH PARALLELISM
--------------------------------------------------

Independent branches should run in parallel when:

- resources permit
- tasks do not depend on one another
- parallel execution reduces research time
- evidence freshness benefits from simultaneous investigation

Dependent branches should execute sequentially when required.

Example:

Do not synthesize a branch before its required evidence tasks complete.

Parallel execution must not compromise provenance or object integrity.

--------------------------------------------------
BRANCH DEPENDENCIES
--------------------------------------------------

Branches may depend on:

- other branches
- evidence
- claims
- hypotheses
- analyses
- external information
- completion of prerequisite tasks

Dependencies must be explicit.

Possible dependency states:

- READY
- WAITING
- BLOCKED
- SATISFIED
- INVALID

If a dependency changes materially, affected branches should be re-evaluated.

Unrelated branches must remain unaffected.

--------------------------------------------------
BRANCH EXECUTION STATES
--------------------------------------------------

Primary branch execution states:

DRAFT
ACTIVE
PAUSED
COMPLETED
CANCELLED
ARCHIVED

DRAFT

Branch exists but has not begun active investigation.

ACTIVE

Branch is currently being investigated.

PAUSED

Branch is temporarily inactive but remains valid and resumable.

COMPLETED

Branch objective has been sufficiently addressed.

CANCELLED

Branch was intentionally stopped before completion.

ARCHIVED

Branch remains available historically but is no longer part of active workspace execution.

Branches do not use STALE or INVALID as primary lifecycle states.

Evidence or objects inside a branch may independently become stale or invalid.

--------------------------------------------------
BRANCH ACTIVATION
--------------------------------------------------

A branch becomes ACTIVE when:

- prerequisites are satisfied
- resources are available
- scheduler selects it
- trader explicitly activates it
- new evidence makes it materially relevant

Activation must preserve the branch's previous history.

--------------------------------------------------
BRANCH PAUSING
--------------------------------------------------

A branch may be paused because:

- trader requests it
- resource limits require reallocation
- another branch has higher information value
- a dependency is unresolved
- evidence is temporarily unavailable
- the branch is no longer currently valuable

Pausing does not delete work.

All completed evidence, claims, hypotheses, and analysis remain available.

A paused branch can be resumed later.

--------------------------------------------------
AUTOMATIC PAUSING
--------------------------------------------------

The scheduler may automatically pause a branch when:

- the active branch limit is reached
- another branch becomes materially more important
- the branch has low information value
- resource constraints require reallocation

Automatic pausing is allowed when the reason is unambiguous.

If automatic pausing would materially alter trader intent, clarify instead.

The branch's previous state and reason for pausing must be preserved.

--------------------------------------------------
BRANCH RESUMPTION
--------------------------------------------------

When resuming a branch:

1. restore branch state
2. inspect new evidence
3. inspect changed dependencies
4. check whether the original objective remains relevant
5. check freshness
6. revalidate assumptions where necessary
7. determine whether research should resume or be replanned

A branch should not blindly continue from an outdated state.

--------------------------------------------------
BRANCH COMPLETION
--------------------------------------------------

A branch may be completed when:

- objective is sufficiently addressed
- required evidence has been collected
- required analysis is complete
- remaining uncertainty is understood
- additional work is unlikely to materially change the result

Completion does not require certainty.

A branch may complete with:

- supported conclusion
- weakened hypothesis
- rejected hypothesis
- inconclusive result
- unresolved evidence gap

The branch result must explain why the branch was completed.

--------------------------------------------------
BRANCH CANCELLATION
--------------------------------------------------

Cancellation intentionally ends active execution.

Cancellation does not delete the branch's historical work.

The system should preserve:

- objective
- work performed
- evidence collected
- hypotheses tested
- reason for cancellation
- current state
- provenance

A cancelled branch may be restored or cloned when appropriate.

Permanent deletion remains a separate MANAGE_STATE operation.

--------------------------------------------------
BRANCH CLONING
--------------------------------------------------

Branches may be cloned when useful.

Cloning creates a new branch based on an existing branch while preserving provenance.

The clone may inherit:

- objective
- scope
- target
- relevant evidence references
- hypotheses
- claims
- research context

The clone must not silently duplicate mutable state as if it were the same branch.

The relationship should be recorded:

CLONED_FROM

The cloned branch can then diverge independently.

--------------------------------------------------
BRANCH RESET
--------------------------------------------------

A branch may be reset to:

- initial state
- branch baseline
- named checkpoint
- previous checkpoint

Reset must preserve history.

The system should identify affected objects and revalidate dependencies.

Resetting a branch must not silently reset unrelated branches.

--------------------------------------------------
BRANCH CHECKPOINTS
--------------------------------------------------

The system may create automatic checkpoints.

Checkpoints preserve:

- branch state
- active tasks
- relevant hypotheses
- evidence references
- claims
- analysis
- dependencies
- resource allocation
- current judgment contribution

Checkpoints allow recovery after:

- major replanning
- branch divergence
- failed research
- user interruption
- restoration

--------------------------------------------------
BRANCH PRIORITY OVERRIDES
--------------------------------------------------

The trader may override branch priority.

Examples:

"Prioritize the regulatory branch."

"Ignore the technical branch for now."

"Make the bearish branch highest priority."

Trader priority overrides should be treated as constraints where explicitly stated.

The scheduler may still identify conflicts with hard resource limits.

--------------------------------------------------
BRANCH RESOURCE LIMITS
--------------------------------------------------

A branch may have:

- maximum depth
- time limit
- task limit
- tool budget
- source limit
- evidence requirement
- execution deadline

Hard limits must not be exceeded.

When a branch reaches a limit:

1. evaluate whether objective is complete
2. determine whether remaining work could materially matter
3. report the limitation
4. recommend continuation if warranted

Do not silently exceed explicit limits.

--------------------------------------------------
BRANCH INTERRUPTION
--------------------------------------------------

Natural language may interrupt a branch.

Examples:

"Stop researching this angle."

"Pause the macro branch."

"Focus on the alternative explanation."

"Don't investigate that anymore."

The agent must identify the affected branch.

If unambiguous, apply immediately.

Completed work remains preserved.

If the command materially affects the whole research, propagate only where justified.

--------------------------------------------------
BRANCH SCOPE CHANGE
--------------------------------------------------

A trader may modify branch scope.

Examples:

"Only look at the last 30 days."

"Focus only on US macro."

"Include on-chain data."

The system should:

1. identify affected branch
2. update active scope
3. preserve previous scope in history
4. determine which completed work remains relevant
5. identify stale or invalid results
6. replan affected tasks

Unrelated branches remain unchanged.

--------------------------------------------------
BRANCH OBJECTIVE CHANGE
--------------------------------------------------

If the trader changes the objective of a branch:

1. determine whether it remains the same investigative path
2. preserve the previous objective
3. update active objective if appropriate
4. reassess dependencies
5. replan affected work

If the new objective is fundamentally different, create a new branch or research path rather than corrupting the original branch's history.

--------------------------------------------------
BRANCH HYPOTHESIS RELATIONSHIP
--------------------------------------------------

A branch may be dedicated to a hypothesis.

Example:

HYPOTHESIS A
→ BRANCH A
→ supporting evidence
→ contradicting evidence
→ analysis
→ branch conclusion

A hypothesis may have multiple branches.

A branch may investigate multiple related hypotheses when they form a coherent investigative path.

The agent should avoid unnecessary fragmentation.

--------------------------------------------------
BRANCH ALTERNATIVES
--------------------------------------------------

Alternative explanations should often receive separate branches when:

- they could materially change the judgment
- they require different evidence
- they require independent investigation
- confirmation bias risk is significant

The first hypothesis must not receive privileged resource allocation simply because it was created first.

--------------------------------------------------
ANTI-ANCHORING
--------------------------------------------------

Branch scheduling must not privilege:

- first hypothesis
- most recently created hypothesis
- agent-preferred explanation
- trader-preferred explanation

Priority should be based on:

- relevance
- information value
- evidence
- uncertainty
- potential judgment impact

When a leading hypothesis dominates, the scheduler should consider allocating resources to meaningful alternatives and falsification.

--------------------------------------------------
BRANCH EVIDENCE SHARING
--------------------------------------------------

Evidence may be shared across branches.

Shared evidence should retain:

- original source
- original retrieval
- provenance
- context
- timestamps
- relationship to each branch

A piece of evidence supporting one branch may contradict another.

The evidence object remains neutral.

Its relationship to each branch is contextual.

--------------------------------------------------
BRANCH CLAIM SHARING
--------------------------------------------------

Claims may be referenced by multiple branches.

The system must distinguish:

- claim itself
- branch-specific interpretation of the claim

A branch may support a claim while another branch challenges it.

This must not create duplicate claim objects unnecessarily.

--------------------------------------------------
BRANCH HYPOTHESIS SHARING
--------------------------------------------------

Hypotheses may be referenced across branches when they are genuinely the same hypothesis.

If materially different versions arise, create separate hypothesis objects and preserve lineage.

Do not silently merge competing hypotheses.

--------------------------------------------------
BRANCH ANALYSIS
--------------------------------------------------

Each branch may produce its own analysis.

Branch analysis should remain connected to:

- evidence
- claims
- hypotheses
- objective
- parent research

Branch analysis contributes to the broader research judgment but does not automatically become the final judgment.

--------------------------------------------------
BRANCH RESULT
--------------------------------------------------

A completed branch should produce a structured result containing:

- branch objective
- key findings
- strongest evidence
- opposing evidence
- hypothesis assessment
- unresolved issues
- confidence
- implications for parent research
- whether additional work is justified

The result should indicate whether the branch:

- strengthens the parent hypothesis
- weakens the parent hypothesis
- creates a competing hypothesis
- resolves an uncertainty
- creates a new uncertainty
- has little effect on the parent judgment

--------------------------------------------------
BRANCH IMPACT ON PARENT RESEARCH
--------------------------------------------------

When branch results become available:

1. evaluate materiality
2. update relevant claims
3. update hypotheses
4. update analysis
5. reassess judgment if necessary
6. preserve previous judgment if materially changed
7. propagate changes through dependencies

A branch must not directly overwrite the parent research judgment.

The parent research remains responsible for synthesis.

--------------------------------------------------
BRANCH CONTRADICTION
--------------------------------------------------

If a branch contradicts another branch:

1. preserve both results
2. identify the conflicting claims/evidence
3. compare evidence quality
4. compare scope/timeframe
5. inspect dependencies
6. determine whether the contradiction is genuine
7. update parent analysis
8. reduce confidence if unresolved and material

Contradiction is not automatically an error.

It may represent genuine uncertainty.

--------------------------------------------------
BRANCH MERGING
--------------------------------------------------

Branches must not be automatically merged.

If two branches become effectively identical, the system may recommend consolidation.

The trader may approve consolidation.

Before consolidation:

- preserve both histories
- preserve provenance
- preserve evidence relationships
- identify duplicated objects
- identify conflicting results
- define the surviving branch
- maintain lineage

No information may be silently discarded.

--------------------------------------------------
BRANCH RELATIONSHIPS
--------------------------------------------------

Supported relationships include:

- branched_from
- depends_on
- supports
- contradicts
- tests
- challenges
- related_to
- references
- informs
- supersedes
- replaces
- cloned_from

Relationships are stored in the broader object graph.

Relationship existence does not automatically mean dependency.

Materiality determines propagation.

--------------------------------------------------
BRANCH DEPENDENCY PROPAGATION
--------------------------------------------------

When a branch changes materially:

1. identify dependent branches
2. identify affected objects
3. determine materiality
4. revalidate affected branches
5. replan where necessary
6. preserve previous state
7. record the transition

Unrelated branches must not be disturbed.

Propagation must avoid loops.

Each propagation event should track:

- propagation_event_id
- origin_object
- affected_objects
- propagation_path
- material_change
- timestamp

The same object should not be processed repeatedly for the same propagation event.

--------------------------------------------------
BRANCH FAILURE
--------------------------------------------------

A branch may fail because:

- tool failure
- source unavailable
- insufficient data
- dependency failure
- invalid target
- research budget exhausted
- execution error

Failure should not automatically mean the hypothesis is false.

The system must distinguish:

RESEARCH FAILURE

from

EVIDENCE AGAINST HYPOTHESIS

A failed investigation may be retried, replanned, paused, or cancelled.

--------------------------------------------------
BRANCH RETRY
--------------------------------------------------

Retry is appropriate when:

- failure is temporary
- source/tool failure is recoverable
- alternate sources exist
- research value remains high

The agent may modify execution strategy after repeated failure.

Retries should avoid repeating identical failed approaches unnecessarily.

--------------------------------------------------
BRANCH FRESHNESS
--------------------------------------------------

When resuming an old branch, the system must check:

- evidence freshness
- source updates
- changed market conditions
- changed target state
- changed dependencies
- changed thesis/judgment
- elapsed time

Historical branch results remain valid as historical context.

They must not automatically become current evidence.

--------------------------------------------------
BRANCH RESTORATION
--------------------------------------------------

Restoring a branch must:

1. retrieve requested state/checkpoint
2. restore relationships
3. preserve provenance
4. check current context
5. revalidate evidence
6. reassess dependencies
7. determine whether fresh research is needed
8. resume only after validation

Restoration must not erase newer history.

--------------------------------------------------
BRANCH VISIBILITY
--------------------------------------------------

Branches may have visibility states:

- visible
- collapsed
- hidden
- archived

Visibility is a workspace presentation state.

Hiding a branch does not pause or cancel it.

Collapsing a branch does not change research execution.

The agent must distinguish UI state from research state.

--------------------------------------------------
BRANCH OWNERSHIP
--------------------------------------------------

Ownership is hybrid.

The agent manages:

- routine execution
- scheduling
- dependencies
- resource allocation
- status updates
- provenance
- adaptive prioritization

The trader controls:

- explicit branch priority
- consequential cancellation
- persistent structural changes
- branch deletion
- hard constraints
- branch-level overrides

--------------------------------------------------
BRANCH LIMITS
--------------------------------------------------

The system should maintain a maximum number of active branches.

Default limits are system-defined.

The trader may override the limit.

When the limit is reached:

1. identify lowest-priority active branches
2. determine whether pausing them is unambiguous
3. pause them if safe
4. otherwise ask for clarification

Do not silently exceed the active branch limit.

Archived and completed branches do not count toward active execution capacity.

--------------------------------------------------
BRANCH COMPLETION CASCADE
--------------------------------------------------

When a branch completes:

1. record result
2. update parent research
3. update related hypotheses
4. update relevant claims
5. unlock dependent tasks
6. reassess other branches
7. reallocate resources
8. reassess research completion

Completion may cause:

- another branch to become unnecessary
- another branch to become more important
- new branches to become necessary
- research to complete

The scheduler must reassess rather than following a fixed sequence.

--------------------------------------------------
BRANCH STOPPING RULE
--------------------------------------------------

A branch should stop when:

- objective is satisfied
- sufficient evidence exists
- additional work has low information value
- hypothesis is sufficiently tested
- branch becomes irrelevant
- hard resource limit is reached
- trader explicitly stops it

Stopping must preserve the reason.

--------------------------------------------------
BRANCH EXPANSION RULE
--------------------------------------------------

A branch may expand when:

- evidence reveals a new material question
- current hypothesis requires another investigative path
- contradiction cannot be resolved within current scope
- an alternative explanation becomes important
- new information materially changes the research landscape

Expansion may create:

- new tasks
- new child branch
- modified scope
- new hypothesis

The agent should choose the smallest structural change that adequately addresses the new requirement.

--------------------------------------------------
BRANCH AND RESEARCH PLANNING
--------------------------------------------------

Research Planning defines:

- what work should exist
- why it exists
- dependencies
- completion criteria
- capabilities required

Branch Intelligence defines:

- how an investigative path behaves as an independent research unit.

The Research Scheduler executes and prioritizes branch work.

These systems must remain coordinated.

--------------------------------------------------
BRANCH AND MANAGE_STATE
--------------------------------------------------

MANAGE_STATE controls branch state through natural language.

Supported operations include:

- create
- activate
- pause
- resume
- cancel
- reprioritize
- rename
- relabel
- clone
- reset
- archive
- restore
- change scope
- change objective
- change depth
- change constraints
- add/remove dependencies
- lock/unlock
- hide/show
- group
- annotate
- checkpoint
- restore checkpoint
- delete

Deletion remains reversible by default.

Permanent deletion requires explicit confirmation.

--------------------------------------------------
BRANCH AND SAVE
--------------------------------------------------

A branch normally persists automatically as part of research state.

SAVE may intentionally preserve:

- branch state
- branch result
- branch checkpoint
- reusable investigation
- historical investigative path

Saving a branch does not alter active execution.

--------------------------------------------------
BRANCH AND MEMORY
--------------------------------------------------

Branch history may become research memory when useful.

Memory should preserve:

- branch objective
- branch result
- tested hypotheses
- important evidence
- reason for completion/cancellation
- major conclusions
- historical context

Historical branch information must not automatically become current evidence.

--------------------------------------------------
BRANCH OUTPUT
--------------------------------------------------

Default branch presentation should be concise.

Show:

- branch objective
- current status
- priority
- key finding
- current hypothesis assessment
- confidence
- next action if active

Deeper details are available progressively:

- tasks
- evidence
- sources
- claims
- hypotheses
- dependencies
- execution history
- resource allocation
- checkpoints

--------------------------------------------------
BRANCH TRANSPARENCY
--------------------------------------------------

When useful, the system should explain:

- why a branch was created
- why it was prioritized
- why it was paused
- why it was resumed
- why resources were reallocated
- why it was completed
- why it was cancelled
- how it affected the parent research

The explanation should be concise by default.

Detailed scheduler reasoning is available on request.

--------------------------------------------------
BRANCH INTEGRITY RULES
--------------------------------------------------

The system must never:

- create unnecessary branches
- silently merge branches
- delete branch history
- confuse research failure with hypothesis rejection
- treat one branch as automatically correct
- privilege the first hypothesis
- allow uncontrolled dependency loops
- overwrite parent research with branch conclusions
- silently expand branch scope
- silently exceed hard branch limits
- treat hidden branches as inactive
- treat completed branches as deleted
- turn historical branch evidence into current evidence without revalidation

Branch lineage must remain traceable.

Every branch must be connected to its parent research.

Every material branch state transition must preserve provenance.

--------------------------------------------------
BRANCH EXECUTION LOOP
--------------------------------------------------

IDENTIFY NEED FOR INDEPENDENT INVESTIGATION

→ CREATE / SELECT BRANCH

→ DEFINE OBJECTIVE

→ RESOLVE TARGET

→ RESOLVE SCOPE

→ RESOLVE DEPTH

→ IDENTIFY HYPOTHESIS / CLAIMS

→ IDENTIFY DEPENDENCIES

→ DEFINE COMPLETION CRITERIA

→ ASSIGN PRIORITY

→ ALLOCATE RESOURCES

→ SCHEDULE TASKS

→ EXECUTE INVESTIGATION

→ INGEST EVIDENCE

→ UPDATE CLAIMS

→ UPDATE HYPOTHESES

→ UPDATE BRANCH ANALYSIS

→ REASSESS INFORMATION VALUE

→ REASSESS PRIORITY

→ REPLAN IF NECESSARY

→ COMPLETE / PAUSE / CANCEL / EXPAND

→ PROPAGATE MATERIAL RESULT

→ UPDATE PARENT RESEARCH

→ REASSESS OTHER BRANCHES

→ REASSESS OVERALL JUDGMENT

--------------------------------------------------
GLOBAL PRINCIPLE
--------------------------------------------------

Branches exist to create controlled investigative independence.

They allow the agent to explore competing explanations, allocate research effort dynamically, preserve alternative paths, and prevent one line of reasoning from dominating simply because it was investigated first.

A branch is not a separate research universe.

It is an independently managed investigative path inside a larger research context.

The parent research remains responsible for synthesis.

The branch contributes evidence, analysis, hypothesis assessment, and uncertainty.

The trader remains the final decision-maker.
