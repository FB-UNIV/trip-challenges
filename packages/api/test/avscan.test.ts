import { describe, it, expect } from "vitest";
import { frameChunks, parseClamReply } from "../src/security/instream.js";

describe("frameChunks (clamd INSTREAM)", () => {
  it("prefixes each chunk with its big-endian length", () => {
    const framed = frameChunks(Buffer.from([0xaa, 0xbb, 0xcc]), 2);
    // [00 00 00 02][AA BB] [00 00 00 01][CC]
    expect([...framed]).toEqual([0, 0, 0, 2, 0xaa, 0xbb, 0, 0, 0, 1, 0xcc]);
  });
  it("emits a single frame when the buffer fits one chunk", () => {
    const framed = frameChunks(Buffer.from([1, 2, 3, 4]), 64);
    expect(framed.readUInt32BE(0)).toBe(4);
    expect(framed.length).toBe(4 + 4);
  });
  it("produces no frames for an empty buffer", () => {
    expect(frameChunks(Buffer.alloc(0)).length).toBe(0);
  });
});

describe("parseClamReply", () => {
  it("treats 'stream: OK' as clean", () => {
    expect(parseClamReply("stream: OK\0")).toEqual({ clean: true });
  });
  it("extracts the signature on FOUND", () => {
    expect(parseClamReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      clean: false,
      signature: "Eicar-Test-Signature",
    });
  });
  it("throws on a scan-side error reply", () => {
    expect(() => parseClamReply("INSTREAM size limit exceeded\0")).toThrow();
  });
});
