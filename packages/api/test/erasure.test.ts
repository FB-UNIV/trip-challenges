import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { eraseTrip, findTripsDueForErasure, warnUpcomingErasures } from "../src/erasure.js";
import { decrypt, hasKey, faults } from "./support/fake-vault.js";
import { objects } from "./support/fake-s3.js";
import { sent, mailer } from "./support/fake-mailer.js";
import {
  pool, resetAll, makeTeacher, makeTrip, addCoTeacher, makeStudent, makeTeam, makeChallenge,
  makeSubmission, makeNomination, setStats, count, auditActions,
} from "./support/harness.js";

let owner: string;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher("owner@school.test");
});

/** A trip with one of everything erasure must destroy. */
async function populatedTrip() {
  const trip = await makeTrip(owner, { phase: "grace" });
  const ch = await makeChallenge(trip);
  const [a, b, c] = [await makeStudent(trip), await makeStudent(trip), await makeStudent(trip)];
  const teamA = await makeTeam(trip, "A", [a.id]);
  const teamB = await makeTeam(trip, "B", [b.id]);
  const subA = await makeSubmission(trip, ch, teamA, a.id);
  const subB = await makeSubmission(trip, ch, teamB, b.id);
  const nomA = await makeNomination(trip, ch, teamA, subA);
  const nomB = await makeNomination(trip, ch, teamB, subB);
  await setStats(trip, nomA, 0.2, 1, 1);
  const [lo, hi] = [nomA, nomB].sort();
  await pool.query(
    `INSERT INTO duel (trip_id, challenge_id, voter_student_id, a_nomination_id, b_nomination_id,
                       winner_nomination_id, low_nomination_id, high_nomination_id)
     VALUES ($1,$2,$3,$4,$5,$4,$6,$7)`,
    [trip, ch, c.id, nomA, nomB, lo, hi],
  );
  await pool.query(
    `INSERT INTO trip_teacher_invite (trip_id, email, token_hash, expires_at) VALUES ($1,'co@school.test','h', now() + interval '1 day')`,
    [trip],
  );
  await pool.query(`INSERT INTO roster_import_item (trip_id, email_enc) VALUES ($1, 'x')`, [trip]);
  await pool.query(
    `INSERT INTO result (trip_id, challenge_title, placement, team_name_vetted, points) VALUES ($1,'C',1,'A',5)`,
    [trip],
  );
  const teamNameEnc = (await pool.query<{ name_enc: Buffer }>(`SELECT name_enc FROM team WHERE id = $1`, [teamA])).rows[0]!.name_enc;
  return { trip, teamNameEnc };
}

describe("eraseTrip", () => {
  it("destroys every student-scoped row, blob and the key; results + audit survive", async () => {
    const { trip, teamNameEnc } = await populatedTrip();
    const bystander = (await populatedTrip()).trip;

    await eraseTrip(trip);

    for (const t of ["duel", "nomination_stats", "nomination", "submission", "team_member", "team",
                     "student", "roster_import_item", "trip_teacher_invite", "challenge"]) {
      expect(await count(t, "trip_id = $1", [trip]), t).toBe(0);
    }
    expect(await count("student_session")).toBe(3); // only the bystander trip's sessions remain
    expect([...objects.keys()].some((k) => k.startsWith(`${trip}/`))).toBe(false);
    expect(hasKey(trip)).toBe(false);
    // Residual ciphertext (e.g. in a backup) is now unreadable.
    await expect(decrypt(trip, teamNameEnc.toString("utf8"))).rejects.toThrow();

    expect((await pool.query(`SELECT phase FROM trip WHERE id = $1`, [trip])).rows[0]).toEqual({ phase: "erased" });
    expect(await count("result", "trip_id = $1", [trip])).toBe(1);
    expect(await auditActions(trip)).toContain("erasure_fired");

    // The other trip is untouched.
    expect(hasKey(bystander)).toBe(true);
    expect(await count("submission", "trip_id = $1", [bystander])).toBe(2);
  });
});

describe("eraseTrip is resumable (#24)", () => {
  // Crypto-erasure is only real once the Vault key is gone. If the key step fails, the
  // trip must stay due so the next scheduler tick finishes it, never marked 'erased'.
  it("leaves the trip due when destroying the key fails, and a rerun completes it", async () => {
    const { trip } = await populatedTrip();
    faults.destroyKeyFailures = 1;

    await expect(eraseTrip(trip)).rejects.toThrow(/sealed/);
    expect(hasKey(trip)).toBe(true);
    expect((await pool.query(`SELECT phase FROM trip WHERE id = $1`, [trip])).rows[0]).toEqual({ phase: "grace" });
    expect(await findTripsDueForErasure(new Date("2100-01-01"))).toContain(trip);
    expect(await auditActions(trip)).not.toContain("erasure_fired");

    await eraseTrip(trip); // next tick
    expect(hasKey(trip)).toBe(false);
    expect((await pool.query(`SELECT phase FROM trip WHERE id = $1`, [trip])).rows[0]).toEqual({ phase: "erased" });
    expect((await auditActions(trip)).filter((a) => a === "erasure_fired")).toHaveLength(1);
  });
});

describe("findTripsDueForErasure", () => {
  const now = new Date("2030-03-01T12:00:00Z");
  const day = 86_400_000;

  it("selects trips past the hard deadline in any live phase, and grace windows that elapsed", async () => {
    const later = new Date(now.getTime() + 90 * day); // hard deadline not reached
    const hardPassed = await makeTrip(owner, { phase: "challenge", hardEraseAt: new Date(now.getTime() - 1) });
    const graceDone = await makeTrip(owner, {
      phase: "grace", graceDays: 2, votingClosesAt: new Date(now.getTime() - 3 * day), hardEraseAt: later,
    });
    // Not due: grace still running; grace math ignored outside phase 'grace'; already erased.
    await makeTrip(owner, { phase: "grace", graceDays: 7, votingClosesAt: new Date(now.getTime() - 3 * day), hardEraseAt: later });
    await makeTrip(owner, { phase: "voting", graceDays: 0, votingClosesAt: new Date(now.getTime() - 3 * day), hardEraseAt: later });
    await makeTrip(owner, { phase: "erased", hardEraseAt: new Date(now.getTime() - day) });

    expect((await findTripsDueForErasure(now)).sort()).toEqual([hardPassed, graceDone].sort());
  });
});

describe("warnUpcomingErasures", () => {
  const now = new Date("2030-03-01T12:00:00Z");
  const H = 3_600_000;

  it("warns owner and co-teachers once per bracket, at the effective (earliest) deadline", async () => {
    const co = await makeTeacher("co@school.test");
    const trip = await makeTrip(owner, {
      phase: "grace", graceDays: 0,
      votingClosesAt: new Date(now.getTime() + 2 * H), // grace deadline in 2h → "1d" bracket
      hardEraseAt: new Date(now.getTime() + 30 * 24 * H),
    });
    await addCoTeacher(trip, co);

    await warnUpcomingErasures(now);
    expect(sent.map((m) => [m.kind, m.to]).sort()).toEqual([
      ["erasure_warning", "co@school.test"],
      ["erasure_warning", "owner@school.test"],
    ]);
    expect((sent[0]!.args[1] as Date).toISOString()).toBe(new Date(now.getTime() + 2 * H).toISOString());

    await warnUpcomingErasures(now); // next tick: already claimed
    expect(sent).toHaveLength(2);
    expect((await pool.query(`SELECT bracket FROM erasure_warning WHERE trip_id = $1`, [trip])).rows).toEqual([{ bracket: "1d" }]);
  });

  it("ignores drafts and deadlines more than 7 days out", async () => {
    await makeTrip(owner, { phase: "draft", hardEraseAt: new Date(now.getTime() + H) });
    await makeTrip(owner, { phase: "challenge", hardEraseAt: new Date(now.getTime() + 8 * 24 * H) });
    await warnUpcomingErasures(now);
    expect(sent).toHaveLength(0);
  });

  it("keeps going when a mail fails (and does not re-send next tick)", async () => {
    const trip = await makeTrip(owner, { phase: "voting", hardEraseAt: new Date(now.getTime() + 30 * 60_000) });
    mailer.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(warnUpcomingErasures(now)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining(trip), expect.anything());
    err.mockRestore();
    expect(await count("erasure_warning", "trip_id = $1 AND bracket = '1h'", [trip])).toBe(1);
  });
});
