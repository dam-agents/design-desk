// node --test toolkit/tests/capture.test.mjs — a capture recipe brings a page into a state before it shoots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const design = new URL("../bin/design.mjs", import.meta.url).pathname;
const PAGE = `<!doctype html><html><body><h1>Agents</h1><button id="add">New agent</button><ul id="list"></ul>
<script>document.getElementById("add").onclick = () => { document.getElementById("list").innerHTML = "<li>Release helper</li>"; };</script></body></html>`;

test("a recipe clicks to its state, shoots both themes, and reports where a step got stuck", async (t) => {
  const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "dd-capture-"));
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({
    setup: [{ goto: "/agents" }],
    shots: [
      { name: "One agent", steps: [{ click: "text=New agent" }, { wait: "text=Release helper" }], themes: ["light", "dark"] },
      { name: "Missing", steps: [{ click: "text=Nowhere" }] },
      { name: "Elsewhere", steps: [{ goto: "https://example.com/" }] },
    ],
  }));
  // The page's server runs in this process, so the capture runs beside it, never blocking it.
  let out;
  try { ({ stdout: out } = await promisify(execFile)(process.execPath, [design, "capture", base, dir, "--recipe", join(dir, "recipe.json")], { timeout: 150000 })); }
  catch (e) { server.close(); if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  server.close();
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.filter((l) => !l.error).map((l) => l.theme), ["light", "dark"]);
  assert.ok(existsSync(join(dir, "one-agent.jpg")) && existsSync(join(dir, "one-agent-dark.jpg")));
  assert.match(lines.find((l) => l.name === "Missing").at, /Missing step 1/);
  assert.match(lines.find((l) => l.name === "Elsewhere").error, /leaves the app/);
});

// The width and height a JPEG says it has (its first start-of-frame marker).
function jpegSize(buf) {
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

test("a recipe shot with an element is cut to that part, sharp, and a missing part fails the shot", async (t) => {
  const page = `<!doctype html><html><body style="margin:0"><div style="height:400px"></div><div id="card" style="margin-left:100px;width:200px;height:100px;background:#36c">Agent</div></body></html>`;
  const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "dd-capture-el-"));
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({ setup: [{ goto: "/" }], shots: [{ name: "Card", element: "#card" }, { name: "Gone", element: "#nothing" }] }));
  let out;
  try { ({ stdout: out } = await promisify(execFile)(process.execPath, [design, "capture", base, dir, "--recipe", join(dir, "recipe.json")], { timeout: 150000 })); }
  catch (e) { server.close(); if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  server.close();
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  const card = lines.find((l) => l.name === "Card");
  assert.equal(card.element, true);
  assert.deepEqual(card.box, { x: 100, y: 400, w: 200, h: 100 });
  // 8 px round the part, at two screen pixels per CSS pixel.
  assert.deepEqual(jpegSize(readFileSync(join(dir, "card-element.jpg"))), { w: 2 * 216, h: 2 * 116 });
  const gone = lines.find((l) => l.name === "Gone");
  assert.match(gone.error, /#nothing is not on the page/);
  assert.ok(existsSync(join(dir, "gone-stuck.jpg")));
});

test("a sticky part is cut where it is seen, the page scrolled under it", async (t) => {
  const page = `<!doctype html><html><body style="margin:0"><header id="bar" style="position:sticky;top:0;height:60px;width:300px;background:#c33">Bar</header><div style="height:3000px"></div><p id="end">End</p></body></html>`;
  const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "dd-capture-sticky-"));
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({ setup: [{ goto: "/" }], shots: [{ name: "Bar", steps: [{ scroll: "#end" }], element: "#bar" }] }));
  let out;
  try { ({ stdout: out } = await promisify(execFile)(process.execPath, [design, "capture", base, dir, "--recipe", join(dir, "recipe.json")], { timeout: 150000 })); }
  catch (e) { server.close(); if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  server.close();
  const line = JSON.parse(out.trim().split("\n")[0]);
  assert.equal(line.element, true, line.error);
  // Cut where it is seen, at the window's top: 8 px round it but none past the window's edge, at
  // two screen pixels per CSS pixel.
  assert.deepEqual(jpegSize(readFileSync(join(dir, "bar-element.jpg"))), { w: 2 * 308, h: 2 * 68 });
});

test("a part taller or wider than the window is shot whole", async (t) => {
  const page = `<!doctype html><html><body style="margin:0"><div style="height:200px"></div><div id="tall" style="margin-left:50px;width:200px;height:1500px;background:#3a3"></div><div style="height:400px"></div><div id="wide" style="width:2000px;height:100px;background:#33a"></div></body></html>`;
  const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "dd-capture-tall-"));
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({ setup: [{ goto: "/" }], shots: [{ name: "Tall", element: "#tall" }, { name: "Wide", element: "#wide" }] }));
  let out;
  try { ({ stdout: out } = await promisify(execFile)(process.execPath, [design, "capture", base, dir, "--recipe", join(dir, "recipe.json")], { timeout: 150000 })); }
  catch (e) { server.close(); if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  server.close();
  const line = JSON.parse(out.trim().split("\n")[0]);
  assert.equal(line.element, true, line.error);
  assert.deepEqual(line.box, { x: 50, y: 200, w: 200, h: 1500 });
  // All of it, though the window is 900 px high: the element itself, without padding.
  assert.deepEqual(jpegSize(readFileSync(join(dir, "tall-element.jpg"))), { w: 2 * 200, h: 2 * 1500 });
  const wide = JSON.parse(out.trim().split("\n")[1]);
  assert.equal(wide.element, true, wide.error);
  assert.deepEqual(jpegSize(readFileSync(join(dir, "wide-element.jpg"))), { w: 2 * 2000, h: 2 * 100 }, "a part wider than the window is not cut at its edge");
});
