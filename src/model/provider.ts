/**
 * ModelProvider — the provider-neutral LLM seam (M3).
 *
 * Architectural basis:
 * - M3 mandate §2/§3: Gemini is an implementation detail behind this interface; the core is
 *   provider-neutral. OpenAI/Claude/GLM can implement it without touching LUI/engine/domain.
 * - M3 §24: the LLM is the intelligence/interface layer, NOT the system authority. Every
 *   structured output it returns must be validated (§6) before dispatch; the Research Engine
 *   executes; adapters provide data; workspace/persistence owns state; the trader decides.
 * - Evidence laws survive the model boundary (§9): the context handed to the model preserves
 *   epistemic classes — the model can never "receive" interpretations as observations.
 *
 * Failure semantics (§19/§20): model failure is a typed condition (ModelFailure), distinct from
 * research/tool failure. Providers must never fabricate a response to hide failure.
 */

import type { ISO } from "../domain/objects.js";

// ---------------------------------------------------------------------------
// Model failures — typed, distinct from research failure (M3 §19/§20)
// ---------------------------------------------------------------------------

export type ModelFailureType =
  | "PROVIDER_UNAVAILABLE" // network/HTTP/service outage — retriable
  | "AUTH_FAILURE" // missing/invalid credentials — not retriable
  | "RATE_LIMITED" // quota/429 — retriable with backoff
  | "INVALID_OUTPUT" // response arrived but failed schema/structural validation
  | "TIMEOUT" // request exceeded the deadline — retriable
  | "EMPTY_OUTPUT" // response arrived but contained no usable content
  | "UNKNOWN";

export class ModelFailure extends Error {
  constructor(
    public readonly type: ModelFailureType,
    message: string,
    public readonly retriable: boolean,
  ) {
    super(message);
    this.name = "ModelFailure";
  }
}

// ---------------------------------------------------------------------------
// Usage metadata (token accounting for budgets; no credential material)
// ---------------------------------------------------------------------------

export interface ModelUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

// ---------------------------------------------------------------------------
// Structured request/response envelope
// ---------------------------------------------------------------------------

/**
 * The single primitive every higher-level call reduces to: ask the model for output that
 * must parse as `schemaName`. Providers that support native structured output should use it;
 * all providers must run the returned text through `validateModelOutput` regardless.
 */
export interface StructuredRequest {
  /** Stable schema name (e.g. "lui.interpretation") — included in prompts and validation. */
  readonly schemaName: string;
  /** JSON-schema-ish description of the expected object; providers render it into the prompt. */
  readonly schemaDescription: string;
  /** Full system prompt: role, rules, epistemic constraints. */
  readonly system: string;
  /** The user/task content for this turn. */
  readonly prompt: string;
  /** Prefer JSON mode where the provider supports it (advisory). */
  readonly preferJson?: boolean;
  /** Hard deadline for the call in milliseconds (advisory; transport-enforced where possible). */
  readonly timeoutMs?: number;
}

export interface StructuredResponse<T = unknown> {
  /** The validated parsed object (shape governed by schemaName). */
  readonly data: T;
  /** Raw model text, preserved for audit (never used for machine routing — §6). */
  readonly raw: string;
  readonly schemaName: string;
  readonly usage?: ModelUsage;
  readonly modelId: string;
}

// ---------------------------------------------------------------------------
// The provider-neutral interface
// ---------------------------------------------------------------------------

export interface ModelProvider {
  /** Stable provider identity for provenance, e.g. "google/gemini". */
  readonly providerId: string;
  /** Configured model identifier, e.g. "gemini-2.0-flash" (from GEMINI_MODEL or default). */
  readonly modelId: string;

  /**
   * One structured round-trip. Implementations must:
   * - obtain credentials exclusively from environment configuration (never hardcoded);
   * - throw ModelFailure (typed) on failure — never fabricate output;
   * - return only responses whose `data` passes `validateModelOutput`.
   */
  structured<T>(request: StructuredRequest): Promise<StructuredResponse<T>>;
}

// ---------------------------------------------------------------------------
// Output validation — every model-produced object is validated before dispatch (M3 §6)
// ---------------------------------------------------------------------------

/**
 * Minimal structural validator. `guards` maps property name → expected primitive type;
 * all properties listed are REQUIRED (missing/extra typing beyond this is the schema's concern).
 * Arrays must be `string[]` or `number[]` when so declared.
 */
export type PrimitiveGuard =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "record"
  | "record[]" // array of objects (compound structures are shape-checked by their parsers)
  | "array"; // array of unknown items — ONLY where the call-site parser does entry-level validation and drops malformed entries (never silently coerces)

export interface OutputSchema {
  readonly name: string;
  readonly properties: Readonly<Record<string, PrimitiveGuard>>;
  /**
   * Declared properties that may be ABSENT (mirroring genuinely optional domain fields).
   * When present they are still type-checked; everything not listed here is required.
   */
  readonly optional?: readonly string[];
  /** Allow additional properties beyond those declared (default: false — strict). */
  readonly allowExtra?: boolean;
}

export class ModelValidationError extends ModelFailure {
  constructor(schemaName: string, problems: readonly string[]) {
    super("INVALID_OUTPUT", `model output failed ${schemaName} validation: ${problems.join("; ")}`, false);
    this.name = "ModelValidationError";
  }
}

function guardProblems(
  schema: OutputSchema,
  value: unknown,
): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`expected object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`];
  }
  const record = value as Record<string, unknown>;
  const optionalKeys = new Set(schema.optional ?? []);
  for (const key of Object.keys(record)) {
    // Models legitimately express "not provided" as an explicit JSON null for optional fields
    // (e.g. live Flash-Lite sends researchRef:null on a fresh workspace). null on an OPTIONAL
    // field IS that signal — normalize before guarding instead of failing the whole output.
    if (record[key] === null && optionalKeys.has(key)) delete record[key];
  }
  for (const [key, guard] of Object.entries(schema.properties)) {
    let v = record[key];
    // LIST-SHAPED NORMALIZATION: small models omit (or null) a list field when it is empty
    // ("no clarifying questions" → no `questions` key) even though the field is required.
    // For list guards an ABSENT/NULL value has exactly one honest meaning — "none" — so it is
    // normalized to [] instead of failing the whole output. Scalar guards stay strictly
    // required; parsers still reject empty lists where emptiness is illegal (e.g. plan steps).
    if ((v === undefined || v === null) && (guard === "string[]" || guard === "number[]" || guard === "record[]" || guard === "array")) {
      record[key] = [];
      v = record[key];
    }
    const missing = v === undefined;
    if (missing && optionalKeys.has(key)) continue; // genuinely optional domain field
    switch (guard) {
      case "string":
        if (missing || typeof v !== "string") problems.push(`${key}: expected string${missing ? " (missing)" : ""}`);
        break;
      case "number":
        if (missing || typeof v !== "number" || Number.isNaN(v)) problems.push(`${key}: expected number${missing ? " (missing)" : ""}`);
        break;
      case "boolean":
        if (missing || typeof v !== "boolean") problems.push(`${key}: expected boolean${missing ? " (missing)" : ""}`);
        break;
      case "string[]":
        if (missing || !Array.isArray(v) || v.some((x) => typeof x !== "string")) {
          problems.push(`${key}: expected string[]${missing ? " (missing)" : ""}`);
        }
        break;
      case "number[]":
        if (missing || !Array.isArray(v) || v.some((x) => typeof x !== "number")) {
          problems.push(`${key}: expected number[]${missing ? " (missing)" : ""}`);
        }
        break;
      case "record":
        if (missing || typeof v !== "object" || v === null || Array.isArray(v)) {
          problems.push(`${key}: expected record${missing ? " (missing)" : ""}`);
        }
        break;
      case "record[]":
        if (
          missing || !Array.isArray(v) ||
          v.some((x) => typeof x !== "object" || x === null || Array.isArray(x))
        ) {
          problems.push(`${key}: expected record[]${missing ? " (missing)" : ""}`);
        }
        break;
      case "array":
        if (missing || !Array.isArray(v)) {
          problems.push(`${key}: expected array${missing ? " (missing)" : ""}`);
        }
        break;
    }
  }
  if (!schema.allowExtra) {
    const declared = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(record)) {
      if (!declared.has(key)) problems.push(`${key}: unexpected property (strict schema)`);
    }
  }
  return problems;
}

/** Extract the first JSON object/array embedded in model text (handles ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through: try to locate an object literal in mixed prose
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // not recoverable
    }
  }
  throw new ModelFailure("EMPTY_OUTPUT", "model response contained no parseable JSON object", false);
}

/**
 * Validate raw model text against a schema. Throws ModelFailure (INVALID_OUTPUT) — never
 * returns an unvalidated object. This is the gate every model output passes before the LUI
 * or engine may act on it (M3 §6: "Never blindly trust JSON returned by the model").
 */
export function validateModelOutput<T>(schema: OutputSchema, text: string): { data: T; raw: string } {
  const parsed = extractJson(text);
  const problems = guardProblems(schema, parsed);
  if (problems.length > 0) throw new ModelValidationError(schema.name, problems);
  return { data: parsed as T, raw: text };
}

// ---------------------------------------------------------------------------
// Config — credentials from environment ONLY (M3 §2)
// ---------------------------------------------------------------------------

export interface ModelEnvConfig {
  /** e.g. GEMINI_API_KEY. Presence-checked, never logged, never included in errors. */
  readonly apiKey: string;
  /** e.g. GEMINI_MODEL. Falls back to the provider's documented default when absent. */
  readonly model: string;
}

/** Read + validate provider env config. Throws typed ModelFailure (never echoes values). */
export function requireEnvConfig(
  env: NodeJS.ProcessEnv,
  keyName: string,
  modelKeyName: string,
  defaultModel: string,
): ModelEnvConfig {
  const apiKey = env[keyName];
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new ModelFailure(
      "AUTH_FAILURE",
      `${keyName} is not set. Configure it via environment (see .env.example). The provider cannot run without credentials.`,
      false,
    );
  }
  const model = env[modelKeyName]?.trim() || defaultModel;
  return { apiKey, model };
}

/** Convenience: what the provider layer is allowed to put into errors/logs — never the key. */
export function redactCredential(value: string): string {
  return value.length > 0 ? "[redacted]" : "";
}

/** ISO timestamp helper for provenance written by model-layer callers. */
export function modelTimestamp(at: Date = new Date()): ISO {
  return at.toISOString();
}
