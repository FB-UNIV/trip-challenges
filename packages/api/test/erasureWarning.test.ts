import { describe, it, expect } from "vitest";
import { pickBracket } from "../src/lib/erasureWarning.js";

const H = 3_600_000;
const D = 86_400_000;

describe("pickBracket", () => {
  it("picks 1h when the deadline is under an hour away", () => {
    expect(pickBracket(30 * 60_000)).toBe("1h");
  });
  it("picks 1d when hours (but <1d) remain", () => {
    expect(pickBracket(2 * H)).toBe("1d");
  });
  it("picks 7d when days (but <7d) remain", () => {
    expect(pickBracket(2 * D)).toBe("7d");
  });
  it("returns null when the deadline is more than 7d away", () => {
    expect(pickBracket(10 * D)).toBeNull();
  });
  it("returns null at or past the deadline (runner's job, not a warning)", () => {
    expect(pickBracket(0)).toBeNull();
    expect(pickBracket(-5)).toBeNull();
  });
  it("is inclusive at each boundary", () => {
    expect(pickBracket(H)).toBe("1h");       // exactly 1h
    expect(pickBracket(7 * D)).toBe("7d");    // exactly 7d
    expect(pickBracket(7 * D + 1)).toBeNull(); // a hair over 7d
  });
});
