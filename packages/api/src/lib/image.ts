// Normalize an uploaded photo: decode (rejects non-images), apply EXIF orientation,
// then re-encode to JPEG. Re-encoding DROPS all metadata (incl. GPS) and neutralizes
// most payloads hidden in the original container — the "strip EXIF + AV-ish" step.
import sharp from "sharp";

const MAX_DIM = 2000;

export async function normalizeImage(input: Buffer): Promise<{ bytes: Buffer; contentType: string }> {
  const bytes = await sharp(input, { failOn: "error" })
    .rotate() // bake in orientation before we drop metadata
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { bytes, contentType: "image/jpeg" };
}
