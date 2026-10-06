import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../src/config.js", () => import("./support/config.js"));

import * as vault from "../src/crypto/vault.js";

type Call = { url: string; method: string; token: string | null; body: any };
let calls: Call[];
let reply: (url: string) => Response;

beforeEach(() => {
  calls = [];
  reply = () => new Response(JSON.stringify({ data: {} }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      token: (init.headers as Record<string, string>)["X-Vault-Token"] ?? null,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return reply(url);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

describe("vault transit client", () => {
  it("names one transit key per trip", () => {
    expect(vault.keyName("abc")).toBe("trip-abc");
  });

  it("creates an aes256-gcm96 key for a trip", async () => {
    await vault.createTripKey("t1");
    expect(calls[0]).toMatchObject({
      url: "http://vault.test/v1/transit/keys/trip-t1", method: "POST", token: "vault-token",
      body: { type: "aes256-gcm96" },
    });
  });

  it("encrypts base64 plaintext and decrypts back to bytes", async () => {
    reply = () => json({ ciphertext: "vault:v1:xyz" });
    expect(await vault.encrypt("t1", Buffer.from("kid@school.test"))).toBe("vault:v1:xyz");
    expect(calls[0]!.url).toBe("http://vault.test/v1/transit/encrypt/trip-t1");
    expect(Buffer.from(calls[0]!.body.plaintext, "base64").toString()).toBe("kid@school.test");

    reply = () => json({ plaintext: Buffer.from("kid@school.test").toString("base64") });
    expect((await vault.decrypt("t1", "vault:v1:xyz")).toString()).toBe("kid@school.test");
    expect(calls[1]).toMatchObject({ url: "http://vault.test/v1/transit/decrypt/trip-t1", body: { ciphertext: "vault:v1:xyz" } });
  });

  it("computes the trip-scoped HMAC with sha2-256", async () => {
    reply = () => json({ hmac: "vault:v1:mac" });
    expect(await vault.hmac("t1", Buffer.from("x"))).toBe("vault:v1:mac");
    expect(calls[0]!.url).toBe("http://vault.test/v1/transit/hmac/trip-t1/sha2-256");
  });

  it("issues a data key (plaintext bytes + wrapped ciphertext)", async () => {
    const dek = Buffer.alloc(32, 7);
    reply = () => json({ plaintext: dek.toString("base64"), ciphertext: "vault:v1:wrapped" });
    const out = await vault.dataKey("t1");
    expect(out.plaintext.equals(dek)).toBe(true);
    expect(out.wrapped).toBe("vault:v1:wrapped");
    expect(calls[0]!.url).toBe("http://vault.test/v1/transit/datakey/plaintext/trip-t1");
  });

  it("destroys a key by allowing deletion, then deleting it", async () => {
    reply = (url) => (url.endsWith("/config") ? json({}) : new Response(null, { status: 204 }));
    await vault.destroyTripKey("t1");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "http://vault.test/v1/transit/keys/trip-t1/config", { deletion_allowed: true }],
      ["DELETE", "http://vault.test/v1/transit/keys/trip-t1", undefined],
    ]);
  });

  it("treats an already-deleted key as destroyed, so an interrupted erasure can be retried", async () => {
    reply = () => new Response(JSON.stringify({ errors: ["no existing key named trip-t1 could be found"] }), { status: 404 });
    await expect(vault.destroyTripKey("t1")).resolves.toBeUndefined();
  });

  it("surfaces Vault errors with status and body", async () => {
    reply = () => new Response("permission denied", { status: 403 });
    await expect(vault.encrypt("t1", Buffer.from("x"))).rejects.toThrow("vault transit/encrypt/trip-t1 -> 403 permission denied");
  });

  it("enables the transit engine idempotently", async () => {
    reply = () => new Response(null, { status: 204 });
    await vault.ensureTransitEngine();
    expect(calls[0]).toMatchObject({ url: "http://vault.test/v1/sys/mounts/transit", body: { type: "transit" } });

    reply = () => new Response("path is already in use", { status: 400 });
    await expect(vault.ensureTransitEngine()).resolves.toBeUndefined();

    reply = () => new Response("sealed", { status: 503 });
    await expect(vault.ensureTransitEngine()).rejects.toThrow("vault enable transit -> 503 sealed");
  });
});
