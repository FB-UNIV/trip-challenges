// Shared harness for route/integration tests: app builder + DB fixtures.
// Test files must declare the vi.mock(...) block (see fake-*.ts) BEFORE importing this,
// so src/db.js, vault, s3 and mailer resolve to the in-memory fakes.
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { pool } from "../../src/db.js";
import { sealBlob } from "../../src/crypto/envelope.js";
import { resetDb } from "./fake-pg.js";
import { createTripKey, encrypt, hmac, resetVault } from "./fake-vault.js";
import { objects, putBlob, blobKey } from "./fake-s3.js";
import { resetMailer } from "./fake-mailer.js";

export { pool };

// Cheap argon2 params for fixtures; argon2.verify reads params from the hash itself.
export const FAST_ARGON = { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 };

export async function resetAll(): Promise<void> {
  await resetDb();
  resetVault();
  objects.clear();
  resetMailer();
}

/** Fastify with cookie + multipart (as in server.ts) and the given route plugins. */
export async function buildApp(
  ...routes: [FastifyPluginAsync<any>, string?][]
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  for (const [plugin, prefix] of routes) await app.register(plugin, prefix ? { prefix } : {});
  await app.ready();
  return app;
}

export const teacherCookie = (app: FastifyInstance, teacherId: string) =>
  `teacher_session=${app.signCookie(teacherId)}`;

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${++seq}`;

export async function makeTeacher(email = `teacher-${uniq()}@school.test`): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO teacher (oidc_subject, email, display_name) VALUES ($1, $2, 'T') RETURNING id`,
    [`sub|${uniq()}`, email],
  );
  return rows[0]!.id;
}

export type TripOpts = {
  phase?: string;
  name?: string;
  maxTeamSize?: number;
  pointsTable?: { placement: number; points: number }[];
  votingClosesAt?: Date | null;
  graceDays?: number;
  hardEraseAt?: Date;
};

export async function makeTrip(ownerId: string, o: TripOpts = {}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO trip (name, owner_teacher_id, max_team_size, points_table, phase,
                       voting_closes_at, grace_days, trip_end_date, hard_erase_at, vault_key_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'2030-01-01',$8,'pending') RETURNING id`,
    [
      o.name ?? "Rome 2030",
      ownerId,
      o.maxTeamSize ?? 4,
      JSON.stringify(o.pointsTable ?? [{ placement: 1, points: 5 }, { placement: 2, points: 3 }, { placement: 3, points: 1 }]),
      o.phase ?? "draft",
      o.votingClosesAt ?? null,
      o.graceDays ?? 7,
      o.hardEraseAt ?? new Date("2030-02-01T00:00:00Z"),
    ],
  );
  const id = rows[0]!.id;
  await pool.query(`UPDATE trip SET vault_key_name = $2 WHERE id = $1`, [id, `trip-${id}`]);
  await pool.query(`INSERT INTO trip_teacher (trip_id, teacher_id, role) VALUES ($1, $2, 'owner')`, [id, ownerId]);
  await createTripKey(id);
  return id;
}

export async function addCoTeacher(tripId: string, teacherId: string): Promise<void> {
  await pool.query(`INSERT INTO trip_teacher (trip_id, teacher_id, role) VALUES ($1, $2, 'co')`, [tripId, teacherId]);
}

export type StudentFixture = { id: string; email: string; cookie: string; code?: string };

/**
 * A Student with a live device session (cookie). With { unredeemedCode: true } the
 * Student instead holds a fresh, unredeemed Access Code ("<id>.<secret>").
 */
export async function makeStudent(
  tripId: string,
  opts: { email?: string; unredeemedCode?: boolean } = {},
): Promise<StudentFixture> {
  const email = opts.email ?? `kid-${uniq()}@school.test`;
  const secret = randomBytes(16).toString("base64url");
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO student (trip_id, email_enc, email_lookup, access_code_hash, access_code_state)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      tripId,
      Buffer.from(await encrypt(tripId, Buffer.from(email))),
      await hmac(tripId, Buffer.from(email)),
      await argon2.hash(secret, FAST_ARGON),
      opts.unredeemedCode ? "unredeemed" : "redeemed",
    ],
  );
  const id = rows[0]!.id;
  const token = randomBytes(32).toString("base64url");
  await pool.query(`INSERT INTO student_session (student_id, token_hash) VALUES ($1, $2)`, [
    id,
    await argon2.hash(token, FAST_ARGON),
  ]);
  return {
    id,
    email,
    cookie: `student_session=${id}.${token}`,
    code: opts.unredeemedCode ? `${id}.${secret}` : undefined,
  };
}

export async function makeTeam(tripId: string, name: string, studentIds: string[] = []): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO team (trip_id, name_enc) VALUES ($1, $2) RETURNING id`,
    [tripId, Buffer.from(await encrypt(tripId, Buffer.from(name)))],
  );
  const id = rows[0]!.id;
  for (const s of studentIds) {
    await pool.query(`INSERT INTO team_member (team_id, student_id, trip_id) VALUES ($1,$2,$3)`, [id, s, tripId]);
  }
  return id;
}

export async function makeChallenge(
  tripId: string,
  o: { title?: string; multiplier?: number } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO challenge (trip_id, title, multiplier, qr_slug) VALUES ($1,$2,$3,$4) RETURNING id`,
    [tripId, o.title ?? `Challenge ${uniq()}`, o.multiplier ?? 1, `slug-${uniq()}`],
  );
  return rows[0]!.id;
}

/** A Submission whose blob is really sealed (envelope-encrypted) in the fake store. */
export async function makeSubmission(
  tripId: string,
  challengeId: string,
  teamId: string,
  studentId: string,
  o: { bytes?: Buffer; createdAt?: Date } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO submission (trip_id, challenge_id, team_id, uploaded_by_student_id, blob_key, content_type, created_at)
     VALUES ($1,$2,$3,$4,'pending','image/jpeg',$5) RETURNING id`,
    [tripId, challengeId, teamId, studentId, o.createdAt ?? new Date()],
  );
  const id = rows[0]!.id;
  const key = blobKey(tripId, id);
  await putBlob(key, await sealBlob(tripId, o.bytes ?? Buffer.from("jpeg-bytes")));
  await pool.query(`UPDATE submission SET blob_key = $2 WHERE id = $1`, [id, key]);
  return id;
}

export async function makeNomination(
  tripId: string,
  challengeId: string,
  teamId: string,
  submissionId: string,
  state: "pending" | "approved" | "rejected" = "approved",
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO nomination (trip_id, challenge_id, team_id, submission_id, state, active)
     VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
    [tripId, challengeId, teamId, submissionId, state],
  );
  return rows[0]!.id;
}

/** Set a nomination's duel record directly (wins out of comparisons + Wilson score). */
export async function setStats(tripId: string, nominationId: string, wilson: number, wins = 0, comparisons = 0) {
  await pool.query(
    `INSERT INTO nomination_stats (nomination_id, trip_id, wins, comparisons, wilson_score)
     VALUES ($1,$2,$3,$4,$5)`,
    [nominationId, tripId, wins, comparisons, wilson],
  );
}

export async function count(table: string, where = "true", params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return rows[0]!.n;
}

export async function auditActions(tripId: string): Promise<string[]> {
  const { rows } = await pool.query<{ action: string }>(
    `SELECT action FROM audit_log WHERE trip_id = $1 ORDER BY at`,
    [tripId],
  );
  return rows.map((r) => r.action);
}
