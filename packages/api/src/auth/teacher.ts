// Resolve the authenticated Teacher from a signed session cookie.
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";

export type TeacherCtx = { teacherId: string };

export const TEACHER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** The signed cookie value: who, and when it was issued — so the 8 h limit holds server-side,
 *  not only in the browser (a copied cookie used to stay valid until SESSION_SECRET rotated). */
export const teacherSessionValue = (teacherId: string, issuedAt = Date.now()) => `${teacherId}.${issuedAt}`;

export function readTeacher(req: FastifyRequest, reply: FastifyReply): TeacherCtx | null {
  const raw = req.cookies["teacher_session"];
  if (!raw) return null;
  const un = reply.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  const [teacherId, issued] = un.value.split(".", 2);
  const age = Date.now() - Number(issued);
  // No timestamp (pre-expiry cookie), expired, or from the future (beyond replica clock skew).
  if (!teacherId || !Number.isFinite(age) || age < -60_000 || age > TEACHER_SESSION_TTL_MS) return null;
  return { teacherId };
}

/** Assert the teacher is owner or co-teacher on a Trip. */
export async function assertTripAccess(teacherId: string, tripId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM trip_teacher WHERE trip_id = $1 AND teacher_id = $2`,
    [tripId, teacherId],
  );
  return (rowCount ?? 0) > 0;
}
