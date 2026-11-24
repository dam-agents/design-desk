// Design Desk's mark (#215): its geometry, and every file in desk/brand/ drawn from it.
//
//   node desk/brand/build.mjs        writes mark.svg, favicon.svg, avatar.svg and their PNGs
//
// The mark is DD: two D's facing right, each made of two quarter circles. The gaps between the
// quarters run straight from the rim and open into a small spark at the centre. At work the
// first D turns round, the two close into a disc and the disc turns (.dd-spin, desk/page.html).
// The page, the guidelines and their tests import the shapes from here, so there is one drawing.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const R = 11.5;        // the disc's radius, in a 24-unit box
const G = 0.6;         // half of every gap: each quarter's corner sits G off the centre
const QR = R - G;      // each quarter is a perfect quarter circle of this radius
const REACH = 5;       // from here inwards a gap opens into the spark…
const CTL = 1;         // …along a curve with its controls this far out
const C = 12;          // the box's centre

const f = (n) => +n.toFixed(3);
const pt = ([x, y]) => `${f(x)} ${f(y)}`;
const rot = ([x, y], k) => { for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };

// One quarter, k quarter turns clockwise from top-right, moved by `at`; `mirror` turns it about
// the vertical line x = mirror, in the disc's own coordinates (the first D, turned round).
function quarter(k, { at = [C, C], mirror = null } = {}) {
  const m = ([x, y]) => [(mirror === null ? x : 2 * mirror - x) + at[0], y + at[1]];
  const P = (p) => pt(m(rot(p, k)));
  const sweep = mirror === null ? 1 : 0;
  return `M${P([G, -R])}A${f(QR)} ${f(QR)} 0 0 ${sweep} ${P([R, -G])}L${P([REACH, -G])}C${P([CTL, -G])} ${P([G, -CTL])} ${P([G, -REACH])}Z`;
}

// The first D's own centre line, about which it turns round (in the disc's coordinates).
const LEFT_MID = (-R - G) / 2;

/** The mark's four pieces, in a 0 0 24 24 box: first D top and bottom, second D top and bottom. */
export const PIECES = {
  tl: quarter(3, { mirror: LEFT_MID }),
  bl: quarter(2, { mirror: LEFT_MID }),
  tr: quarter(0),
  br: quarter(1),
};

/** Its colours: one per piece, light and dark. The first D's top is the Desk's brown (--warn). */
export const COLORS = {
  light: { tl: "#9a6200", bl: "#d98f6c", tr: "#82ad68", br: "#6a90cc" },
  dark: { tl: "#e0a640", bl: "#eaa889", tr: "#9fcc86", br: "#8eb1ec" },
};

const ORDER = ["tl", "bl", "tr", "br"]; // classes mk-tl…: the page styles them by its own light and dark colours
const paths = (fill) => ORDER.map((k) => `<path class="mk-${k}" d="${PIECES[k]}"${fill ? ` fill="${fill(k)}"` : ""}/>`).join("");
const schemeCss = () => {
  const css = (c) => ORDER.map((k) => `.mk-${k}{fill:${c[k]}}`).join("");
  return `<style>${css(COLORS.light)}@media (prefers-color-scheme:dark){${css(COLORS.dark)}}</style>`;
};

/** mark.svg: the mark alone, its colours following the reader's light or dark mode. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${schemeCss()}${paths()}</svg>\n`;

/** The mark in fixed colours, for the PNGs. */
export const markIn = (mode) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths((k) => COLORS[mode][k])}</svg>\n`;

/** avatar.svg: the mark on its ink circle, in its dark-mode colours, as the agent's avatar. */
const AV = 0.64; // the mark's share of the circle
export const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1b1b1a"/><g transform="translate(${f(C - C * AV)} ${f(C - C * AV)}) scale(${AV})">${paths((k) => COLORS.dark[k])}</g></svg>\n`;

/**
 * The spinner's D: the second D's two quarters alone, in their own box. Both halves of .dd-spin
 * wear it as a mask — the first D at rest is the second one moved — and the CSS flips the first.
 */
export const D_SHAPE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(R - G)} ${f(2 * R)}">${[0, 1].map((k) => `<path d="${quarter(k, { at: [-G, R] })}"/>`).join("")}</svg>`;
export const D_MASK = `url("data:image/svg+xml,${encodeURIComponent(D_SHAPE)}")`;

/** Where the D's sit in the spinner's box, in per cent, at SPIN of its size. */
export const SPIN = 0.72;
const pc = (n) => `${f(n)}%`;
export const SPIN_BOX = {
  top: pc(50 - (SPIN * R / 24) * 100),
  width: pc((SPIN * (R - G) / 24) * 100),
  height: pc((SPIN * 2 * R / 24) * 100),
  left: pc(50 - (SPIN * R / 24) * 100),
  right: pc(50 + (SPIN * G / 24) * 100),
};

/** The mark as the page and the guidelines draw it inline: classes only, their colours from CSS. */
export const MARK_INLINE = `<svg class="dd-mark" viewBox="0 0 24 24" aria-hidden="true">${paths()}</svg>`;

/** The spinner's D mask in a JS string's single quotes (the prototype overlay's own copy). */
export const D_MASK_SQ = D_MASK.replace(/"/g, "'");

/** The favicon, as a data: URL the page and the guidelines link to (the page is one file). */
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
