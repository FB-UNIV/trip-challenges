import { describe, it, expect } from "vitest";
import { Env } from "../src/env-schema.js";

// Minimal valid env for the required fields.
const base = {
  PUBLIC_BASE_URL: "http://localhost",
  POSTGRES_HOST: "db",
  POSTGRES_DB: "trip",
  POSTGRES_USER: "trip",
  POSTGRES_PASSWORD: "pw",
  S3_ACCESS_KEY_ID: "u",
  S3_SECRET_ACCESS_KEY: "p",
  VAULT_ADDR: "http://vault:8200",
  VAULT_TOKEN: "t",
  OIDC_ISSUER: "http://idp",
  OIDC_CLIENT_ID: "id",
  OIDC_CLIENT_SECRET: "sec",
  OIDC_REDIRECT_URI: "http://localhost/cb",
  SESSION_SECRET: "x".repeat(32),
};

describe("env schema", () => {
  // Regression: z.coerce.boolean() would turn "false" into true (Boolean("false")),
  // which would silently force path-style against a provider that needs virtual-hosted.
  it("parses S3_FORCE_PATH_STYLE='false' as false", () => {
    expect(Env.parse({ ...base, S3_FORCE_PATH_STYLE: "false" }).S3_FORCE_PATH_STYLE).toBe(false);
  });
  it("parses S3_FORCE_PATH_STYLE='true' as true", () => {
    expect(Env.parse({ ...base, S3_FORCE_PATH_STYLE: "true" }).S3_FORCE_PATH_STYLE).toBe(true);
  });
  it("defaults S3_FORCE_PATH_STYLE to true (MinIO-friendly) and S3_ENDPOINT to undefined (AWS)", () => {
    const parsed = Env.parse(base);
    expect(parsed.S3_FORCE_PATH_STYLE).toBe(true);
    expect(parsed.S3_ENDPOINT).toBeUndefined();
  });

  it("rejects a too-short SESSION_SECRET", () => {
    expect(Env.safeParse({ ...base, SESSION_SECRET: "short" }).success).toBe(false);
  });
  it("requires PUBLIC_BASE_URL to be a URL", () => {
    expect(Env.safeParse({ ...base, PUBLIC_BASE_URL: "not-a-url" }).success).toBe(false);
  });

  it("defaults: 600/min per client, 5/min per access code, 20/min reissue, trusting private proxies (#67)", () => {
    const parsed = Env.parse(base);
    expect(parsed.RATE_LIMIT_MAX).toBe(600);
    expect(parsed.RATE_LIMIT_AUTH_MAX).toBe(5);
    expect(parsed.RATE_LIMIT_REISSUE_MAX).toBe(20);
    expect(parsed.TRUST_PROXY).toBe("loopback,linklocal,uniquelocal");
  });
  it("lets rate limits be raised from the env (e2e runs every browser through one IP)", () => {
    const parsed = Env.parse({ ...base, RATE_LIMIT_MAX: "10000", RATE_LIMIT_AUTH_MAX: "500" });
    expect(parsed.RATE_LIMIT_MAX).toBe(10000);
    expect(parsed.RATE_LIMIT_AUTH_MAX).toBe(500);
  });
  it("rejects a non-positive rate limit", () => {
    expect(Env.safeParse({ ...base, RATE_LIMIT_AUTH_MAX: "0" }).success).toBe(false);
  });
  it("accepts optional alert email and heartbeat URL, validating both", () => {
    expect(Env.parse(base).ALERT_EMAIL).toBeUndefined();
    const parsed = Env.parse({ ...base, ALERT_EMAIL: "ops@school.test", HEARTBEAT_URL: "https://hc.example/ping/abc" });
    expect(parsed).toMatchObject({ ALERT_EMAIL: "ops@school.test", HEARTBEAT_URL: "https://hc.example/ping/abc" });
    expect(Env.safeParse({ ...base, ALERT_EMAIL: "nope" }).success).toBe(false);
    expect(Env.safeParse({ ...base, HEARTBEAT_URL: "nope" }).success).toBe(false);
  });
});
