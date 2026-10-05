// Teams. Rules (CONTEXT: Team): exclusive membership, solo allowed, bounded by the
// Trip's maxTeamSize, and formation locks once the challenge period starts.
// Team names are 🔒 (may contain real names).
import type { FastifyInstance } from "fastify";
import { CreateTeam, JoinTeam } from "@trip/shared";
import { pool, tx } from "../db.js";
import { requireStudent } from "../auth/student.js";
import { encrypt, decrypt } from "../crypto/vault.js";

// Team ops are only allowed before the challenge period locks membership.
async function tripFormable(tripId: string): Promise<{ ok: boolean; maxTeamSize: number }> {
  const { rows } = await pool.query<{ phase: string; max_team_size: number }>(
    `SELECT phase, max_team_size FROM trip WHERE id = $1`,
    [tripId],
  );
  const t = rows[0];
  return { ok: t?.phase === "draft", maxTeamSize: t?.max_team_size ?? 0 };
}

export async function teamRoutes(app: FastifyInstance) {
  // List teams (to join). Names decrypted for display within the Trip.
  app.get("/", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    const { rows } = await pool.query<{ id: string; name_enc: Buffer; members: number }>(
      `SELECT t.id, t.name_enc, COUNT(tm.student_id)::int AS members
         FROM team t LEFT JOIN team_member tm ON tm.team_id = t.id
        WHERE t.trip_id = $1 GROUP BY t.id`,
      [ctx.tripId],
    );
    const teams = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: (await decrypt(ctx.tripId, r.name_enc.toString("utf8"))).toString("utf8"),
        members: r.members,
      })),
    );
    return { teams };
  });

  // Create a team (creator becomes its first member).
  app.post("/", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    if (ctx.teamId) return reply.code(409).send({ error: "in_team", message: "leave your team first" });
    const parsed = CreateTeam.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "name" });
    const { ok } = await tripFormable(ctx.tripId);
    if (!ok) return reply.code(409).send({ error: "locked", message: "teams are locked" });

    const nameEnc = await encrypt(ctx.tripId, Buffer.from(parsed.data.name, "utf8"));
    const teamId = await tx(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO team (trip_id, name_enc) VALUES ($1, $2) RETURNING id`,
        [ctx.tripId, Buffer.from(nameEnc, "utf8")],
      );
      const id = rows[0]!.id;
      await c.query(
        `INSERT INTO team_member (team_id, student_id, trip_id) VALUES ($1, $2, $3)`,
        [id, ctx.studentId, ctx.tripId],
      );
      return id;
    });
    return reply.code(201).send({ teamId });
  });

  // Join an existing team.
  app.post("/join", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    if (ctx.teamId) return reply.code(409).send({ error: "in_team", message: "leave your team first" });
    const parsed = JoinTeam.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "teamId" });
    const { ok, maxTeamSize } = await tripFormable(ctx.tripId);
    if (!ok) return reply.code(409).send({ error: "locked", message: "teams are locked" });

    try {
      await tx(async (c) => {
        // Lock the TEAM row so concurrent joins serialize on the capacity check.
        // (Postgres forbids FOR UPDATE on a COUNT(*) — "not allowed with aggregate
        // functions" — so we lock the parent row, then count separately.)
        const team = await c.query(
          `SELECT 1 FROM team WHERE id = $1 AND trip_id = $2 FOR UPDATE`,
          [parsed.data.teamId, ctx.tripId],
        );
        if (!team.rowCount) throw Object.assign(new Error("no team"), { httpNotFound: true });

        const { rows } = await c.query<{ members: number }>(
          `SELECT COUNT(*)::int AS members FROM team_member WHERE team_id = $1 AND trip_id = $2`,
          [parsed.data.teamId, ctx.tripId],
        );
        if ((rows[0]?.members ?? 0) >= maxTeamSize) {
          throw Object.assign(new Error("full"), { httpFull: true });
        }
        await c.query(
          `INSERT INTO team_member (team_id, student_id, trip_id) VALUES ($1, $2, $3)`,
          [parsed.data.teamId, ctx.studentId, ctx.tripId],
        );
      });
    } catch (e: any) {
      if (e?.httpNotFound) return reply.code(404).send({ error: "not_found", message: "no such team" });
      if (e?.httpFull) return reply.code(409).send({ error: "full", message: "team is full" });
      if (e?.code === "23505") return reply.code(409).send({ error: "in_team", message: "already in a team" });
      throw e;
    }
    return { ok: true };
  });

  // Leave your team (deletes the team if it becomes empty).
  app.post("/leave", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    if (!ctx.teamId) return reply.code(409).send({ error: "no_team", message: "not in a team" });
    const { ok } = await tripFormable(ctx.tripId);
    if (!ok) return reply.code(409).send({ error: "locked", message: "teams are locked" });

    await tx(async (c) => {
      await c.query(`DELETE FROM team_member WHERE team_id = $1 AND student_id = $2`, [
        ctx.teamId, ctx.studentId,
      ]);
      await c.query(
        `DELETE FROM team t WHERE t.id = $1
           AND NOT EXISTS (SELECT 1 FROM team_member m WHERE m.team_id = t.id)`,
        [ctx.teamId],
      );
    });
    return { ok: true };
  });
}
