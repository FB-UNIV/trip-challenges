// Student authentication: single-use Access Code -> device-bound session.
// Redeeming a code spends it and issues a long-lived token; re-issue revokes the
// prior session (CONTEXT: Access Code).
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashSessionToken } from "../auth/session-token.js";
import { RedeemAccessCode, ReissueAccessCode } from "@trip/shared";
import { config } from "../config.js";
import { pool, tx } from "../db.js";
import { guard, studentOf, tripOf } from "../auth/guard.js";
import { hmac } from "../crypto/vault.js";
import { sendAccessCode } from "../email/mailer.js";

export async function studentAuthRoutes(app: FastifyInstance) {
  // Who am I + my trip's state (UI bootstrap).
  app.get("/me", { preHandler: guard({ role: "student" }) }, async (req) => {
    const ctx = studentOf(req);
    const { rows } = await pool.query<{ name: string }>(
      `SELECT name FROM trip WHERE id = $1`,
      [ctx.tripId],
    );
    return {
      studentId: ctx.studentId,
      tripId: ctx.tripId,
      tripName: rows[0]?.name ?? "",
      phase: tripOf(req).phase,
      teamId: ctx.teamId,
    };
  });

  // Every attempt costs an argon2 verify, so it is bounded twice: per client address, sized
  // for a whole class joining from one school Wi-Fi address (#67), and per Access Code (its
  // student id) against brute force. A route's own rateLimit config replaces the global
  // per-IP one, and two plugin limiters don't stack on one route, so the address budget is
  // checked here, before the body is even read.
  const perAddress = app.hasDecorator("createRateLimit")
    ? app.createRateLimit({
        max: config.RATE_LIMIT_REDEEM_IP_MAX,
        timeWindow: "1 minute",
        keyGenerator: (req) => `redeem-ip:${req.ip}`,
      })
    : null;
  app.post(
    "/redeem",
    {
      onRequest: async (req, reply) => {
        const limit = perAddress && (await perAddress(req));
        if (limit && !limit.isAllowed && limit.isExceeded) {
          return reply.code(429).send({ error: "rate_limited", message: "Trop de requêtes — réessaie dans une minute." });
        }
      },
      preHandler: guard({ role: "public" }),
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_AUTH_MAX,
          timeWindow: "1 minute",
          hook: "preHandler", // after body parsing, so the key can come from the code
          keyGenerator: (req) => `redeem:${codeOwner(req.body) ?? req.ip}`,
        },
      },
    },
    async (req, reply) => {
      const parsed = RedeemAccessCode.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Code non valide." });
      }
      const { code } = parsed.data;

      // Code format: "<studentId>.<secret>" — look up by id, verify secret hash. An id that
      // isn't a plain uuid can't be a student: refuse it before any lookup or hashing.
      const [claimed, secret] = code.split(".", 2);
      const studentId = canonicalId(claimed);
      if (!studentId || !secret) {
        return reply.code(401).send({ error: "unauthorized", message: "Code non valide ou déjà utilisé." });
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
        return reply.code(401).send({ error: "unauthorized", message: "Code non valide ou déjà utilisé." });
      }

      // Issue a device-bound session; mark the code spent.
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashSessionToken(token);
      const spent = await tx(async (c) => {
        // Claim the code atomically: only the request that flips THIS code (same hash, so
        // a concurrent reissue can't be spent by the old code) from 'unredeemed' wins.
        // Concurrent redeems (double tap, link prefetch, StrictMode) get 401.
        const claim = await c.query(
          `UPDATE student SET access_code_state = 'redeemed'
            WHERE id = $1 AND access_code_state = 'unredeemed' AND access_code_hash = $2`,
          [student.id, student.access_code_hash],
        );
        if (claim.rowCount !== 1) return false;
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
        return true;
      });
      if (!spent) return reply.code(401).send({ error: "unauthorized", message: "Code non valide ou déjà utilisé." });

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
    { preHandler: guard({ role: "public" }), config: { rateLimit: { max: config.RATE_LIMIT_REISSUE_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = ReissueAccessCode.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "bad_request", message: "Données invalides." });
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
      // Same reply at the same moment for a match and a miss: what a match costs (argon2,
      // two writes, the mail) happens after it, or the response time would confirm the
      // address is on the Roster.
      reply.send(neutral);
      if (student) {
        void reissueCode(tripId, trip.name, student.id, email).catch((e) => {
          // Code/name only: SMTP errors echo the recipient, i.e. the minor's address (#20).
          const err = e as { code?: string; name?: string };
          req.log.error({ smtpError: err?.code ?? err?.name ?? "error" }, "reissue mail failed");
        });
      }
      return reply;
    },
  );
}

/** Mint a fresh single-use code; overwrite the old hash (old code now dead) and set state
 *  back to 'unredeemed' so the new one redeems, then mail it. Sessions are NOT revoked here. */
async function reissueCode(tripId: string, tripName: string, studentId: string, email: string) {
  const secret = randomBytes(16).toString("base64url"); // 128-bit
  const hash = await argon2.hash(secret);
  await pool.query(
    `UPDATE student SET access_code_hash = $2, access_code_state = 'unredeemed' WHERE id = $1`,
    [studentId, hash],
  );
  await pool.query(
    `INSERT INTO audit_log (trip_id, action, target_opaque_id)
     VALUES ($1, 'access_code_reissued', $2)`,
    [tripId, studentId],
  );
  const joinUrl = `${config.PUBLIC_BASE_URL}/join?code=${encodeURIComponent(`${studentId}.${secret}`)}`;
  await sendAccessCode(email, tripName ?? "the trip", joinUrl);
}

// Precomputed argon2 hash of a random string, to equalise timing on unknown ids.
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$3vJ3f0m7c2Q2Wb0m5o0aVZ0v0aVZ0v0aVZ0v0aVZ0";

// silence unused import until /reissue uses it
void timingSafeEqual;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A student id in its one canonical spelling, or undefined: Postgres would also accept
 *  upper case, braces or no hyphens, and each spelling must not get its own budget. */
function canonicalId(id: string | undefined): string | undefined {
  const lower = id?.toLowerCase();
  return lower && UUID.test(lower) ? lower : undefined;
}

/** The student id an access code claims ("<studentId>.<secret>"), for per-code limits. */
function codeOwner(body: unknown): string | undefined {
  const code = (body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? canonicalId(code.split(".", 1)[0]) : undefined;
}
