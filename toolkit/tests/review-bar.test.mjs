// node --test toolkit/tests/review-bar.test.mjs — a design walks its flow: a control wired
// to another view opens it, Back retraces it, and what can be clicked shows.
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLKIT, chromium, req } from "../lib/core.mjs";
import { danglingGotos } from "../bin/build.mjs";

const bar = readFileSync(join(TOOLKIT, "chrome/review-bar.html"), "utf8");
const PAGE = `<!doctype html><html><body>${bar}
  <div data-view="1" data-view-name="List"><p id="plain">Three plans</p><button id="dead">Export</button><button id="open" data-goto-view="2">Open plan</button>
    <button id="menu" data-menu-trigger="m1">More</button><div id="m1"><button>Archive</button></div>
    <button id="js" onclick="this.dataset.on = 1">Expand</button><button id="mark" data-clickable>Pin</button><input id="field">
    <select id="pick"><option>Monthly</option></select><textarea id="area"></textarea><label id="name">Name</label>
    <details><summary id="sum">Details</summary></details><div id="note" contenteditable>Note</div></div>
  <div data-view="2" data-view-name="Plan"><a href="#" id="edit" data-goto-view="3">Edit</a><button id="back" data-goto-view="back">Back</button></div>
  <div data-view="3" data-view-name="Edit plan"><p>Form</p></div>
</body></html>`;

test("a data-goto-view that names no view is found before the build ships it", () => {
  assert.deepEqual(danglingGotos(PAGE), []);
  assert.deepEqual(danglingGotos(`${PAGE}<button data-goto-view="9">x</button><button data-goto-view="9">y</button>`), ["9"]);
});

test("a click walks the flow, Back retraces it, a dead spot flashes what is clickable", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  Object.assign(process.env, browser.env);
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const pg = await chrome.newPage();
    await pg.setContent(PAGE);
    await pg.evaluate(() => document.dispatchEvent(new Event("DOMContentLoaded")));
    const shown = () => pg.evaluate(() => document.querySelector("[data-view].review-shown")?.dataset.view);
    const pressed = () => pg.evaluate(() => document.querySelector('#review [data-review-view][aria-pressed="true"]')?.dataset.reviewView);
    assert.equal(await shown(), "1");
    assert.equal(await pg.isVisible("#review-back"), false);
    await pg.click("#open");
    await pg.click("#edit");
    assert.deepEqual([await shown(), await pressed()], ["3", "3"]);
    await pg.click("#review [data-review-back]");
    assert.equal(await shown(), "2");
    await pg.click("#back");
    assert.equal(await shown(), "1");
    assert.equal(await pg.isVisible("#review-back"), false);
    const hot = () => pg.evaluate(() => document.documentElement.classList.contains("review-hot"));
    // Show hotspots starts on; the rest of the flow is checked with it switched off.
    assert.equal(await hot(), true, "Show hotspots starts on");
    assert.equal(await pg.getAttribute("#review [data-hot]", "aria-checked"), "true");
    await pg.click("#review [data-hot]");
    assert.equal(await hot(), false);
    // Every wired control acts, and so does a field: neither flashes as a dead spot.
    const fields = ["#field", "#pick", "#area", "#name", "#sum", "#note"];
    for (const s of ["#menu", "#js", "#mark", ...fields]) { await pg.click(s); assert.equal(await hot(), false, s); }
    // A click on a spot that does nothing outlines the clickable parts for a moment.
    await pg.click("#plain");
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), true);
    await pg.waitForTimeout(900);
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), false);
    // A product button the prototype does not wire is a dead spot too, and it is not outlined.
    await pg.click("#dead");
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), true);
    const outlined = (s) => pg.evaluate((s) => getComputedStyle(document.querySelector(s)).outlineStyle !== "none", s);
    const marks = ["#open", "#menu", "#js", "#mark", "#dead", ...fields];
    assert.deepEqual(await Promise.all(marks.map(outlined)), [true, true, true, true, false, ...fields.map(() => false)], "only what the design wires is outlined");
    await pg.waitForTimeout(900);
    await pg.click("#review [data-hot]");
    await pg.waitForTimeout(900);
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), true);
    assert.equal(await pg.getAttribute("#review [data-hot]", "aria-checked"), "true");
  } finally { await chrome.close(); }
});

test("design shot takes no picture with the dead-click flash", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  try { req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  const { main } = await import("../bin/shot.mjs");
  const dir = mkdtempSync(join(tmpdir(), "dd-shot-"));
  writeFileSync(join(dir, "p.html"), PAGE);
  // A flash still on when a picture is taken: shot closes a menu with a click on a dead spot,
  // and on a slow machine the next view's picture can come inside the flash's 700 ms.
  writeFileSync(join(dir, "f.html"), PAGE.replace("</body>", `<script>addEventListener("load", () => document.documentElement.classList.add("review-hot"))</script></body>`));
  const log = console.log; console.log = () => {};
  try {
    await main("shot", [join(dir, "p.html"), join(dir, "plain"), "--width", "600", "--height", "400"]);
    await main("shot", [join(dir, "f.html"), join(dir, "clicked"), "--width", "600", "--height", "400"]);
  } finally { console.log = log; }
  // Pixels that differ clearly between the two pictures of view 2; the flash's outlines are hundreds.
  const pw = req("playwright-core");
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const pg = await chrome.newPage();
    const url = (k) => `data:image/png;base64,${readFileSync(join(dir, k, "2-light.png")).toString("base64")}`;
    const changed = await pg.evaluate(async ([a, b]) => {
      const px = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
      const [p, q] = [await px(a), await px(b)];
      let n = p.length === q.length ? 0 : Infinity;
      for (let i = 0; i < p.length && n !== Infinity; i += 4) if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) > 40) n++;
      return n;
    }, [url("plain"), url("clicked")]);
    assert.ok(changed < 20, `view 2 is pictured without the flash (${changed} pixels differ)`);
  } finally { await chrome.close(); }
});

test("design shot --element pictures one part alone, on its view, named after its page", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  try { req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  const { main } = await import("../bin/shot.mjs");
  const dir = mkdtempSync(join(tmpdir(), "dd-element-"));
  // Two states of one part, shot into one directory: each keeps its own picture.
  const css = `<style>#edit{display:inline-block;width:120px;height:40px}</style>`;
  writeFileSync(join(dir, "hover.html"), PAGE.replace("<body>", `<body>${css}`));
  writeFileSync(join(dir, "error.html"), PAGE.replace("<body>", `<body>${css}`).replace(">Edit<", " style=\"background:red\">Edit<"));
  const out = join(dir, "shots"), printed = [];
  const log = console.log; console.log = (p) => printed.push(p);
  try {
    // The part is on view 2, which is not shown when the page opens.
    for (const p of ["hover", "error"]) await main("shot", [join(dir, `${p}.html`), out, "--width", "600", "--height", "400", "--element", "#edit", "--pad", "10"]);
  } finally { console.log = log; }
  assert.deepEqual(printed, ["hover", "error"].flatMap((p) => ["light", "dark"].map((th) => join(out, `${p}-element-${th}.png`))));
  // A PNG names its width and height at bytes 16 and 20: the part and its padding, not the page —
  // at three screen pixels per CSS pixel, so a tile shows it sharp (the part is 120×40 + 10 pad).
  const size = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  for (const f of printed) {
    const [w, h] = size(f);
    assert.ok(w >= 420 && w <= 450 && h >= 180 && h <= 210, `${f} is the part alone at 3× (${w}×${h})`);
  }
  assert.notDeepEqual(readFileSync(printed[0]), readFileSync(printed[2]), "two states keep two pictures");
  // A part the page does not have, or one that is not shown, is said, not pictured.
  const run = (sel) => spawnSync(process.execPath, [join(TOOLKIT, "bin/design.mjs"), "shot", join(dir, "hover.html"), out, "--element", sel], { encoding: "utf8" });
  assert.match(run("#nothing").stderr, /--element: nothing matches #nothing/);
  writeFileSync(join(dir, "hidden.html"), `<!doctype html><html><body><button id="gone" style="display:none">Hidden</button></body></html>`);
  const hidden = spawnSync(process.execPath, [join(TOOLKIT, "bin/design.mjs"), "shot", join(dir, "hidden.html"), out, "--element", "#gone"], { encoding: "utf8" });
  assert.match(hidden.stderr, /--element: #gone is not visible/);
});

test("design shot --element shoots a large part again at a lower scale, so it fits the Desk's 720 KiB", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  try { req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  const { main } = await import("../bin/shot.mjs");
  const dir = mkdtempSync(join(tmpdir(), "dd-element-big-"));
  // A large gradient with a shadow: at 3× its PNG is far over the Desk's limit (desk/store.mjs LIMITS.assetBytes).
  writeFileSync(join(dir, "big.html"), `<!doctype html><html><body style="margin:40px">
<div id="hero" style="width:1000px;height:750px;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.45);
background:radial-gradient(circle at 30% 20%,#ff6a3d,transparent 60%),radial-gradient(circle at 80% 70%,#3d8bff,transparent 55%),conic-gradient(from 40deg,#ffe66d,#7cffcb,#b07cff,#ffe66d)"></div></body></html>`);
  const out = join(dir, "shots"), printed = [];
  const log = console.log; console.log = (p) => printed.push(p);
  try { await main("shot", [join(dir, "big.html"), out, "--width", "1200", "--height", "900", "--element", "#hero", "--pad", "10"]); } finally { console.log = log; }
  assert.deepEqual(printed, ["light", "dark"].map((th) => join(out, `big-element-${th}.png`)));
  for (const f of printed) {
    const b = readFileSync(f), w = b.readUInt32BE(16);
    assert.ok(b.length <= 720 * 1024, `${f} fits the Desk (${b.length} bytes)`);
    assert.ok(w >= 1020 && w < 3 * 1020, `${f} is the part at a lower scale than 3× (${w} px wide)`);
  }
});
