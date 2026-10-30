// Resolve which style a build uses, and compile its CSS.
//   repo:<owner/name>  the repo's own stylesheet, compiled fresh from a fresh clone with
//                      the exact toolchain its lockfile names (profile in work/profiles/)
//   brand              the saved brand (work/brand/brand.json) on the fallback system
//   carbon             IBM Carbon tokens on the fallback system
//   wireframe          grayscale tokens on the fallback system, for structure and flow
// Default order when --style is not given: work/CONFIG.md `default_style`, then brand
// when one is saved, then carbon.
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { TOOLKIT, WORK, SCRATCH, DATA, cfg, fail, warn, ensureDir, run, req, slugOf, fontFaces, fontsourceDir, plexFaces } from "./core.mjs";
import { loadProfile, cloneRepo, lockedVersions } from "./profile.mjs";
import { toolchain, linkModules, bareImports } from "./toolchain.mjs";
import { themeCss } from "./theme.mjs";

const WIREFRAME = {
  name: "wireframe",
  colors: { accent: "#6f6f6f", accentDark: "#a8a8a8", ink: "#262626", primary: "#393939", primaryDark: "#c6c6c6", background: "#ffffff", backgroundDark: "#1f1f1f" },
  radius: "0.375rem",
};

export const brandPath = () => join(WORK, "brand", "brand.json");
export const loadBrand = () => (existsSync(brandPath()) ? JSON.parse(readFileSync(brandPath(), "utf8")) : null);

export function resolveStyle(flag, ref = "") {
  let s = flag || cfg("default_style", "");
  if (!s || s === "auto") s = loadBrand() ? "brand" : "carbon";
  if (s === "brand") {
    const brand = loadBrand();
    if (!brand) fail("--style brand, but no brand is saved — run the brand skill first, or use --style carbon");
    return { kind: "brand", brand, label: `Style: brand "${brand.name || "saved brand"}"` };
  }
  if (s === "carbon") return { kind: "carbon", brand: null, label: "Style: IBM Carbon (default)" };
  if (s === "wireframe") return { kind: "wireframe", brand: WIREFRAME, label: "Style: wireframe (grayscale)" };
  if (s.startsWith("repo:")) {
    const repo = s.slice(5);
    const profile = loadProfile(repo);
    if (!profile) fail(`no saved profile for ${repo} — run \`design repo detect ${repo}\`, confirm it with the user, then \`design repo save\``);
    if (profile.kind === "none") fail(`${repo} has no UI code (its profile says kind: none) — use --style brand or carbon`);
    const { dir, commit } = cloneRepo(repo, ref || profile.ref || "");
    return { kind: "repo", repo, profile, dir, commit, uiDir: join(dir, profile.ui_dir), label: `Style: ${repo}@${commit}` };
  }
  fail(`unknown style "${s}" — use repo:<owner/name>, brand, carbon or wireframe`);
}

// Local @import targets of a CSS file, recursively, so every bare import gets installed.
function cssClosure(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return seen;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/@import\s+(?:url\()?["'](\.[^"']+)["']/g)) cssClosure(resolve(dirname(file), m[1]), seen);
  return seen;
}

// CSS for a build. `scanFile` is the prototype's own markup, written where Tailwind
// will @source it, so every utility the prototype uses is generated exactly as the app has it.
export function compileCss(style, html) {
  const scratch = ensureDir(join(SCRATCH, "build"));
  if (style.kind !== "repo") {
    const dir = ensureDir(join(scratch, "fallback"));
    linkModules(join(TOOLKIT, "node_modules"), dir);
    writeFileSync(join(dir, "scan.html"), html);
    writeFileSync(join(dir, "input.css"), themeCss(style.brand) + `@source "./scan.html";\n`);
    const out = join(dir, "out.css");
    const r = run(join(TOOLKIT, "node_modules/.bin/tailwindcss"), ["-i", "input.css", "-o", out, "--minify"], { cwd: dir });
    if (r.status !== 0) fail(`tailwind failed: ${r.stderr}`);
    return readFileSync(out, "utf8");
  }

  const { profile, dir: root, uiDir } = style;
  if (profile.styling === "css-in-js") return ""; // styles arrive with <ui-component> renders
  const entry = profile.css_entry ? join(root, profile.css_entry) : "";
  if (!entry || !existsSync(entry)) fail(`the profile's css_entry (${profile.css_entry || "none"}) is not in the clone — the repo moved it; run \`design repo detect\` again`);

  if (profile.styling !== "tailwind") {
    // Plain CSS or CSS modules: bundle the repo's own stylesheet, imports and assets inlined.
    const tc = toolchain("esbuild", { esbuild: "0.28.2" });
    const out = join(scratch, "repo.css");
    const r = run(process.execPath, [join(tc.nm, "esbuild/bin/esbuild"), entry, "--bundle", `--outfile=${out}`, "--loader:.woff2=dataurl", "--loader:.woff=dataurl", "--loader:.ttf=dataurl", "--loader:.svg=dataurl", "--loader:.png=dataurl", "--loader:.jpg=dataurl", "--loader:.gif=dataurl", "--log-level=error"], { cwd: uiDir });
    if (r.status !== 0) fail(`could not bundle ${profile.css_entry}: ${r.stderr}`);
    return readFileSync(out, "utf8");
  }

  // Tailwind: the repo's entry CSS compiled by the repo's locked Tailwind.
  const major = profile.tailwind_major || 4;
  const v = profile.versions?.tailwindcss;
  if (!v) fail("the profile has no locked tailwindcss version — confirm it and save the profile again");
  const files = [...cssClosure(entry)];
  const cfgFile = profile.tailwind_config ? join(root, profile.tailwind_config) : "";
  const imports = new Set(files.flatMap((f) => bareImports(readFileSync(f, "utf8"))));
  if (cfgFile && existsSync(cfgFile)) for (const n of bareImports(readFileSync(cfgFile, "utf8"))) imports.add(n);
  const specs = major >= 4 ? { tailwindcss: v, "@tailwindcss/cli": v } : { tailwindcss: v };
  const locked = lockedVersions(root, uiDir, [...imports]);
  for (const n of imports) {
    if (locked[n]) specs[n] = locked[n];
    else { warn(`${n} is imported by the repo's CSS but not in its lockfile; installing latest`); specs[n] = "latest"; }
  }
  const tc = toolchain(`tw-${slugOf(style.repo)}`, specs);
  // node_modules must resolve from the entry's directory and from the UI package.
  for (const d of new Set([dirname(entry), uiDir])) if (!existsSync(join(d, "node_modules"))) linkModules(tc.nm, d);

  const scan = join(dirname(entry), ".design-scan.html");
  const input = join(dirname(entry), ".design-input.css");
  const out = join(scratch, "repo.css");
  writeFileSync(scan, html);
  try {
    if (major >= 4) {
      writeFileSync(input, readFileSync(entry, "utf8") + `\n@source "./.design-scan.html";\n`);
      const r = run(tc.bin("tailwindcss"), ["-i", input, "-o", out, "--minify"], { cwd: uiDir });
      if (r.status !== 0) fail(`tailwind ${v} failed on ${profile.css_entry}: ${r.stderr}`);
    } else {
      // v3: wrap the repo's config and add the prototype to its content globs.
      const wrap = join(uiDir, ".design-tailwind.config.cjs");
      writeFileSync(wrap, `const base = require(${JSON.stringify(cfgFile || join(uiDir, "tailwind.config.js"))});
const c = base.default || base;
const content = Array.isArray(c.content) ? c.content : (c.content && c.content.files) || [];
module.exports = { ...c, content: [...content, ${JSON.stringify(scan)}] };\n`);
      const r = run(tc.bin("tailwindcss"), ["-c", wrap, "-i", entry, "-o", out, "--minify"], { cwd: uiDir });
      rmSync(wrap, { force: true });
      if (r.status !== 0) fail(`tailwind ${v} failed: ${r.stderr}`);
    }
  } finally { rmSync(scan, { force: true }); rmSync(input, { force: true }); }
  return readFileSync(out, "utf8");
}

// Fonts as inline @font-face, so nothing loads from a font CDN.
export function fontCss(style) {
  if (style.kind === "carbon" || style.kind === "wireframe") return plexFaces();
  if (style.kind === "brand") {
    const b = style.brand, out = [];
    for (const role of ["sans", "mono"]) {
      const fam = b.fonts?.[role]; if (!fam) continue;
      const files = (b.fonts.files || []).filter((f) => f.family === fam).map((f) => ({ ...f, path: join(WORK, "brand", f.path) }));
      if (files.length) { out.push(fontFaces([{ family: fam, files }])); continue; }
      const dir = fontsourceDir(fam) || installFontsource(fam);
      if (dir) out.push(fontFaces([{ family: fam, weights: [300, 400, 500, 600, 700], dir }]));
      else warn(`font "${fam}" is not on Fontsource and no file was uploaded — the page falls back to a system font`);
    }
    if (!b.fonts?.sans || !b.fonts?.mono) out.push(plexFaces());
    return out.join("\n");
  }
  const out = [];
  for (const rel of style.profile.fonts_local || []) {
    const path = join(style.dir, rel);
    if (!existsSync(path)) { warn(`fonts_local ${rel} is not in the clone`); continue; }
    const fam = rel.split("/").pop().replace(/[-_](regular|bold|semibold|medium|light|italic|variable).*$/i, "").replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    out.push(fontFaces([{ family: fam, files: [{ path, weight: /bold/i.test(rel) ? (/semi/i.test(rel) ? 600 : 700) : 400 }] }]));
  }
  for (const fam of style.profile.fonts || []) {
    const dir = fontsourceDir(fam) || installFontsource(fam);
    if (dir) out.push(fontFaces([{ family: fam, weights: [300, 400, 500, 600, 700], dir }]));
    else warn(`font "${fam}" could not be fetched from Fontsource — the page keeps the repo's <link> tag, and screenshots here fall back to a system font`);
  }
  // next/font and similar wire fonts through CSS variables the app sets at runtime.
  const vars = Object.entries(style.profile.font_vars || {});
  if (vars.length) out.push(`:root{${vars.map(([k, fam]) => `${k}:"${fam}"`).join(";")}}`);
  return out.join("\n");
}

function installFontsource(family) {
  const pkg = `@fontsource/${family.toLowerCase().replace(/\s+/g, "-")}`;
  const dir = ensureDir(join(DATA, "fonts"));
  if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), '{"name":"design-desk-fonts","private":true}\n');
  const r = run("npm", ["i", "-q", "--no-audit", "--no-fund", "--no-save", pkg], { cwd: dir });
  if (r.status !== 0) return null;
  return fontsourceDir(family);
}
