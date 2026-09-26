/**
 * Phase D: Thesis persistence. A thesis (and its links) must survive reload, cold start and
 * multi-instance merges, and a legacy workspace with no theses must load cleanly.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { VercelBlobStore } from "../../src/persistence/vercel-edge.js";
import { mergeSnapshots } from "../../src/domain/merge.js";
import { Workspace } from "../../src/domain/workspace.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import { FakeBlob } from "./fake-blob.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "test confirmed thesis" };

function workspaceWithThesis(statement: string): Workspace {
  const ws = new Workspace();
  const r = ws.addResearch({ objective: statement, question: statement, flow: "WHAT_HAPPENED" }, trader);
  ws.addThesis({ statement, objective: "objective", linkedResearchRefs: [r.id], materialConditions: ["condition"] }, trader);
  return ws;
}

beforeEach(() => resetIdCounters());

describe("Thesis persistence", () => {
  it("survives reload and cold start with links and Phase D fields intact", async () => {
    const blob = new FakeBlob();
    const first = new VercelBlobStore(blob.client());
    await first.save(workspaceWithThesis("BTC holds above support").toSnapshot());

    const reloaded = await first.load();
    const t1 = reloaded!.listTheses()[0]!;
    expect(t1.statement).toBe("BTC holds above support");
    expect(t1.materialConditions).toEqual(["condition"]);
    expect(t1.linkedResearchRefs).toHaveLength(1);
    expect(t1.userConfirmed).toBe(true);

    const cold = new VercelBlobStore(blob.client());
    const fromCold = (await cold.load())!.listTheses()[0]!;
    expect(fromCold.statement).toBe(t1.statement);
    expect(fromCold.linkedResearchRefs).toEqual(t1.linkedResearchRefs);
  });

  it("concurrent instances preserve each other's theses (union merge)", () => {
    const a = workspaceWithThesis("A thesis");
    workspaceWithThesis("spacer");
    const b = workspaceWithThesis("B thesis");

    const merged = mergeSnapshots(a.toSnapshot(), b.toSnapshot());
    const statements = merged.theses.map((t) => t.statement).sort();
    expect(statements).toEqual(["A thesis", "B thesis"]);
    expect(Workspace.fromSnapshot(merged).listTheses()).toHaveLength(2);
  });

  it("a legacy workspace without a theses collection loads with an empty list", () => {
    const ws = new Workspace();
    ws.addResearch({ objective: "legacy", question: "legacy", flow: "WHAT_HAPPENED" }, trader);
    const snapshot = ws.toSnapshot() as Record<string, unknown>;
    delete snapshot.theses;
    const restored = Workspace.fromSnapshot(snapshot as never);
    expect(restored.listTheses()).toEqual([]);
  });

  it("absorbThesisState brings another instance's thesis write into a warm graph (production link-loss bug)", () => {
    // Warm instance loaded before th_000002 existed.
    const warm = workspaceWithThesis("A thesis");
    // Another instance created a thesis AND attached a saved artifact.
    const other = workspaceWithThesis("B thesis");
    const research = other.listResearch()[0]!;
    const { artifact } = other.upsertSavedArtifact({ kind: "RESEARCH", researchRef: research.id, sourceRef: research.id, content: "attach me" }, trader);
    const t2 = other.listTheses().find((t) => t.statement === "B thesis")!;
    other.linkThesisSaved(t2.id, artifact.id, trader);

    warm.absorbThesisState(other.toSnapshot());
    const absorbed = warm.getThesis(t2.id);
    expect(absorbed).toBeDefined();
    expect(absorbed!.linkedSavedIds).toEqual([artifact.id]); // the link is NOT lost on read
  });

  it("absorbThesisState takes the side with more provenance; equal history keeps local", () => {
    const local = workspaceWithThesis("same statement");
    const mine = local.listTheses()[0]!;

    // Remote revised its copy (more provenance): remote wins.
    const revised = Workspace.fromSnapshot(local.toSnapshot());
    revised.reviseThesis(mine.id, { objective: "revised remotely" }, trader, "remote revise");
    local.absorbThesisState(revised.toSnapshot());
    expect(local.getThesis(mine.id)!.objective).toBe("revised remotely");

    // Equal history: the local in-flight copy wins.
    const local2 = workspaceWithThesis("same statement");
    const mine2 = local2.listTheses()[0]!;
    local2.absorbThesisState(Workspace.fromSnapshot(local2.toSnapshot()).toSnapshot());
    expect(local2.getThesis(mine2.id)!.id).toBe(mine2.id);
  });

  it("absorbThesisState merges assessments without duplicating them", () => {
    const a = workspaceWithThesis("assessed thesis");
    const t = a.listTheses()[0]!;
    const r = a.listResearch()[0]!;
    a.recordThesisAssessment({ thesisId: t.id, thesisVersion: t.version, assessment: "SUPPORTED", rationale: "evidence holds", supportingEvidence: [r.evidenceRefs[0] ?? ""], contradictingEvidence: [], unresolved: [], whatWouldChange: [], confidence: "MODERATE" }, trader);
    const b = Workspace.fromSnapshot(a.toSnapshot());
    b.absorbThesisState(a.toSnapshot());
    b.absorbThesisState(a.toSnapshot()); // repeated absorbs must not duplicate
    expect(b.listThesisAssessments(t.id)).toHaveLength(1);
  });
});
