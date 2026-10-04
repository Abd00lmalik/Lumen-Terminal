/**
 * INVESTIGATION STATE (Phase 5 / Phase 10) — accumulated decision context, DERIVED.
 *
 * The brief is explicit that this must not be "an arbitrary AI-generated summary". So nothing
 * here calls a model. Every field is a PROJECTION over artifacts the research engine already
 * produced and the domain already owns:
 *
 *   establishedFacts        <- Evidence objects owned by this investigation's runs
 *   findings                <- Judgments owned by those runs
 *   competingExplanations   <- Claims/Hypotheses that disagree, where the graph says so
 *   unresolvedQuestions     <- the trader's own unanswered questions + honest engine gaps
 *   thesis                  <- the trader's OWN thesis (never inferred)
 *   challenges              <- Challenge records (Flow 7 derived)
 *   historicalComparisons   <- judgments explicitly about other periods
 *   runCount                <- how many isolated runs the conversation produced
 *
 * A field is empty because nothing established it, not because nothing was written. That
 * distinction is the difference between an accumulated investigation and a plausible-sounding
 * summary, and it is why this is deterministic code rather than a prompt.
 */

import type { Workspace } from "../domain/workspace.js";
import type { Investigation, InvestigationState } from "../domain/investigation.js";
import { readableObservation } from "./observation-text.js";

/** How many findings/facts the sidebar and synthesis surface. Bounded on purpose. */
const MAX_FACTS = 8;
const MAX_FINDINGS = 8;
const MAX_COMPETING = 6;

/**
 * Does this statement describe another period rather than the present?
 *
 * The current/historical distinction is the same one the evidence and judgment layers already
 * police. A Flow 5 conclusion says "the closest analogue was March 2023"; presenting that
 * inside "established" would read as a claim about today.
 */
const HISTORICAL_MARKERS =
  /\b(historic\w*|precedent|analogue|analog|comparable episode|past episode|previous (?:episode|instance)|in 20\d\d)\b/i;

function truncate(text: string, max = 220): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Derive the investigation's accumulated state from its runs.
 *
 * Runs are read through the investigation's OWN runRefs, so nothing from outside the thread can
 * enter the state — including a stale run from a previous investigation about the same asset.
 */
export function deriveInvestigationState(ws: Workspace, investigation: Investigation): InvestigationState {
  const runs = ws.investigationRuns(investigation.id);
  const completed = runs.filter((r) => r.status === "COMPLETED");

  const establishedFacts: InvestigationState["establishedFacts"][number][] = [];
  const findings: InvestigationState["findings"][number][] = [];
  const historicalComparisons: InvestigationState["historicalComparisons"][number][] = [];
  const competingExplanations: InvestigationState["competingExplanations"][number][] = [];
  const seenEvidence = new Set<string>();
  const seenJudgment = new Set<string>();

  for (const run of completed) {
    // Established facts: the run's OWN evidence, by run ownership. Never a workspace scan —
    // an investigation about Bitcoin does not inherit Ethereum's observations, and a previous
    // investigation about Bitcoin does not either.
    for (const evidenceId of run.evidenceRefs) {
      if (seenEvidence.has(evidenceId)) continue;
      seenEvidence.add(evidenceId);
      const evidence = ws.getEvidence(evidenceId);
      if (evidence === undefined) continue;
      if (evidence.freshness === "HISTORICAL") continue; // another period; not an established present fact
      establishedFacts.push({
        // READABLE, never the raw transport payload: the accumulated surface asks the trader
        // "what have we established", and a JSON blob is not an established fact. The bytes are
        // unchanged on the evidence object itself; only this projection is prose.
        statement: truncate(readableObservation(evidence.observation)),
        runId: run.id,
        evidenceRefs: [evidence.id],
      });
    }

    for (const judgmentRef of run.judgmentRefs) {
      if (seenJudgment.has(judgmentRef)) continue;
      seenJudgment.add(judgmentRef);
      const judgment = ws.getJudgment(judgmentRef);
      if (judgment === undefined) continue;
      if (HISTORICAL_MARKERS.test(judgment.statement)) {
        historicalComparisons.push({ runId: run.id, statement: truncate(judgment.statement) });
        continue;
      }
      findings.push({
        statement: truncate(judgment.statement),
        runId: run.id,
        judgmentRef: judgment.id,
        confidence: judgment.confidence ?? "UNKNOWN",
      });

      // COMPETING EXPLANATIONS (derived, not generated): a judgment that cites OPPOSING evidence
      // is the engine's own record that something in this investigation pulled the other way.
      // That is a real disagreement in the graph; inventing an "alternative view" would not be.
      for (const opposingRef of judgment.basis.opposingEvidence) {
        const opposing = ws.getEvidence(opposingRef);
        if (opposing === undefined) continue;
        competingExplanations.push({
          statement: truncate(`Against ${judgment.statement}: ${readableObservation(opposing.observation)}`),
          runId: run.id,
        });
      }
    }
  }

  // Unresolved: the trader's own questions in the thread that the engine has not since run,
  // plus the engine's honest blocking gaps from the latest run. Never filled in by invention.
  const unresolvedQuestions: string[] = [];
  for (const run of completed.slice(-1)) {
    for (const requirement of requirementsOf(ws, run)) {
      if (requirement.importance === "CRITICAL" && requirement.status !== "SATISFIED") {
        unresolvedQuestions.push(truncate(requirement.description, 160));
      }
    }
  }

  const thesis = investigation.thesisRef === undefined
    ? undefined
    : (() => {
        const t = ws.getThesis(investigation.thesisRef);
        return t === undefined ? undefined : { thesisRef: t.id, statement: t.statement };
      })();

  const challenges = ws.listChallenges()
    .filter((c) => completed.some((r) => r.id === c.thesisId) || c.researchRef !== undefined && completed.some((r) => r.id === c.researchRef))
    .map((c) => ({ ref: c.id, statement: c.status }));

  return {
    investigationId: investigation.id,
    subject: investigation.subject,
    establishedFacts: establishedFacts.slice(-MAX_FACTS),
    findings: findings.slice(-MAX_FINDINGS),
    competingExplanations: competingExplanations.slice(-MAX_COMPETING),
    unresolvedQuestions: unresolvedQuestions.slice(0, 6),
    ...(thesis !== undefined ? { thesis } : {}),
    challenges,
    historicalComparisons,
    runCount: runs.length,
  };
}

/** The blocking requirements a run reported, read from its retained diagnostics when present. */
function requirementsOf(ws: Workspace, run: { id: string }): readonly { readonly importance: string; readonly status: string; readonly description: string }[] {
  const response = ws.getResearchResponse(run.id);
  if (response === null || typeof response !== "object") return [];
  const diagnostics = (response as { researchDiagnostics?: { requirements?: readonly { importance: string; status: string; description: string }[] } }).researchDiagnostics;
  return diagnostics?.requirements ?? [];
}