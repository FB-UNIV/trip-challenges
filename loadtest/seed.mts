// Load test seed (#63): a trip in voting with 50 signed-in students in 10 teams, two
// challenges with an approved photo per team, plus a small trip in the challenge phase for
// the upload scenario. Writes loadtest/.state.json and loadtest/.photo.jpg for k6.
//
// Runs against the same compose stack as e2e (npm run e2e:services) and an API started
// with loadtest/api-env.ts. Students sign in the real way: the roster import emails access
// codes (caught by Mailpit), each code is redeemed for a device session cookie.
//
//   npx tsx loadtest/seed.mts
import { writeFile } from "node:fs/promises";
import { API_URL, MAILPIT_URL } from "../e2e/support/env.js";
import { phoneLikeJpeg, writeUploadPhoto } from "./photo.mjs";

const STUDENTS = 50;
const TEAM_SIZE = 5;
const VOTING_CHALLENGES = ["Best gelato", "Most epic statue"];

type Jar = { cookie: string };

async function call(jar: Jar | null, method: string, path: string, body?: unknown, raw?: BodyInit, type?: string) {
  const headers: Record<string, string> = {};
  if (jar?.cookie) headers.cookie = jar.cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (type) headers["content-type"] = type;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  const set = res.headers.getSetCookie().map((c) => c.split(";", 1)[0]!).filter(Boolean);
  if (jar && set.length) jar.cookie = set.join("; ");
  return res.status === 204 ? null : res.json();
}

function multipart(file: Buffer) {
  const boundary = `----load${Math.random().toString(16).slice(2)}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
  return { body: Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]), type: `multipart/form-data; boundary=${boundary}` };
}

/** The access code mailed to `email` (Mailpit), as the `code` the join link carries. */
async function codeFor(email: string): Promise<string> {
  for (let i = 0; i < 120; i++) {
    const q = encodeURIComponent(`to:"${email}"`);
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${q}&limit=5`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string }[] };
    if (messages[0]) {
      const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const link = msg.Text.match(/https?:\/\/\S+\/join\?code=\S+/)?.[0];
      if (link) return new URL(link).searchParams.get("code")!;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no access code mail for ${email}`);
}

async function enroll(teacher: Jar, tripId: string, n: number, tag: string): Promise<Jar[]> {
  const run = Date.now().toString(36);
  const emails = Array.from({ length: n }, (_, i) => `load-${tag}-${run}-${i}@load.test`);
  await call(teacher, "POST", `/api/trips/${tripId}/roster`, { emails });
  return Promise.all(emails.map(async (email) => {
    const jar: Jar = { cookie: "" };
    await call(jar, "POST", "/api/student/redeem", { code: await codeFor(email) });
    return jar;
  }));
}

/** Teams of TEAM_SIZE: the first student creates it, the rest join. Returns each team's members. */
async function formTeams(students: Jar[], tag: string): Promise<Jar[][]> {
  const teams: Jar[][] = [];
  for (let i = 0; i < students.length; i += TEAM_SIZE) teams.push(students.slice(i, i + TEAM_SIZE));
  for (const [t, members] of teams.entries()) {
    const { teamId } = (await call(members[0]!, "POST", "/api/teams", { name: `${tag} team ${t + 1}` })) as { teamId: string };
    for (const m of members.slice(1)) await call(m, "POST", "/api/teams/join", { teamId });
  }
  return teams;
}

const t0 = Date.now();
const teacher: Jar = { cookie: "" };
await call(teacher, "POST", "/api/auth/teacher/dev-login", { email: `load-teacher-${Date.now()}@load.test` });

// ---- voting trip ----
const tripId = ((await call(teacher, "POST", "/api/trips", { name: "Load test", tripEndDate: "2030-06-01", maxTeamSize: TEAM_SIZE })) as { id: string }).id;
const challenges: string[] = [];
for (const title of VOTING_CHALLENGES) {
  challenges.push(((await call(teacher, "POST", "/api/challenges", { tripId, title, instructions: title, multiplier: 1 })) as { id: string }).id);
}
const students = await enroll(teacher, tripId, STUDENTS, "vote");
const teams = await formTeams(students, "Vote");
await call(teacher, "POST", `/api/trips/${tripId}/advance`, { to: "challenge" });
let n = 0;
for (const members of teams) {
  for (const challengeId of challenges) {
    const m = multipart(await phoneLikeJpeg(++n));
    const { id } = (await call(members[0]!, "POST", `/api/submissions?challengeId=${challengeId}`, undefined, m.body, m.type)) as { id: string };
    await call(members[0]!, "POST", "/api/nominations", { challengeId, submissionId: id });
  }
}
const { nominations } = (await call(teacher, "GET", `/api/nominations/trip/${tripId}?state=pending`)) as { nominations: { id: string }[] };
for (const nom of nominations) await call(teacher, "POST", `/api/nominations/${nom.id}/approve`, {});
await call(teacher, "POST", `/api/trips/${tripId}/advance`, { to: "voting" });

// ---- upload trip (stays in the challenge phase) ----
const upTrip = ((await call(teacher, "POST", "/api/trips", { name: "Load test uploads", tripEndDate: "2030-06-01", maxTeamSize: TEAM_SIZE })) as { id: string }).id;
const upChallenge = ((await call(teacher, "POST", "/api/challenges", { tripId: upTrip, title: "Anything", instructions: "x", multiplier: 1 })) as { id: string }).id;
const uploaders = await enroll(teacher, upTrip, 5, "up");
for (const [i, u] of uploaders.entries()) await call(u, "POST", "/api/teams", { name: `Upload team ${i + 1}` });
await call(teacher, "POST", `/api/trips/${upTrip}/advance`, { to: "challenge" });

await writeUploadPhoto();
await writeFile(new URL("./.state.json", import.meta.url), JSON.stringify({
  baseUrl: API_URL,
  tripId,
  challenges,
  students: students.map((s) => s.cookie),
  upload: { challengeId: upChallenge, students: uploaders.map((u) => u.cookie) },
}, null, 2));
console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${students.length} voters in ${teams.length} teams, ` +
  `${nominations.length} approved entries over ${challenges.length} challenges, ${uploaders.length} uploaders`);
