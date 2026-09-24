/**
 * TEMPORARY production ledger verification (delete after use).
 * Usage: node scripts/ledger-check.mjs "question"
 * Prints the ACTUAL researchDiagnostics requirement ledger (arrow rows filtered by
 * /transmission evidence for/), causalLinks, coverage/gate/confidence, and runs
 * machine checks for the invariant: endpoint coverage must never establish
 * transmission (arrow) coverage.
 */
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const question = process.argv.slice(2).join(" ");
if (question.length === 0) {
  console.error("usage: node scripts/ledger-check.mjs \"question\"");
  process.exit(2);
}

const started = Date.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 280_000);
let res;
try {
  res = await fetch(`${BASE}/api/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: question }),
    signal: controller.signal,
  });
} catch (error) {
  clearTimeout(timer);
  console.error("FETCH ERROR:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
clearTimeout(timer);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const body = await res.json();
console.log(`HTTP ${res.status} | ${seconds}s | outcome ${body.outcome} | ref ${body.researchRef ?? "-"}`);

const d = body.researchDiagnostics ?? {};
const reqs = d.requirements ?? [];
const arrows = reqs.filter((r) => /transmission evidence for/i.test(String(r.description)));
const nodes = reqs.filter((r) => !/transmission evidence for/i.test(String(r.description)));
const links = d.causalLinks ?? [];

console.log(`\nledger: ${reqs.length} requirement rows (${arrows.length} arrow rows, ${nodes.length} endpoint/context rows)`);
console.log("\n--- ARROW ROWS (first-class requirement rows) ---");
for (const a of arrows) {
  console.log(`  [${a.status}] ev=${a.evidenceCount}${a.staleEvidenceCount > 0 ? ` stale=${a.staleEvidenceCount}` : ""}${a.recoveryAttempts > 0 ? ` recov=${a.recoveryAttempts}` : ""} :: ${String(a.description).slice(0, 120)}`);
  if (a.unresolvedReason !== undefined) console.log(`      unresolvedReason: ${a.unresolvedReason}`);
}
console.log("\n--- NODE / CONTEXT ROWS ---");
for (const n of nodes) {
  console.log(`  [${n.status}] ev=${n.evidenceCount}${n.staleEvidenceCount > 0 ? ` stale=${n.staleEvidenceCount}` : ""} :: ${String(n.description).slice(0, 120)}`);
}

console.log("\n--- CAUSAL LINKS (derived from arrow rows only) ---");
for (const l of links) {
  console.log(`  ${l.source ?? "?"} -> ${l.target} [${l.status}] evRefs=${l.evidenceRefs.length} (${l.requirementId})`);
}
if (d.weakestCausalLink !== undefined) console.log(`  weakestCausalLink: ${d.weakestCausalLink}`);

console.log(`\ncoverage: ${d.coverage} | gate: ${d.completionGate} | confidence: ${d.confidence ?? "-"} | recoveryRounds: ${d.recoveryRounds}`);
console.log(`completionGates: ${JSON.stringify(d.completionGates ?? [])}`);
console.log(`all executions: ${JSON.stringify((d.executions ?? []).map((e) => `r${e.round} ${e.capability} [${e.completeness}/${e.failureType}] ev=${e.evidenceCount}`))}`);
console.log(`limitations (${(body.limitations ?? []).length}): ${(body.limitations ?? []).join(" | ").slice(0, 400)}`);
console.log(`floorCapabilities: ${JSON.stringify(d.floorCapabilities ?? [])}`);
const relExec = (d.executions ?? []).filter((e) => /CROSS_DOMAIN|WEB_SEARCH|NEWS_ANALYSIS|MACRO_ANALYSIS/i.test(String(e.capability)));
console.log(`executions (${(d.executions ?? []).length} total; relationship-capable):`);
for (const e of relExec) console.log(`  r${e.round} ${e.capability} <- ${String(e.provider).split("/").slice(-1)[0]} [${e.completeness}/${e.failureType}] ev=${e.evidenceCount}`);

const gaps = body.researchGaps ?? [];
console.log(`\nresearchGaps (${gaps.length}):`);
for (const g of gaps) console.log(`  - ${String(g).slice(0, 160)}`);

const answer = body.answer ?? {};
const answerText = typeof answer.answer === "string" ? answer.answer : JSON.stringify(answer);
console.log(`\n--- ANSWER (first 1400 chars) ---\n${answerText.slice(0, 1400)}`);
if (answer.counterevidenceStatus !== undefined) console.log(`counterevidenceStatus: ${answer.counterevidenceStatus}`);

// ---- machine checks of the invariant ----
const unresolvedLink = links.filter((l) => l.status === "UNRESOLVED" || l.status === "NOT_RESEARCHED");
const satisfiedLink = links.filter((l) => l.status === "SUPPORTED" || l.status === "PARTIALLY_SUPPORTED" || l.status === "STALE_ONLY");
const problems = [];
if (links.length > 0 && arrows.length === 0) problems.push("causalLinks present but NO arrow rows in the ledger");
for (const l of satisfiedLink) {
  if (l.evidenceRefs.length === 0) problems.push(`link ${l.source ?? "?"}->${l.target} is ${l.status} with ZERO evidenceRefs on its arrow row (endpoint evidence leaked into the arrow)`);
}
for (const l of unresolvedLink) {
  if (l.evidenceRefs.length > 0) problems.push(`link ${l.source ?? "?"}->${l.target} is ${l.status} but carries ${l.evidenceRefs.length} evidenceRefs`);
}
if (unresolvedLink.length > 0) {
  if (d.completionGate === "EVIDENCE_SUFFICIENT") problems.push(`gate is EVIDENCE_SUFFICIENT while ${unresolvedLink.length} link(s) are unresolved`);
  const conf = String(d.confidence ?? "").toUpperCase();
  if (conf === "HIGH") problems.push("confidence is HIGH while causal links are unresolved (weakest-link ceiling not applied)");
}
if (arrows.length > 0) {
  const distinct = new Set(arrows.map((a) => a.description));
  if (distinct.size !== arrows.length) problems.push("arrow rows share identical descriptions (not distinct first-class rows)");
}

console.log("\n--- INVARIANT CHECK: endpoint coverage ≠ transmission coverage ---");
if (problems.length === 0) {
  console.log("  HOLD — all checks passed:");
  console.log(`    arrow rows in ledger: ${arrows.length}; links: ${links.length} (unresolved: ${unresolvedLink.length}, supported: ${satisfiedLink.length})`);
  console.log(`    supported links all carry their own evidenceRefs; unresolved links carry none; gate=${d.completionGate}, confidence=${d.confidence ?? "-"}`);
} else {
  console.log("  VIOLATION:");
  for (const p of problems) console.log(`    ! ${p}`);
  process.exitCode = 1;
}
