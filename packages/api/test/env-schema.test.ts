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
});
