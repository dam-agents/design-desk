// design build <src.html> <out.html> [--style …] [--ref …]
// Turns a source file into the deliverable: one self-contained HTML file.
//   <!-- design:css -->         in <head> → the style's CSS (repo / brand / carbon) + inline fonts
//   <!-- design:review-bar -->  at the top of <body> → view switcher, empty state, theme, style line
//   <ui-icon>, <ui-pictogram>, <ui-component>   → static SVG / HTML (lib/icons.mjs, lib/components.mjs)
//   every class="" through tailwind-merge when the style uses it, as the app's cn() does
// Checks, failing the build: inline <script>s parse; no <style> blocks or style="" beyond
// a component's own size or position; no `&amp;` inside a class; no unhandled <ui-*> tag.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { TOOLKIT, fail, req } from "../lib/core.mjs";
import { resolveStyle, compileCss, fontCss } from "../lib/style.mjs";
import { renderIcons } from "../lib/icons.mjs";
import { renderComponents } from "../lib/components.mjs";

export async function main(_cmd, argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) argv[i].startsWith("--") ? (opt[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  const [src, out] = pos;
  if (!src || !out) fail("usage: design build <src.html> <out.html> [--style repo:<owner/name>|brand|carbon] [--ref <ref>]");
  let html = readFileSync(src, "utf8");
  const style = resolveStyle(opt.style, opt.ref);

  html = html.replace("<!-- design:review-bar -->", readFileSync(join(TOOLKIT, "chrome/review-bar.html"), "utf8"));
  html = html.replace("<!-- design:tour -->", readFileSync(join(TOOLKIT, "chrome/tour.html"), "utf8"));
  html = renderIcons(html, style);
  html = await renderComponents(html, style);

  // cn(): resolve conflicting utilities the way the app does. Only for Tailwind styles.
  const tailwind = style.kind !== "repo" || style.profile.styling === "tailwind";
  if (tailwind && (style.kind !== "repo" || style.profile.class_merge === "tailwind-merge")) {
    const { twMerge } = req("tailwind-merge");
    html = html.replace(/(\sclass=")([^"]*)(")/g, (_, a, cls, b) => a + twMerge(cls.replace(/\s+/g, " ").trim()) + b);
  }

  const vm = await import("node:vm");
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
    try { new vm.Script(m[1]); } catch (e) { fail(`inline <script> #${i + 1} does not parse: ${e.message}`); }
  });
  const styleProblems = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1])
    .filter((st) => st.split(";").some((d) => d.trim() && !/^\s*(width|height|min-width|max-width|min-height|max-height|top|left|right|bottom|opacity|transform|font-size)\s*:/.test(d)));
  if (styleProblems.length) fail(`hand styling in style="": ${styleProblems.slice(0, 3).join(" | ")} — use the style's classes instead`);
  if (/<style[\s>]/.test(html.replace(/<style data-review>[\s\S]*?<\/style>/g, ""))) fail("a <style> block besides the review bar's — use the style's classes instead");
  const escaped = html.match(/class="[^"]*&amp;[^"]*"/);
  if (escaped) fail(`write "&" literally inside class="" (Tailwind reads the raw text): ${escaped[0].slice(0, 80)}`);
  const left = html.match(/<ui-[\w-]+/);
  if (left) fail(`unhandled tag ${left[0]}`);
  if (!html.includes("<!-- design:css -->")) fail("missing <!-- design:css --> in <head>");

  const css = compileCss(style, html);
  const fonts = fontCss(style);
  html = html.replace("<html", `<html data-review-style="${style.label.replace(/"/g, "&quot;")}"`);
  html = html.replace("<!-- design:css -->", `<!-- ${style.label} -->\n<style>${fonts}\n${css}</style>`);
  writeFileSync(out, html);
  console.log(JSON.stringify({ built: resolve(out), style: style.label, kb: Math.round(html.length / 1024), ...(style.commit ? { commit: style.commit } : {}) }));
}
