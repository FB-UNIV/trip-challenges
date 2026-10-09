// Trip phase transitions + results computation.
// draft -> challenge -> voting -> reveal -> grace -> erased (ADR/CONTEXT: Lifecycle).
import type { PoolClient } from "pg";
import { pool, tx } from "./db.js";
import { decrypt } from "./crypto/vault.js";

const NEXT: Record<string, string> = {
  draft: "challenge",
  challenge: "voting",
  voting: "reveal",
  reveal: "grace",
};

export async function advanceTrip(tripId: string, to: string): Promise<void> {
  // One transaction for the whole transition, starting with a row lock on the trip: a
  // concurrent advance (two teachers clicking) waits here, then sees the new phase and is
  // rejected — so results are computed once, and a failure leaves the trip untouched (#26).
  await tx(async (c) => {
    const { rows } = await c.query<{ phase: string }>(`SELECT phase FROM trip WHERE id = $1 FOR UPDATE`, [tripId]);
    const from = rows[0]?.phase;
    if (!from) throw new Error("no such trip");
    if (NEXT[from] !== to) throw Object.assign(new Error(`illegal ${from}->${to}`), { illegal: true });

    if (to === "voting") await autoNominateLatest(c, tripId);
    if (to === "reveal") await computeResultsIn(c, tripId);

    await c.query(`UPDATE trip SET phase = $2 WHERE id = $1`, [tripId, to]);
    await c.query(
      `INSERT INTO audit_log (trip_id, action, target_opaque_id) VALUES ($1, $2, NULL)`,
      [tripId, `phase_${to}`],
    );
  });
}

// Automatic transitions at the planned dates (#26, owner decision): only up to voting.
// voting_closes_at just closes voting (duels check it); the reveal ceremony is always a
// teacher's click, so voting -> reveal is never automatic.
const AUTO: [from: string, to: string, column: string][] = [
  ["draft", "challenge", "challenge_opens_at"],
  ["challenge", "voting", "voting_opens_at"],
];

/** Advance every trip whose planned date has passed. Returns "tripId:phase" per step. */
export async function autoAdvanceDue(now = new Date()): Promise<string[]> {
  const done: string[] = [];
  // In order, so a trip with both dates past catches up draft -> challenge -> voting.
  for (const [from, to, column] of AUTO) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM trip WHERE phase = $1 AND ${column} IS NOT NULL AND ${column} <= $2`,
      [from, now],
    );
    for (const { id } of rows) {
      try {
        await advanceTrip(id, to); // same locked transition as the teacher's button
        done.push(`${id}:${to}`);
      } catch (e: any) {
        // A teacher advanced it meanwhile: fine. Anything else: log, retry next tick.
        if (!e?.illegal) console.error(`[lifecycle] auto-advance ${id} -> ${to} failed`, e);
      }
    }
  }
  return done;
}

// For every (team, challenge) with submissions but no active nomination, nominate the
// latest submission (CONTEXT: Nomination). Stays 'pending' so the Teacher still moderates.
// A team whose entry a Teacher rejected is skipped: the reject sticks (#81, owner decision).
async function autoNominateLatest(c: PoolClient, tripId: string): Promise<void> {
  await c.query(
    `INSERT INTO nomination (trip_id, challenge_id, team_id, submission_id, state, active, auto_nominated)
     SELECT DISTINCT ON (s.team_id, s.challenge_id)
            s.trip_id, s.challenge_id, s.team_id, s.id, 'pending', true, true
       FROM submission s
      WHERE s.trip_id = $1 AND s.removed_by_teacher_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM nomination n
           WHERE n.team_id = s.team_id AND n.challenge_id = s.challenge_id
             AND (n.active OR n.state = 'rejected'))
      ORDER BY s.team_id, s.challenge_id, s.created_at DESC`,
    [tripId],
  );
}

// Rank approved nominations per Challenge (Wilson desc), assign placement + points
// (points_table x challenge.multiplier), then pick the Grand Champion by total points.
export async function computeResults(tripId: string): Promise<void> {
  await tx((c) => computeResultsIn(c, tripId));
}

async function computeResultsIn(c: PoolClient, tripId: string): Promise<void> {
  const { rows: cfg } = await c.query<{ points_table: { placement: number; points: number }[] }>(
    `SELECT points_table FROM trip WHERE id = $1`,
    [tripId],
  );
  const ptsMap = new Map<number, number>(
    (cfg[0]?.points_table ?? []).map((r) => [r.placement, r.points]),
  );

  const { rows: challenges } = await c.query<{ id: string; title: string; multiplier: string }>(
    `SELECT id, title, multiplier FROM challenge WHERE trip_id = $1`,
    [tripId],
  );

  const nameCache = new Map<string, string>();
  const teamTotals = new Map<string, number>();
  // Each team's neutral label ("Team N", trip-wide creation order) and whether a teacher
  // reviewed its name: Erasure keeps only reviewed names (#92, ADR 0007).
  const { rows: teams } = await c.query<{ id: string; name_reviewed: boolean }>(
    `SELECT id, name_reviewed FROM team WHERE trip_id = $1 ORDER BY created_at, id`,
    [tripId],
  );
  const labelOf = new Map(teams.map((t, i) => [t.id, `Team ${i + 1}`]));
  const reviewed = new Map(teams.map((t) => [t.id, t.name_reviewed]));

  for (const ch of challenges) {
    const { rows: noms } = await c.query<{ team_id: string; name_enc: Buffer; wilson: number }>(
      `SELECT n.team_id, tm.name_enc, COALESCE(ns.wilson_score, 0) AS wilson
         FROM nomination n
         JOIN team tm ON tm.id = n.team_id
         LEFT JOIN nomination_stats ns ON ns.nomination_id = n.id
        WHERE n.challenge_id = $1 AND n.active AND n.state = 'approved'
        ORDER BY wilson DESC`,
      [ch.id],
    );
    // Standard competition ranking ("1224"): equal Wilson scores share the placement
    // AND its points (CONTEXT: Winner — per-Challenge ties are not hand-broken). noms is
    // ordered wilson DESC. Note: a Challenge nobody voted on leaves every nomination at
    // wilson 0 → all tie for 1st (nobody was judged, so nobody is ranked below another).
    let placement = 0; // last assigned placement
    let prevWilson: number | null = null;
    let position = 0; // 1-based row position, = placement after a strict drop
    for (const nom of noms) {
      position++;
      if (prevWilson === null || nom.wilson < prevWilson) placement = position;
      prevWilson = nom.wilson;

      if (!nameCache.has(nom.team_id)) {
        nameCache.set(
          nom.team_id,
          (await decrypt(tripId, nom.name_enc.toString("utf8"))).toString("utf8"),
        );
      }
      const points = (ptsMap.get(placement) ?? 0) * Number(ch.multiplier);
      await c.query(
        `INSERT INTO result (trip_id, challenge_title, placement, team_name_vetted, points, team_label, team_name_reviewed)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tripId, ch.title, placement, nameCache.get(nom.team_id), points, labelOf.get(nom.team_id), reviewed.get(nom.team_id)],
      );
      teamTotals.set(nom.team_id, (teamTotals.get(nom.team_id) ?? 0) + points);
    }
  }

  // Grand Champion = max total points. Ties are the Teacher's call — flag all tied.
  const max = Math.max(0, ...teamTotals.values());
  for (const [teamId, total] of teamTotals) {
    if (total === max && total > 0) {
      await c.query(
        `INSERT INTO result (trip_id, challenge_title, placement, team_name_vetted, points, is_grand_champion, team_label, team_name_reviewed)
         VALUES ($1, 'Grand Champion', 0, $2, $3, true, $4, $5)`,
        [tripId, nameCache.get(teamId), total, labelOf.get(teamId), reviewed.get(teamId)],
      );
    }
  }
}
