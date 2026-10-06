// Background erasure runner. Fires grace-window + hard-deadline erasures.
// HA-safe: a Postgres advisory lock ensures only ONE api replica runs each tick.
import { pool } from "./db.js";
import { config } from "./config.js";
import { findTripsDueForErasure, eraseTrip, warnUpcomingErasures, alertErasureFailure } from "./erasure.js";
import { processRosterBatch } from "./roster-worker.js";
import { autoAdvanceDue } from "./lifecycle.js";

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
          // Planned phase changes first (#26), so a trip opening today is live this tick.
          try {
            await autoAdvanceDue();
          } catch (e) {
            console.error("[lifecycle] auto-advance pass failed", e);
          }
          const due = await findTripsDueForErasure();
          let healthy = true;
          for (const id of due) {
            try {
              await eraseTrip(id);
            } catch (e) {
              healthy = false;
              console.error(`[erasure] failed for trip ${id}`, e);
              await alertErasureFailure(id, e).catch((err) => console.error("[erasure] alerting failed", err));
            }
          }
          // Dead-man's switch: only a tick where every due erasure succeeded checks in, so
          // a stopped scheduler or a stuck erasure both go quiet and the monitor alerts.
          if (healthy) await pingHeartbeat();
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

async function pingHeartbeat(): Promise<void> {
  if (!config.HEARTBEAT_URL) return;
  try {
    await fetch(config.HEARTBEAT_URL, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    console.error("[scheduler] heartbeat ping failed", e);
  }
}
