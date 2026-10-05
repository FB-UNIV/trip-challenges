// Single source for e2e endpoints. Defaults match docker-compose.dev.yml +
// e2e/docker-compose.e2e.yml; every value can be overridden from the environment.
const e = process.env;

export const WEB_PORT = Number(e.E2E_WEB_PORT ?? 5174);
export const API_PORT = Number(e.E2E_API_PORT ?? 3101);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

export const MAILPIT_URL = e.E2E_MAILPIT_URL ?? "http://localhost:8025";
export const VAULT_ADDR = e.E2E_VAULT_ADDR ?? "http://localhost:8200";
export const VAULT_TOKEN = e.E2E_VAULT_TOKEN ?? "dev-root-token";
export const S3_ENDPOINT = e.E2E_S3_ENDPOINT ?? "http://localhost:9000";
export const S3_BUCKET = e.E2E_S3_BUCKET ?? "e2e-submissions";
export const S3_KEY = e.E2E_S3_KEY ?? "trip-minio";
export const S3_SECRET = e.E2E_S3_SECRET ?? "devpass123";
export const PG = {
  host: e.E2E_PG_HOST ?? "localhost",
  port: Number(e.E2E_PG_PORT ?? 5432),
  database: e.E2E_PG_DB ?? "trip",
  user: e.E2E_PG_USER ?? "trip",
  password: e.E2E_PG_PASSWORD ?? "devpass",
};

/** Environment for the API process Playwright starts (see playwright.config.ts). */
export const apiEnv: Record<string, string> = {
  NODE_ENV: "development", // enables /api/auth/teacher/dev-login; never "production" here
  API_PORT: String(API_PORT),
  PUBLIC_BASE_URL: WEB_URL, // links in emails point at the e2e web server
  POSTGRES_HOST: PG.host,
  POSTGRES_PORT: String(PG.port),
  POSTGRES_DB: PG.database,
  POSTGRES_USER: PG.user,
  POSTGRES_PASSWORD: PG.password,
  S3_ENDPOINT,
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: S3_KEY,
  S3_SECRET_ACCESS_KEY: S3_SECRET,
  S3_BUCKET,
  S3_FORCE_PATH_STYLE: "true",
  VAULT_ADDR,
  VAULT_TOKEN,
  VAULT_TRANSIT_MOUNT: "transit",
  // Teacher login uses dev-login in e2e; OIDC discovery is never reached.
  OIDC_ISSUER: "http://localhost:9/unused",
  OIDC_CLIENT_ID: "e2e",
  OIDC_CLIENT_SECRET: "e2e",
  OIDC_REDIRECT_URI: `${WEB_URL}/api/auth/teacher/callback`,
  SESSION_SECRET: "e2e-session-secret-not-for-production-use-0123456789",
  SMTP_HOST: e.E2E_SMTP_HOST ?? "localhost",
  SMTP_PORT: e.E2E_SMTP_PORT ?? "1025",
  SMTP_FROM: "Trip Challenges E2E <e2e@trip.test>",
  AV_SCAN_ENABLED: "false",
  // Every browser reaches the API through the Vite proxy, i.e. from one IP.
  RATE_LIMIT_MAX: "100000",
  RATE_LIMIT_AUTH_MAX: "10000",
};
