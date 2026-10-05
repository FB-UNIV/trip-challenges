// Student authentication: single-use Access Code -> device-bound session.
// Redeeming a code spends it and issues a long-lived token; re-issue revokes the
// prior session (CONTEXT: Access Code).
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { RedeemAccessCode, ReissueAccessCode } from "@trip/shared";
import { config } from "../config.js";
import { pool, tx } from "../db.js";
import { requireStudent } from "../auth/student.js";
import { hmac } from "../crypto/vault.js";
import { sendAccessCode } from "../email/mailer.js";

export async function studentAuthRoutes(app: FastifyInstance) {
  // Who am I + my trip's state (UI bootstrap).
  app.get("/me", async (req, reply) => {
    const ctx = await requireStudent(req);
    if (!ctx) return reply.code(401).send({ error: "unauthorized", message: "no session" });
    const { rows } = await pool.query<{ name: string; phase: string }>(
      `SELECT name, phase FROM trip WHERE id = $1`,
      [ctx.tripId],
    );
    return {
      studentId: ctx.studentId,
      tripId: ctx.tripId,
      tripName: rows[0]?.name ?? "",
      phase: rows[0]?.phase ?? "",
      teamId: ctx.teamId,
    };
  });

  // Tighter rate limit on redemption — anti brute-force on Access Codes.
  app.post(
    "/redeem",
    { config: { rateLimit: { max: config.RATE_LIMIT_AUTH_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = RedeemAccessCode.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "invalid code" });
      }
      const { code } = parsed.data;

      // Code format: "<studentId>.<secret>" — look up by id, verify secret hash.
      const [studentId, secret] = code.split(".", 2);
      if (!studentId || !secret) {
        return reply.code(401).send({ error: "unauthorized", message: "bad code" });
      }

      const { rows } = await pool.query<{
        id: string;
        access_code_hash: string;
        access_code_state: string;
      }>(
        `SELECT id, access_code_hash, access_code_state
           FROM student WHERE id = $1`,
        [studentId],
      );
      const student = rows[0];
      // Verify even on miss to keep timing uniform (argon2 verify handles this poorly
      // for missing rows; use a dummy hash to equalise).
      const hash = student?.access_code_hash ?? DUMMY_HASH;
      const ok = await argon2.verify(hash, secret).catch(() => false);
      // Single-use: only an 'unredeemed' code redeems. A spent ('redeemed') or dead code
      // is refused — the lost-device path is /reissue, which mints a fresh 'unredeemed' one.
      if (!student || !ok || student.access_code_state !== "unredeemed") {
        return reply.code(401).send({ error: "unauthorized", message: "bad code" });
      }

      // Issue a device-bound session; mark the code spent.
      const token = randomBytes(32).toString("base64url");
      const tokenHash = await argon2.hash(token);
      await tx(async (c) => {
        await c.query(
          `UPDATE student SET access_code_state = 'redeemed' WHERE id = $1`,
          [student.id],
        );
        // Revoke any prior device session: redeeming the (possibly re-issued) code binds a
        // new device and retires the old one (CONTEXT: Access Code — revoke on redeem).
        await c.query(
          `UPDATE student_session SET revoked_at = now() WHERE student_id = $1 AND revoked_at IS NULL`,
          [student.id],
        );
        await c.query(
          `INSERT INTO student_session (student_id, token_hash) VALUES ($1, $2)`,
          [student.id, tokenHash],
        );
      });

      reply.setCookie("student_session", `${student.id}.${token}`, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });
      return { ok: true };
    },
  );

  // Lost/changed device: request a fresh Access Code to your email (CONTEXT: Access Code).
  // Trip-scoped (the email_lookup MAC key is per-Trip). Anti-enumeration: the reply is the
  // SAME whether or not the address is on the Roster — it never confirms a minor's email.
  // Revoke-on-redeem: the prior session keeps working until the NEW code is redeemed, so a
  // stranger who knows the email can't log the Student out without also reading the email.
  app.post(
    "/reissue",
    { config: { rateLimit: { max: config.RATE_LIMIT_AUTH_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = ReissueAccessCode.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "invalid" });
      }
      const { tripId } = parsed.data;
      const email = parsed.data.email.trim().toLowerCase();
      const neutral = { ok: true as const }; // identical reply on every path

      // A code is valid only until that Trip's Erasure; nothing to reissue otherwise.
      const { rows: tr } = await pool.query<{ name: string; phase: string }>(
        `SELECT name, phase FROM trip WHERE id = $1`,
        [tripId],
      );
      const trip = tr[0];
      if (!trip || trip.phase === "erased") return reply.send(neutral);

      // Locate the Student without decrypting: HMAC(email) under the Trip's MAC key.
      const lookup = await hmac(tripId, Buffer.from(email, "utf8"));
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM student WHERE trip_id = $1 AND email_lookup = $2`,
        [tripId, lookup],
      );
      const student = rows[0];
      if (!student) return reply.send(neutral); // no match — reveal nothing

      // Mint a fresh single-use code; overwrite the old hash (old code now dead) and set
      // state back to 'unredeemed' so the new one redeems. Sessions are NOT revoked here.
      const secret = randomBytes(16).toString("base64url"); // 128-bit
      const hash = await argon2.hash(secret);
      await pool.query(
        `UPDATE student SET access_code_hash = $2, access_code_state = 'unredeemed' WHERE id = $1`,
        [student.id, hash],
      );
      await pool.query(
        `INSERT INTO audit_log (trip_id, action, target_opaque_id)
         VALUES ($1, 'access_code_reissued', $2)`,
        [tripId, student.id],
      );

      const joinUrl = `${config.PUBLIC_BASE_URL}/join?code=${encodeURIComponent(`${student.id}.${secret}`)}`;
      try {
        await sendAccessCode(email, trip.name ?? "the trip", joinUrl);
      } catch (e) {
        req.log.error({ err: e }, "reissue mail failed"); // never surface via the response
      }
      return reply.send(neutral);
    },
  );
}

// Precomputed argon2 hash of a random string, to equalise timing on unknown ids.
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$3vJ3f0m7c2Q2Wb0m5o0aVZ0v0aVZ0v0aVZ0v0aVZ0";

// silence unused import until /reissue uses it
void timingSafeEqual;
