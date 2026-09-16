import { beforeEach, describe, expect, it } from "vitest";
import { BitgetSkillAdapter, type SkillDescriptor, type OutputMapping } from "../../src/adapters/bitget-skill-adapter.js";
import { McpTransport, type McpCallOutcome } from "../../src/adapters/transports/mcp.js";
import { FRESHNESS_PROFILES } from "../../src/adapters/freshness.js";
import { TransportError } from "../../src/adapters/transports/resilience.js";
import { evidenceFromToolResult } from "../../src/domain/evidence.js";
import { normalizedResult } from "../../src/domain/tool-result.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

/** McpTransport test double: records calls, scripts responses, no HTTP. */
class FakeMcpTransport {
  readonly calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  private outcomes: Array<{ content?: unknown[]; error?: Error }> = [];

  script(...outcomes: Array<{ content?: unknown[]; error?: Error }>): void {
    this.outcomes = outcomes;
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<McpCallOutcome> {
    this.calls.push({ tool, args });
    const step = this.outcomes.shift();
    if (!step) throw new TransportError("UNAVAILABLE", "no scripted response", { retriable: false });
    if (step.error) throw step.error;
    return {
      content: step.content ?? [],
      isError: false,
      rawReference: `fake://raw-${this.calls.length}`,
      attempts: 1,
      durationMs: 5,
    };
  }
}

function makeAdapter(
  transport: FakeMcpTransport,
  overrides: {
    descriptor?: Partial<SkillDescriptor>;
    mapping?: Partial<OutputMapping>;
    toolFor?: (capability: string) => { toolName: string; buildArgs: (p: Record<string, unknown>) => Record<string, unknown> } | undefined;
  } = {},
): BitgetSkillAdapter {
  const descriptor: SkillDescriptor = {
    providerId: overrides.descriptor?.providerId ?? "bitget-signal/test-skill",
    capabilities: overrides.descriptor?.capabilities ?? ["NEWS_ANALYSIS"],
    limitations: overrides.descriptor?.limitations ?? ["test limitation"],
    freshnessProfile: overrides.descriptor?.freshnessProfile ?? "rss",
    dataClasses: overrides.descriptor?.dataClasses ?? [],
    ...overrides.descriptor,
  };
  return new BitgetSkillAdapter({
    descriptor,
    transport: transport as unknown as McpTransport,
    toolFor: overrides.toolFor ?? (() => ({ toolName: "news_feed", buildArgs: (p) => p })),
    outputMapping: {
      narrativeClass: "ANALYST_INTERPRETATION",
      dataClass: "FACTUAL_OBSERVATION",
      ...overrides.mapping,
    },
  });
}

const textBlock = (text: string) => ({ type: "text", text });

describe("Bitget skill adapters (final lock §3/§7/§8)", () => {
  beforeEach(() => resetIdCounters());

  it("invokes the mapped MCP tool with capability params and preserves provenance", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [textBlock("Fed held rates steady")] });
    const adapter = makeAdapter(transport, {
      toolFor: () => ({ toolName: "news_feed", buildArgs: (p) => ({ ...p, category: "crypto" }) }),
    });

    const input = await adapter.execute("NEWS_ANALYSIS", { keywords: "FOMC" });

    expect(transport.calls).toEqual([{ tool: "news_feed", args: { keywords: "FOMC", category: "crypto" } }]);
    expect(input.tool).toBe("bitget-signal/test-skill");
    expect(input.transport).toBe("mcp:news_feed");
    expect(input.params).toEqual({ keywords: "FOMC", __tool: "news_feed" });
    expect(input.rawReference).toMatch(/^fake:\/\/raw-\d+$/);
    expect(input.validation).toBe("VALID");
    expect(input.completeness).toBe("COMPLETE");
  });

  it("classifies narrative text as interpretation; never silently as observation (lock §7)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [textBlock("Risk sentiment deteriorates; RISK-OFF regime likely")] });
    const adapter = makeAdapter(transport);

    const input = await adapter.execute("NEWS_ANALYSIS", {});
    const narrative = input.outputs![0]!;
    expect(narrative.outputClass).toBe("ANALYST_INTERPRETATION");
    expect(narrative.interpretationBasis).toContain("skill-authored");
    // through the evidence boundary it must be DERIVED_OBSERVATION, not OBSERVATION
    const result = normalizedResult({ ...input, capability: "NEWS_ANALYSIS" }, origin);
    const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
    expect(evidence.evidenceClass).toBe("DERIVED_OBSERVATION");
  });

  it("classifies JSON/structured payloads as data observations; numeric macro data as quantitative", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [textBlock(JSON.stringify({ indicator: "CPI", value: 3.1, about: "US" }))] });
    const adapter = makeAdapter(transport, {
      descriptor: { freshnessProfile: "macro" },
      mapping: { dataClass: "QUANTITATIVE_OBSERVATION" },
    });

    const input = await adapter.execute("NEWS_ANALYSIS", {});
    const output = input.outputs![0]!;
    expect(output.outputClass).toBe("QUANTITATIVE_OBSERVATION");
    expect((output.content as { indicator: string }).indicator).toBe("CPI");
    expect(output.about).toBe("US");
  });

  it("market-intel proxy outputs carry proxyBasis and become PROXY_EVIDENCE (lock §3)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [textBlock(JSON.stringify({ metric: "etf_flow_proxy", value: 120 })) ] });
    const adapter = makeAdapter(transport, {
      descriptor: { providerId: "bitget-signal/market-intel", limitations: ["not on-chain"] },
      mapping: { proxyBasis: "dominance-derived proxy; NOT direct on-chain or ETF-flow observation" },
    });

    const input = await adapter.execute("MARKET_DATA_ANALYSIS", {});
    expect(input.outputs![0]!.proxyBasis).toContain("NOT direct on-chain");
    const result = normalizedResult({ ...input, capability: "MARKET_DATA_ANALYSIS" }, origin);
    const evidence = evidenceFromToolResult(result, result.normalizedOutput[0]!, origin);
    expect(evidence.evidenceClass).toBe("PROXY_EVIDENCE");
    expect(evidence.proxyBasis).toBeDefined();
  });

  it("neutral 'data temporarily unavailable' text is preserved as UNAVAILABLE, never fabricated over (lock §18)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [textBlock("Data temporarily unavailable for this source")] });
    const adapter = makeAdapter(transport);

    const input = await adapter.execute("NEWS_ANALYSIS", {});
    expect(input.outputs![0]!.outputClass).toBe("UNAVAILABLE");
    expect(input.completeness).toBe("EMPTY");
    expect(input.limitations!.some((l) => /temporarily unavailable/.test(l))).toBe(true);
    // UNAVAILABLE outputs can never become evidence:
    const result = normalizedResult({ ...input, capability: "NEWS_ANALYSIS" }, origin);
    expect(() => evidenceFromToolResult(result, result.normalizedOutput[0]!, origin)).toThrow(/must not become evidence/);
  });

  it("partial per-source failure → PARTIAL completeness with limitation (FINDINGS.md §2.5)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({
      content: [
        textBlock("Feed A: ETF approved by SEC"),
        textBlock("data temporarily unavailable"),
      ],
    });
    const adapter = makeAdapter(transport);

    const input = await adapter.execute("NEWS_ANALYSIS", {});
    expect(input.completeness).toBe("PARTIAL");
    expect(input.limitations!.some((l) => /1 of 2 content blocks/.test(l))).toBe(true);
  });

  it("empty tool response → EMPTY result, NOT a failure (failure-recovery.md §10: NO RESULT ≠ FAILED)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [] });
    const adapter = makeAdapter(transport);

    const input = await adapter.execute("NEWS_ANALYSIS", {});
    expect(input.completeness).toBe("EMPTY");
    expect(input.failure).toBeUndefined(); // adapter-level input has no failure; call succeeded
    expect(input.outputs).toEqual([]);
  });

  it("transport failures propagate as typed TransportErrors (registry converts to failed TOOL_RESULT)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ error: new TransportError("TIMEOUT", "upstream timeout", { retriable: true }) });
    const adapter = makeAdapter(transport);
    await expect(adapter.execute("NEWS_ANALYSIS", {})).rejects.toMatchObject({ failureType: "TIMEOUT" });
  });

  it("capability with no tool mapping throws permanent SCHEMA_ERROR (no silent fallback)", async () => {
    const transport = new FakeMcpTransport();
    const adapter = makeAdapter(transport, { toolFor: () => undefined });
    await expect(adapter.execute("UNKNOWN_CAPABILITY", {})).rejects.toMatchObject({
      failureType: "SCHEMA_ERROR",
      retriable: false,
    });
  });

  it("freshness profile + documented lag travel on every result (lock §8)", async () => {
    const transport = new FakeMcpTransport();
    transport.script({ content: [textBlock("headline")] });
    const adapter = makeAdapter(transport, { descriptor: { freshnessProfile: "rss" } });

    const input = await adapter.execute("NEWS_ANALYSIS", {});
    expect(input.freshness).toBe("CURRENT");
    expect(input.limitations!.some((l) => l.includes(FRESHNESS_PROFILES.rss.documentedLag))).toBe(true);
  });

  it("stale event time → STALE verdict recorded in freshness + limitations (lock §8)", async () => {
    const transport = new FakeMcpTransport();
    const oldCandle = { ts: String(Date.now() - 26 * 60 * 60 * 1000), close: "100" };
    transport.script({ content: [{ type: "text", text: JSON.stringify(oldCandle) }] });
    const adapter = makeAdapter(
      transport,
      {
        descriptor: { freshnessProfile: "marketStructure" },
      },
    );
    // simulate extractSourceTimestamp wiring via a second adapter with the hook:
    const adapterWithHook = new BitgetSkillAdapter({
      descriptor: {
        providerId: "bitget-signal/test-ta",
        capabilities: ["TECHNICAL_ANALYSIS"],
        limitations: [],
        freshnessProfile: "marketStructure",
        dataClasses: [],
      },
      transport: transport as unknown as McpTransport,
      toolFor: () => ({ toolName: "crypto_market", buildArgs: (p) => p }),
      outputMapping: { narrativeClass: "ANALYST_INTERPRETATION", dataClass: "QUANTITATIVE_OBSERVATION" },
      extractSourceTimestamp: (content) => {
        const first = content[0] as { text?: string } | undefined;
        const parsed = JSON.parse(first?.text ?? "{}") as { ts?: string };
        return parsed.ts !== undefined ? new Date(Number(parsed.ts)).toISOString() : undefined;
      },
    });

    const input = await adapterWithHook.execute("TECHNICAL_ANALYSIS", {});
    expect(input.freshness).toBe("STALE");
    expect(input.sourceTimestamp).toBeDefined();
    expect(input.limitations!.some((l) => /stale relative to profile/.test(l))).toBe(true);
    void adapter;
  });
});
