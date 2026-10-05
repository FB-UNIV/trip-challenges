// Background roster import. Enqueue encrypts each email under the Trip key and stores
// it as a pending item (no plaintext PII at rest). A single advisory-locked worker
// then does the heavy per-student work (argon2 + Vault HMAC + SMTP) and creates the
// Student. HA-safe (one runner across replicas) and resumable across restarts.
import { randomUUID, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { config } from "./config.js";
import { pool } from "./db.js";
import { encrypt, decrypt, hmac } from "./crypto/vault.js";
import { sendAccessCode } from "./email/mailer.js";

const ROSTER_LOCK = 553311; // advisory lock key, distinct from the erasure scheduler's
const BATCH = 25;
const MAX_ATTEMPTS = 5;
const DRAIN_BUDGET_MS = 25_000; // cap one drain so a huge roster can't hog the runner

/** Encrypt + queue emails for background processing. Returns how many were queued. */
export async function enqueueRoster(tripId: string, emails: string[]): Promise<number> {
  let queued = 0;
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    const enc = await encrypt(tripId, Buffer.from(email, "utf8"));
    await pool.query(
      `INSERT INTO roster_import_item (trip_id, email_enc) VALUES ($1, $2)`,
      [tripId, Buffer.from(enc, "utf8")],
    );
    queued++;
  }
  return queued;
}

/**
 * Drain pending roster items. Holds a dedicated advisory lock so only one runner
 * processes at a time (immediate post-enqueue kick + scheduler ticks both call this).
 */
export async function processRosterBatch(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: lock } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ROSTER_LOCK],
    );
    if (!lock[0]?.locked) return; // another runner is draining
    try {
      const deadline = Date.now() + DRAIN_BUDGET_MS;
      while (Date.now() < deadline) {
        const { rows: items } = await client.query<{
          id: string; trip_id: string; email_enc: Buffer; attempts: number;
        }>(
          `SELECT id, trip_id, email_enc, attempts
             FROM roster_import_item
            WHERE status = 'pending'
            ORDER BY created_at
            LIMIT $1`,
          [BATCH],
        );
        if (items.length === 0) break;
        for (const it of items) await processItem(it);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ROSTER_LOCK]);
    }
  } finally {
    client.release();
  }
}

async function processItem(it: { id: string; trip_id: string; email_enc: Buffer; attempts: number }): Promise<void> {
  try {
    const email = (await decrypt(it.trip_id, it.email_enc.toString("utf8"))).toString("utf8");
    const lookup = await hmac(it.trip_id, Buffer.from(email, "utf8"));
    const studentId = randomUUID();
    const secret = randomBytes(16).toString("base64url"); // 128-bit
    const hash = await argon2.hash(secret);

    // Reuse the already-encrypted email ciphertext for the Student row.
    const ins = await pool.query(
      `INSERT INTO student (id, trip_id, email_enc, email_lookup, access_code_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (trip_id, email_lookup) DO NOTHING`,
      [studentId, it.trip_id, it.email_enc, lookup, hash],
    );
    if (ins.rowCount) {
      const { rows: tr } = await pool.query<{ name: string }>(`SELECT name FROM trip WHERE id = $1`, [it.trip_id]);
      const joinUrl = `${config.PUBLIC_BASE_URL}/join?code=${encodeURIComponent(`${studentId}.${secret}`)}`;
      await sendAccessCode(email, tr[0]?.name ?? "the trip", joinUrl);
    } // else: duplicate email already imported — mark done, don't re-send.
    await pool.query(`UPDATE roster_import_item SET status = 'done', processed_at = now() WHERE id = $1`, [it.id]);
  } catch (e: any) {
    const attempts = it.attempts + 1;
    const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    // Store only an error code/name — SMTP errors can echo the recipient address,
    // which must never land in the DB (Erasure › no student PII in logs).
    const reason = String(e?.code ?? e?.name ?? "error").slice(0, 100);
    await pool.query(
      `UPDATE roster_import_item SET attempts = $2, status = $3, last_error = $4 WHERE id = $1`,
      [it.id, attempts, status, reason],
    );
  }
}
