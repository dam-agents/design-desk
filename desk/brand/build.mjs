// Design Desk's mark (#215): its geometry, and every file in desk/brand/ drawn from it.
//
//   node desk/brand/build.mjs        writes mark.svg, favicon.svg, avatar.svg and their PNGs
//
// The mark is a disc in a cool gradient — teal, blue, violet, pink — with DD on it: two D's, a
// thin spark cut out of the second so the gradient shows through. Light mode: deep colours, white
// D's. Dark mode: bright colours, near-black D's. The page, the guidelines and their tests import
// the shapes from here, so there is one drawing.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const f = (n) => +n.toFixed(3);

// In a 24-unit box, the disc filling it.
const C = 12, R = 12;
const D = { h: 7.44, w: 6.86, gap: 1.34 };            // each D: a bar, then a half disc
const r = D.h / 2, x0 = f(C - D.w - D.gap / 2), x1 = f(C + D.gap / 2), y0 = f(C - r);
// A D whose flat back stands at x: up the back, along the top to where its round begins, round.
const dPath = (x) => `M${f(x)} ${y0}H${f(x + D.w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + D.w - r)} ${f(C + r)}H${f(x)}Z`;
// The spark: four thin points, its sides drawn in toward its centre, in the second D.
const S = { x: f(x1 + 2.95), y: C, h: 2.45, w: 1.55, pull: 0.45 };
const sparkPath = () => {
  const { x, y, h, w, pull } = S, q = (a, b) => `Q${f(x + a)} ${f(y + b)}`;
  return `M${x} ${f(y - h)}${q(pull, -pull)} ${f(x + w)} ${y}${q(pull, pull)} ${x} ${f(y + h)}${q(-pull, pull)} ${f(x - w)} ${y}${q(-pull, -pull)} ${x} ${f(y - h)}Z`;
};

/** The two D's (the spark cut from the second: drawn the other way round, filled even-odd). */
export const D_PATH = `${dPath(x0)}${dPath(x1)}${sparkPath()}`;

/** Its colours, light and dark mode: the gradient's stops, top left to bottom right, and the D's. */
export const COLORS = {
  light: { stops: ["#139a9c", "#2f5bd3", "#7a45d0", "#c94a98"], d: "#ffffff" },
  dark: { stops: ["#6ad6d8", "#86a3ff", "#b48dff", "#f08ccc"], d: "#1b1b1a" },
};
const OFFSETS = [0, 0.38, 0.68, 1];

// The drawing; `id` names its gradient (unique per document), `fill` fixes its colours or leaves
// them to classes (mk-s0…mk-s3 on the stops, mk-d on the D's) for the page's CSS.
const drawing = (id, mode) => {
  const stop = (i) => `<stop offset="${OFFSETS[i]}" ${mode ? `stop-color="${COLORS[mode].stops[i]}"` : `class="mk-s${i}"`}/>`;
  return `<defs><linearGradient id="${id}" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">${[0, 1, 2, 3].map(stop).join("")}</linearGradient></defs>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id})"/><path d="${D_PATH}" fill-rule="evenodd" ${mode ? `fill="${COLORS[mode].d}"` : `class="mk-d"`}/>`;
};
const schemeCss = () => {
  const css = (c) => c.stops.map((s, i) => `.mk-s${i}{stop-color:${s}}`).join("") + `.mk-d{fill:${c.d}}`;
  return `<style>${css(COLORS.light)}@media (prefers-color-scheme:dark){${css(COLORS.dark)}}</style>`;
};

/** mark.svg: the mark, its colours following the reader's light or dark mode. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${schemeCss()}${drawing("ddm")}</svg>\n`;

/** The mark in fixed colours, for the PNGs and the avatar. */
export const markIn = (mode) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${drawing(`ddm-${mode}`, mode)}</svg>\n`;

/** avatar.svg: the agent's avatar is the mark itself, a disc, in its light colours. */
export const AVATAR_SVG = markIn("light");

/** The mark as the page draws it inline: classes only, its colours from the page's CSS. */
export const MARK_INLINE = `<svg class="dd-mark" viewBox="0 0 24 24" aria-hidden="true">${drawing("dd-mark-g")}</svg>`;

/** The favicon, as a data: URL the page links to (the page is one file). */
export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(MARK_SVG.trim())}`;

async function build() {
  const out = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(out, "mark.svg"), MARK_SVG);
  writeFileSync(join(out, "favicon.svg"), MARK_SVG);
  writeFileSync(join(out, "avatar.svg"), AVATAR_SVG);
  const { launch } = await import("../../toolkit/lib/core.mjs");
  const browser = await launch();
  const page = await browser.newPage();
  const png = async (svg, px, file) => {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
    await page.screenshot({ path: join(out, file), omitBackground: true });
  };
  await png(AVATAR_SVG, 512, "avatar.png");
  await png(markIn("light"), 32, "favicon-32.png");
  await png(markIn("light"), 64, "mark.png"); // GitHub comments show it at 16 px: four pixels to each
  await browser.close();
  console.log("wrote mark.svg, favicon.svg, avatar.svg, avatar.png, favicon-32.png, mark.png");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await build();
