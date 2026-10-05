// Races that only real Postgres (separate sessions, row locks) can show.
import { test, expect } from "@playwright/test";
import { signInTeacher, closeAll } from "../support/actors.js";
import { seedTrip } from "./seed.js";

test("two teachers clicking 'advance to reveal' at once compute results exactly once (#26)", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const { tripId, contenders } = await seedTrip(browser, teacher); // voting, 3 approved nominations

  const [a, b] = await Promise.all([
    teacher.api.r.post(`/api/trips/${tripId}/advance`, { data: { to: "reveal" } }),
    teacher.api.r.post(`/api/trips/${tripId}/advance`, { data: { to: "reveal" } }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([200, 409]);

  const results = await teacher.api.results(tripId);
  expect(results.filter((r) => !r.is_grand_champion)).toHaveLength(3); // one per team, not doubled
  expect(results.filter((r) => r.is_grand_champion).length).toBeGreaterThanOrEqual(1);
  expect((await teacher.api.trip(tripId)).phase).toBe("reveal");

  await closeAll(teacher, ...contenders);
});
