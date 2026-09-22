/**
 * CAUSAL-LINK STATUS (research contract §3: explicit causal/transmission validation).
 *
 * Evidence for the NODES of a chain is not evidence for the ARROWS. When a question's
 * transmission wording names causal links, each link's status is derived deterministically
 * from the requirement ledger: whether the link-target requirement was actually satisfied, and
 * with what quality of evidence. The judgment must reflect the weakest material link — an
 * answer with oil and yield data but no inflation evidence may not describe the inflation
 * transmission as established.
 *
 * Everything here reads the ledger the loops already assess; nothing inspects question text,
 * so the derivation is identical for any transmission question.
 */
import type { ResearchRequirement } from "./requirements.js";

export type CausalLinkStatus =
  | "SUPPORTED"           // target requirement satisfied by direct, multi-source evidence
  | "PARTIALLY_SUPPORTED" // satisfied, but correlational/inferred or single-source evidence
  | "STALE_ONLY"          // only evidence outside the required time horizon
  | "UNRESOLVED"          // not satisfied and the recovery chain was exhausted
  | "NOT_RESEARCHED";     // requirement still pending (no capability served it yet)

export interface CausalLinkStatusRecord {
  /** Canonical target fold of the link (INFLATION, RATES, ...). */
  readonly target: string;
  /** Human-readable target label (from the shared target vocabulary). */
  readonly targetLabel: string;
  readonly status: CausalLinkStatus;
  /** Requirement id backing the assessment (the ledger row that owns this link). */
  readonly requirementId: string;
  /** Evidence refs that satisfied the link's requirement (empty unless supported). */
  readonly evidenceRefs: readonly string[];
}

/**
 * Derive the status of every transmission link the contract required. One requirement per
 * canonical target (completeRequirements de-duplicates), so the ledger row IS the link.
 */
export function deriveCausalLinkStatuses(requirements: readonly ResearchRequirement[]): readonly CausalLinkStatusRecord[] {
  const out: CausalLinkStatusRecord[] = [];
  for (const req of requirements) {
    // A link is declared either as its own TRANSMISSION row (targetTerms) or attached to the
    // dimension row that already owned the target (transmissionTargets). Both are the arrow.
    const targets = [...(req.targetTerms ?? []), ...(req.transmissionTargets ?? [])];
    if (targets.length === 0) continue;
    for (const target of targets) {
      const status: CausalLinkStatus =
        req.status === "SATISFIED"
          ? req.evidenceQuality === "CORRELATIONAL" || req.evidenceQuality === "UNRESOLVED" || req.sourceDiversity === 1
            ? "PARTIALLY_SUPPORTED"
            : "SUPPORTED"
          : req.status === "PARTIALLY_SATISFIED"
            ? "STALE_ONLY"
            : req.status === "EXHAUSTED" || req.status === "UNAVAILABLE"
              ? "UNRESOLVED"
              : "NOT_RESEARCHED";
      out.push({
        target,
        targetLabel: targetLabelOf(target),
        status,
        requirementId: req.id,
        evidenceRefs: status === "SUPPORTED" || status === "PARTIALLY_SUPPORTED" ? req.evidenceRefs : [],
      });
    }
  }
  return out;
}

/** Weakest link in the chain: the status that must bind the judgment (best = undefined). */
export function weakestCausalLink(links: readonly CausalLinkStatusRecord[]): CausalLinkStatusRecord | undefined {
  const ORDER: Readonly<Record<CausalLinkStatus, number>> = {
    SUPPORTED: 4, PARTIALLY_SUPPORTED: 3, STALE_ONLY: 2, NOT_RESEARCHED: 1, UNRESOLVED: 0,
  };
  return links.reduce<CausalLinkStatusRecord | undefined>(
    (weakest, l) => (weakest === undefined || ORDER[l.status] < ORDER[weakest.status] ? l : weakest),
    undefined,
  );
}

/** Human label shared with the requirement vocabulary (kept local to avoid an import cycle). */
function targetLabelOf(target: string): string {
  switch (target) {
    case "RATES": return "Treasury yields and rate markets";
    case "EQUITIES": return "broader equity and risk-asset markets";
    case "RISK_ASSETS": return "broader risk assets";
    case "EMERGING_MARKETS": return "emerging-market assets";
    case "INFLATION": return "inflation";
    case "DOLLAR": return "the dollar";
    case "CRYPTO": return "crypto markets";
    case "OIL": return "crude oil";
    case "GOLD": return "gold";
    case "COPPER": return "copper";
    case "SILVER": return "silver";
    case "COMMODITY": return "commodity markets";
    default: return target.toLowerCase().replace(/_/g, " ");
  }
}
