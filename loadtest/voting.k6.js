// Load test (#63): 50 students voting at once (the worst case for a trip), plus 5 uploading.
// Seed first (loadtest/seed.mts), then:  k6 run loadtest/voting.k6.js
// Numbers on shared CI runners are relative (before/after), not absolute capacity.
//
// Knobs (k6 -e NAME=value), e.g. a photo-heavy run: -e UPLOADERS=50 -e THINK=1 -e VOTERS=100
//   VOTERS      voting students (default 50; more than the seeded students reuse their sessions)
//   UPLOADERS   students uploading at once (default 5; seed at least that many: --uploaders N)
//   THINK       max seconds a voter looks at a pair before picking (default 3; min is a third)
//   UPLOAD_GAP  max seconds between one phone's uploads (default 7; min is a third)
//   STEADY      how long the full load holds (default 2m)
import http from "k6/http";
import { check, sleep } from "k6";

const state = JSON.parse(open("./.state.json"));
const photo = open("./.photo.jpg", "b");
const BASE = __ENV.BASE_URL || state.baseUrl;

// A refused cast (pair already judged, voting closed) is an answer, not a failure.
const castOk = http.expectedStatuses(200, 201, 409);

const VOTERS = Number(__ENV.VOTERS || 50);
const UPLOADERS = Number(__ENV.UPLOADERS || 5);
const THINK = Number(__ENV.THINK || 3);
const UPLOAD_GAP = Number(__ENV.UPLOAD_GAP || 7);
const STEADY = __ENV.STEADY || "2m";
const between = (max) => max / 3 + Math.random() * (max * 2 / 3);

export const options = {
  scenarios: {
    voting: {
      executor: "ramping-vus", exec: "vote", startVUs: 0,
      stages: [{ duration: "30s", target: VOTERS }, { duration: STEADY, target: VOTERS }, { duration: "10s", target: 0 }],
    },
    uploads: {
      executor: "ramping-vus", exec: "upload", startVUs: 0,
      stages: [{ duration: "30s", target: UPLOADERS }, { duration: STEADY, target: UPLOADERS }, { duration: "10s", target: 0 }],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{ep:me}": ["p(95)<500"],
    "http_req_duration{ep:next}": ["p(95)<500"],
    "http_req_duration{ep:cast}": ["p(95)<500"],
    "http_req_duration{ep:photo}": ["p(95)<1500"],
    "http_req_duration{ep:upload}": ["p(95)<3000"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
};

const as = (cookie, ep) => ({ headers: { cookie }, tags: { ep } });

export function vote() {
  const cookie = state.students[(__VU - 1) % state.students.length];
  if (__ITER % 10 === 0) {
    check(http.get(`${BASE}/api/student/me`, as(cookie, "me")), { "me 200": (r) => r.status === 200 });
  }
  const challengeId = state.challenges[__ITER % state.challenges.length];
  const next = http.get(`${BASE}/api/duels/next?challengeId=${challengeId}`, as(cookie, "next"));
  check(next, { "next 200": (r) => r.status === 200 });
  const pair = next.status === 200 ? next.json("pair") : null;
  if (!pair) { sleep(2); return; } // this voter has judged every pair here

  const photos = http.batch([
    ["GET", `${BASE}/api/submissions/${pair.aSubmissionId}/photo`, null, as(cookie, "photo")],
    ["GET", `${BASE}/api/submissions/${pair.bSubmissionId}/photo`, null, as(cookie, "photo")],
  ]);
  check(photos, { "photos 200": (rs) => rs.every((r) => r.status === 200) });

  sleep(between(THINK)); // looking at the two photos
  const winner = Math.random() < 0.5 ? pair.aNominationId : pair.bNominationId;
  const cast = http.post(
    `${BASE}/api/duels/cast`,
    JSON.stringify({ pairToken: pair.pairToken, winnerNominationId: winner }),
    { headers: { cookie, "content-type": "application/json" }, tags: { ep: "cast" }, responseCallback: castOk },
  );
  check(cast, { "cast accepted": (r) => r.status === 200 || r.status === 201 || r.status === 409 });
}

export function upload() {
  const cookie = state.upload.students[(__VU - 1) % state.upload.students.length];
  const res = http.post(
    `${BASE}/api/submissions?challengeId=${state.upload.challengeId}`,
    { file: http.file(photo, "photo.jpg", "image/jpeg") },
    as(cookie, "upload"),
  );
  check(res, { "upload 201": (r) => r.status === 201 });
  sleep(between(UPLOAD_GAP)); // a phone uploads now and then, not in a tight loop
}

export function handleSummary(data) {
  return { "loadtest/summary.json": JSON.stringify(data, null, 2) };
}
