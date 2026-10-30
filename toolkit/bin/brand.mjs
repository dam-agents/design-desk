// design brand extract <file>... [--name <n>]   draft a brand from what the user uploaded
// design brand show | design brand save <brand.json>
//
// Reads, without a model: colors and fonts from a .pptx/.potx theme (the deck's own
// theme XML), colors and @font-face/font-family from CSS, the dominant non-neutral
// colors of an image (logo or screenshot, sampled in a headless browser), and the
// embedded font names and images of a PDF. Prints a draft brand.json on stdout with a
// `sources` note per value; the agent reviews it with the user before `brand save`.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORK, ensureDir, fail, req, launch } from "../lib/core.mjs";
import { brandPath, loadBrand } from "../lib/style.mjs";
import { contrast } from "../lib/theme.mjs";

const hex = (s) => "#" + s.replace("#", "").toLowerCase();
const isNeutral = (h) => { const c = h.replace("#", "").match(/../g).map((x) => parseInt(x, 16)); return Math.max(...c) - Math.min(...c) < 24; };

async function fromPptx(file) {
  const JSZip = req("jszip");
  const zip = await JSZip.loadAsync(readFileSync(file));
  const themeName = Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)).sort()[0];
  const out = { colors: {}, fonts: {}, logo: null, notes: [] };
  if (!themeName) { out.notes.push(`${basename(file)}: no theme in the file`); return out; }
  const xml = await zip.file(themeName).async("string");
  const slot = (n) => { const m = xml.match(new RegExp(`<a:${n}>\\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"`)); return m ? hex(m[1]) : null; };
  const scheme = Object.fromEntries(["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink"].map((n) => [n, slot(n)]));
  const major = xml.match(/<a:majorFont>\s*<a:latin typeface="([^"]+)"/)?.[1], minor = xml.match(/<a:minorFont>\s*<a:latin typeface="([^"]+)"/)?.[1];
  // What the slides actually use: explicit colors and typefaces, by frequency.
  const slides = (await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => zip.file(n).async("string")))).join("\n");
  const used = {}, faces = {};
  for (const m of slides.matchAll(/<a:srgbClr val="([0-9A-Fa-f]{6})"/g)) { const h = hex(m[1]); if (!isNeutral(h)) used[h] = (used[h] || 0) + 1; }
  for (const m of slides.matchAll(/<a:(?:latin|ea|cs) typeface="([^"+][^"]*)"/g)) faces[m[1]] = (faces[m[1]] || 0) + 1;
  const topUsed = Object.entries(used).sort((a, b) => b[1] - a[1]);
  const topFace = Object.entries(faces).sort((a, b) => b[1] - a[1]);
  // The stock Office theme is not a brand: fall back to what the slides use.
  const stock = scheme.accent1 === "#4472c4" || scheme.accent1 === "#156082" || /^(Calibri|Aptos)/.test(minor || "");
  out.scheme = scheme;
  out.colors.accent = stock && topUsed.length ? topUsed[0][0] : scheme.accent1;
  out.colors.ink = scheme.dk1 && scheme.dk1 !== "#000000" ? scheme.dk1 : scheme.dk2 || scheme.dk1;
  out.fonts.sans = (stock && topFace.length ? topFace[0][0] : minor || major) || null;
  out.fonts.display = !stock && major && major !== minor ? major : undefined;
  out.used = topUsed.slice(0, 8).map(([h]) => h);
  out.notes.push(`${basename(file)}: theme accent1 ${scheme.accent1}, fonts ${major}/${minor}${stock ? " — the stock Office theme, so the slides' own colors and fonts are used instead" : ""}`);
  if (topUsed.length) out.notes.push(`${basename(file)}: colors the slides use most: ${topUsed.slice(0, 6).map(([h, n]) => `${h}×${n}`).join(" ")}`);
  if (topFace.length) out.notes.push(`${basename(file)}: typefaces the slides use most: ${topFace.slice(0, 4).map(([f, n]) => `${f}×${n}`).join(", ")}`);
  // The largest image in the slide masters/layouts is most often the logo.
  const media = Object.keys(zip.files).filter((n) => /^ppt\/media\/.+\.(png|svg|jpe?g|emf)$/i.test(n));
  const masters = (await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/slide(Master|Layout)s\/_rels\/.+\.rels$/.test(n)).map((n) => zip.file(n).async("string")))).join("\n");
  const inMaster = media.filter((m) => masters.includes(m.replace("ppt/", "../")));
  const pick = (inMaster.length ? inMaster : []).find((m) => /\.(svg|png)$/i.test(m));
  if (pick) { out.logo = { name: pick.split("/").pop(), data: await zip.file(pick).async("nodebuffer") }; out.notes.push(`logo candidate from the slide master: ${pick}`); }
  return out;
}

function fromCss(file) {
  const css = readFileSync(file, "utf8");
  const out = { colors: {}, fonts: {}, notes: [] };
  const counts = {};
  for (const m of css.matchAll(/#([0-9a-fA-F]{6})\b/g)) { const h = hex(m[1]); if (!isNeutral(h)) counts[h] = (counts[h] || 0) + 1; }
  const vars = Object.fromEntries([...css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], hex(m[2])]));
  const named = Object.entries(vars).find(([k]) => /^(primary|brand|accent|interactive)(-color)?$/.test(k));
  out.colors.accent = named?.[1] || Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const fam = css.match(/font-family\s*:\s*["']?([^,"';]+)/)?.[1]?.trim();
  if (fam) out.fonts.sans = fam;
  out.notes.push(`${basename(file)}: accent ${out.colors.accent}${named ? ` (from --${named[0]})` : " (most used non-neutral color)"}, font ${fam || "none"}`);
  return out;
}

async function fromImage(files) {
  const browser = await launch();
  const pg = await browser.newPage();
  const res = [];
  for (const f of files) {
    const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" }[extname(f).toLowerCase()];
    const url = `data:${mime};base64,${readFileSync(f).toString("base64")}`;
    const colors = await pg.evaluate(async (src) => {
      const img = new Image(); img.src = src; await img.decode();
      const w = Math.min(img.naturalWidth || 400, 400), h = Math.round(w * ((img.naturalHeight || 400) / (img.naturalWidth || 400)));
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data, bins = {};
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]].map((v) => Math.round(v / 16) * 16);
        const k = [r, g, b].map((v) => Math.min(255, v).toString(16).padStart(2, "0")).join("");
        bins[k] = (bins[k] || 0) + 1;
      }
      return Object.entries(bins).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, n]) => ["#" + k, n]);
    }, url);
    res.push({ file: f, colors });
  }
  await browser.close();
  return res;
}

function fromPdf(file) {
  const buf = readFileSync(file).toString("latin1");
  const fonts = [...new Set([...buf.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)/g)].map((m) => m[1].replace(/-(Regular|Bold|Light|Medium|Italic|SemiBold|Book)+$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2")))];
  return { fonts: { sans: fonts[0] || null }, notes: [`${basename(file)}: fonts embedded — ${fonts.slice(0, 6).join(", ") || "none found"}; for colors, upload a screenshot of a page`] };
}

export async function main(_cmd, [sub, ...rest]) {
  if (sub === "show") { const b = loadBrand(); if (!b) fail("no brand saved (work/brand/brand.json)"); console.log(JSON.stringify(b, null, 2)); return; }
  if (sub === "save") {
    const [file] = rest; if (!file) fail("usage: design brand save <brand.json>");
    const b = JSON.parse(readFileSync(file, "utf8"));
    if (!b.colors?.accent || !/^#[0-9a-f]{6}$/i.test(b.colors.accent)) fail("brand.colors.accent must be a #rrggbb color");
    for (const [k, v] of Object.entries(b.colors)) if (v && !/^#[0-9a-f]{6}$/i.test(v)) fail(`brand.colors.${k} is not #rrggbb: ${v}`);
    const dir = ensureDir(join(WORK, "brand"));
    if (b.logo && !b.logo.startsWith("logo")) { // a path to copy in
      if (!existsSync(b.logo)) fail(`logo file not found: ${b.logo}`);
      const dest = `logo${extname(b.logo)}`; copyFileSync(b.logo, join(dir, dest)); b.logo = dest;
    }
    for (const f of b.fonts?.files || []) if (!f.path.startsWith("fonts/")) {
      ensureDir(join(dir, "fonts")); const dest = `fonts/${basename(f.path)}`; copyFileSync(f.path, join(dir, dest)); f.path = dest;
    }
    delete b.sources; b.saved_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    writeFileSync(brandPath(), JSON.stringify(b, null, 2) + "\n");
    console.log(JSON.stringify({ saved: brandPath() }));
    return;
  }
  if (sub !== "extract") fail("usage: design brand extract <file>... [--name <n>] | show | save <brand.json>");
  const files = [], opt = {};
  for (let i = 0; i < rest.length; i++) rest[i].startsWith("--") ? (opt[rest[i].slice(2)] = rest[++i]) : files.push(resolve(rest[i]));
  if (!files.length) fail("design brand extract needs at least one file (logo, screenshot, .pptx, .pdf, .css)");
  const draft = { name: opt.name || "", colors: {}, fonts: {}, logo: null, radius: null, sources: [] };
  const images = [], ex = ensureDir(join("/tmp/design-desk", "brand-extract"));
  for (const f of files) {
    if (!existsSync(f)) fail(`no such file: ${f}`);
    const e = extname(f).toLowerCase();
    if ([".pptx", ".potx"].includes(e)) {
      const r = await fromPptx(f);
      Object.assign(draft.colors, Object.fromEntries(Object.entries(r.colors).filter(([, v]) => v)));
      Object.assign(draft.fonts, Object.fromEntries(Object.entries(r.fonts).filter(([, v]) => v)));
      if (r.scheme) draft.palette = [...new Set([...(r.used || []), ...Object.values(r.scheme).filter(Boolean)])];
      if (r.logo) { const p = join(ex, r.logo.name); writeFileSync(p, r.logo.data); draft.logo = draft.logo || p; if (/\.(png|svg)$/i.test(p)) images.push(p); }
      draft.sources.push(...r.notes);
    } else if ([".css", ".scss"].includes(e)) {
      const r = fromCss(f); if (r.colors.accent) draft.colors.accent ??= r.colors.accent; if (r.fonts.sans) draft.fonts.sans ??= r.fonts.sans; draft.sources.push(...r.notes);
    } else if (e === ".pdf") {
      const r = fromPdf(f); if (r.fonts.sans) draft.fonts.sans ??= r.fonts.sans; draft.sources.push(...r.notes);
    } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(e)) {
      images.push(f); if (/logo/i.test(basename(f)) || e === ".svg") draft.logo ??= f;
    } else if ([".key", ".pages", ".numbers", ".sketch", ".fig"].includes(e)) {
      draft.sources.push(`${basename(f)}: ${e} files can't be read here — export it as .pptx or .pdf, or send a screenshot`);
    } else if ([".woff2", ".woff", ".ttf", ".otf"].includes(e)) {
      (draft.fonts.files ||= []).push({ family: opt.name ? `${opt.name} Sans` : basename(f).replace(/[-_](regular|bold|light|medium|semibold|italic).*$/i, "").replace(/\.[^.]+$/, ""), path: f, weight: /bold/i.test(f) ? 700 : /semibold/i.test(f) ? 600 : /medium/i.test(f) ? 500 : /light/i.test(f) ? 300 : 400 });
      draft.sources.push(`${basename(f)}: font file, family name guessed from the file name — confirm it`);
    } else draft.sources.push(`${basename(f)}: not a format brand extract reads`);
  }
  if (images.length) {
    for (const { file, colors } of await fromImage(images)) {
      const vivid = colors.map(([h]) => h).filter((h) => !isNeutral(h));
      if (vivid.length && !draft.colors.accent) draft.colors.accent = vivid[0];
      draft.palette = [...new Set([...(draft.palette || []), ...vivid.slice(0, 5)])];
      const darkest = colors.map(([h]) => h).filter(isNeutral).sort((a, b) => contrast(b, "#ffffff") - contrast(a, "#ffffff"))[0];
      if (darkest && !draft.colors.ink && contrast(darkest, "#ffffff") > 10) draft.colors.ink = darkest;
      draft.sources.push(`${basename(file)}: most-used colors ${colors.slice(0, 6).map(([h]) => h).join(" ")}${vivid.length ? ` → accent ${vivid[0]}` : " (all neutral)"}`);
    }
  }
  const a = draft.colors.accent;
  if (a) {
    const c = contrast(a, "#ffffff");
    draft.checks = { accent_on_white: Number(c.toFixed(2)), usable_for_text: c >= 4.5, usable_for_large_text: c >= 3 };
    if (c < 3) draft.sources.push(`accent ${a} is too light for text or buttons on white (${c.toFixed(2)}:1) — pick a darker brand color for interactive elements, keep ${a} for fills`);
  } else draft.sources.push("no accent color found — ask the user for their main brand color");
  if (!draft.fonts.sans) draft.sources.push("no font found — IBM Plex Sans stays the default unless the user names one");
  console.log(JSON.stringify(draft, null, 2));
}
