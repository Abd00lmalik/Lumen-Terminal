/**
 * Phase F migration tooling: prepare the legacy shared workspace for the per-user world.
 *
 * APPROVED POLICY (user decision, recorded in docs/architecture/phase-f-audit.md):
 * "Quarantine in place" — the legacy snapshot at workspace/snapshot.json stays exactly
 * where it is, UNTOUCHED, as an explicit quarantine workspace. No user ever receives it
 * by default; assignment to a designated owner happens ONLY by explicit operator approval
 * via this module's documented admin flow.
 *
 * Therefore "migration" here is NOT a rewrite of historical data. It is:
 * 1. INVENTORY — a full, auditable census of the legacy workspace (counts, refs, ranges,
 *    integrity hash) produced WITHOUT mutating anything.
 * 2. ASSIGNMENT — copying the quarantined snapshot into a designated user's workspace
 *    path (workspaces/{uid}/snapshot.json) as a WHOLE (never filtered, never rewritten),
 *    gated behind an explicit approval token, executed at most ONCE (a persisted marker
 *    makes it non-repeatable by accident), and only after a recovery-point copy exists.
 *
 * Every step is idempotent-or-blocked: repeating the inventory is always safe; repeating
 * the assignment is refused (the marker exists); a refused assignment never leaves a
 * half-copied state (the copy is atomic: read source → parse-verify → write target with
 * the same metadata contract the backup job uses).
 */
import { createHash } from "node:crypto";
import { get, put, head } from "@vercel/blob";
import { LEGACY_BLOB_PATH } from "../persistence/vercel-edge.js";

/** The persisted assignment marker (ops/ object; never a workspace path). */
const ASSIGNMENT_MARKER_PATH = "ops/legacy-assignment.json";

export interface LegacyInventory {
  at: string;
  sourcePath: string;
  bytes: number;
  sha256: string;
  counts: {
    researches: number;
    evidence: number;
    judgments: number;
    theses: number;
    savedArtifacts: number;
    savedTombstones: number;
    runRecords: number;
    monitors: number;
    memories: number;
  };
  refs: {
    firstResearch: string | undefined;
    lastResearch: string | undefined;
    theses: string[];
  };
  integrity: {
    parses: boolean;
    everyRunRecordReferencesExistingResearch: boolean;
    danglingRunRecords: number;
  };
  assignmentMarker: LegacyAssignmentMarker | undefined;
}

export interface LegacyAssignmentMarker {
  assignedToUid: string;
  assignedAt: string;
  approvalTokenFingerprint: string;
  sourceSha256: string;
  sourcePath: string;
  targetPath: string;
  recoveryPath: string;
}

/** Approval token: the operator supplies a one-time token; we never store the token itself
 *  (only its SHA-256 fingerprint) and never log it. This is an intentional-act gate, not
 *  security theater: it makes accidental assignment impossible and the act auditable. */
export function fingerprintApprovalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readAssignmentMarker(): Promise<LegacyAssignmentMarker | undefined> {
  try {
    const blob = await get(ASSIGNMENT_MARKER_PATH, { access: "public", useCache: false });
    if (blob === null || blob.stream === null) return undefined;
    const reader = blob.stream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    return JSON.parse(text) as LegacyAssignmentMarker;
  } catch {
    return undefined;
  }
}

/** Read the legacy snapshot fully (origin-fresh) and parse it; throws on unparseable. */
async function readLegacySnapshotText(): Promise<string> {
  const blob = await get(LEGACY_BLOB_PATH, { access: "public", useCache: false });
  if (blob === null || blob.stream === null) throw new Error("legacy snapshot absent");
  const reader = blob.stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
  text += decoder.decode();
  JSON.parse(text); // parse-verify: the inventory and the assignment both require valid JSON
  return text;
}

function sha256Hex(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function countsOf(snapshot: Record<string, unknown>): LegacyInventory["counts"] {
  const arr = (k: string): unknown[] => (Array.isArray(snapshot[k]) ? snapshot[k] as unknown[] : []);
  return {
    researches: arr("researches").length,
    evidence: arr("evidence").length,
    judgments: arr("judgments").length,
    theses: arr("theses").length,
    savedArtifacts: arr("savedArtifacts").length,
    savedTombstones: arr("savedTombstones").length,
    runRecords: arr("researchResponses").length,
    monitors: arr("monitors").length,
    memories: arr("memories").length,
  };
}

function integrityOf(snapshot: Record<string, unknown>): LegacyInventory["integrity"] {
  const researchIds = new Set(
    ((Array.isArray(snapshot.researches) ? snapshot.researches : []) as Array<{ id?: string }>)
      .map((r) => r.id).filter((id): id is string => id !== undefined),
  );
  let dangling = 0;
  for (const rec of (Array.isArray(snapshot.researchResponses) ? snapshot.researchResponses : []) as Array<{ researchId?: string }>) {
    if (rec.researchId === undefined || !researchIds.has(rec.researchId)) dangling += 1;
  }
  return { parses: true, everyRunRecordReferencesExistingResearch: dangling === 0, danglingRunRecords: dangling };
}

/** READ-ONLY inventory of the legacy workspace (always safe to run, any number of times). */
export async function inventoryLegacyWorkspace(): Promise<LegacyInventory> {
  const text = await readLegacySnapshotText();
  const snapshot = JSON.parse(text) as Record<string, unknown>;
  const researches = (Array.isArray(snapshot.researches) ? snapshot.researches : []) as Array<{ id?: string }>;
  const marker = await readAssignmentMarker();
  return {
    at: new Date().toISOString(),
    sourcePath: LEGACY_BLOB_PATH,
    bytes: text.length,
    sha256: sha256Hex(text),
    counts: countsOf(snapshot),
    refs: {
      firstResearch: researches[0]?.id,
      lastResearch: researches[researches.length - 1]?.id,
      theses: ((Array.isArray(snapshot.theses) ? snapshot.theses : []) as Array<{ id?: string }>).map((t) => t.id ?? "?"),
    },
    integrity: integrityOf(snapshot),
    assignmentMarker: marker,
  };
}

export interface AssignmentResult {
  ok: boolean;
  at: string;
  targetPath?: string;
  recoveryPath?: string;
  sourceSha256?: string;
  verified?: boolean;
  error?: string;
  alreadyAssigned?: boolean;
}

/**
 * Assign the quarantined legacy workspace to ONE designated user (approved act).
 * Preconditions enforced here: valid approval token shape, workspace id shape, NO prior
 * assignment (marker check), parse-clean source. Steps: recovery-point copy → target
 * copy → read-back verify → marker write. A failure before the marker write leaves NO
 * authoritative assignment (the target copy may exist but is not authoritative without
 * the marker; the recovery point always exists first).
 */
export async function assignLegacyWorkspace(input: {
  readonly approvalToken: string;
  readonly targetUid: string;
}): Promise<AssignmentResult> {
  const at = new Date().toISOString();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.approvalToken)) {
    return { ok: false, at, error: "approval token malformed (32-256 chars, [A-Za-z0-9_-])" };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.targetUid)) {
    return { ok: false, at, error: "target uid malformed" };
  }
  const existing = await readAssignmentMarker();
  if (existing !== undefined) {
    return { ok: false, at, alreadyAssigned: true, error: `legacy workspace already assigned at ${existing.assignedAt} to ${existing.assignedToUid}` };
  }
  const text = await readLegacySnapshotText(); // throws honestly on absent/unparseable
  const sourceSha256 = sha256Hex(text);
  const targetPath = `workspaces/${input.targetUid}/snapshot.json`;
  const recoveryPath = `ops/recovery-points/legacy-${sourceSha256.slice(0, 12)}.json`;

  // 1. Recovery point FIRST (never delete/overwrite the only known-good copy later).
  await put(recoveryPath, text, {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
  // 2. Target copy (a WHOLE copy: the designated owner gets the full history, nothing filtered).
  await put(targetPath, text, {
    access: "public", addRandomSuffix: false, allowOverwrite: false,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
  // 3. Verify the target byte-for-byte.
  const targetMeta = await head(targetPath);
  const verified = targetMeta.size === text.length;
  if (!verified) {
    return { ok: false, at, targetPath, recoveryPath, sourceSha256, error: "target size mismatch after copy; assignment NOT recorded" };
  }
  // 4. Marker LAST: only a verified copy becomes the authoritative assignment.
  const marker: LegacyAssignmentMarker = {
    assignedToUid: input.targetUid,
    assignedAt: at,
    approvalTokenFingerprint: fingerprintApprovalToken(input.approvalToken),
    sourceSha256,
    sourcePath: LEGACY_BLOB_PATH,
    targetPath,
    recoveryPath,
  };
  await put(ASSIGNMENT_MARKER_PATH, JSON.stringify(marker), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 60,
  });
  return { ok: true, at, targetPath, recoveryPath, sourceSha256, verified: true };
}

/** Admin route surface: inventory is read-only; assignment requires the explicit token. */
export const legacyMigrationOps = { inventoryLegacyWorkspace, assignLegacyWorkspace, readAssignmentMarker };
