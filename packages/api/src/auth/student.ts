// Resolve the authenticated Student from the device-bound session cookie.
import type { FastifyRequest } from "fastify";
import { hashSessionToken, verifySessionToken } from "./session-token.js";
import { pool } from "../db.js";

export type StudentCtx = { studentId: string; tripId: string; teamId: string | null };

export async function requireStudent(req: FastifyRequest): Promise<StudentCtx | null> {
  const raw = req.cookies["student_session"];
  if (!raw) return null;
  const [studentId, token] = raw.split(".", 2);
  if (!studentId || !token) return null;

  const { rows } = await pool.query<{
    id: string;
    token_hash: string;
    trip_id: string;
    team_id: string | null;
  }>(
    `SELECT s.id, s.token_hash, st.trip_id, tm.team_id
       FROM student_session s
       JOIN student st ON st.id = s.student_id
       LEFT JOIN team_member tm ON tm.student_id = st.id
      WHERE s.student_id = $1 AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC LIMIT 1`,
    [studentId],
  );
  const row = rows[0];
  if (!row) return null;
  const { ok, legacy } = await verifySessionToken(row.token_hash, token);
  if (!ok) return null;
  if (legacy) {
    // Upgrade a pre-#64 argon2 hash so this device skips argon2 from now on. Guarded on the
    // old hash so a concurrent upgrade (or a revoke/re-redeem) isn't clobbered.
    await pool.query(
      `UPDATE student_session SET token_hash = $2 WHERE id = $1 AND token_hash = $3`,
      [row.id, hashSessionToken(token), row.token_hash],
    );
  }
  return { studentId, tripId: row.trip_id, teamId: row.team_id };
}
