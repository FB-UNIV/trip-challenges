// The HTTP app: plugins + every route plugin. server.ts adds boot steps and listen();
// tests build this same app (test/server.test.ts).
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { loggerOptions } from "./lib/logging.js";
import { healthRoutes } from "./routes/health.js";
import { studentAuthRoutes } from "./routes/student-auth.js";
import { duelRoutes } from "./routes/duels.js";
import { teacherAuthRoutes } from "./routes/teacher-auth.js";
import { tripRoutes } from "./routes/trips.js";
import { rosterRoutes } from "./routes/roster.js";
import { tripInviteRoutes, inviteRoutes } from "./routes/invites.js";
import { challengeRoutes } from "./routes/challenges.js";
import { teamRoutes } from "./routes/teams.js";
import { nominationRoutes } from "./routes/nominations.js";
import { submissionRoutes } from "./routes/submissions.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // Never log student PII or bearer secrets (Erasure › logs, #20): see lib/logging.ts.
    logger: loggerOptions(config.NODE_ENV),
    bodyLimit: 15 * 1024 * 1024, // 15MB — photo uploads
  });

  await app.register(helmet, { contentSecurityPolicy: false }); // CSP handled at edge
  await app.register(cors, { origin: config.PUBLIC_BASE_URL, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: "1 minute" }); // global floor
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

  await app.register(healthRoutes);
  await app.register(teacherAuthRoutes, { prefix: "/api/auth/teacher" });
  await app.register(tripRoutes, { prefix: "/api/trips" });
  await app.register(rosterRoutes, { prefix: "/api/trips" });
  await app.register(tripInviteRoutes, { prefix: "/api/trips" });
  await app.register(inviteRoutes, { prefix: "/api/invites" });
  await app.register(challengeRoutes, { prefix: "/api/challenges" });
  await app.register(teamRoutes, { prefix: "/api/teams" });
  await app.register(nominationRoutes, { prefix: "/api/nominations" });
  await app.register(studentAuthRoutes, { prefix: "/api/student" });
  await app.register(submissionRoutes, { prefix: "/api/submissions" });
  await app.register(duelRoutes, { prefix: "/api/duels" });
  return app;
}
