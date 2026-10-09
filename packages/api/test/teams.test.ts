import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { teamRoutes } from "../src/routes/teams.js";
import {
  pool, resetAll, buildApp, makeTeacher, makeTrip, makeStudent, makeTeam, count,
} from "./support/harness.js";

const app = await buildApp([teamRoutes, "/api/teams"]);

let trip: string;
beforeEach(async () => {
  await resetAll();
  trip = await makeTrip(await makeTeacher(), { maxTeamSize: 2 });
});

const call = (method: "GET" | "POST", url: string, cookie: string, payload?: object) =>
  app.inject({ method, url: `/api/teams${url}`, headers: { cookie }, payload });

describe("teams", () => {
  it("requires a student session everywhere", async () => {
    for (const [method, url] of [["GET", ""], ["POST", ""], ["POST", "/join"], ["POST", "/leave"]] as const) {
      expect((await app.inject({ method, url: `/api/teams${url}` })).statusCode).toBe(401);
    }
  });

  it("lists the trip's teams with decrypted names and sizes (other trips hidden)", async () => {
    const s = await makeStudent(trip);
    const foxes = await makeTeam(trip, "Foxes", [s.id]);
    const other = await makeTrip(await makeTeacher());
    await makeTeam(other, "Elsewhere");
    const res = await call("GET", "", s.cookie);
    expect(res.json()).toEqual({ teams: [{ id: foxes, name: "Foxes", members: 1 }] });
  });

  it("creates a team with the creator as first member, name encrypted at rest", async () => {
    const s = await makeStudent(trip);
    const res = await call("POST", "", s.cookie, { name: "Owls" });
    expect(res.statusCode).toBe(201);
    const { teamId } = res.json();
    expect(await count("team_member", "team_id = $1 AND student_id = $2", [teamId, s.id])).toBe(1);
    const { rows } = await pool.query<{ name_enc: Buffer }>(`SELECT name_enc FROM team WHERE id = $1`, [teamId]);
    expect(rows[0]!.name_enc.toString()).not.toContain("Owls");
  });

  it("refuses to create when already in a team, with a bad name, or once photo time is over", async () => {
    const s = await makeStudent(trip);
    expect((await call("POST", "", s.cookie, { name: "" })).statusCode).toBe(400);
    await makeTeam(trip, "Foxes", [s.id]);
    expect((await call("POST", "", s.cookie, { name: "Owls" })).json().error).toBe("in_team");

    const over = await makeTrip(await makeTeacher(), { phase: "voting" });
    const late = await makeStudent(over);
    expect((await call("POST", "", late.cookie, { name: "Owls" })).json().error).toBe("locked");
  });

  // #79: teams are optional. Once teams lock, a student without one can still play solo:
  // creating a team is allowed (a team of one, since nobody can join any more).
  it("lets a student without a team play solo during photo time, as a team of one nobody can join", async () => {
    const t = await makeTrip(await makeTeacher(), { phase: "challenge" });
    const solo = await makeStudent(t);
    const res = await call("POST", "", solo.cookie, { name: "Lone wolf" });
    expect(res.statusCode).toBe(201);
    const { teamId } = res.json();
    expect(await count("team_member", "team_id = $1", [teamId])).toBe(1);
    // Its name goes through the teacher's review like any other (ADR 0007).
    expect((await pool.query(`SELECT name_reviewed FROM team WHERE id = $1`, [teamId])).rows[0]).toEqual({ name_reviewed: false });

    const other = await makeStudent(t);
    expect((await call("POST", "/join", other.cookie, { teamId })).json().error).toBe("locked");
    expect((await call("POST", "/leave", solo.cookie)).json().error).toBe("locked");
  });

  it("joins a team up to maxTeamSize", async () => {
    const [a, b, c] = [await makeStudent(trip), await makeStudent(trip), await makeStudent(trip)];
    const team = await makeTeam(trip, "Foxes", [a.id]);
    expect((await call("POST", "/join", b.cookie, { teamId: team })).json()).toEqual({ ok: true });
    const full = await call("POST", "/join", c.cookie, { teamId: team });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toBe("full");
  });

  it("rejects joining an unknown/foreign team, a bad body, a second team, or after lock", async () => {
    const s = await makeStudent(trip);
    expect((await call("POST", "/join", s.cookie, { teamId: "nope" })).statusCode).toBe(400);
    const foreign = await makeTeam(await makeTrip(await makeTeacher()), "Elsewhere");
    expect((await call("POST", "/join", s.cookie, { teamId: foreign })).statusCode).toBe(404);

    await makeTeam(trip, "Mine", [s.id]);
    const other = await makeTeam(trip, "Other");
    expect((await call("POST", "/join", s.cookie, { teamId: other })).json().error).toBe("in_team");

    await pool.query(`UPDATE trip SET phase = 'challenge' WHERE id = $1`, [trip]);
    const late = await makeStudent(trip);
    expect((await call("POST", "/join", late.cookie, { teamId: other })).json().error).toBe("locked");
  });

  it("leaving deletes a team only once it is empty", async () => {
    const [a, b] = [await makeStudent(trip), await makeStudent(trip)];
    const team = await makeTeam(trip, "Foxes", [a.id, b.id]);
    await call("POST", "/leave", a.cookie);
    expect(await count("team", "id = $1", [team])).toBe(1);
    await call("POST", "/leave", b.cookie);
    expect(await count("team", "id = $1", [team])).toBe(0);
  });

  it("refuses to leave without a team or after lock", async () => {
    const s = await makeStudent(trip);
    expect((await call("POST", "/leave", s.cookie)).json().error).toBe("no_team");
    await makeTeam(trip, "Foxes", [s.id]);
    await pool.query(`UPDATE trip SET phase = 'challenge' WHERE id = $1`, [trip]);
    expect((await call("POST", "/leave", s.cookie)).json().error).toBe("locked");
  });
});
