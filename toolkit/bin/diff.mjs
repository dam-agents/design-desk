// design diff <before.jpg|png> <after.jpg|png> <out.jpg> [--threshold 24]
// The after picture with every changed region outlined, for a change card's "What changed".
// Compares the two in the browser, 12-pixel cells: a cell whose pixels differ by more than the
// threshold (0–255, per channel) is changed; neighbouring changed cells merge into one box.
// Prints {changed_pct, boxes: [{x, y, w, h}], out}.
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { fail, launch } from "../lib/core.mjs";

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const dataUrl = (file) => `data:${TYPES[extname(file).toLowerCase()] || "image/png"};base64,${readFileSync(file).toString("base64")}`;

export async function main(_cmd, argv) {
  const pos = []; let threshold = 24;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === "--threshold") threshold = Number(argv[++i]); else pos.push(argv[i]); }
  const [before, after, out] = pos;
  if (!before || !after || !out) fail("usage: design diff <before> <after> <out.jpg> [--threshold 24]");
  const browser = await launch();
  const pg = await (await browser.newContext()).newPage();
  const result = await pg.evaluate(async ({ a, b, threshold }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("cannot read a picture")); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = ib.naturalWidth, h = ib.naturalHeight;
    const px = (img) => { const c = Object.assign(document.createElement("canvas"), { width: w, height: h }); const g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
    const pa = px(ia), pb = px(ib);
    const S = 12, cols = Math.ceil(w / S), rows = Math.ceil(h / S);
    const hot = new Uint8Array(cols * rows);
    let changed = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (Math.abs(pa[i] - pb[i]) > threshold || Math.abs(pa[i + 1] - pb[i + 1]) > threshold || Math.abs(pa[i + 2] - pb[i + 2]) > threshold) {
        const cell = Math.floor(y / S) * cols + Math.floor(x / S);
        if (!hot[cell]) changed++;
        hot[cell] = 1;
      }
    }
    // Neighbouring changed cells (with a one-cell gap) become one box.
    const seen = new Uint8Array(cols * rows), boxes = [];
    for (let c = 0; c < hot.length; c++) {
      if (!hot[c] || seen[c]) continue;
      let x0 = c % cols, x1 = x0, y0 = Math.floor(c / cols), y1 = y0;
      const stack = [c]; seen[c] = 1;
      while (stack.length) {
        const k = stack.pop(), kx = k % cols, ky = Math.floor(k / cols);
        x0 = Math.min(x0, kx); x1 = Math.max(x1, kx); y0 = Math.min(y0, ky); y1 = Math.max(y1, ky);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = kx + dx, ny = ky + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (hot[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      boxes.push({ x: x0 * S, y: y0 * S, w: (x1 - x0 + 1) * S, h: (y1 - y0 + 1) * S });
    }
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const g = c.getContext("2d");
    g.drawImage(ib, 0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(0, 0, w, h);
    for (const r of boxes) { g.drawImage(ib, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h); g.strokeStyle = "#e8a400"; g.lineWidth = 4; g.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6); }
    return { changed_pct: Math.round((changed / (cols * rows)) * 1000) / 10, boxes, image: c.toDataURL("image/jpeg", 0.82) };
  }, { a: dataUrl(before), b: dataUrl(after), threshold });
  await browser.close();
  writeFileSync(out, Buffer.from(result.image.split(",")[1], "base64"));
  console.log(JSON.stringify({ changed_pct: result.changed_pct, boxes: result.boxes.slice(0, 50), out }));
}
