import { describe, expect, it } from "vitest";
import { FRESHNESS_PROFILES, assessFreshness, freshnessLimitations } from "../../src/adapters/freshness.js";

describe("freshness profiles (final lock §8 — derived from FINDINGS.md §2)", () => {
  it("profiles carry the documented lag verbatim for provenance", () => {
    expect(FRESHNESS_PROFILES.rss.documentedLag).toContain("15-60 minutes");
    expect(FRESHNESS_PROFILES.community.documentedLag).toContain("~15 min lag");
    expect(FRESHNESS_PROFILES.macro.documentedLag).toContain("1-2 day release lag");
    expect(FRESHNESS_PROFILES.technical.documentedLag).toContain("exact");
    expect(FRESHNESS_PROFILES.marketStructure.documentedLag).toContain("undocumented");
  });

  it("within the window → CURRENT", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const verdict = assessFreshness(FRESHNESS_PROFILES.rss, "2026-09-13T11:30:00Z", now);
    expect(verdict).toBe("CURRENT"); // 30 min < 60 min window
  });

  it("outside the window → STALE (still usable, limitation travels)", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const verdict = assessFreshness(FRESHNESS_PROFILES.rss, "2026-09-13T10:00:00Z", now);
    expect(verdict).toBe("STALE"); // 2h > 60 min
    const limitations = freshnessLimitations(FRESHNESS_PROFILES.rss, verdict);
    expect(limitations.some((l) => /stale relative to profile rss:15-60min/.test(l))).toBe(true);
  });

  it("macro economic data tolerates the 1-2 day release lag before going stale", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    expect(assessFreshness(FRESHNESS_PROFILES.macro, "2026-09-12T12:00:00Z", now)).toBe("CURRENT"); // 24h < 48h lag
    expect(assessFreshness(FRESHNESS_PROFILES.macro, "2026-09-10T12:00:00Z", now)).toBe("STALE"); // 3d
  });

  it("missing/unparseable source timestamp → CURRENT per profile lag (never fabricated)", () => {
    expect(assessFreshness(FRESHNESS_PROFILES.community, undefined)).toBe("CURRENT");
    expect(assessFreshness(FRESHNESS_PROFILES.community, "not-a-date")).toBe("CURRENT");
  });

  it("explicitly historical requests keep HISTORICAL semantics", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const profile = { ...FRESHNESS_PROFILES.technical, historicalAfterMs: 24 * 60 * 60 * 1000 };
    expect(assessFreshness(profile, "2026-09-10T12:00:00Z", now)).toBe("HISTORICAL");
  });

  it("RSS vs community vs technical windows differ per FINDINGS.md lags", () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const t = "2026-09-13T11:35:00Z"; // 25 minutes ago
    expect(assessFreshness(FRESHNESS_PROFILES.rss, t, now)).toBe("CURRENT");
    expect(assessFreshness(FRESHNESS_PROFILES.community, t, now)).toBe("CURRENT");
    expect(assessFreshness(FRESHNESS_PROFILES.technical, t, now)).toBe("STALE"); // > 5min default
  });
});
