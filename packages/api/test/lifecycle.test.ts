import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { advanceTrip, computeResults, autoAdvanceDue } from "../src/lifecycle.js";
import {
  pool, resetAll, makeTeacher, makeTrip, makeStudent, makeTeam, makeChallenge,
  makeSubmission, makeNomination, setStats, count,
} from "./support/harness.js";

let owner: string;
beforeEach(async () => {
  await resetAll();
  owner = await makeTeacher();
});

type Row = { challenge_title: string; placement: number; team_name_vetted: string; points: string; is_grand_champion: boolean };
const results = async (tripId: string) =>
  (await pool.query<Row>(
    `SELECT challenge_title, placement, team_name_vetted, points, is_grand_champion
       FROM result WHERE trip_id = $1 ORDER BY is_grand_champion, challenge_title, placement, team_name_vetted`,
    [tripId],
  )).rows.map((r) => ({ ...r, points: Number(r.points) }));

describe("advanceTrip", () => {
  it("throws for an unknown trip", async () => {
    await expect(advanceTrip("00000000-0000-0000-0000-000000000000", "challenge")).rejects.toThrow("no such trip");
  });

  it("flags illegal transitions", async () => {
    const trip = await makeTrip(owner, { phase: "grace" });
    await expect(advanceTrip(trip, "erased")).rejects.toMatchObject({ illegal: true });
  });

  // #81 (owner decision): a teacher's reject sticks; opening voting doesn't bring the team back.
  it("doesn't auto-nominate for a team whose entry was rejected", async () => {
    const trip = await makeTrip(owner, { phase: "challenge" });
    const ch = await makeChallenge(trip);
    const a = await makeStudent(trip);
    const team = await makeTeam(trip, "A", [a.id]);
    const sub = await makeSubmission(trip, ch, team, a.id);
    await makeSubmission(trip, ch, team, a.id); // another photo it could fall back to
    const nom = await makeNomination(trip, ch, team, sub, "pending");
    await pool.query(`UPDATE nomination SET state = 'rejected', active = false WHERE id = $1`, [nom]);

    await advanceTrip(trip, "voting");
    expect(await count("nomination", "trip_id = $1 AND active", [trip])).toBe(0);
  });

  it("auto-nominates each team's latest submission when voting opens", async () => {
    const trip = await makeTrip(owner, { phase: "challenge" });
    const ch = await makeChallenge(trip);
    const a = await makeStudent(trip);
    const b = await makeStudent(trip);
    const teamA = await makeTeam(trip, "A", [a.id]);
    const teamB = await makeTeam(trip, "B", [b.id]);

    await makeSubmission(trip, ch, teamA, a.id, { createdAt: new Date("2030-01-01T10:00:00Z") });
    const latestA = await makeSubmission(trip, ch, teamA, a.id, { createdAt: new Date("2030-01-01T11:00:00Z") });
    // A removed photo is never auto-nominated, even if it is the newest.
    const removed = await makeSubmission(trip, ch, teamA, a.id, { createdAt: new Date("2030-01-01T12:00:00Z") });
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [removed, owner]);
    // Team B already chose: its nomination must be left alone.
    const bOld = await makeSubmission(trip, ch, teamB, b.id, { createdAt: new Date("2030-01-01T09:00:00Z") });
    await makeSubmission(trip, ch, teamB, b.id, { createdAt: new Date("2030-01-01T13:00:00Z") });
    await makeNomination(trip, ch, teamB, bOld, "pending");

    await advanceTrip(trip, "voting");

    const { rows } = await pool.query<{ team_id: string; submission_id: string; state: string; auto_nominated: boolean }>(
      `SELECT team_id, submission_id, state, auto_nominated FROM nomination WHERE trip_id = $1 AND active ORDER BY auto_nominated`,
      [trip],
    );
    expect(rows).toEqual([
      { team_id: teamB, submission_id: bOld, state: "pending", auto_nominated: false },
      { team_id: teamA, submission_id: latestA, state: "pending", auto_nominated: true },
    ]);
    expect((await pool.query(`SELECT phase FROM trip WHERE id = $1`, [trip])).rows[0]).toEqual({ phase: "voting" });
  });
});

describe("phase transitions are atomic (#26)", () => {
  async function votingTripWithResults() {
    const trip = await makeTrip(owner, { phase: "voting" });
    const ch = await makeChallenge(trip, { title: "C" });
    for (const [team, w] of [["A", 0.9], ["B", 0.5], ["C", 0.1]] as const) {
      const s = await makeStudent(trip);
      const teamId = await makeTeam(trip, team, [s.id]);
      await setStats(trip, await makeNomination(trip, ch, teamId, await makeSubmission(trip, ch, teamId, s.id)), w);
    }
    return trip;
  }

  it("a failure while computing results leaves the trip in voting with no partial results", async () => {
    const trip = await votingTripWithResults();
    const vault = await import("./support/fake-vault.js");
    vault.resetVault(); // team names can't be decrypted -> computeResults throws midway

    await expect(advanceTrip(trip, "reveal")).rejects.toThrow();
    expect((await pool.query(`SELECT phase FROM trip WHERE id = $1`, [trip])).rows[0]).toEqual({ phase: "voting" });
    expect((await pool.query(`SELECT count(*)::int AS n FROM result WHERE trip_id = $1`, [trip])).rows[0]).toEqual({ n: 0 });
  });
});

describe("computeResults (via advance voting -> reveal)", () => {
  async function seed(tripId: string, challengeId: string, team: string, wilson: number, state: "approved" | "pending" = "approved") {
    const s = await makeStudent(tripId);
    const teamId = await makeTeam(tripId, team, [s.id]);
    const sub = await makeSubmission(tripId, challengeId, teamId, s.id);
    const nom = await makeNomination(tripId, challengeId, teamId, sub, state);
    await setStats(tripId, nom, wilson);
    return { teamId, sub };
  }

  it("ranks with shared placements, scales by multiplier, and flags tied grand champions", async () => {
    const trip = await makeTrip(owner, { phase: "voting" });
    const boss = await makeChallenge(trip, { title: "Boss", multiplier: 2 });
    const small = await makeChallenge(trip, { title: "Small", multiplier: 0.8 });

    // Boss: Foxes 1st; Owls and Bears tie for 2nd ("1224" ranking) → 10, 6, 6.
    await seed(trip, boss, "Foxes", 0.8);
    const owls = await seed(trip, boss, "Owls", 0.5);
    await seed(trip, boss, "Bears", 0.5);
    await seed(trip, boss, "Pending", 0.99, "pending"); // not approved → not ranked
    // Small: Owls 1st → 5 × 0.8 = 4, so Owls total 10 ties Foxes.
    const s = await makeSubmission(trip, small, owls.teamId, (await makeStudent(trip)).id);
    await setStats(trip, await makeNomination(trip, small, owls.teamId, s), 0.3);

    await advanceTrip(trip, "reveal");

    expect(await results(trip)).toEqual([
      { challenge_title: "Boss", placement: 1, team_name_vetted: "Foxes", points: 10, is_grand_champion: false },
      { challenge_title: "Boss", placement: 2, team_name_vetted: "Bears", points: 6, is_grand_champion: false },
      { challenge_title: "Boss", placement: 2, team_name_vetted: "Owls", points: 6, is_grand_champion: false },
      { challenge_title: "Small", placement: 1, team_name_vetted: "Owls", points: 4, is_grand_champion: false },
      { challenge_title: "Grand Champion", placement: 0, team_name_vetted: "Foxes", points: 10, is_grand_champion: true },
      { challenge_title: "Grand Champion", placement: 0, team_name_vetted: "Owls", points: 10, is_grand_champion: true },
    ]);
  });

  it("records each team's neutral label (trip-wide creation order) and whether its name was reviewed (#92)", async () => {
    const trip = await makeTrip(owner, { phase: "voting" });
    const ch = await makeChallenge(trip, { title: "Gelato" });
    const foxes = await seed(trip, ch, "Léa & Tom 4B", 0.8);
    const idle = await makeTeam(trip, "Idle"); // no entry, but still counts in the numbering
    const owls = await seed(trip, ch, "Les Owls", 0.5);
    const order = [foxes.teamId, idle, owls.teamId];
    for (const [i, id] of order.entries()) {
      await pool.query(`UPDATE team SET created_at = $2 WHERE id = $1`, [id, new Date(Date.UTC(2030, 0, 1, 0, i))]);
    }
    await pool.query(`UPDATE team SET name_reviewed = true WHERE id = $1`, [owls.teamId]);

    await advanceTrip(trip, "reveal");

    const { rows } = await pool.query(
      `SELECT challenge_title, team_name_vetted, team_label, team_name_reviewed
         FROM result WHERE trip_id = $1 ORDER BY is_grand_champion, placement`,
      [trip],
    );
    expect(rows).toEqual([
      { challenge_title: "Gelato", team_name_vetted: "Léa & Tom 4B", team_label: "Team 1", team_name_reviewed: false },
      { challenge_title: "Gelato", team_name_vetted: "Les Owls", team_label: "Team 3", team_name_reviewed: true },
      { challenge_title: "Grand Champion", team_name_vetted: "Léa & Tom 4B", team_label: "Team 1", team_name_reviewed: false },
    ]);
  });

  it("treats an unvoted challenge as an all-way tie for 1st", async () => {
    const trip = await makeTrip(owner, { phase: "voting" });
    const ch = await makeChallenge(trip, { title: "Quiet" });
    await seed(trip, ch, "A", 0);
    await seed(trip, ch, "B", 0);
    await computeResults(trip);
    const rows = (await results(trip)).filter((r) => !r.is_grand_champion);
    expect(rows.map((r) => [r.team_name_vetted, r.placement, r.points])).toEqual([["A", 1, 5], ["B", 1, 5]]);
  });

  it("names no grand champion when nobody scored", async () => {
    const trip = await makeTrip(owner, { phase: "voting", pointsTable: [] });
    const ch = await makeChallenge(trip);
    await seed(trip, ch, "A", 0.5);
    await computeResults(trip);
    expect((await results(trip)).some((r) => r.is_grand_champion)).toBe(false);
  });
});

describe("autoAdvanceDue (#26: auto-advance up to voting; the ceremony stays manual)", () => {
  const now = new Date("2030-03-01T12:00:00Z");
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 60_000);
  const phaseOf = async (id: string) =>
    (await pool.query<{ phase: string }>(`SELECT phase FROM trip WHERE id = $1`, [id])).rows[0]!.phase;

  it("opens the challenge period at challenge_opens_at", async () => {
    const trip = await makeTrip(owner, { phase: "draft", challengeOpensAt: past, votingOpensAt: future });
    await autoAdvanceDue(now);
    expect(await phaseOf(trip)).toBe("challenge");
  });

  it("opens voting at voting_opens_at, auto-nominating like a manual advance", async () => {
    const trip = await makeTrip(owner, { phase: "challenge", votingOpensAt: past });
    const ch = await makeChallenge(trip);
    const s = await makeStudent(trip);
    const team = await makeTeam(trip, "A", [s.id]);
    await makeSubmission(trip, ch, team, s.id);

    await autoAdvanceDue(now);
    expect(await phaseOf(trip)).toBe("voting");
    expect((await pool.query(`SELECT auto_nominated FROM nomination WHERE trip_id = $1`, [trip])).rows).toEqual([{ auto_nominated: true }]);
  });

  it("catches up both steps in one pass when both dates have passed", async () => {
    const trip = await makeTrip(owner, { phase: "draft", challengeOpensAt: past, votingOpensAt: past });
    await autoAdvanceDue(now);
    expect(await phaseOf(trip)).toBe("voting");
  });

  it("never starts the reveal: voting stays put after voting_closes_at", async () => {
    const trip = await makeTrip(owner, { phase: "voting", votingClosesAt: past });
    await autoAdvanceDue(now);
    expect(await phaseOf(trip)).toBe("voting");
  });

  it("leaves trips alone when dates are in the future or unset, and audits auto transitions", async () => {
    const later = await makeTrip(owner, { phase: "draft", challengeOpensAt: future });
    const unset = await makeTrip(owner, { phase: "challenge" });
    const due = await makeTrip(owner, { phase: "draft", challengeOpensAt: past });
    await autoAdvanceDue(now);
    expect(await phaseOf(later)).toBe("draft");
    expect(await phaseOf(unset)).toBe("challenge");
    const { rows } = await pool.query(`SELECT action, teacher_id FROM audit_log WHERE trip_id = $1`, [due]);
    expect(rows).toEqual([{ action: "phase_challenge", teacher_id: null }]);
  });
});
