import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { tripInviteRoutes, inviteRoutes } from "../src/routes/invites.js";
import { sent } from "./support/fake-mailer.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, addCoTeacher, count, auditActions,
} from "./support/harness.js";

const app = await buildApp([tripInviteRoutes, "/api/trips"], [inviteRoutes, "/api/invites"]);

let owner: string, trip: string, asOwner: { cookie: string };
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher("owner@school.test");
  trip = await makeTrip(owner, { name: "Rome" });
  asOwner = { cookie: teacherCookie(app, owner) };
});

const invite = (email: string, headers = asOwner) =>
  app.inject({ method: "POST", url: `/api/trips/${trip}/invites`, headers, payload: { email } });
/** Invite and return the raw token from the mailed accept link. */
async function invitedToken(email: string): Promise<string> {
  await invite(email);
  const url = sent.at(-1)!.args[1] as string;
  return decodeURIComponent(url.split("token=")[1]!);
}
const accept = (token: string, teacherId: string) =>
  app.inject({ method: "POST", url: "/api/invites/accept", headers: { cookie: teacherCookie(app, teacherId) }, payload: { token } });

describe("trip-scoped invite management", () => {
  it("lists the trip's teachers, owner first", async () => {
    const co = await makeTeacher("a-co@school.test");
    await addCoTeacher(trip, co);
    const res = await app.inject({ method: "GET", url: `/api/trips/${trip}/teachers`, headers: asOwner });
    expect(res.json().teachers.map((t: any) => [t.email, t.role])).toEqual([
      ["owner@school.test", "owner"],
      ["a-co@school.test", "co"],
    ]);
  });

  it("invites by email (owner only), storing only a hash of the token", async () => {
    const res = await invite("CO@School.test");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ invited: "co@school.test" });
    expect(sent[0]).toMatchObject({ kind: "invite", to: "co@school.test" });
    const token = decodeURIComponent((sent[0]!.args[1] as string).split("token=")[1]!);
    expect(await count("trip_teacher_invite", "token_hash = $1", [token])).toBe(0);
    expect(await auditActions(trip)).toContain("coteacher_invited");

    const pending = await app.inject({ method: "GET", url: `/api/trips/${trip}/invites`, headers: asOwner });
    expect(pending.json().invites.map((i: any) => i.email)).toEqual(["co@school.test"]);
  });

  it("re-inviting supersedes the previous pending invite", async () => {
    const first = await invitedToken("co@school.test");
    await invite("co@school.test");
    expect(await count("trip_teacher_invite", "trip_id = $1", [trip])).toBe(1);
    const preview = await app.inject({ method: "GET", url: `/api/invites/preview?token=${encodeURIComponent(first)}` });
    expect(preview.statusCode).toBe(404);
  });

  it("refuses co-teachers inviting, existing members, and bad emails", async () => {
    const co = await makeTeacher("co@school.test");
    await addCoTeacher(trip, co);
    expect((await invite("x@school.test", { cookie: teacherCookie(app, co) })).statusCode).toBe(403);
    expect((await invite("co@school.test")).json().error).toBe("already_member");
    expect((await invite("not-an-email")).statusCode).toBe(400);
  });

  it("revokes a pending invite (owner only)", async () => {
    await invite("co@school.test");
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM trip_teacher_invite`);
    const co = await makeTeacher();
    await addCoTeacher(trip, co);
    const url = `/api/trips/${trip}/invites/${rows[0]!.id}`;
    expect((await app.inject({ method: "DELETE", url, headers: { cookie: teacherCookie(app, co) } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url, headers: asOwner })).json()).toEqual({ ok: true });
    expect(await count("trip_teacher_invite")).toBe(0);
  });

  it("hides lists from non-members", async () => {
    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/teachers`, headers: stranger })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/invites`, headers: stranger })).statusCode).toBe(404);
  });
});

describe("recipient side", () => {
  it("previews an invite by token", async () => {
    const token = await invitedToken("co@school.test");
    const res = await app.inject({ method: "GET", url: `/api/invites/preview?token=${encodeURIComponent(token)}` });
    expect(res.json()).toEqual({ email: "co@school.test", trip_name: "Rome", expired: false });
    expect((await app.inject({ method: "GET", url: "/api/invites/preview" })).statusCode).toBe(400);
  });

  it("grants co access to the invited account, idempotently", async () => {
    const token = await invitedToken("co@school.test");
    const co = await makeTeacher("Co@School.test");
    const res = await accept(token, co);
    expect(res.json()).toEqual({ ok: true, tripId: trip });
    expect(await count("trip_teacher", "trip_id = $1 AND teacher_id = $2 AND role = 'co'", [trip, co])).toBe(1);

    expect((await accept(token, co)).json()).toEqual({ ok: true, tripId: trip }); // StrictMode double-call
    expect((await auditActions(trip)).filter((a) => a === "coteacher_joined")).toHaveLength(1);
  });

  it("refuses a forwarded link signed in as a different account", async () => {
    const token = await invitedToken("co@school.test");
    const res = await accept(token, await makeTeacher("someone-else@school.test"));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("wrong_account");
  });

  it("refuses expired or unknown tokens and bad bodies", async () => {
    const token = await invitedToken("co@school.test");
    await pool.query(`UPDATE trip_teacher_invite SET expires_at = now() - interval '1 minute'`);
    const co = await makeTeacher("co@school.test");
    expect((await accept(token, co)).statusCode).toBe(404);
    expect((await accept("unknown-token-value", co)).statusCode).toBe(404);
    expect((await accept("short", co)).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/invites/accept", payload: { token } })).statusCode).toBe(401);
  });
});
