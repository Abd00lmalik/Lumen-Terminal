/**
 * REQUEST BUDGETING (provider request-size law).
 *
 * A model request is serialized bytes the provider must accept. Nothing in the pipeline used to
 * measure them, so the payload grew with the WORKSPACE rather than with the question: a fresh
 * investigation on a long-lived workspace serialized ~57 KB for its target-resolution call
 * (a bare list of every evidence id in the archive), and on a busier workspace that crossed
 * the provider's 128 KiB limit — the trader's question was rejected with HTTP 413 before any
 * research happened.
 *
 * This module makes the size a first-class, deterministic fact:
 *   - `measureRequest` decomposes a request into its components (system / schema / prompt);
 *   - `budgetRequest` compacts an oversized request to fit a provider's limit, dropping whole
 *     trailing lines from the LARGEST removable blocks and saying so in the prompt, so the
 *     model is never left believing it saw something it did not;
 *   - `requestBudgetReport` publishes what happened to a development/test observer.
 *
 * WHAT COMPACTION NEVER DOES: it never touches the system instructions, the output schema, or
 * any line the caller marked as protected (the trader's own words), and it never invents,
 * drops-as-silent, or reorders evidence — it removes whole context LINES and records the
 * omission in-band. Nothing here changes what the engine believes: a compacted request can only
 * ever produce a more cautious answer, never a fabricated one.
 */
import type { StructuredRequest } from "./provider.js";

/**
 * Accepted serialized request size per provider, in BYTES (not tokens: the failure is the
 * transport's, so the transport's unit is the one that matters). Groq's chat/completions
 * endpoint rejects bodies over 128 KiB; Gemini's limit is an order of magnitude larger.
 */
export const PROVIDER_REQUEST_LIMIT_BYTES: Readonly<Record<string, number>> = {
  groq: 131_072,
  gemini: 1_000_000,
};

/** Unknown providers get a conservative default rather than an unbounded request. */
export const DEFAULT_REQUEST_LIMIT_BYTES = 131_072;

/** How much of the limit the first attempt may use (headroom for provider-side additions). */
const USABLE_FRACTION = 0.9;

export interface RequestComponents {
  readonly systemBytes: number;
  readonly schemaBytes: number;
  readonly promptBytes: number;
  /** Bytes the JSON envelope adds (messages wrapper, role names, escaping slack). */
  readonly envelopeBytes: number;
}

export interface RequestBudgetReport {
  readonly providerId: string;
  readonly modelId: string;
  readonly schemaName: string;
  readonly limitBytes: number;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly components: RequestComponents;
  readonly compacted: boolean;
  readonly droppedLines: number;
  /** Set when this attempt runs on a reduced budget after an earlier provider's 413. */
  readonly fallbackReason?: string;
}

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/**
 * Bytes the JSON envelope itself adds on top of the message contents: the `messages` array,
 * two role/content key pairs, the `model`/`response_format` members, JSON escaping slack.
 * Measured conservatively (not minimal) so a request that "fits" by this count really fits.
 */
export const ENVELOPE_BYTES = 512;

function systemAndSchemaBytesOf(request: StructuredRequest, override?: number): number {
  return override ?? bytes(request.system ?? "") + bytes(request.schemaDescription ?? "");
}

/** The serialized shape a chat-completions provider sends, measured honestly. */
export function serializedRequestBytes(request: StructuredRequest, systemWithSchemaBytes?: number): number {
  return systemAndSchemaBytesOf(request, systemWithSchemaBytes) + bytes(request.prompt ?? "") + ENVELOPE_BYTES;
}

export function measureRequest(request: StructuredRequest): RequestComponents {
  return {
    systemBytes: bytes(request.system ?? ""),
    schemaBytes: bytes(request.schemaDescription ?? ""),
    promptBytes: bytes(request.prompt ?? ""),
    envelopeBytes: ENVELOPE_BYTES,
  };
}

/** Development/test observability hook. Never wired to a trader-facing surface. */
let observer: ((report: RequestBudgetReport) => void) | undefined;

export function setRequestBudgetObserver(fn: ((report: RequestBudgetReport) => void) | undefined): void {
  observer = fn;
}

export function requestBudgetObserver(): ((report: RequestBudgetReport) => void) | undefined {
  return observer;
}

export function publishRequestBudget(report: RequestBudgetReport): void {
  observer?.(report);
}

export function limitForProvider(providerId: string): number {
  return PROVIDER_REQUEST_LIMIT_BYTES[providerId] ?? DEFAULT_REQUEST_LIMIT_BYTES;
}

/**
 * The trader's own words, in the shape every call site writes them. Protected by default so the
 * budget layer can never silently answer a DIFFERENT question than the one that was asked
 * (the invariant that "we do not truncate the user's question" must hold mechanically, not by
 * reviewer discipline).
 */
export function traderWords(userMessage: string): readonly string[] {
  return [`Trader message: "${userMessage}"`, userMessage];
}

const COMPACTION_MARKER = (dropped: number): string =>
  `[context compacted: ${dropped} line(s) omitted to fit the provider's request limit; the full context remains in the workspace]`;

interface CompactionInput {
  readonly limitBytes: number;
  readonly systemAndSchemaBytes: number;
}

/**
 * Compact the prompt until the request fits `limitBytes`.
 *
 * Deterministic and shape-preserving: the prompt's first line and every protected line always
 * survive; droppable lines are removed deepest-indentation-first from the end of each block, so
 * the cost is concentrated in the least load-bearing context; and ONE in-band marker records
 * the omission, so the model is never left believing it saw something it did not. Returns the
 * original prompt unchanged when it already fits.
 */
export function compactPrompt(prompt: string, protectedFragments: readonly string[], input: CompactionInput): { text: string; droppedLines: number } {
  const lines = prompt.split("\n");
  if (input.systemAndSchemaBytes + bytes(prompt) + ENVELOPE_BYTES <= input.limitBytes) {
    return { text: prompt, droppedLines: 0 };
  }

  // A line is droppable only if it is NOT the prompt's leading line (which carries the task)
  // and NOT a protected fragment (the trader's own words, the citable-evidence header).
  // Nothing is dropped up front: compaction REMOVES lines from an otherwise intact prompt.
  const droppable = lines.map(
    (line, i) =>
      i !== 0 &&
      line.trim() !== "" &&
      !protectedFragments.some((f) => f.length > 0 && line.includes(f)),
  );
  const dropped = lines.map(() => false);
  const joined = (): string => lines.filter((_, j) => !dropped[j]).join("\n");

  // Deeper-indented lines are the most specific (and most redundant) context, so they go
  // first, from the END of the block backwards: the fewest possible least-load-bearing lines.
  const order = lines
    .map((line, i) => ({ i, indent: line.length - line.trimStart().length }))
    .filter(({ i }) => droppable[i]!)
    .sort((a, b) => b.indent - a.indent || b.i - a.i)
    .map(({ i }) => i);

  // Track the remaining size incrementally. Re-joining the prompt per dropped line would be
  // quadratic, and this runs on the hot path of every oversized request.
  const lineBytes = lines.map((line) => bytes(line) + 1); // +1 for the joining newline
  let remaining = lineBytes.reduce((a, b) => a + b, 0);
  let droppedLines = 0;
  const markerAt = (n: number): number => bytes(COMPACTION_MARKER(n));
  let size = input.systemAndSchemaBytes + remaining + ENVELOPE_BYTES;
  for (const i of order) {
    if (size <= input.limitBytes) break;
    dropped[i] = true;
    remaining -= lineBytes[i]!;
    droppedLines++;
    // The marker is part of what goes on the wire, so its size is accounted for exactly.
    size = input.systemAndSchemaBytes + remaining + ENVELOPE_BYTES + markerAt(droppedLines);
  }

  if (droppedLines === 0) {
    // Nothing droppable at all (e.g. one enormous protected line): clip from the END of the
    // prompt, never touching line 0, and say so in-band.
    const room = Math.max(0, input.limitBytes - input.systemAndSchemaBytes - ENVELOPE_BYTES - bytes(COMPACTION_MARKER(1)) - 1);
    return { text: `${prompt.slice(0, room)}\n${COMPACTION_MARKER(1)}`, droppedLines: 1 };
  }
  const text = `${joined()}\n${COMPACTION_MARKER(droppedLines)}`;
  return { text, droppedLines };
}

export interface BudgetOptions {
  readonly providerId: string;
  readonly modelId: string;
  /** Explicit ceiling for this attempt (a fallback attempt passes a reduced one). */
  readonly limitBytes?: number;
  /** System + schema bytes as the provider will send them (schema is appended to system). */
  readonly systemAndSchemaBytes?: number;
  readonly fallbackReason?: string;
}

/**
 * The request as a provider should send it, plus the report describing what it did.
 * Called by every provider immediately before serialization.
 */
export function budgetRequest(
  request: StructuredRequest,
  options: BudgetOptions,
): { request: StructuredRequest; report: RequestBudgetReport } {
  const limitBytes = options.limitBytes ?? request.limitBytes ?? limitForProvider(options.providerId);
  const systemAndSchemaBytes = options.systemAndSchemaBytes ?? systemAndSchemaBytesOf(request);
  const fallbackReason = options.fallbackReason ?? request.fallbackReason;
  const usable = Math.floor(limitBytes * USABLE_FRACTION);
  const components = measureRequest(request);
  const before = serializedRequestBytes(request, systemAndSchemaBytes);
  const protectedFragments = request.protectedFragments ?? [];
  const { text, droppedLines } = compactPrompt(request.prompt ?? "", protectedFragments, {
    limitBytes: usable,
    systemAndSchemaBytes,
  });
  const compactedRequest: StructuredRequest = droppedLines > 0 ? { ...request, prompt: text } : request;
  const report: RequestBudgetReport = {
    providerId: options.providerId,
    modelId: options.modelId,
    schemaName: request.schemaName,
    limitBytes,
    bytesBefore: before,
    bytesAfter: serializedRequestBytes(compactedRequest, systemAndSchemaBytes),
    components,
    compacted: droppedLines > 0,
    droppedLines,
    ...(fallbackReason !== undefined ? { fallbackReason } : {}),
  };
  publishRequestBudget(report);
  return { request: compactedRequest, report };
}

/** Fraction of a provider's limit a reduced (post-413 fallback) attempt may use. */
export const FALLBACK_BUDGET_FRACTION = 0.4;