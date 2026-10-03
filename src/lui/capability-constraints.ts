/**
 * CAPABILITY ISOLATION (execution-planner constraint).
 *
 * The trader may state a hard boundary on which capability the research is allowed to use:
 * "Use CRYPTO_MARKET_DATA only. Retrieve one fresh Bitcoin spot-price observation."
 *
 * Previously such a boundary existed only as PROMPT TEXT handed to the planner model, so the
 * engine's own capability floor, its gap-recovery rounds and the model's plan could all still
 * execute FALSIFICATION, WEB_SEARCH, CROSS_DOMAIN_SYNTHESIS or an unrelated market-data
 * provider. A stated restriction that the engine does not enforce is not a restriction.
 *
 * The law enforced here:
 *   - the phrase is parsed deterministically (no model call, no prompt instruction);
 *   - it yields an ALLOWLIST of capability names, not a hint;
 *   - provider fallback INSIDE a requested capability stays legal (CRYPTO_MARKET_DATA ->
 *     Bitget -> unavailable -> CoinGecko is one capability with several providers), while
 *   - leaving the capability entirely for another capability is blocked at the planner.
 *
 * The allowlist is advisory input to planning and a hard filter on everything the engine
 * schedules afterwards. When nothing inside the allowlist can serve the request the run ends
 * as an honest capability failure — it never silently becomes a different research task.
 */

/** Capability names are SCREAMING_SNAKE tokens; a constraint names one or more of them. */
const CAPABILITY_TOKEN = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;

/**
 * Phrases that make a capability token a HARD boundary rather than a topic mention.
 * "Use CRYPTO_MARKET_DATA only", "only COMMODITY_MARKET_DATA", "CRYPTO_MARKET_DATA only",
 * "stick to CRYPTO_MARKET_DATA", "nothing but CRYPTO_MARKET_DATA", "do not use WEB_SEARCH".
 */
const EXCLUSIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:use|using|stick to|stick with|restrict(?:ed)? to|limit(?:ed)? to|confine to)\s+(?:only\s+)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s*(?:only\b|,|$)/gi,
  /\bonly\s+(?:use\s+|using\s+)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/gi,
  /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\s+only\b/gi,
  /\bnothing but\s+([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/gi,
  /\bdo not use\s+([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/gi,
  /\bdon't use\s+([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/gi,
];

/** Collect the capability names an "only X" style constraint names, in the order written. */
function capabilitiesIn(text: string): string[] {
  const out: string[] = [];
  for (const pattern of EXCLUSIVE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const captured = match[1];
      if (captured === undefined) continue;
      for (const token of captured.split(/[,;/]|\band\b/i)) {
        const name = token.trim().toUpperCase();
        if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(name) && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}

/** Capabilities the message explicitly FORBIDS ("do not use WEB_SEARCH"). */
export function forbiddenCapabilities(message: string): readonly string[] {
  const forbids = new Set<string>();
  const negated = /\b(?:do not|don't|never|without)\s+(?:use|using|run|running|execute)\s+([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)/gi;
  let match: RegExpExecArray | null;
  while ((match = negated.exec(message)) !== null) {
    const captured = match[1];
    if (captured !== undefined) forbids.add(captured.toUpperCase());
  }
  return [...forbids];
}

/**
 * The explicit capability ALLOWLIST a message states, or undefined when it states none.
 * A message that forbids capabilities but names no exclusive one yields undefined (the
 * prohibitions still apply through `forbiddenCapabilities`).
 */
export function capabilityAllowlistOf(message: string): readonly string[] | undefined {
  const allowed = capabilitiesIn(message);
  return allowed.length > 0 ? allowed : undefined;
}

/**
 * CAPABILITY-ISOLATION GATE: may this capability run under the stated constraint?
 * A named allowlist is exhaustive — anything outside it is blocked, including the engine's
 * own floor capabilities and gap-recovery capabilities. A provider fallback WITHIN an
 * allowed capability is unaffected: this test is about the capability, never the provider.
 */
export function capabilityPermitted(
  capability: string,
  constraint: { readonly allowed?: readonly string[]; readonly forbidden?: readonly string[] },
): boolean {
  if (constraint.forbidden?.includes(capability) === true) return false;
  if (constraint.allowed === undefined) return true;
  return constraint.allowed.includes(capability);
}

/** Filter a capability list through the isolation gate (order preserved, deduplicated). */
export function permittedCapabilities(
  capabilities: readonly string[],
  constraint: { readonly allowed?: readonly string[]; readonly forbidden?: readonly string[] },
): readonly string[] {
  const out: string[] = [];
  for (const capability of capabilities) {
    if (!capabilityPermitted(capability, constraint)) continue;
    if (!out.includes(capability)) out.push(capability);
  }
  return out;
}

/**
 * Human-readable statement of the enforced constraint (diagnostics; never a user prompt).
 * A provider fallback inside an allowed capability is explicitly permitted here, which is
 * what distinguishes a legal fallback from an illegal capability change.
 */
export function describeCapabilityConstraint(
  constraint: { readonly allowed?: readonly string[]; readonly forbidden?: readonly string[] },
): string | undefined {
  if (constraint.allowed === undefined && (constraint.forbidden ?? []).length === 0) return undefined;
  const parts: string[] = [];
  if (constraint.allowed !== undefined) {
    parts.push(`only ${constraint.allowed.join(", ")} may execute (provider fallback inside an allowed capability remains permitted; no other capability may run)`);
  }
  if ((constraint.forbidden ?? []).length > 0) parts.push(`forbidden: ${constraint.forbidden!.join(", ")}`);
  return parts.join("; ");
}

/** The full isolation constraint for a message: an optional allowlist plus prohibitions. */
export interface CapabilityConstraint {
  /** Capabilities the trader stated as the ONLY ones that may run; undefined = no allowlist. */
  readonly allowed?: readonly string[];
  /** Capabilities the trader explicitly prohibited. */
  readonly forbidden: readonly string[];
}

/** Parse a message into the constraint the execution planner must honor. */
export function capabilityConstraintOf(message: string): CapabilityConstraint {
  const allowed = capabilityAllowlistOf(message);
  const forbidden = forbiddenCapabilities(message).filter((c) => allowed?.includes(c) !== true);
  return {
    ...(allowed !== undefined ? { allowed } : {}),
    forbidden,
  };
}

/** All capability tokens the message names anywhere (diagnostics: what the trader talked about). */
export function mentionedCapabilities(message: string): readonly string[] {
  CAPABILITY_TOKEN.lastIndex = 0;
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = CAPABILITY_TOKEN.exec(message)) !== null) {
    const token = match[1];
    if (token !== undefined) out.add(token.toUpperCase());
  }
  return [...out];
}