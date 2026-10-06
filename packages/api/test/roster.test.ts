import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { rosterRoutes } from "../src/routes/roster.js";
import { enqueueRoster, processRosterBatch } from "../src/roster-worker.js";
import { sent, mailer } from "./support/fake-mailer.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, count, auditActions,
} from "./support/harness.js";

const app = await buildApp([rosterRoutes, "/api/trips"]);

let owner: string;
let trip: string;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  trip = await makeTrip(owner, { name: "Rome" });
});

const items = async () =>
  (await pool.query<{ status: string; attempts: number; last_error: string | null; email_enc: Buffer }>(
    `SELECT status, attempts, last_error, email_enc FROM roster_import_item WHERE trip_id = $1 ORDER BY created_at`,
    [trip],
  )).rows;

describe("POST /api/trips/:id/roster", () => {
  const post = (tripId: string, payload: unknown, cookie = teacherCookie(app, owner)) =>
    app.inject({ method: "POST", url: `/api/trips/${tripId}/roster`, headers: { cookie }, payload: payload as object });

  it("queues encrypted emails (never plaintext), audits, and the kicked worker creates students", async () => {
    const res = await post(trip, { emails: ["Kid1@School.test", "kid2@school.test"] });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: 2, requested: 2 });
    for (const it of await items()) expect(it.email_enc.toString()).not.toContain("school.test");
    expect(await auditActions(trip)).toContain("roster_enqueued");

    // The worker runs in the background (two argon2 hashes + Vault); allow it time under load.
    await vi.waitFor(async () => expect(await count("student", "trip_id = $1", [trip])).toBe(2), { timeout: 10_000 });
    // Addresses are normalised before use.
    await vi.waitFor(() => expect(sent.map((m) => m.to).sort()).toEqual(["kid1@school.test", "kid2@school.test"]), { timeout: 10_000 });
  });

  it("rejects bad input, missing auth and non-members", async () => {
    expect((await post(trip, { emails: ["not-an-email"] })).statusCode).toBe(400);
    expect((await post(trip, { emails: [] })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/trips/${trip}/roster`, payload: {} })).statusCode).toBe(401);
    const stranger = teacherCookie(app, await makeTeacher());
    expect((await post(trip, { emails: ["a@b.test"] }, stranger)).statusCode).toBe(404);
  });
});

describe("GET /api/trips/:id/roster/status", () => {
  it("reports queue progress and student count", async () => {
    await enqueueRoster(trip, ["a@school.test", "b@school.test", "c@school.test"]);
    await pool.query(
      `UPDATE roster_import_item SET status = 'failed'
        WHERE id = (SELECT id FROM roster_import_item WHERE trip_id = $1 LIMIT 1)`,
      [trip],
    );
    const res = await app.inject({
      method: "GET", url: `/api/trips/${trip}/roster/status`, headers: { cookie: teacherCookie(app, owner) },
    });
    expect(res.json()).toEqual({ pending: 2, done: 0, failed: 1, students: 0 });
  });

  it("404s for a non-member", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/trips/${trip}/roster/status`, headers: { cookie: teacherCookie(app, await makeTeacher()) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("roster worker", () => {
  it("skips blank lines when enqueuing", async () => {
    expect(await enqueueRoster(trip, ["a@school.test", "   "])).toBe(1);
  });

  it("creates one student per address, mails a join link, and dedupes repeats", async () => {
    await enqueueRoster(trip, ["kid@school.test", "kid@school.test"]);
    await processRosterBatch();

    expect(await count("student", "trip_id = $1", [trip])).toBe(1);
    expect((await items()).map((i) => i.status)).toEqual(["done", "done"]);
    expect(sent).toHaveLength(1);
    const [tripName, url] = sent[0]!.args as [string, string];
    expect(tripName).toBe("Rome");
    expect(url).toMatch(/^http:\/\/app\.test\/join\?code=[0-9a-f-]{36}\.[\w-]+$/);
  });

  it("records only an error code, never the address, when processing fails", async () => {
    await enqueueRoster(trip, ["kid@school.test"]);
    mailer.failTimes = 1;
    await processRosterBatch();
    const { rows } = await pool.query<{ last_error: string }>(
      `SELECT last_error FROM roster_import_item WHERE trip_id = $1`, [trip],
    );
    expect(rows[0]!.last_error).toBe("EENVELOPE");
  });

  // BUG: the Student row is inserted before the mail is sent. When SMTP fails once, the
  // retry hits ON CONFLICT DO NOTHING, skips the mail and marks the item 'done' — the
  // student never receives a code and nothing surfaces as 'failed'.
  it.fails("still delivers the code after a transient SMTP failure", async () => {
    await enqueueRoster(trip, ["kid@school.test"]);
    mailer.failTimes = 1;
    await processRosterBatch();
    expect(sent).toHaveLength(1);
  });

  it.fails("marks the item failed (not done) when the code could never be mailed", async () => {
    await enqueueRoster(trip, ["kid@school.test"]);
    mailer.fail = true;
    await processRosterBatch();
    expect((await items())[0]!.status).toBe("failed");
  });
});
