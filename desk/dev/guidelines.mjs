#!/usr/bin/env node
// The guidelines page (desk/guidelines.html) wears the Desk's own stylesheet: this copies
// desk/page.html's <style> block into desk/guidelines.css, which the page links, so every
// example on it is the real component and the page itself stays short enough to read in one go.
// desk/tests/guidelines.test.mjs fails when the copy differs from the Desk.
//   node desk/dev/guidelines.mjs           copy the Desk's style in
//   node desk/dev/guidelines.mjs --check   exit 1 when the copy is stale
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DESK = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE = join(DESK, "page.html");
export const GUIDELINES = join(DESK, "guidelines.html");
export const STYLE = join(DESK, "guidelines.css");
const HEAD = "/* desk/page.html's own <style>, copied by `node desk/dev/guidelines.mjs` for desk/guidelines.html; never edit it here. */\n";

// The Desk's stylesheet: its first <style> block's content.
export function deskStyle(page) {
  const a = page.indexOf("<style>"), b = page.indexOf("</style>", a);
  if (a < 0 || b < 0) throw new Error("desk/page.html has no <style> block");
  return page.slice(a + "<style>".length, b);
}

// What desk/guidelines.css holds for this page.
export const styleFile = (page) => `${HEAD}${deskStyle(page).replace(/^\n/, "")}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = styleFile(readFileSync(PAGE, "utf8")), was = existsSync(STYLE) ? readFileSync(STYLE, "utf8") : "";
  if (process.argv.includes("--check")) {
    if (now !== was) { console.error("desk/guidelines.css is stale: run node desk/dev/guidelines.mjs"); process.exit(1); }
  } else if (now !== was) { writeFileSync(STYLE, now); console.log("desk/guidelines.css: the Desk's style copied in"); }
}
