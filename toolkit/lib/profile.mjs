// Repo design profiles: what a prototype needs to know about a repository's UI, read
// from the code. `detect` proposes one; the user confirms it; it is saved under
// work/profiles/<slug>.yaml and reused. Nothing about a repo's UI is ever stored beyond
// these pointers — the styles themselves are compiled fresh from a fresh clone each run.
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { WORK, SCRATCH, ensureDir, fail, warn, req, run, slugOf } from "./core.mjs";

const YAML = () => req("yaml");
export const profilePath = (repo) => join(WORK, "profiles", `${slugOf(repo)}.yaml`);
export const loadProfile = (repo) => (existsSync(profilePath(repo)) ? YAML().parse(readFileSync(profilePath(repo), "utf8")) : null);
export function saveProfile(p) { ensureDir(join(WORK, "profiles")); writeFileSync(profilePath(p.repo), YAML().stringify(p)); return profilePath(p.repo); }

// Fresh shallow clone into scratch. A fresh clone every run: a mockup built from a stale
// checkout shows a UI that no longer exists.
export function cloneRepo(repo, ref = "") {
  const dir = join(SCRATCH, "repos", slugOf(repo));
  run("rm", ["-rf", dir]);
  ensureDir(dirname(dir));
  const url = /^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`;
  const args = ["clone", "-q", "--depth", "1", ...(ref ? ["--branch", ref] : []), url, dir];
  let r = run("git", args);
  if (r.status !== 0 && ref) { // a commit sha, not a branch
    r = run("git", ["clone", "-q", url, dir]);
    if (r.status === 0) r = run("git", ["-C", dir, "checkout", "-q", ref]);
  }
  if (r.status !== 0) fail(`could not clone ${repo}${ref ? `@${ref}` : ""}: ${(r.stderr || "").trim().split("\n").pop()} — a private repo needs the GitHub connection`);
  const commit = run("git", ["-C", dir, "rev-parse", "--short", "HEAD"]).stdout.trim();
  return { dir, commit };
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", "vendor", "storybook-static"]);
function walk(root, pred, max = 4000) {
  const found = [];
  const go = (d, depth) => {
    if (found.length >= max || depth > 7) return;
    let ents = []; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) go(p, depth + 1); else if (pred(p)) found.push(p);
    }
  };
  go(root, 0);
  return found;
}
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// Locked versions of the packages the UI builds with, from whichever lockfile exists.
// Never guessed: a prototype compiled with another Tailwind major renders differently.
export function lockedVersions(root, uiDir, names) {
  const out = {};
  const pnpm = join(root, "pnpm-lock.yaml"), npmLock = join(root, "package-lock.json"), yarn = join(root, "yarn.lock"), bun = join(root, "bun.lock");
  if (existsSync(pnpm)) {
    const lock = YAML().parse(read(pnpm));
    // v6+ monorepos list each package under importers; a single-package v5/v6 lockfile
    // keeps its dependencies at the top level.
    const imp = lock.importers?.[relative(root, uiDir) || "."] || lock.importers?.["."] || lock;
    for (const n of names) {
      const e = imp.dependencies?.[n] || imp.devDependencies?.[n];
      const v = e && String(e.version || e).replace(/\(.*$/, "");
      if (v && !/^(link|workspace|file|portal):/.test(v)) out[n] = v;
    }
  } else if (existsSync(npmLock)) {
    const lock = JSON.parse(read(npmLock));
    const rel = relative(root, uiDir);
    for (const n of names) {
      const e = lock.packages?.[`${rel ? rel + "/" : ""}node_modules/${n}`] || lock.packages?.[`node_modules/${n}`];
      if (e?.version) out[n] = e.version;
    }
  } else if (existsSync(yarn) || existsSync(bun)) {
    const text = read(existsSync(yarn) ? yarn : bun);
    for (const n of names) {
      const esc = n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const m = text.match(new RegExp(`(?:^|\\n)"?${esc}@[^\\n]*\\n\\s+version:?\\s+"?([0-9][^"\\s]*)`)) || text.match(new RegExp(`"${esc}@([0-9][^"]*)"`));
      if (m) out[n] = m[1];
    }
  }
  // Fall back to the declared range's floor, and say so.
  const pkg = JSON.parse(read(join(uiDir, "package.json")) || "{}");
  for (const n of names) {
    if (out[n]) continue;
    const r = pkg.dependencies?.[n] || pkg.devDependencies?.[n];
    if (r) { const m = r.match(/\d+\.\d+\.\d+/); if (m) { out[n] = m[0]; warn(`${n}: no lockfile entry, using the floor of "${r}"`); } }
  }
  return out;
}

// name → directory of every package in the clone (pnpm/npm/yarn workspaces alike).
export function workspacePackages(root) {
  const out = {};
  for (const p of walk(root, (f) => f.endsWith("/package.json"), 400)) {
    try { const j = JSON.parse(read(p)); if (j.name && dirname(p) !== root) out[j.name] = dirname(p); } catch {}
  }
  return out;
}

const ICON_PACKAGES = ["@carbon/icons-react", "lucide-react", "@heroicons/react", "@phosphor-icons/react", "@tabler/icons-react", "react-icons", "@radix-ui/react-icons", "@mui/icons-material", "react-feather", "@iconify/react"];
const CSS_IN_JS = ["styled-components", "@emotion/react", "@emotion/styled", "@mui/material", "@chakra-ui/react", "@mantine/core", "@stitches/react", "@vanilla-extract/css", "@pandacss/dev"];

// Propose a profile from the code. Returns {profile, notes}; nothing is saved here.
export function detect(repo, dir, commit) {
  const notes = [];
  const pkgs = walk(dir, (p) => p.endsWith("/package.json"), 400)
    .map((p) => ({ p, j: (() => { try { return JSON.parse(read(p)); } catch { return {}; } })() }))
    .map(({ p, j }) => ({ dir: dirname(p), deps: { ...j.dependencies, ...j.devDependencies }, name: j.name }));
  const score = (d) => (d.deps.react || d.deps.vue || d.deps.svelte || d.deps["solid-js"] ? 10 : 0) + (d.deps.tailwindcss ? 5 : 0)
    + (existsSync(join(d.dir, "components.json")) ? 4 : 0) + (/\b(ui|web|app|frontend|client|site)\b/.test(relative(dir, d.dir)) ? 2 : 0)
    + (d.deps.vite || d.deps.next || d.deps["react-scripts"] ? 2 : 0);
  const ui = pkgs.sort((a, b) => score(b) - score(a))[0];
  if (!ui || score(ui) < 10) {
    notes.push("no React/Vue/Svelte package found — this repo has no UI code to build on; use Carbon or a brand instead");
    return { profile: { repo, kind: "none", commit }, notes };
  }
  const uiRel = relative(dir, ui.dir) || ".";
  const framework = ui.deps.react ? "react" : ui.deps.vue ? "vue" : ui.deps.svelte ? "svelte" : "solid";
  if (framework !== "react") notes.push(`${framework} UI: classes and copy can still be lifted, but <ui-component> renders React only`);

  // Styling system.
  const tailwind = !!ui.deps.tailwindcss;
  const cssInJs = CSS_IN_JS.filter((n) => ui.deps[n]);
  const cssFiles = walk(ui.dir, (p) => /\.(css|scss|sass|less)$/.test(p), 600);
  const twEntry = cssFiles.find((p) => /@import\s+["']tailwindcss["']|@tailwind\s+base/.test(read(p)));
  const shadcn = existsSync(join(ui.dir, "components.json")) ? JSON.parse(read(join(ui.dir, "components.json"))) : null;
  let styling = "plain-css", cssEntry = "";
  if (tailwind) {
    styling = "tailwind";
    cssEntry = shadcn?.tailwind?.css ? join(ui.dir, shadcn.tailwind.css) : twEntry || "";
    if (!cssEntry) notes.push("tailwind is a dependency but no CSS file imports it — set css_entry by hand");
  } else if (cssInJs.length) {
    styling = "css-in-js";
    notes.push(`styles live in JS (${cssInJs.join(", ")}): prototypes render the repo's real components through <ui-component>; hand-written markup will not pick up its look`);
  } else {
    styling = cssFiles.some((p) => /\.module\.(css|scss)$/.test(p)) ? "css-modules" : "plain-css";
    cssEntry = cssFiles.find((p) => /(index|main|app|global|globals|styles?)\.(css|scss)$/i.test(p)) || cssFiles[0] || "";
    notes.push(`${styling}: the build inlines the repo's own CSS (${cssEntry ? relative(dir, cssEntry) : "none found"}); class names must be the ones the components use`);
  }
  const tailwindMajor = tailwind ? Number(String(ui.deps.tailwindcss).match(/\d+/)?.[0] || 4) : null;
  const twConfig = tailwind && tailwindMajor < 4 ? walk(ui.dir, (p) => /tailwind\.config\.(js|cjs|mjs|ts)$/.test(p), 5)[0] || "" : "";

  // Icons, by how many source files import each package.
  const src = walk(ui.dir, (p) => /\.(tsx|jsx|ts|js|vue|svelte)$/.test(p) && !/\.(test|spec|stories)\./.test(p), 3000);
  const counts = Object.fromEntries(ICON_PACKAGES.map((n) => [n, 0]));
  for (const f of src) { const t = read(f); for (const n of ICON_PACKAGES) if (t.includes(`from "${n}`) || t.includes(`from '${n}`)) counts[n]++; }
  const icons = ICON_PACKAGES.filter((n) => counts[n] > 0).sort((a, b) => counts[b] - counts[a]);
  const iconPackage = icons[0] || "";
  if (icons.length > 1) notes.push(`several icon packages in use (${icons.map((n) => `${n}×${counts[n]}`).join(", ")}); using ${iconPackage}`);

  // Class merger (cn) — tailwind-merge resolves conflicting utilities the way the app does.
  const merger = ui.deps["tailwind-merge"] ? "tailwind-merge" : ui.deps.clsx ? "clsx" : ui.deps.classnames ? "classnames" : "";

  // Fonts the app loads: <link> tags in index.html, @fontsource deps, next/font.
  const html = [join(ui.dir, "index.html"), join(ui.dir, "public/index.html")].map(read).join("\n");
  const fontLinks = [...html.matchAll(/<link[^>]+fonts\.googleapis\.com[^>]*>/g)].map((m) => m[0]);
  // next/font: `import { Inter } from "next/font/google"` in the root layout or _app.
  const fontsource = Object.keys(ui.deps).filter((n) => n.startsWith("@fontsource"));
  const families = new Set();
  for (const l of fontLinks) for (const m of l.matchAll(/family=([^:&"]+)/g)) families.add(decodeURIComponent(m[1]).replace(/\+/g, " "));
  for (const n of fontsource) families.add(n.replace(/^@fontsource(-variable)?\//, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  const localFonts = [], fontVars = {};
  for (const f of ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "pages/_app.tsx", "src/pages/_app.tsx", "app/fonts.ts", "lib/fonts.ts"].map((p) => join(ui.dir, p))) {
    const t = read(f);
    const alias = {}; // local binding → family, e.g. FontSans → Inter
    for (const m of t.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g))
      for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
        const [name, as] = part.split(/\s+as\s+/); const fam = name.replace(/_/g, " ");
        families.add(fam); alias[(as || name).trim()] = fam;
      }
    // const fontSans = FontSans({ …, variable: "--font-sans" }) → --font-sans: Inter
    for (const m of t.matchAll(/=\s*(\w+)\(\{[^}]*?variable:\s*["'](--[\w-]+)["']/g)) if (alias[m[1]]) fontVars[m[2]] = alias[m[1]];
    for (const m of t.matchAll(/localFont\(\{([^}]*)\}/g)) {
      const src = m[1].match(/src:\s*["']([^"']+)["']/)?.[1]; if (!src) continue;
      const rel = relative(dir, join(dirname(f), src)); localFonts.push(rel);
      const v = m[1].match(/variable:\s*["'](--[\w-]+)["']/)?.[1];
      if (v) fontVars[v] = rel.split("/").pop().replace(/[-_](regular|bold|semibold|medium|light|italic|variable).*$/i, "").replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    }
  }
  if (localFonts.length) notes.push(`local font files (${localFonts.join(", ")}): the build inlines them when listed under fonts_local`);

  // Where screens and components live — hints for reading, never copied.
  const has = (p) => existsSync(join(ui.dir, p));
  const shell = ["src/app.tsx", "src/App.tsx", "src/main.tsx", "app/layout.tsx", "src/app/layout.tsx", "pages/_app.tsx", "src/App.vue", "src/routes/+layout.svelte"].filter(has);
  const components = ["src/components/ui", "components/ui", "src/components", "components"].filter(has);
  const darkMode = /\.dark\b|@custom-variant dark|darkMode:\s*["']class/.test(read(cssEntry) + read(twConfig));

  const versions = lockedVersions(dir, ui.dir, ["tailwindcss", "react", "react-dom", "tailwind-merge", "clsx", iconPackage].filter(Boolean));
  if (tailwind && !versions.tailwindcss) notes.push("could not read the locked Tailwind version — confirm it before building");

  return {
    profile: {
      repo, commit, kind: "repo", framework, ui_dir: uiRel,
      styling, ...(tailwind ? { tailwind_major: tailwindMajor } : {}),
      css_entry: cssEntry ? relative(dir, cssEntry) : "",
      ...(twConfig ? { tailwind_config: relative(dir, twConfig) } : {}),
      icon_package: iconPackage, class_merge: merger,
      fonts: [...families], ...(localFonts.length ? { fonts_local: localFonts } : {}), ...(Object.keys(fontVars).length ? { font_vars: fontVars } : {}), dark_mode: darkMode ? "class" : "none",
      shell: shell.map((p) => join(uiRel, p)), components: components.map((p) => join(uiRel, p)),
      versions,
    },
    notes,
  };
}
