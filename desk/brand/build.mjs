// Design Desk's mark (#215): its geometry, and every file in desk/brand/ drawn from it.
//
//   node desk/brand/build.mjs        writes mark.svg, favicon.svg, avatar.svg and their PNGs
//
// The mark is DD: two D's facing right, each made of two quarter circles. The gaps between the
// quarters are one even width, a cross when the two close. At work the first D turns round, the
// two close into a circle, it turns once and opens again (.dd-spin, desk/page.html).
// The page, the guidelines and their tests import the shapes from here, so there is one drawing.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const R = 11.5;        // the disc's radius, in a 24-unit box
const C = 12;          // the box's centre

// Two cuts of one drawing: four perfect quarter circles, G half of every gap (each quarter's
// corner sits G off the centre). REGULAR is for 48 px and up; SMALL, its gaps wider so they
// survive, for everything at 32 px and below — on the Desk that is everywhere (#215).
export const REGULAR = { G: 0.6 };
export const SMALL = { G: 1.3 };

const f = (n) => +n.toFixed(3);
const pt = ([x, y]) => `${f(x)} ${f(y)}`;
const rot = ([x, y], k) => { for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };

// One quarter, k quarter turns clockwise from top-right; `mirror` turns it about the vertical line
// x = mirror, in the disc's own coordinates (the first D, turned round to face right).
function quarter(cut, k, mirror = null) {
  const { G } = cut, QR = R - G;
  const m = ([x, y]) => [(mirror === null ? x : 2 * mirror - x) + C, y + C];
  const P = (p) => pt(m(rot(p, k)));
  return `M${P([G, -R])}A${f(QR)} ${f(QR)} 0 0 ${mirror === null ? 1 : 0} ${P([R, -G])}L${P([G, -G])}Z`;
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
 * The spinner (.dd-spin): the small mark, simple. At rest DD; the first D turns round and the two
 * close into a circle; the circle turns once; the D turns back and it opens into DD (5 s). The D
 * turns about its own fixed centre line and the circle about the mark's centre (groups moved
 * there), so nothing drifts.
 * The SVG carries its own motion and is the CSS mask of .dd-spin, whose colour is the page's;
 * SPIN_STILL is the mark at rest, for a spinner that waits (.queued). The mark fills SPIN_SIZE.
 */
export const SPIN_SIZE = 0.8;
const LOOP = 5, EASE = "cubic-bezier(.65,0,.35,1)";
const box = f(24 / SPIN_SIZE), pad = f((box - 24) / 2);
const lCx = f(C + leftMid(SMALL)); // the first D's own centre line
const piece = (k) => `<path d="${PIECES_SMALL[k]}"/>`;
const turning = (cx, cls, inner) => `<g transform="translate(${cx} ${C})"><g class="${cls}"><g transform="translate(${-cx} ${-C})">${inner}</g></g></g>`;
const svgOf = (css, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}"><style>g[class]{transform-origin:0 0;transform-box:view-box}${css}</style><g transform="translate(${pad} ${pad})">${body}</g></svg>`;
export const SPIN_SVG = svgOf(
  `.a,.l{animation:${LOOP}s ${EASE} infinite}.a{animation-name:t}.l{animation-name:l}@keyframes t{0%,36%{transform:rotate(0)}62%,100%{transform:rotate(360deg)}}@keyframes l{0%,14%{transform:scaleX(1)}26%,70%{transform:scaleX(-1)}82%,100%{transform:scaleX(1)}}@media (prefers-reduced-motion:reduce){.a,.l{animation-duration:${LOOP * 2}s}}`,
  turning(C, "a", turning(lCx, "l", piece("tl") + piece("bl")) + piece("tr") + piece("br")),
);
const dataUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
export const SPIN_MASK = dataUrl(SPIN_SVG);
export const SPIN_STILL = dataUrl(svgOf("", ORDER.map((k) => `<path d="${PIECES_SMALL[k]}"/>`).join("")));
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
