/**
 * Live acceptance check (research-engine rebuild): sequential questions against production,
 * reporting evidence domains, target relevance, and contamination markers honestly.
 * Usage: node scripts/live-check.mjs [question ...]
 */
const BASE = process.env.LUMEN_BASE ?? "https://asklumen.vercel.app";
const DEFAULT_QUESTIONS = [
  "What is driving oil prices this week?",
  "What macro conditions favor risk assets right now?",
  "What is driving copper prices this week?",
];
const questions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_QUESTIONS;

/** Contamination markers: words that must not dominate evidence for a non-crypto subject. */
function contaminationCheck(question, texts) {
  const joined = texts.join(" \n ");
  const crypto = /\b(bitcoin|btc|ethereum|eth\b|xrp|solana|altcoin|crypto)\b/i;
  const subjectIsCrypto = /\b(btc|bitcoin|eth|ethereum|crypto)\b/i.test(question);
  const hits = texts.filter((t) => crypto.test(t)).length;
  return { subjectIsCrypto, cryptoEvidenceItems: hits, contaminated: !subjectIsCrypto && hits > 0 && hits >= texts.length / 2 };
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
    const evidenceTexts = (body.evidence ?? []).map((e) => String(e.observation ?? ""));
    const types = {};
    for (const e of body.evidence ?? []) types[e.evidenceType ?? "?"] = (types[e.evidenceType ?? "?"] ?? 0) + 1;
    const check = contaminationCheck(question, evidenceTexts);
    return {
      question,
      http: res.status,
      seconds: ((Date.now() - started) / 1000).toFixed(1),
      outcome: body.outcome,
      researchRef: body.researchRef,
      evidence: (body.evidence ?? []).length,
      types,
      ...check,
      answer: String(body.answer?.answer ?? "").slice(0, 320),
      judgment: body.judgments?.[0]?.statement !== undefined,
    };
  } catch (error) {
    return { question, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

for (const question of questions) {
  const report = await ask(question);
  console.log("\n=== " + report.question);
  if (report.error !== undefined) {
    console.log("  ERROR:", report.error);
    continue;
  }
  console.log(`  http ${report.http} | ${report.seconds}s | outcome ${report.outcome} | ${report.researchRef ?? "-"} | evidence ${report.evidence} | judgment ${report.judgment}`);
  console.log("  evidence types:", JSON.stringify(report.types));
  console.log(`  crypto evidence items: ${report.cryptoEvidenceItems}${report.contaminated ? "  <-- CONTAMINATION" : ""}`);
  console.log("  answer head:", report.answer.replace(/\s+/g, " "));
}
