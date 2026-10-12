// Shrinking a photo on the phone before it's sent: the server keeps 2000px anyway, and a
// 10 MB original takes ages on a trip's 4G.
import { afterEach, describe, expect, it, vi } from "vitest";
import { shrinkPhoto } from "../src/photo.js";

const original = () => new File(["a-big-original"], "IMG_0042.HEIC.jpg", { type: "image/jpeg" });

/** A browser that decodes a `width`×`height` photo; returns the canvas draw calls. */
function decodes(width: number, height: number, encoded: Blob | null = new Blob(["small"], { type: "image/jpeg" })) {
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => done(encoded));
  return { bitmap, drawImage, toBlob };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("shrinkPhoto", () => {
  it("scales a large photo down to 2000px on its long side, as a JPEG", async () => {
    const { bitmap, drawImage, toBlob } = decodes(4000, 3000);
    const out = await shrinkPhoto(original());
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85);
    expect(out).toBeInstanceOf(File);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("IMG_0042.HEIC.jpg");
    expect(out.size).toBe(5);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("scales a portrait photo by its height", async () => {
    const { bitmap, drawImage } = decodes(3000, 4000);
    await shrinkPhoto(original());
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1500, 2000);
  });

  it("never enlarges a small photo, but still re-encodes it (which drops its location data)", async () => {
    const { bitmap, drawImage } = decodes(800, 600);
    const out = await shrinkPhoto(original());
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 800, 600);
    expect(out.size).toBe(5);
  });

  it("names the result .jpg", async () => {
    decodes(800, 600);
    const out = await shrinkPhoto(new File(["x"], "photo.png", { type: "image/png" }));
    expect(out.name).toBe("photo.jpg");
  });

  it("sends the original when the browser can't decode images itself", async () => {
    const file = original();
    expect(await shrinkPhoto(file)).toBe(file); // jsdom: no createImageBitmap
  });

  it("sends the original when this browser can't read the format (HEIC outside Safari)", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new DOMException("unsupported", "InvalidStateError"); }));
    const file = original();
    expect(await shrinkPhoto(file)).toBe(file);
  });

  it("sends the original when the canvas can't encode", async () => {
    decodes(4000, 3000, null);
    const file = original();
    expect(await shrinkPhoto(file)).toBe(file);
  });

  it("sends the original when there is no 2D canvas", async () => {
    decodes(4000, 3000);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const file = original();
    expect(await shrinkPhoto(file)).toBe(file);
  });
});
