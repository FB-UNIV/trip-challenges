// Nominations. A Team nominates one Submission per Challenge for voting; the Teacher
// moderates before voting opens. Only approved+active nominations become votable.
import type { FastifyInstance } from "fastify";
import { NominateInput } from "@trip/shared";
import { pool, tx } from "../db.js";
import { requireStudent } from "../auth/student.js";
import { requireTeacher, assertTripAccess } from "../auth/teacher.js";

export async function nominationRoutes(app: FastifyInstance) {
  // Student: set the team's active nomination for a challenge (replaces any prior).
  app.post("/", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    if (!ctx.teamId) return reply.code(409).send({ error: "no_team", message: "join a team first" });
    const parsed = NominateInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "invalid" });
    const { challengeId, submissionId } = parsed.data;

    // Submission must be this team's, for this challenge, in this trip, and not removed.
    const { rows } = await pool.query<{ phase: string }>(
      `SELECT t.phase
         FROM submission s JOIN trip t ON t.id = s.trip_id
        WHERE s.id = $1 AND s.challenge_id = $2 AND s.team_id = $3
          AND s.trip_id = $4 AND s.removed_by_teacher_id IS NULL`,
      [submissionId, challengeId, ctx.teamId, ctx.tripId],
    );
    const trip = rows[0];
    if (!trip) return reply.code(404).send({ error: "not_found", message: "submission" });
    if (trip.phase !== "challenge") {
      return reply.code(409).send({ error: "closed", message: "nominations are closed" });
    }

    await tx(async (c) => {
      // Retire the current active nomination for this (team, challenge), then add the new one.
      await c.query(
        `UPDATE nomination SET active = false
          WHERE team_id = $1 AND challenge_id = $2 AND active`,
        [ctx.teamId, challengeId],
      );
      await c.query(
        `INSERT INTO nomination (trip_id, challenge_id, team_id, submission_id, state, active)
         VALUES ($1,$2,$3,$4,'pending',true)`,
        [ctx.tripId, challengeId, ctx.teamId, submissionId],
      );
    });
    return reply.code(201).send({ ok: true });
  });

  // Teacher: list active nominations for review (optionally by state).
  app.get("/trip/:tripId", async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const tripId = (req.params as { tripId: string }).tripId;
    if (!(await assertTripAccess(teacher.teacherId, tripId))) {
      return reply.code(404).send({ error: "not_found", message: "no such trip" });
    }
    const state = (req.query as any)?.state as string | undefined;
    const { rows } = await pool.query(
      `SELECT n.id, n.challenge_id, n.team_id, n.submission_id, n.state
         FROM nomination n
        WHERE n.trip_id = $1 AND n.active
          AND ($2::text IS NULL OR n.state = $2)
        ORDER BY n.challenge_id`,
      [tripId, state ?? null],
    );
    return { nominations: rows };
  });

  // Teacher: approve / reject a nomination.
  for (const decision of ["approve", "reject"] as const) {
    app.post(`/:id/${decision}`, async (req, reply) => {
      const teacher = await requireTeacher(req, reply);
      if (!teacher) return;
      const id = (req.params as { id: string }).id;
      const { rows } = await pool.query<{ trip_id: string }>(
        `SELECT trip_id FROM nomination WHERE id = $1 AND active`,
        [id],
      );
      const nom = rows[0];
      if (!nom || !(await assertTripAccess(teacher.teacherId, nom.trip_id))) {
        return reply.code(404).send({ error: "not_found", message: "nomination" });
      }
      const state = decision === "approve" ? "approved" : "rejected";
      await pool.query(
        `UPDATE nomination
            SET state = $2, moderated_by_teacher_id = $3, moderated_at = now(),
                active = CASE WHEN $2 = 'rejected' THEN false ELSE active END
          WHERE id = $1`,
        [id, state, teacher.teacherId],
      );
      return { ok: true, state };
    });
  }
}
