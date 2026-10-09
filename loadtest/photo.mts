// The photo k6 uploads (loadtest/.photo.jpg): phone-sized (1600×1200, ~500 KB) with real
// entropy, so decode/re-encode/encrypt cost is realistic. The local seed writes it too;
// against staging, run this once on the machine that runs k6:  npx tsx loadtest/photo.mts
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

export async function phoneLikeJpeg(seed: number): Promise<Buffer> {
  const [w, h] = [1600, 1200];
  const raw = Buffer.alloc(w * h * 3);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < raw.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; raw[i] = (x >>> 0) & 0xff; }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).blur(1.2).jpeg({ quality: 85 }).toBuffer();
}

export const writeUploadPhoto = async () => writeFile(new URL("./.photo.jpg", import.meta.url), await phoneLikeJpeg(999));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await writeUploadPhoto();
