import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { tripRoutes } from "../src/routes/trips.js";
import { hasKey, keyCount } from "./support/fake-vault.js";
import { s3faults } from "./support/fake-s3.js";
import { findTripsDueForErasure } from "../src/erasure.js";
import { advanceTrip } from "../src/lifecycle.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, auditActions, count,
  makeStudent, makeTeam, makeChallenge, makeSubmission, makeNomination, setStats,
} from "./support/harness.js";

const app = await buildApp([tripRoutes, "/api/trips"]);

let owner: string;
let asOwner: { cookie: string };

beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  asOwner = { cookie: teacherCookie(app, owner) };
});

/** A calendar date `n` days from today (UTC), as the date picker sends it. */
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const eraseAt = async (id: string) =>
  (await pool.query<{ hard_erase_at: Date }>(`SELECT hard_erase_at FROM trip WHERE id = $1`, [id])).rows[0]!.hard_erase_at;

const phaseOf = async (id: string) =>
  (await pool.query<{ phase: string }>(`SELECT phase FROM trip WHERE id = $1`, [id])).rows[0]?.phase;

describe("POST /api/trips", () => {
  it("requires a teacher session", async () => {
    const res = await app.inject({ method: "POST", url: "/api/trips", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a forged (unsigned) teacher cookie", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/trips", headers: { cookie: `teacher_session=${owner}` }, payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid config", async () => {
    const res = await app.inject({ method: "POST", url: "/api/trips", headers: asOwner, payload: { name: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("creates the trip, its Vault key, owner membership and an audit row", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/trips", headers: asOwner,
      payload: { name: "Rome", tripEndDate: "2030-06-01", maxRetentionDays: 10 },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(hasKey(id)).toBe(true);

    const { rows } = await pool.query<{ hard_erase_at: Date; vault_key_name: string; phase: string }>(
      `SELECT hard_erase_at, vault_key_name, phase FROM trip WHERE id = $1`, [id],
    );
    expect(rows[0]!.phase).toBe("draft");
    expect(rows[0]!.vault_key_name).toBe(`trip-${id}`);
    // hard_erase_at = tripEndDate + maxRetentionDays
    expect(rows[0]!.hard_erase_at.toISOString().slice(0, 10)).toBe("2030-06-11");
    expect(await count("trip_teacher", "trip_id = $1 AND teacher_id = $2 AND role = 'owner'", [id, owner])).toBe(1);
    expect(await auditActions(id)).toContain("trip_created");
  });

  // A past end date put hard_erase_at in the past too: the next sweep erased the new trip at once.
  it("refuses an end date in the past, which would have the trip erased at once", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/trips", headers: asOwner,
      payload: { name: "Rome", tripEndDate: daysFromNow(-60) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "end_date_past", message: "La date de fin de la sortie ne peut pas être passée." });
    expect(await count("trip")).toBe(0);
    expect(keyCount()).toBe(0);
    expect(await findTripsDueForErasure()).toEqual([]);
  });

  it("refuses an end date two days ago", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/trips", headers: asOwner, payload: { name: "Rome", tripEndDate: daysFromNow(-2) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts today, and yesterday (a teacher ahead of UTC late in the evening)", async () => {
    for (const day of [daysFromNow(0), daysFromNow(-1)]) {
      const res = await app.inject({ method: "POST", url: "/api/trips", headers: asOwner, payload: { name: "Rome", tripEndDate: day } });
      expect(res.statusCode).toBe(201);
    }
    expect(await findTripsDueForErasure()).toEqual([]);
  });

  it("destroys the freshly created key when the DB write fails (no orphaned key)", async () => {
    // tx() runs on pool.connect(); fail the trip INSERT inside it.
    const conn = vi.spyOn(pool, "connect").mockResolvedValueOnce({
      query: async (sql: string) => {
        if (sql.includes("INSERT INTO trip")) throw new Error("insert failed");
        return { rows: [], rowCount: 0 };
      },
      release() {},
    } as any);
    const res = await app.inject({
      method: "POST", url: "/api/trips", headers: asOwner,
      payload: { name: "Rome", tripEndDate: "2030-06-01" },
    });
    conn.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(keyCount()).toBe(0);
    expect(await count("trip")).toBe(0);
  });
});

describe("GET /api/trips and /api/trips/:id", () => {
  it("lists only trips the caller is a member of, with their role", async () => {
    const mine = await makeTrip(owner, { name: "Mine" });
    await makeTrip(await makeTeacher(), { name: "Theirs" });
    const res = await app.inject({ method: "GET", url: "/api/trips", headers: asOwner });
    expect(res.json().trips.map((t: any) => [t.id, t.role])).toEqual([[mine, "owner"]]);
  });

  it("returns a trip to a member and 404s for a non-member", async () => {
    const id = await makeTrip(owner, { name: "Mine" });
    const ok = await app.inject({ method: "GET", url: `/api/trips/${id}`, headers: asOwner });
    expect(ok.json().name).toBe("Mine");

    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    const no = await app.inject({ method: "GET", url: `/api/trips/${id}`, headers: stranger });
    expect(no.statusCode).toBe(404);
  });
});

describe("POST /api/trips/:id/advance", () => {
  it("advances one legal step and audits it", async () => {
    const id = await makeTrip(owner);
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/advance`, headers: asOwner, payload: { to: "challenge" } });
    expect(res.json()).toEqual({ ok: true, phase: "challenge" });
    expect(await phaseOf(id)).toBe("challenge");
    expect(await auditActions(id)).toContain("phase_challenge");
  });

  it("refuses skipping a phase with 409", async () => {
    const id = await makeTrip(owner);
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/advance`, headers: asOwner, payload: { to: "voting" } });
    expect(res.statusCode).toBe(409);
    expect(await phaseOf(id)).toBe("draft");
  });

  it("requires a target phase", async () => {
    const id = await makeTrip(owner);
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/advance`, headers: asOwner, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("404s for a non-member", async () => {
    const id = await makeTrip(await makeTeacher());
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/advance`, headers: asOwner, payload: { to: "challenge" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/trips/:id/erase", () => {
  it("erases the trip and destroys its key", async () => {
    const id = await makeTrip(owner, { phase: "voting" });
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/erase`, headers: asOwner });
    expect(res.json()).toEqual({ ok: true, erased: true });
    expect(await phaseOf(id)).toBe("erased");
    expect(hasKey(id)).toBe(false);
  });

  it("records the request before erasing", async () => {
    const id = await makeTrip(owner, { phase: "voting" });
    await app.inject({ method: "POST", url: `/api/trips/${id}/erase`, headers: asOwner });
    expect(await auditActions(id)).toEqual(["erasure_requested", "erasure_fired"]);
  });

  // #68: a failed "Erase now" used to be a bare 500 that nothing retried.
  it("on failure, leaves the trip due so the scheduler retries, and says so", async () => {
    const id = await makeTrip(owner, { phase: "voting" });
    s3faults.deleteFailures = 1;
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/erase`, headers: asOwner });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "erasure_pending", requestId: expect.any(String) });
    expect(res.json().message).toMatch(/relancé/i);
    expect(await phaseOf(id)).toBe("voting");
    expect(hasKey(id)).toBe(true);
    expect(await findTripsDueForErasure()).toContain(id);
    expect(await auditActions(id)).toEqual(["erasure_requested"]);
  });

  it("404s for a non-member and leaves the trip alone", async () => {
    const id = await makeTrip(await makeTeacher());
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/erase`, headers: asOwner });
    expect(res.statusCode).toBe(404);
    expect(hasKey(id)).toBe(true);
  });
});

describe("GET /api/trips/:id/results (reveal gating)", () => {
  const seedResult = (tripId: string) =>
    pool.query(
      `INSERT INTO result (trip_id, challenge_title, placement, team_name_vetted, points) VALUES ($1,'C1',1,'Foxes',5)`,
      [tripId],
    );

  it("is empty for an unknown trip", async () => {
    const res = await app.inject({ method: "GET", url: `/api/trips/00000000-0000-0000-0000-000000000000/results` });
    expect(res.json()).toEqual({ results: [] });
  });

  it("hides results from the public until the ceremony ends, but shows them to a trip teacher", async () => {
    const id = await makeTrip(owner, { phase: "reveal" });
    await seedResult(id);
    const anon = await app.inject({ method: "GET", url: `/api/trips/${id}/results` });
    expect(anon.json().results).toEqual([]);
    const teacher = await app.inject({ method: "GET", url: `/api/trips/${id}/results`, headers: asOwner });
    expect(teacher.json().results).toHaveLength(1);
  });

  it.each(["grace", "erased"])("publishes results in phase %s", async (phase) => {
    const id = await makeTrip(owner, { phase });
    await seedResult(id);
    const res = await app.inject({ method: "GET", url: `/api/trips/${id}/results` });
    expect(res.json().results[0].team_name_vetted).toBe("Foxes");
  });
});

// #166: the ceremony shows each podium's photo, on the projector only (owner decision): the
// trip's teachers get the link, nobody else, and it never survives Erasure.
describe("GET /api/trips/:id/results: podium photos (#166)", () => {
  /** A voted trip at the reveal: Foxes 1st, Owls 2nd on "Boss"; Foxes is Grand Champion. */
  async function revealed() {
    const trip = await makeTrip(owner, { phase: "voting" });
    const boss = await makeChallenge(trip, { title: "Boss" });
    const entry = async (team: string, wilson: number) => {
      const s = await makeStudent(trip);
      const teamId = await makeTeam(trip, team, [s.id]);
      const sub = await makeSubmission(trip, boss, teamId, s.id);
      await setStats(trip, await makeNomination(trip, boss, teamId, sub), wilson);
      return sub;
    };
    const foxes = await entry("Foxes", 0.8);
    const owls = await entry("Owls", 0.5);
    await advanceTrip(trip, "reveal");
    return { trip, foxes, owls };
  }
  const read = async (trip: string, headers?: { cookie: string }) =>
    (await app.inject({ method: "GET", url: `/api/trips/${trip}/results`, headers })).json().results as
      { team_name_vetted: string; is_grand_champion: boolean; photo_id: string | null }[];
  const photos = (rows: Awaited<ReturnType<typeof read>>) =>
    rows.map((r) => [r.is_grand_champion ? "champion" : r.team_name_vetted, r.photo_id]);

  it("gives the trip's teachers each podium photo, and the grand champion their best-placed one", async () => {
    const { trip, foxes, owls } = await revealed();
    expect(photos(await read(trip, asOwner))).toEqual([["champion", foxes], ["Foxes", foxes], ["Owls", owls]]);
  });

  it("gives no photo to anyone else: the public (students included), another school's teacher", async () => {
    const { trip } = await revealed();
    await advanceTrip(trip, "grace"); // results published
    const stranger = { cookie: teacherCookie(app, await makeTeacher()) };
    for (const rows of [await read(trip), await read(trip, stranger)]) {
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.photo_id === null)).toBe(true);
    }
  });

  it("never shows a photo a teacher removed", async () => {
    const { trip, owls } = await revealed();
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [owls, owner]);
    expect(photos(await read(trip, asOwner))).toContainEqual(["Owls", null]);
  });

  it("keeps no link to the photos after Erasure", async () => {
    const { trip } = await revealed();
    await app.inject({ method: "POST", url: `/api/trips/${trip}/erase`, headers: asOwner });
    expect(await count("result", "trip_id = $1", [trip])).toBe(3);
    expect(await count("result", "trip_id = $1 AND submission_id IS NOT NULL", [trip])).toBe(0);
    expect((await read(trip, asOwner)).every((r) => r.photo_id === null)).toBe(true);
  });
});

describe("POST /api/trips/:id/grand-champion (tie-break)", () => {
  const champ = async (tripId: string, team: string) =>
    (await pool.query<{ id: string }>(
      `INSERT INTO result (trip_id, challenge_title, placement, team_name_vetted, points, is_grand_champion)
       VALUES ($1,'Grand Champion',0,$2,10,true) RETURNING id`,
      [tripId, team],
    )).rows[0]!.id;

  it("only works during the reveal", async () => {
    const id = await makeTrip(owner, { phase: "voting" });
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/grand-champion`, headers: asOwner, payload: { resultId: "x" } });
    expect(res.statusCode).toBe(409);
  });

  it("requires a resultId", async () => {
    const id = await makeTrip(owner, { phase: "reveal" });
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/grand-champion`, headers: asOwner, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a result that isn't a co-champion of this trip", async () => {
    const id = await makeTrip(owner, { phase: "reveal" });
    const other = await makeTrip(owner, { phase: "reveal" });
    const foreign = await champ(other, "Elsewhere");
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/grand-champion`, headers: asOwner, payload: { resultId: foreign } });
    expect(res.statusCode).toBe(404);
  });

  it("keeps the chosen co-champion and drops the others", async () => {
    const id = await makeTrip(owner, { phase: "reveal" });
    const a = await champ(id, "Foxes");
    await champ(id, "Owls");
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/grand-champion`, headers: asOwner, payload: { resultId: a } });
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await pool.query(`SELECT team_name_vetted FROM result WHERE trip_id = $1 AND is_grand_champion`, [id]);
    expect(rows).toEqual([{ team_name_vetted: "Foxes" }]);
    expect(await auditActions(id)).toContain("grand_champion_set");
  });

  it("404s for a non-member", async () => {
    const id = await makeTrip(await makeTeacher(), { phase: "reveal" });
    const res = await app.inject({ method: "POST", url: `/api/trips/${id}/grand-champion`, headers: asOwner, payload: { resultId: "x" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/trips/:id (phase-gated config edits)", () => {
  const patch = (id: string, payload: unknown) =>
    app.inject({ method: "PATCH", url: `/api/trips/${id}`, headers: asOwner, payload: payload as object });

  it("edits fields and audits", async () => {
    const id = await makeTrip(owner);
    const res = await patch(id, { name: "Renamed", maxTeamSize: 6, graceDays: 3 });
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await pool.query(`SELECT name, max_team_size, grace_days FROM trip WHERE id = $1`, [id]);
    expect(rows[0]).toEqual({ name: "Renamed", max_team_size: 6, grace_days: 3 });
    expect(await auditActions(id)).toContain("trip_config_edited");
  });

  it("recomputes hard_erase_at when the end date or retention moves", async () => {
    const id = await makeTrip(owner);
    await patch(id, { maxRetentionDays: 5 });
    const { rows } = await pool.query<{ hard_erase_at: Date }>(`SELECT hard_erase_at FROM trip WHERE id = $1`, [id]);
    expect(rows[0]!.hard_erase_at.toISOString().slice(0, 10)).toBe("2030-01-06");
  });

  it("moves the planned dates, and the erase deadline with the end date", async () => {
    const id = await makeTrip(owner);
    const at = (d: string) => new Date(`${d}T08:00:00.000Z`).toISOString();
    const res = await patch(id, {
      challengeOpensAt: at("2029-12-20"), votingOpensAt: at("2029-12-28"), votingClosesAt: at("2029-12-30"),
      tripEndDate: at("2030-02-01"),
    });
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await pool.query<Record<string, Date> & { max_retention_days: number }>(
      `SELECT challenge_opens_at, voting_opens_at, voting_closes_at, trip_end_date, hard_erase_at, max_retention_days
         FROM trip WHERE id = $1`, [id]);
    const t = rows[0]!;
    expect([t.challenge_opens_at, t.voting_opens_at, t.voting_closes_at].map((d) => d.toISOString()))
      .toEqual([at("2029-12-20"), at("2029-12-28"), at("2029-12-30")]);
    const erase = new Date(at("2030-02-01"));
    erase.setDate(erase.getDate() + t.max_retention_days);
    expect(t.hard_erase_at.toISOString().slice(0, 10)).toBe(erase.toISOString().slice(0, 10));
  });

  // Editing the end date (or the retention) could pull hard_erase_at into the past: an
  // immediate erasure of a trip full of photos, without the "Effacer maintenant" confirmation.
  describe("never brings the erasure within 24 hours", () => {
    const soon = { error: "erasure_too_soon" };

    it("refuses an end date that puts the erasure in the past, and changes nothing", async () => {
      const id = await makeTrip(owner, { phase: "challenge" });
      const res = await patch(id, { tripEndDate: daysFromNow(-60), name: "Renamed" });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject(soon);
      expect(res.json().message).toContain("Effacer maintenant");
      expect((await eraseAt(id)).toISOString()).toBe("2030-02-01T00:00:00.000Z");
      expect(await findTripsDueForErasure()).toEqual([]);
      expect(await auditActions(id)).not.toContain("trip_config_edited");
    });

    it("refuses a shorter retention that makes the erasure due", async () => {
      const id = await makeTrip(owner, { phase: "voting" });
      await pool.query(`UPDATE trip SET trip_end_date = $2, hard_erase_at = $3 WHERE id = $1`, [id, daysFromNow(-10), daysFromNow(20)]);
      const res = await patch(id, { maxRetentionDays: 5 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject(soon);
    });

    it("refuses an erasure less than a day away", async () => {
      const id = await makeTrip(owner);
      await pool.query(`UPDATE trip SET trip_end_date = $2 WHERE id = $1`, [id, daysFromNow(-5)]);
      expect((await patch(id, { maxRetentionDays: 5 })).statusCode).toBe(400); // erasure today, at midnight
    });

    it("allows an earlier erasure more than a day away", async () => {
      const id = await makeTrip(owner);
      expect((await patch(id, { tripEndDate: daysFromNow(3), maxRetentionDays: 1 })).statusCode).toBe(200);
      expect((await eraseAt(id)).toISOString().slice(0, 10)).toBe(daysFromNow(4));
    });

    it("always allows putting a close erasure further off, and edits that don't move it", async () => {
      const id = await makeTrip(owner, { phase: "grace" });
      const inTwelveHours = new Date(Date.now() + 12 * 3600_000);
      await pool.query(`UPDATE trip SET trip_end_date = $2, max_retention_days = 30, hard_erase_at = $3 WHERE id = $1`,
        [id, daysFromNow(-30), inTwelveHours]);
      expect((await patch(id, { name: "Still here" })).statusCode).toBe(200);
      expect((await patch(id, { maxRetentionDays: 60 })).statusCode).toBe(200);
      expect((await eraseAt(id)).toISOString().slice(0, 10)).toBe(daysFromNow(30));
    });
  });

  it("locks maxTeamSize after draft and points after voting", async () => {
    const challenge = await makeTrip(owner, { phase: "challenge" });
    expect((await patch(challenge, { maxTeamSize: 2 })).statusCode).toBe(409);
    expect((await patch(challenge, { pointsTable: [{ placement: 1, points: 9 }] })).statusCode).toBe(200);

    const reveal = await makeTrip(owner, { phase: "reveal" });
    const res = await patch(reveal, { pointsTable: [{ placement: 1, points: 9 }], name: "ok" });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain("pointsTable");
  });

  it("refuses edits on an erased trip", async () => {
    const id = await makeTrip(owner, { phase: "erased" });
    expect((await patch(id, { name: "x" })).statusCode).toBe(409);
  });

  it("accepts an empty patch as a no-op", async () => {
    const id = await makeTrip(owner);
    expect((await patch(id, {})).json()).toEqual({ ok: true });
    expect(await auditActions(id)).not.toContain("trip_config_edited");
  });

  it("rejects an invalid body and non-members", async () => {
    const id = await makeTrip(owner);
    expect((await patch(id, { maxTeamSize: 0 })).statusCode).toBe(400);
    const theirs = await makeTrip(await makeTeacher());
    expect((await patch(theirs, { name: "x" })).statusCode).toBe(404);
  });
});
