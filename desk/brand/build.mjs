// Design Desk's mark (#215): its geometry, and every file in desk/brand/ drawn from it.
//
//   node desk/brand/build.mjs        writes mark.svg, favicon.svg, avatar.svg, app.svg and their PNGs
//
// The mark is a disc with DD on it: two D's, a spark cut out of the second so the disc shows
// through (the operator's drawing, dd-light.svg), the disc in DAM's avatar orange, the D's white,
// in light and dark mode alike, as DAM's avatars are. The page, the guidelines and their tests import the shapes
// from here, so there is one drawing.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// In a 48-unit box: the disc fills it; the D's sit at 0.74 about its centre.
const BOX = 48, C = 24, SCALE = 0.74;
/** The two D's, the spark cut from the second (filled even-odd). */
export const D1_PATH = "M4 14H12A10 10 0 0 1 12 34H4Z";
export const D2_PATH = "M26 14H34A10 10 0 0 1 34 34H26Z M33 18Q33.45 23.55 39 24Q33.45 24.45 33 30Q32.55 24.45 27 24Q32.55 23.55 33 18Z";
export const D_PATH = `${D1_PATH} ${D2_PATH}`;
const f = (n) => +n.toFixed(3);
// Above 128 px the spark is thinner: the operator's first, finest spark (rays curving almost to
// its centre), a touch fuller. Only the app icon is that large; every other use takes D2_PATH.
const sparkFine = (cx, cy, ry, rl, rr, t) => {
  const c = (sx, sy) => `${f(cx + sx * t)} ${f(cy + sy * t)}`;
  return `M${cx} ${f(cy - ry)}C${c(1, -1)} ${c(1, -1)} ${f(cx + rr)} ${cy}C${c(1, 1)} ${c(1, 1)} ${cx} ${f(cy + ry)}`
    + `C${c(-1, 1)} ${c(-1, 1)} ${f(cx - rl)} ${cy}C${c(-1, -1)} ${c(-1, -1)} ${cx} ${f(cy - ry)}Z`;
};
export const D2_LARGE_PATH = `M26 14H34A10 10 0 0 1 34 34H26Z ${sparkFine(33.5, 24, 7.5, 7, 7.5, 0.35)}`;
export const D_LARGE_PATH = `${D1_PATH} ${D2_LARGE_PATH}`;

/** Its colours, light and dark mode: the disc and the D's. Finalised here (#215). */
export const COLORS = {
  light: { disc: "#de9950", d: "#ffffff" }, // DAM's avatar orange
  dark: { disc: "#de9950", d: "#ffffff" },
};

// The drawing: fixed colours for a mode, or classes (mk-disc, mk-d) for the page's CSS.
const drawing = (mode) => `<circle cx="${C}" cy="${C}" r="${C}" ${mode ? `fill="${COLORS[mode].disc}"` : `class="mk-disc"`}/>`
  + `<path transform="translate(${C} ${C}) scale(${SCALE}) translate(${-C} ${-C})" fill-rule="evenodd" d="${D_PATH}" ${mode ? `fill="${COLORS[mode].d}"` : `class="mk-d"`}/>`;
const schemeCss = () => {
  const css = (c) => `.mk-disc{fill:${c.disc}}.mk-d{fill:${c.d}}`;
  return `<style>${css(COLORS.light)}@media (prefers-color-scheme:dark){${css(COLORS.dark)}}</style>`;
};
const svg = (inner, attrs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}"${attrs}>${inner}</svg>`;

/** mark.svg: the mark, its colours following the reader's light or dark mode. */
export const MARK_SVG = svg(schemeCss() + drawing()) + "\n";

/** The mark in fixed colours, for the PNGs and the avatar. */
export const markIn = (mode) => svg(drawing(mode)) + "\n";

/** avatar.svg: the agent's avatar is the mark itself, in its light colours. */
export const AVATAR_SVG = markIn("light");

/**
 * app.svg: the large version, a macOS app icon. On macOS's icon grid (a 1024 canvas, the body 824
 * with macOS's continuous corner, a margin around it), the disc becomes a rounded square and the D's keep
 * their share of it. The circle stays wherever the mark is small (avatars, favicon, GitHub).
 */
const APP = { canvas: 1024, body: 824 };
export const APP_SVG = (() => {
  const k = BOX / APP.canvas, body = APP.body * k, sc = f(SCALE * (body / BOX));
  // macOS's corner is no circle's quarter but a continuous curve: a superellipse, |x|^5 + |y|^5 = 1.
  const h = body / 2, pts = Array.from({ length: 240 }, (_, i) => {
    const t = (i / 240) * 2 * Math.PI, c = Math.cos(t), sn = Math.sin(t);
    return `${f(C + h * Math.sign(c) * Math.abs(c) ** 0.4)} ${f(C + h * Math.sign(sn) * Math.abs(sn) ** 0.4)}`;
  });
  return svg(`<path d="M${pts.join("L")}Z" fill="${COLORS.light.disc}"/>`
    + `<path transform="translate(${C} ${C}) scale(${sc}) translate(${-C} ${-C})" fill-rule="evenodd" d="${D_LARGE_PATH}" fill="${COLORS.light.d}"/>`) + "\n";
})();

/** The mark as the page draws it inline: classes only, its colours from the page's CSS. */
export const MARK_INLINE = `<svg class="dd-mark" viewBox="0 0 ${BOX} ${BOX}" aria-hidden="true">${drawing()}</svg>`;

/** The favicon, as a data: URL the page links to (the page is one file). */
export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(MARK_SVG.trim())}`;

async function build() {
  const out = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(out, "mark.svg"), MARK_SVG);
  writeFileSync(join(out, "favicon.svg"), MARK_SVG);
  writeFileSync(join(out, "avatar.svg"), AVATAR_SVG);
  writeFileSync(join(out, "app.svg"), APP_SVG);
  const { launch } = await import("../../toolkit/lib/core.mjs");
  const browser = await launch();
  const page = await browser.newPage();
  const png = async (svg, px, file) => {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
    await page.screenshot({ path: join(out, file), omitBackground: true });
  };
  await png(AVATAR_SVG, 512, "avatar.png");
  await png(APP_SVG, 1024, "app.png");
  await png(markIn("light"), 32, "favicon-32.png");
  await png(markIn("light"), 64, "mark.png"); // GitHub comments show it at 16 px: four pixels to each
  await browser.close();
  console.log("wrote mark.svg, favicon.svg, avatar.svg, app.svg, avatar.png, app.png, favicon-32.png, mark.png");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await build();
