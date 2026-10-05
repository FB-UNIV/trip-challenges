import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("pg", () => import("./support/fake-pg.js"));
vi.mock("../src/config.js", () => import("./support/config.js"));
vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"));
vi.mock("../src/storage/s3.js", () => import("./support/fake-s3.js"));
vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"));

// Fake PocketID client: records the checks it's handed and returns fixed claims.
const oidc = vi.hoisted(() => ({
  claims: {} as Record<string, string | undefined>,
  callbackChecks: null as Record<string, string> | null,
}));
vi.mock("../src/auth/oidc.js", async () => {
  const { generators } = await import("openid-client");
  return {
    oidcGenerators: generators,
    getOidcClient: async () => ({
      authorizationUrl: (p: Record<string, string>) => `http://idp.test/authorize?state=${p.state}&cc=${p.code_challenge}`,
      callbackParams: () => ({ code: "abc" }),
      callback: async (_uri: string, _params: unknown, checks: Record<string, string>) => {
        oidc.callbackChecks = checks;
        return { claims: () => oidc.claims };
      },
    }),
  };
});

import { teacherAuthRoutes } from "../src/routes/teacher-auth.js";
import { pool, resetAll, buildApp, teacherCookie, makeTeacher } from "./support/harness.js";

const app = await buildApp([teacherAuthRoutes, "/api/auth/teacher"]);

beforeEach(async () => {
  await resetAll();
  oidc.claims = { sub: "pocket|42", email: "ana@school.test", name: "Ana" };
  oidc.callbackChecks = null;
});

type Res = { cookies: { name: string; value: string }[] };
const jar = (...responses: Res[]) =>
  responses.flatMap((r) => r.cookies).filter((c) => c.value).map((c) => `${c.name}=${c.value}`).join("; ");

describe("OIDC login flow", () => {
  it("redirects to the IdP with PKCE and stashes the checks in signed cookies", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/teacher/login?returnTo=/teacher/trips" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^http:\/\/idp\.test\/authorize\?state=.+&cc=.+/);
    expect(res.cookies.map((c) => c.name).sort()).toEqual(["oidc_cv", "oidc_nonce", "oidc_return", "oidc_state"]);
    for (const c of res.cookies) expect(c).toMatchObject({ httpOnly: true, path: "/api/auth/teacher" });
  });

  it.each(["//evil.test/x", "https://evil.test", "evil"])("ignores an unsafe returnTo (%s)", async (rt) => {
    const res = await app.inject({ method: "GET", url: `/api/auth/teacher/login?returnTo=${encodeURIComponent(rt)}` });
    expect(res.cookies.map((c) => c.name)).not.toContain("oidc_return");
  });

  it("callback verifies the stashed checks, upserts the teacher and opens a session", async () => {
    const login = await app.inject({ method: "GET", url: "/api/auth/teacher/login?returnTo=/teacher/accept" });
    const res = await app.inject({ method: "GET", url: "/api/auth/teacher/callback?code=abc", headers: { cookie: jar(login) } });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/teacher/accept");
    expect(oidc.callbackChecks).toMatchObject({ state: expect.any(String), nonce: expect.any(String), code_verifier: expect.any(String) });
    const session = res.cookies.find((c) => c.name === "teacher_session")!;
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Strict", maxAge: 8 * 3600 });

    const me = await app.inject({ method: "GET", url: "/api/auth/teacher/me", headers: { cookie: `teacher_session=${session.value}` } });
    expect(me.json()).toMatchObject({ email: "ana@school.test", display_name: "Ana" });

    // Same subject again → same teacher row, refreshed profile.
    oidc.claims = { sub: "pocket|42", email: "ana.new@school.test", name: undefined };
    await app.inject({ method: "GET", url: "/api/auth/teacher/callback?code=abc", headers: { cookie: jar(login) } });
    const { rows } = await pool.query(`SELECT email, display_name FROM teacher`);
    expect(rows).toEqual([{ email: "ana.new@school.test", display_name: "" }]);
  });

  it("defaults to / and rejects a callback without valid signed checks", async () => {
    const login = await app.inject({ method: "GET", url: "/api/auth/teacher/login" });
    const ok = await app.inject({ method: "GET", url: "/api/auth/teacher/callback", headers: { cookie: jar(login) } });
    expect(ok.headers.location).toBe("/");

    const forged = await app.inject({ method: "GET", url: "/api/auth/teacher/callback", headers: { cookie: "oidc_state=x; oidc_nonce=y; oidc_cv=z" } });
    expect(forged.statusCode).toBe(400);
  });
});

describe("session endpoints", () => {
  it("/me 401s without a valid session or for a deleted teacher", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/teacher/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/auth/teacher/me", headers: { cookie: "teacher_session=forged" } })).statusCode).toBe(401);
    const gone = teacherCookie(app, "00000000-0000-0000-0000-000000000000");
    expect((await app.inject({ method: "GET", url: "/api/auth/teacher/me", headers: { cookie: gone } })).statusCode).toBe(401);
  });

  it("dev-login (non-production only) creates and signs in a teacher", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/teacher/dev-login", payload: { email: "dev@school.test" } });
    const { teacherId } = res.json();
    const me = await app.inject({ method: "GET", url: "/api/auth/teacher/me", headers: { cookie: jar(res) } });
    expect(me.json()).toMatchObject({ id: teacherId, email: "dev@school.test" });
    // Default address when none given.
    const anon = await app.inject({ method: "POST", url: "/api/auth/teacher/dev-login", payload: {} });
    expect(anon.json().ok).toBe(true);
  });

  it("logout clears the session cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/teacher/logout", headers: { cookie: teacherCookie(app, await makeTeacher()) } });
    expect(res.json()).toEqual({ ok: true });
    expect(res.cookies.find((c) => c.name === "teacher_session")?.value).toBe("");
  });
});
