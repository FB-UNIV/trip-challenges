import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { challengeRoutes } from "../src/routes/challenges.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeChallenge, count,
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
