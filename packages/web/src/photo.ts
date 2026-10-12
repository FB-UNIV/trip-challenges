// Shrink a photo on the phone before it's sent. The server keeps 2000px JPEGs anyway
// (api/src/lib/image.ts), so a 10 MB original only costs time on a trip's 4G. Re-encoding
// also drops the original's metadata, location included, before it leaves the phone.
const MAX_DIM = 2000;
const QUALITY = 0.85;

/** The photo to send: shrunk if this browser can decode it, else the original (the server normalizes it either way). */
export async function shrinkPhoto(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file); // applies the EXIF orientation
    try {
      const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", QUALITY));
      if (!jpeg) return file;
      return new File([jpeg], `${file.name.replace(/\.[^.]*$/, "")}.jpg`, { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file; // a format this browser can't read (HEIC outside Safari): the server decodes it
  }
}
