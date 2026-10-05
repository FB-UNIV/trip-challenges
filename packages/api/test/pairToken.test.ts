import { describe, it, expect } from "vitest";
import { signPair, verifyPair } from "../src/lib/pairToken.js";

const SECRET = "test-secret-at-least-32-chars-long-xxx";
const voter = "voter-1";
const ch = "challenge-1";

describe("pair token", () => {
  it("round-trips a valid pair", () => {
    const t = signPair(SECRET, voter, ch, "nomA", "nomB");
    const v = verifyPair(SECRET, t, voter);
    expect(v).not.toBeNull();
    expect(v!.challengeId).toBe(ch);
  });

  it("is order-independent (a,b === b,a)", () => {
    expect(signPair(SECRET, voter, ch, "nomA", "nomB")).toBe(
      signPair(SECRET, voter, ch, "nomB", "nomA"),
    );
  });

  it("rejects a token for a different voter", () => {
    const t = signPair(SECRET, voter, ch, "nomA", "nomB");
    expect(verifyPair(SECRET, t, "someone-else")).toBeNull();
  });

  it("rejects a tampered MAC", () => {
    const t = signPair(SECRET, voter, ch, "nomA", "nomB");
    const tampered = t.slice(0, -1) + (t.at(-1) === "A" ? "B" : "A");
    expect(verifyPair(SECRET, tampered, voter)).toBeNull();
  });

  it("rejects under the wrong secret", () => {
    const t = signPair(SECRET, voter, ch, "nomA", "nomB");
    expect(verifyPair("another-secret-at-least-32-chars-yyy", t, voter)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyPair(SECRET, "not-a-token", voter)).toBeNull();
  });
});
