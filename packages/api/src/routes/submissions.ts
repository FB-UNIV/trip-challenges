// Submission upload + photo fetch + teacher removal. Photos are normalized
// (EXIF/GPS stripped) and envelope-encrypted before hitting MinIO.
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { requireStudent } from "../auth/student.js";
import { readTeacher, assertTripAccess } from "../auth/teacher.js";
import { guard, tripFrom, studentOf, teacherOf, tripOf } from "../auth/guard.js";
import { normalizeImage } from "../lib/image.js";
import { sealBlob, openBlob } from "../crypto/envelope.js";
import { putBlob, getBlob, blobKey } from "../storage/s3.js";
import { avScanEnabled, scanBuffer } from "../security/avscan.js";

export async function submissionRoutes(app: FastifyInstance) {
  // Upload a photo for a Challenge (any team member; challenge phase only).
  app.post("/", {
    preHandler: guard({
      role: "student",
      query: z.object({ challengeId: z.string() }),
      trip: tripFrom.challenge("query.challengeId"),
      phases: ["challenge"],
      closed: { status: 409, body: { error: "closed", message: "submissions are closed" } },
    }),
  }, async (req, reply) => {
    const ctx = studentOf(req);
    if (!ctx.teamId) return reply.code(409).send({ error: "no_team", message: "join a team first" });
    const { challengeId } = req.query as { challengeId: string };

    const file = await req.file();
    if (!file || !file.mimetype.startsWith("image/")) {
      return reply.code(400).send({ error: "bad_file", message: "image required" });
    }
    const raw = await file.toBuffer();

    // Antivirus scan on the ORIGINAL bytes, before any processing. Fail closed:
    // if scanning is enabled but clamd is unreachable, refuse the upload.
    if (avScanEnabled()) {
      let verdict;
      try {
        verdict = await scanBuffer(raw);
      } catch (e) {
        req.log.error({ err: e }, "av scan unavailable");
        return reply.code(503).send({ error: "scan_unavailable", message: "virus scan unavailable, try again later" });
      }
      if (!verdict.clean) {
        await pool.query(
          `INSERT INTO audit_log (trip_id, action) VALUES ($1, 'submission_infected_rejected')`,
          [ctx.tripId],
        );
        return reply.code(422).send({ error: "infected", message: "file failed the virus scan" });
      }
    }

    const normalized = await normalizeImage(raw).catch(() => null);
    if (!normalized) return reply.code(400).send({ error: "bad_image", message: "unreadable image" });

    const submissionId = randomUUID();
    const key = blobKey(ctx.tripId, submissionId);
    await putBlob(key, await sealBlob(ctx.tripId, normalized.bytes));

    await pool.query(
      `INSERT INTO submission
         (id, trip_id, challenge_id, team_id, uploaded_by_student_id, blob_key, content_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [submissionId, ctx.tripId, challengeId, ctx.teamId, ctx.studentId, key, normalized.contentType],
    );
    return reply.code(201).send({ id: submissionId });
  });

  // List my team's submissions for a challenge (to nominate from).
  app.get("/", { preHandler: guard({ role: "student", query: z.object({ challengeId: z.string() }) }) }, async (req) => {
    const ctx = studentOf(req);
    const { challengeId } = req.query as { challengeId: string };
    if (!ctx.teamId) return { submissions: [] };
    const { rows } = await pool.query(
      `SELECT s.id, s.created_at,
              EXISTS (SELECT 1 FROM nomination n WHERE n.submission_id = s.id AND n.active) AS nominated,
              -- #81: this photo's entry state; a rejected one stays marked.
              COALESCE(
                (SELECT n.state FROM nomination n WHERE n.submission_id = s.id AND n.active),
                (SELECT 'rejected' FROM nomination n
                  WHERE n.submission_id = s.id AND n.state = 'rejected' LIMIT 1)
              ) AS entry
         FROM submission s
        WHERE s.challenge_id = $1 AND s.team_id = $2 AND s.removed_by_teacher_id IS NULL
        ORDER BY s.created_at DESC`,
      [challengeId, ctx.teamId],
    );
    return { submissions: rows };
  });

  // Fetch a decrypted photo. Visible to: the owning Team always; a Teacher of the
  // Trip always (standing oversight); any authed student once it's an approved,
  // active Nomination and the Trip is voting/reveal. Mixed audience, so the checks stay here.
  app.get("/:id/photo", { preHandler: guard({ role: "public" }) }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { rows } = await pool.query<{
      trip_id: string;
      team_id: string;
      blob_key: string;
      content_type: string;
      removed: boolean;
      votable: boolean;
      phase: string;
    }>(
      `SELECT s.trip_id, s.team_id, s.blob_key, s.content_type,
              s.removed_by_teacher_id IS NOT NULL AS removed,
              EXISTS (SELECT 1 FROM nomination n
                       WHERE n.submission_id = s.id AND n.active AND n.state = 'approved') AS votable,
              t.phase
         FROM submission s JOIN trip t ON t.id = s.trip_id
        WHERE s.id = $1`,
      [id],
    );
    const s = rows[0];
    if (!s || s.removed) return reply.code(404).send({ error: "not_found", message: "photo" });

    let allowed = false;
    const teacher = readTeacher(req, reply);
    if (teacher && (await assertTripAccess(teacher.teacherId, s.trip_id))) {
      allowed = true; // teacher standing oversight
    } else {
      const ctx = await requireStudent(req);
      if (ctx && ctx.tripId === s.trip_id) {
        const ownTeam = ctx.teamId === s.team_id;
        const publicNow = s.votable && (s.phase === "voting" || s.phase === "reveal");
        allowed = ownTeam || publicNow;
      }
    }
    if (!allowed) return reply.code(403).send({ error: "forbidden", message: "not visible" });

    const plain = await openBlob(s.trip_id, await getBlob(s.blob_key));
    reply.header("content-type", s.content_type);
    reply.header("cache-control", "no-store"); // never cache minors' photos
    return reply.send(plain);
  });

  // Teacher standing removal of ANY submission (child-safety backstop).
  app.post("/:id/remove", {
    preHandler: guard({ role: "teacher", trip: tripFrom.submission("params.id") }),
  }, async (req) => {
    const teacher = teacherOf(req);
    const sub = { trip_id: tripOf(req).id };
    const id = (req.params as { id: string }).id;
    await pool.query(
      `UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`,
      [id, teacher.teacherId],
    );
    // Any nomination pointing at it is withdrawn.
    await pool.query(
      `UPDATE nomination SET active = false WHERE submission_id = $1 AND active`,
      [id],
    );
    await pool.query(
      `INSERT INTO audit_log (trip_id, teacher_id, action, target_opaque_id)
       VALUES ($1, $2, 'submission_removed', $3)`,
      [sub.trip_id, teacher.teacherId, id],
    );
    return { ok: true };
  });
}
