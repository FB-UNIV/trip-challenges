import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

const av = vi.hoisted(() => ({
  enabled: false,
  scan: async (): Promise<{ clean: boolean; signature?: string }> => ({ clean: true }),
}));
vi.mock("../src/security/avscan.js", () => ({
  avScanEnabled: () => av.enabled,
  scanBuffer: () => av.scan(),
}));

import sharp from "sharp";
import { submissionRoutes } from "../src/routes/submissions.js";
import { objects } from "./support/fake-s3.js";
import {
  pool, resetAll, buildApp, teacherCookie, makeTeacher, makeTrip, makeStudent, makeTeam,
  makeChallenge, makeSubmission, makeNomination, count, auditActions, type StudentFixture,
} from "./support/harness.js";

const app = await buildApp([submissionRoutes, "/api/submissions"]);

// A real PNG carrying EXIF that the upload path must strip.
const photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3a7" } })
  .withExif({ IFD0: { Make: "KidPhone", ImageDescription: "45.4N 12.3E" } })
  .png()
  .toBuffer();

function form(data: Buffer, contentType = "image/png", filename = "p.png") {
  const boundary = `----vitest${Math.random().toString(16).slice(2)}`;
  const head =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

let owner: string, trip: string, ch: string, team: string, kid: StudentFixture;
beforeEach(async () => {
  await resetAll();
  av.enabled = false;
  av.scan = async () => ({ clean: true });
  owner = await makeTeacher();
  trip = await makeTrip(owner, { phase: "challenge" });
  ch = await makeChallenge(trip);
  kid = await makeStudent(trip);
  team = await makeTeam(trip, "Foxes", [kid.id]);
});

const upload = (cookie: string | undefined, data: Buffer, opts: { challengeId?: string | null; type?: string } = {}) => {
  const f = form(data, opts.type);
  const qs = opts.challengeId === null ? "" : `?challengeId=${opts.challengeId ?? ch}`;
  return app.inject({
    method: "POST", url: `/api/submissions${qs}`, payload: f.payload,
    headers: { ...f.headers, ...(cookie ? { cookie } : {}) },
  });
};
const photoOf = (id: string, cookie?: string) =>
  app.inject({ method: "GET", url: `/api/submissions/${id}/photo`, headers: cookie ? { cookie } : {} });

describe("POST /api/submissions (upload)", () => {
  it("normalises to JPEG, strips metadata, and stores only the sealed blob", async () => {
    const res = await upload(kid.cookie, photo);
    expect(res.statusCode).toBe(201);
    const { id } = res.json();

    const stored = objects.get(`${trip}/${id}`)!;
    expect(stored.readUInt8(0)).toBe(1); // envelope frame version, not raw image bytes
    expect(stored.includes(Buffer.from("KidPhone"))).toBe(false);

    const got = await photoOf(id, kid.cookie);
    expect(got.headers["content-type"]).toBe("image/jpeg");
    expect(got.headers["cache-control"]).toBe("no-store");
    const meta = await sharp(got.rawPayload).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([40, 30]);
  });

  it("rejects non-images and unreadable images", async () => {
    expect((await upload(kid.cookie, Buffer.from("hello"), { type: "text/plain" })).json().error).toBe("bad_file");
    expect((await upload(kid.cookie, Buffer.from("not really a png"))).json().error).toBe("bad_image");
    expect(await count("submission")).toBe(0);
  });

  it("enforces session, team, challenge and phase", async () => {
    expect((await upload(undefined, photo)).statusCode).toBe(401);
    const loner = await makeStudent(trip);
    expect((await upload(loner.cookie, photo)).json().error).toBe("no_team");
    expect((await upload(kid.cookie, photo, { challengeId: null })).statusCode).toBe(400);
    const foreign = await makeChallenge(await makeTrip(owner, { phase: "challenge" }));
    expect((await upload(kid.cookie, photo, { challengeId: foreign })).statusCode).toBe(404);
    await pool.query(`UPDATE trip SET phase = 'voting' WHERE id = $1`, [trip]);
    expect((await upload(kid.cookie, photo)).json().error).toBe("closed");
  });

  describe("with antivirus enabled", () => {
    beforeEach(() => { av.enabled = true; });

    it("accepts clean files", async () => {
      expect((await upload(kid.cookie, photo)).statusCode).toBe(201);
    });

    it("rejects infected files and audits it", async () => {
      av.scan = async () => ({ clean: false, signature: "Eicar-Test-Signature" });
      const res = await upload(kid.cookie, photo);
      expect(res.statusCode).toBe(422);
      expect(await count("submission")).toBe(0);
      expect(await auditActions(trip)).toContain("submission_infected_rejected");
    });

    it("fails closed when the scanner is down", async () => {
      av.scan = async () => { throw new Error("ECONNREFUSED"); };
      expect((await upload(kid.cookie, photo)).statusCode).toBe(503);
      expect(await count("submission")).toBe(0);
    });
  });
});

describe("GET /api/submissions (my team's photos)", () => {
  it("lists the team's non-removed submissions with their nomination flag", async () => {
    const a = await makeSubmission(trip, ch, team, kid.id, { createdAt: new Date("2030-01-01T10:00:00Z") });
    const b = await makeSubmission(trip, ch, team, kid.id, { createdAt: new Date("2030-01-01T11:00:00Z") });
    const removed = await makeSubmission(trip, ch, team, kid.id);
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [removed, owner]);
    await makeNomination(trip, ch, team, a, "pending");

    const res = await app.inject({ method: "GET", url: `/api/submissions?challengeId=${ch}`, headers: { cookie: kid.cookie } });
    expect(res.json().submissions.map((s: any) => [s.id, s.nominated])).toEqual([[b, false], [a, true]]);
  });

  // #81: each photo says where it stands, so the rejected one can be marked.
  it("gives each photo its entry state, a rejected one included", async () => {
    const a = await makeSubmission(trip, ch, team, kid.id, { createdAt: new Date("2030-01-01T10:00:00Z") });
    const b = await makeSubmission(trip, ch, team, kid.id, { createdAt: new Date("2030-01-01T11:00:00Z") });
    const c = await makeSubmission(trip, ch, team, kid.id, { createdAt: new Date("2030-01-01T12:00:00Z") });
    const rejected = await makeNomination(trip, ch, team, a, "pending");
    await pool.query(`UPDATE nomination SET state = 'rejected', active = false WHERE id = $1`, [rejected]);
    await makeNomination(trip, ch, team, b, "approved");

    const res = await app.inject({ method: "GET", url: `/api/submissions?challengeId=${ch}`, headers: { cookie: kid.cookie } });
    expect(res.json().submissions.map((s: any) => [s.id, s.nominated, s.entry])).toEqual([
      [c, false, null], [b, true, "approved"], [a, false, "rejected"],
    ]);
  });

  it("is empty without a team; needs a session and challengeId", async () => {
    const loner = await makeStudent(trip);
    expect((await app.inject({ method: "GET", url: `/api/submissions?challengeId=${ch}`, headers: { cookie: loner.cookie } })).json())
      .toEqual({ submissions: [] });
    expect((await app.inject({ method: "GET", url: `/api/submissions?challengeId=${ch}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/submissions`, headers: { cookie: kid.cookie } })).statusCode).toBe(400);
  });
});

describe("GET /api/submissions/:id/photo (visibility)", () => {
  let sub: string;
  let rival: StudentFixture;
  beforeEach(async () => {
    sub = await makeSubmission(trip, ch, team, kid.id, { bytes: Buffer.from("secret-photo") });
    rival = await makeStudent(trip);
    await makeTeam(trip, "Owls", [rival.id]);
  });

  it("shows the owning team and trip teachers, decrypted", async () => {
    expect((await photoOf(sub, kid.cookie)).body).toBe("secret-photo");
    expect((await photoOf(sub, teacherCookie(app, owner))).body).toBe("secret-photo");
  });

  it("hides it from other teams until it is an approved nomination during voting/reveal", async () => {
    expect((await photoOf(sub, rival.cookie)).statusCode).toBe(403);
    await makeNomination(trip, ch, team, sub, "approved");
    expect((await photoOf(sub, rival.cookie)).statusCode).toBe(403); // still challenge phase
    await pool.query(`UPDATE trip SET phase = 'voting' WHERE id = $1`, [trip]);
    expect((await photoOf(sub, rival.cookie)).statusCode).toBe(200);
  });

  it("never shows it to other trips' students or teachers, or anonymously", async () => {
    await makeNomination(trip, ch, team, sub, "approved");
    await pool.query(`UPDATE trip SET phase = 'voting' WHERE id = $1`, [trip]);
    const elsewhere = await makeTrip(await makeTeacher(), { phase: "voting" });
    expect((await photoOf(sub, (await makeStudent(elsewhere)).cookie)).statusCode).toBe(403);
    expect((await photoOf(sub, teacherCookie(app, await makeTeacher()))).statusCode).toBe(403);
    expect((await photoOf(sub)).statusCode).toBe(403);
  });

  it("404s for removed or unknown photos", async () => {
    await pool.query(`UPDATE submission SET removed_by_teacher_id = $2 WHERE id = $1`, [sub, owner]);
    expect((await photoOf(sub, teacherCookie(app, owner))).statusCode).toBe(404);
    expect((await photoOf("00000000-0000-0000-0000-000000000000", kid.cookie)).statusCode).toBe(404);
  });
});

describe("POST /api/submissions/:id/remove (teacher oversight)", () => {
  it("removes the photo, withdraws its nomination and audits", async () => {
    const sub = await makeSubmission(trip, ch, team, kid.id);
    const nom = await makeNomination(trip, ch, team, sub, "approved");
    const res = await app.inject({ method: "POST", url: `/api/submissions/${sub}/remove`, headers: { cookie: teacherCookie(app, owner) } });
    expect(res.json()).toEqual({ ok: true });
    expect(await count("submission", "id = $1 AND removed_by_teacher_id = $2", [sub, owner])).toBe(1);
    expect(await count("nomination", "id = $1 AND active", [nom])).toBe(0);
    expect(await auditActions(trip)).toContain("submission_removed");
  });

  it("requires a teacher of that trip", async () => {
    const sub = await makeSubmission(trip, ch, team, kid.id);
    expect((await app.inject({ method: "POST", url: `/api/submissions/${sub}/remove` })).statusCode).toBe(401);
    const stranger = teacherCookie(app, await makeTeacher());
    expect((await app.inject({ method: "POST", url: `/api/submissions/${sub}/remove`, headers: { cookie: stranger } })).statusCode).toBe(404);
  });
});
