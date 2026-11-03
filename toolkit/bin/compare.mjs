// design compare <before.html> <after.html> <outdir> [--anchor <anchor.json|->] [--view <n>]
//                [--selector <css>] [--label <text>] [--width 1440] [--dark] [--pad 120]
// What a worked-in comment did to an option: the same place in its earlier and its new version,
// cropped around the element the comment is pinned to (`anchor.selector`, on `anchor.view`). Both
// crops are one box (the element's place in either version, padded, at least 720×400), so they line up; where
// that does not fit both pages, the box around the after version's element; without a
// selector, or where neither version has the element, the whole view. The review bar is left out.
// Prints {found, changed_pct, shots}: `found` says whether each picture shows the element;
// `shots` is what `design desk answer --shots` takes, a before and an after picture as `file`s
// (`<outdir>/<pair>-<light|dark>-before.jpg` and `…-after.jpg`, so runs into one directory keep
// each other's; the Desk command uploads them), the changed boxes as `marks` on both when they
// are the same size, on the after one otherwise.
// A note's anchor is a person's text: give it with --anchor (its JSON as the Desk keeps it, a file
// or stdin), so no view, selector or label passes through a shell command line.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, fail, launch } from "../lib/core.mjs";
import { measure } from "./diff.mjs";

const MIN = { w: 720, h: 400 };
// The Desk stores an asset of at most 720 KiB (desk/store.mjs LIMITS.assetBytes); a tall whole
// view is shot again at a lower quality until it fits.
const MAX_BYTES = 700 * 1024, QUALITY = [82, 70, 55, 40];

export async function main(_cmd, argv) {
  const pos = []; let view = "", selector = "", label = "", width = 1440, dark = false, pad = 120;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--anchor") {
      const src = argv[++i];
      let an; try { an = JSON.parse(readFileSync(src === "-" ? 0 : src, "utf8")); } catch (e) { fail(`--anchor: not JSON (${e.message})`); }
      an = an?.anchor ?? an;
      if (!an || typeof an !== "object") fail("--anchor: the note's anchor, {view, selector, label}");
      if (typeof an.view === "string") view = an.view;
      if (typeof an.selector === "string") selector = an.selector;
      if (typeof an.label === "string") label = an.label;
    }
    else if (a === "--view") view = String(argv[++i]);
    else if (a === "--selector") selector = argv[++i];
    else if (a === "--label") label = argv[++i];
    else if (a === "--width") width = Number(argv[++i]);
    else if (a === "--pad") pad = Number(argv[++i]);
    else if (a === "--dark") dark = true;
    else pos.push(a);
  }
  const [before, after, out] = pos;
  if (!before || !after || !out) fail("usage: design compare <before.html> <after.html> <outdir> [--anchor <anchor.json|->] [--view <n>] [--selector <css>] [--label <text>] [--dark]");
  ensureDir(out);
  const browser = await launch();
  const pages = [];
  for (const file of [before, after]) pages.push(await open(browser, file, { view, selector, width, dark }));
  const [a, b] = pages;
  // One box for both: where the element is in either version, padded and at least MIN big so a
  // person sees what is around it, inside both pages. Where that span does not fit both pages
  // (the element moved further than the shorter page holds), the box is the after version's.
  const W = Math.min(a.size.w, b.size.w), H = Math.min(a.size.h, b.size.h);
  const span = (lo, hi, min, max) => {
    const want = Math.min(max, Math.max(hi - lo, min)), mid = (lo + hi) / 2;
    const from = Math.max(0, Math.min(mid - want / 2, max - want));
    return [Math.round(from), Math.round(want)];
  };
  const around = (boxes) => {
    const [x, w] = span(Math.min(...boxes.map((r) => r.x)) - pad, Math.max(...boxes.map((r) => r.x + r.w)) + pad, MIN.w, W);
    const [y, h] = span(Math.min(...boxes.map((r) => r.y)) - pad, Math.max(...boxes.map((r) => r.y + r.h)) + pad, MIN.h, H);
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  };
  const inside = (r, c) => Boolean(r) && r.x >= c.x && r.y >= c.y && r.x + r.w <= c.x + c.w && r.y + r.h <= c.y + c.h;
  const boxes = [a.box, b.box].filter(Boolean);
  let clip = (boxes.length && around(boxes)) || { x: 0, y: 0, w: W, h: H };
  if (boxes.length > 1 && !boxes.every((r) => inside(r, clip))) clip = around([b.box]) || clip;
  // `found` says whether each picture shows the element: tested against the box both are cut to.
  const found = { before: inside(a.box, clip), after: inside(b.box, clip) };
  // Named after the pair and the theme, so runs into one directory keep each other's pictures.
  const pair = label || (view ? `View ${view}` : "the option");
  const stem = `${pair.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "option"}-${dark ? "dark" : "light"}`;
  const files = [`${out}/${stem}-before.jpg`, `${out}/${stem}-after.jpg`];
  for (const [i, p] of pages.entries()) {
    for (const quality of QUALITY) {
      await p.pg.screenshot({ path: files[i], type: "jpeg", quality, fullPage: true, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } });
      if (statSync(files[i]).size <= MAX_BYTES) break;
    }
    await p.pg.close();
  }
  const big = files.filter((f) => statSync(f).size > MAX_BYTES);
  if (big.length) { await browser.close(); fail(`${big.join(", ")}: more than the Desk's 720 KiB at quality ${QUALITY.at(-1)}; give a --selector, or a smaller --width`); }
  const m = await measure(browser, files[0], files[1]);
  await browser.close();
  const caption = dark ? "Dark" : "";
  const marks = m.marks.length ? { marks: m.marks } : {};
  console.log(JSON.stringify({
    found, changed_pct: m.changed_pct,
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
  // The view's tab found by its value, not by a selector built from it: a quote in a name stays text.
  if (view) await pg.evaluate((v) => [...document.querySelectorAll("[data-review-view]")].find((e) => e.dataset.reviewView === v)?.click(), view);
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
