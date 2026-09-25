/**
 * SSE client edge-case tests — deterministic, no network.
 *
 * Laws under test (SSE/error-path audit):
 * - CHUNK BOUNDARIES: an event split across arbitrary read boundaries parses; a terminal
 *   `final`/`error` delivered in the LAST chunk without a trailing blank line is still
 *   parsed (a dropped final used to leave the UI "researching" forever).
 * - CRLF TRANSPORT: an intermediary normalizing line endings to CRLF must not break parsing.
 * - HEARTBEAT COMMENTS: `: heartbeat` comments (even split across reads) never render.
 * - MULTI-BYTE SPLITS: a UTF-8 character split across reads is decoded via decoder flush.
 * - MALFORMED TERMINALS: a malformed `final`/`error` payload surfaces a typed
 *   INTERNAL_ERROR instead of failing silently (silence = eternal spinner).
 * - MALFORMED PROGRESS: skipped without aborting the stream.
 * - TERMINAL-ONCE: after `final`, a later connection reset must NOT produce an error
 *   turn (no phantom failure after a delivered result).
 * - NON-STREAM FAILURE: non-OK responses normalize through parseErrorBody to ApiError.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { streamResearch, ApiError } from "../src/api/client.js";

const encoder = new TextEncoder();

function sseResponse(chunks: readonly string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

const FINAL_DTO = {
  requestId: "req_1",
  action: "RESEARCH",
  outcome: "COMPLETED",
  answer: { answer: "BTC moved on macro news.", supportingReasons: [], opposingReasons: [], confidence: "MEDIUM", keyUncertainty: "", implication: "", citedObjectRefs: [] },
  limitations: [],
  evidenceRefs: [],
  evidence: [],
  judgments: [],
};

interface Received {
  progress: { stage: string; summary: string }[];
  final: unknown[];
  errors: ApiError[];
  connectionLost: number;
}

function collect(): { received: Received; handlers: Parameters<typeof streamResearch>[2] } {
  const received: Received = { progress: [], final: [], errors: [], connectionLost: 0 };
  const handlers = {
    onProgress: (e: { stage: string; summary: string }) => received.progress.push(e),
    onFinal: (r: unknown) => received.final.push(r),
    onError: (e: ApiError) => received.errors.push(e),
    onConnectionLost: () => {
      received.connectionLost += 1;
    },
  };
  return { received, handlers };
}

function mockFetchWith(res: Response | Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(async () => res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE chunk boundaries", () => {
  it("parses a terminal final delivered in the last chunk WITHOUT a trailing blank line", async () => {
    mockFetchWith(sseResponse(["event: progress\ndata: {\"stage\":\"plan_created\",\"summary\":\"plan\"}\n\n", "event: final\ndata: " + JSON.stringify(FINAL_DTO)]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.progress).toHaveLength(1);
    expect(received.final).toHaveLength(1);
    expect((received.final[0] as { outcome: string }).outcome).toBe("COMPLETED");
    expect(received.errors).toHaveLength(0);
    expect(received.connectionLost).toBe(0);
  });

  it("parses an event split mid-JSON across read boundaries", async () => {
    const finalLine = "event: final\ndata: " + JSON.stringify(FINAL_DTO) + "\n\n";
    const cut = finalLine.indexOf('"COMPLETED"') + 5;
    mockFetchWith(sseResponse([finalLine.slice(0, cut), finalLine.slice(cut)]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.final).toHaveLength(1);
    expect(received.errors).toHaveLength(0);
  });

  it("decodes a UTF-8 multi-byte character split across reads (decoder flush)", async () => {
    const withUtf8 = { ...FINAL_DTO, answer: { ...FINAL_DTO.answer, answer: "BTC moved on macro news; uncertainty remains ◆ high." } };
    const last = "event: final\ndata: " + JSON.stringify(withUtf8);
    const bytes = encoder.encode(last);
    const splitAt = bytes.findIndex((b, i) => i > 20 && b === 0xe2); // mid multi-byte sequence
    const first = bytes.slice(0, splitAt);
    const rest = bytes.slice(splitAt);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(first);
        c.enqueue(rest);
        c.close();
      },
    });
    mockFetchWith(new Response(stream, { status: 200 }));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.final).toHaveLength(1);
    expect((received.final[0] as { answer: { answer: string } }).answer.answer).toContain("◆");
    expect(received.errors).toHaveLength(0);
  });
});

describe("SSE transport variance", () => {
  it("parses a CRLF-normalized stream (intermediary line-ending rewrite)", async () => {
    const body = "event: progress\r\ndata: {\"stage\":\"intent_understood\",\"summary\":\"ok\"}\r\n\r\nevent: final\r\ndata: " + JSON.stringify(FINAL_DTO) + "\r\n\r\n";
    mockFetchWith(sseResponse([body]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.progress).toHaveLength(1);
    expect(received.final).toHaveLength(1);
    expect(received.errors).toHaveLength(0);
  });

  it("ignores heartbeat comments, including one split across reads", async () => {
    mockFetchWith(sseResponse([": heartbeat", "\n\nevent: final\ndata: " + JSON.stringify(FINAL_DTO) + "\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.progress).toHaveLength(0);
    expect(received.final).toHaveLength(1);
  });
});

describe("malformed terminal events must never fail silently", () => {
  it("malformed final payload → typed INTERNAL_ERROR (no eternal spinner)", async () => {
    mockFetchWith(sseResponse(["event: final\ndata: {\"outcome\": \"COMPLETED\"\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.final).toHaveLength(0);
    expect(received.errors).toHaveLength(1);
    expect(received.errors[0]!.code).toBe("INTERNAL_ERROR");
  });

  it("malformed error payload → typed INTERNAL_ERROR", async () => {
    mockFetchWith(sseResponse(["event: error\ndata: \"just a string\"\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.errors).toHaveLength(1);
    expect(received.errors[0]!.code).toBe("INTERNAL_ERROR");
  });

  it("malformed PROGRESS event is skipped without aborting the stream", async () => {
    mockFetchWith(sseResponse(["event: progress\ndata: not-json\n\nevent: final\ndata: " + JSON.stringify(FINAL_DTO) + "\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.progress).toHaveLength(0);
    expect(received.final).toHaveLength(1);
    expect(received.errors).toHaveLength(0);
  });

  it("final payload without a renderable answer → typed INTERNAL_ERROR, never a bogus render", async () => {
    mockFetchWith(sseResponse(["event: final\ndata: {\"outcome\":\"COMPLETED\"}\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.final).toHaveLength(0);
    expect(received.errors).toHaveLength(1);
    expect(received.errors[0]!.code).toBe("INTERNAL_ERROR");
  });
});

describe("premature EOF (no terminal event) is reported honestly", () => {
  it("a stream that ends with only progress events surfaces connection-lost, never an eternal spinner", async () => {
    // Production shape: the serverless function was killed at the platform limit mid-run, so
    // the SSE body ended without `final`/`error`. The UI must stop "Researching…" and say so.
    mockFetchWith(sseResponse(["event: progress\ndata: {\"stage\":\"capability_started\",\"summary\":\"running\"}\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("What is driving gold prices this week?", {}, handlers);
    expect(received.progress).toHaveLength(1);
    expect(received.final).toHaveLength(0);
    expect(received.errors).toHaveLength(0);
    expect(received.connectionLost).toBe(1);
  });

  it("a typed error event followed by EOF produces exactly ONE terminal signal", async () => {
    const body = "event: error\ndata: " + JSON.stringify({ error: { code: "MODEL_FAILURE", message: "provider exhausted" } }) + "\n\n";
    mockFetchWith(sseResponse([body]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.errors).toHaveLength(1);
    expect(received.errors[0]!.code).toBe("MODEL_FAILURE");
    expect(received.connectionLost).toBe(0); // the failure turn is not duplicated
  });

  it("a delivered final is never followed by a connection-lost signal", async () => {
    mockFetchWith(sseResponse(["event: final\ndata: " + JSON.stringify(FINAL_DTO) + "\n\n"]));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.final).toHaveLength(1);
    expect(received.connectionLost).toBe(0);
  });
});

describe("terminal-once semantics", () => {
  it("a connection reset AFTER final is delivered does not produce an error/connection-lost callback", async () => {
    // ReadableStream.error() discards queued chunks, so the reset must fire only after
    // the reader has consumed the final event (a post-result teardown reset).
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamController = c;
        c.enqueue(encoder.encode("event: final\ndata: " + JSON.stringify(FINAL_DTO) + "\n\n"));
      },
    });
    setTimeout(() => streamController.error(new Error("connection reset during teardown")), 10);
    mockFetchWith(new Response(stream, { status: 200 }));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.final).toHaveLength(1);
    expect(received.errors).toHaveLength(0);
    expect(received.connectionLost).toBe(0);
  });
});

describe("non-stream failures", () => {
  it("HTTP error response normalizes through the typed error body", async () => {
    mockFetchWith(new Response(JSON.stringify({ error: { code: "MODEL_FAILURE", message: "quota exhausted" } }), { status: 503 }));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.errors).toHaveLength(1);
    expect(received.errors[0]!.code).toBe("MODEL_FAILURE");
    expect(received.errors[0]!.message).toBe("quota exhausted");
  });

  it("transport-level connection failure → onError NETWORK (never a hang)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const { received, handlers } = collect();
    await streamResearch("Why did BTC move?", {}, handlers);
    expect(received.errors).toHaveLength(1);
    expect(received.errors[0]!.code).toBe("NETWORK");
  });
});
