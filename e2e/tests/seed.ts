// Shared scenario seeding (API-driven) for specs that test what happens *after* setup.
import type { Browser } from "@playwright/test";
import { enrollStudents, unique, type Student, type Teacher } from "../support/actors.js";
import { photo } from "../support/photos.js";

export type Contender = Student & { team: string; teamId: string; submissionId: string };

/**
 * A trip with one challenge and `teams.length` single-member teams, each with an
 * uploaded + nominated photo. Ends in `phase` ("challenge" or "voting"); nominations
 * are approved when `approve` is set.
 */
export async function seedTrip(
  browser: Browser,
  teacher: Teacher,
  { teams = ["Foxes", "Owls", "Bears"], phase = "voting", approve = true }:
    { teams?: string[]; phase?: "challenge" | "voting"; approve?: boolean } = {},
) {
  const tripName = unique("Trip");
  const tripId = await teacher.api.createTrip(tripName);
  const challenge = await teacher.api.addChallenge(tripId, "Best gelato");
  const students = await enrollStudents(browser, teacher, tripId, teams.length);

  const colors = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#8cb369"];
  const contenders: Contender[] = [];
  for (const [i, s] of students.entries()) {
    const teamId = await s.api.createTeam(teams[i]!);
    contenders.push({ ...s, team: teams[i]!, teamId, submissionId: "" });
  }
  await teacher.api.advance(tripId, "challenge");
  for (const [i, c] of contenders.entries()) {
    c.submissionId = await c.api.upload(challenge.id, await photo(colors[i % colors.length]!));
    await c.api.nominate(challenge.id, c.submissionId);
  }
  if (approve) {
    for (const n of await teacher.api.nominations(tripId, "pending")) await teacher.api.moderate(n.id, "approve");
  }
  if (phase === "voting") await teacher.api.advance(tripId, "voting");
  return { tripId, tripName, challenge, contenders };
}
