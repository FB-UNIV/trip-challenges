// Co-teacher invites. The OWNER emails a staff member an invite link; the recipient
// signs in via OIDC and accepts, which grants role 'co' on the Trip.
// Security: the link carries a high-entropy single-use token (we store only its SHA-256),
// it expires, AND on accept the signed-in teacher's email must match the invited address —
// so a forwarded link can't grant a stranger access to minors' data.
import type { FastifyInstance } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { InviteCoTeacher, AcceptInvite } from "@trip/shared";
import { config } from "../config.js";
import { pool } from "../db.js";
import { guard, tripFrom, teacherOf, tripOf } from "../auth/guard.js";
import { sendCoTeacherInvite } from "../email/mailer.js";

const INVITE_TTL_DAYS = 7;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Trip-scoped management (mounted under /api/trips).
export async function tripInviteRoutes(app: FastifyInstance) {
  const member = guard({ role: "teacher", trip: tripFrom.trip("params.id") });

  // Current teachers on the Trip (for the admin UI).
  app.get("/:id/teachers", { preHandler: member }, async (req) => {
    const tripId = tripOf(req).id;
    const { rows } = await pool.query(
      `SELECT t.id, t.email, t.display_name, tt.role
         FROM trip_teacher tt JOIN teacher t ON t.id = tt.teacher_id
        WHERE tt.trip_id = $1
        ORDER BY tt.role = 'owner' DESC, t.email`,
      [tripId],
    );
    return { teachers: rows };
  });

  // Pending (unaccepted, unexpired) invites.
  app.get("/:id/invites", { preHandler: member }, async (req) => {
    const tripId = tripOf(req).id;
    const { rows } = await pool.query(
      `SELECT id, email, expires_at
         FROM trip_teacher_invite
        WHERE trip_id = $1 AND accepted_at IS NULL AND expires_at > now()
        ORDER BY email`,
      [tripId],
    );
    return { invites: rows };
  });

  // Invite a co-teacher by email (owner only).
  app.post("/:id/invites", {
    preHandler: guard({ role: "teacher", trip: tripFrom.trip("params.id"), owner: "only the trip owner can invite co-teachers" }),
  }, async (req, reply) => {
    const teacher = teacherOf(req);
    const tripId = tripOf(req).id;
    const parsed = InviteCoTeacher.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.message });
    const email = parsed.data.email.trim().toLowerCase();

    // Already a member? (citext compare)
    const member = await pool.query(
      `SELECT 1 FROM trip_teacher tt JOIN teacher t ON t.id = tt.teacher_id
        WHERE tt.trip_id = $1 AND t.email = $2`,
      [tripId, email],
    );
    if (member.rowCount) return reply.code(409).send({ error: "already_member", message: "already a teacher on this trip" });

    const { rows: tripRows } = await pool.query<{ name: string }>(`SELECT name FROM trip WHERE id = $1`, [tripId]);
    const tripName = tripRows[0]?.name ?? "the trip";

    const token = randomBytes(32).toString("base64url"); // 256-bit
    const tokenHash = sha256(token);
    const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

    // Supersede any prior pending invite to the same address.
    await pool.query(
      `DELETE FROM trip_teacher_invite WHERE trip_id = $1 AND email = $2 AND accepted_at IS NULL`,
      [tripId, email],
    );
    await pool.query(
      `INSERT INTO trip_teacher_invite (trip_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tripId, email, tokenHash, expires],
    );

    const acceptUrl = `${config.PUBLIC_BASE_URL}/teacher/accept?token=${encodeURIComponent(token)}`;
    await sendCoTeacherInvite(email, tripName, acceptUrl);
    await pool.query(
      `INSERT INTO audit_log (trip_id, teacher_id, action) VALUES ($1, $2, 'coteacher_invited')`,
      [tripId, teacher.teacherId],
    );
    return reply.code(201).send({ invited: email });
  });

  // Revoke a pending invite (owner only).
  app.delete("/:id/invites/:inviteId", {
    preHandler: guard({
      role: "teacher",
      params: z.object({ id: z.string(), inviteId: z.string().uuid() }),
      trip: tripFrom.trip("params.id"),
      owner: "only the trip owner can revoke invites",
    }),
  }, async (req) => {
    const tripId = tripOf(req).id;
    const { inviteId } = req.params as { inviteId: string };
    await pool.query(
      `DELETE FROM trip_teacher_invite WHERE id = $1 AND trip_id = $2 AND accepted_at IS NULL`,
      [inviteId, tripId],
    );
    return { ok: true };
  });
}

// Recipient-facing (mounted under /api/invites).
export async function inviteRoutes(app: FastifyInstance) {
  // Preview an invite by token — shows what the recipient is accepting (no auth;
  // possession of the token is the credential). Never reveals more than the invitee already knows.
  app.get("/preview", {
    preHandler: guard({ role: "public", query: z.object({ token: z.string().min(1) }) }),
  }, async (req, reply) => {
    const { token } = req.query as { token: string };
    const { rows } = await pool.query<{ email: string; trip_name: string; expired: boolean }>(
      `SELECT i.email, t.name AS trip_name, i.expires_at <= now() AS expired
         FROM trip_teacher_invite i JOIN trip t ON t.id = i.trip_id
        WHERE i.token_hash = $1 AND i.accepted_at IS NULL`,
      [sha256(token)],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found", message: "invite not found or already used" });
    return rows[0];
  });

  // Accept an invite (must be signed in as a teacher).
  app.post("/accept", { preHandler: guard({ role: "teacher" }) }, async (req, reply) => {
    const teacher = teacherOf(req);
    const parsed = AcceptInvite.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "token" });

    // Look up by token WITHOUT the accepted_at filter so a repeat accept is idempotent
    // rather than a confusing 404. The client auto-accepts on mount and React StrictMode
    // double-invokes effects in dev, so the same valid token legitimately arrives twice;
    // re-clicking an already-accepted (but unexpired) link should also just succeed.
    const { rows } = await pool.query<{ id: string; trip_id: string; email: string; expired: boolean; accepted_at: string | null }>(
      `SELECT id, trip_id, email, expires_at <= now() AS expired, accepted_at
         FROM trip_teacher_invite
        WHERE token_hash = $1`,
      [sha256(parsed.data.token)],
    );
    const invite = rows[0];
    if (!invite || invite.expired) {
      return reply.code(404).send({ error: "not_found", message: "invite invalid or expired" });
    }

    // Bind the invite to the intended recipient: the signed-in teacher's email must match.
    const { rows: me } = await pool.query<{ email: string }>(`SELECT email FROM teacher WHERE id = $1`, [teacher.teacherId]);
    if ((me[0]?.email ?? "").toLowerCase() !== invite.email.toLowerCase()) {
      return reply.code(403).send({ error: "wrong_account", message: "this invite was sent to a different email address" });
    }

    // Idempotent: ensure membership, mark accepted + audit only on the first accept.
    await pool.query(
      `INSERT INTO trip_teacher (trip_id, teacher_id, role) VALUES ($1, $2, 'co')
       ON CONFLICT (trip_id, teacher_id) DO NOTHING`,
      [invite.trip_id, teacher.teacherId],
    );
    if (!invite.accepted_at) {
      await pool.query(`UPDATE trip_teacher_invite SET accepted_at = now() WHERE id = $1`, [invite.id]);
      await pool.query(
        `INSERT INTO audit_log (trip_id, teacher_id, action) VALUES ($1, $2, 'coteacher_joined')`,
        [invite.trip_id, teacher.teacherId],
      );
    }
    return { ok: true, tripId: invite.trip_id };
  });
}
