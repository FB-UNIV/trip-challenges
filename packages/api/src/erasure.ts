// Erasure: irreversible destruction of a Trip's student data (ADR-0001, data-model.md).
// Triggered by: grace window after voting, teacher early-fire, or hard_erase_at (any phase).
import { pool, tx } from "./db.js";
import { deleteTripBlobs } from "./storage/s3.js";
import { destroyTripKey } from "./crypto/vault.js";
import { sendErasureWarning } from "./email/mailer.js";
import { pickBracket } from "./lib/erasureWarning.js";

export async function eraseTrip(tripId: string): Promise<void> {
  // 1. Hard-delete photo blobs (live copies).
  await deleteTripBlobs(tripId);

  // 2. Delete all PII-bearing Trip-scoped rows; tombstone the Trip.
  //    result + audit_log have no FK to trip and survive.
  await tx(async (c) => {
    // Children cascade off these, but delete explicitly for clarity/order.
    await c.query(`DELETE FROM duel WHERE trip_id = $1`, [tripId]);
    await c.query(
      `DELETE FROM nomination_stats WHERE trip_id = $1`,
      [tripId],
    );
    await c.query(`DELETE FROM nomination WHERE trip_id = $1`, [tripId]);
    await c.query(`DELETE FROM submission WHERE trip_id = $1`, [tripId]);
    await c.query(`DELETE FROM team_member WHERE trip_id = $1`, [tripId]);
    await c.query(`DELETE FROM team WHERE trip_id = $1`, [tripId]);
    await c.query(
      `DELETE FROM student_session
        WHERE student_id IN (SELECT id FROM student WHERE trip_id = $1)`,
      [tripId],
    );
    await c.query(`DELETE FROM student WHERE trip_id = $1`, [tripId]);
    await c.query(`DELETE FROM roster_import_item WHERE trip_id = $1`, [tripId]);
    await c.query(`DELETE FROM trip_teacher_invite WHERE trip_id = $1`, [tripId]);
    await c.query(`DELETE FROM challenge WHERE trip_id = $1`, [tripId]);
    await c.query(`UPDATE trip SET phase = 'erased' WHERE id = $1`, [tripId]);
  });

  // 3. Scrub email-delivery + app logs of Trip identifiers/PII, rotate.
  //    TODO: wire to your log pipeline (structured logs keyed by trip_id).
  await scrubLogs(tripId);

  // 4. THE decisive step: destroy the Trip's Vault key. Residual copies in
  //    DB/MinIO backups become permanently unreadable.
  await destroyTripKey(tripId);

  // 5. Audit (PII-free) — survives.
  await pool.query(
    `INSERT INTO audit_log (trip_id, action) VALUES ($1, 'erasure_fired')`,
    [tripId],
  );
}

async function scrubLogs(_tripId: string): Promise<void> {
  // Placeholder: student PII should never enter logs in the first place
  // (log opaque IDs only). Email-delivery records get purged/rotated here.
}

/** Trips whose grace window elapsed or hard deadline passed. Run on a schedule. */
export async function findTripsDueForErasure(now = new Date()): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM trip
      WHERE phase <> 'erased'
        AND (
          hard_erase_at <= $1
          OR (phase = 'grace'
              AND voting_closes_at IS NOT NULL
              AND voting_closes_at + (grace_days || ' days')::interval <= $1)
        )`,
    [now],
  );
  return rows.map((r) => r.id);
}

/**
 * Send escalating pre-erasure warnings (7d/1d/1h) to a Trip's teachers.
 * The effective deadline mirrors findTripsDueForErasure() EXACTLY (the grace
 * window only counts once phase='grace'), so a warning never promises an
 * erasure that won't actually fire then. Idempotent: a row is claimed in
 * erasure_warning before sending, so repeated ticks / HA replicas don't re-send.
 */
export async function warnUpcomingErasures(now = new Date()): Promise<void> {
  const { rows } = await pool.query<{ id: string; name: string; erase_at: Date }>(
    `SELECT id, name,
            LEAST(hard_erase_at,
                  CASE WHEN phase = 'grace' AND voting_closes_at IS NOT NULL
                       THEN voting_closes_at + (grace_days || ' days')::interval END) AS erase_at
       FROM trip
      WHERE phase NOT IN ('draft','erased')`,
  );

  for (const t of rows) {
    const bracket = pickBracket(t.erase_at.getTime() - now.getTime());
    if (!bracket) continue; // >7d out, or already due (runner handles that)

    // Claim this (trip, bracket, deadline). ON CONFLICT DO NOTHING → send once.
    const claim = await pool.query(
      `INSERT INTO erasure_warning (trip_id, bracket, erase_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [t.id, bracket, t.erase_at],
    );
    if (claim.rowCount === 0) continue; // a prior tick already warned this bracket

    for (const to of await teacherEmailsForTrip(t.id)) {
      try {
        await sendErasureWarning(to, t.name, t.erase_at);
      } catch (e) {
        console.error(`[warn] mail failed for trip ${t.id}`, e);
      }
    }
  }
}

/** Owner + co-teachers of a Trip (staff, so email is plaintext — not 🔒 student PII). */
async function teacherEmailsForTrip(tripId: string): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT DISTINCT t.email
       FROM teacher t
      WHERE t.id = (SELECT owner_teacher_id FROM trip WHERE id = $1)
         OR t.id IN (SELECT teacher_id FROM trip_teacher WHERE trip_id = $1)`,
    [tripId],
  );
  return rows.map((r) => r.email);
}
