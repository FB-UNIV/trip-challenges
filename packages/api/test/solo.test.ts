// #79: teams are optional. A student who never joined one can still play once teams lock:
// play solo (a team of one), upload, nominate, and be ranked like anyone else.
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));
vi.mock("../src/security/avscan.js", () => ({ avScanEnabled: () => false, scanBuffer: async () => ({ clean: true }) }));

import sharp from "sharp";
import { teamRoutes } from "../src/routes/teams.js";
import { submissionRoutes } from "../src/routes/submissions.js";
import { nominationRoutes } from "../src/routes/nominations.js";
import { advanceTrip } from "../src/lifecycle.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination, setStats,
} from "./support/harness.js";

const app = await buildApp(
  [teamRoutes, "/api/teams"], [submissionRoutes, "/api/submissions"], [nominationRoutes, "/api/nominations"],
);
const photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a7" } }).png().toBuffer();

function upload(cookie: string, challengeId: string) {
  const boundary = "----solo";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`;
  return app.inject({
    method: "POST", url: `/api/submissions?challengeId=${challengeId}`,
    payload: Buffer.concat([Buffer.from(head), photo, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie },
  });
}

let owner: string, trip: string, ch: string;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
  trip = await makeTrip(owner, { phase: "challenge" });
  ch = await makeChallenge(trip, { title: "Gelato" });
});

describe("playing solo", () => {
  it("a student without a team plays solo, uploads, nominates and is ranked", async () => {
    const solo = await makeStudent(trip);
    expect((await upload(solo.cookie, ch)).json().error).toBe("no_team"); // the team of one comes first

    const created = await app.inject({ method: "POST", url: "/api/teams", headers: { cookie: solo.cookie }, payload: { name: "Lone wolf" } });
    expect(created.statusCode).toBe(201);
    const { teamId } = created.json();

    const up = await upload(solo.cookie, ch);
    expect(up.statusCode).toBe(201);
    const nominated = await app.inject({
      method: "POST", url: "/api/nominations", headers: { cookie: solo.cookie },
      payload: { challengeId: ch, submissionId: up.json().id },
    });
    expect(nominated.statusCode).toBe(201);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM nomination WHERE team_id = $1 AND active`, [teamId]);
    const mine = rows[0]!.id;
    const approve = await app.inject({ method: "POST", url: `/api/nominations/${mine}/approve`, headers: { cookie: teacherCookie(app, owner) } });
    expect(approve.statusCode).toBe(200);

    // Two ordinary teams, so duels are possible (CONTEXT: Duel needs 3 entrants).
    const others: string[] = [];
    for (const name of ["Foxes", "Owls"]) {
      const s = await makeStudent(trip);
      const team = await makeTeam(trip, name, [s.id]);
      others.push(await makeNomination(trip, ch, team, await makeSubmission(trip, ch, team, s.id), "approved"));
    }
    await advanceTrip(trip, "voting");
    await setStats(trip, mine, 0.9, 2, 2);
    await setStats(trip, others[0]!, 0.5, 1, 2);
    await setStats(trip, others[1]!, 0.1, 0, 2);
    await advanceTrip(trip, "reveal");

    const ranked = await pool.query<{ placement: number; team_name_vetted: string }>(
      `SELECT placement, team_name_vetted FROM result
        WHERE trip_id = $1 AND challenge_title = 'Gelato' ORDER BY placement`,
      [trip],
    );
    expect(ranked.rows).toEqual([
      { placement: 1, team_name_vetted: "Lone wolf" },
      { placement: 2, team_name_vetted: "Foxes" },
      { placement: 3, team_name_vetted: "Owls" },
    ]);
  });
});
