import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";

// scanBuffer reads CLAMAV_HOST/PORT at call time; point it at a local fake clamd.
const clam = vi.hoisted(() => ({ port: 0 }));
vi.mock("../src/config.js", async () => {
  const { config } = await import("./support/config.js");
  return {
    config: new Proxy(config, {
      get: (t, k) =>
        k === "CLAMAV_HOST" ? "127.0.0.1" :
        k === "CLAMAV_PORT" ? clam.port :
        k === "AV_SCAN_ENABLED" ? true :
        (t as any)[k],
    }),
  };
});

import { scanBuffer, avScanEnabled } from "../src/security/avscan.js";

/** Fake clamd: parses the INSTREAM frames, then answers with `respond(payload)`. */
let respond: (payload: Buffer) => string = () => "stream: OK\0";
let received: Buffer[] = [];
let server: net.Server;

beforeAll(async () => {
  server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    const cmd = Buffer.from("zINSTREAM\0");
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < cmd.length || !buf.subarray(0, cmd.length).equals(cmd)) return;
      // Walk length-prefixed chunks until the zero-length terminator.
      let o = cmd.length;
      const parts: Buffer[] = [];
      while (o + 4 <= buf.length) {
        const len = buf.readUInt32BE(o);
        if (len === 0) {
          const payload = Buffer.concat(parts);
          received.push(payload);
          sock.end(respond(payload));
          return;
        }
        if (o + 4 + len > buf.length) return; // wait for more bytes
        parts.push(buf.subarray(o + 4, o + 4 + len));
        o += 4 + len;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  clam.port = (server.address() as net.AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("scanBuffer (clamd INSTREAM over TCP)", () => {
  it("streams the whole payload and reports clean", async () => {
    received = [];
    respond = () => "stream: OK\0";
    const payload = Buffer.alloc(150 * 1024, 0xab); // spans several 64KiB chunks
    expect(await scanBuffer(payload)).toEqual({ clean: true });
    expect(received[0]!.equals(payload)).toBe(true);
  });

  it("reports the signature of an infected payload", async () => {
    respond = () => "stream: Eicar-Test-Signature FOUND\0";
    expect(await scanBuffer(Buffer.from("X5O!P%@AP"))).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
  });

  it("rejects on a clamd-side error reply", async () => {
    respond = () => "INSTREAM size limit exceeded. ERROR\0";
    await expect(scanBuffer(Buffer.from("x"))).rejects.toThrow("clamd: INSTREAM size limit exceeded. ERROR");
  });

  it("rejects when clamd is unreachable", async () => {
    const live = clam.port;
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    clam.port = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    await expect(scanBuffer(Buffer.from("x"))).rejects.toThrow(/ECONNREFUSED/);
    clam.port = live;
  });

  it("exposes the enable flag", () => {
    expect(avScanEnabled()).toBe(true);
  });
});
