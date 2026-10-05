import { vi, describe, it, expect, afterEach } from "vitest";
import sharp from "sharp";

vi.mock("../src/config.js", () => import("./support/config.js"));

const discover = vi.hoisted(() => vi.fn());
vi.mock("openid-client", () => ({
  Issuer: { discover },
  generators: { state: () => "s" },
}));

import { getOidcClient, oidcGenerators } from "../src/auth/oidc.js";
import { normalizeImage } from "../src/lib/image.js";

describe("getOidcClient", () => {
  it("discovers the issuer once and builds a code-flow client", async () => {
    class Client { constructor(public meta: unknown) {} }
    discover.mockResolvedValue({ Client });
    const a = await getOidcClient();
    const b = await getOidcClient();
    expect(a).toBe(b);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith("http://idp.test");
    expect((a as unknown as Client).meta).toEqual({
      client_id: "client",
      client_secret: "secret",
      redirect_uris: ["http://app.test/api/auth/teacher/callback"],
      response_types: ["code"],
    });
    expect(oidcGenerators.state()).toBe("s");
  });
});

describe("normalizeImage", () => {
  const img = (w: number, h: number) =>
    sharp({ create: { width: w, height: h, channels: 3, background: "#888" } });

  it("re-encodes to JPEG and drops all metadata", async () => {
    const input = await img(10, 10).withExif({ IFD0: { Make: "KidPhone" } }).png().toBuffer();
    const out = await normalizeImage(input);
    expect(out.contentType).toBe("image/jpeg");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
  });

  it("bakes in EXIF orientation before dropping it", async () => {
    const rotated = await img(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const meta = await sharp((await normalizeImage(rotated)).bytes).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.orientation).toBeUndefined();
  });

  it("caps the longest side at 2000px without enlarging small images", async () => {
    const big = await sharp((await normalizeImage(await img(4000, 1000).png().toBuffer())).bytes).metadata();
    expect([big.width, big.height]).toEqual([2000, 500]);
    const small = await sharp((await normalizeImage(await img(30, 20).png().toBuffer())).bytes).metadata();
    expect([small.width, small.height]).toEqual([30, 20]);
  });

  it("rejects bytes that are not an image", async () => {
    await expect(normalizeImage(Buffer.from("definitely not an image"))).rejects.toThrow();
  });
});

describe("config.ts (fail-fast env parsing)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parses process.env on import", async () => {
    vi.doUnmock("../src/config.js");
    vi.resetModules();
    const env = {
      PUBLIC_BASE_URL: "http://localhost", POSTGRES_HOST: "db", POSTGRES_DB: "trip", POSTGRES_USER: "u",
      POSTGRES_PASSWORD: "p", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", VAULT_ADDR: "http://vault",
      VAULT_TOKEN: "t", OIDC_ISSUER: "http://idp", OIDC_CLIENT_ID: "c", OIDC_CLIENT_SECRET: "s",
      OIDC_REDIRECT_URI: "http://localhost/cb", SESSION_SECRET: "x".repeat(32), API_PORT: "4123",
    };
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { config } = await import("../src/config.js");
    expect(config.API_PORT).toBe(4123);
  });

  it("throws on import when a required variable is missing", async () => {
    vi.doUnmock("../src/config.js");
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "");
    await expect(import("../src/config.js")).rejects.toThrow();
  });
});
