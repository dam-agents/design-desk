// node --test toolkit/tests/diff.test.mjs — design diff outlines what changed and gives the Desk its marks;
// design compare pictures one place of two versions of an option.
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
  assert.equal(r.partial, false);
  assert.equal(r.same_size, true);
});

test("at most 20 marks, and a before picture of another size is said", async (t) => {
  const dots = []; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) dots.push([48 * i + 4, 48 * j + 4, 4]);
  const r = await diff(t, png(240, 200), png(240, 240, dots));
  if (!r) return;
  assert.equal(r.boxes.length, 25);
  assert.equal(r.marks.length, 20);
  assert.equal(r.partial, true, "a picture with more changed areas than marks says so");
  assert.equal(r.same_size, false, "the marks do not fit the before picture");
});

// Two versions of an option: the button the comment is pinned to changes colour on view 2.
const option = (colour) => `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div id="review"><button data-review-view="1">1</button><button data-review-view="2">2</button></div>
  <section data-view="1" style="height:400px">Overview</section>
  <section data-view="2" style="display:none;padding:300px 40px 600px"><button id="save" style="width:120px;height:40px;border:0;background:${colour}">Save</button></section>
  <script>for (const b of document.querySelectorAll("[data-review-view]")) b.onclick = () => document.querySelectorAll("[data-view]").forEach((v) => { v.style.display = v.dataset.view === b.dataset.reviewView ? "block" : "none"; });</script></body></html>`;

test("compare crops both versions to one box around the element and marks the change", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dd-compare-"));
  writeFileSync(join(dir, "a.html"), option("#ddd")); writeFileSync(join(dir, "b.html"), option("#0f62fe"));
  let r;
  try { r = JSON.parse((await promisify(execFile)(process.execPath, [design, "compare", join(dir, "a.html"), join(dir, "b.html"), join(dir, "out"), "--view", "2", "--selector", "#save", "--label", "Save", "--pad", "40"], { timeout: 60000 })).stdout); }
  catch (e) { if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  assert.deepEqual(r.found, { before: true, after: true });
  assert.deepEqual(r.shots.map((s) => [s.stage, s.pair, s.file.endsWith(`/save-light-${s.stage}.jpg`)]), [["before", "Save", true], ["after", "Save", true]],
    "named after the pair and the theme, so another run into one directory keeps them");
  assert.ok(r.shots[1].marks.length && r.shots[0].marks, "the same box on both pictures, so both carry the marks");
  assert.ok(r.changed_pct > 0 && r.changed_pct < 20, `only the button changed (${r.changed_pct}%)`);
});

test("compare takes a note's anchor as JSON, and a quote in it stays text", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dd-compare-"));
  writeFileSync(join(dir, "a.html"), option("#ddd")); writeFileSync(join(dir, "b.html"), option("#0f62fe"));
  const run = async (anchor) => {
    writeFileSync(join(dir, "anchor.json"), JSON.stringify(anchor));
    return JSON.parse((await promisify(execFile)(process.execPath, [design, "compare", join(dir, "a.html"), join(dir, "b.html"), join(dir, "out"), "--anchor", join(dir, "anchor.json"), "--pad", "40"], { timeout: 60000 })).stdout);
  };
  let r;
  try { r = await run({ anchor: { variant: "v1", view: "2", selector: "section > #save", label: "Save \"now\"" } }); }
  catch (e) { if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  assert.deepEqual(r.found, { before: true, after: true }, "a selector with a space and > finds the element");
  assert.equal(r.shots[0].pair, "Save \"now\"");
  r = await run({ view: "2\"]", selector: "#save" });
  assert.deepEqual(r.found, { before: false, after: false }, "a view name with a quote finds no tab and does not fail");
});
