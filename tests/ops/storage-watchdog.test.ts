/**
 * Phase F watchdog tests: the PURE classifier (facts → verdict) across every branch the
 * runbook promises — availability, content corruption shapes, save outcomes, size/growth,
 * record-count integrity, backup freshness, schema/hash continuity. The endpoint wiring
 * (probes + composition) is exercised by the browser smoke test; classification is the
 * decision logic worth exhaustive unit coverage.
 */
import { describe, expect, it } from "vitest";
import { classifyStorageHealth, type StorageFacts } from "../../src/ops/storage-watchdog.js";

const base: StorageFacts = { transport: "ok", snapshotBytes: 16_000_000, recordCount: 102, schemaVersion: 2 };

describe("Phase F storage watchdog classification", () => {
  it("a healthy snapshot with fresh backup context is HEALTHY", () => {
    const v = classifyStorageHealth({ ...base, recordCount: 102 });
    expect(v.health).toBe("HEALTHY");
    expect(v.findings).toEqual([]);
  });

  it("a genuinely absent snapshot on a healthy store is HEALTHY (honest 'no workspace yet')", () => {
    const v = classifyStorageHealth({ transport: "absent" });
    expect(v.health).toBe("HEALTHY");
    expect(v.findings.map((f) => f.code)).toContain("SNAPSHOT_ABSENT");
  });

  it("a store-level failure is UNAVAILABLE and NEVER reported as empty workspace", () => {
    const v = classifyStorageHealth({ transport: "error", storeUnavailable: true });
    expect(v.health).toBe("UNAVAILABLE");
    expect(v.findings[0]!.code).toBe("STORE_UNAVAILABLE");
    expect(v.findings[0]!.message).toMatch(/NOT confirmed empty/);
  });

  it("unparseable or blank content is UNAVAILABLE (corruption shapes)", () => {
    for (const extra of [{ unparseableContent: true }, { blankContent: true }]) {
      const v = classifyStorageHealth({ ...base, ...extra });
      expect(v.health, JSON.stringify(extra)).toBe("UNAVAILABLE");
    }
  });

  it("all recent saves failing degrades with a critical finding; a few failures degrade", () => {
    // Reads still work, so the workspace is impaired (DEGRADED), not unavailable —
    // honest-abort keeps data safe; the finding itself carries critical severity.
    const all = classifyStorageHealth({ ...base, recentSaveOutcomes: ["read-unavailable", "io-timeout", "error"] });
    expect(all.health).toBe("DEGRADED");
    const failing = all.findings.find((f) => f.code === "SAVES_FAILING");
    expect(failing?.severity).toBe("critical");
    const flaky = classifyStorageHealth({ ...base, recentSaveOutcomes: ["ok", "conflict"] });
    expect(flaky.health).toBe("DEGRADED");
    expect(flaky.findings.map((f) => f.code)).toContain("SAVE_FLAKY");
  });

  it("size warnings fire at the documented thresholds", () => {
    const over = classifyStorageHealth({ ...base, snapshotBytes: 41 * 1024 * 1024 });
    expect(over.health).toBe("DEGRADED");
    expect(over.findings.map((f) => f.code)).toContain("SIZE_LIMIT_RISK");
    const watch = classifyStorageHealth({ ...base, snapshotBytes: 21 * 1024 * 1024 });
    expect(watch.health).toBe("HEALTHY"); // info only
    expect(watch.findings.map((f) => f.code)).toContain("SIZE_WATCH");
  });

  it("a growth spike (>50% in <1h) degrades", () => {
    const v = classifyStorageHealth({
      ...base, snapshotBytes: 21_000_000, previousBytes: 10_000_000, previousAgeMs: 10 * 60_000,
    });
    expect(v.health).toBe("DEGRADED");
    expect(v.findings.map((f) => f.code)).toContain("GROWTH_SPIKE");
  });

  it("a record-count DROP is critical (no-eviction law: collections never shrink)", () => {
    const v = classifyStorageHealth({
      ...base, recordCount: 100, previousRecordCount: 102, previousBytes: 16_000_000, previousAgeMs: 60_000,
    });
    expect(v.findings.map((f) => f.code)).toContain("RECORD_COUNT_DROPPED");
    const f = v.findings.find((x) => x.code === "RECORD_COUNT_DROPPED")!;
    expect(f.severity).toBe("critical");
  });

  it("backup staleness and missing drills are surfaced", () => {
    const stale = classifyStorageHealth({
      ...base,
      backup: { lastSuccessAt: new Date(Date.now() - 48 * 3600_000).toISOString() },
    });
    expect(stale.health).toBe("DEGRADED");
    expect(stale.findings.map((f) => f.code)).toContain("BACKUP_STALE");

    const noDrill = classifyStorageHealth({
      ...base,
      backup: { lastSuccessAt: new Date().toISOString() },
    });
    expect(noDrill.health).toBe("HEALTHY"); // info-level until a backup exists without a drill
    expect(noDrill.findings.map((f) => f.code)).toContain("BACKUP_DRILL_MISSING");

    const never = classifyStorageHealth({
      ...base,
      backup: { lastAttemptAt: new Date().toISOString() },
    });
    expect(never.health).toBe("DEGRADED");
    expect(never.findings.map((f) => f.code)).toContain("BACKUP_NEVER_SUCCEEDED");
  });

  it("unexpected schema version and silent hash drift degrade with remediation text", () => {
    const schema = classifyStorageHealth({ ...base, schemaVersion: 1 });
    expect(schema.findings.map((f) => f.code)).toContain("SCHEMA_UNEXPECTED");
    const hash = classifyStorageHealth({
      ...base, previousRecordCount: 102, previousBytes: 16_000_000,
      lastIntegrityHash: "aaa", currentIntegrityHash: "bbb",
    });
    expect(hash.findings.map((f) => f.code)).toContain("HASH_MISMATCH");
    for (const finding of [...schema.findings, ...hash.findings]) {
      expect(finding.remediation.length).toBeGreaterThan(20);
    }
  });

  it("findings never contain emails, tokens, or snapshot content", () => {
    const v = classifyStorageHealth({
      ...base,
      transport: "error",
      storeUnavailable: true,
      recentSaveOutcomes: ["error"],
      backup: { lastSuccessAt: "2020-01-01T00:00:00Z" },
    });
    const serialized = JSON.stringify(v);
    expect(serialized).not.toMatch(/@/);           // no emails
    expect(serialized).not.toMatch(/Bearer /i);   // no tokens
    expect(serialized).not.toMatch(/answer/i);    // no workspace content
  });
});
