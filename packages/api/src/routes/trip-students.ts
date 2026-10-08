// A Trip's students, for its teachers (#93, ADR 0006): who has Joined, who was Invited, whose
// code was never delivered — and the two fixes: resend a code, correct an undelivered address.
// Emails are decrypted for the Trip's teachers only; never logged, never audited.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FixAddress, RetryRosterItem, type RosterEntry } from "@trip/shared";
import { pool } from "../db.js";
import { guard, teacherOf, tripFrom, tripOf, type Phase } from "../auth/guard.js";
import { decrypt, encrypt, hmac } from "../crypto/vault.js";
import { sendAccessCode } from "../email/mailer.js";
import { joinUrlFor, newAccessCode, processRosterBatch } from "../roster-worker.js";

const LIVE: Phase[] = ["draft", "challenge", "voting", "reveal", "grace"];
const StudentParams = z.object({ id: z.string().uuid(), studentId: z.string().uuid() });
const ItemParams = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });

export async function tripStudentRoutes(app: FastifyInstance) {
  const member = guard({ role: "teacher", trip: tripFrom.trip("params.id") });

  app.get("/:id/students", { preHandler: member }, async (req) => {
    const tripId = tripOf(req).id;
    const plain = async (enc: Buffer) => (await decrypt(tripId, enc.toString("utf8"))).toString("utf8");

    const { rows: students } = await pool.query<{
      id: string; email_enc: Buffer; code_state: string; sent: boolean; joined: boolean; team_id: string | null;
    }>(
      `SELECT s.id, s.email_enc, s.access_code_state AS code_state, s.access_code_sent_at IS NOT NULL AS sent,
              EXISTS (SELECT 1 FROM student_session ss WHERE ss.student_id = s.id) AS joined,
              (SELECT m.team_id FROM team_member m WHERE m.student_id = s.id) AS team_id
         FROM student s WHERE s.trip_id = $1`,
      [tripId],
    );
    const items = await openItems(tripId);
    const itemOf = new Map<string, (typeof items)[number]>();
    for (const it of items) if (!itemOf.has(it.email) || it.status === "pending") itemOf.set(it.email, it);

    const rows: RosterEntry[] = [];
    const known = new Set<string>();
    for (const s of students) {
      const email = await plain(s.email_enc);
      known.add(email);
      const item = itemOf.get(email);
      // Joined = has ever signed in (CONTEXT: Joined); not the code state, which a reissue resets.
      const status = s.joined ? "joined" : s.sent ? "invited" : item?.status === "pending" ? "sending" : "undelivered";
      rows.push({
        kind: "student", id: s.id, email, status,
        newCodeRequested: s.joined && s.code_state === "unredeemed",
        teamId: s.team_id,
        lastError: status === "undelivered" ? (item?.last_error ?? null) : null,
      });
    }
    for (const it of items) {
      if (known.has(it.email)) continue; // folded into that student's row
      rows.push({
        kind: "import", id: it.id, email: it.email,
        status: it.status === "pending" ? "sending" : "undelivered",
        newCodeRequested: false, teamId: null, lastError: it.status === "failed" ? it.last_error : null,
      });
      known.add(it.email);
    }
    rows.sort((a, b) => a.email.localeCompare(b.email));
    return {
      students: rows,
      counts: {
        all: rows.length,
        notJoined: rows.filter((r) => r.status !== "joined").length,
        undelivered: rows.filter((r) => r.status === "undelivered").length,
        noTeam: rows.filter((r) => r.kind === "student" && !r.teamId).length,
        sending: rows.filter((r) => r.status === "sending").length,
      },
    };
  });

  const onStudent = guard({ role: "teacher", params: StudentParams, trip: tripFrom.trip("params.id"), phases: LIVE });

  // Resend: a fresh code (the old one can't be re-sent: only its hash is stored).
  app.post("/:id/students/:studentId/resend", { preHandler: onStudent }, async (req, reply) => {
    const tripId = tripOf(req).id;
    const s = await notJoined(tripId, (req.params as { studentId: string }).studentId, reply);
    if (!s) return;
    const email = (await decrypt(tripId, s.email_enc.toString("utf8"))).toString("utf8");
    return deliver(tripId, s.id, email, [email], teacherOf(req).teacherId, "access_code_resent", reply);
  });

  // Fix an undelivered (or wrong) address, then send the code to the new one.
  app.patch(
    "/:id/students/:studentId",
    { preHandler: guard({ role: "teacher", params: StudentParams, body: FixAddress, trip: tripFrom.trip("params.id"), phases: LIVE }) },
    async (req, reply) => {
      const tripId = tripOf(req).id;
      const s = await notJoined(tripId, (req.params as { studentId: string }).studentId, reply);
      if (!s) return;
      const { email } = req.body as { email: string };
      const lookup = await hmac(tripId, Buffer.from(email, "utf8"));
      const { rowCount: taken } = await pool.query(
        `SELECT 1 FROM student WHERE trip_id = $1 AND email_lookup = $2 AND id <> $3`, [tripId, lookup, s.id],
      );
      if (taken) return reply.code(409).send({ error: "already_on_roster", message: "Another student already has this address." });
      const old = (await decrypt(tripId, s.email_enc.toString("utf8"))).toString("utf8");
      const enc = await encrypt(tripId, Buffer.from(email, "utf8"));
      await pool.query(`UPDATE student SET email_enc = $2, email_lookup = $3 WHERE id = $1`, [s.id, Buffer.from(enc, "utf8"), lookup]);
      return deliver(tripId, s.id, email, [old, email], teacherOf(req).teacherId, "roster_address_fixed", reply);
    },
  );

  // An address that never became a student (it failed before): queue it again, corrected if given.
  app.post(
    "/:id/roster/items/:itemId/retry",
    { preHandler: guard({ role: "teacher", params: ItemParams, body: RetryRosterItem, trip: tripFrom.trip("params.id"), phases: LIVE }) },
    async (req, reply) => {
      const tripId = tripOf(req).id;
      const { itemId } = req.params as { itemId: string };
      const { email } = req.body as { email?: string };
      const enc = email ? Buffer.from(await encrypt(tripId, Buffer.from(email, "utf8")), "utf8") : null;
      const { rowCount } = await pool.query(
        `UPDATE roster_import_item
            SET status = 'pending', attempts = 0, last_error = NULL, email_enc = COALESCE($3, email_enc)
          WHERE id = $1 AND trip_id = $2 AND status = 'failed'`,
        [itemId, tripId, enc],
      );
      if (!rowCount) return reply.code(404).send({ error: "not_found", message: "no failed address to retry" });
      await audit(tripId, teacherOf(req).teacherId, "roster_item_retried", itemId);
      setImmediate(() => void processRosterBatch().catch(() => {}));
      return reply.code(202).send({ ok: true });
    },
  );
}

/** Pending/failed roster items of a trip, decrypted. */
async function openItems(tripId: string) {
  const { rows } = await pool.query<{ id: string; email_enc: Buffer; status: "pending" | "failed"; last_error: string | null }>(
    `SELECT id, email_enc, status, last_error FROM roster_import_item
      WHERE trip_id = $1 AND status IN ('pending', 'failed') ORDER BY created_at`,
    [tripId],
  );
  return Promise.all(rows.map(async (r) => ({
    ...r, email: (await decrypt(tripId, r.email_enc.toString("utf8"))).toString("utf8"),
  })));
}

/** This trip's student, if they haven't joined (a joined student uses the lost-code link). */
async function notJoined(tripId: string, studentId: string, reply: FastifyReply) {
  const { rows: [s] } = await pool.query<{ id: string; email_enc: Buffer; joined: boolean }>(
    `SELECT s.id, s.email_enc, EXISTS (SELECT 1 FROM student_session ss WHERE ss.student_id = s.id) AS joined
       FROM student s WHERE s.id = $1 AND s.trip_id = $2`,
    [studentId, tripId],
  );
  if (!s) { reply.code(404).send({ error: "not_found", message: "student" }); return null; }
  if (s.joined) {
    reply.code(409).send({ error: "joined", message: "This student has joined; they can get a new code from the lost-code link." });
    return null;
  }
  return s;
}

/**
 * Mint a fresh code, mail it, record the outcome. On success the bounced roster items for
 * `bounced` addresses are resolved; on failure the student is left undelivered (the old
 * code is dead either way) and the reason is the generic one — SMTP errors echo the address.
 */
async function deliver(
  tripId: string, studentId: string, email: string, bounced: string[], teacherId: string, action: string, reply: FastifyReply,
) {
  const { secret, hash } = await newAccessCode();
  await pool.query(
    `UPDATE student SET access_code_hash = $2, access_code_state = 'unredeemed', access_code_sent_at = NULL WHERE id = $1`,
    [studentId, hash],
  );
  await audit(tripId, teacherId, action, studentId);
  const { rows: [trip] } = await pool.query<{ name: string }>(`SELECT name FROM trip WHERE id = $1`, [tripId]);
  try {
    await sendAccessCode(email, trip!.name, joinUrlFor(studentId, secret));
  } catch {
    return reply.code(502).send({ error: "mail_failed", message: "The email couldn't be sent. Check the address and try again." });
  }
  await pool.query(`UPDATE student SET access_code_sent_at = now() WHERE id = $1`, [studentId]);
  const resolved = (await openItems(tripId)).filter((it) => it.status === "failed" && bounced.includes(it.email));
  if (resolved.length) {
    await pool.query(`DELETE FROM roster_import_item WHERE id = ANY($1::uuid[])`, [resolved.map((it) => it.id)]);
  }
  return { ok: true };
}

const audit = (tripId: string, teacherId: string, action: string, target: string) =>
  pool.query(
    `INSERT INTO audit_log (trip_id, teacher_id, action, target_opaque_id) VALUES ($1, $2, $3, $4)`,
    [tripId, teacherId, action, target],
  );
