// Env schema, separated from config.ts so it can be unit-tested without triggering
// the parse-on-import (config.ts fails fast if the real env is incomplete).
import { z } from "zod";

export const Env = z.object({
  API_PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PUBLIC_BASE_URL: z.string().url(),

  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),

  // Object storage speaks the S3 API — works with MinIO, AWS S3, Cloudflare R2,
  // Backblaze B2, etc. Leave S3_ENDPOINT unset for AWS (derived from region);
  // set it to the provider's endpoint for MinIO/R2/B2.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_BUCKET: z.string().default("submissions"),
  // Path-style addressing (bucket in the URL path). Required for MinIO; AWS and R2
  // use virtual-hosted style, so set false there. NB: z.coerce.boolean() is a footgun
  // — Boolean("false") === true — so parse the string explicitly.
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),

  VAULT_ADDR: z.string().url(),
  VAULT_TOKEN: z.string(),
  VAULT_TRANSIT_MOUNT: z.string().default("transit"),

  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string(),
  OIDC_CLIENT_SECRET: z.string(),
  OIDC_REDIRECT_URI: z.string().url(),

  SESSION_SECRET: z.string().min(32),

  // Requests per minute per client IP: global floor, and the access-code routes
  // (redeem/reissue, anti brute-force). Raise only for test rigs where every browser
  // shares one IP (e2e behind the dev proxy) — never in production.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(5),

  // Antivirus (ClamAV clamd). Off by default so dev needs no AV service; enable in prod.
  AV_SCAN_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  CLAMAV_HOST: z.string().default("clamav"),
  CLAMAV_PORT: z.coerce.number().default(3310),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Trip Challenges <no-reply@example.org>"),
});

export type Config = z.infer<typeof Env>;
