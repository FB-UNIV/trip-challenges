// Antivirus scanning of uploaded photos via ClamAV's clamd INSTREAM protocol.
// Dependency-free (raw TCP). Minors' uploads are scanned BEFORE any processing.
import net from "node:net";
import { config } from "../config.js";
import { INSTREAM_CMD, TERMINATOR, frameChunks, parseClamReply, type ScanVerdict } from "./instream.js";

const TIMEOUT_MS = 15_000;

export type { ScanVerdict };
export const avScanEnabled = () => config.AV_SCAN_ENABLED;

/** Stream a buffer to clamd and return the verdict. Rejects if clamd is unreachable. */
export function scanBuffer(buf: Buffer): Promise<ScanVerdict> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(config.CLAMAV_PORT, config.CLAMAV_HOST);
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; socket.destroy(); fn(); };

    socket.setTimeout(TIMEOUT_MS);
    socket.on("timeout", () => done(() => reject(new Error("clamd timeout"))));
    socket.on("error", (e) => done(() => reject(e)));
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => done(() => {
      try { resolve(parseClamReply(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(e); }
    }));
    socket.on("connect", () => {
      socket.write(INSTREAM_CMD);
      socket.write(frameChunks(buf));
      socket.write(TERMINATOR);
    });
  });
}
