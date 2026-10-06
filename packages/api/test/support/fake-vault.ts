// In-memory stand-in for src/crypto/vault.ts. Mirrors the property erasure relies on:
// once a Trip's key is destroyed, nothing encrypted under it can be decrypted.
// Mock with: vi.mock("../src/crypto/vault.js", () => import("./support/fake-vault.js"))
import { createHmac, randomBytes } from "node:crypto";

const keys = new Map<string, Buffer>();

export const keyName = (tripId: string) => `trip-${tripId}`;
export const hasKey = (tripId: string) => keys.has(tripId);
export const keyCount = () => keys.size;
/** Fault injection: the next `destroyKeyFailures` calls to destroyTripKey throw. */
export const faults = { destroyKeyFailures: 0 };
export const resetVault = () => {
  keys.clear();
  faults.destroyKeyFailures = 0;
};

function key(tripId: string): Buffer {
  const k = keys.get(tripId);
  if (!k) throw new Error(`vault: no key ${keyName(tripId)}`);
  return k;
}

export async function ensureTransitEngine(): Promise<void> {}

export async function createTripKey(tripId: string): Promise<void> {
  keys.set(tripId, randomBytes(32));
}

export async function encrypt(tripId: string, plaintext: Buffer): Promise<string> {
  key(tripId);
  return `vault:v1:${plaintext.toString("base64")}`;
}

export async function decrypt(tripId: string, ciphertext: string): Promise<Buffer> {
  key(tripId);
  return Buffer.from(ciphertext.replace(/^vault:v1:/, ""), "base64");
}

export async function hmac(tripId: string, input: Buffer): Promise<string> {
  return `vault:v1:${createHmac("sha256", key(tripId)).update(input).digest("base64")}`;
}

export async function dataKey(tripId: string): Promise<{ plaintext: Buffer; wrapped: string }> {
  key(tripId);
  const dek = randomBytes(32);
  return { plaintext: Buffer.from(dek), wrapped: `vault:v1:${dek.toString("base64")}` };
}

export async function destroyTripKey(tripId: string): Promise<void> {
  if (faults.destroyKeyFailures > 0) {
    faults.destroyKeyFailures--;
    throw new Error("vault: 503 Vault is sealed");
  }
  keys.delete(tripId); // idempotent, like the real client for an already-deleted key
}
