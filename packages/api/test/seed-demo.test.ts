import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { seedDemo, eraseDemo, DEMO_PREFIX } from "../src/demo/seed.js";
import { run } from "../src/scripts/seed-demo.js";
import { studentAuthRoutes } from "../src/routes/student-auth.js";
import { duelRoutes } from "../src/routes/duels.js";
import { openBlob } from "../src/crypto/envelope.js";
import { getBlob } from "./support/fake-s3.js";
import { hasKey } from "./support/fake-vault.js";
import { sent } from "./support/fake-mailer.js";
import { pool, resetAll, buildApp, makeTeacher, makeTrip } from "./support/harness.js";

// Small sizes keep the suite fast; the defaults are bigger.
const SMALL = { teams: 3, studentsPerTeam: 2, joinLinks: 2, photosPerTeam: 1, votesPerStudent: 2 };
const BASE = "http://app.test";

const app = await buildApp([studentAuthRoutes, "/api/student"], [duelRoutes, "/api/duels"]);

let teacher: string;
beforeEach(async () => {
  await resetAll();
  teacher = await makeTeacher("staging-teacher@school.test");
});

const trips = async () =>
  (await pool.query<{ id: string; name: string; phase: string }>(
    `SELECT t.id, t.name, t.phase FROM trip t JOIN trip_teacher tt ON tt.trip_id = t.id
      WHERE tt.teacher_id = $1 AND tt.role = 'owner' ORDER BY t.created_at`, [teacher],
  )).rows;

/** Redeem a printed join link like a phone would; returns the session cookie. */
async function redeem(url: string): Promise<string> {
  const code = decodeURIComponent(new URL(url).searchParams.get("code")!);
  const res = await app.inject({ method: "POST", url: "/api/student/redeem", payload: { code } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "student_session")!;
  return `student_session=${cookie.value}`;
}

describe("seedDemo", () => {
  it("creates a draft, a voting and a reveal trip owned by the given teacher (email matched case-insensitively)", { timeout: 120_000 }, async () => {
    const report = await seedDemo({ teacherEmail: "Staging-Teacher@School.test", ...SMALL });
    expect((await trips()).map((t) => [t.name.startsWith(DEMO_PREFIX), t.phase])).toEqual([
      [true, "draft"], [true, "voting"], [true, "reveal"],
    ]);
    expect(report.trips.map((t) => t.phase)).toEqual(["draft", "voting", "reveal"]);
    for (const t of report.trips) {
      expect(t.adminUrl).toBe(`${BASE}/teacher/trips/${t.id}`);
      expect(t.joinLinks).toHaveLength(SMALL.joinLinks);
    }
    expect(report.trips[2]!.ceremonyUrl).toBe(`${BASE}/ceremony/${report.trips[2]!.id}`);
    expect(sent).toEqual([]); // demo students never get real emails
  });

  it("prints join links that redeem through the real route (draft trip: no team yet)", { timeout: 120_000 }, async () => {
    const report = await seedDemo({ teacherEmail: "staging-teacher@school.test", ...SMALL });
    const draft = report.trips[0]!;
    const cookie = await redeem(draft.joinLinks[0]!);
    const me = await app.inject({ method: "GET", url: "/api/student/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ tripId: draft.id, phase: "draft", teamId: null });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM challenge WHERE trip_id = $1`, [draft.id]);
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it("leaves the voting trip ready to vote: a fresh student gets a duel pair", { timeout: 120_000 }, async () => {
    const report = await seedDemo({ teacherEmail: "staging-teacher@school.test", ...SMALL });
    const voting = report.trips[1]!;
    const cookie = await redeem(voting.joinLinks[0]!);
    const { rows: ch } = await pool.query<{ id: string }>(`SELECT id FROM challenge WHERE trip_id = $1`, [voting.id]);
    const next = await app.inject({ method: "GET", url: `/api/duels/next?challengeId=${ch[0]!.id}`, headers: { cookie } });
    expect(next.json().pair).toMatchObject({ challengeId: ch[0]!.id });

    const { rows } = await pool.query<{ teams: number }>(
      `SELECT count(DISTINCT team_id)::int AS teams FROM nomination
        WHERE trip_id = $1 AND active AND state = 'approved'`, [voting.id],
    );
    expect(rows[0]!.teams).toBe(SMALL.teams);
  });

  it("uploads real, encrypted photos (JPEG once opened with the trip key)", { timeout: 120_000 }, async () => {
    const report = await seedDemo({ teacherEmail: "staging-teacher@school.test", ...SMALL });
    const { rows } = await pool.query<{ blob_key: string }>(
      `SELECT blob_key FROM submission WHERE trip_id = $1 LIMIT 1`, [report.trips[1]!.id],
    );
    const sealed = await getBlob(rows[0]!.blob_key);
    expect(sealed.subarray(0, 2)).not.toEqual(Buffer.from([0xff, 0xd8]));
    expect((await openBlob(report.trips[1]!.id, sealed)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("brings the reveal trip through real voting to computed results", { timeout: 120_000 }, async () => {
    const report = await seedDemo({ teacherEmail: "staging-teacher@school.test", ...SMALL });
    const reveal = report.trips[2]!;
    const { rows: duels } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM duel WHERE trip_id = $1`, [reveal.id]);
    expect(duels[0]!.n).toBeGreaterThan(0);
    const { rows: results } = await pool.query<{ champ: boolean }>(
      `SELECT is_grand_champion AS champ FROM result WHERE trip_id = $1`, [reveal.id],
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.champ)).toBe(true);
  });

  it("refuses a teacher who has never signed in", async () => {
    await expect(seedDemo({ teacherEmail: "nobody@school.test", ...SMALL })).rejects.toThrow(/sign in once/);
    expect(await trips()).toEqual([]);
  });
});

describe("eraseDemo", () => {
  it("erases every demo trip through the real erasure path, and nothing else", { timeout: 120_000 }, async () => {
    const real = await makeTrip(teacher, { name: "Rome 2030" });
    const report = await seedDemo({ teacherEmail: "staging-teacher@school.test", ...SMALL });
    const erased = await eraseDemo();
    expect([...erased].sort()).toEqual(report.trips.map((t) => t.id).sort());

    for (const t of report.trips) {
      const { rows } = await pool.query(`SELECT phase FROM trip WHERE id = $1`, [t.id]);
      expect(rows[0]).toEqual({ phase: "erased" });
      expect(hasKey(t.id)).toBe(false);
    }
    const { rows: students } = await pool.query(`SELECT count(*)::int AS n FROM student WHERE trip_id <> $1`, [real]);
    expect(students[0]).toEqual({ n: 0 });
    expect((await pool.query(`SELECT phase FROM trip WHERE id = $1`, [real])).rows[0]).toEqual({ phase: "draft" });
    expect(await eraseDemo()).toEqual([]); // already erased: nothing left to do
  });
});

describe("seed-demo CLI", () => {
  const out = () => {
    const lines: string[] = [];
    return { lines, log: (s: string) => { lines.push(s); } };
  };

  it("refuses to run without SEED_DEMO=staging", async () => {
    const o = out();
    expect(await run(["--teacher", "staging-teacher@school.test"], {}, o.log)).toBe(1);
    expect(o.lines.join("\n")).toMatch(/SEED_DEMO=staging/);
    expect(await trips()).toEqual([]);
  });

  it("needs --teacher (or --erase)", async () => {
    const o = out();
    expect(await run([], { SEED_DEMO: "staging" }, o.log)).toBe(1);
    expect(o.lines.join("\n")).toMatch(/--teacher <email>/);
  });

  it("seeds and prints where to go and the join links", { timeout: 120_000 }, async () => {
    const o = out();
    expect(await run(["--teacher", "staging-teacher@school.test", "--small"], { SEED_DEMO: "staging" }, o.log)).toBe(0);
    const text = o.lines.join("\n");
    expect(text).toMatch(/\[DEMO\].*draft/);
    expect(text).toContain(`${BASE}/teacher/trips/`);
    expect(text).toContain(`${BASE}/join?code=`);
    expect(text).toContain(`${BASE}/ceremony/`);
  });

  it("reports a failure (e.g. unknown teacher) with exit code 1", async () => {
    const o = out();
    expect(await run(["--teacher", "nobody@school.test"], { SEED_DEMO: "staging" }, o.log)).toBe(1);
    expect(o.lines.join("\n")).toMatch(/sign in once/);
  });

  it("--erase erases the demo trips", { timeout: 120_000 }, async () => {
    await seedDemo({ teacherEmail: "staging-teacher@school.test", ...SMALL });
    const o = out();
    expect(await run(["--erase"], { SEED_DEMO: "staging" }, o.log)).toBe(0);
    expect(o.lines.join("\n")).toMatch(/Erased 3 demo trip/);
    expect((await trips()).every((t) => t.phase === "erased")).toBe(true);
  });
});
