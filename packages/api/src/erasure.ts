// Erasure: irreversible destruction of a Trip's student data (ADR-0001, data-model.md).
// Triggered by: grace window after voting, teacher early-fire, or hard_erase_at (any phase).
import { pool, tx } from "./db.js";
import { deleteTripBlobs } from "./storage/s3.js";
import { destroyTripKey } from "./crypto/vault.js";
import { config } from "./config.js";
import { sendErasureWarning, sendErasureFailedAlert } from "./email/mailer.js";
import { pickBracket } from "./lib/erasureWarning.js";

export async function eraseTrip(tripId: string): Promise<void> {
  // 1. Hard-delete photo blobs (live copies).
  await deleteTripBlobs(tripId);

  // 2. Delete all PII-bearing Trip-scoped rows; tombstone the Trip.
  //    result + audit_log have no FK to trip and survive — but only reviewed team names do:
  //    any other name becomes its neutral label (#92, ADR 0007). Results from before labels
  //    existed are numbered by name; the label is stored so a rerun keeps it.
  await tx(async (c) => {
    await c.query(
      `UPDATE result r
          SET team_name_vetted = COALESCE(r.team_label, x.fallback),
              team_label = COALESCE(r.team_label, x.fallback)
         FROM (SELECT id, 'Team ' || dense_rank() OVER (ORDER BY team_name_vetted) AS fallback
                 FROM result WHERE trip_id = $1 AND NOT team_name_reviewed) x
        WHERE r.id = x.id`,
      [tripId],
    );
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
    // NOT tombstoned yet: until the key is destroyed (step 4) the trip must stay due,
    // so a failure below is retried on the next tick instead of being forgotten (#24).
  });

  // 3. Logs need no scrubbing: student PII never enters them by construction (opaque
  //    ids only; query strings, emails and codes stripped, see lib/logging.ts and
  //    docs/production-hardening.md). Email-provider delivery logs are bounded by the
  //    provider's retention setting, an operational control documented there too (#20).

  // 4. THE decisive step: destroy the Trip's Vault key. Residual copies in
  //    DB/MinIO backups become permanently unreadable. Idempotent, so a retry after a
  //    later failure is safe.
  await destroyTripKey(tripId);

  // 5. Only now tombstone the Trip, together with the (PII-free, surviving) audit row.
  //    Every step above is idempotent: re-running a half-finished erasure converges.
  await tx(async (c) => {
    await c.query(`UPDATE trip SET phase = 'erased' WHERE id = $1`, [tripId]);
    await c.query(`INSERT INTO audit_log (trip_id, action) VALUES ($1, 'erasure_fired')`, [tripId]);
  });
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

const ALERT_EVERY_MS = 60 * 60_000;
const lastAlert = new Map<string, number>(); // tripId -> last alert time (per process)

/**
 * Tell the Trip's teachers (and ALERT_EMAIL, if set) that its erasure failed (#24).
 * At most once an hour per trip per process; the scheduler retries every tick meanwhile.
 * The detail is our own error text (ids, HTTP status), never student PII.
 */
export async function alertErasureFailure(tripId: string, error: unknown, now = Date.now()): Promise<void> {
  const last = lastAlert.get(tripId);
  if (last !== undefined && now - last < ALERT_EVERY_MS) return;
  lastAlert.set(tripId, now);

  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM trip WHERE id = $1`, [tripId]);
  const detail = String((error as Error)?.message ?? error).slice(0, 300);
  const to = new Set(await teacherEmailsForTrip(tripId));
  if (config.ALERT_EMAIL) to.add(config.ALERT_EMAIL);
  for (const addr of to) {
    try {
      await sendErasureFailedAlert(addr, rows[0]?.name ?? "a trip", tripId, detail);
    } catch (e) {
      console.error(`[erasure] alert mail failed for trip ${tripId}`, e);
    }
  }
}
