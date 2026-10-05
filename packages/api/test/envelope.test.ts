import { vi, describe, it, expect } from "vitest";

// Mock Vault: a fixed data key, wrapped/unwrapped consistently. Lets us test the
// AES-GCM framing + auth-tag behaviour without a live Vault.
const h = vi.hoisted(() => {
  const dek = new Uint8Array(32);
  globalThis.crypto.getRandomValues(dek);
  return { dek: Buffer.from(dek) };
});
vi.mock("../src/crypto/vault.js", () => ({
  dataKey: async () => ({ plaintext: Buffer.from(h.dek), wrapped: "wrapped-token" }),
  decrypt: async () => Buffer.from(h.dek),
}));

const { sealBlob, openBlob } = await import("../src/crypto/envelope.js");

describe("envelope seal/open", () => {
  it("round-trips plaintext", async () => {
    const pt = Buffer.from("a photo's bytes 📷");
    const framed = await sealBlob("trip1", pt);
    expect(framed.equals(pt)).toBe(false); // actually encrypted
    const out = await openBlob("trip1", framed);
    expect(out.toString()).toBe(pt.toString());
  });

  it("detects tampering via the GCM auth tag", async () => {
    const framed = await sealBlob("trip1", Buffer.from("secret"));
    framed[framed.length - 1] ^= 0xff; // corrupt the ciphertext
    await expect(openBlob("trip1", framed)).rejects.toThrow();
  });

  it("rejects an unknown frame version", async () => {
    const framed = await sealBlob("trip1", Buffer.from("x"));
    framed[0] = 9;
    await expect(openBlob("trip1", framed)).rejects.toThrow(/version/);
  });
});
