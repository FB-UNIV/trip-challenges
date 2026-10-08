import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { guard, tripFrom, isGuard, tripOf, teacherOf, studentOf } from "../src/auth/guard.js";
import { healthRoutes } from "../src/routes/health.js";
import { teacherAuthRoutes } from "../src/routes/teacher-auth.js";
import { tripRoutes } from "../src/routes/trips.js";
import { rosterRoutes } from "../src/routes/roster.js";
import { tripInviteRoutes, inviteRoutes } from "../src/routes/invites.js";
import { challengeRoutes } from "../src/routes/challenges.js";
import { teamRoutes } from "../src/routes/teams.js";
import { nominationRoutes } from "../src/routes/nominations.js";
import { studentAuthRoutes } from "../src/routes/student-auth.js";
import { submissionRoutes } from "../src/routes/submissions.js";
import { duelRoutes } from "../src/routes/duels.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination, addCoTeacher,
} from "./support/harness.js";

// A throwaway plugin exercising each guard option; handlers echo what the guard resolved.
async function probeRoutes(app: FastifyInstance) {
  const echo = async (req: any) => ({ trip: req.trip ?? null, teacher: req.teacher ?? null, student: req.student ?? null });
  app.get("/teacher", { preHandler: guard({ role: "teacher" }) }, async (req) => teacherOf(req));
  app.get("/student", { preHandler: guard({ role: "student" }) }, async (req) => ({ student: studentOf(req), trip: tripOf(req) }));
  app.get("/public", { preHandler: guard({ role: "public" }) }, echo);
  app.get("/trip/:id", { preHandler: guard({ role: "teacher", trip: tripFrom.trip("params.id") }) }, async (req) => tripOf(req));
  app.get("/owner/:id", {
    preHandler: guard({ role: "teacher", trip: tripFrom.trip("params.id"), owner: "owners only" }),
  }, echo);
  app.get("/draft/:id", { preHandler: guard({ role: "teacher", trip: tripFrom.trip("params.id"), phases: ["draft"] }) }, echo);
  app.get("/custom-closed/:id", {
    preHandler: guard({
      role: "teacher", trip: tripFrom.trip("params.id"), phases: ["voting"],
      closed: { status: 200, body: { pair: null, reason: "closed" } },
    }),
  }, echo);
  app.get("/challenge/:id", { preHandler: guard({ role: "teacher", trip: tripFrom.challenge("params.id") }) }, async (req) => tripOf(req));
  app.get("/nomination/:id", { preHandler: guard({ role: "teacher", trip: tripFrom.nomination("params.id") }) }, echo);
  app.get("/submission/:id", { preHandler: guard({ role: "teacher", trip: tripFrom.submission("params.id") }) }, echo);
  app.get("/kid-challenge", {
    preHandler: guard({
      role: "student",
      query: z.object({ challengeId: z.string() }),
      trip: tripFrom.challenge("query.challengeId"),
      phases: ["challenge"],
      closed: { status: 409, body: { error: "closed", message: "submissions are closed" } },
    }),
  }, async (req) => tripOf(req));
  app.post("/by-body", {
    preHandler: guard({
      role: "teacher",
      body: z.object({ tripId: z.string().uuid(), title: z.string().min(1) }),
      trip: tripFrom.trip("body.tripId"),
    }),
  }, async (req) => ({ trip: tripOf(req), body: req.body }));
  app.get("/unguarded-reader", async (req) => tripOf(req));
}

const app = await buildApp([probeRoutes, "/p"]);

let owner: string, trip: string;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  trip = await makeTrip(owner, { phase: "draft" });
});

const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
const asOwner = () => teacherCookie(app, owner);
const NIL = "00000000-0000-0000-0000-000000000000";

describe("guard: roles", () => {
  it("teacher routes answer 401 without a valid teacher session", async () => {
    for (const cookie of [undefined, "teacher_session=forged"]) {
      const res = await get("/p/teacher", cookie);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "unauthorized", message: "teacher login required", requestId: expect.any(String) });
    }
    expect((await get("/p/teacher", asOwner())).json()).toEqual({ teacherId: owner });
  });

  it("student routes answer 401 without a live student session, and expose the student's trip", async () => {
    const res = await get("/p/student");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized", message: "no session", requestId: expect.any(String) });

    const kid = await makeStudent(trip);
    const ok = await get("/p/student", kid.cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      student: { studentId: kid.id, tripId: trip, teamId: null },
      trip: { id: trip, phase: "draft", votingClosed: false },
    });
  });

  it("public routes let anyone through and resolve nothing", async () => {
    expect((await get("/p/public")).json()).toEqual({ trip: null, teacher: null, student: null });
  });

  it("refuses, at registration, checks that would have nothing to check", () => {
    expect(() => guard({ role: "teacher", phases: ["draft"] })).toThrow(/trip/);
    expect(() => guard({ role: "teacher", owner: "x" })).toThrow(/trip/);
    expect(() => guard({ role: "public", phases: ["draft"] })).toThrow(/trip/);
    expect(() => guard({ role: "student", trip: tripFrom.trip("params.id"), owner: "x" })).toThrow(/teacher/);
    expect(() => guard({ role: "student", phases: ["draft"] })).not.toThrow(); // their own trip
  });

  it("reading the trip context on an unguarded route is a programming error, not a silent undefined", async () => {
    expect((await get("/p/unguarded-reader")).statusCode).toBe(500);
  });
});

describe("guard: trip scoping (teacher)", () => {
  it("resolves the trip and its phase for a member, owner or co-teacher", async () => {
    const co = await makeTeacher();
    await addCoTeacher(trip, co);
    for (const t of [owner, co]) {
      const res = await get(`/p/trip/${trip}`, teacherCookie(app, t));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: trip, phase: "draft", votingClosed: false });
    }
  });

  it("answers the same 404 for someone else's trip, a missing trip, and a malformed id", async () => {
    const stranger = await makeTeacher();
    for (const [url, cookie] of [
      [`/p/trip/${trip}`, teacherCookie(app, stranger)],
      [`/p/trip/${NIL}`, asOwner()],
      [`/p/trip/not-a-uuid`, asOwner()],
    ] as const) {
      const res = await get(url, cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found", message: "no such trip", requestId: expect.any(String) });
    }
  });

  it("owner-only routes refuse co-teachers and strangers with 403 and the route's message", async () => {
    const co = await makeTeacher();
    await addCoTeacher(trip, co);
    for (const t of [co, await makeTeacher()]) {
      const res = await get(`/p/owner/${trip}`, teacherCookie(app, t));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: "forbidden", message: "owners only", requestId: expect.any(String) });
    }
    expect((await get(`/p/owner/${trip}`, asOwner())).statusCode).toBe(200);
  });

  it("resolves the trip through a challenge, an active nomination or a submission", async () => {
    const kid = await makeStudent(trip);
    const team = await makeTeam(trip, "Foxes", [kid.id]);
    const ch = await makeChallenge(trip);
    const sub = await makeSubmission(trip, ch, team, kid.id);
    const nom = await makeNomination(trip, ch, team, sub);

    expect((await get(`/p/challenge/${ch}`, asOwner())).json()).toEqual({ id: trip, phase: "draft", votingClosed: false });
    expect((await get(`/p/nomination/${nom}`, asOwner())).statusCode).toBe(200);
    expect((await get(`/p/submission/${sub}`, asOwner())).statusCode).toBe(200);

    const stranger = teacherCookie(app, await makeTeacher());
    expect((await get(`/p/challenge/${ch}`, stranger)).json()).toEqual({ error: "not_found", message: "challenge", requestId: expect.any(String) });
    expect((await get(`/p/nomination/${nom}`, stranger)).json()).toEqual({ error: "not_found", message: "nomination", requestId: expect.any(String) });
    expect((await get(`/p/submission/${sub}`, stranger)).json()).toEqual({ error: "not_found", message: "submission", requestId: expect.any(String) });

    await pool.query(`UPDATE nomination SET active = false WHERE id = $1`, [nom]);
    expect((await get(`/p/nomination/${nom}`, asOwner())).statusCode).toBe(404); // retired nominations are gone
  });
});

describe("guard: trip scoping (student)", () => {
  it("only resolves challenges of the student's own trip", async () => {
    await pool.query(`UPDATE trip SET phase = 'challenge' WHERE id = $1`, [trip]);
    const kid = await makeStudent(trip);
    const mine = await makeChallenge(trip);
    const otherTrip = await makeTrip(await makeTeacher(), { phase: "challenge" });
    const theirs = await makeChallenge(otherTrip);

    expect((await get(`/p/kid-challenge?challengeId=${mine}`, kid.cookie)).json()).toMatchObject({ id: trip });
    for (const id of [theirs, NIL, "nope"]) {
      const res = await get(`/p/kid-challenge?challengeId=${id}`, kid.cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found", message: "challenge", requestId: expect.any(String) });
    }
  });
});

describe("guard: phases", () => {
  it("rejects a disallowed phase with a default 409 naming the phase", async () => {
    expect((await get(`/p/draft/${trip}`, asOwner())).statusCode).toBe(200);
    await pool.query(`UPDATE trip SET phase = 'challenge' WHERE id = $1`, [trip]);
    const res = await get(`/p/draft/${trip}`, asOwner());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "wrong_phase", message: "not available in phase 'challenge'", requestId: expect.any(String) });
  });

  it("uses the route's own closed reply when one is given", async () => {
    const res = await get(`/p/custom-closed/${trip}`, asOwner());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pair: null, reason: "closed" });

    const kid = await makeStudent(trip);
    await pool.query(`UPDATE trip SET phase = 'voting' WHERE id = $1`, [trip]);
    const closed = await get(`/p/kid-challenge?challengeId=${await makeChallenge(trip)}`, kid.cookie);
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toEqual({ error: "closed", message: "submissions are closed", requestId: expect.any(String) });
  });

  it("flags a voting trip whose planned close time has passed", async () => {
    await pool.query(`UPDATE trip SET phase = 'voting', voting_closes_at = now() - interval '1 minute' WHERE id = $1`, [trip]);
    expect((await get(`/p/trip/${trip}`, asOwner())).json()).toEqual({ id: trip, phase: "voting", votingClosed: true });
  });
});

describe("guard: input validation", () => {
  it("rejects a missing or malformed query with 400 naming the field, before touching the trip", async () => {
    const kid = await makeStudent(trip);
    const res = await get(`/p/kid-challenge`, kid.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request", message: "challengeId", requestId: expect.any(String) });
  });

  it("validates the body first, then resolves the trip it names", async () => {
    const post = (payload: unknown, cookie = asOwner()) =>
      app.inject({ method: "POST", url: "/p/by-body", headers: { cookie }, payload: payload as any });
    const bad = await post({ tripId: trip });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("bad_request");

    expect((await post({ tripId: trip, title: "x" }, teacherCookie(app, await makeTeacher()))).statusCode).toBe(404);
    const ok = await post({ tripId: trip, title: "x", extra: 1 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ trip: { id: trip, phase: "draft", votingClosed: false }, body: { tripId: trip, title: "x" } });
  });
});

describe("every API route declares a guard (#27)", () => {
  it("has no route without a guard preHandler", async () => {
    const unguarded: string[] = [];
    const all = Fastify();
    all.addHook("onRoute", (r) => {
      const pre = [r.preHandler ?? []].flat();
      if (!pre.some(isGuard)) unguarded.push(`${r.method} ${r.url}`);
    });
    await all.register((await import("@fastify/cookie")).default, { secret: "x".repeat(32) });
    for (const [plugin, prefix] of [
      [healthRoutes, ""], [teacherAuthRoutes, "/api/auth/teacher"], [tripRoutes, "/api/trips"],
      [rosterRoutes, "/api/trips"], [tripInviteRoutes, "/api/trips"], [inviteRoutes, "/api/invites"],
      [challengeRoutes, "/api/challenges"], [teamRoutes, "/api/teams"], [nominationRoutes, "/api/nominations"],
      [studentAuthRoutes, "/api/student"], [submissionRoutes, "/api/submissions"], [duelRoutes, "/api/duels"],
    ] as const) {
      await all.register(plugin as any, { prefix });
    }
    await all.ready();
    expect(unguarded.filter((r) => !r.startsWith("HEAD "))).toEqual([]);
  });
});
