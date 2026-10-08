// A Trip's Teams, for its teachers (#94): decrypted names to review before they can survive
// Erasure (ADR 0007), members and activity. Renaming or reviewing closes at the reveal, when
// the names are copied into the results.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RenameTeam } from "@trip/shared";
import { pool } from "../db.js";
import { guard, teacherOf, tripFrom, tripOf, type Phase } from "../auth/guard.js";
import { decrypt, encrypt } from "../crypto/vault.js";

const BEFORE_REVEAL: Phase[] = ["draft", "challenge", "voting"];
const TeamParams = z.object({ id: z.string().uuid(), teamId: z.string().uuid() });
const closed = { status: 409, body: { error: "closed", message: "team names are final once results are computed" } };

export async function tripTeamRoutes(app: FastifyInstance) {
  const member = guard({ role: "teacher", trip: tripFrom.trip("params.id") });

  app.get("/:id/teams", { preHandler: member }, async (req) => {
    const trip = tripOf(req);
    const { rows } = await pool.query<{
      id: string; name_enc: Buffer; name_reviewed: boolean; members: string[]; photos: number; challenges: number;
      pending: number; approved: number; rejected: number;
    }>(
      `SELECT t.id, t.name_enc, t.name_reviewed,
              COALESCE((SELECT array_agg(m.student_id) FROM team_member m WHERE m.team_id = t.id), '{}') AS members,
              (SELECT count(*)::int FROM submission s WHERE s.team_id = t.id AND s.removed_by_teacher_id IS NULL) AS photos,
              (SELECT count(DISTINCT s.challenge_id)::int FROM submission s
                WHERE s.team_id = t.id AND s.removed_by_teacher_id IS NULL) AS challenges,
              (SELECT count(*)::int FROM nomination n WHERE n.team_id = t.id AND n.active AND n.state = 'pending') AS pending,
              (SELECT count(*)::int FROM nomination n WHERE n.team_id = t.id AND n.active AND n.state = 'approved') AS approved,
              (SELECT count(*)::int FROM nomination n WHERE n.team_id = t.id AND n.active AND n.state = 'rejected') AS rejected
         FROM team t WHERE t.trip_id = $1
        ORDER BY t.created_at, t.id`,
      [trip.id],
    );
    const { rows: [cfg] } = await pool.query<{ max_team_size: number }>(`SELECT max_team_size FROM trip WHERE id = $1`, [trip.id]);
    const teams = await Promise.all(rows.map(async (r, i) => ({
      id: r.id,
      name: (await decrypt(trip.id, r.name_enc.toString("utf8"))).toString("utf8"),
      label: `Team ${i + 1}`, // same rule as the results' label (lifecycle.ts)
      nameReviewed: r.name_reviewed,
      members: r.members,
      photos: r.photos,
      challengesEntered: r.challenges,
      nominations: { pending: r.pending, approved: r.approved, rejected: r.rejected },
    })));
    return { teams, maxTeamSize: cfg!.max_team_size };
  });

  const editable = guard({
    role: "teacher", params: TeamParams, body: RenameTeam, trip: tripFrom.trip("params.id"), phases: BEFORE_REVEAL, closed,
  });
  app.patch("/:id/teams/:teamId", { preHandler: editable }, async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    const { name } = req.body as { name: string };
    const trip = tripOf(req);
    const enc = await encrypt(trip.id, Buffer.from(name));
    return mark(req, reply, teamId, `name_enc = $3, name_reviewed = true`, "team_renamed", [Buffer.from(enc)]);
  });

  const reviewable = guard({
    role: "teacher", params: TeamParams, trip: tripFrom.trip("params.id"), phases: BEFORE_REVEAL, closed,
  });
  app.post("/:id/teams/:teamId/review", { preHandler: reviewable }, async (req, reply) => {
    const { teamId } = req.params as { teamId: string };
    return mark(req, reply, teamId, `name_reviewed = true`, "team_name_reviewed", []);
  });

  /** Update a team of this trip; audit with opaque ids only — never the name. */
  async function mark(req: FastifyRequest, reply: FastifyReply, teamId: string, set: string, action: string, extra: unknown[]) {
    const trip = tripOf(req);
    const { rowCount } = await pool.query(`UPDATE team SET ${set} WHERE id = $1 AND trip_id = $2`, [teamId, trip.id, ...extra]);
    if (!rowCount) return reply.code(404).send({ error: "not_found", message: "team" });
    await pool.query(
      `INSERT INTO audit_log (trip_id, teacher_id, action, target_opaque_id) VALUES ($1, $2, $3, $4)`,
      [trip.id, teacherOf(req).teacherId, action, teamId],
    );
    return { ok: true };
  }
}
