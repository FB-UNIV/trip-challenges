// End-to-end smoke test against a live stack (Postgres + MinIO + Vault + the API).
//
// Usage:
//   docker compose -f docker-compose.dev.yml up -d
//   npx tsx --env-file=.env packages/api/src/server.ts > /tmp/api.log 2>&1 &   # NODE_ENV=development
//   E2E_BASE=http://localhost:3100 E2E_LOG=/tmp/api.log node scripts/e2e.mjs
//
// It drives real HTTP flows and asserts behaviour, with emphasis on the paths added in
// "Finish core-flow gaps": reveal gating, access-code re-issue, tie handling, config
// editing, and duel pair-exclusion. Student access codes are recovered by scraping the
// dev mailer output (NODE_ENV=development logs the join link instead of sending it).
import { readFileSync } from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const LOG = process.env.E2E_LOG ?? "/tmp/api.log";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failures.push(label); console.log(`  \x1b[31m✗ ${label}\x1b[0m`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tiny cookie jar. We ignore cookie Path and send everything on every request — good
// enough for a test client and sidesteps per-cookie path scoping.
class Client {
  constructor() { this.jar = new Map(); }
  #store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async req(method, path, { json, form } = {}) {
    const headers = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body;
    if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
    else if (form !== undefined) { body = form; }
    const res = await fetch(`${BASE}${path}`, { method, headers, body });
    this.#store(res);
    let data = null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  get(p, o) { return this.req("GET", p, o); }
  post(p, o) { return this.req("POST", p, o); }
  patch(p, o) { return this.req("PATCH", p, o); }
  del(p, o) { return this.req("DELETE", p, o); }
}

// Scrape the dev mailer log for the latest value emailed to `email`.
function scrape(email, re) {
  const blocks = readFileSync(LOG, "utf8").split("[mail:dev] to=").slice(1);
  let found = null;
  for (const b of blocks) if (b.startsWith(`${email} ::`)) { const m = b.match(re); if (m) found = decodeURIComponent(m[1]); }
  return found;
}
const latestCode = (email) => scrape(email, /join\?code=([^\s"']+)/);
const inviteToken = (email) => scrape(email, /accept\?token=([^\s"']+)/);

async function waitRosterDrained(teacher, tripId, expected) {
  for (let i = 0; i < 40; i++) {
    const { data } = await teacher.get(`/api/trips/${tripId}/roster/status`);
    if (data && data.pending === 0 && data.students >= expected) return true;
    await sleep(250);
  }
  return false;
}

// Redeem a code, expecting success. /redeem is rate-limited to 5/min per IP; if we hit the
// window (only happens on rapid re-runs against a warm server), wait it out once and retry.
async function redeemOK(client, code) {
  let r = await client.post("/api/student/redeem", { json: { code } });
  if (r.status === 429) { await sleep(61_000); r = await client.post("/api/student/redeem", { json: { code } }); }
  return r;
}

// Register + redeem a student, returning an authenticated Client.
async function joinStudent(teacher, tripId, email) {
  const code = latestCode(email);
  if (!code) throw new Error(`no code in log for ${email}`);
  const c = new Client();
  const r = await redeemOK(c, code);
  if (r.status !== 200) throw new Error(`redeem failed for ${email}: ${r.status}`);
  return c;
}

async function makeTeam(student, name) {
  const r = await student.post("/api/teams", { json: { name } });
  return r.data?.teamId;
}

async function upload(student, challengeId) {
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "p.png");
  const r = await student.req("POST", `/api/submissions?challengeId=${challengeId}`, { form: fd });
  return r.data?.id;
}

async function nominate(student, challengeId, submissionId) {
  return student.post("/api/nominations", { json: { challengeId, submissionId } });
}

async function approveAll(teacher, tripId) {
  const { data } = await teacher.get(`/api/nominations/trip/${tripId}?state=pending`);
  for (const n of data?.nominations ?? []) await teacher.post(`/api/nominations/${n.id}/approve`);
  return (data?.nominations ?? []).length;
}

const uniq = () => Math.random().toString(36).slice(2, 8);

// ─────────────────────────────────────────────────────────────────────────────
async function tripMainFlow() {
  console.log("\n\x1b[1mTrip A — full flow (config edits, reissue, duels + pair exclusion, reveal gate)\x1b[0m");
  const T = new Client();
  const teacherEmail = `teach-${uniq()}@example.org`;
  const login = await T.post("/api/auth/teacher/dev-login", { json: { email: teacherEmail } });
  ok(login.status === 200 && login.data?.teacherId, "teacher dev-login");

  const created = await T.post("/api/trips", {
    json: {
      name: "Rome A", tripEndDate: "2026-12-31", maxTeamSize: 4,
      pointsTable: [{ placement: 1, points: 5 }, { placement: 2, points: 3 }, { placement: 3, points: 1 }],
      graceDays: 7, maxRetentionDays: 30,
    },
  });
  const tripId = created.data?.id;
  ok(created.status === 201 && tripId, "create trip (draft)");

  // ── Config editing (#4) in draft ──
  ok((await T.patch(`/api/trips/${tripId}`, { json: { name: "Rome A (edited)" } })).status === 200, "PATCH trip name in draft");
  ok((await T.patch(`/api/trips/${tripId}`, { json: { maxTeamSize: 3 } })).status === 200, "PATCH maxTeamSize in draft");

  // Challenges: add / edit / delete (draft)
  const ch1 = (await T.post("/api/challenges", { json: { tripId, title: "Sunset", instructions: "shoot a sunset", multiplier: 1 } })).data?.id;
  const ch2 = (await T.post("/api/challenges", { json: { tripId, title: "Fountain", instructions: "a fountain", multiplier: 1 } })).data?.id;
  const chTmp = (await T.post("/api/challenges", { json: { tripId, title: "Temp", instructions: "", multiplier: 1 } })).data?.id;
  ok(ch1 && ch2 && chTmp, "add 3 challenges");
  ok((await T.patch(`/api/challenges/${ch1}`, { json: { title: "Best Sunset" } })).status === 200, "PATCH challenge title");
  ok((await T.del(`/api/challenges/${chTmp}`)).status === 200, "DELETE challenge in draft");

  // ── Roster + reissue (#2) ──
  const s1e = `s1-${uniq()}@example.org`, s2e = `s2-${uniq()}@example.org`, s3e = `s3-${uniq()}@example.org`, s4e = `s4-${uniq()}@example.org`;
  const imp = await T.post(`/api/trips/${tripId}/roster`, { json: { emails: [s1e, s2e, s3e, s4e] } });
  ok(imp.status === 202 && imp.data?.queued === 4, "roster import (202, queued 4)");
  ok(await waitRosterDrained(T, tripId, 4), "roster drained (4 students, codes emailed)");

  const s1old = latestCode(s1e);
  const reissue = await T.post("/api/student/reissue", { json: { tripId, email: s1e } });
  ok(reissue.status === 200, "reissue request → 200 (neutral)");
  await sleep(150);
  const s1new = latestCode(s1e);
  ok(s1new && s1new !== s1old, "reissue emailed a NEW code");

  const deadRedeem = await new Client().post("/api/student/redeem", { json: { code: s1old } });
  ok(deadRedeem.status === 401, "old code is dead after reissue (401)");

  const anon = await T.post("/api/student/reissue", { json: { tripId, email: `nobody-${uniq()}@example.org` } });
  ok(anon.status === 200, "reissue for unknown email → 200 (anti-enumeration)");

  const s1 = new Client();
  ok((await redeemOK(s1, s1new)).status === 200, "redeem NEW code → 200");
  ok((await new Client().post("/api/student/redeem", { json: { code: s1new } })).status === 401, "re-redeem spent code → 401 (single-use)");

  const s2 = await joinStudent(T, tripId, s2e);
  const s3 = await joinStudent(T, tripId, s3e);
  const s4 = await joinStudent(T, tripId, s4e);
  ok(true, "redeem s2, s3, s4");

  // Teams (draft): 3 teams so a 3rd voter can judge any pair (no self-vote). s4 JOINS an
  // existing team — exercises the team_member capacity check (regression: that count query
  // must not use FOR UPDATE, which Postgres forbids with aggregates).
  const tA = await makeTeam(s1, "Alpha"), tB = await makeTeam(s2, "Bravo"), tC = await makeTeam(s3, "Charlie");
  ok(tA && tB && tC, "3 students form 3 teams (draft)");
  ok((await s4.post("/api/teams/join", { json: { teamId: tA } })).status === 200, "s4 joins an existing team → 200");
  ok((await s4.post("/api/teams/join", { json: { teamId: tB } })).status === 409, "s4 can't join a second team → 409 (exclusive)");

  // ── Advance to challenge; config locks kick in ──
  ok((await T.post(`/api/trips/${tripId}/advance`, { json: { to: "challenge" } })).status === 200, "advance draft→challenge");
  ok((await T.patch(`/api/trips/${tripId}`, { json: { maxTeamSize: 5 } })).status === 409, "maxTeamSize locked in challenge (409)");
  ok((await T.patch(`/api/trips/${tripId}`, { json: { pointsTable: [{ placement: 1, points: 10 }, { placement: 2, points: 4 }] } })).status === 200, "pointsTable still editable pre-reveal");
  ok((await T.del(`/api/challenges/${ch2}`)).status === 409, "challenge delete locked outside draft (409)");

  // ── Uploads + nominations ──
  for (const [st, name] of [[s1, "Alpha"], [s2, "Bravo"], [s3, "Charlie"]]) {
    for (const ch of [ch1, ch2]) {
      const subId = await upload(st, ch);
      const nom = await nominate(st, ch, subId);
      if (nom.status !== 201) ok(false, `${name} nominate on ${ch} (${nom.status})`);
    }
  }
  ok(true, "3 teams upload + nominate on 2 challenges");
  ok((await approveAll(T, tripId)) === 6, "teacher approves all 6 nominations");

  // ── Voting + duel pair-exclusion (#5) ──
  ok((await T.post(`/api/trips/${tripId}/advance`, { json: { to: "voting" } })).status === 200, "advance challenge→voting");
  const first = await s3.get(`/api/duels/next?challengeId=${ch1}`);
  ok(first.status === 200 && first.data?.pair?.pairToken, "s3 gets a duel pair for ch1");
  const cast = await s3.post("/api/duels/cast", { json: { pairToken: first.data.pair.pairToken, winnerNominationId: first.data.pair.aNominationId } });
  ok(cast.status === 200, "s3 casts the duel");
  const second = await s3.get(`/api/duels/next?challengeId=${ch1}`);
  ok(second.data?.pair === null && second.data?.reason === "exhausted", "s3's only remaining pair is excluded → {pair:null, exhausted}");

  // ── Reveal gating (#1) ──
  ok((await T.post(`/api/trips/${tripId}/advance`, { json: { to: "reveal" } })).status === 200, "advance voting→reveal (computeResults)");
  const publicDuringReveal = await new Client().get(`/api/trips/${tripId}/results`);
  ok(publicDuringReveal.status === 200 && (publicDuringReveal.data?.results?.length ?? 0) === 0, "public results EMPTY during reveal (gated)");
  const teacherDuringReveal = await T.get(`/api/trips/${tripId}/results`);
  ok((teacherDuringReveal.data?.results?.length ?? 0) > 0, "teacher sees results during reveal (projector)");

  ok((await T.post(`/api/trips/${tripId}/advance`, { json: { to: "grace" } })).status === 200, "advance reveal→grace (publish)");
  const publicAfter = await new Client().get(`/api/trips/${tripId}/results`);
  ok((publicAfter.data?.results?.length ?? 0) > 0, "public results VISIBLE after grace (published keepsake)");
}

// ─────────────────────────────────────────────────────────────────────────────
async function tripTieFlow() {
  console.log("\n\x1b[1mTrip B — shared placement + Grand Champion tie override (#3)\x1b[0m");
  const T = new Client();
  await T.post("/api/auth/teacher/dev-login", { json: { email: `teachB-${uniq()}@example.org` } });
  const tripId = (await T.post("/api/trips", {
    json: { name: "Tie Town", tripEndDate: "2026-12-31", maxTeamSize: 2,
      pointsTable: [{ placement: 1, points: 5 }, { placement: 2, points: 3 }], graceDays: 7, maxRetentionDays: 30 },
  })).data?.id;
  const ch = (await T.post("/api/challenges", { json: { tripId, title: "Solo", instructions: "", multiplier: 1 } })).data?.id;

  const b1e = `b1-${uniq()}@example.org`, b2e = `b2-${uniq()}@example.org`;
  await T.post(`/api/trips/${tripId}/roster`, { json: { emails: [b1e, b2e] } });
  await waitRosterDrained(T, tripId, 2);
  const b1 = await joinStudent(T, tripId, b1e), b2 = await joinStudent(T, tripId, b2e);
  await makeTeam(b1, "Xerox"); await makeTeam(b2, "Yankee");

  await T.post(`/api/trips/${tripId}/advance`, { json: { to: "challenge" } });
  for (const st of [b1, b2]) { const s = await upload(st, ch); await nominate(st, ch, s); }
  await approveAll(T, tripId);
  await T.post(`/api/trips/${tripId}/advance`, { json: { to: "voting" } });
  // 2 teams → the no-self-vote rule leaves every voter with <2 comparable nominations, so a
  // pair can never form. The API must say so distinctly (not "you've voted everything").
  const noPair = await b1.get(`/api/duels/next?challengeId=${ch}`);
  ok(noPair.data?.pair === null && noPair.data?.reason === "not_enough", "2-team trip → duel reason 'not_enough' (pairwise needs 3+ teams)");
  // No duels cast → both nominations sit at wilson 0 → a genuine tie.
  ok((await T.post(`/api/trips/${tripId}/advance`, { json: { to: "reveal" } })).status === 200, "advance to reveal with an unvoted challenge");

  const before = (await T.get(`/api/trips/${tripId}/results`)).data.results;
  const soloRows = before.filter((r) => r.challenge_title === "Solo");
  ok(soloRows.length === 2 && soloRows.every((r) => r.placement === 1), "tied Wilson → both share placement #1");
  const champs = before.filter((r) => r.is_grand_champion);
  ok(champs.length === 2, "equal totals → 2 Grand Champion co-champions");

  // Override guards + happy path.
  ok((await T.post(`/api/trips/${tripId}/grand-champion`, { json: { resultId: "00000000-0000-0000-0000-000000000000" } })).status === 404, "override with a non-champion id → 404");
  const chosen = champs[0];
  ok((await T.post(`/api/trips/${tripId}/grand-champion`, { json: { resultId: chosen.id } })).status === 200, "teacher crowns one co-champion → 200");
  const after = (await T.get(`/api/trips/${tripId}/results`)).data.results;
  const champsAfter = after.filter((r) => r.is_grand_champion);
  ok(champsAfter.length === 1 && champsAfter[0].team_name_vetted === chosen.team_name_vetted, "exactly one Grand Champion remains (the chosen team)");
  ok(after.filter((r) => r.challenge_title === "Solo").length === 2, "per-challenge placements untouched by the override");

  await T.post(`/api/trips/${tripId}/advance`, { json: { to: "grace" } });
  ok((await T.post(`/api/trips/${tripId}/grand-champion`, { json: { resultId: chosen.id } })).status === 409, "override refused outside reveal (409)");
}

// ─────────────────────────────────────────────────────────────────────────────
async function coTeacherFlow() {
  console.log("\n\x1b[1mCo-teacher invite — idempotent accept (StrictMode-safe)\x1b[0m");
  const O = new Client();
  await O.post("/api/auth/teacher/dev-login", { json: { email: `own-${uniq()}@example.org` } });
  const tripId = (await O.post("/api/trips", { json: { name: "Co Trip", tripEndDate: "2026-12-31" } })).data?.id;
  const coEmail = `co-${uniq()}@example.org`;
  ok((await O.post(`/api/trips/${tripId}/invites`, { json: { email: coEmail } })).status === 201, "owner invites a co-teacher");
  await sleep(200);
  const token = inviteToken(coEmail);
  ok(!!token, "invite token emailed");

  const CO = new Client();
  await CO.post("/api/auth/teacher/dev-login", { json: { email: coEmail } }); // signed in as the invitee
  ok((await CO.post("/api/invites/accept", { json: { token } })).status === 200, "first accept → 200");
  // The client auto-accepts on mount and React StrictMode double-invokes effects in dev,
  // so the same token legitimately arrives twice — the second must also succeed.
  ok((await CO.post("/api/invites/accept", { json: { token } })).status === 200, "second accept → 200 (idempotent)");
  ok(((await O.get(`/api/trips/${tripId}/teachers`)).data?.teachers?.length ?? 0) === 2, "trip now has 2 teachers");

  const W = new Client();
  await W.post("/api/auth/teacher/dev-login", { json: { email: `stranger-${uniq()}@example.org` } });
  const co2 = `co2-${uniq()}@example.org`;
  await O.post(`/api/trips/${tripId}/invites`, { json: { email: co2 } });
  await sleep(200);
  ok((await W.post("/api/invites/accept", { json: { token: inviteToken(co2) } })).status === 403, "wrong signed-in account → 403 (email must match)");
}

// ─────────────────────────────────────────────────────────────────────────────
try {
  const h = await fetch(`${BASE}/api/healthz`).then((r) => r.json()).catch(() => null);
  if (h?.status !== "ok") throw new Error(`API not healthy at ${BASE}`);
  await tripMainFlow();
  // /redeem is rate-limited to 5/min per IP; from one host the two trips share that bucket.
  console.log("\n(waiting 61s for the redeem rate-limit window to reset…)");
  await sleep(61_000);
  await tripTieFlow();
  await coTeacherFlow();
  console.log(`\n\x1b[1m${passed} passed, ${failures.length} failed\x1b[0m`);
  if (failures.length) { for (const f of failures) console.log(`  \x1b[31m- ${f}\x1b[0m`); process.exit(1); }
  console.log("\x1b[32mE2E OK\x1b[0m");
} catch (e) {
  console.error("\x1b[31mE2E crashed:\x1b[0m", e);
  process.exit(1);
}
