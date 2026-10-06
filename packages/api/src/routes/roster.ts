// Roster import (ADR-0004). Teacher bulk-imports student emails; each becomes a
// Student with a single-use Access Code emailed as a join link. Emails are stored
// 🔒 (Vault-encrypted); a Trip-scoped HMAC provides dedupe without decryption.
//
// The request only ENQUEUES (encrypt + persist); the heavy per-student work
// (argon2 + SMTP) runs in a background worker so large rosters don't block/timeout.
import type { FastifyInstance } from "fastify";
import { RosterImport } from "@trip/shared";
import { pool } from "../db.js";
import { guard, tripFrom, teacherOf, tripOf } from "../auth/guard.js";
import { enqueueRoster, processRosterBatch } from "../roster-worker.js";

export async function rosterRoutes(app: FastifyInstance) {
  const member = guard({ role: "teacher", trip: tripFrom.trip("params.id") });

  // POST /api/trips/:id/roster — enqueue emails; returns 202 with how many were queued.
  app.post("/:id/roster", { preHandler: member }, async (req, reply) => {
    const teacher = teacherOf(req);
    const tripId = tripOf(req).id;
    const parsed = RosterImport.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
    }

    const queued = await enqueueRoster(tripId, parsed.data.emails);
    await pool.query(
      `INSERT INTO audit_log (trip_id, teacher_id, action) VALUES ($1, $2, 'roster_enqueued')`,
      [tripId, teacher.teacherId],
    );

    // Kick the worker now so codes go out promptly; the scheduler is the safety net.
    setImmediate(() => void processRosterBatch().catch(() => {}));
    return reply.code(202).send({ queued, requested: parsed.data.emails.length });
  });

  // GET /api/trips/:id/roster/status — progress for the admin UI.
  app.get("/:id/roster/status", { preHandler: member }, async (req) => {
    const tripId = tripOf(req).id;
    const { rows } = await pool.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM roster_import_item WHERE trip_id = $1 GROUP BY status`,
      [tripId],
    );
    const by = { pending: 0, done: 0, failed: 0 };
    for (const r of rows) by[r.status as keyof typeof by] = Number(r.n);
    const { rows: st } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM student WHERE trip_id = $1`,
      [tripId],
    );
    return { ...by, students: Number(st[0]?.n ?? 0) };
  });
}
