// The teacher's student list (#93): who is Joined / Invited / Undelivered (CONTEXT: Joined),
// in which team — and the two fixes: resend a code, correct an undelivered address.
// Emails are decrypted for the Trip's teachers only (ADR 0006).
import { vi, describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Writable } from "node:stream";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { RosterList } from "@trip/shared";
import { tripStudentRoutes } from "../src/routes/trip-students.js";
import { encrypt, decrypt, hmac } from "./support/fake-vault.js";
import { sent, mailer } from "./support/fake-mailer.js";
import { loggerOptions } from "../src/lib/logging.js";
import { config } from "./support/config.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam, auditActions, count,
} from "./support/harness.js";

const app = await buildApp([tripStudentRoutes, "/api/trips"]);

let owner: string;
let asOwner: { cookie: string };
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  asOwner = { cookie: teacherCookie(app, owner) };
});

/** A Student in a given situation. makeStudent signs them in; undo that for non-joined ones. */
async function student(trip: string, email: string, state: "joined" | "invited" | "undelivered") {
  const s = await makeStudent(trip, { email });
  if (state !== "joined") await pool.query(`DELETE FROM student_session WHERE student_id = $1`, [s.id]);
  if (state !== "undelivered") await pool.query(`UPDATE student SET access_code_sent_at = now() WHERE id = $1`, [s.id]);
  return s.id;
}
async function item(trip: string, email: string, status: "pending" | "failed", lastError: string | null = null) {
  const enc = await encrypt(trip, Buffer.from(email));
  return (await pool.query<{ id: string }>(
    `INSERT INTO roster_import_item (trip_id, email_enc, status, attempts, last_error) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [trip, Buffer.from(enc), status, status === "failed" ? 5 : 0, lastError],
  )).rows[0]!.id;
}
const list = async (trip: string) => {
  const res = await app.inject({ method: "GET", url: `/api/trips/${trip}/students`, headers: asOwner });
  expect(res.statusCode).toBe(200);
  return RosterList.parse(res.json());
};
const emailOf = async (trip: string, studentId: string) => {
  const { rows } = await pool.query<{ email_enc: Buffer }>(`SELECT email_enc FROM student WHERE id = $1`, [studentId]);
  return (await decrypt(trip, rows[0]!.email_enc.toString("utf8"))).toString("utf8");
};

describe("GET /api/trips/:id/students", () => {
  it("is for the trip's teachers only", async () => {
    const trip = await makeTrip(owner);
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/students` })).statusCode).toBe(401);
    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    expect((await app.inject({ method: "GET", url: `/api/trips/${trip}/students`, headers: stranger })).statusCode).toBe(404);
  });

  it("gives each student's email, status and team, plus addresses that never became students", async () => {
    const trip = await makeTrip(owner, { phase: "challenge" });
    const ana = await student(trip, "ana@school.test", "joined");
    const tom = await student(trip, "tom@school.test", "invited");
    const lea = await student(trip, "lea@school.test", "undelivered");
    await item(trip, "lea@school.test", "failed", "EENVELOPE"); // her code's mail bounced
    const team = await makeTeam(trip, "Foxes", [ana]);
    await item(trip, "new@school.test", "pending"); // just imported, still sending
    const orphan = await item(trip, "vault-hiccup@school.test", "failed", "ECONNRESET"); // never became a student
    await pool.query(`UPDATE student SET access_code_state = 'unredeemed' WHERE id = $1`, [ana]); // asked for a new code

    const { students, counts } = await list(trip);
    const byEmail = Object.fromEntries(students.map((s) => [s.email, s]));
    expect(byEmail["ana@school.test"]).toMatchObject({ kind: "student", id: ana, status: "joined", teamId: team, newCodeRequested: true });
    expect(byEmail["tom@school.test"]).toMatchObject({ kind: "student", id: tom, status: "invited", teamId: null, newCodeRequested: false });
    expect(byEmail["lea@school.test"]).toMatchObject({ kind: "student", id: lea, status: "undelivered", lastError: "EENVELOPE" });
    expect(byEmail["new@school.test"]).toMatchObject({ kind: "import", status: "sending" });
    expect(byEmail["vault-hiccup@school.test"]).toMatchObject({ kind: "import", id: orphan, status: "undelivered", lastError: "ECONNRESET" });
    expect(students).toHaveLength(5); // lea's failed item is folded into her student row
    expect(counts).toEqual({ all: 5, notJoined: 4, undelivered: 2, noTeam: 2, sending: 1 });
  });

  it("doesn't count a student still being sent their code as undelivered", async () => {
    const trip = await makeTrip(owner);
    await student(trip, "zoe@school.test", "undelivered");
    await item(trip, "zoe@school.test", "pending");
    const { students } = await list(trip);
    expect(students).toEqual([expect.objectContaining({ email: "zoe@school.test", kind: "student", status: "sending" })]);
  });
});

describe("POST /api/trips/:id/students/:studentId/resend", () => {
  const resend = (trip: string, id: string) =>
    app.inject({ method: "POST", url: `/api/trips/${trip}/students/${id}/resend`, headers: asOwner });

  it("mints a fresh code for a student who hasn't joined, mails it, and audits without the email", async () => {
    const trip = await makeTrip(owner);
    const lea = await student(trip, "lea@school.test", "undelivered");
    await item(trip, "lea@school.test", "failed", "EENVELOPE");
    const before = (await pool.query(`SELECT access_code_hash FROM student WHERE id = $1`, [lea])).rows[0];

    expect((await resend(trip, lea)).statusCode).toBe(200);

    const after = (await pool.query(`SELECT access_code_hash, access_code_sent_at FROM student WHERE id = $1`, [lea])).rows[0];
    expect(after.access_code_hash).not.toBe(before.access_code_hash);
    expect(after.access_code_sent_at).not.toBeNull();
    expect(sent).toEqual([expect.objectContaining({ kind: "access_code", to: "lea@school.test" })]);
    expect((sent[0]!.args[1] as string)).toContain(`/join?code=${lea}.`);
    expect(await count("roster_import_item", "trip_id = $1", [trip])).toBe(0); // the bounce is resolved
    expect((await list(trip)).students[0]).toMatchObject({ status: "invited" });
    expect(await auditActions(trip)).toContain("access_code_resent");
    const audit = await pool.query(`SELECT * FROM audit_log WHERE trip_id = $1`, [trip]);
    expect(JSON.stringify(audit.rows)).not.toContain("lea@");
  });

  it("refuses a student who has joined (the lost-code link covers them)", async () => {
    const trip = await makeTrip(owner);
    const ana = await student(trip, "ana@school.test", "joined");
    expect((await resend(trip, ana)).statusCode).toBe(409);
    expect(sent).toEqual([]);
  });

  it("explains a mail that fails again, and leaves the student undelivered", async () => {
    const trip = await makeTrip(owner);
    const lea = await student(trip, "lea@school.test", "undelivered");
    mailer.fail = true;
    const res = await resend(trip, lea);
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toMatch(/couldn't be sent/i);
    expect(JSON.stringify(res.json())).not.toContain("lea@");
    expect((await list(trip)).students[0]).toMatchObject({ status: "undelivered" });
  });

  it("404s for another trip's student", async () => {
    const trip = await makeTrip(owner);
    const elsewhere = await student(await makeTrip(owner), "x@school.test", "invited");
    expect((await resend(trip, elsewhere)).statusCode).toBe(404);
  });
});

describe("PATCH /api/trips/:id/students/:studentId — fix an address", () => {
  const fix = (trip: string, id: string, email: unknown) =>
    app.inject({ method: "PATCH", url: `/api/trips/${trip}/students/${id}`, headers: asOwner, payload: { email } });

  it("replaces the address (and its lookup), mails the new one a code, drops the bounce", async () => {
    const trip = await makeTrip(owner);
    const lea = await student(trip, "lea@shcool.test", "undelivered");
    await item(trip, "lea@shcool.test", "failed", "EENVELOPE");

    expect((await fix(trip, lea, " Lea@School.test ")).statusCode).toBe(200);

    expect(await emailOf(trip, lea)).toBe("lea@school.test");
    const { rows } = await pool.query(`SELECT email_lookup FROM student WHERE id = $1`, [lea]);
    expect(rows[0].email_lookup).toBe(await hmac(trip, Buffer.from("lea@school.test")));
    expect(sent).toEqual([expect.objectContaining({ to: "lea@school.test" })]);
    expect(await count("roster_import_item", "trip_id = $1", [trip])).toBe(0);
    expect(await auditActions(trip)).toContain("roster_address_fixed");
  });

  it("refuses joined students, addresses already on the roster, and non-emails", async () => {
    const trip = await makeTrip(owner);
    const ana = await student(trip, "ana@school.test", "joined");
    const lea = await student(trip, "lea@shcool.test", "undelivered");
    expect((await fix(trip, ana, "ana2@school.test")).statusCode).toBe(409);
    expect((await fix(trip, lea, "ana@school.test")).statusCode).toBe(409);
    expect((await fix(trip, lea, "not an email")).statusCode).toBe(400);
    expect(await emailOf(trip, lea)).toBe("lea@shcool.test");
  });
});

describe("POST /api/trips/:id/roster/items/:itemId/retry", () => {
  const retry = (trip: string, id: string, payload: object = {}) =>
    app.inject({ method: "POST", url: `/api/trips/${trip}/roster/items/${id}/retry`, headers: asOwner, payload });

  it("queues a failed address again, corrected if given", async () => {
    const trip = await makeTrip(owner);
    const orphan = await item(trip, "lea@shcool.test", "failed", "ECONNRESET");
    expect((await retry(trip, orphan, { email: "lea@school.test" })).statusCode).toBe(202);
    const { rows } = await pool.query(`SELECT email_enc, attempts, last_error FROM roster_import_item WHERE id = $1`, [orphan]);
    expect((await decrypt(trip, rows[0].email_enc.toString("utf8"))).toString("utf8")).toBe("lea@school.test");
    expect(rows[0]).toMatchObject({ attempts: 0, last_error: null });
    expect(await auditActions(trip)).toContain("roster_item_retried");
  });

  it("only retries failed items of this trip", async () => {
    const trip = await makeTrip(owner);
    const pending = await item(trip, "a@school.test", "pending");
    const elsewhere = await item(await makeTrip(owner), "b@school.test", "failed");
    expect((await retry(trip, pending)).statusCode).toBe(404);
    expect((await retry(trip, elsewhere)).statusCode).toBe(404);
  });
});

describe("the decrypted emails never reach the logs (ADR 0006)", () => {
  it("not on listing, nor on a failed resend or fix", async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); } });
    const logged = Fastify({ logger: { ...loggerOptions("production"), stream } });
    await logged.register(cookie, { secret: config.SESSION_SECRET });
    await logged.register(tripStudentRoutes, { prefix: "/api/trips" });
    await logged.ready();
    const headers = { cookie: teacherCookie(logged, owner) };

    const trip = await makeTrip(owner);
    const lea = await student(trip, "lea@shcool.test", "undelivered");
    await item(trip, "orphan@school.test", "failed", "EENVELOPE");
    mailer.fail = true; // the fake's error message echoes the address, like real SMTP errors
    await logged.inject({ method: "GET", url: `/api/trips/${trip}/students`, headers });
    await logged.inject({ method: "POST", url: `/api/trips/${trip}/students/${lea}/resend`, headers });
    await logged.inject({ method: "PATCH", url: `/api/trips/${trip}/students/${lea}`, headers, payload: { email: "lea@school.test" } });

    const all = lines.join("");
    expect(all).toContain(`/api/trips/${trip}/students`);
    for (const email of ["lea@shcool.test", "lea@school.test", "orphan@school.test"]) expect(all).not.toContain(email);
    await logged.close();
  });
});
