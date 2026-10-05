// Signed, voter-bound token for a duel pair. Prevents forged/duplicate casts and
// binds the pair to a single voter. Order-independent (a,b === b,a).
import { createHmac, timingSafeEqual } from "node:crypto";

export function signPair(
  secret: string,
  voterId: string,
  challengeId: string,
  a: string,
  b: string,
): string {
  const [lo, hi] = [a, b].sort();
  const payload = `${voterId}:${challengeId}:${lo}:${hi}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}:${mac}`;
}

export function verifyPair(
  secret: string,
  token: string,
  voterId: string,
): { challengeId: string; lo: string; hi: string } | null {
  const parts = token.split(":");
  if (parts.length !== 5) return null;
  const [v, challengeId, lo, hi, mac] = parts;
  if (v !== voterId) return null;
  const expect = createHmac("sha256", secret)
    .update(`${v}:${challengeId}:${lo}:${hi}`)
    .digest("base64url");
  const got = Buffer.from(mac!);
  const want = Buffer.from(expect);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return { challengeId: challengeId!, lo: lo!, hi: hi! };
}
