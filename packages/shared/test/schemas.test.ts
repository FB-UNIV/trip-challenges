import { describe, it, expect } from "vitest";
import { TripConfig, ChallengeInput, RedeemAccessCode, PointsRow } from "../src/index.js";

describe("TripConfig", () => {
  it("applies sensible defaults", () => {
    const c = TripConfig.parse({ name: "Rome 2026", tripEndDate: "2026-06-01" });
    expect(c.maxTeamSize).toBe(4);
    expect(c.graceDays).toBe(7);
    expect(c.maxRetentionDays).toBe(30);
    expect(c.pointsTable).toEqual([
      { placement: 1, points: 5 },
      { placement: 2, points: 3 },
      { placement: 3, points: 1 },
    ]);
  });

  it("rejects a missing name", () => {
    expect(TripConfig.safeParse({ tripEndDate: "2026-06-01" }).success).toBe(false);
  });

  it("rejects an out-of-range team size", () => {
    expect(
      TripConfig.safeParse({ name: "x", tripEndDate: "2026-06-01", maxTeamSize: 0 }).success,
    ).toBe(false);
  });
});

describe("ChallengeInput", () => {
  it("defaults multiplier to 1", () => {
    expect(ChallengeInput.parse({ title: "Selfie" }).multiplier).toBe(1);
  });
  it("rejects a non-positive multiplier", () => {
    expect(ChallengeInput.safeParse({ title: "x", multiplier: 0 }).success).toBe(false);
  });
});

describe("RedeemAccessCode", () => {
  it("rejects short codes", () => {
    expect(RedeemAccessCode.safeParse({ code: "short" }).success).toBe(false);
  });
  it("accepts a realistic code", () => {
    expect(RedeemAccessCode.safeParse({ code: "a".repeat(40) }).success).toBe(true);
  });
});

describe("PointsRow", () => {
  it("requires a positive placement", () => {
    expect(PointsRow.safeParse({ placement: 0, points: 5 }).success).toBe(false);
  });
});
