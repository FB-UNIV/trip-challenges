// Distinct, tiny PNGs generated on the fly (no binary fixtures in the repo).
import sharp from "sharp";

export async function photo(color: string, width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    // EXIF the server must strip (camera make + a GPS-like description).
    .withExif({ IFD0: { Make: "E2EPhone", ImageDescription: "45.43N 12.33E" } })
    .png()
    .toBuffer();
}

export const asFile = (buffer: Buffer, name = "photo.png") => ({ name, mimeType: "image/png", buffer });
