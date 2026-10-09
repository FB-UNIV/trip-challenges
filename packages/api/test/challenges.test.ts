import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { challengeRoutes } from "../src/routes/challenges.js";
import { StudentChallengeList } from "@trip/shared";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeChallenge, count,
  makeTeam, makeSubmission, makeNomination,
} from "./support/harness.js";

const app = await buildApp([challengeRoutes, "/api/challenges"]);

let owner: string, trip: string, asOwner: { cookie: string }, asStranger: { cookie: string };
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  trip = await makeTrip(owner);
  asOwner = { cookie: teacherCookie(app, owner) };
  asStranger = { cookie: teacherCookie(app, await makeTeacher()) };
});

const setPhase = (phase: string) => pool.query(`UPDATE trip SET phase = $2 WHERE id = $1`, [trip, phase]);

describe("POST /api/challenges", () => {
  it("creates a challenge with a QR slug and defaults", async () => {
    const res = await app.inject({ method: "POST", url: "/api/challenges", headers: asOwner, payload: { tripId: trip, title: "Gelato" } });
    expect(res.statusCode).toBe(201);
    const { id, qrSlug } = res.json();
    expect(qrSlug).toMatch(/^[\w-]{11}$/);
    const { rows } = await pool.query(`SELECT title, instructions, multiplier FROM challenge WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ title: "Gelato", instructions: "", multiplier: "1" });
  });

  it("enforces auth, body and trip membership", async () => {
    expect((await app.inject({ method: "POST", url: "/api/challenges", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/challenges", headers: asOwner, payload: { tripId: trip } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/challenges", headers: asStranger, payload: { tripId: trip, title: "x" } })).statusCode).toBe(404);
  });
});

describe("PATCH /api/challenges/:id", () => {
  it("edits content until results are computed", async () => {
    const id = await makeChallenge(trip, { title: "Old" });
    await setPhase("voting");
    const res = await app.inject({ method: "PATCH", url: `/api/challenges/${id}`, headers: asOwner, payload: { title: "New", multiplier: 3 } });
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await pool.query(`SELECT title, multiplier FROM challenge WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ title: "New", multiplier: "3" });

    await setPhase("reveal");
    expect((await app.inject({ method: "PATCH", url: `/api/challenges/${id}`, headers: asOwner, payload: { title: "Late" } })).statusCode).toBe(409);
  });

  it("treats an empty patch as a no-op and validates input and access", async () => {
    const id = await makeChallenge(trip);
    expect((await app.inject({ method: "PATCH", url: `/api/challenges/${id}`, headers: asOwner, payload: {} })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "PATCH", url: `/api/challenges/${id}`, headers: asOwner, payload: { multiplier: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/challenges/${id}`, headers: asStranger, payload: {} })).statusCode).toBe(404);
  });
});

describe("DELETE /api/challenges/:id", () => {
  it("deletes only while the trip is a draft (QRs may be printed after)", async () => {
    const id = await makeChallenge(trip);
    expect((await app.inject({ method: "DELETE", url: `/api/challenges/${id}`, headers: asStranger })).statusCode).toBe(404);
    await setPhase("challenge");
    expect((await app.inject({ method: "DELETE", url: `/api/challenges/${id}`, headers: asOwner })).statusCode).toBe(409);
    await setPhase("draft");
    expect((await app.inject({ method: "DELETE", url: `/api/challenges/${id}`, headers: asOwner })).json()).toEqual({ ok: true });
    expect(await count("challenge", "id = $1", [id])).toBe(0);
  });
});

describe("listing and lookup", () => {
  it("lists a trip's challenges for its teachers only", async () => {
    await makeChallenge(trip, { title: "A" });
    const res = await app.inject({ method: "GET", url: `/api/challenges?tripId=${trip}`, headers: asOwner });
    expect(res.json().challenges.map((c: any) => c.title)).toEqual(["A"]);
    expect((await app.inject({ method: "GET", url: `/api/challenges?tripId=${trip}`, headers: asStranger })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/challenges`, headers: asOwner })).statusCode).toBe(404);
  });

  it("lists the student's own trip challenges", async () => {
    await makeChallenge(trip, { title: "Mine" });
    await makeChallenge(await makeTrip(owner), { title: "Elsewhere" });
    const s = await makeStudent(trip);
    const res = await app.inject({ method: "GET", url: "/api/challenges/for-student", headers: { cookie: s.cookie } });
    expect(res.json().challenges.map((c: any) => c.title)).toEqual(["Mine"]);
    expect((await app.inject({ method: "GET", url: "/api/challenges/for-student" })).statusCode).toBe(401);
  });

  it("resolves a scanned slug publicly", async () => {
    const id = await makeChallenge(trip, { title: "Gelato" });
    const { rows } = await pool.query<{ qr_slug: string }>(`SELECT qr_slug FROM challenge WHERE id = $1`, [id]);
    const res = await app.inject({ method: "GET", url: `/api/challenges/by-slug/${rows[0]!.qr_slug}` });
    expect(res.json()).toEqual({ id, title: "Gelato", instructions: "" });
    expect((await app.inject({ method: "GET", url: "/api/challenges/by-slug/nope" })).statusCode).toBe(404);
  });

  it("renders a printable QR PNG for the trip's teachers", async () => {
    const id = await makeChallenge(trip);
    const res = await app.inject({ method: "GET", url: `/api/challenges/${id}/qr.png`, headers: asOwner });
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    expect((await app.inject({ method: "GET", url: `/api/challenges/${id}/qr.png`, headers: asStranger })).statusCode).toBe(404);
  });
});

// The student checklist + vote list: per-challenge progress for *this* student only.
describe("GET /api/challenges/for-student — progress", () => {
  const list = async (cookie: string) => {
    const res = await app.inject({ method: "GET", url: "/api/challenges/for-student", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return StudentChallengeList.parse(res.json()).challenges;
  };
  const one = async (cookie: string) => (await list(cookie))[0]!;

  /** A team with one member and one approved nomination for `ch`. */
  async function entrant(ch: string, name: string, state: "approved" | "pending" = "approved") {
    const s = await makeStudent(trip);
    const team = await makeTeam(trip, name, [s.id]);
    const sub = await makeSubmission(trip, ch, team, s.id);
    return makeNomination(trip, ch, team, sub, state);
  }
  async function duel(voter: string, ch: string, a: string, b: string) {
    const [lo, hi] = [a, b].sort();
    await pool.query(
      `INSERT INTO duel (trip_id, challenge_id, voter_student_id, a_nomination_id, b_nomination_id,
                         winner_nomination_id, low_nomination_id, high_nomination_id)
       VALUES ($1,$2,$3,$4,$5,$4,$6,$7)`,
      [trip, ch, voter, a, b, lo, hi],
    );
  }

  it("challenge phase: counts my team's live photos and whether one is entered", async () => {
    await setPhase("challenge");
    const ch = await makeChallenge(trip, { title: "Gelato" });
    const me = await makeStudent(trip);
    const mine = await makeTeam(trip, "Foxes", [me.id]);
    const kept = await makeSubmission(trip, ch, mine, me.id);
    const removed = await makeSubmission(trip, ch, mine, me.id);
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [removed, owner]);
    await entrant(ch, "Other team"); // other teams' photos never count toward mine
    const { rows } = await pool.query<{ qr_slug: string }>(`SELECT qr_slug FROM challenge WHERE id = $1`, [ch]);

    expect(await one(me.cookie)).toMatchObject({ id: ch, title: "Gelato", qrSlug: rows[0]!.qr_slug, photos: 1, nominated: false, vote: null });
    await makeNomination(trip, ch, mine, kept, "pending");
    expect(await one(me.cookie)).toMatchObject({ photos: 1, nominated: true });
  });

  // #81: the team learns what happened to its entry, rejection included.
  it("tells the team where its entry stands: none, pending, approved, rejected, then pending again", async () => {
    await setPhase("challenge");
    const ch = await makeChallenge(trip);
    const me = await makeStudent(trip);
    const mine = await makeTeam(trip, "Foxes", [me.id]);
    const first = await makeSubmission(trip, ch, mine, me.id);
    expect((await one(me.cookie)).entry).toBeNull();

    const nom = await makeNomination(trip, ch, mine, first, "pending");
    expect(await one(me.cookie)).toMatchObject({ nominated: true, entry: "pending" });
    await pool.query(`UPDATE nomination SET state = 'approved' WHERE id = $1`, [nom]);
    expect((await one(me.cookie)).entry).toBe("approved");
    await pool.query(`UPDATE nomination SET state = 'rejected', active = false WHERE id = $1`, [nom]);
    expect(await one(me.cookie)).toMatchObject({ nominated: false, entry: "rejected" });

    // Picking another photo starts over.
    await makeNomination(trip, ch, mine, await makeSubmission(trip, ch, mine, me.id), "pending");
    expect((await one(me.cookie)).entry).toBe("pending");
  });

  it("never shows another team's rejection", async () => {
    await setPhase("challenge");
    const ch = await makeChallenge(trip);
    const me = await makeStudent(trip);
    await makeTeam(trip, "Foxes", [me.id]);
    const other = await entrant(ch, "Owls", "pending");
    await pool.query(`UPDATE nomination SET state = 'rejected', active = false WHERE id = $1`, [other]);
    expect((await one(me.cookie)).entry).toBeNull();
  });

  it("a student without a team has no photos and nothing entered", async () => {
    await setPhase("challenge");
    await makeChallenge(trip);
    const loner = await makeStudent(trip);
    expect(await one(loner.cookie)).toMatchObject({ photos: 0, nominated: false, vote: null });
  });

  it("voting, 3 teams: one possible pair; done after voting it", async () => {
    await setPhase("voting");
    const ch = await makeChallenge(trip);
    const me = await makeStudent(trip);
    const mine = await makeTeam(trip, "Foxes", [me.id]);
    await makeNomination(trip, ch, mine, await makeSubmission(trip, ch, mine, me.id)); // my own: never in a pair
    const b = await entrant(ch, "B");
    const c = await entrant(ch, "C");

    expect((await one(me.cookie)).vote).toEqual({ voted: 0, total: 1, status: "todo" });
    await duel(me.id, ch, b, c);
    expect((await one(me.cookie)).vote).toEqual({ voted: 1, total: 1, status: "done" });
  });

  it("voting, 4 other teams: 6 pairs; only my own duels count", async () => {
    await setPhase("voting");
    const ch = await makeChallenge(trip);
    const me = await makeStudent(trip);
    const someoneElse = await makeStudent(trip);
    const [a, b, c] = [await entrant(ch, "A"), await entrant(ch, "B"), await entrant(ch, "C")];
    await entrant(ch, "D");
    await duel(me.id, ch, a, b);
    await duel(someoneElse.id, ch, a, c);

    expect((await one(me.cookie)).vote).toEqual({ voted: 1, total: 6, status: "in_progress" });
  });

  it("voting: pending nominations don't count, so too few approved means not_enough", async () => {
    await setPhase("voting");
    const ch = await makeChallenge(trip);
    const me = await makeStudent(trip);
    await entrant(ch, "A");
    await entrant(ch, "B", "pending");
    expect((await one(me.cookie)).vote).toEqual({ voted: 0, total: 0, status: "not_enough" });
  });

  it("voting: a duel against a since-removed nomination no longer counts", async () => {
    await setPhase("voting");
    const ch = await makeChallenge(trip);
    const me = await makeStudent(trip);
    const a = await entrant(ch, "A");
    await entrant(ch, "B");
    const c = await entrant(ch, "C");
    await duel(me.id, ch, a, c);
    await pool.query(`UPDATE nomination SET active = false WHERE id = $1`, [c]);
    expect((await one(me.cookie)).vote).toEqual({ voted: 0, total: 1, status: "todo" });
  });

  it("no vote progress once voting has closed", async () => {
    await setPhase("voting");
    await pool.query(`UPDATE trip SET voting_closes_at = now() - interval '1 minute' WHERE id = $1`, [trip]);
    await makeChallenge(trip);
    const me = await makeStudent(trip);
    expect((await one(me.cookie)).vote).toBeNull();
  });

  it("lists challenges in a stable order (by title)", async () => {
    await makeChallenge(trip, { title: "Zebra crossing" });
    await makeChallenge(trip, { title: "Apple stand" });
    const me = await makeStudent(trip);
    expect((await list(me.cookie)).map((c) => c.title)).toEqual(["Apple stand", "Zebra crossing"]);
  });
});
