// Pictures as WebP, encoded by the toolkit's own Chromium (a canvas), so no image package is
// needed: the handoff bundle pushes them this way (docs/handoff.md → The bundle). A picture
// wider or taller than WebP's limit is scaled down to fit, never left in another format.
import { launch } from "./core.mjs";

export const WEBP_QUALITY = 0.9;
const MAX_SIDE = 16383;
const RASTER = new Set(["image/png", "image/jpeg", "image/jpg", "image/bmp", "image/webp"]);

// A file's content type is one WebP can stand in for: a still raster picture (an SVG stays
// text, a GIF may move).
export function isRaster(contentType) { return RASTER.has(String(contentType || "").toLowerCase().split(";")[0].trim()); }

// One browser for many pictures: `encode(buffer, type)` → the WebP bytes. `close()` when done.
export async function webpEncoder({ quality = WEBP_QUALITY, browser = null } = {}) {
  const b = browser || await launch();
  const page = await b.newPage();
  const encode = async (data, type = "image/png") => {
    const url = `data:${type};base64,${Buffer.from(data).toString("base64")}`;
    const out = await page.evaluate(async ({ url, quality, max }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const k = Math.min(1, max / img.naturalWidth, max / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/webp", quality);
    }, { url, quality, max: MAX_SIDE });
    if (!out.startsWith("data:image/webp;base64,")) throw new Error("the browser did not encode WebP");
    return Buffer.from(out.slice(out.indexOf(",") + 1), "base64");
  };
  return { encode, close: async () => { await page.close(); if (!browser) await b.close(); } };
}

// `design webp <file>...` — each picture written beside itself as <name>.webp; prints the paths.
export async function main(_cmd, argv) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { fail } = await import("./core.mjs");
  if (!argv.length) fail("usage: design webp <picture>...");
  const enc = await webpEncoder();
  try {
    for (const f of argv) {
      const type = /\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webp$/i.test(f) ? "image/webp" : "image/png";
      const to = f.replace(/\.[a-z0-9]+$/i, "") + ".webp";
      writeFileSync(to, await enc.encode(readFileSync(f), type));
      process.stdout.write(`${to}\n`);
    }
  } finally { await enc.close(); }
}
