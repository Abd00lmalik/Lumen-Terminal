/**
 * INVESTIGATION CONTEXT BUILDER (Phase 3).
 *
 * A follow-up turn needs to understand the conversation without being handed the whole archive.
 * The distinction that makes this safe is:
 *
 *   Previous research can provide CONTEXT.
 *   Previous evidence does not become newly retrieved evidence.
 *
 * Run 1 established "BTC declined, ETF flows were negative". Run 2 ("Focus on ETF flows") may
 * RECEIVE those findings as labelled context. If Run 2 performs retrieval, its new evidence
 * belongs to Run 2 and to nothing else. Nothing here re-parents evidence, and nothing here hands
 * a run a capability it may not use.
 *
 * WHAT THIS BUILDER DOES NOT DO, deliberately:
 *   - it does not concatenate the entire conversation (cost, and noise that degrades every turn);
 *   - it does not scan the whole evidence archive to find "relevant" evidence by keyword — that
 *     lexical gate is the exact mechanism that put a 07:41 observation beside a fresh 08:46 one
 *     in the original research-integrity defect;
 *   - it does not convert a prior run's evidence into the current run's.
 *
 * It selects over the investigation's OWN runs, by run identity, and labels everything it carries
 * as prior context. The run's own evidence comes from the run-scoped context builder
 * (context.ts), which is untouched.
 */

import type { Workspace } from "../domain/workspace.js";
import type { ConversationTurn, Investigation } from "../domain/investigation.js";
import type { Research } from "../domain/objects.js";

/** How many prior turns/findings the builder will carry. Bounded by design, not by accident. */
const MAX_TURNS = 6;
const MAX_FINDINGS = 8;
const MAX_OPEN_QUESTIONS = 6;

/**
 * A piece of prior context handed to the next run. Every item carries the run that produced it,
 * so the research layer can always answer "where did this come from?" — and so a consumer can
 * never mistake prior context for this run's own evidence.
 */
export interface InvestigationContextItem {
  readonly kind: "FINDING" | "OPEN_QUESTION" | "THESIS" | "HISTORICAL_REFERENCE" | "PREVIOUS_QUESTION";
  readonly text: string;
  /** The research run that produced this. Always present for FINDING/HISTORICAL_REFERENCE. */
  readonly runId?: string;
  /** Judgment refs backing the statement (a finding, never a bare claim). */
  readonly judgmentRefs?: readonly string[];
  readonly turnId?: string;
}

export interface InvestigationContext {
  readonly investigationId?: string;
  readonly subject?: string;
  /** The trader's verbatim question for THIS turn. */
  readonly question: string;
  /** Recent conversation turns, oldest first (the trader's own words, not a summary). */
  readonly turns: readonly ConversationTurn[];
  /** Prior findings this turn may build on — each with its originating run. */
  readonly findings: readonly InvestigationContextItem[];
  /** Questions the investigation has not resolved. */
  readonly openQuestions: readonly InvestigationContextItem[];
  /** The trader's OWN thesis for this investigation, if they stated one. Never inferred. */
  readonly thesis?: InvestigationContextItem;
  /** Explicitly labelled references to prior runs' material. NEVER current-run evidence. */
  readonly historicalReferences: readonly InvestigationContextItem[];
  /** The runs this investigation produced, oldest first (identity only; no evidence). */
  readonly priorRunIds: readonly string[];
  /**
   * The boundary, stated in the payload itself so every consumer is told rather than trusted:
   * prior context is REFERENCE material and never becomes this run's evidence.
   */
  readonly boundary: string;
}

const BOUNDARY_NOTICE =
  "Everything above is PRIOR CONTEXT from earlier runs of this investigation. It may inform " +
  "the investigation but it is NOT evidence for this run. Any evidence this run cites must " +
  "have been retrieved BY this run and be owned by it.";

/**
 * Build the context for the next turn of an investigation.
 *
 * Selection is by RUN IDENTITY, not by lexical similarity across the workspace. That is the
 * whole point: an investigation's runs are exactly the runs the trader asked for in this
 * conversation, so they are the only prior material that may be considered, and every item
 * carries its run.
 */
export function buildInvestigationContext(input: {
  readonly workspace: Workspace;
  readonly investigation: Investigation | undefined;
  readonly question: string;
}): InvestigationContext {
  const { workspace, investigation, question } = input;
  if (investigation === undefined) {
    return { question, turns: [], findings: [], openQuestions: [], historicalReferences: [], priorRunIds: [], boundary: BOUNDARY_NOTICE };
  }

  const runs = workspace.investigationRuns(investigation.id);
  const turns = workspace.listTurns(investigation.id).slice(-MAX_TURNS);

  const findings: InvestigationContextItem[] = [];
  const historicalReferences: InvestigationContextItem[] = [];

  for (const run of runs) {
    // Only COMPLETED runs have a conclusion worth carrying; an in-flight run contributes
    // nothing, so a fast follow-up never reads a half-written answer as established.
    if (run.status !== "COMPLETED") continue;
    for (const judgmentRef of run.judgmentRefs) {
      const judgment = workspace.getJudgment(judgmentRef);
      if (judgment === undefined) continue;
      const item: InvestigationContextItem = {
        kind: "FINDING",
        text: judgment.statement,
        runId: run.id,
        judgmentRefs: [judgment.id],
      };
      // A HISTORICAL comparison (Flow 5) is explicitly a REFERENCE to another period. It is
      // labelled as such here so it can never be read as an observation about now — which is
      // the historical/current confusion the run-ownership work also had to police.
      if (/historic|precedent|analogue|analog|comparable episode|past (?:episode|instance)/i.test(judgment.statement)) {
        historicalReferences.push({ ...item, kind: "HISTORICAL_REFERENCE" });
      } else {
        findings.push(item);
      }
    }
  }

  // Prefer the most recent findings: a conversation's latest conclusion supersedes the one it
  // refined, and an eight-item window taken from the start would never see it.
  const recentFindings = findings.slice(-MAX_FINDINGS);

  const openQuestions: InvestigationContextItem[] = [];
  for (const turn of turns) {
    if (turn.role !== "LUMEN") continue;
    // The trader's own question is the best available record of what is still open, and it is
    // the trader's words rather than a generated paraphrase.
    if (/\?$/.test(turn.content.trim()) === false) continue;
    openQuestions.push({ kind: "OPEN_QUESTION", text: turn.content, turnId: turn.id });
  }

  const thesis: InvestigationContextItem | undefined =
    investigation.thesisRef !== undefined
      ? (() => {
          const thesis = workspace.getThesis(investigation.thesisRef);
          return thesis === undefined
            ? undefined
            : { kind: "THESIS" as const, text: thesis.statement };
        })()
      : undefined;

  return {
    investigationId: investigation.id,
    ...(investigation.subject !== "" ? { subject: investigation.subject } : {}),
    question,
    turns,
    findings: recentFindings,
    openQuestions: openQuestions.slice(-MAX_OPEN_QUESTIONS),
    ...(thesis !== undefined ? { thesis } : {}),
    historicalReferences,
    priorRunIds: runs.map((r: Research) => r.id),
    boundary: BOUNDARY_NOTICE,
  };
}

/**
 * Render the investigation context for a prompt.
 *
 * The boundary notice is part of the RENDERED text, not only the data structure: the model reads
 * what the researcher reads. A prior finding is labelled with the run it came from, and an
 * explicit HISTORICAL REFERENCE section keeps another period's material visually separate from
 * anything about the present.
 */
export function renderInvestigationContext(ctx: InvestigationContext): string {
  const lines: string[] = [];
  if (ctx.investigationId === undefined) return "";
  lines.push(`INVESTIGATION: ${ctx.subject ?? "ongoing investigation"} (${ctx.investigationId})`);
  lines.push(`THIS TURN'S QUESTION: ${ctx.question}`);
  if (ctx.turns.length > 0) {
    lines.push("", "RECENT CONVERSATION (the trader's own words):");
    for (const turn of ctx.turns) {
      lines.push(`  ${turn.role === "TRADER" ? "TRADER" : "LUMEN"}: ${turn.content}`);
    }
  }
  if (ctx.findings.length > 0) {
    lines.push("", "ESTABLISHED IN EARLIER RUNS OF THIS INVESTIGATION (prior findings, not evidence for this run):");
    for (const f of ctx.findings) lines.push(`  - ${f.text} [run ${f.runId ?? "unknown"}]`);
  }
  if (ctx.historicalReferences.length > 0) {
    lines.push("", "HISTORICAL REFERENCE (about other periods; NOT an observation about now):");
    for (const h of ctx.historicalReferences) lines.push(`  - ${h.text} [run ${h.runId ?? "unknown"}]`);
  }
  if (ctx.openQuestions.length > 0) {
    lines.push("", "STILL OPEN IN THIS INVESTIGATION:");
    for (const q of ctx.openQuestions) lines.push(`  - ${q.text}`);
  }
  if (ctx.thesis !== undefined) {
    lines.push("", `THE TRADER'S OWN THESIS FOR THIS INVESTIGATION: ${ctx.thesis.text}`);
  }
  lines.push("", `RUN BOUNDARY: ${ctx.boundary}`);
  return lines.join("\n");
}

/** Has this investigation produced any completed research yet? (Routing reads this.) */
export function investigationHasResearch(workspace: Workspace, investigationId: string): boolean {
  return workspace.investigationRuns(investigationId).some((r) => r.status === "COMPLETED");
}