// node --test desk/tests/guidelines.test.mjs — the interface guidelines (desk/guidelines.html)
// cannot silently differ from the Desk: they wear its stylesheet, show only its components, and
// the Desk's switchers are the ones they name (docs/desk-page.md → The guidelines).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PAGE, GUIDELINES, STYLE, deskStyle, styleFile } from "../dev/guidelines.mjs";
import { chromium, req } from "../../toolkit/lib/core.mjs";

const page = readFileSync(PAGE, "utf8"), gl = readFileSync(GUIDELINES, "utf8");
const css = deskStyle(page).replace(/\/\*[\s\S]*?\*\//g, "");
const own = gl.match(/<style data-guidelines>([\s\S]*?)<\/style>/)?.[1] ?? "";
const body = gl.slice(gl.indexOf("<body>"), gl.indexOf("<script>", gl.indexOf("<body>")));

test("the guidelines wear the Desk's own stylesheet, as it is now", () => {
  assert.equal(readFileSync(STYLE, "utf8"), styleFile(page), "desk/guidelines.css is stale: run node desk/dev/guidelines.mjs");
  assert.match(gl, /<link rel="stylesheet" href="guidelines\.css">/, "the page links the copy");
  assert.equal((gl.replace(/<!--[\s\S]*?-->/g, "").match(/<style\b/g) || []).length, 1, "the page carries no stylesheet but its own layout");
  // Read whole in one go: the page holds its rules, never a copy of the Desk's stylesheet.
  assert.ok(Buffer.byteLength(gl) < 40_000, `desk/guidelines.html is ${Buffer.byteLength(gl)} bytes`);
});

test("the guidelines' own styles only lay the page out", () => {
  assert.ok(own.trim(), "the page has its layout block");
  for (const block of own.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const sel = block.slice(0, block.lastIndexOf("{")).split("{").pop().trim();
    if (!sel || sel.startsWith("@media")) continue;
    for (const s of sel.split(",").map((x) => x.trim())) {
      // No Desk class anywhere in it, and its subject, the last compound, is one of the page's own.
      const desk = [...s.matchAll(/\.(-?[\w-]+)/g)].map((m) => m[1]).filter((c) => !c.startsWith("gl-"));
      assert.deepEqual(desk, [], `a rule of the guidelines' own reaches a Desk component: ${s}`);
      assert.match(s.split(/\s*[\s>+~]\s*/).pop(), /^[a-z]*\.gl-/, `a rule of the guidelines' own restyles a component: ${s}`);
    }
  }
  // An inline style only on the page's own parts (a swatch, a corner), never on a component.
  for (const [tag] of body.matchAll(/<[a-z]+\b[^>]*\bstyle="[^"]*"[^>]*>/g))
    assert.match(tag, /\bclass="[^"]*\bgl-/, `an inline style on a component: ${tag}`);
});

test("every component on the guidelines is one the Desk's stylesheet defines", () => {
  const classes = new Set([...body.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c && !c.startsWith("gl-")));
  assert.ok(classes.size > 20, "the page shows the Desk's components");
  const missing = [...classes].filter((c) => !new RegExp(`\\.${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], "classes the Desk no longer styles");
});

test("the Desk's design options are the underline tabs with a number chip the guidelines show", () => {
  const ex = body.match(/<div class="(tabs vtabs vrow utabs)"/);
  assert.ok(ex, "the guidelines show the option tabs");
  const tabs = [...page.matchAll(/class="(tabs vtabs[^"]*)" role="group" aria-label="Design options"/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 2, "the Desk renders its option tabs");
  for (const t of tabs) assert.match(t, /\butabs\b/, `the Desk's option tabs: ${t}`);
  // The workspace's options are the same tabs; their chips' marks are rendered and checked in
  // desk/tests/page.test.mjs ("an option tab's chip is …").
  assert.match(css, /\.ws-opts \.ws-seg \.ws-opt\[aria-selected="true"\] \{[^}]*border-bottom-color: var\(--ink\)/, "the workspace's shown option is underlined");
  assert.match(page, /class="ws-opt[^`]*\$\{optionMark\(c, x\.id, asked\)\}/, "the workspace's option tabs carry the same marks");
  // A panel's sections are plain underline tabs: the look panel's too.
  assert.match(css, /\.pl-tabs button\[aria-selected="true"\] \{[^}]*border-bottom-color: var\(--ink\)/, "the look panel's shown section is underlined");
});

test("the guidelines show in light and dark, with the Desk's colours", async (t) => {
  const exe = chromium();
  if (!exe) { t.skip("no browser here"); return; }
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") { t.skip("toolkit dependencies are not installed"); return; } throw e; }
  Object.assign(process.env, exe.env);
  const browser = await pw.chromium.launch({ executablePath: exe.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const p = await browser.newPage();
    await p.goto(pathToFileURL(GUIDELINES).href);
    const look = () => p.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      chip: getComputedStyle(document.querySelector('.utabs [aria-pressed="true"] .ono')).backgroundColor,
      ok: getComputedStyle(document.querySelector('.utabs [data-m="ok"] .ono')).backgroundColor,
      under: getComputedStyle(document.querySelector('.utabs [aria-pressed="true"]')).borderBottomWidth,
    }));
    await p.click('[data-gl-theme="light"]');
    const light = await look();
    // The page's ground is the Desk's --bg token in each theme, as the stylesheet sets it.
    const token = (re) => { const h = css.match(re)[1]; return `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`; };
    assert.equal(light.bg, token(/:root \{[^}]*?--bg: (#[0-9a-f]{6})/));
    assert.equal(light.under, "2px", "the shown option is underlined");
    assert.notEqual(light.chip, light.ok, "the approved option's chip is not the shown one's");
    await p.click('[data-gl-theme="dark"]');
    const dark = await look();
    assert.equal(dark.bg, token(/:root\[data-theme="dark"\] \{[^}]*?--bg: (#[0-9a-f]{6})/));
    assert.notEqual(dark.bg, light.bg);
    assert.notEqual(dark.chip, light.chip, "the chip follows the theme");
    await p.click(".utabs .vscroll > button:nth-child(4)");
    assert.equal(await p.getAttribute(".utabs .vscroll > button:nth-child(4)", "aria-pressed"), "true");
  } finally { await browser.close(); }
});

// Every switcher the Desk renders has one of the looks the guidelines show, by what it means. A
// new kind of switcher fails here until the page names its look (or it takes one of these).
const LOOKS = {
  filters: "Segmented control", "ws-pages": "Segmented control",
  "tabs vtabs utabs": "Underline tabs with a number chip", "tabs vtabs vrow utabs": "Underline tabs with a number chip", "tabs vtabs vrow utabs chg-tabs cv-tabs": "Underline tabs with a number chip", "ws-opts": "Underline tabs with a number chip",
  subtabs: "Plain underline tabs", "pl-tabs": "Plain underline tabs", "ws-ptabs": "Plain underline tabs",
  tabs: "Choice in a form",
  nav: "Main menu",
};
test("every switcher on the Desk has a look the guidelines show", () => {
  const found = new Set([
    ...[...page.matchAll(/class="([^"$]+)" role="(?:tablist|radiogroup)"/g)].map((m) => m[1]),
    ...[...page.matchAll(/class="([^"$]*(?:tabs|filters)[^"$]*)" role="group"/g)].map((m) => m[1]),
    // A <nav> by its class; the header's, filled in by script, by its id.
    ...[...page.matchAll(/<nav (?:class|id)="([^"$]+)"/g)].map((m) => m[1]),
  ]);
  assert.ok(found.size >= 6, `the Desk's switchers: ${[...found]}`);
  for (const cls of found) {
    assert.ok(LOOKS[cls], `a switcher with no look on the guidelines: class="${cls}"`);
    assert.ok(body.includes(`<h3 class="gl-h3">${LOOKS[cls]}</h3>`), `the guidelines show ${LOOKS[cls]}`);
  }
});

// The same gate read from the Desk's stylesheet: a rule that styles a control as pressed or
// selected marks a switcher, whatever its markup or role. Each is one of the looks the guidelines
// show, or named here as no switcher with why. A new one fails until it is either.
const PRESSED = [
  [/^\.tabs(?:\.vtabs)?(?:\.utabs)? button/, "Choice in a form|Underline tabs with a number chip"],
  [/^:is\(\.tabs\.vtabs\.utabs|^\.ws-opts \.ws-seg \.ws-opt/, "Underline tabs with a number chip"],
  [/^\.(?:pl-tabs|ws-ptabs) button/, "Plain underline tabs"],
  [/^\.ws-seg button/, "Segmented control"],
  [/^\.(?:pl-seg|pl-chips) button|^\.pl-sw(?![\w-])/, "A property's value"],
  [/^\.spec-versions button/, "Version links"],
  [/^\.el-tile\[aria-pressed/, "Pictures to pick from"],
  [/^#hits \.hit/, null, "a search result picked by the keys, not a switch"],
  [/^#(?:simple|figma)\b/, null, "an on/off switch in a menu, not a pick-one"],
  [/^\.stories ol button/, null, "a user story that plays in the design, not a switch"],
  [/^\.ws-toolbar \.(?:tool|tog)/, null, "a drawing tool on the workspace's toolbar"],
];
test("every pressed or selected control the Desk styles has a look the guidelines show", () => {
  const sels = [];
  for (const block of css.split("}")) {
    const sel = block.slice(0, block.lastIndexOf("{")).split("{").pop().trim();
    for (const s of sel.split(",").map((x) => x.trim().replace(/\s+/g, " ")))
      if (/\[aria-(?:pressed|selected)="true"\]/.test(s)) sels.push(s);
  }
  assert.ok(sels.length >= 10, "the Desk styles its switchers' pressed state");
  for (const s of sels) {
    const hit = PRESSED.find(([re]) => re.test(s));
    assert.ok(hit, `a pressed or selected control with no look on the guidelines: ${s}`);
    if (hit[1]) assert.ok(hit[1].split("|").some((look) => body.includes(`<h3 class="gl-h3">${look}</h3>`)), `the guidelines show ${hit[1]}`);
  }
});

// Close is ✕, alone, in a dialog's corner (desk/guidelines.html → Dialogs and forms): every dialog
// of the page carries one (the element dialog's is drawn with its header), and no "✕ Close" is left.
test("every dialog closes with a lone ✕, as the guidelines show", () => {
  assert.ok(body.includes('class="dlg-x"'), "the guidelines show the ✕");
  assert.doesNotMatch(page, /✕ Close/, "Close is ✕ alone");
  const dialogs = page.match(/<dialog id="[^"]+"[\s\S]*?<\/dialog>/g) || [];
  assert.ok(dialogs.length >= 9, "the page has its dialogs");
  for (const d of dialogs) {
    const id = d.match(/id="([^"]+)"/)[1];
    if (id === "element-dialog") assert.match(page, /class="dlg-x" data-el-close aria-label="Close">✕</, id);
    else assert.match(d, /<button type="button" class="dlg-x" data-dlg-x aria-label="Close">✕<\/button>/, id);
  }
});

// Two corners, no more (desk/guidelines.html → Corners): the Desk declares --r-sm and --radius
// and no other radius token, and the page shows both.
test("the Desk has two corners", () => {
  const tokens = [...css.matchAll(/(--r-[\w-]+|--radius)\s*:/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tokens)].sort(), ["--r-sm", "--radius"]);
  for (const t of ["--r-sm", "--radius"]) assert.ok(body.includes(`data-gl-var="${t}"`), `the guidelines show ${t}`);
});
