// Per-route wrong-trip and wrong-phase checks (#27): every trip-scoped route, driven through
// the real plugins, refuses callers from another Trip and calls outside its phases.
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { tripRoutes } from "../src/routes/trips.js";
import { rosterRoutes } from "../src/routes/roster.js";
import { tripInviteRoutes } from "../src/routes/invites.js";
import { challengeRoutes } from "../src/routes/challenges.js";
import { teamRoutes } from "../src/routes/teams.js";
import { nominationRoutes } from "../src/routes/nominations.js";
import { submissionRoutes } from "../src/routes/submissions.js";
import { duelRoutes } from "../src/routes/duels.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination,
} from "./support/harness.js";

const app = await buildApp(
  [tripRoutes, "/api/trips"], [rosterRoutes, "/api/trips"], [tripInviteRoutes, "/api/trips"],
  [challengeRoutes, "/api/challenges"], [teamRoutes, "/api/teams"], [nominationRoutes, "/api/nominations"],
  [submissionRoutes, "/api/submissions"], [duelRoutes, "/api/duels"],
);

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Ids = { trip: string; ch: string; sub: string; nom: string };
let ids: Ids, owner: string;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  const trip = await makeTrip(owner);
  const ch = await makeChallenge(trip);
  const kid = await makeStudent(trip);
  const team = await makeTeam(trip, "Foxes", [kid.id]);
  const sub = await makeSubmission(trip, ch, team, kid.id);
  const nom = await makeNomination(trip, ch, team, sub, "pending");
  ids = { trip, ch, sub, nom };
});

const call = (method: Method, url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const setPhase = (phase: string) => pool.query(`UPDATE trip SET phase = $2 WHERE id = $1`, [ids.trip, phase]);

describe("a teacher of another trip", () => {
  const routes: [Method, string, (i: Ids) => object | undefined, number][] = [
    ["GET", "/api/trips/{trip}", () => undefined, 404],
    ["PATCH", "/api/trips/{trip}", () => ({ name: "Hijacked" }), 404],
    ["POST", "/api/trips/{trip}/advance", () => ({ to: "challenge" }), 404],
    ["POST", "/api/trips/{trip}/erase", () => undefined, 404],
    ["POST", "/api/trips/{trip}/grand-champion", (i) => ({ resultId: i.trip }), 404],
    ["POST", "/api/trips/{trip}/roster", () => ({ emails: ["kid@school.test"] }), 404],
    ["GET", "/api/trips/{trip}/roster/status", () => undefined, 404],
    ["GET", "/api/trips/{trip}/teachers", () => undefined, 404],
    ["GET", "/api/trips/{trip}/invites", () => undefined, 404],
    ["POST", "/api/trips/{trip}/invites", () => ({ email: "me@evil.test" }), 403],
    ["DELETE", "/api/trips/{trip}/invites/{nom}", () => undefined, 403],
    ["POST", "/api/challenges", (i) => ({ tripId: i.trip, title: "Sneaky", instructions: "", multiplier: 1 }), 404],
    ["GET", "/api/challenges?tripId={trip}", () => undefined, 404],
    ["PATCH", "/api/challenges/{ch}", () => ({ title: "Hijacked" }), 404],
    ["DELETE", "/api/challenges/{ch}", () => undefined, 404],
    ["GET", "/api/challenges/{ch}/qr.png", () => undefined, 404],
    ["GET", "/api/nominations/trip/{trip}", () => undefined, 404],
    ["POST", "/api/nominations/{nom}/approve", () => undefined, 404],
    ["POST", "/api/nominations/{nom}/reject", () => undefined, 404],
    ["POST", "/api/submissions/{sub}/remove", () => undefined, 404],
  ];

  it.each(routes)("is refused on %s %s", async (method, template, payload, status) => {
    const url = template.replace(/\{(\w+)\}/g, (_, k: keyof Ids) => ids[k]);
    const stranger = teacherCookie(app, await makeTeacher());
    const res = await call(method, url, stranger, payload(ids));
    expect(res.statusCode).toBe(status);

    // Nothing moved.
    const { rows } = await pool.query(`SELECT name, phase FROM trip WHERE id = $1`, [ids.trip]);
    expect(rows[0]).toEqual({ name: "Rome 2030", phase: "draft" });
    const ch = await pool.query(`SELECT title FROM challenge WHERE id = $1`, [ids.ch]);
    expect(ch.rows[0]?.title).not.toBe("Hijacked");
    const nom = await pool.query(`SELECT state FROM nomination WHERE id = $1`, [ids.nom]);
    expect(nom.rows[0]).toEqual({ state: "pending" });
    const sub = await pool.query(`SELECT removed_by_teacher_id FROM submission WHERE id = $1`, [ids.sub]);
    expect(sub.rows[0]).toEqual({ removed_by_teacher_id: null });
  });
});

describe("a student of another trip", () => {
  it.each([
    ["GET", "/api/duels/next?challengeId=", "voting"],
    ["POST", "/api/submissions?challengeId=", "challenge"],
  ] as const)("can't reach this trip's challenge via %s %s", async (method, url, phase) => {
    const other = await makeTrip(await makeTeacher(), { phase });
    const outsider = await makeStudent(other);
    await makeTeam(other, "Owls", [outsider.id]);
    await setPhase(phase);
    const res = await call(method, url + ids.ch, outsider.cookie);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "challenge", requestId: expect.any(String) });
  });
});

describe("outside its phases", () => {
  const cases: ["teacher" | "student", Method, string, (i: Ids) => object | undefined, string, object][] = [
    ["teacher", "POST", "/api/trips/{trip}/grand-champion", (i) => ({ resultId: i.trip }), "voting",
      { error: "wrong_phase", message: "tie-break is only available during the reveal" }],
    ["teacher", "PATCH", "/api/trips/{trip}", () => ({ name: "Late" }), "erased",
      { error: "erased", message: "trip is erased" }],
    ["teacher", "PATCH", "/api/challenges/{ch}", () => ({ title: "Late" }), "reveal",
      { error: "locked_in_phase", message: "challenges can't be edited once results are computed" }],
    ["teacher", "DELETE", "/api/challenges/{ch}", () => undefined, "challenge",
      { error: "locked_in_phase", message: "a challenge can only be deleted while the trip is in draft" }],
    ["student", "POST", "/api/nominations", (i) => ({ challengeId: i.ch, submissionId: i.sub }), "voting",
      { error: "closed", message: "nominations are closed" }],
    ["student", "POST", "/api/submissions?challengeId={ch}", () => undefined, "voting",
      { error: "closed", message: "submissions are closed" }],
    ["student", "POST", "/api/teams", () => ({ name: "Late" }), "challenge",
      { error: "locked", message: "teams are locked" }],
    ["student", "POST", "/api/teams/join", (i) => ({ teamId: i.trip }), "challenge",
      { error: "locked", message: "teams are locked" }],
    ["student", "POST", "/api/teams/leave", () => undefined, "challenge",
      { error: "locked", message: "teams are locked" }],
    ["student", "POST", "/api/duels/cast", (i) => ({ pairToken: "x", winnerNominationId: i.nom }), "reveal",
      { error: "closed", message: "closed" }],
  ];

  it.each(cases)("%s %s %s is refused", async (who, method, template, payload, phase, body) => {
    const url = template.replace(/\{(\w+)\}/g, (_, k: keyof Ids) => ids[k]);
    const kid = await makeStudent(ids.trip);
    const cookie = who === "teacher" ? teacherCookie(app, owner) : kid.cookie;
    await setPhase(phase);
    const res = await call(method, url, cookie, payload(ids));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ...body, requestId: expect.any(String) });
  });

  it("GET /api/duels/next answers 'closed' (not an error) before voting and after its planned close", async () => {
    const kid = await makeStudent(ids.trip);
    const next = () => call("GET", `/api/duels/next?challengeId=${ids.ch}`, kid.cookie);
    await setPhase("challenge");
    expect((await next()).json()).toEqual({ pair: null, reason: "closed" });
    await pool.query(
      `UPDATE trip SET phase = 'voting', voting_closes_at = now() - interval '1 minute' WHERE id = $1`,
      [ids.trip],
    );
    expect((await next()).json()).toEqual({ pair: null, reason: "closed" });
  });
});
