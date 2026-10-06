// Demo data for a staging stack: three trips (draft / voting / reveal) owned by a real
// teacher account, built by driving the API's own routes in-process. Seeding therefore
// exercises the real chain end to end — Vault keys, field encryption, image
// normalisation + envelope encryption into the object store, guards, phase transitions,
// pairwise voting and results — without exposing anything or sending a single email:
// demo students are created with known access codes and their join links are printed.
// Clean up with eraseDemo(), which goes through the real erasure path.
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import argon2 from "argon2";
import sharp from "sharp";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { pool } from "../db.js";
import { encrypt, hmac } from "../crypto/vault.js";
import { eraseTrip } from "../erasure.js";
import { tripRoutes } from "../routes/trips.js";
import { challengeRoutes } from "../routes/challenges.js";
import { teamRoutes } from "../routes/teams.js";
import { nominationRoutes } from "../routes/nominations.js";
import { studentAuthRoutes } from "../routes/student-auth.js";
import { submissionRoutes } from "../routes/submissions.js";
import { duelRoutes } from "../routes/duels.js";

export const DEMO_PREFIX = "[DEMO] ";

export type SeedOptions = {
  teacherEmail: string;
  teams?: number;
  studentsPerTeam?: number;
  /** Unredeemed join links printed per trip, for testers' phones. */
  joinLinks?: number;
  /** Photos each team uploads per challenge (the last one is nominated). */
  photosPerTeam?: number;
  /** Duels each demo student judges per challenge in the reveal trip. */
  votesPerStudent?: number;
};

export type SeededTrip = {
  id: string;
  name: string;
  phase: "draft" | "voting" | "reveal";
  adminUrl: string;
  ceremonyUrl: string;
  joinLinks: string[];
};

const TEAM_NAMES = ["Foxes", "Owls", "Otters", "Hawks", "Lynxes", "Badgers", "Herons", "Wolves"];
const COLORS = ["#e4572e", "#29335c", "#f3a712", "#669bbc", "#a8c686", "#7d5ba6", "#2a9d8f", "#d1495b"];
const CHALLENGES = [
  { title: "Best gelato face", instructions: "Your whole team, one gelato, maximum drama.", multiplier: 1 },
  { title: "Human pyramid at the fountain", instructions: "Safely! Feet on the ground for the bottom row.", multiplier: 2 },
  { title: "Spot the hidden lion", instructions: "Find a lion on a building or statue and frame it.", multiplier: 1 },
];
// Demo-only access codes: cheap argon2 params keep seeding fast (verify reads the params
// from the hash, so these codes redeem exactly like real ones).
const DEMO_ARGON = { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 } as const;

type Res = { statusCode: number; body: string; json: () => any; cookies: { name: string; value: string }[] };

export async function seedDemo(opts: SeedOptions): Promise<{ trips: SeededTrip[] }> {
  const o = {
    teams: 4, studentsPerTeam: 3, joinLinks: 5, photosPerTeam: 2, votesPerStudent: 4,
    ...opts,
  };
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM teacher WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
    [o.teacherEmail],
  );
  const teacherId = rows[0]?.id;
  if (!teacherId) {
    throw new Error(`No teacher with email ${o.teacherEmail}: sign in once via PocketID on this server first.`);
  }

  const app = await demoApp();
  try {
    const teacher = `teacher_session=${app.signCookie(teacherId)}`;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const trips: SeededTrip[] = [];
    for (const target of ["draft", "voting", "reveal"] as const) {
      trips.push(await seedTrip(app, teacher, `${DEMO_PREFIX}${target} — ${stamp}`, target, o));
    }
    return { trips };
  } finally {
    await app.close();
  }
}

/** Erase every not-yet-erased demo trip through the real erasure path. */
export async function eraseDemo(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM trip WHERE left(name, length($1)) = $1 AND phase <> 'erased'`,
    [DEMO_PREFIX],
  );
  for (const { id } of rows) await eraseTrip(id);
  return rows.map((r) => r.id);
}

async function seedTrip(
  app: FastifyInstance,
  teacher: string,
  name: string,
  target: SeededTrip["phase"],
  o: Required<SeedOptions>,
): Promise<SeededTrip> {
  const call = caller(app);
  const end = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const tripId: string = (await call("POST", "/api/trips", teacher, { name, tripEndDate: end, maxTeamSize: 6 })).json().id;

  const challengeIds: string[] = [];
  for (const ch of CHALLENGES) {
    challengeIds.push((await call("POST", "/api/challenges", teacher, { tripId, ...ch })).json().id);
  }

  // Teams of demo students, formed through the student routes (teams lock after draft).
  const teams: string[][] = []; // session cookies per team
  for (let t = 0; t < o.teams; t++) {
    const members: string[] = [];
    for (let s = 0; s < o.studentsPerTeam; s++) {
      members.push(await sessionFor(app, await demoStudent(tripId)));
    }
    const teamName = TEAM_NAMES[t % TEAM_NAMES.length]!;
    const teamId: string = (await call("POST", "/api/teams", members[0]!, { name: teamName })).json().teamId;
    for (const m of members.slice(1)) await call("POST", "/api/teams/join", m, { teamId });
    teams.push(members);
  }

  // Join links left unredeemed, for testers' phones.
  const joinLinks: string[] = [];
  for (let i = 0; i < o.joinLinks; i++) {
    const code = await demoStudent(tripId);
    joinLinks.push(`${config.PUBLIC_BASE_URL}/join?code=${encodeURIComponent(code)}`);
  }

  if (target !== "draft") {
    await call("POST", `/api/trips/${tripId}/advance`, teacher, { to: "challenge" });
    for (const [t, members] of teams.entries()) {
      for (const [c, challengeId] of challengeIds.entries()) {
        let last = "";
        for (let p = 0; p < o.photosPerTeam; p++) {
          last = await upload(app, members[p % members.length]!, challengeId, await demoPhoto(t, c, p));
        }
        await call("POST", "/api/nominations", members[0]!, { challengeId, submissionId: last });
      }
    }
    const pending = (await call("GET", `/api/nominations/trip/${tripId}?state=pending`, teacher)).json().nominations;
    for (const n of pending as { id: string }[]) await call("POST", `/api/nominations/${n.id}/approve`, teacher);
    await call("POST", `/api/trips/${tripId}/advance`, teacher, { to: "voting" });
  }

  if (target === "reveal") {
    for (const cookieOf of teams.flat()) {
      for (const challengeId of challengeIds) {
        for (let v = 0; v < o.votesPerStudent; v++) {
          const { pair } = (await call("GET", `/api/duels/next?challengeId=${challengeId}`, cookieOf)).json();
          if (!pair) break;
          // Lean towards the "a" side so rankings aren't a coin flip, but not always.
          const winner = Math.random() < 0.7 ? pair.aNominationId : pair.bNominationId;
          await call("POST", "/api/duels/cast", cookieOf, { pairToken: pair.pairToken, winnerNominationId: winner });
        }
      }
    }
    await call("POST", `/api/trips/${tripId}/advance`, teacher, { to: "reveal" });
  }

  return {
    id: tripId,
    name,
    phase: target,
    adminUrl: `${config.PUBLIC_BASE_URL}/teacher/trips/${tripId}`,
    ceremonyUrl: `${config.PUBLIC_BASE_URL}/ceremony/${tripId}`,
    joinLinks,
  };
}

/** An unredeemed demo student; returns their access code ("<id>.<secret>"). */
async function demoStudent(tripId: string): Promise<string> {
  const id = randomUUID();
  const secret = randomBytes(16).toString("base64url");
  // Reserved TLD: undeliverable by definition, and never mailed anyway.
  const email = Buffer.from(`demo-${id.slice(0, 8)}@example.invalid`, "utf8");
  await pool.query(
    `INSERT INTO student (id, trip_id, email_enc, email_lookup, access_code_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, tripId, Buffer.from(await encrypt(tripId, email), "utf8"), await hmac(tripId, email),
      await argon2.hash(secret, DEMO_ARGON)],
  );
  return `${id}.${secret}`;
}

/** Redeem a code through the real route, like a phone; returns the session cookie. */
async function sessionFor(app: FastifyInstance, code: string): Promise<string> {
  const res = await caller(app)("POST", "/api/student/redeem", undefined, { code });
  const session = res.cookies.find((c) => c.name === "student_session")!;
  return `student_session=${session.value}`;
}

async function upload(app: FastifyInstance, cookieOf: string, challengeId: string, jpeg: Buffer): Promise<string> {
  const boundary = `----demo${randomBytes(8).toString("hex")}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="demo.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`),
    jpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: `/api/submissions?challengeId=${challengeId}`,
    headers: { cookie: cookieOf, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  return expectOk(res, "upload").json().id;
}

/** A colourful, recognisable placeholder photo: team colour + a few shapes. */
async function demoPhoto(team: number, challenge: number, n: number): Promise<Buffer> {
  const bg = COLORS[team % COLORS.length]!;
  const fg = COLORS[(team + challenge + n + 3) % COLORS.length]!;
  const shapes = Array.from({ length: 3 + challenge }, (_, i) =>
    `<circle cx="${120 + i * 140 + n * 30}" cy="${200 + ((i * 97 + n * 53) % 260)}" r="${50 + ((i + n) % 3) * 25}" fill="${fg}" opacity="0.85"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">` +
    `<rect width="800" height="600" fill="${bg}"/>${shapes}` +
    `<rect x="40" y="500" width="${120 + challenge * 120}" height="40" rx="20" fill="#ffffff" opacity="0.7"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

async function demoApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 15 * 1024 * 1024 });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  await app.register(tripRoutes, { prefix: "/api/trips" });
  await app.register(challengeRoutes, { prefix: "/api/challenges" });
  await app.register(teamRoutes, { prefix: "/api/teams" });
  await app.register(nominationRoutes, { prefix: "/api/nominations" });
  await app.register(studentAuthRoutes, { prefix: "/api/student" });
  await app.register(submissionRoutes, { prefix: "/api/submissions" });
  await app.register(duelRoutes, { prefix: "/api/duels" });
  await app.ready();
  return app;
}

function caller(app: FastifyInstance) {
  return async (method: "GET" | "POST", url: string, cookieOf?: string, payload?: object): Promise<Res> =>
    expectOk(
      await app.inject({ method, url, headers: cookieOf ? { cookie: cookieOf } : {}, ...(payload ? { payload } : {}) }),
      `${method} ${url.split("?")[0]}`,
    );
}

function expectOk(res: Res, what: string): Res {
  if (res.statusCode >= 300) throw new Error(`demo seed: ${what} -> ${res.statusCode} ${res.body}`);
  return res;
}
