// Shared paths and helpers for the Design Desk toolkit. Every bin/ script imports this.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLKIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = process.env.HOME || "/home/agent";
export const WORK = process.env.WORK_DIR || join(HOME, "work");
// Persistent: survives hibernation and restarts. Per-repo toolchains and fonts live here.
export const DATA = process.env.DESIGN_DESK_DATA || join(HOME, ".local/share/design-desk");
// Ephemeral: emptied at every boot. Fresh clones and build scratch live here.
export const SCRATCH = process.env.DESIGN_DESK_SCRATCH || "/tmp/design-desk";
export const req = createRequire(join(TOOLKIT, "package.json"));

export const fail = (msg) => { console.error(`design: ${msg}`); process.exit(1); };
export const warn = (msg) => console.error(`design: warning: ${msg}`);
export const ensureDir = (d) => { mkdirSync(d, { recursive: true }); return d; };
export const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
export const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

// work/CONFIG.md reader, same contract as scripts/lib/config.sh: `- <key>: <value>`,
// first match wins, trailing # comment and one layer of quotes stripped.
export function cfg(key, fallback = "") {
  let text = "";
  try { text = readFileSync(join(WORK, "CONFIG.md"), "utf8"); } catch { return fallback; }
  for (const line of text.split("\n")) {
    const m = line.match(new RegExp(`^- ${key}:[\\t ]*(.*)$`));
    if (!m) continue;
    const v = m[1].replace(/\s*#.*$/, "").trim().replace(/^[`"']/, "").replace(/[`"']$/, "");
    return v || fallback;
  }
  return fallback;
}

// Rows of the Markdown table under `## <heading>` in work/CONFIG.md, as objects keyed
// by the lowercased header cells; same contract as cfg_table in scripts/lib/config.sh.
export function cfgTable(heading) {
  let text = "";
  try { text = readFileSync(join(WORK, "CONFIG.md"), "utf8"); } catch { return []; }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return [];
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const rows = [];
  let head = null;
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(l)) break;
    if (!l.trim().startsWith("|")) continue;
    if (!head) { head = cells(l).map((h) => h.toLowerCase()); continue; }
    if (/^\|?\s*:?-{3,}/.test(l.trim())) continue;
    const c = cells(l);
    rows.push(Object.fromEntries(head.map((h, i) => [h, (c[i] || "").replace(/^[`"']|[`"']$/g, "")])));
  }
  return rows;
}

// The browser every screenshot, PDF and video uses. Order: $CHROMIUM, the image's
// Playwright Chromium, the one install-toolkit.sh unpacked into DATA, one on PATH.
export function chromium() {
  if (process.env.CHROMIUM && existsSync(process.env.CHROMIUM)) return { executablePath: process.env.CHROMIUM, env: {} };
  const pw = "/opt/ms-playwright";
  if (existsSync(pw)) {
    const dirs = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) {
      const exe = join(pw, d, "chrome-linux64/chrome");
      if (existsSync(exe)) return { executablePath: exe, env: {} };
    }
  }
  const own = join(DATA, "chromium/chromium");
  if (existsSync(own)) {
    const base = join(DATA, "chromium");
    return { executablePath: own, env: { LD_LIBRARY_PATH: `${base}/lib:${base}`, FONTCONFIG_PATH: `${base}/fonts` } };
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const r = run("sh", ["-c", `command -v ${name}`]);
    if (r.status === 0 && r.stdout.trim()) return { executablePath: r.stdout.trim(), env: {} };
  }
  return null;
}

export async function launch() {
  const found = chromium();
  if (!found) fail("no Chromium found — run `bash ~/scripts/install-toolkit.sh` (it installs one), or set CHROMIUM=/path/to/chrome");
  Object.assign(process.env, found.env);
  const { chromium: pw } = req("playwright-core");
  return pw.launch({ executablePath: found.executablePath, args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files", "--font-render-hinting=none"] });
}

// @font-face rules with the font files inlined, so a deliverable never needs a font CDN.
// `families` is [{family, weights:[300,400], dir}] where dir holds fontsource-style files.
export function fontFaces(families) {
  const out = [];
  for (const { family, weights, dir, files } of families) {
    if (files) { // uploaded brand fonts: [{path, weight, style}]
      for (const f of files) {
        const ext = f.path.split(".").pop().toLowerCase();
        const fmt = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" }[ext] || "woff2";
        const data = readFileSync(f.path).toString("base64");
        out.push(`@font-face{font-family:"${family}";font-style:${f.style || "normal"};font-weight:${f.weight || 400};font-display:swap;src:url(data:font/${ext};base64,${data}) format("${fmt}")}`);
      }
      continue;
    }
    for (const w of weights) {
      const file = readdirSync(dir).find((f) => new RegExp(`-latin-${w}-normal\\.woff2$`).test(f));
      if (!file) { warn(`no ${family} ${w} latin file in ${dir}`); continue; }
      const data = readFileSync(join(dir, file)).toString("base64");
      out.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2")}`);
    }
  }
  return out.join("\n");
}

// Fontsource package dir for a family, from the toolkit (Plex) or DATA/fonts (on demand).
export function fontsourceDir(family) {
  const pkg = `@fontsource/${family.toLowerCase().replace(/\s+/g, "-")}`;
  for (const base of [join(TOOLKIT, "node_modules"), join(DATA, "fonts/node_modules")]) {
    const d = join(base, pkg, "files");
    if (existsSync(d)) return d;
  }
  return null;
}

export const PLEX = [
  { family: "IBM Plex Sans", weights: [300, 400, 500, 600, 700] },
  { family: "IBM Plex Mono", weights: [400, 500, 600] },
];

export function plexFaces() {
  return fontFaces(PLEX.map((f) => ({ ...f, dir: fontsourceDir(f.family) })));
}

export const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
export const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
export const slugOf = (repo) => repo.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]+/g, "__");
export const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]));
export const tagRe = (name) => new RegExp(`<${name}\\b([^>]*?)\\s*(?:/>|>\\s*</${name}>)`, "g");
