// Pure clamd INSTREAM wire helpers — no config/socket, so they're unit-testable.
// Wire format: "zINSTREAM\0", then per chunk a 4-byte big-endian length + bytes,
// then a zero-length chunk (0x00000000). Reply: "stream: OK\0" or "... FOUND\0".

export const INSTREAM_CMD = Buffer.from("zINSTREAM\0");
export const TERMINATOR = Buffer.from([0, 0, 0, 0]);
export const DEFAULT_CHUNK = 64 * 1024;

export type ScanVerdict = { clean: boolean; signature?: string };

/** Frame a payload into length-prefixed INSTREAM chunks (no command, no terminator). */
export function frameChunks(buf: Buffer, chunkSize = DEFAULT_CHUNK): Buffer {
  const parts: Buffer[] = [];
  for (let off = 0; off < buf.length; off += chunkSize) {
    const chunk = buf.subarray(off, Math.min(off + chunkSize, buf.length));
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(chunk.length, 0);
    parts.push(len, chunk);
  }
  return Buffer.concat(parts);
}

/** Parse a clamd INSTREAM reply into a verdict. Throws on scan-side errors. */
export function parseClamReply(reply: string): ScanVerdict {
  const line = reply.replace(/\0/g, "").trim();
  if (/\bOK$/.test(line)) return { clean: true };
  const found = line.match(/^stream:\s*(.+?)\s+FOUND$/);
  if (found) return { clean: false, signature: found[1] };
  throw new Error(`clamd: ${line || "empty reply"}`);
}
