import { describe, it, expect } from "vitest";
import { overStudentBudget } from "../src/lib/student-rate.js";

describe("per-student request budget (#63)", () => {
  it("allows `max` requests a minute, then refuses until the next window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(overStudentBudget("s-budget", 3, t0 + i)).toBe(false);
    expect(overStudentBudget("s-budget", 3, t0 + 10)).toBe(true);
    expect(overStudentBudget("s-budget", 3, t0 + 60_000)).toBe(false); // fresh window
  });

  it("past 10 000 tracked students, drops expired windows but keeps live ones", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 10_001; i++) overStudentBudget(`stale-${i}`, 100, t0);
    const t1 = t0 + 60_000;
    // A student still inside their window, already at the limit.
    overStudentBudget("live", 1, t1 - 1_000);
    // A new student triggers the sweep.
    overStudentBudget("newcomer", 100, t1);
    // The live window survived the sweep: the next request is still over budget.
    expect(overStudentBudget("live", 1, t1)).toBe(true);
  });
});
