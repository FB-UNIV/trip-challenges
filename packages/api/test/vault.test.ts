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
      token: ((init.headers ?? {}) as Record<string, string>)["X-Vault-Token"] ?? null,
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

  it("tags failures as keystore errors, unreachable Vault included (#69)", async () => {
    reply = () => new Response("Vault is sealed", { status: 503 });
    await expect(vault.encrypt("t1", Buffer.from("x"))).rejects.toMatchObject({ dependency: "keystore", status: 503 });
    reply = () => { throw new TypeError("fetch failed"); };
    await expect(vault.encrypt("t1", Buffer.from("x"))).rejects.toMatchObject({ dependency: "keystore" });
  });

  // #69: boot proves the token can do everything the app does with a trip key, erasure included.
  describe("probeKeystore (startup self-check)", () => {
    it("runs a throwaway trip key through every operation, then destroys it", async () => {
      reply = (url) => url.includes("/encrypt/") ? json({ ciphertext: "vault:v1:x" })
        : url.includes("/decrypt/") ? json({ plaintext: Buffer.from("selfcheck").toString("base64") })
        : url.includes("/hmac/") ? json({ hmac: "vault:v1:h" })
        : url.includes("/datakey/") ? json({ plaintext: "AAAA", ciphertext: "vault:v1:k" })
        : new Response(null, { status: 204 });
      await vault.probeKeystore();
      const paths = calls.map((c) => `${c.method} ${c.url.replace(/trip-selfcheck-[0-9a-f-]+/, "trip-*")}`);
      expect(paths).toEqual([
        "POST http://vault.test/v1/transit/keys/trip-*",
        "POST http://vault.test/v1/transit/encrypt/trip-*",
        "POST http://vault.test/v1/transit/decrypt/trip-*",
        "POST http://vault.test/v1/transit/hmac/trip-*/sha2-256",
        "POST http://vault.test/v1/transit/datakey/plaintext/trip-*",
        "POST http://vault.test/v1/transit/keys/trip-*/config",
        "DELETE http://vault.test/v1/transit/keys/trip-*",
      ]);
    });

    it("names the operation and the policy path the token lacks", async () => {
      reply = (url) => url.includes("/hmac/") ? new Response("permission denied", { status: 403 })
        : url.includes("/encrypt/") ? json({ ciphertext: "vault:v1:x" })
        : url.includes("/decrypt/") ? json({ plaintext: Buffer.from("selfcheck").toString("base64") })
        : new Response(null, { status: 204 });
      await expect(vault.probeKeystore()).rejects.toThrow(/compute an HMAC.*403.*"update" on transit\/hmac\/trip-\*/);
      // The probe key doesn't outlive a failed check.
      expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    });

    it.each([
      ["sealed", () => new Response("Vault is sealed", { status: 503 })],
      ["unreachable", () => { throw new TypeError("fetch failed"); }],
    ])("points at Vault itself, not the policy, when it is %s", async (_label, r) => {
      reply = r as any;
      const e = await vault.probeKeystore().catch((x: Error) => x);
      expect((e as Error).message).toMatch(/could not create a key.*Check that VAULT_ADDR/);
      expect((e as Error).message).not.toMatch(/token needs/);
    });

    it("says so when the token can't destroy keys (erasure would fail)", async () => {
      reply = (url) => url.endsWith("/config") ? new Response("permission denied", { status: 403 })
        : url.includes("/encrypt/") ? json({ ciphertext: "vault:v1:x" })
        : url.includes("/decrypt/") ? json({ plaintext: Buffer.from("selfcheck").toString("base64") })
        : url.includes("/hmac/") ? json({ hmac: "h" })
        : url.includes("/datakey/") ? json({ plaintext: "AAAA", ciphertext: "k" })
        : new Response(null, { status: 204 });
      await expect(vault.probeKeystore()).rejects.toThrow(/destroy a key.*403.*transit\/keys\/trip-\*\/config/);
    });
  });

  describe("keystoreHealth (readiness)", () => {
    it.each([
      [200, "ok"], [429, "ok"], [503, "sealed"], [501, "down"],
    ])("sys/health %i → %s", async (status, want) => {
      reply = () => new Response("{}", { status });
      expect(await vault.keystoreHealth()).toBe(want);
      expect(calls[0]!.url).toBe("http://vault.test/v1/sys/health?standbyok=true");
    });

    it("is down when Vault can't be reached", async () => {
      reply = () => { throw new TypeError("fetch failed"); };
      expect(await vault.keystoreHealth()).toBe("down");
    });
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
