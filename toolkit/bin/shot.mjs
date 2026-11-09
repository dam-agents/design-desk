// design shot <page.html> <outdir> [--width 1440] [--height 900] [--views] [--dark] [--click <selector>]...
//             [--element <selector> [--pad 16]]
// Full-length screenshots. With --views (or when the page has a review bar) it shoots
// every view in light and dark, plus the empty state where the view has one, plus each
// menu or dialog whose trigger --click names. With --element, only that element, padded,
// light and dark (`<page>-element-<light|dark>.png`, named after the page so the states of a
// part shot into one directory keep each their own): a part's state for the request's design
// catalog (docs/requests.md → Every state of a part). An element is shot at three screen pixels
// per CSS pixel, so a 380–420 px tile shows it sharp rather than enlarging it; where a picture
// would pass 700 KiB (under the Desk's 720 KiB), both are shot again at two, then one. Over it
// even at one, it exits 1 and leaves no picture. Prints one path per line.
import { renameSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, fail, launch } from "../lib/core.mjs";

const ELEMENT_SCALES = [3, 2, 1], ELEMENT_MAX_BYTES = 700 * 1024;

export async function main(_cmd, argv) {
  const pos = [], clicks = []; let width = 1440, height = 900, dark = false, element = "", pad = 16;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--width") width = Number(argv[++i]);
    else if (a === "--height") height = Number(argv[++i]);
    else if (a === "--click") clicks.push(argv[++i]);
    else if (a === "--dark") dark = true;
    else if (a === "--element") element = argv[++i];
    else if (a === "--pad") pad = Number(argv[++i]);
    else if (a === "--views") {}
    else pos.push(a);
  }
  const [page, out = "shots"] = pos;
  if (!page) fail("usage: design shot <page.html> <outdir> [--width N] [--click <selector>]...");
  ensureDir(out);
  const themes = dark ? ["dark"] : ["light", "dark"];
  const browser = await launch();
  const errors = [];
  const open = async (scale) => {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await p.goto(pathToFileURL(resolve(page)).href);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(400);
    return p;
  };
  if (element) return shootElement();
  const pg = await open(1);
  const views = await pg.locator("[data-review-view]").count();
  const steps = await pg.locator("#tour-steps button").count();
  const snap = async (name) => {
    await pg.waitForTimeout(350);
    // The review bar's dead-click flash outlines every wired control; a picture never shows it.
    await pg.evaluate(() => document.documentElement.classList.remove("review-hot"));
    // Apps scroll inside a pane, not the page: grow the window to the tallest scroll area.
    const tall = await pg.evaluate(() => Math.max(innerHeight, ...[...document.querySelectorAll("*")]
      .filter((e) => e.offsetParent !== null && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
      .map((e) => e.scrollHeight + e.getBoundingClientRect().top)));
    await pg.setViewportSize({ width, height: Math.min(Math.ceil(tall) + 8, 8000) });
    await pg.waitForTimeout(80);
    const p = `${out}/${name}.png`;
    await pg.screenshot({ path: p, fullPage: true });
    console.log(p);
    await pg.setViewportSize({ width, height });
  };
  if (steps) { // a walkthrough: every step, light and dark
    for (let i = 0; i < steps; i++) {
      await pg.locator("#tour-steps button").nth(i).click();
      for (const t of themes) { await pg.evaluate((d) => document.documentElement.classList.toggle("dark", d), t === "dark"); await snap(`step-${i + 1}-${t}`); }
      await pg.evaluate(() => document.documentElement.classList.remove("dark"));
    }
    await browser.close();
    if (errors.length) { console.error(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`); process.exitCode = 1; }
    return;
  }
  for (let i = 0; i < Math.max(views, 1); i++) {
    if (views) await pg.locator("[data-review-view]").nth(i).click();
    for (const t of themes) {
      await pg.evaluate((d) => document.documentElement.classList.toggle("dark", d), t === "dark");
      await snap(`${i + 1}-${t}`);
    }
    await pg.evaluate(() => document.documentElement.classList.remove("dark"));
    const hasEmpty = await pg.evaluate(() => !!(document.querySelector("[data-view].review-shown [data-populated]") || (!document.querySelector("[data-view]") && document.querySelector("[data-populated]"))));
    if (hasEmpty) {
      await pg.evaluate(() => document.documentElement.classList.add("review-empty"));
      await snap(`${i + 1}-empty`);
      await pg.evaluate(() => document.documentElement.classList.remove("review-empty"));
    }
    for (const [k, sel] of clicks.entries()) {
      const el = pg.locator(sel).first();
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click(); await snap(`${i + 1}-open-${k + 1}`);
      await pg.keyboard.press("Escape"); await pg.mouse.click(1, height - 1);
    }
  }
  await browser.close();
  if (errors.length) { console.error(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`); process.exitCode = 1; }
  // A part alone is a picture for a tile 380–420 px wide (docs/requests.md → step 4): it is shot at
  // three screen pixels per CSS pixel, so the tile shows it sharp instead of enlarging a 1× picture.
  // The Desk stores an asset of at most 720 KiB (desk/store.mjs LIMITS.assetBytes): where a picture
  // passes 700 KiB, both are shot again at two, then one screen pixel per CSS pixel, as compare.mjs
  // lowers its quality. Each round shoots to a scratch name; only a round that fits takes the real
  // names, so a refused run leaves no picture to upload and never overwrites an earlier one.
  async function shootElement() {
    let paths = [];
    const scratch = (p) => p.replace(/\.png$/, ".shooting.png");
    const drop = () => { for (const p of paths) rmSync(scratch(p), { force: true }); };
    for (const scale of ELEMENT_SCALES) {
      const pg = await open(scale);
      const el = pg.locator(element).first();
      if (!(await el.count())) { drop(); await browser.close(); fail(`--element: nothing matches ${element}`); }
      const view = await el.evaluate((e) => e.closest("[data-view]")?.dataset.view || null);
      if (view) await pg.locator(`[data-review-view="${view}"]`).first().click().catch(() => {});
      await pg.evaluate(() => { document.documentElement.classList.remove("review-hot"); const r = document.querySelector("#review"); if (r) r.style.display = "none"; });
      drop(); paths = [];
      for (const t of themes) {
        await pg.evaluate((d) => document.documentElement.classList.toggle("dark", d), t === "dark");
        await pg.waitForTimeout(250);
        await el.scrollIntoViewIfNeeded().catch(() => {});
        const b = await el.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
        if (!b.w || !b.h) { drop(); await browser.close(); fail(`--element: ${element} is not visible`); }
        const size = await pg.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
        const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
        const p = `${out}/${basename(page).replace(/(\.src)?\.html?$/i, "")}-element-${t}.png`;
        await pg.screenshot({ path: scratch(p), fullPage: true, clip: { x, y, width: Math.min(size.w - x, b.w + 2 * pad), height: Math.min(size.h - y, b.h + 2 * pad) } });
        paths.push(p);
      }
      await pg.close();
      if (paths.every((p) => statSync(scratch(p)).size <= ELEMENT_MAX_BYTES)) break;
      if (scale === ELEMENT_SCALES.at(-1)) { drop(); await browser.close(); fail(`--element: ${element} is more than 700 KiB (the Desk takes at most 720 KiB) even at one screen pixel per CSS pixel; no picture was written: shoot a smaller part`); }
    }
    for (const p of paths) { renameSync(scratch(p), p); console.log(p); }
    await browser.close();
    if (errors.length) { console.error(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`); process.exitCode = 1; }
  }
}
