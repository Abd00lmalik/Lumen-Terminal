import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../../src/persistence/index.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";

const origin = { kind: "agent" as const, detail: "test" };

describe("file-backed persistence (lock §14)", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    resetIdCounters();
    dir = mkdtempSync(join(tmpdir(), "ws-"));
    file = join(dir, "workspace.json");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing workspace file → undefined (not an error)", async () => {
    const store = new FileStore(join(dir, "absent.json"));
    const loaded = await store.load();
    expect(loaded).toBeUndefined();
  });

  it("round-trip preserves graph, provenance, and superseded judgment history", async () => {
    const ws = new Workspace();
    const research = ws.addResearch({ objective: "o", question: "q", flow: "WHAT_HAPPENED" }, origin);
    const judgment1 = ws.addJudgment(
      { statement: "v1", basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] }, researchRef: research.id },
      origin,
      new Date("2026-09-11T14:00:00Z"),
    );
    const judgment2 = ws.addJudgment(
      { statement: "v2", basis: { supportingEvidence: [], opposingEvidence: [], keyClaims: [], hypotheses: [] }, researchRef: research.id },
      origin,
      new Date("2026-09-11T15:00:00Z"),
    );

    const store = new FileStore(file);
    await store.save(ws.toSnapshot());
    const restored = (await store.load())!;

    expect(restored.getResearch(research.id)!.currentJudgmentRef).toBe(judgment2.id);
    expect(restored.getJudgment(judgment1.id)!.status).toBe("SUPERSEDED");
    expect(restored.getJudgment(judgment1.id)!.statement).toBe("v1"); // history intact, not overwritten
    expect(restored.currentJudgment(research.id)!.id).toBe(judgment2.id);
  });

  it("restored graph never re-mints persisted ids (restart collision regression)", async () => {
    // Regression (G1-analysis phase): a fresh process restarted counters at 1, so its first new
    // research object got `rs_000001` — OVERWRITING the persisted rs_000001. Counter continuity
    // must be restored from the loaded graph before any new object is minted.
    const first = new Workspace();
    const r1 = first.addResearch(
      { objective: "earlier research", question: "earlier", flow: "WHAT_HAPPENED" },
      origin,
      new Date("2026-09-15T10:00:00Z"),
    );
    const store = new FileStore(file);
    await store.save(first.toSnapshot());

    // Simulate a restart: counters reset, graph restored from disk.
    resetIdCounters();
    const restored = (await store.load())!;
    expect(restored.getResearch(r1.id)).toBeDefined();

    const r2 = restored.addResearch(
      { objective: "post-restart research", question: "new", flow: "WHAT_HAPPENED" },
      origin,
      new Date("2026-09-16T10:00:00Z"),
    );
    expect(r2.id).not.toBe(r1.id); // must advance past, not collide with, the persisted id
    expect(r2.id.endsWith("000002")).toBe(true);
    expect(restored.getResearch(r1.id)!.objective).toBe("earlier research"); // original intact
  });
});
