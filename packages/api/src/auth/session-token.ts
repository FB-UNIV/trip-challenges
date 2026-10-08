// Student session token hashing (#64). Tokens are 32 random bytes (256-bit), so a fast hash
// is the right tool: a slow KDF only helps low-entropy secrets, and argon2 on every student
// request was the bottleneck. Access codes (human-typed) stay on argon2.
import argon2 from "argon2";
import { createHash, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256:";

export function hashSessionToken(token: string): string {
  return PREFIX + createHash("sha256").update(token).digest("hex");
}

// `legacy` is true when the stored hash is a pre-#64 argon2 hash that should be upgraded.
export async function verifySessionToken(
  stored: string,
  token: string,
): Promise<{ ok: boolean; legacy: boolean }> {
  if (stored.startsWith(PREFIX)) {
    const want = Buffer.from(stored.slice(PREFIX.length), "hex");
    const got = createHash("sha256").update(token).digest();
    return { ok: want.length === got.length && timingSafeEqual(want, got), legacy: false };
  }
  const ok = await argon2.verify(stored, token).catch(() => false);
  return { ok, legacy: ok };
}
