/**
 * Phase C domain: SavedArtifact model, deterministic identity, idempotent SAVE, unsave
 * tombstones and legacy normalization.
 *
 * The laws under test:
 *  - kinds are a closed vocabulary (no invented artifact types);
 *  - identity is originating research + kind + source object, NEVER title/question text;
 *  - saving the same artifact twice updates the existing record (no uncontrolled duplicates);
 *  - unsave removes the artifact and records a durable tombstone (the original graph is
 *    untouched);
 *  - legacy artifacts (pre-Phase-C) load without a migration and keep their content.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import { createSavedArtifact, normalizeSavedArtifact, savedArtifactIdentity, SAVED_KINDS, legacyKindFromType } from "../../src/domain/thesis.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test confirmed save" };

beforeEach(() => resetIdCounters());

describe("SavedArtifact creation (Phase C)", () => {
  it("creates a typed artifact with a stable id and full provenance", () => {
    const a = createSavedArtifact(
      { kind: "RESEARCH", researchRef: "rs_000001", sourceRef: "rs_000001", title: "Why did BTC move?", summary: "BTC moved on ETF flows", content: "BTC moved on ETF flows" },
      trader,
      new Date("2026-03-12T10:00:00.000Z"),
    );
    expect(a.id).toMatch(/^sa_/);
    expect(a.kind).toBe("RESEARCH");
    expect(a.title).toBe("Why did BTC move?");
    expect(a.summary).toBe("BTC moved on ETF flows");
    expect(a.researchRef).toBe("rs_000001");
    expect(a.createdAt).toBe("2026-03-12T10:00:00.000Z");
    expect(a.updatedAt).toBe(a.createdAt);
    expect(a.provenance).toHaveLength(1);
    expect(a.tags).toEqual([]);
  });

  it("accepts exactly the five Phase C kinds", () => {
    for (const kind of SAVED_KINDS) {
      const a = createSavedArtifact({ kind, content: "c", researchRef: "rs_000001" }, trader);
      expect(a.kind).toBe(kind);
    }
    expect(SAVED_KINDS).toEqual(["RESEARCH", "JUDGMENT", "EVIDENCE", "INSIGHT", "WATCH_NEXT"]);
  });

  it("rejects malformed input: empty content and an unknown kind", () => {
    expect(() => createSavedArtifact({ kind: "RESEARCH", content: "   ", researchRef: "rs_000001" }, trader)).toThrow(/non-empty content/);
    expect(() => createSavedArtifact({ content: "c", kind: "ORDER_BOOK" as never }, trader)).toThrow();
  });

  it("maps a legacy artifactType onto a kind when kind is absent", () => {
    expect(legacyKindFromType("research-conclusion")).toBe("JUDGMENT");
    expect(legacyKindFromType("finding")).toBe("RESEARCH");
    expect(legacyKindFromType("evidence")).toBe("EVIDENCE");
    const a = createSavedArtifact({ type: "framework", content: "momentum criteria" }, trader);
    expect(a.kind).toBe("RESEARCH");
  });
});

describe("saved identity and idempotency", () => {
  it("identity is origin + kind + source, never title text", () => {
    const base = { kind: "JUDGMENT" as const, researchRef: "rs_000001", sourceRef: "jd_000001" };
    expect(savedArtifactIdentity(base)).toBe("rs_000001::JUDGMENT::jd_000001");
    const withTitles = [
      createSavedArtifact({ ...base, title: "Title A", content: "c" }, trader),
      createSavedArtifact({ ...base, title: "Title B", content: "c" }, trader),
    ];
    expect(new Set(withTitles.map(savedArtifactIdentity)).size).toBe(1);
  });

  it("saving the same artifact twice returns/updates the existing record (no duplicate)", () => {
    const ws = new Workspace();
    const first = ws.upsertSavedArtifact(
      { kind: "JUDGMENT", researchRef: "rs_000001", sourceRef: "jd_000001", title: "Judgment", summary: "v1", content: "v1", tags: ["a"] },
      trader,
      new Date("2026-03-12T10:00:00.000Z"),
    );
    expect(first.created).toBe(true);
    const second = ws.upsertSavedArtifact(
      { kind: "JUDGMENT", researchRef: "rs_000001", sourceRef: "jd_000001", title: "Judgment", summary: "v2", content: "v2", tags: ["b"] },
      trader,
      new Date("2026-03-12T11:00:00.000Z"),
    );
    expect(second.created).toBe(false);
    expect(second.artifact.id).toBe(first.artifact.id);
    expect(ws.listSavedArtifacts()).toHaveLength(1);
    expect(second.artifact.summary).toBe("v2");
    expect(second.artifact.tags).toEqual(["a", "b"]);
    expect(second.artifact.createdAt).toBe("2026-03-12T10:00:00.000Z"); // creation time preserved
    expect(second.artifact.updatedAt).toBe("2026-03-12T11:00:00.000Z");
    expect(second.artifact.provenance.length).toBeGreaterThan(1); // re-affirmation recorded
  });

  it("unsave removes only the artifact and records a tombstone", () => {
    const ws = new Workspace();
    const { artifact } = ws.upsertSavedArtifact({ kind: "RESEARCH", researchRef: "rs_000001", sourceRef: "rs_000001", content: "answer" }, trader);
    expect(ws.removeSavedArtifact(artifact.id, new Date("2026-03-12T12:00:00.000Z"))).toBe(true);
    expect(ws.getSavedArtifact(artifact.id)).toBeUndefined();
    expect(ws.listSavedArtifacts()).toHaveLength(0);
    expect(ws.listSavedTombstones()).toEqual([{ id: artifact.id, at: "2026-03-12T12:00:00.000Z" }]);
    // Removing again is a no-op, not a silent re-tombstone of nothing.
    expect(ws.removeSavedArtifact(artifact.id)).toBe(false);
  });

  it("survives snapshot round-trip: unsaved artifacts stay gone, kept ones return", () => {
    const ws = new Workspace();
    const kept = ws.upsertSavedArtifact({ kind: "RESEARCH", researchRef: "rs_000001", sourceRef: "rs_000001", content: "keep" }, trader).artifact;
    const dropped = ws.upsertSavedArtifact({ kind: "INSIGHT", researchRef: "rs_000001", sourceRef: "insight", content: "drop" }, trader).artifact;
    ws.removeSavedArtifact(dropped.id);
    const restored = Workspace.fromSnapshot(ws.toSnapshot());
    expect(restored.listSavedArtifacts().map((a) => a.id)).toEqual([kept.id]);
    expect(restored.listSavedTombstones().map((t) => t.id)).toEqual([dropped.id]);
  });
});

describe("legacy normalization", () => {
  it("fills missing Phase C fields from what the record actually holds, preserving content", () => {
    const legacy = {
      id: "sa_000009",
      type: "research",
      content: "legacy finding",
      derivedFromRefs: ["rs_000001"],
      rationale: "kept",
      researchRef: "rs_000001",
      provenance: [{ at: "2026-01-01T00:00:00.000Z", origin: { kind: "trader" } }],
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never;
    const normalized = normalizeSavedArtifact(legacy);
    expect(normalized.kind).toBe("RESEARCH");
    expect(normalized.content).toBe("legacy finding");
    expect(normalized.title.length).toBeGreaterThan(0);
    expect(normalized.tags).toEqual([]);
    expect(normalized.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(normalized.researchRef).toBe("rs_000001");
  });
});
