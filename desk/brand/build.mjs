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
 * The spinner (.dd-spin): the small mark in its own colours, simple, in two halves. First half: the
 * first D turns round and the two close into a circle; the circle turns once (2 s); the second D
 * turns round and opens it — the D's now face left. Second half: the second D turns back and closes
 * the circle; it turns once more; the first D turns back and opens it into DD. Each D turns about
 * its own fixed centre line and the circle about the mark's centre (groups moved there), so
 * nothing drifts. The SVG carries its own motion.
 * SPIN_COLOR draws it in the mark's colours (light and dark mode), SPIN_MASK in one colour for a
 * CSS mask (white on a comment pin); the *_STILL ones rest, for a spinner that waits (.queued).
 * The mark fills SPIN_SIZE of the box.
 */
export const SPIN_SIZE = 0.8;
const FLIP = 0.6, TURN = 2, HALF = 4.7, LOOP = f(2 * HALF);
// Each half, in seconds from its start: a D closes, the circle turns, the other D opens.
const H = { close: 0.5, turn: 1.4, open: 3.8 };
const EASE = "cubic-bezier(.65,0,.35,1)", pc = (sec) => f((sec * 100) / LOOP);
const box = f(24 / SPIN_SIZE), pad = f((box - 24) / 2);
const lCx = f(C + leftMid(SMALL)), rCx = f(2 * C - lCx); // each D's own centre line
// The first D turns round as the first half closes and back as the second half opens; the second D
// turns round as the first half opens and back as the second half closes.
const flipKeys = (out, back) => `0%,${pc(out)}%{transform:scaleX(1)}${pc(out + FLIP)}%,${pc(back)}%{transform:scaleX(-1)}${pc(back + FLIP)}%,100%{transform:scaleX(1)}`;
const turnKeys = `0%,${pc(H.turn)}%{transform:rotate(0)}${pc(H.turn + TURN)}%,${pc(HALF + H.turn)}%{transform:rotate(360deg)}${pc(HALF + H.turn + TURN)}%,100%{transform:rotate(720deg)}`;
const SPIN_CSS = `.a,.l,.r{animation:${LOOP}s ${EASE} infinite}.a{animation-name:t}.l{animation-name:l}.r{animation-name:r}@keyframes t{${turnKeys}}@keyframes l{${flipKeys(H.close, HALF + H.open)}}@keyframes r{${flipKeys(H.open, HALF + H.close)}}@media (prefers-reduced-motion:reduce){.a,.l,.r{animation-duration:${f(LOOP * 2)}s}}`;
const piece = (k, mode) => `<path d="${PIECES_SMALL[k]}"${mode ? ` fill="${COLORS[mode][k]}"` : ""}/>`;
const turning = (cx, cls, inner) => `<g transform="translate(${cx} ${C})"><g class="${cls}"><g transform="translate(${-cx} ${-C})">${inner}</g></g></g>`;
const svgOf = (css, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}"><style>g[class]{transform-origin:0 0;transform-box:view-box}${css}</style><g transform="translate(${pad} ${pad})">${body}</g></svg>`;
// mode "light" or "dark": the mark's colours; none: one colour, for a mask.
const spinIn = (mode) => svgOf(SPIN_CSS, turning(C, "a", turning(lCx, "l", piece("tl", mode) + piece("bl", mode)) + turning(rCx, "r", piece("tr", mode) + piece("br", mode))));
const stillIn = (mode) => svgOf("", ORDER.map((k) => piece(k, mode)).join(""));
export const SPIN_SVG = spinIn();
const dataUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
export const SPIN_MASK = dataUrl(SPIN_SVG);
export const SPIN_STILL = dataUrl(stillIn());
export const SPIN_COLOR = { light: dataUrl(spinIn("light")), dark: dataUrl(spinIn("dark")) };
export const SPIN_COLOR_STILL = { light: dataUrl(stillIn("light")), dark: dataUrl(stillIn("dark")) };
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
