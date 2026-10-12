import { describe, it, expect } from "vitest";
import argon2 from "argon2";
import { hashSessionToken, verifySessionToken } from "../src/auth/session-token.js";

const FAST_ARGON = { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 };

describe("student session tokens (#64)", () => {
  it("verifies a sha256-stored token, and nothing else", async () => {
    const stored = hashSessionToken("tok-1");
    expect(await verifySessionToken(stored, "tok-1")).toEqual({ ok: true, legacy: false });
    expect(await verifySessionToken(stored, "tok-2")).toEqual({ ok: false, legacy: false });
    expect(await verifySessionToken("sha256:abcd", "tok-1")).toEqual({ ok: false, legacy: false }); // wrong length
  });

  it("still accepts a pre-#64 argon2 hash, flagged for upgrade", async () => {
    const stored = await argon2.hash("tok-1", FAST_ARGON);
    expect(await verifySessionToken(stored, "tok-1")).toEqual({ ok: true, legacy: true });
    expect(await verifySessionToken(stored, "tok-2")).toEqual({ ok: false, legacy: false });
  });

  it("refuses a stored value that is neither, instead of throwing", async () => {
    expect(await verifySessionToken("not-a-hash", "tok-1")).toEqual({ ok: false, legacy: false });
  });
});
