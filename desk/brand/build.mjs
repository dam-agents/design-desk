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
 * The spinner (.dd-spin): the small mark, calm and slow. Four phrases of eight beats (SPIN_BEAT s
 * each): the first D turns round and the two close into a circle; it holds; the circle turns a
 * quarter; it holds; the D turns back and it opens into DD, a quarter on from where it began; three
 * beats of rest. After the four it stands as it began. Every turn pivots on a fixed point (a group
 * moved there, so the browser never measures a box mid-motion and nothing drifts).
 * SPIN_BOUNCE is the other one, to compare: the upper pieces rise and fall one after the other,
 * then the lower ones dip and come back, like jumping dots.
 * The SVG carries its own motion and is the CSS mask of .dd-spin, whose colour is the page's;
 * SPIN_STILL is the mark at rest, for a spinner that waits (.queued). The mark fills SPIN_SIZE.
 */
export const SPIN_BEAT = 0.8;
export const SPIN_SIZE = 0.8;
const PHRASE = 8, BEATS = 4 * PHRASE, MOVE = 0.65; // a move takes 0.65 s of its beat
const at = (beat) => f((beat * 100) / BEATS), end = (beat) => f(((beat + MOVE / SPIN_BEAT) * 100) / BEATS);
const LOOP = f(BEATS * SPIN_BEAT), EASE = "cubic-bezier(.65,0,.35,1)";
// The first D closes on beat 0 of each phrase and opens on beat 4; the circle turns on beat 2.
const closeKeys = [0, 1, 2, 3].map((p) => `${at(PHRASE * p)}%{transform:scaleX(1)}${end(PHRASE * p)}%,${at(PHRASE * p + 4)}%{transform:scaleX(-1)}${end(PHRASE * p + 4)}%{transform:scaleX(1)}`).join("");
const turnKeys = [0, 1, 2, 3].map((p) => `${at(PHRASE * p + 2)}%{transform:rotate(${90 * p}deg)}${end(PHRASE * p + 2)}%{transform:rotate(${90 * (p + 1)}deg)}`).join("");
const box = f(24 / SPIN_SIZE), pad = f((box - 24) / 2), mid = f(box / 2);
const lCx = f(C + leftMid(SMALL)); // the first D's own centre line
const piecesOfD = (ks) => ks.map((k) => `<path d="${PIECES_SMALL[k]}"/>`).join("");
// A group pivots on its own origin: move it to the pivot, turn it, move its drawing back.
const pivot = (x, y, cls, inner) => `<g transform="translate(${x} ${y})"><g class="${cls}"><g transform="translate(${-x} ${-y})">${inner}</g></g></g>`;
const svgOf = (css, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}"><style>g[class]{transform-origin:0 0;transform-box:view-box}${css}</style><g transform="translate(${pad} ${pad})">${body}</g></svg>`;
export const SPIN_SVG = svgOf(
  `.a,.l{animation:${LOOP}s ${EASE} infinite}.a{animation-name:t}.l{animation-name:l}@keyframes t{0%{transform:rotate(0)}${turnKeys}100%{transform:rotate(360deg)}}@keyframes l{0%{transform:scaleX(1)}${closeKeys}100%{transform:scaleX(1)}}@media (prefers-reduced-motion:reduce){.a,.l{animation-duration:${f(LOOP * 2)}s}}`,
  pivot(C, C, "a", pivot(lCx, C, "l", piecesOfD(["tl", "bl"])) + piecesOfD(["tr", "br"])),
);
// Bounce: 2.4 s; top left rises, then top right; bottom left dips, then bottom right; a rest.
const BOUNCE = 2.4, LIFT = 2.2;
const bounce = (start, dir) => { const s0 = f(start), up = f(start + 12), back = f(start + 26); return `0%,${s0}%{transform:translateY(0)}${up}%{transform:translateY(${f(dir * LIFT)}px)}${back}%,100%{transform:translateY(0)}`; };
export const SPIN_BOUNCE = svgOf(
  `.p{animation:${BOUNCE}s cubic-bezier(.45,0,.55,1) infinite}${[["tl", 0, -1], ["tr", 12, -1], ["bl", 36, 1], ["br", 48, 1]].map(([k, s0, d]) => `.${k}{animation-name:${k}}@keyframes ${k}{${bounce(s0, d)}}`).join("")}@media (prefers-reduced-motion:reduce){.p{animation-duration:${f(BOUNCE * 2)}s}}`,
  ORDER.map((k) => `<path class="p ${k}" d="${PIECES_SMALL[k]}"/>`).join(""),
);
const dataUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
export const SPIN_MASK = dataUrl(SPIN_SVG);
export const SPIN_BOUNCE_MASK = dataUrl(SPIN_BOUNCE);
export const SPIN_STILL = dataUrl(svgOf("", piecesOfD(ORDER)));
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
