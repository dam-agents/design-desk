// Exploration marks for #215, round 8, and their sheet.
// At rest the mark is DD: two D's facing right, each cut by half of a soft spark.
// At work the left D flips back, the two close into a disc with the whole spark
// in it, and the disc turns — then it opens back into DD.
import { writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const R = 11.5; // the disc's radius in a 24-unit box centred on 0
const H = 0.6;  // half the gap where a spark arm meets the rim
const K = 1.2;  // how far towards the centre an arm stays an even channel
const f = (n) => +n.toFixed(3);
const pt = ([x, y]) => `${f(x)} ${f(y)}`;
const rot = ([x, y], k) => { for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };

// One quarter of the disc, k quarter turns clockwise from top-right (0 TR, 1 BR, 2 BL, 3 TL).
// mx mirrors the result about x = mx (used to turn the left D round so it faces right).
function quarter(k, mx = null) {
  const m = mx === null ? (p) => p : ([x, y]) => [2 * mx - x, y];
  const P = (p) => pt(m(rot(p, k)));
  const p1 = [H, -Math.sqrt(R * R - H * H)], p2 = [-p1[1], -p1[0]];
  const sweep = mx === null ? 1 : 0;
  return `M${P(p1)}A${R} ${R} 0 0 ${sweep} ${P(p2)}C${P([K, -H])} ${P([H, -K])} ${P(p1)}Z`;
}
const RIM = Math.sqrt(R * R - H * H);
const LEFT_MID = (-RIM + -H) / 2; // the left D's own centre line, which it flips about

// The disc's four quarters at rest, as DD.
const ddRest = { right: [quarter(0), quarter(1)], left: [quarter(2, LEFT_MID), quarter(3, LEFT_MID)] };

// Sharp: round 1's Cut — the Desk's straight-edged spark, waist a, half-gap SH at the rim.
const SA = 2.1, SH = 0.65, SRIM = Math.sqrt(R * R - SH * SH), SMID = (-SRIM - SH) / 2;
function sharpQuarter(k, mx = null) {
  const m = mx === null ? (p) => p : ([x, y]) => [2 * mx - x, y];
  const P = (p) => pt(m(rot(p, k)));
  const p1 = [SH, -SRIM], p2 = [SRIM, -SH];
  return `M${P([SA, -SA])}L${P(p1)}A${R} ${R} 0 0 ${mx === null ? 1 : 0} ${P(p2)}Z`;
}
// Quarters: perfect quarter discs, their corners G off the centre, so every gap is an even channel.
// A spark grows from the centre: the channel runs straight from the rim to `reach` from the
// centre, then curves into the corner (controls at `ctl`). reach <= G is the plain quarter.
const G = 0.6, QR = R - G, QMID = (-G - R) / 2;
function stagedQuarter(k, mx, reach, ctl, shift = [0, 0]) {
  const m = mx === null ? ([x, y]) => [x + shift[0], y + shift[1]] : ([x, y]) => [2 * mx - x, y];
  const P = (p) => pt(m(rot(p, k)));
  const arc = `M${P([G, -R])}A${f(QR)} ${f(QR)} 0 0 ${mx === null ? 1 : 0} ${P([R, -G])}`;
  if (reach <= G) return `${arc}L${P([G, -G])}Z`;
  const toCorner = reach >= R ? "" : `L${P([reach, -G])}`;
  return `${arc}${toCorner}C${P([ctl, -G])} ${P([G, -ctl])} ${P([G, Math.max(-reach, -R)])}Z`;
}
const staged = (reach, ctl) => ({
  right: [stagedQuarter(0, null, reach, ctl), stagedQuarter(1, null, reach, ctl)],
  left: [stagedQuarter(2, QMID, reach, ctl), stagedQuarter(3, QMID, reach, ctl)],
});
const ddQuarters = staged(0, 0);
const ddSharp = { right: [sharpQuarter(0), sharpQuarter(1)], left: [sharpQuarter(2, SMID), sharpQuarter(3, SMID)] };

// Colours: [left D bottom, left D top, right D top, right D bottom], light and dark.
// The Desk's brown is the spinner's colour, --warn.
const BROWN = { light: "#9a6200", dark: "#f0c060" };
const WARM = { light: ["#e79a55", BROWN.light, "#efc46e", "#eea28a"], dark: ["#f2b27a", "#e0a640", "#f6d68f", "#f4b3a2"] };
// Eyes as DAM draws its agents' avatars (api-server-api avatar/svg.ts): round, DAM's pink, closed as an arc when asleep.
const DAM_PINK = "#E89DA8";
const INK = { light: "#1b1b1a", dark: "#1b1b1a" };
const EARTH = { light: ["#d98f6c", BROWN.light, "#a3b98a", "#8fa8c6"], dark: ["#eaa889", "#e0a640", "#b8cf9e", "#a8bedb"] };
const FULLER = { light: ["#d98f6c", BROWN.light, "#82ad68", "#6a90cc"], dark: ["#eaa889", "#e0a640", "#9fcc86", "#8eb1ec"] };
const variants = [
  {
    id: "subtle", name: "Subtle spark", geo: staged(5, 1), ...FULLER,
    note: "The mark: four quarter circles whose gaps open into a small spark at the centre. Clay, the Desk's brown, green and blue.",
  },
];

// The spinner: the same two D's in one colour, four tones. One D shape serves both halves
// (the left D at rest is the right one, moved); each D is a CSS mask, its two tones a gradient.
const D_SHAPE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(R - G)} ${f(2 * R)}">${[0, 1]
  .map((k) => `<path d="${stagedQuarter(k, null, 5, 1, [-G, R])}"/>`).join("")}</svg>`;
const D_URI = `url("data:image/svg+xml,${encodeURIComponent(D_SHAPE).replace(/'/g, "%27")}")`;
const pc = (n) => `${f((n / 24) * 100)}%`;
export const SPIN_CSS = `
  .dd-spin { position: relative; display: inline-block; width: 1.25em; height: 1.25em; flex: none; vertical-align: -0.25em; color: var(--warn); animation: dd-spin-turn 5s cubic-bezier(.65,0,.35,1) infinite; }
  .dd-spin::before, .dd-spin::after { content: ""; position: absolute; top: ${pc(12 - R)}; width: ${pc(R - G)}; height: ${pc(2 * R)}; -webkit-mask: ${D_URI} center / 100% 100% no-repeat; mask: ${D_URI} center / 100% 100% no-repeat; }
  .dd-spin::before { left: ${pc(12 - R)}; background: linear-gradient(currentColor 50%, color-mix(in srgb, currentColor 62%, transparent) 50%); animation: dd-spin-left 5s cubic-bezier(.65,0,.35,1) infinite; }
  .dd-spin::after { left: ${pc(12 + G)}; background: linear-gradient(color-mix(in srgb, currentColor 45%, transparent) 50%, color-mix(in srgb, currentColor 80%, transparent) 50%); }
  .dd-spin.queued, .dd-spin.queued::before { animation: none; }
  .dd-spin.queued { opacity: .5; }
  .dd-spin.light { color: var(--bg); }
  @keyframes dd-spin-turn { 0%, 36% { transform: rotate(0); } 62%, 100% { transform: rotate(360deg); } }
  @keyframes dd-spin-left { 0%, 14% { transform: scaleX(1); } 26%, 70% { transform: scaleX(-1); } 82%, 100% { transform: scaleX(1); } }
  @media (prefers-reduced-motion: reduce) { .dd-spin, .dd-spin::before { animation-duration: 10s; } }`;

// Peek: the DD shrinks and drops to leave DAM's eye line above it (eye r .072, spacing .2, line .2 of the box).
const PEEK = { s: 0.66, dy: 3.8, r: 1.72, dx: 2.42, cy: -7.2 };
// Face: one eye on each D's top piece, towards its round front.
const FACE = { r: 1.45, left: [-4.6, -4.4], right: [6.9, -4.4] };
const eye = ([cx, cy], r, fill, mood, stroke) => mood === "awake"
  ? `<circle class="eye" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"/>`
  : `<path class="eye" d="M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 0 0 ${f(cx + r)} ${f(cy)}" fill="none" stroke="${fill}" stroke-width="${f(stroke)}" stroke-linecap="round"/>`;

const svg = (v, colors, mono = false, mood = "awake", mode = "light") => {
  const g = v.geo, c = (i) => (mono ? "currentColor" : colors[i]);
  const faceEye = (at) => v.eyes === "face" ? eye(at, FACE.r, mono ? "var(--eye-mono, #fcfbfc)" : INK[mode], mood, 0.9) : "";
  const L = g.left.map((d, i) => `<path class="q l${i}" d="${d}" fill="${c(i)}"/>`).join("") + faceEye(FACE.left);
  const Rt = g.right.map((d, i) => `<path class="q r${i}" d="${d}" fill="${c(2 + i)}"/>`).join("") + faceEye(FACE.right);
  let body = `<g class="body"><g class="ld">${L}</g><g class="rd">${Rt}</g></g>`;
  if (v.eyes === "peek") {
    const fill = mono ? "currentColor" : DAM_PINK;
    body = `<g transform="translate(0 ${PEEK.dy}) scale(${PEEK.s})">${body}</g><g class="eyes">${
      eye([-PEEK.dx, PEEK.cy], PEEK.r, fill, mood, 1.1)}${eye([PEEK.dx, PEEK.cy], PEEK.r, fill, mood, 1.1)}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24">${body}</svg>`;
};
// The mark file: colours that follow the scheme, as favicon.svg would.
const markFile = (v) => {
  const css = (pal) => pal.map((c, i) => `.p${i}{fill:${c}}`).join("");
  let i = 0;
  const body = svg(v, v.light).replace(/<path class="q [lr]\d" d="([^"]+)" fill="[^"]+"\/>/g, (_, d) => `<path class="p${i++}" d="${d}"/>`)
    .replace('viewBox="-12 -12 24 24">', `viewBox="-12 -12 24 24"><style>${css(v.light)}@media (prefers-color-scheme:dark){${css(v.dark)}}</style>`);
  return body + "\n";
};
for (const name of readdirSync(OUT)) if (/^mark-.*\.svg$/.test(name)) rmSync(join(OUT, name));
for (const v of variants) writeFileSync(join(OUT, `mark-${v.id}.svg`), markFile(v));

const SIZES = [16, 24, 32, 48];
const tile = (v, mode) => `<div class="mode ${mode}">
    <div class="sizes">${SIZES.map((s) => `<figure><div style="width:${s}px;height:${s}px">${svg(v, v[mode], false, "awake", mode)}</div><figcaption>${s}</figcaption></figure>`).join("")}
      <figure><div style="width:24px;height:24px">${svg(v, v[mode], true)}</div><figcaption>one colour</figcaption></figure>
      <figure><div class="spin close" style="width:24px;height:24px">${svg(v, v[mode], false, "awake", mode)}</div><figcaption>at work</figcaption></figure>${v.eyes ? `<figure><div style="width:24px;height:24px">${svg(v, v[mode], false, "asleep", mode)}</div><figcaption>asleep</figcaption></figure>` : ""}
    </div>
    <div class="ctx">
      <div class="tab"><span class="fav">${svg(v, v[mode], false, "awake", mode)}</span>Design Desk</div>
      <div class="msg"><span class="av">${svg(v, v[mode], false, "awake", mode)}</span><div><b>Design Desk</b><p>Option 2 drops the second button; the spec keeps one primary action per dialog.</p></div></div>
      <div class="gh"><span class="ghm">${svg(v, v[mode], false, "awake", mode)}</span><b>Design Desk</b> · reviewed this change</div>
    </div>
  </div>`;

const spinRow = () => `<div class="sizes">${[13, 16, 20, 26, 40].map((px) => `<figure><span style="font-size:${px}px;line-height:1"><span class="dd-spin"></span></span><figcaption>${px} px text</figcaption></figure>`).join("")}
  <figure><span style="font-size:16px"><span class="dd-spin queued"></span></span><figcaption>queued</figcaption></figure>
  <figure><span class="pinn"><span class="dd-spin light"></span></span><figcaption>.light, on a pin</figcaption></figure>
  <figure><span style="font-size:40px;line-height:1"><span class="dd-spin still"></span></span><figcaption>at rest</figcaption></figure></div>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Design Desk mark — round 8</title>
<style>
  :root { --bg:#fcfbfc; --ink:#1b1b1a; --muted:#6b6b66; --line:#e4e3df; --dbg:#151514; --dink:#ecebe7; --dline:#33332f; }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.45 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--ink); }
  header { padding: 32px 40px 8px; } h1 { font-size: 22px; margin: 0 0 6px; } header p { color: var(--muted); margin: 0 0 6px; max-width: 80ch; }
  section { display:grid; grid-template-columns: 300px 1fr; gap: 28px; padding: 28px 40px; border-top: 1px solid var(--line); align-items: start; }
  .hero h2 { margin: 0; font-size: 18px; } .hero h2 small { color: var(--muted); font-weight: 400; font-size: 13px; margin-left: 6px; }
  .hero .pair { display:flex; gap: 20px; align-items:center; margin: 10px 0 14px; }
  .hero .big { width: 200px; height: 200px; } .hero .bigspin { width: 72px; height: 72px; }
  .hero p { color: var(--muted); margin: 6px 0 0; }
  .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .mode { border-radius: 12px; padding: 18px; border: 1px solid var(--line); }
  .mode.light { background: var(--bg); color: var(--ink); } .mode.dark { background: var(--dbg); color: var(--dink); border-color: var(--dline); }
  .sizes { display:flex; align-items:flex-end; gap: 20px; } figure { margin:0; display:flex; flex-direction:column; align-items:center; gap:6px; }
  figcaption { font-size: 11px; opacity: .6; white-space: nowrap; } svg { display:block; width:100%; height:100%; overflow: visible; }
  .ctx { margin-top: 18px; display: grid; gap: 10px; font-size: 13px; }
  .tab { display:inline-flex; align-items:center; gap:8px; padding: 6px 12px; border-radius: 8px 8px 0 0; background: rgba(127,127,127,.12); width: fit-content; }
  .fav { width:16px; height:16px; } .msg { display:flex; gap:10px; } .msg p { margin: 2px 0 0; opacity: .8; }
  .av { width: 28px; height: 28px; flex:none; border-radius: 50%; padding: 5px; background: rgba(127,127,127,.12); }
  .gh { display:flex; align-items:center; gap:6px; } .ghm { width:16px; height:16px; }
  .avatars { display:flex; gap: 14px; margin-top: 16px; align-items:center; }
  .avatar { width: 72px; height: 72px; border-radius: 50%; display:grid; place-items:center; } .avatar > div { width: 44px; height: 44px; }
  .avatar.sm { width: 32px; height: 32px; } .avatar.sm > div { width: 19px; height: 19px; }
  .spin g { transform-box: fill-box; transform-origin: center; }
  /* close: DD opens into the disc, the disc turns, and it opens back into DD */
  .spin.close .body { animation: close-turn 5s cubic-bezier(.65,0,.35,1) infinite; }
  .spin.close .ld { animation: close-left 5s cubic-bezier(.65,0,.35,1) infinite; }
  @keyframes close-left { 0%, 14% { transform: scaleX(1); } 26%, 70% { transform: scaleX(-1); } 82%, 100% { transform: scaleX(1); } }
  @keyframes close-turn { 0%, 36% { transform: rotate(0); } 62%, 100% { transform: rotate(360deg); } }
  .spin.close .eyes { animation: glance 5s ease-in-out infinite; }
  @keyframes glance { 0%, 20% { transform: translateX(0); } 30%, 45% { transform: translateX(-1.2px); } 55%, 70% { transform: translateX(1.2px); } 80%, 100% { transform: translateX(0); } }
  /* flip: as .dd-spin today */
  .spin.flip svg { animation: flip-turn 5s cubic-bezier(.65,0,.35,1) infinite; }
  .spin.flip .ld { animation: flip-left 5s cubic-bezier(.65,0,.35,1) infinite; }
  .spin.flip .rd { animation: flip-right 5s cubic-bezier(.65,0,.35,1) infinite; }
  @keyframes flip-turn { 0%, 72% { transform: rotate(0); } 94%, 100% { transform: rotate(360deg); } }
  @keyframes flip-left { 0%, 12% { transform: scaleX(1); } 20%, 34% { transform: scaleX(-1); } 42%, 100% { transform: scaleX(1); } }
  @keyframes flip-right { 0%, 40% { transform: scaleX(1); } 48%, 58% { transform: scaleX(-1); } 66%, 100% { transform: scaleX(1); } }
  @media (prefers-reduced-motion: reduce) { .spin svg, .spin g { animation-duration: 10s !important; } }
${SPIN_CSS}
  .dd-spin.still, .dd-spin.still::before { animation: none; }
  .pinn { display:inline-grid; place-items:center; width: 22px; height: 22px; border-radius: 50%; background: var(--warn); font-size: 13px; }
</style></head><body>
<header><h1>Design Desk mark — round 8</h1>
<p>At rest the mark is <b>DD</b>: two D's facing right, each split in two. At work the first D turns round, the two close into a disc, the disc turns once, and it opens back into DD. The big animated mark beside each one shows it; so does "at work" in each row.</p>
<p>Round 8: the chosen mark, Subtle spark, and the spinner drawn from it in one colour, four tones. Shown at 16, 24, 32 and 48 px on the Desk's light and dark background, in a browser tab, as the agent's avatar in a thread, and on a GitHub comment line.</p></header>
<section class="spinner"><div class="hero"><h2>Spinner <small>.dd-spin</small></h2>
  <p>The same DD in one colour, four tones — the spinner's own colour (<code>--warn</code>) at full, 80, 62 and 45 per cent. It rests as the mark does, closes into the disc and turns. <code>.light</code> and <code>.queued</code> work as today.</p></div>
  <div class="modes"><div class="mode light" style="--warn:#9a6200;--bg:#fcfbfc">${spinRow()}</div><div class="mode dark" style="--warn:#f0c060;--bg:#151514">${spinRow()}</div></div>
</section>
${variants.map((v, i) => `<section>
  <div class="hero"><h2>${i + 1}. ${v.name}<small>mark-${v.id}.svg</small></h2>
    <div class="pair"><div class="big">${svg(v, v.light)}</div><div class="bigspin spin close">${svg(v, v.light)}</div></div>
    <p>${v.note}</p>
    <div class="avatars"><div class="avatar" style="background:#fff;box-shadow:0 0 0 1px #e4e3df"><div>${svg(v, v.light)}</div></div><div class="avatar" style="background:#1b1b1a"><div>${svg(v, v.dark, false, "awake", "dark")}</div></div>${v.eyes ? `<div class="avatar" style="background:#1b1b1a"><div>${svg(v, v.dark, false, "asleep", "dark")}</div></div>` : ""}<div class="avatar sm" style="background:#1b1b1a"><div>${svg(v, v.dark, false, "awake", "dark")}</div></div></div>
  </div>
  <div class="modes">${tile(v, "light")}${tile(v, "dark")}</div>
</section>`).join("\n")}
</body></html>
`;
writeFileSync(join(OUT, "sheet.html"), html);
console.log("wrote", variants.map((v) => `mark-${v.id}.svg`).join(", "), "and sheet.html");
