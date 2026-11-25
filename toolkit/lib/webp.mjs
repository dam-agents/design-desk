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

// A picture's type from its first bytes, never its name: PNG, JPEG, WebP, GIF, or null.
export function pictureType(buf) {
  const b = Buffer.from(buf);
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString("latin1"))) return "image/gif";
  return null;
}

// `design webp <file>...` — each still picture written beside itself as <name>.webp; prints the
// paths. Anything else (a GIF, an SVG, not a picture) is refused before any is written.
export async function main(_cmd, argv) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { fail } = await import("./core.mjs");
  if (!argv.length) fail("usage: design webp <picture>...");
  const todo = argv.map((f) => {
    let data;
    try { data = readFileSync(f); } catch (e) { fail(`${f}: cannot read it (${e.code || e.message})`); }
    const type = pictureType(data);
    if (!isRaster(type)) fail(`${f}: not a still PNG, JPEG or WebP picture (${type || "unknown type"}); send it as it is`);
    return { f, data, type };
  });
  const enc = await webpEncoder();
  try {
    for (const { f, data, type } of todo) {
      const to = f.replace(/\.[a-z0-9]+$/i, "") + ".webp";
      let out;
      try { out = await enc.encode(data, type); } catch (e) { fail(`${f}: cannot encode it as WebP (${String(e.message || e).split("\n")[0]})`); }
      writeFileSync(to, out);
      process.stdout.write(`${to}\n`);
    }
  } finally { await enc.close(); }
}
