---
title: "RESEARCH EXECUTION ENGINE"
source: RESEARCH EXECUTION ENGINE.txt
converted: 2026-09-12
type: architecture-spec
related: [research-planning.md, execution-scheduler.md, tool-skill-orchestration.md, quality-control.md]
---

**Related documents:** `research-planning.md` · `execution-scheduler.md` · `tool-skill-orchestration.md` · `quality-control.md`

> Converted from `RESEARCH EXECUTION ENGINE.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

RESEARCH EXECUTION ENGINE

PURPOSE

The Research Execution Engine is the execution layer between the trader's natural-language request and the final research judgment.

It converts a trader request into an adaptive research process that can interpret intent, resolve context, select the correct research flow, plan the investigation, orchestrate tools and Skills, collect and evaluate evidence, form and test claims and hypotheses, adapt when new information changes the direction of research, synthesize findings, produce a judgment, update workspace state, and optionally hand the result to CHALLENGE, MONITOR, or SAVE.

The engine is not a rigid waterfall.

Research may change direction when evidence warrants it:

Evidence → new claim/hypothesis → affected branch changes → replan → further investigation → analysis → updated judgment.

The trader remains the final decision-maker. The agent owns the burden of research execution.

CORE EXECUTION PIPELINE

NATURAL LANGUAGE REQUEST
→ REQUEST INTAKE
→ INTENT & CONTEXT RESOLUTION
→ TARGET RESOLUTION
→ RESEARCH FLOW SELECTION
→ RESEARCH PLAN
→ SCOPE / DEPTH / CONSTRAINTS
→ TOOL + SKILL ORCHESTRATION
→ EVIDENCE COLLECTION
→ CLAIM MANAGEMENT
→ HYPOTHESIS MANAGEMENT
→ ADAPTIVE INVESTIGATION
→ ANALYSIS
→ JUDGMENT SYNTHESIS
→ CONFIDENCE + UNCERTAINTY
→ WORKSPACE / GRAPH UPDATE
→ COMPLETION ASSESSMENT
→ OPTIONAL CHALLENGE / MONITOR / SAVE

This pipeline is directional rather than strictly sequential. Any stage may trigger a justified return to an earlier stage when new information materially changes the research.

1. REQUEST INTAKE

The engine receives natural language as the primary control surface.

The request may contain:

* A research question
* An asset or entity
* An event
* A thesis
* A position or expected outcome
* A timeframe
* A requested scope
* A preferred depth
* Constraints
* A research framework
* A request to challenge existing research
* A request to continue previous research
* A request to modify active research
* A request to save or monitor something

The engine must preserve the trader's original wording as the original research objective.

The original request should not be silently rewritten into a different objective.

2. INTENT & CONTEXT RESOLUTION

The engine determines what the trader is actually asking and which research flow or universal action applies.

It resolves:

* Intent
* Research question type
* Analytical intent
* Target
* Asset/entity
* Event
* Timeframe
* Current research context
* Active thesis
* Relevant prior research
* Relevant framework
* Relevant memory
* Constraints
* Trader preferences
* Requested depth
* Requested scope

The engine should distinguish between explicit information and inferred information.

When interpretation is uncertain but not materially consequential, the agent may proceed with the most reasonable interpretation and briefly state it.

When ambiguity could materially change the research, the engine must ask for clarification.

3. TARGET RESOLUTION

The engine determines exactly what the research is about.

Resolution priority:

1. Explicit target in the current request
2. Active research context
3. Current conversation context
4. Relevant persistent memory
5. Clarification when material ambiguity remains

The resolved target may include:

* Assets
* Tokens
* Markets
* Events
* Companies
* Protocols
* People
* Macro variables
* Relationships
* Thesis claims
* Positions
* Framework factors
* Historical cases

The engine records how the target was resolved and its confidence.

4. RESEARCH FLOW SELECTION

The engine maps the request to the appropriate research flow.

Supported primary flows:

1. WHAT HAPPENED?
2. WHY DID IT HAPPEN?
3. WHAT COULD AFFECT IT?
4. DOES MY THESIS HOLD?
5. HAS THIS HAPPENED BEFORE?
6. WHAT DOES ALL THE INFORMATION SAY?
7. WHAT COULD PROVE ME WRONG?
8. EVALUATE ACCORDING TO MY FRAMEWORK

The universal execution engine remains responsible for execution mechanics.

Each flow provides specialized research requirements, hypotheses, evidence expectations, completion criteria, and output structure.

A request may invoke more than one flow when necessary.

For example:

"Why did BTC fall and what could affect it next?"

may begin as WHY DID IT HAPPEN? and then extend into WHAT COULD AFFECT IT?

The engine should not force every request into one isolated flow when the trader's intent clearly requires multiple connected investigations.

5. RESEARCH OBJECT CREATION

When a new investigation begins, the engine creates or restores a RESEARCH object.

The research object contains:

* Objective
* Question
* Intent
* Flow
* Target
* Scope
* Depth
* Constraints
* Context
* Status
* Priority
* Branches
* Claims
* Evidence
* Hypotheses
* Analyses
* Judgments
* Active branch
* Current judgment
* Timestamps
* Provenance
* History

Existing research should be reused when the trader is clearly continuing or modifying an existing investigation.

A materially different intent creates a new active research direction while preserving previous research as historical context.

6. RESEARCH PLAN

The engine creates a research plan appropriate to the complexity of the task.

Simple requests may begin immediately without exposing a detailed plan.

Complex investigations should maintain a living research plan.

The plan may contain:

* Research objectives
* Subquestions
* Investigation branches
* Required evidence
* Candidate hypotheses
* Required Skills
* Required data sources
* Tool strategy
* Research depth
* Branch priorities
* Dependencies
* Completion criteria

The plan is a living control surface rather than a fixed checklist.

New evidence may:

* Add a branch
* Remove an unnecessary branch
* Change branch priority
* Increase or decrease depth
* Introduce a new hypothesis
* Change required evidence
* Change tool selection
* Change the investigation sequence

Completed and unaffected work must be preserved.

7. SCOPE, DEPTH & CONSTRAINTS

The engine resolves:

SCOPE

* Included domains
* Excluded domains
* Entities
* Markets
* Timeframes
* Geographic or regulatory boundaries
* Research boundaries

DEPTH

* Requested depth
* Minimum depth
* Maximum depth
* Resolved depth
* Adaptive depth

CONSTRAINTS

* Hard constraints
* Trader preferences
* Time limits
* Tool limitations
* Data availability
* Explicit exclusions

The engine may dynamically increase or decrease research depth when evidence warrants it, unless the trader has established a hard limit.

Internal depth levels may be represented as:

* Quick
* Standard
* Deep
* Exhaustive

These are execution concepts and do not need to be exposed unless useful.

8. FULL ADAPTIVE TOOL & SKILL ORCHESTRATION

The engine uses FULL ADAPTIVE ORCHESTRATION.

The agent chooses:

* Appropriate Bitget Skills
* Data sources
* External tools
* Research sequence
* Parallel investigations
* Evidence-gathering strategy
* Cross-validation strategy
* Research depth
* Branch allocation
* When additional tools or Skills are necessary

The research flow defines the objective and required capabilities, but it does not rigidly prescribe the exact tool sequence.

The agent may use multiple Skills when the research question crosses domains.

Relevant Bitget Skills include:

* macro-analyst
* market-intel
* news-briefing
* sentiment-analyst
* technical-analysis

The engine may select one or several of them depending on the research.

The agent may also select additional data sources or tools when the available Skills are insufficient.

The agent may execute independent investigations in parallel when this improves research quality or efficiency.

The agent may execute sequentially when one investigation depends on another.

The trader can steer or override orchestration through natural language.

Examples:

"Focus more on macro."

"Ignore social sentiment."

"Go deeper on derivatives."

"Use only information from the last week."

"Check whether the same pattern occurred in previous cycles."

The engine incorporates clear steering into the active plan.

9. TOOL EXECUTION STRATEGY

The engine determines whether a task should be:

* Sequential
* Parallel
* Conditional
* Iterative
* Repeated for cross-validation

Independent branches should be investigated in parallel when appropriate.

Dependent branches should wait for the information they require.

Research should avoid unnecessary duplicate work.

When one source or tool provides insufficient evidence, the engine may seek independent corroboration.

When a tool fails, returns insufficient data, or produces unreliable information, the engine should adapt rather than fabricate an answer.

10. EVIDENCE COLLECTION

All material retrieved information enters the evidence-management layer.

Each evidence object should preserve:

* Observation
* Evidence type
* Source
* Timestamp
* Publication time
* Retrieval time
* Directness
* Reliability
* Recency
* Specificity
* Corroboration
* Interpretation
* Status
* Provenance

The engine distinguishes:

FACT / OBSERVATION
from
INTERPRETATION
from
HYPOTHESIS
from
SPECULATION.

Evidence should be connected to the claims and hypotheses it supports or contradicts.

Evidence should never become a conclusion merely because it was retrieved.

11. EVIDENCE QUALITY ASSESSMENT

Evidence is evaluated according to factors such as:

* Source quality
* Provenance
* Directness
* Recency
* Specificity
* Corroboration
* Reliability
* Conflicts of interest
* Observation versus interpretation
* Consistency with independent evidence

Evidence quality is claim-specific.

The same source may be strong evidence for one claim and weak evidence for another.

The engine must not treat source reputation alone as sufficient evidence quality.

12. CLAIM MANAGEMENT

Claims represent propositions that the research is attempting to establish, weaken, or evaluate.

Claims may be:

* Supported
* Contradicted
* Partially supported
* Unresolved
* Resolved

Each important claim should maintain links to relevant evidence and hypotheses.

The engine should prioritize claims according to their importance to the research objective.

Minor claims should not consume disproportionate research resources.

13. HYPOTHESIS MANAGEMENT

The engine creates hypotheses when the research requires explanatory or interpretive reasoning.

Hypotheses are living objects.

They may be:

* Candidate
* Under investigation
* Leading
* Supported
* Weakened
* Rejected
* Inconclusive
* Historical

Hypotheses are ranked according to available evidence and confidence.

The engine must actively consider relevant alternative explanations.

A hypothesis should not become the leading explanation simply because it was discovered first.

New evidence can:

* Strengthen a hypothesis
* Weaken it
* Reject it
* Change its ranking
* Introduce a competing hypothesis

Previous hypotheses remain available in history.

14. ADAPTIVE INVESTIGATION

Adaptive investigation is a core property of the engine.

The agent continuously evaluates whether current evidence is sufficient to answer the research objective.

If evidence supports the current direction:

→ continue and deepen where useful.

If evidence weakens the current direction:

→ investigate alternatives.

If a new material explanation appears:

→ create a new hypothesis or branch.

If a branch becomes low-value:

→ reduce its priority or pause it.

If evidence contradicts a major assumption:

→ replan the affected research.

If the research objective is already sufficiently resolved:

→ stop unnecessary investigation.

The engine must not continue researching indefinitely merely because additional information exists.

Research continues while additional investigation has a reasonable possibility of materially improving or changing the judgment.

15. BRANCH MANAGEMENT

Complex research may contain multiple investigation branches.

Branches may represent:

* Candidate explanations
* Different domains
* Competing hypotheses
* Independent evidence paths
* Historical comparisons
* Alternative interpretations

The engine may:

* Create branches
* Prioritize branches
* Pause branches
* Resume branches
* Clone branches
* Reallocate resources
* Cancel explicitly unnecessary branches
* Archive completed branches

When branch capacity is reached, the system may automatically pause the lowest-priority branch if the choice is unambiguous.

Otherwise it asks the trader.

Unrelated branches should not be affected by changes to another branch.

16. REPLANNING

Replanning occurs when material new information changes the expected value or direction of research.

Triggers include:

* Strong contradictory evidence
* New leading hypothesis
* Major target clarification
* Material scope change
* Material constraint change
* Tool/data failure
* Discovery of an important missing domain
* Research objective change
* Completion of a major branch
* Significant change in confidence

Replanning should preserve completed research.

The engine should not restart from zero unless explicitly required.

17. INTERRUPTION & TRADER STEERING

The trader may interrupt active research through natural language.

Examples:

"Stop looking at sentiment and focus on macro."

"Go deeper on the SEC angle."

"Actually, I want to know whether this happened before."

"Challenge the explanation you currently have."

"Ignore that hypothesis."

"Compare this with ETH instead."

The engine determines the affected portion of research.

Only affected branches should be interrupted or replanned where possible.

Unrelated completed or active work should be preserved.

A material intent change replaces the active plan while preserving the previous research as historical context.

18. ANALYSIS

Once sufficient evidence exists, the engine performs ANALYZE.

Analysis may use:

* Compare
* Explain
* Interpret
* Synthesize

The engine may conduct additional research if the evidence is insufficient for the requested analysis.

Universal analytical output:

* Primary judgment
* Supporting evidence
* Opposing evidence
* Key findings
* Important relationships
* Uncertainty
* Confidence

Analysis should remain neutral by default.

When a thesis, position, or belief is explicitly relevant, analysis may become thesis-aware while still actively seeking contradictory evidence.

19. CONFLICTING EVIDENCE

Conflicting evidence must not be hidden.

The engine should evaluate the conflict using:

* Evidence quality
* Directness
* Recency
* Specificity
* Corroboration
* Provenance
* Reliability
* Context

If one side is clearly stronger, the engine may resolve the conflict while preserving the weaker evidence.

If the conflict cannot be resolved:

* Preserve both sides
* Reduce confidence when material
* Explain the uncertainty
* Conduct additional research when useful

The engine must never manufacture certainty to make the result cleaner.

20. JUDGMENT SYNTHESIS

The engine produces a JUDGMENT when sufficient research has been completed.

A judgment is the system's current best-supported assessment.

It contains:

* Primary statement
* Supporting evidence
* Opposing evidence
* Key claims
* Relevant hypotheses
* Confidence
* Uncertainty
* Implications
* Unresolved questions
* Provenance
* Previous judgment reference

There should be one current judgment per research object.

When new material evidence changes the conclusion:

* Create the updated judgment
* Supersede the previous judgment
* Preserve the previous judgment in history
* Record what changed and why

21. CONFIDENCE & UNCERTAINTY

Confidence should normally be qualitative:

* High
* Moderate
* Low

Confidence must reflect evidence quality and conclusion robustness.

Uncertainty should explicitly describe:

* Missing evidence
* Conflicting evidence
* Weak assumptions
* Alternative explanations
* Data limitations
* Unknown future conditions

Confidence is not a substitute for reasoning.

The engine should explain the major factors behind confidence when useful.

22. COMPLETION CRITERIA

Research is complete when its success criteria have been sufficiently satisfied.

Completion may occur when:

* The question has a defensible answer
* Required evidence has been gathered
* Important competing explanations have been evaluated
* Remaining uncertainty is unlikely to materially change the conclusion
* Available research has been reasonably exhausted
* The requested depth has been reached
* A hard constraint prevents further useful research

Completion does not mean certainty.

A completed research object may still contain unresolved uncertainty.

23. INSUFFICIENT INFORMATION

When available evidence is insufficient, the engine should clearly distinguish:

* What is known
* What was researched
* What remains uncertain
* What information is unavailable
* What additional research could potentially resolve the uncertainty

The engine must never silently fill missing information with assumptions.

If the requested answer cannot be responsibly established, the judgment should state that limitation.

24. STATE & GRAPH UPDATE

After meaningful research execution, the engine updates the workspace and object graph.

It may create or update:

* Research
* Branches
* Claims
* Evidence
* Hypotheses
* Analyses
* Judgment
* Relationships
* Dependencies
* Provenance
* History
* Annotations

Core relationship chain:

SOURCE
→ EVIDENCE
→ CLAIM
→ HYPOTHESIS
→ ANALYSIS
→ JUDGMENT
→ THESIS
→ MONITOR
→ NEW EVIDENCE
→ REASSESSMENT

The engine preserves provenance throughout this chain.

State changes must not destroy historical research.

25. DEPENDENCY PROPAGATION

When a material object changes, the engine identifies connected dependent objects.

It determines:

* Which objects depend on the changed object
* Whether the dependency is material
* Which states require revalidation
* Which judgments may be affected
* Which hypotheses may be affected
* Whether a thesis requires reassessment
* Whether monitoring conditions remain valid

Only materially affected objects should be propagated.

Unrelated research remains untouched.

Previous states remain available in history.

Circular relationships are allowed where legitimate, but propagation loops must be controlled using a propagation event and path so the same object is not repeatedly processed for the same material change.

26. THESIS INTERACTION

Research may inform a trader's THESIS.

The engine may:

* Support a thesis
* Weaken a thesis
* Identify contradictions
* Identify missing evidence
* Suggest a possible revised thesis
* Recommend CHALLENGE

The engine must never silently rewrite or replace the trader's thesis.

The trader remains responsible for adopting, changing, or rejecting a thesis.

27. FRAMEWORK INTERACTION

When the request involves a trader's framework, the engine uses the framework exactly as defined.

A framework may contain:

* Factors
* Conditions
* Evidence required
* Weight
* Threshold
* Evaluation rule

The engine must preserve framework integrity.

If the framework appears inconsistent, incomplete, or produces an unexpected result, the engine flags the issue rather than silently modifying the framework.

Persistent framework changes require confirmation.

28. PROGRESSIVE DISCLOSURE

The engine should present the result at the appropriate level first.

Default result:

* Primary judgment
* Key supporting evidence
* Key opposing evidence
* Confidence
* Important uncertainty
* Important implications

Deeper detail should be available on demand:

* Research plan
* Branches
* Claims
* Evidence
* Sources
* Hypotheses
* Reasoning trail
* Conflicting evidence
* State changes
* Provenance

The trader should not be forced to read the entire research trace to understand the conclusion.

29. RESEARCH TRACEABILITY

Every material conclusion must be traceable through the research graph.

The trader should be able to move from:

Judgment
→ Hypothesis
→ Claim
→ Evidence
→ Source

and, where relevant:

Judgment
→ Thesis
→ Framework
→ Monitor.

Traceability should be available without overwhelming the default interface.

30. ERROR & FAILURE HANDLING

If a tool fails:

* Record the failure when material
* Try an appropriate alternative when available
* Replan if necessary
* Reduce confidence if the failure materially limits research
* Never fabricate unavailable results

If a source is inaccessible:

* Mark it unavailable
* Seek independent evidence when useful
* Preserve the limitation

If a Skill produces insufficient output:

* Use another appropriate Skill or data source
* Do not treat insufficient output as evidence

31. RESEARCH RESTORATION

When continuing previous research, the engine restores the relevant research state.

It retrieves:

* Original objective
* Previous plan
* Current branches
* Previous evidence
* Hypotheses
* Previous judgments
* Thesis context
* Framework context
* Monitor context
* Relevant memory

The engine then evaluates freshness.

Historical research should not automatically become current evidence.

Old evidence must be revalidated when freshness materially affects the current question.

32. RESEARCH MEMORY

Relevant prior research may inform execution.

Memory retrieval is context-aware and prioritizes:

* Current research context
* Same thesis
* Same framework
* Relevant prior judgments
* Relevant hypotheses
* Strong historical parallels
* Durable trader preferences

Retrieved memory must be clearly distinguished from current evidence.

Memory labels may include:

* CURRENT
* HISTORICAL
* PREFERENCE
* PRIOR JUDGMENT
* PRIOR HYPOTHESIS
* FRAMEWORK

Historical information informs current research but does not silently become current evidence.

33. MONITOR HANDOFF

When research identifies a meaningful condition worth watching, the engine may recommend MONITOR.

Monitoring should remain connected to:

* Original research
* Thesis
* Judgment
* Hypotheses
* Evidence
* Invalidation conditions
* Relevant signals
* Research context

The engine may propose monitoring automatically when appropriate.

Activation of a persistent monitor requires explicit trader confirmation.

A monitor should reassess the original research context when meaningful new evidence appears.

34. CHALLENGE HANDOFF

The engine may recommend CHALLENGE when:

* A thesis has meaningful weaknesses
* Evidence conflicts materially
* An important assumption is unsupported
* An alternative explanation is strong
* A high-risk invalidation condition appears
* Confidence is lower than expected
* New evidence materially changes the research direction

CHALLENGE should test the current thesis rather than merely generate generic objections.

35. SAVE HANDOFF

The engine may recommend SAVE when research produces a reusable artifact or knowledge object.

Examples:

* Completed research
* Current judgment
* Historical analysis
* Framework
* Snapshot
* Reusable thesis
* Research artifact

Normal workspace state and history are persisted automatically.

Explicit SAVE is used when the trader intentionally wants to preserve something as a reusable artifact or persistent knowledge.

Consequential persistent saves require confirmation.

36. NATURAL LANGUAGE CONTROL

Natural language is the primary control interface.

The trader does not need to learn rigid commands.

Examples:

"Go deeper."

"Focus only on macro."

"Challenge that."

"Compare it with ETH."

"Use my usual framework."

"Continue the research from yesterday."

"Ignore sentiment."

"Save this."

"Watch for anything that would invalidate this."

The LUI layer maps these requests into internal actions such as:

RESEARCH
ANALYZE
CHALLENGE
MANAGE_STATE
MONITOR
SAVE

The internal action taxonomy is structured, but the trader does not need to speak in structured commands.

37. ACTION COMBINATION

Multiple universal actions may occur in one request.

Examples:

"Research why BTC dropped and challenge the explanation."

→ RESEARCH + CHALLENGE

"Compare this with previous cycles and tell me whether my thesis still holds."

→ RESEARCH + ANALYZE + CHALLENGE / thesis validation

"Find what could affect this next and watch for the important ones."

→ RESEARCH + MONITOR recommendation/activation boundary

"Evaluate this using my framework and save the result."

→ RESEARCH + ANALYZE + SAVE

The engine determines the appropriate execution order.

38. TRADER DECISION BOUNDARY

The agent owns research execution.

The trader owns consequential decisions.

The engine may:

* Research
* Analyze
* Challenge
* Replan
* Update research state
* Identify implications
* Recommend monitoring
* Recommend next steps

The engine must not:

* Trade on behalf of the trader without an explicitly authorized execution system
* Silently change a persistent thesis
* Silently change a persistent framework
* Activate consequential monitoring without confirmation
* Permanently delete research
* Hide material uncertainty
* Present speculation as fact

39. PERSISTENCE & HISTORY

Normal research execution automatically maintains workspace state and history.

Material changes preserve previous states.

Explicit SAVE creates intentionally reusable persistent artifacts.

Versioning applies when material changes occur to versioned objects.

Deletion is reversible by default.

Permanent deletion requires explicit confirmation.

Historical research remains available unless explicitly removed.

40. GLOBAL EXECUTION PRINCIPLES

41. Natural language is the control surface.

42. The agent owns the burden of research execution.

43. The research flow determines the objective; the execution engine determines how to investigate it.

44. Tool and Skill orchestration is fully adaptive.

45. The agent may choose tools, Skills, sources, sequencing, parallelization, and research depth dynamically.

46. The trader can steer or override execution naturally.

47. Research is evidence-driven rather than confirmation-driven.

48. New evidence may change the direction of research.

49. Completed and unaffected research is preserved when replanning.

50. Evidence, claims, hypotheses, analyses, judgments, and sources remain traceable.

51. Conflicting evidence is preserved rather than hidden.

52. Confidence reflects uncertainty and evidence quality.

53. Historical information is never silently treated as current evidence.

54. The trader remains the final decision-maker.

55. Persistent and consequential actions have explicit confirmation boundaries.

56. Research can continue into ANALYZE, CHALLENGE, MONITOR, or SAVE when appropriate.

57. The system should stop when additional research is unlikely to materially improve the answer.

58. The engine is adaptive rather than a rigid waterfall.

59. The workspace is persistent and reversible.

60. The fundamental research loop is:

QUESTION
→ RESEARCH
→ EVIDENCE
→ HYPOTHESES
→ ANALYSIS
→ JUDGMENT
→ THESIS
→ MONITOR
→ NEW EVIDENCE
→ REASSESSMENT

The Research Execution Engine exists to make this loop operational, adaptive, traceable, and controllable through natural language.
