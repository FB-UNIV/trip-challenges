// Stand-in for src/config.ts (which parses the real process env on import).
// Mock with: vi.mock("../src/config.js", () => import("./support/config.js"))
import { Env } from "../../src/env-schema.js";

export const config = Env.parse({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "http://app.test",
  POSTGRES_HOST: "pglite",
  POSTGRES_DB: "trip",
  POSTGRES_USER: "trip",
  POSTGRES_PASSWORD: "unused",
  S3_ACCESS_KEY_ID: "unused",
  S3_SECRET_ACCESS_KEY: "unused",
  VAULT_ADDR: "http://vault.test",
  VAULT_TOKEN: "vault-token",
  OIDC_ISSUER: "http://idp.test",
  OIDC_CLIENT_ID: "client",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_REDIRECT_URI: "http://app.test/api/auth/teacher/callback",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  RATE_LIMIT_MAX: "8", // small, so the limits are cheap to hit in tests
  RATE_LIMIT_AUTH_MAX: "3",
  RATE_LIMIT_STUDENT_MAX: "40", // above any single test's use of one student
  ALERT_EMAIL: "ops@school.test",
  HEARTBEAT_URL: "http://heartbeat.test/ping",
});
