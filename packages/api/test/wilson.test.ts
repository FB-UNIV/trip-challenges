import { describe, it, expect } from "vitest";
import { wilsonLower } from "../src/lib/wilson.js";

describe("wilsonLower", () => {
  it("is 0 with no comparisons", () => {
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it("sits below the raw proportion (it's a lower bound)", () => {
    const wins = 8, n = 10;
    expect(wilsonLower(wins, n)).toBeLessThan(wins / n);
  });

  it("rewards more evidence at the same win-rate", () => {
    // 80% over 100 comparisons is more trustworthy than 80% over 5.
    expect(wilsonLower(80, 100)).toBeGreaterThan(wilsonLower(4, 5));
  });

  it("ranks a better win-rate higher at equal sample size", () => {
    expect(wilsonLower(9, 10)).toBeGreaterThan(wilsonLower(6, 10));
  });

  it("stays within [0,1]", () => {
    for (const [w, n] of [[0, 10], [5, 10], [10, 10], [1, 1]] as const) {
      const s = wilsonLower(w, n);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
