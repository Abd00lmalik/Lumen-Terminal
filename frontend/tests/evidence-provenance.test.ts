/**
 * Evidence provenance surfacing (Workstream IV): the trader can see WHERE an item came from
 * (source origin + kind) and WHEN an item is a repeated report rather than independent
 * corroboration. Deterministic; adapter-level (DOM-free), matching the repo's data-test style.
 */
import { describe, expect, it } from "vitest";
import { evidenceFromDto } from "../src/data/adapters.js";
import type { EvidenceDto } from "../src/api/types.js";

function dto(overrides: Partial<EvidenceDto> = {}): EvidenceDto {
  return {
    ref: "ev_000001",
    observation: "ETF inflows accelerating",
    evidenceType: "NEWS_ANALYSIS",
    evidenceClass: "OBSERVATION",
    freshness: "CURRENT",
    observedAt: "2026-09-29T10:00:00.000Z",
    sourceRefs: ["raw://resp-1"],
    supports: [],
    contradicts: [],
    ...overrides,
  };
}

describe("evidence provenance through the DTO adapter", () => {
  it("carries source origin and kind when the backend provides them", () => {
    const item = evidenceFromDto(dto({ sourceProvider: "CoinDesk", sourceType: "SECONDARY" }));
    expect(item.sourceProvider).toBe("CoinDesk");
    expect(item.sourceType).toBe("SECONDARY");
    expect(item.duplicateContent).toBeUndefined();
  });

  it("marks repeated content; a repeated item is never presented as independent corroboration", () => {
    const duplicate = evidenceFromDto(dto({ sourceProvider: "CoinDesk", sourceType: "SECONDARY", duplicateContent: true }));
    expect(duplicate.duplicateContent).toBe(true);
  });

  it("omits the provenance fields entirely when the backend does not send them (legacy DTOs)", () => {
    const item = evidenceFromDto(dto());
    expect("sourceProvider" in item).toBe(false);
    expect("sourceType" in item).toBe(false);
    expect("duplicateContent" in item).toBe(false);
  });
});
