import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { nominationRoutes } from "../src/routes/nominations.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination, type StudentFixture,
} from "./support/harness.js";

const app = await buildApp([nominationRoutes, "/api/nominations"]);

let owner: string, trip: string, ch: string, team: string, kid: StudentFixture;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  trip = await makeTrip(owner, { phase: "challenge" });
  ch = await makeChallenge(trip);
  kid = await makeStudent(trip);
  team = await makeTeam(trip, "Foxes", [kid.id]);
});

const nominate = (cookie: string, challengeId: string, submissionId: string) =>
  app.inject({ method: "POST", url: "/api/nominations", headers: { cookie }, payload: { challengeId, submissionId } });
const active = async () =>
  (await pool.query<{ submission_id: string; state: string }>(
    `SELECT submission_id, state FROM nomination WHERE team_id = $1 AND active`, [team],
  )).rows;

describe("POST /api/nominations (student)", () => {
  it("sets the team's nomination, replacing any previous one", async () => {
    const first = await makeSubmission(trip, ch, team, kid.id);
    const second = await makeSubmission(trip, ch, team, kid.id);
    expect((await nominate(kid.cookie, ch, first)).statusCode).toBe(201);
    expect((await nominate(kid.cookie, ch, second)).statusCode).toBe(201);
    expect(await active()).toEqual([{ submission_id: second, state: "pending" }]);
  });

  it("only accepts the team's own, non-removed submission for that challenge", async () => {
    const rival = await makeStudent(trip);
    const rivalTeam = await makeTeam(trip, "Owls", [rival.id]);
    const theirs = await makeSubmission(trip, ch, rivalTeam, rival.id);
    expect((await nominate(kid.cookie, ch, theirs)).statusCode).toBe(404);

    const mine = await makeSubmission(trip, ch, team, kid.id);
    expect((await nominate(kid.cookie, await makeChallenge(trip), mine)).statusCode).toBe(404);

    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [mine, owner]);
    expect((await nominate(kid.cookie, ch, mine)).statusCode).toBe(404);
  });

  it("is closed outside the challenge period", async () => {
    const sub = await makeSubmission(trip, ch, team, kid.id);
    await pool.query(`UPDATE trip SET phase = 'voting' WHERE id = $1`, [trip]);
    expect((await nominate(kid.cookie, ch, sub)).statusCode).toBe(409);
  });

  it("requires a session, a team and a valid body", async () => {
    expect((await app.inject({ method: "POST", url: "/api/nominations", payload: {} })).statusCode).toBe(401);
    const loner = await makeStudent(trip);
    expect((await nominate(loner.cookie, ch, ch)).json().error).toBe("no_team");
    expect((await nominate(kid.cookie, "x", "y")).statusCode).toBe(400);
  });
});

describe("teacher moderation", () => {
  const asOwner = () => ({ cookie: teacherCookie(app, owner) });

  it("lists active nominations, optionally filtered by state", async () => {
    const a = await makeNomination(trip, ch, team, await makeSubmission(trip, ch, team, kid.id), "pending");
    const rival = await makeStudent(trip);
    const rivalTeam = await makeTeam(trip, "Owls", [rival.id]);
    await makeNomination(trip, ch, rivalTeam, await makeSubmission(trip, ch, rivalTeam, rival.id), "approved");

    const all = await app.inject({ method: "GET", url: `/api/nominations/trip/${trip}`, headers: asOwner() });
    expect(all.json().nominations).toHaveLength(2);
    const pending = await app.inject({ method: "GET", url: `/api/nominations/trip/${trip}?state=pending`, headers: asOwner() });
    expect(pending.json().nominations.map((n: any) => n.id)).toEqual([a]);
  });

  it("approves, and rejecting withdraws the nomination", async () => {
    const sub = await makeSubmission(trip, ch, team, kid.id);
    const nom = await makeNomination(trip, ch, team, sub, "pending");
    const ok = await app.inject({ method: "POST", url: `/api/nominations/${nom}/approve`, headers: asOwner() });
    expect(ok.json()).toEqual({ ok: true, state: "approved" });
    expect(await active()).toEqual([{ submission_id: sub, state: "approved" }]);

    await app.inject({ method: "POST", url: `/api/nominations/${nom}/reject`, headers: asOwner() });
    expect(await active()).toEqual([]);
    const { rows } = await pool.query(`SELECT state, moderated_by_teacher_id FROM nomination WHERE id = $1`, [nom]);
    expect(rows[0]).toEqual({ state: "rejected", moderated_by_teacher_id: owner });
  });

  it("404s for teachers of other trips and for withdrawn nominations", async () => {
    const nom = await makeNomination(trip, ch, team, await makeSubmission(trip, ch, team, kid.id), "pending");
    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    expect((await app.inject({ method: "POST", url: `/api/nominations/${nom}/approve`, headers: stranger })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/nominations/trip/${trip}`, headers: stranger })).statusCode).toBe(404);

    await pool.query(`UPDATE nomination SET active = false WHERE id = $1`, [nom]);
    expect((await app.inject({ method: "POST", url: `/api/nominations/${nom}/approve`, headers: asOwner() })).statusCode).toBe(404);
  });
});
