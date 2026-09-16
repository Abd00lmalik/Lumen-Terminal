---
title: "EXECUTION SCHEDULER & RESOURCE ALLOCATION"
source: EXECUTION SCHEDULER & RESOURCE ALLO.txt
converted: 2026-09-12
type: architecture-spec
related: [research-execution-engine.md, research-planning.md, branch.md]
---

**Related documents:** `research-execution-engine.md` · `research-planning.md` · `branch.md`

> Converted from `EXECUTION SCHEDULER & RESOURCE ALLO.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

EXECUTION SCHEDULER & RESOURCE ALLOCATION

PURPOSE

The Execution Scheduler converts the Research Plan into active executable work.

It determines:

- Which task should execute next
- Which tasks can execute simultaneously
- Which tasks must wait
- Which branches receive research resources
- How priorities change during research
- When blocked tasks become executable
- When research should be paused, resumed, or deprioritized
- When additional research effort is justified
- When the research should stop

The scheduler operates continuously throughout research.

It does not replace the Research Plan.

The Research Plan defines what should be investigated.

The Scheduler determines how that work is executed.

CORE MODEL

RESEARCH PLAN
→ AVAILABLE TASKS
→ DEPENDENCY CHECK
→ PRIORITY EVALUATION
→ RESOURCE ALLOCATION
→ EXECUTION
→ RESULT
→ STATE UPDATE
→ REASSESS PRIORITIES
→ SCHEDULE NEXT WORK

1. SCHEDULER PRINCIPLE

The scheduler is adaptive rather than FIFO.

Tasks are not executed simply because they were created first.

Execution priority depends on:

- Research relevance
- Dependency readiness
- Expected information value
- Potential impact on judgment
- Uncertainty
- Evidence weakness
- Branch priority
- Task urgency
- Resource availability
- Trader constraints

2. TASK READINESS

A task is READY when:

- Its required dependencies are satisfied
- Its target is resolved
- Required context is available
- Required tools or Skills are available
- No blocking constraint prevents execution

A task that is not ready remains BLOCKED.

The scheduler continuously checks whether blocked tasks have become ready.

3. TASK STATES

Execution-level task states:

PENDING
READY
RUNNING
BLOCKED
PAUSED
COMPLETED
FAILED
CANCELLED

These are execution states and should remain distinct from the broader object lifecycle states.

4. PRIORITY SCORE

The scheduler evaluates task priority using contextual factors rather than a rigid universal numeric formula.

Relevant factors include:

- Objective relevance
- Expected information value
- Potential judgment impact
- Evidence uncertainty
- Hypothesis importance
- Dependency importance
- Branch priority
- Time sensitivity
- Research cost
- Trader-specified priority

The agent may internally calculate a priority score, but the exact scoring formula does not need to be exposed.

5. INFORMATION VALUE

A task receives higher priority when its result could materially change the research conclusion.

Examples:

A task testing a weak but highly consequential causal explanation should receive more attention than a task confirming a minor supporting detail.

A task that could invalidate the leading hypothesis should generally receive substantial priority.

6. DEPENDENCY PRIORITY

A task that unlocks several important downstream tasks may receive elevated priority.

Example:

TASK A
→ resolves the actual event

TASK B
→ investigates macro impact
depends on A

TASK C
→ investigates market reaction
depends on A

TASK D
→ compares explanations
depends on B + C

TASK A may receive high priority because it unlocks multiple important tasks.

7. PARALLEL EXECUTION

Independent READY tasks may execute concurrently.

Examples:

MACRO
```text
+
NEWS
+
SENTIMENT
+
TECHNICAL
+
```
ON-CHAIN

can execute in parallel when they do not depend on one another.

Parallel execution should be used when it improves:

- Speed
- Coverage
- Independent corroboration
- Research diversity

8. PARALLELISM LIMITS

Parallel execution is bounded by:

- Available tool capacity
- Available Skill capacity
- Research complexity
- Resource constraints
- Data-source limitations
- Trader-imposed constraints

The scheduler should not create unnecessary parallel work.

More simultaneous tasks do not automatically mean better research.

9. SEQUENTIAL EXECUTION

Tasks execute sequentially when:

- One requires another's result
- The target is unresolved
- A hypothesis must first be established
- A previous result determines the next investigation
- A synthesis requires completed inputs

Dependencies always take precedence over convenience.

10. CONDITIONAL TASKS

A task may be dormant until a condition becomes true.

Example:

IF regulatory evidence becomes material
→ activate regulatory investigation.

IF historical similarity is strong
→ deepen historical analysis.

IF the leading hypothesis weakens
→ activate alternative explanation branch.

Conditional tasks should not consume unnecessary resources before activation.

11. RESOURCE ALLOCATION

Research resources are allocated dynamically.

Resources may include:

- Tool calls
- Skill invocations
- Research depth
- Parallel execution capacity
- Time
- Data-source queries
- Branch attention

Resources should be concentrated where they have the greatest expected research value.

12. RESOURCE REALLOCATION

Resources may move between branches.

Example:

Initial:

Macro: HIGH
News: HIGH
Sentiment: MEDIUM
Technical: MEDIUM

New evidence strongly weakens the macro explanation.

The scheduler may reduce macro resources and increase resources for:

- Market structure
- Liquidations
- Technical factors
- Alternative causal explanations

Completed work is preserved.

13. BRANCH RESOURCE BALANCING

No branch should monopolize resources merely because it was created first.

The scheduler considers:

- Current branch priority
- Remaining uncertainty
- Expected impact
- Evidence quality
- Potential to change judgment

A low-value branch may be paused while a higher-value branch receives additional resources.

14. EXPLORATION VS CONFIRMATION

The scheduler must balance:

EXPLORATION
and
CONFIRMATION.

Exploration searches for:

- Alternative explanations
- Contradictory evidence
- Unexpected signals
- Missing domains
- New hypotheses

Confirmation tests whether important claims remain supported.

The scheduler should not allow confirmation work to consume all available research effort.

15. FALSIFICATION PRIORITY

When a leading hypothesis becomes dominant, the scheduler should allocate appropriate effort to testing whether it could be wrong.

This is especially important when:

- Confidence is high but evidence is narrow
- The conclusion has major implications
- Alternative explanations remain plausible
- Important assumptions remain untested

The system should actively seek meaningful disconfirming evidence rather than manufacture objections.

16. EVIDENCE-DRIVEN PRIORITY CHANGES

When new evidence arrives, the scheduler reassesses affected tasks.

Possible results:

- Continue unchanged
- Increase priority
- Reduce priority
- Pause
- Complete
- Create new task
- Create new branch
- Replace affected task

Only materially affected work should be changed.

17. HYPOTHESIS-DRIVEN SCHEDULING

When a new hypothesis appears:

1. Assess relevance.
2. Determine whether it could materially change the judgment.
3. Identify required evidence.
4. Create tasks if necessary.
5. Assign priority.
6. Schedule execution.
7. Compare its results with existing hypotheses.

A weak speculative hypothesis should not automatically receive substantial resources.

18. CONTRADICTION PRIORITY

Contradictory evidence receives elevated attention when it affects:

- A major claim
- The leading hypothesis
- A critical assumption
- The current judgment
- A thesis
- A high-confidence conclusion

Minor contradictions may be recorded without triggering extensive research.

19. STALE TASKS

A task may become stale when:

- Its target changes
- Its required evidence becomes outdated
- Its branch is superseded
- Its underlying assumption changes
- Its research context changes materially

The scheduler should revalidate before continuing stale work.

20. BLOCKED TASKS

When a task is BLOCKED:

- Record the blocking dependency
- Continue unrelated READY tasks
- Recheck when dependencies change
- Avoid repeatedly attempting the blocked task

If the dependency becomes impossible:

- Replan
- Replace the task
- Cancel it
- Or mark the research limitation

21. TASK FAILURE

When a task fails:

1. Record the failure.
2. Determine whether retrying is useful.
3. Try an alternative tool or Skill if appropriate.
4. Reassess dependencies.
5. Continue unrelated tasks.
6. Reduce confidence if the missing result is material.

A single failed task should not automatically stop the research.

22. RETRY POLICY

Retry when:

- Failure appears temporary
- The task is high-value
- No better alternative exists
- New information could make the task executable

Do not repeatedly retry a task when:

- The tool is clearly unavailable
- The data does not exist
- The task is no longer relevant
- An equivalent result is already available

23. TOOL FAILURE RECOVERY

When a selected tool fails:

TOOL FAILURE
→ DETERMINE MATERIALITY
→ RETRY OR ALTERNATIVE TOOL
→ CROSS-CHECK IF NECESSARY
→ UPDATE PLAN
→ CONTINUE

The scheduler must never treat a tool failure as successful execution.

24. SKILL FAILURE RECOVERY

If a Skill produces insufficient or unusable research:

- Evaluate the output
- Seek another relevant Skill
- Use another data source
- Split the task if necessary
- Reduce confidence if the gap remains material

The agent should not blindly repeat the same Skill.

25. TIME-SENSITIVE TASKS

Tasks may receive increased priority when information decays quickly.

Examples:

- Breaking news
- Market-moving events
- Scheduled economic releases
- Rapidly changing sentiment
- Live market conditions

The scheduler should account for freshness requirements.

26. FRESHNESS

Task freshness requirements depend on the research objective.

A task concerning a live market event may require very recent evidence.

A historical research task may prioritize archival evidence.

A framework evaluation may require current evidence while still referencing historical context.

The scheduler should not apply one universal freshness window.

27. RESEARCH BUDGET

A research plan may have:

- Maximum depth
- Maximum time
- Tool limits
- Source limits
- Branch limits
- Trader-imposed restrictions

The scheduler must respect hard constraints.

Adaptive optimization may occur within those boundaries.

28. BRANCH LIMIT

The system maintains a maximum number of active branches.

When the limit is reached:

- Consolidate related branches where safe
- Pause low-priority branches when unambiguous
- Otherwise ask the trader

The scheduler must preserve branch distinction when consolidation would destroy meaningful analytical differences.

29. TASK LIMIT

The same principle applies to tasks.

The scheduler should avoid uncontrolled task generation.

New tasks should be created only when they have a meaningful research purpose.

30. TASK DEDUPLICATION

Before creating a new task, the engine checks whether an existing task already addresses substantially the same objective.

If equivalent:

- Reuse the existing task
- Extend it if necessary
- Or create a new version only when the research context materially differs

This prevents duplicate research.

31. RESEARCH CONVERGENCE

The scheduler should recognize when independent branches begin converging.

Example:

Macro evidence
+
News evidence
+
Market structure evidence

all support the same explanation.

At this point the scheduler may:

- Reduce redundant investigation
- Increase synthesis work
- Run targeted contradiction checks
- Move toward judgment

32. RESEARCH DIVERGENCE

The scheduler should recognize when branches produce materially different conclusions.

Example:

Macro branch → explanation A

Market structure branch → explanation B

News branch → explanation C

The scheduler may:

- Increase evidence validation
- Create comparison tasks
- Test competing hypotheses
- Investigate missing evidence
- Reduce confidence
- Delay final judgment

33. SYNTHESIS PRIORITY

Synthesis becomes a high-priority task when:

- Required branches are sufficiently complete
- Evidence is converging
- Major conflicts are understood
- The research objective can be answered

The scheduler should not synthesize prematurely when major evidence paths remain unresolved.

34. EARLY SYNTHESIS

Partial synthesis may occur before the full investigation ends.

This can identify:

- Missing evidence
- Contradictions
- New hypotheses
- Weak branches
- Important relationships

Partial synthesis is not necessarily the final judgment.

35. STOPPING CONDITIONS

The scheduler should stop research when:

- Success criteria are satisfied
- Required evidence has been gathered
- Major alternatives have been considered
- Additional research has low expected information value
- Requested depth has been reached
- Hard constraints prevent further research

The existence of additional possible information does not justify indefinite research.

36. EARLY STOPPING

The scheduler may stop a branch early when:

- It has sufficiently answered its objective
- Additional evidence is unlikely to change the result
- The branch is no longer relevant
- Another branch has become materially more important

37. RESEARCH EXPANSION

The scheduler may expand research when:

- A critical evidence gap appears
- A new material hypothesis emerges
- A major contradiction appears
- The current conclusion is too uncertain
- A previously ignored domain becomes relevant
- New evidence changes the expected value of further investigation

38. COMPLETION CASCADE

When a task completes:

1. Store result.
2. Update evidence/claims/hypotheses.
3. Recalculate affected dependencies.
4. Unlock dependent tasks.
5. Recalculate branch priorities.
6. Recalculate overall research progress.
7. Determine whether replanning is necessary.

This allows the scheduler to continuously progress through the research graph.

39. DEPENDENCY UNLOCK

When a dependency is satisfied:

BLOCKED TASK
→ DEPENDENCY SATISFIED
→ READY
→ PRIORITY EVALUATION
→ SCHEDULE

A newly unlocked task does not automatically execute if another higher-value task should run first.

40. PRIORITY REASSESSMENT

After every material result, the scheduler may reassess:

- Task priority
- Branch priority
- Resource allocation
- Research depth
- Dependencies
- Completion criteria
- Need for new research

Minor results should not trigger unnecessary global replanning.

41. MATERIALITY FILTER

Not every event should trigger scheduler-wide adaptation.

Materiality depends on whether the event could affect:

- Research objective
- Major claim
- Leading hypothesis
- Current judgment
- Thesis
- Completion criteria
- Critical dependency

Minor changes remain local.

42. TRADER OVERRIDE

The trader may explicitly override scheduling.

Examples:

"Prioritize macro."

"Ignore the technical branch."

"Research the regulatory angle first."

"Don't spend more time on sentiment."

"Run these three investigations in parallel."

Explicit trader instructions override ordinary scheduling preferences, subject to hard system constraints and safety/integrity requirements.

43. AUTOMATIC VS EXPLICIT CONTROL

Ordinary scheduling is automatic.

The trader does not need to approve every task.

Explicit confirmation is reserved for consequential actions already defined elsewhere, such as:

- Persistent framework changes
- Persistent preference changes
- Monitor activation
- Permanent deletion
- Other consequential state changes

44. SCHEDULER TRANSPARENCY

The trader should be able to ask:

"Why are you researching this?"

"Why did you stop that branch?"

"Why is this branch prioritized?"

"What are you waiting for?"

"What changed?"

The system should explain the major scheduling decision using:

- Research objective
- Evidence
- Hypothesis relevance
- Dependency
- Expected information value
- Constraints

45. PROGRESS REPRESENTATION

The default workspace should show meaningful progress rather than raw task counts.

Useful progress information includes:

- Current research objective
- Active branches
- Completed major areas
- Current leading hypotheses
- Major unresolved questions
- Current judgment status
- Important blockers

Raw internal scheduler state may be available on demand.

46. SCHEDULER HISTORY

Material scheduling changes should preserve:

- Previous priority
- New priority
- Reason
- Trigger
- Timestamp
- Affected task/branch
- Result

This supports auditability and research traceability.

47. EXECUTION FAIRNESS

The scheduler should avoid starving a potentially important branch indefinitely.

If one branch continually dominates resources, the system should reassess whether:

- Its expected value remains high
- Other branches contain unresolved material uncertainty
- Exploration is being neglected

Resource allocation should remain evidence-driven.

48. RESEARCH BALANCE

The scheduler balances:

- Depth
- Breadth
- Speed
- Evidence quality
- Contradiction testing
- Alternative explanations
- Resource efficiency

No single dimension should dominate automatically.

49. FINAL EXECUTION LOOP

The scheduler operates as:

PLAN
→ IDENTIFY READY WORK
→ CHECK DEPENDENCIES
→ PRIORITIZE
→ ALLOCATE RESOURCES
→ EXECUTE
→ INGEST RESULT
→ UPDATE OBJECT GRAPH
→ REASSESS MATERIALITY
→ REPRIORITIZE
→ UNLOCK DEPENDENCIES
→ REPLAN WHEN NECESSARY
→ CONTINUE OR COMPLETE

50. GLOBAL SCHEDULER PRINCIPLES

1. Scheduling is adaptive, not FIFO.

2. The highest-value research should receive attention first.

3. Dependencies determine when work becomes executable.

4. Independent research should run in parallel when useful.

5. Dependent research should run sequentially.

6. Conditional research should activate only when warranted.

7. Resources should follow expected information value.

8. New evidence can change scheduling decisions.

9. Branch priorities can change during research.

10. Research should balance exploration and confirmation.

11. Contradictory evidence receives appropriate attention.

12. High-impact uncertainty receives more research effort.

13. Completed work is preserved.

14. Failed tasks do not automatically fail the entire research.

15. Tool and Skill failures trigger recovery rather than fabricated results.

16. Hard constraints are always respected.

17. Trader instructions can override ordinary scheduling preferences.

18. Material scheduler decisions remain traceable.

19. The scheduler should stop when additional research is unlikely to materially improve the answer.

20. The goal is not maximum research.

21. The goal is sufficient, high-quality research that produces the strongest defensible judgment for the trader's question.
