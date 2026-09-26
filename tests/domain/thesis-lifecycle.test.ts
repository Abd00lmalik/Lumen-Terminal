/**
 * Phase D: Thesis domain. Trader ownership, deterministic lifecycle, explicit confirmation,
 * ref-only linkage, and backward-compatible normalization of pre-Phase-D records.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "../../src/domain/workspace.js";
import {
  createThesis, normalizeThesis, thesisTransitionAllowed, THESIS_TRANSITIONS, type Thesis,
} from "../../src/domain/thesis.js";
import { resetIdCounters } from "../../src/domain/ids.js";
import type { ProvenanceOrigin } from "../../src/domain/provenance.js";

const trader: ProvenanceOrigin = { kind: "trader", detail: "trader test" };
const system: ProvenanceOrigin = { kind: "agent", detail: "system test" };

beforeEach(() => resetIdCounters());

describe("Thesis domain (Phase D)", () => {
  it("a trader-created thesis is ACTIVE and user-confirmed; a system draft is DRAFT and unconfirmed", () => {
    const t = createThesis({ statement: "BTC holds", objective: "swing" }, trader);
    expect(t.status).toBe("ACTIVE");
    expect(t.userConfirmed).toBe(true);
    expect(t.linkedResearchRefs).toEqual([]);
    expect(t.materialConditions).toEqual([]);

    const draft = createThesis({ statement: "BTC holds", objective: "swing" }, system);
    expect(draft.status).toBe("DRAFT");
    expect(draft.userConfirmed).toBe(false);
  });

  it("thesis identity is the id prefix and title/statement are NOT identity", () => {
    const a = createThesis({ statement: "same text", objective: "o" }, trader);
    const b = createThesis({ statement: "same text", objective: "o" }, trader);
    expect(a.id).toMatch(/^th_/);
    expect(a.id).not.toBe(b.id);
  });

  it("normalizes a legacy thesis (pre-Phase-D fields missing) without inventing data", () => {
    const legacy = {
      id: "th_000001", statement: "legacy", objective: "o",
      scope: { entities: ["BTC"] }, claims: [], assumptions: [],
      invalidationConditions: [], alternatives: [], status: "ACTIVE", version: 1,
      provenance: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as Thesis;
    const n = normalizeThesis(legacy);
    expect(n.linkedResearchRefs).toEqual([]);
    expect(n.linkedSavedIds).toEqual([]);
    expect(n.materialConditions).toEqual([]);
    expect(n.userConfirmed).toBe(true); // ACTIVE legacy thesis = confirmed
    expect(n.asset).toBe("BTC"); // derived from scope.entities, a fact of the record
  });

  it("enforces deterministic transitions and rejects invalid ones", () => {
    expect(thesisTransitionAllowed("DRAFT", "ACTIVE")).toBe(true);
    expect(thesisTransitionAllowed("DRAFT", "CONFIRMED")).toBe(false);
    expect(thesisTransitionAllowed("ARCHIVED", "ACTIVE")).toBe(false);
    expect(thesisTransitionAllowed("SUPERSEDED", "ACTIVE")).toBe(false);
    expect(thesisTransitionAllowed("ACTIVE", "PAUSED")).toBe(true);

    const ws = new Workspace();
    const t = ws.addThesis({ statement: "s", objective: "o" }, trader);
    expect(() => ws.transitionThesis(t.id, "SUPERSEDED", trader, "ok")).not.toThrow();
    expect(() => ws.transitionThesis(t.id, "DRAFT", trader, "backwards")).toThrow(/invalid thesis transition/);
    expect(Object.keys(THESIS_TRANSITIONS).length).toBeGreaterThanOrEqual(9);
  });

  it("a non-trader origin may never adopt (DRAFT→ACTIVE) or confirm the trader's thesis", () => {
    const ws = new Workspace();
    const draft = ws.addThesis({ statement: "s", objective: "o" }, system);
    expect(draft.status).toBe("DRAFT");
    expect(() => ws.transitionThesis(draft.id, "ACTIVE", system, "agent tries")).toThrow(/trader origin/);

    ws.transitionThesis(draft.id, "ACTIVE", trader, "trader adopts");
    expect(ws.getThesis(draft.id)?.userConfirmed).toBe(true);
    expect(() => ws.transitionThesis(draft.id, "CONFIRMED", system, "agent confirms")).toThrow(/trader origin/);
  });

  it("thesis revision is trader-only; the prior version is preserved", () => {
    const ws = new Workspace();
    const t = ws.addThesis({ statement: "v1", objective: "o" }, trader);
    expect(() => ws.reviseThesis(t.id, { statement: "hijacked" }, system, "system edit")).toThrow(/trader origin/);
    const revised = ws.reviseThesis(t.id, { statement: "v2" }, trader, "trader refined");
    expect(revised.statement).toBe("v2");
    expect(revised.version).toBe(2);
    expect(revised.priorVersionRef).toBe(t.id);
    expect(revised.createdAt).toBe(t.createdAt); // original timestamp preserved
  });

  it("links only REAL research runs and REAL saved artifacts (no invented refs)", () => {
    const ws = new Workspace();
    const r = ws.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const t = ws.addThesis({ statement: "s", objective: "o" }, trader);
    expect(() => ws.linkThesisResearch(t.id, "rs_999999", trader)).toThrow(/Unknown research/);
    const linked = ws.linkThesisResearch(t.id, r.id, trader);
    expect(linked.linkedResearchRefs).toEqual([r.id]);
    expect(ws.linkThesisResearch(t.id, r.id, trader).linkedResearchRefs).toEqual([r.id]); // idempotent

    expect(() => ws.linkThesisSaved(t.id, "sa_999999", trader)).toThrow(/unknown saved artifact/);
    const art = ws.saveArtifact({ content: "kept", researchRef: r.id }, trader);
    const withSaved = ws.linkThesisSaved(t.id, art.id, trader);
    expect(withSaved.linkedSavedIds).toEqual([art.id]);
  });

  it("unsaving a linked artifact never corrupts or deletes the thesis", () => {
    const ws = new Workspace();
    const r = ws.addResearch({ objective: "q", question: "q", flow: "WHAT_HAPPENED" }, trader);
    const t = ws.addThesis({ statement: "s", objective: "o" }, trader);
    const art = ws.saveArtifact({ content: "kept", researchRef: r.id }, trader);
    ws.linkThesisSaved(t.id, art.id, trader);
    ws.removeSavedArtifact(art.id);
    const after = ws.getThesis(t.id)!;
    expect(after.status).toBe("ACTIVE");
    expect(after.linkedSavedIds).toEqual([art.id]); // reference retained; DTO reports it unavailable
    // Explicit unlink removes the reference without touching the thesis lifecycle.
    const unlinked = ws.unlinkThesisSaved(t.id, art.id, trader);
    expect(unlinked.linkedSavedIds).toEqual([]);
    expect(unlinked.status).toBe("ACTIVE");
  });
});
