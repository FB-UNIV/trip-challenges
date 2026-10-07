// Challenges (Teacher-authored). Each gets a static qr_slug; the printed QR encodes
// PUBLIC_BASE_URL/c/<slug>. Challenge content is non-PII and survives Erasure.
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { ChallengeInput, ChallengePatch, type StudentChallengeList, type VoteProgress } from "@trip/shared";
import { config } from "../config.js";
import { pool } from "../db.js";
import { guard, tripFrom, studentOf, tripOf, type Phase } from "../auth/guard.js";

const CreateChallenge = ChallengeInput.extend({ tripId: z.string().uuid() });

export async function challengeRoutes(app: FastifyInstance) {
  const ofMyChallenge = (phases?: Phase[], message?: string) => guard({
    role: "teacher",
    trip: tripFrom.challenge("params.id"),
    phases,
    closed: message ? { status: 409, body: { error: "locked_in_phase", message } } : undefined,
  });

  // Create (teacher, must own/co the Trip).
  app.post("/", {
    preHandler: guard({ role: "teacher", body: CreateChallenge, trip: tripFrom.trip("body.tripId") }),
  }, async (req, reply) => {
    const tripId = tripOf(req).id;
    const { title, instructions, multiplier } = req.body as z.infer<typeof CreateChallenge>;
    const qrSlug = randomBytes(8).toString("base64url");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO challenge (trip_id, title, instructions, multiplier, qr_slug)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tripId, title, instructions, multiplier, qrSlug],
    );
    return reply.code(201).send({ id: rows[0]!.id, qrSlug });
  });

  // Edit content (teacher). Title/instructions/multiplier only; the qr_slug never changes.
  // Allowed until results are computed (phase < reveal) — see data-model.md#editability.
  app.patch("/:id", {
    preHandler: ofMyChallenge(["draft", "challenge", "voting"], "challenges can't be edited once results are computed"),
  }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = ChallengePatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, col] of [["title", "title"], ["instructions", "instructions"], ["multiplier", "multiplier"]] as const) {
      const v = (parsed.data as Record<string, unknown>)[key];
      if (v !== undefined) { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); }
    }
    if (!sets.length) return { ok: true };
    vals.push(id);
    await pool.query(`UPDATE challenge SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    return { ok: true };
  });

  // Delete (teacher) — draft only: once a Trip leaves draft the QR may be printed/distributed,
  // and deleting would leave a dead QR in the wild (data-model.md#editability).
  app.delete("/:id", {
    preHandler: ofMyChallenge(["draft"], "a challenge can only be deleted while the trip is in draft"),
  }, async (req) => {
    const id = (req.params as { id: string }).id;
    await pool.query(`DELETE FROM challenge WHERE id = $1`, [id]);
    return { ok: true };
  });

  // List a Trip's challenges (teacher).
  app.get("/", { preHandler: guard({ role: "teacher", trip: tripFrom.trip("query.tripId") }) }, async (req) => {
    const tripId = tripOf(req).id;
    const { rows } = await pool.query(
      `SELECT id, title, instructions, multiplier, qr_slug FROM challenge WHERE trip_id = $1`,
      [tripId],
    );
    return { challenges: rows };
  });

  // Student: my Trip's challenges with *my* progress (checklist + vote list). Only the
  // caller's own Team's photos and own Duels are counted, never other Teams' activity.
  app.get("/for-student", { preHandler: guard({ role: "student" }) }, async (req): Promise<StudentChallengeList> => {
    const ctx = studentOf(req);
    const trip = tripOf(req);
    // Eligible = what /api/duels/next may pair for this voter: approved, active, not my Team's.
    // A duel only counts while both its Nominations are still eligible.
    const { rows } = await pool.query<{
      id: string; title: string; instructions: string; qr_slug: string;
      photos: number; nominated: boolean; eligible: number; voted: number;
    }>(
      `WITH eligible AS (
         SELECT id, challenge_id FROM nomination
          WHERE trip_id = $1 AND active AND state = 'approved' AND team_id IS DISTINCT FROM $2::uuid
       )
       SELECT c.id, c.title, c.instructions, c.qr_slug,
              (SELECT count(*)::int FROM submission s
                WHERE s.challenge_id = c.id AND s.team_id = $2 AND s.removed_by_teacher_id IS NULL) AS photos,
              EXISTS (SELECT 1 FROM nomination n
                       WHERE n.challenge_id = c.id AND n.team_id = $2 AND n.active) AS nominated,
              (SELECT count(*)::int FROM eligible e WHERE e.challenge_id = c.id) AS eligible,
              (SELECT count(*)::int FROM duel d
                WHERE d.challenge_id = c.id AND d.voter_student_id = $3
                  AND d.low_nomination_id IN (SELECT id FROM eligible)
                  AND d.high_nomination_id IN (SELECT id FROM eligible)) AS voted
         FROM challenge c
        WHERE c.trip_id = $1
        ORDER BY c.title, c.id`,
      [ctx.tripId, ctx.teamId, ctx.studentId],
    );
    const votingOpen = trip.phase === "voting" && !trip.votingClosed;
    return {
      challenges: rows.map((r) => ({
        id: r.id,
        title: r.title,
        instructions: r.instructions,
        qrSlug: r.qr_slug,
        photos: r.photos,
        nominated: r.nominated,
        vote: votingOpen ? voteProgress(r.eligible, r.voted) : null,
      })),
    };
  });

  // Public: resolve a scanned slug to basic Challenge info (shown before login).
  app.get("/by-slug/:slug", { preHandler: guard({ role: "public" }) }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const { rows } = await pool.query(
      `SELECT id, title, instructions FROM challenge WHERE qr_slug = $1`,
      [slug],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found", message: "challenge" });
    return rows[0];
  });

  // Printable QR (teacher).
  app.get("/:id/qr.png", { preHandler: ofMyChallenge() }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { rows } = await pool.query<{ qr_slug: string }>(`SELECT qr_slug FROM challenge WHERE id = $1`, [id]);
    const ch = rows[0]!;
    const png = await QRCode.toBuffer(`${config.PUBLIC_BASE_URL}/c/${ch.qr_slug}`, {
      type: "png",
      width: 512,
      margin: 2,
    });
    reply.header("content-type", "image/png");
    return reply.send(png);
  });
}

/** Pairs a voter can be shown among `eligible` Nominations, and how far through them they are. */
export function voteProgress(eligible: number, voted: number): VoteProgress {
  const total = (eligible * (eligible - 1)) / 2;
  if (total === 0) return { voted: 0, total: 0, status: "not_enough" };
  const status = voted >= total ? "done" : voted > 0 ? "in_progress" : "todo";
  return { voted: Math.min(voted, total), total, status };
}
