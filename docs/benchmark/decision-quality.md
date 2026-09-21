# Decision-Quality Benchmark

> A run can technically complete and still FAIL the benchmark. A truthful INSUFFICIENT after real
> recovery can PASS. The benchmark scores the engine's research process, not the fluency of the
> paragraph.

## Suites

| Suite | File | What it scores |
|---|---|---|
| Process benchmark | `tests/benchmark/process.test.ts` | Target law, domain isolation, coverage, completion, freshness across macro/oil/NVDA/BTC/EUR-USD/gold/yields/dollar scenarios incl. adversarial crypto-only and sequential-isolation runs. |
| Decision-quality benchmark | `tests/benchmark/decision-quality.test.ts` | 15 independent dimensions over hidden golden contracts; question-type generalization (price, event, causal, macro, cross-asset, thesis, falsification, historical, held-out subject) + adversarial failure modes. |
| Research contract unit laws | `tests/research/requirements-contract.test.ts` | Question typing, ledger completion, role identity, challenge attempt/blocking laws, retrieval brief. |
| Confidence unit laws | `tests/research/confidence.test.ts` | The deterministic confidence ladder and the model cap. |

## Hidden golden contracts

Each decision-quality scenario defines a golden contract the engine never sees: expected subject,
temporal window, decision dimensions, required calculations, expected/forbidden evidence classes,
counterevidence requirement. The engine receives only the question.

## The 15 dimensions (scored independently, never averaged)

QUESTION UNDERSTANDING · SUBJECT RESOLUTION · TEMPORAL CORRECTNESS · CORE REQUIREMENTS ·
CHALLENGE EXECUTION · EVIDENCE RELEVANCE · FRESHNESS · ANALYTICAL CORRECTNESS · CROSS-SIGNAL
SYNTHESIS · COUNTEREVIDENCE · UNCERTAINTY · DECISION USEFULNESS · TRACEABILITY · NO CONTAMINATION ·
RECOVERY.

Key semantics:

- **CORE REQUIREMENTS** — the decision-critical role rows must all be satisfied (or the gap named);
  a question whose only dimension IS the challenge ("what could prove me wrong?") must carry an
  attempted CHALLENGE row instead of nothing.
- **CHALLENGE EXECUTION** — counterevidence must be attempted, not merely worded.
- **UNCERTAINTY** — must correspond to actual unresolved requirements, never filler.
- **TRACEABILITY** — factor/citation refs must resolve inside the admitted context.
- The stale-evidence adversarial case is EXPECTED to fail temporal/coverage (that failure is the
  assertion); every other case must pass all dimensions.

## Pass condition

THE QUESTION WAS UNDERSTOOD and THE CORRECT SUBJECT WAS RESEARCHED and THE REQUIRED WINDOW WAS USED
and DECISION-CRITICAL REQUIREMENTS WERE COVERED and THE REQUIRED ANALYSIS WAS PERFORMED and
COUNTEREVIDENCE WAS TESTED and THE CONCLUSION IS TRACEABLE and NO STALE/UNRELATED EVIDENCE
CONTAMINATED THE RUN and THE RESULT IS DECISION-USEFUL and MATERIAL UNKNOWNS ARE EXPLICIT.

## Running

```bash
npx vitest run tests/benchmark/          # deterministic suites
node scripts/live-check.mjs "question"   # live run against the deployed API (post-deploy)
```
