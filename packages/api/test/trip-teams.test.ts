// Teacher view of a Trip's Teams (#94): names to review before they can survive Erasure
// (ADR 0007), members and activity. Names are decrypted for the Trip's teachers only.
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { TripTeamList, TripProgress } from "@trip/shared";
import { tripRoutes } from "../src/routes/trips.js";
import { tripTeamRoutes } from "../src/routes/trip-teams.js";
import { decrypt } from "./support/fake-vault.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination, auditActions,
} from "./support/harness.js";

const app = await buildApp([tripRoutes, "/api/trips"], [tripTeamRoutes, "/api/trips"]);

let owner: string;
let asOwner: { cookie: string };
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  asOwner = { cookie: teacherCookie(app, owner) };
});

const at = (minute: number) => new Date(Date.UTC(2030, 0, 1, 0, minute));
const created = (teamId: string, minute: number) =>
  pool.query(`UPDATE team SET created_at = $2 WHERE id = $1`, [teamId, at(minute)]);
const list = async (trip: string) => {
  const res = await app.inject({ method: "GET", url: `/api/trips/${trip}/teams`, headers: asOwner });
  expect(res.statusCode).toBe(200);
  return TripTeamList.parse(res.json()).teams;
};

describe("GET /api/trips/:id/teams", () => {
  it("is for the trip's teachers only", async () => {
    const trip = await makeTrip(owner);
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/teams` })).statusCode).toBe(401);
    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/teams`, headers: stranger })).statusCode).toBe(404);
  });

  it("lists teams in creation order with name, label, review state, members and activity", async () => {
    const trip = await makeTrip(owner, { phase: "challenge", maxTeamSize: 3 });
    const ch = await makeChallenge(trip);
    const other = await makeChallenge(trip);
    const [a, b, c] = [await makeStudent(trip), await makeStudent(trip), await makeStudent(trip)];
    const foxes = await makeTeam(trip, "Léa & Tom 4B", [a.id, b.id]);
    const empty = await makeTeam(trip, "Ghosts");
    const owls = await makeTeam(trip, "Les Owls", [c.id]);
    await created(foxes, 0); await created(empty, 1); await created(owls, 2);
    await pool.query(`UPDATE team SET name_reviewed = true WHERE id = $1`, [owls]);
    const s1 = await makeSubmission(trip, ch, foxes, a.id);
    await makeSubmission(trip, ch, foxes, b.id);
    await makeSubmission(trip, other, foxes, a.id);
    const removed = await makeSubmission(trip, other, owls, c.id);
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [removed, owner]);
    await makeNomination(trip, ch, foxes, s1, "pending");

    const teams = await list(trip);
    expect(teams.map((t) => [t.name, t.label, t.nameReviewed, t.members.length])).toEqual([
      ["Léa & Tom 4B", "Team 1", false, 2],
      ["Ghosts", "Team 2", false, 0],
      ["Les Owls", "Team 3", true, 1],
    ]);
    expect(teams[0]!.members.sort()).toEqual([a.id, b.id].sort());
    expect(teams[0]).toMatchObject({ photos: 3, challengesEntered: 2, nominations: { pending: 1, approved: 0, rejected: 0 } });
    expect(teams[2]).toMatchObject({ photos: 0, challengesEntered: 0 }); // removed photos don't count
  });
});

describe("renaming and reviewing team names", () => {
  const rename = (trip: string, team: string, name: unknown, headers = asOwner) =>
    app.inject({ method: "PATCH", url: `/api/trips/${trip}/teams/${team}`, headers, payload: { name } });
  const review = (trip: string, team: string, headers = asOwner) =>
    app.inject({ method: "POST", url: `/api/trips/${trip}/teams/${team}/review`, headers });

  it("renaming re-encrypts the name and counts as reviewing it; audited without the name", async () => {
    const trip = await makeTrip(owner, { phase: "voting" });
    const team = await makeTeam(trip, "Léa & Tom 4B");
    expect((await rename(trip, team, "  Les Renards ")).statusCode).toBe(200);

    const { rows } = await pool.query<{ name_enc: Buffer; name_reviewed: boolean }>(
      `SELECT name_enc, name_reviewed FROM team WHERE id = $1`, [team],
    );
    expect((await decrypt(trip, rows[0]!.name_enc.toString("utf8"))).toString("utf8")).toBe("Les Renards");
    expect(rows[0]!.name_reviewed).toBe(true);
    expect(await auditActions(trip)).toContain("team_renamed");
    const audit = await pool.query(`SELECT * FROM audit_log WHERE trip_id = $1 AND action = 'team_renamed'`, [trip]);
    expect(JSON.stringify(audit.rows)).not.toContain("Renards");
    expect(audit.rows[0]).toMatchObject({ teacher_id: owner, target_opaque_id: team });
  });

  it("marks a name reviewed as it is", async () => {
    const trip = await makeTrip(owner, { phase: "challenge" });
    const team = await makeTeam(trip, "Les Renards");
    expect((await review(trip, team)).statusCode).toBe(200);
    expect((await list(trip))[0]).toMatchObject({ name: "Les Renards", nameReviewed: true });
    expect(await auditActions(trip)).toContain("team_name_reviewed");
  });

  it("rejects an empty or overlong name", async () => {
    const trip = await makeTrip(owner);
    const team = await makeTeam(trip, "A");
    expect((await rename(trip, team, "   ")).statusCode).toBe(400);
    expect((await rename(trip, team, "x".repeat(81))).statusCode).toBe(400);
  });

  it("is closed from the reveal on: results already hold the names", async () => {
    for (const phase of ["reveal", "grace"]) {
      const trip = await makeTrip(owner, { phase });
      const team = await makeTeam(trip, "A");
      expect((await rename(trip, team, "B")).statusCode).toBe(409);
      expect((await review(trip, team)).statusCode).toBe(409);
    }
  });

  it("404s for another trip's team, or a stranger", async () => {
    const trip = await makeTrip(owner);
    const elsewhere = await makeTeam(await makeTrip(owner), "A");
    expect((await rename(trip, elsewhere, "B")).statusCode).toBe(404);
    expect((await review(trip, elsewhere)).statusCode).toBe(404);
    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    expect((await rename(trip, await makeTeam(trip, "C"), "B", stranger)).statusCode).toBe(404);
  });
});

describe("GET /api/trips/:id/progress — review and voting counts", () => {
  it("counts teams with members whose name isn't reviewed, and distinct voters", async () => {
    const trip = await makeTrip(owner, { phase: "voting" });
    const ch = await makeChallenge(trip);
    const [a, b, c, d] = [await makeStudent(trip), await makeStudent(trip), await makeStudent(trip), await makeStudent(trip)];
    const teams = [await makeTeam(trip, "A", [a.id]), await makeTeam(trip, "B", [b.id]), await makeTeam(trip, "C", [c.id])];
    await makeTeam(trip, "Empty"); // no members: not something to review
    await pool.query(`UPDATE team SET name_reviewed = true WHERE id = $1`, [teams[0]]);
    const noms = [];
    for (const [i, t] of teams.entries()) {
      const s = [a, b, c][i]!;
      noms.push(await makeNomination(trip, ch, t, await makeSubmission(trip, ch, t, s.id)));
    }
    const duel = (voter: string, x: string, y: string) => {
      const [lo, hi] = [x, y].sort();
      return pool.query(
        `INSERT INTO duel (trip_id, challenge_id, voter_student_id, a_nomination_id, b_nomination_id,
                           winner_nomination_id, low_nomination_id, high_nomination_id)
         VALUES ($1,$2,$3,$4,$5,$4,$6,$7)`,
        [trip, ch, voter, x, y, lo, hi],
      );
    };
    await duel(d.id, noms[0]!, noms[1]!);
    await duel(d.id, noms[0]!, noms[2]!); // same voter twice
    await duel(a.id, noms[1]!, noms[2]!);

    const res = await app.inject({ method: "GET", url: `/api/trips/${trip}/progress`, headers: asOwner });
    expect(TripProgress.parse(res.json())).toMatchObject({ teamsUnreviewed: 2, voters: 2 });
  });
});
