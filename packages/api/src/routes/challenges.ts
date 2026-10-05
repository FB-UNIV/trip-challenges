// Challenges (Teacher-authored). Each gets a static qr_slug; the printed QR encodes
// PUBLIC_BASE_URL/c/<slug>. Challenge content is non-PII and survives Erasure.
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { ChallengeInput, ChallengePatch } from "@trip/shared";
import { config } from "../config.js";
import { pool } from "../db.js";
import { requireTeacher, assertTripAccess } from "../auth/teacher.js";
import { requireStudent } from "../auth/student.js";

const CreateChallenge = ChallengeInput.extend({ tripId: z.string().uuid() });

export async function challengeRoutes(app: FastifyInstance) {
  // Create (teacher, must own/co the Trip).
  app.post("/", async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const parsed = CreateChallenge.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
    }
    const { tripId, title, instructions, multiplier } = parsed.data;
    if (!(await assertTripAccess(teacher.teacherId, tripId))) {
      return reply.code(404).send({ error: "not_found", message: "no such trip" });
    }
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
  app.patch("/:id", async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const id = (req.params as { id: string }).id;
    const parsed = ChallengePatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });

    const ch = await challengeWithPhase(id);
    if (!ch || !(await assertTripAccess(teacher.teacherId, ch.trip_id))) {
      return reply.code(404).send({ error: "not_found", message: "challenge" });
    }
    if (rank(ch.phase) >= rank("reveal")) {
      return reply.code(409).send({ error: "locked_in_phase", message: "challenges can't be edited once results are computed" });
    }

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
  app.delete("/:id", async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const id = (req.params as { id: string }).id;
    const ch = await challengeWithPhase(id);
    if (!ch || !(await assertTripAccess(teacher.teacherId, ch.trip_id))) {
      return reply.code(404).send({ error: "not_found", message: "challenge" });
    }
    if (ch.phase !== "draft") {
      return reply.code(409).send({ error: "locked_in_phase", message: "a challenge can only be deleted while the trip is in draft" });
    }
    await pool.query(`DELETE FROM challenge WHERE id = $1`, [id]);
    return { ok: true };
  });

  // List a Trip's challenges (teacher).
  app.get("/", async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const tripId = (req.query as any)?.tripId as string | undefined;
    if (!tripId || !(await assertTripAccess(teacher.teacherId, tripId))) {
      return reply.code(404).send({ error: "not_found", message: "no such trip" });
    }
    const { rows } = await pool.query(
      `SELECT id, title, instructions, multiplier, qr_slug FROM challenge WHERE trip_id = $1`,
      [tripId],
    );
    return { challenges: rows };
  });

  // Student: list challenges in my Trip (for the voting screen).
  app.get("/for-student", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    const { rows } = await pool.query(
      `SELECT id, title, instructions FROM challenge WHERE trip_id = $1`,
      [ctx.tripId],
    );
    return { challenges: rows };
  });

  // Public: resolve a scanned slug to basic Challenge info (shown before login).
  app.get("/by-slug/:slug", async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const { rows } = await pool.query(
      `SELECT id, title, instructions FROM challenge WHERE qr_slug = $1`,
      [slug],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found", message: "challenge" });
    return rows[0];
  });

  // Printable QR (teacher).
  app.get("/:id/qr.png", async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const id = (req.params as { id: string }).id;
    const { rows } = await pool.query<{ qr_slug: string; trip_id: string }>(
      `SELECT qr_slug, trip_id FROM challenge WHERE id = $1`,
      [id],
    );
    const ch = rows[0];
    if (!ch || !(await assertTripAccess(teacher.teacherId, ch.trip_id))) {
      return reply.code(404).send({ error: "not_found", message: "challenge" });
    }
    const png = await QRCode.toBuffer(`${config.PUBLIC_BASE_URL}/c/${ch.qr_slug}`, {
      type: "png",
      width: 512,
      margin: 2,
    });
    reply.header("content-type", "image/png");
    return reply.send(png);
  });
}

const PHASES = ["draft", "challenge", "voting", "reveal", "grace", "erased"];
const rank = (p: string) => PHASES.indexOf(p);

async function challengeWithPhase(id: string): Promise<{ trip_id: string; phase: string } | undefined> {
  const { rows } = await pool.query<{ trip_id: string; phase: string }>(
    `SELECT c.trip_id, t.phase FROM challenge c JOIN trip t ON t.id = c.trip_id WHERE c.id = $1`,
    [id],
  );
  return rows[0];
}
