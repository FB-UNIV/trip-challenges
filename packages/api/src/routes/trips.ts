// Trip lifecycle. Creating a Trip provisions its Vault key (ADR-0001) up front,
// so every subsequent 🔒 write has a key to encrypt under.
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { TripConfig, TripConfigPatch } from "@trip/shared";
import { pool, tx } from "../db.js";
import { readTeacher, assertTripAccess } from "../auth/teacher.js";
import { guard, tripFrom, teacherOf, tripOf, type Phase } from "../auth/guard.js";
import { createTripKey, destroyTripKey, keyName } from "../crypto/vault.js";
import { advanceTrip } from "../lifecycle.js";
import { eraseTrip } from "../erasure.js";

export async function tripRoutes(app: FastifyInstance) {
  const anyTeacher = guard({ role: "teacher" });
  const member = guard({ role: "teacher", trip: tripFrom.trip("params.id") });

  // Create a Trip (owner = caller).
  app.post("/", { preHandler: anyTeacher }, async (req, reply) => {
    const teacher = teacherOf(req);
    const parsed = TripConfig.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
    }
    const cfg = parsed.data;

    const id = randomUUID();
    const hardEraseAt = new Date(cfg.tripEndDate);
    hardEraseAt.setDate(hardEraseAt.getDate() + cfg.maxRetentionDays);

    // Provision the crypto key first; roll it back if the DB write fails.
    await createTripKey(id);
    try {
      await tx(async (c) => {
        await c.query(
          `INSERT INTO trip
             (id, name, owner_teacher_id, max_team_size, points_table,
              challenge_opens_at, voting_opens_at, voting_closes_at,
              grace_days, trip_end_date, max_retention_days, hard_erase_at, vault_key_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            id, cfg.name, teacher.teacherId, cfg.maxTeamSize, JSON.stringify(cfg.pointsTable),
            cfg.challengeOpensAt ?? null, cfg.votingOpensAt ?? null, cfg.votingClosesAt ?? null,
            cfg.graceDays, cfg.tripEndDate, cfg.maxRetentionDays, hardEraseAt, keyName(id),
          ],
        );
        await c.query(
          `INSERT INTO trip_teacher (trip_id, teacher_id, role) VALUES ($1, $2, 'owner')`,
          [id, teacher.teacherId],
        );
        await c.query(
          `INSERT INTO audit_log (trip_id, teacher_id, action) VALUES ($1, $2, 'trip_created')`,
          [id, teacher.teacherId],
        );
      });
    } catch (e) {
      await destroyTripKey(id).catch(() => {}); // avoid orphaned key
      throw e;
    }
    return reply.code(201).send({ id });
  });

  // List Trips the caller manages.
  app.get("/", { preHandler: anyTeacher }, async (req) => {
    const teacher = teacherOf(req);
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.phase, t.trip_end_date, t.hard_erase_at, tt.role
         FROM trip t
         JOIN trip_teacher tt ON tt.trip_id = t.id
        WHERE tt.teacher_id = $1
        ORDER BY t.created_at DESC`,
      [teacher.teacherId],
    );
    return { trips: rows };
  });

  // Get one Trip (must be a member).
  app.get("/:id", { preHandler: member }, async (req, reply) => {
    const id = tripOf(req).id;
    const { rows } = await pool.query(
      `SELECT id, name, phase, max_team_size, points_table, challenge_opens_at,
              voting_opens_at, voting_closes_at, grace_days, trip_end_date,
              max_retention_days, hard_erase_at
         FROM trip WHERE id = $1`,
      [id],
    );
    return rows[0];
  });

  // Advance the phase (teacher-confirmed transition).
  app.post("/:id/advance", { preHandler: member }, async (req, reply) => {
    const id = tripOf(req).id;
    const to = (req.body as { to?: string })?.to;
    if (!to) return reply.code(400).send({ error: "bad_request", message: "to" });
    try {
      await advanceTrip(id, to);
    } catch (e: any) {
      if (e?.illegal) return reply.code(409).send({ error: "illegal_transition", message: e.message });
      throw e;
    }
    return { ok: true, phase: to };
  });

  // What's ready and what's missing, for the teacher's overview. Counts only (ADR 0001).
  // eraseAt mirrors findTripsDueForErasure(): the grace window only counts once in grace.
  app.get("/:id/progress", { preHandler: member }, async (req) => {
    const id = tripOf(req).id;
    const { rows: [t] } = await pool.query<{
      phase: string; hard_erase_at: Date; grace_ends_at: Date | null;
      students: number; teams: number; without_team: number;
    }>(
      `SELECT phase, hard_erase_at,
              voting_closes_at + (grace_days || ' days')::interval AS grace_ends_at,
              (SELECT count(*)::int FROM student s WHERE s.trip_id = t.id) AS students,
              (SELECT count(DISTINCT m.team_id)::int FROM team_member m WHERE m.trip_id = t.id) AS teams,
              (SELECT count(*)::int FROM student s WHERE s.trip_id = t.id
                  AND NOT EXISTS (SELECT 1 FROM team_member m WHERE m.student_id = s.id)) AS without_team
         FROM trip t WHERE t.id = $1`,
      [id],
    );
    const { rows: challenges } = await pool.query(
      `SELECT c.id, c.title,
              (SELECT count(DISTINCT s.team_id)::int FROM submission s
                WHERE s.challenge_id = c.id AND s.removed_by_teacher_id IS NULL) AS "teamsWithPhotos",
              count(n.id) FILTER (WHERE n.state = 'pending')::int AS pending,
              count(n.id) FILTER (WHERE n.state = 'approved')::int AS approved,
              count(n.id) FILTER (WHERE n.state = 'rejected')::int AS rejected
         FROM challenge c
         LEFT JOIN nomination n ON n.challenge_id = c.id AND n.active
        WHERE c.trip_id = $1
        GROUP BY c.id
        ORDER BY c.title, c.id`,
      [id],
    );
    const graceEndsAt = t!.grace_ends_at;
    const eraseAt = t!.phase === "grace" && graceEndsAt && graceEndsAt < t!.hard_erase_at ? graceEndsAt : t!.hard_erase_at;
    return {
      students: t!.students,
      teams: t!.teams,
      studentsWithoutTeam: t!.without_team,
      challenges,
      eraseAt: eraseAt.toISOString(),
      graceEndsAt: graceEndsAt?.toISOString() ?? null,
    };
  });

  // Fire Erasure early (teacher). Irreversible.
  app.post("/:id/erase", { preHandler: member }, async (req, reply) => {
    const id = tripOf(req).id;
    await eraseTrip(id);
    return { ok: true, erased: true };
  });

  // Results (non-PII, survive Erasure). Reveal gating (CONTEXT: Grand Champion):
  // results are NOT publicly viewable until the teacher finishes the projector ceremony
  // and advances reveal->grace. Until then only a Trip teacher (running the ceremony) may
  // read them, so student phones can't leak the leaderboard ahead of the shared reveal.
  // From 'grace' onward they are a public keepsake (and survive Erasure).
  app.get("/:id/results", { preHandler: guard({ role: "public" }) }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { rows: tr } = await pool.query<{ phase: string }>(
      `SELECT phase FROM trip WHERE id = $1`,
      [id],
    );
    const phase = tr[0]?.phase;
    if (!phase) return { results: [] };

    const published = phase === "grace" || phase === "erased";
    if (!published) {
      const teacher = readTeacher(req, reply);
      if (!teacher || !(await assertTripAccess(teacher.teacherId, id))) {
        return { results: [] }; // not yet published; not a Trip teacher
      }
    }

    const { rows } = await pool.query(
      `SELECT id, challenge_title, placement, team_name_vetted, points, is_grand_champion
         FROM result WHERE trip_id = $1
        ORDER BY is_grand_champion DESC, challenge_title, placement`,
      [id],
    );
    return { results: rows };
  });

  // Break a Grand Champion tie (CONTEXT: Grand Champion — the ONLY tie the Teacher
  // hand-breaks). computeResults flags every top-total Team as a co-champion; the Teacher
  // picks one during the ceremony (phase 'reveal', before results publish at reveal->grace).
  // The chosen row stays; the other co-champion rows are dropped.
  app.post("/:id/grand-champion", {
    preHandler: guard({
      role: "teacher",
      trip: tripFrom.trip("params.id"),
      phases: ["reveal"],
      closed: { status: 409, body: { error: "wrong_phase", message: "tie-break is only available during the reveal" } },
    }),
  }, async (req, reply) => {
    const teacher = teacherOf(req);
    const id = tripOf(req).id;
    const resultId = (req.body as { resultId?: string })?.resultId;
    if (!resultId) return reply.code(400).send({ error: "bad_request", message: "resultId" });

    // The chosen row must be one of THIS trip's co-champion rows.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM result WHERE id = $1 AND trip_id = $2 AND is_grand_champion`,
      [resultId, id],
    );
    if (!rowCount) return reply.code(404).send({ error: "not_found", message: "not a co-champion of this trip" });

    await pool.query(
      `DELETE FROM result
        WHERE trip_id = $1 AND is_grand_champion AND id <> $2`,
      [id, resultId],
    );
    await pool.query(
      `INSERT INTO audit_log (trip_id, teacher_id, action, target_opaque_id)
       VALUES ($1, $2, 'grand_champion_set', $3)`,
      [id, teacher.teacherId, resultId],
    );
    return { ok: true };
  });

  // Edit Trip config after creation — phase-gated per docs/data-model.md#editability.
  // Any provided field that isn't editable in the current phase rejects the whole request.
  app.patch("/:id", {
    preHandler: guard({
      role: "teacher",
      trip: tripFrom.trip("params.id"),
      phases: LIVE,
      closed: { status: 409, body: { error: "erased", message: "trip is erased" } },
    }),
  }, async (req, reply) => {
    const teacher = teacherOf(req);
    const id = tripOf(req).id;
    const parsed = TripConfigPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
    const patch = parsed.data;

    const { phase } = tripOf(req);
    const { rows: cur } = await pool.query<{ trip_end_date: string; max_retention_days: number }>(
      `SELECT trip_end_date, max_retention_days FROM trip WHERE id = $1`,
      [id],
    );
    const trip = cur[0]!;

    const beforeReveal = rank(phase) < rank("reveal");
    const draftOnly = phase === "draft";

    // field key -> [db column, value, editable in this phase?]
    const fields: Record<string, [string, unknown, boolean]> = {};
    if (patch.name !== undefined)             fields.name = ["name", patch.name, true];
    if (patch.pointsTable !== undefined)      fields.pointsTable = ["points_table", JSON.stringify(patch.pointsTable), beforeReveal];
    if (patch.challengeOpensAt !== undefined) fields.challengeOpensAt = ["challenge_opens_at", patch.challengeOpensAt, true];
    if (patch.votingOpensAt !== undefined)    fields.votingOpensAt = ["voting_opens_at", patch.votingOpensAt, true];
    if (patch.votingClosesAt !== undefined)   fields.votingClosesAt = ["voting_closes_at", patch.votingClosesAt, true];
    if (patch.graceDays !== undefined)        fields.graceDays = ["grace_days", patch.graceDays, true];
    if (patch.tripEndDate !== undefined)      fields.tripEndDate = ["trip_end_date", patch.tripEndDate, true];
    if (patch.maxRetentionDays !== undefined) fields.maxRetentionDays = ["max_retention_days", patch.maxRetentionDays, true];
    if (patch.maxTeamSize !== undefined)      fields.maxTeamSize = ["max_team_size", patch.maxTeamSize, draftOnly];

    const blocked = Object.keys(fields).filter((k) => !fields[k]![2]);
    if (blocked.length) {
      return reply.code(409).send({
        error: "locked_in_phase",
        message: `not editable in phase '${phase}': ${blocked.join(", ")}`,
      });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [col, val] of Object.values(fields)) { sets.push(`${col} = $${vals.length + 1}`); vals.push(val); }

    // hard_erase_at is derived from trip_end_date + max_retention_days — recompute if either moved.
    if (patch.tripEndDate !== undefined || patch.maxRetentionDays !== undefined) {
      const endDate = patch.tripEndDate ?? new Date(trip.trip_end_date);
      const retention = patch.maxRetentionDays ?? trip.max_retention_days;
      const hardErase = new Date(endDate);
      hardErase.setDate(hardErase.getDate() + retention);
      sets.push(`hard_erase_at = $${vals.length + 1}`); vals.push(hardErase);
    }

    if (!sets.length) return { ok: true }; // empty patch — nothing to do
    vals.push(id);
    await pool.query(`UPDATE trip SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    await pool.query(
      `INSERT INTO audit_log (trip_id, teacher_id, action) VALUES ($1, $2, 'trip_config_edited')`,
      [id, teacher.teacherId],
    );
    return { ok: true };
  });
}

// Phase ordering for editability gates (draft < challenge < ... < erased).
const PHASES: Phase[] = ["draft", "challenge", "voting", "reveal", "grace", "erased"];
const LIVE = PHASES.filter((p) => p !== "erased");
const rank = (p: string) => PHASES.indexOf(p as Phase);
