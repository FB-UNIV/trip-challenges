// Background erasure runner. Fires grace-window + hard-deadline erasures.
// HA-safe: a Postgres advisory lock ensures only ONE api replica runs each tick.
import { pool } from "./db.js";
import { findTripsDueForErasure, eraseTrip, warnUpcomingErasures } from "./erasure.js";
import { processRosterBatch } from "./roster-worker.js";

const LOCK_KEY = 918273645; // arbitrary, stable across replicas

export function startErasureScheduler(intervalMs = 60_000) {
  const tick = async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [LOCK_KEY],
      );
      // Another replica holds the erasure lock: skip erasure only. The roster drain
      // below has its own lock and must still run here (#37).
      if (rows[0]?.locked) {
        try {
          const due = await findTripsDueForErasure();
          for (const id of due) {
            try {
              await eraseTrip(id);
            } catch (e) {
              console.error(`[erasure] failed for trip ${id}`, e);
            }
          }
          // Escalating warnings for erasures still ahead (deduped in erasure_warning).
          try {
            await warnUpcomingErasures();
          } catch (e) {
            console.error("[erasure] warning pass failed", e);
          }
        } finally {
          await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
        }
      }
    } finally {
      client.release();
    }

    // Roster draining is gated by its OWN advisory lock (not the erasure lock),
    // so it keeps making progress on whichever replica is free.
    try {
      await processRosterBatch();
    } catch (e) {
      console.error("[roster] drain failed", e);
    }
  };

  // A failed tick (e.g. Postgres restarting) is logged and retried next interval. Letting
  // it escape would be an unhandled rejection, which terminates the process (#19).
  const timer = setInterval(() => {
    tick().catch((e) => console.error("[scheduler] tick failed", e));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
