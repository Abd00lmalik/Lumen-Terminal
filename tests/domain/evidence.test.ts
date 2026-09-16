import { beforeEach, describe, expect, it } from "vitest";
import { normalizedResult, isInterpretationClass, type ToolResult } from "../../src/domain/tool-result.js";
import { evidenceFromToolResult, assessEvidenceQuality } from "../../src/domain/evidence.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

function okResult(overrides: Partial<ToolResult> = {}): ToolResult {
  const base = normalizedResult(
    {
      tool: "bitget-signal/news-briefing",
      capability: "NEWS_ANALYSIS",
      transport: "mcp:public-market-data",
      params: { topic: "BTC" },
      rawReference: "raw://resp-1",
      outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: "ETF announcement reported by 3 outlets" }],
      validation: "VALID",
    },
    origin,
  );
  return { ...base, ...overrides };
}

describe("TOOL_RESULT normalization (tool-skill-orchestration.md §18, lock §7)", () => {
  beforeEach(() => resetIdCounters());

  it("normalizes identity, capability, transport, invocation, raw reference", () => {
    const result = okResult();
    expect(result.tool).toBe("bitget-signal/news-briefing");
    expect(result.capability).toBe("NEWS_ANALYSIS");
    expect(result.transport).toBe("mcp:public-market-data");
    expect(result.invocation.params).toEqual({ topic: "BTC" });
    expect(result.invocation.at).toBeTruthy();
    expect(result.rawReference).toBe("raw://resp-1");
    expect(result.failure.type).toBe("NONE");
  });

  it("a failing call produces a result, never fabricated outputs", () => {
    const result = normalizedResult(
      {
        tool: "bitget-signal/market-intel",
        capability: "MARKET_DATA_ANALYSIS",
        transport: "mcp:public-market-data",
        params: {},
        completeness: "EMPTY",
        validation: "VALID",
        failure: { type: "TIMEOUT", message: "upstream timeout", retriable: true },
        limitations: ["timeout after 2 retries"],
      },
      origin,
    );
    expect(result.normalizedOutput).toHaveLength(0);
    expect(result.completeness).toBe("EMPTY");
    expect(result.failure.type).toBe("TIMEOUT");
    expect(result.failure.retriable).toBe(true);
  });

  it("partial responses keep PARTIAL completeness and limitations", () => {
    const result = normalizedResult(
      {
        tool: "bitget-signal/news-briefing",
        capability: "NEWS_ANALYSIS",
        transport: "mcp:public-market-data",
        params: {},
        outputs: [{ outputClass: "FACTUAL_OBSERVATION", content: "one feed responded" }],
        completeness: "PARTIAL",
        limitations: ["3 of 4 feeds failed; per-feed errors skipped"],
        validation: "VALID",
      },
      origin,
    );
    expect(result.completeness).toBe("PARTIAL");
    expect(result.limitations).toContain("3 of 4 feeds failed; per-feed errors skipped");
  });
});

describe("evidence classification (evidence-source.md, lock §7)", () => {
  beforeEach(() => resetIdCounters());

  it("factual observation → OBSERVATION evidence", () => {
    const result = okResult();
    const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
    expect(evidence.evidenceClass).toBe("OBSERVATION");
    expect(evidence.toolResultRef).toBe(result.id);
    expect(evidence.sourceRefs).toContain("raw://resp-1");
  });

  it("skill interpretation must NOT silently become factual observation (lock §7)", () => {
    const result = normalizedResult(
      {
        tool: "bitget-signal/macro-analyst",
        capability: "MACRO_ANALYSIS",
        transport: "mcp:public-market-data",
        params: {},
        outputs: [
          { outputClass: "ANALYST_INTERPRETATION", content: "RISK-OFF regime likely", interpretationBasis: "skill-authored verdict template" },
          { outputClass: "QUANTITATIVE_OBSERVATION", content: "10Y at 4.2%", },
        ],
        validation: "VALID",
      },
      origin,
    );
    const interp = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
    const obs = evidenceFromToolResult(result, result.normalizedOutput[1]!, origin);
    expect(interp.evidenceClass).toBe("DERIVED_OBSERVATION");
    expect(obs.evidenceClass).toBe("OBSERVATION");
    expect(isInterpretationClass("ANALYST_INTERPRETATION")).toBe(true);
    expect(isInterpretationClass("QUANTITATIVE_OBSERVATION")).toBe(false);
  });

  it("proxy classification is preserved with its basis (lock §3 market-intel rule)", () => {
    const result = normalizedResult(
      {
        tool: "bitget-signal/market-intel",
        capability: "MARKET_DATA_ANALYSIS",
        transport: "mcp:public-market-data",
        params: {},
        outputs: [{ outputClass: "INFERENCE", content: "whale accumulation inferred" }],
        validation: "VALID",
      },
      origin,
    );
    const evidence = evidenceFromToolResult(
      result,
      result.normalizedOutput[0]!,
      origin,
      { forceProxy: { basis: "derivatives positioning proxy — NOT direct on-chain whale observation" } },
    );
    expect(evidence.evidenceClass).toBe("PROXY_EVIDENCE");
    expect(evidence.proxyBasis).toMatch(/NOT direct on-chain/);
  });

  it("failed tool results must not become evidence (lock §10)", () => {
    const failed = normalizedResult(
      {
        tool: "x",
        capability: "NEWS_ANALYSIS",
        transport: "t",
        failure: { type: "RATE_LIMIT", retriable: true },
        validation: "VALID",
      },
      origin,
    );
    expect(() =>
      evidenceFromToolResult(failed, { outputClass: "FACTUAL_OBSERVATION", content: "nope" }, origin),
    ).toThrow(/must not become evidence/);
  });

  it("invalid results are rejected before entering the graph (orchestration §20)", () => {
    const invalid = okResult({ validation: "INVALID" });
    expect(() =>
      evidenceFromToolResult(invalid, { outputClass: "FACTUAL_OBSERVATION", content: "nope" }, origin),
    ).toThrow(/validation/);
  });

  it("QUALITY ≠ CONFIDENCE: quality assesses evidence, not the assessment (lock §10)", () => {
    const result = okResult();
    const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
    const quality = assessEvidenceQuality(evidence);
    // quality factors exist and are bounded; confidence is NOT among them
    for (const value of Object.values(quality)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(quality)).not.toContain("confidence");
  });

  it("stale freshness is preserved, not upgraded", () => {
    const result = okResult({ freshness: "STALE" });
    const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
    expect(evidence.freshness).toBe("STALE");
  });
});
