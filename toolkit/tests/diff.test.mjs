// node --test toolkit/tests/diff.test.mjs — design diff outlines what changed and gives the Desk its marks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const design = new URL("../bin/design.mjs", import.meta.url).pathname;

// A white PNG with black squares [x, y, size].
function png(w, h, squares = []) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(t.length + 8); out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), t.length + 4); return out; };
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (const [sx, sy, n] of squares) if (y >= sy && y < sy + n) for (let x = sx; x < Math.min(w, sx + n); x++) raw.fill(0, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3); }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function diff(t, before, after) {
  const dir = mkdtempSync(join(tmpdir(), "dd-diff-"));
  writeFileSync(join(dir, "a.png"), before); writeFileSync(join(dir, "b.png"), after);
  try { const { stdout } = await promisify(execFile)(process.execPath, [design, "diff", join(dir, "a.png"), join(dir, "b.png"), join(dir, "d.jpg")], { timeout: 60000 }); return JSON.parse(stdout); }
  catch (e) { if (/Chromium|browser/i.test(String(e.stderr))) { t.skip("no browser here"); return null; } throw e; }
}

test("marks are the changed boxes as fractions of the after picture, kept inside it", async (t) => {
  const r = await diff(t, png(100, 60), png(100, 60, [[20, 10, 10], [96, 40, 10]]));
  if (!r) return;
  assert.deepEqual(r.boxes, [{ x: 12, y: 0, w: 24, h: 24 }, { x: 96, y: 36, w: 12, h: 24 }]);
  assert.deepEqual(r.marks, [{ x: 0.12, y: 0, w: 0.24, h: 0.4 }, { x: 0.96, y: 0.6, w: 0.04, h: 0.4 }], "the box at the edge ends at the edge");
  assert.equal(r.same_size, true);
});

test("at most 20 marks, and a before picture of another size is said", async (t) => {
  const dots = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) dots.push([48 * i + 4, 48 * j + 4, 4]);
  const r = await diff(t, png(240, 200), png(240, 240, dots));
  if (!r) return;
  assert.equal(r.boxes.length, 25);
  assert.equal(r.marks.length, 20);
  assert.equal(r.same_size, false, "the marks do not fit the before picture");
});
