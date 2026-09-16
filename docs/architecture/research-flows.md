---
title: "Below is the consolidated version of the 8 locked research flows. This is the version to save as the canonical product-design reference."
source: researchflows.txt
converted: 2026-09-12
type: architecture-spec
related: [core-principles.md, lui-universal-core.md]
---

**Related documents:** `core-principles.md` · `lui-universal-core.md`

> Converted from `researchflows.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

Below is the consolidated version of the 8 locked research flows. This is the version to save as the canonical product-design reference.
AI Trading Desk — 8 Core Research Flows
Product Principle
The workbench is not eight separate products. It is one natural-language research workbench with eight specialized research behaviors.
The trader speaks naturally. The system identifies the type of research required, constructs an appropriate investigation, uses relevant data/tools, maintains a living research workspace, synthesizes evidence, and produces a decision-ready judgment.
The trader remains the final decision-maker.
The eight flows are:

What happened?
Why did it happen?
What could affect it?
Does my thesis hold?
Has this happened before?
What does all the information say?
What could prove me wrong?
Evaluate this according to my framework.


FLOW 1 — WHAT HAPPENED?
Purpose
Reconstruct and explain a market event.
This flow answers:

“Something happened. What actually happened, and what best explains it?”

It is primarily event reconstruction, not deep causal investigation.
Example

“BTC just moved 7% in the last few hours. What happened?”

Step 1 — Natural-language question
The trader asks the question normally.
The agent extracts:

Asset
Event
Magnitude
Timeframe
Relevant context
Research intent

The trader does not need to manually configure these.
Step 2 — AI proposes a research plan
The agent presents its intended investigation.
For example:

Establish exactly what happened.
Build the event timeline.
Identify major contemporaneous developments.
Examine candidate drivers.
Cross-check market/data sources.
Identify contradictions.
Determine the strongest-supported explanation.

The trader can modify the plan naturally.
For example:

“Ignore social media sentiment and focus on derivatives and macro.”

The agent modifies the investigation accordingly.
Step 3 — Investigation
The agent conducts the research.
It should not simply retrieve one article and summarize it.
It should:

Cross-check information.
Compare timestamps.
Examine related market movements.
Search for competing explanations.
Distinguish facts from interpretations.
Look for contradictory evidence.

Step 4 — Living research workspace
Research is continuously organized into a structured workspace.
Possible sections:

Event
Timeline
Evidence
Candidate Drivers
Evidence Strength
Contradictions
Current Judgment

The trader can interrogate the workspace naturally.
For example:

“Why did you rank the ETF news above the liquidation data?”

Step 5 — Synthesis
The system produces:

Strongest-supported explanation
Key evidence
Relevant contradictions
Confidence level

The answer leads with the strongest-supported judgment.
It does not unnecessarily dump every possible explanation on the trader.
Evidence standard
The agent must distinguish:
Fact → Inference → Speculation
Low-confidence behavior
Low confidence cannot simply mean:

“There isn't enough information.”

The agent must first expand its investigation.
It can:

Broaden sources.
Check additional datasets.
Investigate alternatives.
Cross-check timestamps.
Compare related markets.
Search for contradictions.

Only after meaningful investigation should it conclude that evidence remains insufficient.
Final sequence
Natural-language question → Intent understanding → AI research plan → Trader modification/approval → Investigation → Living research workspace → Evidence synthesis → Strongest-supported explanation → Confidence → Trader decides

FLOW 2 — WHY DID IT HAPPEN?
Purpose
Investigate causality, rather than merely reconstructing an event.
The central question is:

“What caused this?”

Example

“Why did BTC crash after the CPI release?”

Step 1 — Define the event
The agent establishes:

What happened?
When?
What needs to be explained?

Step 2 — Candidate-cause map
Instead of immediately choosing one explanation, the agent generates a map of plausible causes.
For example:

Macro
News
Positioning
Derivatives
Liquidity
Market structure
On-chain activity
Regulatory developments
Related assets
Technical conditions

The exact structure depends on the event.
Step 3 — Parallel investigation
The agent investigates relevant branches concurrently.
It does not investigate one hypothesis from beginning to end before considering the others.
Step 4 — Adaptive research depth
The initial investigation is broad.
As evidence appears:

Strong hypotheses receive deeper investigation.
Weak hypotheses receive less attention.
New evidence can create new branches.

The investigation dynamically reallocates research effort.
Step 5 — Test causal relationships
The agent asks whether the evidence actually supports causation.
It distinguishes:

Correlation
Temporal association
Plausible mechanism
Strong causal evidence

Step 6 — Active falsification
The agent actively searches for evidence that weakens its leading explanation.
This happens by default.
Step 7 — Dynamic hypothesis branching
If new evidence weakens the leading explanation:

Preserve the existing research.
Branch into the new explanation.
Investigate it.
Compare the branches.
Continue branching if warranted.

The agent does not throw away earlier work.
Step 8 — Resolve conflicting evidence
If evidence conflicts, the agent resolves the conflict itself where possible.
The default behavior is not:

“Here are two explanations. You decide.”

Instead, it determines which explanation is better supported and explains why.
Step 9 — Event-specific causal structure
The agent should not force every event into:

Trigger → Driver → Amplifier

That structure may be useful sometimes, but the agent chooses the causal structure appropriate to the event.
Step 10 — Final judgment
Output:

Primary causal explanation
Supporting evidence
Important competing explanations
Evidence that weakened alternatives
Confidence

The detailed reasoning remains accessible.
Progressive traceability
Default:

Judgment

Trader can ask:

“Show me why.”

Then the underlying hypotheses, evidence, and reasoning become visible.
Workspace
Two synchronized views:
Hypothesis Tree
Shows:

Hypotheses
Branches
Evidence
Strength
Relationships

Research Workspace
Shows:

Sources
Evidence
Timeline
Findings
Contradictions
Conclusions

Final sequence
Natural-language question → Event definition → Candidate-cause map → Parallel investigation → Adaptive research depth → Causal testing → Active falsification → Dynamic branching → Conflict resolution → Event-specific causal structure → Final judgment → Confidence

FLOW 3 — WHAT COULD AFFECT IT?
Purpose
Identify factors that could materially affect an asset, event, position, or thesis.
This is an impact analysis flow.
Example

“What could affect my BTC position over the next few days?”

Step 1 — Adaptive input
The trader can start from:

Asset
Event
Position
Thesis
Market condition
Any other relevant context

The agent adapts to the input.
Step 2 — Discover relevant domains
The agent determines which domains matter.
Potential domains include:

Scheduled events
Emerging signals
Macro
Market structure
Related assets
Correlations
On-chain activity
Regulatory developments
Industry developments
Technical conditions
Derivatives
Liquidity

It should not blindly investigate every domain for every question.
Step 3 — Broad impact discovery
The agent searches broadly internally.
The objective is to avoid missing something important.
Step 4 — Materiality assessment
The agent ranks discovered factors based on their relevance and potential impact.
The workspace should primarily surface material factors.
Lower-ranked factors remain inspectable but do not overwhelm the trader.
Step 5 — Conditional impact analysis
For every material factor, the agent determines:

Potential direction of impact
Potential significance
Conditions under which the impact changes
What evidence would confirm or weaken the expected effect

Thresholds should be derived from the current evidence, expectations, and market context.
The agent should not invent arbitrary thresholds.
Step 6 — Decision-ready synthesis
The output focuses on:

Most important factors
Expected direction
Why they matter
What could change the assessment
Relative importance
Confidence

Step 7 — Optional monitoring handoff
Research ends by default.
If the trader says:

“Keep watching these.”

The agent can convert selected factors into monitoring tasks.
The trader can then modify the monitoring naturally.
Final sequence
Natural-language question → Context interpretation → Broad impact discovery → Materiality assessment → Conditional impact analysis → Relevance filtering → Decision-ready synthesis → Optional monitoring handoff → Trader decides

FLOW 4 — DOES MY THESIS HOLD?
Purpose
Test an existing trader thesis rather than simply confirming it.
This is the workbench's primary thesis validation/stress-testing flow.
Example

“My thesis is that BTC will continue higher because ETF inflows are strong and liquidity is improving. Does it hold?”

Step 1 — Capture the thesis
The agent identifies the trader's actual belief.
It does not assume the thesis is correct.
Step 2 — Decompose the thesis
The agent breaks it into:

Claims
Assumptions
Dependencies
Causal relationships
Expected outcomes

For example:

ETF inflows → demand → reduced available supply → price support

Each link can be tested.
Step 3 — Test individual claims
The agent gathers supporting and disconfirming evidence for each claim.
Step 4 — Test dependencies
A thesis can contain individually true statements but still fail because the relationships between them are weak.
The agent therefore tests:

Does A actually support B?

rather than merely:

Is A true?

Step 5 — Falsification
The agent actively searches for evidence that could invalidate the thesis.
Step 6 — Alternative explanations
The agent always tests alternative explanations that could produce the same expected outcome without the thesis being correct.
For example:

BTC could rise while ETF inflows are strong, but the actual driver might be short covering rather than structural demand.

Step 7 — Apply research framework
The trader can maintain:
Persistent framework
A framework they regularly use.
Or:
Temporary framework
A framework provided specifically for this research task.
Both can be modified through natural language.
Step 8 — Reconstruct the thesis
After testing the individual components, the agent reassesses the thesis as a whole.
Step 9 — Nuanced assessment
The output is not simply:

“Yes.”

or:

“No.”

Instead:

Supported components
Weak assumptions
Contradictions
Causal-chain quality
Alternative explanations
Missing evidence
What evidence would change the assessment
Overall degree of support

Step 10 — Thesis refinement without takeover
If the thesis is weak, the agent can explain:

What needs to change.
Which assumptions are problematic.
What a more defensible interpretation could look like.

But it does not automatically rewrite the trader's thesis.
The trader decides whether to adopt a revised thesis.
Final sequence
Natural-language thesis → Claim decomposition → Claim testing → Dependency testing → Falsification → Alternative explanations → Framework application → Reconstruction → Nuanced assessment → Required changes → Trader decides

FLOW 5 — HAS THIS HAPPENED BEFORE?
Purpose
Use historical precedent to understand the current situation.
The core principle:

Historical precedent informs the present; it does not determine the future.

Example

“Has BTC experienced a similar move after a Fed surprise before?”

Step 1 — Historical case discovery
The agent searches for relevant historical situations.
Step 2 — Hybrid historical matching
Two types of similarity are considered:
Surface similarity
Similar:

Price action
Magnitude
Timing
Market conditions
News/event type

Causal similarity
Similar:

Underlying mechanism
Market structure
Participants
Conditions
Cause/effect relationships

Causal similarity is prioritized because it is more useful than superficial resemblance.
Step 3 — Relevance ranking
The agent identifies a broad set of precedents and ranks them.
Strongest matches receive deeper investigation.
Weaker matches provide contextual background.
Step 4 — Deep investigation
For the strongest precedents, the agent reconstructs:

What happened
Why it happened
What conditions existed
What happened afterward
Which factors mattered

Step 5 — Counterexample search
The agent always searches for historical cases where the apparent pattern failed.
This protects against confirmation bias.
Step 6 — Current-vs-historical comparison
The agent explicitly compares:
Then
vs.
Now
It asks:

Are the conditions actually similar enough for this precedent to matter?

Step 7 — Applicability assessment
Historical evidence is not automatically treated as predictive.
The agent determines whether the precedent is actually applicable.
Step 8 — Forward-looking conclusion
The agent can say something like:

“Historical cases suggest X under conditions A/B/C, but the current situation differs because of D.”

Not:

“This happened before, therefore it will happen again.”

Step 9 — Conflicting precedents
If the strongest precedents conflict, the agent continues researching rather than prematurely choosing one.
Final sequence
Historical question → Broad precedent discovery → Relevance ranking → Deep investigation → Pattern extraction → Counterexample search → Current-vs-historical comparison → Applicability assessment → Forward-looking conclusion → Confidence

FLOW 6 — WHAT DOES ALL THE INFORMATION SAY?
Purpose
Produce a comprehensive cross-domain assessment when the trader wants the broader picture.
This is the multi-source synthesis flow.
Example

“What does everything currently say about BTC?”

Step 1 — Adaptive information scope
The agent determines which information domains are relevant.
Possible domains:

Market data
Macro
News
Sentiment
On-chain
Technicals
Derivatives
Ecosystem developments
Regulatory developments

The agent adapts the scope to the question.
Step 2 — Natural-language modification
The trader can change the scope naturally.
For example:

“Include derivatives but ignore social sentiment.”

The research plan updates accordingly.
Step 3 — Broad investigation
The agent gathers information across the relevant domains.
Step 4 — Cross-domain relationship discovery
The agent looks for meaningful relationships between domains.
For example:

Macro change + derivatives positioning + liquidity conditions

But it should not blindly correlate everything.
A relationship must be contextually meaningful.
Step 5 — Claim-specific evidence weighting
Evidence is not given a universal score independent of context.
The agent evaluates evidence based on factors such as:

Source quality
Provenance
Direct access to underlying information
Recency
Specificity
Corroboration
Potential conflicts of interest
Observation vs interpretation
Speculation

The importance of each factor depends on the claim being tested.
Step 6 — Synthesis
The agent builds one coherent picture.
The output explicitly separates:
Supporting evidence
What supports the primary judgment.
Opposing evidence
What argues against it.
Unresolved uncertainty
What remains genuinely unclear.
Step 7 — Conflict resolution
When sources disagree, the agent investigates the conflict and determines which evidence is more defensible.
Step 8 — Primary judgment
The agent produces one primary judgment.
It does not simply dump ten perspectives on the trader and ask them to synthesize everything themselves.
Step 9 — Confidence
The judgment includes an appropriate confidence assessment.
Final sequence
Natural-language question → Adaptive information scope → Broad investigation → Cross-domain relationship discovery → Claim-specific evidence weighting → Synthesis → Supporting/opposing evidence → Conflict resolution → Primary judgment → Uncertainty + confidence → Trader decides

FLOW 7 — WHAT COULD PROVE ME WRONG?
Purpose
Stress-test what the trader currently believes.
This is the explicit falsification and early-warning flow.
Example

“I'm bullish on BTC. What could prove me wrong?”

Step 1 — Adaptive input
The trader does not need to provide a formal thesis.
The input can be:

Belief
Thesis
Position
Expected outcome
Current interpretation
Strategy assumption

Step 2 — Define failure conditions
The agent determines what would actually make the belief invalid.
Step 3 — Search for invalidating evidence
The agent actively searches for evidence contradicting the belief.
Step 4 — Detect early warnings
The agent looks for meaningful signals that indicate the thesis may be weakening before complete invalidation.
It distinguishes:
Invalidating evidence
The belief is no longer defensible.
Warning signal
The belief may be weakening.
Noise
Information that should not materially change the assessment.
Step 5 — Establish confirmation conditions
For every meaningful warning or potential failure point, the agent determines what observable condition would confirm that the belief has actually become invalid.
These conditions must be based on research.
They should not be arbitrary thresholds.
Step 6 — Reassess
The agent investigates whether current evidence already satisfies any failure conditions.
Step 7 — Falsification assessment
Output includes:

What could invalidate the belief
Current warning signals
Whether any invalidation condition has been reached
What evidence is still missing
Confidence

Step 8 — Optional monitoring
The agent may propose:

“These three conditions are worth monitoring.”

But monitoring does not start automatically.
The trader must explicitly confirm.
Final sequence
Belief/thesis → Define failure conditions → Search for invalidating evidence → Detect meaningful warnings → Establish confirmation conditions → Investigate → Reassess → Falsification assessment → Optional monitoring proposal → Trader confirms

FLOW 8 — EVALUATE THIS ACCORDING TO MY FRAMEWORK
Purpose
Evaluate an asset, thesis, opportunity, or situation according to the trader's personal research framework.
This is the primary personalization flow.
Example

“Evaluate my BTC long according to my framework.”

The trader's framework might be:

“For my BTC longs, I care about liquidity, momentum, macro conditions, and derivatives.”

Step 1 — Natural-language framework
The trader can create or modify a framework through natural language.
For example:

“For my BTC longs, I care about liquidity, momentum, macro conditions and derivatives.”

Step 2 — Structured representation
Although the interface is natural language, the system maintains a structured representation underneath.
Possible framework schema:

Factor
Condition
Evidence required
Weight / importance
Threshold/state
Evaluation rule

This provides reliability and reproducibility.
Step 3 — Define factors
The agent converts the trader's framework into evaluable factors.
Example:
Liquidity
Momentum
Macro
Derivatives
Each becomes an explicit research dimension.
Step 4 — Weighting
Default:
Equal weighting
The trader can explicitly specify weights.
For example:

“Macro is twice as important as technicals.”

The system preserves this distinction:
Importance ≠ Evidence strength
A highly weighted factor with weak evidence does not automatically become strong evidence.
Step 5 — Gather relevant evidence
The agent investigates evidence required by each framework factor.
Step 6 — Evaluate each factor
Each factor is assessed according to its own rules.
For example:

Macro → supportive
Liquidity → neutral
Momentum → weakening
Derivatives → supportive

The actual structure depends on the trader's framework.
Step 7 — Apply framework rules
The system applies the trader's specified rules rather than silently replacing them with generic analysis.
Step 8 — Aggregate assessment
The agent combines the factor-level results according to the framework.
Step 9 — Explain what drives the result
The trader should be able to see:

Which factors are driving the assessment
Which factors are weak
Which factors conflict
Which factors lack evidence

Step 10 — Framework integrity check
The agent is not blindly obedient to the framework.
If the framework itself appears internally inconsistent, or its assumptions strongly conflict with available evidence, the agent:

Applies the framework as defined.
Preserves the original framework-based evaluation.
Flags the inconsistency.
Investigates whether the underlying assumptions should be reconsidered.
Explains how the framework's weakness affects the result.
Does not silently modify the framework.
Leaves the decision to modify it with the trader.

This gives us:

Framework evaluation without framework capture.

Final sequence
Natural-language framework → Structured representation → Define factors → Optional weighting → Gather relevant evidence → Evaluate each factor → Apply framework rules → Aggregate assessment → Explain result drivers → Identify gaps/conflicts → Detect framework weaknesses → Investigate assumptions → Explain implications → Trader decides

The 8 Flows as a Single System
These flows are deliberately different because the research objective changes.


Flow
Core question
Primary research behavior


1
What happened?
Event reconstruction


2
Why did it happen?
Causal investigation


3
What could affect it?
Impact analysis


4
Does my thesis hold?
Thesis validation


5
Has this happened before?
Historical precedent


6
What does all the information say?
Cross-domain synthesis


7
What could prove me wrong?
Falsification/stress testing


8
Evaluate this according to my framework
Personalized framework evaluation


The deeper distinction is:
Flow 1: reconstruct the event.
Flow 2: explain the cause.
Flow 3: identify future influences.
Flow 4: test whether a thesis is defensible.
Flow 5: compare with historical precedent.
Flow 6: synthesize the whole information landscape.
Flow 7: actively attack the trader's belief.
Flow 8: evaluate the situation through the trader's own decision framework.
And across all eight:

The agent researches. The trader steers. The agent synthesizes. The trader decides.

This is the canonical set we can now build the Common Intelligence Layer around.
