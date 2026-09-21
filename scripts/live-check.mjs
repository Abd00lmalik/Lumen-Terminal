/**
 * Live acceptance check (research-engine rebuild): sequential questions against production,
 * reporting the ACTUAL answer, the judgment, evidence domains/provenance, and contamination
 * markers honestly. Usage: node scripts/live-check.mjs [question ...]
 */
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const DEFAULT_QUESTIONS = [
  "What is driving oil prices this week?",
  "What macro conditions favor risk assets right now?",
];
const questions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_QUESTIONS;

/** Contamination markers: words that must not dominate evidence for a non-crypto subject. */
function contaminationCheck(question, texts) {
  const joined = texts.join(" \n ");
  const crypto = /\b(bitcoin|btc|ethereum|eth\b|xrp|solana|altcoin|crypto)\b/i;
  const subjectIsCrypto = /\b(btc|bitcoin|eth|ethereum|crypto)\b/i.test(question);
  const hits = texts.filter((t) => crypto.test(t)).length;
  return { subjectIsCrypto, cryptoEvidenceItems: hits, contaminated: !subjectIsCrypto && hits > 0 && hits >= texts.length / 2, joinedLength: joined.length };
}

function section(title) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

async function ask(question) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 280_000);
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: question }),
      signal: controller.signal,
    });
    const body = await res.json();
    const evidence = body.evidence ?? [];
    const evidenceTexts = evidence.map((e) => String(e.observation ?? ""));
    const types = {};
    for (const e of evidence) types[e.evidenceType ?? "?"] = (types[e.evidenceType ?? "?"] ?? 0) + 1;
    const check = contaminationCheck(question, evidenceTexts);
    return {
      question,
      http: res.status,
      seconds: ((Date.now() - started) / 1000).toFixed(1),
      outcome: body.outcome,
      researchRef: body.researchRef,
      evidence,
      types,
      ...check,
      answer: body.answer ?? {},
      judgments: body.judgments ?? [],
      /* Part 13 record: unresolved RESEARCH requirements (engine ledger) and the diagnostics
         that stay out of the user-facing answer. */
      researchGaps: body.researchGaps ?? [],
      limitations: body.limitations ?? [],
      error: undefined,
    };
  } catch (error) {
    return { question, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

for (const question of questions) {
  const report = await ask(question);
  section(question);
  if (report.error !== undefined) {
    console.log("  ERROR:", report.error);
    continue;
  }
  console.log(`  http ${report.http} | ${report.seconds}s | outcome ${report.outcome} | ${report.researchRef ?? "-"} | evidence ${report.evidence.length} | judgments ${report.judgments.length}`);
  console.log("  evidence types:", JSON.stringify(report.types));
  console.log(`  crypto evidence items: ${report.cryptoEvidenceItems}${report.contaminated ? "  <-- CONTAMINATION" : ""}`);
  console.log(`  unresolved requirements (research gaps): ${report.researchGaps.length === 0 ? "none" : report.researchGaps.join(" | ")}`);
  console.log(`  capability notes kept in diagnostics: ${report.limitations.length}`);
  const confidence = report.judgments.map((j) => j.confidence).filter(Boolean);
  if (confidence.length > 0) console.log(`  judgment confidence: ${[...new Set(confidence)].join(", ")}`);
  console.log("\n--- ANSWER ---");
  const answer = report.answer;
  console.log(typeof answer === "string" ? answer : JSON.stringify(answer, null, 2).slice(0, 6000));
  console.log("\n--- JUDGMENT ---");
  for (const j of report.judgments) {
    console.log(`  [${j.status ?? "?"}] ${String(j.statement ?? "").slice(0, 900)}`);
  }
  console.log("\n--- EVIDENCE (first 14) ---");
  for (const e of report.evidence.slice(0, 14)) {
    console.log(`  - (${e.evidenceType ?? "?"}${e.freshness !== undefined ? `/${e.freshness}` : ""}) ${String(e.observation ?? "").replace(/\s+/g, " ").slice(0, 190)}`);
    const p = e.provenance ?? {};
    const bits = [p.source, p.provider, p.publisher, p.url, p.publishedAt ?? p.retrievedAt].filter((x) => typeof x === "string" && x.length > 0);
    if (bits.length > 0) console.log(`      provenance: ${bits.join(" | ").slice(0, 200)}`);
  }
}
