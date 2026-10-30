// design deck-pdf <deck.html> <out.pdf>   one 1920×1080 page per slide
// design deck-check <deck.html>           the slides skill's mechanical checks
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLKIT, fail, launch } from "../lib/core.mjs";
import { resolveStyle, fontCss } from "../lib/style.mjs";
import { palette } from "../lib/theme.mjs";

// The template's palette is Carbon's. A brand swaps the accent family and the fonts;
// greys stay, because they carry the hierarchy and a brand rarely defines five of them.
const CARBON = { accent: "#0f62fe", accentMuted: "#a6c8ff", accentOnDark: "#78a9ff", accentSoft: "#d0e2ff" };
const mixHex = (a, b, t) => "#" + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - t) + parseInt(b.slice(1 + i, 3 + i), 16) * t).toString(16).padStart(2, "0")).join("");

export function themeDeck(html, style) {
  html = html.replace("<!-- design:fonts -->", `<style>${fontCss(style)}</style>`);
  if (style.kind !== "brand") return html;
  const p = palette(style.brand), a = p.accent;
  const swap = { [CARBON.accent]: a, [CARBON.accentMuted]: mixHex(a, "#ffffff", 0.6), [CARBON.accentOnDark]: mixHex(a, "#ffffff", 0.35), [CARBON.accentSoft]: mixHex(a, "#ffffff", 0.8) };
  for (const [from, to] of Object.entries(swap)) html = html.replace(new RegExp(from, "gi"), to);
  if (p.sans !== "IBM Plex Sans") html = html.replace(/'IBM Plex Sans'/g, `'${p.sans}'`);
  if (p.mono !== "IBM Plex Mono") html = html.replace(/'IBM Plex Mono'/g, `'${p.mono}'`);
  return html;
}

export async function main(cmd, [deck, out, ...rest]) {
  if (cmd === "deck-new") {
    if (!deck) fail("usage: design deck-new <deck.html> [--style brand|carbon]");
    const args = [out, ...rest].filter((x) => x !== undefined);
    const i = args.indexOf("--style");
    const style = resolveStyle(i >= 0 ? args[i + 1] : undefined);
    writeFileSync(deck, themeDeck(readFileSync(join(TOOLKIT, "templates/deck.html"), "utf8"), style.kind === "repo" ? { kind: "carbon" } : style));
    console.log(JSON.stringify({ deck: resolve(deck), style: style.label }));
    return;
  }
  if (!deck) fail(`usage: design ${cmd} <deck.html>${cmd === "deck-pdf" ? " <out.pdf>" : ""}`);
  if (cmd === "deck-check") return check(deck);
  if (!out) fail("usage: design deck-pdf <deck.html> <out.pdf>");
  const browser = await launch();
  const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await pg.goto(pathToFileURL(resolve(deck)).href);
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(300);
  await pg.pdf({ path: out, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(JSON.stringify({ pdf: resolve(out) }));
}

async function check(deck) {
  const html = readFileSync(deck, "utf8");
  const problems = [];
  const sections = [...html.matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
  sections.forEach((s, i) => { if (/style="[^"]*\bdisplay\s*:/.test(s)) problems.push(`slide ${i + 1}: a <section> carries display: — put the layout on an inner div`); });
  const small = [...new Set([...html.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n < 24))];
  if (small.length) problems.push(`font-size under 24px: ${small.sort((a, b) => a - b).join(", ")}px`);
  if (/fonts\.googleapis|fonts\.gstatic/.test(html)) problems.push("loads fonts from Google — inline them (`<!-- design:fonts -->`) so the deck works offline");
  // Rendered checks: nothing overflows its 1080px slide.
  const browser = await launch();
  const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await pg.goto(pathToFileURL(resolve(deck)).href);
  await pg.evaluate(() => document.fonts.ready);
  const over = await pg.evaluate(() => [...document.querySelectorAll("#stage > section")].map((s, i) => {
    s.setAttribute("data-active", ""); const r = s.getBoundingClientRect();
    const bad = [...s.querySelectorAll("*")].some((e) => { const b = e.getBoundingClientRect(); return b.height && (b.bottom > r.bottom + 1 || b.right > r.right + 1); });
    s.removeAttribute("data-active"); return bad ? i + 1 : 0;
  }).filter(Boolean));
  await browser.close();
  if (over.length) problems.push(`content runs past the slide edge on slide(s) ${over.join(", ")} — cut content, never shrink type`);
  console.log(JSON.stringify({ slides: sections.length, problems }, null, 1));
  if (problems.length) process.exitCode = 1;
}
