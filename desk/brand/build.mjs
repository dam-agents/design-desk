// Design Desk's mark (#215): its geometry, and every file in desk/brand/ drawn from it.
//
//   node desk/brand/build.mjs        writes mark.svg, favicon.svg, avatar.svg and their PNGs
//
// The mark is DD: two D's facing right, each made of two quarter circles. The gaps between the
// quarters run straight from the rim and open into a spark at the centre. At work the first D
// turns round, the two close into a disc and the disc turns (.dd-spin, desk/page.html), in ink.
// The page, the guidelines and their tests import the shapes from here, so there is one drawing.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const R = 11.5;        // the disc's radius, in a 24-unit box
const C = 12;          // the box's centre

// Two cuts of one drawing. G is half of every gap (each quarter's corner sits G off the centre),
// REACH where a gap starts to open into the spark, CTL how far out the spark's curve pulls.
// REGULAR is for 48 px and up; SMALL, its gaps and spark wider so they survive, for everything
// at 32 px and below — on the Desk that is everywhere (#215).
export const REGULAR = { G: 0.6, REACH: 5, CTL: 1 };
export const SMALL = { G: 1.3, REACH: 7.5, CTL: 2.1 };

const f = (n) => +n.toFixed(3);
const pt = ([x, y]) => `${f(x)} ${f(y)}`;
const rot = ([x, y], k) => { for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };

// One quarter, k quarter turns clockwise from top-right; `mirror` turns it about the vertical line
// x = mirror, in the disc's own coordinates (the first D, turned round to face right).
function quarter(cut, k, mirror = null) {
  const { G, REACH, CTL } = cut, QR = R - G;
  const m = ([x, y]) => [(mirror === null ? x : 2 * mirror - x) + C, y + C];
  const P = (p) => pt(m(rot(p, k)));
  return `M${P([G, -R])}A${f(QR)} ${f(QR)} 0 0 ${mirror === null ? 1 : 0} ${P([R, -G])}L${P([REACH, -G])}C${P([CTL, -G])} ${P([G, -CTL])} ${P([G, -REACH])}Z`;
}
// The first D's own centre line, about which it turns round (in the disc's coordinates).
const leftMid = (cut) => (-R - cut.G) / 2;

/** The mark's four pieces in a 0 0 24 24 box: first D top and bottom, second D top and bottom. */
export const piecesOf = (cut) => ({
  tl: quarter(cut, 3, leftMid(cut)), bl: quarter(cut, 2, leftMid(cut)), tr: quarter(cut, 0), br: quarter(cut, 1),
});
export const PIECES = piecesOf(REGULAR);
export const PIECES_SMALL = piecesOf(SMALL);

/** Its colours: one per piece, light and dark. The first D's top is the Desk's brown (--warn). */
export const COLORS = {
  light: { tl: "#9a6200", bl: "#d98f6c", tr: "#82ad68", br: "#6a90cc" },
  dark: { tl: "#e0a640", bl: "#eaa889", tr: "#9fcc86", br: "#8eb1ec" },
};

const ORDER = ["tl", "bl", "tr", "br"]; // classes mk-tl…: the page styles them by its own light and dark colours
const paths = (pieces, fill) => ORDER.map((k) => `<path class="mk-${k}" d="${pieces[k]}"${fill ? ` fill="${fill(k)}"` : ""}/>`).join("");
const schemeCss = () => {
  const css = (c) => ORDER.map((k) => `.mk-${k}{fill:${c[k]}}`).join("");
  return `<style>${css(COLORS.light)}@media (prefers-color-scheme:dark){${css(COLORS.dark)}}</style>`;
};
const file = (pieces) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${schemeCss()}${paths(pieces)}</svg>\n`;

/** mark.svg, for 48 px and up; mark-small.svg, for 32 px and below. Colours follow light or dark mode. */
export const MARK_SVG = file(PIECES);
export const MARK_SMALL_SVG = file(PIECES_SMALL);

/** The small mark in fixed colours, for the PNGs (all shown small: the favicon, GitHub, avatars). */
export const markIn = (mode, pieces = PIECES_SMALL) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths(pieces, (k) => COLORS[mode][k])}</svg>\n`;

/** avatar.svg: the small mark on its ink circle, in its dark-mode colours, as the agent's avatar. */
const AV = 0.64; // the mark's share of the circle
export const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1b1b1a"/><g transform="translate(${f(C - C * AV)} ${f(C - C * AV)}) scale(${AV})">${paths(PIECES_SMALL, (k) => COLORS.dark[k])}</g></svg>\n`;

/** The mark as the page draws it inline (the small cut): classes only, colours from the page's CSS. */
export const MARK_INLINE = `<svg class="dd-mark" viewBox="0 0 24 24" aria-hidden="true">${paths(PIECES_SMALL)}</svg>`;

/**
 * The spinner (.dd-spin): the small mark, its pieces flipping one by one on a beat. Eight beats of
 * 0.6 s: the four pieces turn over in turn, clockwise from the top left (beats 1-4); the pairs
 * across the middle turn back together (5, 6); two beats of rest (7, 8). Nothing turns as a whole.
 * The SVG carries its own animation and is the CSS mask of .dd-spin, whose colour is the page's.
 * SPIN_STILL is the mark at rest, for a spinner that waits (.queued).
 */
export const SPIN_BEAT = 0.6;
const BEATS = 8, FLIP = 0.36; // a flip takes 0.36 s of its 0.6 s beat
const pcT = (beat) => f((beat * 100) / BEATS);
const flipKeys = (out, back) => {
  const o = pcT(out - 1), oe = f(o + (FLIP * 100) / (BEATS * SPIN_BEAT)), b = pcT(back - 1), be = f(b + (FLIP * 100) / (BEATS * SPIN_BEAT));
  return `0%,${o}%{transform:scale(1,1)}${oe}%,${b}%{transform:var(--t)}${be}%,100%{transform:scale(1,1)}`;
};
// Which beat each piece turns over and back on, and which way: the first D's pieces across, the
// second's up and down, so the four never move alike.
const SPIN_PLAN = { tl: [1, 5, "scale(-1,1)"], tr: [2, 6, "scale(1,-1)"], br: [3, 5, "scale(1,-1)"], bl: [4, 6, "scale(-1,1)"] };
const spinCss = ORDER.map((k) => { const [o, b, t] = SPIN_PLAN[k]; return `@keyframes ${k}{${flipKeys(o, b)}}.${k}{--t:${t};animation:${k} ${f(BEATS * SPIN_BEAT)}s cubic-bezier(.45,0,.2,1.25) infinite}`; }).join("");
export const SPIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>path{transform-box:fill-box;transform-origin:center}${spinCss}@media (prefers-reduced-motion:reduce){path{animation-duration:${f(BEATS * SPIN_BEAT * 2.5)}s}}</style>${ORDER.map((k) => `<path class="${k}" d="${PIECES_SMALL[k]}"/>`).join("")}</svg>`;
const dataUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
export const SPIN_MASK = dataUrl(SPIN_SVG);
export const SPIN_STILL = dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${ORDER.map((k) => `<path d="${PIECES_SMALL[k]}"/>`).join("")}</svg>`);
/** A mask in a JS string's single quotes (the prototype overlay's own copy). */
export const sq = (s) => s.replace(/"/g, "'");

/** The favicon, as a data: URL the page links to (the page is one file). */
export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(MARK_SMALL_SVG.trim())}`;

async function build() {
  const out = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(out, "mark.svg"), MARK_SVG);
  writeFileSync(join(out, "mark-small.svg"), MARK_SMALL_SVG);
  writeFileSync(join(out, "favicon.svg"), MARK_SMALL_SVG);
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
  console.log("wrote mark.svg, mark-small.svg, favicon.svg, avatar.svg, avatar.png, favicon-32.png, mark.png");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await build();
