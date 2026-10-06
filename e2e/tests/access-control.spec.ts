// Authorization across real sessions. Known bugs are pinned with test.fail() and the
// issue number; when one is fixed, its test reports "expected to fail but passed".
import { test, expect } from "@playwright/test";
import { signInTeacher, enrollStudents, unique, closeAll } from "../support/actors.js";
import { seedTrip } from "./seed.js";

test("students can't use teacher endpoints, and teachers can't see other teachers' trips", async ({ browser }) => {
  const owner = await signInTeacher(browser);
  const other = await signInTeacher(browser);
  const tripId = await owner.api.createTrip(unique("Rome"));
  const [kid] = await enrollStudents(browser, owner, tripId, 1);

  expect((await kid!.api.r.get("/api/trips")).status()).toBe(401);
  expect((await kid!.api.r.post(`/api/trips/${tripId}/advance`, { data: { to: "challenge" } })).status()).toBe(401);

  expect((await other.api.r.get(`/api/trips/${tripId}`)).status()).toBe(404);
  expect((await other.api.r.post(`/api/trips/${tripId}/erase`, { data: {} })).status()).toBe(404);
  expect((await other.api.r.get(`/api/nominations/trip/${tripId}`)).status()).toBe(404);
  expect((await owner.api.trip(tripId)).phase).toBe("draft");

  await closeAll(owner, other, kid!);
});

test("a duel pair is bound to the voter who was served it", async ({ browser }) => {
  const teacher = await signInTeacher(browser);
  const { challenge, contenders } = await seedTrip(browser, teacher);
  const [foxes, owls] = contenders;

  const { pair } = await (await foxes!.api.nextDuel(challenge.id)).json();
  const stolen = await owls!.api.cast(pair.pairToken, pair.aNominationId);
  expect(stolen.status()).toBe(400);
  expect((await stolen.json()).error).toBe("bad_token");

  await closeAll(teacher, ...contenders);
});

test("students can't vote on another trip's challenge (#16)", async ({ browser }) => {
  test.fail(true, "Known bug #16: /api/duels/next doesn't check the challenge's trip");
  const teacher = await signInTeacher(browser);
  const { challenge, contenders } = await seedTrip(browser, teacher);
  const otherTrip = await teacher.api.createTrip(unique("Other"));
  const [outsider] = await enrollStudents(browser, teacher, otherTrip, 1);

  const { pair } = await (await outsider!.api.nextDuel(challenge.id)).json();
  try {
    expect(pair).toBeNull();
  } finally {
    await closeAll(teacher, outsider!, ...contenders);
  }
});

test("duels are only served during the voting period (#17)", async ({ browser }) => {
  test.fail(true, "Known bug #17: duels don't check the trip phase");
  const teacher = await signInTeacher(browser);
  const { challenge, contenders } = await seedTrip(browser, teacher, { phase: "challenge" });

  const { pair } = await (await contenders[0]!.api.nextDuel(challenge.id)).json();
  try {
    expect(pair).toBeNull();
  } finally {
    await closeAll(teacher, ...contenders);
  }
});
