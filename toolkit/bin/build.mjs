// design build <src.html> <out.html> [--style …] [--ref …]
// Turns a source file into the deliverable: one self-contained HTML file.
//   <!-- design:css -->         in <head> → the style's CSS (repo / brand / carbon) + inline fonts
//   <!-- design:review-bar -->  at the top of <body> → view switcher, empty state, theme, style line
//   <ui-icon>, <ui-pictogram>, <ui-component>   → static SVG / HTML (lib/icons.mjs, lib/components.mjs)
//   every class="" through tailwind-merge when the style uses it, as the app's cn() does
// Checks, failing the build: inline <script>s parse; no <style> blocks or style="" beyond
// a component's own size or position; no `&amp;` inside a class; no unhandled <ui-*> tag;
// every data-goto-view names a view the page has; no data-anchor twice in one view.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { TOOLKIT, fail, req, slugOf } from "../lib/core.mjs";
import { toolchain } from "../lib/toolchain.mjs";
import { resolveStyle, compileCss, fontCss } from "../lib/style.mjs";
import { renderIcons } from "../lib/icons.mjs";
import { renderComponents } from "../lib/components.mjs";
import { ANCHOR_NAME } from "../../desk/store.mjs";

export async function main(_cmd, argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) argv[i].startsWith("--") ? (opt[argv[i].slice(2)] = argv[++i]) : pos.push(argv[i]);
  const [src, out] = pos;
  if (!src || !out) fail("usage: design build <src.html> <out.html> [--style repo:<owner/name>|brand|carbon] [--ref <ref>]");
  let html = readFileSync(src, "utf8");
  const style = resolveStyle(opt.style, opt.ref);
  // Read before the placeholder is filled: the check below is on the source, not on the bar.
  const hasReviewBar = html.includes("<!-- design:review-bar -->");

  html = html.replace("<!-- design:review-bar -->", readFileSync(join(TOOLKIT, "chrome/review-bar.html"), "utf8"));
  html = html.replace("<!-- design:tour -->", readFileSync(join(TOOLKIT, "chrome/tour.html"), "utf8"));
  html = renderIcons(html, style);
  html = await renderComponents(html, style);

  // cn(): resolve conflicting utilities the way the app does, with the app's tailwind-merge.
  const tailwind = style.kind !== "repo" || style.profile.styling === "tailwind";
  if (tailwind && (style.kind !== "repo" || style.profile.class_merge === "tailwind-merge")) {
    const v = style.kind === "repo" && style.profile.versions?.["tailwind-merge"];
    const { twMerge } = v ? toolchain(`merge-${slugOf(style.repo)}`, { "tailwind-merge": v }).req("tailwind-merge") : req("tailwind-merge");
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
  const dangling = danglingGotos(html);
  if (dangling.length) fail(`data-goto-view names no view: ${dangling.slice(0, 3).join(", ")} — give the target a data-view, or use "back"`);
  const anchors = anchorProblems(html);
  if (anchors.length) fail(`${anchors.slice(0, 3).join("; ")} — name each part once per view (docs/requests.md → Names notes hang on)`);
  if (!hasReviewBar) fail("missing <!-- design:review-bar --> at the top of <body> — every page the build makes carries the review bar");

  const css = compileCss(style, html);
  const fonts = fontCss(style);
  html = html.replace("<html", `<html data-review-style="${style.label.replace(/"/g, "&quot;")}"`);
  html = html.replace("<!-- design:css -->", () => `<!-- ${style.label} -->\n<style>${fonts}\n${css}\n${style.componentCss || ""}</style>`);
  writeFileSync(out, html);
  console.log(JSON.stringify({ built: resolve(out), style: style.label, kb: Math.round(html.length / 1024), ...(style.commit ? { commit: style.commit } : {}) }));
}

// The views a click leads to that the page does not have ("back" retraces the flow).
// The names people's notes hang on (data-anchor, docs/requests.md → Names notes hang on): one name
// twice in one view, or one that is not a short lowercase name, finds the wrong part or none.
// The markup is read as tags, outside scripts, styles and comments; a closing tag closes what it
// names and everything left open inside it, as a browser does.
export function anchorProblems(html) {
  const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  const stack = [], seen = new Map(), problems = [];
  const text = html.replace(/<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, "");
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [, close, tag, attrs] = m, name = tag.toLowerCase();
    if (close) { const i = stack.findLastIndex((x) => x.tag === name); if (i >= 0) stack.length = i; continue; }
    const view = attrs.match(/\sdata-view=["']([^"']*)["']/)?.[1] ?? null;
    const at = { tag: name, view: view ?? stack.at(-1)?.view ?? "" };
    const anchor = attrs.match(/\sdata-anchor=["']([^"']*)["']/)?.[1];
    if (anchor != null) {
      const where = at.view ? `view ${at.view}` : "the page";
      if (!ANCHOR_NAME.test(anchor)) problems.push(`data-anchor="${anchor}" in ${where} is not a name: lowercase letters, digits and dashes, at most 40`);
      else if (seen.has(`${at.view}\u0000${anchor}`)) problems.push(`data-anchor="${anchor}" twice in ${where}`);
      seen.set(`${at.view}\u0000${anchor}`, true);
    }
    if (!VOID.test(name) && !/\/\s*$/.test(attrs)) stack.push(at);
  }
  return [...new Set(problems)];
}

export function danglingGotos(html) {
  const views = new Set([...html.matchAll(/\sdata-view="([^"]*)"/g)].map((m) => m[1]));
  return [...new Set([...html.matchAll(/\sdata-goto-view="([^"]*)"/g)].map((m) => m[1]))].filter((v) => v !== "back" && !views.has(v));
}
