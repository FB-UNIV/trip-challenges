// Resolve the authenticated Teacher from a signed session cookie.
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db.js";

export type TeacherCtx = { teacherId: string };

export function readTeacher(req: FastifyRequest, reply: FastifyReply): TeacherCtx | null {
  const raw = req.cookies["teacher_session"];
  if (!raw) return null;
  const un = reply.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  return { teacherId: un.value };
}

/** Guard: 401 if no teacher. Returns ctx on success. */
export async function requireTeacher(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<TeacherCtx | null> {
  const ctx = readTeacher(req, reply);
  if (!ctx) {
    reply.code(401).send({ error: "unauthorized", message: "teacher login required" });
    return null;
  }
  return ctx;
}

/** Assert the teacher is owner or co-teacher on a Trip. */
export async function assertTripAccess(teacherId: string, tripId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM trip_teacher WHERE trip_id = $1 AND teacher_id = $2`,
    [tripId, teacherId],
  );
  return (rowCount ?? 0) > 0;
}
