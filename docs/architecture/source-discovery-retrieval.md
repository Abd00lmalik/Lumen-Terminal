---
title: "SOURCE DISCOVERY & RETRIEVAL INTELLIGENCE"
source: SOURCE DISCOVERY & RETRIEVAL INTELL.txt
converted: 2026-09-12
type: architecture-spec
related: [source-intelligence.md, evidence-source.md, tool-skill-orchestration.md]
---

**Related documents:** `source-intelligence.md` · `evidence-source.md` · `tool-skill-orchestration.md`

> Converted from `SOURCE DISCOVERY & RETRIEVAL INTELL.txt` on 2026-09-12. Formatting only — architectural content, schemas, and decisions are unchanged.

SOURCE DISCOVERY & RETRIEVAL INTELLIGENCE

## 1. Purpose

Source Discovery & Retrieval Intelligence is the operational layer responsible for finding, selecting, retrieving, validating, and preparing information sources during active research.

It converts research information requirements into concrete source-retrieval operations.

It does not determine the final truth of retrieved information. Source Intelligence evaluates source characteristics and provenance, while Evidence Intelligence evaluates the resulting evidence.

The operational chain is:

RESEARCH REQUIREMENT
→ INFORMATION REQUIREMENT
→ SEARCH STRATEGY
→ SOURCE DISCOVERY
→ CANDIDATE RANKING
→ SOURCE SELECTION
→ RETRIEVAL
→ SOURCE VALIDATION
→ EXTRACTION
→ DEDUPLICATION
→ CROSS-CHECKING
→ EVIDENCE HANDOFF
→ SUFFICIENCY ASSESSMENT
→ CONTINUE / ESCALATE / STOP

The objective is not to retrieve the largest possible amount of information.

The objective is to retrieve sufficient, relevant, reliable, sufficiently independent information to support the strongest defensible research judgment.

---

## 2. Core Principles

### 2.1 Information requirement before search

The system should determine what information is needed before generating searches whenever practical.

An information requirement may specify:

* claim to investigate
* hypothesis to test
* event to reconstruct
* entity
* timeframe
* required source type
* required evidence type
* required specificity
* required freshness
* jurisdiction
* domain
* expected information value
* minimum evidence requirement

Search should serve a research need rather than become an open-ended browsing process.

### 2.2 Search is adaptive

Search strategy changes according to what the system discovers.

The system may:

* broaden a search
* narrow a search
* change terminology
* search a different domain
* search for primary sources
* search for contradictory information
* search for historical material
* search for quantitative confirmation
* search for independent corroboration
* abandon an unproductive query family

### 2.3 Source discovery and source validation are separate

Finding a source does not establish that the source is reliable.

The system first discovers candidate sources, then validates their identity, relevance, provenance, accessibility, freshness, and independence.

### 2.4 Search result count is not evidence strength

Ten sources repeating the same original report do not automatically provide ten independent confirmations.

The system must identify source relationships and common origins.

### 2.5 Primary sources should be preferred when they directly answer the requirement

When a primary source exists and is accessible, it should generally receive priority for factual claims directly originating from that source.

Examples:

* official filings
* protocol documentation
* company announcements
* government releases
* regulatory documents
* blockchain data
* original research
* official economic releases

Secondary sources remain valuable for:

* independent reporting
* interpretation
* context
* discovery of relevant primary sources
* identifying disagreements
* historical reconstruction

### 2.6 Retrieval failure is not contradictory evidence

If a source cannot be accessed, the system records:

> source unavailable

rather than:

> source disproves the claim.

### 2.7 Search must actively resist confirmation bias

When a hypothesis becomes dominant, the system should deliberately search for:

* contradictory evidence
* alternative explanations
* failed historical precedents
* primary-source disagreement
* evidence that would weaken the leading hypothesis

Search should not simply accumulate supporting material.

---

# 3. Information Requirement Model

```text
INFORMATION REQUIREMENT {
  id
  research_ref
  branch_ref
  objective
  claim_refs[]
  hypothesis_refs[]
  target
  question
  entities[]
  event
  timeframe
  required_source_types[]
  preferred_source_types[]
  required_evidence_types[]
  required_specificity
  required_freshness
  jurisdiction
  domains[]
  constraints
  priority
  information_value
  completion_criteria[]
  status
  provenance
  history
}
```

Information requirements may be created by:

* Research Planning
* Scheduler
* Hypothesis Intelligence
* Evidence Intelligence
* Analysis Intelligence
* Challenge
* Monitor
* Framework Evaluation
* user instruction

The requirement should remain connected to the research object that created it.

---

# 4. Search Strategy

The system selects a search strategy based on the information requirement.

Possible strategies include:

### DIRECT SEARCH

Used when the required information is well defined.

Example:

```text
"Federal Reserve September 2026 interest rate decision"
```

### ENTITY SEARCH

Used to identify information surrounding a specific entity.

### EVENT SEARCH

Used to reconstruct a particular event.

### DOCUMENT SEARCH

Used when a specific document or document class is required.

### PRIMARY-SOURCE SEARCH

Used when direct evidence is preferred or secondary reporting needs verification.

### HISTORICAL SEARCH

Used for precedent and historical comparison.

### CONTRADICTION SEARCH

Used to deliberately search for evidence against a claim or hypothesis.

### ALTERNATIVE-EXPLANATION SEARCH

Used when multiple mechanisms could explain the same observation.

### QUANTITATIVE SEARCH

Used when numerical confirmation is required.

### CROSS-DOMAIN SEARCH

Used when the research question requires information from multiple domains.

### FOLLOW-UP SEARCH

Used when an existing source identifies another relevant source, event, entity, document, or claim.

### FRESHNESS SEARCH

Used when previously retrieved information may have changed.

---

# 5. Query Generation

Queries should be generated from the information requirement rather than from arbitrary conversational wording.

Query generation may use:

* entity names
* aliases
* ticker symbols
* protocol names
* event names
* dates
* relevant terminology
* technical terminology
* regulatory terminology
* geographic terminology
* source-specific terminology
* known document titles
* known publisher names
* alternative terminology

The system should generate multiple query formulations when the first formulation has high ambiguity or low retrieval quality.

Query families may include:

```text
PRIMARY TERM
ALIAS
TECHNICAL TERM
EVENT TERM
SOURCE-SPECIFIC TERM
DATE-CONSTRAINED TERM
CONTRADICTION TERM
PRIMARY-SOURCE TERM
```

The system should avoid unnecessary query multiplication.

---

# 6. Search Expansion

If initial search results are insufficient, the system may expand the search.

Expansion methods include:

* synonyms
* abbreviations
* aliases
* historical names
* related entities
* broader terminology
* narrower terminology
* alternate spelling
* domain-specific terminology
* source-specific terminology
* geographic variations
* timeframe variations

Expansion should preserve the original information requirement.

---

# 7. Search Narrowing

Search should narrow when:

* results are excessively broad
* irrelevant domains dominate
* entity ambiguity exists
* timeframe ambiguity exists
* multiple unrelated events share a name
* source quality is poor
* evidence volume exceeds useful information value

Narrowing may introduce:

* exact phrases
* dates
* entities
* domains
* publishers
* document types
* jurisdictions
* source categories

---

# 8. Search Passes

Research may use multiple search passes.

### PASS 1 — DISCOVERY

Goal:

Identify relevant entities, sources, terminology, and initial evidence.

### PASS 2 — VALIDATION

Goal:

Verify important claims and locate stronger or primary sources.

### PASS 3 — CONTRADICTION

Goal:

Search for evidence that weakens the current interpretation.

### PASS 4 — GAP FILLING

Goal:

Retrieve information specifically missing from the current evidence graph.

### PASS 5 — DISCRIMINATING EVIDENCE

Goal:

Search for evidence capable of distinguishing competing hypotheses.

### PASS 6 — FRESHNESS

Goal:

Determine whether material information has changed since previous research.

Not every research task requires every pass.

The scheduler determines which passes provide sufficient information value.

---

# 9. Candidate Source Ranking

Candidate sources should be ranked according to the research requirement.

Relevant dimensions include:

* relevance
* directness
* source type
* primary/secondary status
* reliability
* specificity
* recency
* freshness
* independence
* provenance quality
* jurisdiction
* accessibility
* expected information value
* duplication likelihood
* conflict-of-interest considerations
* relationship to existing sources

A source should not receive a high rank merely because it appears prominently in search results.

Ranking is contextual.

A source may be highly authoritative for one claim and less useful for another.

---

# 10. Source Selection

The system should select sources rather than retrieve every candidate.

Selection should consider:

```text
RELEVANCE
```text
+
QUALITY
+
DIRECTNESS
+
INDEPENDENCE
+
FRESHNESS
+
```
INFORMATION VALUE
```

The system should prefer a diverse evidence set when appropriate.

For example:

```text
Official announcement
```text
+
Independent reporting
+
Market data
+
```
Relevant historical record
```

may be more valuable than four secondary articles repeating the same announcement.

---

# 11. Source Diversity

Source diversity should be considered when the research question requires corroboration.

Diversity may exist across:

* source type
* publisher
* geographic jurisdiction
* methodology
* data provider
* primary vs secondary origin
* analytical perspective

However, artificial diversity should not be introduced when it does not improve evidence quality.

---

# 12. Primary-Source Escalation

The system should escalate toward primary sources when:

* a major claim depends on secondary reporting
* the primary source is likely available
* the claim is highly consequential
* conflicting reports exist
* the secondary source contains ambiguous attribution
* precise wording matters
* numerical details need verification

The system should record when a primary source could not be located or accessed.

---

# 13. Retrieval

Retrieval converts a selected source into a usable source representation.

Retrieval should preserve:

* source identity
* locator
* publisher
* author
* title
* publication time
* update time
* retrieval time
* content representation
* relevant metadata
* access state
* provenance

The system must not fabricate missing metadata.

Unknown metadata remains unknown.

---

# 14. Retrieval States

A source may have:

```text
ACCESSIBLE
PARTIALLY_ACCESSIBLE
TEMPORARILY_UNAVAILABLE
PAYWALLED
BLOCKED
REMOVED
BROKEN
UNKNOWN
```

These states describe accessibility, not truth value.

---

# 15. Retrieval Failure

When retrieval fails, the system should determine whether the source is:

* retryable
* replaceable
* discoverable through another source
* sufficiently represented by an accessible primary source
* critical enough to require escalation

Retry behavior should be bounded.

The system should not repeatedly retry a source with no meaningful probability of success.

---

# 16. Alternate Retrieval

If an important source is inaccessible, the system may search for:

* official mirrors
* archived versions where appropriate
* related official documents
* independent reporting
* equivalent datasets
* alternative APIs
* another representation of the same source

The system must preserve the distinction between:

```text
ORIGINAL SOURCE
```

and

```text
ALTERNATE REPRESENTATION
```

An alternate representation does not become an independent source merely because it is hosted elsewhere.

---

# 17. Extraction

Retrieved material should be converted into structured research information.

Extraction may identify:

* facts
* numerical observations
* statements
* dates
* entities
* events
* relationships
* claims
* relevant passages
* data points
* conditions
* methodological details
* uncertainty
* attribution

Extraction should preserve source references.

The extracted information becomes input to Evidence Intelligence.

---

# 18. Evidence Handoff

Source Discovery & Retrieval does not independently decide that extracted information is sufficient evidence.

It passes extracted information to Evidence Intelligence with:

```text
SOURCE
```text
+
EXTRACTION
+
CONTEXT
+
TIMESTAMP
+
PROVENANCE
+
```
RETRIEVAL STATE
```

Evidence Intelligence then determines:

* evidence type
* quality
* directness
* reliability
* corroboration
* contradiction
* relevance
* freshness
* claim relationship

---

# 19. Deduplication

The system should identify duplicate or substantially overlapping sources.

Duplicates may include:

* identical documents
* syndicated articles
* copied announcements
* reposted social posts
* secondary reports citing the same primary source
* mirrored documents
* repeated datasets
* different URLs containing identical content

Deduplication should preserve the original source relationship.

It should not simply delete duplicate records.

---

# 20. Source Independence

The system must distinguish:

```text
NUMBER OF SOURCES
```

from:

```text
NUMBER OF INDEPENDENT INFORMATION ORIGINS
```

For example:

```text
Primary announcement
```text
↓
News outlet A
↓
News outlet B
↓
```
Social post C
```

does not represent four independent confirmations.

The source graph should preserve these relationships.

---

# 21. Cross-Checking

Important claims should be cross-checked according to:

* materiality
* uncertainty
* source reliability
* claim importance
* hypothesis competition
* contradiction
* research objective

Cross-checking may involve:

```text
SOURCE → SOURCE
SOURCE → DATA
SOURCE → PRIMARY DOCUMENT
SOURCE → HISTORICAL RECORD
SOURCE → ONCHAIN OBSERVATION
SOURCE → MARKET OBSERVATION
```

Cross-checking should focus on resolving meaningful uncertainty rather than mechanically verifying every trivial statement.

---

# 22. Contradiction Search

When evidence supports a leading hypothesis or judgment, the system may deliberately search for contradictory information.

Contradiction search should target:

* opposing claims
* alternative explanations
* contradictory datasets
* different timeframes
* different jurisdictions
* conflicting official statements
* failed precedents
* evidence that invalidates assumptions

Contradiction search becomes higher priority when:

* confidence is high but evidence is narrow
* the research is consequential
* one hypothesis dominates alternatives
* the evidence is heavily correlated
* the conclusion depends on a fragile assumption

---

# 23. Search for Discriminating Evidence

When competing hypotheses exist, the system should prioritize information capable of distinguishing them.

Example:

```text
HYPOTHESIS A
vs
HYPOTHESIS B
```

The system should ask:

> What observable evidence would look materially different under A versus B?

Search should prioritize that evidence.

This connects Source Discovery directly to Hypothesis Intelligence and the Execution Scheduler.

---

# 24. Freshness

Freshness requirements depend on the research objective.

Examples:

* breaking event → very high freshness
* current market condition → high freshness
* historical event → publication age may be irrelevant
* long-term protocol history → older sources may remain valid
* framework methodology → freshness may be low priority

The system should never equate:

```text
OLD = INVALID
```

or:

```text
NEW = RELIABLE
```

Freshness is contextual.

---

# 25. Existing Research Restoration

When previous research is restored, the system should determine whether source retrieval needs to be refreshed.

It should consider:

* source age
* current objective
* changed market conditions
* changed source content
* updated documents
* new evidence
* source invalidation
* thesis changes
* framework changes
* monitor conditions

Historical retrieval should remain preserved.

Fresh retrieval creates new evidence rather than silently rewriting history.

---

# 26. Search Budget

Search should operate within resource constraints.

Possible limits include:

* maximum search iterations
* maximum source count
* maximum retrieval operations
* maximum branch resources
* maximum execution time
* tool-specific limits
* trader-defined constraints

Limits may be adaptive unless explicitly defined as hard constraints.

A hard trader limit must not be silently exceeded.

---

# 27. Search Stopping

Search may stop when:

* information requirements are satisfied
* evidence is sufficiently strong
* major alternatives have been addressed
* contradictions are sufficiently understood
* additional searches have low expected information value
* available sources are exhausted
* the research objective is complete
* resource constraints prevent further useful research

Search should continue when:

* an important evidence gap remains
* competing hypotheses remain unresolved
* a major contradiction exists
* a primary source is still needed
* new evidence could materially change the judgment
* current confidence depends on weak evidence
* a material event has changed during research

---

# 28. Escalation

The system should escalate research when normal search cannot resolve a material question.

Escalation may include:

```text
BROADER SEARCH
→ PRIMARY-SOURCE SEARCH
→ ALTERNATIVE SOURCE TYPE
→ CROSS-DOMAIN SEARCH
→ HISTORICAL SEARCH
→ CONTRADICTION SEARCH
→ DISCRIMINATING-EVIDENCE SEARCH
→ ADDITIONAL TOOL/SKILL
→ USER CLARIFICATION
```

Escalation should be proportional to the unresolved uncertainty.

---

# 29. User Clarification Boundary

The system should not ask the trader unnecessary questions.

Clarification is appropriate when:

* entity identity is materially ambiguous
* timeframe changes the answer materially
* multiple research targets are equally plausible
* source constraints are unclear and consequential
* the user's instruction conflicts with an existing hard constraint
* the requested research cannot be meaningfully executed without missing information

Otherwise, infer reasonable context and begin research.

---

# 30. Tool and Skill Integration

Source Discovery may invoke tools or Skills through Tool & Skill Orchestration.

The source layer should not directly hard-code every tool.

Instead:

```text
INFORMATION REQUIREMENT
```text
        ↓
CAPABILITY REQUIREMENT
        ↓
TOOL/SKILL ORCHESTRATOR
        ↓
SOURCE DISCOVERY
        ↓
```
RETRIEVAL
```

This keeps source retrieval independent of individual providers.

---

# 31. Materiality

Not every source discovery result should affect the research.

The system should classify discovered information according to potential impact:

```text
MATERIAL
POTENTIALLY MATERIAL
CONTEXTUAL
LOW VALUE
IRRELEVANT
```

Material information enters the main evidence/research path.

Low-value information may remain available for traceability without consuming significant research resources.

---

# 32. Information Value

Search priority should consider expected information value.

High-value searches include those likely to:

* resolve a major contradiction
* distinguish leading hypotheses
* validate a critical claim
* invalidate a thesis assumption
* verify a major event
* materially change confidence
* resolve a key uncertainty
* improve the current judgment

Low-value searches should be deprioritized when they are unlikely to affect the research outcome.

---

# 33. Source Relationship Graph

Discovery should maintain source relationships such as:

```text
ORIGINATES_FROM
CITES
REFERENCES
UPDATES
CORRECTS
DUPLICATES
SUMMARIZES
REPUBLISHES
CONTRADICTS
CORROBORATES
DERIVED_FROM
RELATED_TO
```

These relationships support:

* independence assessment
* provenance
* contradiction analysis
* source ranking
* evidence weighting
* historical traceability

---

# 34. Source Update Detection

When a previously retrieved source changes, the system should preserve:

```text
PREVIOUS REPRESENTATION
NEW REPRESENTATION
CHANGE DETECTED
CHANGE TIME
SOURCE VERSION
```

Material changes may trigger:

* evidence revalidation
* claim reassessment
* hypothesis reassessment
* judgment reassessment
* monitor reassessment

Minor changes should not automatically restart research.

---

# 35. Research Continuity

Source retrieval must preserve continuity between:

```text
OLD RESEARCH
CURRENT RESEARCH
NEW RETRIEVAL
NEW EVIDENCE
UPDATED JUDGMENT
```

Old research remains historical unless explicitly revalidated.

New retrieval should not silently overwrite previous evidence.

---

# 36. Error Handling

The system should distinguish:

```text
NO SOURCE FOUND
SOURCE FOUND BUT INACCESSIBLE
SOURCE ACCESSIBLE BUT INSUFFICIENT
SOURCE CONFLICTS WITH OTHER SOURCES
SOURCE IS OUTDATED
SOURCE IS DUPLICATIVE
SOURCE IS LOW QUALITY
SOURCE IS AMBIGUOUS
SOURCE CANNOT ANSWER REQUIREMENT
```

Each condition should trigger an appropriate recovery path.

The system must never convert retrieval failure into a fabricated conclusion.

---

# 37. Output

The operational output of Source Discovery & Retrieval Intelligence is:

```text
SOURCE SET
```text
+
RETRIEVED SOURCE REPRESENTATIONS
+
SOURCE RELATIONSHIPS
+
EXTRACTED INFORMATION
+
PROVENANCE
+
ACCESS STATUS
+
FRESHNESS
+
DUPLICATION STATUS
+
CROSS-CHECK STATUS
+
```
REMAINING INFORMATION GAPS
```

This output feeds:

```text
Evidence Intelligence
Claim Management
Hypothesis Intelligence
Analysis Intelligence
Research Scheduler
Judgment Intelligence
```

---

# 38. Completion Criteria

Source Discovery & Retrieval is complete for an information requirement when:

* required information has been sufficiently retrieved
* important source types have been considered
* relevant primary sources have been pursued where appropriate
* important contradictions have been investigated
* duplicate sources have been identified
* source independence has been assessed
* provenance has been preserved
* freshness is appropriate to the objective
* remaining gaps are understood
* additional search has low expected information value

Completion does not require perfect information.

---

# 39. Global Operating Loop

```text
INFORMATION REQUIREMENT
```text
        ↓
DETERMINE SEARCH STRATEGY
        ↓
GENERATE QUERY FAMILY
        ↓
DISCOVER CANDIDATE SOURCES
        ↓
RANK SOURCES
        ↓
SELECT SOURCES
        ↓
RETRIEVE
        ↓
VALIDATE SOURCE
        ↓
EXTRACT INFORMATION
        ↓
PRESERVE PROVENANCE
        ↓
DEDUPLICATE
        ↓
CHECK SOURCE INDEPENDENCE
        ↓
CROSS-CHECK
        ↓
SEARCH FOR CONTRADICTIONS
        ↓
SEARCH FOR DISCRIMINATING EVIDENCE
        ↓
HAND OFF TO EVIDENCE INTELLIGENCE
        ↓
ASSESS INFORMATION SUFFICIENCY
        ↓
REASSESS INFORMATION VALUE
        ↓
EXPAND / NARROW / ESCALATE / STOP
        ↓
```
UPDATE RESEARCH
```

## Global Principle

Source Discovery & Retrieval Intelligence should answer:

> “What information do we need, where is the strongest available source for it, how can we retrieve and verify it, and is further searching likely to materially improve the research?”

It optimizes for **relevant, high-quality, sufficiently independent information**, not search volume.

It never fabricates sources, silently treats inaccessible information as negative evidence, mistakes repeated reporting for independent corroboration, or allows search activity itself to become the objective.
