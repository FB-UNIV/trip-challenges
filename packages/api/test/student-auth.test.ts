import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { studentAuthRoutes } from "../src/routes/student-auth.js";
import { sent, mailer } from "./support/fake-mailer.js";
import {
  pool, resetAll, buildApp, makeTeacher, makeTrip, makeStudent, makeTeam, auditActions, count,
} from "./support/harness.js";

const app = await buildApp([studentAuthRoutes, "/api/student"]);

let trip: string;
beforeEach(async () => {
  await resetAll();
  trip = await makeTrip(await makeTeacher(), { name: "Rome", phase: "challenge" });
});

const me = (cookie?: string) =>
  app.inject({ method: "GET", url: "/api/student/me", headers: cookie ? { cookie } : {} });
const redeem = (code: string) =>
  app.inject({ method: "POST", url: "/api/student/redeem", payload: { code } });
const reissue = (payload: object) =>
  app.inject({ method: "POST", url: "/api/student/reissue", payload });
const sessionCookie = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === "student_session");
  return c ? `student_session=${c.value}` : undefined;
};

describe("GET /api/student/me", () => {
  it("returns the student's trip context", async () => {
    const s = await makeStudent(trip);
    const team = await makeTeam(trip, "Foxes", [s.id]);
    const res = await me(s.cookie);
    expect(res.json()).toEqual({ studentId: s.id, tripId: trip, tripName: "Rome", phase: "challenge", teamId: team });
  });

  it.each([
    ["no cookie", undefined],
    ["malformed cookie", "student_session=garbage"],
    ["wrong token", "student_session=00000000-0000-0000-0000-000000000000.nope"],
  ])("401s with %s", async (_label, cookie) => {
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it("401s with a revoked session", async () => {
    const s = await makeStudent(trip);
    await pool.query(`UPDATE student_session SET revoked_at = now() WHERE student_id = $1`, [s.id]);
    expect((await me(s.cookie)).statusCode).toBe(401);
  });
});

describe("POST /api/student/redeem", () => {
  it("rejects malformed input", async () => {
    expect((await redeem("short")).statusCode).toBe(400);
    expect((await redeem("no-dot-in-this-code")).statusCode).toBe(401);
  });

  it("rejects unknown students and wrong secrets alike", async () => {
    const s = await makeStudent(trip, { unredeemedCode: true });
    expect((await redeem(`00000000-0000-0000-0000-000000000000.whatever-secret`)).statusCode).toBe(401);
    expect((await redeem(`${s.id}.wrong-secret-value`)).statusCode).toBe(401);
  });

  it("spends the code, binds a new device session and retires the old one", async () => {
    const s = await makeStudent(trip, { unredeemedCode: true });
    const res = await redeem(s.code!);
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === "student_session")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });

    expect((await me(sessionCookie(res))).statusCode).toBe(200);
    expect((await me(s.cookie)).statusCode).toBe(401); // previous device
    expect(await count("student", "id = $1 AND access_code_state = 'redeemed'", [s.id])).toBe(1);

    // Single use.
    expect((await redeem(s.code!)).statusCode).toBe(401);
  });
});

describe("POST /api/student/reissue (lost device)", () => {
  it("rejects malformed input", async () => {
    expect((await reissue({ tripId: "nope", email: "x" })).statusCode).toBe(400);
  });

  it("answers identically and sends nothing for unknown trips, erased trips and unknown emails", async () => {
    const erased = await makeTrip(await makeTeacher(), { phase: "erased" });
    const s = await makeStudent(erased);
    for (const body of [
      { tripId: "00000000-0000-0000-0000-000000000000", email: "kid@school.test" },
      { tripId: erased, email: s.email },
      { tripId: trip, email: "stranger@school.test" },
    ]) {
      const res = await reissue(body);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    }
    expect(sent).toHaveLength(0);
  });

  it("mails a fresh code without logging the old device out; redeeming it does", async () => {
    const s = await makeStudent(trip, { email: "kid@school.test" });
    const res = await reissue({ tripId: trip, email: "KID@school.test" });
    expect(res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("kid@school.test");
    expect(await auditActions(trip)).toContain("access_code_reissued");

    // Requesting alone doesn't revoke: a stranger knowing the email can't log the kid out.
    expect((await me(s.cookie)).statusCode).toBe(200);

    const code = decodeURIComponent((sent[0]!.args[1] as string).split("code=")[1]!);
    const redeemed = await redeem(code);
    expect(redeemed.statusCode).toBe(200);
    expect((await me(s.cookie)).statusCode).toBe(401);
    expect((await me(sessionCookie(redeemed))).statusCode).toBe(200);
  });

  it("still answers neutrally when the mail fails", async () => {
    const s = await makeStudent(trip);
    mailer.fail = true;
    const res = await reissue({ tripId: trip, email: s.email });
    expect(res.json()).toEqual({ ok: true });
  });
});
