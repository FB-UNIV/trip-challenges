// #165: the installed app's icons. The manifest listed /icon-192.png and /icon-512.png, but no
// such files existed, so an installed app had no icon. Every icon the manifest or the page
// names must exist in public/ at the size it claims.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const web = resolve(__dirname, "..") + "/"; // packages/web/ (import.meta.url is http: under jsdom)
const text = (path: string) => readFileSync(web + path, "utf8");
/** A PNG's [width, height], from its IHDR chunk. */
const pngSize = (path: string) => {
  const buf = readFileSync(web + path);
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

const manifestIcons = [...text("vite.config.ts").matchAll(
  /\{ src: "\/([^"]+)", sizes: "(\d+)x(\d+)", type: "image\/png"(?:, purpose: "([^"]+)")? \}/g,
)].map(([, file, w, h, purpose]) => ({ file: file!, w: Number(w), h: Number(h), purpose: purpose ?? "any" }));

describe("app icons", () => {
  it("the manifest offers 192 and 512 px icons, and a maskable one for Android", () => {
    expect(manifestIcons.map((i) => `${i.w}:${i.purpose}`)).toEqual(expect.arrayContaining(["192:any", "512:any", "512:maskable"]));
  });

  it.each(manifestIcons)("public/$file exists at $w×$h", ({ file, w, h }) => {
    expect(existsSync(web + "public/" + file)).toBe(true);
    expect(pngSize("public/" + file)).toEqual([w, h]);
  });

  it("the page links an SVG favicon and a 180 px Apple touch icon that exist", () => {
    const html = text("index.html");
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(text("public/icon.svg")).toContain("<svg");
    expect(pngSize("public/apple-touch-icon.png")).toEqual([180, 180]);
  });
});
