// Teacher auth via PocketID OIDC (ADR-0005). No local passwords.
// Flow: /login -> PocketID -> /callback -> upsert teacher, set signed session cookie.
import type { FastifyInstance } from "fastify";
import { getOidcClient, oidcGenerators } from "../auth/oidc.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { guard } from "../auth/guard.js";
import { readTeacher, teacherSessionValue, TEACHER_SESSION_TTL_MS } from "../auth/teacher.js";

const TEN_MIN = 600;

// Guard against open redirects: only same-origin absolute paths. "//host" is
// protocol-relative (external) so it must be rejected — and so are "/\host" and
// "/<TAB>/host", which browsers read as "//host" ("\" is "/", tabs and newlines are dropped).
function isSafeReturnTo(v: unknown): v is string {
  if (typeof v !== "string" || !v.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(v)) return false;
  const base = new URL(config.PUBLIC_BASE_URL);
  return new URL(v, base).origin === base.origin;
}

// Cookies are Secure in production (HTTPS at the edge); relaxed in dev over http.
const secureCookies = config.NODE_ENV === "production";

function setTeacherSession(reply: import("fastify").FastifyReply, teacherId: string) {
  reply.setCookie("teacher_session", teacherSessionValue(teacherId), {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
    path: "/",
    signed: true,
    maxAge: TEACHER_SESSION_TTL_MS / 1000, // 8 h, also enforced server-side (readTeacher)
  });
}

export async function teacherAuthRoutes(app: FastifyInstance) {
  // These routes establish (or read) the teacher session, so none can require one.
  const open = { preHandler: guard({ role: "public" }) };

  app.get("/login", open, async (req, reply) => {
    const client = await getOidcClient();
    const state = oidcGenerators.state();
    const nonce = oidcGenerators.nonce();
    const codeVerifier = oidcGenerators.codeVerifier();
    const codeChallenge = oidcGenerators.codeChallenge(codeVerifier);

    // Stash checks in short-lived signed cookies until callback.
    const cookieOpts = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/api/auth/teacher", signed: true, maxAge: TEN_MIN };
    reply.setCookie("oidc_state", state, cookieOpts);
    reply.setCookie("oidc_nonce", nonce, cookieOpts);
    reply.setCookie("oidc_cv", codeVerifier, cookieOpts);
    // Optional post-login destination. Only same-origin paths (no open redirect).
    const returnTo = (req.query as { returnTo?: string })?.returnTo;
    if (isSafeReturnTo(returnTo)) reply.setCookie("oidc_return", returnTo, cookieOpts);

    const url = client.authorizationUrl({
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return reply.redirect(url);
  });

  app.get("/callback", open, async (req, reply) => {
    const client = await getOidcClient();
    const state = reply.unsignCookie(req.cookies["oidc_state"] ?? "");
    const nonce = reply.unsignCookie(req.cookies["oidc_nonce"] ?? "");
    const cv = reply.unsignCookie(req.cookies["oidc_cv"] ?? "");
    if (!state.valid || !nonce.valid || !cv.valid) {
      return reply.code(400).send({ error: "bad_state", message: "La connexion a échoué (vérifications OIDC manquantes ou non valides). Réessaie." });
    }

    const tokenSet = await client.callback(
      config.OIDC_REDIRECT_URI,
      client.callbackParams(req.raw),
      { state: state.value!, nonce: nonce.value!, code_verifier: cv.value! },
    );
    const claims = tokenSet.claims();

    // The email is what a co-teacher invite is bound to (and where erasure warnings go), so
    // it must be one the IdP verified: an unverified address would let any account claim
    // someone else's invite. PocketID marks its users' emails verified.
    if (claims.email_verified !== true || !claims.email) {
      return reply.code(403).send({
        error: "email_unverified",
        message: "Ton adresse e-mail n'est pas vérifiée auprès du service de connexion. Contacte l'administrateur.",
      });
    }

    // Upsert teacher by stable OIDC subject.
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO teacher (oidc_subject, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (oidc_subject) DO UPDATE
         SET email = EXCLUDED.email, display_name = EXCLUDED.display_name
       RETURNING id`,
      [claims.sub, claims.email ?? "", claims.name ?? ""],
    );
    const teacherId = rows[0]!.id;

    // Resolve post-login destination before clearing cookies.
    const rt = reply.unsignCookie(req.cookies["oidc_return"] ?? "");
    const dest = rt.valid && isSafeReturnTo(rt.value) ? rt.value! : "/";

    // Clear transient cookies, set the session.
    for (const c of ["oidc_state", "oidc_nonce", "oidc_cv", "oidc_return"]) {
      reply.clearCookie(c, { path: "/api/auth/teacher" });
    }
    setTeacherSession(reply, teacherId);
    return reply.redirect(dest); // back to the PWA (teacher view / invite accept)
  });

  // DEV ONLY: log in as a teacher without OIDC. Never enabled in production.
  if (config.NODE_ENV !== "production") {
    app.post("/dev-login", open, async (req, reply) => {
      const email = (req.body as { email?: string })?.email ?? "dev-teacher@example.org";
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO teacher (oidc_subject, email, display_name)
         VALUES ($1, $2, 'Dev Teacher')
         ON CONFLICT (oidc_subject) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [`dev|${email}`, email],
      );
      setTeacherSession(reply, rows[0]!.id);
      return { ok: true, teacherId: rows[0]!.id };
    });
  }

  app.post("/logout", open, async (_req, reply) => {
    reply.clearCookie("teacher_session", { path: "/" });
    return { ok: true };
  });

  // Who am I? (UI bootstrap) Reads the session itself: a stale cookie for a deleted teacher is a 401 too.
  app.get("/me", open, async (req, reply) => {
    const teacher = readTeacher(req, reply);
    if (!teacher) return reply.code(401).send({ error: "unauthorized", message: "Tu n'es pas connecté." });
    const { rows } = await pool.query(
      `SELECT id, email, display_name FROM teacher WHERE id = $1`,
      [teacher.teacherId],
    );
    if (!rows[0]) return reply.code(401).send({ error: "unauthorized", message: "Tu n'es pas connecté." });
    return rows[0];
  });
}
