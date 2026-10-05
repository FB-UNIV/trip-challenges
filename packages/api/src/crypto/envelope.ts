// Envelope encryption for photo blobs (ADR-0001, data-model.md).
// Each blob gets a fresh data key from Vault (wrapped under the Trip key). The bytes
// are AES-256-GCM encrypted locally; the wrapped key travels WITH the object, so the
// stored blob is self-describing. Destroying the Trip key makes the wrapped key —
// and thus the blob — permanently unrecoverable.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dataKey, decrypt } from "./vault.js";

// Frame: [1B version][2B wrappedLen][wrapped][12B iv][16B tag][ciphertext]
const VERSION = 1;

export async function sealBlob(tripId: string, plaintext: Buffer): Promise<Buffer> {
  const { plaintext: dek, wrapped } = await dataKey(tripId);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrappedBuf = Buffer.from(wrapped, "utf8");
    const head = Buffer.alloc(3);
    head.writeUInt8(VERSION, 0);
    head.writeUInt16BE(wrappedBuf.length, 1);
    return Buffer.concat([head, wrappedBuf, iv, tag, ct]);
  } finally {
    dek.fill(0); // best-effort scrub of the plaintext data key
  }
}

export async function openBlob(tripId: string, framed: Buffer): Promise<Buffer> {
  if (framed.readUInt8(0) !== VERSION) throw new Error("unknown blob version");
  const wlen = framed.readUInt16BE(1);
  let o = 3;
  const wrapped = framed.subarray(o, o + wlen).toString("utf8");
  o += wlen;
  const iv = framed.subarray(o, o + 12);
  o += 12;
  const tag = framed.subarray(o, o + 16);
  o += 16;
  const ct = framed.subarray(o);

  const dek = await decrypt(tripId, wrapped); // unwrap via Vault
  try {
    const decipher = createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } finally {
    dek.fill(0);
  }
}
