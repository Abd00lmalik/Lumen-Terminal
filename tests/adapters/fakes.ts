import { type McpCallOutcome } from "../../src/adapters/transports/mcp.js";
import { TransportError } from "../../src/adapters/transports/resilience.js";
import type { Candle } from "../../src/adapters/transports/rest.js";

/** McpTransport test double: records calls, scripts outcomes, no HTTP. */
export class FakeMcpTransport {
  readonly calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  private outcomes: Array<{ content?: unknown[]; error?: Error }> = [];

  script(...outcomes: Array<{ content?: unknown[]; error?: Error }>): void {
    this.outcomes = [...outcomes];
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

  get rawCapture(): { size: number } {
    return { size: this.calls.length };
  }
}

/** RestTransport test double: records GETs, scripts JSON bodies, no HTTP. */
export class FakeRestTransport {
  readonly gets: Array<{ path: string; params: Record<string, string> }> = [];
  private outcomes: Array<{ body?: string; error?: Error }> = [];

  script(...outcomes: Array<{ body?: string; error?: Error }>): void {
    this.outcomes = [...outcomes];
  }

  async get(path: string, options: { params?: Record<string, string> } = {}): Promise<{ body: unknown; rawReference: string; attempts: number; durationMs: number; status: number }> {
    this.gets.push({ path, params: options.params ?? {} });
    const step = this.outcomes.shift();
    if (!step) throw new TransportError("UNAVAILABLE", "no scripted response", { retriable: false });
    if (step.error) throw step.error;
    return {
      body: JSON.parse(step.body ?? "{}"),
      rawReference: `fake://rest-${this.gets.length}`,
      attempts: 1,
      durationMs: 3,
      status: 200,
    };
  }
}

export function makeCandle(ts: string, close: string): Candle {
  return { ts, open: close, high: close, low: close, close, baseVolume: "1", quoteVolume: "1" };
}
