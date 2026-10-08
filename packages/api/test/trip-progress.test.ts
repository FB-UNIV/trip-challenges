// GET /api/trips/:id/progress — the teacher's "what's ready, what's missing" counts.
// Counts only: no student identity, team names or photos (ADR 0001).
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { TripProgress } from "@trip/shared";
import { tripRoutes } from "../src/routes/trips.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination,
} from "./support/harness.js";

const app = await buildApp([tripRoutes, "/api/trips"]);

let owner: string;
let asOwner: { cookie: string };
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  asOwner = { cookie: teacherCookie(app, owner) };
});

const progress = (tripId: string, headers = asOwner) =>
  app.inject({ method: "GET", url: `/api/trips/${tripId}/progress`, headers });

describe("GET /api/trips/:id/progress", () => {
  it("is for the trip's teachers only (404 for others, like the trip itself)", async () => {
    const trip = await makeTrip(owner);
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/progress` })).statusCode).toBe(401);
    const stranger = await makeTeacher();
    expect((await progress(trip, { cookie: teacherCookie(app, stranger) })).statusCode).toBe(404);
  });

  it("counts students, teams and who still has no team", async () => {
    const trip = await makeTrip(owner);
    const [a, b, c] = await Promise.all([makeStudent(trip), makeStudent(trip), makeStudent(trip)]);
    await makeTeam(trip, "Foxes", [a!.id, b!.id]);
    await makeTeam(trip, "Owls"); // empty teams don't count
    void c;
    const res = await progress(trip);
    expect(res.statusCode).toBe(200);
    const body = TripProgress.parse(res.json());
    expect(body).toMatchObject({ students: 3, teams: 1, studentsWithoutTeam: 1, challenges: [] });
  });

  it("per challenge: teams with photos and active nominations by state", async () => {
    const trip = await makeTrip(owner, { phase: "voting" });
    const ch = await makeChallenge(trip, { title: "Gelato" });
    const other = await makeChallenge(trip, { title: "Tower" });
    const teams = [];
    for (const name of ["Foxes", "Owls", "Bears", "Cats"]) {
      const s = await makeStudent(trip);
      teams.push({ team: await makeTeam(trip, name, [s.id]), student: s.id });
    }
    const states = ["approved", "approved", "pending", "rejected"] as const;
    for (const [i, t] of teams.entries()) {
      const sub = await makeSubmission(trip, ch, t.team, t.student);
      await makeSubmission(trip, ch, t.team, t.student); // a second photo: still one team
      await makeNomination(trip, ch, t.team, sub, states[i]);
    }
    // A removed photo doesn't count as the team having entered.
    const removed = await makeSubmission(trip, other, teams[0]!.team, teams[0]!.student);
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [removed, owner]);

    const body = TripProgress.parse((await progress(trip)).json());
    expect(body.challenges).toEqual([
      { id: ch, title: "Gelato", teamsWithPhotos: 4, pending: 1, approved: 2, rejected: 1 },
      { id: other, title: "Tower", teamsWithPhotos: 0, pending: 0, approved: 0, rejected: 0 },
    ]);
  });

  it("ignores retired (inactive) nominations", async () => {
    const trip = await makeTrip(owner, { phase: "challenge" });
    const ch = await makeChallenge(trip, { title: "Gelato" });
    const s = await makeStudent(trip);
    const team = await makeTeam(trip, "Foxes", [s.id]);
    const sub = await makeSubmission(trip, ch, team, s.id);
    const old = await makeNomination(trip, ch, team, sub, "rejected");
    await pool.query(`UPDATE nomination SET active = false WHERE id = $1`, [old]);
    await makeNomination(trip, ch, team, sub, "pending");
    const body = TripProgress.parse((await progress(trip)).json());
    expect(body.challenges[0]).toMatchObject({ pending: 1, rejected: 0 });
  });

  describe("eraseAt — mirrors when erasure will actually fire", () => {
    const hardEraseAt = new Date("2030-02-01T00:00:00Z");
    const votingClosesAt = new Date("2030-01-10T12:00:00Z");

    it("is the hard deadline before the grace period", async () => {
      const trip = await makeTrip(owner, { phase: "voting", hardEraseAt, votingClosesAt, graceDays: 7 });
      const body = TripProgress.parse((await progress(trip)).json());
      expect(body.eraseAt).toBe(hardEraseAt.toISOString());
      expect(body.graceEndsAt).toBe("2030-01-17T12:00:00.000Z"); // planned, not yet effective
    });

    it("is the end of the grace window once in grace, if that comes first", async () => {
      const trip = await makeTrip(owner, { phase: "grace", hardEraseAt, votingClosesAt, graceDays: 7 });
      expect(TripProgress.parse((await progress(trip)).json()).eraseAt).toBe("2030-01-17T12:00:00.000Z");
    });

    it("stays the hard deadline when that is sooner, or when voting has no close date", async () => {
      const soon = new Date("2030-01-12T00:00:00Z");
      const t1 = await makeTrip(owner, { phase: "grace", hardEraseAt: soon, votingClosesAt, graceDays: 7 });
      expect(TripProgress.parse((await progress(t1)).json()).eraseAt).toBe(soon.toISOString());
      const t2 = await makeTrip(owner, { phase: "grace", hardEraseAt, graceDays: 7 });
      const body = TripProgress.parse((await progress(t2)).json());
      expect(body.eraseAt).toBe(hardEraseAt.toISOString());
      expect(body.graceEndsAt).toBeNull();
    });
  });
});
