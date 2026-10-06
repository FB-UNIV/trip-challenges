// Pairwise voting (ADR-0002). Pairing = least-compared-first + random eligible
// opponent, excluding the voter's own Team, never repeating a pair per voter.
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { CastDuel } from "@trip/shared";
import { config } from "../config.js";
import { pool, tx } from "../db.js";
import { requireStudent } from "../auth/student.js";
import { wilsonLower } from "../lib/wilson.js";
import { signPair as sign, verifyPair as verify } from "../lib/pairToken.js";

const signPair = (voterId: string, challengeId: string, a: string, b: string) =>
  sign(config.SESSION_SECRET, voterId, challengeId, a, b);
const verifyPair = (token: string, voterId: string) =>
  verify(config.SESSION_SECRET, token, voterId);

export async function duelRoutes(app: FastifyInstance) {
  // Serve the next pair for a Challenge.
  app.get("/next", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    const challengeId = (req.query as any)?.challengeId as string | undefined;
    if (!challengeId) return reply.code(400).send({ error: "bad_request", message: "challengeId" });

    // Only this voter's trip (#16), and only during the Voting Period (#17).
    const phase = await challengePhase(pool, challengeId, ctx.tripId);
    if (!phase) return reply.code(404).send({ error: "not_found", message: "challenge" });
    if (phase !== "voting") return { pair: null, reason: "closed" };

    // Eligible = approved+active nominations for this challenge, not the voter's team,
    // and not already exhausted against this voter. Least-compared-first.
    const { rows } = await pool.query<Cand>(
      `SELECT n.id, n.submission_id, COALESCE(ns.comparisons, 0) AS comparisons
         FROM nomination n
         LEFT JOIN nomination_stats ns ON ns.nomination_id = n.id
        WHERE n.challenge_id = $1 AND n.active AND n.state = 'approved'
          AND n.team_id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY comparisons ASC, random()`,
      [challengeId, ctx.teamId],
    );
    // A pair needs TWO approved nominations from teams other than the voter's. Fewer than
    // that (too few teams — pairwise needs 3+ — or not enough approved yet) means no pair
    // can ever be shown to this voter, which is different from "you've voted everything".
    if (rows.length < 2) return { pair: null, reason: "not_enough" };

    // Exclude pairs this voter already cast for this Challenge. The cast-time unique
    // constraint is the backstop; filtering here stops us serving a dead pair (-> 409).
    const { rows: voted } = await pool.query<{ low_nomination_id: string; high_nomination_id: string }>(
      `SELECT low_nomination_id, high_nomination_id
         FROM duel WHERE voter_student_id = $1 AND challenge_id = $2`,
      [ctx.studentId, challengeId],
    );
    const seen = new Set(voted.map((v) => pairKey(v.low_nomination_id, v.high_nomination_id)));

    // Keep least-compared-first for A; if all of A's opponents are used up, fall through to
    // the next A. When every pair is exhausted for this voter, voting is done (204).
    let pair: { a: Cand; b: Cand } | null = null;
    for (let i = 0; i < rows.length && !pair; i++) {
      const a = rows[i]!;
      for (const b of shuffle(rows.filter((_, j) => j !== i))) {
        if (!seen.has(pairKey(a.id, b.id))) { pair = { a, b }; break; }
      }
    }
    if (!pair) return { pair: null, reason: "exhausted" }; // voter has compared every pair
    const { a, b } = pair;
    return {
      pair: {
        challengeId,
        aNominationId: a.id,
        bNominationId: b.id,
        aSubmissionId: a.submission_id,
        bSubmissionId: b.submission_id,
        pairToken: signPair(ctx.studentId, challengeId, a.id, b.id),
      },
    };
  });

  // Cast the result of a duel.
  app.post("/cast", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    const parsed = CastDuel.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "invalid" });

    const pair = verifyPair(parsed.data.pairToken, ctx.studentId);
    if (!pair) return reply.code(400).send({ error: "bad_token", message: "invalid pair token" });
    const winner = parsed.data.winnerNominationId;
    if (winner !== pair.lo && winner !== pair.hi) {
      return reply.code(400).send({ error: "bad_request", message: "winner not in pair" });
    }
    const loser = winner === pair.lo ? pair.hi : pair.lo;

    try {
      await tx(async (c) => {
        // Re-check trip + phase at cast time, holding the trip row so a concurrent phase
        // change can't land between the check and the vote (#16, #17).
        const phase = await challengePhase(c, pair.challengeId, ctx.tripId, "FOR SHARE OF t");
        if (!phase) throw Object.assign(new Error("not found"), { httpStatus: 404, error: "not_found" });
        if (phase !== "voting") throw Object.assign(new Error("closed"), { httpStatus: 409, error: "closed" });

        await c.query(
          `INSERT INTO duel (trip_id, challenge_id, voter_student_id,
                             a_nomination_id, b_nomination_id, winner_nomination_id,
                             low_nomination_id, high_nomination_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ctx.tripId, pair.challengeId, ctx.studentId, pair.lo, pair.hi, winner, pair.lo, pair.hi],
        );
        await bumpStats(c, ctx.tripId, winner, true);
        await bumpStats(c, ctx.tripId, loser, false);
      });
    } catch (e: any) {
      if (e?.httpStatus) return reply.code(e.httpStatus).send({ error: e.error, message: e.message });
      // unique violation = repeat pair for this voter
      if (e?.code === "23505") return reply.code(409).send({ error: "duplicate", message: "already voted this pair" });
      throw e;
    }
    return { ok: true };
  });
}

/** The trip phase for a challenge, but only if it belongs to `tripId`. */
async function challengePhase(
  db: Pick<PoolClient, "query">,
  challengeId: string,
  tripId: string,
  lock = "",
): Promise<string | undefined> {
  const { rows } = await db.query<{ phase: string }>(
    `SELECT t.phase FROM challenge c JOIN trip t ON t.id = c.trip_id
      WHERE c.id = $1 AND c.trip_id = $2 ${lock}`,
    [challengeId, tripId],
  );
  return rows[0]?.phase;
}

type Cand = { id: string; submission_id: string; comparisons: number };

// Unordered pair identity — matches the duel(low,high) unique constraint.
const pairKey = (x: string, y: string) => (x < y ? `${x}:${y}` : `${y}:${x}`);

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

async function bumpStats(c: PoolClient, tripId: string, nominationId: string, won: boolean) {
  await c.query(
    `INSERT INTO nomination_stats (nomination_id, trip_id, wins, comparisons)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (nomination_id) DO UPDATE
       SET wins = nomination_stats.wins + $3,
           comparisons = nomination_stats.comparisons + 1`,
    [nominationId, tripId, won ? 1 : 0],
  );
  const { rows } = await c.query<{ wins: number; comparisons: number }>(
    `SELECT wins, comparisons FROM nomination_stats WHERE nomination_id = $1`,
    [nominationId],
  );
  const s = rows[0]!;
  await c.query(`UPDATE nomination_stats SET wilson_score = $2 WHERE nomination_id = $1`, [
    nominationId,
    wilsonLower(s.wins, s.comparisons),
  ]);
}
