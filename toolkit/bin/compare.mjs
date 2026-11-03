// design compare <before.html> <after.html> <outdir> [--view <n>] [--selector <css>] [--label <text>]
//                [--width 1440] [--dark] [--pad 120]
// What a worked-in comment did to an option: the same place in its earlier and its new version,
// cropped around the element the comment is pinned to (`anchor.selector`, on `anchor.view`). Both
// crops are one box (the element's place in either version, padded, at least 720×400), so they line up; without a
// selector, or where neither version has the element, the whole view. The review bar is left out.
// Prints {found, changed_pct, shots}: `shots` is what `design desk answer --shots` takes, a
// before and an after picture as `file`s (the Desk command uploads them), the changed boxes as
// `marks` on both when they are the same size, on the after one otherwise.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, fail, launch } from "../lib/core.mjs";
import { measure } from "./diff.mjs";

const MIN = { w: 720, h: 400 };

export async function main(_cmd, argv) {
  const pos = []; let view = "", selector = "", label = "", width = 1440, dark = false, pad = 120;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--view") view = String(argv[++i]);
    else if (a === "--selector") selector = argv[++i];
    else if (a === "--label") label = argv[++i];
    else if (a === "--width") width = Number(argv[++i]);
    else if (a === "--pad") pad = Number(argv[++i]);
    else if (a === "--dark") dark = true;
    else pos.push(a);
  }
  const [before, after, out] = pos;
  if (!before || !after || !out) fail("usage: design compare <before.html> <after.html> <outdir> [--view <n>] [--selector <css>] [--label <text>] [--dark]");
  ensureDir(out);
  const browser = await launch();
  const pages = [];
  for (const file of [before, after]) pages.push(await open(browser, file, { view, selector, width, dark }));
  const [a, b] = pages;
  // One box for both: where the element is in either version, padded and at least MIN big so a
  // person sees what is around it, inside both pages.
  const boxes = [a.box, b.box].filter(Boolean);
  const W = Math.min(a.size.w, b.size.w), H = Math.min(a.size.h, b.size.h);
  let clip = { x: 0, y: 0, w: W, h: H };
  if (boxes.length) {
    const span = (lo, hi, min, max) => {
      const want = Math.min(max, Math.max(hi - lo, min)), mid = (lo + hi) / 2;
      const from = Math.max(0, Math.min(mid - want / 2, max - want));
      return [Math.round(from), Math.round(want)];
    };
    const [x, w] = span(Math.min(...boxes.map((r) => r.x)) - pad, Math.max(...boxes.map((r) => r.x + r.w)) + pad, MIN.w, W);
    const [y, h] = span(Math.min(...boxes.map((r) => r.y)) - pad, Math.max(...boxes.map((r) => r.y + r.h)) + pad, MIN.h, H);
    if (w > 0 && h > 0) clip = { x, y, w, h };
  }
  const files = [`${out}/before.jpg`, `${out}/after.jpg`];
  for (const [i, p] of pages.entries()) {
    await p.pg.screenshot({ path: files[i], type: "jpeg", quality: 82, fullPage: true, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } });
    await p.pg.close();
  }
  const m = await measure(browser, files[0], files[1]);
  await browser.close();
  const pair = label || (view ? `View ${view}` : "the option");
  const caption = dark ? "Dark" : "";
  const marks = m.marks.length ? { marks: m.marks } : {};
  console.log(JSON.stringify({
    found: { before: Boolean(a.box), after: Boolean(b.box) }, changed_pct: m.changed_pct,
    shots: [
      { file: files[0], stage: "before", pair, caption, ...(m.same_size ? marks : {}) },
      { file: files[1], stage: "after", pair, caption, ...marks },
    ],
  }));
  if (pages.some((p) => p.errors.length)) { console.error(`page errors:\n  ${[...new Set(pages.flatMap((p) => p.errors))].join("\n  ")}`); process.exitCode = 1; }
}

// One version, on its view and theme, grown to its tallest scroll area as `design shot` does;
// `box` is where the element is on the page, null when it is not there or not shown.
async function open(browser, file, { view, selector, width, dark }) {
  const pg = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  pg.on("pageerror", (e) => errors.push(e.message));
  await pg.goto(pathToFileURL(resolve(file)).href);
  await pg.evaluate(() => document.fonts.ready);
  if (view) { const tab = pg.locator(`[data-review-view="${view}"]`); if (await tab.count()) await tab.first().click(); }
  await pg.evaluate((d) => {
    const de = document.documentElement;
    de.classList.toggle("dark", d); de.classList.remove("review-hot");
    de.style.setProperty("--review-h", "0px");
    const bar = document.getElementById("review"); if (bar) bar.style.display = "none";
  }, dark);
  await pg.waitForTimeout(350);
  const tall = await pg.evaluate(() => Math.max(innerHeight, ...[...document.querySelectorAll("*")]
    .filter((e) => e.offsetParent !== null && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
    .map((e) => e.scrollHeight + e.getBoundingClientRect().top)));
  await pg.setViewportSize({ width, height: Math.min(Math.ceil(tall) + 8, 8000) });
  await pg.waitForTimeout(80);
  return await pg.evaluate((sel) => {
    let box = null;
    try {
      const e = sel ? document.querySelector(sel) : null, r = e?.getBoundingClientRect();
      if (r && r.width && r.height) box = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    } catch { /* a selector this version cannot parse finds nothing */ }
    return { box, size: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight } };
  }, selector).then((r) => ({ ...r, pg, errors }));
}
