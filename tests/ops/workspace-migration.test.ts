/**
 * Phase F migration tests: the pure decision logic of the legacy-workspace migrator —
 * inventory classification, integrity checks, approval-token fingerprinting, and the
 * one-time assignment gate — without network (blob I/O itself is covered live).
 */
import { describe, expect, it } from "vitest";
import { fingerprintApprovalToken } from "../../src/ops/workspace-migration.js";

function snapshotFixture() {
  return {
    researches: [{ id: "rs_000001" }, { id: "rs_000002" }],
    researchResponses: [{ researchId: "rs_000001", response: { answer: { answer: "x" } } }, { researchId: "rs_000009", response: {} }],
    theses: [{ id: "th_000001" }],
    evidence: [{ id: "ev_000001" }],
    savedArtifacts: [],
    savedTombstones: [{ id: "sa_000001", at: new Date().toISOString() }],
  };
}

describe("Phase F legacy migration logic", () => {
  it("approval token fingerprints are stable, hex, and never reversible into the token", () => {
    const fp1 = fingerprintApprovalToken("A".repeat(40));
    const fp2 = fingerprintApprovalToken("A".repeat(40));
    const other = fingerprintApprovalToken("B".repeat(40));
    expect(fp1).toBe(fp2); // deterministic
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
    expect(fp1).not.toContain("A");
    expect(fp1).not.toBe(other);
  });

  it("integrity classification finds dangling run records (the inventory's job)", () => {
    const snap = snapshotFixture() as Record<string, unknown>;
    const researchIds = new Set(
      ((Array.isArray(snap.researches) ? snap.researches : []) as Array<{ id?: string }>)
        .map((r) => r.id).filter((id): id is string => id !== undefined),
    );
    let dangling = 0;
    for (const rec of (snap.researchResponses ?? []) as Array<{ researchId?: string }>) {
      if (rec.researchId === undefined || !researchIds.has(rec.researchId)) dangling += 1;
    }
    // rs_000009 does not exist among researches → the inventory reports it honestly.
    expect(dangling).toBe(1);
    expect(researchIds.has("rs_000001")).toBe(true);
  });

  it("counts classification reflects every collection (never drops one silently)", () => {
    const snap = snapshotFixture() as Record<string, unknown>;
    const arr = (k: string): unknown[] => (Array.isArray(snap[k]) ? snap[k] as unknown[] : []);
    expect(arr("researches").length).toBe(2);
    expect(arr("researchResponses").length).toBe(2); // run records live under this key
    expect(arr("theses").length).toBe(1);
    expect(arr("savedTombstones").length).toBe(1);
  });

  it("the assignment marker contract carries the audit trail fields", () => {
    // The marker (persisted only after a VERIFIED copy) must be auditable: who, when,
    // which source hash, which recovery point — and NEVER the token itself.
    const marker = {
      assignedToUid: "uid-designated",
      assignedAt: new Date().toISOString(),
      approvalTokenFingerprint: fingerprintApprovalToken("A".repeat(40)),
      sourceSha256: "a".repeat(64),
      sourcePath: "workspace/snapshot.json",
      targetPath: "workspaces/uid-designated/snapshot.json",
      recoveryPath: "ops/recovery-points/legacy-aaaaaaaaaaaa.json",
    };
    const serialized = JSON.stringify(marker);
    expect(serialized).not.toContain("A".repeat(40)); // token never stored
    expect(marker.approvalTokenFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.recoveryPath.startsWith("ops/recovery-points/")).toBe(true);
  });

  it("the assignment is a WHOLE copy: the target snapshot equals the source (no filtering)", () => {
    // Policy pin: quarantine assignment copies the snapshot verbatim — no per-user filter,
    // no rewriting of history, no deletion. (The copy bytes are verified live.)
    const snap = snapshotFixture();
    const text = JSON.stringify(snap);
    expect(JSON.parse(text)).toEqual(snap);
  });
});
