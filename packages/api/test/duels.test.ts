import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

import { duelRoutes } from "../src/routes/duels.js";
import { wilsonLower } from "../src/lib/wilson.js";
import {
  pool, resetAll, buildApp, makeTeacher, makeTrip, makeStudent, makeTeam, makeChallenge,
  makeSubmission, makeNomination, type StudentFixture,
} from "./support/harness.js";

const app = await buildApp([duelRoutes, "/api/duels"]);

let trip: string, ch: string, voter: StudentFixture;
const noms: Record<string, string> = {};

/** A team with one member and an approved nomination for `challengeId`. */
async function contender(tripId: string, challengeId: string, name: string) {
  const s = await makeStudent(tripId);
  const team = await makeTeam(tripId, name, [s.id]);
  const nom = await makeNomination(tripId, challengeId, team, await makeSubmission(tripId, challengeId, team, s.id));
  return { s, team, nom };
}

beforeEach(async () => {
  await resetAll();
  trip = await makeTrip(await makeTeacher(), { phase: "voting" });
  ch = await makeChallenge(trip);
  const a = await contender(trip, ch, "A");
  voter = a.s;
  noms.A = a.nom;
  noms.B = (await contender(trip, ch, "B")).nom;
});

const next = (cookie: string, challengeId = ch) =>
  app.inject({ method: "GET", url: `/api/duels/next?challengeId=${challengeId}`, headers: { cookie } });
const cast = (cookie: string, pairToken: string, winnerNominationId: string) =>
  app.inject({ method: "POST", url: "/api/duels/cast", headers: { cookie }, payload: { pairToken, winnerNominationId } });
const stats = async (nom: string) =>
  (await pool.query(`SELECT wins, comparisons, wilson_score FROM nomination_stats WHERE nomination_id = $1`, [nom])).rows[0];

describe("GET /api/duels/next", () => {
  it("requires a session and a challengeId", async () => {
    expect((await app.inject({ method: "GET", url: "/api/duels/next?challengeId=x" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/duels/next", headers: { cookie: voter.cookie } })).statusCode).toBe(400);
  });

  it("needs two eligible nominations besides the voter's own team (2 teams → no pair)", async () => {
    expect((await next(voter.cookie)).json()).toEqual({ pair: null, reason: "not_enough" });
  });

  it("never shows the voter's own team, and signs the pair to the voter", async () => {
    noms.C = (await contender(trip, ch, "C")).nom;
    for (let i = 0; i < 5; i++) {
      const { pair } = (await next(voter.cookie)).json();
      expect([pair.aNominationId, pair.bNominationId].sort()).toEqual([noms.B, noms.C].sort());
      expect(pair.pairToken.startsWith(`${voter.id}:${ch}:`)).toBe(true);
    }
  });

  it("only offers approved, active nominations", async () => {
    noms.C = (await contender(trip, ch, "C")).nom;
    await pool.query(`UPDATE nomination SET state = 'pending' WHERE id = $1`, [noms.C]);
    expect((await next(voter.cookie)).json().reason).toBe("not_enough");
  });

  it("reports exhaustion once the voter has judged every pair", async () => {
    noms.C = (await contender(trip, ch, "C")).nom;
    const { pair } = (await next(voter.cookie)).json();
    await cast(voter.cookie, pair.pairToken, pair.aNominationId);
    expect((await next(voter.cookie)).json()).toEqual({ pair: null, reason: "exhausted" });
  });

  it("lets a team-less student vote on every team", async () => {
    const loner = await makeStudent(trip);
    const { pair } = (await next(loner.cookie)).json();
    expect([pair.aNominationId, pair.bNominationId].sort()).toEqual([noms.A, noms.B].sort());
  });

  // #16: a student of trip X must never be served trip Y's nominations.
  it("404s for a challenge outside the voter's trip", async () => {
    const outsider = await makeStudent(await makeTrip(await makeTeacher(), { phase: "voting" }));
    const res = await next(outsider.cookie);
    expect(res.statusCode).toBe(404);
    expect(res.json().pair).toBeUndefined();
  });

  // #17: duels only happen during the Voting Period.
  it.each(["challenge", "reveal"])("serves no pair while the trip is in %s", async (phase) => {
    noms.C = (await contender(trip, ch, "C")).nom;
    await pool.query(`UPDATE trip SET phase = $2 WHERE id = $1`, [trip, phase]);
    expect((await next(voter.cookie)).json()).toEqual({ pair: null, reason: "closed" });
  });
});

describe("voting closes at voting_closes_at (#26)", () => {
  beforeEach(async () => {
    noms.C = (await contender(trip, ch, "C")).nom;
  });

  it("serves no pair and refuses casts once the planned close time has passed", async () => {
    const { pair } = (await next(voter.cookie)).json();
    await pool.query(`UPDATE trip SET voting_closes_at = now() - interval '1 minute' WHERE id = $1`, [trip]);

    expect((await next(voter.cookie)).json()).toEqual({ pair: null, reason: "closed" });
    const res = await cast(voter.cookie, pair.pairToken, pair.aNominationId);
    expect(res.statusCode).toBe(409);
  });

  it("keeps voting open before the planned close time", async () => {
    await pool.query(`UPDATE trip SET voting_closes_at = now() + interval '1 hour' WHERE id = $1`, [trip]);
    expect((await next(voter.cookie)).json().pair).not.toBeNull();
  });
});

describe("POST /api/duels/cast — trip and phase checks (#16, #17)", () => {
  beforeEach(async () => {
    noms.C = (await contender(trip, ch, "C")).nom;
  });

  it("refuses a vote once voting has closed, even with a token served during voting", async () => {
    const { pair } = (await next(voter.cookie)).json();
    await pool.query(`UPDATE trip SET phase = 'reveal' WHERE id = $1`, [trip]);
    const res = await cast(voter.cookie, pair.pairToken, pair.aNominationId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("closed");
    expect((await pool.query(`SELECT count(*)::int AS n FROM duel`)).rows[0]).toEqual({ n: 0 });
  });

  it("refuses a validly signed token for another trip's challenge", async () => {
    // Defence in depth: even a correctly signed pair can't move votes across trips.
    const { signPair } = await import("../src/lib/pairToken.js");
    const { config } = await import("./support/config.js");
    const outsider = await makeStudent(await makeTrip(await makeTeacher(), { phase: "voting" }));
    const token = signPair(config.SESSION_SECRET, outsider.id, ch, noms.B!, noms.C!);
    const res = await cast(outsider.cookie, token, noms.B!);
    expect(res.statusCode).toBe(404);
    expect((await pool.query(`SELECT count(*)::int AS n FROM duel`)).rows[0]).toEqual({ n: 0 });
  });
});

describe("POST /api/duels/cast", () => {
  beforeEach(async () => {
    noms.C = (await contender(trip, ch, "C")).nom;
  });

  it("records the duel and updates win/loss + Wilson score for both sides", async () => {
    const { pair } = (await next(voter.cookie)).json();
    const winner = pair.aNominationId;
    const loser = pair.bNominationId;
    expect((await cast(voter.cookie, pair.pairToken, winner)).json()).toEqual({ ok: true });

    expect(await stats(winner)).toEqual({ wins: 1, comparisons: 1, wilson_score: wilsonLower(1, 1) });
    expect(await stats(loser)).toEqual({ wins: 0, comparisons: 1, wilson_score: 0 });
    const { rows } = await pool.query(`SELECT trip_id, voter_student_id, winner_nomination_id FROM duel`);
    expect(rows).toEqual([{ trip_id: trip, voter_student_id: voter.id, winner_nomination_id: winner }]);
  });

  it("rejects a repeat of the same pair with 409", async () => {
    const { pair } = (await next(voter.cookie)).json();
    await cast(voter.cookie, pair.pairToken, pair.aNominationId);
    const again = await cast(voter.cookie, pair.pairToken, pair.bNominationId);
    expect(again.statusCode).toBe(409);
    expect(await stats(pair.bNominationId)).toMatchObject({ comparisons: 1 });
  });

  it("rejects bad bodies, someone else's token, and winners outside the pair", async () => {
    const { pair } = (await next(voter.cookie)).json();
    expect((await app.inject({ method: "POST", url: "/api/duels/cast", payload: {} })).statusCode).toBe(401);
    expect((await cast(voter.cookie, pair.pairToken, "not-a-uuid")).statusCode).toBe(400);

    const other = await makeStudent(trip);
    expect((await cast(other.cookie, pair.pairToken, pair.aNominationId)).json().error).toBe("bad_token");
    expect((await cast(voter.cookie, pair.pairToken, noms.A!)).json().message).toBe("winner not in pair");
  });
});
